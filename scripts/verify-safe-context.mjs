import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm,mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { main as legacyRegression } from './verify-design-task.mjs';
import { prepareInstance,cleanup,node } from './verify-foundation.mjs';
import { migrate } from './migrate.mjs';
import { withConnection } from '../src/database.mjs';
import { executeCommand } from '../src/foundation.mjs';
import { createDesignFixture } from '../test/support/design-fixture.mjs';
import { requireCondition } from '../src/safety.mjs';
import { analyzeResults,scanSecrets,imageDigest } from './verification-support.mjs';
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'verification/safe-context');
const check=(v,c)=>requireCondition(v,c);
const parse=r=>{try{return JSON.parse(r.stdout);}catch{return null;}};
async function command(i,script,args=[],actor='migrator'){const r=node(script,args,i.configPaths[actor]);i.outputs.push(r.stdout,r.stderr);check(r.status===0&&parse(r)?.ok,'SETUP_COMMAND_FAILED');return parse(r);}
async function snapshot(i){return withConnection(i.configs.admin,async c=>{
  const result={};const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='agent_book' ORDER BY tablename")).rows;
  for(const {tablename}of tables)result[tablename]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${tablename} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.r);return result;
});}
async function upgraded(directory,runId,resources,instances,state){
  const i=await prepareInstance(directory,runId,'context-upgrade',resources);instances.push(i);
  process.env.AB_TEST_MIGRATION_BOUNDARY='2';check((await migrate(i.configs.migrator)).migrations_applied===2,'UPGRADE_BASE_FAILED');process.env.AB_TEST_MIGRATION_BOUNDARY='3';
  await command(i,'scripts/bootstrap.mjs',[],'admin');const fixture=await createDesignFixture(i.configs.authorA,'upgrade-context');
  const grant=(await withConnection(i.configs.admin,c=>c.query(`SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND ca.capability_key='structure.manage'`,[fixture.novel]))).rows[0].grant_id;
  check((await executeCommand(i.configs.authorA,'grant:revoke',{grant_id:grant})).ok,'UPGRADE_REVOKE_FAILED');
  const before=await snapshot(i);
  await withConnection(i.configs.admin,c=>c.query(`CREATE FUNCTION public.context_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$ BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.context_bundle') THEN RAISE EXCEPTION 'TEST_CONTEXT_MIGRATION_FAILURE'; END IF; END $f$;
    CREATE EVENT TRIGGER context_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.context_migration_fault()`));
  const failure=node('scripts/migrate.mjs',[],i.configPaths.migrator);i.outputs.push(failure.stdout,failure.stderr);check(failure.status!==0,'MIGRATION_FAILURE_NOT_PROPAGATED');
  check(JSON.stringify(await snapshot(i))===JSON.stringify(before),'FAILED_UPGRADE_CHANGED_HISTORY');
  await withConnection(i.configs.admin,async c=>{check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===2,'FAILED_UPGRADE_CHANGED_LEDGER');await c.query('DROP EVENT TRIGGER context_migration_fault;DROP FUNCTION public.context_migration_fault()');});
  check((await command(i,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT_INVALID');
  const after=await snapshot(i);for(const [name,rows]of Object.entries(before))check(JSON.stringify(after[name])===JSON.stringify(rows),'UPGRADE_CHANGED_OLD_DATA');
  check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY_INVALID');
  check((await executeCommand(i.configs.authorA,'design:history',{novel_id:fixture.novel,request:{}})).ok,'UPGRADED_DESIGN_FAILED');
  check((await executeCommand(i.configs.authorA,'task:history',{novel_id:fixture.novel,request:{}})).ok,'UPGRADED_TASK_FAILED');
  const writer=i.actors.find(a=>a.label==='writerA').actorId;
  const permission=await executeCommand(i.configs.authorA,'context-grant:create',{novel_id:fixture.novel,request:{request_key:randomUUID(),task_version_id:fixture.version,writer_actor_id:writer,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}});
  check(permission.ok,'UPGRADED_CONTEXT_AUTHORITY_FAILED');
  check(!(await executeCommand(i.configs.writerA,'context:compile',{novel_id:fixture.novel,request:{request_key:randomUUID(),task_version_id:fixture.version,max_bytes:65536}})).ok,'MISSING_PROJECTIONS_ACCEPTED');
  state.upgrade={baseApplied:2,expectedFailureExit:failure.status,testsStartedAfterFailure:false,oldDataExactAfterFailedMigration:true,applied:1,replayApplied:0,oldDataExactAfterUpgrade:true,revocationsPreserved:true,oldAuthorCommands:true,newExplicitGrant:true,noAutomaticWriterContext:true};
}
function report(s){return ['# 第二批第二段正式安全上下文验收','',`- run：${s.runId}；时间 ${s.startedAt}；状态 ${s.failure??'completed'}；最终退出 ${s.ok?0:1}`,
  `- PostgreSQL ${s.serverVersion??'未取得'}；镜像 ${imageDigest}；Node ${process.version}`,
  '- 原回归在实际 002 边界执行，详见 legacy-regression.md；第一批 5/45、控制 7、第二批第一段 6/34、补授权有效期 9（运行器独立阶段）分别统计。未改写旧断言或历史报告。',
  `- 新增集成：${s.summary?.topLevel??0} 顶层／${s.summary?.subscenarios??0} 子场景；跳过 ${s.summary?.skipped??0}；失败 ${s.summary?.failed??'未取得有效结果'}。`,
  `- 容器/匿名卷清理 ${s.containerCleanup===true}；临时凭据/结果清理 ${s.temporaryCleanup===true}；秘密/凭据扫描 ${s.leaks??'未取得'}。`,
  '', '## 迁移路径','','```json',JSON.stringify({fresh:s.fresh,upgrade:s.upgrade},null,2),'```',
  '', '## 新增真实场景','','| 分组 | 场景 | 结果 |','|---|---|---|',...(s.groups??[]).flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?` ${JSON.stringify(c.failure)}`:''} |`)),
  '', '## 并发、来源、预算及回滚证据','','```json',JSON.stringify(s.evidence??{},null,2),'```',
  '', '## 未执行与边界','', '- 不实现 Workflow、Generation、模型调用、候选、校验、审批、Canon、投影消费或外部检索；没有人物知识/读者披露历史，不做自然语言泄密识别。',
  '- 安全投影是作者批准的有限指令，不是 Canon Fact；只支持三个真实 Author Design 来源类型。字节预算不代表实际 token 窗口或模型调用准入。',
  '- 仅清理本轮匹配标签的容器、匿名卷和临时文件；生产、灾备与规模测试未执行。',''].join('\n');}
export async function main({reportDirectory=output}={}){
  await mkdir(reportDirectory,{recursive:true});
  check(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');
  process.env.AB_TEST_MODE='1';const directory=await mkdtemp(path.join(os.tmpdir(),'agent-book-safe-context-')),resources=[],instances=[],markers=[];
  const s={runId:randomUUID(),startedAt:new Date().toISOString()};
  try{
    process.env.AB_TEST_MIGRATION_BOUNDARY='2';const legacyDir=path.join(directory,'legacy');await legacyRegression({reportDirectory:legacyDir});
    await writeFile(path.join(reportDirectory,'legacy-regression.md'),await readFile(path.join(legacyDir,'run-result.md')));check(process.exitCode===0,'LEGACY_REGRESSION_FAILED');s.legacy=true;process.env.AB_TEST_MIGRATION_BOUNDARY='3';
    const i=await prepareInstance(directory,s.runId,'context-fresh',resources);instances.push(i);
    check((await command(i,'scripts/migrate.mjs')).migrations_applied===3,'FRESH_MIGRATION_FAILED');check((await command(i,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY_FAILED');await command(i,'scripts/bootstrap.mjs',[],'admin');s.fresh={applied:3,replayApplied:0};
    s.serverVersion=await withConnection(i.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
    const manifest=path.join(directory,'context-manifest.json'),result=path.join(directory,'context-result.json');await writeFile(manifest,JSON.stringify(i),{mode:0o600});
    const execution=node('--test',['--test-concurrency=1','test/safe-context.integration.test.mjs'],i.configPaths.writerA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});i.outputs.push(execution.stdout,execution.stderr);
    const data=JSON.parse(await readFile(result));s.summary=analyzeResults(data,s.runId);s.groups=data.groups;s.evidence=data.evidence;markers.push(...JSON.parse(await readFile(result+'.markers')));
    if(execution.status!==0||!s.summary.allPassed)process.stderr.write(`${JSON.stringify({event:'safe_context_failed',groups:data.groups})}\n`);
    check(execution.status===0&&s.summary.allPassed,'CONTEXT_INTEGRATION_FAILED');await upgraded(directory,s.runId,resources,instances,s);
    markers.push(...instances.flatMap(i=>Object.values(i.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])));
    s.leaks=scanSecrets([s,...instances.map(i=>i.outputs)],markers);check(s.leaks===0,'DISCLOSURE');s.valid=true;
  }catch(e){s.failure=/^[A-Z_]+$/.test(e.code??'')?e.code:'VERIFICATION_FAILED';}
  finally{
    delete process.env.AB_TEST_MIGRATION_BOUNDARY;s.containerCleanup=await cleanup(resources);await rm(directory,{recursive:true,force:true});s.temporaryCleanup=true;
    s.ok=s.valid===true&&s.legacy===true&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;
    try{const content=report(s);check(scanSecrets([content],markers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(reportDirectory,'run-result.md'),content);}catch{s.ok=false;}
  }
  process.stdout.write(`${JSON.stringify({ok:s.ok,stage:s.failure??'completed',newTests:s.summary,cleanup:s.containerCleanup&&s.temporaryCleanup})}\n`);process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
