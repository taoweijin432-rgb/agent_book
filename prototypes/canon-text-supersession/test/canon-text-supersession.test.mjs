import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'canon_text_supersession_fixture';
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
  return { stage, code: error.code, constraint: error.constraint ?? '', evidence: error.message, detail: error.detail, table: error.table, column: error.column };
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
const kinds=['candidate_event','candidate_fact_proposal','candidate_state_transition'];
async function project() {
  return tx(async (c) => {
    const x = { project: id('novel'), design: id('design'), rule: id('rule'), policy: id('policy') };
    await insert(c, 'novel', { project_id: x.project });
    await insert(c, 'author_design_revision', { revision_id: x.design, project_id: x.project, status: 'frozen', content: { intent: 'fixture' } });
    await insert(c, 'rule_version', { version_id: x.rule, content: { hard_rules: 'fixture-v1' } });
    await insert(c, 'approval_policy_version', { version_id: x.policy, content: { manual: true } });
    await call(c, 'change_baseline', x.project, 0, x.design, x.rule, x.policy);
    x.entity=id('entity');x.dimension=id('dimension');await insert(c,'entity',{entity_id:x.entity,project_id:x.project});await insert(c,'state_dimension',{state_dimension_id:x.dimension,project_id:x.project,dimension_key:'fixture-initial'});
    await c.query('COMMIT'); return x;
  });
}
async function work(base,types=kinds,options={}){
  return tx(async c=>{
    const x={...base,chapter:id('chapter'),scene:id('scene'),identity:id('identity'),task:id('task'),workflow:id('workflow'),bundle:id('bundle'),generation:id('generation'),candidate:id('candidate'),validation:id('validation'),version:1,proposals:[]};
    delete x.output;
    x.canon=Number(await call(c,'current_watermark',x.project));
    await insert(c,'chapter',{chapter_id:x.chapter,project_id:x.project});await insert(c,'scene',{scene_id:x.scene,chapter_id:x.chapter});await insert(c,'canonical_text_identity_root',{canonical_text_identity_id:x.identity,chapter_id:x.chapter,scene_id:x.scene});
    await insert(c,'scene_task_version',{task_version_id:x.task,project_id:x.project,scene_id:x.scene,revision_id:x.design,input_canon_watermark:x.canon,content:{goal:'structured fixture'}});
    const context='设计与 Canon 输入边界';await insert(c,'context_bundle',{bundle_id:x.bundle,task_version_id:x.task,content:context,content_hash:await hash(c,context)});
    await insert(c,'workflow_identity',{workflow_id:x.workflow,task_version_id:x.task});await insert(c,'generation_run',{generation_id:x.generation,workflow_id:x.workflow,bundle_id:x.bundle,input_bundle_hash:await hash(c,context)});
    await candidate(c,x);
    for(const kind of types)x.proposals.push(await proposal(c,x,kind,options));
    await call(c,'select_candidate',x.workflow,x.candidate,0);
    if(options.freeze!==false){await finishOn(c,x);}
    await c.query('COMMIT');return x;
  });
}
async function candidate(c,x){const body=x.body??'角色走进庭院。物品是蓝色。初始状态为清醒。';await insert(c,'candidate_version',{candidate_version_id:x.candidate,workflow_id:x.workflow,bundle_id:x.bundle,generation_id:x.generation,origin:'model',bundle_basis:'direct',body,content_hash:await hash(c,body)});}
const proposalIdColumn={candidate_event:'candidate_event_id',candidate_fact_proposal:'candidate_fact_proposal_id',candidate_state_transition:'candidate_state_transition_id'};
const targetKind={candidate_event:'story_event',candidate_fact_proposal:'canon_fact',candidate_state_transition:'state_transition'};
const targetIdColumn={story_event:'story_event_id',canon_fact:'canon_fact_id',state_transition:'state_transition_id'};
const supportTable={story_event:'canon_commit_item_story_event_target',canon_fact:'canon_commit_item_fact_target',state_transition:'canon_commit_item_state_target'};
async function proposal(c,x,kind,options={}){
  const proposalId=options.sharedIds&&kind!=='candidate_state_transition'?`shared_${x.candidate}`:id('proposal');const assertion=id('assertion');
  const common={candidate_version_id:x.candidate,assertion_id:assertion,object_hash_spec_version:'fixture-proposal-v1'};
  let row;
  if(kind==='candidate_event')row={...common,candidate_event_id:proposalId,event_key:id('event'),subject_entity_id:x.entity,predicate:'entered',object_ref:x.entity,story_time_ref:null};
  if(kind==='candidate_fact_proposal')row={...common,candidate_fact_proposal_id:proposalId,subject_entity_id:x.entity,fact_key:options.factKey??id('color'),proposed_value:{color:'blue'},effective_scope:'fixture-scope'};
  if(kind==='candidate_state_transition')row={...common,candidate_state_transition_id:proposalId,entity_id:x.entity,state_dimension_id:x.dimension,transition_key:id('initial'),from_value:null,to_value:{state:'awake'}};
  row={...row,...options.proposalRow};
  const asserted=await call(c,'proposal_asserted_value',kind,row);const body=(await c.query(`SELECT body,content_hash,char_length(body) AS n FROM ${q('candidate_version')} WHERE candidate_version_id=$1`,[x.candidate])).rows[0];
  await insert(c,'narrative_assertion',{assertion_id:assertion,candidate_version_id:x.candidate,source_domain:'candidate',assertion_type:options.assertionType??'direct_observation',assertion_payload:asserted,locator:{start:0,end:body.n,quote:body.body},source_content_hash:body.content_hash,hash_spec_version:'fixture-assertion-v1',extractor_version:'fixture-extractor-v1',...options.assertionRow});
  await insert(c,'narrative_assertion_candidate_source',{assertion_id:assertion,candidate_version_id:x.candidate,source_version_id:x.candidate,...options.assertionSource});
  if(options.confirm!==false){const record=id('observation');await insert(c,'fixture_world_record',{record_id:record,project_id:x.project,subject_entity_id:asserted.subject,predicate:asserted.predicate,value:asserted.value,provenance:'fixture-observation-v1'});await insert(c,'assertion_confirmation_basis',{basis_id:id('basis'),assertion_id:assertion,record_id:record,rule_version:'fixture-confirm-v1'});}
  await insert(c,kind,row);return {type:kind,id:proposalId};
}
async function validation(c,x,options={}){return insert(c,'validation_run',{validation_run_id:x.validation,candidate_version_id:x.candidate,request_key:id('validation_request'),author_design_revision_id:x.design,input_canon_watermark:x.canon,rule_set_version:x.rule,validator_version:'fixture-validator-v1',input_hash:await call(c,'validation_input_hash',x.candidate,x.design,x.canon,x.rule),result:'pass',...options});}
async function binding(c,x){return {candidate_version_id:x.candidate,candidate_content_hash:(await c.query(`SELECT content_hash FROM ${q('candidate_version')} WHERE candidate_version_id=$1`,[x.candidate])).rows[0].content_hash,context_bundle_id:x.bundle,author_design_revision_id:x.design,input_canon_watermark:x.canon,validation_run_id:x.validation,approval_policy_version:x.policy};}
async function finishOn(c,x){await call(c,'freeze_candidate',x.candidate);await validation(c,x);x.binding=await binding(c,x);}
async function approve(x,key='review',bind=x.binding){const r=await invoke('record_approval',x.candidate,key,bind,'approved','fixture-author','structured manual review');x.approval=r.approval.approval_id;return r;}
async function ready(types=kinds,options={},base){const x=await work(base??await project(),types,options);await approve(x);return x;}
function request(x,extra={}){return {digest_spec_version:'canon-text-supersession-request-v1',mode:x.old?'revise_text':'initial_text',workflow_id:x.workflow,candidate_version_id:x.candidate,selection_version:x.version,approval_id:x.approval,input_canon_watermark:x.canon,canonical_text_identity_id:x.identity,projection_config_id:'fixture-targets-v1',structured_outputs:x.proposals,...extra};}
const commitOn=(c,x,key=`commit-${x.candidate}`,r=request(x))=>call(c,'commit_text',x.project,key,r);
const commit=(x,key=`commit-${x.candidate}`,r=request(x))=>invoke('commit_text',x.project,key,r);
const invalidate=x=>invoke('invalidate_approval',x.approval,'fixture_change','fixture-manual','v1');
async function snapshot(x){return observe(async c=>{
  const commits=(await c.query(`SELECT * FROM ${q('canon_commit')} WHERE project_id=$1 ORDER BY success_commit_sequence`,[x.project])).rows;
  const outputs=[];for(const cc of commits)outputs.push(await call(c,'commit_output_manifest',cc.canon_commit_id));
  const current=(await c.query(`SELECT i.* FROM ${q('canonical_text_identity')} i JOIN ${q('chapter')} ch USING(chapter_id) WHERE ch.project_id=$1 ORDER BY canonical_text_identity_id`,[x.project])).rows;
  const audits=(await c.query(`SELECT event_kind,count(*)::int AS n FROM ${q('operation_audit')} WHERE project_id=$1 GROUP BY event_kind ORDER BY event_kind`,[x.project])).rows;
  const invalidations=(await c.query(`SELECT count(*)::int AS n FROM ${q('approval_invalidation_record')} i JOIN ${q('approval_record')} a USING(approval_id) WHERE ${q('candidate_project')}(a.candidate_version_id)=$1`,[x.project])).rows[0].n;
  const texts=(await c.query(`SELECT v.* FROM ${q('canonical_text_version')} v JOIN ${q('canon_commit')} cc USING(canon_commit_id) WHERE cc.project_id=$1 ORDER BY canon_commit_id`,[x.project])).rows;
  const outbox=(await c.query(`SELECT o.* FROM ${q('projection_outbox')} o JOIN ${q('canon_commit')} cc USING(canon_commit_id) WHERE cc.project_id=$1 ORDER BY canon_commit_id,target`,[x.project])).rows;
  const physicalTables=['canon_commit','canonical_text_version','story_event','canon_fact','state_transition','evidence_reference','evidence_canon_source','canon_commit_item','canon_commit_item_text_target','canon_commit_item_story_event_target','canon_commit_item_fact_target','canon_commit_item_state_target','candidate_to_canon_mapping','candidate_to_canon_candidate_source','projection_outbox','canon_relation_target','supersession_relation'];
  const physicalCounts=(await c.query(`SELECT ${physicalTables.map(table=>`(SELECT count(*)::int FROM ${q(table)}) AS ${table}`).join(',')}`)).rows[0];
  return {watermark:Number(await call(c,'current_watermark',x.project)),commits,outputs,current,audits,invalidations,texts,outbox,physicalCounts};
});}
async function unchanged(x,before){const actual=await snapshot(x);assert.deepEqual(actual,before);return actual;}
async function rejectUnchanged(x,action,stage,reason,code='P0001'){const before=await snapshot(x);const evidence=await expectSql(action,stage,code,reason);const after=await unchanged(x,before);return {...evidence,evidence:JSON.stringify({rejection:evidence,physicalCountsBefore:before.physicalCounts,physicalCountsAfter:after.physicalCounts})};}
async function complete(x,n=1){const s=await snapshot(x);assert.equal(s.watermark,n);assert.equal(s.commits.length,n);assert.equal(s.texts.length,n);assert.equal(s.outbox.length,n*2);
  for(let j=0;j<s.commits.length;j++){const cc=s.commits[j];const output=s.outputs[j];const expected=await observe(c=>call(c,'manifest_ids',cc.candidate_version_id));assert.equal(output.objects.length,expected.length);assert.equal(output.items.length,expected.length+1);assert.equal(output.targets.length,output.items.length);assert.equal(output.mappings.length,expected.length);assert.equal(output.mapping_sources.length,expected.length);assert.equal(output.evidence.length,expected.length?1:0);assert.equal(output.evidence_sources.length,output.evidence.length);
    const event=s.outbox.find(o=>o.canon_commit_id===cc.canon_commit_id);assert.deepEqual(event.event_payload.complete_output,output);assert.equal(event.event_payload.event_type,cc.request_payload.mode==='revise_text'?'fixture_canon_text_revised_v1':'fixture_canon_text_initial_v1');
    for(const m of output.mappings){assert.notEqual(m.candidate_object_hash,m.candidate_content_hash);assert.ok(output.items.some(i=>i.commit_item_id===m.canon_commit_item_id&&i.source_mapping_id===m.mapping_id));}
  }return s;
}
async function race(x,first,second,release='COMMIT'){const a=await connect(),b=await connect(),o=await connect();try{await begin(a);await begin(b);const firstResult=await first(a);const blocker=await pid(a),waiter=await pid(b);const pending=second(b).then(value=>({value}),error=>({error}));const waiting=await blocked(o,waiter,blocker);const before=await snapshot(x);await a.query(release);const next=await pending;if(next.error)await b.query('ROLLBACK');else await b.query('COMMIT');return {firstResult,...next,stage:'concurrency',evidence:JSON.stringify({blocker,waiter,observer:await pid(o),waiting,release,visibleWatermark:before.watermark,visibleCommits:before.commits.length,firstResult,secondResult:next.value,secondError:next.error?.constraint})};}finally{await close(a);await close(b);await o.end();}}

async function manualText(c, x, key, options = {}) {
  const r = options.request ?? request(x); const textId = id('text_version');
  const row = { canon_commit_id: id('commit'), project_id: x.project, workflow_id: x.workflow, candidate_version_id: x.candidate, selection_version: x.version,
    approval_id: x.approval, approval_policy_version: x.policy, idempotency_key: key, digest_spec_version: 'canon-text-supersession-request-v1', request_payload: r,
    payload_hash: (await c.query(`SELECT ${q('digest_text')}(${q('canonical_request')}($1,$2)::text) AS h`, [x.project,r])).rows[0].h, projection_config_id: 'fixture-targets-v1', input_canon_watermark: x.canon,
    success_commit_sequence: Number(await call(c, 'current_watermark', x.project)) + 1, canon_watermark: Number(await call(c, 'current_watermark', x.project)) + 1,
    result: 'committed', canonical_text_identity_id: x.identity, canonical_text_version_id: textId, ...options.commitRow };
  const cc = (await insert(c, 'canon_commit', row)).rows[0];
  if (options.omit === 'text') return cc;
  const source = (await c.query(`SELECT *,char_length(body) AS actual_length FROM ${q('candidate_version')} WHERE candidate_version_id=$1`, [x.candidate])).rows[0];
  await insert(c, 'canonical_text_version', { canonical_text_version_id: textId, canonical_text_identity_id: x.identity, version_no: x.oldNo?x.oldNo+1:1, canon_commit_id: cc.canon_commit_id,
    body: source.body, content_hash: source.content_hash, text_length: source.actual_length, ...options.textRow });
  if (options.omit === 'item') return cc;
  const item = (await insert(c, 'canon_commit_item', { commit_item_id: id('item'), canon_commit_id: cc.canon_commit_id, target_type: 'canonical_text', target_id: textId, ...options.itemRow })).rows[0];
  if (options.omit === 'support') return cc;
  await insert(c, 'canon_commit_item_text_target', { commit_item_id: item.commit_item_id, canonical_text_version_id: textId, ...options.supportRow });
  return cc;
}
async function sibling(x,types=[kinds[0]]){return tx(async c=>{const y={...x,candidate:id('candidate'),validation:id('validation'),proposals:[],version:2};delete y.approval;await candidate(c,y);for(const kind of types)y.proposals.push(await proposal(c,y,kind));await finishOn(c,y);await c.query('COMMIT');return y;});}
async function writeOutbox(c,x,cc){for(const target of ['fixture_graph','fixture_vector']){const strategy=target==='fixture_graph'?'fixture-graph-v1':'fixture-vector-v1';const event=(await c.query(`SELECT ${q('expected_outbox_event')}(jsonb_populate_record(NULL::${q('canon_commit')},$1::jsonb),$2,$3) AS e`,[cc,target,strategy])).rows[0].e;
  await insert(c,'projection_outbox',{canon_commit_id:cc.canon_commit_id,target,scope_key:x.scene,scope_hash:await call(c,'scope_digest',x.project,x.scene),source_canon_watermark:cc.canon_watermark,strategy_version:strategy,event_payload:event,event_hash:(await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS h`,[event])).rows[0].h});}}

async function initial(types=[]){const x=await ready(types);x.output=await commit(x);return x;}
async function revision(previous,options={}){
  return tx(async c=>{
    const oldId=options.old??previous.output.canonical_text_version_id;
    const old=(await c.query(`SELECT * FROM ${q('canonical_text_version')} WHERE canonical_text_version_id=$1`,[oldId])).rows[0];
    const x={...previous,old:oldId,oldNo:old.version_no,identity:options.identity??previous.identity,
      task:id('revision_task'),workflow:id('revision_workflow'),bundle:id('revision_bundle'),generation:id('revision_generation'),candidate:id('revision_candidate'),validation:id('revision_validation'),version:1,proposals:[],body:`修订 ${id('body')}：角色走进庭院。物品是蓝色。初始状态为清醒。`};
    delete x.approval;delete x.output;
    x.canon=Number(await call(c,'current_watermark',x.project));
    await insert(c,'scene_task_version',{task_version_id:x.task,project_id:x.project,scene_id:x.scene,revision_id:x.design,input_canon_watermark:x.canon,content:{goal:'pure text revision'}});
    const context=`旧正文 ${oldId} 与 Canon ${x.canon}`;
    await insert(c,'context_bundle',{bundle_id:x.bundle,task_version_id:x.task,content:context,content_hash:await hash(c,context)});
    await insert(c,'workflow_identity',{workflow_id:x.workflow,task_version_id:x.task});
    await insert(c,'generation_run',{generation_id:x.generation,workflow_id:x.workflow,bundle_id:x.bundle,input_bundle_hash:await hash(c,context)});
    await candidate(c,x);
    for(const kind of options.types??[])x.proposals.push(await proposal(c,x,kind));
    x.intent={candidate_version_id:x.candidate,canonical_text_identity_id:x.identity,expected_old_text_version_id:oldId,reason:options.reason??'修正正文措辞',revision_contract_version:'fixture-text-revision-v1'};
    if(options.intent!==false)await insert(c,'candidate_revision_intent',{...x.intent,...options.intentRow});
    await call(c,'select_candidate',x.workflow,x.candidate,0);
    if(options.freeze!==false)await finishOn(c,x);
    await c.query('COMMIT');return x;
  });
}
async function revisionReady(previous,options={}){const x=await revision(previous,options);await approve(x);return x;}
async function chain(x,version,watermark=version){const s=await complete(x,watermark);const own=s.texts.filter(v=>v.canonical_text_identity_id===x.identity).sort((a,b)=>a.version_no-b.version_no);assert.equal(own.length,version);assert.deepEqual(own.map(v=>v.version_no),Array.from({length:version},(_,i)=>i+1));assert.equal(s.current.find(i=>i.canonical_text_identity_id===x.identity).current_canonical_text_version_id,own.at(-1).canonical_text_version_id);
  for(let j=0;j<own.length;j++){const output=s.outputs[s.commits.findIndex(cc=>cc.canon_commit_id===own[j].canon_commit_id)];assert.equal(output.supersession.relations.length,j?1:0);assert.equal(output.supersession.targets.length,j?1:0);if(j){const rel=output.supersession.relations[0],target=output.supersession.targets[0];assert.equal(rel.canon_commit_id,own[j].canon_commit_id);assert.equal(rel.replacement_commit_id,own[j].canon_commit_id);assert.equal(target.target_text_version_id,own[j-1].canonical_text_version_id);assert.equal(target.target_ref_id,rel.target_ref_id);const outbox=s.outbox.filter(o=>o.canon_commit_id===own[j].canon_commit_id);for(const o of outbox){assert.equal(o.event_payload.old_text_version_id,own[j-1].canonical_text_version_id);assert.equal(o.event_payload.new_text_version_id,own[j].canonical_text_version_id);assert.equal(o.event_payload.supersession_relation_id,rel.relation_id);}}}
  return s;
}
async function manualRevision(c,x,key,options={}){
  const cc=await manualText(c,x,key,options);
  if(options.omit==='text')return cc;
  const ref=id('target_ref');
  if(!options.omitTarget)await insert(c,'canon_relation_target',{target_ref_id:ref,relation_kind:'supersession',target_type:'canonical_text',target_text_version_id:x.old,created_by_commit_id:cc.canon_commit_id,...options.targetRow});
  if(!options.omitRelation)await insert(c,'supersession_relation',{relation_id:id('relation'),canon_commit_id:cc.canon_commit_id,target_ref_id:ref,replacement_commit_id:cc.canon_commit_id,reason:x.intent.reason,...options.relationRow});
  if(!options.omitOutbox)await writeOutbox(c,x,cc);
  return cc;
}
async function deferredRevision(x,options,reason,code='P0001',key='negative'){
  let inserts=false;const before=await snapshot(x);
  const proof=await expectSql(()=>tx(async c=>{await manualRevision(c,x,key,options);inserts=true;await c.query('COMMIT');}),'COMMIT',code,reason);
  assert.equal(inserts,true);const after=await unchanged(x,before);
  return {...proof,evidence:JSON.stringify({insertsSucceeded:inserts,rejection:proof,physicalCountsBefore:before.physicalCounts,physicalCountsAfter:after.physicalCounts,independentCurrent:after.current,watermark:after.watermark,audits:after.audits,invalidations:after.invalidations})};
}
const precheck=x=>invoke('check_admission',x.project,x.workflow,x.candidate,x.approval,x.version);

scenario('A 合法正文版本链与历史读取',async t=>{
  const a=await initial();let v1;let v2;let b;let v3;
  await sub(t,'真实首次提交 v1，无替代关系',async()=>{v1=await chain(a,1);return JSON.stringify({output:a.output,current:v1.current,body:v1.texts[0]});});
  await sub(t,'新候选、新校验、新审批提交 v2',async()=>{b=await revisionReady(a);b.output=await commit(b);v2=await chain(b,2);assert.deepEqual(v2.commits[0],v1.commits[0]);assert.deepEqual(v2.outputs[0],v1.outputs[0]);assert.deepEqual(v2.texts.find(v=>v.canon_commit_id===a.output.canon_commit_id),v1.texts[0]);assert.deepEqual(v2.outbox.filter(o=>o.canon_commit_id===a.output.canon_commit_id),v1.outbox);return JSON.stringify({output:b.output,current:v2.current,validation:b.validation,approval:b.approval});});
  await sub(t,'另一 Scene 推进 Canon，正文版本仍为 v2',async()=>{const other=await ready([],{},a);other.output=await commit(other);const s=await chain(b,2,3);assert.equal(Number(other.output.success_commit_sequence),3);return JSON.stringify({other:other.output,current:s.current,watermark:s.watermark});});
  await sub(t,'同身份继续 v3，正文版本号 3 与成功水位 4 分离',async()=>{v3=await revisionReady(b);v3.output=await commit(v3);const s=await chain(v3,3,4);assert.equal(Number(v3.output.success_commit_sequence),4);for(let i=0;i<2;i++){assert.deepEqual(s.commits[i],v2.commits[i]);assert.deepEqual(s.outputs[i],v2.outputs[i]);}return JSON.stringify({output:v3.output,current:s.current,versions:s.texts.map(v=>({id:v.canonical_text_version_id,no:v.version_no}))});});
  await sub(t,'正常读取 v3，明确历史 ID 仍读取 v1/v2 正文及来源',async()=>observe(async c=>{const current=(await c.query(`SELECT v.* FROM ${q('canonical_text_identity')} i JOIN ${q('canonical_text_version')} v ON v.canonical_text_version_id=i.current_canonical_text_version_id WHERE i.canonical_text_identity_id=$1`,[a.identity])).rows[0];assert.equal(current.canonical_text_version_id,v3.output.canonical_text_version_id);const history=(await c.query(`SELECT v.*,cc.candidate_version_id,cc.approval_id,cc.payload_hash,cc.result FROM ${q('canonical_text_version')} v JOIN ${q('canon_commit')} cc USING(canon_commit_id) WHERE v.canonical_text_version_id=ANY($1) ORDER BY version_no`,[[a.output.canonical_text_version_id,b.output.canonical_text_version_id]])).rows;assert.equal(history.length,2);assert.equal(history[0].body,v1.texts[0].body);assert.ok(history.every(v=>v.result==='committed'));return JSON.stringify({current,history});}));
  await sub(t,'Validation 摘要实际包含不可变意图、旧身份/版本/实际正文摘要',async()=>observe(async c=>{const manifest=(await c.query(`SELECT manifest FROM ${q('candidate_submission_manifest')} WHERE candidate_version_id=$1`,[b.candidate])).rows[0].manifest;assert.deepEqual(manifest.revision.intent,b.intent);assert.equal(manifest.revision.old_version.version_no,1);assert.equal(manifest.revision.old_version.actual_body_hash,v1.texts[0].content_hash);assert.equal(manifest.members.length,0);const hashValue=await call(c,'validation_input_hash',b.candidate,b.design,b.canon,b.rule);const validationRow=(await c.query(`SELECT * FROM ${q('validation_run')} WHERE validation_run_id=$1`,[b.validation])).rows[0];assert.equal(hashValue,validationRow.input_hash);return JSON.stringify({manifest,validation:validationRow});}));
});

scenario('B 修订资格与审批绑定',async t=>{
  for(const mode of ['missing','old'])await sub(t,`${mode} 新审批拒绝`,async()=>{const a=await initial();const b=await revision(a);const r=request(b,{approval_id:mode==='missing'?'missing-approval':a.approval});return rejectUnchanged(b,()=>commit(b,'bad-approval',r),'commit admission',mode==='missing'?'request_input_missing':'admission_approval_candidate_identity');});
  for(const change of ['selection','approval','canon'])await sub(t,`预检查通过后 ${change} 改变，提交重新拒绝`,async()=>{const a=await initial();const b=await revisionReady(a);assert.equal((await precheck(b)).accepted,true);let reason;
    if(change==='selection'){await invoke('select_candidate',b.workflow,null,1);reason='admission_selection_version_conflict';}
    if(change==='approval'){await invalidate(b);reason='admission_approval_invalidated';}
    if(change==='canon'){const other=await ready([],{},a);await commit(other);reason='stale_canon_watermark';}
    return rejectUnchanged(b,()=>commit(b,'after-precheck'),'commit admission',reason);
  });
  await sub(t,'意图创建必须早于冻结，冻结后追加失败',async()=>{const a=await initial();const b=await revision(a,{intent:false});return rejectUnchanged(b,()=>tx(c=>insert(c,'candidate_revision_intent',b.intent)),'INSERT:intent','candidate_set_frozen');});
  for(const field of ['reason','expected_old_text_version_id','canonical_text_identity_id'])await sub(t,`不可原地改变意图 ${field}`,async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>tx(c=>c.query(`UPDATE ${q('candidate_revision_intent')} SET ${field}=$1 WHERE candidate_version_id=$2`,[field==='reason'?'另一个原因':id('changed'),b.candidate])),'UPDATE:intent','immutable_candidate_revision_intent');});
  await sub(t,'新 Candidate 的不同修订原因不能复用旧 Validation 或 Approval',async()=>{const a=await initial();const b=await revisionReady(a);const c=await revision(a,{reason:'另一个经审批的修订原因'});const oldValidation=await observe(async conn=>(await conn.query(`SELECT * FROM ${q('validation_run')} WHERE validation_run_id=$1`,[b.validation])).rows[0]);
    await rejectUnchanged(c,()=>tx(conn=>insert(conn,'validation_run',{...oldValidation,validation_run_id:id(),candidate_version_id:c.candidate,request_key:id()})),'INSERT:Validation','validation_input_hash');
    await rejectUnchanged(c,()=>approve(c,'old-validation',{...c.binding,validation_run_id:b.validation}),'new approval','approval_validation');
    return rejectUnchanged(c,()=>commit(c,'old-approval',request(c,{approval_id:b.approval})),'commit admission','admission_approval_candidate_identity');
  });
  await sub(t,'同一 Candidate 伪造冻结意图摘要不能进入 Validation',async()=>{
    const b=await revision(await initial(),{freeze:false});
    const forged=await observe(c=>call(c,'candidate_manifest',b.candidate));forged.revision.intent.reason='客户端替换的原因';
    await rejectUnchanged(b,()=>tx(async c=>insert(c,'candidate_submission_manifest',{candidate_version_id:b.candidate,manifest:forged,manifest_hash:(await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS h`,[forged])).rows[0].h,digest_spec_version:'fixture-frozen-set-v1'})),'INSERT:freeze','frozen_manifest_mismatch');
    await tx(async c=>{await finishOn(c,b);await c.query('COMMIT');});
    const proof=await rejectUnchanged(b,()=>tx(async c=>{const m=(await c.query(`SELECT * FROM ${q('candidate_submission_manifest')} WHERE candidate_version_id=$1`,[b.candidate])).rows[0];
      const badHash=(await c.query(`SELECT ${q('digest_text')}(jsonb_build_array('validation-text-supersession-v1',${q('validation_base_hash')}($1,$2,$3,$4),$5::text,$6::jsonb,'fixture-conversion-v1')::text) AS h`,[b.candidate,b.design,b.canon,b.rule,m.manifest_hash,forged])).rows[0].h;
      return insert(c,'validation_run',{validation_run_id:id('forged_validation'),candidate_version_id:b.candidate,request_key:id(),author_design_revision_id:b.design,input_canon_watermark:b.canon,rule_set_version:b.rule,validator_version:'fixture-validator-v1',input_hash:badHash,result:'pass'});
    }),'INSERT:Validation','validation_input_hash');
    await approve(b);await commit(b);await chain(b,2);return {...proof,evidence:JSON.stringify({sameCandidate:b.candidate,onlyForgedReason:forged.revision.intent.reason,actualReason:b.intent.reason,rejection:proof})};
  });
  await sub(t,'刷新 Canon 并重新审批，仍以过时 v1 为目标时因非当前拒绝',async()=>{const a=await initial();const b=await revisionReady(a);b.output=await commit(b);const stale=await revisionReady(a);assert.equal(stale.canon,2);assert.equal((await precheck(stale)).accepted,true);return rejectUnchanged(stale,()=>commit(stale,'stale-target'),'locked current compare','revision_old_not_current');});
  for(const scope of ['identity','project'])await sub(t,`真实跨 ${scope} 旧版本拒绝`,async()=>{const a=await initial();const other=scope==='project'?await initial():await ready([],{},a);if(!other.output)other.output=await commit(other);return expectSql(()=>revision(a,{old:other.output.canonical_text_version_id}),'INSERT:intent','P0001','revision_intent_scope');});
  await sub(t,'请求身份不能脱离审批覆盖的修订身份',async()=>{const a=await initial();const other=await ready([],{},a);const b=await revisionReady(a);return rejectUnchanged(b,()=>commit(b,'cross-identity',request(b,{canonical_text_identity_id:other.identity})),'request','revision_intent_request_identity');});
  await sub(t,'真实旧 Commit 含三类结构化 Canon 对象，拒绝纯正文替代',async()=>{const a=await initial(kinds);const s=await snapshot(a);assert.equal(s.outputs[0].objects.length,3);const b=await revisionReady(a);return rejectUnchanged(b,()=>commit(b,'old-structured'),'locked old commit','revision_old_structured_forbidden');});
  await sub(t,'新修订真实非空冻结提案拒绝',async()=>{const a=await initial();const b=await revisionReady(a,{types:[kinds[0]]});return rejectUnchanged(b,()=>commit(b,'new-structured'),'request','revision_new_structured_forbidden');});
  await sub(t,'没有修订意图的 Candidate 不能声明修订',async()=>{const a=await initial();const b=await revision(a,{intent:false});await approve(b);return rejectUnchanged(b,()=>commit(b,'no-intent'),'request','revision_intent_required');});
  for(const mode of ['reversal','compensation','supersede_commit','supersede_event','supersede_fact','supersede_state_transition'])await sub(t,`范围外模式 ${mode} 拒绝`,async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>commit(b,'unsupported',request(b,{mode})),'request','revision_mode_not_supported');});
  for(const [field,value,reason] of [['batch',[], 'batch_not_supported'],['reason','未绑定原因','unknown_request_field'],['target_type','canon_commit','unknown_request_field'],['expected_old_text_version_id','other','unknown_request_field']])await sub(t,`请求额外字段 ${field} 拒绝`,async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>commit(b,'extra',request(b,{[field]:value})),'request',reason);});
});

scenario('C 普通 DML 与关系完整性',async t=>{
  await sub(t,'public search_path 下完整直接 DML 可以真实提交',async()=>{const b=await revisionReady(await initial());const cc=await tx(async c=>{const row=await manualRevision(c,b,'direct-positive');await c.query('COMMIT');return row;});const s=await chain(b,2);assert.equal(s.texts.find(v=>v.version_no===2).canon_commit_id,cc.canon_commit_id);return JSON.stringify({commit:cc.canon_commit_id,current:s.current,outputs:s.outputs[1]});});
  const cases=[
    ['缺替代关系',{omitRelation:true},'supersession_missing'],
    ['缺目标支撑',{omitTarget:true},'supersession_target_missing'],
    ['replacement 指向真实旧 Commit',null,'supersession_binding'],
    ['关系 reason 不同于已审批意图',{relationRow:{reason:'未经审批的另一原因'}},'supersession_binding'],
    ['正文版本跳到 3',{textRow:{version_no:3}},'text_chain_version_gap'],
    ['缺正文 Item',{omit:'item'},'commit_item_missing'],
    ['缺正文 Item 支撑',{omit:'support'},'commit_text_support_missing'],
    ['缺全部必需 Outbox',{omitOutbox:true},'commit_outbox_set'],
  ];
  for(const [label,options,reason] of cases)await sub(t,label,async()=>{const a=await initial();const b=await revisionReady(a);return deferredRevision(b,options??{relationRow:{replacement_commit_id:a.output.canon_commit_id}},reason);});
  await sub(t,'缺正文在真实 COMMIT 拒绝',async()=>{const b=await revisionReady(await initial());return deferredRevision(b,{omit:'text'},'commit_text_version_fk','23503');});
  await sub(t,'第二条必需 Outbox 遗漏独立拒绝',async()=>{const b=await revisionReady(await initial());let inserted=false;const before=await snapshot(b);const proof=await expectSql(()=>tx(async c=>{const cc=await manualRevision(c,b,'one-outbox',{omitOutbox:true});await writeOneOutbox(c,b,cc,'fixture_graph');inserted=true;await c.query('COMMIT');}),'COMMIT','P0001','commit_outbox_set');assert.ok(inserted);await unchanged(b,before);return proof;});
  for(const [label,patch,code,constraint] of [
    ['版本重复产生分叉',{version_no:1},'23505','canonical_text_version_canonical_text_identity_id_version_n_key'],
    ['零版本',{version_no:0},'23514','canonical_text_version_version_no_check']
  ])await sub(t,label,async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'bad-version',{textRow:patch})),'INSERT:text',constraint,code);});
  for(const kind of ['canon_commit','story_event','canon_fact','state_transition'])await sub(t,`真实 ${kind} 不能用作本批关系目标`,async()=>{const structured=await initial(kinds);const b=await revisionReady(await initial());const objects=structured.output.complete_output.objects;const column={canon_commit:'target_commit_id',story_event:'target_story_event_id',canon_fact:'target_fact_id',state_transition:'target_state_transition_id'}[kind];const value=kind==='canon_commit'?structured.output.canon_commit_id:objects.find(o=>o.kind===kind).id;
    return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'bad-type',{targetRow:{target_type:kind,target_text_version_id:null,[column]:value}})),'INSERT:relation target',undefined,'23502');
  });
  for(const kind of ['canon_commit','story_event','canon_fact','state_transition'])await sub(t,`仅替换 discriminator 为 ${kind} 亦拒绝`,async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'wrong-discriminator',{targetRow:{target_type:kind}})),'INSERT:target discriminator','canon_relation_target_target_type_check','23514');});
  await sub(t,'关系目标同时填两个真实 FK 拒绝',async()=>{const a=await initial();const b=await revisionReady(a);return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'xor',{targetRow:{target_commit_id:a.output.canon_commit_id}})),'INSERT:relation target','text_relation_target_shape','23514');});
  for(const target of ['self','other-identity','other-project'])await sub(t,`真实 ${target} 正文目标在 ${target==='other-project'?'FK 锁前':'COMMIT'} 拒绝`,async()=>{const a=await initial();let other;if(target!=='self'){other=target==='other-project'?await initial():await ready([],{},a);if(!other.output)other.output=await commit(other);}const b=await revisionReady(a);const before=await snapshot(b);let inserted=false;
    const proof=await expectSql(()=>tx(async c=>{const cc=await manualText(c,b,'wrong-target');const targetId=target==='self'?cc.canonical_text_version_id:other.output.canonical_text_version_id;const ref=id('ref');await insert(c,'canon_relation_target',{target_ref_id:ref,relation_kind:'supersession',target_type:'canonical_text',target_text_version_id:targetId,created_by_commit_id:cc.canon_commit_id});await insert(c,'supersession_relation',{canon_commit_id:cc.canon_commit_id,target_ref_id:ref,replacement_commit_id:cc.canon_commit_id,reason:b.intent.reason});await writeOutbox(c,b,cc);inserted=true;await c.query('COMMIT');}),target==='other-project'?'INSERT:relation target':'COMMIT','P0001',target==='other-project'?'relation_target_project_mismatch':'supersession_binding');assert.equal(inserted,target!=='other-project');await unchanged(b,before);return {...proof,evidence:JSON.stringify({allForeignKeysReal:true,rejection:proof,counts:before.physicalCounts})};
  });
  await sub(t,'真实跨项目 replacement 在 FK 锁之前拒绝',async()=>{const other=await initial();const b=await revisionReady(await initial());return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'foreign-replacement',{relationRow:{replacement_commit_id:other.output.canon_commit_id}})),'INSERT:relation','relation_target_project_mismatch');});
  await sub(t,'目标由真实旧 Commit 创建拒绝历史追加',async()=>{const a=await initial();const b=await revisionReady(a);return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'wrong-creator',{targetRow:{created_by_commit_id:a.output.canon_commit_id}})),'INSERT:target','historical_output_append');});
  await sub(t,'关系由真实旧 Commit 创建拒绝历史追加',async()=>{const a=await initial();const b=await revisionReady(a);return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'wrong-relation-creator',{relationRow:{canon_commit_id:a.output.canon_commit_id}})),'INSERT:relation','historical_output_append');});
  await sub(t,'两个 target_ref 包装同一旧正文不能绕过单一接续',async()=>{const b=await revisionReady(await initial());return rejectUnchanged(b,()=>tx(async c=>{const cc=await manualRevision(c,b,'duplicate-ref');await insert(c,'canon_relation_target',{target_ref_id:id('duplicate'),relation_kind:'supersession',target_type:'canonical_text',target_text_version_id:b.old,created_by_commit_id:cc.canon_commit_id});}),'INSERT:target','one_successor_per_old_text','23505');});
  await sub(t,'直接 DML 不能复用旧 Approval',async()=>{const a=await initial();const b=await revisionReady(a);return rejectUnchanged(b,()=>tx(c=>manualRevision(c,b,'old-approval',{request:request(b,{approval_id:a.approval}),commitRow:{approval_id:a.approval}})),'INSERT:commit','admission_approval_candidate_identity');});
  await sub(t,'派生当前版本不可伪造跨身份或跳链指针',async()=>{const a=await initial();const b=await initial();return rejectUnchanged(a,()=>tx(c=>c.query(`UPDATE ${q('canonical_text_identity')} SET current_canonical_text_version_id=$1 WHERE canonical_text_identity_id=$2`,[b.output.canonical_text_version_id,a.identity])),'UPDATE:current view','readonly_canonical_text_identity');});
  const historical=await revisionReady(await initial());historical.output=await commit(historical);
  for(const table of ['canon_relation_target','supersession_relation'])await sub(t,`后续 INSERT 不能扩充历史 ${table}`,async()=>{const original=await observe(async c=>(await c.query(`SELECT * FROM ${q(table)} WHERE ${table==='canon_relation_target'?'created_by_commit_id':'canon_commit_id'}=$1`,[historical.output.canon_commit_id])).rows[0]);const row={...original,[table==='canon_relation_target'?'target_ref_id':'relation_id']:id('late')};return rejectUnchanged(historical,()=>tx(c=>insert(c,table,row)),'INSERT:historical','historical_output_append');});
  const immutableColumns={candidate_revision_intent:'reason',canon_commit:'result',canonical_text_version:'body',canon_commit_item:'target_id',canon_commit_item_text_target:'canonical_text_version_id',canon_relation_target:'target_type',supersession_relation:'reason',projection_outbox:'target',operation_audit:'event_kind',approval_invalidation_record:'reason_code',story_event:'predicate',canon_fact:'fact_key',state_transition:'transition_key',evidence_reference:'evidence_kind',evidence_canon_source:'canonical_text_version_id',candidate_to_canon_mapping:'candidate_object_id',candidate_to_canon_candidate_source:'candidate_object_id'};
  for(const [table,column] of Object.entries(immutableColumns))for(const op of ['UPDATE','DELETE','TRUNCATE'])await sub(t,`${table} ${op} 不可变`,async()=>{
    const expression=op==='UPDATE'?`UPDATE ${q(table)} SET ${column}=${column}`:op==='DELETE'?`DELETE FROM ${q(table)}`:`TRUNCATE ${q(table)} CASCADE`;
    return rejectUnchanged(historical,()=>tx(c=>c.query(expression)),`${op}:historical`,`immutable_${table}`);
  });
});
async function writeOneOutbox(c,x,cc,target){const strategy=target==='fixture_graph'?'fixture-graph-v1':'fixture-vector-v1';const event=(await c.query(`SELECT ${q('expected_outbox_event')}(jsonb_populate_record(NULL::${q('canon_commit')},$1::jsonb),$2,$3) AS e`,[cc,target,strategy])).rows[0].e;await insert(c,'projection_outbox',{canon_commit_id:cc.canon_commit_id,target,scope_key:x.scene,scope_hash:await call(c,'scope_digest',x.project,x.scene),source_canon_watermark:cc.canon_watermark,strategy_version:strategy,event_payload:event,event_hash:(await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS h`,[event])).rows[0].h});}
async function faultTrigger(table,reason){const name=id('test_fault');const condition=table==='projection_outbox'?"NEW.target='fixture_vector'":'true';await observe(c=>c.query(`CREATE FUNCTION ${q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, ${SCHEMA}, pg_temp AS $fault$
  BEGIN IF ${condition} THEN RAISE EXCEPTION USING ERRCODE='P0001',CONSTRAINT='${reason}',MESSAGE='${reason}',DETAIL=jsonb_build_object('texts',(SELECT count(*) FROM canonical_text_version WHERE canon_commit_id=NEW.canon_commit_id),'targets',(SELECT count(*) FROM canon_relation_target WHERE created_by_commit_id=NEW.canon_commit_id),'relations',(SELECT count(*) FROM supersession_relation WHERE canon_commit_id=NEW.canon_commit_id),'items',(SELECT count(*) FROM canon_commit_item WHERE canon_commit_id=NEW.canon_commit_id),'outbox',(SELECT count(*) FROM projection_outbox WHERE canon_commit_id=NEW.canon_commit_id))::text;END IF;RETURN NEW;END $fault$;CREATE TRIGGER ${name} BEFORE INSERT ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION ${q(name)}();`));return ()=>observe(c=>c.query(`DROP TRIGGER ${name} ON ${q(table)};DROP FUNCTION ${q(name)}();`));}
scenario('D 故障与真实 COMMIT 原子回滚',async t=>{
  for(const [table,reason,relations,outbox] of [['supersession_relation','fixture_relation_failure',0,0],['projection_outbox','fixture_second_outbox_failure',1,1]])await sub(t,`${table} 写入失败，所有输出及维护回滚后同 key 重试`,async()=>{const b=await revisionReady(await initial());const before=await snapshot(b);const remove=await faultTrigger(table,reason);let proof;let rolledBack;try{proof=await expectSql(()=>commit(b,'retry'),'INSERT:fault','P0001',reason);const detail=JSON.parse(proof.detail);assert.deepEqual(detail,{texts:1,targets:1,relations,items:1,outbox});rolledBack=await unchanged(b,before);}finally{await remove();}const output=await commit(b,'retry');const after=await chain(b,2);return {...proof,evidence:JSON.stringify({failure:proof,physicalBefore:before.physicalCounts,countsAfterRollback:rolledBack.physicalCounts,currentAfterRollback:rolledBack.current,watermarkAfterRollback:rolledBack.watermark,auditsAfterRollback:rolledBack.audits,invalidationsAfterRollback:rolledBack.invalidations,retried:output,countsAfterRetry:after.physicalCounts})};});
  for(const variant of ['missing','wrong'])await sub(t,`真实 COMMIT ${variant} 关系失败，修复后同 key 重试`,async()=>{const a=await initial();const b=await revisionReady(a);const options=variant==='missing'?{omitRelation:true}:{relationRow:{replacement_commit_id:a.output.canon_commit_id}};const proof=await deferredRevision(b,options,variant==='missing'?'supersession_missing':'supersession_binding','P0001','retry');const output=await commit(b,'retry');await chain(b,2);return {...proof,evidence:JSON.stringify({failure:proof,retried:output})};});
  await sub(t,'函数返回仍不可见，外层 ROLLBACK 后同 key 重试',async()=>{const b=await revisionReady(await initial());const before=await snapshot(b);let returned;await tx(async c=>{returned=await commitOn(c,b,'rollback-key');assert.equal(returned.requires_outer_commit,true);await unchanged(b,before);await c.query('ROLLBACK');});await unchanged(b,before);const retried=await commit(b,'rollback-key');assert.notEqual(retried.canon_commit_id,returned.canon_commit_id);await chain(b,2);return JSON.stringify({returned,retried,countsAfterRollback:before.physicalCounts,currentAfterRollback:before.current,auditsAfterRollback:before.audits,invalidationsAfterRollback:before.invalidations});});
});

scenario('E 历史幂等与修订竞争',async t=>{
  await sub(t,'v3 后重放 v2 返回原全部输出且当前仍为 v3',async()=>{const a=await initial();const b=await revisionReady(a);b.output=await commit(b,'v2');const c=await revisionReady(b);c.output=await commit(c,'v3');const before=await snapshot(c);const replay=await commit(b,'v2');assert.equal(replay.result,'replayed');assert.deepEqual({...replay,result:b.output.result},b.output);await unchanged(c,before);await chain(c,3);return JSON.stringify({v2:b.output,v3:c.output,replay,current:before.current});});
  await sub(t,'同 key 不同已审批修订输入摘要拒绝',async()=>{const a=await initial();const b=await revisionReady(a);const c=await revisionReady(a,{reason:'其他原因'});await commit(b,'same-key');return rejectUnchanged(c,()=>commit(c,'same-key'),'idempotency before current admission','commit_idempotency_conflict');});
  for(const release of ['COMMIT','ROLLBACK'])await sub(t,`相同 key 修订等待 A ${release}`,async()=>{const b=await revisionReady(await initial());const r=await race(b,c=>commitOn(c,b,'same'),c=>commitOn(c,b,'same'),release);assert.ok(!r.error,r.error?.message);assert.equal(r.value.result,release==='COMMIT'?'replayed':'created_in_transaction');if(release==='COMMIT')assert.deepEqual(r.value.complete_output,r.firstResult.complete_output);else assert.notEqual(r.value.canon_commit_id,r.firstResult.canon_commit_id);await chain(b,2);return r;});
  await sub(t,'两个 key 同时替代同一旧版本，仅一个成功且记录实际失效条件',async()=>{const a=await initial();const b=await revisionReady(a);const c=await revisionReady(a);const r=await race(b,conn=>commitOn(conn,b,'one'),conn=>commitOn(conn,c,'two'));assert.equal(r.error?.code,'P0001');assert.equal(r.error?.constraint,'stale_canon_watermark');await chain(b,2);return {...r,code:r.error.code,constraint:r.error.constraint};});
  await sub(t,'不同项目相同 key 相互隔离，A 持锁不阻止 B 提交',async()=>{const a=await revisionReady(await initial());const b=await revisionReady(await initial());const ca=await connect(),cb=await connect();try{await begin(ca);await begin(cb);const first=await commitOn(ca,a,'isolated');const second=await commitOn(cb,b,'isolated');await cb.query('COMMIT');const visibleB=await chain(b,2);assert.equal((await snapshot(a)).watermark,1);await ca.query('COMMIT');await chain(a,2);assert.notEqual(first.canon_commit_id,second.canon_commit_id);return JSON.stringify({first,second,visibleB:visibleB.current});}finally{await close(ca);await close(cb);}});
  await sub(t,'函数固定 search_path，故障设施已清理，无外部投影执行表',async()=>observe(async c=>{const funcs=(await c.query(`SELECT p.proname,p.proconfig,p.prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY proname`,[SCHEMA])).rows;for(const f of funcs){assert.deepEqual(f.proconfig,[`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);assert.equal(f.prosecdef,false);assert.ok(!f.proname.startsWith('test_fault'));}const tables=(await c.query(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename`,[SCHEMA])).rows.map(r=>r.tablename);for(const name of ['publication_record','impact_assessment','projection_task','projection_attempt'])assert.ok(!tables.includes(name));return JSON.stringify({functions:funcs.length,searchPath:`pg_catalog, ${SCHEMA}, pg_temp`,noFaultFunctions:true,excludedTables:['publication_record','impact_assessment','projection_task','projection_attempt']});}));
});
