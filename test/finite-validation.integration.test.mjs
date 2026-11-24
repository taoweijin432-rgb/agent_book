import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {executeCommand} from '../src/foundation.mjs';
import {withConnection,inTransaction,connectionOptions} from '../src/database.mjs';
import {initializeNovelReader} from '../scripts/administration.mjs';
import {scanSecrets} from '../scripts/verification-support.mjs';
import {createValidationFixture} from './support/validation-fixture.mjs';
if(process.env.AB_TEST_MODE!=='1'||!process.env.AB_TEST_MANIFEST)throw new Error('ISOLATED_TEST_REQUIRED');
const m=JSON.parse(await readFile(process.env.AB_TEST_MANIFEST)),groups=[],logs=[],outputs=[],evidence={},errors=[];
const secret='validation_secret_'+randomBytes(20).toString('hex'),bodyMarker='validation_body_'+randomBytes(20).toString('hex'),key=()=>randomUUID();
const admin=fn=>withConnection(m.configs.admin,fn),actor=who=>m.actors.find(x=>x.label===who).actorId;
let a,b,hard,unselected,passed,unknown,failed,requestA,policyA;
async function call(who,op,n,p={}){const r=await executeCommand(m.configs[who],op,{novel_id:n,request:p},{logger:x=>logs.push(x)});outputs.push({who,op,r});if(!r.ok)errors.push(r);
 if(r.error==='REQUEST_FAILED'&&op==='validation:run'&&(evidence.diagnostics?.length??0)<8)await withConnection(m.configs[who],async c=>{await c.query('BEGIN');try{await api(c,op,n,p);}catch(e){evidence.diagnostics??=[];evidence.diagnostics.push({sqlstate:e.code,functions:[...(e.where??'').matchAll(/function ([a-z_]+)/g)].map(x=>x[1])});}finally{await c.query('ROLLBACK');}});return r;}
async function ok(p){const r=await p;assert.equal(r.ok,true);return r;}
async function deny(p,code){const r=await p;assert.equal(r.ok,false);if(code)assert.equal(r.error,code);return r;}
async function sqlError(fn,code){let e;try{await fn();}catch(error){e=error;}if(!(Array.isArray(code)?code:[code]).includes(e?.code)){evidence.sqlMismatch??=[];evidence.sqlMismatch.push({expected:code,actual:e?.code??'no_error'});}assert.ok((Array.isArray(code)?code:[code]).includes(e?.code));}
function group(name,body){test(name,{timeout:120000},async t=>{const g={name,status:'passed',cases:[]};groups.push(g);await body(async(label,fn)=>t.test(label,{timeout:25000},async()=>{const c={name:label,status:'passed'};g.cases.push(c);try{await fn();}catch(e){g.status='failed';c.status='failed';c.failure={code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'CHECK_FAILED',line:Number(e.stack?.match(/finite-validation.integration.test.mjs:(\d+):/)?.[1]??0)};throw new Error('CHECK_FAILED '+label);}}));});}
const fixture=opts=>createValidationFixture(m.configs,m.actors,{secret,body:bodyMarker,...opts});
async function publish(f,previous=null){return ok(call(f.author,'validation-policy:publish',f.novel,{request_key:key(),expected_release_id:previous}));}
const request=f=>({request_key:key(),workflow_ref:f.workflow,expected_candidate_ref:f.candidate,expected_selection_version:f.selection});
const run=(f,p=request(f))=>call(f.author,'validation:run',f.novel,p);
const history=f=>call(f.author,'validation:history',f.novel,{workflow_ref:f.workflow});
const current=(f,id)=>call(f.author,'validation:current',f.novel,{validation_ref:id});
async function selected(f,c,version){return ok(call(f.writer,'candidate:select',f.novel,{request_key:key(),workflow_ref:f.workflow,candidate_ref:c,expected_selection_version:version}));}
async function candidate(f,text=bodyMarker,previous=f.candidate){return ok(call(f.writer,'candidate:edit',f.novel,{request_key:key(),workflow_ref:f.workflow,previous_candidate_ref:previous,body:text}));}
async function api(c,op,n,p){return(await c.query('SELECT agent_book.api_finite_validation($1,$2,$3,$4,$5) r',[op,n,JSON.stringify(p),Array.from({length:128},key),key()])).rows[0].r;}
async function revoke(c,g){return(await c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[g,key()])).rows[0].r;}
async function selectionApi(c,f,candidate,version){return(await c.query('SELECT agent_book.api_manual_workflow($1,$2,$3,$4,$5) r',['candidate:select',f.novel,JSON.stringify({request_key:key(),workflow_ref:f.workflow,candidate_ref:candidate,expected_selection_version:version}),Array.from({length:16},key),key()])).rows[0].r;}
async function snapshot(){return admin(async c=>{const r={};for(const t of ['validation_policy_release','validation_run','validation_check','validation_command_request','validation_access_audit','workflow_run','workflow_candidate_selection_history','candidate_version'])r[t]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${t} t ORDER BY to_jsonb(t)::text`)).rows;return r;});}
async function observe(o,waiter,blocker){const end=Date.now()+4500;while(Date.now()<end){const r=(await o.query('SELECT wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[waiter])).rows[0];if(r?.wait_event_type==='Lock'&&r.blockers.includes(blocker))return r;await new Promise(r=>setTimeout(r,15));}throw new Error('BLOCK_NOT_OBSERVED');}
async function race(firstWho,first,secondWho,second){const clients=await Promise.all([firstWho,secondWho,'admin'].map(async who=>{const c=new pg.Client(connectionOptions(m.configs[who]));await c.connect();return c;}));const[x,y,o]=clients;let pending;try{const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await y.query('BEGIN');const one=await first(x);pending=second(y);pending.catch(()=>{});const w=await observe(o,pids[1],pids[0]);await x.query('COMMIT');const two=await pending;await y.query('COMMIT');return{one,two,evidence:{blocker:pids[0],waiter:pids[1],observer:pids[2],wait_event:w.wait_event,actualBlockerConfirmed:true}};}finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}}
async function clone(f,id,change={}){return admin(c=>inTransaction(c,async tx=>{const old=(await tx.query('SELECT to_jsonb(r) r FROM agent_book.validation_run r WHERE validation_run_id=$1',[id])).rows[0].r,newId=key();const copy={...old,validation_run_id:newId,...change.run};await tx.query('INSERT INTO agent_book.validation_run SELECT * FROM jsonb_populate_record(NULL::agent_book.validation_run,$1)',[JSON.stringify(copy)]);
 const checks=(await tx.query('SELECT to_jsonb(d) r FROM agent_book.validation_check d WHERE validation_run_id=$1 ORDER BY position',[id])).rows.map(x=>x.r);for(const d of checks){if(change.missing&&d.position===1)continue;const row={...d,validation_run_id:newId,validation_check_id:key()};if(change.badCheck&&d.position===1)row.outcome='unknown';await tx.query('INSERT INTO agent_book.validation_check SELECT * FROM jsonb_populate_record(NULL::agent_book.validation_check,$1)',[JSON.stringify(row)]);}}));}
after(async()=>{await writeFile(process.env.AB_TEST_RESULTS,JSON.stringify({runId:m.runId,groups,evidence,logs}));await writeFile(process.env.AB_TEST_RESULTS+'.markers',JSON.stringify([secret,bodyMarker]),{mode:0o600});});

group('A 真实 author 与有限检查结果',async sub=>{
 await sub('全新合法软约束任务通过，实际 author 记录与冻结输入一致',async()=>{
  a=await fixture({label:'validation-a'});b=await fixture({label:'validation-b',author:'authorB',writer:'writerB'});hard=await fixture({label:'validation-hard',hard:true});
  await initializeNovelReader(m.configs.admin,{actorId:actor('auditorA'),novelId:a.novel});await initializeNovelReader(m.configs.admin,{actorId:actor('writerA'),novelId:a.novel});
  policyA=(await publish(a)).release_id;await publish(b);await publish(hard);requestA=request(a);passed=await ok(run(a,requestA));assert.equal(passed.overall,'passed');assert.equal(passed.current_applicable,true);assert.equal(passed.approval_implemented,false);
  const h=await ok(history(a)),r=h.runs[0];assert.equal(r.executed_by,actor('authorA'));assert.equal(r.writer_actor_id,a.writerId);assert.equal(r.selection_version,1);assert.equal(r.candidate_content_hash,createHash('sha256').update(bodyMarker).digest('hex'));assert.equal(r.release_id,policyA);assert.equal(r.checks.length,7);assert.equal(r.checks.filter(d=>d.required).length,6);assert.ok(r.checks.every(d=>d.required?d.outcome==='passed':d.outcome==='unknown'&&d.code==='RULE_NOT_CHECKED'));assert.equal(r.implementation_version,'finite-validator-v1');
  evidence.path={realAuthorExecutor:true,noValidatorImpersonation:true,newLegalDesignWithoutHardRule:true,allTechnicalChecksPassed:true,softExplicitlyUnchecked:true};
 });
 await sub('适用自由文本 hard 固定 unknown 并阻断；真实超覆盖正文 failed',async()=>{
  unknown=await ok(run(hard));assert.equal(unknown.overall,'unknown');assert.equal(hard.taskInput.constraint_ids.length,0);assert.equal(unknown.covered_checks_pass,false);const h=(await ok(history(hard))).runs[0];assert.ok(h.checks.some(d=>d.constraint_id===hard.constraint&&d.required&&d.outcome==='unknown'&&d.code==='RULE_UNSUPPORTED'));
  const large=await fixture({label:'validation-failed',body:'界'.repeat(22000)});await publish(large);failed=await ok(run(large));assert.equal(failed.overall,'failed');assert.equal(failed.covered_checks_pass,false);assert.ok((await ok(history(large))).runs[0].checks.some(d=>d.check_key==='review_bytes'&&d.outcome==='failed'));
  evidence.results={passed:true,failed:true,hardUnknownBlocks:true,notNaturalLanguageValidation:true};
 });
 await sub('writer、独立 author、auditor 及未开放服务均不能发起或冒充执行',async()=>{
  for(const who of ['writerA','authorB','auditorA','validator','commit','projection'])await deny(call(who,'validation:run',a.novel,request(a)));
  await deny(call('writerA','validation:history',a.novel,{workflow_ref:a.workflow}));await deny(call('auditorA','validation:history',a.novel,{workflow_ref:a.workflow}),'ACCESS_DENIED');
  for(const patch of [{pass:true},{score:100},{checks:[]},{actor_id:actor('validator')},{checker:'arbitrary code'},{snippet:secret}])await deny(run(a,{...request(a),...patch}),'INVALID_REQUEST');
 });
 await sub('无选择、预期过时及实际跨 Novel/Workflow Candidate 拒绝',async()=>{
  unselected=await fixture({label:'validation-unselected',select:false});await publish(unselected);await deny(run(unselected),'NO_CURRENT_SELECTION');
  await deny(run(a,{...request(a),expected_candidate_ref:b.candidate}),'VERSION_CONFLICT');await deny(run(a,{...request(a),expected_selection_version:0}),'VERSION_CONFLICT');await deny(run(a,{...request(a),workflow_ref:b.workflow}),'INVALID_REQUEST');
  await deny(current(a,unknown.validation_ref),'VALIDATION_STALE');await deny(call('authorB','validation:history',a.novel,{workflow_ref:a.workflow}),'ACCESS_DENIED');
 });
});

group('B 冻结集合、摘要和数据库完整性',async sub=>{
 await sub('必需集合与结果独立重算摘要，实际来源及绑定完整',async()=>{
  const r=(await ok(history(a))).runs[0],sha=(kind,p)=>createHash('sha256').update('validation-jsonb-v1:'+kind+'\n'+p).digest('hex');
  const native=(await admin(c=>c.query('SELECT required_check_set::text text FROM agent_book.validation_run WHERE validation_run_id=$1',[passed.validation_ref]))).rows[0].text;assert.equal(r.check_set_hash,sha('check-set',native));
  const actual=(await admin(c=>c.query("SELECT jsonb_agg(jsonb_build_object('position',position,'check_key',check_key,'check_version',check_version,'required',required,'constraint_id',constraint_id,'outcome',outcome,'code',code) ORDER BY position)::text text FROM agent_book.validation_check WHERE validation_run_id=$1",[passed.validation_ref]))).rows[0].text;assert.equal(r.result_hash,sha('results',actual));
  assert.equal(r.task_version_id,a.version);assert.equal(r.revision_id,a.revision);assert.equal(r.input_canon_watermark,0);assert.equal(r.required_check_set.length,r.checks.length);evidence.binding={actualFkChain:true,independentCheckSetAndResultSha256:true,bodyAndPayloadHashes:true};
 });
 await sub('数据库拒绝遗漏/错误明细、错误 hash/绑定与伪造整体通过',async()=>{
  const before=await snapshot();for(const change of [{missing:true},{badCheck:true},{run:{check_set_hash:'0'.repeat(64)}},{run:{result_hash:'0'.repeat(64)}},{run:{candidate_content_hash:'0'.repeat(64)}},{run:{bundle_payload_hash:'0'.repeat(64)}},{run:{candidate_version_id:b.candidate}}])await sqlError(()=>clone(a,passed.validation_ref,change),['23514','23503']);
  await sqlError(()=>clone(hard,unknown.validation_ref,{run:{overall:'passed'}}),'23514');assert.deepEqual(await snapshot(),before);evidence.integrity={missingDetailsRejected:true,falseOverallRejected:true,wrongHashesAndBindingsRejected:true,independentPhysicalStateUnchanged:true};
 });
 await sub('冻结 Run/检查/策略/请求/审计不可改删，历史不能追加检查',async()=>{
  for(const [t,col]of [['validation_run','overall'],['validation_check','outcome'],['validation_policy_release','policy_version'],['validation_command_request','operation'],['validation_access_audit','operation']]){
   await sqlError(()=>admin(c=>c.query(`UPDATE agent_book.${t} SET ${col}=${col}`)),'23514');await sqlError(()=>admin(c=>c.query(`DELETE FROM agent_book.${t}`)),'23514');await sqlError(()=>admin(c=>c.query(`TRUNCATE agent_book.${t} CASCADE`)),['23514','0A000']);
  }
  const before=await snapshot();await sqlError(()=>admin(c=>c.query("INSERT INTO agent_book.validation_check VALUES($1,$2,$3,$4,8,'extra','finite-check-v1',true,NULL,'passed','CHECK_PASSED')",[key(),passed.validation_ref,a.novel,a.revision])),'23514');assert.deepEqual(await snapshot(),before);
 });
});

group('C 幂等、编辑、选择与 Release 身份',async sub=>{
 await sub('同键不重执行、异请求拒绝；独立正文编辑不扩展旧结果覆盖',async()=>{
  assert.deepEqual(await ok(run(a,requestA)),passed);await deny(run(a,{...requestA,expected_selection_version:2}),'IDEMPOTENCY_CONFLICT');const next=await candidate(a);assert.notEqual(next.candidate_ref,a.candidate);assert.equal((await ok(current(a,passed.validation_ref))).current_applicable,true);
  assert.equal((await ok(history(a))).runs.length,1);evidence.edit={doesNotSelect:true,oldResultOnlyOriginalCandidate:true,sameBodyNewCandidate:true};a.newCandidate=next.candidate_ref;
 });
 await sub('选择变化与 A→B→A 均不恢复旧校验，新 Candidate 必须独立记录',async()=>{
  await selected(a,a.newCandidate,1);await deny(current(a,passed.validation_ref),'VALIDATION_STALE');await deny(run(a,requestA),'VALIDATION_STALE');a.selection=2;const nr=await ok(run({...a,candidate:a.newCandidate}));assert.notEqual(nr.validation_ref,passed.validation_ref);
  await selected(a,a.candidate,2);a.selection=3;await deny(current(a,passed.validation_ref),'VALIDATION_STALE');await deny(current(a,nr.validation_ref),'VALIDATION_STALE');const again=await ok(run(a));assert.notEqual(again.validation_ref,passed.validation_ref);a.latest=again;
  evidence.selection={candidateIdentityNotHash:true,abaDoesNotRestore:true,oldReplayNoExecution:true};
 });
 await sub('重新发布相同规则内容使用新 Release，旧结果不复活且历史不改写',async()=>{
  const old=await ok(history(a));const next=await publish(a,policyA);assert.notEqual(next.release_id,policyA);await deny(current(a,a.latest.validation_ref),'VALIDATION_STALE');const newRun=await ok(run(a));
  const releases=(await admin(c=>c.query('SELECT content_hash,generation FROM agent_book.validation_policy_release WHERE novel_id=$1 ORDER BY generation',[a.novel]))).rows;assert.equal(releases.length,2);assert.equal(releases[0].content_hash,releases[1].content_hash);assert.equal(Number(releases[1].generation),2);
  assert.equal((await ok(history(a))).runs.find(r=>r.validation_run_id===a.latest.validation_ref).result_hash,old.runs.find(r=>r.validation_run_id===a.latest.validation_ref).result_hash);a.latest=newRun;policyA=next.release_id;evidence.policy={sameContentNewIdentity:true,oldRunNotApplicable:true,historyUnchanged:true};
 });
});

group('D 输入与授权失效后的历史',async sub=>{
 for(const reason of ['publication','context-policy','task','design','writing-revoke','context-revoke'])await sub(`${reason} 变化拒绝当前取用与重放，完整历史仍可查询`,async()=>{
  const f=await fixture({label:'stale-'+reason});await publish(f);const p=request(f),r=await ok(run(f,p));
  if(reason==='publication')await ok(call(f.author,'projection:revoke',f.novel,{request_key:key(),publication_id:f.publications[0]}));
  if(reason==='context-policy')await ok(call(f.author,'context-policy:publish',f.novel,{request_key:key(),task_version_id:f.version,expected_release_id:f.contextPolicy,policy_version:'safe-context-v2'}));
  if(reason==='task')await ok(call(f.author,'task:append',f.novel,{request_key:key(),task_id:f.task,expected_version_id:f.version,...f.taskInput}));
  if(reason==='design'){const d=await ok(call(f.author,'design:draft',f.novel,{request_key:key(),base_revision_id:f.revision}));await ok(call(f.author,'design:freeze',f.novel,{request_key:key(),draft_id:d.draft_id,expected_edit_version:1,expected_current_revision_id:f.revision}));}
  if(reason.endsWith('revoke'))await ok(executeCommand(m.configs[f.author],'grant:revoke',{grant_id:reason==='writing-revoke'?f.writing:f.contextGrant}));
  await deny(current(f,r.validation_ref),'VALIDATION_STALE');await deny(run(f,p),'VALIDATION_STALE');await deny(run(f),'ACCESS_DENIED');const hist=(await ok(history(f))).runs;assert.equal(hist.length,1);assert.equal(hist[0].overall,'passed');assert.equal(hist[0].current_applicable,false);evidence.stale??={};evidence.stale[reason]=true;
 });
 await sub('作者自身失权后不能用旧请求键取回结果',async()=>{
  const f=await fixture({label:'author-revoke'});await publish(f);const p=request(f);await ok(run(f,p));const grant=(await admin(c=>c.query("SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND ca.capability_key='design.read'",[f.novel]))).rows[0].grant_id;
  await ok(executeCommand(m.configs[f.author],'grant:revoke',{grant_id:grant}));await deny(run(f,p),'ACCESS_DENIED');await deny(history(f),'ACCESS_DENIED');
 });
});

group('E 真实并发与数据库时点',async sub=>{
 await sub('校验先受保护完成，写作撤销等待；结果保存后当前适用性拒绝',async()=>{
  const f=await fixture({label:'validate-first'});await publish(f);const r=await race(f.author,c=>api(c,'validation:run',f.novel,request(f)),f.author,c=>revoke(c,f.writing));assert.equal(r.one.ok,true);assert.equal(r.two.ok,true);await deny(current(f,r.one.validation_ref),'VALIDATION_STALE');assert.equal((await ok(history(f))).runs.length,1);evidence.validationFirst=r.evidence;
 });
 await sub('撤销先行，等待校验拒绝且无 Run',async()=>{
  const f=await fixture({label:'revoke-first'});await publish(f);const r=await race(f.author,c=>revoke(c,f.writing),f.author,c=>api(c,'validation:run',f.novel,request(f)));assert.equal(r.one.ok,true);assert.equal(r.two.error,'ACCESS_DENIED');assert.equal((await ok(history(f))).runs.length,0);evidence.revocationFirst=r.evidence;
 });
 await sub('校验先行和选择先行分别得到完整顺序，无错候选校验',async()=>{
  for(const validationFirst of [true,false]){const f=await fixture({label:'selection-race'});await publish(f);const next=await candidate(f);const r=validationFirst?await race(f.author,c=>api(c,'validation:run',f.novel,request(f)),f.writer,c=>selectionApi(c,f,next.candidate_ref,1)):await race(f.writer,c=>selectionApi(c,f,next.candidate_ref,1),f.author,c=>api(c,'validation:run',f.novel,request(f)));
   assert.equal(r.one.ok,true);assert.equal(validationFirst?r.two.ok:r.two.error,validationFirst?true:'VERSION_CONFLICT');const h=await ok(history(f));assert.equal(h.runs.length,validationFirst?1:0);if(validationFirst)assert.equal(h.runs[0].current_applicable,false);evidence[validationFirst?'validateBeforeSelection':'selectionBeforeValidation']=r.evidence;
  }
 });
 await sub('等待跨过原上下文截止，观察数据库时间后释放保护并拒绝',async()=>{
  const deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+interval '5 seconds')::text t"))).rows[0].t,f=await fixture({label:'expiry',expiresAt:deadline});await publish(f);const original=await ok(run(f));
  const clients=await Promise.all([f.author,f.author,'admin'].map(async who=>{const c=new pg.Client(connectionOptions(m.configs[who]));await c.connect();return c;}));const[x,y,o]=clients;let pending;
  try{const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await x.query('SELECT agent_book.api_identity($1)',[key()]);await y.query('BEGIN');pending=api(y,'validation:run',f.novel,request(f));pending.catch(()=>{});await observe(o,pids[1],pids[0]);let row;const end=Date.now()+6500;while(Date.now()<end){row=(await o.query('SELECT clock_timestamp()::text t,clock_timestamp()>$1::timestamptz passed',[deadline])).rows[0];if(row.passed)break;await new Promise(r=>setTimeout(r,15));}assert.equal(row.passed,true);await x.query('COMMIT');assert.equal((await pending).error,'ACCESS_DENIED');await y.query('COMMIT');await deny(current(f,original.validation_ref),'VALIDATION_STALE');assert.equal((await ok(history(f))).runs.length,1);evidence.expiry={blocker:pids[0],waiter:pids[1],observer:pids[2],actualBlockerConfirmed:true,deadline,databaseObserved:row.t,denied:true};
  }finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}
 });
});

group('F 回滚、权限、审计与完整输出扫描',async sub=>{
 await sub('中途故障及外层回滚，所有新增表及旧选择状态不变',async()=>{
  const before=await snapshot();await admin(c=>c.query(`CREATE FUNCTION public.validation_test_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_FAILURE';END $f$;CREATE TRIGGER validation_test_fault AFTER INSERT ON agent_book.validation_check FOR EACH ROW EXECUTE FUNCTION public.validation_test_fault()`));try{await deny(run(a),'REQUEST_FAILED');}finally{await admin(c=>c.query('DROP TRIGGER validation_test_fault ON agent_book.validation_check;DROP FUNCTION public.validation_test_fault()'));}assert.deepEqual(await snapshot(),before);
  await withConnection(m.configs.authorA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'validation:run',a.novel,request(a))).ok,true);await c.query('ROLLBACK');});assert.deepEqual(await snapshot(),before);evidence.rollback={midCheckFailure:true,outerRollback:true,allTablesAndSelectionUnchanged:true};
 });
 await sub('真实 COMMIT 延后失败，函数返回不能被当作成功交付',async()=>{
  const before=await snapshot();await admin(c=>c.query(`CREATE FUNCTION public.validation_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'TEST_COMMIT_FAILURE';END $f$;CREATE CONSTRAINT TRIGGER validation_commit_fault AFTER INSERT ON agent_book.validation_check DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.validation_commit_fault()`));try{
   await withConnection(m.configs.authorA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'validation:run',a.novel,request(a))).ok,true);await sqlError(()=>c.query('COMMIT'),'P0001');});await deny(run(a),'REQUEST_FAILED');
  }finally{await admin(c=>c.query('DROP TRIGGER validation_commit_fault ON agent_book.validation_check;DROP FUNCTION public.validation_commit_fault()'));}assert.deepEqual(await snapshot(),before);evidence.rollback.realCommitFailure=true;evidence.rollback.serviceWithheldResult=true;
 });
 await sub('审计过滤跨 Novel/Task/Workflow 资源，保留原引用与合法历史',async()=>{
  const rb=await ok(run(b));const ids=[key(),key(),key()];
  const otherTask=await ok(call(a.author,'task:create',a.novel,{request_key:key(),...a.taskInput}));
  await admin(async c=>{await c.query("INSERT INTO agent_book.validation_access_audit VALUES($1,$4,$5,$6,$7,'foreign-resource','deny','run',$8,NULL,clock_timestamp()),($2,$4,$5,$9,$7,'wrong-task','deny','run',$10,NULL,clock_timestamp()),($3,$4,$5,NULL,NULL,'ordinary','deny','none',NULL,NULL,clock_timestamp())",[...ids,actor('authorA'),a.novel,a.version,a.workflow,rb.validation_ref,otherTask.version_id,a.latest.validation_ref]);});
  const otherWorkflow=await ok(call(a.writer,'workflow:create',a.novel,{request_key:key(),writing_grant_id:a.writing,bundle_ref:a.bundle,execution_mode:'manual_input_v1'}));
  const otherCandidate=await ok(call(a.writer,'candidate:input',a.novel,{request_key:key(),workflow_ref:otherWorkflow.workflow_ref,body:bodyMarker}));await ok(call(a.writer,'candidate:select',a.novel,{request_key:key(),workflow_ref:otherWorkflow.workflow_ref,candidate_ref:otherCandidate.candidate_ref,expected_selection_version:0}));
  const otherResult=await ok(run({...a,workflow:otherWorkflow.workflow_ref,candidate:otherCandidate.candidate_ref,selection:1})),badWorkflowEvent=key();
  await admin(c=>c.query("INSERT INTO agent_book.validation_access_audit VALUES($1,$2,$3,$4,$5,'wrong-workflow','deny','run',$6,NULL,clock_timestamp())",[badWorkflowEvent,actor('authorA'),a.novel,a.version,a.workflow,otherResult.validation_ref]));
  const audit=await ok(call('auditorA','validation:audit',a.novel,{}));for(const id of [ids[0],ids[1],badWorkflowEvent,rb.validation_ref])assert.equal(JSON.stringify(audit).includes(id),false);assert.ok(audit.events.some(x=>x.audit_id===ids[2]));assert.ok(audit.events.some(x=>x.resource_id===otherResult.validation_ref));assert.ok(audit.events.some(x=>x.resource_id===a.latest.validation_ref));assert.equal((await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.validation_access_audit WHERE audit_id=ANY($1)',[ids]))).rows[0].n,3);
  const all=await ok(executeCommand(m.configs.auditorA,'audit:read',{novel_id:a.novel}));assert.ok(all.events.some(x=>x.resource_id===a.latest.validation_ref));assert.equal(scanSecrets([audit,all],[secret,bodyMarker,a.constraint,a.revision,a.bundle]),0);await deny(call('auditorA','validation:audit',b.novel,{}),'ACCESS_DENIED');evidence.audit={actualResourceScope:true,rawRowsPreserved:true,legalHistoricalEventsRetained:true,auditorNoBodyOrRule:true};
 });
 await sub('005 后旧命令兼容；真实角色、函数 ACL、所有者、路径及约束完整',async()=>{
  for(const [who,op,p]of [[a.author,'design:history',{}],[a.author,'task:history',{}],[a.writer,'workflow:read',{workflow_ref:a.workflow}],[a.writer,'context:read',{bundle_ref:a.bundle}]])await ok(call(who,op,a.novel,p));
  for(const who of ['writerA','validator','commit','projection'])await sqlError(()=>withConnection(m.configs[who],c=>api(c,'validation:history',a.novel,{workflow_ref:a.workflow})),'42501');
  for(const who of ['authorA','auditorA','writerA'])for(const sql of ['SELECT * FROM agent_book.validation_run','SELECT agent_book._val_policy(NULL::uuid)','SELECT agent_book._read_audit_pre_validation(NULL::uuid,NULL::uuid)'])await sqlError(()=>withConnection(m.configs[who],c=>c.query(sql)),'42501');
  await admin(async c=>{const fs=(await c.query("SELECT p.oid,p.proname,p.prosecdef,p.proconfig,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book'")).rows;for(const f of fs){assert.equal(f.owner,m.owner);assert.equal(f.prosecdef,true);assert.ok(f.proconfig.includes('search_path=pg_catalog, agent_book, pg_temp'));}
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='agent_book' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
   for(const a of m.actors){const login=a.login;assert.equal((await c.query('SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls high FROM pg_roles WHERE rolname=$1',[login])).rows[0].high,false);assert.equal((await c.query('SELECT count(*)::int n FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member WHERE r.rolname=$1',[login])).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee=$1 AND table_schema='agent_book'",[login])).rows[0].n,0);for(const f of fs.filter(f=>f.proname.startsWith('_val_')||f.proname==='_read_audit_pre_validation'))assert.equal((await c.query("SELECT has_function_privilege($1,$2,'EXECUTE') yes",[login,f.oid])).rows[0].yes,false);}
   assert.equal((await c.query("SELECT count(*)::int n FROM pg_constraint WHERE connamespace='agent_book'::regnamespace AND NOT convalidated")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='agent_book'::regnamespace AND t.tgenabled='D'")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'validation_%fault%'")).rows[0].n,0);evidence.permissions={functions:fs.length,publicExecute:0,privateHelperExecute:0,basePrivileges:0,highMemberships:0,unvalidatedConstraints:0,disabledTriggers:0,faultResidue:0,validatorBusinessPermission:false};});
 });
 await sub('真实 CLI、日志、嵌套错误、auditor 和 PostgreSQL 日志零敏感披露',async()=>{
  const file=process.env.AB_TEST_RESULTS+'.request.json';await writeFile(file,JSON.stringify(request(a)),{mode:0o600});const cli=spawnSync(process.execPath,['src/cli.mjs','validation:run',a.novel,file],{env:{...process.env,AB_CONFIG:m.configPaths.authorA},encoding:'utf8',timeout:15000});assert.equal(cli.status,0);assert.equal(JSON.parse(cli.stdout).overall,'passed');
  await writeFile(file,JSON.stringify({...request(a),pass:true,nested:{body:bodyMarker,rule:secret}}),{mode:0o600});const bad=spawnSync(process.execPath,['src/cli.mjs','validation:run',a.novel,file],{env:{...process.env,AB_CONFIG:m.configPaths.authorA},encoding:'utf8',timeout:15000});assert.notEqual(bad.status,0);
  const pglog=spawnSync('docker',['logs',m.container],{encoding:'utf8',timeout:15000});assert.equal(pglog.status,0);const secrets=[secret,bodyMarker,...Object.values(m.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])];
  assert.equal(scanSecrets([logs,errors,cli.stdout,cli.stderr,bad.stdout,bad.stderr,pglog.stdout,pglog.stderr,...outputs.filter(x=>x.who==='auditorA').map(x=>x.r)],secrets),0);assert.equal(scanSecrets([logs,errors,cli.stdout,cli.stderr,pglog.stdout,pglog.stderr],[a.revision,a.constraint,a.object,a.contextGrant,a.writing]),0);evidence.disclosure={logCount:logs.length,responseCount:outputs.length,actualPgLogScanned:true,cliScanned:true,auditorScanned:true,secretCredentialBodyAndRuleLeaks:0};
 });
});
