import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { executeCommand } from '../src/foundation.mjs';
import { withConnection } from '../src/database.mjs';
import { createValidationFixture } from './support/validation-fixture.mjs';
import { registerTestNovel } from '../scripts/test-generation-initialize.mjs';

const key=()=>randomUUID();
const checkRows=rows=>rows.map(x=>({position:x.position,check:x.check_key.startsWith('rule:')?'author_rule':x.check_key,required:x.required,outcome:x.outcome,code:x.code}));
export async function runHistoricalTimeExperiments(i,{expectFixed,beforeOnly=false}={}){
 const secret='authorization_time_'+randomBytes(20).toString('hex'),logs=[],errors=[],cases=[];
 const admin=action=>withConnection(i.configs.admin,action);
 async function call(f,op,p,who=f.author){const r=await executeCommand(i.configs[who],op,{novel_id:f.novel,request:p},{logger:x=>logs.push(x),generationRuntime:{executorConfig:i.executor}});if(!r.ok)errors.push(r);return r;}
 async function ok(p){const r=await p;assert.equal(r.ok,true);return r;}
 async function waitAfter(deadline,observer){const end=Date.now()+6500;while(Date.now()<end){const r=(await observer.query('SELECT clock_timestamp()::text observed,clock_timestamp()>$1::timestamptz expired',[deadline])).rows[0];if(r.expired)return r.observed;await new Promise(resolve=>setTimeout(resolve,15));}throw new Error('DATABASE_DEADLINE_NOT_OBSERVED');}
 async function snapshot(){return admin(async c=>{const data={};for(const{tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows)data[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows;return data;});}
 async function setup(mode,{finite=true,body='历史授权对照正文',windowMs=2200}={}){
  const f=await createValidationFixture(i.configs,i.actors,{label:'authorization-time-'+mode,secret,body});
  await ok(executeCommand(i.configs[f.author],'grant:revoke',{grant_id:f.contextGrant}));
  if(mode==='test_generation')await registerTestNovel(i.configs.admin,f.novel);
  let deadline=null;if(finite)deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+$1::integer*interval '1 millisecond')::text deadline",[windowMs]))).rows[0].deadline;
  f.contextGrant=(await ok(call(f,'context-grant:create',{request_key:key(),task_version_id:f.version,writer_actor_id:f.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:deadline}))).grant_id;
  f.bundle=(await ok(call(f,'context:compile',{request_key:key(),task_version_id:f.version,max_bytes:65536},f.writer))).bundle_ref;
  if(mode==='test_generation'){
   f.generationGrant=(await ok(call(f,'generation-grant:create',{request_key:key(),context_grant_id:f.contextGrant,expires_at:null}))).grant_id;
   f.workflow=(await ok(call(f,'test-workflow:create',{request_key:key(),generation_grant_id:f.generationGrant,bundle_ref:f.bundle,execution_mode:'test_generation_v1'},f.writer))).workflow_ref;
   f.generationRequest={request_key:key(),workflow_ref:f.workflow,expected_selection_version:0,adapter_id:'fixed-test-v1',parameters:{protocol:'test-parameters-v1',max_output_bytes:4096}};const generated=await ok(call(f,'generation:execute',f.generationRequest,f.writer));assert.equal(generated.execution_state,'accepted');f.candidate=generated.candidate_ref;
   f.body=(await ok(call(f,'workflow:read',{workflow_ref:f.workflow},f.writer))).candidates[0].body;
  }else{
   f.writing=(await ok(call(f,'writing-grant:create',{request_key:key(),context_grant_id:f.contextGrant,expires_at:null}))).grant_id;
   f.workflow=(await ok(call(f,'workflow:create',{request_key:key(),writing_grant_id:f.writing,bundle_ref:f.bundle,execution_mode:'manual_input_v1'},f.writer))).workflow_ref;
   f.candidate=(await ok(call(f,'candidate:input',{request_key:key(),workflow_ref:f.workflow,body},f.writer))).candidate_ref;f.body=body;
  }
  f.selection=(await ok(call(f,'candidate:select',{request_key:key(),workflow_ref:f.workflow,candidate_ref:f.candidate,expected_selection_version:0},f.writer))).selection_version;
  await ok(call(f,'validation-policy:publish',{request_key:key(),expected_release_id:null}));f.mode=mode;
  const facts=await admin(async c=>({deadline:(await c.query('SELECT expires_at::text deadline FROM agent_book.context_grant WHERE context_grant_id=$1',[f.contextGrant])).rows[0].deadline,
   inherited:(await c.query(mode==='test_generation'?'SELECT expires_at::text deadline FROM agent_book.test_generation_grant WHERE generation_grant_id=$1':'SELECT expires_at::text deadline FROM agent_book.manual_writing_grant WHERE writing_grant_id=$1',[mode==='test_generation'?f.generationGrant:f.writing])).rows[0].deadline,
   authorValid:(await c.query("SELECT agent_book._ctx_manage($1,$2) valid,count(*) FILTER(WHERE g.expires_at IS NULL AND x.grant_id IS NULL)::int unlimited FROM agent_book.capability_grant g JOIN agent_book.capability cap USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) LEFT JOIN agent_book.grant_revocation x USING(grant_id) WHERE g.actor_id=$1 AND s.novel_id=$2 AND cap.capability_key IN ('design.read','design.freeze','task.read','task.create')",[i.actors.find(a=>a.label===f.author).actorId,f.novel])).rows[0]}));
  assert.equal(facts.deadline,facts.inherited);assert.equal(facts.authorValid.valid,true);assert.equal(facts.authorValid.unlimited,4);f.deadline=facts.deadline;return f;
 }
 const validationRequest=f=>({request_key:key(),workflow_ref:f.workflow,expected_candidate_ref:f.candidate,expected_selection_version:f.selection});
 async function validation(c,f,p){return(await c.query('SELECT agent_book.api_finite_validation($1,$2,$3,$4,$5) r',['validation:run',f.novel,JSON.stringify(p),Array.from({length:128},key),key()])).rows[0].r;}
 async function inspectRun(c,id){const r=(await c.query('SELECT to_jsonb(v) data,executed_at::text executed FROM agent_book.validation_run v WHERE validation_run_id=$1',[id])).rows[0];const checks=(await c.query('SELECT to_jsonb(x) r FROM agent_book.validation_check x WHERE validation_run_id=$1 ORDER BY position',[id])).rows.map(x=>x.r);return{...r,checks};}
 async function persisted(f,id,p){return admin(async c=>{
  const run=(await c.query('SELECT count(*)::int n FROM agent_book.validation_run WHERE validation_run_id=$1',[id])).rows[0].n;
  return{runs:run,checks:(await c.query('SELECT count(*)::int n FROM agent_book.validation_check WHERE validation_run_id=$1',[id])).rows[0].n,
   requests:(await c.query("SELECT count(*)::int n FROM agent_book.validation_command_request WHERE novel_id=$1 AND operation='validation:run' AND request_key=$2",[f.novel,p.request_key])).rows[0].n,
   successfulAudit:(await c.query("SELECT count(*)::int n FROM agent_book.validation_access_audit WHERE resource_run_id=$1 AND operation='validation:run' AND decision='allow'",[id])).rows[0].n,
   epochs:(await c.query('SELECT count(*)::int n FROM agent_book.approval_validation_epoch WHERE validation_run_id=$1',[id])).rows[0].n};
 });}
 async function expiryCommit(f){
  const p=validationRequest(f),before=await snapshot();let evidence,id;
  await withConnection(i.configs[f.author],author=>withConnection(i.configs.admin,async observer=>{
   await author.query('BEGIN');try{
    const actualAuthor=(await author.query('SELECT pg_backend_pid() pid,session_user login')).rows[0];assert.equal(actualAuthor.login,i.configs[f.author].user);
    const result=await validation(author,f,p);assert.equal(result.ok,true);assert.equal(result.overall,'passed');id=result.validation_ref;const history=(await author.query('SELECT agent_book.api_finite_validation($1,$2,$3,$4,$5) r',['validation:history',f.novel,JSON.stringify({workflow_ref:f.workflow}),Array.from({length:128},key),key()])).rows[0].r;assert.equal(history.ok,true);const stored=history.runs.find(x=>x.validation_run_id===id),{checks,current_applicable,covered_checks_pass,...data}=stored;const initial={data,checks,executed:data.executed_at};assert.ok(initial.checks.filter(x=>x.required).every(x=>x.outcome==='passed'));
    assert.equal((await author.query('SELECT $1::timestamptz<$2::timestamptz before',[initial.executed,f.deadline])).rows[0].before,true);
    const observerPid=(await observer.query('SELECT pg_backend_pid() pid')).rows[0].pid;assert.notEqual(observerPid,actualAuthor.pid);const observed=await waitAfter(f.deadline,observer);const rebuilt=(await observer.query('SELECT * FROM agent_book._val_expected($1,$2,$3,$4) ORDER BY position',[f.workflow,f.candidate,initial.data.selection_id,initial.executed])).rows;
    evidence={mode:f.mode,deadline:f.deadline,executedAt:initial.executed,databaseObserved:observed,authorPid:actualAuthor.pid,observerPid,checks:checkRows(initial.checks),rebuiltChecks:checkRows(rebuilt),overall:initial.data.overall};
    try{await author.query('COMMIT');evidence.commit={ok:true,sqlstate:null,error:null};}catch(e){evidence.commit={ok:false,sqlstate:e.code,error:e.message==='VALIDATION_INCOMPLETE'?e.message:'UNEXPECTED_DATABASE_ERROR'};}
    if(evidence.commit.ok){const final=await admin(c=>inspectRun(c,id));assert.deepEqual(final.data,initial.data);assert.deepEqual(final.checks,initial.checks);evidence.checksAndHashesUnchanged=true;}else{assert.deepEqual(await snapshot(),before);evidence.noPartialRows=true;}
   }finally{await author.query('ROLLBACK');}
  }));
  evidence.persisted=await persisted(f,id,p);assert.equal(evidence.commit.ok,f.mode==='manual_input'||expectFixed);
  if(evidence.commit.ok){assert.deepEqual(evidence.persisted,{runs:1,checks:7,requests:1,successfulAudit:1,epochs:1});const current=await call(f,'validation:current',{validation_ref:id});assert.equal(current.error,'VALIDATION_STALE');const writer=await call(f,'workflow:read',{workflow_ref:f.workflow},f.writer);assert.equal(writer.error,'ACCESS_DENIED');evidence.currentApplicable=false;evidence.writerDenied=true;}
  else{assert.equal(evidence.commit.sqlstate,'23514');assert.equal(evidence.commit.error,'VALIDATION_INCOMPLETE');assert.ok(Object.values(evidence.persisted).every(x=>x===0));}
  return evidence;
 }
 let sharedBody;
 for(const mode of['test_generation','manual_input']){
  const f=await setup(mode,{body:sharedBody??'历史授权对照正文'});if(mode==='test_generation')sharedBody=f.body;else assert.equal(f.body,sharedBody);
  const result=await expiryCommit(f);cases.push({name:mode+' expires between execution and COMMIT',status:'passed',evidence:result});
 }

 if(!beforeOnly){
  async function captureInside(c,f,id){
   const h=(await c.query('SELECT agent_book.api_finite_validation($1,$2,$3,$4,$5) r',['validation:history',f.novel,JSON.stringify({workflow_ref:f.workflow}),Array.from({length:128},key),key()])).rows[0].r;assert.equal(h.ok,true);const {checks,current_applicable,covered_checks_pass,...data}=h.runs.find(x=>x.validation_run_id===id);return{data,checks};
  }
  async function historicalAndCurrent(f,at){return admin(async c=>(await c.query('SELECT agent_book._val_writer_at(w,$2::timestamptz) historical,agent_book._val_writer_at(w,clock_timestamp()) current FROM agent_book.workflow_run w WHERE workflow_run_id=$1',[f.workflow,at])).rows[0]);}
  for(const mode of['test_generation','manual_input']){
   const f=await setup(mode,{body:sharedBody}),p=validationRequest(f);let result,observed,txStart;
   await withConnection(i.configs[f.author],author=>withConnection(i.configs.admin,async observer=>{
    await author.query('BEGIN');try{txStart=(await author.query('SELECT transaction_timestamp()::text t')).rows[0].t;assert.equal((await author.query('SELECT $1::timestamptz<$2::timestamptz valid',[txStart,f.deadline])).rows[0].valid,true);observed=await waitAfter(f.deadline,observer);result=await validation(author,f,p);assert.equal(result.error,'ACCESS_DENIED');await author.query('COMMIT');}finally{await author.query('ROLLBACK');}
   }));
   const state=await persisted(f,null,p);assert.ok(Object.values(state).every(v=>v===0));assert.equal((await admin(c=>c.query("SELECT count(*)::int n FROM agent_book.validation_access_audit WHERE workflow_run_id=$1 AND operation='validation:run' AND decision='deny'",[f.workflow]))).rows[0].n,1);
   cases.push({name:mode+' already expired before validation',status:'passed',evidence:{mode,deadline:f.deadline,transactionStarted:txStart,databaseObserved:observed,failureStage:'live_validation_admission',error:result.error,commit:{ok:true},persisted:state,denialAuditPersisted:true,transactionStartNotUsedForCurrentAuthorization:true}});
  }
  for(const [mode,grantKind]of[['test_generation','generation'],['test_generation','context'],['manual_input','writing'],['manual_input','context']]){
   const f=await setup(mode,{finite:false,body:sharedBody}),p=validationRequest(f),target=grantKind==='generation'?f.generationGrant:grantKind==='writing'?f.writing:f.contextGrant;let initial,id,afterRevoke;
   await withConnection(i.configs[f.author],async c=>{
    await c.query('BEGIN');try{const v=await validation(c,f,p);assert.equal(v.ok,true);id=v.validation_ref;initial=await captureInside(c,f,id);assert.equal(initial.data.overall,'passed');const revoked=(await c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[target,key()])).rows[0].r;assert.equal(revoked.ok,true);afterRevoke=(await c.query('SELECT clock_timestamp()::text t')).rows[0].t;
     const live=(await c.query('SELECT agent_book.api_finite_validation($1,$2,$3,$4,$5) r',['validation:current',f.novel,JSON.stringify({validation_ref:id}),Array.from({length:128},key),key()])).rows[0].r;assert.equal(live.error,'VALIDATION_STALE');await c.query('COMMIT');
    }finally{await c.query('ROLLBACK');}
   });
   const final=await admin(c=>inspectRun(c,id));assert.deepEqual(final.data,initial.data);assert.deepEqual(final.checks,initial.checks);const temporal=await historicalAndCurrent(f,initial.data.executed_at);assert.equal(temporal.historical,true);assert.equal(temporal.current,false);
   const table=grantKind==='generation'?'test_generation_revocation':grantKind==='writing'?'manual_writing_revocation':'context_grant_revocation',column=grantKind==='generation'?'generation_grant_id':grantKind==='writing'?'writing_grant_id':'context_grant_id';
   const rev=(await admin(c=>c.query(`SELECT revoked_at::text t,revoked_at>$2::timestamptz later FROM agent_book.${table} WHERE ${column}=$1`,[target,initial.data.executed_at]))).rows[0];assert.equal(rev.later,true);assert.equal((await call(f,'workflow:read',{workflow_ref:f.workflow},f.writer)).error,'ACCESS_DENIED');
   cases.push({name:mode+' '+grantKind+' revoked after execution before COMMIT',status:'passed',evidence:{mode,grantKind,executedAt:initial.data.executed_at,revokedAt:rev.t,databaseObserved:afterRevoke,checks:checkRows(initial.checks),commit:{ok:true,sqlstate:null,error:null},checksAndHashesUnchanged:true,historical:true,current:false,writerDenied:true,persisted:await persisted(f,id,p)}});
  }
  for(const grantKind of['generation','context']){
   const f=await setup('test_generation',{finite:false,body:sharedBody}),p=validationRequest(f),v=await ok(call(f,'validation:run',p)),before=await admin(c=>inspectRun(c,v.validation_ref));await ok(call(f,'approval-policy:publish',{request_key:key(),expected_release_id:null}));const review=await ok(call(f,'approval:review',{request_key:key(),workflow_ref:f.workflow})),approvalRequest={request_key:key(),workflow_ref:f.workflow,review_ref:review.review_ref,expected_decision_version:0,review_hash:review.review_hash,confirmed_soft_constraint_ids:review.review.required_soft_confirmation};const approved=await ok(call(f,'approval:approve',approvalRequest));assert.equal(approved.currently_usable,true);
   const oldBytes=(await admin(c=>c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref]))).rows[0].t;
   await ok(executeCommand(i.configs[f.author],'grant:revoke',{grant_id:grantKind==='generation'?f.generationGrant:f.contextGrant}));
   const replacement=grantKind==='generation'?await call(f,'generation-grant:create',{request_key:key(),context_grant_id:f.contextGrant,expires_at:null}):await call(f,'context-grant:create',{request_key:key(),task_version_id:f.version,writer_actor_id:f.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null});assert.equal(replacement.ok,true);
   const temporal=await historicalAndCurrent(f,before.executed);assert.equal(temporal.historical,true);assert.equal(temporal.current,false);const final=await admin(c=>inspectRun(c,v.validation_ref));assert.deepEqual(final.data,before.data);assert.deepEqual(final.checks,before.checks);
   assert.equal((await call(f,'approval:current',{workflow_ref:f.workflow})).error,'APPROVAL_UNAVAILABLE');assert.equal((await call(f,'approval:approve',approvalRequest)).error,'APPROVAL_UNAVAILABLE');assert.equal((await call(f,'generation:execute',f.generationRequest,f.writer)).error,'ACCESS_DENIED');
   const permanent=(await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.approval_invalidation_record WHERE approval_id=$1',[approved.decision_ref]))).rows[0].n;assert.equal(permanent,1);assert.equal(oldBytes,(await admin(c=>c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref]))).rows[0].t);
   cases.push({name:'test_generation '+grantKind+' later revocation and replacement never restore approval',status:'passed',evidence:{historical:true,current:false,checksAndHashesUnchanged:true,reviewBytesUnchanged:true,originalApprovalPermanentlyInvalidated:true,oldApprovalReplayDenied:true,generationReplayDenied:true,replacementDoesNotRebindOriginal:true}});
  }
  {
   const f=await setup('test_generation',{body:sharedBody,windowMs:1400}),before=(await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.candidate_version WHERE workflow_run_id=$1',[f.workflow]))).rows[0].n;let observed;
   const result=await executeCommand(i.configs[f.writer],'generation:execute',{novel_id:f.novel,request:{request_key:key(),workflow_ref:f.workflow,expected_selection_version:f.selection,adapter_id:'fixed-test-v1',parameters:{protocol:'test-parameters-v1',max_output_bytes:4096}}},{logger:x=>logs.push(x),generationRuntime:{executorConfig:i.executor,onPhase:async phase=>{if(phase==='response')await withConnection(i.configs.admin,async c=>{observed=await waitAfter(f.deadline,c);});}}});assert.equal(result.error,'ACCESS_DENIED');errors.push(result);
   const facts=(await admin(c=>c.query("SELECT f.outcome,f.candidate_version_id,r.outcome call_outcome,r.response_text IS NOT NULL response_saved,r.response_hash=agent_book._gen_sha(r.response_text) hash_valid FROM agent_book.generation_run g JOIN agent_book.model_call c USING(generation_run_id) JOIN agent_book.model_call_result r USING(model_call_id) JOIN agent_book.generation_finalization f ON f.generation_run_id=g.generation_run_id WHERE g.workflow_run_id=$1 ORDER BY g.prepared_at DESC LIMIT 1",[f.workflow]))).rows[0];assert.equal(facts.outcome,'input_rejected');assert.equal(facts.candidate_version_id,null);assert.equal(facts.call_outcome,'succeeded');assert.equal(facts.response_saved,true);assert.equal(facts.hash_valid,true);const after=(await admin(c=>c.query('SELECT count(*)::int n FROM agent_book.candidate_version WHERE workflow_run_id=$1',[f.workflow]))).rows[0].n;assert.equal(after,before);
   cases.push({name:'response exists before expiry, admission after expiry preserves facts only',status:'passed',evidence:{deadline:f.deadline,databaseObserved:observed,writerDenied:true,callSucceeded:true,responseAndHashPersisted:true,executionState:facts.outcome,candidatesBefore:before,candidatesAfter:after,noNewCandidate:true}});
  }
 }
 return{stage:expectFixed?'after':'before',cases,logs,errors,markers:[secret],sameBodyAcrossModes:true,beforeOnly};
}
