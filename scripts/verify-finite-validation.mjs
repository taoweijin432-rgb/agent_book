import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mkdtemp,readFile,writeFile,rm,mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { main as previousRegression } from './verify-workflow-candidate.mjs';
import { prepareInstance,cleanup,node } from './verify-foundation.mjs';
import { migrate } from './migrate.mjs';
import { withConnection } from '../src/database.mjs';
import { executeCommand } from '../src/foundation.mjs';
import { createValidationFixture } from '../test/support/validation-fixture.mjs';
import { requireCondition } from '../src/safety.mjs';
import { analyzeResults,scanSecrets,imageDigest } from './verification-support.mjs';
const output=path.resolve(import.meta.dirname,'../verification/finite-validation');
const check=(v,c)=>requireCondition(v,c);
async function command(i,script,actor='migrator'){const r=node(script,[],i.configPaths[actor]);i.outputs.push(r.stdout,r.stderr);let v;try{v=JSON.parse(r.stdout);}catch{check(false,'COMMAND_INVALID');}check(r.status===0&&v?.ok,'COMMAND_FAILED');return v;}
async function snapshot(i){return withConnection(i.configs.admin,async c=>{const r={};for(const {tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows)r[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.r);return r;});}
async function upgrade(i,state){
 process.env.AB_TEST_MIGRATION_BOUNDARY='4';check((await migrate(i.configs.migrator)).migrations_applied===4,'UPGRADE_BASE_FAILED');process.env.AB_TEST_MIGRATION_BOUNDARY='5';
 await command(i,'scripts/bootstrap.mjs','admin');const f=await createValidationFixture(i.configs,i.actors,{label:'upgrade-validation'});
 const unused=await executeCommand(i.configs.authorA,'writing-grant:create',{novel_id:f.novel,request:{request_key:randomUUID(),context_grant_id:f.contextGrant,expires_at:null}});check(unused.ok,'UPGRADE_GRANT');check((await executeCommand(i.configs.authorA,'grant:revoke',{grant_id:unused.grant_id})).ok,'UPGRADE_REVOKE');
 const before=await snapshot(i);
 await withConnection(i.configs.admin,c=>c.query(`CREATE FUNCTION public.validation_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.validation_run') THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE';END IF;END $f$;CREATE EVENT TRIGGER validation_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.validation_migration_fault()`));
 const failure=node('scripts/migrate.mjs',[],i.configPaths.migrator);i.outputs.push(failure.stdout,failure.stderr);check(failure.status!==0,'MIGRATION_DID_NOT_FAIL');check(JSON.stringify(await snapshot(i))===JSON.stringify(before),'FAILED_UPGRADE_CHANGED_DATA');
 await withConnection(i.configs.admin,async c=>{check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===4,'FAILED_UPGRADE_CHANGED_LEDGER');await c.query('DROP EVENT TRIGGER validation_migration_fault;DROP FUNCTION public.validation_migration_fault()');});
 check((await command(i,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT');const after=await snapshot(i);for(const[name,data]of Object.entries(before))check(JSON.stringify(after[name])===JSON.stringify(data),'UPGRADE_OLD_DATA_CHANGED');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY');
 const call=(who,op,p)=>executeCommand(i.configs[who],op,{novel_id:f.novel,request:p});check((await call('writerA','workflow:read',{workflow_ref:f.workflow})).ok,'OLD_WORKFLOW_FAILED');check((await call('authorA','design:history',{})).ok&&(await call('authorA','task:history',{})).ok,'OLD_AUTHOR_FAILED');check((await call('writerA','context:read',{bundle_ref:f.bundle})).ok,'OLD_BUNDLE_FAILED');
 check((await call('authorA','validation-policy:publish',{request_key:randomUUID(),expected_release_id:null})).ok,'UPGRADE_POLICY_FAILED');const r=await call('authorA','validation:run',{request_key:randomUUID(),workflow_ref:f.workflow,expected_candidate_ref:f.candidate,expected_selection_version:f.selection});check(r.ok&&r.overall==='passed','UPGRADE_VALIDATION_FAILED');
 state.upgrade={baseApplied:4,failedExit:failure.status,testsStartedAfterFailure:false,failedLedger:4,oldDataExactAfterFailure:true,applied:1,replayApplied:0,oldDataExactAfterUpgrade:true,writingRevocationsPreserved:true,oldCommands:true,realAuthorValidation:true,faultFacilitiesRemoved:true};
}
function report(s){return ['# 第二批第四段：有限确定性校验与结果绑定验收','',`- run：${s.runId}；时间 ${s.startedAt}；退出 ${s.ok?0:1}；状态 ${s.failure??'completed'}`,
`- PostgreSQL ${s.serverVersion??'未取得'}；${imageDigest}；Node ${process.version}`,
'- 原有回归按 002/003/004 边界执行，记录在本目录 legacy-regression.md、context-regression.md、workflow-regression.md；历史报告原字节保留。',
`- 本轮：${s.summary?.topLevel??0} 顶层／${s.summary?.subscenarios??0} 子场景，失败 ${s.summary?.failed??'无有效结果'}，跳过 ${s.summary?.skipped??0}。`,
`- 自有容器及匿名卷清理 ${s.containerCleanup===true}；临时凭据/结果清理 ${s.temporaryCleanup===true}；泄密扫描 ${s.leaks??'未完成'}。`,
'','## 迁移','', '```json',JSON.stringify({fresh:s.fresh,upgrade:s.upgrade},null,2),'```','', '## 场景','', '| 分组 | 场景 | 结果 |','|---|---|---|',...(s.groups??[]).flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?` ${JSON.stringify(c.failure)}`:''} |`)),
'','## 权限、并发、摘要与回滚证据','','```json',JSON.stringify(s.evidence??{},null,2),'```','', '## 未执行','', '- 没有模型、Generation、审批、结构化提案、Canon、Outbox、投影或自动修复。输入水位固定 0。', '- finite-validator-v1 只验证声明覆盖；author_rule_v1 的 hard=unknown 阻断，soft=unknown 明确未检查。未做自然语言语义、token、小说质量、生产认证或性能验收。',''].join('\n');}
export async function main({reportDirectory=output}={}){
  check(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');await mkdir(reportDirectory,{recursive:true});process.env.AB_TEST_MODE='1';
  const dir=await mkdtemp(path.join(os.tmpdir(),'agent-book-validation-')),resources=[],instances=[],markers=[],s={runId:randomUUID(),startedAt:new Date().toISOString()};
  try{
    const legacy=path.join(dir,'previous');await previousRegression({reportDirectory:legacy});for(const [from,to]of [['run-result.md','workflow-regression.md'],['context-regression.md','context-regression.md'],['legacy-regression.md','legacy-regression.md']])await writeFile(path.join(reportDirectory,to),await readFile(path.join(legacy,from)));check(process.exitCode===0,'OLD_REGRESSION_FAILED');s.legacy=true;process.env.AB_TEST_MIGRATION_BOUNDARY='5';
    const i=await prepareInstance(dir,s.runId,'validation-fresh',resources);instances.push(i);check((await command(i,'scripts/migrate.mjs')).migrations_applied===5,'FRESH_MIGRATION');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY');await command(i,'scripts/bootstrap.mjs','admin');s.fresh={applied:5,replayApplied:0};
    s.serverVersion=await withConnection(i.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
    const manifest=path.join(dir,'manifest.json'),result=path.join(dir,'result.json');await writeFile(manifest,JSON.stringify(i),{mode:0o600});const execution=node('--test',['--test-concurrency=1','test/finite-validation.integration.test.mjs'],i.configPaths.writerA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});i.outputs.push(execution.stdout,execution.stderr);
    const data=JSON.parse(await readFile(result));markers.push(...JSON.parse(await readFile(result+'.markers')));s.groups=data.groups;s.evidence=data.evidence;s.summary=analyzeResults(data,s.runId);
    if(execution.status!==0||!s.summary.allPassed)process.stderr.write(JSON.stringify({event:'validation_tests_failed',groups:s.groups})+'\n');check(execution.status===0&&s.summary.allPassed,'VALIDATION_TESTS_FAILED');
    const u=await prepareInstance(dir,s.runId,'validation-upgrade',resources);instances.push(u);await upgrade(u,s);
    markers.push(...instances.flatMap(x=>Object.values(x.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])));s.leaks=scanSecrets([s,...instances.map(x=>x.outputs)],markers);check(s.leaks===0,'DISCLOSURE');s.valid=true;
  }catch(e){s.failure=/^[A-Z_]+$/.test(e.code??'')?e.code:'VERIFICATION_FAILED';}
  finally{delete process.env.AB_TEST_MIGRATION_BOUNDARY;s.containerCleanup=await cleanup(resources);await rm(dir,{recursive:true,force:true});s.temporaryCleanup=true;s.ok=s.valid===true&&s.legacy===true&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;
    try{const text=report(s);check(scanSecrets([text],markers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(reportDirectory,'run-result.md'),text);}catch{s.ok=false;}}
  process.stdout.write(JSON.stringify({ok:s.ok,stage:s.failure??'completed',newTests:s.summary,cleanup:s.containerCleanup&&s.temporaryCleanup})+'\n');process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
