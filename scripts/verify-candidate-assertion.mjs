import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {main as previousRegression} from './verify-test-generation.mjs';
import {prepareInstance,cleanup,node} from './verify-foundation.mjs';
import {migrate} from './migrate.mjs';import {initializeTestExecutor} from './test-generation-initialize.mjs';
import {withConnection} from '../src/database.mjs';import {executeCommand} from '../src/foundation.mjs';
import {createApprovalFixture} from '../test/support/approval-fixture.mjs';
import {requireCondition} from '../src/safety.mjs';import {analyzeResults,scanSecrets,imageDigest} from './verification-support.mjs';
const output=path.resolve(import.meta.dirname,'../verification/candidate-assertion'),check=(v,c)=>requireCondition(v,c);
async function command(i,script,actor='migrator'){const r=node(script,[],i.configPaths[actor]);i.outputs.push(r.stdout,r.stderr);let v;try{v=JSON.parse(r.stdout);}catch{check(false,'COMMAND_INVALID');}if(r.status!==0)process.stderr.write(JSON.stringify({event:'assertion_command_failure',status:r.status,diagnostic:r.stderr.split('\n').filter(Boolean).map(x=>{try{const d=JSON.parse(x);return{sqlstate:d.sqlstate,position:d.position};}catch{return{};}})})+'\n');check(r.status===0&&v?.ok,'COMMAND_FAILED');return v;}
async function executor(i,dir){i.executor={...i.configs.writerA,user:'ab_gen_'+randomBytes(6).toString('hex'),password:randomBytes(24).toString('hex')};await initializeTestExecutor(i.configs.admin,{login:i.executor.user,password:i.executor.password});i.executorPath=path.join(dir,i.executor.user+'.json');await writeFile(i.executorPath,JSON.stringify(i.executor),{mode:0o600});}
async function snapshot(i){return withConnection(i.configs.admin,async c=>{const r={};for(const{tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows)r[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.r);return r;});}
async function upgrade(i,s){
 process.env.AB_TEST_MIGRATION_BOUNDARY='7';check((await migrate(i.configs.migrator)).migrations_applied===7,'UPGRADE_BASE');await command(i,'scripts/bootstrap.mjs','admin');
 const f=await createApprovalFixture(i.configs,i.actors,{label:'assertion-upgrade'}),call=(op,p)=>executeCommand(i.configs[f.author],op,{novel_id:f.novel,request:{request_key:randomUUID(),...p}});
 const review=await call('approval:review',{workflow_ref:f.workflow});check(review.ok,'OLD_REVIEW');const approved=await call('approval:approve',{workflow_ref:f.workflow,review_ref:review.review_ref,expected_decision_version:0,review_hash:review.review_hash,confirmed_soft_constraint_ids:review.review.required_soft_confirmation});check(approved.ok&&approved.currently_usable,'OLD_APPROVAL');
 const bytes=await withConnection(i.configs.admin,async c=>(await c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].t),before=await snapshot(i);
 delete process.env.AB_TEST_MIGRATION_BOUNDARY;
 await withConnection(i.configs.admin,c=>c.query(`CREATE FUNCTION public.assertion_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.evidence_candidate_source') THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE';END IF;END $f$;CREATE EVENT TRIGGER assertion_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.assertion_migration_fault()`));
 const fail=node('scripts/migrate.mjs',[],i.configPaths.migrator);i.outputs.push(fail.stdout,fail.stderr);check(fail.status!==0,'MIGRATION_DID_NOT_FAIL');check(JSON.stringify(await snapshot(i))===JSON.stringify(before),'FAILED_UPGRADE_DATA');
 await withConnection(i.configs.admin,async c=>{check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===7,'FAILED_LEDGER');await c.query('DROP EVENT TRIGGER assertion_migration_fault;DROP FUNCTION public.assertion_migration_fault()');});
 check((await command(i,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT');const after=await snapshot(i);for(const[k,v]of Object.entries(before))check(JSON.stringify(after[k])===JSON.stringify(v),'OLD_DATA_CHANGED');
 check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY');
 check(bytes===await withConnection(i.configs.admin,async c=>(await c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].t),'OLD_REVIEW_BYTES');
 const current=()=>executeCommand(i.configs[f.author],'approval:current',{novel_id:f.novel,request:{workflow_ref:f.workflow}});check((await current()).currently_usable,'OLD_APPROVAL_CHANGED');
 const body=(await executeCommand(i.configs[f.writer],'workflow:read',{novel_id:f.novel,request:{workflow_ref:f.workflow}})).candidates[0].body;
 const registered=await call('assertion:register',{workflow_ref:f.workflow,candidate_ref:f.candidate,assertion_type:'narrated_claim_v1',content:'人工断言',locator:{format:'utf8-byte-range-v1',start:0,end:Buffer.byteLength(body)},quote:body});check(registered.ok,'UPGRADED_ASSERTION');check((await current()).currently_usable,'ASSERTION_INVALIDATED_OLD_APPROVAL');
 s.upgrade={baseApplied:7,failedExit:fail.status,failedLedger:7,noTestsAfterMigrationFailure:true,oldDataExactAfterFailure:true,oldDataExactAfterSuccess:true,applied:1,replayApplied:0,reviewExactBytes:true,oldApprovalUsableBeforeAndAfterAssertion:true,realAuthorAssertion:true,faultFacilitiesRemoved:true};
}
function report(s){return['# 第二批第七段 A：Candidate 正文断言与 Evidence','',`- run ${s.runId}；开始 ${s.startedAt}；状态 ${s.failure??'completed'}；退出 ${s.ok?0:1}。`,`- PostgreSQL ${s.serverVersion??'unavailable'}；${imageDigest}；Node ${process.version}。`,
`- 新增 Node 测试 ${s.summary?.topLevel??0} 顶层／${s.summary?.subscenarios??0} 子场景；失败 ${s.summary?.failed??'invalid'}；跳过 ${s.summary?.skipped??0}。`,
`- 旧回归独立按 001—007 声明边界运行：${s.legacy===true}；007 的 11 项授权时间专项见 legacy/run-result.md。未将数量相加表示覆盖率。`,
`- 自有容器/卷清理 ${s.containerCleanup===true}；临时凭据/结果清理 ${s.temporaryCleanup===true}；泄密扫描 ${s.leaks??'unavailable'}。`,
'','## 迁移','','```json',JSON.stringify({fresh:s.fresh,upgrade:s.upgrade},null,2),'```','','## 场景','','| 分组 | 场景 | 结果 |','|---|---|---|',...(s.groups??[]).flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?' '+JSON.stringify(c.failure):''} |`)),
'','## 真实权限、提交、并发及失败阶段','','```json',JSON.stringify(s.evidence??{},null,2),'```','','## 未执行与边界','','- 仅 Candidate 正文、narrated_claim_v1、人工作业；未执行语义真实性判断、自动抽取、三类结构化提案、Canon/Tool Evidence、真实模型或生产部署验证。', '- 旧校验与审批不覆盖本轮追加断言。未执行生产负载、完整恢复和全侧信道测试。',''].join('\n');}
export async function main(){
 const args=process.argv.slice(2),currentOnly=args.length===2&&args[1]==='--current-only';check(args[0]==='--isolated'&&(args.length===1||currentOnly),'EXPLICIT_ISOLATED_TEST_REQUIRED');
 await mkdir(output,{recursive:true});process.env.AB_TEST_MODE='1';const dir=await mkdtemp(path.join(os.tmpdir(),'agent-book-assertion-')),resources=[],instances=[],markers=[],s={runId:randomUUID(),startedAt:new Date().toISOString()};
 try{
  if(!currentOnly){await previousRegression({reportDirectory:path.join(output,'legacy')});check(process.exitCode===0,'OLD_REGRESSION_FAILED');s.legacy=true;}else s.legacy=false;
  delete process.env.AB_TEST_MIGRATION_BOUNDARY;
  const i=await prepareInstance(dir,s.runId,'assertion-fresh',resources);instances.push(i);check((await command(i,'scripts/migrate.mjs')).migrations_applied===8,'FRESH_MIGRATION');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY');await command(i,'scripts/bootstrap.mjs','admin');await executor(i,dir);s.fresh={applied:8,replayApplied:0};s.serverVersion=await withConnection(i.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
  const manifest=path.join(dir,'manifest.json'),result=path.join(dir,'result.json');await writeFile(manifest,JSON.stringify(i),{mode:0o600});const r=node('--test',['--test-concurrency=1','test/candidate-assertion.integration.test.mjs'],i.configPaths.authorA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});i.outputs.push(r.stdout,r.stderr);const data=JSON.parse(await readFile(result));markers.push(...JSON.parse(await readFile(result+'.markers')));s.groups=data.groups;s.evidence=data.evidence;s.summary=analyzeResults(data,s.runId);if(r.status!==0||!s.summary.allPassed)process.stderr.write(JSON.stringify({event:'assertion_tests_failed',groups:s.groups})+'\n');check(r.status===0&&s.summary.allPassed,'ASSERTION_TESTS_FAILED');
  const u=await prepareInstance(dir,s.runId,'assertion-upgrade',resources);instances.push(u);await upgrade(u,s);
  for(const inst of instances){const logs=spawnSync('docker',['logs',inst.container],{encoding:'utf8',timeout:10000});check(logs.status===0,'DATABASE_LOG_READ');inst.outputs.push(logs.stdout,logs.stderr);}
  markers.push(...instances.flatMap(x=>[x.executor?.password,...Object.values(x.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])]).filter(Boolean));s.leaks=scanSecrets([s,...instances.map(x=>x.outputs)],markers);check(s.leaks===0,'DISCLOSURE');s.valid=true;
 }catch(e){s.failure=/^[A-Z_]+$/.test(e.code??'')?e.code:'VERIFICATION_FAILED';}
 finally{delete process.env.AB_TEST_MIGRATION_BOUNDARY;s.containerCleanup=await cleanup(resources);await rm(dir,{recursive:true,force:true});s.temporaryCleanup=true;s.ok=s.valid===true&&(s.legacy===true||currentOnly)&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;try{const text=report(s);check(scanSecrets([text],markers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(output,currentOnly?'development-result.md':'run-result.md'),text);}catch{s.ok=false;}}
 process.stdout.write(JSON.stringify({ok:s.ok,stage:s.failure??'completed',legacy:s.legacy,newTests:s.summary,cleanup:s.containerCleanup&&s.temporaryCleanup})+'\n');process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
