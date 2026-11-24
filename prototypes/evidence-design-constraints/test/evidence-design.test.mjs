import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Client, Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PROTOTYPE_SCHEMA ?? 'evidence_design_constraint_fixture';
const RESULTS_PATH = process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json';
assert.ok(DATABASE_URL, 'DATABASE_URL is required');

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
const outcomes = [];
let sequence = 0;

const sourceDefinitions = {
  author_design_revision: {
    table: 'author_design_revision', idColumn: 'revision_id', supportColumn: 'source_author_design_revision_id',
  },
  design_object_version: {
    table: 'design_object_version', idColumn: 'design_object_version_id', supportColumn: 'source_design_object_version_id',
  },
  design_constraint: {
    table: 'design_constraint', idColumn: 'design_constraint_id', supportColumn: 'source_design_constraint_id',
  },
  outline_node: {
    table: 'outline_node', idColumn: 'outline_node_id', supportColumn: 'source_outline_node_id',
  },
  world_rule: {
    table: 'world_rule', idColumn: 'world_rule_id', supportColumn: 'source_world_rule_id',
  },
  temporal_constraint: {
    table: 'temporal_constraint', idColumn: 'temporal_constraint_id', supportColumn: 'source_temporal_constraint_id',
  },
  foreshadowing_plan: {
    table: 'foreshadowing_plan', idColumn: 'foreshadowing_plan_id', supportColumn: 'source_foreshadowing_plan_id',
  },
  ending_constraint: {
    table: 'ending_constraint', idColumn: 'ending_constraint_id', supportColumn: 'source_ending_constraint_id',
  },
};
const sourceTypes = Object.keys(sourceDefinitions);
const supportColumns = Object.values(sourceDefinitions).map(({ supportColumn }) => supportColumn);

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

async function seedRevision(client, {
  projectId = id('project'),
  revisionProjectId = projectId,
  revisionId = id('revision'),
  createProjects = true,
} = {}) {
  if (createProjects) {
    for (const value of new Set([projectId, revisionProjectId])) {
      await seedProject(client, value);
    }
  }
  await client.query(
    'INSERT INTO author_design_revision(revision_id, project_id) VALUES ($1, $2)',
    [revisionId, revisionProjectId],
  );
  return { projectId, revisionProjectId, revisionId };
}

async function createSource(client, type, graph, overrides = {}) {
  const definition = sourceDefinitions[type];
  if (!definition) throw new Error(`unsupported test source type ${type}`);
  const projectId = overrides.projectId ?? graph.revisionProjectId;
  const revisionId = overrides.revisionId ?? graph.revisionId;
  const objectId = type === 'author_design_revision'
    ? revisionId
    : (overrides.objectId ?? id(type));
  const targets = Object.fromEntries(supportColumns.map((column) => [column, null]));
  targets[definition.supportColumn] = objectId;
  if (type !== 'author_design_revision') {
    await client.query(
      `INSERT INTO ${definition.table}(${definition.idColumn}, project_id, revision_id) VALUES ($1, $2, $3)`,
      [objectId, projectId, revisionId],
    );
  }
  return { type, objectId, projectId, revisionId, ...targets };
}

function parentValues(source, overrides = {}) {
  return {
    evidenceId: overrides.evidenceId ?? id('evidence'),
    projectId: overrides.projectId ?? source.projectId,
    sourceDomain: overrides.sourceDomain ?? 'author_design',
    sourceVersionId: overrides.sourceVersionId ?? source.revisionId,
    sourceObjectType: overrides.sourceObjectType ?? source.type,
    sourceObjectId: overrides.sourceObjectId ?? source.objectId,
    locator: overrides.locator ?? 'design:path/1',
    evidenceKind: overrides.evidenceKind ?? 'author_decision',
  };
}

async function insertParent(client, values, { qualified = false } = {}) {
  const table = qualified ? `${SCHEMA}.evidence_reference` : 'evidence_reference';
  await client.query(
    `INSERT INTO ${table}(
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

async function insertSupport(client, evidenceId, source, overrides = {}, { qualified = false } = {}) {
  const table = qualified ? `${SCHEMA}.evidence_design_source` : 'evidence_design_source';
  const targetValues = supportColumns.map((column) => (
    Object.hasOwn(overrides, column) ? overrides[column] : source[column]
  ));
  await client.query(
    `INSERT INTO ${table}(
       evidence_reference_id, author_design_revision_id, source_object_type, source_object_id,
       ${supportColumns.join(', ')}
     ) VALUES (${Array.from({ length: 12 }, (_, index) => `$${index + 1}`).join(', ')})`,
    [
      evidenceId,
      overrides.authorDesignRevisionId ?? source.revisionId,
      overrides.sourceObjectType ?? source.type,
      overrides.sourceObjectId ?? source.objectId,
      ...targetValues,
    ],
  );
}

async function insertEvidencePair(client, source, overrides = {}) {
  const values = parentValues(source, overrides);
  await insertParent(client, values, { qualified: overrides.qualified ?? false });
  await insertSupport(
    client,
    values.evidenceId,
    source,
    overrides.support ?? {},
    { qualified: overrides.qualified ?? false },
  );
  return values;
}

async function assertEvidenceState(evidenceId, expected = 1) {
  const check = await observerClient();
  try {
    const { rows } = await check.query(
      `SELECT er.*, eds.author_design_revision_id AS support_revision_id,
              eds.source_object_type AS support_object_type,
              eds.source_object_id AS support_object_id
         FROM evidence_reference er
         LEFT JOIN evidence_design_source eds USING (evidence_reference_id)
        WHERE er.evidence_reference_id = $1`,
      [evidenceId],
    );
    assert.equal(rows.length, expected);
    if (expected === 1) {
      assert.equal(rows[0].source_version_id, rows[0].support_revision_id);
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

async function insertFullyQualifiedEvidence(client, { withSupport = true } = {}) {
  const projectId = id('qualified_project');
  const revisionId = id('qualified_revision');
  const worldRuleId = id('qualified_world_rule');
  const evidenceId = id('qualified_evidence');
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query('SET LOCAL search_path TO public');
  await client.query(`INSERT INTO ${SCHEMA}.project(project_id) VALUES ($1)`, [projectId]);
  await client.query(
    `INSERT INTO ${SCHEMA}.author_design_revision(revision_id, project_id) VALUES ($1, $2)`,
    [revisionId, projectId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.world_rule(world_rule_id, project_id, revision_id) VALUES ($1, $2, $3)`,
    [worldRuleId, projectId, revisionId],
  );
  const source = {
    type: 'world_rule', objectId: worldRuleId, projectId, revisionId,
    ...Object.fromEntries(supportColumns.map((column) => [column, null])),
    source_world_rule_id: worldRuleId,
  };
  const values = parentValues(source, { evidenceId, locator: 'design:qualified' });
  await insertParent(client, values, { qualified: true });
  if (withSupport) await insertSupport(client, evidenceId, source, {}, { qualified: true });
  return { projectId, revisionId, worldRuleId, evidenceId };
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

scenario('八种 Author Design 来源分别提交完整父子关系', async () => {
  const committed = [];
  for (const type of sourceTypes) {
    const client = await transactionClient();
    try {
      const graph = await seedRevision(client);
      const source = await createSource(client, type, graph);
      if (type === 'author_design_revision') {
        assert.equal(source.objectId, graph.revisionId);
      } else {
        assert.notEqual(source.objectId, graph.revisionId);
      }
      const evidence = await insertEvidencePair(client, source, { locator: `design:${type}` });
      await client.query('COMMIT');
      committed.push({ type, evidenceId: evidence.evidenceId });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  for (const { evidenceId } of committed) await assertEvidenceState(evidenceId);
  return `8 个参数化子场景真实 COMMIT 成功；Revision 直接目标等于容器，七类对象 ID 均不同于 Revision：${sourceTypes.join('、')}`;
});

scenario('八种来源的实际目标列全空均由 CHECK 即时拒绝', async () => {
  const rejected = [];
  for (const type of sourceTypes) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedRevision(client);
      const source = await createSource(client, type, graph);
      const values = parentValues(source, { locator: `design:empty-target/${type}` });
      evidenceId = values.evidenceId;
      await insertParent(client, values);

      const emptyTargets = Object.fromEntries(supportColumns.map((column) => [column, null]));
      assert.equal(source[sourceDefinitions[type].supportColumn], source.objectId);
      assert.ok(supportColumns.every((column) => emptyTargets[column] === null));
      await expectPgError(() => insertSupport(client, evidenceId, source, emptyTargets), {
        code: '23514',
        constraint: 'ck_evidence_design_source_target_shape',
        stage: `${type} all-empty targets support INSERT`,
      });
      rejected.push(type);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `8 个参数化子场景均在支撑 INSERT 即时命中 23514/ck_evidence_design_source_target_shape，独立连接确认无父行或支撑半成品：${rejected.join('、')}`;
});

scenario('只有 Evidence 父行时真实 COMMIT 失败', async () => {
  const client = await transactionClient();
  let evidenceId;
  try {
    const graph = await seedRevision(client);
    const source = await createSource(client, 'author_design_revision', graph);
    const values = parentValues(source);
    evidenceId = values.evidenceId;
    await insertParent(client, values);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_design_complete', stage: 'parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceId, 0);
  return '父 INSERT 成功；真实 COMMIT 以 23514/evidence_design_complete 失败；独立连接确认无半成品';
});

scenario('重复支撑、悬空目标 FK 与错误目标组合命中即时约束', async () => {
  const results = [];
  {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedRevision(client);
      const source = await createSource(client, 'world_rule', graph);
      const evidence = await insertEvidencePair(client, source);
      evidenceId = evidence.evidenceId;
      const error = await expectPgError(() => insertSupport(client, evidenceId, source), {
        code: '23505', constraint: 'evidence_design_source_pkey', stage: 'duplicate support INSERT',
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
      const graph = await seedRevision(client);
      const source = await createSource(client, 'world_rule', graph);
      const values = parentValues(source);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      const missing = 'missing_world_rule';
      const error = await expectPgError(() => insertSupport(client, evidenceId, source, {
        sourceObjectId: missing,
        source_world_rule_id: missing,
      }), {
        code: '23503', constraint: 'fk_evidence_design_world_rule', stage: 'dangling target INSERT',
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
      const graph = await seedRevision(client);
      const worldRule = await createSource(client, 'world_rule', graph);
      const temporal = await createSource(client, 'temporal_constraint', graph);
      const values = parentValues(worldRule);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      const error = await expectPgError(() => insertSupport(client, evidenceId, worldRule, {
        source_temporal_constraint_id: temporal.objectId,
      }), {
        code: '23514', constraint: 'ck_evidence_design_source_target_shape', stage: 'wrong target shape INSERT',
      });
      results.push(`${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `3 个即时负例分别命中 ${results.join('、')}，未混算为延后失败`;
});

scenario('父子类型与对象 ID 不一致分开在真实 COMMIT 失败', async () => {
  const verified = [];
  for (const mismatch of ['type', 'object']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      const graph = await seedRevision(client);
      let parentSource;
      let supportSource;
      if (mismatch === 'type') {
        const sharedId = id('shared_design_object');
        parentSource = await createSource(client, 'design_constraint', graph, { objectId: sharedId });
        supportSource = await createSource(client, 'world_rule', graph, { objectId: sharedId });
        assert.equal(parentSource.objectId, supportSource.objectId);
        assert.notEqual(parentSource.type, supportSource.type);
        assert.equal(parentSource.revisionId, supportSource.revisionId);
        assert.equal(parentSource.projectId, supportSource.projectId);
        const { rows } = await client.query(
          `SELECT
             (SELECT count(*)::int FROM design_constraint WHERE design_constraint_id = $1) AS constraint_count,
             (SELECT count(*)::int FROM world_rule WHERE world_rule_id = $1) AS rule_count`,
          [sharedId],
        );
        assert.deepEqual(rows[0], { constraint_count: 1, rule_count: 1 });
      } else {
        parentSource = await createSource(client, 'world_rule', graph);
        supportSource = await createSource(client, 'world_rule', graph);
        assert.equal(parentSource.type, supportSource.type);
        assert.notEqual(parentSource.objectId, supportSource.objectId);
        assert.equal(parentSource.revisionId, supportSource.revisionId);
        assert.equal(parentSource.projectId, supportSource.projectId);
      }
      const values = parentValues(parentSource);
      evidenceId = values.evidenceId;
      await insertParent(client, values);
      await insertSupport(client, evidenceId, supportSource);
      const { rows } = await client.query(
        `SELECT er.source_object_type AS parent_type, er.source_object_id AS parent_id,
                eds.source_object_type AS support_type, eds.source_object_id AS support_id,
                er.source_version_id, eds.author_design_revision_id
           FROM evidence_reference er
           JOIN evidence_design_source eds USING (evidence_reference_id)
          WHERE er.evidence_reference_id = $1`,
        [evidenceId],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source_version_id, rows[0].author_design_revision_id);
      if (mismatch === 'type') {
        assert.equal(rows[0].parent_id, rows[0].support_id);
        assert.notEqual(rows[0].parent_type, rows[0].support_type);
      } else {
        assert.equal(rows[0].parent_type, rows[0].support_type);
        assert.notEqual(rows[0].parent_id, rows[0].support_id);
      }
      await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_design_complete', stage: `${mismatch} mismatch COMMIT`,
      });
      verified.push(mismatch);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  assert.deepEqual(verified, ['type', 'object']);
  return '2 个独立子场景：类型负例保持相同文本 ID，对象负例保持同一类型；目标/FK/Revision/项目及父子 INSERT 均先断言合法，COMMIT 均命中 23514/evidence_design_complete';
});

scenario('错误 source_version、目标 Revision 或项目分别延后失败', async () => {
  const results = [];
  for (const kind of ['source_version', 'target_revision', 'project']) {
    const client = await transactionClient();
    let evidenceId;
    try {
      let source;
      let values;
      if (kind === 'source_version') {
        const projectId = id('project');
        await seedProject(client, projectId);
        const graphA = await seedRevision(client, { projectId, createProjects: false });
        const graphB = await seedRevision(client, { projectId, createProjects: false });
        source = await createSource(client, 'world_rule', graphA);
        values = parentValues(source, { sourceVersionId: graphB.revisionId });
        await insertParent(client, values);
        await insertSupport(client, values.evidenceId, source);
      } else if (kind === 'target_revision') {
        const projectId = id('project');
        await seedProject(client, projectId);
        const graphA = await seedRevision(client, { projectId, createProjects: false });
        const graphB = await seedRevision(client, { projectId, createProjects: false });
        source = await createSource(client, 'world_rule', graphB);
        values = parentValues(source, { sourceVersionId: graphA.revisionId });
        await insertParent(client, values);
        await insertSupport(client, values.evidenceId, source, { authorDesignRevisionId: graphA.revisionId });
      } else {
        const projectA = id('project_a');
        const projectB = id('project_b');
        await seedProject(client, projectA);
        await seedProject(client, projectB);
        const graph = await seedRevision(client, { projectId: projectB, createProjects: false });
        source = await createSource(client, 'world_rule', graph);
        values = parentValues(source, { projectId: projectA });
        await insertParent(client, values);
        await insertSupport(client, values.evidenceId, source);
      }
      evidenceId = values.evidenceId;
      const error = await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_design_complete', stage: `${kind} COMMIT`,
      });
      results.push(`${kind}:${error.code}/${error.constraint}`);
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceState(evidenceId, 0);
  }
  return `3 个独立延后负例：${results.join('；')}；独立连接确认均整体回滚`;
});

scenario('历史合法 Revision 来源可在后续事务创建 Evidence', async () => {
  const seed = await transactionClient();
  let source;
  try {
    const graph = await seedRevision(seed);
    source = await createSource(seed, 'outline_node', graph);
    await seed.query('COMMIT');
  } finally {
    await rollbackQuietly(seed);
    seed.release();
  }
  const later = await transactionClient();
  let evidence;
  try {
    evidence = await insertEvidencePair(later, source, { locator: 'design:historical' });
    await later.query('COMMIT');
  } finally {
    await rollbackQuietly(later);
    later.release();
  }
  await assertEvidenceState(evidence.evidenceId);
  return 'Revision 与来源对象先独立提交，后续事务创建 Evidence 成功；没有 current/effective 状态门槛';
});

scenario('六字段完整身份重复由父表唯一约束拒绝', async () => {
  const setup = await transactionClient();
  let source;
  let first;
  try {
    const graph = await seedRevision(setup);
    source = await createSource(setup, 'world_rule', graph);
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
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'duplicate identity INSERT',
    });
  } finally {
    await rollbackQuietly(duplicate);
    duplicate.release();
  }
  await assertEvidenceState(first.evidenceId);
  return '不同 Evidence 主键的相同六字段身份以 23505/uq_evidence_reference_full_identity 拒绝；原父子链保留';
});

scenario('旧四字段相同但实际对象不同可分别提交', async () => {
  const client = await transactionClient();
  let evidenceA;
  let evidenceB;
  try {
    const graph = await seedRevision(client);
    const sourceA = await createSource(client, 'world_rule', graph);
    const sourceB = await createSource(client, 'world_rule', graph);
    const common = { locator: 'design:shared', evidenceKind: 'author_decision' };
    evidenceA = await insertEvidencePair(client, sourceA, common);
    evidenceB = await insertEvidencePair(client, sourceB, common);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceState(evidenceA.evidenceId);
  await assertEvidenceState(evidenceB.evidenceId);
  return 'source_domain/source_version_id/locator/evidence_kind 相同而实际对象不同的两条记录均提交；旧四字段索引非唯一';
});

scenario('同一实际对象可使用不同 locator 或 evidence_kind', async () => {
  const client = await transactionClient();
  const evidenceIds = [];
  try {
    const graph = await seedRevision(client);
    const source = await createSource(client, 'foreshadowing_plan', graph);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'design:1', evidenceKind: 'author_decision' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'design:2', evidenceKind: 'author_decision' })).evidenceId);
    evidenceIds.push((await insertEvidencePair(client, source, { locator: 'design:1', evidenceKind: 'structured_rule' })).evidenceId);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  for (const evidenceId of evidenceIds) await assertEvidenceState(evidenceId);
  return '同一来源对象的不同 locator 或 evidence_kind 形成 3 个合法完整身份';
});

scenario('Evidence、支撑和来源归属修改被拒绝并保留原链', async () => {
  const setup = await transactionClient();
  let graph;
  let source;
  let evidence;
  try {
    graph = await seedRevision(setup);
    source = await createSource(setup, 'world_rule', graph);
    evidence = await insertEvidencePair(setup, source);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }

  const seed = await transactionClient();
  let otherProjectId;
  let otherRevisionId;
  try {
    otherProjectId = await seedProject(seed);
    const otherRevision = await seedRevision(seed, { projectId: graph.projectId, createProjects: false });
    otherRevisionId = otherRevision.revisionId;
    await seed.query('COMMIT');
  } finally {
    await rollbackQuietly(seed);
    seed.release();
  }

  const mutations = [
    ['Evidence UPDATE', `UPDATE evidence_reference SET locator = 'changed' WHERE evidence_reference_id = $1`, [evidence.evidenceId], 'evidence_design_immutable'],
    ['support UPDATE', 'UPDATE evidence_design_source SET source_object_id = source_object_id WHERE evidence_reference_id = $1', [evidence.evidenceId], 'evidence_design_immutable'],
    ['source project UPDATE', 'UPDATE world_rule SET project_id = $2 WHERE world_rule_id = $1', [source.objectId, otherProjectId], 'evidence_design_complete'],
    ['source revision UPDATE', 'UPDATE world_rule SET revision_id = $2 WHERE world_rule_id = $1', [source.objectId, otherRevisionId], 'evidence_design_complete'],
    ['Revision project UPDATE', 'UPDATE author_design_revision SET project_id = $2 WHERE revision_id = $1', [graph.revisionId, otherProjectId], 'evidence_design_complete'],
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
    const { rows: chain } = await check.query(
      `SELECT wr.project_id AS target_project, wr.revision_id AS target_revision,
              adr.project_id AS revision_project
         FROM world_rule wr
         JOIN author_design_revision adr ON adr.revision_id = wr.revision_id
        WHERE wr.world_rule_id = $1`,
      [source.objectId],
    );
    assert.deepEqual(chain[0], {
      target_project: graph.projectId,
      target_revision: graph.revisionId,
      revision_project: graph.projectId,
    });
  } finally {
    check.release();
  }
  return 'Evidence/支撑 UPDATE 命中 23514/evidence_design_immutable；来源项目/Revision 归属修改命中 23514/evidence_design_complete；独立连接确认原链保留';
});

scenario('public search_path 下全限定合法父子关系可提交', async () => {
  const client = await standalonePublicClient();
  let ids;
  try {
    const { rows: functions } = await client.query(
      `SELECT p.proname, p.proconfig
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1
          AND p.proname = ANY($2::text[])
        ORDER BY p.proname`,
      [SCHEMA, [
        'protect_design_source_ownership',
        'raise_evidence_design_complete',
        'reject_evidence_design_mutation',
        'validate_evidence_design',
        'validate_evidence_design_trigger',
      ]],
    );
    assert.equal(functions.length, 5);
    for (const row of functions) {
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
      `SELECT er.source_version_id, er.source_object_id,
              eds.author_design_revision_id, eds.source_world_rule_id
         FROM ${SCHEMA}.evidence_reference er
         JOIN ${SCHEMA}.evidence_design_source eds USING (evidence_reference_id)
        WHERE er.evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_version_id, ids.revisionId);
    assert.equal(rows[0].author_design_revision_id, ids.revisionId);
    assert.equal(rows[0].source_object_id, ids.worldRuleId);
    assert.equal(rows[0].source_world_rule_id, ids.worldRuleId);
  } finally {
    await check.end();
  }
  return '新建直连连接 search_path=public；5 个函数路径固定；全限定业务 SQL 合法 COMMIT 并由另一新连接回读';
});

scenario('public search_path 下缺失支撑命中目标延后约束', async () => {
  const client = await standalonePublicClient();
  let ids;
  try {
    ids = await insertFullyQualifiedEvidence(client, { withSupport: false });
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_design_complete', stage: 'public parent-only COMMIT',
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
  return '全限定父 INSERT 成功；COMMIT 命中 23514/evidence_design_complete 而非名称解析错误；新连接确认无半成品';
});

scenario('未支持来源域和来源类型由父表 CHECK 即时拒绝', async () => {
  for (const variant of ['domain', 'type']) {
    const client = await transactionClient();
    try {
      const graph = await seedRevision(client);
      const source = await createSource(client, 'author_design_revision', graph);
      const values = parentValues(source, variant === 'domain'
        ? { sourceDomain: 'canon' }
        : { sourceObjectType: 'secret_definition' });
      await expectPgError(() => insertParent(client, values), {
        code: '23514',
        constraint: variant === 'domain'
          ? 'ck_evidence_reference_design_domain'
          : 'ck_evidence_reference_design_type',
        stage: `unsupported ${variant} INSERT`,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  return '非 author_design 域和八类集合外类型分别被父表 CHECK 即时拒绝';
});

async function seedCommittedConcurrencySource(type = 'world_rule') {
  const client = await transactionClient();
  try {
    const graph = await seedRevision(client);
    const source = await createSource(client, type, graph);
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
    first = await insertEvidencePair(a, source, { locator: 'design:concurrent-commit' });
    duplicate = parentValues(source, {
      evidenceId: id('concurrent_b'),
      locator: first.locator,
      evidenceKind: first.evidenceKind,
    });
    const bInsert = insertParent(b, duplicate);
    const blocked = await waitForBlocked(observer, bPid, aPid);
    assert.ok(blocked.blockers.map(Number).includes(Number(aPid)));
    await a.query('COMMIT');
    await expectPgError(() => bInsert, {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'B duplicate INSERT after wait',
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
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A COMMIT 后 B 命中 23505/uq_evidence_reference_full_identity；仅 A 完整父子链持久化`;
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
    first = await insertEvidencePair(a, source, { locator: 'design:concurrent-rollback' });
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
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A ROLLBACK 后 B 完成支撑并 COMMIT；仅 B 完整父子链持久化`;
}, 30_000);

scenario('共享 Revision 的不同设计对象可合法并发创建', async () => {
  const setup = await transactionClient();
  let graph;
  let sourceA;
  let sourceB;
  try {
    graph = await seedRevision(setup);
    sourceA = await createSource(setup, 'world_rule', graph);
    sourceB = await createSource(setup, 'design_constraint', graph);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }

  const a = await transactionClient();
  const b = await transactionClient();
  const observer = await observerClient();
  let evidenceA;
  let evidenceB;
  try {
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    evidenceA = await insertEvidencePair(a, sourceA, { locator: 'design:legal-a' });
    evidenceB = await insertEvidencePair(b, sourceB, { locator: 'design:legal-b' });
    const { rows: lockRows } = await observer.query(
      `SELECT pid, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE pid = ANY($1::int[])
        ORDER BY pid`,
      [[aPid, bPid]],
    );
    assert.equal(lockRows.length, 2);
    assert.deepEqual(lockRows.flatMap((row) => row.blockers), []);
    const [commitA, commitB] = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
    assert.equal(commitA.status, 'fulfilled', commitA.reason?.message);
    assert.equal(commitB.status, 'fulfilled', commitB.reason?.message);
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    a.release();
    b.release();
    observer.release();
  }
  const [rowsA, rowsB] = await Promise.all([
    assertEvidenceState(evidenceA.evidenceId),
    assertEvidenceState(evidenceB.evidenceId),
  ]);
  assert.equal(rowsA[0].source_version_id, graph.revisionId);
  assert.equal(rowsB[0].source_version_id, graph.revisionId);
  assert.notEqual(rowsA[0].source_object_id, rowsB[0].source_object_id);
  return '共享同一 Revision 的 World Rule 与 Design Constraint 首次并发 COMMIT 均成功，无重试；独立连接确认两套父子关系及共同 Revision/项目';
}, 30_000);
