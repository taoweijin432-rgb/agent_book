import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { executeCommand } from '../src/foundation.mjs';
import { withConnection, inTransaction, connectionOptions } from '../src/database.mjs';
import { initializeNovelReader, quote } from '../scripts/administration.mjs';
import { scanSecrets } from '../scripts/verification-support.mjs';
import pg from 'pg';

if (process.env.AB_TEST_MODE !== '1' || !process.env.AB_TEST_MANIFEST) throw new Error('ISOLATED_TEST_CONFIGURATION_REQUIRED');
const manifest = JSON.parse(await readFile(process.env.AB_TEST_MANIFEST, 'utf8'));
const groups = [], logs = [], cliOutputs = [], evidence = {};
let novelA, novelB, writerGrant, auditorGrant;
const admin = action => withConnection(manifest.configs.admin, action);
const call = (actor, operation, input = {}) => executeCommand(manifest.configs[actor], operation, input, { logger: row => logs.push(row) });
const actorId = label => manifest.actors.find(actor => actor.label === label).actorId;

function group(name, action) {
  test(name, { timeout: 60000 }, async t => {
    const row = { name, status: 'passed', cases: [] }; groups.push(row);
    const sub = async (label, fn) => t.test(label, { timeout: 15000 }, async () => {
      const item = { name: label, status: 'passed' }; row.cases.push(item);
      try { await fn(); } catch (error) { item.status = 'failed'; row.status = 'failed'; item.failure={code:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CHECK_FAILED',line:Number(error.stack?.match(/foundation\.integration\.test\.mjs:(\d+):/)?.[1]??0)};throw new Error(`CHECK_FAILED: ${label}`); }
    });
    await action(sub);
  });
}
async function denied(promise) { const response = await promise; assert.equal(response.ok, false); return response; }
async function sqlError(action, code) {
  let error; try { await action(); } catch (caught) { error = caught; }
  assert.equal(error?.code, code);
  evidence.databaseRejections ??= {};evidence.databaseRejections[code]=(evidence.databaseRejections[code]??0)+1;
  return error;
}
async function begin(client) { await client.query('BEGIN ISOLATION LEVEL READ COMMITTED'); }
async function clientFor(label) { const client = new pg.Client(connectionOptions(manifest.configs[label])); await client.connect(); return client; }
async function close(client) { if (client) { await client.query('ROLLBACK'); await client.end(); } }
async function api(client, endpoint, args) {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
  return (await client.query(`SELECT agent_book.${endpoint}(${placeholders}) AS result`, args)).rows[0].result;
}
async function counts() {
  return admin(async c => {
    const result = {};
    for (const table of ['novel','data_scope','capability_grant','grant_revocation','access_audit_record']) {
      result[table] = (await c.query(`SELECT count(*)::int AS n FROM agent_book.${table}`)).rows[0].n;
    }
    return result;
  });
}
async function grant(label, novel, { expired = false, milliseconds = null } = {}) {
  if (!expired && milliseconds === null) return (await initializeNovelReader(manifest.configs.admin, { actorId: actorId(label), novelId: novel })).grant_id;
  return admin(async c => {
    const id = randomUUID();
    await c.query(`INSERT INTO agent_book.capability_grant(grant_id,actor_id,role_id,capability_id,data_scope_id,effective_at,expires_at)
      SELECT $1,ar.actor_id,ar.role_id,cap.capability_id,s.data_scope_id,
        clock_timestamp() - interval '2 seconds',
        CASE WHEN $4::boolean THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+$5::integer*interval '1 millisecond' END
      FROM agent_book.actor_role ar CROSS JOIN agent_book.capability cap CROSS JOIN agent_book.data_scope s
      WHERE ar.actor_id=$2 AND cap.capability_key='novel.read' AND s.novel_id=$3`, [id,actorId(label),novel,expired,milliseconds]);
    return id;
  });
}
async function blocked(observer, waiter, blocker) {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const row = (await observer.query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
      FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waiter])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.includes(blocker)) return row;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('EXPECTED_BLOCK_NOT_OBSERVED');
}
async function race({ firstActor, first, secondActor, second }) {
  const a = await clientFor(firstActor), b = await clientFor(secondActor), observer = await clientFor('admin');
  let pending;
  try {
    const pidA = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const pidO = (await observer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await begin(a); await begin(b);
    const firstResult = await first(a);
    pending = second(b); pending.catch(() => {});
    const waiting = await blocked(observer, pidB, pidA);
    await a.query('COMMIT'); const secondResult = await pending; await b.query('COMMIT');
    return { firstResult, secondResult, evidence: { blocker: pidA, waiter: pidB, observer: pidO,
      wait_event: waiting.wait_event, actualBlockerConfirmed: true, release: 'COMMIT' } };
  } finally { await close(a); await close(b); await close(observer); if (pending) await pending.catch(() => {}); }
}

before(async () => { assert.equal(manifest.mode, 'test'); assert.ok(manifest.runId); });
after(async () => {
  await writeFile(process.env.AB_TEST_RESULTS, JSON.stringify({ runId: manifest.runId, groups, evidence, logs }, null, 2));
});

group('A 正式身份与作品正反例', async sub => {
  await sub('真实 author CLI 创建返回后已完成 COMMIT，独立连接可读', async () => {
    const result = spawnSync(process.execPath, ['src/cli.mjs','novel:create','foundation-a','作品 A'], {
      env: { ...process.env, AB_CONFIG: manifest.configPaths.authorA }, encoding: 'utf8', timeout: 15000 });
    cliOutputs.push(result.stdout, result.stderr); assert.equal(result.status, 0);
    const response = JSON.parse(result.stdout); assert.equal(response.ok, true); novelA = response.novel_id;
    assert.equal(response.canon_watermark, 0); assert.equal(response.canon_status, 'not_implemented');
    assert.equal((await admin(c => c.query('SELECT count(*)::int AS n FROM agent_book.novel WHERE novel_id=$1', [novelA]))).rows[0].n, 1);
    assert.equal((await call('authorA','novel:read',{ novel_id: novelA })).ok, true);
  });
  await sub('独立 author B 创建第二作品，跨作品授权拒绝', async () => {
    const response = await call('authorB','novel:create',{ external_key: 'foundation-b', title: '作品 B' });
    assert.equal(response.ok, true); novelB = response.novel_id; assert.notEqual(novelA, novelB);
    await denied(call('authorA','novel:read',{ novel_id: novelB }));
    await denied(call('authorB','novel:read',{ novel_id: novelA }));
  });
  await sub('受信初始化登记 writer/auditor 最小范围；真实 writer 读取成功', async () => {
    writerGrant = await grant('writerA',novelA); auditorGrant = await grant('auditorA',novelA);
    await grant('writerB',novelB); await grant('auditorB',novelB);
    assert.equal((await call('writerA','novel:read',{ novel_id: novelA })).ok, true);
    await denied(call('writerA','novel:read',{ novel_id: novelB }));
    await denied(call('writerB','novel:read',{ novel_id: novelA }));
  });
  for (const label of ['authorA','writerA','auditorA','validator','commit','projection']) await sub(`真实 ${label} 身份自检来自 session_user`, async () => {
    const response = await call(label,'identity'); assert.equal(response.ok, true);
    assert.equal(response.actor_id, actorId(label)); assert.equal(response.connection_identity, manifest.configs[label].user);
  });
  await sub('writer 不能创建作品、撤销授权或调用授权初始化器', async () => {
    await denied(call('writerA','novel:create',{ external_key: 'forbidden', title: '不允许' }));
    await denied(call('writerA','grant:revoke',{ grant_id: writerGrant }));
    let error; try { await initializeNovelReader(manifest.configs.writerA, { actorId: actorId('writerA'), novelId: novelB }); } catch (caught) { error = caught; }
    assert.equal(error?.code, 'INITIALIZER_REQUIRED');
  });
  await sub('无授权、已到期、已撤销及停用身份拒绝，有效授权保留正例', async () => {
    await grant('expired',novelA,{ expired: true });
    const revoked = await grant('revoked',novelA);
    assert.equal((await call('authorA','grant:revoke',{ grant_id: revoked })).ok, true);
    for (const label of ['ungranted','expired','revoked','disabled']) await denied(call(label,'novel:read',{ novel_id: novelA }));
    await denied(call('disabled','identity'));
    assert.equal((await call('writerA','novel:read',{ novel_id: novelA })).ok, true);
  });
});

group('B 数据库边界与伪造输入', async sub => {
  for (const field of ['actor_id','role','scope','scene_id','viewpoint_id','secret_scope','max_canon_watermark']) await sub(`不支持或伪造 ${field} 明确拒绝`, async () => {
    const response = await denied(call('writerA','novel:read',{ novel_id: novelA, [field]: actorId('authorA') }));
    assert.equal(response.error, 'INVALID_REQUEST');
  });
  await sub('可控会话变量不改变真实主体', async () => withConnection(manifest.configs.writerA, c => inTransaction(c, async tx => {
    await tx.query("SELECT set_config('app.actor_id',$1,true)", [actorId('authorA')]);
    await tx.query("SELECT set_config('app.role','author',true)");
    const response = await api(tx,'api_read_novel',[novelB,randomUUID()]);
    assert.equal(response.ok, false);
    const self = await api(tx,'api_identity',[randomUUID()]); assert.equal(self.actor_id, actorId('writerA'));
  })));
  for (const target of [manifest.owner,manifest.configs.migrator.user,manifest.configs.admin.user]) await sub('运行登录不能 SET ROLE 到高权限身份', async () => {
    await sqlError(() => withConnection(manifest.configs.writerA,c => c.query(`SET ROLE ${quote(target)}`)), '42501');
  });
  await sub('运行登录不能 SET SESSION AUTHORIZATION 到所有者', async () => {
    await sqlError(() => withConnection(manifest.configs.writerA,c => c.query(`SET SESSION AUTHORIZATION ${quote(manifest.owner)}`)), '42501');
  });
  for (const operation of ['SELECT * FROM agent_book.novel','SELECT * FROM agent_book.access_audit_record',
    'INSERT INTO agent_book.novel(novel_id,external_key,title) VALUES($1,$2,$3)',
    'SELECT agent_book._has_capability($1,$2,$3)','SELECT agent_book._lock_authorization()']) await sub('writer 底表或内部函数直接访问拒绝', async () => {
    const args = operation.includes('_has_capability') ? [actorId('authorA'),'novel.read',novelB]
      : operation.startsWith('INSERT') ? [randomUUID(),'direct-forgery','禁止'] : [];
    await sqlError(() => withConnection(manifest.configs.writerA,c => c.query(operation,args)), '42501');
  });
  await sub('writer 伪造审计、授权以及 Governance 修改均无权限', async () => {
    for (const table of ['capability_grant','grant_revocation','data_scope','actor_principal','access_audit_record']) {
      await sqlError(() => withConnection(manifest.configs.writerA,c => c.query(`DELETE FROM agent_book.${table}`)), '42501');
    }
    await sqlError(() => withConnection(manifest.configs.writerA,c => c.query('INSERT INTO agent_book.access_audit_record(access_audit_id,operation,decision,resource_type) VALUES($1,$2,$3,$4)',[randomUUID(),'forged','allow','none'])), '42501');
  });
  await sub('validator、commit-service、projection-worker 未实现业务无执行权', async () => {
    for (const label of ['validator','commit','projection']) await sqlError(() => withConnection(manifest.configs[label],c => api(c,'api_read_novel',[novelA,randomUUID()])), '42501');
    assert.equal((await denied(call('writerA','canon:commit',{}))).error, 'UNSUPPORTED_OPERATION');
    await sqlError(() => withConnection(manifest.configs.writerA,c => c.query('SELECT agent_book.api_commit()')), '42883');
  });
  await sub('Volume/Chapter/Scene 归属由真实 FK 拒绝，不计作权限正例', async () => {
    const volume = randomUUID(), chapter = randomUUID(), scene = randomUUID();
    await admin(c => c.query("INSERT INTO agent_book.volume(volume_id,novel_id,display_order,title) VALUES($1,$2,1,'卷')",[volume,novelA]));
    await admin(c => c.query("INSERT INTO agent_book.chapter(chapter_id,novel_id,volume_id,chapter_no,title) VALUES($1,$2,$3,1,'章')",[chapter,novelA,volume]));
    await admin(c => c.query('INSERT INTO agent_book.scene(scene_id,novel_id,chapter_id,scene_no) VALUES($1,$2,$3,1)',[scene,novelA,chapter]));
    await sqlError(() => admin(c => c.query("INSERT INTO agent_book.volume(volume_id,novel_id,display_order,title) VALUES($1,$2,1,'错误')",[randomUUID(),randomUUID()])), '23503');
    await sqlError(() => admin(c => c.query("INSERT INTO agent_book.chapter(chapter_id,novel_id,volume_id,chapter_no,title) VALUES($1,$2,$3,2,'错误')",[randomUUID(),novelB,volume])), '23503');
    await sqlError(() => admin(c => c.query('INSERT INTO agent_book.scene(scene_id,novel_id,chapter_id,scene_no) VALUES($1,$2,$3,2)',[randomUUID(),novelB,chapter])), '23503');
    evidence.ownership = { legalHierarchy: true, foreignNovelChapterDenied: true, foreignNovelSceneDenied: true, missingNovelVolumeDenied: true };
  });
  await sub('归属、Scope 与授权历史普通 DML 不可改绑', async () => {
    for (const table of ['novel','volume','chapter','scene','entity','actor_principal','actor_role','data_scope','capability_grant','grant_revocation','access_audit_record']) {
      await sqlError(() => admin(c => c.query(`TRUNCATE agent_book.${table} CASCADE`)), '23514');
    }
    await sqlError(() => admin(c => c.query('UPDATE agent_book.novel SET novel_id=$1 WHERE novel_id=$2',[randomUUID(),novelA])), '23514');
    await sqlError(() => admin(c => c.query('UPDATE agent_book.capability_grant SET actor_id=$1 WHERE grant_id=$2',[actorId('authorA'),writerGrant])), '23514');
  });
});

group('C 创建原子性及真实 COMMIT', async sub => {
  await sub('创建事务内返回后外层回滚，不留下作品、Scope、授权或成功审计', async () => {
    const before = await counts();
    await withConnection(manifest.configs.authorA,async c => {
      await begin(c);
      const result = await api(c,'api_create_novel',[randomUUID(),'rolled-back','回滚',Array.from({ length: 10 },() => randomUUID()),randomUUID()]);
      assert.equal(result.ok,true); assert.deepEqual(await counts(),before); await c.query('ROLLBACK');
    });
    assert.deepEqual(await counts(),before);
  });
  await sub('第二项初始授权写入故障，真实入口安全报错且全量回滚', async () => {
    const before = await counts();
    await admin(c => c.query(`CREATE FUNCTION agent_book.test_fault_grant() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF (SELECT capability_key FROM agent_book.capability WHERE capability_id=NEW.capability_id)='grant.revoke'
        THEN RAISE EXCEPTION 'PRIVATE_DATABASE_ERROR'; END IF; RETURN NEW; END $f$;
      CREATE TRIGGER test_fault_grant BEFORE INSERT ON agent_book.capability_grant FOR EACH ROW EXECUTE FUNCTION agent_book.test_fault_grant()`));
    try { assert.equal((await denied(call('authorA','novel:create',{ external_key:'fault-grant',title:'故障' }))).error,'REQUEST_FAILED'); assert.deepEqual(await counts(),before); }
    finally { await admin(c => c.query('DROP TRIGGER test_fault_grant ON agent_book.capability_grant; DROP FUNCTION agent_book.test_fault_grant()')); }
  });
  await sub('撤销后审计写入故障同事务回滚，原授权仍有效', async () => {
    const before=await counts();
    await admin(c=>c.query(`CREATE FUNCTION agent_book.test_fault_revoke_audit() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.operation='grant.revoke' THEN RAISE EXCEPTION 'PRIVATE_AUDIT_ERROR';END IF;RETURN NEW;END $f$;
      CREATE TRIGGER test_fault_revoke_audit BEFORE INSERT ON agent_book.access_audit_record FOR EACH ROW EXECUTE FUNCTION agent_book.test_fault_revoke_audit()`));
    try{assert.equal((await denied(call('authorA','grant:revoke',{grant_id:writerGrant}))).error,'REQUEST_FAILED');assert.deepEqual(await counts(),before);}
    finally{await admin(c=>c.query('DROP TRIGGER test_fault_revoke_audit ON agent_book.access_audit_record;DROP FUNCTION agent_book.test_fault_revoke_audit()'));}
    assert.equal((await call('writerA','novel:read',{novel_id:novelA})).ok,true);
  });
  await sub('函数返回后真实 COMMIT 延后故障，服务不交付成功或半成品', async () => {
    const before = await counts();
    await admin(c => c.query(`CREATE FUNCTION agent_book.test_fault_commit() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='test_commit_failure',MESSAGE='PRIVATE_COMMIT_ERROR'; END $f$;
      CREATE CONSTRAINT TRIGGER test_fault_commit AFTER INSERT ON agent_book.novel DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book.test_fault_commit()`));
    try {
      let returned = false;
      await sqlError(() => withConnection(manifest.configs.authorA,c => inTransaction(c,async tx => {
        const result = await api(tx,'api_create_novel',[randomUUID(),'fault-commit-direct','故障',Array.from({length:10},() => randomUUID()),randomUUID()]);
        returned = result.ok;
      })), '23514');
      assert.equal(returned,true);
      assert.equal((await denied(call('authorA','novel:create',{ external_key:'fault-commit-service',title:'故障' }))).error,'REQUEST_FAILED');
      assert.deepEqual(await counts(),before); evidence.atomicity = { functionReturnedInsideTransaction:true, serviceWaitsForCommit:true, physicalCountsUnchanged:true };
    } finally { await admin(c => c.query('DROP TRIGGER test_fault_commit ON agent_book.novel; DROP FUNCTION agent_book.test_fault_commit()')); }
  });
});

group('D 稳定锁、撤销与期限', async sub => {
  await sub('撤销先持锁并提交，等待中的真实 writer 判定拒绝', async () => {
    const result = await race({ firstActor:'authorA',first:c => api(c,'api_revoke_grant',[writerGrant,randomUUID()]),
      secondActor:'writerA',second:c => api(c,'api_read_novel',[novelA,randomUUID()]) });
    assert.equal(result.firstResult.ok,true); assert.equal(result.secondResult.ok,false);
    await denied(call('writerA','novel:read',{novel_id:novelA})); evidence.revokeFirst=result.evidence;
  });
  await sub('许可判定先完成可完成本次，撤销等待后生效，下一次拒绝', async () => {
    writerGrant = await grant('writerA',novelA);
    const result = await race({ firstActor:'writerA',first:c => api(c,'api_read_novel',[novelA,randomUUID()]),
      secondActor:'authorA',second:c => api(c,'api_revoke_grant',[writerGrant,randomUUID()]) });
    assert.equal(result.firstResult.ok,true); assert.equal(result.secondResult.ok,true);
    await denied(call('writerA','novel:read',{novel_id:novelA})); evidence.readFirst=result.evidence;
  });
  await sub('等待中跨过授权期限，取锁后使用数据库实时时间拒绝', async () => {
    const timed = await grant('timed',novelA,{milliseconds:900});
    const holder=await clientFor('admin'),waiter=await clientFor('timed'),observer=await clientFor('admin');let pending;
    try {
      await begin(holder);await holder.query('SELECT agent_book._lock_authorization()');await begin(waiter);
      const blocker=(await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const waiting=(await waiter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      pending=api(waiter,'api_read_novel',[novelA,randomUUID()]);pending.catch(()=>{});
      await blocked(observer,waiting,blocker);
      const deadline=Date.now()+3500;let expired=false;
      while(Date.now()<deadline){expired=(await observer.query('SELECT clock_timestamp()>=expires_at AS expired FROM agent_book.capability_grant WHERE grant_id=$1',[timed])).rows[0].expired;if(expired)break;await new Promise(resolve=>setTimeout(resolve,15));}
      assert.equal(expired,true);await holder.query('COMMIT');assert.equal((await pending).ok,false);await waiter.query('COMMIT');
      evidence.expiryAfterLock={blocker,waiter:waiting,expiredByDatabaseClock:true};
    } finally {await close(holder);await close(waiter);await close(observer);if(pending)await pending.catch(()=>{});}
  });
});

group('E 审计范围、元数据与披露', async sub => {
  await sub('业务拒绝审计真实提交，由独立连接读取', async () => {
    const before=(await admin(c=>c.query("SELECT count(*)::int AS n FROM agent_book.access_audit_record WHERE actor_id=$1 AND decision='deny'",[actorId('writerB')]))).rows[0].n;
    await denied(call('writerB','novel:read',{novel_id:novelA}));
    const after=(await admin(c=>c.query("SELECT count(*)::int AS n FROM agent_book.access_audit_record WHERE actor_id=$1 AND decision='deny'",[actorId('writerB')]))).rows[0].n;
    assert.equal(after,before+1);evidence.denialAudit={independentlyCommitted:true,before,after};
  });
  await sub('审计检查记录作品及实际资源，保留普通事件和原始引用', async () => {
    const grantB=(await admin(c=>c.query(`SELECT g.grant_id FROM agent_book.capability_grant g JOIN agent_book.data_scope s USING(data_scope_id) WHERE s.novel_id=$1 LIMIT 1`,[novelB]))).rows[0].grant_id;
    const ids=Array.from({length:3},()=>randomUUID());
    await admin(async c=>{
      await c.query("INSERT INTO agent_book.access_audit_record(access_audit_id,actor_id,novel_id,operation,decision,resource_type,resource_novel_id) VALUES($1,$2,$3,'initialization_filter','deny','novel',$4)",[ids[0],actorId('authorA'),novelA,novelB]);
      await c.query("INSERT INTO agent_book.access_audit_record(access_audit_id,actor_id,novel_id,operation,decision,resource_type,resource_grant_id) VALUES($1,$2,$3,'initialization_filter','deny','grant',$4)",[ids[1],actorId('authorA'),novelA,grantB]);
      await c.query("INSERT INTO agent_book.access_audit_record(access_audit_id,actor_id,novel_id,operation,decision,resource_type) VALUES($1,$2,$3,'ordinary','allow','none')",[ids[2],actorId('authorA'),novelA]);
    });
    const before=(await admin(c=>c.query('SELECT * FROM agent_book.access_audit_record WHERE access_audit_id=ANY($1::uuid[]) ORDER BY access_audit_id',[ids]))).rows;
    const response=await call('auditorA','audit:read',{novel_id:novelA});assert.equal(response.ok,true);
    const visible=JSON.stringify(response);for(const forbidden of [novelB,grantB,ids[0],ids[1]])assert.equal(visible.includes(forbidden),false);
    assert.ok(response.events.some(e=>e.audit_id===ids[2]&&e.resource_type==='none'));
    assert.ok(response.events.some(e=>e.resource_id===novelA));
    assert.deepEqual((await admin(c=>c.query('SELECT * FROM agent_book.access_audit_record WHERE access_audit_id=ANY($1::uuid[]) ORDER BY access_audit_id',[ids]))).rows,before);
    await denied(call('auditorA','audit:read',{novel_id:novelB}));await denied(call('writerA','audit:read',{novel_id:novelA}));
    await sqlError(()=>admin(c=>c.query("INSERT INTO agent_book.access_audit_record(access_audit_id,operation,decision,resource_type) VALUES($1,'unsupported','allow','canon_fact')",[randomUUID()])), '23514');
    evidence.auditScope={foreignNovelAndGrantIdentifiersAbsent:true,ordinaryAndAllowedResourceRetained:true,rawAuditPreserved:true,unsupportedResourceDenied:true};
  });
  await sub('作者不能撤销其他作品授权，创建接口不能指定他人或既有 Scope', async () => {
    await denied(call('authorB','grant:revoke',{grant_id:auditorGrant}));
    const before=await counts();
    await denied(call('authorA','novel:create',{external_key:'forged-scope',title:'禁止',actor_id:actorId('writerB')}));
    await denied(call('authorA','novel:create',{external_key:'forged-scope',title:'禁止',scope:{novel_id:novelB}}));
    assert.deepEqual(await counts(),before);
  });
  await sub('作者只能撤销自己的新作品启动授权，既有作品读取仍按 Novel Grant 判断',async()=>{
    const revoked=await call('authorB','creation:revoke');assert.equal(revoked.ok,true);
    await denied(call('authorB','novel:create',{external_key:'stopped-author',title:'禁止'}));
    assert.equal((await call('authorB','novel:read',{novel_id:novelB})).ok,true);
    assert.equal((await denied(call('writerA','creation:revoke'))).ok,false);
  });
  await sub('逐角色属性、成员关系、所有者、ACL、函数路径及触发器核验', async () => admin(async c=>{
    const runtime=Object.entries(manifest.configs).filter(([key])=>!['admin','migrator'].includes(key)).map(([,value])=>value.user);
    const roles=(await c.query('SELECT oid,rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit FROM pg_catalog.pg_roles WHERE rolname=ANY($1::name[])',[runtime])).rows;
    assert.equal(roles.length,runtime.length);for(const role of roles)assert.ok(!role.rolsuper&&!role.rolbypassrls&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolinherit);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM pg_catalog.pg_auth_members WHERE member=ANY($1::oid[])',[roles.map(r=>r.oid)])).rows[0].n,0);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_tables WHERE schemaname IN ('agent_book','agent_book_meta') AND tableowner<>$1",[manifest.owner])).rows[0].n,0);
    const owner=(await c.query('SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_catalog.pg_roles WHERE rolname=$1',[manifest.owner])).rows[0];
    assert.deepEqual(owner,{rolcanlogin:false,rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});
    const migrationMembership=(await c.query(`SELECT parent.rolname,m.inherit_option,m.set_option,m.admin_option FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles child ON child.oid=m.member JOIN pg_catalog.pg_roles parent ON parent.oid=m.roleid WHERE child.rolname=$1`,[manifest.configs.migrator.user])).rows;
    assert.deepEqual(migrationMembership,[{rolname:manifest.owner,inherit_option:false,set_option:true,admin_option:false}]);
    const baseTables=(await c.query("SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agent_book' AND c.relkind='r'")).rows;
    for(const login of runtime)for(const table of baseTables){
      const rights=(await c.query("SELECT has_table_privilege($1::name,$2::oid,'SELECT') AS read,has_table_privilege($1::name,$2::oid,'INSERT') AS write",[login,table.oid])).rows[0];
      assert.deepEqual(rights,{read:false,write:false});
    }
    const meta=(await c.query(`SELECT p.prosecdef,p.proconfig,r.rolname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book_meta' AND p.proname='instance_identity'`)).rows[0];
    assert.equal(meta.prosecdef,true);assert.equal(meta.rolname,manifest.owner);assert.deepEqual(meta.proconfig,['search_path=pg_catalog, agent_book_meta, pg_temp']);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_constraint co JOIN pg_catalog.pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='agent_book' AND NOT co.convalidated")).rows[0].n,0);
    const functions=(await c.query(`SELECT p.proname,p.oid,p.prosecdef,p.proconfig,r.rolname AS owner FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace JOIN pg_catalog.pg_roles r ON r.oid=p.proowner WHERE n.nspname='agent_book'`)).rows;
    for(const f of functions){assert.equal(f.owner,manifest.owner);assert.equal(f.prosecdef,true);assert.deepEqual(f.proconfig,['search_path=pg_catalog, agent_book, pg_temp']);assert.ok(!f.proname.startsWith('test_fault'));
      const publicAcl=(await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid=$1 AND acl.grantee=0 AND acl.privilege_type='EXECUTE'",[f.oid])).rows[0].n;assert.equal(publicAcl,0);
      for(const actor of manifest.actors){const allowed=['api_identity',...(actor.role==='author'?['api_revoke_creation','api_create_novel','api_read_novel','api_revoke_grant','api_design_task']:actor.role==='writer'?['api_read_novel']:actor.role==='auditor'?['api_read_audit']:[])];
        assert.equal((await c.query('SELECT has_function_privilege($1::name,$2::oid,\'EXECUTE\') AS allowed',[actor.login,f.oid])).rows[0].allowed,allowed.includes(f.proname));}
    }
    assert.equal((await c.query("SELECT count(*)::int AS n FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='agent_book' AND t.tgenabled<>'O'")).rows[0].n,0);
    const tables=(await c.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='agent_book'")).rows.map(r=>r.tablename);
    for(const forbidden of ['candidate_version','canon_commit','projection_outbox','projection_task'])assert.equal(tables.includes(forbidden),false);
    evidence.databasePermissions={runtimeLogins:runtime.length,noMemberships:true,controlledFunctions:functions.length,publicExecute:0,allTablesOwnedByNoLoginOwner:true,ownerCannotLogin:true,migratorSetOnlyOwnerMembership:true,runtimeBaseTablePrivileges:0,noUnvalidatedConstraints:true,noDisabledTriggersOrFaults:true};
  }));
  await sub('日志、CLI 错误、数据库日志与验收输出不披露随机凭据', async () => {
    for(const env of [{...process.env,AB_CONFIG:''},{...process.env,AB_CONFIG:manifest.configPaths.writerA}]){
      const r=spawnSync(process.execPath,['src/cli.mjs','novel:read',manifest.configs.admin.password],{env,encoding:'utf8',timeout:15000});assert.notEqual(r.status,0);cliOutputs.push(r.stdout,r.stderr);
    }
    for(const row of logs)assert.deepEqual(Object.keys(row),['event','operation','outcome','request_id']);
    assert.ok(logs.some(row=>row.outcome==='failed'));assert.ok(logs.some(row=>row.outcome==='denied'));
    const db=spawnSync('docker',['logs',manifest.container],{encoding:'utf8',timeout:10000});assert.equal(db.status,0);
    const markers=Object.values(manifest.configs).flatMap(c=>[c.password,`postgres://${c.user}:${c.password}@${c.host}:${c.port}/${c.database}`]);
    assert.equal(scanSecrets([logs,cliOutputs,db.stdout,db.stderr,groups,evidence],markers),0);
    assert.equal(JSON.stringify(cliOutputs).includes('PRIVATE_COMMIT_ERROR'),false);
    assert.equal(JSON.stringify(logs).includes('PRIVATE_DATABASE_ERROR'),false);
    evidence.disclosure={defaultLogRecords:logs.length,credentialMarkers:markers.length,leaks:0,rawSqlOrPrivateErrorsReturned:false,technicalFailureLogs:logs.filter(row=>row.outcome==='failed').length,businessOrInputDenialLogs:logs.filter(row=>row.outcome==='denied').length};
  });
});
