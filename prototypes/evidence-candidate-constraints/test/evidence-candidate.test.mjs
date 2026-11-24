import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Client, Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PROTOTYPE_SCHEMA ?? 'evidence_candidate_constraint_fixture';
const RESULTS_PATH = process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json';
assert.ok(DATABASE_URL, 'DATABASE_URL is required');

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
const outcomes = [];
let sequence = 0;

function id(prefix) {
  sequence += 1;
  return `${prefix}_${Date.now()}_${sequence}`;
}

async function transactionClient() {
  const client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query(`SET LOCAL search_path TO ${SCHEMA}, public`);
  await client.query(`SET LOCAL statement_timeout = '10s'`);
  const { rows } = await client.query('SHOW transaction_isolation');
  assert.equal(rows[0].transaction_isolation, 'read committed');
  return client;
}

async function observerClient() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  return client;
}

async function standalonePublicClient() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('SET search_path TO public');
  const { rows } = await client.query('SHOW search_path');
  assert.equal(rows[0].search_path, 'public');
  return client;
}

async function insertFullyQualifiedEvidence(client, { withSupport = true } = {}) {
  const projectId = id('qualified_project');
  const workflowRunId = id('qualified_workflow');
  const candidateVersionId = id('qualified_candidate');
  const eventId = id('qualified_event');
  const evidenceId = id('qualified_evidence');
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query('SET LOCAL search_path TO public');
  await client.query(`INSERT INTO ${SCHEMA}.project(project_id) VALUES ($1)`, [projectId]);
  await client.query(
    `INSERT INTO ${SCHEMA}.workflow_run(workflow_run_id, project_id) VALUES ($1, $2)`,
    [workflowRunId, projectId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.candidate_version(candidate_version_id, project_id, workflow_run_id)
     VALUES ($1, $2, $3)`,
    [candidateVersionId, projectId, workflowRunId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.candidate_event(candidate_event_id, project_id, candidate_version_id)
     VALUES ($1, $2, $3)`,
    [eventId, projectId, candidateVersionId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.evidence_reference(
       evidence_reference_id, project_id, source_domain, source_version_id,
       source_object_type, source_object_id, locator, evidence_kind
     ) VALUES ($1, $2, 'candidate', $3, 'candidate_event', $4, 'chars:qualified', 'text_span')`,
    [evidenceId, projectId, candidateVersionId, eventId],
  );
  if (withSupport) {
    await client.query(
      `INSERT INTO ${SCHEMA}.evidence_candidate_source(
         evidence_reference_id, candidate_version_id, source_object_type, source_object_id,
         source_candidate_event_id
       ) VALUES ($1, $2, 'candidate_event', $3, $3)`,
      [evidenceId, candidateVersionId, eventId],
    );
  }
  return { projectId, workflowRunId, candidateVersionId, eventId, evidenceId };
}

async function rollbackQuietly(client) {
  if (!client) return;
  try {
    await client.query('ROLLBACK');
  } catch {
    // Cleanup continues when the transaction has already ended.
  }
}

function scenario(name, fn, timeout = 20_000) {
  test(name, { timeout }, async () => {
    try {
      const evidence = await fn();
      outcomes.push({ name, status: 'passed', evidence: evidence ?? '' });
    } catch (error) {
      outcomes.push({
        name,
        status: 'failed',
        evidence: '',
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
        constraint: error?.constraint ?? null,
      });
      throw error;
    }
  });
}

async function expectPgError(action, { code, constraint, stage }) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${stage} should fail`);
  assert.equal(caught.code, code, `${stage} SQLSTATE`);
  assert.equal(caught.constraint, constraint, `${stage} constraint`);
  return caught;
}

async function seedProject(client, projectId = id('project')) {
  await client.query('INSERT INTO project(project_id) VALUES ($1)', [projectId]);
  return projectId;
}

async function seedCandidate(client, {
  projectId = id('project'),
  workflowProjectId = projectId,
  candidateProjectId = projectId,
  workflowRunId = id('workflow'),
  candidateVersionId = id('candidate'),
  createProjects = true,
} = {}) {
  if (createProjects) {
    for (const value of new Set([projectId, workflowProjectId, candidateProjectId])) {
      await seedProject(client, value);
    }
  }
  await client.query(
    'INSERT INTO workflow_run(workflow_run_id, project_id) VALUES ($1, $2)',
    [workflowRunId, workflowProjectId],
  );
  await client.query(
    'INSERT INTO candidate_version(candidate_version_id, project_id, workflow_run_id) VALUES ($1, $2, $3)',
    [candidateVersionId, candidateProjectId, workflowRunId],
  );
  return { projectId, workflowProjectId, candidateProjectId, workflowRunId, candidateVersionId };
}

async function createSource(client, type, graph, overrides = {}) {
  const projectId = overrides.projectId ?? graph.candidateProjectId;
  const candidateVersionId = overrides.candidateVersionId ?? graph.candidateVersionId;
  const objectId = overrides.objectId ?? id(type);
  const source = {
    type,
    objectId,
    projectId,
    candidateVersionId,
    sourceCandidateEventId: null,
    sourceCandidateFactProposalId: null,
    sourceCandidateStateTransitionId: null,
    sourceAssertionId: null,
  };
  if (type === 'candidate_version') {
    source.objectId = candidateVersionId;
    return source;
  }
  if (type === 'candidate_event') {
    await client.query(
      'INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id) VALUES ($1, $2, $3)',
      [objectId, projectId, candidateVersionId],
    );
    source.sourceCandidateEventId = objectId;
    return source;
  }
  if (type === 'candidate_fact_proposal') {
    await client.query(
      'INSERT INTO candidate_fact_proposal(candidate_fact_proposal_id, project_id, candidate_version_id) VALUES ($1, $2, $3)',
      [objectId, projectId, candidateVersionId],
    );
    source.sourceCandidateFactProposalId = objectId;
    return source;
  }
  if (type === 'candidate_state_transition') {
    await client.query(
      'INSERT INTO candidate_state_transition(candidate_state_transition_id, project_id, candidate_version_id) VALUES ($1, $2, $3)',
      [objectId, projectId, candidateVersionId],
    );
    source.sourceCandidateStateTransitionId = objectId;
    return source;
  }
  if (type === 'narrative_assertion') {
    const assertionDomain = overrides.assertionDomain ?? 'candidate';
    const assertionCandidateVersionId = overrides.assertionCandidateVersionId ?? candidateVersionId;
    await client.query(
      'INSERT INTO narrative_assertion(assertion_id, project_id, source_domain) VALUES ($1, $2, $3)',
      [objectId, projectId, assertionDomain],
    );
    await client.query(
      `INSERT INTO narrative_assertion_candidate_source(assertion_id, candidate_version_id, source_version_id)
       VALUES ($1, $2, $2)`,
      [objectId, assertionCandidateVersionId],
    );
    source.sourceAssertionId = objectId;
    return source;
  }
  throw new Error(`unsupported test source type ${type}`);
}

function parentValues(source, overrides = {}) {
  return {
    evidenceId: overrides.evidenceId ?? id('evidence'),
    projectId: overrides.projectId ?? source.projectId,
    sourceDomain: overrides.sourceDomain ?? 'candidate',
    sourceVersionId: overrides.sourceVersionId ?? source.candidateVersionId,
    sourceObjectType: overrides.sourceObjectType ?? source.type,
    sourceObjectId: overrides.sourceObjectId ?? source.objectId,
    locator: overrides.locator ?? 'chars:10-24',
    evidenceKind: overrides.evidenceKind ?? 'text_span',
  };
}

async function insertParent(client, values) {
  await client.query(
    `INSERT INTO evidence_reference(
       evidence_reference_id, project_id, source_domain, source_version_id,
       source_object_type, source_object_id, locator, evidence_kind
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      values.evidenceId,
      values.projectId,
      values.sourceDomain,
      values.sourceVersionId,
      values.sourceObjectType,
      values.sourceObjectId,
      values.locator,
      values.evidenceKind,
    ],
  );
}

async function insertSupport(client, evidenceId, source, overrides = {}) {
  await client.query(
    `INSERT INTO evidence_candidate_source(
       evidence_reference_id, candidate_version_id, source_object_type, source_object_id,
       source_candidate_event_id, source_candidate_fact_proposal_id,
       source_candidate_state_transition_id, source_assertion_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      evidenceId,
      overrides.candidateVersionId ?? source.candidateVersionId,
      overrides.sourceObjectType ?? source.type,
      overrides.sourceObjectId ?? source.objectId,
      Object.hasOwn(overrides, 'sourceCandidateEventId') ? overrides.sourceCandidateEventId : source.sourceCandidateEventId,
      Object.hasOwn(overrides, 'sourceCandidateFactProposalId') ? overrides.sourceCandidateFactProposalId : source.sourceCandidateFactProposalId,
      Object.hasOwn(overrides, 'sourceCandidateStateTransitionId') ? overrides.sourceCandidateStateTransitionId : source.sourceCandidateStateTransitionId,
      Object.hasOwn(overrides, 'sourceAssertionId') ? overrides.sourceAssertionId : source.sourceAssertionId,
    ],
  );
}

async function insertEvidencePair(client, source, overrides = {}) {
  const values = parentValues(source, overrides);
  await insertParent(client, values);
  await insertSupport(client, values.evidenceId, source, overrides.support ?? {});
  return values;
}

async function assertEvidenceState(evidenceId, expected = 1) {
  const check = await observerClient();
  try {
    const { rows } = await check.query(
      `SELECT er.*, ecs.candidate_version_id AS support_candidate_version_id,
              ecs.source_object_type AS support_object_type,
              ecs.source_object_id AS support_object_id
         FROM evidence_reference er
         LEFT JOIN evidence_candidate_source ecs USING (evidence_reference_id)
        WHERE er.evidence_reference_id = $1`,
      [evidenceId],
    );
    assert.equal(rows.length, expected);
    if (expected === 1) {
      assert.equal(rows[0].source_version_id, rows[0].support_candidate_version_id);
      assert.equal(rows[0].source_object_type, rows[0].support_object_type);
      assert.equal(rows[0].source_object_id, rows[0].support_object_id);
    }
    return rows;
  } finally {
    check.release();
  }
}

async function waitForBlocked(observer, waitingPid, blockerPid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `SELECT wait_event_type, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE pid = $1`,
      [waitingPid],
    );
    const row = rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.map(Number).includes(Number(blockerPid))) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`backend ${waitingPid} was not observed blocked by ${blockerPid}`);
}

before(async () => {
  const client = await observerClient();
  try {
    await client.query(`SET default_transaction_isolation = 'read committed'`);
  } finally {
    client.release();
  }
});

after(async () => {
  await writeFile(RESULTS_PATH, JSON.stringify({
    database: 'PostgreSQL',
    isolation: 'read committed',
    schema: SCHEMA,
    outcomes,
  }, null, 2));
  await pool.end();
});

const sourceTypes = [
  'candidate_version',
  'candidate_event',
  'candidate_fact_proposal',
  'candidate_state_transition',
  'narrative_assertion',
];

scenario('五种 Candidate 来源分别提交完整父子关系', async () => {
  const evidenceIds = [];
  for (const type of sourceTypes) {
    const client = await transactionClient();
    try {
      const graph = await seedCandidate(client);
      const source = await createSource(client, type, graph);
      const evidence = await insertEvidencePair(client, source, { locator: `chars:${sequence}-${sequence + 10}` });
      await client.query('COMMIT');
      evidenceIds.push(evidence.evidenceId);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  for (const evidenceId of evidenceIds) await assertEvidenceState(evidenceId);
  return `真实 COMMIT 成功；${sourceTypes.join('、')} 均可从独立连接读取完整父子身份`;
});

scenario('public search_path 下全限定合法父子关系可提交', async () => {
  const client = await standalonePublicClient();
  let ids;
  try {
    const { rows: functionRows } = await client.query(
      `SELECT p.proname, p.proconfig
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
          AND p.proname = ANY($2::text[])
        ORDER BY p.proname`,
      [SCHEMA, [
        'protect_source_ownership',
        'raise_evidence_candidate_complete',
        'reject_evidence_mutation',
        'validate_evidence_candidate',
        'validate_evidence_candidate_trigger',
      ]],
    );
    assert.equal(functionRows.length, 5);
    for (const row of functionRows) {
      assert.deepEqual(row.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);
    }
    ids = await insertFullyQualifiedEvidence(client);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    await client.end();
  }
  const check = await standalonePublicClient();
  try {
    const { rows } = await check.query(
      `SELECT er.source_version_id, er.source_object_id, ecs.candidate_version_id,
              ecs.source_candidate_event_id
         FROM ${SCHEMA}.evidence_reference er
         JOIN ${SCHEMA}.evidence_candidate_source ecs USING (evidence_reference_id)
        WHERE er.evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_version_id, ids.candidateVersionId);
    assert.equal(rows[0].candidate_version_id, ids.candidateVersionId);
    assert.equal(rows[0].source_object_id, ids.eventId);
    assert.equal(rows[0].source_candidate_event_id, ids.eventId);
  } finally {
    await check.end();
  }
  return '新建直连连接固定 search_path=public；全部对象名带 Schema；合法父子关系真实 COMMIT 并由另一新连接回读';
});

scenario('public search_path 下只有父行仍在 COMMIT 拒绝', async () => {
  const client = await standalonePublicClient();
  let ids;
  try {
    ids = await insertFullyQualifiedEvidence(client, { withSupport: false });
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_candidate_complete', stage: 'fully-qualified parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    await client.end();
  }
  const check = await standalonePublicClient();
  try {
    const { rows } = await check.query(
      `SELECT count(*)::int AS count
         FROM ${SCHEMA}.evidence_reference
        WHERE evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows[0].count, 0);
  } finally {
    await check.end();
  }
  return '前置 INSERT 成功；真实 COMMIT 以 23514/evidence_candidate_complete 失败；新连接确认无父行半成品';
});

scenario('public search_path 下不可变与归属保护仍生效', async () => {
  const setup = await standalonePublicClient();
  let ids;
  try {
    ids = await insertFullyQualifiedEvidence(setup);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    await setup.end();
  }

  const identityClient = await standalonePublicClient();
  try {
    await identityClient.query('BEGIN');
    await expectPgError(
      () => identityClient.query(
        `UPDATE ${SCHEMA}.evidence_reference SET locator = 'chars:changed'
          WHERE evidence_reference_id = $1`,
        [ids.evidenceId],
      ),
      { code: '23514', constraint: 'evidence_candidate_immutable', stage: 'fully-qualified Evidence UPDATE' },
    );
  } finally {
    await rollbackQuietly(identityClient);
    await identityClient.end();
  }

  const ownershipClient = await standalonePublicClient();
  try {
    await ownershipClient.query('BEGIN');
    const otherProjectId = id('qualified_other_project');
    await ownershipClient.query(`INSERT INTO ${SCHEMA}.project(project_id) VALUES ($1)`, [otherProjectId]);
    await expectPgError(
      () => ownershipClient.query(
        `UPDATE ${SCHEMA}.candidate_event SET project_id = $2 WHERE candidate_event_id = $1`,
        [ids.eventId, otherProjectId],
      ),
      { code: '23514', constraint: 'evidence_candidate_complete', stage: 'fully-qualified source ownership UPDATE' },
    );
  } finally {
    await rollbackQuietly(ownershipClient);
    await ownershipClient.end();
  }

  const check = await standalonePublicClient();
  try {
    const { rows } = await check.query(
      `SELECT er.locator, ce.project_id, ecs.source_object_id
         FROM ${SCHEMA}.evidence_reference er
         JOIN ${SCHEMA}.evidence_candidate_source ecs USING (evidence_reference_id)
         JOIN ${SCHEMA}.candidate_event ce ON ce.candidate_event_id = ecs.source_candidate_event_id
        WHERE er.evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].locator, 'chars:qualified');
    assert.equal(rows[0].project_id, ids.projectId);
    assert.equal(rows[0].source_object_id, ids.eventId);
  } finally {
    await check.end();
  }
  return '新连接 public 路径下 Evidence UPDATE 命中 23514/evidence_candidate_immutable，来源归属 UPDATE 命中 23514/evidence_candidate_complete；原链保留';
});

scenario('只有 Evidence 父行时真实 COMMIT 失败', async () => {
  const client = await transactionClient();
  let evidenceId;
  try {
    const graph = await seedCandidate(client);
    const source = await createSource(client, 'candidate_version', graph);
    const values = parentValues(source);
    evidenceId = values.evidenceId;
    await insertParent(client, values);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_candidate_complete', stage: 'COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceId, 0);
  return '父 INSERT 成功；COMMIT 以 23514/evidence_candidate_complete 失败；独立连接确认父行未持久化';
});

scenario('重复支撑行、悬空 FK 与错误目标组合命中各自即时约束', async () => {
  const cases = [];

  {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedCandidate(client);
      const source = await createSource(client, 'candidate_event', graph);
      const values = await insertEvidencePair(client, source);
      evidenceId = values.evidenceId;
      const error = await expectPgError(() => insertSupport(client, values.evidenceId, source), {
        code: '23505', constraint: 'evidence_candidate_source_pkey', stage: '第二个支撑行 INSERT',
      });
      cases.push(`${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }

  {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedCandidate(client);
      const source = await createSource(client, 'candidate_event', graph);
      const values = parentValues(source);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      const error = await expectPgError(
        () => insertSupport(client, values.evidenceId, source, {
          sourceObjectId: 'missing_event', sourceCandidateEventId: 'missing_event',
        }),
        { code: '23503', constraint: 'fk_evidence_candidate_event', stage: '悬空目标 INSERT' },
      );
      cases.push(`${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }

  {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedCandidate(client);
      const event = await createSource(client, 'candidate_event', graph);
      const fact = await createSource(client, 'candidate_fact_proposal', graph);
      const values = parentValues(event);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      const error = await expectPgError(
        () => insertSupport(client, values.evidenceId, event, {
          sourceCandidateFactProposalId: fact.objectId,
        }),
        { code: '23514', constraint: 'ck_evidence_candidate_source_target_shape', stage: '错误目标组合 INSERT' },
      );
      cases.push(`${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `即时失败分别为 ${cases.join('、')}；均未被误算为延后检查`;
});

scenario('父子类型或对象 ID 不一致在真实 COMMIT 失败', async () => {
  const verified = [];
  for (const mismatch of ['type', 'object']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedCandidate(client);
      let parentSource;
      let supportSource;
      if (mismatch === 'type') {
        const sharedObjectId = id('shared_cross_type_object');
        const event = await createSource(client, 'candidate_event', graph, { objectId: sharedObjectId });
        const fact = await createSource(client, 'candidate_fact_proposal', graph, { objectId: sharedObjectId });
        assert.equal(event.objectId, fact.objectId, 'type mismatch must keep source_object_id identical');
        assert.notEqual(event.type, fact.type, 'only source_object_type may differ');
        assert.equal(event.candidateVersionId, fact.candidateVersionId);
        assert.equal(event.projectId, fact.projectId);
        const { rows } = await client.query(
          `SELECT
             (SELECT count(*)::int FROM candidate_event WHERE candidate_event_id = $1) AS event_count,
             (SELECT count(*)::int FROM candidate_fact_proposal WHERE candidate_fact_proposal_id = $1) AS fact_count`,
          [sharedObjectId],
        );
        assert.deepEqual(rows[0], { event_count: 1, fact_count: 1 }, 'both same-ID targets must exist');
        parentSource = event;
        supportSource = fact;
      } else {
        const eventA = await createSource(client, 'candidate_event', graph);
        const eventB = await createSource(client, 'candidate_event', graph);
        assert.equal(eventA.type, eventB.type, 'object mismatch must keep source_object_type identical');
        assert.notEqual(eventA.objectId, eventB.objectId, 'only source_object_id may differ');
        assert.equal(eventA.candidateVersionId, eventB.candidateVersionId);
        assert.equal(eventA.projectId, eventB.projectId);
        parentSource = eventA;
        supportSource = eventB;
      }
      const values = parentValues(parentSource);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      await insertSupport(client, evidenceId, supportSource);
      const { rows: insertedRows } = await client.query(
        `SELECT er.source_object_type AS parent_type, er.source_object_id AS parent_id,
                ecs.source_object_type AS support_type, ecs.source_object_id AS support_id,
                er.source_version_id, ecs.candidate_version_id
           FROM evidence_reference er
           JOIN evidence_candidate_source ecs USING (evidence_reference_id)
          WHERE er.evidence_reference_id = $1`,
        [evidenceId],
      );
      assert.equal(insertedRows.length, 1, 'all pre-COMMIT rows must be inserted');
      assert.equal(insertedRows[0].source_version_id, insertedRows[0].candidate_version_id);
      if (mismatch === 'type') {
        assert.equal(insertedRows[0].parent_id, insertedRows[0].support_id);
        assert.notEqual(insertedRows[0].parent_type, insertedRows[0].support_type);
      } else {
        assert.equal(insertedRows[0].parent_type, insertedRows[0].support_type);
        assert.notEqual(insertedRows[0].parent_id, insertedRows[0].support_id);
      }
      await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_candidate_complete', stage: `${mismatch} mismatch COMMIT`,
      });
      verified.push(mismatch);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  assert.deepEqual(verified, ['type', 'object']);
  return '2 个独立子场景：类型不一致保持同一对象文本 ID，对象不一致保持同一类型；前置目标/Candidate/项目及父子 INSERT 均已断言，COMMIT 均以 23514/evidence_candidate_complete 失败且无半成品';
});

scenario('错误 Candidate、项目或 Workflow 归属分别在 COMMIT 失败', async () => {
  const checks = [];

  for (const kind of ['candidate', 'project', 'workflow']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      let source;
      let parent;
      if (kind === 'candidate') {
        const projectId = id('project');
        await seedProject(client, projectId);
        const graphA = await seedCandidate(client, { projectId, createProjects: false });
        const graphB = await seedCandidate(client, { projectId, createProjects: false });
        source = await createSource(client, 'candidate_event', graphA);
        parent = parentValues(source, { sourceVersionId: graphB.candidateVersionId });
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, source, { candidateVersionId: graphB.candidateVersionId });
      } else if (kind === 'project') {
        const projectA = id('project_a');
        const projectB = id('project_b');
        await seedProject(client, projectA);
        await seedProject(client, projectB);
        const graph = await seedCandidate(client, { projectId: projectB, createProjects: false });
        source = await createSource(client, 'candidate_event', graph);
        parent = parentValues(source, { projectId: projectA });
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, source);
      } else {
        const projectA = id('project_a');
        const projectB = id('project_b');
        await seedProject(client, projectA);
        await seedProject(client, projectB);
        const graph = await seedCandidate(client, {
          projectId: projectA,
          candidateProjectId: projectA,
          workflowProjectId: projectB,
          createProjects: false,
        });
        source = await createSource(client, 'candidate_event', graph);
        parent = parentValues(source);
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, source);
      }
      evidenceId = parent.evidenceId;
      const error = await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_candidate_complete', stage: `${kind} ownership COMMIT`,
      });
      checks.push(`${kind}:${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `${checks.join('；')}；每个反例仅改变一个归属条件并整体回滚`;
});

scenario('Assertion Candidate 来源链错误不能只凭 Assertion ID 通过', async () => {
  const client = await transactionClient();
  let evidenceId;
  try {
    const projectId = id('project');
    await seedProject(client, projectId);
    const graphA = await seedCandidate(client, { projectId, createProjects: false });
    const graphB = await seedCandidate(client, { projectId, createProjects: false });
    const assertion = await createSource(client, 'narrative_assertion', graphA, {
      assertionCandidateVersionId: graphB.candidateVersionId,
    });
    const values = parentValues(assertion);
    evidenceId = values.evidenceId;
    await insertParent(client, values);
    await insertSupport(client, evidenceId, assertion);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_candidate_complete', stage: 'Assertion chain COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceId, 0);
  return 'Assertion 与支撑 ID 均存在，但 Candidate 来源支撑指向另一版本；COMMIT 以 23514/evidence_candidate_complete 失败';
});

scenario('六字段完整身份重复由父表唯一约束拒绝', async () => {
  const setup = await transactionClient();
  let source;
  let first;
  try {
    const graph = await seedCandidate(setup);
    source = await createSource(setup, 'candidate_event', graph);
    first = await insertEvidencePair(setup, source);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }

  const duplicate = await transactionClient();
  try {
    const values = parentValues(source, {
      evidenceId: id('different_evidence'),
      locator: first.locator,
      evidenceKind: first.evidenceKind,
    });
    await expectPgError(() => insertParent(duplicate, values), {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'duplicate parent INSERT',
    });
  } finally {
    await rollbackQuietly(duplicate);
    duplicate.release();
  }
  await assertEvidenceState(first.evidenceId);
  return '不同 Evidence 主键的相同六字段身份在 INSERT 以 23505/uq_evidence_reference_full_identity 失败；原记录保留';
});

scenario('旧四字段相同但实际来源对象不同可分别提交', async () => {
  const client = await transactionClient();
  let evidenceA;
  let evidenceB;
  try {
    const graph = await seedCandidate(client);
    const eventA = await createSource(client, 'candidate_event', graph);
    const eventB = await createSource(client, 'candidate_event', graph);
    const common = { locator: 'chars:shared', evidenceKind: 'text_span' };
    evidenceA = await insertEvidencePair(client, eventA, common);
    evidenceB = await insertEvidencePair(client, eventB, common);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceA.evidenceId);
  await assertEvidenceState(evidenceB.evidenceId);
  return 'source_domain/source_version_id/locator/evidence_kind 相同而 source_object_id 不同的两条记录均提交；旧四字段索引非唯一';
});

scenario('同一来源对象可按不同 locator 或 evidence_kind 建立证据', async () => {
  const client = await transactionClient();
  const evidenceIds = [];
  try {
    const graph = await seedCandidate(client);
    const source = await createSource(client, 'candidate_fact_proposal', graph);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:1-2', evidenceKind: 'text_span' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:3-4', evidenceKind: 'text_span' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:1-2', evidenceKind: 'structured_claim' })).evidenceId);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  for (const evidenceId of evidenceIds) await assertEvidenceState(evidenceId);
  return '同一实际来源对象的 2 个 locator 与 2 个 evidence_kind 组合均可提交';
});

scenario('两个消费方可共享同一 Evidence', async () => {
  const client = await transactionClient();
  let evidence;
  try {
    const graph = await seedCandidate(client);
    const source = await createSource(client, 'candidate_state_transition', graph);
    evidence = await insertEvidencePair(client, source);
    await client.query(
      `INSERT INTO evidence_consumer_reference(consumer_reference_id, evidence_reference_id, consumer_kind)
       VALUES ($1, $3, 'validation_issue'), ($2, $3, 'context_source')`,
      [id('consumer'), id('consumer'), evidence.evidenceId],
    );
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  const check = await observerClient();
  try {
    const { rows } = await check.query(
      'SELECT count(*)::int AS count FROM evidence_consumer_reference WHERE evidence_reference_id = $1',
      [evidence.evidenceId],
    );
    assert.equal(rows[0].count, 2);
  } finally {
    check.release();
  }
  return '两个最小消费引用均提交且只存在一个 Evidence；消费方不进入去重身份';
});

scenario('Evidence、来源绑定与被引用对象归属均不可变', async () => {
  const setup = await transactionClient();
  let graph;
  let source;
  let evidence;
  try {
    graph = await seedCandidate(setup);
    source = await createSource(setup, 'candidate_event', graph);
    evidence = await insertEvidencePair(setup, source);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }

  const alternateProject = id('alternate_project');
  const seed = await transactionClient();
  try {
    await seedProject(seed, alternateProject);
    await seed.query('COMMIT');
  } finally {
    await rollbackQuietly(seed);
    seed.release();
  }

  const mutations = [
    ['Evidence identity UPDATE', `UPDATE evidence_reference SET locator = 'changed' WHERE evidence_reference_id = $1`, [evidence.evidenceId], 'evidence_candidate_immutable'],
    ['source binding UPDATE', 'UPDATE evidence_candidate_source SET source_object_id = source_object_id WHERE evidence_reference_id = $1', [evidence.evidenceId], 'evidence_candidate_immutable'],
    ['source ownership UPDATE', 'UPDATE candidate_event SET project_id = $2 WHERE candidate_event_id = $1', [source.objectId, alternateProject], 'evidence_candidate_complete'],
    ['Candidate Version ownership UPDATE', 'UPDATE candidate_version SET project_id = $2 WHERE candidate_version_id = $1', [graph.candidateVersionId, alternateProject], 'evidence_candidate_complete'],
    ['Workflow Run ownership UPDATE', 'UPDATE workflow_run SET project_id = $2 WHERE workflow_run_id = $1', [graph.workflowRunId, alternateProject], 'evidence_candidate_complete'],
  ];
  for (const [name, sql, params, constraint] of mutations) {
    const client = await transactionClient();
    try {
      await expectPgError(() => client.query(sql, params), { code: '23514', constraint, stage: name });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }

  const rows = await assertEvidenceState(evidence.evidenceId);
  assert.equal(rows[0].locator, evidence.locator);
  const check = await observerClient();
  try {
    const { rows: eventRows } = await check.query('SELECT project_id FROM candidate_event WHERE candidate_event_id = $1', [source.objectId]);
    assert.equal(eventRows[0].project_id, graph.projectId);
    const { rows: candidateRows } = await check.query(
      `SELECT cv.project_id AS candidate_project, wr.project_id AS workflow_project
         FROM candidate_version cv
         JOIN workflow_run wr ON wr.workflow_run_id = cv.workflow_run_id
        WHERE cv.candidate_version_id = $1`,
      [graph.candidateVersionId],
    );
    assert.equal(candidateRows[0].candidate_project, graph.projectId);
    assert.equal(candidateRows[0].workflow_project, graph.projectId);
  } finally {
    check.release();
  }
  return '身份和支撑修改以 23514/evidence_candidate_immutable 拒绝；来源对象、Candidate Version 与 Workflow Run 归属修改以 23514/evidence_candidate_complete 拒绝；独立连接确认原链保留';
});

scenario('未支持来源域和来源类型由夹具即时拒绝', async () => {
  for (const variant of ['domain', 'type']) {
    const client = await transactionClient();
    try {
      const graph = await seedCandidate(client);
      const source = await createSource(client, 'candidate_version', graph);
      const values = parentValues(source, variant === 'domain'
        ? { sourceDomain: 'canon' }
        : { sourceObjectType: 'story_event' });
      await expectPgError(() => insertParent(client, values), {
        code: '23514',
        constraint: variant === 'domain' ? 'ck_evidence_reference_candidate_domain' : 'ck_evidence_reference_candidate_type',
        stage: `unsupported ${variant} INSERT`,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  return '非 candidate 域及五类集合外的对象类型均在父 INSERT 被 CHECK 拒绝';
});

async function seedCommittedConcurrencySource() {
  const client = await transactionClient();
  try {
    const graph = await seedCandidate(client);
    const source = await createSource(client, 'candidate_event', graph);
    await client.query('COMMIT');
    return { graph, source };
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
}

scenario('并发相同完整身份：A 提交后 B 唯一冲突', async () => {
  const { source } = await seedCommittedConcurrencySource();
  const a = await transactionClient();
  const b = await transactionClient();
  const observer = await observerClient();
  let aPid;
  let bPid;
  let first;
  let duplicate;
  try {
    aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    first = await insertEvidencePair(a, source, { locator: 'chars:concurrent-commit' });
    duplicate = parentValues(source, {
      evidenceId: id('concurrent_b'),
      locator: first.locator,
      evidenceKind: first.evidenceKind,
    });
    const bInsert = insertParent(b, duplicate);
    const block = await waitForBlocked(observer, bPid, aPid);
    assert.ok(block.blockers.map(Number).includes(Number(aPid)));
    await a.query('COMMIT');
    await expectPgError(() => bInsert, {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'B blocked duplicate INSERT',
    });
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    a.release();
    b.release();
    observer.release();
  }
  await assertEvidenceState(first.evidenceId);
  await assertEvidenceState(duplicate.evidenceId, 0);
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A COMMIT；B 以 23505/uq_evidence_reference_full_identity 失败；仅 A 父子关系持久化`;
}, 30_000);

scenario('并发相同完整身份：A 回滚后 B 可完成', async () => {
  const { source } = await seedCommittedConcurrencySource();
  const a = await transactionClient();
  const b = await transactionClient();
  const observer = await observerClient();
  let aPid;
  let bPid;
  let first;
  let second;
  try {
    aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    first = await insertEvidencePair(a, source, { locator: 'chars:concurrent-rollback' });
    second = parentValues(source, {
      evidenceId: id('concurrent_b'),
      locator: first.locator,
      evidenceKind: first.evidenceKind,
    });
    const bInsert = insertParent(b, second);
    await waitForBlocked(observer, bPid, aPid);
    await a.query('ROLLBACK');
    await bInsert;
    await insertSupport(b, second.evidenceId, source);
    await b.query('COMMIT');
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    a.release();
    b.release();
    observer.release();
  }
  await assertEvidenceState(first.evidenceId, 0);
  await assertEvidenceState(second.evidenceId);
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A ROLLBACK；B 随后写入支撑并 COMMIT，完整父子关系持久化`;
}, 30_000);

scenario('共享 Candidate 的不同来源可合法并发创建', async () => {
  const setup = await transactionClient();
  let sourceA;
  let sourceB;
  try {
    const graph = await seedCandidate(setup);
    sourceA = await createSource(setup, 'candidate_event', graph);
    sourceB = await createSource(setup, 'candidate_fact_proposal', graph);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }

  const a = await transactionClient();
  const b = await transactionClient();
  let evidenceA;
  let evidenceB;
  try {
    evidenceA = await insertEvidencePair(a, sourceA, { locator: 'chars:legal-a' });
    evidenceB = await insertEvidencePair(b, sourceB, { locator: 'chars:legal-b' });
    const [commitA, commitB] = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
    assert.equal(commitA.status, 'fulfilled', commitA.reason?.message);
    assert.equal(commitB.status, 'fulfilled', commitB.reason?.message);
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    a.release();
    b.release();
  }
  const [rowsA, rowsB] = await Promise.all([
    assertEvidenceState(evidenceA.evidenceId),
    assertEvidenceState(evidenceB.evidenceId),
  ]);
  assert.equal(rowsA[0].source_version_id, rowsB[0].source_version_id);
  assert.notEqual(rowsA[0].source_object_id, rowsB[0].source_object_id);
  return '共享 Candidate Version 的不同合法对象首次并发 COMMIT 均成功，无重试；独立连接确认两套完整父子关系与共同容器';
}, 30_000);
