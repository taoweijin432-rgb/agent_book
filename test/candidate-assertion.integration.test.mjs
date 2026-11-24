import {spawnSync} from 'node:child_process';
import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';
import {executeCommand} from '../src/foundation.mjs';import {connectionOptions,withConnection} from '../src/database.mjs';import {createValidationFixture} from './support/validation-fixture.mjs';import {createGenerationFixture} from './support/generation-fixture.mjs';import {createApprovalFixture} from './support/approval-fixture.mjs';import {initializeNovelReader} from '../scripts/administration.mjs';import {scanSecrets} from '../scripts/verification-support.mjs';
if(process.env.AB_TEST_MODE!=='1'||!process.env.AB_TEST_MANIFEST)throw new Error('ISOLATED_TEST_REQUIRED');
const m=JSON.parse(await readFile(process.env.AB_TEST_MANIFEST)),key=()=>randomUUID(),secret='assertion_secret_'+randomBytes(20).toString('hex'),marker='assertion_body_'+randomBytes(20).toString('hex'),body=marker+'\r\n中文😀e\u0301\n尾',groups=[],logs=[],errors=[],audits=[],evidence={failures:[],races:[]},admin=fn=>withConnection(m.configs.admin,fn);
const tables=['narrative_assertion','narrative_assertion_candidate_source','evidence_reference','evidence_candidate_source','narrative_assertion_evidence','assertion_command_request','assertion_access_audit'];let a,b,registered;
function group(name,fn){test(name,{timeout:180000},async t=>{const g={name,status:'passed',cases:[]};groups.push(g);await fn(async(label,body)=>t.test(label,{timeout:35000},async()=>{const c={name:label,status:'passed'};g.cases.push(c);try{await body();}catch(e){g.status=c.status='failed';c.failure={code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'CHECK_FAILED',line:Number(e.stack?.match(/candidate-assertion.integration.test.mjs:(\d+):/)?.[1]??0)};throw new Error('CHECK_FAILED '+label);}}));});}
async function call(who,op,n,p={}){const r=await executeCommand(m.configs[who],op,{novel_id:n,request:p},{logger:x=>logs.push(x),generationRuntime:{executorConfig:m.executor}});if(!r.ok)errors.push(r);if(who.startsWith('auditor'))audits.push(r);return r;}
async function ok(p){const r=await p;assert.equal(r.ok,true);return r;}async function deny(p,code){const r=await p;assert.equal(r.ok,false);if(code)assert.equal(r.error,code);return r;}
const locator=(start,end)=>({format:'utf8-byte-range-v1',start,end}),request=(f,content='人工陈述',start=0,end=Buffer.byteLength(body),quote=body)=>({request_key:key(),workflow_ref:f.workflow,candidate_ref:f.candidate,assertion_type:'narrated_claim_v1',content,locator:locator(start,end),quote});
const register=(f,p=request(f))=>call(f.author,'assertion:register',f.novel,p),history=f=>call(f.author,'assertion:history',f.novel,{workflow_ref:f.workflow,candidate_ref:f.candidate});
const raw=(c,op,n,p)=>c.query('SELECT agent_book.api_candidate_assertion($1,$2,$3,$4,$5) r',[op,n,JSON.stringify(p),Array.from({length:16},key),key()]).then(x=>x.rows[0].r);
async function snapshot(){return admin(async c=>{const result={};for(const table of tables)result[table]=(await c.query(`SELECT to_jsonb(t) r FROM agent_book.${table} t ORDER BY to_jsonb(t)::text`)).rows;return result;});}
async function rejected(label,fn,codes,stage='statement',constraint){let error;try{await fn();}catch(e){error=e;}evidence.failures.push({label,stage,sqlstate:error?.code??'NO_FAILURE',constraint:error?.constraint??null});assert.ok((Array.isArray(codes)?codes:[codes]).includes(error?.code));if(constraint)assert.equal(error.constraint,constraint);return error;}
async function transactionFailure(label,action,codes,stage='commit',constraint){const before=await snapshot();await rejected(label,()=>admin(async c=>{await c.query('BEGIN');try{await action(c);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}}),codes,stage,constraint);assert.deepEqual(await snapshot(),before);}
async function bodyFor(f){return (await ok(call(f.writer,'workflow:read',f.novel,{workflow_ref:f.workflow}))).candidates.find(x=>x.candidate_ref===f.candidate).body;}
async function directEvidence(c,f,{id=key(),type='candidate_version',object=f.candidate,loc='utf8-byte-range-v1:10:12',kind='candidate_text_v1',support=true,source={}}={}){
 await c.query('INSERT INTO agent_book.evidence_reference VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,f.novel,'candidate',f.candidate,type,object,loc,kind]);
 if(support)await c.query('INSERT INTO agent_book.evidence_candidate_source VALUES($1,$2,$3,$4,$5,$6,$7)',[id,source.novel??f.novel,source.workflow??f.workflow,source.candidate??f.candidate,source.type??type,source.object??object,Object.hasOwn(source,'assertion')?source.assertion:(type==='narrative_assertion'?object:null)]);return id;
}
async function cloneAssertion(c,changes={},support=true,link=true){
 let row=(await c.query('SELECT to_jsonb(a) r FROM agent_book.narrative_assertion a WHERE assertion_id=$1',[registered.assertion_ref])).rows[0].r;
 row={...row,assertion_id:key(),assertion_text:'new-'+key(),...changes};
 if(!Object.hasOwn(changes,'assertion_hash'))row.assertion_hash=(await c.query("SELECT agent_book._na_hash('content',agent_book._na_payload(jsonb_populate_record(NULL::agent_book.narrative_assertion,$1::jsonb))) h",[JSON.stringify(row)])).rows[0].h;
 await c.query('INSERT INTO agent_book.narrative_assertion SELECT (jsonb_populate_record(NULL::agent_book.narrative_assertion,$1::jsonb)).*',[JSON.stringify(row)]);
 if(support)await c.query('INSERT INTO agent_book.narrative_assertion_candidate_source VALUES($1,$2,$3,$4,$4)',[row.assertion_id,row.novel_id,row.workflow_run_id,row.candidate_version_id]);
 if(link)await c.query('INSERT INTO agent_book.narrative_assertion_evidence VALUES($1,$2,$3)',[row.assertion_id,registered.evidence_ref,registered.text_evidence_ref]);return row;
}
async function observe(c,waiter,blocker){const end=Date.now()+4500;while(Date.now()<end){const row=(await c.query('SELECT wait_event_type,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE pid=$1',[waiter])).rows[0];if(row?.wait_event_type==='Lock'&&row.blockers.includes(blocker))return;await new Promise(r=>setTimeout(r,15));}throw new Error('BLOCK_NOT_OBSERVED');}
async function race(config1,one,config2,two,{rollback=false}={}){const cs=await Promise.all([config1,config2,m.configs.admin].map(async config=>{const c=new pg.Client(connectionOptions(config));await c.connect();return c;}));const[x,y,o]=cs;let pending;try{const pids=await Promise.all(cs.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await y.query('BEGIN');const first=await one(x);pending=two(y);pending.catch(()=>{});await observe(o,pids[1],pids[0]);await x.query(rollback?'ROLLBACK':'COMMIT');const second=await pending;await y.query('COMMIT');const proof={blocker:pids[0],waiter:pids[1],observer:pids[2],actualBlockingConfirmed:true,firstRollback:rollback};evidence.races.push(proof);return{first,second};}finally{for(const c of cs){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}}
after(async()=>{await writeFile(process.env.AB_TEST_RESULTS,JSON.stringify({runId:m.runId,groups,evidence,logs}));await writeFile(process.env.AB_TEST_RESULTS+'.markers',JSON.stringify([secret,marker]),{mode:0o600});});

group('A 真实人工登记、权限及来源',async sub=>{
 await sub('真实 author 人工 Candidate 原子登记并独立回读两类 Evidence 与来源链',async()=>{
  a=await createValidationFixture(m.configs,m.actors,{label:'assertion-a',secret,body});b=await createValidationFixture(m.configs,m.actors,{label:'assertion-b',author:'authorB',writer:'writerB',secret,body});registered=await ok(register(a));
  const h=await ok(history(a));assert.equal(h.assertions.length,1);assert.equal(h.evidence.length,2);assert.equal(h.approval_coverage,'excluded');assert.equal(h.semantic_verification,'not_performed');
  const row=h.assertions[0];assert.equal(row.quote_text,body);assert.equal(row.extractor_version,'human-curation-v1');assert.equal(row.candidate_source.source_version_id,a.candidate);assert.equal(row.source_content_hash,createHash('sha256').update(body).digest('hex'));
  await admin(async c=>{assert.equal((await c.query('SELECT count(*)::int n FROM agent_book.narrative_assertion WHERE assertion_id=$1',[registered.assertion_ref])).rows[0].n,1);assert.equal((await c.query('SELECT count(*)::int n FROM agent_book.evidence_reference WHERE source_domain=$1 AND source_version_id=$2',['candidate',a.candidate])).rows[0].n,2);});evidence.realAuthor={atomicChain:true,independentConnection:true,noSemanticTruth:true};
 });
 for(const who of['writerA','writerB','validator','commit','projection'])await sub(who+' 无新 API 或底表权限',async()=>{await deny(call(who,'assertion:register',a.novel,request(a)));await rejected(who+' helper',()=>withConnection(m.configs[who],c=>c.query('SELECT agent_book._na_history(c) FROM agent_book.candidate_version c')),'42501');});
 await sub('同角色跨 Novel author 拒绝读和登记；同 Novel 错 Workflow 拒绝',async()=>{
  await deny(call('authorB','assertion:register',a.novel,request(a)),'ACCESS_DENIED');await deny(call('authorB','assertion:history',a.novel,{workflow_ref:a.workflow,candidate_ref:a.candidate}),'ACCESS_DENIED');
  await deny(register(a,{...request(a),candidate_ref:b.candidate}),'ACCESS_DENIED');
  const second=await ok(call(a.writer,'workflow:create',a.novel,{request_key:key(),writing_grant_id:a.writing,bundle_ref:a.bundle,execution_mode:'manual_input_v1'}));await deny(register(a,{...request(a),workflow_ref:second.workflow_ref}),'ACCESS_DENIED');
 });
 await sub('测试生成及人工编辑继承测试来源都可登记，未伪造额外调用',async()=>{
  const f=await createGenerationFixture(m.configs,m.actors,{label:'assertion-generated',secret,body});const g=await ok(call(f.writer,'generation:execute',f.novel,{request_key:key(),workflow_ref:f.workflow,expected_selection_version:0,adapter_id:'fixed-test-v1',parameters:{protocol:'test-parameters-v1',max_output_bytes:4096}}));f.candidate=g.candidate_ref;
  const actual=await bodyFor(f);await ok(register(f,request(f,'生成正文人工整理',0,Buffer.byteLength(actual),actual)));assert.equal((await ok(history(f))).test_only,true);
  const edit=await ok(call(f.writer,'candidate:edit',f.novel,{request_key:key(),workflow_ref:f.workflow,previous_candidate_ref:f.candidate,body}));f.candidate=edit.candidate_ref;await ok(register(f));assert.equal((await ok(history(f))).test_only,true);
  const tr=await ok(call(f.author,'generation:trace',f.novel,{workflow_ref:f.workflow}));assert.equal(tr.runs.length,1);evidence.generation={actualCall:true,humanEditKeepsTestOrigin:true,noExtraGeneration:true};
 });
 await sub('writer 撤销后登记和重放拒绝，author 历史仍可读',async()=>{const f=await createValidationFixture(m.configs,m.actors,{label:'assertion-stale',secret,body});const p=request(f);await ok(register(f,p));await ok(executeCommand(m.configs[f.author],'grant:revoke',{grant_id:f.writing}));await deny(register(f,request(f)),'INPUT_STALE');await deny(register(f,p),'INPUT_STALE');assert.equal((await ok(history(f))).assertions.length,1);});
});

group('B 精确 UTF-8、摘要与范围',async sub=>{
 for(const [label,text]of [['中文','中文'],['emoji','😀'],['组合字符','e\u0301'],['CRLF','\r\n'],['LF','\n']])await sub(label+' 精确字节引用',async()=>{const bytes=Buffer.from(body),lo=bytes.indexOf(Buffer.from(text)),hi=lo+Buffer.byteLength(text);const r=await ok(register(a,request(a,label,lo,hi,text)));const row=(await ok(history(a))).assertions.find(x=>x.assertion_id===r.assertion_ref);assert.equal(row.quote_text,text);assert.equal(row.start_byte,lo);assert.equal(row.end_byte,hi);const payload=await admin(async c=>(await c.query("SELECT agent_book._na_payload(a)::text p FROM agent_book.narrative_assertion a WHERE assertion_id=$1",[r.assertion_ref])).rows[0].p);const digest=createHash('sha256').update('assertion-jsonb-v1:content\n'+payload,'utf8').digest('hex');assert.equal(row.assertion_hash,digest);});
 const chineseStart=Buffer.from(body).indexOf(Buffer.from('中文')),emojiStart=Buffer.from(body).indexOf(Buffer.from('😀'));
 for(const[label,lo,hi,q]of [['空区间',0,0,''],['越界',0,Buffer.byteLength(body)+1,body],['负数',-1,1,'x'],['中文起始截断',chineseStart+1,chineseStart+3,'中'],['emoji结束截断',emojiStart,emojiStart+3,'😀'],['错误引用',0,1,'z'],['换行规范化',0,Buffer.byteLength(body),body.replace('\r\n','\n')],['Unicode规范化',0,Buffer.byteLength(body),body.normalize('NFC')]])await sub(label+' 不留部分记录',async()=>{const before=await snapshot();await deny(register(a,request(a,'bad',lo,hi,q)),'INVALID_REQUEST');const after=await snapshot();for(const t of tables.filter(x=>x!=='assertion_access_audit'))assert.deepEqual(after[t],before[t]);});
 await sub('未知类型、确认/Canon/模型标志、消费方、客户端hash均拒绝',async()=>{
  for(const extra of[{assertion_type:'candidate_fact_proposal'},{confirmed:true},{canon:true},{extractor_version:'model-v1'},{consumer_id:key()},{source_content_hash:'0'.repeat(64)}])await deny(register(a,{...request(a),...extra}),'INVALID_REQUEST');
  await deny(register(a,{...request(a),content:'\uD800'}),'INVALID_REQUEST');
 });
});

group('C 完整性、六字段去重及不可变',async sub=>{
 await sub('完整身份去重与不同合法 locator，消费方不在身份内',async()=>{
  const p=request(a,'同内容重复'),r1=await ok(register(a,p)),r2=await ok(register(a,{...p,request_key:key()})),r3=await ok(register(a,p));assert.equal(r1.assertion_ref,r2.assertion_ref);assert.equal(r1.evidence_ref,r3.evidence_ref);
  const direct={request_key:key(),workflow_ref:a.workflow,candidate_ref:a.candidate,locator:locator(0,1),quote:body.slice(0,1)};
  const e1=await ok(call(a.author,'candidate-evidence:register',a.novel,direct)),e2=await ok(call(a.author,'candidate-evidence:register',a.novel,{...direct,request_key:key()})),e3=await ok(call(a.author,'candidate-evidence:register',a.novel,{...direct,request_key:key(),locator:locator(0,2),quote:body.slice(0,2)}));assert.equal(e1.evidence_ref,e2.evidence_ref);assert.notEqual(e1.evidence_ref,e3.evidence_ref);await deny(register(a,{...p,content:'different'}),'IDEMPOTENCY_CONFLICT');
  const links=(await ok(history(a))).assertions.filter(x=>x.start_byte===0&&x.end_byte===Buffer.byteLength(body));assert.ok(links.length>1);assert.equal(new Set(links.map(x=>x.evidence_link.text_evidence_id)).size,1);evidence.dedup={sixFields:true,differentLocator:true,consumerSharing:true};
 });
 await sub('无支撑 Evidence 在真实 COMMIT 拒绝',()=>transactionFailure('missing evidence support',c=>directEvidence(c,a,{support:false}), '23514','commit','evidence_source_complete'));
 await sub('Assertion 缺支撑及缺 Evidence 关联在 COMMIT 拒绝',async()=>{await transactionFailure('missing assertion support',c=>cloneAssertion(c,{},false,false),'23503','commit','assertion_source_required');await transactionFailure('missing assertion link',c=>cloneAssertion(c,{},true,false),'23503','commit','assertion_evidence_required');});
 await sub('类型与对象 ID 各自不一致在实际 FK 拒绝',async()=>{
  // Cross-table UUID equality is legal. Hold object/version/Novel/Workflow identical and change only type.
  const collision=await withConnection(m.configs.authorA,async c=>{const ids=Array.from({length:16},key);ids[0]=a.candidate;return(await c.query('SELECT agent_book.api_candidate_assertion($1,$2,$3,$4,$5) r',['assertion:register',a.novel,JSON.stringify(request(a,'同ID不同类型')),ids,key()])).rows[0].r;});assert.equal(collision.ok,true);assert.equal(collision.assertion_ref,a.candidate);
  await transactionFailure('wrong type only',c=>directEvidence(c,a,{type:'narrative_assertion',object:a.candidate,kind:'narrative_assertion_v1',loc:'utf8-byte-range-v1:11:13',source:{type:'candidate_version',object:a.candidate,assertion:null}}),'23503','statement','evidence_candidate_parent');
  // Both assertion targets really belong to the same Candidate; only the actual object ID disagrees.
  await transactionFailure('wrong object only',c=>directEvidence(c,a,{type:'narrative_assertion',object:registered.assertion_ref,kind:'narrative_assertion_v1',loc:'utf8-byte-range-v1:12:14',source:{object:collision.assertion_ref,assertion:collision.assertion_ref}}),'23503','statement','evidence_candidate_parent');
 });
 await sub('双支撑保持总数规则及类型专属 FK，不可冒用 Design',async()=>{
  await transactionFailure('double support',async c=>{await c.query('INSERT INTO agent_book.evidence_design_source VALUES($1,$2,$3,$4,$5,$5,NULL,NULL)',[registered.text_evidence_ref,a.novel,a.revision,'author_design_revision',a.revision]);},'23503','statement');
  const indexes=await admin(c=>c.query("SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='agent_book.evidence_reference'::regclass AND contype='u'"));assert.ok(indexes.rows.some(x=>x.d.includes('source_domain, source_version_id, source_object_type, source_object_id, locator, evidence_kind')));
 });
 await sub('真实但不对应本断言的关联在 COMMIT 拒绝',()=>transactionFailure('wrong evidence association',c=>cloneAssertion(c),'23514','commit','assertion_source_complete'));
 await sub('Candidate Evidence 越界或非码点边界在 COMMIT 拒绝',async()=>{
  const off=Buffer.from(body).indexOf(Buffer.from('😀'));
  for(const loc of ['utf8-byte-range-v1:0:262144','utf8-byte-range-v1:'+off+':'+(off+3)])await transactionFailure('invalid evidence range',c=>directEvidence(c,a,{loc}),'23514','commit','evidence_source_complete');
 });
 await sub('错误正文hash及断言hash在插入时拒绝',async()=>{await transactionFailure('wrong body hash',c=>cloneAssertion(c,{source_content_hash:'0'.repeat(64)}),'23514','statement','assertion_content_integrity');await transactionFailure('wrong assertion hash',c=>cloneAssertion(c,{assertion_hash:'0'.repeat(64)}),'23514','statement','assertion_content_integrity');});
 await sub('跨 Novel/Workflow/Candidate 真实引用均有约束拒绝',async()=>{
  await transactionFailure('wrong workflow',c=>cloneAssertion(c,{workflow_run_id:b.workflow}),'23503','statement','assertion_candidate_owner');
  await transactionFailure('wrong novel',c=>cloneAssertion(c,{novel_id:b.novel}),'23503','statement','assertion_candidate_owner');
  await transactionFailure('wrong assertion candidate',c=>directEvidence(c,b,{type:'narrative_assertion',object:registered.assertion_ref,kind:'narrative_assertion_v1'}),'23503','statement','evidence_assertion_owner');
 });
 await sub('非法 locator/kind 及 Canon/Tool/未实现子类型直接 SQL 拒绝',async()=>{
  for(const opts of[{type:'candidate_event'},{kind:'author_intent'},{loc:'whole:v1'}])await transactionFailure('unsupported evidence',c=>directEvidence(c,a,opts),'23514','statement','evidence_supported_shape');
  for(const domain of['canon','tool'])await transactionFailure(domain+' unsupported',c=>c.query('INSERT INTO agent_book.evidence_reference VALUES($1,$2,$3,$4,$5,$4,$6,$7)',[key(),a.novel,domain,a.candidate,'candidate_version','utf8-byte-range-v1:0:1','candidate_text_v1']),'23514','statement','evidence_supported_shape');
 });
 await sub('所有新增历史表 UPDATE/DELETE/TRUNCATE 以及底表/helper防绕过',async()=>{
  for(const table of tables.filter(t=>t!=='evidence_reference')){for(const op of ['UPDATE','DELETE','TRUNCATE']){const statement=op==='UPDATE'?`UPDATE agent_book.${table} SET `+(table==='narrative_assertion'?'assertion_text=assertion_text':table==='assertion_access_audit'?'operation=operation':table==='assertion_command_request'?'request_key=request_key':table==='evidence_candidate_source'?'source_object_id=source_object_id':'assertion_id=assertion_id'):op==='DELETE'?`DELETE FROM agent_book.${table}`:`TRUNCATE agent_book.${table} CASCADE`;await rejected(table+' '+op,()=>admin(c=>c.query(statement)),op==='TRUNCATE'?['23514','0A000']:['23514'],'statement');}
   await rejected(table+' runtime',()=>withConnection(m.configs.authorA,c=>c.query(`SELECT * FROM agent_book.${table}`)),'42501');}
  await rejected('internal execute',()=>withConnection(m.configs.authorA,c=>c.query("SELECT agent_book._na_evidence_valid($1)",[registered.evidence_ref])),'42501');
 });
});

group('D 原子提交和真实竞争',async sub=>{
 await sub('外层回滚无 Assertion/Evidence/请求/成功审计',async()=>{const before=await snapshot();await withConnection(m.configs.authorA,async c=>{await c.query('BEGIN');assert.equal((await raw(c,'assertion:register',a.novel,request(a,'rollback'))).ok,true);await c.query('ROLLBACK');});assert.deepEqual(await snapshot(),before);evidence.outerRollback=true;});
 await sub('中途故障由子事务回滚，仅保留真实拒绝审计',async()=>{
  const before=await snapshot();await admin(c=>c.query("CREATE FUNCTION public.assertion_mid_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TEST_MID_FAILURE';END $f$;CREATE TRIGGER test_mid BEFORE INSERT ON agent_book.narrative_assertion_evidence FOR EACH ROW EXECUTE FUNCTION public.assertion_mid_fault()"));
  try{await deny(register(a,request(a,'mid-fault')),'INVALID_REQUEST');}finally{await admin(c=>c.query('DROP TRIGGER test_mid ON agent_book.narrative_assertion_evidence;DROP FUNCTION public.assertion_mid_fault()'));}
  const after=await snapshot();for(const t of tables.filter(x=>x!=='assertion_access_audit'))assert.deepEqual(after[t],before[t]);assert.equal(after.assertion_access_audit.length,before.assertion_access_audit.length+1);evidence.midFault={noPartial:true,denialPersisted:true};
 });
 await sub('真实 COMMIT 延后故障全量回滚',async()=>{
  await admin(c=>c.query("CREATE FUNCTION public.assertion_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TEST_COMMIT_FAILURE',CONSTRAINT='test_commit';END $f$;CREATE CONSTRAINT TRIGGER test_commit AFTER INSERT ON agent_book.assertion_command_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.assertion_commit_fault()"));
  try{const before=await snapshot();await rejected('real author COMMIT',()=>withConnection(m.configs.authorA,async c=>{await c.query('BEGIN');assert.equal((await raw(c,'assertion:register',a.novel,request(a,'commit-fault'))).ok,true);await c.query('COMMIT');}),'23514','commit','test_commit');assert.deepEqual(await snapshot(),before);await deny(register(a,request(a,'service-commit-fault')),'REQUEST_FAILED');assert.deepEqual(await snapshot(),before);evidence.realCommit={sqlstate:'23514',constraint:'test_commit',noSuccessDelivered:true,allRowsRolledBack:true};}
  finally{await admin(c=>c.query('DROP TRIGGER test_commit ON agent_book.assertion_command_request;DROP FUNCTION public.assertion_commit_fault()'));}
 });
 for(const rollback of[false,true])await sub('同身份唯一索引等待，先行事务'+(rollback?'回滚':'提交'),async()=>{
  const loc=rollback?[3,5]:[2,4];const insert=c=>c.query('SELECT agent_book._na_evidence(v,$2,$3,$4,$5,$6) id FROM agent_book.candidate_version v WHERE candidate_version_id=$1',[a.candidate,'candidate_version',a.candidate,...loc,key()]).then(x=>x.rows[0].id);
  const r=await race(m.configs.admin,insert,m.configs.admin,insert,{rollback});if(!rollback)assert.equal(r.first,r.second);else assert.notEqual(r.first,r.second);
  await admin(async c=>{assert.equal((await c.query('SELECT count(*)::int n FROM agent_book.evidence_reference WHERE source_version_id=$1 AND locator=$2',[a.candidate,'utf8-byte-range-v1:'+loc.join(':')])).rows[0].n,1);});
 });
 for(const rollback of[false,true])await sub('真实 author 同断言身份竞争，先行'+(rollback?'回滚':'提交'),async()=>{
  const p=request(a,'same-author-identity-'+key());const r=await race(m.configs.authorA,c=>raw(c,'assertion:register',a.novel,p),m.configs.authorA,c=>raw(c,'assertion:register',a.novel,{...p,request_key:key()}),{rollback});assert.equal(r.first.ok,true);assert.equal(r.second.ok,true);if(rollback)assert.notEqual(r.first.assertion_ref,r.second.assertion_ref);else assert.equal(r.first.assertion_ref,r.second.assertion_ref);
  assert.equal((await ok(history(a))).assertions.filter(x=>x.assertion_text===p.content).length,1);
 });
 await sub('同 Candidate 不同合法 Evidence 不争容器，首次异步 COMMIT 都成功',async()=>{
  const cs=await Promise.all([1,2].map(()=>new pg.Client(connectionOptions(m.configs.admin))));try{await Promise.all(cs.map(c=>c.connect()));await Promise.all(cs.map(c=>c.query('BEGIN')));await Promise.all(cs.map((c,i)=>c.query('SELECT agent_book._na_evidence(v,$2,$3,$4,$5,$6) FROM agent_book.candidate_version v WHERE candidate_version_id=$1',[a.candidate,'candidate_version',a.candidate,6+i,8+i,key()])));await Promise.all(cs.map(c=>c.query('COMMIT')));evidence.differentEvidenceFirstCommit=true;}finally{await Promise.all(cs.map(c=>c.end()));}
 });
 await sub('同 Candidate 不同断言真实作者并发，均首次成功',async()=>{const r=await race(m.configs.authorA,c=>raw(c,'assertion:register',a.novel,request(a,'concurrent-first')),m.configs.authorA,c=>raw(c,'assertion:register',a.novel,request(a,'concurrent-second')));assert.equal(r.first.ok,true);assert.equal(r.second.ok,true);assert.notEqual(r.first.assertion_ref,r.second.assertion_ref);});
 await sub('授权 gate 等待跨截止后用数据库时间拒绝登记',async()=>{
  const f=await createValidationFixture(m.configs,m.actors,{label:'assertion-expiry',secret,body});
  const deadline=(await admin(c=>c.query("SELECT (clock_timestamp()+interval '1800 milliseconds')::text t"))).rows[0].t;
  const grant=await ok(call(f.author,'writing-grant:create',f.novel,{request_key:key(),context_grant_id:f.contextGrant,expires_at:deadline}));
  const w=await ok(call(f.writer,'workflow:create',f.novel,{request_key:key(),writing_grant_id:grant.grant_id,bundle_ref:f.bundle,execution_mode:'manual_input_v1'}));f.workflow=w.workflow_ref;
  const ca=await ok(call(f.writer,'candidate:input',f.novel,{request_key:key(),workflow_ref:f.workflow,body}));f.candidate=ca.candidate_ref;
  const cs=await Promise.all([m.configs.authorA,m.configs.authorA,m.configs.admin].map(async cfg=>{const c=new pg.Client(connectionOptions(cfg));await c.connect();return c;}));const [x,y,o]=cs;let pending;
  try{const pids=await Promise.all(cs.map(async c=>(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid));await x.query('BEGIN');await y.query('BEGIN');assert.equal((await raw(x,'assertion:history',f.novel,{workflow_ref:f.workflow,candidate_ref:f.candidate})).ok,true);pending=raw(y,'assertion:register',f.novel,request(f));pending.catch(()=>{});await observe(o,pids[1],pids[0]);
   let observed;const end=Date.now()+5000;while(Date.now()<end){const row=(await o.query('SELECT clock_timestamp()::text t,clock_timestamp()>=$1::timestamptz expired',[deadline])).rows[0];if(row.expired){observed=row.t;break;}await new Promise(r=>setTimeout(r,15));}assert.ok(observed);await x.query('COMMIT');const r=await pending;assert.equal(r.error,'INPUT_STALE');await y.query('COMMIT');assert.equal((await ok(history(f))).assertions.length,0);evidence.expiryWait={deadline,observed,blocker:pids[0],waiter:pids[1],actualBlockingConfirmed:true,noPartial:true};
  }finally{for(const c of cs){await c.query('ROLLBACK');await c.end();}if(pending)await pending.catch(()=>{});}
 });
 await sub('撤销先行拒绝；登记先行可完成，下一次拒绝',async()=>{
  for(const revokeFirst of[true,false]){const f=await createValidationFixture(m.configs,m.actors,{label:'assertion-revoke',secret,body}),rev=c=>c.query('SELECT agent_book.api_revoke_grant($1,$2) r',[f.writing,key()]).then(x=>x.rows[0].r),write=c=>raw(c,'assertion:register',f.novel,request(f));const r=await race(m.configs.authorA,revokeFirst?rev:write,m.configs.authorA,revokeFirst?write:rev);assert.equal(r.first.ok,true);assert.equal(r.second.ok,!revokeFirst);await deny(register(f,request(f)),'INPUT_STALE');assert.equal((await ok(history(f))).assertions.length,revokeFirst?0:1);}
 });
});

group('E 旧协议、Design 消费边界及审计',async sub=>{
 await sub('追加断言不改变旧审阅精确字节、校验和审批；不扩展覆盖',async()=>{
  const f=await createApprovalFixture(m.configs,m.actors,{label:'assertion-approval',secret,body});const review=await ok(call(f.author,'approval:review',f.novel,{request_key:key(),workflow_ref:f.workflow}));const approved=await ok(call(f.author,'approval:approve',f.novel,{request_key:key(),workflow_ref:f.workflow,review_ref:review.review_ref,expected_decision_version:0,review_hash:review.review_hash,confirmed_soft_constraint_ids:review.review.required_soft_confirmation}));assert.equal(approved.currently_usable,true);
  const before=await admin(async c=>(await c.query('SELECT agent_book._ap_payload(r)::text p FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].p);await ok(register(f));
  const after=await admin(async c=>(await c.query('SELECT agent_book._ap_payload(r)::text p FROM agent_book.approval_review r WHERE review_id=$1',[review.review_ref])).rows[0].p);assert.equal(before,after);assert.equal((await ok(call(f.author,'approval:current',f.novel,{workflow_ref:f.workflow}))).currently_usable,true);assert.equal((await ok(call(f.author,'validation:current',f.novel,{validation_ref:f.validation}))).overall,'passed');evidence.legacyReview={exactBytes:true,approvalUnchanged:true,assertionsExcluded:true};
 });
 await sub('旧 Design Evidence/投影/Bundle 仍只接受 Design，不摄入 Candidate',async()=>{
  const old=await ok(call(a.writer,'context:read',a.novel,{bundle_ref:a.bundle}));const compiled=await ok(call(a.writer,'context:compile',a.novel,{request_key:key(),task_version_id:a.version,max_bytes:65536}));assert.equal(compiled.payload_text,old.payload_text);
  await admin(async c=>{assert.equal((await c.query("SELECT count(*)::int n FROM agent_book.context_item_source s JOIN agent_book.evidence_reference e USING(evidence_reference_id) WHERE e.source_domain<>'author_design'")).rows[0].n,0);assert.equal((await c.query('SELECT bool_and(agent_book._na_evidence_valid(evidence_reference_id)) valid FROM agent_book.evidence_reference')).rows[0].valid,true);});evidence.designConsumptionUnchanged=true;
 });
 await sub('跨域 UUID 碰撞也不能让 Candidate Evidence 进入旧 Context 审计',async()=>{
  const collision=await withConnection(m.configs.writerA,async c=>{const ids=Array.from({length:16},key);ids[0]=a.revision;return(await c.query('SELECT agent_book.api_manual_workflow($1,$2,$3,$4,$5) r',['candidate:input',a.novel,JSON.stringify({request_key:key(),workflow_ref:a.workflow,body}),ids,key()])).rows[0].r;});assert.equal(collision.ok,true);
  const ev=await ok(call(a.author,'candidate-evidence:register',a.novel,{request_key:key(),workflow_ref:a.workflow,candidate_ref:collision.candidate_ref,locator:locator(0,1),quote:body.slice(0,1)}));const audit=key();
  await admin(async c=>{await c.query("INSERT INTO agent_book.context_access_audit VALUES($1,$2,$3,$4,'integrity_fixture','allow','evidence',NULL,NULL,NULL,$5,NULL,clock_timestamp())",[audit,m.actors.find(x=>x.label==='authorA').actorId,a.novel,a.version,ev.evidence_ref]);const row=(await c.query('SELECT agent_book._ctx_resource_visible(a,$2) visible FROM agent_book.context_access_audit a WHERE audit_id=$1',[audit,a.novel])).rows[0];assert.equal(row.visible,false);assert.equal((await c.query('SELECT count(*)::int n FROM agent_book.context_access_audit WHERE audit_id=$1',[audit])).rows[0].n,1);});evidence.contextDomainCollisionFiltered=true;
 });
 await sub('auditor 仅元数据且跨 Novel/错 Task/错 Workflow 事件整体过滤，原审计保留',async()=>{
  await initializeNovelReader(m.configs.admin,{actorId:m.actors.find(x=>x.label==='auditorA').actorId,novelId:a.novel});const hidden=[];
  await admin(async c=>{for(const overrides of[{candidate:b.candidate},{task:b.version},{workflow:b.workflow},{assertion:(await ok(register(b))).assertion_ref}]){const id=key();hidden.push(id);await c.query('INSERT INTO agent_book.assertion_access_audit VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp())',[id,m.actors.find(x=>x.label==='authorA').actorId,a.novel,overrides.task??a.version,overrides.workflow??a.workflow,overrides.candidate??a.candidate,'integrity_fixture','allow',overrides.assertion??registered.assertion_ref,registered.evidence_ref]);}});
  const r=await ok(call('auditorA','assertion:audit',a.novel,{}));const serialized=JSON.stringify(r);for(const id of hidden)assert.equal(serialized.includes(id),false);assert.ok(r.events.some(x=>x.assertion_ref===registered.assertion_ref));assert.equal(scanSecrets([r],[marker,secret,'人工陈述']),0);
  const generic=await executeCommand(m.configs.auditorA,'audit:read',{novel_id:a.novel});audits.push(generic);for(const id of hidden)assert.equal(JSON.stringify(generic).includes(id),false);await deny(call('auditorA','assertion:history',a.novel,{workflow_ref:a.workflow,candidate_ref:a.candidate}),'ACCESS_DENIED');await deny(call('writerA','assertion:audit',a.novel,{}));
  await admin(async c=>assert.equal((await c.query('SELECT count(*)::int n FROM agent_book.assertion_access_audit WHERE audit_id=ANY($1)',[hidden])).rows[0].n,hidden.length));evidence.audit={nestedScopeChecks:true,originalReferencesRetained:true,noContent:true};
 });
});

group('F 身份、函数路径、无残留及披露',async sub=>{
 await sub('默认 search_path 的受限 author 正例、固定函数所有者/ACL/路径',async()=>{
  await withConnection(m.configs.authorA,async c=>{const who=(await c.query('SELECT session_user,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=session_user')).rows[0];assert.equal(who.session_user,m.configs.authorA.user);for(const k of['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole'])assert.equal(who[k],false);assert.equal((await raw(c,'assertion:history',a.novel,{workflow_ref:a.workflow,candidate_ref:a.candidate})).ok,true);});
  await admin(async c=>{const rows=(await c.query("SELECT p.proname,p.prosecdef,p.proconfig,r.rolname owner,r.rolcanlogin,EXISTS(SELECT 1 FROM aclexplode(p.proacl) x WHERE x.grantee=0 AND x.privilege_type='EXECUTE') public_execute FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner WHERE ns.nspname='agent_book' AND(p.proname LIKE '_na_%' OR p.proname='api_candidate_assertion')")).rows;assert.ok(rows.length>10);for(const r of rows){assert.equal(r.prosecdef,true);assert.equal(r.owner,m.owner);assert.equal(r.rolcanlogin,false);assert.ok(r.proconfig.includes('search_path=pg_catalog, agent_book, pg_temp'));assert.equal(r.public_execute,false);}
   for(const actor of [...Object.values(m.configs).filter(x=>!['postgres',m.configs.migrator.user].includes(x.user)),m.executor]){for(const table of tables)assert.equal((await c.query("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') p",[actor.user,'agent_book.'+table])).rows[0].p,false);assert.equal((await c.query('SELECT count(*)::int n FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=$1)',[actor.user])).rows[0].n,0);}
  });evidence.acl={realLogins:true,noTableAccess:true,noRoleMembership:true,fixedOwnerAndPath:true,noPublicExecute:true};
 });
 await sub('真实 CLI author 查询成功，writer CLI 拒绝且错误无受保护内容',async()=>{
  const file=process.env.AB_TEST_RESULTS+'.cli-request';await writeFile(file,JSON.stringify({workflow_ref:a.workflow,candidate_ref:a.candidate}),{mode:0o600});
  const run=who=>spawnSync(process.execPath,['src/cli.mjs','assertion:history',a.novel,file],{env:{...process.env,AB_CONFIG:m.configPaths[who]},encoding:'utf8',timeout:10000});
  const author=run(a.author),writer=run(a.writer);assert.equal(author.status,0);assert.ok(JSON.parse(author.stdout).assertions.some(x=>x.quote_text.includes(marker)));assert.equal(writer.status,1);assert.equal(JSON.parse(writer.stdout).ok,false);assert.equal(scanSecrets([author.stderr,writer.stderr,writer.stdout],[secret,marker]),0);errors.push(JSON.parse(writer.stdout));for(const line of (author.stderr+'\n'+writer.stderr).split('\n').filter(Boolean))logs.push(JSON.parse(line));evidence.cli={realAuthorAllowed:true,writerDenied:true,noErrorOrLogDisclosure:true};
 });
 await sub('故障设施均移除，约束与来源触发器未禁用',async()=>{await admin(async c=>{assert.equal((await c.query("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('test_mid','test_commit') OR (tgrelid IN(SELECT oid FROM pg_class WHERE relnamespace='agent_book'::regnamespace) AND tgenabled='D')")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'assertion_%_fault'")).rows[0].n,0);assert.equal((await c.query("SELECT count(*)::int n FROM pg_constraint WHERE connamespace='agent_book'::regnamespace AND NOT convalidated")).rows[0].n,0);});evidence.noFaultFacilities=true;});
 await sub('默认日志、错误与auditor嵌套扫描，合法author读取仍保留正文片段',async()=>{const h=await ok(history(a));assert.equal(h.assertions.some(x=>x.quote_text.includes(marker)),true);assert.equal(scanSecrets([logs,errors,audits],[secret,marker]),0);assert.ok(logs.every(x=>Object.keys(x).every(k=>['event','operation','outcome','request_id'].includes(k))));evidence.disclosure={leaks:0,protectedAuthorReadPositive:true,rawSqlAndPayloadNotLogged:true};});
});
