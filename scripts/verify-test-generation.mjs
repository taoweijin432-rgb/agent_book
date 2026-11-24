import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {main as previousRegression} from './verify-manual-approval.mjs';
import {prepareInstance,cleanup,node} from './verify-foundation.mjs';
import {migrate} from './migrate.mjs';
import {initializeTestExecutor} from './test-generation-initialize.mjs';
import {withConnection} from '../src/database.mjs';
import {executeCommand} from '../src/foundation.mjs';
import {createApprovalFixture} from '../test/support/approval-fixture.mjs';
import {createGenerationFixture} from '../test/support/generation-fixture.mjs';
import {runHistoricalTimeExperiments} from '../test/generation-authorization-time.mjs';
import {requireCondition} from '../src/safety.mjs';
import {analyzeResults,scanSecrets,imageDigest} from './verification-support.mjs';
const output=path.resolve(import.meta.dirname,'../verification/test-generation-time-repair/after'),check=(v,c)=>requireCondition(v,c);
async function command(i,script,actor='migrator'){const r=node(script,[],i.configPaths[actor]);i.outputs.push(r.stdout,r.stderr);let v;try{v=JSON.parse(r.stdout);}catch{check(false,'COMMAND_INVALID');}check(r.status===0&&v?.ok,'COMMAND_FAILED');return v;}
async function executor(i,dir){i.executor={...i.configs.writerA,user:'ab_gen_'+randomBytes(6).toString('hex'),password:randomBytes(24).toString('hex')};await initializeTestExecutor(i.configs.admin,{login:i.executor.user,password:i.executor.password});i.executorPath=path.join(dir,i.executor.user+'.json');await writeFile(i.executorPath,JSON.stringify(i.executor),{mode:0o600});}
async function snapshot(i){return withConnection(i.configs.admin,async c=>{const r={};for(const{tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows)r[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.r);return r;});}
const canonical=x=>JSON.stringify(sort(x));function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;}
async function upgrade(i,dir,state){
 process.env.AB_TEST_MIGRATION_BOUNDARY='6';check((await migrate(i.configs.migrator)).migrations_applied===6,'UPGRADE_BASE');process.env.AB_TEST_MIGRATION_BOUNDARY='7';await command(i,'scripts/bootstrap.mjs','admin');
 const f=await createApprovalFixture(i.configs,i.actors,{label:'generation-upgrade'}),call=(op,p)=>executeCommand(i.configs[f.author],op,{novel_id:f.novel,request:{request_key:randomUUID(),...p}});
 const review=await call('approval:review',{workflow_ref:f.workflow});check(review.ok,'OLD_REVIEW');const approved=await call('approval:approve',{workflow_ref:f.workflow,review_ref:review.review_ref,expected_decision_version:0,review_hash:review.review_hash,confirmed_soft_constraint_ids:review.review.required_soft_confirmation});check(approved.ok&&approved.currently_usable,'OLD_APPROVAL');
 const unused=await call('writing-grant:create',{context_grant_id:f.contextGrant,expires_at:null});check(unused.ok&&(await executeCommand(i.configs[f.author],'grant:revoke',{grant_id:unused.grant_id})).ok,'OLD_REVOCATION');
 const reviewBytes=await withConnection(i.configs.admin,async c=>(await c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].t),before=await snapshot(i);
 await withConnection(i.configs.admin,c=>c.query(`CREATE FUNCTION public.generation_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.model_call') THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE';END IF;END $f$;CREATE EVENT TRIGGER generation_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.generation_migration_fault()`));
 const failure=node('scripts/migrate.mjs',[],i.configPaths.migrator);i.outputs.push(failure.stdout,failure.stderr);check(failure.status!==0,'MIGRATION_DID_NOT_FAIL');check(canonical(await snapshot(i))===canonical(before),'FAILED_UPGRADE_CHANGED_DATA');
 await withConnection(i.configs.admin,async c=>{check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===6,'FAILED_UPGRADE_LEDGER');await c.query('DROP EVENT TRIGGER generation_migration_fault;DROP FUNCTION public.generation_migration_fault()');});
 check((await command(i,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT');const after=await snapshot(i);
 for(const[name,rows]of Object.entries(before)){
  check(after[name].length===rows.length+(name==='execution_role'?1:0),'OLD_ROW_COUNT_CHANGED');if(!rows.length)continue;
  const keys=Object.keys(rows[0]),projected=new Set(after[name].map(row=>canonical(Object.fromEntries(keys.map(k=>[k,row[k]])))));for(const row of rows)check(projected.has(canonical(row)),'OLD_DATA_CHANGED');
 }
 check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY');
 const now=await executeCommand(i.configs[f.author],'approval:current',{novel_id:f.novel,request:{workflow_ref:f.workflow}});check(now.ok&&now.currently_usable&&now.decision_ref===approved.decision_ref,'OLD_APPROVAL_INVALIDATED');
 check(reviewBytes===await withConnection(i.configs.admin,async c=>(await c.query('SELECT agent_book._ap_payload(r)::text t FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].t),'OLD_REVIEW_BYTES_CHANGED');
 await executor(i,dir);const fresh=await createGenerationFixture(i.configs,i.actors,{label:'upgraded-generation'});const generated=await executeCommand(i.configs[fresh.writer],'generation:execute',{novel_id:fresh.novel,request:{request_key:randomUUID(),workflow_ref:fresh.workflow,expected_selection_version:0,adapter_id:'fixed-test-v1',parameters:{protocol:'test-parameters-v1',max_output_bytes:4096}}},{generationRuntime:{executorConfig:i.executor}});check(generated.ok&&generated.execution_state==='accepted','UPGRADED_GENERATION');
 state.upgrade={baseApplied:6,failedExit:failure.status,testsStartedAfterFailure:false,failedLedger:6,oldDataExactAfterFailure:true,applied:1,replayApplied:0,oldColumnsAndRowsPreserved:true,onlyNewExecutorRoleAddedToOldCatalog:true,revocationsPreserved:true,oldReviewExactBytes:true,oldApprovalStillUsable:true,realWriterGeneration:true,faultFacilitiesRemoved:true};
}
function report(s){return['# 007 历史授权时间修复：完整验收','',`- run：${s.runId}；时间 ${s.startedAt}；退出 ${s.ok?0:1}；状态 ${s.failure??'completed'}`,
`- 执行 pnpm test；PostgreSQL ${s.serverVersion??'未取得'}；${imageDigest}；Node ${process.version}；provider=test。`,
'- 原有回归按 002/003/004/005/006 边界真实重新执行，副本分别为 legacy/context/workflow/validation/approval-regression.md；全部原历史文件保持原字节。',
`- 第六段既有 Node 回归 ${s.summary?.topLevel??0} 顶层／${s.summary?.subscenarios??0} 子场景，失败 ${s.summary?.failed??'无有效结果'}，跳过 ${s.summary?.skipped??0}。`,
`- 新增授权时间专项（独立运行器）${s.authorizationTime?.summary.cases??0} 项，通过 ${s.authorizationTime?.summary.passed??0}，失败 ${s.authorizationTime?.summary.failed??'无有效结果'}，跳过 ${s.authorizationTime?.summary.skipped??0}；控制测试和原有效期专项另计，不汇总为系统覆盖率。`,
`- 自有容器及匿名卷清理 ${s.containerCleanup===true}；临时凭据及结果清理 ${s.temporaryCleanup===true}；泄密扫描 ${s.leaks??'未完成'}。`,
'','## 迁移','','```json',JSON.stringify({fresh:s.fresh,upgrade:s.upgrade},null,2),'```','','## 场景','','| 分组 | 场景 | 结果 |','|---|---|---|',...(s.groups??[]).flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?' '+JSON.stringify(c.failure):''} |`)),
'','## 历史授权时间专项（独立运行器阶段，不混入 Node 数量）','','```json',JSON.stringify(s.authorizationTime?{stage:s.authorizationTime.stage,cases:s.authorizationTime.cases,sameBodyAcrossModes:s.authorizationTime.sameBodyAcrossModes,summary:s.authorizationTime.summary,databaseLogsReadAfterSpecial:s.authorizationTime.databaseLogsReadAfterSpecial,channelCounts:{logs:s.authorizationTime.logs.length,errors:s.authorizationTime.errors.length}}:{},null,2),'```', '','## 权限、字节、并发及回滚证据','','```json',JSON.stringify(s.evidence??{},null,2),'```','','## 未执行与边界','','- 固定工程内测试适配器，没有外部网络、真实模型、工具调用、自动重试、流式输出、结构化提案、Canon、Outbox 或投影。', '- 不承诺数据库外调用恰好一次；数据库候选至多接纳一次。测试字节计量不等于 token/真实费用；没有自然语言质量或生产安全保证。',''].join('\n');}
export async function main({reportDirectory=output}={}){
 check(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');await mkdir(reportDirectory,{recursive:true});process.env.AB_TEST_MODE='1';const dir=await mkdtemp(path.join(os.tmpdir(),'agent-book-generation-')),resources=[],instances=[],markers=[],s={runId:randomUUID(),startedAt:new Date().toISOString()};
 try{
  const previous=path.join(dir,'previous');await previousRegression({reportDirectory:previous});for(const[from,to]of[['run-result.md','approval-regression.md'],['validation-regression.md','validation-regression.md'],['workflow-regression.md','workflow-regression.md'],['context-regression.md','context-regression.md'],['legacy-regression.md','legacy-regression.md']])await writeFile(path.join(reportDirectory,to),await readFile(path.join(previous,from)));check(process.exitCode===0,'OLD_REGRESSION_FAILED');s.legacy=true;process.env.AB_TEST_MIGRATION_BOUNDARY='7';
  const i=await prepareInstance(dir,s.runId,'generation-fresh',resources);instances.push(i);check((await command(i,'scripts/migrate.mjs')).migrations_applied===7,'FRESH_MIGRATION');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY');await command(i,'scripts/bootstrap.mjs','admin');await executor(i,dir);s.fresh={applied:7,replayApplied:0};s.serverVersion=await withConnection(i.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
  const manifest=path.join(dir,'manifest.json'),result=path.join(dir,'result.json');await writeFile(manifest,JSON.stringify(i),{mode:0o600});const r=node('--test',['--test-concurrency=1','test/test-generation.integration.test.mjs'],i.configPaths.writerA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});i.outputs.push(r.stdout,r.stderr);const data=JSON.parse(await readFile(result));markers.push(...JSON.parse(await readFile(result+'.markers')));s.groups=data.groups;s.evidence=data.evidence;s.summary=analyzeResults(data,s.runId);if(r.status!==0||!s.summary.allPassed)process.stderr.write(JSON.stringify({event:'generation_tests_failed',groups:s.groups})+'\n');check(r.status===0&&s.summary.allPassed,'GENERATION_TESTS_FAILED');
  const temporal=await runHistoricalTimeExperiments(i,{expectFixed:true});markers.push(...temporal.markers);delete temporal.markers;s.authorizationTime=temporal;s.authorizationTime.summary={runnerIndependent:true,cases:temporal.cases.length,passed:temporal.cases.filter(c=>c.status==='passed').length,failed:temporal.cases.filter(c=>c.status!=='passed').length,skipped:0};check(s.authorizationTime.summary.failed===0,'AUTHORIZATION_TIME_TESTS_FAILED');
  const databaseLogs=spawnSync('docker',['logs',i.container],{encoding:'utf8',timeout:10000});check(databaseLogs.status===0,'DATABASE_LOG_READ_FAILED');i.outputs.push(databaseLogs.stdout,databaseLogs.stderr);s.authorizationTime.databaseLogsReadAfterSpecial=true;
  const u=await prepareInstance(dir,s.runId,'generation-upgrade',resources);instances.push(u);await upgrade(u,dir,s);
  markers.push(...instances.flatMap(x=>[x.executor?.password,...Object.values(x.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])]).filter(Boolean));s.leaks=scanSecrets([s,...instances.map(x=>x.outputs)],markers);check(s.leaks===0,'DISCLOSURE');s.valid=true;
 }catch(e){s.failure=/^[A-Z_]+$/.test(e.code??'')?e.code:'VERIFICATION_FAILED';}
 finally{delete process.env.AB_TEST_MIGRATION_BOUNDARY;s.containerCleanup=await cleanup(resources);await rm(dir,{recursive:true,force:true});s.temporaryCleanup=true;s.ok=s.valid===true&&s.legacy===true&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;try{const text=report(s);check(scanSecrets([text],markers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(reportDirectory,'run-result.md'),text);}catch{s.ok=false;}}
 process.stdout.write(JSON.stringify({ok:s.ok,stage:s.failure??'completed',newTests:s.summary,authorizationTime:s.authorizationTime?.summary,cleanup:s.containerCleanup&&s.temporaryCleanup})+'\n');process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
