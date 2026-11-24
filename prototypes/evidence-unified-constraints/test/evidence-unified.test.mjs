import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'evidence_unified_constraint_fixture';
const DATABASE_URL = process.env.DATABASE_URL;
assert.ok(DATABASE_URL, 'DATABASE_URL is required');
const outcomes = [];
const subscenarios = [];
const parameterizedSubscenarios = {};
let sequence = 0;
const id = (prefix = 'id') => `${prefix}_${++sequence}`;
const q = (table) => `${SCHEMA}.${table}`;
const domains = ['author_design', 'candidate', 'canon', 'tool'];
const supportTable = { author_design: 'evidence_design_source', candidate: 'evidence_candidate_source', canon: 'evidence_canon_source', tool: 'evidence_tool_source' };
const designTypes = ['author_design_revision', 'design_object_version', 'design_constraint', 'outline_node', 'world_rule', 'temporal_constraint', 'foreshadowing_plan', 'ending_constraint'];
const candidateTypes = ['candidate_version', 'candidate_event', 'candidate_fact_proposal', 'candidate_state_transition', 'narrative_assertion'];
const canonTypes = ['canonical_text_version', 'canon_commit', 'story_event', 'canon_fact', 'state_transition', 'temporal_relation'];
const types = [...designTypes, ...candidateTypes, ...canonTypes, 'tool_call'];
const defaultType = { author_design: 'world_rule', candidate: 'candidate_event', canon: 'story_event', tool: 'tool_call' };
const domainOf = (type) => designTypes.includes(type) ? 'author_design' : candidateTypes.includes(type) ? 'candidate' : canonTypes.includes(type) ? 'canon' : 'tool';
const pk = (type) => ({ author_design_revision: 'revision_id', narrative_assertion: 'assertion_id' })[type] ?? `${type}_id`;
const targetColumn = (type) => ({ narrative_assertion: 'source_assertion_id', canonical_text_version: 'canonical_text_version_id', canon_commit: 'canon_commit_id', candidate_version: 'candidate_version_id', tool_call: 'tool_call_id' })[type] ?? `source_${type}_id`;
const targetColumns = {
  author_design: designTypes.map(targetColumn),
  candidate: candidateTypes.slice(1).map(targetColumn),
  canon: canonTypes.filter((type) => type !== 'canon_commit').map(targetColumn),
};

async function connect() {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  await client.query('SET search_path TO public');
  await client.query("SET statement_timeout = '8s'");
  await client.query("SET lock_timeout = '6s'");
  assert.equal((await client.query('SHOW search_path')).rows[0].search_path, 'public');
  return client;
}

async function begin(client) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'read committed');
}

async function close(client) {
  try { await client.query('ROLLBACK'); } finally { await client.end(); }
}

async function transaction(fn) {
  const client = await connect();
  try { await begin(client); return await fn(client); } finally { await close(client); }
}

async function observe(fn) {
  const client = await connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function insert(client, table, values) {
  const columns = Object.keys(values);
  await client.query(`INSERT INTO ${q(table)} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(values));
}

async function project(client, projectId) {
  await client.query(`INSERT INTO ${q('project')} VALUES ($1) ON CONFLICT DO NOTHING`, [projectId]);
}

async function seedGraph(client, domain, options = {}) {
  const projectId = options.projectId ?? id('project');
  await project(client, projectId);
  const graph = { domain, projectId, ...options };
  if (domain === 'author_design') {
    graph.revisionId = options.containerId ?? id('revision');
    await insert(client, 'author_design_revision', { revision_id: graph.revisionId, project_id: projectId });
  } else if (domain === 'canon') {
    graph.commitId = options.containerId ?? id('commit');
    await insert(client, 'canon_commit', { canon_commit_id: graph.commitId, project_id: projectId, status: options.status ?? 'committed' });
  } else {
    await seedExecution(client, graph);
    if (domain === 'candidate') {
      graph.candidateId = options.containerId ?? id('candidate');
      const candidateProject = options.candidateProject ?? projectId;
      await project(client, candidateProject);
      await insert(client, 'candidate_version', { candidate_version_id: graph.candidateId, project_id: candidateProject, workflow_run_id: graph.workflowId });
    }
  }
  return graph;
}

async function seedExecution(client, graph) {
  const p = graph.projectId;
  const taskProject = graph.taskProject ?? p;
  const workflowProject = graph.workflowProject ?? p;
  for (const value of [taskProject, workflowProject, graph.bundleProject ?? p, graph.generationProject ?? p]) await project(client, value);
  graph.taskId = id('task');
  graph.workflowId = id('workflow');
  await insert(client, 'scene_task_version', { scene_task_version_id: graph.taskId, project_id: taskProject });
  await insert(client, 'workflow_run', { workflow_run_id: graph.workflowId, project_id: workflowProject, scene_task_version_id: graph.taskId });
  if (graph.domain !== 'tool') return;
  graph.bundleTaskId = graph.taskId;
  if (graph.differentTask) {
    graph.bundleTaskId = id('bundle_task');
    await insert(client, 'scene_task_version', { scene_task_version_id: graph.bundleTaskId, project_id: p });
  }
  graph.bundleWorkflowId = graph.nullWorkflow ? null : graph.workflowId;
  if (graph.differentWorkflow) {
    graph.bundleWorkflowId = id('bundle_workflow');
    await insert(client, 'workflow_run', { workflow_run_id: graph.bundleWorkflowId, project_id: p, scene_task_version_id: graph.taskId });
  }
  graph.bundleId = id('bundle');
  graph.generationId = graph.containerId ?? id('generation');
  await insert(client, 'context_bundle', { context_bundle_id: graph.bundleId, project_id: graph.bundleProject ?? p, scene_task_version_id: graph.bundleTaskId, workflow_run_id: graph.bundleWorkflowId });
  await insert(client, 'generation_run', { generation_run_id: graph.generationId, project_id: graph.generationProject ?? p, workflow_run_id: graph.workflowId, context_bundle_id: graph.bundleId });
}

async function createSource(client, type, graph, options = {}) {
  const domain = domainOf(type);
  const projectId = options.targetProject ?? graph.projectId;
  await project(client, projectId);
  let objectId = options.objectId ?? id(type);
  const support = {};
  let versionId;
  let containerId;
  let row;
  if (domain === 'author_design') {
    versionId = containerId = graph.revisionId;
    support.author_design_revision_id = containerId;
    if (type === 'author_design_revision') objectId = containerId;
    else row = { [pk(type)]: objectId, project_id: projectId, revision_id: containerId };
  } else if (domain === 'candidate') {
    versionId = containerId = graph.candidateId;
    support.candidate_version_id = containerId;
    if (type === 'candidate_version') objectId = containerId;
    else if (type === 'narrative_assertion') {
      row = { assertion_id: objectId, project_id: projectId, source_domain: options.assertionDomain ?? 'candidate' };
    } else row = { [pk(type)]: objectId, project_id: projectId, candidate_version_id: containerId };
  } else if (domain === 'canon') {
    containerId = graph.commitId;
    versionId = type === 'canonical_text_version' ? objectId : containerId;
    support.canon_commit_id = containerId;
    if (type === 'canon_commit') objectId = containerId;
    else row = { [pk(type)]: objectId, project_id: projectId, canon_commit_id: containerId };
  } else {
    versionId = containerId = graph.generationId;
    row = { tool_call_id: objectId, project_id: projectId, generation_run_id: containerId, tool_name: 'fixture.lookup', request_ref: `fixture://request/${objectId}`, response_ref: options.emptyResponse ? null : `fixture://response/${objectId}` };
    support.source_ref = options.sourceRef ?? `fixture://source/${objectId}`;
    assert.notEqual(objectId, versionId, 'Tool Call and Generation IDs must differ');
  }
  if (row) await insert(client, type, row);
  if (type === 'narrative_assertion' && !options.missingAssertionChain) {
    const candidateId = options.assertionCandidateId ?? containerId;
    await insert(client, 'narrative_assertion_candidate_source', { assertion_id: objectId, candidate_version_id: candidateId, source_version_id: candidateId });
  }
  if (domain !== 'tool') Object.assign(support, { source_object_type: type, source_object_id: objectId });
  support[targetColumn(type)] = objectId;
  return { domain, type, objectId, versionId, containerId, projectId, support, graph };
}

function parent(source, overrides = {}) {
  return { evidence_reference_id: id('evidence'), project_id: source.projectId, source_domain: source.domain, source_version_id: source.versionId, source_object_type: source.type, source_object_id: source.objectId, locator: 'offset:1', evidence_kind: 'support', ...overrides };
}
async function support(client, evidenceId, source, overrides = {}) {
  await insert(client, supportTable[source.domain], { evidence_reference_id: evidenceId, ...source.support, ...overrides });
}
async function pair(client, source, overrides = {}) {
  const values = parent(source, overrides);
  await insert(client, 'evidence_reference', values);
  await support(client, values.evidence_reference_id, source);
  return values;
}

async function assertStored(values, source, exists = true) {
  return observe(async (client) => {
    const evidenceId = typeof values === 'string' ? values : values.evidence_reference_id;
    const parents = (await client.query(`SELECT * FROM ${q('evidence_reference')} WHERE evidence_reference_id=$1`, [evidenceId])).rows;
    const all = [];
    for (const domain of domains) {
      const rows = (await client.query(`SELECT * FROM ${q(supportTable[domain])} WHERE evidence_reference_id=$1`, [evidenceId])).rows;
      all.push(...rows.map((row) => ({ domain, row })));
    }
    assert.equal(parents.length, exists ? 1 : 0);
    assert.equal(all.length, exists ? 1 : 0, 'four-table total support count');
    if (!exists) return;
    assert.deepEqual(parents[0], values);
    assert.equal(all[0].domain, source.domain);
    assert.deepEqual(all[0].row, { evidence_reference_id: evidenceId, ...Object.fromEntries((targetColumns[source.domain] ?? []).map((column) => [column, null])), ...source.support });
    const target = (await client.query(`SELECT * FROM ${q(source.type)} WHERE ${pk(source.type)}=$1`, [source.objectId])).rows[0];
    assert.ok(target, 'typed actual target exists');
    assert.equal(target.project_id, values.project_id);
    if (source.domain === 'author_design') {
      assert.equal(target.revision_id, source.containerId);
      const revision = (await client.query(`SELECT * FROM ${q('author_design_revision')} WHERE revision_id=$1`, [source.containerId])).rows[0];
      assert.equal(revision.project_id, values.project_id);
      assert.equal(values.source_version_id, revision.revision_id);
    }
    if (source.domain === 'candidate') {
      const candidate = (await client.query(`SELECT cv.*, wr.project_id AS workflow_project FROM ${q('candidate_version')} cv
        JOIN ${q('workflow_run')} wr USING (workflow_run_id) WHERE candidate_version_id=$1`, [source.containerId])).rows[0];
      assert.equal(candidate.candidate_version_id, values.source_version_id);
      assert.equal(candidate.workflow_run_id, source.graph.workflowId);
      assert.equal(candidate.project_id, values.project_id);
      assert.equal(candidate.workflow_project, values.project_id);
    }
    if (source.domain === 'candidate' && !['candidate_version', 'narrative_assertion'].includes(source.type)) assert.equal(target.candidate_version_id, source.containerId);
    if (source.domain === 'candidate' && source.type === 'narrative_assertion') {
      const chain = (await client.query(`SELECT * FROM ${q('narrative_assertion_candidate_source')} WHERE assertion_id=$1`, [source.objectId])).rows[0];
      assert.equal(chain.candidate_version_id, source.containerId);
      assert.equal(chain.source_version_id, source.versionId);
      assert.equal(target.source_domain, 'candidate');
    }
    if (source.domain === 'canon') {
      assert.equal(target.canon_commit_id, source.containerId);
      const commit = (await client.query(`SELECT * FROM ${q('canon_commit')} WHERE canon_commit_id=$1`, [source.containerId])).rows[0];
      assert.equal(commit.status, 'committed');
      assert.equal(commit.project_id, values.project_id);
      assert.equal(values.source_version_id, source.type === 'canonical_text_version' ? target.canonical_text_version_id : commit.canon_commit_id);
    }
    if (source.domain === 'tool') {
      assert.equal(target.generation_run_id, values.source_version_id);
      const chain = (await client.query(`SELECT gr.*, cb.workflow_run_id AS bundle_workflow, cb.scene_task_version_id AS bundle_task,
        wr.scene_task_version_id AS workflow_task, wr.project_id AS workflow_project, cb.project_id AS bundle_project,
        st.project_id AS task_project FROM ${q('generation_run')} gr
        JOIN ${q('workflow_run')} wr USING (workflow_run_id)
        JOIN ${q('context_bundle')} cb USING (context_bundle_id)
        JOIN ${q('scene_task_version')} st ON st.scene_task_version_id=wr.scene_task_version_id
        WHERE generation_run_id=$1`, [values.source_version_id])).rows[0];
      for (const field of ['project_id', 'workflow_project', 'bundle_project', 'task_project']) assert.equal(chain[field], values.project_id);
      assert.equal(chain.workflow_task, chain.bundle_task);
      if (chain.bundle_workflow !== null) assert.equal(chain.bundle_workflow, chain.workflow_run_id);
    }
  });
}

function scenario(name, fn) {
  test(name, { timeout: 120_000 }, async (t) => {
    try {
      const evidence = await fn(t);
      outcomes.push({ name, status: 'passed', evidence: evidence ?? '详见实测子场景' });
    } catch (error) {
      outcomes.push({ name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint });
      throw error;
    }
  });
}

async function sub(t, name, fn) {
  let failure;
  await t.test(name, { timeout: 20_000 }, async () => {
    try {
      const result = await fn();
      subscenarios.push({ group: t.name, name, status: 'passed', ...(typeof result === 'string' ? { evidence: result } : result) });
    } catch (error) {
      subscenarios.push({ group: t.name, name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint });
      failure = error;
      throw error;
    } finally {
      parameterizedSubscenarios[t.name] = (parameterizedSubscenarios[t.name] ?? 0) + 1;
    }
  });
  if (failure) throw failure;
}

async function expectSql(action, stage, code = '23514', constraint = 'evidence_source_complete', message) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, `${stage} must fail`);
  assert.equal(error.code, code, `${stage}: ${error.message}`);
  if (constraint !== null) assert.equal(error.constraint, constraint);
  if (message) assert.match(error.message, message);
  return { stage, code: error.code, constraint: error.constraint ?? '', evidence: error.message };
}

async function committedSource(domain, options = {}) {
  return transaction(async (client) => {
    const graph = await seedGraph(client, domain, options);
    const source = await createSource(client, defaultType[domain], graph);
    await client.query('COMMIT');
    return source;
  });
}

async function commitEvidence(source, overrides = {}) {
  return transaction(async (client) => {
    const values = await pair(client, source, overrides);
    await client.query('COMMIT');
    return values;
  });
}

after(async () => {
  await writeFile(process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json', JSON.stringify({ schema: SCHEMA, isolation: 'read committed', outcomes, subscenarios, parameterizedSubscenarios }, null, 2));
});

scenario('A：20 种来源完整提交及独立连接回读', async (t) => {
  for (const type of types) await sub(t, type, async () => {
    let source;
    const values = await transaction(async (client) => {
      const graph = await seedGraph(client, domainOf(type));
      source = await createSource(client, type, graph);
      const values = await pair(client, source);
      await client.query('COMMIT');
      return values;
    });
    await assertStored(values, source);
    return `COMMIT 成功；独立直连回读父行、实际 ${type} 目标、版本/容器及四表总支撑=1`;
  });
});

scenario('A：Canon 同事务终态与历史 committed 来源', async (t) => {
  await sub(t, 'preparing→committed 同事务', async () => {
    let source;
    const values = await transaction(async (client) => {
      const graph = await seedGraph(client, 'canon', { status: 'preparing' });
      source = await createSource(client, 'canonical_text_version', graph);
      const values = await pair(client, source);
      await client.query(`UPDATE ${q('canon_commit')} SET status='committed' WHERE canon_commit_id=$1`, [graph.commitId]);
      await client.query('COMMIT');
      return values;
    });
    await assertStored(values, source);
    return 'preparing 来源、正文与 Evidence 一起创建，切换 committed 后整体提交';
  });
  await sub(t, '历史来源后续创建 Evidence', async () => {
    const source = await committedSource('canon');
    const values = await commitEvidence(source);
    await assertStored(values, source);
    return '来源与 Evidence 使用不同事务提交；旧 committed Commit 可复用';
  });
});

scenario('B：四域缺支撑只在真实 COMMIT 拒绝', async (t) => {
  for (const domain of domains) await sub(t, domain, async () => {
    let values;
    const result = await transaction(async (client) => {
      const graph = await seedGraph(client, domain);
      const source = await createSource(client, defaultType[domain], graph);
      values = parent(source);
      await insert(client, 'evidence_reference', values);
      return expectSql(() => client.query('COMMIT'), 'COMMIT', '23514', 'evidence_source_complete', /support_count=0/);
    });
    await assertStored(values, null, false);
    return { ...result, evidence: `${result.evidence}；父 INSERT 成功；独立连接确认无父子半成品` };
  });
});

scenario('B：单支撑错域 12 个方向', async (t) => {
  for (const parentDomain of domains) for (const wrongDomain of domains.filter((d) => d !== parentDomain)) {
    await sub(t, `${parentDomain}→${wrongDomain}`, async () => {
      let values;
      const result = await transaction(async (client) => {
        const projectId = id('project');
        const own = await createSource(client, defaultType[parentDomain], await seedGraph(client, parentDomain, { projectId }));
        const wrong = await createSource(client, defaultType[wrongDomain], await seedGraph(client, wrongDomain, { projectId }));
        values = parent(own);
        await insert(client, 'evidence_reference', values);
        await support(client, values.evidence_reference_id, wrong);
        return expectSql(() => client.query('COMMIT'), 'COMMIT', '23514', 'evidence_source_complete', /support_domain=/);
      });
      await assertStored(values, null, false);
      return { ...result, evidence: `${result.evidence}；唯一支撑自身 CHECK/FK 合法、真实目标存在；整套回滚` };
    });
  }
});

scenario('B：六种双支撑组合和四表同时存在', async (t) => {
  const combinations = domains.flatMap((domain, i) => domains.slice(i + 1).map((other) => [domain, other]));
  combinations.push(domains);
  for (const selected of combinations) await sub(t, selected.join('+'), async () => {
    let values;
    const result = await transaction(async (client) => {
      const projectId = id('project');
      const sources = [];
      for (const domain of selected) sources.push(await createSource(client, defaultType[domain], await seedGraph(client, domain, { projectId })));
      values = parent(sources[0]);
      await insert(client, 'evidence_reference', values);
      for (const source of sources) await support(client, values.evidence_reference_id, source);
      return expectSql(() => client.query('COMMIT'), 'COMMIT', '23514', 'evidence_source_complete', new RegExp(`support_count=${selected.length}`));
    });
    await assertStored(values, null, false);
    return { ...result, evidence: `${result.evidence}；全部支撑 INSERT 成功；独立连接确认父行与四表新关系全部回滚` };
  });
});

scenario('B：同表主键与无父支撑 FK 即时拒绝', async (t) => {
  for (const domain of domains) for (const kind of ['duplicate', 'orphan']) await sub(t, `${domain}/${kind}`, async () => transaction(async (client) => {
    const source = await createSource(client, defaultType[domain], await seedGraph(client, domain));
    let evidenceId = id('absent_parent');
    if (kind === 'duplicate') evidenceId = (await pair(client, source)).evidence_reference_id;
    return expectSql(() => support(client, evidenceId, source), 'support INSERT', kind === 'duplicate' ? '23505' : '23503', kind === 'duplicate' ? `${supportTable[domain]}_pkey` : `${supportTable[domain]}_evidence_reference_id_fkey`);
  }));
});

scenario('C：四域相同 ID 文本与域内同 ID 不同类型', async (t) => {
  await sub(t, '四域共享版本/对象/locator/kind 文本', async () => {
    const stored = [];
    await transaction(async (client) => {
      const projectId = id('project');
      const versionId = id('shared_version');
      const objectId = id('shared_object');
      for (const domain of domains) {
        const graph = await seedGraph(client, domain, { projectId, containerId: versionId });
        const source = await createSource(client, defaultType[domain], graph, { objectId });
        const values = await pair(client, source);
        assert.equal(values.source_version_id, versionId);
        assert.equal(values.source_object_id, objectId);
        stored.push([values, source]);
      }
      await client.query('COMMIT');
    });
    for (const [values, source] of stored) await assertStored(values, source);
    return '四个真实来源对象共享 ID 文本；四条父记录与各自单一支撑均提交成功，无跨域共用 ID 唯一限制';
  });
  const pairs = [['world_rule', 'design_constraint'], ['candidate_event', 'candidate_fact_proposal'], ['story_event', 'canon_fact']];
  for (const [first, second] of pairs) await sub(t, `${first}+${second}`, async () => {
    const stored = [];
    await transaction(async (client) => {
      const graph = await seedGraph(client, domainOf(first));
      const objectId = id('same_typed_id');
      for (const type of [first, second]) {
        const source = await createSource(client, type, graph, { objectId });
        stored.push([await pair(client, source), source]);
      }
      assert.equal(stored[0][0].source_version_id, stored[1][0].source_version_id);
      assert.equal(stored[0][0].source_object_id, stored[1][0].source_object_id);
      await client.query('COMMIT');
    });
    for (const [values, source] of stored) await assertStored(values, source);
    return '仅实际类型不同，其余五字段相同；两种真实目标均存在并提交';
  });
});

scenario('C：六字段去重、旧四字段及 locator/kind 变体', async (t) => {
  for (const domain of domains) {
    const source = await committedSource(domain);
    const original = await commitEvidence(source);
    await sub(t, `${domain}/完整六字段重复`, async () => transaction(async (client) => {
      return expectSql(() => insert(client, 'evidence_reference', parent(source)), 'parent INSERT', '23505', 'uq_evidence_reference_full_identity');
    }));
    await sub(t, `${domain}/同版本旧四字段同但实际对象不同`, async () => {
      let second;
      const values = await transaction(async (client) => {
        second = await createSource(client, source.type, source.graph);
        const values = await pair(client, second);
        assert.equal(values.source_version_id, original.source_version_id);
        assert.notEqual(values.source_object_id, original.source_object_id);
        await client.query('COMMIT');
        return values;
      });
      await assertStored(values, second);
      await assertStored(original, source);
      return '同域、同来源类型/版本、同 locator/kind；两个实际对象分别提交';
    });
    for (const field of ['locator', 'evidence_kind']) await sub(t, `${domain}/${field} 不同`, async () => {
      const values = await commitEvidence(source, { [field]: `different:${field}` });
      await assertStored(values, source);
      return '其余五个身份字段相同，真实 COMMIT 成功';
    });
  }
});

scenario('C：父子类型不一致与对象 ID 不一致独立验证', async (t) => {
  for (const [first, second] of [['world_rule', 'design_constraint'], ['candidate_event', 'candidate_fact_proposal'], ['story_event', 'canon_fact']]) {
    for (const kind of ['type_only_same_id', 'object_only_same_type']) await sub(t, `${domainOf(first)}/${kind}`, async () => {
      let values;
      const result = await transaction(async (client) => {
        const graph = await seedGraph(client, domainOf(first));
        const own = await createSource(client, first, graph);
        const wrong = await createSource(client, kind === 'type_only_same_id' ? second : first, graph, kind === 'type_only_same_id' ? { objectId: own.objectId } : {});
        assert.equal(own.versionId, wrong.versionId);
        assert.equal(own.projectId, wrong.projectId);
        if (kind === 'type_only_same_id') { assert.equal(own.objectId, wrong.objectId); assert.notEqual(own.type, wrong.type); }
        else { assert.equal(own.type, wrong.type); assert.notEqual(own.objectId, wrong.objectId); }
        values = parent(own);
        await insert(client, 'evidence_reference', values);
        await support(client, values.evidence_reference_id, wrong);
        return expectSql(() => client.query('COMMIT'), 'COMMIT');
      });
      await assertStored(values, null, false);
      return { ...result, evidence: `${result.evidence}；仅一个父子身份字段错误；双方实际对象存在，支撑 INSERT 成功` };
    });
  }
});

scenario('C：逐分支全空实际目标及错误组合在 INSERT 拒绝', async (t) => {
  for (const type of types.filter((type) => type !== 'tool_call')) {
    const domain = domainOf(type);
    const kinds = ['candidate_version', 'canon_commit'].includes(type) ? ['wrong_combination', 'wrong_container_target_id'] : ['all_actual_targets_null', 'wrong_combination'];
    for (const kind of kinds) await sub(t, `${type}/${kind}`, async () => transaction(async (client) => {
      const graph = await seedGraph(client, domain);
      const source = await createSource(client, type, graph);
      const values = parent(source);
      await insert(client, 'evidence_reference', values);
      let overrides;
      if (kind === 'all_actual_targets_null') {
        overrides = Object.fromEntries(targetColumns[domain].map((column) => [column, null]));
      } else if (kind === 'wrong_container_target_id') {
        overrides = { source_object_id: id('different_actual_id') };
      } else {
        const otherType = domain === 'author_design' ? (type === 'author_design_revision' ? 'world_rule' : 'author_design_revision')
          : domain === 'candidate' ? (type === 'candidate_event' ? 'candidate_fact_proposal' : 'candidate_event')
          : type === 'story_event' ? 'canonical_text_version' : 'story_event';
        const other = await createSource(client, otherType, graph);
        overrides = { [targetColumn(otherType)]: other.objectId };
      }
      return expectSql(() => support(client, values.evidence_reference_id, source, overrides), 'support INSERT', '23514', `ck_evidence_${domain === 'author_design' ? 'design' : domain}_source_target_shape`);
    }));
  }
});

scenario('C：类型 FK、必填字段和父域类型行级检查', async (t) => {
  for (const type of types) await sub(t, `${type}/悬空实际目标 FK`, async () => transaction(async (client) => {
    const source = await createSource(client, type, await seedGraph(client, domainOf(type)));
    const values = parent(source);
    await insert(client, 'evidence_reference', values);
    const missing = id('missing_target');
    const overrides = { [targetColumn(type)]: missing };
    if (type !== 'tool_call') overrides.source_object_id = missing;
    if (type === 'author_design_revision') overrides.author_design_revision_id = missing;
    return expectSql(() => support(client, values.evidence_reference_id, source, overrides), 'support INSERT', '23503', null);
  }));
  const source = await committedSource('tool');
  for (const field of ['source_domain', 'source_version_id', 'source_object_type', 'source_object_id', 'locator', 'evidence_kind']) {
    await sub(t, `${field}/NOT NULL`, async () => transaction(async (client) => {
      const result = await expectSql(() => insert(client, 'evidence_reference', parent(source, { [field]: null })), 'parent INSERT', '23502', null);
      return result;
    }));
  }
  for (const overrides of [{ source_domain: 'unknown' }, { source_object_type: 'story_event' }, { locator: ' ' }, { evidence_kind: ' ' }]) {
    await sub(t, `parent CHECK ${JSON.stringify(overrides)}`, async () => transaction(async (client) => expectSql(
      () => insert(client, 'evidence_reference', parent(source, overrides)), 'parent INSERT', '23514', Object.hasOwn(overrides, 'locator') ? 'ck_evidence_reference_locator_nonempty' : Object.hasOwn(overrides, 'evidence_kind') ? 'ck_evidence_reference_kind_nonempty' : 'ck_evidence_reference_domain_type',
    )));
  }
  for (const [field, value, code, constraint] of [
    ['tool_call_id', null, '23502', null], ['source_ref', null, '23502', null], ['source_ref', ' ', '23514', 'ck_evidence_tool_source_ref_nonempty'],
  ]) await sub(t, `tool/${field}=${JSON.stringify(value)}`, async () => transaction(async (client) => {
    const values = parent(source);
    await insert(client, 'evidence_reference', values);
    return expectSql(() => support(client, values.evidence_reference_id, source, { [field]: value }), 'support INSERT', code, constraint);
  }));
});

async function rejectDetailed(setup) {
  let values;
  const result = await transaction(async (client) => {
    const { source, parentOverrides = {}, supportOverrides = {} } = await setup(client);
    values = parent(source, parentOverrides);
    await insert(client, 'evidence_reference', values);
    await support(client, values.evidence_reference_id, source, supportOverrides);
    return expectSql(() => client.query('COMMIT'), 'COMMIT');
  });
  await assertStored(values, null, false);
  return { ...result, evidence: `${result.evidence}；父/支撑 INSERT 成功，独立连接确认整体回滚` };
}

scenario('D：Design Revision、版本及项目独立负例', async (t) => {
  for (const kind of ['parent_version', 'target_revision', 'parent_project', 'target_project', 'revision_project']) {
    await sub(t, kind, async () => rejectDetailed(async (client) => {
      const graph = await seedGraph(client, 'author_design');
      const other = await seedGraph(client, 'author_design', { projectId: graph.projectId });
      const otherProject = id('other_project');
      await project(client, otherProject);
      const source = await createSource(client, 'world_rule', graph, kind === 'target_project' ? { targetProject: otherProject } : {});
      if (kind === 'parent_version') return { source, parentOverrides: { source_version_id: other.revisionId } };
      if (kind === 'target_revision') return { source, parentOverrides: { source_version_id: other.revisionId }, supportOverrides: { author_design_revision_id: other.revisionId } };
      if (kind === 'revision_project') {
        const cross = await seedGraph(client, 'author_design', { projectId: otherProject });
        // Target's own project matches Evidence; only its Revision belongs elsewhere.
        const crossSource = await createSource(client, 'world_rule', cross, { targetProject: graph.projectId });
        return { source: crossSource };
      }
      return { source, parentOverrides: kind === 'parent_project' ? { project_id: otherProject } : {} };
    }));
  }
});

scenario('D：Candidate 容器、Workflow 与 Assertion 支撑链', async (t) => {
  for (const kind of ['parent_version', 'target_candidate', 'parent_project', 'target_project', 'workflow_project', 'assertion_wrong_candidate', 'assertion_missing_chain', 'assertion_wrong_domain']) {
    await sub(t, kind, async () => rejectDetailed(async (client) => {
      const otherProject = id('other_project');
      const graph = await seedGraph(client, 'candidate', kind === 'workflow_project' ? { workflowProject: otherProject } : {});
      const other = await seedGraph(client, 'candidate', { projectId: graph.projectId });
      await project(client, otherProject);
      const isAssertion = kind.startsWith('assertion_');
      const options = kind === 'assertion_wrong_candidate' ? { assertionCandidateId: other.candidateId }
        : kind === 'assertion_missing_chain' ? { missingAssertionChain: true }
        : kind === 'assertion_wrong_domain' ? { assertionDomain: 'canon' }
        : kind === 'target_project' ? { targetProject: otherProject } : {};
      const source = await createSource(client, isAssertion ? 'narrative_assertion' : 'candidate_event', graph, options);
      if (kind === 'target_candidate') return { source, parentOverrides: { source_version_id: other.candidateId }, supportOverrides: { candidate_version_id: other.candidateId } };
      if (kind === 'parent_version') return { source, parentOverrides: { source_version_id: other.candidateId } };
      return { source, parentOverrides: kind === 'parent_project' ? { project_id: otherProject } : {} };
    }));
  }
});

scenario('D：Canon 创建 Commit、正文/Commit 版本映射与终态', async (t) => {
  for (const kind of ['creating_commit', 'text_creating_commit', 'text_version_uses_commit', 'internal_version_uses_text', 'parent_project', 'target_project', 'preparing', 'failed']) {
    await sub(t, kind, async () => rejectDetailed(async (client) => {
      const graph = await seedGraph(client, 'canon', ['preparing', 'failed'].includes(kind) ? { status: kind } : {});
      const other = await seedGraph(client, 'canon', { projectId: graph.projectId });
      const otherProject = id('other_project');
      await project(client, otherProject);
      const type = ['text_creating_commit', 'text_version_uses_commit'].includes(kind) ? 'canonical_text_version' : 'story_event';
      const source = await createSource(client, type, graph, kind === 'target_project' ? { targetProject: otherProject } : {});
      if (kind === 'creating_commit') return { source, parentOverrides: { source_version_id: other.commitId }, supportOverrides: { canon_commit_id: other.commitId } };
      if (kind === 'text_creating_commit') return { source, supportOverrides: { canon_commit_id: other.commitId } };
      if (kind === 'text_version_uses_commit') return { source, parentOverrides: { source_version_id: graph.commitId } };
      if (kind === 'internal_version_uses_text') {
        const text = await createSource(client, 'canonical_text_version', graph);
        return { source, parentOverrides: { source_version_id: text.objectId } };
      }
      return { source, parentOverrides: kind === 'parent_project' ? { project_id: otherProject } : {} };
    }));
  }
});

scenario('D：Tool Generation 映射与执行范围', async (t) => {
  for (const kind of ['parent_generation', 'version_uses_tool_id', 'object_id', 'parent_project', 'tool_project', 'generation_project', 'workflow_project', 'bundle_project', 'workflow_task_project', 'task_version', 'bundle_workflow']) {
    await sub(t, kind, async () => rejectDetailed(async (client) => {
      const otherProject = id('other_project');
      const options = {
        generation_project: { generationProject: otherProject }, workflow_project: { workflowProject: otherProject },
        bundle_project: { bundleProject: otherProject }, workflow_task_project: { taskProject: otherProject },
        task_version: { differentTask: true },
        bundle_workflow: { differentWorkflow: true },
      }[kind] ?? {};
      const graph = await seedGraph(client, 'tool', options);
      const source = await createSource(client, 'tool_call', graph, kind === 'tool_project' ? { targetProject: otherProject } : {});
      await project(client, otherProject);
      if (kind === 'parent_generation') {
        const other = await seedGraph(client, 'tool', { projectId: graph.projectId });
        return { source, parentOverrides: { source_version_id: other.generationId } };
      }
      if (kind === 'object_id') {
        const other = await createSource(client, 'tool_call', graph);
        return { source, parentOverrides: { source_object_id: other.objectId } };
      }
      return { source, parentOverrides: kind === 'parent_project' ? { project_id: otherProject }
        : kind === 'version_uses_tool_id' ? { source_version_id: source.objectId } : {} };
    }));
  }
});

scenario('D：Bundle Workflow 可空边界', async (t) => {
  for (const nullWorkflow of [true, false]) await sub(t, nullWorkflow ? '为空合法' : '同 Workflow 合法', async () => {
    const source = await committedSource('tool', { nullWorkflow });
    const values = await commitEvidence(source);
    await assertStored(values, source);
    return nullWorkflow ? 'Bundle.workflow_run_id=NULL；Generation→Workflow 与 Bundle Task/项目一致；COMMIT 成功' : 'Bundle 关联 Generation 同一 Workflow；COMMIT 成功';
  });
  await sub(t, '不同 Workflow 非法', async () => rejectDetailed(async (client) => {
    const graph = await seedGraph(client, 'tool', { differentWorkflow: true });
    return { source: await createSource(client, 'tool_call', graph) };
  }));
  for (const kind of ['task', 'bundle_project', 'workflow_project', 'generation_project', 'task_project']) await sub(t, `为空仍校验 ${kind}`, async () => rejectDetailed(async (client) => {
    const otherProject = id('other_project');
    const options = { task: { differentTask: true }, bundle_project: { bundleProject: otherProject }, workflow_project: { workflowProject: otherProject }, generation_project: { generationProject: otherProject }, task_project: { taskProject: otherProject } }[kind];
    const graph = await seedGraph(client, 'tool', { nullWorkflow: true, ...options });
    return { source: await createSource(client, 'tool_call', graph) };
  }));
});

scenario('D：父行及四类支撑修改/删除拒绝，多个消费方共享', async (t) => {
  for (const domain of domains) {
    const source = await committedSource(domain);
    const values = await commitEvidence(source);
    for (const table of ['evidence_reference', supportTable[domain]]) for (const operation of ['UPDATE', 'DELETE']) {
      await sub(t, `${domain}/${table}/${operation}`, async () => {
        const result = await transaction(async (client) => {
          const column = table === 'evidence_reference' ? 'locator' : domain === 'tool' ? 'source_ref' : 'source_object_id';
          const sql = operation === 'DELETE' ? `DELETE FROM ${q(table)} WHERE evidence_reference_id=$1`
            : `UPDATE ${q(table)} SET ${column}='actual_change' WHERE evidence_reference_id=$1`;
          return expectSql(() => client.query(sql, [values.evidence_reference_id]), operation, '23514', 'evidence_source_immutable');
        });
        await assertStored(values, source);
        return result;
      });
    }
    await sub(t, `${domain}/多消费方共享`, async () => {
      await transaction(async (client) => {
        for (const kind of ['validation', 'context', 'fact']) await insert(client, 'evidence_consumer_reference', { consumer_reference_id: id('consumer'), evidence_reference_id: values.evidence_reference_id, consumer_kind: kind });
        await client.query('COMMIT');
      });
      await observe(async (client) => {
        assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${q('evidence_consumer_reference')} WHERE evidence_reference_id=$1`, [values.evidence_reference_id])).rows[0].count, 3);
        assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${q('evidence_reference')} WHERE source_domain=$1 AND source_version_id=$2 AND source_object_type=$3 AND source_object_id=$4 AND locator=$5 AND evidence_kind=$6`, [domain, source.versionId, source.type, source.objectId, values.locator, values.evidence_kind])).rows[0].count, 1);
      });
      await assertStored(values, source);
      return '3 个消费方共用同一 Evidence；完整身份父行数=1、四表总支撑=1';
    });
  }
});

async function sourceProtectionInventory(client) {
  const inventory = [];
  for (const domain of domains) {
    const graph = await seedGraph(client, domain);
    const alternate = await seedGraph(client, domain, { projectId: graph.projectId });
    const otherProject = id('other_project');
    await project(client, otherProject);
    const replacements = {
      project_id: otherProject, revision_id: alternate.revisionId, candidate_version_id: alternate.candidateId,
      workflow_run_id: alternate.workflowId, scene_task_version_id: alternate.taskId,
      canon_commit_id: alternate.commitId, generation_run_id: alternate.generationId,
      context_bundle_id: alternate.bundleId, source_version_id: alternate.candidateId,
    };
    const selectedTypes = domain === 'author_design' ? designTypes : domain === 'candidate' ? candidateTypes : domain === 'canon' ? canonTypes : ['tool_call'];
    for (const type of selectedTypes) {
      const source = await createSource(client, type, graph);
      const fields = ['project_id', pk(type)];
      if (domain === 'author_design' && type !== 'author_design_revision') fields.push('revision_id');
      if (domain === 'candidate' && type === 'candidate_version') fields.push('workflow_run_id');
      else if (domain === 'candidate') fields.push(type === 'narrative_assertion' ? 'source_domain' : 'candidate_version_id');
      if (domain === 'canon' && type !== 'canon_commit') fields.push('canon_commit_id');
      if (domain === 'tool') fields.push('generation_run_id', 'tool_name', 'request_ref', 'response_ref');
      inventory.push({ table: type, key: pk(type), value: source.objectId, fields, replacements });
      await pair(client, source);
      if (type === 'narrative_assertion') inventory.push({ table: 'narrative_assertion_candidate_source', key: 'assertion_id', value: source.objectId, fields: ['candidate_version_id', 'source_version_id'], replacements, immutable: true });
    }
    if (domain === 'candidate' || domain === 'tool') {
      inventory.push({ table: 'scene_task_version', key: 'scene_task_version_id', value: graph.taskId, fields: ['project_id', 'scene_task_version_id'], replacements });
      inventory.push({ table: 'workflow_run', key: 'workflow_run_id', value: graph.workflowId, fields: ['project_id', 'workflow_run_id', 'scene_task_version_id'], replacements });
    }
    if (domain === 'tool') {
      inventory.push({ table: 'context_bundle', key: 'context_bundle_id', value: graph.bundleId, fields: ['context_bundle_id', 'project_id', 'scene_task_version_id', 'workflow_run_id'], replacements });
      inventory.push({ table: 'generation_run', key: 'generation_run_id', value: graph.generationId, fields: ['generation_run_id', 'project_id', 'workflow_run_id', 'context_bundle_id'], replacements });
    }
  }
  await client.query('COMMIT');
  return inventory;
}

scenario('D：全部来源身份/归属保护字段实际改绑与无变化 UPDATE', async (t) => {
  const inventory = await transaction(sourceProtectionInventory);
  for (const row of inventory) {
    for (const field of row.fields) await sub(t, `${row.table}/${row.value}/${field} 实际变化`, async () => transaction(async (client) => {
      const replacement = field === row.key ? id('new_identity') : field === 'source_domain' ? 'canon' : row.replacements[field] ?? id('rebind');
      const assignment = row.immutable ? 'candidate_version_id=$1, source_version_id=$1' : `${field}=$1`;
      return expectSql(() => client.query(`UPDATE ${q(row.table)} SET ${assignment} WHERE ${row.key}=$2`, [replacement, row.value]), 'UPDATE', '23514', row.immutable ? 'evidence_source_immutable' : 'evidence_source_complete');
    }));
    await sub(t, `${row.table}/${row.value}/无变化 UPDATE`, async () => transaction(async (client) => {
      const result = await client.query(`UPDATE ${q(row.table)} SET ${row.fields.map((field) => `${field}=${field}`).join(', ')} WHERE ${row.key}=$1`, [row.value]);
      assert.equal(result.rowCount, 1);
      await client.query('COMMIT');
      return '全部来源保护字段保持原值；UPDATE 与 COMMIT 成功';
    }));
  }
  const assertion = inventory.find((row) => row.immutable);
  await sub(t, 'Assertion 来源支撑删除', async () => transaction(async (client) => expectSql(() => client.query(`DELETE FROM ${q(assertion.table)} WHERE assertion_id=$1`, [assertion.value]), 'DELETE', '23514', 'evidence_source_immutable')));
});

scenario('D：来源删除 FK、Commit 终态和 Tool 响应首次写入', async (t) => {
  for (const domain of domains) await sub(t, `${domain}/被引用实际目标删除`, async () => {
    const source = await committedSource(domain);
    const values = await commitEvidence(source);
    const result = await transaction(async (client) => expectSql(() => client.query(`DELETE FROM ${q(source.type)} WHERE ${pk(source.type)}=$1`, [source.objectId]), 'DELETE', '23503', null));
    await assertStored(values, source);
    return result;
  });
  for (const status of ['committed', 'failed']) await sub(t, `${status}/终态不可变`, async () => {
    const graph = await transaction(async (client) => {
      const graph = await seedGraph(client, 'canon', { status });
      await client.query('COMMIT');
      return graph;
    });
    return transaction(async (client) => expectSql(() => client.query(`UPDATE ${q('canon_commit')} SET status='preparing' WHERE canon_commit_id=$1`, [graph.commitId]), 'UPDATE', '23514', 'evidence_canon_commit_terminal'));
  });
  await sub(t, 'Tool response_ref 从 NULL 首次写入', async () => {
    let source;
    await transaction(async (client) => {
      source = await createSource(client, 'tool_call', await seedGraph(client, 'tool'), { emptyResponse: true });
      await client.query('COMMIT');
    });
    await transaction(async (client) => {
      await client.query(`UPDATE ${q('tool_call')} SET response_ref='fixture://first-response' WHERE tool_call_id=$1`, [source.objectId]);
      await client.query('COMMIT');
    });
    return observe(async (client) => {
      assert.equal((await client.query(`SELECT response_ref FROM ${q('tool_call')} WHERE tool_call_id=$1`, [source.objectId])).rows[0].response_ref, 'fixture://first-response');
      return '保留 Tool 来源原型的首次响应写入边界；已有非空响应覆盖另有负例';
    });
  });
});

async function waitForBlocked(observer, waitingPid, blockerPid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const row = (await observer.query(`SELECT pid, state, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
      FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waitingPid])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.map(Number).includes(Number(blockerPid))) return row;
    // Polling interval only; the assertion requires an observed blocker PID.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`PID ${waitingPid} was not observed blocked by ${blockerPid}`);
}

const backendPid = async (client) => (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

scenario('E：四域重复身份 A 提交/回滚的真实阻塞证据', async (t) => {
  for (const domain of domains) for (const action of ['COMMIT', 'ROLLBACK']) await sub(t, `${domain}/A ${action}`, async () => {
    const source = await committedSource(domain);
    const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
    let first;
    let second;
    let evidence;
    let aPid;
    let bPid;
    let blocked;
    try {
      await begin(a); await begin(b);
      [aPid, bPid] = await Promise.all([backendPid(a), backendPid(b)]);
      first = await pair(a, source);
      second = parent(source);
      const bInsert = insert(b, 'evidence_reference', second);
      bInsert.catch(() => {}); // Retain the rejection for expectSql after observing the wait.
      blocked = await waitForBlocked(observer, bPid, aPid);
      await a.query(action);
      if (action === 'COMMIT') {
        evidence = await expectSql(() => bInsert, 'B parent INSERT after lock wait', '23505', 'uq_evidence_reference_full_identity');
        await b.query('ROLLBACK');
      } else {
        await bInsert;
        await support(b, second.evidence_reference_id, source);
        await b.query('COMMIT');
        evidence = { stage: 'B COMMIT', evidence: 'A 回滚后 B 完成来源支撑并首次提交成功' };
      }
    } finally {
      await close(a); await close(b); await observer.end();
    }
    await assertStored(first, source, action === 'COMMIT');
    await assertStored(second, source, action === 'ROLLBACK');
    return { ...evidence, evidence: `${evidence.evidence}；A PID=${aPid}, B PID=${bPid}; pg_stat_activity=${JSON.stringify(blocked)}；独立连接确认仅获胜者完整父子关系持久化` };
  });
});

scenario('E：四域共享合法容器、不同实际对象首次异步 COMMIT', async (t) => {
  for (const domain of domains) await sub(t, domain, async () => {
    const firstSource = await committedSource(domain);
    const secondSource = await transaction(async (client) => {
      const source = await createSource(client, firstSource.type, firstSource.graph);
      await client.query('COMMIT');
      return source;
    });
    const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
    let valuesA;
    let valuesB;
    let pids;
    let activity;
    let statuses;
    try {
      await begin(a); await begin(b);
      pids = await Promise.all([backendPid(a), backendPid(b)]);
      valuesA = await pair(a, firstSource);
      valuesB = await pair(b, secondSource);
      assert.equal(valuesA.source_version_id, valuesB.source_version_id);
      assert.equal(valuesA.locator, valuesB.locator);
      assert.notEqual(valuesA.source_object_id, valuesB.source_object_id);
      activity = (await observer.query(`SELECT pid, state, pg_blocking_pids(pid) AS blockers FROM pg_catalog.pg_stat_activity WHERE pid=ANY($1::int[]) ORDER BY pid`, [pids])).rows;
      assert.equal(activity.length, 2);
      assert.deepEqual(activity.flatMap((row) => row.blockers), []);
      const results = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
      statuses = results.map((result) => result.status);
      for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.message);
    } finally {
      await close(a); await close(b); await observer.end();
    }
    await assertStored(valuesA, firstSource);
    await assertStored(valuesB, secondSource);
    return { stage: 'first asynchronous COMMIT', evidence: `共享容器=${firstSource.containerId}; PID=${pids}; 首次结果=${statuses}; 无重试；观察=${JSON.stringify(activity)}；独立连接回读两套完整父子关系` };
  });
});

scenario('E：既有合法 Evidence 被两个事务追加其他域错误支撑', async (t) => {
  for (const domain of domains) await sub(t, domain, async () => {
    const originalSource = await committedSource(domain);
    const original = await commitEvidence(originalSource);
    const otherDomains = domains.filter((other) => other !== domain).slice(0, 2);
    const extras = [];
    for (const extra of otherDomains) extras.push(await committedSource(extra, { projectId: originalSource.projectId }));
    const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
    let pids;
    let failures;
    try {
      await begin(a); await begin(b);
      pids = await Promise.all([backendPid(a), backendPid(b)]);
      await support(a, original.evidence_reference_id, extras[0]);
      await support(b, original.evidence_reference_id, extras[1]);
      const visible = (await observer.query(`SELECT count(*)::int AS count FROM ${q('evidence_reference')} WHERE evidence_reference_id=$1`, [original.evidence_reference_id])).rows[0];
      assert.equal(visible.count, 1);
      const results = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
      failures = results.map((result) => {
        assert.equal(result.status, 'rejected', 'neither appending transaction may commit');
        assert.equal(result.reason.code, '23514');
        assert.equal(result.reason.constraint, 'evidence_source_complete');
        assert.match(result.reason.message, /support_count=2/);
        return { code: result.reason.code, constraint: result.reason.constraint, message: result.reason.message };
      });
    } finally {
      await close(a); await close(b); await observer.end();
    }
    await assertStored(original, originalSource);
    return { stage: 'both asynchronous COMMIT', code: failures[0].code, constraint: failures[0].constraint, evidence: `PID=${pids}; 两次支撑 INSERT 均成功；首次 COMMIT 均拒绝=${JSON.stringify(failures)}；原父行/原支撑保留，四表总计=1` };
  });
});

scenario('E：新建 public 路径直连的完整性与不可变保护', async (t) => {
  for (const domain of domains) await sub(t, `${domain}/public 合法提交`, async () => {
    let source;
    const values = await transaction(async (client) => {
      const graph = await seedGraph(client, domain);
      source = await createSource(client, defaultType[domain], graph);
      const values = await pair(client, source);
      await client.query('COMMIT');
      return values;
    });
    await assertStored(values, source);
    return '全新 pg.Client，search_path=public，所有业务表使用全限定名；独立连接回读完整映射';
  });
  // All earlier transactions also use fresh direct clients and public; repeat these
  // explicit cases here so the call-path regression is discoverable in the report.
  await sub(t, 'public 缺支撑 COMMIT', async () => {
    let values;
    const result = await transaction(async (client) => {
      const source = await createSource(client, 'world_rule', await seedGraph(client, 'author_design'));
      values = parent(source);
      await insert(client, 'evidence_reference', values);
      return expectSql(() => client.query('COMMIT'), 'COMMIT', '23514', 'evidence_source_complete', /support_count=0/);
    });
    await assertStored(values, null, false);
    return result;
  });
  await sub(t, 'public 多支撑 COMMIT', async () => {
    let values;
    const result = await transaction(async (client) => {
      const source = await createSource(client, 'world_rule', await seedGraph(client, 'author_design'));
      values = await pair(client, source);
      const extra = await createSource(client, 'tool_call', await seedGraph(client, 'tool', { projectId: source.projectId }));
      await support(client, values.evidence_reference_id, extra);
      return expectSql(() => client.query('COMMIT'), 'COMMIT', '23514', 'evidence_source_complete', /support_count=2/);
    });
    await assertStored(values, null, false);
    return result;
  });
  await sub(t, 'public 不可变 UPDATE', async () => {
    const source = await committedSource('tool');
    const values = await commitEvidence(source);
    const result = await transaction(async (client) => expectSql(() => client.query(`UPDATE ${q('evidence_reference')} SET locator='changed' WHERE evidence_reference_id=$1`, [values.evidence_reference_id]), 'UPDATE', '23514', 'evidence_source_immutable'));
    await assertStored(values, source);
    return result;
  });
});

scenario('E：实际保存的函数路径、触发器、唯一身份及 Schema 边界', async (t) => {
  await sub(t, '全部数据库函数固定路径，无 SECURITY DEFINER', async () => observe(async (client) => {
    const functions = (await client.query(`SELECT p.proname, p.proconfig, p.prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname`, [SCHEMA])).rows;
    assert.equal(functions.length, 9);
    for (const fn of functions) {
      assert.deepEqual(fn.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);
      assert.equal(fn.prosecdef, false);
    }
    return `实际 pg_proc 核验=${JSON.stringify(functions)}`;
  }));
  await sub(t, '共同父表及四支撑表全部写路径默认延后', async () => observe(async (client) => {
    const triggers = (await client.query(`SELECT c.relname, t.tgname, t.tgtype, t.tgdeferrable, t.tginitdeferred FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND t.tgname LIKE '%_complete' ORDER BY c.relname`, [SCHEMA])).rows;
    assert.equal(triggers.length, 5);
    assert.deepEqual(triggers.map((row) => row.relname).sort(), ['evidence_reference', ...Object.values(supportTable)].sort());
    for (const trigger of triggers) {
      assert.equal(trigger.tgdeferrable, true);
      assert.equal(trigger.tginitdeferred, true);
      assert.equal(trigger.tgtype, 29, 'AFTER INSERT/UPDATE/DELETE FOR EACH ROW');
    }
    return `实际 pg_trigger 核验=${JSON.stringify(triggers)}`;
  }));
  await sub(t, '六字段唯一身份且旧四字段索引非唯一', async () => observe(async (client) => {
    const constraints = (await client.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='u'`, [q('evidence_reference')])).rows;
    assert.deepEqual(constraints, [{ conname: 'uq_evidence_reference_full_identity', definition: 'UNIQUE (source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind)' }]);
    const index = (await client.query(`SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_catalog.pg_index i WHERE i.indexrelid=$1::regclass`, [q('idx_evidence_reference_legacy_lookup')])).rows[0];
    assert.equal(index.indisunique, false);
    assert.match(index.definition, /\(source_domain, source_version_id, locator, evidence_kind\)/);
    return `${JSON.stringify(constraints)}；${JSON.stringify(index)}`;
  }));
  await sub(t, '所有业务 FK 均指向本 Schema，单一 Evidence 父表，Bundle Workflow 可空', async () => observe(async (client) => {
    const fks = (await client.query(`SELECT c.conname, rn.nspname AS target_schema FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class l ON l.oid=c.conrelid JOIN pg_catalog.pg_namespace ln ON ln.oid=l.relnamespace JOIN pg_catalog.pg_class r ON r.oid=c.confrelid JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace WHERE c.contype='f' AND ln.nspname=$1`, [SCHEMA])).rows;
    assert.ok(fks.length > 20);
    for (const fk of fks) assert.equal(fk.target_schema, SCHEMA);
    const namespaces = (await client.query(`SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname LIKE 'evidence_%constraint_fixture'`)).rows;
    assert.deepEqual(namespaces, [{ nspname: SCHEMA }]);
    assert.equal((await client.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='context_bundle' AND column_name='workflow_run_id'`, [SCHEMA])).rows[0].is_nullable, 'YES');
    return `${fks.length} 个业务 FK 全在本 Schema；空库无旧原型 Schema；Bundle Workflow 列可空`;
  }));
});


scenario('D：TRUNCATE 不能绕过父行与四类支撑的追加不可变保护', async (t) => {
  for (const table of ['evidence_reference', ...Object.values(supportTable)]) await sub(t, table, async () => {
    const domain = domains.find((domain) => supportTable[domain] === table) ?? 'tool';
    const source = await committedSource(domain);
    const values = await commitEvidence(source);
    const result = await transaction(async (client) => expectSql(
      () => client.query(`TRUNCATE ${q(table)} CASCADE`), 'TRUNCATE', '23514', 'evidence_source_immutable',
    ));
    await assertStored(values, source);
    return { ...result, evidence: '语句级 BEFORE TRUNCATE 保护生效；独立连接确认原父行和四表恰一支撑完整保留' };
  });
});
