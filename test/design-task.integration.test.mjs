import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { executeCommand } from '../src/foundation.mjs';
import { withConnection,inTransaction,connectionOptions } from '../src/database.mjs';
import { initializeNovelReader } from '../scripts/administration.mjs';
import { scanSecrets } from '../scripts/verification-support.mjs';

if(process.env.AB_TEST_MODE!=='1'||!process.env.AB_TEST_MANIFEST)throw new Error('ISOLATED_TEST_CONFIGURATION_REQUIRED');
const manifest=JSON.parse(await readFile(process.env.AB_TEST_MANIFEST,'utf8'));
const groups=[],logs=[],evidence={},outputs=[],secret=`design_private_${randomBytes(24).toString('hex')}`;
const admin=action=>withConnection(manifest.configs.admin,action);
const call=(actor,op,novel,request={})=>executeCommand(manifest.configs[actor],op,{novel_id:novel,request},{logger:r=>logs.push(r)});
const key=()=>randomUUID();
let a,b,sa,sb,ca,cb,location,draft,rev1,rev2,task,v1,v2,rule1,rule2;
let content;
function group(name,action){test(name,{timeout:90000},async t=>{
  const row={name,status:'passed',cases:[]};groups.push(row);
  await action(async(label,fn)=>t.test(label,{timeout:20000},async()=>{
    const item={name:label,status:'passed'};row.cases.push(item);
    try{await fn();}catch(error){item.status='failed';row.status='failed';item.failure={code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CHECK_FAILED',line:Number(error.stack?.match(/design-task.integration.test.mjs:(\d+):/)?.[1]??0)};throw new Error(`CHECK_FAILED: ${label}`);}
  }));
});}
async function ok(promise){const r=await promise;assert.equal(r.ok,true);return r;}
async function denied(promise,error){const r=await promise;assert.equal(r.ok,false);if(error)assert.equal(r.error,error);assert.equal(JSON.stringify(r).includes(secret),false);return r;}
async function dbError(action,code){let e;try{await action();}catch(error){e=error;}assert.equal(e?.code,code);}
async function raw(c,op,novel,request){return (await c.query('SELECT agent_book.api_design_task($1,$2,$3,$4,$5) r',[op,novel,JSON.stringify(request),Array.from({length:128},()=>randomUUID()),randomUUID()])).rows[0].r;}
async function counts(){return admin(async c=>{
  const result={};for(const table of ['design_draft','author_design_revision','design_object_identity','design_object_version','design_to_entity_binding','design_constraint','design_activation','design_head','scene_task','scene_task_version','task_constraint_ref','design_task_request','access_audit_record'])result[table]=(await c.query(`SELECT count(*)::int n FROM agent_book.${table}`)).rows[0].n;
  result.fingerprints={};for(const table of Object.keys(result).filter(k=>k!=='fingerprints'))result.fingerprints[table]=(await c.query(`SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') hash FROM agent_book.${table} t`)).rows[0].hash;
  result.heads=(await c.query('SELECT * FROM agent_book.design_head ORDER BY novel_id')).rows;
  result.tasks=(await c.query('SELECT * FROM agent_book.scene_task ORDER BY scene_task_id')).rows;return result;
});}
async function makeDraft(base=rev1,payload=content){const d=await ok(call('authorA','design:draft',a,{request_key:key(),base_revision_id:base??null}));
  const edited=await ok(call('authorA','design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:1,content:payload}));return {...d,...edited};}
const freezeRequest=(d,current)=>({request_key:key(),draft_id:d.draft_id,expected_edit_version:d.edit_version,expected_current_revision_id:current??null});
const taskRequest=(revision=rev1)=>({request_key:key(),scene_id:sa,revision_id:revision,viewpoint_entity_id:ca,input_canon_watermark:0,goal:`目标 ${secret}`,
  constraint_ids:[revision===rev1?rule1:rule2],budget:{max_input_tokens:8000,max_output_tokens:2000},
  reader_scope:{format_version:'task-reader-v1',mode:'no_disclosure_claim'},compile:{format_version:'scene-task-v1',timeline:'linear',dependencies:'committed_only'}});
async function blocked(observer,waiter,blocker){const end=Date.now()+4500;while(Date.now()<end){
  const r=(await observer.query('SELECT wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=$1',[waiter])).rows[0];
  if(r?.wait_event_type==='Lock'&&r.blockers.includes(blocker))return r;await new Promise(resolve=>setTimeout(resolve,15));}throw new Error('BLOCK_NOT_OBSERVED');}
async function race(first,second,{firstActor='authorA',secondActor='authorA'}={}){
  const clients=await Promise.all([firstActor,secondActor,'admin'].map(async actor=>{const c=new pg.Client(connectionOptions(manifest.configs[actor]));await c.connect();return c;}));
  const [x,y,o]=clients;let pending;
  try{
    const ids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));
    await x.query('BEGIN');await y.query('BEGIN');const one=await first(x);pending=second(y);pending.catch(()=>{});
    const wait=await blocked(o,ids[1],ids[0]);await x.query('COMMIT');const two=await pending;await y.query('COMMIT');
    return {one,two,evidence:{blocker:ids[0],waiter:ids[1],observer:ids[2],wait_event:wait.wait_event,actualBlockerConfirmed:true,release:'COMMIT'}};
  }finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}
}
async function authorGrant(cap,novel=a,actor='authorA'){return admin(async c=>(await c.query(`SELECT g.grant_id FROM agent_book.capability_grant g
  JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) JOIN agent_book.actor_principal p USING(actor_id)
  WHERE ca.capability_key=$1 AND s.novel_id=$2 AND p.db_login=$3 AND NOT EXISTS(SELECT 1 FROM agent_book.grant_revocation x WHERE x.grant_id=g.grant_id)`,[cap,novel,manifest.configs[actor].user])).rows[0].grant_id);}
async function revoke(c,id){return (await c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[id,randomUUID()])).rows[0].r;}
before(async()=>{assert.equal(manifest.mode,'test');});
after(async()=>{await writeFile(process.env.AB_TEST_RESULTS,JSON.stringify({runId:manifest.runId,groups,evidence,logs}));await writeFile(process.env.AB_TEST_RESULTS+'.markers',JSON.stringify([secret]),{mode:0o600});});

group('F 作者结构、草案、冻结与任务正例',async sub=>{
  await sub('真实作者创建结构及 Entity，第二作者独立作品',async()=>{
    const r=await executeCommand(manifest.configs.authorA,'novel:create',{external_key:'design-task-a',title:'设计任务 A'});a=(await ok(Promise.resolve(r))).novel_id;
    b=(await admin(c=>c.query("SELECT novel_id FROM agent_book.novel WHERE external_key='foundation-b'"))).rows[0].novel_id;
    for(const [actor,n]of [['authorA',a],['authorB',b]]){
      const volume=await ok(call(actor,'volume:create',n,{request_key:key(),position:1,title:'卷'}));
      const chapter=await ok(call(actor,'chapter:create',n,{request_key:key(),volume_id:volume.id,position:1,title:'章'}));
      const scene=await ok(call(actor,'scene:create',n,{request_key:key(),chapter_id:chapter.id,position:1,goal:'场景目标'}));
      const character=await ok(call(actor,'entity:create',n,{request_key:key(),entity_type:'character',name:'人物'}));
      if(actor==='authorA'){sa=scene.id;ca=character.id;}else{sb=scene.id;cb=character.id;}
    }
    location=(await ok(call('authorA','entity:create',a,{request_key:key(),entity_type:'location',name:'地点'}))).id;
    await ok(call('authorA','structure:read',a));
    evidence.authorPath={realRestrictedLogin:true,structureAndEntityCreatedThroughAPI:true};
  });
  await sub('可编辑草案：受控预期版本更新，人物与约束归属检查',async()=>{
    content={characters:[{design_key:'hero',entity_id:ca,name:'人物',description:{summary:secret,motivation:'作者意图',traits:['谨慎']}}],
      constraints:[{rule_key:'voice',severity:'hard',scope_kind:'scene',scope_id:sa,rule_text:`保持线索 ${secret}`} ]};
    draft=await makeDraft(null);assert.equal(draft.edit_version,2);
    const history=await ok(call('authorA','design:history',a));assert.ok(history.drafts.some(d=>d.content.characters[0].description.summary===secret));
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:draft.draft_id,expected_edit_version:1,content}),'VERSION_CONFLICT');
  });
  await sub('冻结完整集合并生效，独立受限连接可回读来源关系',async()=>{
    const frozen=await ok(call('authorA','design:freeze',a,freezeRequest(draft,null)));rev1=frozen.revision_id;
    const h=await ok(call('authorA','design:history',a));assert.equal(h.current_revision_id,rev1);assert.equal(h.revisions.length,1);
    assert.equal(h.objects.length,1);assert.equal(h.bindings.length,1);assert.equal(h.constraints.length,1);rule1=h.constraints[0].constraint_id;
    assert.equal(h.bindings[0].entity_id,ca);assert.equal(h.objects[0].revision_id,rev1);
    assert.equal(h.revisions[0].content_hash,createHash('sha256').update(`ab-jsonb-v1:frozen\n${h.revisions[0].canonical_text}`,'utf8').digest('hex'));
  });
  await sub('创建稳定任务与追加版本，当前指针及历史绑定同事务',async()=>{
    const request=taskRequest();const created=await ok(call('authorA','task:create',a,request));task=created.task_id;v1=created.version_id;
    const appended=await ok(call('authorA','task:append',a,{...request,request_key:key(),task_id:task,expected_version_id:v1,goal:'新目标'}));v2=appended.version_id;
    const h=await ok(call('authorA','task:history',a));assert.equal(h.tasks[0].current_version_id,v2);assert.equal(h.versions.length,2);
    for(const v of h.versions){assert.equal(v.author_design_revision_id,rev1);assert.equal(v.input_canon_watermark,0);assert.equal(v.viewpoint_entity_id,ca);
      assert.equal(v.version_hash,createHash('sha256').update(`ab-jsonb-v1:task\n${v.canonical_text}`).digest('hex'));}
    assert.equal(h.constraint_refs.length,2);
    evidence.authorPath.completeThroughAppendedTaskVersion=true;
  });
  await sub('真实 CLI 读许可设计并经过 COMMIT；输出与安全日志分离',async()=>{
    const file=process.env.AB_TEST_RESULTS+'.request';await writeFile(file,'{}',{mode:0o600});
    const r=spawnSync(process.execPath,['src/cli.mjs','design:history',a,file],{env:{...process.env,AB_CONFIG:manifest.configPaths.authorA},encoding:'utf8',timeout:15000});
    assert.equal(r.status,0);assert.ok(JSON.parse(r.stdout).revisions.length);assert.ok(r.stdout.includes(secret));assert.equal(r.stderr.includes(secret),false);outputs.push(r.stderr);
  });
});

group('G 跨作品、类型、范围与权限',async sub=>{
  await sub('独立 author 跨作品读取、编辑、冻结与任务均拒绝且不披露摘要',async()=>{
    for(const [actor,n]of [['authorA',b],['authorB',a]])for(const [op,request]of [['design:history',{}],['task:history',{}],['design:edit',{request_key:key(),draft_id:draft.draft_id,expected_edit_version:2,content}],['design:freeze',freezeRequest(draft,rev1)]]){
      const r=await denied(call(actor,op,n,request),'ACCESS_DENIED');assert.deepEqual(Object.keys(r).sort(),['error','ok']);}
  });
  await sub('writer 元数据正例不等于设计权限；其他服务及审计员无设计入口权',async()=>{
    await initializeNovelReader(manifest.configs.admin,{actorId:manifest.actors.find(x=>x.label==='writerA').actorId,novelId:a});
    await initializeNovelReader(manifest.configs.admin,{actorId:manifest.actors.find(x=>x.label==='auditorA').actorId,novelId:a});
    await ok(executeCommand(manifest.configs.writerA,'novel:read',{novel_id:a}));
    for(const actor of ['writerA','validator','commit','projection','auditorA'])for(const op of ['design:history','task:history'])await denied(call(actor,op,a));
    await dbError(()=>withConnection(manifest.configs.writerA,c=>c.query('SELECT * FROM agent_book.author_design_revision')),'42501');
    await dbError(()=>withConnection(manifest.configs.authorA,c=>c.query("SELECT agent_book._design_task_history('design:history',$1)",[a])),'42501');
  });
  await sub('实际存在的跨 Novel Scene、人物和约束引用分别拒绝',async()=>{
    const d=await makeDraft();
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content:{...content,characters:[{...content.characters[0],entity_id:cb}]}}),'INVALID_REQUEST');
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content:{...content,constraints:[{...content.constraints[0],scope_id:sb}]}}),'INVALID_REQUEST');
    for(const patch of [{scene_id:sb},{viewpoint_entity_id:cb},{viewpoint_entity_id:location}])await denied(call('authorA','task:create',a,{...taskRequest(),...patch}),'INVALID_REQUEST');
  });
  await sub('实际存在的跨作品 Revision 与草案引用拒绝；B 的完整设计正例',async()=>{
    const d=await ok(call('authorB','design:draft',b,{request_key:key(),base_revision_id:null}));
    const payload={characters:[{...content.characters[0],entity_id:cb}],constraints:[{...content.constraints[0],scope_id:sb}]};
    await ok(call('authorB','design:edit',b,{request_key:key(),draft_id:d.draft_id,expected_edit_version:1,content:payload}));
    const r=await ok(call('authorB','design:freeze',b,{...freezeRequest(d,null),expected_edit_version:2}));
    await denied(call('authorA','design:draft',a,{request_key:key(),base_revision_id:r.revision_id}),'INVALID_REQUEST');
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content}),'INVALID_REQUEST');
    await denied(call('authorA','design:freeze',a,{...freezeRequest(d,rev1),expected_edit_version:2}),'INVALID_REQUEST');
  });
  await sub('同 Novel 错 Revision 约束、错误人物类型与结构 FK 独立拒绝',async()=>{
    const d=await makeDraft(rev1,{...content,constraints:[{...content.constraints[0],rule_text:'新版本规则'}]});
    rev2=(await ok(call('authorA','design:freeze',a,freezeRequest(d,rev1)))).revision_id;
    rule2=(await ok(call('authorA','design:history',a))).constraints.find(c=>c.revision_id===rev2).constraint_id;
    await denied(call('authorA','task:create',a,{...taskRequest(rev2),constraint_ids:[rule1]}),'INVALID_REQUEST');
    await denied(call('authorA','task:create',a,taskRequest(rev1)),'DESIGN_NOT_CURRENT');
    const s=await ok(call('authorB','structure:read',b));
    await denied(call('authorA','chapter:create',a,{request_key:key(),volume_id:s.volumes[0].volume_id,position:2,title:'跨作品'}),'INVALID_REQUEST');
    const dv=await makeDraft(rev1);
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:dv.draft_id,expected_edit_version:2,content:{...content,characters:[{...content.characters[0],entity_id:location}]}}),'INVALID_REQUEST');
    evidence.references={foreignNovelScene:true,foreignNovelCharacter:true,nonCharacterViewpoint:true,wrongRevisionConstraint:true,foreignNovelParent:true};
  });
  await sub('数据库复合 FK 直接拒绝错绑（独立于入口参数检查）',async()=>{
    await dbError(()=>admin(c=>c.query("INSERT INTO agent_book.design_object_identity VALUES($1,$2,'wrong-entity','character',$3)",[randomUUID(),a,cb])),'23503');
    await dbError(()=>admin(c=>c.query("INSERT INTO agent_book.design_constraint(constraint_id,novel_id,revision_id,constraint_type,rule_key,severity,rule_text,scope_kind,scene_id) VALUES($1,$2,$3,'author_rule_v1','wrong-scene','hard','规则','scene',$4)",[randomUUID(),a,rev2,sb])),'23503');
    await dbError(()=>admin(c=>c.query('INSERT INTO agent_book.task_constraint_ref VALUES($1,$2,$3,$4)',[a,rev1,v1,rule2])),'23503');
  });
  await sub('请求 actor/role/scope、全知/分支/草稿依赖、非零水位及后续命令拒绝',async()=>{
    for(const patch of [{actor_id:manifest.actors[0].actorId},{role:'author'},{scope:{novel_id:a}}])await denied(call('authorA','task:create',a,{...taskRequest(rev2),...patch}),'INVALID_REQUEST');
    for(const patch of [{input_canon_watermark:1},{viewpoint_entity_id:'omniscient'},{compile:{format_version:'scene-task-v1',timeline:'nonlinear',dependencies:'draft'}},{reader_scope:{format_version:'unknown',mode:'all'}}])await denied(call('authorA','task:create',a,{...taskRequest(rev2),...patch}),'INVALID_REQUEST');
    for(const op of ['bundle:compile','workflow:create','generation:create','candidate:create','validation:run','approval:create','canon:commit'])await denied(call('authorA',op,a,{}),'UNSUPPORTED_OPERATION');
    const d=await makeDraft();await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content:{...content,secrets:[]}}),'INVALID_REQUEST');
    await dbError(()=>withConnection(manifest.configs.writerA,c=>c.query(`SET ROLE "${manifest.owner}"`)),'42501');
    await withConnection(manifest.configs.writerA,async c=>{await c.query("SET agent_book.actor='authorA';SET agent_book.role='author'");await dbError(()=>raw(c,'design:history',a,{}),'42501');});
  });
});

group('H 不可变、历史、摘要与幂等',async sub=>{
  await sub('冻结后编辑拒绝；版本、约束、绑定、归属与 TRUNCATE 拒绝普通 DML',async()=>{
    await denied(call('authorA','design:edit',a,{request_key:key(),draft_id:draft.draft_id,expected_edit_version:2,content}),'VERSION_CONFLICT');
    for(const table of ['author_design_revision','design_object_version','design_to_entity_binding','design_object_identity','design_constraint','design_activation','scene_task_version','task_constraint_ref','design_task_request']){
      await dbError(()=>admin(c=>c.query(`DELETE FROM agent_book.${table}`)),'23514');
      await dbError(()=>admin(c=>c.query(`TRUNCATE agent_book.${table} CASCADE`)),'23514');
    }
    await dbError(()=>admin(c=>c.query('UPDATE agent_book.author_design_revision SET novel_id=$1 WHERE revision_id=$2',[b,rev1])),'23514');
    await dbError(()=>admin(c=>c.query("UPDATE agent_book.design_object_version SET name='改写'")),'23514');
    await dbError(()=>admin(c=>c.query('UPDATE agent_book.design_head SET current_revision_id=$1 WHERE novel_id=$2',[rev1,a])),'23514');
    await dbError(()=>admin(c=>c.query('UPDATE agent_book.scene_task SET current_version_id=$1 WHERE scene_task_id=$2',[v1,task])),'23514');
  });
  await sub('旧 Revision 派生新草案，历史内容与旧任务绑定保持不变',async()=>{
    const h=await ok(call('authorA','design:history',a));assert.equal(h.current_revision_id,rev2);
    const old=h.revisions.find(r=>r.revision_id===rev1);assert.equal(old.content.constraints[0].rule_text,content.constraints[0].rule_text);
    const th=await ok(call('authorA','task:history',a));assert.equal(th.versions.find(v=>v.scene_task_version_id===v1).author_design_revision_id,rev1);
    assert.ok(h.activations.some(x=>x.revision_id===rev2&&x.previous_revision_id===rev1));
    evidence.history={oldRevisionRetained:true,oldTaskBindingRetained:true,currentSeparateFromFrozenContent:true};
  });
  await sub('同键同请求返回原结果；不同请求拒绝，重放不倒退当前指针',async()=>{
    const d=await makeDraft(rev1),request=freezeRequest(d,rev2),f=await ok(call('authorA','design:freeze',a,request));
    const next=await makeDraft(f.revision_id);const newer=await ok(call('authorA','design:freeze',a,freezeRequest(next,f.revision_id)));
    assert.deepEqual(await ok(call('authorA','design:freeze',a,request)),f);
    await denied(call('authorA','design:freeze',a,{...request,expected_edit_version:9}),'IDEMPOTENCY_CONFLICT');
    assert.equal((await ok(call('authorA','design:history',a))).current_revision_id,newer.revision_id);
    const req={request_key:key(),base_revision_id:rev1};assert.deepEqual(await ok(call('authorA','design:draft',a,req)),await ok(call('authorA','design:draft',a,req)));
    rev2=newer.revision_id;rule2=(await ok(call('authorA','design:history',a))).constraints.find(c=>c.revision_id===rev2).constraint_id;
    const tr=taskRequest(rev2),r=await ok(call('authorA','task:create',a,tr));
    const ap={...tr,request_key:key(),task_id:r.task_id,expected_version_id:r.version_id,goal:'幂等追加'};
    const ap1=await ok(call('authorA','task:append',a,ap));assert.deepEqual(await ok(call('authorA','task:append',a,ap)),ap1);
    await denied(call('authorA','task:create',a,{...tr,goal:'异内容'}),'IDEMPOTENCY_CONFLICT');
  });
  await sub('结构与编辑请求重放不重复写入，服务新 UUID 不影响请求摘要',async()=>{
    const vr={request_key:key(),position:9,title:'重放卷'};assert.deepEqual(await ok(call('authorA','volume:create',a,vr)),await ok(call('authorA','volume:create',a,vr)));
    const d=await makeDraft();const er={request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content};
    assert.deepEqual(await ok(call('authorA','design:edit',a,er)),await ok(call('authorA','design:edit',a,er)));
    await denied(call('authorA','design:edit',a,{...er,expected_edit_version:3}),'IDEMPOTENCY_CONFLICT');
  });
  await sub('冻结集合不能在历史 Revision 上追加条目，延后完整性检查拒绝',async()=>{
    await dbError(()=>admin(c=>inTransaction(c,tx=>tx.query("INSERT INTO agent_book.design_constraint(constraint_id,novel_id,revision_id,constraint_type,rule_key,severity,rule_text,scope_kind) VALUES($1,$2,$3,'author_rule_v1','late','hard','晚追加','novel')",[randomUUID(),a,rev1]))),'23514');
  });
  await sub('按原协议独立核验所有持久化摘要，UUID/时间不进入重试请求摘要',async()=>{
    await admin(async c=>{
      const requests=(await c.query('SELECT * FROM agent_book.design_task_request')).rows;
      for(const r of requests){assert.equal(r.digest_spec_version,'ab-jsonb-v1');assert.equal(r.request_hash,createHash('sha256').update(`ab-jsonb-v1:request\n${r.canonical_text}`).digest('hex'));assert.equal(r.canonical_text.includes(r.request_id),false);}
      const revisions=(await c.query('SELECT revision_id,content_hash,canonical_text,agent_book._revision_payload(revision_id)::text actual FROM agent_book.author_design_revision')).rows;
      for(const r of revisions){assert.equal(r.canonical_text,r.actual);assert.equal(r.content_hash,createHash('sha256').update(`ab-jsonb-v1:frozen\n${r.actual}`).digest('hex'));}
      const versions=(await c.query('SELECT version_hash,canonical_text,agent_book._task_payload(scene_task_version_id)::text actual FROM agent_book.scene_task_version')).rows;
      for(const v of versions){assert.equal(v.canonical_text,v.actual);assert.equal(v.version_hash,createHash('sha256').update(`ab-jsonb-v1:task\n${v.actual}`).digest('hex'));}
      evidence.digests={protocol:'ab-jsonb-v1',requestCount:requests.length,frozenCount:revisions.length,taskVersionCount:versions.length,allIndependentlyRehashed:true,actualRelationalPayloadMatched:true};
    });
  });
});

group('I 实际连接竞争与版本前驱',async sub=>{
  await sub('同草案并发编辑：预期版本仅允许一方成功',async()=>{
    const d=await makeDraft();const req={request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content};
    const r=await race(c=>raw(c,'design:edit',a,req),c=>raw(c,'design:edit',a,{...req,request_key:key()}));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');evidence.concurrentEdit=r.evidence;
  });
  await sub('编辑先于冻结：旧编辑号冻结拒绝且没有错配摘要',async()=>{
    const d=await makeDraft();const r=await race(c=>raw(c,'design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content}),c=>raw(c,'design:freeze',a,freezeRequest(d,rev2)));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');evidence.editThenFreeze=r.evidence;
  });
  await sub('冻结先于编辑：旧草案不可再编辑',async()=>{
    const d=await makeDraft();const r=await race(c=>raw(c,'design:freeze',a,freezeRequest(d,rev2)),c=>raw(c,'design:edit',a,{request_key:key(),draft_id:d.draft_id,expected_edit_version:2,content}));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');rev2=r.one.revision_id;
    rule2=(await ok(call('authorA','design:history',a))).constraints.find(c=>c.revision_id===rev2).constraint_id;evidence.freezeThenEdit=r.evidence;
  });
  await sub('两草案竞争当前生效版本：预期当前 Revision 阻止丢失更新',async()=>{
    const d=await makeDraft(),other=await makeDraft();const r=await race(c=>raw(c,'design:freeze',a,freezeRequest(d,rev2)),c=>raw(c,'design:freeze',a,freezeRequest(other,rev2)));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');rev2=r.one.revision_id;
    rule2=(await ok(call('authorA','design:history',a))).constraints.find(c=>c.revision_id===rev2).constraint_id;evidence.competingDrafts=r.evidence;
  });
  await sub('同任务竞争追加：仅一个当前前驱成功',async()=>{
    const created=await ok(call('authorA','task:create',a,taskRequest(rev2)));
    const p={...taskRequest(rev2),task_id:created.task_id,expected_version_id:created.version_id};
    const r=await race(c=>raw(c,'task:append',a,p),c=>raw(c,'task:append',a,{...p,request_key:key(),goal:'另一方'}));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'VERSION_CONFLICT');evidence.competingTaskVersions=r.evidence;
  });
});

group('J 中途与 COMMIT 故障、授权竞争',async sub=>{
  await sub('冻结集合中途故障，全量回滚',async()=>{
    const d=await makeDraft();const before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_design_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'PRIVATE_DESIGN_FAILURE'; END $f$;
      CREATE TRIGGER test_design_fault BEFORE INSERT ON agent_book.design_to_entity_binding FOR EACH ROW EXECUTE FUNCTION agent_book.test_design_fault()`));
    try{await denied(call('authorA','design:freeze',a,freezeRequest(d,rev2)),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_design_fault ON agent_book.design_to_entity_binding;DROP FUNCTION agent_book.test_design_fault()'));}
  });
  await sub('当前指针切换中途故障，全量回滚',async()=>{
    const d=await makeDraft();const before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_head_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'PRIVATE_HEAD_FAILURE'; END $f$;
      CREATE TRIGGER test_head_fault BEFORE UPDATE ON agent_book.design_head FOR EACH ROW EXECUTE FUNCTION agent_book.test_head_fault()`));
    try{await denied(call('authorA','design:freeze',a,freezeRequest(d,rev2)),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_head_fault ON agent_book.design_head;DROP FUNCTION agent_book.test_head_fault()'));}
  });
  await sub('任务追加中途故障，不留版本或部分当前指针',async()=>{
    const created=await ok(call('authorA','task:create',a,taskRequest(rev2)));const before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_task_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'PRIVATE_TASK_FAILURE'; END $f$;
      CREATE TRIGGER test_task_fault BEFORE UPDATE ON agent_book.scene_task FOR EACH ROW EXECUTE FUNCTION agent_book.test_task_fault()`));
    try{await denied(call('authorA','task:append',a,{...taskRequest(rev2),task_id:created.task_id,expected_version_id:created.version_id}),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_task_fault ON agent_book.scene_task;DROP FUNCTION agent_book.test_task_fault()'));}
  });
  await sub('函数已返回后真实 COMMIT 故障；服务不交付成功，完整回滚',async()=>{
    const d=await makeDraft();const before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_design_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRIVATE_COMMIT_FAILURE'; END $f$;
      CREATE CONSTRAINT TRIGGER test_design_commit_fault AFTER INSERT ON agent_book.author_design_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book.test_design_commit_fault()`));
    let returned=false;
    try{await dbError(()=>withConnection(manifest.configs.authorA,c=>inTransaction(c,async tx=>{returned=(await raw(tx,'design:freeze',a,freezeRequest(d,rev2))).ok;})),'23514');
      assert.equal(returned,true);await denied(call('authorA','design:freeze',a,freezeRequest(d,rev2)),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_design_commit_fault ON agent_book.author_design_revision;DROP FUNCTION agent_book.test_design_commit_fault()'));}
    evidence.rollback={midFreeze:true,headSwitch:true,taskAppend:true,realCommitFailure:true,functionReturnedBeforeFailedCommit:true,physicalCountsAndPointersUnchanged:true};
  });
  await sub('任务追加真实 COMMIT 延后故障，历史与当前指针全部回滚',async()=>{
    const created=await ok(call('authorA','task:create',a,taskRequest(rev2))),before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_task_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRIVATE_TASK_COMMIT_FAILURE'; END $f$; CREATE CONSTRAINT TRIGGER test_task_commit_fault AFTER INSERT ON agent_book.scene_task_version DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book.test_task_commit_fault()`));
    try{await denied(call('authorA','task:append',a,{...taskRequest(rev2),task_id:created.task_id,expected_version_id:created.version_id}),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_task_commit_fault ON agent_book.scene_task_version;DROP FUNCTION agent_book.test_task_commit_fault()'));}
    evidence.rollback.taskRealCommitFailure=true;
  });
  await sub('外层回滚不留下冻结内容或成功审计',async()=>{
    const d=await makeDraft();const before=await counts();await withConnection(manifest.configs.authorA,async c=>{await c.query('BEGIN');assert.equal((await raw(c,'design:freeze',a,freezeRequest(d,rev2))).ok,true);assert.deepEqual(await counts(),before);await c.query('ROLLBACK');});assert.deepEqual(await counts(),before);
  });
  await sub('撤销先提交，等待的新增结构命令拒绝',async()=>{
    const id=await authorGrant('structure.manage');const r=await race(c=>revoke(c,id),c=>raw(c,'volume:create',a,{request_key:key(),position:21,title:'撤销后拒绝'}));
    assert.equal(r.one.ok,true);assert.equal(r.two.error,'ACCESS_DENIED');evidence.revokeThenBusiness=r.evidence;
  });
  await sub('新增业务先受保护完成，撤销等待；后续操作与历史重放均拒绝',async()=>{
    const id=await authorGrant('design.edit');const request={request_key:key(),base_revision_id:rev1};
    const r=await race(c=>raw(c,'design:draft',a,request),c=>revoke(c,id));assert.equal(r.one.ok,true);assert.equal(r.two.ok,true);
    await denied(call('authorA','design:draft',a,request),'ACCESS_DENIED');
    const readGrant=await authorGrant('design.read');await ok(executeCommand(manifest.configs.authorA,'grant:revoke',{grant_id:readGrant}));
    await denied(call('authorA','design:history',a),'ACCESS_DENIED');evidence.businessThenRevoke=r.evidence;
  });
});

group('K 数据库安全与输出边界',async sub=>{
  await sub('新增函数所有者、固定路径、PUBLIC/角色 ACL 与底表权限',async()=>{
    await admin(async c=>{
      const functions=(await c.query(`SELECT p.oid,p.proname,p.prosecdef,p.proconfig,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book'`)).rows;
      for(const f of functions){assert.equal(f.owner,manifest.owner);assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog, agent_book, pg_temp']);assert.ok(!f.proname.startsWith('test_'));
        assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid=$1 AND acl.grantee=0 AND acl.privilege_type='EXECUTE'",[f.oid])).rows[0].n,0);
        if(f.proname.startsWith('_')||f.proname==='api_design_task')for(const actor of manifest.actors)assert.equal((await c.query("SELECT has_function_privilege($1::name,$2::oid,'EXECUTE') allowed",[actor.login,f.oid])).rows[0].allowed,f.proname==='api_design_task'&&actor.role==='author');
      }
      const tables=(await c.query("SELECT c.oid,r.rolname owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='agent_book' AND c.relkind='r'")).rows;
      for(const t of tables){assert.equal(t.owner,manifest.owner);for(const actor of manifest.actors)assert.equal((await c.query("SELECT has_table_privilege($1::name,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[actor.login,t.oid])).rows[0].allowed,false);}
      assert.equal((await c.query("SELECT count(*)::int n FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='agent_book' AND NOT convalidated")).rows[0].n,0);
      assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agent_book' AND t.tgenabled<>'O'")).rows[0].n,0);
      evidence.permissions={controlledFunctions:functions.length,ownerOnly:true,publicExecute:0,privateHelperExecute:0,runtimeTablePrivileges:0,unvalidatedConstraints:0,disabledTriggers:0,faultResidue:0};
    });
  });
  await sub('拒绝审计独立连接可读；许可审计不含设计载荷或任意细粒度引用',async()=>{
    const before=await admin(async c=>(await c.query("SELECT count(*)::int n FROM agent_book.access_audit_record WHERE novel_id=$1 AND decision='deny'",[a])).rows[0].n);
    await denied(call('authorB','design:history',a),'ACCESS_DENIED');
    const after=await admin(async c=>(await c.query("SELECT count(*)::int n FROM agent_book.access_audit_record WHERE novel_id=$1 AND decision='deny'",[a])).rows[0].n);assert.equal(after,before+1);
    const response=await ok(executeCommand(manifest.configs.auditorA,'audit:read',{novel_id:a}));assert.equal(JSON.stringify(response).includes(secret),false);
    assert.ok(response.events.every(e=>['none','novel','grant'].includes(e.resource_type)));evidence.audit={independentlyCommittedDenial:true,onlyNovelResourcesForNewOperations:true,noDesignPayload:true};
  });
  await sub('固定日志、嵌套错误、数据库日志与报告扫描零秘密/凭据披露',async()=>{
    const r=spawnSync(process.execPath,['src/cli.mjs','design:freeze',a,secret],{env:{...process.env,AB_CONFIG:manifest.configPaths.writerA},encoding:'utf8',timeout:15000});assert.notEqual(r.status,0);outputs.push(r.stdout,r.stderr);
    for(const log of logs)assert.deepEqual(Object.keys(log),['event','operation','outcome','request_id']);
    const db=spawnSync('docker',['logs',manifest.container],{encoding:'utf8',timeout:10000});assert.equal(db.status,0);
    const markers=[secret,...Object.values(manifest.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])];
    assert.equal(scanSecrets([logs,outputs,groups,evidence,db.stdout,db.stderr],markers),0);
    evidence.disclosure={randomDesignCanaryInternalOnly:true,authorizedReadPositive:true,channelsScanned:['logs','CLI errors','nested denials','database logs','evaluation/report'],markers:markers.length,leaks:0};
  });
});
