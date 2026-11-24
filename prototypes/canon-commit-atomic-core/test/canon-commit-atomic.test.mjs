import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'canon_commit_atomic_fixture';
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
  return { stage, code: error.code, constraint: error.constraint ?? '', evidence: error.message, detail: error.detail };
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
const emptyOutputs = () => ({ events: [], facts: [], state_transitions: [], assertions: [], temporal_relations: [], mappings: [] });
async function project() {
  return tx(async (c) => {
    const x = { project: id('novel'), design: id('design'), rule: id('rule'), policy: id('policy') };
    await insert(c, 'novel', { project_id: x.project });
    await insert(c, 'author_design_revision', { revision_id: x.design, project_id: x.project, status: 'frozen', content: { intent: 'fixture' } });
    await insert(c, 'rule_version', { version_id: x.rule, content: { hard_rules: 'fixture-v1' } });
    await insert(c, 'approval_policy_version', { version_id: x.policy, content: { manual: true } });
    await call(c, 'change_baseline', x.project, 0, x.design, x.rule, x.policy);
    await c.query('COMMIT'); return x;
  });
}
async function work(base, options = {}) {
  return tx(async (c) => {
    const x = { ...base, chapter: options.chapter ?? id('chapter'), scene: options.scene ?? id('scene'), identity: options.identity ?? id('text_identity'), task: id('task'), workflow: id('workflow'), bundle: id('bundle'), generation: id('generation'), candidate: id('candidate'), validation: id('validation'), version: 1 };
    x.canon = options.canon ?? Number(await call(c, 'current_watermark', x.project));
    if (!options.scene) {
      await insert(c, 'chapter', { chapter_id: x.chapter, project_id: x.project });
      await insert(c, 'scene', { scene_id: x.scene, chapter_id: x.chapter });
      await insert(c, 'canonical_text_identity_root', { canonical_text_identity_id: x.identity, chapter_id: x.chapter, scene_id: x.scene });
    }
    await insert(c, 'scene_task_version', { task_version_id: x.task, project_id: x.project, scene_id: x.scene, revision_id: x.design, input_canon_watermark: x.canon, content: { goal: 'fixture scene' } });
    const context = '有序夹具上下文：设计与明确 Canon 边界。';
    await insert(c, 'context_bundle', { bundle_id: x.bundle, task_version_id: x.task, content: context, content_hash: await hash(c, context) });
    await insert(c, 'workflow_identity', { workflow_id: x.workflow, task_version_id: x.task });
    await insert(c, 'generation_run', { generation_id: x.generation, workflow_id: x.workflow, bundle_id: x.bundle, input_bundle_hash: await hash(c, context) });
    await candidate(c, x);
    await validation(c, x);
    await call(c, 'select_candidate', x.workflow, x.candidate, 0);
    x.binding = await binding(c, x);
    await c.query('COMMIT'); return x;
  });
}
async function candidate(c, x, options = {}) {
  const body = options.body ?? '正式正文候选：角色走进庭院。';
  return insert(c, 'candidate_version', { candidate_version_id: x.candidate, workflow_id: x.workflow, bundle_id: x.bundle, generation_id: x.generation,
    predecessor_id: null, origin: 'model', bundle_basis: 'direct', edit_basis: null, body, content_hash: await hash(c, body), ...options });
}
async function validation(c, x, options = {}) {
  return insert(c, 'validation_run', { validation_run_id: x.validation, candidate_version_id: x.candidate, request_key: id('validation_request'), author_design_revision_id: x.design,
    input_canon_watermark: x.canon, rule_set_version: x.rule, validator_version: 'fixture-validator-v1',
    input_hash: await call(c, 'validation_input_hash', x.candidate, x.design, x.canon, x.rule), result: 'pass', ...options });
}
async function binding(c, x) {
  const bodyHash = (await c.query(`SELECT content_hash FROM ${q('candidate_version')} WHERE candidate_version_id=$1`, [x.candidate])).rows[0].content_hash;
  return { candidate_version_id: x.candidate, candidate_content_hash: bodyHash, context_bundle_id: x.bundle, author_design_revision_id: x.design,
    input_canon_watermark: x.canon, validation_run_id: x.validation, approval_policy_version: x.policy };
}
async function approve(x, key = 'manual-review', bind = x.binding) {
  const r = await invoke('record_approval', x.candidate, key, bind, 'approved', 'fixture-author', 'manual review');
  x.approval = r.approval.approval_id; return r;
}
async function ready(base, options = {}) { const x = await work(base ?? await project(), options); await approve(x); return x; }
function request(x, options = {}) {
  return { digest_spec_version: 'canon-request-v1', mode: 'initial_text', workflow_id: x.workflow, candidate_version_id: x.candidate, selection_version: x.version,
    approval_id: x.approval, input_canon_watermark: x.canon, canonical_text_identity_id: x.identity, projection_config_id: 'fixture-targets-v1', structured_outputs: emptyOutputs(), ...options };
}
const commitOn = (c, x, key = 'commit-key', req = request(x)) => call(c, 'commit_text', x.project, key, req);
const commit = (x, key = 'commit-key', req = request(x)) => invoke('commit_text', x.project, key, req);
const precheck = (x) => invoke('check_admission', x.project, x.workflow, x.candidate, x.approval, x.version);
const invalidate = (x) => invoke('invalidate_approval', x.approval, 'fixture_change', 'fixture_manual', 'v1');
async function sibling(x) {
  return tx(async (c) => {
    const y = { ...x, candidate: id('candidate'), validation: id('validation') }; delete y.approval;
    await candidate(c, y); await validation(c, y); y.binding = await binding(c, y);
    await c.query('COMMIT'); return y;
  });
}
async function snapshot(x) {
  return observe(async (c) => {
    const commits = (await c.query(`SELECT * FROM ${q('canon_commit')} WHERE project_id=$1 ORDER BY success_commit_sequence`, [x.project])).rows;
    const commitIds = commits.map((r) => r.canon_commit_id);
    const texts = (await c.query(`SELECT * FROM ${q('canonical_text_version')} WHERE canon_commit_id=ANY($1::text[]) ORDER BY canon_commit_id`, [commitIds])).rows;
    const items = (await c.query(`SELECT * FROM ${q('canon_commit_item')} WHERE canon_commit_id=ANY($1::text[]) ORDER BY canon_commit_id`, [commitIds])).rows;
    const supports = (await c.query(`SELECT * FROM ${q('canon_commit_item_text_target')} WHERE commit_item_id=ANY($1::text[]) ORDER BY commit_item_id`, [items.map((i) => i.commit_item_id)])).rows;
    const outbox = (await c.query(`SELECT * FROM ${q('projection_outbox')} WHERE canon_commit_id=ANY($1::text[]) ORDER BY canon_commit_id,target`, [commitIds])).rows;
    const current = (await c.query(`SELECT i.* FROM ${q('canonical_text_identity')} i JOIN ${q('chapter')} ch USING(chapter_id) WHERE ch.project_id=$1 ORDER BY canonical_text_identity_id`, [x.project])).rows;
    const audit = (await c.query(`SELECT event_kind,count(*)::int AS count FROM ${q('operation_audit')} WHERE project_id=$1 GROUP BY event_kind ORDER BY event_kind`, [x.project])).rows;
    const invalidations = (await c.query(`SELECT count(*)::int AS count FROM ${q('approval_invalidation_record')} i JOIN ${q('approval_record')} a USING(approval_id) WHERE ${q('candidate_project')}(a.candidate_version_id)=$1`, [x.project])).rows[0].count;
    const watermark = Number(await call(c, 'current_watermark', x.project));
    return { watermark, commits, texts, items, supports, outbox, current, audit, invalidations };
  });
}
async function assertUnchanged(x, before) { const actual = await snapshot(x); assert.deepEqual(actual, before); return actual; }
async function assertComplete(x, expectedWatermark) {
  const s = await snapshot(x); assert.equal(s.watermark, expectedWatermark);
  assert.equal(s.commits.length, expectedWatermark); assert.equal(s.texts.length, expectedWatermark); assert.equal(s.items.length, expectedWatermark); assert.equal(s.supports.length, expectedWatermark); assert.equal(s.outbox.length, expectedWatermark * 2);
  for (const cc of s.commits) {
    assert.equal(cc.result, 'committed'); assert.equal(cc.canon_watermark, cc.success_commit_sequence);
    const body = s.texts.find((v) => v.canon_commit_id === cc.canon_commit_id); assert.equal(body.canonical_text_version_id, cc.canonical_text_version_id);
    assert.equal(body.canonical_text_identity_id, cc.canonical_text_identity_id); assert.equal(body.version_no, 1);
    const item = s.items.find((i) => i.canon_commit_id === cc.canon_commit_id); assert.equal(item.target_type, 'canonical_text'); assert.equal(item.target_id, body.canonical_text_version_id);
    assert.ok(s.supports.some((i) => i.commit_item_id === item.commit_item_id && i.canonical_text_version_id === body.canonical_text_version_id));
    assert.equal(s.current.find((i) => i.canonical_text_identity_id === body.canonical_text_identity_id).current_canonical_text_version_id, body.canonical_text_version_id);
    assert.deepEqual(s.outbox.filter((o) => o.canon_commit_id === cc.canon_commit_id).map((o) => o.target), ['fixture_graph', 'fixture_vector']);
  }
  return s;
}
async function rejectUnchanged(x, action, stage, reason, code = 'P0001') {
  const before = await snapshot(x); const evidence = await expectSql(action, stage, code, reason); await assertUnchanged(x, before); return evidence;
}
async function race(x, first, second, release = 'COMMIT') {
  const a = await connect(); const b = await connect(); const observer = await connect();
  try {
    await begin(a); await begin(b);
    const firstResult = await first(a); const before = await snapshot(x);
    const blocker = await pid(a); const waiter = await pid(b);
    const pending = second(b).then((value) => ({ value }), (error) => ({ error }));
    const blocking = await blocked(observer, waiter, blocker);
    await a.query(release); const next = await pending;
    if (next.error) await b.query('ROLLBACK'); else await b.query('COMMIT');
    return { firstResult, ...next, stage: 'concurrency', evidence: JSON.stringify({ blocker, waiter, observer: await pid(observer), blocking, release, visibleBeforeRelease: { watermark: before.watermark, commits: before.commits.length, texts: before.texts.length, outbox: before.outbox.length }, first: firstResult, second: next.value, secondError: next.error?.constraint }) };
  } finally { await close(a); await close(b); await observer.end(); }
}
async function manualCore(c, x, key, options = {}) {
  const r = options.request ?? request(x); const textId = id('text_version');
  const row = { canon_commit_id: id('commit'), project_id: x.project, workflow_id: x.workflow, candidate_version_id: x.candidate, selection_version: x.version,
    approval_id: x.approval, approval_policy_version: x.policy, idempotency_key: key, digest_spec_version: 'canon-request-v1', request_payload: r,
    payload_hash: (await c.query(`SELECT ${q('digest_text')}(${q('canonical_request')}($1,$2)::text) AS h`, [x.project,r])).rows[0].h, projection_config_id: 'fixture-targets-v1', input_canon_watermark: x.canon,
    success_commit_sequence: Number(await call(c, 'current_watermark', x.project)) + 1, canon_watermark: Number(await call(c, 'current_watermark', x.project)) + 1,
    result: 'committed', canonical_text_identity_id: x.identity, canonical_text_version_id: textId, ...options.commitRow };
  const cc = (await insert(c, 'canon_commit', row)).rows[0];
  if (options.omit === 'text') return cc;
  const source = (await c.query(`SELECT *,char_length(body) AS actual_length FROM ${q('candidate_version')} WHERE candidate_version_id=$1`, [x.candidate])).rows[0];
  await insert(c, 'canonical_text_version', { canonical_text_version_id: textId, canonical_text_identity_id: x.identity, version_no: 1, canon_commit_id: cc.canon_commit_id,
    body: source.body, content_hash: source.content_hash, text_length: source.actual_length, ...options.textRow });
  if (options.omit === 'item') return cc;
  const item = (await insert(c, 'canon_commit_item', { commit_item_id: id('item'), canon_commit_id: cc.canon_commit_id, target_type: 'canonical_text', target_id: textId, ...options.itemRow })).rows[0];
  if (options.omit === 'support') return cc;
  await insert(c, 'canon_commit_item_text_target', { commit_item_id: item.commit_item_id, canonical_text_version_id: textId, ...options.supportRow });
  const targets = options.targets ?? ['fixture_graph','fixture_vector'];
  for (const target of targets) {
    const strategy = target === 'fixture_graph' ? 'fixture-graph-v1' : 'fixture-vector-v1';
    const event = (await c.query(`SELECT ${q('expected_outbox_event')}(jsonb_populate_record(NULL::${q('canon_commit')},$1::jsonb),$2,$3) AS e`, [cc,target,strategy])).rows[0].e;
    await insert(c, 'projection_outbox', { outbox_id: id('outbox'), canon_commit_id: cc.canon_commit_id, target, scope_key: x.scene, scope_hash: await call(c, 'scope_digest', x.project,x.scene),
      source_canon_watermark: cc.canon_watermark, strategy_version: strategy, event_payload: event,
      event_hash: (await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS h`, [event])).rows[0].h, ...options.outboxRow });
  }
  return cc;
}
async function deferredFailure(x, key, options, reason, code = 'P0001') {
  const before = await snapshot(x); let reached = false;
  const evidence = await expectSql(() => tx(async c => { await manualCore(c,x,key,options); reached = true; await c.query('COMMIT'); }), 'COMMIT', code, reason);
  assert.equal(reached,true,'all INSERT statements must finish before the intended COMMIT rejection'); await assertUnchanged(x,before);
  const retried = await commit(x,key); await assertComplete(x,1); return { ...evidence, evidence: JSON.stringify({ rejected: evidence, insertsSucceeded: reached, afterRollback: { watermark:before.watermark,commits:before.commits.length,texts:before.texts.length }, retry:retried }) };
}
async function faultTrigger(table, condition, reason) {
  const name = id('test_fault');
  await observe(c => c.query(`CREATE FUNCTION ${q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, ${SCHEMA}, pg_temp AS $fault$
    BEGIN IF ${condition} THEN RAISE EXCEPTION USING ERRCODE='P0001',CONSTRAINT='${reason}',MESSAGE='${reason}',
      DETAIL=jsonb_build_object('text_count',(SELECT count(*) FROM canonical_text_version WHERE canon_commit_id=NEW.canon_commit_id),'outbox_count',(SELECT count(*) FROM projection_outbox WHERE canon_commit_id=NEW.canon_commit_id))::text; END IF; RETURN NEW; END $fault$;
    CREATE TRIGGER ${name} BEFORE INSERT ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION ${q(name)}();`));
  return async () => observe(c => c.query(`DROP TRIGGER ${name} ON ${q(table)}; DROP FUNCTION ${q(name)}();`));
}

scenario('A 合法首次正文提交与成功水位', async(t) => {
  await sub(t,'水位 0→1→2，独立连接读取完整输出',async()=>{
    const base=await project(); const x=await ready(base); assert.equal((await snapshot(x)).watermark,0);
    const first=await commit(x,'first'); assert.equal(first.requires_outer_commit,true); const one=await assertComplete(x,1);
    assert.equal(one.texts[0].body,'正式正文候选：角色走进庭院。'); assert.notEqual(one.commits[0].payload_hash,one.texts[0].content_hash);
    const y=await ready(base);assert.equal(y.canon,1);const second=await commit(y,'second');const two=await assertComplete(y,2);
    assert.deepEqual(two.commits.map(c=>Number(c.success_commit_sequence)),[1,2]);assert.notEqual(first.canonical_text_version_id,second.canonical_text_version_id);
    assert.ok(two.invalidations>=2);return JSON.stringify({first,second,counts:{commits:two.commits.length,texts:two.texts.length,outbox:two.outbox.length},watermark:two.watermark});
  });
  await sub(t,'已存在正文身份的修订明确拒绝',async()=>{
    const base=await project();const x=await ready(base);await commit(x);const y=await ready(base,{chapter:x.chapter,scene:x.scene,identity:x.identity});
    return rejectUnchanged(y,()=>commit(y,'revision'),'commit-function','revision_not_supported');
  });
  for(const field of Object.keys(emptyOutputs()))await sub(t,`非空结构化集合 ${field} 明确拒绝`,async()=>{
    const x=await ready();return rejectUnchanged(x,()=>commit(x,'structured',request(x,{structured_outputs:{...emptyOutputs(),[field]:[{fixture:'not-supported'}]}})),'request-validation','structured_outputs_not_supported');
  });
  for(const [label,extra,reason] of [['未知字段',{surprise:true},'unknown_request_field'],['跨场景批量',{batch:[]},'batch_not_supported'],['显式修订模式',{mode:'replace'},'revision_not_supported'],['客户端摘要字段',{payload_hash:'client-claim'},'unknown_request_field'],['调用方省略投影目标',{targets:['fixture_graph']},'unknown_request_field'],['未知摘要版本',{digest_spec_version:'v-unknown'},'unknown_digest_version']])await sub(t,label,async()=>{
    const x=await ready();return rejectUnchanged(x,()=>commit(x,'unsupported',request(x,extra)),'request-validation',reason);
  });
});

scenario('B 正式提交事务重新复核准入',async(t)=>{
  await sub(t,'预检查通过后候选变化，正式提交拒绝且无输出',async()=>{
    const x=await ready();assert.equal((await precheck(x)).accepted,true);const y=await sibling(x);await invoke('select_candidate',x.workflow,y.candidate,1);
    return rejectUnchanged(x,()=>commit(x),'commit-function','admission_selection_version_conflict');
  });
  await sub(t,'预检查通过后审批失效，正式提交拒绝',async()=>{
    const x=await ready();assert.equal((await precheck(x)).accepted,true);await invalidate(x);return rejectUnchanged(x,()=>commit(x),'commit-function','admission_approval_invalidated');
  });
  await sub(t,'ABA 旧审批失效，新审批不可与旧选择/审批混用',async()=>{
    const x=await ready();const old=x.approval;const y=await sibling(x);
    await invoke('select_candidate',x.workflow,y.candidate,1);await invoke('select_candidate',x.workflow,x.candidate,2);x.version=3;
    await rejectUnchanged(x,()=>commit(x,'ABA-old'),'commit-function','admission_approval_invalidated');await approve(x,'new-approval');assert.notEqual(x.approval,old);
    await rejectUnchanged(x,()=>commit(x,'mixed',request(x,{selection_version:1})),'commit-function','admission_selection_version_conflict');
    const r=await commit(x,'ABA-new');await assertComplete(x,1);return JSON.stringify(r);
  });
  await sub(t,'成功水位推进后新 key 的陈旧输入不能重基',async()=>{
    const base=await project();const x=await ready(base);const y=await ready(base);await commit(x,'first');
    return rejectUnchanged(y,()=>commit(y,'stale-new-key'),'commit-function','stale_canon_watermark');
  });
  for(const baseline of ['design','rule','policy'])await sub(t,`预检查后 ${baseline} 基线变化阻断新提交`,async()=>{
    const x=await ready();assert.equal((await precheck(x)).accepted,true);
    await tx(async c=>{
      const design=baseline==='design'?id('design'):x.design;const rule=baseline==='rule'?id('rule'):x.rule;const policy=baseline==='policy'?id('policy'):x.policy;
      if(baseline==='design')await insert(c,'author_design_revision',{revision_id:design,project_id:x.project,status:'frozen',content:{changed:true}});
      if(baseline==='rule')await insert(c,'rule_version',{version_id:rule,content:{changed:true}});
      if(baseline==='policy')await insert(c,'approval_policy_version',{version_id:policy,content:{changed:true}});
      await call(c,'change_baseline',x.project,1,design,rule,policy);await c.query('COMMIT');
    });return rejectUnchanged(x,()=>commit(x),'commit-function',baseline==='policy'?'admission_approval_policy':'admission_approval_invalidated');
  });
});

scenario('C 函数返回、后续错误与 COMMIT 失败的原子回滚',async(t)=>{
  await sub(t,'函数返回后外层 ROLLBACK，响应不是持久成功凭据',async()=>{
    const x=await ready();const before=await snapshot(x);let pending;
    await tx(async c=>{pending=await commitOn(c,x,'retry');assert.equal(pending.requires_outer_commit,true);assert.equal(Number(await call(c,'current_watermark',x.project)),1);await assertUnchanged(x,before);await c.query('ROLLBACK');});
    await assertUnchanged(x,before);const retried=await commit(x,'retry');assert.notEqual(pending.canon_commit_id,retried.canon_commit_id);await assertComplete(x,1);return JSON.stringify({pending,afterRollback:before.watermark,retried});
  });
  for(const [label,table,condition,reason] of [['正文已写后 Item 写入出错','canon_commit_item','true','fixture_after_text'],['第二个必需 Outbox 出错','projection_outbox',"NEW.target='fixture_vector'",'fixture_second_outbox']])await sub(t,label,async()=>{
    const x=await ready();const before=await snapshot(x);const remove=await faultTrigger(table,condition,reason);let evidence;
    try{evidence=await expectSql(()=>commit(x,'retry'),'after-text/outbox INSERT','P0001',reason);const detail=JSON.parse(evidence.detail);assert.equal(detail.text_count,1);assert.equal(detail.outbox_count,table==='canon_commit_item'?0:1);await assertUnchanged(x,before);}finally{await remove();}
    const retried=await commit(x,'retry');await assertComplete(x,1);return {...evidence,evidence:JSON.stringify({failure:evidence,retried})};
  });
  await sub(t,'真实 COMMIT 延后完整性失败后同 key 可重试',async()=>{const x=await ready();return deferredFailure(x,'retry',{targets:['fixture_graph']},'commit_outbox_set');});
  await sub(t,'函数完成后追加不允许的 Outbox，真实 COMMIT 仍整体失败',async()=>{
    const x=await ready();const before=await snapshot(x);let returned;
    const evidence=await expectSql(()=>tx(async c=>{
      returned=await commitOn(c,x,'retry');await insert(c,'projection_outbox',{canon_commit_id:returned.canon_commit_id,target:'extra-fixture',scope_key:x.scene,scope_hash:'bad',source_canon_watermark:1,strategy_version:'extra',event_payload:{},event_hash:'bad'});await c.query('COMMIT');
    }),'COMMIT','P0001','commit_outbox_set');await assertUnchanged(x,before);const retried=await commit(x,'retry');await assertComplete(x,1);return {...evidence,evidence:JSON.stringify({returned,rejected:evidence,retried})};
  });
});

scenario('D 请求幂等与可观察并发',async(t)=>{
  await sub(t,'成功请求重放输出身份不变，计数不增长',async()=>{
    const x=await ready();const first=await commit(x);const before=await snapshot(x);const second=await commit(x);assert.equal(second.result,'replayed');
    assert.deepEqual({...second,result:first.result},first);await assertUnchanged(x,before);return JSON.stringify({first,second});
  });
  await sub(t,'水位/选择前进且审批已失效，历史成功请求仍先返回幂等结果',async()=>{
    const base=await project();const x=await ready(base);const first=await commit(x,'historical');const y=await ready(base);await commit(y,'next');
    const changed=await sibling(x);await invoke('select_candidate',x.workflow,changed.candidate,1);const before=await snapshot(x);assert.ok(before.invalidations>0);
    const repeated=await commit(x,'historical');assert.equal(repeated.canon_commit_id,first.canon_commit_id);assert.deepEqual(repeated.outbox_ids,first.outbox_ids);await assertUnchanged(x,before);return JSON.stringify({first,repeated,currentWatermark:before.watermark});
  });
  await sub(t,'当前规则/审批策略改变也不重新解释成功请求摘要',async()=>{
    const x=await ready();const first=await commit(x,'frozen-digest');
    await tx(async c=>{const policy=id('new_policy');const rule=id('new_rule');await insert(c,'approval_policy_version',{version_id:policy,content:{changed:true}});await insert(c,'rule_version',{version_id:rule,content:{changed:true}});await call(c,'change_baseline',x.project,1,x.design,rule,policy);await c.query('COMMIT');});
    const before=await snapshot(x);const replay=await commit(x,'frozen-digest');assert.equal(replay.payload_hash,first.payload_hash);assert.equal(replay.canon_commit_id,first.canon_commit_id);await assertUnchanged(x,before);return JSON.stringify({first,replay});
  });
  for(const field of ['selection_version','input_canon_watermark','canonical_text_identity_id','approval_id'])await sub(t,`同 key 不同摘要 ${field} 拒绝`,async()=>{
    const base=await project();const x=await ready(base);const y=await ready(base);await commit(x,'same');
    const extra={selection_version:2,input_canon_watermark:1,canonical_text_identity_id:y.identity,approval_id:y.approval};
    return rejectUnchanged(x,()=>commit(x,'same',request(x,{[field]:extra[field]})),'idempotency','commit_idempotency_conflict');
  });
  for(const release of ['COMMIT','ROLLBACK'])await sub(t,`同 key 同请求竞争 A ${release}`,async()=>{
    const x=await ready();const r=await race(x,c=>commitOn(c,x,'same'),c=>commitOn(c,x,'same'),release);assert.ok(!r.error,r.error?.message);
    assert.equal(r.value.result,release==='COMMIT'?'replayed':'created_in_transaction');
    if(release==='COMMIT')assert.equal(r.firstResult.canon_commit_id,r.value.canon_commit_id);else assert.notEqual(r.firstResult.canon_commit_id,r.value.canon_commit_id);
    await assertComplete(x,1);return r;
  });
  await sub(t,'同项目不同 key 相同水位只有一个推进，不做死锁重试',async()=>{
    const base=await project();const x=await ready(base);const y=await ready(base);const r=await race(x,c=>commitOn(c,x,'first'),c=>commitOn(c,y,'second'));
    assert.equal(r.error?.constraint,'stale_canon_watermark');await assertComplete(x,1);return {...r,code:r.error.code,constraint:r.error.constraint};
  });
  await sub(t,'不同项目同 key 首次并行提交，结果隔离',async()=>{
    const x=await ready();const y=await ready();const a=await connect();const b=await connect();
    try{await begin(a);await begin(b);const responses=await Promise.all([commitOn(a,x,'shared'),commitOn(b,y,'shared')]);const committed=await Promise.allSettled([a.query('COMMIT'),b.query('COMMIT')]);
      assert.ok(committed.every(r=>r.status==='fulfilled'));assert.notEqual(responses[0].canon_commit_id,responses[1].canon_commit_id);await assertComplete(x,1);await assertComplete(y,1);
      return JSON.stringify({pids:[await pid(a),await pid(b)],responses,committed:committed.map(r=>r.status),attempts:1});
    }finally{await close(a);await close(b);}
  });
});

scenario('E 普通直接 DML 防绕过与连接环境',async(t)=>{
  await sub(t,'完整且有效的直接 INSERT 也能成功，未禁止所有变化',async()=>{
    const x=await ready();await tx(async c=>{await manualCore(c,x,'direct');await c.query('COMMIT');});const s=await assertComplete(x,1);return JSON.stringify({commit:s.commits[0].canon_commit_id,watermark:s.watermark});
  });
  for(const [omit,reason,code] of [['text','commit_text_version_fk','23503'],['item','commit_item_missing','P0001'],['support','commit_text_support_missing','P0001']])await sub(t,`缺少 ${omit} 在真实 COMMIT 阻断`,async()=>{
    const x=await ready();return deferredFailure(x,'retry',{omit},reason,code);
  });
  for(const targets of [[],['fixture_graph'],['fixture_vector'],['fixture_graph','fixture_vector','extra-fixture']])await sub(t,`Outbox 必需集合精确匹配 ${targets.join('+')||'empty'}`,async()=>{
    const x=await ready();return deferredFailure(x,'retry',{targets},'commit_outbox_set');
  });
  for(const [label,options,reason] of [
    ['正文实际内容错绑',{textRow:{body:'伪造正文',content_hash:'wrong'}},'commit_text_binding'],
    
    ['Outbox 范围错绑',{outboxRow:{scope_hash:'wrong'}},'commit_outbox_binding'],
    ['Outbox 水位错绑',{outboxRow:{source_canon_watermark:999}},'commit_outbox_binding'],
    ['Outbox 事件摘要错绑',{outboxRow:{event_hash:'wrong'}},'commit_outbox_binding'],
    ['Outbox 事件内容错绑',{outboxRow:{event_payload:{forged:true}}},'commit_outbox_binding'],
  ])await sub(t,label,async()=>{const x=await ready();return deferredFailure(x,'retry',options,reason);});
  for(const [label,options,reason] of [
    ['跳过成功序号',{success_commit_sequence:9,canon_watermark:9},'commit_sequence_invalid'],
    ['伪造请求摘要',{payload_hash:'client-claim'},'request_payload_hash'],
    ['伪造选择绑定',{selection_version:9},'commit_request_binding'],
  ])await sub(t,label,async()=>{const x=await ready();return rejectUnchanged(x,()=>tx(async c=>{await manualCore(c,x,'forged',{commitRow:options});await c.query('COMMIT');}),'INSERT:canon_commit',reason);});
  await sub(t,'失效审批不能经直接 INSERT 伪造成功提交',async()=>{
    const x=await ready();await invalidate(x);return rejectUnchanged(x,()=>tx(async c=>{await manualCore(c,x,'forged');await c.query('COMMIT');}),'INSERT:canon_commit','admission_approval_invalidated');
  });
  await sub(t,'跨项目正文身份与 Candidate 归属不一致拒绝',async()=>{
    const x=await ready();const y=await ready();return rejectUnchanged(x,()=>commit(x,'cross',request(x,{canonical_text_identity_id:y.identity})),'INSERT:canon_commit','commit_text_scope');
  });
  await sub(t,'同项目跨场景目标拒绝',async()=>{
    const base=await project();const x=await ready(base);const y=await ready(base);return rejectUnchanged(x,()=>commit(x,'cross-scene',request(x,{canonical_text_identity_id:y.identity})),'INSERT:canon_commit','commit_text_scope');
  });
  await sub(t,'同 Scene 但跨 Chapter 的正文身份拒绝',async()=>{
    const x=await ready();return rejectUnchanged(x,()=>tx(async c=>{const chapter=id('other_chapter');await insert(c,'chapter',{chapter_id:chapter,project_id:x.project});await insert(c,'canonical_text_identity_root',{canonical_text_identity_id:id(),chapter_id:chapter,scene_id:x.scene});}),'INSERT:identity','text_identity_scene_chapter');
  });
  await sub(t,'正文不能绑定其他项目的真实正文身份',async()=>{
    const x=await ready();const y=await ready();return deferredFailure(x,'retry',{textRow:{canonical_text_identity_id:y.identity}},'commit_text_binding');
  });
  for(const part of ['item','support'])await sub(t,`正文 ${part} 不能指向其他成功 Commit 的真实正文版本`,async()=>{
    const foreign=await ready();const other=await commit(foreign);const x=await ready();
    const options=part==='item'?{itemRow:{target_id:other.canonical_text_version_id}}:{supportRow:{canonical_text_version_id:other.canonical_text_version_id}};
    // The support FK targets a real version. Its existing exclusive support may reject earlier than completeness.
    if(part==='support')return rejectUnchanged(x,()=>tx(async c=>{await manualCore(c,x,'cross-support',options);await c.query('COMMIT');}),'INSERT:text_support','canon_commit_item_text_target_canonical_text_version_id_key','23505');
    return deferredFailure(x,'retry',options,'commit_item_binding');
  });
  await sub(t,'Task 的真实 Scene 不能跨项目借用',async()=>{
    const x=await ready();const y=await ready();return rejectUnchanged(x,()=>tx(c=>insert(c,'scene_task_version',{task_version_id:id(),project_id:x.project,scene_id:y.scene,revision_id:x.design,input_canon_watermark:0,content:{}})),'INSERT:task','task_scene_project');
  });
  await sub(t,'Outbox Commit/目标/策略唯一约束实际阻断重复',async()=>{
    const x=await ready();const output=await commit(x);const s=await snapshot(x);const existing=s.outbox[0];
    const constraint=await observe(async c=>(await c.query(`SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND pg_catalog.pg_get_constraintdef(oid)='UNIQUE (canon_commit_id, target, strategy_version)'`,[q('projection_outbox')])).rows[0].conname);
    return rejectUnchanged(x,()=>tx(c=>insert(c,'projection_outbox',{...existing,outbox_id:id('duplicate')})),'INSERT:outbox',''+constraint,'23505');
  });
  await sub(t,'配置不能省掉第二个必需目标',async()=>{
    const x=await ready();return rejectUnchanged(x,()=>tx(c=>insert(c,'projection_target_config',{config_id:id(),targets:JSON.stringify([{target:'fixture_graph',strategy_version:'fixture-graph-v1'}])})),'INSERT:config','projection_target_config_targets_check','23514');
  });
  const immutables=['canon_commit','canonical_text_version','canon_commit_item','canon_commit_item_text_target','projection_outbox','projection_target_config','canonical_text_identity_root','candidate_version','context_bundle','approval_record','approval_invalidation_record','candidate_selection_history'];
  for(const table of immutables)await sub(t,`核心历史 ${table} 更新/删除/清空拒绝`,async()=>{
    const x=await ready();await commit(x);const before=await snapshot(x);const column={canon_commit:'result',canonical_text_version:'content_hash',canon_commit_item:'target_id',canon_commit_item_text_target:'canonical_text_version_id',projection_outbox:'event_hash',projection_target_config:'config_id',canonical_text_identity_root:'scene_id',candidate_version:'content_hash',context_bundle:'content_hash',approval_record:'decision',approval_invalidation_record:'reason_code',candidate_selection_history:'selection_version'}[table];const evidence=[];
    for(const sql of [`UPDATE ${q(table)} SET ${column}=${column}`,`DELETE FROM ${q(table)}`,`TRUNCATE ${q(table)} CASCADE`])evidence.push(await expectSql(()=>tx(c=>c.query(sql)),sql.split(' ')[0],'P0001',`immutable_${table}`));
    await assertUnchanged(x,before);return {stage:'direct DML',evidence:JSON.stringify(evidence)};
  });
  for(const view of ['canon_watermark','current_baseline','canonical_text_identity'])await sub(t,`只读当前状态 ${view} 不能篡改`,async()=>{
    const x=await ready();const column=view==='canonical_text_identity'?'current_canonical_text_version_id':'canon_watermark';
    return rejectUnchanged(x,()=>tx(c=>c.query(`UPDATE ${q(view)} SET ${column}=${column}`)),'direct DML:view',`readonly_${view}`);
  });
  await sub(t,'实际路径、延后约束、唯一约束与无故障设施残留',async()=>observe(async c=>{
    const funcs=(await c.query(`SELECT p.proname,p.proconfig,p.prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY proname`,[SCHEMA])).rows;
    for(const f of funcs){assert.deepEqual(f.proconfig,[`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);assert.equal(f.prosecdef,false);assert.ok(!f.proname.startsWith('test_fault'));}
    const triggers=(await c.query(`SELECT c.relname,t.tgname,t.tgdeferrable,t.tginitdeferred,t.tgenabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,[SCHEMA])).rows;
    assert.equal(triggers.filter(t=>t.tgname==='atomic_completeness'&&t.tgdeferrable&&t.tginitdeferred).length,5);assert.ok(triggers.every(t=>t.tgenabled==='O'));
    const constraints=(await c.query(`SELECT conname,pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname`,[SCHEMA])).rows;
    for(const def of ['UNIQUE (project_id, idempotency_key)','UNIQUE (project_id, success_commit_sequence)','UNIQUE (canon_commit_id, target, strategy_version)'])assert.ok(constraints.some(c=>c.definition===def),def);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name='baseline_history' AND column_name='canon_watermark'`,[SCHEMA])).rows[0].n,0);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname IN ('projection_task','projection_attempt','story_event','canon_fact','state_transition')`,[SCHEMA])).rows[0].n,0);
    return JSON.stringify({functions:funcs,triggers,constraints});
  }));
});
