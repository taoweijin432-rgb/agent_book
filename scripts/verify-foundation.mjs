import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { connectionOptions, withConnection } from '../src/database.mjs';
import { requireCondition } from '../src/safety.mjs';
import { runFile, image, imageDigest, waitForReady, analyzeResults, scanSecrets, finalExit, migrationThenTest, protectedFiles } from './verification-support.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const labels={authorA:'author',authorB:'author',writerA:'writer',writerB:'writer',auditorA:'auditor',auditorB:'auditor',
  validator:'validator',commit:'commit-service',projection:'projection-worker',expired:'writer',revoked:'writer',ungranted:'writer',disabled:'writer',timed:'writer'};

export function node(script,args,configPath,extra={}) {
  return spawnSync(process.execPath,[script,...args],{cwd:root,env:{...process.env,AB_TEST_MODE:'1',AB_CONFIG:configPath,...extra},encoding:'utf8',timeout:180000});
}
function parsed(result) { try { return JSON.parse(result.stdout); } catch { return null; } }
async function secretFile(file,value){await writeFile(file,JSON.stringify(value),{mode:0o600});}

export async function prepareInstance(directory,runId,index,resources) {
  const nonce=randomBytes(6).toString('hex'),prefix=`ab_${nonce}`;
  const name=`agent-book-foundation-${nonce}`,password=randomBytes(24).toString('hex');
  const resource={name,runId,started:false};resources.push(resource);
  runFile('docker',['run','-d','--rm','--name',name,'--label',`agent-book-foundation-run=${runId}`,
    '-e',`POSTGRES_PASSWORD=${password}`,'-p','127.0.0.1::5432',imageDigest,
    '-c','log_error_verbosity=terse','-c','log_min_error_statement=panic','-c','log_parameter_max_length_on_error=0','-c','log_statement=none']);
  resource.started=true;
  const port=Number(runFile('docker',['port',name,'5432/tcp']).match(/127\.0\.0\.1:(\d+)/)?.[1]);
  requireCondition(port>0,'LOCAL_PORT_REQUIRED');
  await waitForReady({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
  const database=`agent_book_foundation_${nonce}`,instanceId=randomUUID();
  const bootstrapClient=new pg.Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',connectionTimeoutMillis:5000});
  try{await bootstrapClient.connect();await bootstrapClient.query(`CREATE DATABASE "${database}"`);}finally{await bootstrapClient.end();}
  const base={mode:'test',host:'127.0.0.1',port,database,instanceId};
  const provision={owner:`${prefix}_owner`,migrator:{login:`${prefix}_migrator`,password:randomBytes(24).toString('hex')},
    actors:Object.entries(labels).map(([label,role])=>({actorId:randomUUID(),login:`${prefix}_${label.toLowerCase()}`,password:randomBytes(24).toString('hex'),role,status:label==='disabled'?'disabled':'active'}))};
  const configs={admin:{...base,user:'postgres',password},migrator:{...base,user:provision.migrator.login,password:provision.migrator.password}};
  for(const [i,label] of Object.keys(labels).entries())configs[label]={...base,user:provision.actors[i].login,password:provision.actors[i].password};
  const configPaths={};for(const [key,config]of Object.entries(configs)){const target=path.join(directory,`${index}-${key}.json`);await secretFile(target,config);configPaths[key]=target;}
  const provisionPath=path.join(directory,`${index}-provision.json`);await secretFile(provisionPath,provision);
  const init=node('scripts/initialize.mjs',['--confirm-empty-target'],configPaths.admin,{AB_PROVISION:provisionPath});
  requireCondition(init.status===0&&parsed(init)?.ok,'INITIALIZATION_FAILED');
  return {mode:'test',runId,container:name,configs,configPaths,owner:provision.owner,
    actors:provision.actors.map((actor,i)=>({...actor,label:Object.keys(labels)[i]})),outputs:[init.stdout,init.stderr]};
}

async function primary(directory,runId,resources,state) {
  const instance=await prepareInstance(directory,runId,1,resources);state.instances.push({index:1,initialized:true});
  const first=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(first.stdout,first.stderr);
  state.migrationExit=first.status;state.migrationDiagnostic=first.stderr.trim();requireCondition(first.status===0&&parsed(first)?.migrations_applied===1,'MIGRATION_FAILED');
  const second=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(second.stdout,second.stderr);
  requireCondition(second.status===0&&parsed(second)?.migrations_applied===0,'MIGRATION_REPLAY_FAILED');
  const seeded=node('scripts/bootstrap.mjs',[],instance.configPaths.admin);instance.outputs.push(seeded.stdout,seeded.stderr);
  requireCondition(seeded.status===0&&parsed(seeded)?.ok,'BOOTSTRAP_FAILED');
  const manifestPath=path.join(directory,'manifest.json'),resultPath=path.join(directory,'results.json');
  await secretFile(manifestPath,instance);
  const test=node('--test',['--test-concurrency=1','test/foundation.integration.test.mjs'],instance.configPaths.writerA,
    {AB_TEST_MANIFEST:manifestPath,AB_TEST_RESULTS:resultPath});
  state.testExit=test.status;instance.outputs.push(test.stdout,test.stderr);
  const result=JSON.parse(await readFile(resultPath,'utf8'));const summary=analyzeResults(result,runId);
  const markers=Object.values(instance.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`]);
  const leaks=scanSecrets([instance.outputs,result],markers);requireCondition(leaks===0,'CREDENTIAL_DISCLOSURE');
  state.resultsValid=true;state.allPassed=summary.allPassed&&test.status===0;state.summary=summary;state.groups=result.groups;state.evidence=result.evidence;
  state.instances[0]={index:1,initialized:true,firstMigrationExit:first.status,applied:parsed(first).migrations_applied,
    replayMigrationExit:second.status,replayApplied:parsed(second).migrations_applied,credentialLeaks:leaks};
  state.serverVersion=await withConnection(instance.configs.admin,async c=>(await c.query('SHOW server_version')).rows[0].server_version);
  requireCondition(state.allPassed,'INTEGRATION_TEST_FAILED');
}

async function repeatAndFailMigration(directory,runId,resources,state) {
  const instance=await prepareInstance(directory,runId,2,resources);
  await withConnection(instance.configs.admin,c=>c.query(`CREATE FUNCTION public.foundation_migration_fault() RETURNS event_trigger LANGUAGE plpgsql AS $f$
    BEGIN IF EXISTS(SELECT 1 FROM pg_event_trigger_ddl_commands() WHERE object_identity='agent_book.entity')
      THEN RAISE EXCEPTION 'TEST_MIGRATION_FAILURE'; END IF; END $f$;
    CREATE EVENT TRIGGER foundation_migration_fault ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.foundation_migration_fault()`));
  let testsStarted=false;
  const failure=await migrationThenTest(async()=>{
    const result=node('scripts/migrate.mjs',[],instance.configPaths.migrator);instance.outputs.push(result.stdout,result.stderr);return result;
  },async()=>{testsStarted=true;return{status:0};});
  requireCondition(failure.migrationExit!==0&&!testsStarted,'FAILED_MIGRATION_NOT_STOPPED');
  const rollback=await withConnection(instance.configs.admin,async c=>{
    const absent=(await c.query("SELECT to_regclass('agent_book.novel') IS NULL AS absent")).rows[0].absent;
    const ledger=(await c.query('SELECT count(*)::int AS n FROM agent_book_meta.schema_migrations')).rows[0].n;
    await c.query('DROP EVENT TRIGGER foundation_migration_fault; DROP FUNCTION public.foundation_migration_fault()');
    return {businessObjectsAbsent:absent,migrationLedgerRows:ledger};
  });
  requireCondition(rollback.businessObjectsAbsent&&rollback.migrationLedgerRows===0,'MIGRATION_PARTIAL_STATE');
  const retried=node('scripts/migrate.mjs',[],instance.configPaths.migrator),replay=node('scripts/migrate.mjs',[],instance.configPaths.migrator);
  const seeded=node('scripts/bootstrap.mjs',[],instance.configPaths.admin);
  const created=node('src/cli.mjs',['novel:create','repeat-instance','第二实例'],instance.configPaths.authorA);
  const read=node('src/cli.mjs',['novel:read',parsed(created)?.novel_id??'invalid'],instance.configPaths.authorA);
  for(const result of [retried,replay,seeded,created,read]){instance.outputs.push(result.stdout,result.stderr);requireCondition(result.status===0&&parsed(result)?.ok,'SECOND_INSTANCE_FAILED');}
  requireCondition(parsed(retried).migrations_applied===1&&parsed(replay).migrations_applied===0,'SECOND_MIGRATION_REPLAY_FAILED');
  const faults=await withConnection(instance.configs.admin,async c=>(await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_event_trigger WHERE evtname='foundation_migration_fault'")).rows[0].n);
  requireCondition(faults===0,'FAULT_REMAINS');
  requireCondition(scanSecrets(instance.outputs,Object.values(instance.configs).map(c=>c.password))===0,'CREDENTIAL_DISCLOSURE');
  state.instances.push({index:2,initialized:true,expectedFailureExit:failure.migrationExit,testsStartedAfterFailure:testsStarted,
    ...rollback,retryExit:retried.status,retryApplied:parsed(retried).migrations_applied,replayApplied:parsed(replay).migrations_applied,realAuthorCreateAndRead:true,faultFacilitiesRemaining:faults});
}

export async function cleanup(resources) {
  let success=true;
  for(const resource of resources){
    try{
      const found=JSON.parse(runFile('docker',['inspect',resource.name]))[0];
      requireCondition(found.Config.Labels?.['agent-book-foundation-run']===resource.runId,'CONTAINER_OWNERSHIP_MISMATCH');
      runFile('docker',['rm','--force','--volumes',resource.name]);
      const gone=spawnSync('docker',['inspect',resource.name],{encoding:'utf8',timeout:10000});
      requireCondition(gone.status!==0,'CONTAINER_REMAINS');resource.removed=true;
    }catch{success=false;resource.removed=false;}
  }
  return success;
}

function report(state) {
  const lines=['# 第一批正式工程与身份底座验收','',`- 本轮 run：${state.runId}`,`- 时间：${state.startedAt}`,
    `- 固定镜像：${image}；${imageDigest}`,`- 实际 PostgreSQL：${state.serverVersion??'未执行'}`,
    `- Node：${process.version}；pg 8.23.0；node-pg-migrate 9.0.0`,
    `- 执行：pnpm test；最终退出：${finalExit({...state,reportWritten:true})}`,
    `- 正式迁移退出：${state.migrationExit??'未执行'}；集成测试退出：${state.testExit??'未执行'}`,
    `- 迁移安全诊断：${state.migrationDiagnostic||'无错误'}`,
    `- 集成顶层：${state.summary?.topLevel??0}（通过 ${state.summary?.topPassed??0}／失败 ${state.summary?.topFailed??0}）；参数化子场景：${state.summary?.subscenarios??0}；失败：${state.summary?.failed??'未取得有效结果'}；跳过：${state.summary?.skipped??0}`,
    `- 配置/运行器控制验证：${state.unitTests??'未执行'} 个顶层；退出 ${state.unitExit??'未执行'}（单独统计，不计入数据库场景）`,
    `- 容器清理：${state.containerCleanup===true}；临时目录/凭据/结果清理：${state.temporaryCleanup===true}`,
    `- 状态：${state.failureCode??'completed'}；结果有效：${state.resultsValid===true}`,
    '', '## 两个全新实例与迁移失败边界','', '```json',JSON.stringify(state.instances,null,2),'```',
    '', '## 实际集成场景','', '| 分组 | 子场景 | 状态 |','|---|---|---|'];
  for(const group of state.groups??[])for(const entry of group.cases)lines.push(`| ${group.name} | ${entry.name} | ${entry.status}${entry.failure?` ${JSON.stringify(entry.failure)}`:''} |`);
  lines.push('','## 权限、事务、并发及安全证据','','```json',JSON.stringify(state.evidence??{},null,2),'```',
    '', '## 支持与未执行范围','', '- 本轮为正式 agent_book Schema 与独立 agent_book_meta 迁移账本的真实空库验收，未引用原型执行结果。',
    '- 只支持 Novel 信息范围和独立的新作品创建启动授权；无 Scene/视角/秘密/水位授权。其他三类服务只作身份自检。',
    '- 未执行：模型、Candidate/Design 内容、Canon、投影、生产认证/部署、连接池、规模/性能、完整恢复。逻辑 Canon 边界仅为 0。',
    '- 直接 SQL 权限异常、技术回滚和受控业务拒绝分别验证；只有受控结果提交的拒绝才声称数据库审计持久化。',
    '- 只删除本轮带匹配标签的实例/匿名卷及本轮临时目录，未全局清理 Docker。');
  return `${lines.join('\n')}\n`;
}

export async function main() {
  requireCondition(process.argv.slice(2).length===1&&process.argv[2]==='--isolated','EXPLICIT_ISOLATED_TEST_REQUIRED');
  const runId=randomUUID(),resources=[],state={runId,startedAt:new Date().toISOString(),instances:[]};
  const directory=await mkdtemp(path.join(os.tmpdir(),'agent-book-foundation-'));
  try{
    const before=await protectedFiles(root);await mkdir(path.join(root,'verification/foundation'),{recursive:true});
    const unit=spawnSync(process.execPath,['--test','test/foundation.unit.test.mjs'],{cwd:root,encoding:'utf8',timeout:30000});
    state.unitExit=unit.status;state.unitTests=Number(unit.stdout.match(/# tests (\d+)/)?.[1]??0);
    requireCondition(unit.status===0,'CONTROL_TEST_FAILED');
    const digest=JSON.parse(runFile('docker',['image','inspect',image]))[0];requireCondition(digest.RepoDigests?.includes(imageDigest),'IMAGE_DIGEST_MISMATCH');
    await primary(directory,runId,resources,state);await repeatAndFailMigration(directory,runId,resources,state);
    requireCondition(JSON.stringify(await protectedFiles(root))===JSON.stringify(before),'PROTECTED_FILES_CHANGED');
  }catch(error){state.failureCode=typeof error.code==='string'&&/^[A-Z_]+$/.test(error.code)?error.code:'VERIFICATION_FAILED';}
  finally{
    state.containerCleanup=await cleanup(resources);
    try{await rm(directory,{recursive:true,force:true});state.temporaryCleanup=true;}catch{state.temporaryCleanup=false;}
    state.cleanup=state.containerCleanup&&state.temporaryCleanup;
    try{await writeFile(path.join(root,'verification/foundation/run-result.md'),report(state));state.reportWritten=true;}catch{state.reportWritten=false;}
  }
  const exit=finalExit(state);process.stdout.write(`${JSON.stringify({ok:exit===0,stage:state.failureCode??'completed',topLevel:state.summary?.topLevel??0,subscenarios:state.summary?.subscenarios??0,cleanup:state.cleanup})}\n`);
  process.exitCode=exit;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
