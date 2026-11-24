import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import { prepareInstance,cleanup,node } from '../scripts/verify-foundation.mjs';
import { migrate } from '../scripts/migrate.mjs';
import { withConnection,inTransaction,connectionOptions } from '../src/database.mjs';
import { executeCommand } from '../src/foundation.mjs';
import { requireCondition } from '../src/safety.mjs';
import { scanSecrets } from '../scripts/verification-support.mjs';

const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'verification/design-task/expiry-repair');
const keys=['structure.manage','design.read','design.edit','design.freeze','task.read','task.create','task.append'];
const check=(condition,code)=>requireCondition(condition,code);
const parse=result=>{try{return JSON.parse(result.stdout);}catch{return null;}};
const pause=()=>new Promise(resolve=>setTimeout(resolve,15));
async function admin(instance,fn){return withConnection(instance.configs.admin,fn);}
async function beforeState(instance){return admin(instance,async c=>({
  grants:(await c.query('SELECT to_jsonb(g) r FROM agent_book.capability_grant g ORDER BY grant_id')).rows.map(x=>x.r),
  revocations:(await c.query('SELECT to_jsonb(g) r FROM agent_book.grant_revocation g ORDER BY grant_id')).rows.map(x=>x.r)}));}
async function originalRowsUnchanged(instance,before){const after=await beforeState(instance);return before.grants.every(g=>after.grants.some(x=>JSON.stringify(g)===JSON.stringify(x)))&&JSON.stringify(after.revocations)===JSON.stringify(before.revocations);}
async function legacyNovel(instance,label){return withConnection(instance.configs.authorA,c=>inTransaction(c,async tx=>{
  const id=randomUUID();const response=(await tx.query('SELECT agent_book.api_create_novel($1,$2,$3,$4,$5) r',[id,label,'有效期专项作品',Array.from({length:3},()=>randomUUID()),randomUUID()])).rows[0].r;
  check(response.ok,'AUTHOR_CREATION_FAILED');return id;
}));}
async function sourceFixture(instance,label,{readMs=null,revokeMs=null,revoked=false}={}){
  const novel=await legacyNovel(instance,label);
  const originals=await admin(instance,async c=>(await c.query(`SELECT g.grant_id,ca.capability_key FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1`,[novel])).rows);
  for(const row of originals){const r=await executeCommand(instance.configs.authorA,'grant:revoke',{grant_id:row.grant_id});check(r.ok,'CONTROLLED_REVOKE_FAILED');}
  const sources=await admin(instance,c=>inTransaction(c,async tx=>{
    const time=(await tx.query('SELECT clock_timestamp()::text t')).rows[0].t;const result=[];
    for(const [cap,offset]of [['novel.read',readMs],['grant.revoke',revokeMs]]){
      const id=randomUUID();await tx.query(`INSERT INTO agent_book.capability_grant
        SELECT $1,ar.actor_id,ar.role_id,ca.capability_id,s.data_scope_id,$2::timestamptz,
          CASE WHEN $3::integer IS NULL THEN NULL ELSE $2::timestamptz+$3*interval '1 millisecond' END
        FROM agent_book.actor_role ar JOIN agent_book.actor_principal a USING(actor_id) CROSS JOIN agent_book.capability ca CROSS JOIN agent_book.data_scope s
        WHERE a.db_login=$4 AND ca.capability_key=$5 AND s.novel_id=$6`,[id,time,offset,instance.configs.authorA.user,cap,novel]);
      result.push({id,cap});
    }return result;
  }));
  if(revoked)for(const s of sources){const result=await executeCommand(instance.configs.authorA,'grant:revoke',{grant_id:s.id});check(result.ok,'SOURCE_REVOKE_FAILED');}
  const proof=await admin(instance,async c=>(await c.query(`SELECT count(*)::int AS source_count,
    bool_and(a.status='active' AND r.role_key='author' AND r.status='active' AND s.novel_id=$1 AND s.format_version='foundation-scope-v1' AND s.default_decision='deny') AS other_prerequisites,
    (SELECT count(*)=1 FROM agent_book.access_audit_record WHERE novel_id=$1 AND operation='novel.create' AND decision='allow' AND resource_novel_id=$1) AS creation_provenance,
    min(g.expires_at)::text AS first_deadline,clock_timestamp()::text AS observed_at,
    bool_and(g.effective_at<=clock_timestamp() AND(g.expires_at IS NULL OR clock_timestamp()<g.expires_at) AND NOT EXISTS(SELECT 1 FROM agent_book.grant_revocation x WHERE x.grant_id=g.grant_id)) AS sources_valid
    FROM agent_book.capability_grant g JOIN agent_book.actor_principal a USING(actor_id) JOIN agent_book.execution_role r USING(role_id)
    JOIN agent_book.data_scope s USING(data_scope_id) WHERE g.grant_id=ANY($2::uuid[])`,[novel,sources.map(x=>x.id)] )).rows[0]);
  proof.source_expiries=await admin(instance,async c=>(await c.query(`SELECT ca.capability_key,g.expires_at::text AS expires_at,EXISTS(SELECT 1 FROM agent_book.grant_revocation x WHERE x.grant_id=g.grant_id) AS revoked FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) WHERE g.grant_id=ANY($1::uuid[]) ORDER BY ca.capability_key`,[sources.map(s=>s.id)])).rows);
  check(proof.source_count===2&&proof.other_prerequisites&&proof.creation_provenance,'INVALID_NEGATIVE_PREREQUISITES');
  return {novel,sources,proof};
}
function migrationChild(instance){
  const child=spawn(process.execPath,['scripts/migrate.mjs'],{cwd:root,env:{...process.env,AB_TEST_MODE:'1',AB_CONFIG:instance.configPaths.migrator},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  let timer;const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('MIGRATION_CHILD_TIMEOUT'));},20000);child.once('error',reject);child.once('close',status=>resolve({status,stdout,stderr}));}).finally(()=>clearTimeout(timer));
  done.catch(()=>{});return {child,done};
}
async function installBarrier(instance,target,lockKey,{commit=false,fault=false}={}){
  await admin(instance,c=>c.query(`CREATE FUNCTION public.expiry_migration_barrier() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='${target}') THEN
      ${fault?"RAISE EXCEPTION 'EXPIRY_SEED_FAULT';":`PERFORM pg_advisory_xact_lock(${lockKey});`} END IF; END $f$;
    CREATE EVENT TRIGGER expiry_migration_barrier ON ddl_command_end WHEN TAG IN ('${commit?'CREATE TRIGGER':'CREATE TABLE'}') EXECUTE FUNCTION public.expiry_migration_barrier()`));
}
async function dropBarrier(instance){await admin(instance,c=>c.query('DROP EVENT TRIGGER IF EXISTS expiry_migration_barrier;DROP FUNCTION IF EXISTS public.expiry_migration_barrier()'));}
async function observeBarrier(observer,login,blocker,target){const deadline=Date.now()+4500;
  while(Date.now()<deadline){await observer.query('SELECT pg_stat_clear_snapshot()');const rows=(await observer.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers,
    position($2 in query)>0 stage_matches FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock'`,[login,target])).rows;
    const row=rows.find(r=>r.blockers.includes(blocker)&&r.stage_matches);if(row)return {migrationPid:row.pid,blockerPid:blocker,wait_event:row.wait_event,actualStageConfirmed:true};await pause();}
  throw new Error('MIGRATION_BARRIER_NOT_OBSERVED');
}
async function afterDeadline(observer,deadline){const end=Date.now()+4500;while(Date.now()<end){
  const row=(await observer.query('SELECT clock_timestamp()>=$1::timestamptz expired,clock_timestamp()::text observed_at',[deadline])).rows[0];
  if(row.expired)return row.observed_at;await pause();}throw new Error('DATABASE_DEADLINE_NOT_REACHED');
}
async function blockedMigration(instance,fixture,{afterWrite=false,fault=false}={}){
  const lockKey=80421937,target=afterWrite?'immutable_rows on agent_book.design_authority_upgrade':'agent_book.design_draft';
  await installBarrier(instance,target,lockKey,{commit:afterWrite,fault});
  if(fault){try{const r=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(r.stdout,r.stderr);return {execution:r,evidence:{stage:'after_first_upgrade_seed_before_next_tables',fault:true}};}finally{await dropBarrier(instance);}}
  const observer=new pg.Client(connectionOptions(instance.configs.admin));await observer.connect();let pending;
  try{
    await observer.query('BEGIN');await observer.query('SELECT pg_advisory_xact_lock($1)',[lockKey]);
    const pid=(await observer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    pending=migrationChild(instance);const evidence=await observeBarrier(observer,instance.configs.migrator.user,pid,afterWrite?'immutable_rows':'design_draft');
    evidence.stage=afterWrite?'all_seed_inserts_completed_before_immutable_triggers_and_commit':'DDL_execution_after_up_eligibility_before_seed_inserts';
    evidence.sourceDeadline=fixture.proof.first_deadline;evidence.databaseObservedAfterDeadline=await afterDeadline(observer,fixture.proof.first_deadline);
    await observer.query('COMMIT');evidence.release='COMMIT';
    const execution=await pending.done;instance.outputs.push(execution.stdout,execution.stderr);return {execution,evidence};
  }finally{
    await observer.query('ROLLBACK');await observer.end();if(pending)await pending.done.catch(()=>{});await dropBarrier(instance);
  }
}
async function persisted(instance,fixture){return admin(instance,async c=>{
  const exists=(await c.query("SELECT to_regclass('agent_book.design_authority_upgrade') IS NOT NULL present")).rows[0].present;
  const grants=(await c.query(`SELECT ca.capability_key,g.expires_at::text AS expires_at,g.effective_at::text AS effective_at
    FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id)
    WHERE s.novel_id=$1 AND ca.capability_key=ANY($2::text[]) ORDER BY ca.capability_key`,[fixture.novel,keys])).rows;
  const ledger=(await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n;
  const disposition=exists?(await c.query('SELECT disposition FROM agent_book.design_authority_upgrade WHERE novel_id=$1',[fixture.novel])).rows[0]?.disposition:null;
  const facilities=(await c.query("SELECT count(*)::int n FROM pg_event_trigger WHERE evtname='expiry_migration_barrier'")).rows[0].n;
  return {grants,ledger,disposition,faultFacilities:facilities};
});}
async function initializeLegacy(instance){check((await migrate(instance.configs.migrator,{firstBatchOnly:true})).migrations_applied===1,'LEGACY_MIGRATION_FAILED');const b=node('scripts/bootstrap.mjs',[],instance.configPaths.admin);instance.outputs.push(b.stdout,b.stderr);check(b.status===0&&parse(b)?.ok,'BOOTSTRAP_FAILED');}
export async function reproduceBefore(directory,runId,resources,instances){
  const original=await readFile(path.join(output,'before/db/migrations/002_design_task.mjs'));
  check(original.equals(await readFile(path.join(root,'db/migrations/002_design_task.mjs'))),'ORIGINAL_MIGRATION_REQUIRED');
  const instance=await prepareInstance(directory,runId,'expiry-before',resources);instances.push(instance);await initializeLegacy(instance);
  const fixture=await sourceFixture(instance,'expiry-before',{readMs:2800});check(fixture.proof.sources_valid,'SOURCE_NOT_VALID_BEFORE_MIGRATION');
  const before=await beforeState(instance);const migration=await blockedMigration(instance,fixture);
  check(migration.execution.status===0,'ORIGINAL_MIGRATION_DID_NOT_SUCCEED');
  const state=await persisted(instance,fixture);const author=await executeCommand(instance.configs.authorA,'design:history',{novel_id:fixture.novel,request:{}});
  check(state.grants.length===7&&state.grants.every(g=>g.expires_at===null)&&author.ok,'REVIEW_PATH_NOT_REPRODUCED');
  check(await originalRowsUnchanged(instance,before),'ORIGINAL_AUTHORIZATION_CHANGED');
  return {runId,conclusion:'reproduced',beforeQualification:fixture.proof,synchronization:migration.evidence,migrationExit:migration.execution.status,
    persisted:state,authorAllowedAfterSourceExpiry:author.ok,originalGrantsAndRevocationsUnchanged:true,qualificationTrueConfirmedBySevenSeededRows:true};
}

export async function main(){
  check(process.argv.slice(2).length===1&&['--reproduce-before','--verify-after'].includes(process.argv[2]),'EXPLICIT_EXPIRY_TEST_MODE_REQUIRED');process.env.AB_TEST_MODE='1';
  const directory=await mkdtemp(path.join(os.tmpdir(),'agent-book-expiry-before-')),resources=[],instances=[],runId=randomUUID();let state={runId};let success=false;
  try{state=process.argv[2]==='--reproduce-before'?await reproduceBefore(directory,runId,resources,instances):{runId,special:await verifyExpiryUpgrade(directory,runId,resources,instances)};success=true;}
  catch(error){state.failureCode=/^[A-Z_]+$/.test(error.code??'')?error.code:'REPRODUCTION_FAILED';state.diagnostic={sqlstate:/^[0-9A-Z]{5}$/.test(error.code??'')?error.code:null,line:Number(error.stack?.match(/design-upgrade-expiry.mjs:(\d+):/)?.[1]??0),routine:/^[a-z_]+$/.test(error.routine??'')?error.routine:null,functions:[...(error.where??'').matchAll(/function ([a-z_]+)/g)].map(x=>x[1])};}
  finally{
    state.containerCleanup=await cleanup(resources);await rm(directory,{recursive:true,force:true});state.temporaryCleanup=true;
    const markers=instances.flatMap(i=>Object.values(i.configs).map(c=>c.password));
    check(scanSecrets([state,...instances.map(i=>i.outputs)],markers)===0,'CREDENTIAL_DISCLOSURE');
    await writeFile(path.join(output,process.argv[2]==='--reproduce-before'?'before-reproduction.json':'after-special.json'),JSON.stringify(state,null,2)+'\n');
  }
  const ok=success&&state.containerCleanup&&state.temporaryCleanup;process.stdout.write(`${JSON.stringify({ok,conclusion:state.conclusion??state.failureCode,cleanup:state.containerCleanup})}\n`);process.exitCode=ok?0:1;
}
if(process.argv[1]===import.meta.filename)await main();

async function facilityCount(instance){return admin(instance,async c=>(await c.query(`SELECT
  (SELECT count(*) FROM pg_event_trigger WHERE evtname LIKE 'expiry_%')+
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'expiry_%')+
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'expiry_%')+
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'expiry_%') AS n`)).rows[0].n).then(Number);}
async function checkExpiry(instance,fixture,state,{allowed,expiry,disposition}){
  check(state.disposition===disposition,'UPGRADE_DISPOSITION_INVALID');
  const count=disposition==='seeded'?7:0;check(state.grants.length===count,'UPGRADE_SET_PARTIAL');
  if(count){check(new Set(state.grants.map(g=>g.effective_at)).size===1,'SEED_DECISION_TIME_NOT_UNIFORM');check(state.grants.every(g=>g.expires_at===expiry),'INHERITED_EXPIRY_INCORRECT');check(new Set(state.grants.map(g=>g.capability_key)).size===7,'UPGRADE_CAPABILITIES_INCOMPLETE');}
  const author=await executeCommand(instance.configs.authorA,'design:history',{novel_id:fixture.novel,request:{}});
  check(author.ok===allowed,'REAL_AUTHOR_PERMISSION_MISMATCH');
  if(!allowed)check(author.error==='ACCESS_DENIED','NEGATIVE_MUST_BE_AUTHORIZATION_DENIAL');
  return {casePrerequisites:fixture.proof,expectedExpiry:expiry,capabilities:state.grants,disposition:state.disposition,ledger:state.ledger,realAuthorAllowed:author.ok,realAuthorError:author.ok?null:author.error};
}
async function prepareLegacy(directory,runId,index,resources,instances){const i=await prepareInstance(directory,runId,index,resources);instances.push(i);await initializeLegacy(i);return i;}
async function normalCases(directory,runId,resources,instances){
  const instance=await prepareLegacy(directory,runId,'expiry-normal',resources,instances),cases=[];
  for(const [label,parameters]of [
    ['both_finite_different_deadlines',{readMs:60000,revokeMs:90000}],
    ['read_finite_revoke_unlimited',{readMs:60000}],
    ['read_unlimited_revoke_finite',{revokeMs:60000}],
    ['both_unlimited',{}],
    ['initially_expired',{readMs:250}],
    ['initially_revoked',{revoked:true}]
  ]){
    const fixture=await sourceFixture(instance,label,parameters);
    if(label==='initially_expired'){fixture.proof.databaseObservedExpiredBeforeMigration=await admin(instance,c=>afterDeadline(c,fixture.proof.first_deadline));}
    cases.push({label,fixture});
  }
  const before=await beforeState(instance),result=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(result.stdout,result.stderr);
  check(result.status===0&&parse(result)?.migrations_applied===1,'NORMAL_EXPIRY_UPGRADE_FAILED');
  const results=[];
  for(const {label,fixture}of cases){
    const seeded=!['initially_expired','initially_revoked'].includes(label),state=await persisted(instance,fixture);
    check(state.ledger===2,'NORMAL_LEDGER_INVALID');
    results.push({name:label,status:'passed',...(await checkExpiry(instance,fixture,state,{allowed:seeded,expiry:fixture.proof.first_deadline,disposition:seeded?'seeded':'withheld_revoked_or_expired'})),sameUpgrade:true});
  }
  check(await originalRowsUnchanged(instance,before),'NORMAL_SOURCE_HISTORY_CHANGED');
  const replay=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(replay.stdout,replay.stderr);check(replay.status===0&&parse(replay)?.migrations_applied===0,'NORMAL_UPGRADE_REPLAY_FAILED');
  const facilities=await facilityCount(instance);check(facilities===0,'NORMAL_FACILITIES_REMAIN');
  return {cases:results,sharedUpgrade:{migrationExit:result.status,seededNovels:4,withheldNovels:2,sourceHistoryUnchanged:true,replayApplied:0,facilities}};
}
async function expiryBeforeWrite(directory,runId,resources,instances){
  const instance=await prepareLegacy(directory,runId,'expiry-before-write',resources,instances);
  const fixture=await sourceFixture(instance,'expiry-before-write',{readMs:2800});check(fixture.proof.sources_valid,'PREWRITE_SOURCE_NOT_VALID');
  const before=await beforeState(instance),migration=await blockedMigration(instance,fixture);check(migration.execution.status!==0&&JSON.parse(migration.execution.stderr).sqlstate==='P0001','EXPIRED_SOURCE_UPGRADE_SUCCEEDED');
  const failed=await persisted(instance,fixture);check(failed.grants.length===0&&failed.ledger===1&&failed.disposition===null,'EXPIRED_SOURCE_LEFT_PARTIAL_UPGRADE');
  check(await originalRowsUnchanged(instance,before),'PREWRITE_SOURCE_HISTORY_CHANGED');
  // Retrying evaluates a fresh, already-expired source: safely withheld, never restored.
  const retry=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(retry.stdout,retry.stderr);check(retry.status===0,'EXPIRED_RETRY_FAILED');
  const final=await persisted(instance,fixture),permission=await checkExpiry(instance,fixture,final,{allowed:false,expiry:null,disposition:'withheld_revoked_or_expired'});
  check(await facilityCount(instance)===0,'PREWRITE_FACILITIES_REMAIN');
  return {name:'eligible_then_expired_before_seed',status:'passed',synchronization:migration.evidence,migrationExit:migration.execution.status,
    failedUpgrade:failed,retryExit:retry.status,retry:permission,sourceHistoryUnchanged:true,facilities:0};
}
async function expiryAfterWrite(directory,runId,resources,instances){
  const instance=await prepareLegacy(directory,runId,'expiry-after-write',resources,instances);
  const fixture=await sourceFixture(instance,'expiry-after-write',{revokeMs:2800});check(fixture.proof.sources_valid,'PRECOMMIT_SOURCE_NOT_VALID');
  const before=await beforeState(instance),migration=await blockedMigration(instance,fixture,{afterWrite:true});
  check(migration.execution.status===0,'WRITTEN_FINITE_UPGRADE_FAILED');
  const final=await persisted(instance,fixture),permission=await checkExpiry(instance,fixture,final,{allowed:false,expiry:fixture.proof.first_deadline,disposition:'seeded'});
  check(final.grants.every(g=>Date.parse(g.effective_at)<Date.parse(g.expires_at)),'GRANT_WRITTEN_AFTER_EXPIRY');
  check(await originalRowsUnchanged(instance,before),'PRECOMMIT_SOURCE_HISTORY_CHANGED');check(await facilityCount(instance)===0,'PRECOMMIT_FACILITIES_REMAIN');
  return {name:'seeded_finite_then_expired_before_commit',status:'passed',synchronization:migration.evidence,migrationExit:0,...permission,sourceHistoryUnchanged:true,facilities:0};
}
async function midSeedFailure(directory,runId,resources,instances){
  const instance=await prepareLegacy(directory,runId,'expiry-seed-fault',resources,instances);
  const fixtures=[await sourceFixture(instance,'seed-fault-a'),await sourceFixture(instance,'seed-fault-b')];
  const before=await beforeState(instance);
  await admin(instance,c=>c.query(`CREATE SEQUENCE public.expiry_fault_counter;
    CREATE FUNCTION public.expiry_seed_fault() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
    BEGIN IF (SELECT capability_key FROM agent_book.capability WHERE capability_id=NEW.capability_id)
      IN ('structure.manage','design.read','design.edit','design.freeze','task.read','task.create','task.append') THEN
      IF nextval('public.expiry_fault_counter')=4 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='EXPIRY_SEED_FAULT_AFTER_THREE_ROWS'; END IF;
    END IF; RETURN NEW; END $f$;
    REVOKE ALL ON FUNCTION public.expiry_seed_fault() FROM PUBLIC;
    CREATE TRIGGER expiry_seed_fault BEFORE INSERT ON agent_book.capability_grant FOR EACH ROW EXECUTE FUNCTION public.expiry_seed_fault()`));
  let failed,counter;
  try{
    failed=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(failed.stdout,failed.stderr);check(failed.status!==0&&JSON.parse(failed.stderr).sqlstate==='P0001','MID_SEED_FAULT_NOT_PROPAGATED');
    counter=await admin(instance,async c=>Number((await c.query('SELECT last_value FROM public.expiry_fault_counter')).rows[0].last_value));check(counter===4,'MID_SEED_FAULT_STAGE_NOT_REACHED');
    for(const f of fixtures){const state=await persisted(instance,f);check(state.grants.length===0&&state.ledger===1&&state.disposition===null,'MID_SEED_PARTIAL_UPGRADE');}
    check(await originalRowsUnchanged(instance,before),'MID_SEED_SOURCE_HISTORY_CHANGED');
  }finally{await admin(instance,c=>c.query('DROP TRIGGER expiry_seed_fault ON agent_book.capability_grant;DROP FUNCTION public.expiry_seed_fault();DROP SEQUENCE public.expiry_fault_counter'));}
  const retry=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(retry.stdout,retry.stderr);check(retry.status===0,'MID_SEED_RETRY_FAILED');
  const results=[];for(const f of fixtures)results.push(await checkExpiry(instance,f,await persisted(instance,f),{allowed:true,expiry:null,disposition:'seeded'}));
  check(await originalRowsUnchanged(instance,before),'MID_SEED_RETRY_CHANGED_SOURCE_HISTORY');check(await facilityCount(instance)===0,'MID_SEED_FACILITIES_REMAIN');
  return {name:'failure_on_fourth_seed_row',status:'passed',failureExit:failed.status,observedInsertAttempts:counter,
    wholeUpgradeRolledBack:true,migrationLedgerAfterFailure:1,upgradeTableAfterFailureAbsent:true,grantsAfterFailure:0,retryExit:retry.status,retry:results,sourceHistoryUnchanged:true,facilities:0};
}
export async function verifyExpiryUpgrade(directory,runId,resources,instances){
  const normal=await normalCases(directory,runId,resources,instances);
  const cases=[...normal.cases];
  cases.push(await expiryBeforeWrite(directory,runId,resources,instances));
  cases.push(await expiryAfterWrite(directory,runId,resources,instances));
  cases.push(await midSeedFailure(directory,runId,resources,instances));
  return {stage:'runner_independent_expiry_regressions',count:cases.length,passed:cases.length,failed:0,skipped:0,sharedUpgrade:normal.sharedUpgrade,cases};
}
