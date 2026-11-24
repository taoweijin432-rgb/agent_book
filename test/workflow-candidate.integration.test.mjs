import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { executeCommand } from '../src/foundation.mjs';
import { withConnection,inTransaction,connectionOptions } from '../src/database.mjs';
import { initializeNovelReader } from '../scripts/administration.mjs';
import { scanSecrets } from '../scripts/verification-support.mjs';
import { createContextFixture } from './support/context-fixture.mjs';
if(process.env.AB_TEST_MODE!=='1'||!process.env.AB_TEST_MANIFEST)throw new Error('ISOLATED_TEST_REQUIRED');
const m=JSON.parse(await readFile(process.env.AB_TEST_MANIFEST));
const secret=`design_${randomBytes(20).toString('hex')}`,bodyMarker=`body_${randomBytes(20).toString('hex')}`;
const groups=[],logs=[],responses=[],errors=[],evidence={};const key=()=>randomUUID(),actor=label=>m.actors.find(a=>a.label===label).actorId,admin=fn=>withConnection(m.configs.admin,fn);
let a,b,w1,w2,ca,cb,cc,selectA,selectB,selectionRequest;
async function call(who,op,n,p={}){const r=await executeCommand(m.configs[who],op,{novel_id:n,request:p},{logger:r=>logs.push(r)});responses.push({who,op,r});if(!r.ok)errors.push(r);
 if(r.error==='REQUEST_FAILED'&&(evidence.diagnostics?.length??0)<6&&op.startsWith('candidate'))await withConnection(m.configs[who],async c=>{await c.query('BEGIN');try{await api(c,op,n,p);}catch(e){evidence.diagnostics??=[];evidence.diagnostics.push({operation:op,sqlstate:e.code,functions:[...(e.where??'').matchAll(/function ([a-z_]+)/g)].map(x=>x[1])});}finally{await c.query('ROLLBACK');}});
 return r;}
async function ok(p){const r=await p;assert.equal(r.ok,true);return r;}
async function deny(p,error){const r=await p;assert.equal(r.ok,false);if(error)assert.equal(r.error,error);assert.equal(JSON.stringify(r).includes(bodyMarker),false);return r;}
async function sqlError(fn,code){let error;try{await fn();}catch(e){error=e;}const accepted=(Array.isArray(code)?code:[code]).includes(error?.code);if(!accepted){evidence.sqlMismatch??=[];evidence.sqlMismatch.push({expected:code,actual:error?.code??'no_error',line:Number(new Error().stack?.match(/workflow-candidate.integration.test.mjs:(\d+):[^\n]*\n[^\n]*workflow-candidate.integration.test.mjs:(\d+):/)?.[2]??0)});}assert.ok(accepted);}
function group(name,body){test(name,{timeout:120000},async t=>{const g={name,status:'passed',cases:[]};groups.push(g);await body(async(label,fn)=>t.test(label,{timeout:25000},async()=>{const c={name:label,status:'passed'};g.cases.push(c);try{await fn();}catch(e){g.status='failed';c.status='failed';c.failure={code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'CHECK_FAILED',line:Number(e.stack?.match(/workflow-candidate.integration.test.mjs:(\d+):/)?.[1]??0)};throw new Error(`CHECK_FAILED ${label}`);}}));});}
const fixture=(opts={})=>createContextFixture(m.configs,m.actors,{secret,...opts});
const writing=(f,patch={})=>call(f.author,'writing-grant:create',f.novel,{request_key:key(),context_grant_id:f.contextGrant,expires_at:null,...patch});
async function ready(f){f.writing=(await ok(writing(f))).grant_id;return f;}
const workflow=(f,patch={})=>call(f.writer,'workflow:create',f.novel,{request_key:key(),writing_grant_id:f.writing,bundle_ref:f.bundle,execution_mode:'manual_input_v1',...patch});
const input=(f,w,body,patch={})=>call(f.writer,'candidate:input',f.novel,{request_key:key(),workflow_ref:w,body,...patch});
const edit=(f,w,c,body,patch={})=>call(f.writer,'candidate:edit',f.novel,{request_key:key(),workflow_ref:w,previous_candidate_ref:c,body,...patch});
const history=(f,w,who=f.writer)=>call(who,'workflow:read',f.novel,{workflow_ref:w});
const choose=(f,w,c,v,patch={})=>call(f.writer,'candidate:select',f.novel,{request_key:key(),workflow_ref:w,candidate_ref:c,expected_selection_version:v,...patch});
async function api(c,op,n,p){return(await c.query('SELECT agent_book.api_manual_workflow($1,$2,$3,$4,$5) r',[op,n,JSON.stringify(p),Array.from({length:16},key),key()])).rows[0].r;}
async function revoke(c,g){return(await c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[g,key()])).rows[0].r;}
async function snapshot(){return admin(async c=>{const r={};for(const table of ['manual_writing_grant','manual_writing_revocation','workflow_run','candidate_version','workflow_candidate_selection_history','manual_workflow_request','manual_workflow_audit'])r[table]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${table} t ORDER BY to_jsonb(t)::text`)).rows;return r;});}
async function observe(o,waiter,blocker){const deadline=Date.now()+4500;while(Date.now()<deadline){const r=(await o.query('SELECT wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[waiter])).rows[0];if(r?.wait_event_type==='Lock'&&r.blockers.includes(blocker))return r;await new Promise(r=>setTimeout(r,15));}throw new Error('BLOCK_NOT_OBSERVED');}
async function race(firstActor,first,secondActor,second){const clients=await Promise.all([firstActor,secondActor,'admin'].map(async who=>{const c=new pg.Client(connectionOptions(m.configs[who]));await c.connect();return c;}));const[x,y,o]=clients;let pending;try{
 const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await y.query('BEGIN');const one=await first(x);pending=second(y);pending.catch(()=>{});const wait=await observe(o,pids[1],pids[0]);await x.query('COMMIT');const two=await pending;await y.query('COMMIT');return{one,two,evidence:{blocker:pids[0],waiter:pids[1],observer:pids[2],actualBlockerConfirmed:true,wait_event:wait.wait_event}};
 }finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}}
after(async()=>{await writeFile(process.env.AB_TEST_RESULTS,JSON.stringify({runId:m.runId,groups,evidence,logs}));await writeFile(process.env.AB_TEST_RESULTS+'.markers',JSON.stringify([secret,bodyMarker]),{mode:0o600});});

group('A 真实人工路径与精确正文',async sub=>{
 await sub('上下文权不导出写作权，真实作者显式发放后建立人工 Workflow',async()=>{
  a=await fixture({label:'manual-a'});b=await fixture({author:'authorB',writer:'writerB',label:'manual-b'});
  await initializeNovelReader(m.configs.admin,{actorId:actor('writerA'),novelId:a.novel});await initializeNovelReader(m.configs.admin,{actorId:actor('auditorA'),novelId:a.novel});
  await ok(executeCommand(m.configs.writerA,'novel:read',{novel_id:a.novel}));await deny(workflow({...a,writing:a.contextGrant}),'ACCESS_DENIED');
  await initializeNovelReader(m.configs.admin,{actorId:actor('ungranted'),novelId:a.novel});await ok(executeCommand(m.configs.ungranted,'novel:read',{novel_id:a.novel}));await deny(call('ungranted','workflow:create',a.novel,{request_key:key(),writing_grant_id:a.contextGrant,bundle_ref:a.bundle,execution_mode:'manual_input_v1'}),'ACCESS_DENIED');
  await ready(a);await ready(b);w1=(await ok(workflow(a))).workflow_ref;w2=(await ok(workflow(a))).workflow_ref;
  const wb=await ok(workflow(b));b.workflow=wb.workflow_ref;assert.equal((await ok(history(a,w1))).selection_version,0);
 });
 await sub('人工录入、编辑新身份、相同正文不同身份，不自动选择',async()=>{
  const body=`  ${bodyMarker}\r\n第一行\n第二行 e\u0301 🙂  `;
  ca=await ok(input(a,w1,body));cb=await ok(edit(a,w1,ca.candidate_ref,body+'\n编辑'));cc=await ok(edit(a,w1,ca.candidate_ref,body));
  assert.notEqual(ca.candidate_ref,cc.candidate_ref);assert.equal(ca.body_hash,cc.body_hash);assert.equal(cb.previous_candidate_ref,ca.candidate_ref);assert.equal(ca.origin,'human_input');assert.equal(cb.origin,'human_edit');
  const h=await ok(history(a,w1));assert.equal(h.candidates.length,3);assert.equal(h.current_candidate_ref,null);assert.equal(h.selection_version,0);
  for(const c of h.candidates){assert.equal(c.body_hash,createHash('sha256').update(Buffer.from(c.body,'utf8')).digest('hex'));assert.equal(c.body_bytes,Buffer.byteLength(c.body));}
  const saved=await withConnection(m.configs.authorA,async()=>ok(call('authorA','workflow:trace',a.novel,{workflow_ref:w1})));assert.equal(saved.candidates.find(c=>c.candidate_ref===ca.candidate_ref).body,body);
  evidence.manual={realAuthorAndWriter:true,originExplicit:true,noGenerationRecords:true,metadataOnlyAndContextOnlyDenied:true,sameBodyNewIdentity:true,exactUtf8HashAndReadback:true,noImplicitSelection:true};
 });
 await sub('正文按字节幂等，CRLF/LF和Unicode不同请求；空白、非法字符及上限拒绝',async()=>{
  const k=key(),first=await ok(input(a,w2,'行\r\n尾',{request_key:k}));assert.deepEqual(await ok(input(a,w2,'行\r\n尾',{request_key:k})),first);await deny(input(a,w2,'行\n尾',{request_key:k}),'IDEMPOTENCY_CONFLICT');
  const other=await ok(input(a,w2,'e\u0301'));const composed=await ok(input(a,w2,'é'));assert.notEqual(other.body_hash,composed.body_hash);
  for(const text of ['', ' \r\n\t ','\u0000bad','\u0001bad','\uD800','x'.repeat(262145)])await deny(input(a,w1,text),'INVALID_REQUEST');
  const max=await ok(input(a,w2,'x'.repeat(262144)));assert.equal(max.body_bytes,262144);evidence.textProtocol={name:'exact-utf8-v1',maxBytes:262144,independentlyHashed:true,newlineAndUnicodePreserved:true};
 });
 await sub('writer 仅得公开候选信息，author 可来源追溯，auditor 无正文',async()=>{
  const h=await ok(history(a,w1));for(const id of [a.revision,a.object,a.constraint,a.soft,a.contextGrant,a.writing,a.version,a.novel,a.scene])assert.equal(JSON.stringify(h).includes(id),false);
  const trace=await ok(call('authorA','workflow:trace',a.novel,{workflow_ref:w1}));assert.equal(trace.input.task_version_id,a.version);assert.equal(trace.bundle_ref,a.bundle);
  const audit=await ok(call('auditorA','workflow:audit',a.novel,{}));assert.equal(JSON.stringify(audit).includes(bodyMarker),false);await deny(call('auditorA','workflow:trace',a.novel,{workflow_ref:w1}),'ACCESS_DENIED');await deny(history(a,w1,'auditorA'),'ACCESS_DENIED');
 });
});

group('B 真实归属与入口边界',async sub=>{
 await sub('两个 Novel、writer、author 交叉读写及授权均拒绝',async()=>{
  for(const [who,op,n,p]of [['writerB','workflow:read',a.novel,{workflow_ref:w1}],['writerA','workflow:read',b.novel,{workflow_ref:b.workflow}],['authorB','workflow:trace',a.novel,{workflow_ref:w1}],['authorB','writing-grant:create',a.novel,{request_key:key(),context_grant_id:a.contextGrant,expires_at:null}]])await deny(call(who,op,n,p),'ACCESS_DENIED');
  await deny(workflow(a,{bundle_ref:b.bundle}),'ACCESS_DENIED');await deny(workflow({...a,writing:b.writing}),'ACCESS_DENIED');
 });
 await sub('同 Novel 不同 Task 和原上下文 Grant 的真实 Bundle 不可错绑',async()=>{
  const t=await ok(call('authorA','task:create',a.novel,{request_key:key(),...a.taskInput}));a.otherTask=t.version_id;
  const cg=await ok(call('authorA','context-grant:create',a.novel,{request_key:key(),task_version_id:t.version_id,writer_actor_id:a.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}));
  await deny(writing(a,{context_grant_id:b.contextGrant}),'ACCESS_DENIED');
  const fresh=await ok(call('authorA','context-grant:create',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:a.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}));
  const bundle=await ok(call('writerA','context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536}));await deny(workflow(a,{bundle_ref:bundle.bundle_ref}),'ACCESS_DENIED');
  const publishFor=async(version,writer)=>{for(const [kind,type,id]of [['goal','author_design_revision',a.revision],['character','design_object_version',a.object],['constraint','design_constraint',a.constraint],['constraint','design_constraint',a.soft]]){
   const prop=await ok(call('authorA','projection:propose',a.novel,{request_key:key(),task_version_id:version,writer_actor_id:writer,kind,source_object_type:type,source_object_id:id,safe_text:'另一个授权范围的指导',semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null}));await ok(call('authorA','projection:publish',a.novel,{request_key:key(),proposal_id:prop.proposal_id}));}};
  await publishFor(t.version_id,a.writerId);const taskBundle=await ok(call('writerA','context:compile',a.novel,{request_key:key(),task_version_id:t.version_id,max_bytes:65536}));await deny(workflow(a,{bundle_ref:taskBundle.bundle_ref}),'ACCESS_DENIED');
  const writerGrant=await ok(call('authorA','context-grant:create',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:b.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}));await publishFor(a.version,b.writerId);
  const writerBundle=await ok(call('writerB','context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536}));const ownWriting=await ok(writing(a,{context_grant_id:writerGrant.grant_id}));
  const otherWorkflow=await ok(call('writerB','workflow:create',a.novel,{request_key:key(),writing_grant_id:ownWriting.grant_id,bundle_ref:writerBundle.bundle_ref,execution_mode:'manual_input_v1'}));await deny(history(a,otherWorkflow.workflow_ref),'ACCESS_DENIED');await deny(workflow(a,{bundle_ref:writerBundle.bundle_ref}),'ACCESS_DENIED');
  assert.notEqual(cg.grant_id,fresh.grant_id);evidence.ownership={sameNovelOtherTask:true,sameNovelOtherWriter:true,wrongOriginalContextGrant:true};
 });
 await sub('实际存在的跨 Workflow 前序与选择、缺前序均拒绝',async()=>{
  const c=(await ok(history(a,w2))).candidates[0].candidate_ref;
  await deny(edit(a,w1,c,'越界'),'INVALID_REQUEST');await deny(edit(a,w1,key(),'缺前序'),'INVALID_REQUEST');await deny(choose(a,w1,c,0),'INVALID_REQUEST');
  await deny(input(a,w1,'正文',{previous_candidate_ref:ca.candidate_ref}),'INVALID_REQUEST');
 });
 await sub('数据库复合 FK 拒绝错 writer/Task/Bundle/前序，普通登录底表与 helper 拒绝',async()=>{
  const row=(await admin(c=>c.query('SELECT to_jsonb(c) r FROM agent_book.candidate_version c WHERE candidate_version_id=$1',[ca.candidate_ref]))).rows[0].r;
  for(const patch of [{writer_actor_id:b.writerId,edited_by:b.writerId},{task_version_id:b.version},{context_bundle_id:(await admin(c=>c.query('SELECT context_bundle_id FROM agent_book.context_bundle WHERE public_bundle_ref=$1',[b.bundle]))).rows[0].context_bundle_id},{previous_candidate_id:(await ok(history(b,b.workflow))).candidates[0]?.candidate_ref??key(),origin:'human_edit'}])await sqlError(()=>admin(c=>c.query('INSERT INTO agent_book.candidate_version SELECT * FROM jsonb_populate_record(NULL::agent_book.candidate_version,$1)',[JSON.stringify({...row,candidate_version_id:key(),...patch})])),'23503');
  for(const sql of ['SELECT * FROM agent_book.candidate_version','SELECT agent_book._wf_events(NULL::uuid)',"INSERT INTO agent_book.manual_workflow_audit(audit_id) VALUES(gen_random_uuid())",'SELECT agent_book._revoke_pre_manual(NULL::uuid,NULL::uuid)'])await sqlError(()=>withConnection(m.configs.writerA,c=>c.query(sql)),'42501');
 });
 await sub('请求 actor/role/Scope/Bundle 覆盖及后续未实现入口明确拒绝',async()=>{
  for(const patch of [{actor_id:actor('authorA')},{role:'author'},{scope:'all'},{bundle_ref:b.bundle},{generation_run_id:key()}])await deny(input(a,w1,'内容',patch),'INVALID_REQUEST');
  await deny(workflow(a,{execution_mode:'model'}),'INVALID_REQUEST');for(const op of ['generation:create','validation:run','approval:create','canon:commit'])assert.equal((await executeCommand(m.configs.writerA,op,{})).error,'UNSUPPORTED_OPERATION');
  await withConnection(m.configs.writerA,async c=>{await c.query("SET app.actor='author';SET app.scope='all'");const r=await api(c,'writing-grant:create',a.novel,{request_key:key(),context_grant_id:a.contextGrant,expires_at:null});assert.equal(r.error,'ACCESS_DENIED');});
 });
});

group('C 选择版本、ABA 与并发',async sub=>{
 await sub('显式 A→B→A 递增选择版本，旧请求重放不移动指针',async()=>{
  selectionRequest={request_key:key(),workflow_ref:w1,candidate_ref:ca.candidate_ref,expected_selection_version:0};selectA=await ok(call('writerA','candidate:select',a.novel,selectionRequest));selectB=await ok(choose(a,w1,cb.candidate_ref,1));
  assert.deepEqual(await ok(call('writerA','candidate:select',a.novel,selectionRequest)),selectA);assert.equal((await ok(history(a,w1))).current_candidate_ref,cb.candidate_ref);
  const again=await ok(choose(a,w1,ca.candidate_ref,2));assert.equal(again.selection_version,3);assert.notEqual(again.selection_ref,selectA.selection_ref);
  await ok(edit(a,w1,ca.candidate_ref,'新编辑'));assert.equal((await ok(history(a,w1))).selection_version,3);await deny(choose(a,w1,cb.candidate_ref,1),'VERSION_CONFLICT');
  await deny(call('writerA','candidate:select',a.novel,{...selectionRequest,candidate_ref:cb.candidate_ref}),'IDEMPOTENCY_CONFLICT');evidence.selection={abaNewSelectionVersion:true,oldReplayDoesNotMoveHead:true,editDoesNotSelect:true};
 });
 await sub('两真实事务竞争相同期望选择版本，仅一个成功',async()=>{
  const r=await race('writerA',c=>api(c,'candidate:select',a.novel,{request_key:key(),workflow_ref:w1,candidate_ref:cb.candidate_ref,expected_selection_version:3}),'writerA',c=>api(c,'candidate:select',a.novel,{request_key:key(),workflow_ref:w1,candidate_ref:ca.candidate_ref,expected_selection_version:3}));
  assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');assert.equal((await ok(history(a,w1))).selection_version,4);evidence.selectionRace=r.evidence;
 });
 await sub('写作授权与旧两类授权 ID 双向无歧义',async()=>{
  const base=(await admin(c=>c.query("SELECT to_jsonb(g) r FROM agent_book.capability_grant g JOIN agent_book.capability c USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND g.actor_id=$2 AND c.capability_key='novel.read'",[a.novel,a.writerId]))).rows[0].r;
  await sqlError(()=>admin(c=>c.query('INSERT INTO agent_book.capability_grant SELECT * FROM jsonb_populate_record(NULL::agent_book.capability_grant,$1)',[JSON.stringify({...base,grant_id:a.writing,actor_id:b.writerId})])),'23514');
  const cg=(await admin(c=>c.query('SELECT to_jsonb(g) r FROM agent_book.context_grant g WHERE context_grant_id=$1',[a.contextGrant]))).rows[0].r;
  await sqlError(()=>admin(c=>c.query('INSERT INTO agent_book.context_grant SELECT * FROM jsonb_populate_record(NULL::agent_book.context_grant,$1)',[JSON.stringify({...cg,context_grant_id:a.writing})])),'23514');
  const wg=(await admin(c=>c.query('SELECT to_jsonb(g) r FROM agent_book.manual_writing_grant g WHERE writing_grant_id=$1',[a.writing]))).rows[0].r;
  for(const id of [base.grant_id,a.contextGrant])await sqlError(()=>admin(c=>c.query('INSERT INTO agent_book.manual_writing_grant SELECT * FROM jsonb_populate_record(NULL::agent_book.manual_writing_grant,$1)',[JSON.stringify({...wg,writing_grant_id:id})])),'23514');evidence.grantIds={allThreeTypesBothDirections:true};
 });
});

group('D 授权期限、撤销与实际阻塞',async sub=>{
 await sub('上下文有限期与作者有限支撑分别约束新授权，原记录保持',async()=>{
  const deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+interval '60 seconds')::text t"))).rows[0].t;
  const f=await ready(await fixture({label:'finite-context',expiresAt:deadline}));const g=(await admin(c=>c.query('SELECT expires_at::text e FROM agent_book.manual_writing_grant WHERE writing_grant_id=$1',[f.writing]))).rows[0];assert.equal(new Date(g.e).getTime(),new Date(deadline).getTime());
  const support=await fixture({label:'finite-author'});const original=(await admin(c=>c.query(`SELECT to_jsonb(g) r FROM agent_book.capability_grant g JOIN agent_book.capability c USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND c.capability_key='design.freeze'`,[support.novel]))).rows[0].r;
  await ok(executeCommand(m.configs.authorA,'grant:revoke',{grant_id:original.grant_id}));await admin(c=>c.query("INSERT INTO agent_book.capability_grant SELECT * FROM jsonb_populate_record(NULL::agent_book.capability_grant,$1::jsonb||jsonb_build_object('effective_at',clock_timestamp()))",[JSON.stringify({...original,grant_id:key(),expires_at:deadline})]));
  await ready(support);assert.equal(new Date((await admin(c=>c.query('SELECT expires_at FROM agent_book.manual_writing_grant WHERE writing_grant_id=$1',[support.writing]))).rows[0].expires_at).getTime(),new Date(deadline).getTime());
  assert.deepEqual((await admin(c=>c.query('SELECT to_jsonb(g) r FROM agent_book.capability_grant g WHERE grant_id=$1',[original.grant_id]))).rows[0].r,original);assert.equal((await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.grant_revocation WHERE grant_id=$1',[original.grant_id]))).rows[0].n,1);
  evidence.validity={contextFinitePreserved:true,authorFinitePreserved:true,nullRequestNotUnlimited:true,oldGrantAndRevocationPreserved:true};
 });
 await sub('写作授权撤销先提交，等待候选操作拒绝且正文不可回放',async()=>{
  const f=await ready(await fixture({label:'revoke-first'})),w=(await ok(workflow(f))).workflow_ref;const p={request_key:key(),workflow_ref:w,body:'保护正文'};await ok(call(f.writer,'candidate:input',f.novel,p));
  const r=await race(f.author,c=>revoke(c,f.writing),f.writer,c=>api(c,'candidate:input',f.novel,{request_key:key(),workflow_ref:w,body:'等待内容'}));assert.equal(r.one.ok,true);assert.equal(r.two.error,'ACCESS_DENIED');await deny(call(f.writer,'candidate:input',f.novel,p),'ACCESS_DENIED');await deny(history(f,w),'ACCESS_DENIED');evidence.revokeFirst=r.evidence;
 });
 await sub('候选先完成受保护操作，撤销等待；之后选择和读取拒绝',async()=>{
  const f=await ready(await fixture({label:'operation-first'})),w=(await ok(workflow(f))).workflow_ref;
  const r=await race(f.writer,c=>api(c,'candidate:input',f.novel,{request_key:key(),workflow_ref:w,body:'许可内容'}),f.author,c=>revoke(c,f.writing));assert.equal(r.one.ok,true);assert.equal(r.two.ok,true);await deny(choose(f,w,r.one.candidate_ref,0),'ACCESS_DENIED');await deny(history(f,w),'ACCESS_DENIED');evidence.operationFirst=r.evidence;
 });
 await sub('原上下文授权撤销后新授权、创建、编辑、选择、读取和重放全部拒绝',async()=>{
  const f=await ready(await fixture({label:'parent-revoke'})),p={request_key:key(),writing_grant_id:null,bundle_ref:f.bundle,execution_mode:'manual_input_v1'};p.writing_grant_id=f.writing;const w=(await ok(call(f.writer,'workflow:create',f.novel,p))).workflow_ref;const c=await ok(input(f,w,'原文'));
  await ok(executeCommand(m.configs.authorA,'grant:revoke',{grant_id:f.contextGrant}));await deny(writing(f),'ACCESS_DENIED');for(const request of [workflow(f),edit(f,w,c.candidate_ref,'新文'),choose(f,w,c.candidate_ref,0),history(f,w),call(f.writer,'workflow:create',f.novel,p)])await deny(request,'ACCESS_DENIED');
  assert.ok((await ok(call(f.author,'workflow:trace',f.novel,{workflow_ref:w}))).candidates.length===1);
 });
 await sub('原上下文授权实际到期，持久化写作授权不变但真实作者发放和 writer 取用拒绝',async()=>{
  const deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+interval '4 seconds')::text t"))).rows[0].t;
  const f=await ready(await fixture({label:'parent-expiry',expiresAt:deadline})),w=(await ok(workflow(f))).workflow_ref,c=await ok(input(f,w,'限时正文'));
  const before=(await admin(c=>c.query('SELECT to_jsonb(g) r FROM agent_book.manual_writing_grant g WHERE writing_grant_id=$1',[f.writing]))).rows[0].r;assert.equal(new Date(before.expires_at).getTime(),new Date(deadline).getTime());
  let observed;const end=Date.now()+5500;while(Date.now()<end){observed=(await admin(c=>c.query('SELECT clock_timestamp()::text t,clock_timestamp()>$1::timestamptz passed',[deadline]))).rows[0];if(observed.passed)break;await new Promise(r=>setTimeout(r,15));}assert.equal(observed.passed,true);
  await deny(writing(f),'ACCESS_DENIED');for(const attempt of [workflow(f),edit(f,w,c.candidate_ref,'更改'),choose(f,w,c.candidate_ref,0),history(f,w)])await deny(attempt,'ACCESS_DENIED');
  assert.deepEqual((await admin(c=>c.query('SELECT to_jsonb(g) r FROM agent_book.manual_writing_grant g WHERE writing_grant_id=$1',[f.writing]))).rows[0].r,before);evidence.parentExpiry={deadline,databaseObserved:observed.t,limitedGrantUnchanged:true,realWriterDenied:true};
 });
 await sub('等待中跨越写作截止，观察实际数据库时间后释放保护仍拒绝',async()=>{
  const f=await fixture({label:'expiry-wait'});const deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+interval '1800 milliseconds')::text t"))).rows[0].t;f.writing=(await ok(writing(f,{expires_at:deadline}))).grant_id;const w=(await ok(workflow(f))).workflow_ref;
  const clients=await Promise.all(['authorA','writerA','admin'].map(async x=>{const c=new pg.Client(connectionOptions(m.configs[x]));await c.connect();return c;}));const[x,y,o]=clients;let pending;
  try{const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await x.query('SELECT agent_book.api_identity($1)',[key()]);await y.query('BEGIN');pending=api(y,'candidate:input',f.novel,{request_key:key(),workflow_ref:w,body:'等待'});pending.catch(()=>{});await observe(o,pids[1],pids[0]);
   let observed;const end=Date.now()+5000;while(Date.now()<end){observed=(await o.query('SELECT clock_timestamp()::text t,clock_timestamp()>$1::timestamptz passed',[deadline])).rows[0];if(observed.passed)break;await new Promise(r=>setTimeout(r,15));}assert.equal(observed.passed,true);await x.query('COMMIT');assert.equal((await pending).error,'ACCESS_DENIED');await y.query('COMMIT');evidence.expiryWait={blocker:pids[0],waiter:pids[1],observer:pids[2],actualBlockerConfirmed:true,deadline,databaseObserved:observed.t,denied:true};
  }finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}
 });
});

group('E Bundle 失效与历史',async sub=>{
 for(const reason of ['publication','policy','task','design'])await sub(`${reason} 变化后所有 writer 操作与重放拒绝，author 历史保留`,async()=>{
  const f=await ready(await fixture({label:`stale-${reason}`}));const p={request_key:key(),writing_grant_id:f.writing,bundle_ref:f.bundle,execution_mode:'manual_input_v1'},w=(await ok(call(f.writer,'workflow:create',f.novel,p))).workflow_ref,c=await ok(input(f,w,'历史正文'));
  if(reason==='publication')await ok(call(f.author,'projection:revoke',f.novel,{request_key:key(),publication_id:f.publications[0]}));
  if(reason==='policy')await ok(call(f.author,'context-policy:publish',f.novel,{request_key:key(),task_version_id:f.version,expected_release_id:f.policy,policy_version:'safe-context-v2'}));
  if(reason==='task')await ok(call(f.author,'task:append',f.novel,{request_key:key(),task_id:f.task,expected_version_id:f.version,...f.taskInput}));
  if(reason==='design'){const d=await ok(call(f.author,'design:draft',f.novel,{request_key:key(),base_revision_id:f.revision}));await ok(call(f.author,'design:freeze',f.novel,{request_key:key(),draft_id:d.draft_id,expected_edit_version:1,expected_current_revision_id:f.revision}));}
  for(const attempt of [workflow(f),input(f,w,'新文'),edit(f,w,c.candidate_ref,'编辑'),choose(f,w,c.candidate_ref,0),history(f,w),call(f.writer,'workflow:create',f.novel,p)])await deny(attempt,'ACCESS_DENIED');
  const trace=await ok(call(f.author,'workflow:trace',f.novel,{workflow_ref:w}));assert.equal(trace.candidates[0].body,'历史正文');evidence.staleInputs??={};evidence.staleInputs[reason]={allWriterActionsAndReplayDenied:true,historicalBodyUnchanged:true};
 });
});

group('F 原子性、数据库权限与披露',async sub=>{
 await sub('中途故障和外层回滚不留新增物理行或成功审计',async()=>{
  const before=await snapshot();await admin(c=>c.query(`CREATE FUNCTION public.manual_test_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_FAILURE';END $f$;CREATE TRIGGER manual_test_fault AFTER INSERT ON agent_book.candidate_version FOR EACH ROW EXECUTE FUNCTION public.manual_test_fault()`));
  try{await deny(input(a,w1,'故障正文'),'REQUEST_FAILED');}finally{await admin(c=>c.query('DROP TRIGGER manual_test_fault ON agent_book.candidate_version;DROP FUNCTION public.manual_test_fault()'));}assert.deepEqual(await snapshot(),before);
  await withConnection(m.configs.writerA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'candidate:input',a.novel,{request_key:key(),workflow_ref:w1,body:'将回滚'})).ok,true);await c.query('ROLLBACK');});assert.deepEqual(await snapshot(),before);
  await withConnection(m.configs.writerA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'workflow:create',a.novel,{request_key:key(),writing_grant_id:a.writing,bundle_ref:a.bundle,execution_mode:'manual_input_v1'})).ok,true);assert.equal((await api(c,'candidate:select',a.novel,{request_key:key(),workflow_ref:w1,candidate_ref:ca.candidate_ref,expected_selection_version:4})).ok,true);await c.query('ROLLBACK');});assert.deepEqual(await snapshot(),before);
  evidence.rollback={midInsert:true,outerRollback:true,allNewTablesAndPointersUnchanged:true};
 });
 await sub('真实 COMMIT 延后故障，函数返回不等于服务成功；选择历史与指针全回滚',async()=>{
  const before=await snapshot();await admin(c=>c.query(`CREATE FUNCTION public.manual_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_COMMIT_FAILURE';END $f$;CREATE CONSTRAINT TRIGGER manual_commit_fault AFTER INSERT ON agent_book.workflow_candidate_selection_history DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.manual_commit_fault()`));
  try{
   await withConnection(m.configs.writerA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'candidate:select',a.novel,{request_key:key(),workflow_ref:w1,candidate_ref:ca.candidate_ref,expected_selection_version:4})).ok,true);await sqlError(()=>c.query('COMMIT'),'P0001');});
   await deny(choose(a,w1,ca.candidate_ref,4),'REQUEST_FAILED');await deny(workflow(a),'REQUEST_FAILED');
  }finally{await admin(c=>c.query('DROP TRIGGER manual_commit_fault ON agent_book.workflow_candidate_selection_history;DROP FUNCTION public.manual_commit_fault()'));}
  assert.deepEqual(await snapshot(),before);evidence.rollback.realCommitFailure=true;evidence.rollback.functionReturnedBeforeCommit=true;evidence.rollback.serviceWithheldSuccess=true;
 });
 await sub('冻结记录 UPDATE/DELETE/TRUNCATE 拒绝，输入及不完整选择无法普通 DML 改绑',async()=>{
  for(const table of ['manual_writing_grant','manual_writing_revocation','candidate_version','workflow_candidate_selection_history','manual_workflow_request','manual_workflow_audit']){
   const col=table==='candidate_version'?'body_text':table==='workflow_candidate_selection_history'?'action':table==='manual_workflow_request'?'operation':table==='manual_workflow_audit'?'operation':table==='manual_writing_revocation'?'revoked_at':'capability_set';
   const total=(await admin(c=>c.query(`SELECT count(*)::int n FROM agent_book.${table}`))).rows[0].n;
   if(total){await sqlError(()=>admin(c=>c.query(`UPDATE agent_book.${table} SET ${col}=${col}`)),'23514');await sqlError(()=>admin(c=>c.query(`DELETE FROM agent_book.${table}`)),'23514');}
   await sqlError(()=>admin(c=>c.query(`TRUNCATE agent_book.${table} CASCADE`)),['23514','0A000']);
  }
  await sqlError(()=>admin(c=>c.query('UPDATE agent_book.workflow_run SET context_bundle_id=context_bundle_id,current_selection_version=current_selection_version+1 WHERE workflow_run_id=$1',[w1])),'23514');
  await sqlError(()=>admin(c=>c.query('UPDATE agent_book.workflow_run SET writer_actor_id=$1 WHERE workflow_run_id=$2',[b.writerId,w1])),'23514');await sqlError(()=>admin(c=>c.query('DELETE FROM agent_book.workflow_run WHERE workflow_run_id=$1',[w1])),'23514');
 });
 await sub('审计核验实际资源 Novel/Task/Workflow，错范围整条过滤且原记录保留',async()=>{
  const foreign=(await ok(input(b,b.workflow,'B正文'))).candidate_ref;const other=(await ok(history(a,w2))).candidates[0].candidate_ref;const ids=[key(),key(),key(),key()];
  await admin(async c=>{await c.query(`INSERT INTO agent_book.manual_workflow_audit(audit_id,actor_id,novel_id,task_version_id,workflow_run_id,operation,decision,resource_type,resource_candidate_id) VALUES($1,$3,$4,$5,$6,'filtered-fixture','deny','candidate',$7),($2,$3,$4,$5,$6,'filtered-fixture','deny','candidate',$8)`,[ids[0],ids[1],actor('authorA'),a.novel,a.version,w1,foreign,other]);await c.query(`INSERT INTO agent_book.manual_workflow_audit(audit_id,actor_id,novel_id,task_version_id,workflow_run_id,operation,decision,resource_type) VALUES($1,$2,$3,$4,$5,'ordinary','allow','none')`,[ids[2],actor('authorA'),a.novel,a.version,w1]);});
  await admin(c=>c.query(`INSERT INTO agent_book.manual_workflow_audit(audit_id,actor_id,novel_id,task_version_id,workflow_run_id,operation,decision,resource_type,resource_candidate_id) VALUES($1,$2,$3,$4,$5,'wrong-task','deny','candidate',$6)`,[ids[3],actor('authorA'),a.novel,a.otherTask,w1,ca.candidate_ref]));
  const result=await ok(call('auditorA','workflow:audit',a.novel,{}));for(const id of [ids[0],ids[1],ids[3],foreign])assert.equal(JSON.stringify(result).includes(id),false);assert.ok(result.events.some(e=>e.audit_id===ids[2]));assert.ok(result.events.some(e=>e.resource_id===other));assert.ok(result.events.some(e=>e.resource_id===ca.candidate_ref));
  assert.equal((await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.manual_workflow_audit WHERE audit_id=ANY($1)',[ids]))).rows[0].n,4);
  await deny(history(a,w1,'writerB'),'ACCESS_DENIED');const after=await ok(call('auditorA','workflow:audit',a.novel,{}));assert.ok(after.events.some(e=>e.operation==='workflow:read'&&e.decision==='deny'));await deny(call('auditorA','workflow:audit',b.novel,{}),'ACCESS_DENIED');
  const unified=await ok(executeCommand(m.configs.auditorA,'audit:read',{novel_id:a.novel}));assert.ok(unified.events.some(e=>e.resource_id===ca.candidate_ref));assert.equal(JSON.stringify(unified).includes(bodyMarker),false);evidence.audit={taskAndActualResourceIndependentlyScoped:true,wrongWorkflowAndForeignNovelFiltered:true,rawReferencesPreserved:true,denialIndependentlyCommitted:true,noBodyForAuditor:true};
 });
 await sub('004 后旧关键命令可用；真实身份、所有者、ACL、固定路径与故障设施核验',async()=>{
  await ok(executeCommand(m.configs.writerA,'novel:read',{novel_id:a.novel}));await ok(call('authorA','design:history',a.novel,{}));await ok(call('authorA','task:history',a.novel,{}));await ok(call('writerA','context:read',a.novel,{bundle_ref:a.bundle}));
  for(const who of ['validator','commit','projection']){await ok(executeCommand(m.configs[who],'identity',{}));await sqlError(()=>withConnection(m.configs[who],c=>api(c,'workflow:read',a.novel,{workflow_ref:w1})),'42501');}
  const data=await admin(async c=>{
   const owners=(await c.query("SELECT r.rolname FROM pg_class t JOIN pg_roles r ON r.oid=t.relowner WHERE t.relnamespace='agent_book'::regnamespace AND t.relkind IN ('r','p')")).rows;assert.ok(owners.every(r=>r.rolname===m.owner));assert.equal((await c.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[m.owner])).rows[0].rolcanlogin,false);
   const functions=(await c.query("SELECT p.oid,p.proname,p.prosecdef,p.proconfig,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book'")).rows;
   for(const f of functions){assert.equal(f.owner,m.owner);assert.equal(f.prosecdef,true);assert.ok(f.proconfig.includes('search_path=pg_catalog, agent_book, pg_temp'));}
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='agent_book' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
   for(const who of m.actors){const login=m.configs[who.label]?.user;if(!login)continue;assert.equal((await c.query('SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls high FROM pg_roles WHERE rolname=$1',[login])).rows[0].high,false);assert.equal((await c.query('SELECT count(*)::int n FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member WHERE r.rolname=$1',[login])).rows[0].n,0);
    assert.equal((await c.query("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee=$1 AND table_schema='agent_book'",[login])).rows[0].n,0);
    for(const f of functions.filter(f=>f.proname.startsWith('_wf_')||f.proname.endsWith('_pre_manual')))assert.equal((await c.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[login,f.oid])).rows[0].allowed,false);
   }
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_constraint WHERE connamespace='agent_book'::regnamespace AND NOT convalidated")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace='agent_book'::regnamespace) AND tgenabled='D'")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'manual_%fault%'")).rows[0].n,0);
   return{controlledFunctions:functions.length,publicExecute:0,privateHelperExecute:0,baseTablePrivileges:0,highPrivilegeMemberships:0,unvalidatedConstraints:0,disabledTriggers:0,faultResidue:0};
  });evidence.database=data;
 });
 await sub('真实 CLI 提交人工正文，标准输出与安全日志分离，嵌套错误不带正文',async()=>{
  const requestFile=process.env.AB_TEST_RESULTS+'.request.json';await writeFile(requestFile,JSON.stringify({request_key:key(),workflow_ref:w1,body:bodyMarker+' CLI'}),{mode:0o600});
  const run=()=>spawnSync(process.execPath,['src/cli.mjs','candidate:input',a.novel,requestFile],{env:{...process.env,AB_CONFIG:m.configPaths.writerA},encoding:'utf8',timeout:15000});const success=run();assert.equal(success.status,0);const value=JSON.parse(success.stdout);assert.equal(value.ok,true);assert.equal(value.body,bodyMarker+' CLI');assert.equal(scanSecrets([success.stderr],[secret,bodyMarker]),0);
  await writeFile(requestFile,JSON.stringify({request_key:key(),workflow_ref:w1,body:bodyMarker,actor_id:secret,nested:{hidden:secret}}),{mode:0o600});const failure=run();assert.notEqual(failure.status,0);assert.equal(JSON.parse(failure.stdout).error,'INVALID_REQUEST');assert.equal(scanSecrets([failure.stdout,failure.stderr],[secret,bodyMarker]),0);evidence.cli={realCommitBeforeResponse:true,authorizedBodyOnlyOnStdout:true,logAndNestedErrorLeaks:0};
 });
 await sub('默认日志、错误、完整嵌套输出不泄露正文标记、原始设计或受限标识',async()=>{
  const dbLog=spawnSync('docker',['logs',m.container],{encoding:'utf8',timeout:10000});assert.equal(dbLog.status,0);const credentials=Object.values(m.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`]);assert.equal(scanSecrets([dbLog.stdout,dbLog.stderr],[secret,bodyMarker,a.revision,a.object,a.contextGrant,a.writing,...credentials]),0);evidence.databaseLog={actualDockerLogScanned:true,credentialBodyAndSourceLeaks:0};
  assert.equal(scanSecrets([logs,errors],[secret,bodyMarker]),0);const visible=responses.filter(x=>x.who.startsWith('writer')).map(x=>x.r);assert.equal(scanSecrets(visible,[secret,a.revision,a.object,a.constraint,a.soft,a.contextGrant,a.writing]),0);
  const allowedBodyOps=new Set(['candidate:input','candidate:edit','workflow:read']);for(const entry of responses)if(!allowedBodyOps.has(entry.op)&&entry.op!=='workflow:trace')assert.equal(scanSecrets([entry.r],[bodyMarker]),0);
  evidence.disclosure={logs:logs.length,fullResponses:responses.length,errors:errors.length,defaultLogAndErrorLeaks:0,rawDesignAndHiddenIdentifiers:0,bodyOnlyInAuthorizedBusinessResponses:true,noAutomaticDeclassification:true};
 });
});
