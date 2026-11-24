import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { executeCommand } from '../src/foundation.mjs';
import { withConnection,inTransaction,connectionOptions } from '../src/database.mjs';
import { initializeNovelReader } from '../scripts/administration.mjs';
import { createDesignFixture } from './support/design-fixture.mjs';
import { scanSecrets } from '../scripts/verification-support.mjs';
if(process.env.AB_TEST_MODE!=='1'||!process.env.AB_TEST_MANIFEST)throw new Error('ISOLATED_TEST_REQUIRED');
const m=JSON.parse(await readFile(process.env.AB_TEST_MANIFEST));
const groups=[],logs=[],writerOutputs=[],cliErrors=[],evidence={},canary=`ctx_private_${randomBytes(24).toString('hex')}`;
const admin=fn=>withConnection(m.configs.admin,fn),key=()=>randomUUID(),actorId=label=>m.actors.find(a=>a.label===label).actorId;
let a,b,otherTask,otherPov,grantA,grantB,policyA,bundleA,bundleB,compileRequest,rawBundle;
const publications=new Map();
async function call(actor,op,n,request={}){const r=await executeCommand(m.configs[actor],op,{novel_id:n,request},{logger:r=>logs.push(r)});if(actor.startsWith('writer'))writerOutputs.push(r);
  if(r.error==='REQUEST_FAILED'&&(evidence.technicalDiagnostics?.length??0)<5){
    await withConnection(m.configs[actor],async c=>{await c.query('BEGIN');try{await api(c,op,n,request);}catch(e){evidence.technicalDiagnostics??=[];evidence.technicalDiagnostics.push({operation:op,sqlstate:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:'unavailable',functions:[...(e.where??'').matchAll(/function ([a-z_]+)/g)].map(x=>x[1])});}finally{await c.query('ROLLBACK');}});
  }return r;}
async function ok(p){const r=await p;assert.equal(r.ok,true);return r;}
async function denied(p,error){const r=await p;assert.equal(r.ok,false);if(error)assert.equal(r.error,error);assert.equal(JSON.stringify(r).includes(canary),false);return r;}
async function sqlError(fn,codes){let e;try{await fn();}catch(error){e=error;}assert.ok((Array.isArray(codes)?codes:[codes]).includes(e?.code));}
function group(name,fn){test(name,{timeout:90000},async t=>{
  const row={name,status:'passed',cases:[]};groups.push(row);
  await fn(async(label,body)=>t.test(label,{timeout:20000},async()=>{const item={name:label,status:'passed'};row.cases.push(item);
    try{await body();}catch(error){item.status='failed';row.status='failed';item.failure={code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CHECK_FAILED',line:Number(error.stack?.match(/safe-context.integration.test.mjs:(\d+):/)?.[1]??0)};throw new Error(`CHECK_FAILED: ${label}`);}
  }));
});}
const projectionKey=(f,writer,kind,source)=>[f.version,writer,kind,source].join(':');
const sources=f=>[{kind:'constraint',type:'design_constraint',id:f.constraint,text:'遵守本场景的作者硬约束。'},{kind:'constraint',type:'design_constraint',id:f.soft,text:'保持场景节奏。'},
  {kind:'goal',type:'author_design_revision',id:f.revision,text:'围绕眼前行动推进场景，不确认尚未获准的身份。'},{kind:'character',type:'design_object_version',id:f.object,text:'以当前人物可观察的行动展开，保持谨慎语气。'}];
async function authorize(f,writer='writerA',patch={}){return ok(call('authorA','context-grant:create',f.novel,{request_key:key(),task_version_id:f.version,writer_actor_id:actorId(writer),allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null,...patch}));}
async function publish(f,source,writer='writerA',{author='authorA',policy='safe-context-v1',patch={}}={}){
  const slot=projectionKey(f,writer,source.kind,source.id),previous=publications.get(slot)??null;
  const proposal=await ok(call(author,'projection:propose',f.novel,{request_key:key(),task_version_id:f.version,writer_actor_id:actorId(writer),kind:source.kind,source_object_type:source.type,source_object_id:source.id,
    safe_text:source.text,semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:policy,replaces_publication_id:previous,...patch}));
  const pub=await ok(call(author,'projection:publish',f.novel,{request_key:key(),proposal_id:proposal.proposal_id}));publications.set(slot,pub.publication_id);return pub;
}
async function publishAll(f,writer='writerA',options={}){for(const s of sources(f))await publish(f,s,writer,options);}
const compile=(f,writer='writerA',patch={})=>call(writer,'context:compile',f.novel,{request_key:key(),task_version_id:f.version,max_bytes:65536,...patch});
const read=(f,ref,writer='writerA')=>call(writer,'context:read',f.novel,{bundle_ref:ref});
async function api(c,op,n,p){return(await c.query('SELECT agent_book.api_safe_context($1,$2,$3,$4,$5) r',[op,n,JSON.stringify(p),Array.from({length:128},()=>randomUUID()),randomUUID()])).rows[0].r;}
async function revoke(c,g){return(await c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[g,randomUUID()])).rows[0].r;}
async function counts(){return admin(async c=>{const result={};for(const table of ['context_bundle','context_item','context_item_source','context_compilation','evidence_reference','evidence_design_source','context_command_request','context_access_audit'])
  result[table]=(await c.query(`SELECT count(*)::int n FROM agent_book.${table}`)).rows[0].n;return result;});}
async function observe(o,waiter,blocker){const end=Date.now()+4500;while(Date.now()<end){const r=(await o.query('SELECT wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[waiter])).rows[0];
  if(r?.wait_event_type==='Lock'&&r.blockers.includes(blocker))return r;await new Promise(r=>setTimeout(r,15));}throw new Error('BLOCK_NOT_OBSERVED');}
async function race(firstActor,first,secondActor,second){const clients=await Promise.all([firstActor,secondActor,'admin'].map(async actor=>{const c=new pg.Client(connectionOptions(m.configs[actor]));await c.connect();return c;}));
  const [x,y,o]=clients;let pending;try{const pids=await Promise.all(clients.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));
    await x.query('BEGIN');await y.query('BEGIN');const one=await first(x);pending=second(y);pending.catch(()=>{});const wait=await observe(o,pids[1],pids[0]);
    await x.query('COMMIT');const two=await pending;await y.query('COMMIT');return{one,two,evidence:{blocker:pids[0],waiter:pids[1],observer:pids[2],wait_event:wait.wait_event,actualBlockerConfirmed:true,release:'COMMIT'}};
  }finally{for(const c of clients){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}}
async function cloneBundle({missingItem=false,missingSource=false,wrongHash=false,wrongOrder=false,sameOpaque=false}={}){
  return admin(c=>inTransaction(c,async tx=>{
    const old=(await tx.query('SELECT to_jsonb(b) r FROM agent_book.context_bundle b WHERE public_bundle_ref=$1',[bundleA.bundle_ref])).rows[0].r;
    const bid=randomUUID(),copy={...old,context_bundle_id:bid,public_bundle_ref:randomUUID()};if(sameOpaque)copy.public_bundle_ref=bid;if(wrongHash)copy.payload_hash='0'.repeat(64);
    await tx.query('INSERT INTO agent_book.context_bundle SELECT * FROM jsonb_populate_record(NULL::agent_book.context_bundle,$1::jsonb)',[JSON.stringify(copy)]);
    await tx.query('INSERT INTO agent_book.context_compilation VALUES($1,$2,$3,$4)',[randomUUID(),bid,copy.writer_actor_id,key()]);
    const items=(await tx.query('SELECT to_jsonb(i) r FROM agent_book.context_item i WHERE context_bundle_id=$1 ORDER BY position',[old.context_bundle_id])).rows.map(r=>r.r);
    for(const [index,item]of items.entries()){
      if(missingItem&&index===0)continue;const id=randomUUID();const cloned={...item,context_item_id:id,context_bundle_id:bid,position:wrongOrder?items.length-index:item.position};
      await tx.query('INSERT INTO agent_book.context_item SELECT * FROM jsonb_populate_record(NULL::agent_book.context_item,$1::jsonb)',[JSON.stringify(cloned)]);
      if(missingSource&&index===0)continue;
      await tx.query('INSERT INTO agent_book.context_item_source SELECT $1,publication_id,evidence_reference_id FROM agent_book.context_item_source WHERE context_item_id=$2',[id,item.context_item_id]);
    }
  }));
}
after(async()=>{await writeFile(process.env.AB_TEST_RESULTS,JSON.stringify({runId:m.runId,groups,evidence,logs}));await writeFile(process.env.AB_TEST_RESULTS+'.markers',JSON.stringify([canary]),{mode:0o600});});

group('A 正式来源、发布与真实 writer 正例',async sub=>{
  await sub('真实 author 创建两部作品、冻结设计和任务；秘密分布于全部原始输入',async()=>{
    a=await createDesignFixture(m.configs.authorA,'context-a',canary);b=await createDesignFixture(m.configs.authorB,'context-b',canary);
    await initializeNovelReader(m.configs.admin,{actorId:actorId('writerA'),novelId:a.novel});await initializeNovelReader(m.configs.admin,{actorId:actorId('auditorA'),novelId:a.novel});
    const author=await ok(executeCommand(m.configs.authorA,'design:history',{novel_id:a.novel,request:{}}));assert.ok(JSON.stringify(author).includes(canary));
    await denied(compile(a),'ACCESS_DENIED');await denied(call('writerA','design:history',a.novel,{}));
    const grant=await authorize(a);grantA=grant.grant_id;policyA=grant.policy_release_id;
    grantB=(await ok(call('authorB','context-grant:create',b.novel,{request_key:key(),task_version_id:b.version,writer_actor_id:actorId('writerB'),allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}))).grant_id;
  });
  await sub('未发布提案不能进入上下文；正式发布后才允许完整编译',async()=>{
    const s=sources(a)[0];const pending=await ok(call('authorA','projection:propose',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:actorId('writerA'),kind:s.kind,source_object_type:s.type,source_object_id:s.id,safe_text:s.text,semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null}));
    await denied(compile(a),'CONTEXT_UNAVAILABLE');
    const pub=await ok(call('authorA','projection:publish',a.novel,{request_key:key(),proposal_id:pending.proposal_id}));publications.set(projectionKey(a,'writerA',s.kind,s.id),pub.publication_id);
    for(const s of sources(a).slice(1))await publish(a,s);
    compileRequest={request_key:key(),task_version_id:a.version,max_bytes:65536};bundleA=await ok(call('writerA','context:compile',a.novel,compileRequest));
    assert.deepEqual(await ok(read(a,bundleA.bundle_ref)),bundleA);
    const body=JSON.parse(bundleA.payload_text);assert.equal(body.items.length,4);assert.deepEqual(body.items.map(i=>i.kind),['constraint','constraint','goal','character']);
    assert.ok(body.items.some(i=>i.text===sources(a)[2].text));assert.equal(body.semantics,'author_intent_only');
    assert.equal(bundleA.budget.used_bytes,Buffer.byteLength(bundleA.payload_text,'utf8'));assert.equal(bundleA.payload_hash,createHash('sha256').update(bundleA.payload_text).digest('hex'));
    assert.equal(bundleA.budget.real_token_budget_verified,false);assert.equal(bundleA.budget.model_call_admitted,false);assert.equal(bundleA.budget.declared_input_tokens,8000);
    evidence.path={realAuthorPublish:true,realWriterCompileAndRead:true,allFourRequiredItems:true,rawTaskGoalNotCopied:true,actualBytesAndHashVerified:true,tokenBudgetNotClaimed:true};
  });
  await sub('受限来源链可追溯，writer 仅见公开不透明引用与批准文字',async()=>{
    const trace=await ok(call('authorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}));assert.equal(trace.items.length,4);assert.equal(trace.authorization.grant.context_grant_id,grantA);assert.equal(trace.authorization.scope.task_version_id,a.version);rawBundle=trace.bundle;
    for(const item of trace.items){assert.equal(item.item.publication_id,item.publication.publication_id);assert.equal(item.source.evidence_reference_id,item.evidence.evidence_reference_id);assert.equal(item.evidence.source_version_id,a.revision);assert.equal(item.design_source.novel_id,a.novel);}
    const auditTrace=await ok(call('auditorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}));assert.equal(auditTrace.bundle.context_bundle_id,trace.bundle.context_bundle_id);
    const output=JSON.stringify(bundleA);for(const hidden of [a.novel,a.scene,a.character,a.revision,a.object,a.constraint,a.soft,a.version,a.task,grantA,policyA,trace.bundle.context_bundle_id,...trace.items.flatMap(i=>[i.evidence.evidence_reference_id,i.publication.publication_id])])assert.equal(output.includes(hidden),false);
    assert.notEqual(bundleA.bundle_ref,trace.bundle.context_bundle_id);evidence.sources={completeFormalFKChain:true,hiddenSourceIdentifiersAbsent:true,auditorTracePositive:true};
  });
});

group('B 范围隔离、正式 Evidence 和拒绝',async sub=>{
  await sub('父 Evidence 缺支撑拒绝；错 Novel、Revision、类型和父子身份拒绝',async()=>{
    await sqlError(()=>admin(c=>inTransaction(c,tx=>tx.query("INSERT INTO agent_book.evidence_reference VALUES($1,$2,'author_design',$3,'author_design_revision',$3,'whole:v1','author_intent')",[randomUUID(),b.novel,b.revision]))),'23503');
    await sqlError(()=>admin(c=>c.query("INSERT INTO agent_book.evidence_reference VALUES($1,$2,'author_design',$3,'author_design_revision',$3,'whole:v1','author_intent')",[randomUUID(),a.novel,b.revision])),'23503');
    await sqlError(()=>admin(c=>inTransaction(c,async tx=>{const id=randomUUID();await tx.query("INSERT INTO agent_book.evidence_reference VALUES($1,$2,'author_design',$3,'design_object_version',$4,'whole:v1','author_intent')",[id,a.novel,a.revision,b.object]);await tx.query("INSERT INTO agent_book.evidence_design_source VALUES($1,$2,$3,'design_object_version',$4,NULL,$4,NULL)",[id,a.novel,a.revision,b.object]);})),'23503');
    await sqlError(()=>admin(c=>c.query("INSERT INTO agent_book.evidence_reference VALUES($1,$2,'canon',$3,'canon_fact',$4,'whole:v1','author_intent')",[randomUUID(),a.novel,a.revision,a.object])),'23514');
    const first=(await admin(c=>c.query('SELECT * FROM agent_book.evidence_reference LIMIT 1'))).rows[0];
    await sqlError(()=>admin(c=>c.query('INSERT INTO agent_book.evidence_reference VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),first.novel_id,first.source_domain,first.source_version_id,first.source_object_type,first.source_object_id,first.locator,first.evidence_kind])),'23505');
  });
  await sub('第二个 writer 在自己的作品正例；两个作者、作品和 writer 交叉均拒绝',async()=>{
    await publishAll(b,'writerB',{author:'authorB'});bundleB=await ok(compile(b,'writerB'));
    for(const [actor,n,op,p]of [['writerA',b.novel,'context:compile',{request_key:key(),task_version_id:b.version,max_bytes:65536}],['writerB',a.novel,'context:read',{bundle_ref:bundleA.bundle_ref}],['writerA',b.novel,'context:read',{bundle_ref:bundleB.bundle_ref}],['authorB',a.novel,'context:trace',{bundle_ref:bundleA.bundle_ref}],['auditorA',b.novel,'context:trace',{bundle_ref:bundleB.bundle_ref}]])await denied(call(actor,op,n,p),'ACCESS_DENIED');
    await denied(call('authorB','context-grant:create',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:actorId('writerB'),allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}),'ACCESS_DENIED');
  });
  await sub('同 Novel 不同 Scene/人物/Task 的真实引用不能借用当前 Scope',async()=>{
    const write=async(op,p)=>ok(call('authorA',op,a.novel,{request_key:key(),...p}));
    const scene=(await write('scene:create',{chapter_id:a.chapter,position:2,goal:'另一个场景'})).id;
    otherTask=await write('task:create',{...a.taskInput,scene_id:scene,constraint_ids:[]});
    const character=(await write('entity:create',{entity_type:'character',name:'另一人物'})).id;
    otherPov=await write('task:create',{...a.taskInput,viewpoint_entity_id:character,constraint_ids:[]});
    for(const version of [otherTask.version_id,otherPov.version_id])await denied(call('writerA','context:compile',a.novel,{request_key:key(),task_version_id:version,max_bytes:65536}),'ACCESS_DENIED');
    const before=(await counts()).evidence_reference;
    const f={...a,version:otherTask.version_id,soft:null};await authorize(f,'writerB');
    for(const s of sources(f).filter(s=>s.id))await publish(f,s,'writerB');await ok(compile(f,'writerB'));
    assert.equal((await counts()).evidence_reference,before);evidence.evidenceIdentity={sixFieldsUnique:true,consumerExcluded:true,secondTaskAndWriterReuse:true,missingSupportAndForeignRevisionDenied:true};
  });
  await sub('元数据读取不导出上下文；writer 不能发布、读底表或调用内部函数',async()=>{
    await ok(executeCommand(m.configs.writerA,'novel:read',{novel_id:a.novel}));
    for(const table of ['context_bundle','safe_projection_proposal','evidence_reference','scene_task_version'])await sqlError(()=>withConnection(m.configs.writerA,c=>c.query(`SELECT * FROM agent_book.${table}`)),'42501');
    await sqlError(()=>withConnection(m.configs.writerA,c=>c.query('SELECT agent_book._ctx_required($1)',[a.version])),'42501');
    await denied(call('writerA','projection:publish',a.novel,{request_key:key(),proposal_id:randomUUID()}),'ACCESS_DENIED');
    await denied(call('writerA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}),'ACCESS_DENIED');
    await denied(call('authorA','context-grant:create',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:actorId('validator'),allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}),'INVALID_REQUEST');
  });
  await sub('真实错误来源、错 Task、人物类型和客户端秘密/snippet/旧策略参数均拒绝',async()=>{
    const base={request_key:key(),task_version_id:a.version,writer_actor_id:actorId('writerA'),kind:'character',source_object_type:'design_object_version',source_object_id:a.object,safe_text:'批准文字',semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null};
    for(const patch of [{source_object_id:b.object},{source_object_type:'design_constraint',source_object_id:a.constraint},{task_version_id:otherPov.version_id},{policy_version:'unknown'},{semantics:'known_true'},{title:canary},{metadata:{nested:canary}}])await denied(call('authorA','projection:propose',a.novel,{...base,...patch,request_key:key()}),'INVALID_REQUEST');
    for(const patch of [{snippet:canary},{actor_id:actorId('writerB')},{scope:{all:true}},{policy_version:'safe-context-v0'},{safe_text:canary}])await denied(compile(a,'writerA',patch),'INVALID_REQUEST');
    await denied(executeCommand(m.configs.writerA,'bundle:generate',{}),'UNSUPPORTED_OPERATION');
  });
  await sub('缺必需投影、来源范围缺口或字节超限不生成可用半成品',async()=>{
    await denied(compile(a,'writerA',{max_bytes:128}),'CONTEXT_UNAVAILABLE');
    const f={...a,version:otherPov.version_id};await authorize(f);await denied(compile(f),'CONTEXT_UNAVAILABLE');
    const partial=await authorize(a,'writerA',{allow_constraint:false});await denied(compile(a),'CONTEXT_UNAVAILABLE');
    await ok(executeCommand(m.configs.authorA,'grant:revoke',{grant_id:partial.grant_id}));await ok(compile(a));
    evidence.requiredProjection={allApplicableHardRulesRequired:true,taskConstraintRequired:true,unbackedCharacterExcluded:true,byteBudgetRejectsWholeBundle:true};
  });
});

group('C 冻结完整性、幂等与事务',async sub=>{
  await sub('同请求重放返回同一包，异请求拒绝；请求不能插入自定义 Item',async()=>{
    const before=await counts();assert.deepEqual(await ok(call('writerA','context:compile',a.novel,compileRequest)),bundleA);
    assert.equal((await counts()).context_bundle,before.context_bundle);
    await denied(call('writerA','context:compile',a.novel,{...compileRequest,max_bytes:60000}),'IDEMPOTENCY_CONFLICT');
    await denied(compile(a,'writerA',{items:[{text:canary}]}),'INVALID_REQUEST');
  });
  await sub('相同来源的旧发布前驱不能覆盖新发布；相同载荷也须重新编译',async()=>{
    const source=sources(a).find(s=>s.kind==='character'),previous=publications.get(projectionKey(a,'writerA',source.kind,source.id));
    const proposal=await ok(call('authorA','projection:propose',a.novel,{request_key:key(),task_version_id:a.version,writer_actor_id:actorId('writerA'),kind:source.kind,source_object_type:source.type,source_object_id:source.id,safe_text:source.text,semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:previous}));
    await publish(a,source);await denied(call('authorA','projection:publish',a.novel,{request_key:key(),proposal_id:proposal.proposal_id}),'VERSION_CONFLICT');
    const old=bundleA;await denied(read(a,old.bundle_ref),'CONTEXT_UNAVAILABLE');bundleA=await ok(compile(a));assert.equal(old.payload_text,bundleA.payload_text);
    rawBundle=(await ok(call('authorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}))).bundle;
  });
  await sub('缺少未列入任务引用的适用硬约束仍阻断，恢复发布才可重新编译',async()=>{
    const pub=publications.get(projectionKey(a,'writerA','constraint',a.constraint));await ok(call('authorA','projection:revoke',a.novel,{request_key:key(),publication_id:pub}));
    const before=(await counts()).context_bundle;await denied(compile(a),'CONTEXT_UNAVAILABLE');assert.equal((await counts()).context_bundle,before);
    await publish(a,sources(a)[0]);bundleA=await ok(compile(a));rawBundle=(await ok(call('authorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}))).bundle;
  });
  await sub('数据库拒绝缺 Item、缺来源、错误 hash 和错误顺序，独立读取无半成品',async()=>{
    for(const mutation of [{missingItem:true},{missingSource:true},{wrongHash:true},{wrongOrder:true},{sameOpaque:true}]){const before=await counts();await sqlError(()=>cloneBundle(mutation),['23503','23514']);assert.deepEqual(await counts(),before);}
    evidence.integrity={missingItem:true,missingSource:true,wrongHash:true,wrongOrder:true,publicReferenceDistinctFromInternalId:true,independentPhysicalCountsUnchanged:true};
  });
  await sub('Bundle、Item、来源、Evidence、发布和治理历史普通 DML 不可变',async()=>{
    for(const table of ['context_bundle','context_item','context_item_source','context_compilation','evidence_reference','evidence_design_source','safe_projection_proposal','safe_projection_publication','context_task_scope','context_grant','context_policy_release']){
      await sqlError(()=>admin(c=>c.query(`DELETE FROM agent_book.${table}`)),'23514');await sqlError(()=>admin(c=>c.query(`TRUNCATE agent_book.${table} CASCADE`)),'23514');}
    await sqlError(()=>admin(c=>c.query("UPDATE agent_book.context_bundle SET payload_text='changed'")),'23514');
    await sqlError(()=>admin(c=>c.query("UPDATE agent_book.safe_projection_publication SET approved_hash='changed'")),'23514');
    await sqlError(()=>admin(c=>inTransaction(c,async tx=>{
      const first=(await tx.query('SELECT * FROM agent_book.context_item WHERE context_bundle_id=$1 LIMIT 1',[rawBundle.context_bundle_id])).rows[0];
      await tx.query("INSERT INTO agent_book.context_item VALUES($1,$2,5,$3,$4,'required_approved_guidance_v1')",[randomUUID(),rawBundle.context_bundle_id,first.kind,first.publication_id]);
    })),['23505','23514']);
  });
  await sub('编译中途故障和外层回滚不留 Bundle、Item、来源或成功审计',async()=>{
    const before=await counts();await admin(c=>c.query(`CREATE FUNCTION public.ctx_item_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'PRIVATE_ITEM_ERROR'; END $f$;
      CREATE TRIGGER ctx_item_fault BEFORE INSERT ON agent_book.context_item_source FOR EACH ROW EXECUTE FUNCTION public.ctx_item_fault()`));
    try{await denied(compile(a),'REQUEST_FAILED');assert.deepEqual(await counts(),before);}finally{await admin(c=>c.query('DROP TRIGGER ctx_item_fault ON agent_book.context_item_source;DROP FUNCTION public.ctx_item_fault()'));}
    await withConnection(m.configs.writerA,async c=>{await c.query('BEGIN');assert.equal((await api(c,'context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536})).ok,true);assert.deepEqual(await counts(),before);await c.query('ROLLBACK');});assert.deepEqual(await counts(),before);
  });
  await sub('真实 COMMIT 延后故障：函数可返回，服务不能交付可用结果',async()=>{
    const before=await counts();let returned=false;
    await admin(c=>c.query(`CREATE FUNCTION public.ctx_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PRIVATE_CONTEXT_COMMIT'; END $f$;
      CREATE CONSTRAINT TRIGGER ctx_commit_fault AFTER INSERT ON agent_book.context_bundle DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ctx_commit_fault()`));
    try{await sqlError(()=>withConnection(m.configs.writerA,c=>inTransaction(c,async tx=>{returned=(await api(tx,'context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536})).ok;})),'23514');assert.equal(returned,true);
      await denied(compile(a),'REQUEST_FAILED');assert.deepEqual(await counts(),before);
    }finally{await admin(c=>c.query('DROP TRIGGER ctx_commit_fault ON agent_book.context_bundle;DROP FUNCTION public.ctx_commit_fault()'));}
    evidence.atomicity={midItemFailure:true,outerRollback:true,realCommitFailure:true,serviceWaitsForCommit:true,allPhysicalRowsUnchanged:true};
  });
});

group('D 撤销、期限和真实并发',async sub=>{
  await sub('原撤销入口可撤销新授权：撤销先持保护，等待取包拒绝',async()=>{
    const r=await race('authorA',c=>revoke(c,grantA),'writerA',c=>api(c,'context:read',a.novel,{bundle_ref:bundleA.bundle_ref}));assert.equal(r.one.ok,true);assert.equal(r.two.error,'ACCESS_DENIED');
    await denied(call('writerA','context:compile',a.novel,compileRequest),'ACCESS_DENIED');evidence.grantRevokeFirst=r.evidence;
  });
  await sub('编译先受保护完成，撤销等待；下一次取用及旧请求重放拒绝',async()=>{
    grantA=(await authorize(a)).grant_id;const request={request_key:key(),task_version_id:a.version,max_bytes:65536};
    const r=await race('writerA',c=>api(c,'context:compile',a.novel,request),'authorA',c=>revoke(c,grantA));assert.equal(r.one.ok,true);assert.equal(r.two.ok,true);
    await denied(read(a,r.one.bundle_ref),'ACCESS_DENIED');await denied(call('writerA','context:compile',a.novel,request),'ACCESS_DENIED');
    grantA=(await authorize(a)).grant_id;bundleA=await ok(compile(a));rawBundle=(await ok(call('authorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}))).bundle;
    evidence.compileBeforeGrantRevoke=r.evidence;
  });
  await sub('投影撤销先持保护，等待编译拒绝并保留原发布历史',async()=>{
    const pub=publications.get(projectionKey(a,'writerA','goal',a.revision));
    const r=await race('authorA',c=>api(c,'projection:revoke',a.novel,{request_key:key(),publication_id:pub}),'writerA',c=>api(c,'context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536}));assert.equal(r.one.ok,true);assert.equal(r.two.error,'CONTEXT_UNAVAILABLE');
    await denied(read(a,bundleA.bundle_ref),'CONTEXT_UNAVAILABLE');const revokedTrace=await ok(call('auditorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}));assert.ok(revokedTrace.items.some(i=>i.revocation?.publication_id===pub));
    const replacement=await publish(a,sources(a).find(s=>s.kind==='goal'));
    const before=await counts();await sqlError(()=>admin(c=>inTransaction(c,async tx=>{
      const bid=(await tx.query('SELECT context_bundle_id FROM agent_book.context_bundle WHERE public_bundle_ref=$1',[bundleA.bundle_ref])).rows[0].context_bundle_id;
      const id=randomUUID();await tx.query("INSERT INTO agent_book.context_item VALUES($1,$2,5,'goal',$3,'required_approved_guidance_v1')",[id,bid,replacement.publication_id]);
      await tx.query('INSERT INTO agent_book.context_item_source SELECT $1,publication_id,evidence_reference_id FROM agent_book.safe_projection_publication WHERE publication_id=$2',[id,replacement.publication_id]);
    })),'23514');assert.deepEqual(await counts(),before);evidence.integrity.historicalAppendWithNewPublicationDenied=true;
    bundleA=await ok(compile(a));evidence.projectionRevokeFirst=r.evidence;
  });
  await sub('取包先受保护完成，投影撤销等待；下一次取包拒绝',async()=>{
    const pub=publications.get(projectionKey(a,'writerA','character',a.object));
    const r=await race('writerA',c=>api(c,'context:read',a.novel,{bundle_ref:bundleA.bundle_ref}),'authorA',c=>api(c,'projection:revoke',a.novel,{request_key:key(),publication_id:pub}));assert.equal(r.one.ok,true);assert.equal(r.two.ok,true);
    await denied(read(a,bundleA.bundle_ref),'CONTEXT_UNAVAILABLE');await publish(a,sources(a).find(s=>s.kind==='character'));bundleA=await ok(compile(a));evidence.readBeforeProjectionRevoke=r.evidence;
  });
  await sub('等待期间跨过授权期限，观察数据库时间后释放保护仍拒绝',async()=>{
    await ok(executeCommand(m.configs.authorA,'grant:revoke',{grant_id:grantA}));
    const end=await admin(async c=>(await c.query("SELECT (clock_timestamp()+interval '1 second')::text end_at")).rows[0].end_at);
    const grant=await authorize(a,'writerA',{expires_at:end});
    const holder=new pg.Client(connectionOptions(m.configs.admin)),waiter=new pg.Client(connectionOptions(m.configs.writerA)),observer=new pg.Client(connectionOptions(m.configs.admin));let pending;
    try{await holder.connect();await waiter.connect();await observer.connect();await holder.query('BEGIN');await holder.query('SELECT agent_book._lock_authorization()');await waiter.query('BEGIN');
      const hp=(await holder.query('SELECT pg_backend_pid() pid')).rows[0].pid,wp=(await waiter.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      pending=api(waiter,'context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536});pending.catch(()=>{});await observe(observer,wp,hp);
      let seen;const deadline=Date.now()+3500;while(Date.now()<deadline){const r=(await observer.query('SELECT clock_timestamp()>=$1::timestamptz expired,clock_timestamp()::text observed_at',[end])).rows[0];if(r.expired){seen=r.observed_at;break;}await new Promise(r=>setTimeout(r,15));}assert.ok(seen);
      await holder.query('COMMIT');const result=await pending;await waiter.query('COMMIT');
      assert.equal(result.error,'ACCESS_DENIED');
      evidence.expiryAfterLock={blocker:hp,waiter:wp,sourceDeadline:end,databaseObservedAfterDeadline:seen,actualBlockerConfirmed:true,deniedAfterExpiry:true};
    }finally{for(const c of [holder,waiter,observer]){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}
    grantA=(await authorize(a)).grant_id;bundleA=await ok(compile(a));
  });
});

group('E 变更失效、历史审计与范围',async sub=>{
  await sub('策略变化拒绝旧 writer 包；旧来源和历史发布仍可追溯',async()=>{
    const old=bundleA;
    const policy=await ok(call('authorA','context-policy:publish',a.novel,{request_key:key(),task_version_id:a.version,expected_release_id:policyA,policy_version:'safe-context-v2'}));policyA=policy.policy_release_id;
    await denied(read(a,old.bundle_ref),'CONTEXT_UNAVAILABLE');await denied(compile(a),'CONTEXT_UNAVAILABLE');
    await ok(call('authorA','context:trace',a.novel,{bundle_ref:old.bundle_ref}));await ok(call('auditorA','context:trace',a.novel,{bundle_ref:old.bundle_ref}));
    await publishAll(a,'writerA',{policy:'safe-context-v2'});bundleA=await ok(compile(a));assert.equal(bundleA.policy_version,'safe-context-v2');
    await denied(compile(a,'writerA',{policy_version:'safe-context-v1'}),'INVALID_REQUEST');
    evidence.history={policyChangeInvalidatesWriter:true,restrictedHistoryReadable:true,newPublicationRequired:true};
  });
  await sub('任务版本改变后旧输入失效，重新授权和发布才能编译新版本',async()=>{
    const old=bundleA,priorVersion=a.version;
    const appended=await ok(call('authorA','task:append',a.novel,{request_key:key(),...a.taskInput,goal:`new goal ${canary}`,task_id:a.task,expected_version_id:a.version}));
    await denied(read(a,old.bundle_ref),'CONTEXT_UNAVAILABLE');
    await denied(call('writerA','context:compile',a.novel,{request_key:key(),task_version_id:appended.version_id,max_bytes:65536}),'ACCESS_DENIED');
    a={...a,version:appended.version_id};const g=await authorize(a);grantA=g.grant_id;policyA=g.policy_release_id;await publishAll(a);bundleA=await ok(compile(a));
    await ok(call('auditorA','context:trace',a.novel,{bundle_ref:old.bundle_ref}));assert.notEqual(a.version,priorVersion);evidence.history.taskChangeInvalidatesWriter=true;
  });
  await sub('Design 生效版本改变后旧包拒绝；包和原历史任务不改写',async()=>{
    const before=(await admin(c=>c.query('SELECT to_jsonb(b) r FROM agent_book.context_bundle b WHERE public_bundle_ref=$1',[bundleA.bundle_ref]))).rows[0].r;
    const draft=await ok(call('authorA','design:draft',a.novel,{request_key:key(),base_revision_id:a.revision}));
    const current=await ok(call('authorA','design:freeze',a.novel,{request_key:key(),draft_id:draft.draft_id,expected_edit_version:1,expected_current_revision_id:a.revision}));
    await denied(read(a,bundleA.bundle_ref),'CONTEXT_UNAVAILABLE');await denied(compile(a),'CONTEXT_UNAVAILABLE');
    const trace=await ok(call('auditorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}));assert.equal(trace.bundle.revision_id,a.revision);
    assert.deepEqual((await admin(c=>c.query('SELECT to_jsonb(b) r FROM agent_book.context_bundle b WHERE public_bundle_ref=$1',[bundleA.bundle_ref]))).rows[0].r,before);evidence.history.designChangeInvalidatesWriter=true;evidence.history.bundleBytesUnchanged=true;
    const next=await ok(call('authorA','task:append',a.novel,{request_key:key(),...a.taskInput,revision_id:current.revision_id,constraint_ids:[],task_id:a.task,expected_version_id:a.version}));
    const f={...a,version:next.version_id,revision:current.revision_id};await authorize(f);
    await denied(call('authorA','projection:propose',a.novel,{request_key:key(),task_version_id:next.version_id,writer_actor_id:actorId('writerA'),kind:'character',source_object_type:'design_object_version',source_object_id:a.object,safe_text:'旧来源不得冒充新版本',semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null}),'INVALID_REQUEST');
    evidence.sources.sameNovelWrongRevisionRejected=true;
  });
  await sub('审计分别验证记录 Task 与实际资源：跨 Novel 资源与错 Task 事件不返回，合法记录保留',async()=>{
    const bTrace=await ok(call('authorB','context:trace',b.novel,{bundle_ref:bundleB.bundle_ref}));const aTrace=await ok(call('auditorA','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}));
    const foreignPub=bTrace.items[0].publication.publication_id,foreignEvidence=bTrace.items[0].evidence.evidence_reference_id;
    const differentTaskBundle=(await admin(c=>c.query('SELECT context_bundle_id FROM agent_book.context_bundle WHERE novel_id=$1 AND task_version_id=$2 LIMIT 1',[a.novel,otherTask.version_id]))).rows[0].context_bundle_id;
    const ids=Array.from({length:5},()=>randomUUID());
    await admin(async c=>{
      await c.query("INSERT INTO agent_book.context_access_audit(audit_id,actor_id,novel_id,task_version_id,operation,decision,resource_type,resource_publication_id) VALUES($1,$2,$3,$4,'filter','deny','projection',$5)",[ids[0],actorId('authorA'),a.novel,a.version,foreignPub]);
      await c.query("INSERT INTO agent_book.context_access_audit(audit_id,actor_id,novel_id,task_version_id,operation,decision,resource_type,resource_evidence_id) VALUES($1,$2,$3,$4,'filter','deny','evidence',$5)",[ids[1],actorId('authorA'),a.novel,a.version,foreignEvidence]);
      await c.query("INSERT INTO agent_book.context_access_audit(audit_id,actor_id,novel_id,task_version_id,operation,decision,resource_type,resource_bundle_id) VALUES($1,$2,$3,$4,'filter','deny','bundle',$5)",[ids[2],actorId('authorA'),a.novel,a.version,differentTaskBundle]);
      await c.query("INSERT INTO agent_book.context_access_audit(audit_id,actor_id,novel_id,task_version_id,operation,decision,resource_type) VALUES($1,$2,$3,$4,'ordinary','allow','none')",[ids[3],actorId('authorA'),a.novel,a.version]);
      await c.query("INSERT INTO agent_book.context_access_audit(audit_id,actor_id,novel_id,task_version_id,operation,decision,resource_type,resource_bundle_id) VALUES($1,$2,$3,$4,'history','allow','bundle',$5)",[ids[4],actorId('authorA'),a.novel,a.version,aTrace.bundle.context_bundle_id]);
    });
    const snapshot=(await admin(c=>c.query('SELECT to_jsonb(a) r FROM agent_book.context_access_audit a WHERE audit_id=ANY($1::uuid[]) ORDER BY audit_id',[ids]))).rows;
    for(const response of [await ok(call('auditorA','context:audit',a.novel,{})),await ok(executeCommand(m.configs.auditorA,'audit:read',{novel_id:a.novel}))]){
      const all=JSON.stringify(response);for(const forbidden of [...ids.slice(0,3),foreignPub,foreignEvidence,b.novel])assert.equal(all.includes(forbidden),false);
      assert.ok(response.events.some(e=>e.resource_id===differentTaskBundle));assert.ok(response.events.some(e=>e.audit_id===ids[3]));assert.ok(response.events.some(e=>e.audit_id===ids[4]));
    }
    assert.deepEqual((await admin(c=>c.query('SELECT to_jsonb(a) r FROM agent_book.context_access_audit a WHERE audit_id=ANY($1::uuid[]) ORDER BY audit_id',[ids]))).rows,snapshot);
    await denied(call('writerA','context:audit',a.novel,{}),'ACCESS_DENIED');evidence.auditScope={foreignResourcesAndMismatchedTaskEventsFiltered:true,legitimateOtherTaskResourceRetained:true,ordinaryAndLegalHistoryRetained:true,rawAuditReferencesPreserved:true};
  });
  await sub('拒绝审计真实提交，独立连接可读，writer 不可伪造',async()=>{
    const count=()=>admin(async c=>(await c.query("SELECT count(*)::int n FROM agent_book.context_access_audit WHERE actor_id=$1 AND decision='deny'",[actorId('writerB')])).rows[0].n);
    const before=await count();await denied(call('writerB','context:trace',a.novel,{bundle_ref:bundleA.bundle_ref}),'ACCESS_DENIED');assert.equal(await count(),before+1);
    await sqlError(()=>withConnection(m.configs.writerA,c=>c.query("INSERT INTO agent_book.context_access_audit(audit_id,operation,decision,resource_type) VALUES($1,'forged','allow','none')",[randomUUID()])),'42501');
    evidence.denialAudit={independentlyCommitted:true,writerCannotForge:true};
  });
});

group('F 权限元数据、日志及完整输出扫描',async sub=>{
  await sub('新任务授权继承有限作者支撑截止，不因 NULL 请求变为永久授权',async()=>{
    const original=(await admin(c=>c.query(`SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id) JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 AND ca.capability_key='design.freeze'`,[b.novel]))).rows[0].grant_id;
    await ok(executeCommand(m.configs.authorB,'grant:revoke',{grant_id:original}));
    const end=await admin(async c=>{const id=randomUUID();await c.query(`INSERT INTO agent_book.capability_grant SELECT $1,ar.actor_id,ar.role_id,ca.capability_id,s.data_scope_id,clock_timestamp(),clock_timestamp()+interval '3 seconds' FROM agent_book.actor_role ar CROSS JOIN agent_book.capability ca CROSS JOIN agent_book.data_scope s WHERE ar.actor_id=$2 AND ca.capability_key='design.freeze' AND s.novel_id=$3`,[id,actorId('authorB'),b.novel]);return(await c.query('SELECT expires_at::text expiry FROM agent_book.capability_grant WHERE grant_id=$1',[id])).rows[0].expiry;});
    const grant=await ok(call('authorB','context-grant:create',b.novel,{request_key:key(),task_version_id:b.version,writer_actor_id:actorId('writerA'),allow_revision:true,allow_object:true,allow_constraint:true,expires_at:null}));
    const actual=(await admin(c=>c.query('SELECT expires_at::text expiry FROM agent_book.context_grant WHERE context_grant_id=$1',[grant.grant_id]))).rows[0].expiry;assert.equal(actual,end);evidence.delegation={finiteSourceExpiryPreserved:true,missingSourceNeverMeansUnlimited:true};
  });
  await sub('003 后旧命令仍可用；真实角色、函数 ACL、所有者及约束正常',async()=>{
    await ok(executeCommand(m.configs.authorA,'novel:read',{novel_id:a.novel}));await ok(executeCommand(m.configs.writerA,'novel:read',{novel_id:a.novel}));
    await ok(call('authorA','task:history',a.novel,{}));await ok(call('authorA','design:history',a.novel,{}));
    for(const actor of ['validator','commit','projection']){await ok(executeCommand(m.configs[actor],'identity'));await denied(call(actor,'context:audit',a.novel,{}));}
    await admin(async c=>{
      const functions=(await c.query("SELECT p.oid,p.proname,p.prosecdef,p.proconfig,r.rolname owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book'")).rows;
      for(const f of functions){assert.equal(f.owner,m.owner);assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog, agent_book, pg_temp']);
        assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x WHERE p.oid=$1 AND x.grantee=0 AND x.privilege_type='EXECUTE'",[f.oid])).rows[0].n,0);
        for(const actor of m.actors){if(f.proname.startsWith('_ctx_')||f.proname==='api_safe_context')assert.equal((await c.query("SELECT has_function_privilege($1::name,$2::oid,'EXECUTE') allowed",[actor.login,f.oid])).rows[0].allowed,f.proname==='api_safe_context'&&['author','writer','auditor'].includes(actor.role));}
      }
      const tables=(await c.query("SELECT c.oid,r.rolname owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='agent_book' AND c.relkind='r'")).rows;
      for(const t of tables){assert.equal(t.owner,m.owner);for(const actor of m.actors)assert.equal((await c.query("SELECT has_table_privilege($1::name,$2::oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[actor.login,t.oid])).rows[0].allowed,false);}
      const roles=(await c.query('SELECT oid,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=ANY($1::name[])',[m.actors.map(a=>a.login)])).rows;
      for(const r of roles)assert.ok(!r.rolsuper&&!r.rolbypassrls&&!r.rolcreatedb&&!r.rolcreaterole);assert.equal((await c.query('SELECT count(*)::int n FROM pg_auth_members WHERE member=ANY($1::oid[])',[roles.map(r=>r.oid)])).rows[0].n,0);
      assert.equal((await c.query("SELECT count(*)::int n FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='agent_book' AND NOT convalidated")).rows[0].n,0);
      assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agent_book' AND t.tgenabled<>'O'")).rows[0].n,0);
      assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'ctx_%'")).rows[0].n,0);
      evidence.databasePermissions={controlledFunctions:functions.length,publicExecute:0,privateHelperExecute:0,runtimeBasePrivileges:0,highPrivilegeMemberships:0,allOwnedByNoLoginOwner:true,unvalidatedConstraints:0,disabledTriggers:0,faultFacilities:0};
    });
  });
  await sub('随机秘密、受限来源标识、嵌套错误、CLI 和日志全通道扫描',async()=>{
    const file=process.env.AB_TEST_RESULTS+'.request';await writeFile(file,JSON.stringify({bundle_ref:bundleB.bundle_ref,metadata:{path:canary,title:canary}}),{mode:0o600});
    const result=spawnSync(process.execPath,['src/cli.mjs','context:read',a.novel,file],{env:{...process.env,AB_CONFIG:m.configPaths.writerA},encoding:'utf8',timeout:15000});assert.notEqual(result.status,0);cliErrors.push(result.stdout,result.stderr);
    for(const row of logs)assert.deepEqual(Object.keys(row),['event','operation','outcome','request_id']);
    const db=spawnSync('docker',['logs',m.container],{encoding:'utf8',timeout:10000});assert.equal(db.status,0);
    const markers=[canary,...Object.values(m.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`])];
    assert.equal(scanSecrets([writerOutputs,logs,cliErrors,groups,evidence,db.stdout,db.stderr],markers),0);
    for(const r of writerOutputs)if(r.ok&&r.payload_text){assert.equal(JSON.stringify(r).includes('source_object_id'),false);assert.equal(JSON.stringify(r).includes('evidence_reference_id'),false);}
    evidence.disclosure={randomCanaryNeverPrinted:true,rawGoalNameMotivationRulesTitlesCovered:true,completeNestedWriterResponses:writerOutputs.length,defaultLogRecords:logs.length,credentialAndSecretLeaks:0,naturalLanguageInferenceNotClaimed:true};
  });
});
