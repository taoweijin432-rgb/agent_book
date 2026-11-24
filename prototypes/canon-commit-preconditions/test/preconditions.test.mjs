import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'canon_commit_precondition_fixture';
const DATABASE_URL = process.env.DATABASE_URL;
assert.ok(DATABASE_URL, 'DATABASE_URL is required');
pg.types.setTypeParser(1184, (value) => value); // Preserve database microseconds in comparisons and evidence.
const q = (name) => `${SCHEMA}.${name}`;
const outcomes = [];
const subscenarios = [];
const parameterizedSubscenarios = {};
let sequence = 0;
const id = (label = 'id') => `${label}_${++sequence}`;

async function connect() {
  const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  await c.connect();
  await c.query('SET search_path TO public');
  await c.query("SET statement_timeout='8s'");
  await c.query("SET lock_timeout='6s'");
  assert.equal((await c.query('SHOW search_path')).rows[0].search_path, 'public');
  return c;
}
async function begin(c) {
  await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal((await c.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'read committed');
}
async function close(c) { try { await c.query('ROLLBACK'); } finally { await c.end(); } }
async function tx(fn) {
  const c = await connect();
  try { await begin(c); return await fn(c); } finally { await close(c); }
}
async function observe(fn) {
  const c = await connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function insert(c, table, row) {
  const columns = Object.keys(row);
  return c.query(`INSERT INTO ${q(table)} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(row));
}
async function call(c, name, ...args) {
  return (await c.query(`SELECT to_jsonb(${q(name)}(${args.map((_, i) => `$${i + 1}`).join(',')})) AS response`, args)).rows[0].response;
}
async function invoke(name, ...args) {
  return tx(async (c) => { const response = await call(c, name, ...args); await c.query('COMMIT'); return response; });
}
const pid = async (c) => (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
async function blocked(observer, waiter, blocker) {
  const limit = Date.now() + 4500;
  while (Date.now() < limit) {
    const row = (await observer.query(`SELECT pid, state, query_start, xact_start, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers,
      clock_timestamp() AS observed_at FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waiter])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.map(Number).includes(Number(blocker))) return row;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`PID ${waiter} was not observed blocked by ${blocker}`);
}
async function expectSql(action, stage, code, constraint) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, `${stage} must reject`);
  assert.equal(error.code, code, error.message);
  if (constraint !== undefined) assert.equal(error.constraint, constraint);
  return { stage, code: error.code, constraint: error.constraint ?? '', evidence: error.message };
}
function scenario(name, fn) {
  test(name, { timeout: 120_000 }, async (t) => {
    try { const evidence = await fn(t); outcomes.push({ name, status: 'passed', evidence: evidence ?? '详见实测子场景' }); }
    catch (error) { outcomes.push({ name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint }); throw error; }
  });
}
async function sub(t, name, fn) {
  let failure;
  await t.test(name, { timeout: 20_000 }, async () => {
    try { const evidence = await fn(); subscenarios.push({ group: t.name, name, status: 'passed', ...(typeof evidence === 'string' ? { evidence } : evidence) }); }
    catch (error) { subscenarios.push({ group: t.name, name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint }); failure = error; throw error; }
    finally { parameterizedSubscenarios[t.name] = (parameterizedSubscenarios[t.name] ?? 0) + 1; }
  });
  if (failure) throw failure;
}
after(async () => {
  await writeFile(process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json', JSON.stringify({ schema: SCHEMA, isolation: 'read committed', outcomes, subscenarios, parameterizedSubscenarios }, null, 2));
});
const hash = (c, value) => call(c, 'digest_text', value);
async function environment(options = {}) {
  return tx(async (c) => {
    const x = { project: id('novel'), design: id('design'), rule: id('rule'), policy: id('policy'), task: id('task'), workflow: id('workflow'), bundle: id('bundle'), generation: id('generation'), candidate: id('candidate'), validation: id('validation'), canon: options.canon ?? 0 };
    await insert(c, 'novel', { project_id: x.project });
    await insert(c, 'rule_version', { version_id: x.rule, content: { rule: 'fixture-no-hard-conflicts-v1' } });
    await insert(c, 'approval_policy_version', { version_id: x.policy, content: { manual: true, auto: false, override: false } });
    await insert(c, 'author_design_revision', { revision_id: x.design, project_id: x.project, status: options.designState ?? 'frozen', content: { intent: 'fixture-design' } });
    await call(c, 'change_baseline', x.project, 0, x.design, x.canon, x.rule, x.policy);
    await insert(c, 'scene_task_version', { task_version_id: x.task, project_id: x.project, revision_id: x.design, input_canon_watermark: x.canon, content: { pov: 'fixture', goal: 'scene' } });
    await insert(c, 'context_bundle', { bundle_id: x.bundle, task_version_id: x.task, content: 'ordered context; sources: design + Canon boundary', content_hash: await hash(c, 'ordered context; sources: design + Canon boundary') });
    await insert(c, 'workflow_identity', { workflow_id: x.workflow, task_version_id: x.task });
    await insert(c, 'generation_run', { generation_id: x.generation, workflow_id: x.workflow, bundle_id: x.bundle, input_bundle_hash: await hash(c, 'ordered context; sources: design + Canon boundary') });
    await createCandidate(c, x, x.candidate);
    await createValidation(c, x, x.validation, x.candidate, options.result ?? 'pass');
    if (options.hardIssue) await insert(c, 'validation_hard_issue', { issue_id: id('issue'), validation_run_id: x.validation, rule_code: 'hard-fixture', resolved: false });
    await call(c, 'select_candidate', x.workflow, x.candidate, 0);
    x.version = 1;
    x.binding = await binding(c, x);
    await c.query('COMMIT'); return x;
  });
}
async function createCandidate(c, x, candidate, options = {}) {
  const body = options.body ?? '候选正文：角色进入庭院。';
  return insert(c, 'candidate_version', { candidate_version_id: candidate, workflow_id: x.workflow, bundle_id: x.bundle,
    generation_id: x.generation, predecessor_id: null, origin: 'model', bundle_basis: 'direct', edit_basis: null,
    body, content_hash: await hash(c, body), ...options });
}
async function createValidation(c, x, validation, candidate, result = 'pass', options = {}) {
  return insert(c, 'validation_run', { validation_run_id: validation, candidate_version_id: candidate, request_key: id('validation_request'),
    author_design_revision_id: x.design, input_canon_watermark: x.canon, rule_set_version: x.rule, validator_version: 'fixture-validator-v1',
    input_hash: await call(c, 'validation_input_hash', candidate, x.design, x.canon, x.rule), result, ...options });
}
async function binding(c, x) {
  return { candidate_version_id: x.candidate, candidate_content_hash: (await c.query(`SELECT content_hash FROM ${q('candidate_version')} WHERE candidate_version_id=$1`, [x.candidate])).rows[0].content_hash,
    context_bundle_id: x.bundle, author_design_revision_id: x.design, input_canon_watermark: x.canon, validation_run_id: x.validation, approval_policy_version: x.policy };
}
const approveOn = (c, x, key = 'approve-1', decision = 'approved', bind = x.binding) => call(c, 'record_approval', x.candidate, key, bind, decision, 'fixture-author', 'manual review');
async function approve(x, key = 'approve-1', decision = 'approved', bind = x.binding) {
  const result = await invoke('record_approval', x.candidate, key, bind, decision, 'fixture-author', 'manual review');
  if (decision === 'approved') x.approval = result.approval.approval_id;
  return result;
}
const admissionOn = (c, x, options = {}) => call(c, 'check_admission', options.project ?? x.project, options.workflow ?? x.workflow, options.candidate ?? x.candidate, options.approval ?? x.approval ?? 'missing-approval', options.version ?? x.version);
const admission = (x, options = {}) => tx(async (c) => { const r = await admissionOn(c, x, options); await c.query('COMMIT'); return r; });
async function assertAdmission(x, accepted, reasons = [], options = {}) {
  const r = await admission(x, options); assert.equal(r.accepted, accepted, JSON.stringify(r));
  for (const reason of reasons) assert.ok(r.reasons.includes(reason), JSON.stringify(r));
  assert.equal(r.scope, 'transaction_check_only');
  return { stage: 'admission', evidence: JSON.stringify(r) };
}
const select = (x, candidate, version = x.version) => invoke('select_candidate', x.workflow, candidate, version);
async function sibling(x, options = {}) {
  return tx(async (c) => {
    const next = { ...x, candidate: id('candidate'), validation: id('validation') };
    await createCandidate(c, x, next.candidate, options);
    await createValidation(c, next, next.validation, next.candidate);
    next.binding = await binding(c, next); delete next.approval;
    await c.query('COMMIT'); return next;
  });
}
const invalidate = (x, reason = 'manual_input_change', version = 'change-v1') => invoke('invalidate_approval', x.approval, reason, 'fixture_manual', version);
const baseline = (x, options = {}) => invoke('change_baseline', x.project, options.version ?? 1, options.design ?? x.design, options.canon ?? x.canon, options.rule ?? x.rule, options.policy ?? x.policy);
async function counts(x) {
  return observe(async (c) => {
    const result = await c.query(`SELECT (SELECT row_to_json(w) FROM ${q('workflow_run')} w WHERE workflow_id=$1) AS workflow,
      (SELECT count(*)::int FROM ${q('candidate_selection_history')} WHERE workflow_id=$1) AS history,
      (SELECT count(*)::int FROM ${q('approval_record')} WHERE candidate_version_id IN (SELECT candidate_version_id FROM ${q('candidate_version')} WHERE workflow_id=$1)) AS approvals,
      (SELECT count(*)::int FROM ${q('approval_invalidation_record')} WHERE approval_id IN (SELECT approval_id FROM ${q('approval_record')} WHERE candidate_version_id IN (SELECT candidate_version_id FROM ${q('candidate_version')} WHERE workflow_id=$1))) AS invalidations,
      (SELECT count(*)::int FROM ${q('operation_audit')} WHERE project_id=$2) AS audits`, [x.workflow, x.project]);
    return result.rows[0];
  });
}
async function race(x, first, second, release = 'COMMIT') {
  const a = await connect(); const b = await connect(); const observer = await connect();
  try {
    await begin(a); await begin(b);
    const firstResult = await first(a);
    const pids = { blocker: await pid(a), waiter: await pid(b), observer: await pid(observer) };
    const pending = second(b).then((value) => ({ value }), (error) => ({ error }));
    const blockedState = await blocked(observer, pids.waiter, pids.blocker);
    await a.query(release);
    const next = await pending;
    if (next.error) await b.query('ROLLBACK'); else await b.query('COMMIT');
    return { firstResult, ...next, stage: 'concurrency', evidence: JSON.stringify({ release, ...pids, blockedState }) };
  } finally { await close(a); await close(b); await observer.end(); }
}

scenario('A 合法路径与实际数据库结构', async (t) => {
  for (const canon of [0, 7, 112]) await sub(t, `完整路径 Canon=${canon}`, async () => {
    const x = await environment({ canon }); await approve(x);
    const r = await admission(x); assert.equal(r.accepted, true); assert.equal(Number(r.actual.input_canon_watermark), canon);
    assert.equal(r.actual.baseline.rule_version, x.rule); assert.deepEqual(r.reasons, []);
    return JSON.stringify(r);
  });
  await sub(t, '同 Workflow 多候选只接受当前最终身份', async () => {
    const x = await environment(); await approve(x); const y = await sibling(x);
    await assertAdmission(y, false, ['not_current_candidate', 'approval_missing']);
    return assertAdmission(x, true);
  });
  await sub(t, '两个项目独立合法', async () => {
    const a = await environment(); const b = await environment({ canon: 9 });
    await approve(a); await approve(b); await assertAdmission(a, true); return assertAdmission(b, true);
  });
  await sub(t, '实际函数路径、约束、触发器与只读当前指针', async () => observe(async (c) => {
    const f = (await c.query(`SELECT p.proname,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY p.proname`, [SCHEMA])).rows;
    assert.ok(f.length >= 20);
    for (const row of f) { assert.equal(row.prosecdef, false); assert.deepEqual(row.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]); }
    const constraints = (await c.query(`SELECT conname,contype,pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname`, [SCHEMA])).rows;
    assert.ok(constraints.some((r) => r.conname === 'approval_record_candidate_version_id_request_key_key'));
    assert.ok(constraints.some((r) => r.contype === 'u' && r.definition === 'UNIQUE (approval_id, reason_code, trigger_version)'));
    const triggers = (await c.query(`SELECT c.relname,t.tgname,t.tgenabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`, [SCHEMA])).rows;
    assert.ok(triggers.length >= 40); assert.ok(triggers.every((r) => r.tgenabled === 'O'));
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='approval_record' AND column_name IN ('workflow_run_id','workflow_id','status','selection_version')`, [SCHEMA])).rows[0].n, 0);
    return JSON.stringify({ functions: f, constraints, triggers });
  }));
});

scenario('B 归属、输入摘要与选择独立负例', async (t) => {
  for (const [label, reason, options] of [
    ['跨项目调用','project_mismatch', (x,y) => ({ project: y.project })],
    ['跨 Workflow 调用','workflow_mismatch', (x,y) => ({ workflow: y.workflow })],
    ['过旧选择版本','selection_version_conflict', () => ({ version: 0 })],
    ['缺少审批','approval_missing', () => ({ approval: 'no-such-approval' })],
  ]) await sub(t, label, async () => { const x = await environment(); const y = await environment(); await approve(x); return assertAdmission(x, false, [reason], options(x,y)); });
  const cases = [
    ['跨项目 Task Design', 'scene_task_version', 'task_design_project', async (c,x,y) => ({ task_version_id:id(),project_id:x.project,revision_id:y.design,input_canon_watermark:0,content:{} })],
    ['Generation Bundle 不同 Task Version', 'generation_run', 'bundle_task_chain', async (c,x,y) => ({generation_id:id(),workflow_id:x.workflow,bundle_id:y.bundle,input_bundle_hash:y.binding.candidate_content_hash})],
    ['Candidate Bundle 不同 Task Version', 'candidate_version', 'bundle_task_chain', async (c,x,y) => ({candidate_version_id:id(),workflow_id:x.workflow,bundle_id:y.bundle,generation_id:x.generation,origin:'model',bundle_basis:'direct',body:'text',content_hash:await hash(c,'text')})],
    ['Candidate Generation 跨 Workflow', 'candidate_version', 'candidate_generation_chain', async (c,x,y) => ({candidate_version_id:id(),workflow_id:x.workflow,bundle_id:x.bundle,generation_id:y.generation,origin:'model',bundle_basis:'direct',body:'text',content_hash:await hash(c,'text')})],
    ['Generation 实际 Bundle 摘要', 'generation_run', 'generation_bundle_hash', async (c,x) => ({generation_id:id(),workflow_id:x.workflow,bundle_id:x.bundle,input_bundle_hash:'wrong'})],
    ['正文实际摘要', 'candidate_version', 'candidate_actual_hash', async (c,x) => ({candidate_version_id:id(),workflow_id:x.workflow,bundle_id:x.bundle,generation_id:x.generation,origin:'model',bundle_basis:'direct',body:'text',content_hash:'wrong'})],
    ['Bundle 实际摘要', 'context_bundle', 'bundle_actual_hash', async (c,x) => ({bundle_id:id(),task_version_id:x.task,content:'changed context',content_hash:'wrong'})],
  ];
  for (const [label, table, reason, row] of cases) await sub(t, label, async () => {
    const x = await environment(); const y = await environment();
    return expectSql(() => tx(async (c) => insert(c, table, await row(c,x,y))), 'insert:'+table, 'P0001', reason);
  });
  await sub(t, '同项目不同 Task Version 隔离', async () => {
    const x = await environment();
    return expectSql(() => tx(async (c) => {
      const task = id(); const bundle = id();
      await insert(c,'scene_task_version',{task_version_id:task,project_id:x.project,revision_id:x.design,input_canon_watermark:0,content:{}});
      await insert(c,'context_bundle',{bundle_id:bundle,task_version_id:task,content:'different task',content_hash:await hash(c,'different task')});
      await insert(c,'generation_run',{generation_id:id(),workflow_id:x.workflow,bundle_id:bundle,input_bundle_hash:await hash(c,'different task')});
    }), 'insert:generation_run', 'P0001','bundle_task_chain');
  });
  await sub(t, '非当前 Candidate 不可批准', async () => { const x=await environment(); const y=await sibling(x); return expectSql(()=>approve(y),'approval','P0001','approval_not_current'); });
  await sub(t, '伪造 selection 前序与版本分开阻断', async () => {
    const x=await environment();const y=await sibling(x);
    const r=await expectSql(()=>tx(c=>insert(c,'candidate_selection_history',{workflow_id:x.workflow,selection_version:2,previous_candidate_id:null,candidate_version_id:y.candidate})),'insert:selection','P0001','selection_previous_mismatch');
    await expectSql(()=>tx(c=>insert(c,'candidate_selection_history',{workflow_id:x.workflow,selection_version:99,previous_candidate_id:x.candidate,candidate_version_id:y.candidate})),'insert:selection','P0001','selection_version_conflict'); return r;
  });
});

scenario('B 审批七项绑定、决定和 Validation 独立负例', async (t) => {
  const bindingCases = [
    ['candidate_version_id','approval_binding_shape',(x,y)=>y.candidate],
    ['candidate_content_hash','approval_content_hash',()=> 'different-body-hash'],
    ['context_bundle_id','approval_bundle',(x,y)=>y.bundle],
    ['author_design_revision_id','approval_design',(x,y)=>y.design],
    ['input_canon_watermark','approval_canon',()=> 1],
    ['validation_run_id','approval_validation',(x,y)=>y.validation],
    ['approval_policy_version','approval_policy',(x,y)=>y.policy],
  ];
  for (const [field, reason, value] of bindingCases) await sub(t, `审批错绑 ${field}`, async () => {
    const x=await environment(); const y=await environment();
    return expectSql(()=>approve(x,'request','approved',{...x.binding,[field]:value(x,y)}),'approval','P0001',reason);
  });
  for (const result of ['running','fail','inconclusive','invalidated']) await sub(t, `Validation=${result}`, async () => {
    const x=await environment({result});
    const rejected = await expectSql(()=>approve(x),'approval','P0001',`validation_${result}`);
    await assertAdmission(x,false,['approval_missing']);
    return rejected;
  });
  await sub(t, '未解决硬阻断不允许普通批准', async () => { const x=await environment({hardIssue:true}); return expectSql(()=>approve(x),'approval','P0001','unresolved_hard_issue'); });
  await sub(t, '审批后出现硬阻断，准入复核拒绝', async () => {
    const x=await environment();await approve(x);
    await tx(async c=>{await insert(c,'validation_hard_issue',{issue_id:id(),validation_run_id:x.validation,rule_code:'new-hard',resolved:false});await c.query('COMMIT');});
    return assertAdmission(x,false,['unresolved_hard_issue']);
  });
  await sub(t, '已解决硬问题允许通过', async () => {
    const x=await environment();await tx(async c=>{await insert(c,'validation_hard_issue',{issue_id:id(),validation_run_id:x.validation,rule_code:'resolved',resolved:true});await c.query('COMMIT');});await approve(x);return assertAdmission(x,true);
  });
  for (const [label, reason, options] of [
    ['校验快照 Design','validation_snapshot',(x,y)=>({author_design_revision_id:y.design})],
    ['校验快照 Canon','validation_snapshot',()=>({input_canon_watermark:1})],
    ['校验摘要只使用正文','validation_input_hash',(x)=>({input_hash:x.binding.candidate_content_hash})],
  ]) await sub(t,label,async()=>{
    const x=await environment();const y=await environment();return expectSql(()=>tx(c=>createValidation(c,x,id(),x.candidate,'pass',options(x,y))),'insert:validation','P0001',reason);
  });
  await sub(t,'拒绝决定存在但不可准入',async()=>{const x=await environment();const a=await approve(x,'reject','rejected');x.approval=a.approval.approval_id;return assertAdmission(x,false,['approval_rejected']);});
  for(const decision of ['auto_approved','force_override'])await sub(t,`禁用 ${decision}`,async()=>{const x=await environment();return expectSql(()=>approve(x,'disabled',decision),'insert:approval','23514','approval_record_decision_check');});
  await sub(t,'草案设计拒绝',async()=>{const x=await environment({designState:'draft'});return expectSql(()=>approve(x),'approval','P0001','design_not_frozen');});
  for(const change of ['design','canon','rule','policy'])await sub(t,`基线变化 ${change} 自动追加失效并独立复核实际值`,async()=>{
    const x=await environment();const y=await environment();await approve(x);
    let options={};
    if(change==='design'){
      const next=id('design');await tx(async c=>{await insert(c,'author_design_revision',{revision_id:next,project_id:x.project,status:'frozen',content:{new:true}});await c.query('COMMIT');});options={design:next};
    } else if(change==='canon')options={canon:1};else options={[change]:y[change]};
    await baseline(x,options);
    const reason={design:'design_baseline_changed',canon:'canon_baseline_changed',rule:'validation_rules_changed',policy:'approval_policy'}[change];
    const r=await assertAdmission(x,false,['approval_invalidated',reason]);
    assert.equal((await counts(x)).invalidations,1);return r;
  });
  for(const change of ['canon','rule','policy','design'])await sub(t,`没有旧审批/失效行时新审批仍核对 ${change}`,async()=>{
    const x=await environment();const y=await environment();let options={};
    if(change==='design'){const next=id();await tx(async c=>{await insert(c,'author_design_revision',{revision_id:next,project_id:x.project,status:'frozen',content:{}});await c.query('COMMIT');});options={design:next};}
    else options=change==='canon'?{canon:1}:{[change]:y[change]};
    await baseline(x,options);assert.equal((await counts(x)).invalidations,0);
    return expectSql(()=>approve(x),'approval','P0001',{canon:'canon_baseline_changed',rule:'validation_rules_changed',policy:'approval_policy',design:'design_baseline_changed'}[change]);
  });
});

scenario('C 编辑、ABA、幂等与直接 DML 保护', async (t) => {
  await sub(t,'人工编辑保留前序与修改依据，重新校验审批',async()=>{
    const x=await environment();await approve(x);
    const y=await sibling(x,{generation_id:null,predecessor_id:x.candidate,origin:'human_edit',bundle_basis:'inherited',edit_basis:'作者调整角色动作',body:'新正文：角色停在庭院门口。'});
    await select(x,y.candidate);y.version=2;
    await assertAdmission(y,false,['approval_candidate_identity'],{approval:x.approval});await approve(y);return assertAdmission(y,true);
  });
  await sub(t,'相同正文摘要也不共享身份审批',async()=>{
    const x=await environment();await approve(x);const y=await sibling(x);
    assert.equal(x.binding.candidate_content_hash,y.binding.candidate_content_hash);await select(x,y.candidate);y.version=2;
    return assertAdmission(y,false,['approval_candidate_identity','validation_binding'],{approval:x.approval});
  });
  await sub(t,'A→B→A 永久失效，新的 Approval 才通过',async()=>{
    const x=await environment();await approve(x);const old=x.approval;const y=await sibling(x);
    await select(x,y.candidate);await select(x,x.candidate,2);x.version=3;
    await assertAdmission(x,false,['approval_invalidated']);const r=await approve(x,'approve-after-ABA');assert.notEqual(x.approval,old);await assertAdmission(x,true);return JSON.stringify(r);
  });
  await sub(t,'取消选择原子失效，不能审批历史候选',async()=>{
    const x=await environment();await approve(x);await select(x,null);x.version=2;
    const r=await assertAdmission(x,false,['approval_invalidated','not_current_candidate']);await expectSql(()=>approve(x,'after-cancel'),'approval','P0001','approval_not_current');return r;
  });
  await sub(t,'审批同请求同全部输入返回原身份',async()=>{
    const x=await environment();const a=await approve(x);const b=await approve(x);assert.equal(a.approval.approval_id,b.approval.approval_id);assert.equal(b.result,'replayed');assert.equal((await counts(x)).approvals,1);return JSON.stringify(b);
  });
  for(const field of ['decision','binding','actor','reason'])await sub(t,`同审批键异 ${field} 显式冲突`,async()=>{
    const x=await environment();await approve(x);
    const args=[x.candidate,'approve-1',field==='binding'?{...x.binding,candidate_content_hash:'different'}:x.binding,field==='decision'?'rejected':'approved',field==='actor'?'another-actor':'fixture-author',field==='reason'?'another reason':'manual review'];
    return expectSql(()=>invoke('record_approval',...args),'approval-idempotency','P0001','approval_request_conflict');
  });
  await sub(t,'返回历史失效 Approval 不恢复有效性',async()=>{const x=await environment();const a=await approve(x);await invalidate(x);const r=await approve(x);assert.equal(r.result,'replayed');assert.equal(r.approval.approval_id,a.approval.approval_id);return assertAdmission(x,false,['approval_invalidated']);});
  await sub(t,'失效正式身份幂等，异 trigger_type 拒绝',async()=>{const x=await environment();await approve(x);const a=await invalidate(x);const b=await invalidate(x);assert.deepEqual(a.invalidation,b.invalidation);assert.equal((await counts(x)).invalidations,1);await expectSql(()=>invoke('invalidate_approval',x.approval,'manual_input_change','different','change-v1'),'invalidation','P0001','invalidation_identity_conflict');return JSON.stringify(b);});
  await sub(t,'相同选择显式 no_change 不追加历史审计',async()=>{const x=await environment();await approve(x);const before=await counts(x);const r=await select(x,x.candidate);assert.equal(r.result,'no_change');assert.deepEqual(await counts(x),before);await expectSql(()=>select(x,x.candidate,0),'selection','P0001','selection_version_conflict');return JSON.stringify(r);});
  const immutableTables=['novel','author_design_revision','scene_task_version','context_bundle','workflow_identity','generation_run','candidate_version','validation_run','validation_hard_issue','baseline_history','candidate_selection_history','approval_record','approval_invalidation_record','operation_audit','rule_version','approval_policy_version'];
  for(const table of immutableTables)await sub(t,`不可变 ${table} 更新/删除/清空`,async()=>{
    const x=await environment();await approve(x);await invalidate(x);
    await tx(async c=>{await insert(c,'validation_hard_issue',{issue_id:id(),validation_run_id:x.validation,rule_code:'resolved',resolved:true});await c.query('COMMIT');});
    const column={novel:'project_id',author_design_revision:'revision_id',scene_task_version:'task_version_id',context_bundle:'bundle_id',workflow_identity:'workflow_id',generation_run:'generation_id',candidate_version:'candidate_version_id',validation_run:'validation_run_id',validation_hard_issue:'issue_id',baseline_history:'revision_id',candidate_selection_history:'selection_version',approval_record:'decision',approval_invalidation_record:'reason_code',operation_audit:'event_kind',rule_version:'version_id',approval_policy_version:'version_id'}[table];
    const evidence=[];
    for(const statement of [`UPDATE ${q(table)} SET ${column}=${column}`,`DELETE FROM ${q(table)}`,`TRUNCATE ${q(table)} CASCADE`]) evidence.push(await expectSql(()=>tx(c=>c.query(statement)),statement.split(' ')[0],'P0001',`immutable_${table}`));
    return {stage:'direct DML',evidence:JSON.stringify(evidence)};
  });
  for(const [field,value] of [['current_candidate_id',"NULL"],['current_selection_version','999'],['state',"'approved'"]])await sub(t,`Workflow 不能伪造 ${field}`,async()=>{
    const x=await environment();return expectSql(()=>tx(c=>c.query(`UPDATE ${q('workflow_run')} SET ${field}=${value} WHERE workflow_id=$1`,[x.workflow])),'direct DML:view','P0001','readonly_workflow_run');
  });
  await sub(t,'当前基线不能直接改指针',async()=>{const x=await environment();return expectSql(()=>tx(c=>c.query(`UPDATE ${q('current_baseline')} SET canon_watermark=100 WHERE project_id=$1`,[x.project])),'direct DML:view','P0001','readonly_current_baseline');});
});

scenario('D 原子性与数据库可观察竞争',async(t)=>{
  for(const release of ['COMMIT','ROLLBACK'])await sub(t,`选择/历史/指针/失效原子 ${release}`,async()=>{
    const x=await environment();await approve(x);const y=await sibling(x);const before=await counts(x);let during;
    const r=await race(x,async c=>{const value=await call(c,'select_candidate',x.workflow,y.candidate,1);during=await counts(x);assert.deepEqual(during,before);return value;},c=>admissionOn(c,x),release);
    assert.equal(r.value.accepted,release==='ROLLBACK');const after=await counts(x);
    assert.equal(after.history,before.history+(release==='COMMIT'?1:0));assert.equal(after.invalidations,release==='COMMIT'?1:0);assert.equal(after.workflow.current_candidate_id,release==='COMMIT'?y.candidate:x.candidate);
    if(release==='ROLLBACK')assert.equal(after.audits,before.audits+1);return {...r,evidence:r.evidence+JSON.stringify({before,during,after,checked:r.value})};
  });
  await sub(t,'审批及依据审计整体回滚，观察者无半条',async()=>{
    const x=await environment();const before=await counts(x);const r=await race(x,async c=>{const a=await approveOn(c,x);assert.deepEqual(await counts(x),before);return a;},c=>approveOn(c,x),'ROLLBACK');
    assert.equal(r.value.result,'created');const after=await counts(x);assert.equal(after.approvals,1);assert.equal(after.audits,before.audits+1);assert.notEqual(r.firstResult.approval.approval_id,r.value.approval.approval_id);return r;
  });
  await sub(t,'两个选择者同预期版本只有一人成功',async()=>{
    const x=await environment();const a=await sibling(x);const b=await sibling(x);
    const r=await race(x,c=>call(c,'select_candidate',x.workflow,a.candidate,1),c=>call(c,'select_candidate',x.workflow,b.candidate,1));
    assert.equal(r.error?.constraint,'selection_version_conflict');assert.equal((await counts(x)).history,2);return {...r,code:r.error.code,constraint:r.error.constraint};
  });
  for(const order of ['approve-first','replace-first'])await sub(t,`审批与替换 ${order}`,async()=>{
    const x=await environment();const y=await sibling(x);
    const r=order==='approve-first'?await race(x,c=>approveOn(c,x),c=>call(c,'select_candidate',x.workflow,y.candidate,1)):
      await race(x,c=>call(c,'select_candidate',x.workflow,y.candidate,1),c=>approveOn(c,x));
    if(order==='approve-first'){x.approval=r.firstResult.approval.approval_id;assert.equal((await counts(x)).invalidations,1);await assertAdmission(x,false,['approval_invalidated','not_current_candidate'],{version:2});}
    else{assert.equal(r.error?.constraint,'approval_not_current');assert.equal((await counts(x)).approvals,0);}return {...r,code:r.error?.code,constraint:r.error?.constraint};
  });
  for(const order of ['admit-first','invalidate-first'])await sub(t,`准入与首次失效 ${order}，失效表初始零行`,async()=>{
    const x=await environment();await approve(x);assert.equal((await counts(x)).invalidations,0);
    const inv=c=>call(c,'invalidate_approval',x.approval,'manual_input_change','fixture_manual','concurrent-v1');
    const r=order==='admit-first'?await race(x,c=>admissionOn(c,x),inv):await race(x,inv,c=>admissionOn(c,x));
    if(order==='admit-first')assert.equal(r.firstResult.accepted,true);else assert.equal(r.value.accepted,false);
    await assertAdmission(x,false,['approval_invalidated']);assert.equal((await counts(x)).invalidations,1);
    return {...r,evidence:r.evidence+JSON.stringify({initialInvalidations:0,first:r.firstResult,second:r.value,laterRecheck:'rejected; past pass is not a permit'})};
  });
  for(const order of ['admit-first','canon-first'])await sub(t,`准入与模拟 Canon 前进 ${order}`,async()=>{
    const x=await environment();await approve(x);
    const advance=c=>call(c,'change_baseline',x.project,1,x.design,1,x.rule,x.policy);
    const r=order==='admit-first'?await race(x,c=>admissionOn(c,x),advance):await race(x,advance,c=>admissionOn(c,x));
    if(order==='admit-first')assert.equal(r.firstResult.accepted,true);else assert.equal(r.value.accepted,false);
    await assertAdmission(x,false,['canon_baseline_changed','approval_invalidated']);return {...r,evidence:r.evidence+JSON.stringify({first:r.firstResult,second:r.value,later:'old admission audit cannot authorize another check'})};
  });
  await sub(t,'相同审批请求并发只有一个 Approval 和依据审计',async()=>{
    const x=await environment();const before=await counts(x);const r=await race(x,c=>approveOn(c,x),c=>approveOn(c,x));
    assert.equal(r.value.result,'replayed');assert.equal(r.firstResult.approval.approval_id,r.value.approval.approval_id);const after=await counts(x);assert.equal(after.approvals,1);assert.equal(after.audits,before.audits+1);return r;
  });
  await sub(t,'不同项目首次并行提交，无死锁重试',async()=>{
    const x=await environment();const y=await environment();const a=await connect();const b=await connect();
    try{await begin(a);await begin(b);const first=await Promise.all([approveOn(a,x),approveOn(b,y)]);
      const committed=await Promise.allSettled([a.query('COMMIT'),b.query('COMMIT')]);assert.ok(committed.every(r=>r.status==='fulfilled'));
      x.approval=first[0].approval.approval_id;y.approval=first[1].approval.approval_id;await assertAdmission(x,true);await assertAdmission(y,true);
      return JSON.stringify({pids:[await pid(a),await pid(b)],committed:committed.map(r=>r.status),attempts:1});
    }finally{await close(a);await close(b);}
  });
  await sub(t,'显式失效及审计整体回滚',async()=>{
    const x=await environment();await approve(x);const before=await counts(x);
    const r=await race(x,c=>call(c,'invalidate_approval',x.approval,'changed','manual','rollback-v1'),c=>admissionOn(c,x),'ROLLBACK');
    assert.equal(r.value.accepted,true);const after=await counts(x);assert.equal(after.invalidations,0);assert.equal(after.audits,before.audits+1);return r;
  });
  await sub(t,'模拟基线及自动失效整体回滚',async()=>{
    const x=await environment();await approve(x);const before=await counts(x);
    const r=await race(x,c=>call(c,'change_baseline',x.project,1,x.design,1,x.rule,x.policy),c=>admissionOn(c,x),'ROLLBACK');
    assert.equal(r.value.accepted,true);assert.equal((await counts(x)).invalidations,0);assert.equal((await counts(x)).audits,before.audits+1);return r;
  });
});

scenario('B/C 输入链隔离与历史凭据防复用补充',async(t)=>{
  await sub(t,'同 Task 同 Bundle 但不同 Workflow 的 Generation 不能借用',async()=>{
    const x=await environment();return expectSql(()=>tx(async c=>{
      const other=id();const generation=id();await insert(c,'workflow_identity',{workflow_id:other,task_version_id:x.task});
      await insert(c,'generation_run',{generation_id:generation,workflow_id:other,bundle_id:x.bundle,input_bundle_hash:(await c.query(`SELECT content_hash FROM ${q('context_bundle')} WHERE bundle_id=$1`,[x.bundle])).rows[0].content_hash});
      await createCandidate(c,x,id(),{generation_id:generation});
    }),'insert:candidate','P0001','candidate_generation_chain');
  });
  await sub(t,'同 Workflow 同 Task 不同具体 Bundle 的 Generation 不能借用',async()=>{
    const x=await environment();return expectSql(()=>tx(async c=>{
      const bundle=id();await insert(c,'context_bundle',{bundle_id:bundle,task_version_id:x.task,content:'other concrete bundle',content_hash:await hash(c,'other concrete bundle')});
      await createCandidate(c,x,id(),{bundle_id:bundle});
    }),'insert:candidate','P0001','candidate_generation_chain');
  });
  await sub(t,'跨 Workflow 最终选择拒绝，所有目标真实存在',async()=>{const x=await environment();const y=await environment();return expectSql(()=>select(x,y.candidate),'selection','P0001','selection_candidate_workflow');});
  await sub(t,'人工编辑前序必须同 Workflow',async()=>{
    const x=await environment();const y=await environment();return expectSql(()=>sibling(x,{generation_id:null,origin:'human_edit',predecessor_id:y.candidate,edit_basis:'edit',bundle_basis:'inherited'}),'insert:candidate','P0001','predecessor_workflow');
  });
  await sub(t,'声明继承却绑定新 Bundle 被拒绝',async()=>{
    const x=await environment();return expectSql(()=>tx(async c=>{
      const bundle=id();await insert(c,'context_bundle',{bundle_id:bundle,task_version_id:x.task,content:'new context',content_hash:await hash(c,'new context')});
      await createCandidate(c,x,id(),{generation_id:null,origin:'human_edit',predecessor_id:x.candidate,edit_basis:'edit',bundle_basis:'inherited',bundle_id:bundle});
    }),'insert:candidate','P0001','inherited_bundle');
  });
  await sub(t,'人工编辑必须提供修改依据',async()=>{const x=await environment();return expectSql(()=>sibling(x,{generation_id:null,origin:'human_edit',predecessor_id:x.candidate,edit_basis:null,bundle_basis:'inherited'}),'insert:candidate','23514','candidate_version_check');});
  await sub(t,'人工编辑显式直接使用新 Bundle 仍可重新审批',async()=>{
    const x=await environment();await approve(x);const y=await tx(async c=>{
      const y={...x,bundle:id(),candidate:id(),validation:id(),version:2};delete y.approval;
      await insert(c,'context_bundle',{bundle_id:y.bundle,task_version_id:x.task,content:'new author context',content_hash:await hash(c,'new author context')});
      await createCandidate(c,y,y.candidate,{generation_id:null,origin:'human_edit',predecessor_id:x.candidate,edit_basis:'作者显式采用新上下文',bundle_basis:'direct'});
      await createValidation(c,y,y.validation,y.candidate);y.binding=await binding(c,y);await c.query('COMMIT');return y;
    });await select(x,y.candidate);await approve(y);return assertAdmission(y,true);
  });
  await sub(t,'相同正文的 Candidate 校验摘要仍绑定具体身份',async()=>{
    const x=await environment();const y=await sibling(x);
    return observe(async c=>{const rows=(await c.query(`SELECT candidate_version_id,input_hash FROM ${q('validation_run')} WHERE validation_run_id=ANY($1::text[]) ORDER BY candidate_version_id`,[[x.validation,y.validation]])).rows;
      assert.equal(rows.length,2);assert.notEqual(rows[0].input_hash,rows[1].input_hash);assert.equal(x.binding.candidate_content_hash,y.binding.candidate_content_hash);return JSON.stringify(rows);
    });
  });
  await sub(t,'历史通过审计和伪造通过审计均不替代当前复核',async()=>{
    const x=await environment();await approve(x);const old=await admission(x);assert.equal(old.accepted,true);await baseline(x,{canon:1});
    await tx(async c=>{await insert(c,'operation_audit',{project_id:x.project,event_kind:'admission_check',subject_id:x.candidate,evidence:old});await c.query('COMMIT');});
    return assertAdmission(x,false,['canon_baseline_changed','approval_invalidated']);
  });
  await sub(t,'失效影响范围按项目隔离',async()=>{
    const x=await environment();const y=await environment();await approve(x);await approve(y);await baseline(x,{canon:1});
    await assertAdmission(x,false,['approval_invalidated']);assert.equal((await counts(y)).invalidations,0);return assertAdmission(y,true);
  });
  await sub(t,'直接重复失效 INSERT 唯一身份幂等，不增加审计',async()=>{
    const x=await environment();await approve(x);await invalidate(x);const before=await counts(x);
    await tx(async c=>{await c.query(`INSERT INTO ${q('approval_invalidation_record')}(approval_id,reason_code,trigger_type,trigger_version) VALUES($1,'manual_input_change','fixture_manual','change-v1') ON CONFLICT(approval_id,reason_code,trigger_version) DO NOTHING`,[x.approval]);await c.query('COMMIT');});
    assert.deepEqual(await counts(x),before);return assertAdmission(x,false,['approval_invalidated']);
  });
});
