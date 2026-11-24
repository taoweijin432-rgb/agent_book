import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'canon_structured_fixture';
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
async function candidate(c,x){const body='角色走进庭院。物品是蓝色。初始状态为清醒。';await insert(c,'candidate_version',{candidate_version_id:x.candidate,workflow_id:x.workflow,bundle_id:x.bundle,generation_id:x.generation,origin:'model',bundle_basis:'direct',body,content_hash:await hash(c,body)});}
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
function request(x,extra={}){return {digest_spec_version:'canon-structured-request-v1',mode:'initial_text',workflow_id:x.workflow,candidate_version_id:x.candidate,selection_version:x.version,approval_id:x.approval,input_canon_watermark:x.canon,canonical_text_identity_id:x.identity,projection_config_id:'fixture-targets-v1',structured_outputs:x.proposals,...extra};}
const commitOn=(c,x,key='commit-key',r=request(x))=>call(c,'commit_text',x.project,key,r);
const commit=(x,key='commit-key',r=request(x))=>invoke('commit_text',x.project,key,r);
const invalidate=x=>invoke('invalidate_approval',x.approval,'fixture_change','fixture-manual','v1');
async function snapshot(x){return observe(async c=>{
  const commits=(await c.query(`SELECT * FROM ${q('canon_commit')} WHERE project_id=$1 ORDER BY success_commit_sequence`,[x.project])).rows;
  const outputs=[];for(const cc of commits)outputs.push(await call(c,'commit_output_manifest',cc.canon_commit_id));
  const current=(await c.query(`SELECT i.* FROM ${q('canonical_text_identity')} i JOIN ${q('chapter')} ch USING(chapter_id) WHERE ch.project_id=$1 ORDER BY canonical_text_identity_id`,[x.project])).rows;
  const audits=(await c.query(`SELECT event_kind,count(*)::int AS n FROM ${q('operation_audit')} WHERE project_id=$1 GROUP BY event_kind ORDER BY event_kind`,[x.project])).rows;
  const invalidations=(await c.query(`SELECT count(*)::int AS n FROM ${q('approval_invalidation_record')} i JOIN ${q('approval_record')} a USING(approval_id) WHERE ${q('candidate_project')}(a.candidate_version_id)=$1`,[x.project])).rows[0].n;
  const texts=(await c.query(`SELECT v.* FROM ${q('canonical_text_version')} v JOIN ${q('canon_commit')} cc USING(canon_commit_id) WHERE cc.project_id=$1 ORDER BY canon_commit_id`,[x.project])).rows;
  const outbox=(await c.query(`SELECT o.* FROM ${q('projection_outbox')} o JOIN ${q('canon_commit')} cc USING(canon_commit_id) WHERE cc.project_id=$1 ORDER BY canon_commit_id,target`,[x.project])).rows;
  const physicalTables=['canon_commit','canonical_text_version','story_event','canon_fact','state_transition','evidence_reference','evidence_canon_source','canon_commit_item','canon_commit_item_text_target','canon_commit_item_story_event_target','canon_commit_item_fact_target','canon_commit_item_state_target','candidate_to_canon_mapping','candidate_to_canon_candidate_source','projection_outbox'];
  const physicalCounts=(await c.query(`SELECT ${physicalTables.map(table=>`(SELECT count(*)::int FROM ${q(table)}) AS ${table}`).join(',')}`)).rows[0];
  return {watermark:Number(await call(c,'current_watermark',x.project)),commits,outputs,current,audits,invalidations,texts,outbox,physicalCounts};
});}
async function unchanged(x,before){const actual=await snapshot(x);assert.deepEqual(actual,before);return actual;}
async function rejectUnchanged(x,action,stage,reason,code='P0001'){const before=await snapshot(x);const evidence=await expectSql(action,stage,code,reason);const after=await unchanged(x,before);return {...evidence,evidence:JSON.stringify({rejection:evidence,physicalCountsBefore:before.physicalCounts,physicalCountsAfter:after.physicalCounts})};}
async function complete(x,n=1){const s=await snapshot(x);assert.equal(s.watermark,n);assert.equal(s.commits.length,n);assert.equal(s.texts.length,n);assert.equal(s.outbox.length,n*2);
  for(let j=0;j<s.commits.length;j++){const cc=s.commits[j];const output=s.outputs[j];const expected=await observe(c=>call(c,'manifest_ids',cc.candidate_version_id));assert.equal(output.objects.length,expected.length);assert.equal(output.items.length,expected.length+1);assert.equal(output.targets.length,output.items.length);assert.equal(output.mappings.length,expected.length);assert.equal(output.mapping_sources.length,expected.length);assert.equal(output.evidence.length,expected.length?1:0);assert.equal(output.evidence_sources.length,output.evidence.length);
    const event=s.outbox.find(o=>o.canon_commit_id===cc.canon_commit_id);assert.deepEqual(event.event_payload.complete_output,output);assert.equal(event.event_payload.event_type,'fixture_canon_structured_committed_v1');
    for(const m of output.mappings){assert.notEqual(m.candidate_object_hash,m.candidate_content_hash);assert.ok(output.items.some(i=>i.commit_item_id===m.canon_commit_item_id&&i.source_mapping_id===m.mapping_id));}
  }return s;
}
async function race(x,first,second,release='COMMIT'){const a=await connect(),b=await connect(),o=await connect();try{await begin(a);await begin(b);const firstResult=await first(a);const blocker=await pid(a),waiter=await pid(b);const pending=second(b).then(value=>({value}),error=>({error}));const waiting=await blocked(o,waiter,blocker);const before=await snapshot(x);await a.query(release);const next=await pending;if(next.error)await b.query('ROLLBACK');else await b.query('COMMIT');return {firstResult,...next,stage:'concurrency',evidence:JSON.stringify({blocker,waiter,observer:await pid(o),waiting,release,visibleWatermark:before.watermark,visibleCommits:before.commits.length,firstResult,secondResult:next.value,secondError:next.error?.constraint})};}finally{await close(a);await close(b);await o.end();}}

scenario('A 合法冻结集合与完整结构化提交',async(t)=>{
  for(const types of [[],[kinds[0]],[kinds[1]],[kinds[2]],[kinds[0],kinds[0],kinds[1],kinds[2]]])await sub(t,`提交 ${types.join('+')||'正文空集合'}`,async()=>{const x=await ready(types);const response=await commit(x);const s=await complete(x);return JSON.stringify({response,objects:s.outputs[0].objects,counts:{items:s.outputs[0].items.length,evidence:s.outputs[0].evidence.length},watermark:s.watermark});});
  await sub(t,'集合换序不改变摘要，重放不增长任何输出',async()=>{const x=await ready();const first=await commit(x);const before=await snapshot(x);const second=await commit(x,'commit-key',request(x,{structured_outputs:[...x.proposals].reverse()}));assert.equal(second.result,'replayed');assert.deepEqual({...second,result:first.result},first);await unchanged(x,before);return JSON.stringify({first,second});});
  await sub(t,'重复提案显式拒绝',async()=>{const x=await ready();return rejectUnchanged(x,()=>commit(x,'duplicate',request(x,{structured_outputs:[...x.proposals,x.proposals[0]]})),'request normalization','duplicate_proposal');});
});
async function manualText(c, x, key, options = {}) {
  const r = options.request ?? request(x); const textId = id('text_version');
  const row = { canon_commit_id: id('commit'), project_id: x.project, workflow_id: x.workflow, candidate_version_id: x.candidate, selection_version: x.version,
    approval_id: x.approval, approval_policy_version: x.policy, idempotency_key: key, digest_spec_version: 'canon-structured-request-v1', request_payload: r,
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
  return cc;
}
async function sibling(x,types=[kinds[0]]){return tx(async c=>{const y={...x,candidate:id('candidate'),validation:id('validation'),proposals:[],version:2};delete y.approval;await candidate(c,y);for(const kind of types)y.proposals.push(await proposal(c,y,kind));await finishOn(c,y);await c.query('COMMIT');return y;});}
async function manualStructured(c,x,key,options={}){
  const cc=await manualText(c,x,key,options);const ps=(await c.query(`SELECT * FROM ${q('all_candidate_proposals')} WHERE candidate_version_id=$1 ORDER BY kind COLLATE "C",id COLLATE "C"`,[x.candidate])).rows;
  const entries=[];const shared=id('shared_target');const evByLoc=new Map();
  for(let index=0;index<ps.length;index++){
    const p=ps[index];const a=(await c.query(`SELECT * FROM ${q('narrative_assertion')} WHERE assertion_id=$1`,[p.assertion_id])).rows[0];const locKey=JSON.stringify(a.locator);let ev=evByLoc.get(locKey);
    if(!ev){ev=id('evidence');await insert(c,'evidence_reference',{evidence_reference_id:ev,source_domain:'canon',source_version_id:options.badEvidenceVersion?cc.canon_commit_id:cc.canonical_text_version_id,source_object_type:'canonical_text_version',source_object_id:cc.canonical_text_version_id,locator:options.badLocator?{start:0,end:1,quote:'错误'}:a.locator,evidence_kind:'fixture_assertion_span'});if(!options.omitEvidenceSource)await insert(c,'evidence_canon_source',{evidence_reference_id:ev,canonical_text_version_id:cc.canonical_text_version_id,canon_commit_id:cc.canon_commit_id});evByLoc.set(locKey,ev);}
    const kind=targetKind[p.kind];const objectId=options.reuseSourceId&&index===0?p.id:options.sharedTargetIds&&['story_event','canon_fact'].includes(kind)?shared:id('canon_object');
    const data=(await c.query(`SELECT ${q('expected_canon_fields')}($1,$2,jsonb_populate_record(NULL::${q('canon_commit')},$3::jsonb)) AS data`,[p.kind,p.payload,cc])).rows[0].data;
    await insert(c,kind,{...data,[targetIdColumn[kind]]:objectId,evidence_reference_id:ev,...(index===0?options.canonRow:{} )});
    entries.push({p,kind,objectId,item:id(index===0?'a_item':'b_item'),mapping:id('mapping')});
  }
  for(let index=0;index<entries.length;index++){
    const e=entries[index];if(index===0&&options.omitItem)continue;
    const backref=index===0&&options.badBackref?entries[1].mapping:e.mapping;
    await insert(c,'canon_commit_item',{commit_item_id:e.item,canon_commit_id:cc.canon_commit_id,target_type:e.kind,target_id:e.objectId,source_mapping_id:backref});
  }
  for(let index=0;index<entries.length;index++){
    const e=entries[index];if(index===0&&options.omitItem)continue;
    const mappingRow={mapping_id:e.mapping,canon_commit_id:cc.canon_commit_id,candidate_version_id:x.candidate,candidate_object_type:e.p.kind,candidate_object_id:e.p.id,canon_commit_item_id:e.item,candidate_object_hash:e.p.object_hash,candidate_content_hash:x.binding.candidate_content_hash,...(index===0?options.mappingRow:{})};
    if(index===0&&options.bareTarget)mappingRow.canon_commit_item_id=e.objectId;
    await insert(c,'candidate_to_canon_mapping',mappingRow);
    if(!(index===0&&options.omitMappingSource)){
      const kind=index===0&&options.sourceTypeSwap?kinds[1]:e.p.kind;
      const sourceId=index===0&&options.sourceIdSwap?entries.find((other,j)=>j>0&&other.p.kind===e.p.kind).p.id:e.p.id;
      await insert(c,'candidate_to_canon_candidate_source',{mapping_id:e.mapping,candidate_object_type:kind,candidate_object_id:sourceId,candidate_event_id:kind===kinds[0]?sourceId:null,candidate_fact_proposal_id:kind===kinds[1]?sourceId:null,candidate_state_transition_id:kind===kinds[2]?sourceId:null,...(index===0?options.sourceRow:{})});
    }
    if(index===0&&options.omitTarget)continue;
    if(options.multipleTargets&&index===1)continue;
    const kind=options.targetTypeSwap?e.kind==='story_event'?'canon_fact':e.kind==='canon_fact'?'story_event':e.kind:e.kind;
    const objectId=options.targetIdSwap?entries[index===0?1:0].objectId:e.objectId;
    await insert(c,supportTable[kind],{commit_item_id:e.item,[targetIdColumn[kind]]:objectId});
    if(options.multipleTargets&&index===0){const other=entries[1];await insert(c,supportTable[other.kind],{commit_item_id:e.item,[targetIdColumn[other.kind]]:other.objectId});}
  }
  const preconditions=options.precheck?await options.precheck(c,{cc,entries}):null;
  await writeOutbox(c,x,cc);
  return {cc,entries,preconditions};
}
async function writeOutbox(c,x,cc){for(const target of ['fixture_graph','fixture_vector']){const strategy=target==='fixture_graph'?'fixture-graph-v1':'fixture-vector-v1';const event=(await c.query(`SELECT ${q('expected_outbox_event')}(jsonb_populate_record(NULL::${q('canon_commit')},$1::jsonb),$2,$3) AS e`,[cc,target,strategy])).rows[0].e;
  await insert(c,'projection_outbox',{canon_commit_id:cc.canon_commit_id,target,scope_key:x.scene,scope_hash:await call(c,'scope_digest',x.project,x.scene),source_canon_watermark:cc.canon_watermark,strategy_version:strategy,event_payload:event,event_hash:(await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS h`,[event])).rows[0].h});}}
async function deferred(x,options,reason){let inserts=false;let prepared;const before=await snapshot(x);const proof=await expectSql(()=>tx(async c=>{prepared=await manualStructured(c,x,'negative',options);inserts=true;await c.query('COMMIT');}),'COMMIT','P0001',reason);assert.equal(inserts,true);const after=await unchanged(x,before);return {...proof,evidence:JSON.stringify({physicalCountsBefore:before.physicalCounts,physicalCountsAfter:after.physicalCounts,insertsSucceeded:inserts,preconditions:prepared.preconditions??'All FK, CHECK and unique preconditions passed INSERT',rejection:proof,independentAfter:{watermark:before.watermark,commits:before.commits.length,texts:before.texts.length,outbox:before.outbox.length}})};}

scenario('B 冻结集合、摘要与确认门禁',async(t)=>{
  for(const kind of kinds)await sub(t,`${kind} 冻结后追加被拒绝`,async()=>{const x=await ready([kind]);const row=await observe(async c=>(await c.query(`SELECT * FROM ${q(kind)} WHERE ${proposalIdColumn[kind]}=$1`,[x.proposals[0].id])).rows[0]);const copy={...row,[proposalIdColumn[kind]]:id('late')};if(kind===kinds[0])copy.event_key=id('late_event');if(kind===kinds[1])copy.fact_key=id('late_fact');if(kind===kinds[2])copy.transition_key=id('late_state');return rejectUnchanged(x,()=>tx(c=>insert(c,kind,copy)),'INSERT:proposal','candidate_set_frozen');});
  await sub(t,'第一次 Validation 必须已有冻结集合',async()=>{const x=await work(await project(),[],{freeze:false});return rejectUnchanged(x,()=>tx(c=>insert(c,'validation_run',{validation_run_id:x.validation,candidate_version_id:x.candidate,request_key:'before-freeze',author_design_revision_id:x.design,input_canon_watermark:x.canon,rule_set_version:x.rule,validator_version:'fixture-validator-v1',input_hash:'untrusted',result:'pass'})),'INSERT:validation','candidate_set_not_frozen');});
  await sub(t,'同正文新 Candidate 使用新提案，不能借旧 Validation/Approval/提案',async()=>{
    const x=await ready();const y=await sibling(x);assert.equal(x.binding.candidate_content_hash,y.binding.candidate_content_hash);await invoke('select_candidate',x.workflow,y.candidate,1);
    const oldValidation=await observe(async c=>(await c.query(`SELECT * FROM ${q('validation_run')} WHERE validation_run_id=$1`,[x.validation])).rows[0]);
    await rejectUnchanged(y,()=>tx(c=>insert(c,'validation_run',{...oldValidation,validation_run_id:id('wrong_validation'),candidate_version_id:y.candidate,request_key:'wrong-input'})),'INSERT:validation','validation_input_hash');
    await rejectUnchanged(y,()=>approve(y,'wrong-validation',{...y.binding,validation_run_id:x.validation}),'approval','approval_validation');
    await rejectUnchanged(y,()=>commit(y,'old-proposals',request(y,{approval_id:x.approval,structured_outputs:x.proposals})),'commit guard','request_frozen_set_mismatch');
    await rejectUnchanged(y,()=>commit(y,'old-approval',request(y,{approval_id:x.approval})),'commit admission','admission_approval_candidate_identity');
    await approve(y);await commit(y);const result=await complete(y);return JSON.stringify({newCandidate:y.candidate,oldCandidate:x.candidate,newObjects:result.outputs[0].objects});
  });
  for(const mode of ['direct_observation','lie','rumor','unknown'])await sub(t,`${mode} 无确认依据不能晋升客观 Fact`,async()=>{const x=await work(await project(),[kinds[1]],{confirm:false,assertionType:mode});return rejectUnchanged(x,()=>approve(x),'approval','proposal_confirmation_missing');});
  await sub(t,'匹配失败的观察记录不能仅凭 confirmed 标记确认',async()=>{
    const x=await work(await project(),[kinds[1]],{freeze:false,confirm:false});const a=await observe(async c=>(await c.query(`SELECT * FROM ${q('narrative_assertion')} WHERE candidate_version_id=$1`,[x.candidate])).rows[0]);
    return rejectUnchanged(x,()=>tx(async c=>{const record=id('false_basis');await insert(c,'fixture_world_record',{record_id:record,project_id:x.project,subject_entity_id:x.entity,predicate:a.assertion_payload.predicate,value:{confirmed:true,color:'red'},provenance:'fixture-observation-v1'});await insert(c,'assertion_confirmation_basis',{basis_id:id(),assertion_id:a.assertion_id,record_id:record,rule_version:'fixture-confirm-v1'});}),'INSERT:confirmation','confirmation_rule_mismatch');
  });
  await sub(t,'跨 Candidate 的真实 Assertion 不能绑定提案',async()=>{
    const x=await work(await project(),[],{freeze:false});const y=await ready([kinds[0]]);const row=await observe(async c=>(await c.query(`SELECT * FROM ${q('candidate_event')} WHERE candidate_event_id=$1`,[y.proposals[0].id])).rows[0]);
    return rejectUnchanged(x,()=>tx(c=>insert(c,'candidate_event',{...row,candidate_event_id:id(),candidate_version_id:x.candidate})),'INSERT:proposal','proposal_assertion_candidate');
  });
  await sub(t,'Assertion 来源不能指向另一个真实 Candidate',async()=>{const y=await ready([]);const base=await project();return expectSql(()=>work(base,[kinds[0]],{assertionSource:{source_version_id:y.candidate}}),'INSERT:assertion source','P0001','assertion_source_candidate');});
  for(const [label,field,reason] of [['提案 object_hash 不能使用实际正文 hash','proposal','proposal_actual_hash'],['Assertion 自身 hash 不能使用实际正文 hash','assertion','assertion_actual_hash']])await sub(t,label,async()=>{
    const x=await work(await project(),[],{freeze:false});const bodyHash=await observe(async c=>(await c.query(`SELECT content_hash FROM ${q('candidate_version')} WHERE candidate_version_id=$1`,[x.candidate])).rows[0].content_hash);
    const options=field==='proposal'?{proposalRow:{object_hash:bodyHash}}:{assertionRow:{assertion_hash:bodyHash}};
    return rejectUnchanged(x,()=>tx(c=>proposal(c,x,kinds[0],options)),'INSERT:actual digest',reason);
  });
  await sub(t,'Assertion 来源正文 hash 不能换成另一个实际提案 hash',async()=>{
    const y=await ready([kinds[0]]);const proposalHash=await observe(async c=>(await c.query(`SELECT object_hash FROM ${q('candidate_event')} WHERE candidate_event_id=$1`,[y.proposals[0].id])).rows[0].object_hash);assert.notEqual(proposalHash,y.binding.candidate_content_hash);
    const x=await work(await project(),[],{freeze:false});return rejectUnchanged(x,()=>tx(c=>proposal(c,x,kinds[0],{assertionRow:{source_content_hash:proposalHash}})),'INSERT:assertion','assertion_source_hash');
  });
  await sub(t,'提案不能借用另一个项目的真实 Entity',async()=>{const foreign=await ready([]);const base=await project();return expectSql(()=>work(base,[kinds[2]],{confirm:false,proposalRow:{entity_id:foreign.entity}}),'INSERT:proposal','P0001','proposal_entity_project');});
  await sub(t,'谎言即使引用观察记录也不能通过确认规则',async()=>{const base=await project();return expectSql(()=>work(base,[kinds[1]],{assertionType:'lie'}),'INSERT:confirmation','P0001','confirmation_rule_mismatch');});
  await sub(t,'SQL NULL 与 JSON null 区分，JSON null 也不是状态初始化依据',async()=>{const base=await project();return expectSql(()=>work(base,[kinds[2]],{proposalRow:{from_value:'null'}}),'INSERT:proposal','P0001','state_history_not_supported');});
  await sub(t,'不能伪造空冻结清单覆盖实际提案集合',async()=>{const x=await work(await project(),[kinds[0]],{freeze:false});return rejectUnchanged(x,()=>tx(async c=>{const manifest={version:'fixture-frozen-set-v1',candidate_id:x.candidate,members:[]};await insert(c,'candidate_submission_manifest',{candidate_version_id:x.candidate,manifest,manifest_hash:(await c.query(`SELECT ${q('digest_text')}($1::jsonb::text) AS hash`,[manifest])).rows[0].hash,digest_spec_version:'fixture-frozen-set-v1'});}),'INSERT:manifest','frozen_manifest_mismatch');});
  await sub(t,'实际正文、Assertion、Proposal、Validation、Commit 五种摘要各自独立',async()=>{
    const x=await ready([kinds[1]]);await commit(x);const values=await observe(async c=>(await c.query(`SELECT c.content_hash,a.assertion_hash,p.object_hash,v.input_hash,cc.payload_hash FROM ${q('candidate_version')} c JOIN ${q('candidate_fact_proposal')} p USING(candidate_version_id) JOIN ${q('narrative_assertion')} a ON a.assertion_id=p.assertion_id JOIN ${q('validation_run')} v ON v.candidate_version_id=c.candidate_version_id JOIN ${q('canon_commit')} cc ON cc.candidate_version_id=c.candidate_version_id WHERE c.candidate_version_id=$1`,[x.candidate])).rows[0]);assert.equal(new Set(Object.values(values)).size,5);return JSON.stringify(values);
  });
  for(const [label,options,reason] of [['非空 Event 时间引用',{proposalRow:{story_time_ref:'fixture-time-unsupported'}},'event_time_not_supported'],['非空历史 from_value',{proposalRow:{from_value:{state:'old'}}},'state_history_not_supported']])await sub(t,label,async()=>{const base=await project();return expectSql(()=>work(base,[label.startsWith('非空 Event')?kinds[0]:kinds[2]],options),'INSERT:proposal','P0001',reason);});
  for(const kind of [kinds[1],kinds[2]])await sub(t,`${kind} 仅首次新增，不覆盖已有 Canon`,async()=>{
    const base=await project();const x=await ready([kind],{},base);await commit(x);let options={};if(kind===kinds[1])options.factKey=await observe(async c=>(await c.query(`SELECT fact_key FROM ${q('candidate_fact_proposal')} WHERE candidate_fact_proposal_id=$1`,[x.proposals[0].id])).rows[0].fact_key);const y=await ready([kind],options,base);return rejectUnchanged(y,()=>commit(y,'existing'),'commit guard',kind===kinds[1]?'fact_initial_only':'state_initial_only');
  });
  for(const variant of ['subset','extra'])await sub(t,`请求不能提交冻结集合的 ${variant}`,async()=>{const x=await ready();const y=await ready([kinds[0]]);const members=variant==='subset'?x.proposals.slice(1):[...x.proposals,y.proposals[0]];return rejectUnchanged(x,()=>commit(x,'mismatch',request(x,{structured_outputs:members})),'commit guard','request_frozen_set_mismatch');});
});

scenario('C 跨表关系、类型与 ID 独立负例',async(t)=>{
  await sub(t,'合法完整直接 DML 仍能提交',async()=>{const x=await ready();await tx(async c=>{await manualStructured(c,x,'direct');await c.query('COMMIT');});const s=await complete(x);return JSON.stringify(s.outputs[0]);});
  for(const [label,options,reason] of [
    ['Canon 对象缺 Item',{omitItem:true},'commit_item_count'],
    ['Item 缺目标支撑',{omitTarget:true},'item_target_cardinality'],
    ['Item 多类型目标支撑',{multipleTargets:true},'item_target_cardinality'],
    ['Mapping 缺来源支撑',{omitMappingSource:true},'mapping_source_missing'],
    ['Item 与 Mapping 双向关系不一致',{badBackref:true},'item_mapping_missing'],
    ['Canon 目标复用了源提案身份',{reuseSourceId:true},'canon_source_identity_reused'],
    ['Evidence 缺 Canon 来源支撑',{omitEvidenceSource:true},'evidence_source_missing'],
    ['Evidence source_version_id 误用真实 Commit ID',{badEvidenceVersion:true},'evidence_source_scope'],
    ['Evidence locator 与实际正文不匹配',{badLocator:true},'evidence_locator'],
  ])await sub(t,label,async()=>{const x=await ready();return deferred(x,options,reason);});
  await sub(t,'Mapping 类型错绑：两类真实提案使用相同文本 ID',async()=>{
    const x=await ready(kinds,{sharedIds:true});assert.equal(x.proposals[0].id,x.proposals[1].id);
    return deferred(x,{sourceTypeSwap:true,precheck:async(c,{entries})=>{
      const m=entries.find(e=>e.p.kind===kinds[0]);const row=(await c.query(`SELECT s.*,m.candidate_object_type AS parent_type,m.candidate_object_id AS parent_id,num_nonnulls(s.candidate_event_id,s.candidate_fact_proposal_id,s.candidate_state_transition_id) AS columns FROM ${q('candidate_to_canon_candidate_source')} s JOIN ${q('candidate_to_canon_mapping')} m USING(mapping_id) WHERE mapping_id=$1`,[m.mapping])).rows[0];
      assert.notEqual(row.candidate_object_type,row.parent_type);assert.equal(row.candidate_object_id,row.parent_id);assert.equal(row.columns,1);
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${q('candidate_fact_proposal')} WHERE candidate_fact_proposal_id=$1`,[row.candidate_fact_proposal_id])).rows[0].n,1);return row;
    }},'mapping_source_type');
  });
  await sub(t,'Mapping ID 错绑：同类型两个真实提案，XOR 和 FK 均成立',async()=>{
    const x=await ready([kinds[0],kinds[0]]);
    return deferred(x,{sourceIdSwap:true,precheck:async(c,{entries})=>{
      const row=(await c.query(`SELECT s.*,m.candidate_object_type AS parent_type,m.candidate_object_id AS parent_id,num_nonnulls(s.candidate_event_id,s.candidate_fact_proposal_id,s.candidate_state_transition_id) AS columns FROM ${q('candidate_to_canon_candidate_source')} s JOIN ${q('candidate_to_canon_mapping')} m USING(mapping_id) WHERE mapping_id=$1`,[entries[0].mapping])).rows[0];
      assert.equal(row.candidate_object_type,row.parent_type);assert.notEqual(row.candidate_object_id,row.parent_id);assert.equal(row.columns,1);
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${q('candidate_event')} WHERE candidate_event_id=ANY($1::text[])`,[[row.parent_id,row.candidate_object_id]])).rows[0].n,2);return row;
    }},'mapping_source_id');
  });
  await sub(t,'Item 目标类型错绑：两类实际目标具有相同文本 ID',async()=>{
    const x=await ready([kinds[0],kinds[1]]);
    return deferred(x,{targetTypeSwap:true,sharedTargetIds:true,precheck:async(c,{entries})=>{
      assert.equal(entries[0].objectId,entries[1].objectId);
      const rows=(await c.query(`SELECT i.target_type,i.target_id,t.kind,t.id FROM ${q('canon_commit_item')} i JOIN ${q('all_item_targets')} t USING(commit_item_id) WHERE commit_item_id=ANY($1::text[])`,[entries.map(e=>e.item)])).rows;
      for(const r of rows){assert.notEqual(r.target_type,r.kind);assert.equal(r.target_id,r.id);}
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${q('all_canon_objects')} WHERE id=$1`,[entries[0].objectId])).rows[0].n,2);return rows;
    }},'item_target_type');
  });
  await sub(t,'Item 目标 ID 错绑：同类型两个真实目标',async()=>{
    const x=await ready([kinds[0],kinds[0]]);
    return deferred(x,{targetIdSwap:true,precheck:async(c,{entries})=>{
      const rows=(await c.query(`SELECT i.target_type,i.target_id,t.kind,t.id FROM ${q('canon_commit_item')} i JOIN ${q('all_item_targets')} t USING(commit_item_id) WHERE commit_item_id=ANY($1::text[])`,[entries.map(e=>e.item)])).rows;
      for(const r of rows){assert.equal(r.target_type,r.kind);assert.notEqual(r.target_id,r.id);}
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM ${q('story_event')} WHERE story_event_id=ANY($1::text[])`,[entries.map(e=>e.objectId)])).rows[0].n,2);return rows;
    }},'item_target_id');
  });
  for(const field of ['candidate_object_hash','candidate_content_hash'])await sub(t,`Mapping ${field} 不能与另一种实际摘要互换`,async()=>{
    const x=await ready([kinds[1]]);const actual=await observe(async c=>(await c.query(`SELECT object_hash FROM ${q('candidate_fact_proposal')} WHERE candidate_fact_proposal_id=$1`,[x.proposals[0].id])).rows[0].object_hash);assert.notEqual(actual,x.binding.candidate_content_hash);
    return deferred(x,{mappingRow:{[field]:field==='candidate_object_hash'?x.binding.candidate_content_hash:actual}},field==='candidate_object_hash'?'mapping_object_hash':'mapping_content_hash');
  });
  for(const [kind,change] of [[kinds[0],{predicate:'different actual action'}],[kinds[1],{fact_value:{color:'red'}}],[kinds[2],{to_value:{state:'asleep'}}]])await sub(t,`${kind} 的 Canon 实际内容不能偏离校验提案`,async()=>{const x=await ready([kind]);return deferred(x,{canonRow:change},'canon_conversion_content');});
  await sub(t,'Canon 对象项目必须与本次 Commit 一致',async()=>{const x=await ready([kinds[0]]);const y=await ready([]);return deferred(x,{canonRow:{project_id:y.project}},'canon_object_scope');});
  await sub(t,'Mapping Candidate/Workflow 不得跨真实项目借用',async()=>{const x=await ready([kinds[0]]);const y=await ready([]);return deferred(x,{mappingRow:{candidate_version_id:y.candidate}},'mapping_candidate_workflow');});
  await sub(t,'Commit 的 Workflow 不得借用其他真实 Workflow',async()=>{const x=await ready([kinds[0]]);const y=await ready([]);return rejectUnchanged(x,()=>commit(x,'wrong-workflow',request(x,{workflow_id:y.workflow})),'INSERT:commit','admission_workflow_mismatch');});
  await sub(t,'Mapping 不能以真实 Canon 对象 ID 替代 Item ID',async()=>{
    const x=await ready([kinds[0]]);return rejectUnchanged(x,()=>tx(async c=>{await manualStructured(c,x,'bare',{bareTarget:true});await c.query('COMMIT');}),'INSERT:mapping','candidate_to_canon_mapping_canon_commit_item_id_fkey','23503');
  });
  for(const columns of [0,2])await sub(t,`Mapping 三类来源列必须 XOR，实际非空 ${columns}`,async()=>{
    const x=await ready([kinds[0],kinds[1]],{sharedIds:true});const same=x.proposals[0].id;
    const sourceRow={candidate_event_id:columns===2?same:null,candidate_fact_proposal_id:columns===2?same:null,candidate_state_transition_id:null};
    assert.equal(x.proposals[0].id,x.proposals[1].id);
    return rejectUnchanged(x,()=>tx(async c=>{assert.equal((await c.query(`SELECT (EXISTS(SELECT 1 FROM ${q('candidate_event')} WHERE candidate_event_id=$1) AND EXISTS(SELECT 1 FROM ${q('candidate_fact_proposal')} WHERE candidate_fact_proposal_id=$1)) AS real`,[same])).rows[0].real,true);await manualStructured(c,x,'xor',{sourceRow});await c.query('COMMIT');}),'INSERT:mapping source','candidate_to_canon_candidate_source_check','23514');
  });
  await sub(t,'正文 Item 不要求也不允许伪造提案 Mapping',async()=>{
    const other=await ready([kinds[0]]);const old=await commit(other);const x=await ready([]);
    return deferred(x,{itemRow:{source_mapping_id:old.complete_output.mappings[0].mapping_id}},'text_item_mapping_forbidden');
  });
  await sub(t,'Evidence 完整身份唯一键实际拒绝重复',async()=>{
    const x=await ready([kinds[0]]);const constraint=await observe(async c=>(await c.query(`SELECT conname FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='u'`,[q('evidence_reference')])).rows[0].conname);
    return rejectUnchanged(x,()=>tx(async c=>{const prepared=await manualStructured(c,x,'duplicate-evidence');const row=(await c.query(`SELECT * FROM ${q('evidence_reference')} WHERE source_object_id=$1`,[prepared.cc.canonical_text_version_id])).rows[0];await insert(c,'evidence_reference',{...row,evidence_reference_id:id('duplicate')});await c.query('COMMIT');}),'INSERT:evidence',constraint,'23505');
  });
  const immutableTables=['narrative_assertion','narrative_assertion_candidate_source','assertion_confirmation_basis','fixture_world_record','candidate_event','candidate_fact_proposal','candidate_state_transition','candidate_submission_manifest','story_event','canon_fact','state_transition','evidence_reference','evidence_canon_source','candidate_to_canon_mapping','candidate_to_canon_candidate_source','canon_commit_item','canon_commit_item_story_event_target','canon_commit_item_fact_target','canon_commit_item_state_target','canon_commit','canonical_text_version','projection_outbox','candidate_version','context_bundle','approval_record','approval_invalidation_record','candidate_selection_history'];
  for(const table of immutableTables)await sub(t,`不可变 ${table} UPDATE/DELETE/TRUNCATE`,async()=>{
    const x=await ready();await commit(x);const before=await snapshot(x);const column={canon_commit:'result',canonical_text_version:'content_hash',projection_outbox:'event_hash',candidate_version:'content_hash',context_bundle:'content_hash',approval_record:'decision',approval_invalidation_record:'reason_code',candidate_selection_history:'selection_version',narrative_assertion:'source_content_hash',narrative_assertion_candidate_source:'source_version_id',assertion_confirmation_basis:'basis_hash',fixture_world_record:'record_hash',candidate_event:'object_hash',candidate_fact_proposal:'object_hash',candidate_state_transition:'object_hash',candidate_submission_manifest:'manifest_hash',story_event:'predicate',canon_fact:'fact_value',state_transition:'to_value',evidence_reference:'source_version_id',evidence_canon_source:'canon_commit_id',candidate_to_canon_mapping:'candidate_object_hash',candidate_to_canon_candidate_source:'candidate_object_id',canon_commit_item:'target_id',canon_commit_item_story_event_target:'story_event_id',canon_commit_item_fact_target:'canon_fact_id',canon_commit_item_state_target:'state_transition_id'}[table];const proofs=[];
    for(const statement of [`UPDATE ${q(table)} SET ${column}=${column}`,`DELETE FROM ${q(table)}`,`TRUNCATE ${q(table)} CASCADE`])proofs.push(await expectSql(()=>tx(c=>c.query(statement)),statement.split(' ')[0],'P0001',`immutable_${table}`));await unchanged(x,before);return {stage:'direct DML',evidence:JSON.stringify(proofs)};
  });
});

async function faultTrigger(table,reason){const name=id('test_fault');const condition=table==='projection_outbox'?"NEW.target='fixture_vector'":'true';await observe(c=>c.query(`CREATE FUNCTION ${q(name)}() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, ${SCHEMA}, pg_temp AS $fault$
  BEGIN IF ${condition} THEN RAISE EXCEPTION USING ERRCODE='P0001',CONSTRAINT='${reason}',MESSAGE='${reason}',DETAIL=jsonb_build_object('texts',(SELECT count(*) FROM canonical_text_version WHERE canon_commit_id=NEW.canon_commit_id),'evidence',(SELECT count(*) FROM evidence_canon_source WHERE canon_commit_id=NEW.canon_commit_id),'objects',(SELECT count(*) FROM all_canon_objects WHERE canon_commit_id=NEW.canon_commit_id),'mappings',(SELECT count(*) FROM candidate_to_canon_mapping WHERE canon_commit_id=NEW.canon_commit_id),'outbox',(SELECT count(*) FROM projection_outbox WHERE canon_commit_id=NEW.canon_commit_id))::text;END IF;RETURN NEW;END $fault$;CREATE TRIGGER ${name} BEFORE INSERT ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION ${q(name)}();`));return ()=>observe(c=>c.query(`DROP TRIGGER ${name} ON ${q(table)};DROP FUNCTION ${q(name)}();`));}
scenario('D 故障注入与真实 COMMIT 原子回滚',async(t)=>{
  for(const [label,table,reason,objects,outbox] of [['正文与 Evidence 后','story_event','fixture_after_evidence',0,0],['已写部分 Canon 对象后','canon_fact','fixture_partial_objects',1,0],['第二个必需 Outbox','projection_outbox','fixture_second_outbox',3,1]])await sub(t,label,async()=>{
    const x=await ready();const before=await snapshot(x);const remove=await faultTrigger(table,reason);let error;let after;
    try{error=await expectSql(()=>commit(x,'retry'),'INSERT:fault trigger','P0001',reason);const detail=JSON.parse(error.detail);assert.equal(detail.texts,1);assert.equal(detail.evidence,1);assert.equal(detail.objects,objects);assert.equal(detail.outbox,outbox);after=await unchanged(x,before);}finally{await remove();}
    const retried=await commit(x,'retry');await complete(x);return {...error,evidence:JSON.stringify({failure:error,physicalCountsBefore:before.physicalCounts,physicalCountsAfter:after.physicalCounts,independentRollback:{commits:before.commits.length,evidence:0,objects:0,mappings:0,outbox:before.outbox.length,watermark:before.watermark},retried})};
  });
  for(const [options,reason] of [[{omitItem:true},'commit_item_count'],[{omitMappingSource:true},'mapping_source_missing']])await sub(t,`不完整关系真实 COMMIT 失败 ${reason}`,async()=>{const x=await ready();const evidence=await deferred(x,options,reason);const retry=await commit(x,'negative');await complete(x);return {...evidence,evidence:JSON.stringify({failure:evidence,retry})};});
  await sub(t,'函数返回后外层 ROLLBACK，所有输出和失效均消失',async()=>{const x=await ready();const before=await snapshot(x);let pending;await tx(async c=>{pending=await commitOn(c,x,'retry');assert.equal(pending.requires_outer_commit,true);await unchanged(x,before);await c.query('ROLLBACK');});await unchanged(x,before);const retried=await commit(x,'retry');assert.notEqual(retried.canon_commit_id,pending.canon_commit_id);await complete(x);return JSON.stringify({pending,retried,rollbackWatermark:before.watermark});});
});

scenario('E 幂等、竞争与历史输出封闭',async(t)=>{
  for(const release of ['COMMIT','ROLLBACK'])await sub(t,`同 key 同请求竞争 A ${release}`,async()=>{const x=await ready();const r=await race(x,c=>commitOn(c,x,'same'),c=>commitOn(c,x,'same',request(x,{structured_outputs:[...x.proposals].reverse()})),release);assert.ok(!r.error,r.error?.message);assert.equal(r.value.result,release==='COMMIT'?'replayed':'created_in_transaction');if(release==='COMMIT')assert.deepEqual(r.value.complete_output,r.firstResult.complete_output);else assert.notEqual(r.value.canon_commit_id,r.firstResult.canon_commit_id);await complete(x);return r;});
  await sub(t,'同 key 不同结构化摘要拒绝',async()=>{const x=await ready();await commit(x,'same');return rejectUnchanged(x,()=>commit(x,'same',request(x,{structured_outputs:x.proposals.slice(1)})),'idempotency','commit_idempotency_conflict');});
  await sub(t,'同项目不同 key 同输入水位仅一个成功',async()=>{const base=await project();const x=await ready(kinds,{},base);const y=await ready(kinds,{},base);const r=await race(x,c=>commitOn(c,x,'one'),c=>commitOn(c,y,'two'));assert.equal(r.error?.constraint,'stale_canon_watermark');await complete(x);return {...r,code:r.error.code,constraint:r.error.constraint};});
  for(const change of ['selection','approval'])await sub(t,`预检查后 ${change} 变化阻断新提交`,async()=>{const x=await ready();assert.equal((await invoke('check_admission',x.project,x.workflow,x.candidate,x.approval,1)).accepted,true);if(change==='selection'){const y=await sibling(x);await invoke('select_candidate',x.workflow,y.candidate,1);}else await invalidate(x);return rejectUnchanged(x,()=>commit(x,'fresh'),'commit admission',change==='selection'?'admission_selection_version_conflict':'admission_approval_invalidated');});
  await sub(t,'ABA 旧审批保持失效，新审批后才可提交',async()=>{const x=await ready();const y=await sibling(x);await invoke('select_candidate',x.workflow,y.candidate,1);await invoke('select_candidate',x.workflow,x.candidate,2);x.version=3;await rejectUnchanged(x,()=>commit(x,'old'),'commit admission','admission_approval_invalidated');await approve(x,'after-ABA');const output=await commit(x,'new');await complete(x);return JSON.stringify(output);});
  await sub(t,'历史成功请求在水位、选择和审批变化后仍重放全部原身份',async()=>{
    const base=await project();const x=await ready([kinds[0]],{},base);const original=await commit(x,'historical');const y=await ready([kinds[0]],{},base);await commit(y,'advance');const z=await sibling(x);await invoke('select_candidate',x.workflow,z.candidate,1);const before=await snapshot(x);const replay=await commit(x,'historical');assert.equal(replay.result,'replayed');assert.deepEqual(replay.complete_output,original.complete_output);assert.deepEqual(replay.outbox_ids,original.outbox_ids);await unchanged(x,before);await complete(x,2);return JSON.stringify({original,replay,actualWatermark:before.watermark});
  });
  for(const table of ['story_event','canon_fact','state_transition','evidence_reference','evidence_canon_source','candidate_to_canon_mapping','candidate_to_canon_candidate_source','canon_commit_item','canon_commit_item_story_event_target'])await sub(t,`后续普通 INSERT 不能扩充历史 ${table}`,async()=>{
    const x=await ready();const output=await commit(x);const data=await observe(async c=>{
      let query;
      if(table==='evidence_reference')query=`SELECT e.* FROM ${q(table)} e WHERE source_object_id=$1`;
      else if(table==='candidate_to_canon_candidate_source')query=`SELECT s.* FROM ${q(table)} s JOIN ${q('candidate_to_canon_mapping')} m USING(mapping_id) WHERE m.canon_commit_id=$1`;
      else if(table==='canon_commit_item_story_event_target')query=`SELECT s.* FROM ${q(table)} s JOIN ${q('canon_commit_item')} i USING(commit_item_id) WHERE i.canon_commit_id=$1`;
      else query=`SELECT * FROM ${q(table)} WHERE canon_commit_id=$1`;
      return (await c.query(query,[table==='evidence_reference'?output.canonical_text_version_id:output.canon_commit_id])).rows[0];
    });return rejectUnchanged(x,()=>tx(c=>insert(c,table,data)),'INSERT:historical child','historical_output_append');
  });
  await sub(t,'不同项目同 key 首次并行提交并保持独立',async()=>{const x=await ready();const y=await ready();const a=await connect(),b=await connect();try{await begin(a);await begin(b);const responses=await Promise.all([commitOn(a,x,'shared'),commitOn(b,y,'shared')]);const done=await Promise.allSettled([a.query('COMMIT'),b.query('COMMIT')]);assert.ok(done.every(r=>r.status==='fulfilled'));assert.notEqual(responses[0].canon_commit_id,responses[1].canon_commit_id);await complete(x);await complete(y);return JSON.stringify({pids:[await pid(a),await pid(b)],responses,commits:done.map(r=>r.status),attempts:1});}finally{await close(a);await close(b);}});
  await sub(t,'实际函数路径、延后约束、基数索引与故障设施清理',async()=>observe(async c=>{
    const funcs=(await c.query(`SELECT p.proname,p.proconfig,p.prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY proname`,[SCHEMA])).rows;for(const f of funcs){assert.deepEqual(f.proconfig,[`search_path=pg_catalog, ${SCHEMA}, pg_temp`]);assert.equal(f.prosecdef,false);assert.ok(!f.proname.startsWith('test_fault'));}
    const constraints=(await c.query(`SELECT conrelid::regclass::text AS table_name,conname,pg_catalog.pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE connamespace=$1::regnamespace ORDER BY conname`,[SCHEMA])).rows;
    assert.ok(!constraints.some(r=>r.table_name===q('canon_commit_item')&&r.definition==='UNIQUE (canon_commit_id)'));
    const index=(await c.query(`SELECT indexdef FROM pg_catalog.pg_indexes WHERE schemaname=$1 AND indexname='one_text_item'`,[SCHEMA])).rows[0];assert.match(index.indexdef,/WHERE.*canonical_text/);
    const triggers=(await c.query(`SELECT c.relname,t.tgname,t.tgdeferrable,t.tginitdeferred,t.tgenabled FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`,[SCHEMA])).rows;assert.ok(triggers.filter(r=>r.tgname==='structured_complete'&&r.tgdeferrable&&r.tginitdeferred).length>=10);assert.ok(triggers.every(r=>r.tgenabled==='O'));
    return JSON.stringify({functions:funcs,constraints,index,triggers});
  }));
});
