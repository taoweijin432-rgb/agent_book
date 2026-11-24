import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Client, Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PROTOTYPE_SCHEMA ?? 'evidence_canon_constraint_fixture';
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

async function rollbackQuietly(client) {
  if (!client) return;
  try {
    await client.query('ROLLBACK');
  } catch {
    // Cleanup continues when COMMIT already ended the transaction.
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

async function seedCommit(client, {
  projectId = id('project'),
  commitId = id('commit'),
  initialStatus = 'preparing',
  finalStatus = initialStatus,
  createProject = true,
} = {}) {
  if (createProject) await seedProject(client, projectId);
  await client.query(
    'INSERT INTO canon_commit(canon_commit_id, project_id, status) VALUES ($1, $2, $3)',
    [commitId, projectId, initialStatus],
  );
  if (finalStatus !== initialStatus) {
    await client.query('UPDATE canon_commit SET status = $2 WHERE canon_commit_id = $1', [commitId, finalStatus]);
  }
  return { projectId, commitId, status: finalStatus };
}

async function createSource(client, type, commit, overrides = {}) {
  const projectId = overrides.projectId ?? commit.projectId;
  const commitId = overrides.commitId ?? commit.commitId;
  const objectId = type === 'canon_commit' ? commitId : (overrides.objectId ?? id(type));
  const source = {
    type,
    objectId,
    projectId,
    commitId,
    sourceVersionId: type === 'canonical_text_version' ? objectId : commitId,
    canonicalTextVersionId: null,
    sourceStoryEventId: null,
    sourceCanonFactId: null,
    sourceStateTransitionId: null,
    sourceTemporalRelationId: null,
  };
  if (type === 'canon_commit') return source;
  const definitions = {
    canonical_text_version: ['canonical_text_version', 'canonical_text_version_id', 'canonicalTextVersionId'],
    story_event: ['story_event', 'story_event_id', 'sourceStoryEventId'],
    canon_fact: ['canon_fact', 'canon_fact_id', 'sourceCanonFactId'],
    state_transition: ['state_transition', 'state_transition_id', 'sourceStateTransitionId'],
    temporal_relation: ['temporal_relation', 'temporal_relation_id', 'sourceTemporalRelationId'],
  };
  const definition = definitions[type];
  if (!definition) throw new Error(`unsupported test source type ${type}`);
  const [table, primaryKey, targetProperty] = definition;
  await client.query(
    `INSERT INTO ${table}(${primaryKey}, project_id, canon_commit_id) VALUES ($1, $2, $3)`,
    [objectId, projectId, commitId],
  );
  source[targetProperty] = objectId;
  return source;
}

function parentValues(source, overrides = {}) {
  return {
    evidenceId: overrides.evidenceId ?? id('evidence'),
    projectId: overrides.projectId ?? source.projectId,
    sourceDomain: overrides.sourceDomain ?? 'canon',
    sourceVersionId: overrides.sourceVersionId ?? source.sourceVersionId,
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
    `INSERT INTO evidence_canon_source(
       evidence_reference_id, canonical_text_version_id, canon_commit_id,
       source_object_type, source_object_id, source_story_event_id,
       source_canon_fact_id, source_state_transition_id, source_temporal_relation_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      evidenceId,
      Object.hasOwn(overrides, 'canonicalTextVersionId') ? overrides.canonicalTextVersionId : source.canonicalTextVersionId,
      overrides.commitId ?? source.commitId,
      overrides.sourceObjectType ?? source.type,
      overrides.sourceObjectId ?? source.objectId,
      Object.hasOwn(overrides, 'sourceStoryEventId') ? overrides.sourceStoryEventId : source.sourceStoryEventId,
      Object.hasOwn(overrides, 'sourceCanonFactId') ? overrides.sourceCanonFactId : source.sourceCanonFactId,
      Object.hasOwn(overrides, 'sourceStateTransitionId') ? overrides.sourceStateTransitionId : source.sourceStateTransitionId,
      Object.hasOwn(overrides, 'sourceTemporalRelationId') ? overrides.sourceTemporalRelationId : source.sourceTemporalRelationId,
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
      `SELECT er.*, ecs.canon_commit_id AS support_commit_id,
              ecs.source_object_type AS support_object_type,
              ecs.source_object_id AS support_object_id,
              cc.project_id AS commit_project, cc.status AS commit_status
         FROM evidence_reference er
         LEFT JOIN evidence_canon_source ecs USING (evidence_reference_id)
         LEFT JOIN canon_commit cc ON cc.canon_commit_id = ecs.canon_commit_id
        WHERE er.evidence_reference_id = $1`,
      [evidenceId],
    );
    assert.equal(rows.length, expected);
    if (expected === 1) {
      assert.equal(rows[0].source_object_type, rows[0].support_object_type);
      assert.equal(rows[0].source_object_id, rows[0].support_object_id);
      assert.equal(rows[0].project_id, rows[0].commit_project);
      assert.equal(rows[0].commit_status, 'committed');
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
    if (row?.wait_event_type === 'Lock' && row.blockers.map(Number).includes(Number(blockerPid))) return row;
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
  'canonical_text_version',
  'canon_commit',
  'story_event',
  'canon_fact',
  'state_transition',
  'temporal_relation',
];

scenario('六种 Canon 来源分别提交完整父子关系', async () => {
  const evidenceIds = [];
  for (const type of sourceTypes) {
    const client = await transactionClient();
    try {
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      const source = await createSource(client, type, commit);
      if (type === 'canonical_text_version') {
        assert.notEqual(source.objectId, source.commitId, 'text version ID must not equal Commit ID');
        assert.equal(source.sourceVersionId, source.objectId);
      } else {
        assert.equal(source.sourceVersionId, source.commitId);
      }
      const evidence = await insertEvidencePair(client, source, { locator: `chars:${sequence}-${sequence + 10}` });
      await client.query('COMMIT');
      evidenceIds.push(evidence.evidenceId);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  for (const evidenceId of evidenceIds) await assertEvidenceState(evidenceId);
  return `6 个参数化子场景真实 COMMIT 成功；正文 ID 与 Commit ID 分离；${sourceTypes.join('、')} 均可完整回读`;
});

scenario('同事务 preparing 到 committed 后可整体提交', async () => {
  const client = await transactionClient();
  let evidence;
  try {
    const commit = await seedCommit(client, { initialStatus: 'preparing' });
    const source = await createSource(client, 'story_event', commit);
    evidence = await insertEvidencePair(client, source);
    await client.query('UPDATE canon_commit SET status = $2 WHERE canon_commit_id = $1', [commit.commitId, 'committed']);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidence.evidenceId);
  return 'preparing Commit、来源对象与 Evidence 同事务创建，状态更新为 committed 后真实 COMMIT 成功';
});

scenario('来源 Commit 最终为 preparing 或 failed 时拒绝提交', async () => {
  for (const status of ['preparing', 'failed']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const commit = await seedCommit(client, {
        initialStatus: 'preparing',
        finalStatus: status,
      });
      const source = await createSource(client, 'canon_fact', commit);
      const evidence = await insertEvidencePair(client, source);
      evidenceId = evidence.evidenceId;
      await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_canon_complete', stage: `${status} Commit COMMIT`,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return '2 个状态子场景均在真实 COMMIT 以 23514/evidence_canon_complete 失败，且无 Evidence 半成品';
});

scenario('历史已提交来源可被后续 Evidence 引用', async () => {
  const sourceTx = await transactionClient();
  let source;
  try {
    const commit = await seedCommit(sourceTx, { initialStatus: 'preparing', finalStatus: 'committed' });
    source = await createSource(sourceTx, 'state_transition', commit);
    await sourceTx.query('COMMIT');
  } finally {
    await rollbackQuietly(sourceTx);
    sourceTx.release();
  }
  const evidenceTx = await transactionClient();
  let evidence;
  try {
    evidence = await insertEvidencePair(evidenceTx, source);
    await evidenceTx.query('COMMIT');
  } finally {
    await rollbackQuietly(evidenceTx);
    evidenceTx.release();
  }
  await assertEvidenceState(evidence.evidenceId);
  return '来源 Commit 与对象先独立提交，后续事务创建 Evidence 成功；不要求来自消费方当前 Commit';
});

scenario('只有 Evidence 父行时真实 COMMIT 失败', async () => {
  const client = await transactionClient();
  let evidenceId;
  try {
    const commit = await seedCommit(client, { initialStatus: 'committed' });
    const source = await createSource(client, 'canon_commit', commit);
    const values = parentValues(source);
    evidenceId = values.evidenceId;
    await insertParent(client, values);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_canon_complete', stage: 'parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceId, 0);
  return '父 INSERT 成功；COMMIT 以 23514/evidence_canon_complete 失败；独立连接确认父行未持久化';
});

scenario('重复支撑、悬空 FK 与错误目标组合命中各自即时约束', async () => {
  const results = [];
  {
    const client = await transactionClient();
    let evidenceId;
    try {
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      const source = await createSource(client, 'story_event', commit);
      const evidence = await insertEvidencePair(client, source);
      evidenceId = evidence.evidenceId;
      const error = await expectPgError(() => insertSupport(client, evidenceId, source), {
        code: '23505', constraint: 'evidence_canon_source_pkey', stage: 'duplicate support INSERT',
      });
      results.push(`${error.code}/${error.constraint}`);
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
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      const source = await createSource(client, 'story_event', commit);
      const parent = parentValues(source, { sourceObjectId: 'missing_story_event' });
      evidenceId = parent.evidenceId;
      await insertParent(client, parent);
      const error = await expectPgError(
        () => insertSupport(client, evidenceId, source, {
          sourceObjectId: 'missing_story_event', sourceStoryEventId: 'missing_story_event',
        }),
        { code: '23503', constraint: 'fk_evidence_canon_story_event', stage: 'dangling target INSERT' },
      );
      results.push(`${error.code}/${error.constraint}`);
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
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      const event = await createSource(client, 'story_event', commit);
      const fact = await createSource(client, 'canon_fact', commit);
      const parent = parentValues(event);
      evidenceId = parent.evidenceId;
      await insertParent(client, parent);
      const error = await expectPgError(
        () => insertSupport(client, evidenceId, event, { sourceCanonFactId: fact.objectId }),
        { code: '23514', constraint: 'ck_evidence_canon_source_target_shape', stage: 'wrong target shape INSERT' },
      );
      results.push(`${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `3 个即时子场景分别命中 ${results.join('、')}；未混算为延后约束通过`;
});

scenario('父子类型与对象 ID 不一致分别延后失败', async () => {
  const verified = [];
  for (const mismatch of ['type', 'object']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      let parentSource;
      let supportSource;
      if (mismatch === 'type') {
        const sharedId = id('shared_cross_type_object');
        const event = await createSource(client, 'story_event', commit, { objectId: sharedId });
        const fact = await createSource(client, 'canon_fact', commit, { objectId: sharedId });
        assert.equal(event.objectId, fact.objectId);
        assert.notEqual(event.type, fact.type);
        assert.equal(event.commitId, fact.commitId);
        assert.equal(event.projectId, fact.projectId);
        const { rows } = await client.query(
          `SELECT
             (SELECT count(*)::int FROM story_event WHERE story_event_id = $1) AS event_count,
             (SELECT count(*)::int FROM canon_fact WHERE canon_fact_id = $1) AS fact_count`,
          [sharedId],
        );
        assert.deepEqual(rows[0], { event_count: 1, fact_count: 1 });
        parentSource = event;
        supportSource = fact;
      } else {
        const eventA = await createSource(client, 'story_event', commit);
        const eventB = await createSource(client, 'story_event', commit);
        assert.equal(eventA.type, eventB.type);
        assert.notEqual(eventA.objectId, eventB.objectId);
        assert.equal(eventA.commitId, eventB.commitId);
        assert.equal(eventA.projectId, eventB.projectId);
        parentSource = eventA;
        supportSource = eventB;
      }
      const parent = parentValues(parentSource);
      evidenceId = parent.evidenceId;
      await insertParent(client, parent);
      await insertSupport(client, evidenceId, supportSource);
      const { rows } = await client.query(
        `SELECT er.source_object_type AS parent_type, er.source_object_id AS parent_id,
                ecs.source_object_type AS support_type, ecs.source_object_id AS support_id,
                er.source_version_id, ecs.canon_commit_id
           FROM evidence_reference er
           JOIN evidence_canon_source ecs USING (evidence_reference_id)
          WHERE er.evidence_reference_id = $1`,
        [evidenceId],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source_version_id, rows[0].canon_commit_id);
      if (mismatch === 'type') {
        assert.equal(rows[0].parent_id, rows[0].support_id);
        assert.notEqual(rows[0].parent_type, rows[0].support_type);
      } else {
        assert.equal(rows[0].parent_type, rows[0].support_type);
        assert.notEqual(rows[0].parent_id, rows[0].support_id);
      }
      await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_canon_complete', stage: `${mismatch} mismatch COMMIT`,
      });
      verified.push(mismatch);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  assert.deepEqual(verified, ['type', 'object']);
  return '2 个独立子场景：类型不一致保持同一文本 ID，对象不一致保持同一类型；前置关系均合法，COMMIT 以 23514/evidence_canon_complete 失败且无半成品';
});

scenario('版本、项目与创建 Commit 不一致分别延后失败', async () => {
  const results = [];
  for (const mismatch of ['source_version', 'project', 'creating_commit']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const projectId = id('project');
      await seedProject(client, projectId);
      const commitA = await seedCommit(client, { projectId, createProject: false, initialStatus: 'committed' });
      const commitB = await seedCommit(client, { projectId, createProject: false, initialStatus: 'committed' });
      const event = await createSource(client, 'story_event', commitA);
      let parent;
      if (mismatch === 'source_version') {
        parent = parentValues(event, { sourceVersionId: commitB.commitId });
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, event);
      } else if (mismatch === 'project') {
        const otherProjectId = await seedProject(client);
        parent = parentValues(event, { projectId: otherProjectId });
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, event);
      } else {
        parent = parentValues(event, { sourceVersionId: commitB.commitId });
        await insertParent(client, parent);
        await insertSupport(client, parent.evidenceId, event, { commitId: commitB.commitId });
      }
      evidenceId = parent.evidenceId;
      const error = await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_canon_complete', stage: `${mismatch} COMMIT`,
      });
      results.push(`${mismatch}:${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `3 个单错误子场景：${results.join('；')}；均整体回滚`;
});

scenario('六字段完整身份重复由父表唯一约束拒绝', async () => {
  const setup = await transactionClient();
  let source;
  let first;
  try {
    const commit = await seedCommit(setup, { initialStatus: 'committed' });
    source = await createSource(setup, 'story_event', commit);
    first = await insertEvidencePair(setup, source);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const duplicate = await transactionClient();
  try {
    const values = parentValues(source, {
      evidenceId: id('different_evidence'), locator: first.locator, evidenceKind: first.evidenceKind,
    });
    await expectPgError(() => insertParent(duplicate, values), {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'duplicate identity INSERT',
    });
  } finally {
    await rollbackQuietly(duplicate);
    duplicate.release();
  }
  await assertEvidenceState(first.evidenceId);
  return '不同 Evidence 主键的相同六字段身份在 INSERT 以 23505/uq_evidence_reference_full_identity 失败；原链保留';
});

scenario('旧四字段相同但实际来源对象不同可分别提交', async () => {
  const client = await transactionClient();
  let evidenceA;
  let evidenceB;
  try {
    const commit = await seedCommit(client, { initialStatus: 'committed' });
    const eventA = await createSource(client, 'story_event', commit);
    const eventB = await createSource(client, 'story_event', commit);
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
  return '旧四字段完全相同、Story Event 实际对象不同的两条 Evidence 均提交，证明旧索引非唯一';
});

scenario('同一来源对象可按不同 locator 或 evidence_kind 建立证据', async () => {
  const client = await transactionClient();
  const evidenceIds = [];
  try {
    const commit = await seedCommit(client, { initialStatus: 'committed' });
    const source = await createSource(client, 'temporal_relation', commit);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:1-2', evidenceKind: 'text_span' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:3-4', evidenceKind: 'text_span' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'chars:1-2', evidenceKind: 'structured_claim' })).evidenceId);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  for (const evidenceId of evidenceIds) await assertEvidenceState(evidenceId);
  return '同一实际来源对象的不同 locator 或 evidence_kind 均可分别提交';
});

scenario('Evidence、支撑、来源归属及 Commit 终态不可改写', async () => {
  const setup = await transactionClient();
  let source;
  let evidence;
  let committed;
  let failed;
  let otherCommit;
  try {
    committed = await seedCommit(setup, { initialStatus: 'committed' });
    otherCommit = await seedCommit(setup, {
      projectId: committed.projectId, createProject: false, initialStatus: 'committed',
    });
    failed = await seedCommit(setup, {
      projectId: committed.projectId, createProject: false, initialStatus: 'failed',
    });
    source = await createSource(setup, 'story_event', committed);
    evidence = await insertEvidencePair(setup, source);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const alternateProjectTx = await transactionClient();
  const alternateProjectId = id('alternate_project');
  try {
    await seedProject(alternateProjectTx, alternateProjectId);
    await alternateProjectTx.query('COMMIT');
  } finally {
    await rollbackQuietly(alternateProjectTx);
    alternateProjectTx.release();
  }
  const mutations = [
    ['Evidence identity', `UPDATE evidence_reference SET locator = 'changed' WHERE evidence_reference_id = $1`, [evidence.evidenceId], 'evidence_canon_immutable'],
    ['Canon support', 'UPDATE evidence_canon_source SET source_object_id = source_object_id WHERE evidence_reference_id = $1', [evidence.evidenceId], 'evidence_canon_immutable'],
    ['source project', 'UPDATE story_event SET project_id = $2 WHERE story_event_id = $1', [source.objectId, alternateProjectId], 'evidence_canon_complete'],
    ['source creating Commit', 'UPDATE story_event SET canon_commit_id = $2 WHERE story_event_id = $1', [source.objectId, otherCommit.commitId], 'evidence_canon_complete'],
    ['Commit project', 'UPDATE canon_commit SET project_id = $2 WHERE canon_commit_id = $1', [committed.commitId, alternateProjectId], 'evidence_canon_complete'],
    ['committed terminal', `UPDATE canon_commit SET status = 'failed' WHERE canon_commit_id = $1`, [committed.commitId], 'evidence_canon_commit_terminal'],
    ['failed terminal', `UPDATE canon_commit SET status = 'preparing' WHERE canon_commit_id = $1`, [failed.commitId], 'evidence_canon_commit_terminal'],
  ];
  for (const [name, sql, params, constraint] of mutations) {
    const client = await transactionClient();
    try {
      await expectPgError(() => client.query(sql, params), { code: '23514', constraint, stage: `${name} UPDATE` });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const rows = await assertEvidenceState(evidence.evidenceId);
  assert.equal(rows[0].locator, evidence.locator);
  const check = await observerClient();
  try {
    const { rows: stateRows } = await check.query(
      `SELECT se.project_id AS source_project, se.canon_commit_id AS source_commit,
              committed.project_id AS commit_project, committed.status AS committed_status,
              failed.status AS failed_status
         FROM story_event se
         JOIN canon_commit committed ON committed.canon_commit_id = se.canon_commit_id
         CROSS JOIN canon_commit failed
        WHERE se.story_event_id = $1 AND failed.canon_commit_id = $2`,
      [source.objectId, failed.commitId],
    );
    assert.equal(stateRows[0].source_project, committed.projectId);
    assert.equal(stateRows[0].source_commit, committed.commitId);
    assert.equal(stateRows[0].commit_project, committed.projectId);
    assert.equal(stateRows[0].committed_status, 'committed');
    assert.equal(stateRows[0].failed_status, 'failed');
  } finally {
    check.release();
  }
  return '7 个修改子场景分别命中 evidence_canon_immutable、evidence_canon_complete 或 evidence_canon_commit_terminal；独立连接确认原合法链和两种终态保留';
});

async function insertFullyQualifiedEvidence(client, { withSupport = true } = {}) {
  const projectId = id('qualified_project');
  const commitId = id('qualified_commit');
  const eventId = id('qualified_event');
  const evidenceId = id('qualified_evidence');
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query('SET LOCAL search_path TO public');
  await client.query(`INSERT INTO ${SCHEMA}.project(project_id) VALUES ($1)`, [projectId]);
  await client.query(
    `INSERT INTO ${SCHEMA}.canon_commit(canon_commit_id, project_id, status) VALUES ($1, $2, 'committed')`,
    [commitId, projectId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.story_event(story_event_id, project_id, canon_commit_id) VALUES ($1, $2, $3)`,
    [eventId, projectId, commitId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.evidence_reference(
       evidence_reference_id, project_id, source_domain, source_version_id,
       source_object_type, source_object_id, locator, evidence_kind
     ) VALUES ($1, $2, 'canon', $3, 'story_event', $4, 'chars:qualified', 'text_span')`,
    [evidenceId, projectId, commitId, eventId],
  );
  if (withSupport) {
    await client.query(
      `INSERT INTO ${SCHEMA}.evidence_canon_source(
         evidence_reference_id, canon_commit_id, source_object_type,
         source_object_id, source_story_event_id
       ) VALUES ($1, $2, 'story_event', $3, $3)`,
      [evidenceId, commitId, eventId],
    );
  }
  return { projectId, commitId, eventId, evidenceId };
}

scenario('public search_path 下全限定合法来源可提交', async () => {
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
        'protect_canon_source_ownership',
        'raise_evidence_canon_complete',
        'reject_evidence_canon_mutation',
        'validate_evidence_canon',
        'validate_evidence_canon_trigger',
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
      `SELECT er.source_version_id, er.source_object_id, ecs.canon_commit_id,
              ecs.source_story_event_id, cc.status
         FROM ${SCHEMA}.evidence_reference er
         JOIN ${SCHEMA}.evidence_canon_source ecs USING (evidence_reference_id)
         JOIN ${SCHEMA}.canon_commit cc ON cc.canon_commit_id = ecs.canon_commit_id
        WHERE er.evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_version_id, ids.commitId);
    assert.equal(rows[0].source_object_id, ids.eventId);
    assert.equal(rows[0].source_story_event_id, ids.eventId);
    assert.equal(rows[0].status, 'committed');
  } finally {
    await check.end();
  }
  return '新建直连连接 search_path=public，全部业务对象全限定；5 个函数路径已核对，合法父子真实 COMMIT 并由另一连接回读';
});

scenario('public search_path 下缺失支撑仍命中目标约束', async () => {
  const client = await standalonePublicClient();
  let ids;
  try {
    ids = await insertFullyQualifiedEvidence(client, { withSupport: false });
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_canon_complete', stage: 'fully-qualified parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    await client.end();
  }
  const check = await standalonePublicClient();
  try {
    const { rows } = await check.query(
      `SELECT count(*)::int AS count FROM ${SCHEMA}.evidence_reference WHERE evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows[0].count, 0);
  } finally {
    await check.end();
  }
  return '前置 INSERT 成功；COMMIT 以 23514/evidence_canon_complete 失败而非名称解析错误；新连接确认无半成品';
});

scenario('未支持来源域和来源类型由父表即时拒绝', async () => {
  for (const variant of ['domain', 'type']) {
    const client = await transactionClient();
    try {
      const commit = await seedCommit(client, { initialStatus: 'committed' });
      const source = await createSource(client, 'canon_commit', commit);
      const values = parentValues(source, variant === 'domain'
        ? { sourceDomain: 'candidate' }
        : { sourceObjectType: 'candidate_version' });
      await expectPgError(() => insertParent(client, values), {
        code: '23514',
        constraint: variant === 'domain' ? 'ck_evidence_reference_canon_domain' : 'ck_evidence_reference_canon_type',
        stage: `unsupported ${variant} INSERT`,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  return '2 个子场景分别由 ck_evidence_reference_canon_domain 和 ck_evidence_reference_canon_type 即时拒绝';
});

async function seedCommittedConcurrencySource() {
  const client = await transactionClient();
  try {
    const commit = await seedCommit(client, { initialStatus: 'committed' });
    const source = await createSource(client, 'story_event', commit);
    await client.query('COMMIT');
    return { commit, source };
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
      evidenceId: id('concurrent_b'), locator: first.locator, evidenceKind: first.evidenceKind,
    });
    const bInsert = insertParent(b, duplicate);
    await waitForBlocked(observer, bPid, aPid);
    await a.query('COMMIT');
    await expectPgError(() => bInsert, {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'B duplicate INSERT',
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
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A COMMIT；B 以 23505/uq_evidence_reference_full_identity 失败；仅 A 完整链持久化`;
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
      evidenceId: id('concurrent_b'), locator: first.locator, evidenceKind: first.evidenceKind,
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
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A ROLLBACK；B 写入支撑并 COMMIT；仅 B 完整链持久化`;
}, 30_000);

scenario('共享已提交 Commit 的不同对象可合法并发创建', async () => {
  const setup = await transactionClient();
  let commit;
  let sourceA;
  let sourceB;
  try {
    commit = await seedCommit(setup, { initialStatus: 'committed' });
    sourceA = await createSource(setup, 'story_event', commit);
    sourceB = await createSource(setup, 'canon_fact', commit);
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
  assert.equal(rowsA[0].support_commit_id, commit.commitId);
  assert.equal(rowsB[0].support_commit_id, commit.commitId);
  assert.notEqual(rowsA[0].source_object_id, rowsB[0].source_object_id);
  return '同一已提交 Commit 下 Story Event 与 Canon Fact 的 Evidence 首次并发 COMMIT 均成功，无重试；完整父子关系与共同归属已回读';
}, 30_000);
