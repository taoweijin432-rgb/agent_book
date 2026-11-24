import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validateConfig } from '../src/config.mjs';
import { safeFailure, logRecord } from '../src/safety.mjs';
import { analyzeResults, finalExit, migrationThenTest, waitForReady } from '../scripts/verification-support.mjs';

const config = { mode:'local',host:'127.0.0.1',port:5432,database:'agent_book_local',user:'one_login',password:'test-only',instanceId:randomUUID() };
test('配置必须显式且完整，无隐式管理员或远程回退', () => {
  assert.equal(validateConfig(config).user,'one_login');
  for(const bad of [{...config,password:''},{...config,host:'example.org'},{...config,database:'postgres'},{...config,instanceId:null},{...config,actor:'author'}])assert.throws(()=>validateConfig(bad));
});
test('测试配置只在显式测试选项下接纳',()=>{
  assert.throws(()=>validateConfig({...config,mode:'test'}));
  assert.equal(validateConfig({...config,mode:'test'},{allowTest:true}).mode,'test');
});
test('错误和日志从固定白名单构造',()=>{
  const error=new Error('sensitive exception');error.code='password-in-error';
  assert.deepEqual(safeFailure(error),{ok:false,error:'REQUEST_FAILED'});
  assert.deepEqual(Object.keys(logRecord('identity','allowed')),['event','operation','outcome','request_id']);
});
test('结果必须来自本轮且每一项实际通过',()=>{
  const valid={runId:'run',groups:[{name:'A',status:'passed',cases:[{name:'one',status:'passed'}]}]};
  assert.equal(analyzeResults(valid,'run').allPassed,true);
  assert.throws(()=>analyzeResults(valid,'older'));
  assert.throws(()=>analyzeResults({...valid,groups:[]},'run'));
  assert.equal(analyzeResults({...valid,groups:[{name:'A',status:'passed',cases:[{name:'one',status:'failed'}]}]},'run').allPassed,false);
});
test('测试失败、无效结果及清理失败各自触发真实非零退出',()=>{
  const state={migrationExit:0,testExit:0,resultsValid:true,allPassed:true,cleanup:true,reportWritten:true};
  assert.equal(finalExit(state),0);
  for(const change of [{testExit:1},{resultsValid:false},{allPassed:false},{cleanup:false},{reportWritten:false}]){
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {finalExit} from './scripts/verification-support.mjs'; process.exitCode=finalExit(${JSON.stringify({...state,...change})})`],{encoding:'utf8'});
    assert.equal(child.status,1);
  }
});
test('迁移失败阻断测试启动',async()=>{
  let called=false;const status=await migrationThenTest(async()=>({status:1}),async()=>{called=true;return{status:0};});
  assert.equal(called,false);assert.equal(status.testStarted,false);assert.equal(status.migrationExit,1);
});
test('TCP 连接后查询挂起受统一期限控制且关闭连接',async()=>{
  let closed=0;
  await assert.rejects(waitForReady({}, { timeout:700,clientFactory:()=>({connect:async()=>{},query:()=>new Promise(()=>{}),end:async()=>{closed++;}}) }));
  assert.ok(closed>=1);
});
