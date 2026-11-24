import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { execFileSync,spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import pg from 'pg';
import { waitForReady } from '../../scripts/run-prototype.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const migration='migrations/001_authorization_safe_context.mjs';
const testFile='test/authorization-safe-context.test.mjs';
for(const name of [migration,testFile]){
  const actual=await readFile(path.join(root,name));const before=await readFile(path.join(here,'before',name));
  if(!actual.equals(before))throw new Error('ORIGINAL_CODE_REQUIRED_BEFORE_REPRODUCTION');
}
const source=(await readFile(path.join(root,testFile),'utf8'))
  .replace("import pg from 'pg';",`import pg from ${JSON.stringify(import.meta.resolve('pg'))};`)
  .replace("import { createToolGateway } from '../lib/tool-gateway.mjs';",`import { createToolGateway } from ${JSON.stringify(new URL('../../lib/tool-gateway.mjs',import.meta.url).href)};`)
  .replace('function scenario(name,fn){test(',"function scenario(name,fn){if(name!=='R 修复前真实复现')return;test(");
const proof=`
scenario('R 修复前真实复现',async t=>{
  await sub(t,'真实写作编译、原始跨项目审计和真实审计员读取',async()=>{
    await compile('writerA');
    const raw=await using('admin',async c=>(await c.query(\`SELECT a.* FROM \${q('access_audit_record')} a JOIN \${q('resource')} rr ON rr.resource_id=a.restricted_resource_id WHERE a.actor_id='writerA' AND a.task_id=$1 AND a.action='retrieval_filter' AND rr.resource_id=$2 AND rr.project_id=$3\`,[task.writerA,resources.rain_B.resource_id,base.B.project])).rows);
    safe(raw.length>0,'real_cross_project_filtered_audit_exists');
    const scope=await using('admin',async c=>(await c.query(\`SELECT * FROM \${q('data_scope')} WHERE scope_id=$1\`,[scopeIds.auditor])).rows[0]);
    const foreign=resources.rain_B;
    const otherChecks=foreign.canon_watermark<=Number(scope.max_canon_watermark)&&scope.resource_classes.includes(foreign.resource_class)&&(foreign.proposition_key===null||scope.allowed_propositions.includes(foreign.proposition_key));
    safe(otherChecks,'other_scope_conditions_allow_counterexample');
    const readerLogin=await using('auditor',async c=>(await c.query('SELECT session_user,current_user')).rows[0]);
    const writerLogin=await using('writerA',async c=>(await c.query('SELECT session_user,current_user')).rows[0]);
    const response=await api('auditor','read_audit',{task_id:task.writerA});safe(response.ok,'real_auditor_api_succeeded');
    const returned=response.events.filter(e=>e.restricted_resource_id===foreign.resource_id).length;
    const rawAfter=await using('admin',async c=>(await c.query(\`SELECT * FROM \${q('access_audit_record')} WHERE audit_id=ANY($1::bigint[]) ORDER BY audit_id\`,[raw.map(e=>e.audit_id)])).rows);
    return JSON.stringify({originalCodeUnchanged:true,originalFixtures:true,writerRealLogin:writerLogin.session_user===prefix+'_writera'&&writerLogin.current_user===writerLogin.session_user,
      auditorRealLogin:readerLogin.session_user===prefix+'_auditor'&&readerLogin.current_user===readerLogin.session_user,crossProjectFilteredAuditRows:raw.length,
      otherWatermarkClassPropositionConditionsPass:otherChecks,auditApiSucceeded:true,crossProjectEventsReturned:returned,
      nestedForeignIdentifierPresent:JSON.stringify(response).includes(foreign.resource_id),originalAuditUnchanged:JSON.stringify(rawAfter)===JSON.stringify(raw)});
  });
});
`;
const temporary=await mkdtemp(path.join(os.tmpdir(),'audit-scope-reproduction-'));
const container=`audit-scope-before-${process.pid}-${Date.now()}`;
const password=randomBytes(24).toString('hex');const prefix=`asc_${randomBytes(6).toString('hex')}`;
const resultsPath=path.join(temporary,'result.json');const testPath=path.join(temporary,'reproduction.test.mjs');
await writeFile(testPath,source+proof);
let migrationExit=null,testExit=null,cleanup=false,evidence=null;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
try{
  docker('run','-d','--rm','--name',container,'-e',`POSTGRES_PASSWORD=${password}`,'-p','127.0.0.1::5432','postgres:18.6','-c','log_error_verbosity=terse','-c','log_min_error_statement=panic','-c','log_parameter_max_length_on_error=0','-c','log_statement=none');
  const port=Number(docker('port',container,'5432/tcp').match(/127\.0\.0\.1:(\d+)/)[1]);await waitForReady({port,password});
  const admin=new pg.Client({connectionString:`postgres://postgres:${password}@127.0.0.1:${port}/postgres`});await admin.connect();
  try{await admin.query('CREATE DATABASE authorization_safe_context');}finally{await admin.end();}
  const env={...process.env,DATABASE_URL:`postgres://postgres:${password}@127.0.0.1:${port}/authorization_safe_context`,PROTOTYPE_ROLE_PREFIX:prefix,PROTOTYPE_RESULTS_PATH:resultsPath,PROTOTYPE_CONTAINER:container};
  migrationExit=spawnSync('pnpm',['run','migrate:up'],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).status;
  if(migrationExit!==0)throw new Error('REPRODUCTION_MIGRATION_FAILED');
  testExit=spawnSync(process.execPath,['--test',testPath],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).status;
  if(testExit!==0)throw new Error('REPRODUCTION_TEST_FAILED');
  const results=JSON.parse(await readFile(resultsPath,'utf8'));evidence=JSON.parse(results.subscenarios[0].evidence);
}finally{
  try{docker('rm','-f',container);cleanup=true;}catch{cleanup=false;}
  await rm(temporary,{recursive:true,force:true});
  const record={migrationSucceeded:migrationExit===0,testSucceeded:testExit===0,...evidence,containerRemoved:cleanup,temporaryResultsRemoved:true};
  const lines=['# 修复前真实复现','','原迁移与原测试文件均先与本轮 before 快照逐字节核对；仅在临时模块中复用原初始化夹具并注册复现场景，原仓库代码未改。全新一次性 PostgreSQL 18.6 实例，角色和数据库均为本轮专属。',
    '',...Object.entries(record).map(([key,value])=>`- ${key}: ${value}`),'',evidence?.nestedForeignIdentifierPresent?'实测结论：缺陷已复现。真实 auditor 读取 A 的审计时返回了 B 的资源标识；其他范围条件满足，原跨项目过滤审计保持不变。':'实测结论：未取得该泄漏路径的成功复现；不得将静态推断当作实测。',
    '', '证据只保留标签、布尔与计数；无资源 ID、canary 或原始审计内容。未覆盖历史 109 场景报告；未修改运行器或工具网关。'];
  await writeFile(path.join(here,'reproduction-before.md'),lines.join('\n')+'\n');
  console.log(JSON.stringify(record));
}
if(migrationExit!==0||testExit!==0||!cleanup)process.exitCode=1;
