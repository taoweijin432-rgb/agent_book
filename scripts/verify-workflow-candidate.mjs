import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { mkdtemp,readFile,writeFile,rm,mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { main as contextRegression } from './verify-safe-context.mjs';
import { prepareInstance,cleanup,node } from './verify-foundation.mjs';
import { migrate } from './migrate.mjs';
import { withConnection } from '../src/database.mjs';
import { executeCommand } from '../src/foundation.mjs';
import { createContextFixture } from '../test/support/context-fixture.mjs';
import { requireCondition } from '../src/safety.mjs';
import { analyzeResults,scanSecrets,imageDigest } from './verification-support.mjs';
const output=path.resolve(import.meta.dirname,'../verification/workflow-candidate');
const check=(v,c)=>requireCondition(v,c);
async function command(i,script,actor='migrator'){const r=node(script,[],i.configPaths[actor]);i.outputs.push(r.stdout,r.stderr);let v;try{v=JSON.parse(r.stdout);}catch{check(false,'COMMAND_INVALID');}check(r.status===0&&v?.ok,'COMMAND_FAILED');return v;}
async function snapshot(i){return withConnection(i.configs.admin,async c=>{const r={};for(const {tablename}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows)r[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows.map(x=>x.r);return r;});}
async function upgrade(i,state){
  process.env.AB_TEST_MIGRATION_BOUNDARY='3';check((await migrate(i.configs.migrator)).migrations_applied===3,'UPGRADE_BASE_FAILED');process.env.AB_TEST_MIGRATION_BOUNDARY='4';
  await command(i,'scripts/bootstrap.mjs','admin');const f=await createContextFixture(i.configs,i.actors,{label:'upgrade-manual'});
  const unused=await executeCommand(i.configs.authorA,'context-grant:create',{novel_id:f.novel,request:{request_key:randomUUID(),task_version_id:f.version,writer_actor_id:f.writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}});check(unused.ok,'UPGRADE_REVOCATION_FIXTURE');check((await executeCommand(i.configs.authorA,'grant:revoke',{grant_id:unused.grant_id})).ok,'UPGRADE_CONTEXT_REVOKE');
  const baseGrant=await withConnection(i.configs.admin,async c=>(await c.query("SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND ca.capability_key='structure.manage'",[f.novel])).rows[0].grant_id);check((await executeCommand(i.configs.authorA,'grant:revoke',{grant_id:baseGrant})).ok,'UPGRADE_BASE_REVOKE');
  const before=await snapshot(i);
  await withConnection(i.configs.admin,c=>c.query(`CREATE FUNCTION public.manual_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.candidate_version') THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE';END IF;END $f$;CREATE EVENT TRIGGER manual_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.manual_migration_fault()`));
  const failure=node('scripts/migrate.mjs',[],i.configPaths.migrator);i.outputs.push(failure.stdout,failure.stderr);check(failure.status!==0,'MIGRATION_DID_NOT_FAIL');check(JSON.stringify(await snapshot(i))===JSON.stringify(before),'FAILED_MIGRATION_CHANGED_DATA');
  await withConnection(i.configs.admin,async c=>{check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===3,'FAILED_MIGRATION_CHANGED_LEDGER');await c.query('DROP EVENT TRIGGER manual_migration_fault;DROP FUNCTION public.manual_migration_fault()');});
  check((await command(i,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT');const after=await snapshot(i);for(const [name,data]of Object.entries(before))check(JSON.stringify(after[name])===JSON.stringify(data),'UPGRADE_HISTORY_CHANGED');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY');
  const call=(actor,op,request)=>executeCommand(i.configs[actor],op,{novel_id:f.novel,request});
  check((await call('authorA','design:history',{})).ok&&(await call('authorA','task:history',{})).ok,'OLD_COMMAND_FAILED');check((await call('writerA','context:read',{bundle_ref:f.bundle})).ok,'OLD_BUNDLE_FAILED');
  const g=await call('authorA','writing-grant:create',{request_key:randomUUID(),context_grant_id:f.contextGrant,expires_at:null});check(g.ok,'UPGRADE_GRANT_FAILED');
  check((await call('writerA','workflow:create',{request_key:randomUUID(),writing_grant_id:g.grant_id,bundle_ref:f.bundle,execution_mode:'manual_input_v1'})).ok,'UPGRADED_WORKFLOW_FAILED');
  state.upgrade={baseApplied:3,failedExit:failure.status,testsStartedAfterFailure:false,failedLedger:3,oldDataExactAfterFailure:true,applied:1,replayApplied:0,oldDataExactAfterUpgrade:true,baseAndContextRevocationsPreserved:true,oldAuthorAndWriterCommands:true,newWorkflowTrueRestrictedLogin:true,faultFacilitiesRemoved:true};
}
function report(s){return ['# 第二批第三段：人工 Workflow 与不可变 Candidate 验收','',`- run：${s.runId}；时间 ${s.startedAt}；退出 ${s.ok?0:1}；状态 ${s.failure??'completed'}`,
`- PostgreSQL ${s.serverVersion??'未取得'}；${imageDigest}；Node ${process.version}`,
'- 原有回归按 002/003 边界执行，记录在本目录 legacy-regression.md、context-regression.md；历史报告原字节保留。',
`- 本轮：${s.summary?.topLevel??0} 顶层／${s.summary?.subscenarios??0} 子场景，失败 ${s.summary?.failed??'无有效结果'}，跳过 ${s.summary?.skipped??0}。`,
`- 自有容器及匿名卷清理 ${s.containerCleanup===true}；临时凭据/结果清理 ${s.temporaryCleanup===true}；泄密扫描 ${s.leaks??'未完成'}。`,
'','## 迁移','', '```json',JSON.stringify({fresh:s.fresh,upgrade:s.upgrade},null,2),'```','', '## 场景','', '| 分组 | 场景 | 结果 |','|---|---|---|',...(s.groups??[]).flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?` ${JSON.stringify(c.failure)}`:''} |`)),
'','## 权限、并发、摘要与回滚证据','','```json',JSON.stringify(s.evidence??{},null,2),'```','', '## 未执行','', '- 没有模型、Generation、校验、审批、结构化提案、Canon、Outbox、投影或跨 Workflow 草稿依赖。输入水位固定 0。', '- 人工正文是受保护业务内容，不做自动脱密；exact-utf8-v1 上限 262144 字节仅为入口保护；未做 token、长篇质量、生产认证、灾备或性能验收。',''].join('\n');}
export async function main({reportDirectory=output}={}){
  check(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');await mkdir(reportDirectory,{recursive:true});process.env.AB_TEST_MODE='1';
  const dir=await mkdtemp(path.join(os.tmpdir(),'agent-book-manual-')),resources=[],instances=[],markers=[],s={runId:randomUUID(),startedAt:new Date().toISOString()};
  try{
    const legacy=path.join(dir,'previous');await contextRegression({reportDirectory:legacy});for(const [from,to]of [['run-result.md','context-regression.md'],['legacy-regression.md','legacy-regression.md']])await writeFile(path.join(reportDirectory,to),await readFile(path.join(legacy,from)));check(process.exitCode===0,'OLD_REGRESSION_FAILED');s.legacy=true;process.env.AB_TEST_MIGRATION_BOUNDARY='4';
    const i=await prepareInstance(dir,s.runId,'manual-fresh',resources);instances.push(i);check((await command(i,'scripts/migrate.mjs')).migrations_applied===4,'FRESH_MIGRATION');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY');await command(i,'scripts/bootstrap.mjs','admin');s.fresh={applied:4,replayApplied:0};
    s.serverVersion=await withConnection(i.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
    const manifest=path.join(dir,'manifest.json'),result=path.join(dir,'result.json');await writeFile(manifest,JSON.stringify(i),{mode:0o600});const execution=node('--test',['--test-concurrency=1','test/workflow-candidate.integration.test.mjs'],i.configPaths.writerA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});i.outputs.push(execution.stdout,execution.stderr);
    const data=JSON.parse(await readFile(result));markers.push(...JSON.parse(await readFile(result+'.markers')));s.groups=data.groups;s.evidence=data.evidence;s.summary=analyzeResults(data,s.runId);
    if(execution.status!==0||!s.summary.allPassed)process.stderr.write(JSON.stringify({event:'manual_tests_failed',groups:s.groups})+'\n');check(execution.status===0&&s.summary.allPassed,'MANUAL_TESTS_FAILED');
    const u=await prepareInstance(dir,s.runId,'manual-upgrade',resources);instances.push(u);await upgrade(u,s);
    markers.push(...instances.flatMap(x=>Object.values(x.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])));s.leaks=scanSecrets([s,...instances.map(x=>x.outputs)],markers);check(s.leaks===0,'DISCLOSURE');s.valid=true;
  }catch(e){s.failure=/^[A-Z_]+$/.test(e.code??'')?e.code:'VERIFICATION_FAILED';}
  finally{delete process.env.AB_TEST_MIGRATION_BOUNDARY;s.containerCleanup=await cleanup(resources);await rm(dir,{recursive:true,force:true});s.temporaryCleanup=true;s.ok=s.valid===true&&s.legacy===true&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;
    try{const text=report(s);check(scanSecrets([text],markers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(reportDirectory,'run-result.md'),text);}catch{s.ok=false;}}
  process.stdout.write(JSON.stringify({ok:s.ok,stage:s.failure??'completed',newTests:s.summary,cleanup:s.containerCleanup&&s.temporaryCleanup})+'\n');process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
