import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Client, Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PROTOTYPE_SCHEMA ?? 'evidence_tool_constraint_fixture';
const RESULTS_PATH = process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json';
assert.ok(DATABASE_URL, 'DATABASE_URL is required');

const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
const outcomes = [];
const parameterizedSubscenarios = {
  immediate_constraint_variants: 8,
  ownership_mismatch_variants: 4,
  locator_and_kind_variants: 3,
  evidence_immutability_variants: 4,
  source_protection_variants: 14,
  public_search_path_variants: 3,
};
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

async function expectPgError(action, { code, constraint, column, stage }) {
  let caught;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${stage} should fail`);
  assert.equal(caught.code, code, `${stage} SQLSTATE`);
  if (constraint !== undefined) assert.equal(caught.constraint, constraint, `${stage} constraint`);
  if (column !== undefined) assert.equal(caught.column, column, `${stage} column`);
  return caught;
}

async function seedProjects(client, projectIds) {
  for (const projectId of new Set(projectIds)) {
    await client.query('INSERT INTO project(project_id) VALUES ($1)', [projectId]);
  }
}

async function seedExecutionChain(client, options = {}) {
  const projectId = options.projectId ?? id('project');
  const workflowProjectId = options.workflowProjectId ?? projectId;
  const bundleProjectId = options.bundleProjectId ?? projectId;
  const generationProjectId = options.generationProjectId ?? projectId;
  const toolProjectId = options.toolProjectId ?? projectId;
  const workflowTaskProjectId = options.workflowTaskProjectId ?? projectId;
  const bundleTaskProjectId = options.bundleTaskProjectId ?? workflowTaskProjectId;
  const workflowTaskVersionId = options.workflowTaskVersionId ?? id('task_version');
  const bundleTaskVersionId = options.bundleTaskVersionId ?? workflowTaskVersionId;
  const workflowRunId = options.workflowRunId ?? id('workflow');
  const bundleWorkflowRunId = options.bundleWorkflowRunId ?? workflowRunId;
  const bundleWorkflowProjectId = options.bundleWorkflowProjectId ?? workflowProjectId;
  const bundleWorkflowTaskVersionId = options.bundleWorkflowTaskVersionId ?? workflowTaskVersionId;
  const contextBundleId = options.contextBundleId ?? id('bundle');
  const generationRunId = options.generationRunId ?? id('generation');
  const toolCallId = options.toolCallId ?? id('tool_call');

  await seedProjects(client, [
    projectId,
    workflowProjectId,
    bundleProjectId,
    generationProjectId,
    toolProjectId,
    workflowTaskProjectId,
    bundleTaskProjectId,
    bundleWorkflowProjectId,
  ]);

  const taskVersions = new Map();
  taskVersions.set(workflowTaskVersionId, workflowTaskProjectId);
  if (taskVersions.has(bundleTaskVersionId)) {
    assert.equal(taskVersions.get(bundleTaskVersionId), bundleTaskProjectId);
  } else {
    taskVersions.set(bundleTaskVersionId, bundleTaskProjectId);
  }
  if (taskVersions.has(bundleWorkflowTaskVersionId)) {
    assert.equal(taskVersions.get(bundleWorkflowTaskVersionId), bundleWorkflowProjectId);
  } else {
    taskVersions.set(bundleWorkflowTaskVersionId, bundleWorkflowProjectId);
  }
  for (const [taskVersionId, taskProjectId] of taskVersions) {
    await client.query(
      'INSERT INTO scene_task_version(scene_task_version_id, project_id) VALUES ($1, $2)',
      [taskVersionId, taskProjectId],
    );
  }

  await client.query(
    'INSERT INTO workflow_run(workflow_run_id, project_id, scene_task_version_id) VALUES ($1, $2, $3)',
    [workflowRunId, workflowProjectId, workflowTaskVersionId],
  );
  if (bundleWorkflowRunId !== workflowRunId) {
    await client.query(
      'INSERT INTO workflow_run(workflow_run_id, project_id, scene_task_version_id) VALUES ($1, $2, $3)',
      [bundleWorkflowRunId, bundleWorkflowProjectId, bundleWorkflowTaskVersionId],
    );
  }
  await client.query(
    `INSERT INTO context_bundle(
       context_bundle_id, project_id, scene_task_version_id, workflow_run_id
     ) VALUES ($1, $2, $3, $4)`,
    [contextBundleId, bundleProjectId, bundleTaskVersionId, bundleWorkflowRunId],
  );
  await client.query(
    `INSERT INTO generation_run(
       generation_run_id, project_id, workflow_run_id, context_bundle_id
     ) VALUES ($1, $2, $3, $4)`,
    [generationRunId, generationProjectId, workflowRunId, contextBundleId],
  );
  await client.query(
    `INSERT INTO tool_call(
       tool_call_id, project_id, generation_run_id, tool_name, request_ref, response_ref
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      toolCallId,
      toolProjectId,
      generationRunId,
      options.toolName ?? 'fixture.lookup',
      options.requestRef ?? `fixture://request/${toolCallId}`,
      options.responseRef ?? `fixture://response/${toolCallId}`,
    ],
  );

  return {
    projectId,
    workflowProjectId,
    bundleProjectId,
    generationProjectId,
    toolProjectId,
    workflowTaskProjectId,
    bundleTaskProjectId,
    workflowTaskVersionId,
    bundleTaskVersionId,
    workflowRunId,
    bundleWorkflowRunId,
    contextBundleId,
    generationRunId,
    toolCallId,
  };
}

async function insertToolCall(client, chain, overrides = {}) {
  const toolCallId = overrides.toolCallId ?? id('tool_call');
  await client.query(
    `INSERT INTO tool_call(
       tool_call_id, project_id, generation_run_id, tool_name, request_ref, response_ref
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      toolCallId,
      overrides.projectId ?? chain.toolProjectId,
      overrides.generationRunId ?? chain.generationRunId,
      overrides.toolName ?? 'fixture.lookup',
      overrides.requestRef ?? `fixture://request/${toolCallId}`,
      overrides.responseRef ?? `fixture://response/${toolCallId}`,
    ],
  );
  return toolCallId;
}

function parentValues(chain, overrides = {}) {
  return {
    evidenceId: overrides.evidenceId ?? id('evidence'),
    projectId: overrides.projectId ?? chain.projectId,
    sourceDomain: overrides.sourceDomain ?? 'tool',
    sourceVersionId: overrides.sourceVersionId ?? chain.generationRunId,
    sourceObjectType: overrides.sourceObjectType ?? 'tool_call',
    sourceObjectId: overrides.sourceObjectId ?? chain.toolCallId,
    locator: overrides.locator ?? 'tool:response/0',
    evidenceKind: overrides.evidenceKind ?? 'tool_output',
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

async function insertSupport(client, evidenceId, toolCallId, overrides = {}, { qualified = false } = {}) {
  const table = qualified ? `${SCHEMA}.evidence_tool_source` : 'evidence_tool_source';
  await client.query(
    `INSERT INTO ${table}(evidence_reference_id, tool_call_id, source_ref)
     VALUES ($1, $2, $3)`,
    [
      Object.hasOwn(overrides, 'evidenceId') ? overrides.evidenceId : evidenceId,
      Object.hasOwn(overrides, 'toolCallId') ? overrides.toolCallId : toolCallId,
      Object.hasOwn(overrides, 'sourceRef') ? overrides.sourceRef : `fixture://source/${toolCallId}`,
    ],
  );
}

async function insertEvidencePair(client, chain, overrides = {}) {
  const values = parentValues(chain, overrides);
  await insertParent(client, values, { qualified: overrides.qualified ?? false });
  await insertSupport(
    client,
    values.evidenceId,
    overrides.supportToolCallId ?? chain.toolCallId,
    overrides.support ?? {},
    { qualified: overrides.qualified ?? false },
  );
  return values;
}

async function assertEvidenceChain(evidenceId, expected = 1) {
  const check = await observerClient();
  try {
    const { rows } = await check.query(
      `SELECT er.evidence_reference_id,
              er.project_id AS evidence_project,
              er.source_version_id,
              er.source_object_type,
              er.source_object_id,
              ets.tool_call_id,
              ets.source_ref,
              tc.project_id AS tool_project,
              tc.generation_run_id,
              gr.project_id AS generation_project,
              gr.workflow_run_id,
              gr.context_bundle_id,
              wr.project_id AS workflow_project,
              wr.scene_task_version_id AS workflow_task_version,
              cb.project_id AS bundle_project,
              cb.workflow_run_id AS bundle_workflow_run,
              cb.scene_task_version_id AS bundle_task_version
         FROM evidence_reference er
         LEFT JOIN evidence_tool_source ets USING (evidence_reference_id)
         LEFT JOIN tool_call tc ON tc.tool_call_id = ets.tool_call_id
         LEFT JOIN generation_run gr ON gr.generation_run_id = tc.generation_run_id
         LEFT JOIN workflow_run wr ON wr.workflow_run_id = gr.workflow_run_id
         LEFT JOIN context_bundle cb ON cb.context_bundle_id = gr.context_bundle_id
        WHERE er.evidence_reference_id = $1`,
      [evidenceId],
    );
    assert.equal(rows.length, expected);
    if (expected === 1) {
      const row = rows[0];
      assert.equal(row.source_object_type, 'tool_call');
      assert.equal(row.source_object_id, row.tool_call_id);
      assert.equal(row.source_version_id, row.generation_run_id);
      assert.equal(row.evidence_project, row.tool_project);
      assert.equal(row.tool_project, row.generation_project);
      assert.equal(row.generation_project, row.workflow_project);
      assert.equal(row.generation_project, row.bundle_project);
      assert.equal(row.workflow_run_id, row.bundle_workflow_run);
      assert.equal(row.workflow_task_version, row.bundle_task_version);
      assert.ok(row.source_ref);
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

async function seedCommittedChain(options = {}) {
  const client = await transactionClient();
  try {
    const chain = await seedExecutionChain(client, options);
    await client.query('COMMIT');
    return chain;
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
}

async function createCommittedEvidence(chain, overrides = {}) {
  const client = await transactionClient();
  let evidence;
  try {
    evidence = await insertEvidencePair(client, chain, overrides);
    await client.query('COMMIT');
    return evidence;
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
}

before(async () => {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO ${SCHEMA}, public`);
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
});

after(async () => {
  await writeFile(RESULTS_PATH, JSON.stringify({
    database: 'PostgreSQL',
    isolation: 'read committed',
    schema: SCHEMA,
    parameterizedSubscenarios,
    outcomes,
  }, null, 2));
  await pool.end();
});

scenario('合法 Tool Evidence 引用已提交执行链', async () => {
  const chain = await seedCommittedChain();
  assert.notEqual(chain.generationRunId, chain.toolCallId);
  const evidence = await createCommittedEvidence(chain);
  const rows = await assertEvidenceChain(evidence.evidenceId);
  assert.equal(rows[0].source_version_id, chain.generationRunId);
  assert.equal(rows[0].source_object_id, chain.toolCallId);
  return 'Generation Run ID 与 Tool Call ID 不同；Evidence 父子真实 COMMIT；独立连接回读完整执行归属链';
});

scenario('同一事务创建执行链、Tool Call 和 Evidence', async () => {
  const client = await transactionClient();
  let evidence;
  try {
    const chain = await seedExecutionChain(client);
    evidence = await insertEvidencePair(client, chain);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(evidence.evidenceId);
  return 'Scene Task Version、Workflow、Bundle、Generation、Tool Call 与 Evidence 在同一 READ COMMITTED 事务整体提交';
});

scenario('历史已存在 Tool Call 可在后续事务创建 Evidence', async () => {
  const setup = await transactionClient();
  let oldChain;
  try {
    oldChain = await seedExecutionChain(setup);
    await seedExecutionChain(setup);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const evidence = await createCommittedEvidence(oldChain, { locator: 'tool:historical/0' });
  await assertEvidenceChain(evidence.evidenceId);
  return '较早独立提交的 Tool Call 后续仍可形成 Evidence；原型没有 latest 或 succeeded 门槛';
});

scenario('只有 Evidence 父行时真实 COMMIT 失败', async () => {
  const chain = await seedCommittedChain();
  const client = await transactionClient();
  const values = parentValues(chain);
  try {
    await insertParent(client, values);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_tool_complete', stage: 'parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(values.evidenceId, 0);
  return '父 INSERT 成功；真实 COMMIT 命中 23514/evidence_tool_complete；独立连接确认无半成品';
});

scenario('支撑主键、Tool Call FK、必填列及父域类型即时约束', async () => {
  const variants = [
    { name: 'duplicate_support', code: '23505', constraint: 'evidence_tool_source_pkey' },
    { name: 'dangling_tool', code: '23503', constraint: 'fk_evidence_tool_call' },
    { name: 'null_evidence_id', code: '23502', column: 'evidence_reference_id' },
    { name: 'null_tool_call', code: '23502', column: 'tool_call_id' },
    { name: 'null_source_ref', code: '23502', column: 'source_ref' },
    { name: 'empty_source_ref', code: '23514', constraint: 'ck_evidence_tool_source_ref_nonempty' },
    { name: 'unsupported_domain', code: '23514', constraint: 'ck_evidence_reference_tool_domain' },
    { name: 'unsupported_type', code: '23514', constraint: 'ck_evidence_reference_tool_type' },
  ];
  for (const variant of variants) {
    const chain = await seedCommittedChain();
    const client = await transactionClient();
    let evidenceId;
    try {
      const values = parentValues(chain, variant.name === 'unsupported_domain'
        ? { sourceDomain: 'canon' }
        : variant.name === 'unsupported_type'
          ? { sourceObjectType: 'model_call' }
          : {});
      evidenceId = values.evidenceId;
      if (variant.name.startsWith('unsupported_')) {
        await expectPgError(() => insertParent(client, values), { ...variant, stage: `${variant.name} parent INSERT` });
      } else {
        await insertParent(client, values);
        if (variant.name === 'duplicate_support') {
          await insertSupport(client, evidenceId, chain.toolCallId);
          await expectPgError(() => insertSupport(client, evidenceId, chain.toolCallId), {
            ...variant, stage: 'duplicate support INSERT',
          });
        } else if (variant.name === 'dangling_tool') {
          await expectPgError(() => insertSupport(client, evidenceId, id('missing_tool')), {
            ...variant, stage: 'dangling Tool Call INSERT',
          });
        } else if (variant.name === 'null_evidence_id') {
          await expectPgError(() => insertSupport(client, evidenceId, chain.toolCallId, { evidenceId: null }), {
            ...variant, stage: 'NULL evidence_reference_id INSERT',
          });
        } else if (variant.name === 'null_tool_call') {
          await expectPgError(() => insertSupport(client, evidenceId, chain.toolCallId, { toolCallId: null }), {
            ...variant, stage: 'NULL tool_call_id INSERT',
          });
        } else if (variant.name === 'null_source_ref') {
          await expectPgError(() => insertSupport(client, evidenceId, chain.toolCallId, { sourceRef: null }), {
            ...variant, stage: 'NULL source_ref INSERT',
          });
        } else {
          await expectPgError(() => insertSupport(client, evidenceId, chain.toolCallId, { sourceRef: '' }), {
            ...variant, stage: 'empty source_ref INSERT',
          });
        }
      }
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceChain(evidenceId, 0);
  }
  return '8 个即时负例分别命中目标 PK/FK/NOT NULL/CHECK；三个必填字段为 NULL 均在 INSERT 阶段以 23502 拒绝，空 source_ref 命中具名 CHECK；独立连接确认无半成品';
});

scenario('父对象 ID 与支撑 Tool Call 不一致在 COMMIT 失败', async () => {
  const chain = await seedCommittedChain();
  const setup = await transactionClient();
  let secondToolCallId;
  try {
    secondToolCallId = await insertToolCall(setup, chain);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const client = await transactionClient();
  const values = parentValues(chain);
  try {
    const { rows } = await client.query(
      `SELECT count(*)::int AS count FROM tool_call
        WHERE tool_call_id = ANY($1::text[])
          AND generation_run_id = $2
          AND project_id = $3`,
      [[chain.toolCallId, secondToolCallId], chain.generationRunId, chain.projectId],
    );
    assert.equal(rows[0].count, 2);
    await insertParent(client, values);
    await insertSupport(client, values.evidenceId, secondToolCallId);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_tool_complete', stage: 'object identity mismatch COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(values.evidenceId, 0);
  return '两个 Tool Call 均存在且同 Generation/项目，仅父对象 ID 与支撑 Tool Call 不同；COMMIT 命中 23514/evidence_tool_complete';
});

scenario('父 source_version_id 使用另一真实 Generation 时 COMMIT 失败', async () => {
  const chain = await seedCommittedChain();
  const setup = await transactionClient();
  let otherGenerationId;
  try {
    otherGenerationId = id('other_generation');
    await setup.query(
      `INSERT INTO generation_run(
         generation_run_id, project_id, workflow_run_id, context_bundle_id
       ) VALUES ($1, $2, $3, $4)`,
      [otherGenerationId, chain.projectId, chain.workflowRunId, chain.contextBundleId],
    );
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const client = await transactionClient();
  const values = parentValues(chain, { sourceVersionId: otherGenerationId });
  try {
    await insertParent(client, values);
    await insertSupport(client, values.evidenceId, chain.toolCallId);
    await expectPgError(() => client.query('COMMIT'), {
      code: '23514', constraint: 'evidence_tool_complete', stage: 'source_version mismatch COMMIT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(values.evidenceId, 0);
  return '错误版本是同项目真实 Generation ID，Tool Call 与支撑一致；仅父版本映射错误并在 COMMIT 被拒绝';
});

scenario('项目、Workflow、Bundle 与 Scene Task Version 归属错误分别延后失败', async () => {
  const variants = ['project', 'workflow', 'bundle', 'scene_task_version'];
  for (const variant of variants) {
    const client = await transactionClient();
    let values;
    try {
      const projectId = id('project');
      const otherProjectId = id('other_project');
      let chain;
      if (variant === 'workflow') {
        chain = await seedExecutionChain(client, {
          projectId,
          bundleWorkflowRunId: id('other_workflow'),
        });
      } else if (variant === 'bundle') {
        chain = await seedExecutionChain(client, { projectId, bundleProjectId: otherProjectId });
      } else if (variant === 'scene_task_version') {
        chain = await seedExecutionChain(client, {
          projectId,
          bundleTaskVersionId: id('other_task_version'),
          bundleTaskProjectId: projectId,
        });
      } else {
        chain = await seedExecutionChain(client, { projectId });
        await seedProjects(client, [otherProjectId]);
      }
      values = parentValues(chain, variant === 'project' ? { projectId: otherProjectId } : {});
      await insertParent(client, values);
      await insertSupport(client, values.evidenceId, chain.toolCallId);
      await expectPgError(() => client.query('COMMIT'), {
        code: '23514', constraint: 'evidence_tool_complete', stage: `${variant} ownership COMMIT`,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
    await assertEvidenceChain(values.evidenceId, 0);
  }
  return '4 个单一归属负例均使用真实 FK 对象并在 COMMIT 命中 23514/evidence_tool_complete：Evidence 项目、Bundle Workflow、Bundle 项目、Scene Task Version';
});

scenario('六字段完整身份重复由唯一约束即时拒绝', async () => {
  const chain = await seedCommittedChain();
  const first = await createCommittedEvidence(chain, { locator: 'tool:duplicate/0' });
  const client = await transactionClient();
  const duplicate = parentValues(chain, {
    evidenceId: id('duplicate_evidence'),
    locator: first.locator,
    evidenceKind: first.evidenceKind,
  });
  try {
    await expectPgError(() => insertParent(client, duplicate), {
      code: '23505', constraint: 'uq_evidence_reference_full_identity', stage: 'full identity duplicate INSERT',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(first.evidenceId);
  await assertEvidenceChain(duplicate.evidenceId, 0);
  return '不同 Evidence 主键的相同六字段身份在父 INSERT 命中 23505/uq_evidence_reference_full_identity；原链保留';
});

scenario('旧四字段相同而 Tool Call 不同可分别提交', async () => {
  const chain = await seedCommittedChain();
  const setup = await transactionClient();
  let secondToolCallId;
  try {
    secondToolCallId = await insertToolCall(setup, chain);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const first = await createCommittedEvidence(chain, { locator: 'tool:legacy-shared', evidenceKind: 'tool_output' });
  const secondChain = { ...chain, toolCallId: secondToolCallId };
  const second = await createCommittedEvidence(secondChain, { locator: first.locator, evidenceKind: first.evidenceKind });
  await assertEvidenceChain(first.evidenceId);
  await assertEvidenceChain(second.evidenceId);
  return '同 Generation、locator、evidence_kind 但 Tool Call ID 不同的两条 Evidence 均提交；旧四字段索引非唯一';
});

scenario('同一 Tool Call 的 locator 或 evidence_kind 不同可分别创建', async () => {
  const chain = await seedCommittedChain();
  const variants = [
    { locator: 'tool:variant/a', evidenceKind: 'tool_output' },
    { locator: 'tool:variant/b', evidenceKind: 'tool_output' },
    { locator: 'tool:variant/a', evidenceKind: 'tool_metadata' },
  ];
  const ids = [];
  for (const variant of variants) {
    const evidence = await createCommittedEvidence(chain, variant);
    ids.push(evidence.evidenceId);
  }
  for (const evidenceId of ids) await assertEvidenceChain(evidenceId);
  return '同一 Tool Call 的两个 locator 和两个 evidence_kind 形成 3 个合法完整身份';
});

scenario('两个消费方共享同一 Evidence', async () => {
  const chain = await seedCommittedChain();
  const evidence = await createCommittedEvidence(chain);
  const client = await transactionClient();
  try {
    await client.query(
      `INSERT INTO evidence_consumer_reference(
         consumer_reference_id, evidence_reference_id, consumer_kind
       ) VALUES ($1, $2, 'validation'), ($3, $2, 'audit')`,
      [id('consumer'), evidence.evidenceId, id('consumer')],
    );
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  const check = await observerClient();
  try {
    const { rows } = await check.query(
      `SELECT
         (SELECT count(*)::int FROM evidence_reference WHERE evidence_reference_id = $1) AS evidence_count,
         (SELECT count(*)::int FROM evidence_consumer_reference WHERE evidence_reference_id = $1) AS consumer_count`,
      [evidence.evidenceId],
    );
    assert.deepEqual(rows[0], { evidence_count: 1, consumer_count: 2 });
  } finally {
    check.release();
  }
  return '两个消费方仅通过 Evidence ID 共享同一父子链；Evidence 1 条、消费引用 2 条';
});

scenario('Evidence 与 Tool 来源支撑的修改和删除均被拒绝', async () => {
  const chain = await seedCommittedChain();
  const evidence = await createCommittedEvidence(chain);
  const mutations = [
    ['parent update', `UPDATE evidence_reference SET locator = locator || '/changed' WHERE evidence_reference_id = $1`],
    ['parent delete', 'DELETE FROM evidence_reference WHERE evidence_reference_id = $1'],
    ['support update', `UPDATE evidence_tool_source SET source_ref = source_ref || '/changed' WHERE evidence_reference_id = $1`],
    ['support delete', 'DELETE FROM evidence_tool_source WHERE evidence_reference_id = $1'],
  ];
  for (const [name, sql] of mutations) {
    const client = await transactionClient();
    try {
      await expectPgError(() => client.query(sql, [evidence.evidenceId]), {
        code: '23514', constraint: 'evidence_tool_immutable', stage: name,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  await assertEvidenceChain(evidence.evidenceId);
  return '父行和支撑的 UPDATE/DELETE 均即时命中 23514/evidence_tool_immutable；独立连接确认原链保留';
});

scenario('Tool Call 及上层执行容器的来源保护字段不可改绑', async () => {
  const chain = await seedCommittedChain();
  const evidence = await createCommittedEvidence(chain);
  const setup = await transactionClient();
  let alternate;
  try {
    alternate = await seedExecutionChain(setup);
    await setup.query('COMMIT');
  } finally {
    await rollbackQuietly(setup);
    setup.release();
  }
  const mutations = [
    ['tool generation', 'UPDATE tool_call SET generation_run_id = $1 WHERE tool_call_id = $2', [alternate.generationRunId, chain.toolCallId]],
    ['tool project', 'UPDATE tool_call SET project_id = $1 WHERE tool_call_id = $2', [alternate.projectId, chain.toolCallId]],
    ['tool name', 'UPDATE tool_call SET tool_name = $1 WHERE tool_call_id = $2', ['fixture.changed', chain.toolCallId]],
    ['tool request', 'UPDATE tool_call SET request_ref = $1 WHERE tool_call_id = $2', ['fixture://request/changed', chain.toolCallId]],
    ['tool response', 'UPDATE tool_call SET response_ref = $1 WHERE tool_call_id = $2', ['fixture://response/changed', chain.toolCallId]],
    ['generation workflow', 'UPDATE generation_run SET workflow_run_id = $1 WHERE generation_run_id = $2', [alternate.workflowRunId, chain.generationRunId]],
    ['generation bundle', 'UPDATE generation_run SET context_bundle_id = $1 WHERE generation_run_id = $2', [alternate.contextBundleId, chain.generationRunId]],
    ['generation project', 'UPDATE generation_run SET project_id = $1 WHERE generation_run_id = $2', [alternate.projectId, chain.generationRunId]],
    ['workflow task', 'UPDATE workflow_run SET scene_task_version_id = $1 WHERE workflow_run_id = $2', [alternate.workflowTaskVersionId, chain.workflowRunId]],
    ['workflow project', 'UPDATE workflow_run SET project_id = $1 WHERE workflow_run_id = $2', [alternate.projectId, chain.workflowRunId]],
    ['bundle workflow', 'UPDATE context_bundle SET workflow_run_id = $1 WHERE context_bundle_id = $2', [alternate.workflowRunId, chain.contextBundleId]],
    ['bundle task', 'UPDATE context_bundle SET scene_task_version_id = $1 WHERE context_bundle_id = $2', [alternate.workflowTaskVersionId, chain.contextBundleId]],
    ['bundle project', 'UPDATE context_bundle SET project_id = $1 WHERE context_bundle_id = $2', [alternate.projectId, chain.contextBundleId]],
    ['task project', 'UPDATE scene_task_version SET project_id = $1 WHERE scene_task_version_id = $2', [alternate.projectId, chain.workflowTaskVersionId]],
  ];
  for (const [name, sql, params] of mutations) {
    const client = await transactionClient();
    try {
      await expectPgError(() => client.query(sql, params), {
        code: '23514', constraint: 'evidence_tool_complete', stage: name,
      });
    } finally {
      await rollbackQuietly(client);
      client.release();
    }
  }
  await assertEvidenceChain(evidence.evidenceId);
  return '14 个身份、项目、输入绑定及既有结果实际变化在 UPDATE 阶段命中 23514/evidence_tool_complete；未依赖延后扫描或 BEFORE 先锁父行假设';
});

scenario('删除被 Evidence 引用的 Tool Call 由 FK 拒绝', async () => {
  const chain = await seedCommittedChain();
  const evidence = await createCommittedEvidence(chain);
  const client = await transactionClient();
  try {
    await expectPgError(() => client.query('DELETE FROM tool_call WHERE tool_call_id = $1', [chain.toolCallId]), {
      code: '23503', constraint: 'fk_evidence_tool_call', stage: 'referenced Tool Call DELETE',
    });
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(evidence.evidenceId);
  return 'Tool Call DELETE 即时命中 23503/fk_evidence_tool_call；独立连接确认来源链保留';
});

scenario('来源保护字段的无变化 UPDATE 合法提交', async () => {
  const chain = await seedCommittedChain();
  const evidence = await createCommittedEvidence(chain);
  const client = await transactionClient();
  try {
    const generation = await client.query(
      'UPDATE generation_run SET workflow_run_id = workflow_run_id WHERE generation_run_id = $1',
      [chain.generationRunId],
    );
    const tool = await client.query(
      'UPDATE tool_call SET generation_run_id = generation_run_id WHERE tool_call_id = $1',
      [chain.toolCallId],
    );
    assert.equal(generation.rowCount, 1);
    assert.equal(tool.rowCount, 1);
    await client.query('COMMIT');
  } finally {
    await rollbackQuietly(client);
    client.release();
  }
  await assertEvidenceChain(evidence.evidenceId);
  return 'Generation Run 与 Tool Call 的受保护字段原值 UPDATE 首次 COMMIT 成功；实际变化才拒绝';
});

async function qualifiedSeedAndEvidence(client, { withSupport = true } = {}) {
  const projectId = id('qualified_project');
  const taskVersionId = id('qualified_task');
  const workflowRunId = id('qualified_workflow');
  const bundleId = id('qualified_bundle');
  const generationId = id('qualified_generation');
  const toolCallId = id('qualified_tool');
  const evidenceId = id('qualified_evidence');
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query('SET LOCAL search_path TO public');
  await client.query(`INSERT INTO ${SCHEMA}.project(project_id) VALUES ($1)`, [projectId]);
  await client.query(
    `INSERT INTO ${SCHEMA}.scene_task_version(scene_task_version_id, project_id) VALUES ($1, $2)`,
    [taskVersionId, projectId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.workflow_run(workflow_run_id, project_id, scene_task_version_id) VALUES ($1, $2, $3)`,
    [workflowRunId, projectId, taskVersionId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.context_bundle(
       context_bundle_id, project_id, scene_task_version_id, workflow_run_id
     ) VALUES ($1, $2, $3, $4)`,
    [bundleId, projectId, taskVersionId, workflowRunId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.generation_run(
       generation_run_id, project_id, workflow_run_id, context_bundle_id
     ) VALUES ($1, $2, $3, $4)`,
    [generationId, projectId, workflowRunId, bundleId],
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.tool_call(
       tool_call_id, project_id, generation_run_id, tool_name, request_ref, response_ref
     ) VALUES ($1, $2, $3, 'fixture.lookup', $4, $5)`,
    [toolCallId, projectId, generationId, `fixture://request/${toolCallId}`, `fixture://response/${toolCallId}`],
  );
  const chain = { projectId, generationRunId: generationId, toolCallId };
  const values = parentValues(chain, { evidenceId, qualified: true });
  await insertParent(client, values, { qualified: true });
  if (withSupport) {
    await insertSupport(client, evidenceId, toolCallId, {}, { qualified: true });
  }
  return { projectId, taskVersionId, workflowRunId, bundleId, generationId, toolCallId, evidenceId };
}

scenario('public search_path 下全限定 SQL 命中合法、缺支撑和不可变规则', async () => {
  const functionNames = [
    'protect_tool_source_ownership',
    'raise_evidence_tool_complete',
    'reject_evidence_tool_mutation',
    'validate_evidence_tool',
    'validate_evidence_tool_trigger',
  ];
  const legal = await standalonePublicClient();
  let legalIds;
  try {
    const { rows } = await legal.query(
      `SELECT p.proname, p.proconfig
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proname = ANY($2::text[])
        ORDER BY p.proname`,
      [SCHEMA, functionNames],
    );
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.deepEqual(row.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);
    }
    legalIds = await qualifiedSeedAndEvidence(legal);
    await legal.query('COMMIT');
  } finally {
    await rollbackQuietly(legal);
    await legal.end();
  }
  await assertEvidenceChain(legalIds.evidenceId);

  const missing = await standalonePublicClient();
  let missingIds;
  try {
    missingIds = await qualifiedSeedAndEvidence(missing, { withSupport: false });
    await expectPgError(() => missing.query('COMMIT'), {
      code: '23514', constraint: 'evidence_tool_complete', stage: 'public parent-only COMMIT',
    });
  } finally {
    await rollbackQuietly(missing);
    await missing.end();
  }
  await assertEvidenceChain(missingIds.evidenceId, 0);

  const immutable = await standalonePublicClient();
  try {
    await immutable.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await immutable.query('SET LOCAL search_path TO public');
    await expectPgError(
      () => immutable.query(
        `UPDATE ${SCHEMA}.evidence_tool_source SET source_ref = source_ref || '/changed'
          WHERE evidence_reference_id = $1`,
        [legalIds.evidenceId],
      ),
      { code: '23514', constraint: 'evidence_tool_immutable', stage: 'public immutable UPDATE' },
    );
  } finally {
    await rollbackQuietly(immutable);
    await immutable.end();
  }
  await assertEvidenceChain(legalIds.evidenceId);
  return '新建直连连接 search_path=public；5 个函数路径固定；全限定合法 COMMIT、缺支撑 23514/evidence_tool_complete、不可变 23514/evidence_tool_immutable 均符合预期';
});

scenario('并发相同完整身份：A 提交后 B 唯一冲突', async () => {
  const chain = await seedCommittedChain();
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
    first = await insertEvidencePair(a, chain, { locator: 'tool:concurrent-commit' });
    duplicate = parentValues(chain, {
      evidenceId: id('concurrent_b'), locator: first.locator, evidenceKind: first.evidenceKind,
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
  await assertEvidenceChain(first.evidenceId);
  await assertEvidenceChain(duplicate.evidenceId, 0);
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A COMMIT 后 B 命中 23505/uq_evidence_reference_full_identity；仅 A 完整链持久化`;
}, 30_000);

scenario('并发相同完整身份：A 回滚后 B 完成父子关系', async () => {
  const chain = await seedCommittedChain();
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
    first = await insertEvidencePair(a, chain, { locator: 'tool:concurrent-rollback' });
    second = parentValues(chain, {
      evidenceId: id('concurrent_b'), locator: first.locator, evidenceKind: first.evidenceKind,
    });
    const bInsert = insertParent(b, second);
    await waitForBlocked(observer, bPid, aPid);
    await a.query('ROLLBACK');
    await bInsert;
    await insertSupport(b, second.evidenceId, chain.toolCallId);
    await b.query('COMMIT');
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    a.release();
    b.release();
    observer.release();
  }
  await assertEvidenceChain(first.evidenceId, 0);
  await assertEvidenceChain(second.evidenceId);
  return `观察连接确认 B PID ${bPid} 被 A PID ${aPid} 阻塞；A ROLLBACK 后 B 完成支撑并 COMMIT；仅 B 完整链持久化`;
}, 30_000);

scenario('同一 Generation 下不同 Tool Call 可合法并发创建 Evidence', async () => {
  const chain = await seedCommittedChain();
  const setup = await transactionClient();
  let secondToolCallId;
  try {
    secondToolCallId = await insertToolCall(setup, chain);
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
  let aPid;
  let bPid;
  try {
    aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    evidenceA = await insertEvidencePair(a, chain, { locator: 'tool:legal-shared' });
    evidenceB = await insertEvidencePair(
      b,
      { ...chain, toolCallId: secondToolCallId },
      { locator: evidenceA.locator, evidenceKind: evidenceA.evidenceKind },
    );
    const { rows } = await observer.query(
      `SELECT pid, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE pid = ANY($1::int[])
        ORDER BY pid`,
      [[aPid, bPid]],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.flatMap((row) => row.blockers), []);
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
    assertEvidenceChain(evidenceA.evidenceId),
    assertEvidenceChain(evidenceB.evidenceId),
  ]);
  assert.equal(rowsA[0].generation_run_id, chain.generationRunId);
  assert.equal(rowsB[0].generation_run_id, chain.generationRunId);
  assert.notEqual(rowsA[0].tool_call_id, rowsB[0].tool_call_id);
  return `A PID ${aPid} 与 B PID ${bPid} 提交前均无阻塞者；同 Generation 不同 Tool Call 首次异步 COMMIT 均成功、无重试；独立连接确认两套完整链`;
}, 30_000);
