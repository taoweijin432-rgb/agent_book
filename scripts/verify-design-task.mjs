import { verifyExpiryUpgrade } from '../test/design-upgrade-expiry.mjs';
import { randomUUID,createHash } from 'node:crypto';
import { mkdtemp,readFile,writeFile,rm,mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareInstance,cleanup,node } from './verify-foundation.mjs';
import { migrate } from './migrate.mjs';
import { withConnection,inTransaction } from '../src/database.mjs';
import { initializeNovelReader } from './administration.mjs';
import { executeCommand } from '../src/foundation.mjs';
import { requireCondition } from '../src/safety.mjs';
import { runFile,image,imageDigest,analyzeResults,scanSecrets,finalExit } from './verification-support.mjs';

const disclosureMarkers=[];
const root=path.resolve(import.meta.dirname,'..'),output=path.join(root,'verification/design-task');
const parsed=result=>{try{return JSON.parse(result.stdout);}catch{return null;}};
const check=(value,code)=>requireCondition(value,code);
async function command(instance,script,args=[],actor='migrator') {
  const result=node(script,args,instance.configPaths[actor]);instance.outputs.push(result.stdout,result.stderr);
  check(result.status===0&&parsed(result)?.ok,'SETUP_COMMAND_FAILED');return parsed(result);
}
async function suite(instance,directory,file) {
  const manifest=path.join(directory,`${path.basename(file)}-manifest.json`),result=path.join(directory,`${path.basename(file)}-result.json`);
  await writeFile(manifest,JSON.stringify(instance),{mode:0o600});
  const execution=node('--test',['--test-concurrency=1',file],instance.configPaths.authorA,{AB_TEST_MANIFEST:manifest,AB_TEST_RESULTS:result});
  instance.outputs.push(execution.stdout,execution.stderr);
  const data=JSON.parse(await readFile(result,'utf8')),summary=analyzeResults(data,instance.runId);
  if(execution.status!==0||!summary.allPassed){
    // Only structured labels and failure locations, never raw TAP payloads.
    process.stderr.write(`${JSON.stringify({event:'suite_failed',suite:path.basename(file),groups:data.groups})}\n`);
  }
  if(file.includes('design-task'))disclosureMarkers.push(...JSON.parse(await readFile(result+'.markers','utf8')));
  return {summary,evidence:data.evidence,groups:data.groups,exit:execution.status};
}
async function oldCreate(instance,actor,key) {
  const ids=Array.from({length:3},()=>randomUUID()),id=randomUUID();
  const response=await withConnection(instance.configs[actor],c=>inTransaction(c,async tx=>(await tx.query('SELECT agent_book.api_create_novel($1,$2,$3,$4,$5) AS r',[id,key,'升级前作品',ids,randomUUID()])).rows[0].r));
  check(response.ok,'LEGACY_AUTHOR_CREATE_FAILED');return id;
}
async function snapshot(instance) {
  return withConnection(instance.configs.admin,async c=>{
    const rows={};for(const table of ['novel','actor_principal','actor_role','data_scope','capability_grant','grant_revocation','creation_authorization_revocation','access_audit_record'])
      rows[table]=(await c.query(`SELECT to_jsonb(t) AS r FROM agent_book.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.r);
    return rows;
  });
}
async function upgrade(instance,state) {
  check((await migrate(instance.configs.migrator,{firstBatchOnly:true})).migrations_applied===1,'LEGACY_MIGRATION_FAILED');
  await command(instance,'scripts/bootstrap.mjs',[],'admin');
  const a=await oldCreate(instance,'authorA','upgrade-a'),b=await oldCreate(instance,'authorB','upgrade-b'),revoked=await oldCreate(instance,'authorA','upgrade-revoked');
  const reader=(await initializeNovelReader(instance.configs.admin,{actorId:instance.actors.find(a=>a.label==='writerA').actorId,novelId:a})).grant_id;
  const anchor=await withConnection(instance.configs.admin,async c=>(await c.query(`SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.data_scope s USING(data_scope_id)
    JOIN agent_book.capability ca USING(capability_id) WHERE s.novel_id=$1 AND ca.capability_key='novel.read'`,[revoked])).rows[0].grant_id);
  check((await withConnection(instance.configs.authorA,c=>inTransaction(c,async tx=>(await tx.query('SELECT agent_book.api_revoke_grant($1,$2) r',[anchor,randomUUID()])).rows[0].r))).ok,'PREUPGRADE_REVOKE_FAILED');
  check((await executeCommand(instance.configs.authorB,'creation:revoke')).ok,'PREUPGRADE_CREATION_REVOKE_FAILED');
  // A different author can hold metadata-only permission without becoming the creator.
  await withConnection(instance.configs.admin,c=>c.query(`INSERT INTO agent_book.capability_grant
    SELECT $1,ar.actor_id,ar.role_id,ca.capability_id,s.data_scope_id,clock_timestamp(),NULL
    FROM agent_book.actor_role ar JOIN agent_book.actor_principal p USING(actor_id)
      CROSS JOIN agent_book.capability ca CROSS JOIN agent_book.data_scope s
    WHERE p.db_login=$2 AND ca.capability_key='novel.read' AND s.novel_id=$3`,[randomUUID(),instance.configs.authorB.user,a]));
  const before=await snapshot(instance);
  // Real migration failure after 001 data exists, not a mocked status.
  await withConnection(instance.configs.admin,c=>c.query(`CREATE FUNCTION public.design_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.design_draft') THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE'; END IF; END $f$;
    CREATE EVENT TRIGGER design_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.design_migration_fault()`));
  const failed=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(failed.stdout,failed.stderr);
  check(failed.status!==0,'MIGRATION_FAILURE_NOT_PROPAGATED');
  check(JSON.stringify(await snapshot(instance))===JSON.stringify(before),'FAILED_UPGRADE_CHANGED_DATA');
  await withConnection(instance.configs.admin,async c=>{
    check((await c.query("SELECT to_regclass('agent_book.design_draft') IS NULL AS absent")).rows[0].absent,'UPGRADE_PARTIAL_OBJECTS');
    check((await c.query('SELECT count(*)::int n FROM agent_book_meta.schema_migrations')).rows[0].n===1,'UPGRADE_LEDGER_CHANGED');
    await c.query('DROP EVENT TRIGGER design_migration_fault;DROP FUNCTION public.design_migration_fault()');
  });
  check((await command(instance,'scripts/migrate.mjs')).migrations_applied===1,'UPGRADE_COUNT_INVALID');
  check((await command(instance,'scripts/migrate.mjs')).migrations_applied===0,'UPGRADE_REPLAY_INVALID');
  const after=await snapshot(instance);
  for(const [table,rows] of Object.entries(before)) for(const row of rows)
    check(after[table].some(r=>JSON.stringify(r)===JSON.stringify(row)),'UPGRADE_HISTORY_CHANGED');
  for(const [actor,novel,allowed] of [['authorA',a,true],['authorB',b,true],['authorA',revoked,false],['authorB',a,false],['writerA',a,false]]) {
    check((await executeCommand(instance.configs[actor],'design:history',{novel_id:novel,request:{}})).ok===allowed,'UPGRADE_SCOPE_FAILED');
  }
  check((await executeCommand(instance.configs.writerA,'novel:read',{novel_id:a})).ok,'UPGRADE_WRITER_REGRESSION');
  check((await executeCommand(instance.configs.authorB,'novel:read',{novel_id:a})).ok,'METADATA_ONLY_AUTHOR_REGRESSION');
  check(!(await executeCommand(instance.configs.authorA,'novel:read',{novel_id:revoked})).ok,'UPGRADE_RESTORED_REVOKED_READ');
  const count=await withConnection(instance.configs.admin,async c=>({
    granted:(await c.query("SELECT count(*)::int n FROM agent_book.design_authority_upgrade WHERE disposition='seeded'")).rows[0].n,
    withheld:(await c.query("SELECT count(*)::int n FROM agent_book.design_authority_upgrade WHERE disposition='withheld_revoked_or_expired'")).rows[0].n,
    faults:(await c.query("SELECT count(*)::int n FROM pg_event_trigger WHERE evtname='design_migration_fault'")).rows[0].n}));
  state.upgrade={firstBatchApplied:1,realAuthorNovels:3,expectedMigrationFailureExit:failed.status,testsStartedAfterFailure:false,
    rollbackPreservedAllOriginalRows:true,applied:1,replayApplied:0,allHistoricalRowsUnchanged:true,revocationsPreserved:true,
    readerNotElevated:true,metadataOnlyAuthorNotElevated:true,independentAuthorNotElevated:true,creationStartupRevocationDidNotEraseExistingNovelAuthority:true,...count};
  check(count.granted===2&&count.withheld===1&&count.faults===0,'UPGRADE_SEED_COUNT_INVALID');
}
async function invalidProvenance(instance,state) {
  await migrate(instance.configs.migrator,{firstBatchOnly:true});await command(instance,'scripts/bootstrap.mjs',[],'admin');
  // Deliberately incomplete historical administrative fixture; no successful author claim is made for this row.
  await withConnection(instance.configs.admin,c=>c.query("INSERT INTO agent_book.novel(novel_id,external_key,title) VALUES($1,'missing-provenance','核验')",[randomUUID()]));
  const result=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(result.stdout,result.stderr);
  check(result.status!==0,'MISSING_PROVENANCE_ACCEPTED');
  const untouched=await withConnection(instance.configs.admin,async c=>(await c.query("SELECT to_regclass('agent_book.design_draft') IS NULL AND (SELECT count(*) FROM agent_book_meta.schema_migrations)=1 AS valid")).rows[0].valid);
  check(untouched,'PROVENANCE_FAILURE_PARTIAL_STATE');state.provenance={missingCreationEvidenceRejected:true,exit:result.status,firstBatchIntact:true};
}
function report(state) {
  return ['# 第二批第一段：作者设计版本与场景任务验收','',`- run：${state.runId}；时间：${state.startedAt}`,
    `- 执行：pnpm test；退出：${finalExit({...state,reportWritten:true})}；状态：${state.failureCode??'completed'}`,
    `- 镜像：${image}；${imageDigest}；Node ${process.version}；PostgreSQL ${state.serverVersion??'未取得'}`,
    '- 这是本轮修复后的正式工程实际执行；历史通过、未修复 002 与原报告见 expiry-repair/before/；修复前真实复现见 expiry-repair/before-reproduction.json。',
    `- 第一批回归：${state.foundation?.summary.topLevel??0} 顶层／${state.foundation?.summary.subscenarios??0} 子场景；控制测试 ${state.unitTests??0} 个（分别统计）。`,
    `- 新增：${state.design?.summary.topLevel??0} 顶层／${state.design?.summary.subscenarios??0} 子场景；跳过 ${state.design?.summary.skipped??0}；结果有效 ${state.resultsValid===true}。`,
    `- 容器/匿名卷清理 ${state.containerCleanup===true}；临时凭据/结果清理 ${state.temporaryCleanup===true}；泄密扫描 ${state.leaks??'未取得'}。`,
    '', '## 迁移路径与失败边界','','```json',JSON.stringify({fresh:state.fresh,upgrade:state.upgrade,provenance:state.provenance},null,2),'```',
    '', '## 本轮有效期专项（运行器独立阶段，不混入 Node 数量）','','```json',JSON.stringify(state.expiry??{},null,2),'```',
    '', '## 场景结果','','| 分组 | 场景 | 结果 |','|---|---|---|',
    ...[...(state.foundation?.groups??[]),...(state.design?.groups??[])].flatMap(g=>g.cases.map(c=>`| ${g.name} | ${c.name} | ${c.status}${c.failure?` ${JSON.stringify(c.failure)}`:''} |`)),
    '', '## 新增权限、并发、回滚及摘要证据','','```json',JSON.stringify(state.design?.evidence??{},null,2),'```',
    '', '## 第一批本轮回归证据','','```json',JSON.stringify(state.foundation?.evidence??{},null,2),'```',
    '', '## 未执行和边界','', '- 无真实模型、Bundle、Workflow、候选、校验、审批、Canon、Evidence 全域、投影、生产认证和规模测试。',
    '- 任务预算只校验结构/数值，读者范围不代表实际披露；设计约束只保存作者意图，不执行自然语言规则。',
    '- 只清理本轮带匹配标签的容器、匿名卷和临时目录；第一批历史验收文件保持只读。',''].join('\n');
}
export async function main({ reportDirectory=output }={}) {
  check(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');
  const runId=randomUUID(),directory=await mkdtemp(path.join(os.tmpdir(),'agent-book-design-task-')),resources=[],instances=[];
  const state={runId,startedAt:new Date().toISOString()};process.env.AB_TEST_MODE='1';
  try {
    await mkdir(reportDirectory,{recursive:true});
    const unit=spawnSync(process.execPath,['--test','test/foundation.unit.test.mjs'],{encoding:'utf8',timeout:30000});
    state.unitTests=Number(unit.stdout.match(/# tests (\d+)/)?.[1]??0);check(unit.status===0&&state.unitTests===7,'CONTROL_TEST_FAILED');
    check(JSON.parse(runFile('docker',['image','inspect',image]))[0].RepoDigests?.includes(imageDigest),'IMAGE_DIGEST_MISMATCH');
    const fresh=await prepareInstance(directory,runId,1,resources);instances.push(fresh);
    const applied=await command(fresh,'scripts/migrate.mjs');state.migrationExit=0;check(applied.migrations_applied===2,'FRESH_MIGRATION_COUNT_INVALID');
    check((await command(fresh,'scripts/migrate.mjs')).migrations_applied===0,'FRESH_REPLAY_FAILED');
    await command(fresh,'scripts/bootstrap.mjs',[],'admin');state.fresh={applied:2,replayApplied:0};
    state.serverVersion=await withConnection(fresh.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
    state.foundation=await suite(fresh,directory,'test/foundation.integration.test.mjs');check(state.foundation.exit===0&&state.foundation.summary.allPassed,'FOUNDATION_REGRESSION_FAILED');check(state.foundation.summary.topLevel===5&&state.foundation.summary.subscenarios===45,'FOUNDATION_REGRESSION_COUNT_CHANGED');
    state.design=await suite(fresh,directory,'test/design-task.integration.test.mjs');state.testExit=state.design.exit;check(state.design.exit===0&&state.design.summary.allPassed,'INTEGRATION_TEST_FAILED');
    const old=await prepareInstance(directory,runId,2,resources);instances.push(old);await upgrade(old,state);
    const incomplete=await prepareInstance(directory,runId,3,resources);instances.push(incomplete);await invalidProvenance(incomplete,state);
    state.expiry=await verifyExpiryUpgrade(directory,runId,resources,instances);
    const markers=instances.flatMap(i=>Object.values(i.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`]));
    disclosureMarkers.push(...markers);
    state.leaks=scanSecrets([state,...instances.map(i=>i.outputs)],disclosureMarkers);check(state.leaks===0,'CREDENTIAL_DISCLOSURE');
    state.resultsValid=true;state.allPassed=true;
  } catch(error) {state.failureCode=/^[A-Z_]+$/.test(error.code??'')?error.code:'VERIFICATION_FAILED';}
  finally {
    state.containerCleanup=await cleanup(resources);
    try{await rm(directory,{recursive:true,force:true});state.temporaryCleanup=true;}catch{state.temporaryCleanup=false;}
    state.cleanup=state.containerCleanup&&state.temporaryCleanup;
    try{const content=report(state);check(scanSecrets([content],disclosureMarkers)===0,'REPORT_DISCLOSURE');await writeFile(path.join(reportDirectory,'run-result.md'),content);state.reportWritten=true;}catch{state.reportWritten=false;}
  }
  const exit=finalExit(state);process.stdout.write(`${JSON.stringify({ok:exit===0,stage:state.failureCode??'completed',foundation:state.foundation?.summary,design:state.design?.summary,cleanup:state.cleanup})}\n`);process.exitCode=exit;
}
if(process.argv[1]===import.meta.filename)await main();
