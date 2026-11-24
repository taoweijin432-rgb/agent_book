import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'projection_checkpoint_fixture';
const DATABASE_URL = process.env.DATABASE_URL;
assert.ok(DATABASE_URL, 'DATABASE_URL is required');
pg.types.setTypeParser(1184, (value) => value); // Preserve database microseconds in comparisons and evidence.
const q = (name) => `${SCHEMA}.${name}`;
const outcomes = [];
const subscenarios = [];
const parameterizedSubscenarios = {};
let sequence = 0;
const id = (label = 'id') => `${label}_${++sequence}`;
const resultHash = 'sha256:fixture-result';
const resultRef = 'fixture://result/one';

async function connect() {
  const c = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  await c.connect();
  await c.query('SET search_path TO public');
  await c.query("SET statement_timeout='8s'");
  await c.query("SET lock_timeout='6s'");
  assert.equal((await c.query('SHOW search_path')).rows[0].search_path, 'public');
  return c;
}
async function begin(c) {
  await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  assert.equal((await c.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'read committed');
}
async function close(c) { try { await c.query('ROLLBACK'); } finally { await c.end(); } }
async function tx(fn) {
  const c = await connect();
  try { await begin(c); return await fn(c); } finally { await close(c); }
}
async function observe(fn) {
  const c = await connect();
  try { return await fn(c); } finally { await c.end(); }
}
async function insert(c, table, row) {
  const columns = Object.keys(row);
  return c.query(`INSERT INTO ${q(table)} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(row));
}
async function call(c, name, ...args) {
  return (await c.query(`SELECT to_jsonb(${q(name)}(${args.map((_, i) => `$${i + 1}`).join(',')})) AS response`, args)).rows[0].response;
}
async function invoke(name, ...args) {
  return tx(async (c) => { const response = await call(c, name, ...args); await c.query('COMMIT'); return response; });
}
async function success(c, attemptId) { return call(c, 'accept_success', attemptId, resultHash, resultRef); }

async function state(taskId) {
  return observe(async (c) => {
    const attempts = (await c.query(`SELECT *, ended_at < expires_at AS accepted_before_deadline,
      ended_at >= expires_at AS ended_at_or_after_deadline FROM ${q('projection_attempt')} WHERE task_id=$1 ORDER BY attempt_no`, [taskId])).rows;
    const audit = (await c.query(`SELECT au.* FROM ${q('projection_attempt_audit')} au JOIN ${q('projection_attempt')} a USING(attempt_id) WHERE a.task_id=$1 ORDER BY audit_id`, [taskId])).rows;
    return { attempts, audit };
  });
}
async function assertHistory(taskId, statuses, events) {
  const saved = await state(taskId);
  assert.deepEqual(saved.attempts.map((a) => a.status), statuses);
  assert.deepEqual(saved.attempts.map((a) => a.attempt_no), statuses.map((_, i) => i + 1));
  assert.ok(saved.attempts.filter((a) => a.status === 'processing').length <= 1);
  if (events) assert.deepEqual(saved.audit.map((row) => row.event_kind), events);
  for (const a of saved.attempts) {
    assert.equal(a.task_id, taskId);
    assert.equal(saved.audit.filter((row) => row.attempt_id === a.attempt_id && row.to_status === 'processing').length, 1);
    if (a.status !== 'processing') {
      const audit = saved.audit.filter((row) => row.attempt_id === a.attempt_id && row.to_status === a.status);
      assert.equal(audit.length, 1);
      assert.equal(audit[0].occurred_at, a.ended_at);
      if (a.status === 'succeeded') { assert.equal(a.accepted_before_deadline, true); assert.ok(a.result_hash); assert.ok(a.result_ref); }
      else { assert.equal(a.result_hash, null); assert.equal(a.result_ref, null); }
      if (a.status === 'expired') assert.equal(a.ended_at_or_after_deadline, true);
    }
  }
  return saved;
}
async function waitPast(c, deadline) {
  const limit = Date.now() + 5000;
  while (Date.now() < limit) {
    const row = (await c.query('WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS database_time) SELECT database_time, database_time >= $1::timestamptz AS reached FROM tick', [deadline])).rows[0];
    if (row.reached) return row.database_time;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`Database did not reach deadline ${deadline}`);
}
async function past(attempt) { return observe((c) => waitPast(c, attempt.expires_at)); }
const pid = async (c) => (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
async function blocked(observer, waiter, blocker) {
  const limit = Date.now() + 4500;
  while (Date.now() < limit) {
    const row = (await observer.query(`SELECT pid, state, query_start, xact_start, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers,
      clock_timestamp() AS observed_at FROM pg_catalog.pg_stat_activity WHERE pid=$1`, [waiter])).rows[0];
    if (row?.wait_event_type === 'Lock' && row.blockers.map(Number).includes(Number(blocker))) return row;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`PID ${waiter} was not observed blocked by ${blocker}`);
}
async function expectSql(action, stage, code, constraint) {
  let error;
  try { await action(); } catch (caught) { error = caught; }
  assert.ok(error, `${stage} must reject`);
  assert.equal(error.code, code, error.message);
  if (constraint !== undefined) assert.equal(error.constraint, constraint);
  return { stage, code: error.code, constraint: error.constraint ?? '', evidence: error.message };
}
function scenario(name, fn) {
  test(name, { timeout: 120_000 }, async (t) => {
    try { const evidence = await fn(t); outcomes.push({ name, status: 'passed', evidence: evidence ?? '详见实测子场景' }); }
    catch (error) { outcomes.push({ name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint }); throw error; }
  });
}
async function sub(t, name, fn) {
  let failure;
  await t.test(name, { timeout: 20_000 }, async () => {
    try { const evidence = await fn(); subscenarios.push({ group: t.name, name, status: 'passed', ...(typeof evidence === 'string' ? { evidence } : evidence) }); }
    catch (error) { subscenarios.push({ group: t.name, name, status: 'failed', error: error.message, code: error.code, constraint: error.constraint }); failure = error; throw error; }
    finally { parameterizedSubscenarios[t.name] = (parameterizedSubscenarios[t.name] ?? 0) + 1; }
  });
  if (failure) throw failure;
}
after(async () => {
  await writeFile(process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json', JSON.stringify({ schema: SCHEMA, isolation: 'read committed', outcomes, subscenarios, parameterizedSubscenarios }, null, 2));
});


async function environment(options = {}) {
  return tx(async (c) => {
    const ctx = { projectId: options.projectId ?? id('project'), strategy: options.strategy ?? id('strategy'), target: options.target ?? 'graph', scopeKey: options.scopeKey ?? '$root', timeoutMs: options.timeoutMs ?? 30_000 };
    await c.query(`INSERT INTO ${q('project')} VALUES($1) ON CONFLICT DO NOTHING`, [ctx.projectId]);
    await c.query(`INSERT INTO ${q('projection_policy')} VALUES($1,$2) ON CONFLICT DO NOTHING`, [ctx.strategy, ctx.timeoutMs]);
    await ensureCommit(c, ctx, options.canonWatermark ?? 20);
    ctx.scopeHash = await call(c, 'normalized_scope', ctx.projectId, ctx.scopeKey);
    await c.query('COMMIT'); return ctx;
  });
}
async function ensureCommit(c, ctx, watermark) {
  const inserted = await c.query(`INSERT INTO ${q('canon_commit')}(canon_commit_id,project_id,canon_watermark) VALUES($1,$2,$3) ON CONFLICT(project_id,canon_watermark) DO NOTHING RETURNING canon_commit_id`, [id('commit'), ctx.projectId, watermark]);
  return inserted.rows[0]?.canon_commit_id ?? (await c.query(`SELECT canon_commit_id FROM ${q('canon_commit')} WHERE project_id=$1 AND canon_watermark=$2`, [ctx.projectId, watermark])).rows[0].canon_commit_id;
}
async function newWork(ctx, watermark, options = {}) {
  return tx(async (c) => {
    const commitId = await ensureCommit(c, ctx, watermark);
    let outboxId = null; let rebuildId = options.rebuildId ?? null;
    if (options.rebuild || rebuildId) {
      if (!rebuildId) {
        rebuildId = id('rebuild'); const sourceCommit = await ensureCommit(c, ctx, options.goal ?? watermark);
        await insert(c, 'projection_rebuild_record', { rebuild_record_id: rebuildId, project_id: ctx.projectId, target: ctx.target, scope_key: ctx.scopeKey, scope_hash: ctx.scopeHash, strategy_version: ctx.strategy,
          source_commit_id: options.sourceOutbox ? null : sourceCommit, source_outbox_id: options.sourceOutbox ?? null,
          source_from_watermark: options.from ?? 0, target_watermark: options.goal ?? watermark, status: 'running' });
      }
    } else {
      const existing = (await c.query(`SELECT outbox_id FROM ${q('projection_outbox')} WHERE canon_commit_id=$1 AND target=$2 AND strategy_version=$3`, [commitId, ctx.target, ctx.strategy])).rows[0];
      outboxId = existing?.outbox_id ?? id('outbox');
      if (!existing) await insert(c, 'projection_outbox', { outbox_id: outboxId, project_id: ctx.projectId, canon_commit_id: commitId, target: ctx.target, scope_key: ctx.scopeKey, scope_hash: ctx.scopeHash, source_canon_watermark: watermark, strategy_version: ctx.strategy, event_hash: `event:${watermark}` });
    }
    const taskRow = (await insert(c, 'projection_task', { task_id: id('task'), project_id: ctx.projectId, origin_type: rebuildId ? 'rebuild' : 'outbox', outbox_id: outboxId, rebuild_record_id: rebuildId,
      snapshot_commit_id: commitId, source_watermark: watermark, target: ctx.target, scope_key: ctx.scopeKey, scope_hash: ctx.scopeHash, strategy_version: ctx.strategy })).rows[0];
    const response = await call(c, 'claim_attempt', taskRow.task_id, 'same-worker-software-v1');
    assert.equal(response.outcome, 'created');
    const claimPid = await pid(c); await c.query('COMMIT');
    return { ctx, task: taskRow, attempt: response.attempt, claimPid };
  });
}
function payloadFor(work, options = {}) {
  return { format: 'complete_snapshot_v1', project_id: work.ctx.projectId, target: work.ctx.target, scope: work.ctx.scopeHash, strategy: work.ctx.strategy,
    watermark: String(work.task.source_watermark), snapshot: { items: [options.data ?? `full snapshot at ${work.task.source_watermark}`] }, ...options.payloadOverrides };
}
async function isolated(work, options = {}) {
  const payload = payloadFor(work, options);
  const result = await tx(async (c) => {
    const row = await call(c, 'store_result', work.attempt.attempt_id, payload, options.ref ?? `fixture://snapshot/${id('ref')}`, options.claimedHash ?? null);
    const resultPid = await pid(c); assert.notEqual(resultPid, work.claimPid);
    await c.query('COMMIT'); return { row, resultPid };
  });
  return { ...work, result: result.row, resultPid: result.resultPid, payload };
}
async function ready(ctx, watermark, options = {}) {
  const work = await isolated(await newWork(ctx, watermark, options), options);
  if (options.status === 'expired') { await past(work.attempt); await invoke('expire_attempt', work.attempt.attempt_id); }
  else if (['retryable_failure', 'permanent_failure'].includes(options.status)) await invoke('record_failure', work.attempt.attempt_id, options.status, 'fixture://execution-failure');
  else if (options.status !== 'processing') {
    const response = await invoke('accept_success', work.attempt.attempt_id, options.acceptHash ?? work.result.content_hash, options.acceptRef ?? work.result.result_ref);
    assert.equal(response.outcome, 'accepted_success');
  }
  await tx(async (c) => { await insert(c, 'result_permission_fixture', { result_id: work.result.result_id, decision: options.permission ?? 'allow', basis: 'explicit fixture decision; not real authorization' }); await c.query('COMMIT'); });
  work.verification = await invoke('verify_result', work.result.result_id, work.attempt.attempt_id);
  return work;
}
async function publish(work, mode = 'active', reason = 'verified complete snapshot') { return invoke('publish_result', work.attempt.attempt_id, work.result.result_id, mode, reason); }
async function publicationState(ctx) {
  return observe(async (c) => {
    const params = [ctx.target, ctx.scopeHash, ctx.strategy];
    const filter = 'target=$1 AND normalized_scope_hash=$2 AND strategy_version=$3';
    const checkpoints = (await c.query(`SELECT * FROM ${q('projection_checkpoint')} WHERE ${filter} ORDER BY state`, params)).rows;
    const pointer = (await c.query(`SELECT * FROM ${q('active_projection')} WHERE ${filter}`, params)).rows;
    const history = (await c.query(`SELECT * FROM ${q('projection_publication_history')} WHERE ${filter} ORDER BY receipt_no`, params)).rows;
    const receipts = (await c.query(`SELECT * FROM ${q('publication_receipt')} WHERE ${filter} ORDER BY receipt_no`, params)).rows;
    assert.ok(pointer.length <= 1);
    assert.equal(new Set(checkpoints.map((row) => row.state)).size, checkpoints.length);
    const active = checkpoints.find((row) => row.state === 'active');
    if (active) { assert.equal(pointer[0].receipt_id, active.receipt_id); assert.equal(pointer[0].current_watermark, active.current_watermark); }
    for (let i = 1; i < history.length; i += 1) assert.ok(BigInt(history[i].watermark) > BigInt(history[i - 1].watermark), 'active history strictly advances watermark');
    const duplicateAttempt = (await c.query(`SELECT last_successful_attempt_id FROM ${q('projection_checkpoint')} GROUP BY last_successful_attempt_id HAVING count(*)>1`)).rows;
    assert.deepEqual(duplicateAttempt, [], 'one Attempt cannot own multiple current Checkpoints');
    return { checkpoints, pointer, history, receipts };
  });
}
async function assertActive(ctx, expectedWork, expectedWatermark, historyCount) {
  const saved = await publicationState(ctx);
  assert.equal(saved.pointer.length, expectedWatermark === null ? 0 : 1);
  if (expectedWatermark !== null) {
    assert.equal(Number(saved.pointer[0].current_watermark), expectedWatermark);
    if (expectedWork) { assert.equal(saved.pointer[0].result_id, expectedWork.result.result_id); assert.deepEqual(saved.pointer[0].payload, expectedWork.payload); }
  }
  if (historyCount !== undefined) assert.equal(saved.history.length, historyCount);
  return saved;
}
async function taskState(work) {
  return observe(async (c) => ({ task: (await c.query(`SELECT * FROM ${q('projection_task')} WHERE task_id=$1`, [work.task.task_id])).rows[0],
    rebuild: work.task.rebuild_record_id ? (await c.query(`SELECT * FROM ${q('projection_rebuild_record')} WHERE rebuild_record_id=$1`, [work.task.rebuild_record_id])).rows[0] : null }));
}

scenario('A：完整快照发布、单调水位、幂等与冲突', async (t) => {
  const ctx = await environment();
  let current;
  await sub(t, '首次发布与落后 Canon 的明确返回', async () => {
    current = await ready(ctx, 5); assert.equal(current.verification.passed, true);
    const response = await publish(current); assert.equal(response.outcome, 'published');
    assert.deepEqual([response.canon_watermark, response.active_watermark, response.pending_watermark, response.lag, response.behind_canon], [20, 5, 5, 15, true]);
    await assertActive(ctx, current, 5, 1); assert.equal((await taskState(current)).task.status, 'completed');
    return { stage: 'publish COMMIT', evidence: `隔离结果独立 PID=${current.resultPid} 先提交；发布=${JSON.stringify(response)}；唯一 active 与 Checkpoint 完全匹配` };
  });
  await sub(t, '较高完整快照推进', async () => {
    current = await ready(ctx, 10); assert.equal((await publish(current)).outcome, 'published'); await assertActive(ctx, current, 10, 2);
    return 'active 5→10；Canon 20，active 保留真实水位10，不写成Canon水位';
  });
  await sub(t, '同水位同实际内容重复发布幂等', async () => {
    const same = await ready(ctx, 10); assert.equal(same.result.content_hash, current.result.content_hash);
    for (let i = 0; i < 2; i += 1) assert.equal((await publish(same)).outcome, 'idempotent');
    await assertActive(ctx, current, 10, 2); assert.equal((await taskState(same)).task.status, 'completed');
    return '不同 Attempt 的同水位同实际内容为 idempotent；不切换当前指针、不增加有效发布历史';
  });
  await sub(t, '同水位不同内容冲突', async () => {
    const different = await ready(ctx, 10, { data: 'different complete snapshot' });
    assert.notEqual(different.result.content_hash, current.result.content_hash);
    const response = await publish(different); assert.equal(response.outcome, 'watermark_conflict');
    await assertActive(ctx, current, 10, 2); return { stage: 'publication decision', constraint: response.constraint, evidence: JSON.stringify(response) };
  });
});

scenario('A：成功接受时间与发布时间分离，非成功不能进入任何 Checkpoint', async (t) => {
  await sub(t, '截止前接受，截止后仍可发布', async () => {
    const ctx = await environment({ timeoutMs: 450 }); const work = await ready(ctx, 5);
    const databaseTime = await past(work.attempt); assert.equal((await publish(work)).outcome, 'published');
    await assertActive(ctx, work, 5, 1);
    const saved = await assertHistory(work.task.task_id, ['succeeded'], ['claimed', 'succeeded']);
    return { stage: 'publish after expires_at', evidence: `ended_at=${saved.attempts[0].ended_at} < expires_at=${work.attempt.expires_at}；发布前数据库时间=${databaseTime} >= expires_at；仍合法发布；隔离写入 PID=${work.resultPid}` };
  });
  for (const status of ['processing', 'expired', 'retryable_failure', 'permanent_failure']) for (const mode of ['active', 'staging']) await sub(t, `${status}/${mode}`, async () => {
    const ctx = await environment({ timeoutMs: status === 'expired' ? 80 : 30_000 }); const work = await ready(ctx, 5, { status });
    assert.equal(work.verification.passed, false);
    const response = await publish(work, mode); assert.equal(response.outcome, 'attempt_not_eligible');
    const saved = await assertActive(ctx, null, null, 0); assert.deepEqual(saved.checkpoints, []);
    return { stage: `${mode} qualification`, constraint: response.constraint, evidence: `${status} 不推进 active 或 staging；${JSON.stringify(response)}` };
  });
});

scenario('B：项目、目标、规范化范围、策略、来源及水位映射独立负例', async (t) => {
  const ctx = await environment(); const work = await ready(ctx, 5); await publish(work);
  const alternate = await environment(); const alternateWork = await ready(alternate, 6);
  for (const [field, value] of [['project_id', alternate.projectId], ['target', 'vector'], ['normalized_scope_hash', await observe((c) => call(c, 'normalized_scope', ctx.projectId, 'different-scope'))], ['strategy_version', alternate.strategy], ['source_id', alternateWork.result.source_id], ['watermark', 6]]) await sub(t, field, async () => {
    const before = await publicationState(ctx);
    const bad = { ...work.result, result_id: id('wrong_result'), result_ref: `fixture://wrong/${id('ref')}`, [field]: value };
    delete bad.content_hash; delete bad.stored_at;
    const error = await tx((c) => expectSql(() => insert(c, 'projection_result_version', bad), 'isolation result INSERT', '23514', 'publication_result_mapping'));
    assert.deepEqual(await publicationState(ctx), before); return error;
  });
  await sub(t, 'Attempt 不属于该结果', async () => {
    const wrong = await newWork(ctx, 5);
    assert.equal((await invoke('accept_success', wrong.attempt.attempt_id, work.result.content_hash, work.result.result_ref)).outcome, 'accepted_success');
    const response = await invoke('publish_result', wrong.attempt.attempt_id, work.result.result_id);
    assert.equal(response.outcome, 'attempt_result_mismatch'); await assertActive(ctx, work, 5, 1);
    return { stage: 'publication qualification', constraint: response.constraint, evidence: '使用同项目/来源/水位/范围/策略、同 hash/ref 的另一真实 succeeded Attempt，只改变结果的执行关联；原 active 不变' };
  });
});

scenario('B：实际摘要、引用、验证与模拟权限', async (t) => {
  for (const variant of ['claimed_hash', 'attempt_hash', 'result_ref', 'snapshot_format', 'permission', 'verification_missing']) await sub(t, variant, async () => {
    const ctx = await environment(); const opts = {
      claimed_hash: { claimedHash: 'caller-supplied-false-digest' }, attempt_hash: { acceptHash: 'caller-supplied-false-digest' },
      result_ref: { acceptRef: 'fixture://another-result' }, snapshot_format: { payloadOverrides: { format: 'incremental-delta-is-unsupported' } }, permission: { permission: 'deny' },
    }[variant] ?? {};
    let work;
    if (variant === 'verification_missing') {
      work = await isolated(await newWork(ctx, 5));
      await invoke('accept_success', work.attempt.attempt_id, work.result.content_hash, work.result.result_ref);
      await tx(async (c) => { await insert(c, 'result_permission_fixture', { result_id: work.result.result_id, decision: 'allow', basis: 'fixture allow' }); await c.query('COMMIT'); });
    } else work = await ready(ctx, 5, opts);
    const response = await publish(work);
    const expected = { claimed_hash: 'content_hash_mismatch', attempt_hash: 'content_hash_mismatch', result_ref: 'result_ref_mismatch', snapshot_format: 'snapshot_format_invalid', permission: 'permission_denied', verification_missing: 'verification_failed' }[variant];
    assert.equal(response.outcome, expected); await assertActive(ctx, null, null, 0);
    return { stage: 'publication validation', constraint: response.constraint, evidence: `${JSON.stringify(response)}；实际载荷摘要=${work.result.content_hash}，未依赖两份调用者 hash 相等` };
  });
  for (const invalidation of ['cancelled', 'abandoned', 'rebuild_abandoned']) await sub(t, `成功后失去资格/${invalidation}`, async () => {
    const ctx = await environment(); const work = await ready(ctx, 5, { rebuild: invalidation === 'rebuild_abandoned' });
    assert.equal(work.verification.passed, true);
    if (invalidation === 'rebuild_abandoned') await tx(async (c) => { await c.query(`UPDATE ${q('projection_rebuild_record')} SET status='abandoned' WHERE rebuild_record_id=$1`, [work.task.rebuild_record_id]); await c.query('COMMIT'); });
    else await invoke('invalidate_task', work.task.task_id, invalidation, 'fixture revocation after success');
    const response = await publish(work); assert.equal(response.outcome, invalidation === 'rebuild_abandoned' ? 'rebuild_ineligible' : 'source_ineligible');
    await assertActive(ctx, null, null, 0); await assertHistory(work.task.task_id, ['succeeded'], ['claimed', 'succeeded']);
    return { stage: 'source recheck', constraint: response.constraint, evidence: '成功及结果验证先提交，随后来源失效；历史 succeeded 保留，发布被拒绝' };
  });
});

scenario('C：低水位隔离与重建 staging→active 治理', async (t) => {
  await sub(t, '低水位结果不能回退 active，当前读取不选择最后写入', async () => {
    const ctx = await environment(); const high = await ready(ctx, 10); await publish(high);
    const low = await ready(ctx, 5, { data: 'late writer with old complete snapshot' });
    const response = await publish(low); assert.equal(response.outcome, 'staged'); assert.equal(response.reason, 'lower_active');
    const saved = await assertActive(ctx, high, 10, 1);
    assert.equal(saved.checkpoints.find((row) => row.state === 'staging').result_id, low.result.result_id);
    assert.equal((await taskState(low)).task.status, 'pending');
    return { stage: 'low watermark decision', evidence: `低水位结果 PID=${low.resultPid} 在较高结果之后独立写入；返回=${JSON.stringify(response)}；读取 active 仍是水位10，非最后写入的水位5` };
  });
  await sub(t, '重建未达目标、达标 staging 与原子切换', async () => {
    const ctx = await environment(); const low = await ready(ctx, 5, { rebuild: true, goal: 10 });
    const under = await publish(low); assert.equal(under.outcome, 'staged'); assert.equal(under.reason, 'below_rebuild_target');
    assert.equal((await taskState(low)).rebuild.status, 'running'); await assertActive(ctx, null, null, 0);
    const reached = await ready(ctx, 10, { rebuildId: low.task.rebuild_record_id });
    assert.equal((await publish(reached, 'staging')).outcome, 'staged');
    let state = await publicationState(ctx); assert.equal(state.checkpoints.length, 1); assert.equal(state.checkpoints[0].state, 'staging'); assert.equal(Number(state.checkpoints[0].current_watermark), 10);
    const response = await publish(reached, 'active', 'rebuild target reached and validation passed'); assert.equal(response.outcome, 'published');
    state = await assertActive(ctx, reached, 10, 1); assert.deepEqual(state.checkpoints.map((row) => row.state), ['active']);
    const governance = await taskState(reached); assert.equal(governance.task.status, 'completed'); assert.equal(governance.rebuild.status, 'switched');
    assert.equal(governance.rebuild.switched_attempt_id, reached.attempt.attempt_id); assert.ok(governance.rebuild.switched_at); assert.ok(governance.rebuild.verified_at); assert.equal(governance.rebuild.switch_reason, 'rebuild target reached and validation passed');
    assert.equal((await publish(reached)).outcome, 'idempotent'); assert.deepEqual((await taskState(reached)).rebuild, governance.rebuild);
    return { stage: 'staging then active COMMIT', evidence: `目标G=10，Canon C=20；水位5未完成重建；水位10验证后切换，active A=10，lag=10；switched 实际Attempt=${governance.rebuild.switched_attempt_id}，时间=${governance.rebuild.switched_at}；同Attempt不再同时占用staging` };
  });
  await sub(t, '重建期间 active 更高，切换时重新读取当前值', async () => {
    const ctx = await environment(); const rebuild = await ready(ctx, 10, { rebuild: true, goal: 10 }); await publish(rebuild, 'staging');
    const newer = await ready(ctx, 15); await publish(newer);
    const response = await publish(rebuild); assert.equal(response.outcome, 'staging_idempotent'); assert.equal(response.reason, 'lower_active');
    await assertActive(ctx, newer, 15, 1); const governance = await taskState(rebuild);
    assert.equal(governance.rebuild.status, 'running'); assert.equal(governance.rebuild.switched_at, null);
    return { stage: 'rebuild activation recheck', evidence: `重建目标=10，开始时无active；切换时 active=15；返回=${JSON.stringify(response)}；不写 switched，不覆盖15` };
  });
  await sub(t, 'Rebuild 可来自真实 Outbox，不伪造缺失 Outbox', async () => {
    const ctx = await environment(); const ordinary = await ready(ctx, 5); await publish(ordinary);
    const rebuild = await ready(ctx, 5, { rebuild: true, goal: 5, sourceOutbox: ordinary.task.outbox_id });
    assert.equal((await publish(rebuild)).outcome, 'idempotent');
    const governance = await taskState(rebuild); assert.equal(governance.rebuild.source_commit_id, null); assert.equal(governance.rebuild.source_outbox_id, ordinary.task.outbox_id); assert.equal(governance.rebuild.status, 'switched');
    await assertActive(ctx, ordinary, 5, 1); return '重建来源为既有真实Outbox，普通已发布同内容可幂等复用；没有创建替代Outbox';
  });
});

scenario('C：新 Attempt 发布后，旧 expired Worker 只能留下隔离结果', async (t) => {
  await sub(t, '新旧执行身份与不可变结果', async () => {
    const ctx = await environment({ timeoutMs: 600 }); const old = await newWork(ctx, 5); await past(old.attempt);
    const retry = await invoke('retry_attempt', old.attempt.attempt_id, 'same-worker-software-v1'); assert.equal(retry.outcome, 'retried');
    const fresh = await isolated({ ...old, attempt: retry.attempt }, { data: 'new execution snapshot' });
    assert.equal((await invoke('accept_success', fresh.attempt.attempt_id, fresh.result.content_hash, fresh.result.result_ref)).outcome, 'accepted_success');
    await tx(async (c) => { await insert(c, 'result_permission_fixture', { result_id: fresh.result.result_id, decision: 'allow', basis: 'fixture allow fresh execution' }); await c.query('COMMIT'); });
    await invoke('verify_result', fresh.result.result_id, fresh.attempt.attempt_id); assert.equal((await publish(fresh)).outcome, 'published');
    const before = await publicationState(ctx);
    const late = await isolated(old, { data: 'old worker writes after new active' });
    await tx(async (c) => { await insert(c, 'result_permission_fixture', { result_id: late.result.result_id, decision: 'allow', basis: 'permission does not grant execution identity' }); await c.query('COMMIT'); });
    const verified = await invoke('verify_result', late.result.result_id, old.attempt.attempt_id); assert.equal(verified.passed, false);
    const response = await publish(late); assert.equal(response.outcome, 'attempt_not_eligible');
    assert.deepEqual(await publicationState(ctx), before);
    await assertHistory(old.task.task_id, ['expired', 'succeeded'], ['claimed', 'expired', 'retried', 'succeeded']);
    return { stage: 'late external-write simulation', constraint: response.constraint, evidence: `新Attempt=${fresh.attempt.attempt_id} 已发布；旧expired ID=${old.attempt.attempt_id} 仍以独立PID=${late.resultPid} 提交隔离结果，但无资格切换；active/Checkpoint/历史保持逐字段相同` };
  });
});

scenario('D：结果先独立提交，发布 COMMIT/ROLLBACK/后续步骤失败的原子边界', async (t) => {
  for (const disposition of ['ROLLBACK', 'COMMIT', 'later_failure']) await sub(t, disposition, async () => {
    const ctx = await environment(); const original = await ready(ctx, 5); await publish(original);
    const next = await ready(ctx, 10, { rebuild: true, goal: 10 });
    const before = await publicationState(ctx); const governanceBefore = await taskState(next);
    let ownVisible; let observerVisible; let publishingPid; let failure;
    if (disposition === 'later_failure') {
      failure = await tx((c) => expectSql(() => call(c, 'publish_result', next.attempt.attempt_id, next.result.result_id, 'active', ' '), 'AFTER receipt: Rebuild switch CHECK', '23514', 'ck_rebuild_switch_reason'));
    } else {
      await tx(async (c) => {
        publishingPid = await pid(c); assert.notEqual(publishingPid, next.resultPid);
        const response = await call(c, 'publish_result', next.attempt.attempt_id, next.result.result_id, 'active', 'target reached'); assert.equal(response.outcome, 'published');
        ownVisible = (await c.query(`SELECT current_watermark,result_id FROM ${q('projection_active_pointer')} WHERE normalized_scope_hash=$1 AND strategy_version=$2 AND target=$3`, [ctx.scopeHash, ctx.strategy, ctx.target])).rows[0];
        assert.equal(Number(ownVisible.current_watermark), 10);
        assert.equal((await c.query(`SELECT status FROM ${q('projection_task')} WHERE task_id=$1`, [next.task.task_id])).rows[0].status, 'completed');
        assert.equal((await c.query(`SELECT status FROM ${q('projection_rebuild_record')} WHERE rebuild_record_id=$1`, [next.task.rebuild_record_id])).rows[0].status, 'switched');
        observerVisible = await publicationState(ctx); assert.deepEqual(observerVisible, before); assert.deepEqual(await taskState(next), governanceBefore);
        await c.query(disposition);
      });
    }
    if (disposition === 'COMMIT') { await assertActive(ctx, next, 10, 2); assert.equal((await taskState(next)).rebuild.status, 'switched'); }
    else { assert.deepEqual(await publicationState(ctx), before); assert.deepEqual(await taskState(next), governanceBefore); }
    await observe(async (c) => {
      const isolatedRow = (await c.query(`SELECT * FROM ${q('projection_result_version')} WHERE result_id=$1`, [next.result.result_id])).rows[0];
      assert.ok(isolatedRow); assert.deepEqual(isolatedRow.payload, next.payload); assert.equal(isolatedRow.content_hash, next.result.content_hash);
    });
    return failure ? { ...failure, evidence: `${failure.evidence}；收据后的 Task completed、Rebuild switched 步骤失败，前面的Checkpoint/指针/发布历史全部回滚；先独立提交的隔离结果仍存在` }
      : { stage: disposition, evidence: `隔离结果PID=${next.resultPid} 先独立提交；发布PID=${publishingPid} 内可见 active=10、Task completed、Rebuild switched；提交前独立观察仍active=5且治理/历史全旧；${disposition} 后 ${disposition === 'COMMIT' ? '全部新状态一起可见' : 'Checkpoint/指针/Task/Rebuild/历史一起恢复，隔离结果保留'}` };
  });
});

scenario('D：直接 DML、验证依据、来源绑定及历史保护', async (t) => {
  const ctx = await environment(); const work = await ready(ctx, 5); await publish(work);
  const other = await ready(await environment(), 6);
  const before = await publicationState(ctx);
  for (const [name, action, constraint] of [
    ['提高Checkpoint水位', (c) => c.query(`UPDATE ${q('projection_checkpoint')} SET current_watermark=999 WHERE last_successful_attempt_id=$1`, [work.attempt.attempt_id]), 'publication_read_only'],
    ['替换active结果', (c) => c.query(`UPDATE ${q('projection_active_pointer')} SET result_id=$1 WHERE last_successful_attempt_id=$2`, [other.result.result_id, work.attempt.attempt_id]), 'publication_read_only'],
    ['删除Checkpoint', (c) => c.query(`DELETE FROM ${q('projection_checkpoint')} WHERE last_successful_attempt_id=$1`, [work.attempt.attempt_id]), 'publication_read_only'],
    ['伪造Checkpoint INSERT', (c) => insert(c, 'projection_checkpoint', { target: 'graph', current_watermark: 999, state: 'active' }), 'publication_read_only'],
    ['伪造发布收据水位', (c) => insert(c, 'publication_receipt', { attempt_id: work.attempt.attempt_id, result_id: work.result.result_id, requested_state: 'active', reason: 'fake', watermark: 999 }), 'publication_receipt_derived'],
    ['改写验证通过标志', (c) => c.query(`UPDATE ${q('projection_result_verification')} SET passed=false WHERE verification_id=$1`, [work.verification.verification_id]), 'publication_immutable'],
    ['改写已发布载荷', (c) => c.query(`UPDATE ${q('projection_result_version')} SET payload='{"fake":true}' WHERE result_id=$1`, [work.result.result_id]), 'publication_immutable'],
    ['改绑结果Attempt', (c) => c.query(`UPDATE ${q('projection_result_version')} SET attempt_id=$1 WHERE result_id=$2`, [other.attempt.attempt_id, work.result.result_id]), 'publication_immutable'],
    ['改绑Task来源', (c) => c.query(`UPDATE ${q('projection_task')} SET snapshot_commit_id=$1 WHERE task_id=$2`, [other.task.snapshot_commit_id, work.task.task_id]), 'projection_input_immutable'],
    ['改绑Checkpoint身份', (c) => c.query(`UPDATE ${q('checkpoint_slot')} SET normalized_scope_hash=$1 WHERE identity_id=(SELECT identity_id FROM ${q('projection_active_pointer')} WHERE result_id=$2)`, [other.ctx.scopeHash, work.result.result_id]), 'publication_immutable'],
    ['改写收据摘要', (c) => c.query(`UPDATE ${q('publication_receipt')} SET content_hash='fake' WHERE result_id=$1`, [work.result.result_id]), 'publication_immutable'],
  ]) await sub(t, name, async () => { const error = await tx((c) => expectSql(() => action(c), 'direct DML', '23514', constraint)); assert.deepEqual(await publicationState(ctx), before); return error; });
  for (const table of ['projection_result_version', 'publication_receipt', 'projection_result_verification']) for (const operation of ['DELETE', 'TRUNCATE']) await sub(t, `${table}/${operation}`, async () => {
    const error = await tx((c) => expectSql(() => c.query(operation === 'DELETE' ? `DELETE FROM ${q(table)} WHERE result_id=$1` : `TRUNCATE ${q(table)} CASCADE`, operation === 'DELETE' ? [work.result.result_id] : []), operation, '23514', 'publication_immutable'));
    assert.deepEqual(await publicationState(ctx), before); return error;
  });
  await sub(t, '失败验证不能用 passed=true 绕过', async () => {
    const bad = await ready(await environment(), 5, { claimedHash: 'wrong-hash' }); assert.equal(bad.verification.passed, false);
    const error = await tx((c) => expectSql(() => insert(c, 'projection_result_verification', { result_id: bad.result.result_id, attempt_id: bad.attempt.attempt_id, passed: true }), 'verification INSERT', '23514', 'publication_validation_derived'));
    await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_result_verification')} SET passed=true WHERE verification_id=$1`, [bad.verification.verification_id]), 'verification UPDATE', '23514', 'publication_immutable'));
    assert.equal((await publish(bad)).outcome, 'content_hash_mismatch'); await assertActive(bad.ctx, null, null, 0); return error;
  });
  await sub(t, 'Rebuild 目标和来源不可改写', async () => {
    const rebuild = await ready(await environment(), 5, { rebuild: true, goal: 10 });
    for (const field of ['target_watermark', 'source_from_watermark', 'source_commit_id', 'strategy_version']) {
      const replacement = { target_watermark: 5, source_from_watermark: 1, source_commit_id: other.task.snapshot_commit_id, strategy_version: other.ctx.strategy }[field];
      await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_rebuild_record')} SET ${field}=$1 WHERE rebuild_record_id=$2`, [replacement, rebuild.task.rebuild_record_id]), 'Rebuild UPDATE', '23514', 'projection_input_immutable'));
    }
    return { stage: 'Rebuild UPDATE', code: '23514', constraint: 'projection_input_immutable', evidence: '分别改变真实目标水位、起始水位、真实Commit来源、真实策略；全部拒绝' };
  });
});

scenario('D：项目、目标、子范围、策略相互独立及稳定根范围', async (t) => {
  await sub(t, '五组发布身份彼此隔离', async () => {
    const base = await environment();
    const contexts = [base,
      await environment({ projectId: base.projectId, strategy: base.strategy, scopeKey: 'chapter:one' }),
      await environment({ projectId: base.projectId, strategy: base.strategy, target: 'vector' }),
      await environment({ projectId: base.projectId, scopeKey: '$root' }),
      await environment({ strategy: base.strategy })];
    const works = [];
    for (let i = 0; i < contexts.length; i += 1) { const work = await ready(contexts[i], i === 1 ? 6 : 5); assert.equal((await publish(work)).outcome, 'published'); works.push(work); }
    for (let i = 0; i < works.length; i += 1) await assertActive(contexts[i], works[i], i === 1 ? 6 : 5, 1);
    assert.notEqual(base.scopeHash, contexts[4].scopeHash, 'different projects with the same root name must differ');
    await observe(async (c) => { assert.equal(await call(c, 'normalized_scope', base.projectId, ''), base.scopeHash); assert.equal(await call(c, 'normalized_scope', base.projectId, '  '), base.scopeHash); });
    return '同名根范围含项目身份；空/空白范围规范化为稳定 $root；不同项目、目标、范围、策略均拥有独立active';
  });
});

async function publicationRace(first, second) {
  const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
  let firstReturn; let secondReturn; let wait; let aPid; let bPid;
  try {
    await begin(a); await begin(b); aPid = await pid(a); bPid = await pid(b);
    firstReturn = await first(a);
    const pending = second(b); pending.catch(() => {});
    wait = await blocked(observer, bPid, aPid);
    await a.query('COMMIT'); secondReturn = await pending; await b.query('COMMIT');
  } finally { await close(a); await close(b); await observer.end(); }
  return { firstReturn, secondReturn, evidence: `A PID=${aPid}, B PID=${bPid}; 等待=${JSON.stringify(wait)}；先A首次COMMIT释放锁，再B返回并首次COMMIT；返回A=${JSON.stringify(firstReturn)}，B=${JSON.stringify(secondReturn)}；无死锁重试` };
}
const publishOn = (c, work) => call(c, 'publish_result', work.attempt.attempt_id, work.result.result_id, 'active', 'fixture race publication');

scenario('E：无 active、低高顺序及同水位发布竞争', async (t) => {
  await sub(t, '无active时两个首次发布', async () => {
    const ctx = await environment(); const low = await ready(ctx, 5); const high = await ready(ctx, 10);
    assert.equal((await publicationState(ctx)).pointer.length, 0);
    const race = await publicationRace((c) => publishOn(c, low), (c) => publishOn(c, high));
    assert.equal(race.firstReturn.outcome, 'published'); assert.equal(race.secondReturn.outcome, 'published');
    const state = await assertActive(ctx, high, 10, 2);
    assert.equal(new Set(state.checkpoints.map((row) => row.checkpoint_id)).size, state.checkpoints.length);
    return { stage: 'initial identity UPSERT / COMMIT', evidence: `${race.evidence}；唯一插入处理身份最初不存在；最终一个active=10` };
  });
  for (const first of ['low', 'high']) await sub(t, `已有active时/${first}先提交`, async () => {
    const ctx = await environment(); const base = await ready(ctx, 3); await publish(base);
    const low = await ready(ctx, 5); const high = await ready(ctx, 10);
    const race = await publicationRace((c) => publishOn(c, first === 'low' ? low : high), (c) => publishOn(c, first === 'low' ? high : low));
    assert.equal(race.firstReturn.outcome, 'published'); assert.equal(race.secondReturn.outcome, first === 'low' ? 'published' : 'staged');
    await assertActive(ctx, high, 10, first === 'low' ? 3 : 2);
    return { stage: 'identity row lock / COMMIT', evidence: `${race.evidence}；两种顺序均最终active=10，不回退` };
  });
  for (const same of [true, false]) await sub(t, `同水位/${same ? '同摘要幂等' : '不同摘要冲突'}`, async () => {
    const ctx = await environment();
    // Distinct legitimate Rebuild ranges permit two real pending Tasks for the
    // same snapshot; no duplicate ordinary Outbox Task is fabricated.
    const first = await ready(ctx, 5, { rebuild: true, from: 0 });
    const second = await ready(ctx, 5, { rebuild: true, from: 1, data: same ? undefined : 'conflicting snapshot' });
    assert.equal(first.result.content_hash === second.result.content_hash, same);
    const race = await publicationRace((c) => publishOn(c, first), (c) => publishOn(c, second));
    assert.equal(race.firstReturn.outcome, 'published'); assert.equal(race.secondReturn.outcome, same ? 'idempotent' : 'watermark_conflict');
    await assertActive(ctx, first, 5, 1);
    const secondState = await taskState(second); assert.equal(secondState.rebuild.status, same ? 'switched' : 'running');
    return { stage: 'same-watermark identity lock / COMMIT', constraint: race.secondReturn.constraint, evidence: `${race.evidence}；只一份有效发布历史，第一份载荷/指针保留` };
  });
});

scenario('E：发布与来源资格失效的两种顺序', async (t) => {
  for (const first of ['invalidation', 'publication']) await sub(t, first, async () => {
    const ctx = await environment(); const work = await ready(ctx, 5);
    const revoke = (c) => call(c, 'invalidate_task', work.task.task_id, 'cancelled', 'explicit fixture source revocation');
    const race = await publicationRace((c) => first === 'invalidation' ? revoke(c) : publishOn(c, work), (c) => first === 'invalidation' ? publishOn(c, work) : revoke(c));
    if (first === 'invalidation') { assert.equal(race.secondReturn.outcome, 'source_ineligible'); await assertActive(ctx, null, null, 0); assert.equal((await taskState(work)).task.status, 'cancelled'); }
    else { assert.equal(race.firstReturn.outcome, 'published'); await assertActive(ctx, work, 5, 1); assert.equal((await taskState(work)).task.status, 'completed'); }
    const before = await publicationState(ctx);
    assert.equal((await publish(work)).outcome, 'source_ineligible'); assert.deepEqual(await publicationState(ctx), before);
    await assertHistory(work.task.task_id, ['succeeded'], ['claimed', 'succeeded']);
    await observe(async (c) => assert.equal((await c.query(`SELECT count(*)::int AS count FROM ${q('projection_task_invalidation')} WHERE task_id=$1`, [work.task.task_id])).rows[0].count, 1));
    return { stage: 'Task lock / source recheck / COMMIT', evidence: `${race.evidence}；后续资格失效有独立不可变记录；已发生的发布与成功历史不被改写成未发生` };
  });
  await sub(t, 'Rebuild abandoned 先提交', async () => {
    const ctx = await environment(); const work = await ready(ctx, 5, { rebuild: true });
    const race = await publicationRace(async (c) => { await c.query(`UPDATE ${q('projection_rebuild_record')} SET status='abandoned' WHERE rebuild_record_id=$1`, [work.task.rebuild_record_id]); return { outcome: 'abandoned' }; }, (c) => publishOn(c, work));
    assert.equal(race.secondReturn.outcome, 'rebuild_ineligible'); await assertActive(ctx, null, null, 0);
    return { stage: 'Task→Attempt→Rebuild lock / COMMIT', constraint: race.secondReturn.constraint, evidence: race.evidence };
  });
});

scenario('E：不同发布身份首次异步 COMMIT 相互独立', async (t) => {
  await sub(t, '同项目不同范围', async () => {
    const firstContext = await environment(); const secondContext = await environment({ projectId: firstContext.projectId, strategy: firstContext.strategy, scopeKey: 'other-chapter' });
    const works = [await ready(firstContext, 5), await ready(secondContext, 6)];
    const [a, b, observer] = await Promise.all([connect(), connect(), connect()]); let pids; let returns; let activity;
    try {
      await begin(a); await begin(b); pids = await Promise.all([pid(a), pid(b)]);
      returns = await Promise.all([publishOn(a, works[0]), publishOn(b, works[1])]);
      assert.deepEqual(returns.map((row) => row.outcome), ['published', 'published']);
      activity = (await observer.query(`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=ANY($1::int[]) ORDER BY pid`, [pids])).rows;
      assert.deepEqual(activity.flatMap((row) => row.blockers), []);
      const commits = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]); for (const commit of commits) assert.equal(commit.status, 'fulfilled', commit.reason?.message);
    } finally { await close(a); await close(b); await observer.end(); }
    await assertActive(firstContext, works[0], 5, 1); await assertActive(secondContext, works[1], 6, 1);
    return { stage: 'first asynchronous COMMIT', evidence: `PID=${pids}；返回=${JSON.stringify(returns)}；观察=${JSON.stringify(activity)}；首次真实异步COMMIT均成功、无重试` };
  });
});

scenario('A：回归 Attempt 锁后截止、终态不可变及过期重试', async (t) => {
  await sub(t, 'Attempt锁等待跨截止及旧执行隔离', async () => {
    const ctx = await environment({ timeoutMs: 1000 }); const work = await newWork(ctx, 5);
    const [holder, worker, observer] = await Promise.all([connect(), connect(), connect()]); let wait; let crossed; let response; let pids;
    try {
      await begin(holder); await begin(worker); pids = await Promise.all([pid(holder), pid(worker)]);
      await holder.query(`SELECT 1 FROM ${q('projection_attempt')} WHERE attempt_id=$1 FOR UPDATE`, [work.attempt.attempt_id]);
      const before = (await observer.query('SELECT clock_timestamp() < $1::timestamptz AS valid', [work.attempt.expires_at])).rows[0]; assert.equal(before.valid, true);
      const pending = call(worker, 'accept_success', work.attempt.attempt_id, 'late-hash', 'late-ref'); pending.catch(() => {});
      wait = await blocked(observer, pids[1], pids[0]);
      assert.equal((await observer.query('SELECT query_start < $1::timestamptz AS valid FROM pg_stat_activity WHERE pid=$2', [work.attempt.expires_at, pids[1]])).rows[0].valid, true);
      crossed = await waitPast(observer, work.attempt.expires_at); await holder.query('COMMIT'); response = await pending; assert.equal(response.outcome, 'deadline_elapsed'); await worker.query('COMMIT');
    } finally { await close(holder); await close(worker); await observer.end(); }
    await assertHistory(work.task.task_id, ['processing'], ['claimed']);
    assert.equal((await invoke('expire_attempt', work.attempt.attempt_id)).outcome, 'expired');
    const retry = await invoke('retry_attempt', work.attempt.attempt_id, 'same-worker-software-v1'); assert.equal(retry.outcome, 'retried'); assert.equal(retry.attempt.attempt_no, 2);
    await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET status='succeeded',result_hash='fake',result_ref='fake' WHERE attempt_id=$1`, [work.attempt.attempt_id]), 'old terminal UPDATE', '23514', 'projection_attempt_terminal'));
    await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET expires_at=expires_at+interval '1 day' WHERE attempt_id=$1`, [retry.attempt.attempt_id]), 'deadline UPDATE', '23514', 'projection_attempt_identity'));
    await assertHistory(work.task.task_id, ['expired', 'processing'], ['claimed', 'expired', 'retried']);
    assert.deepEqual((await publicationState(ctx)).checkpoints, []);
    return { stage: 'lock wait→expire→retry', evidence: `PID=${pids}; ${JSON.stringify(wait)}；数据库跨截止=${crossed} 后释放holder，完成返回=${response.outcome}；合法过期后新ID=${retry.attempt.attempt_id}，旧终态不能伪造成功、截止不可延长` };
  });
});

scenario('E：public直连、函数配置、Checkpoint身份及结果幂等元数据', async (t) => {
  await sub(t, '所有函数实际固定路径且无SECURITY DEFINER或会话授权开关', async () => observe(async (c) => {
    const functions = (await c.query(`SELECT proname,proconfig,prosecdef,prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY proname`, [SCHEMA])).rows;
    assert.ok(functions.length >= 25);
    for (const fn of functions) {
      assert.deepEqual(fn.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]); assert.equal(fn.prosecdef, false);
      assert.doesNotMatch(fn.prosrc, /current_setting|set_config/);
    }
    const eligibility = functions.find((fn) => fn.proname === 'result_problem').prosrc;
    assert.match(eligibility, /a.ended_at>=a.expires_at/); assert.doesNotMatch(eligibility, /clock_timestamp|statement_timestamp|transaction_timestamp/);
    return `pg_proc实测=${JSON.stringify(functions.map(({ prosrc, ...row }) => row))}；发布资格仅比较已保存ended_at与expires_at`;
  }));
  await sub(t, 'Checkpoint四字段唯一身份与版本化结果完整幂等键', async () => observe(async (c) => {
    const rows = (await c.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=$1::regnamespace AND conname IN ('uq_projection_checkpoint_identity','uq_publication_identity','uq_result_snapshot','uq_projection_attempt_number') ORDER BY conname`, [SCHEMA])).rows;
    const checkpoint = rows.find((row) => row.conname === 'uq_projection_checkpoint_identity');
    assert.equal(checkpoint.definition, 'UNIQUE (target, normalized_scope_hash, strategy_version, state)');
    const result = rows.find((row) => row.conname === 'uq_result_snapshot');
    for (const field of ['attempt_id','origin_type','source_id','project_id','target','normalized_scope_hash','strategy_version','watermark','content_hash']) assert.ok(result.definition.includes(field));
    assert.ok(!result.definition.includes('worker_version'));
    return `实际约束=${JSON.stringify(rows)}；身份槽加验证收据读模型确保每个state最多一条当前Checkpoint`;
  }));
  await sub(t, '关键触发器、所有FK本Schema、结果真实内容生成摘要', async () => observe(async (c) => {
    const triggers = (await c.query(`SELECT c.relname,t.tgname,t.tgtype FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY tgname`, [SCHEMA])).rows;
    for (const name of ['attempt_update_guard','attempt_insert_guard','result_mapping','verification_derived','publication_receipt_guard','publication_governance','projection_checkpoint_read_only','projection_active_pointer_read_only','publication_receipt_no_truncate']) assert.ok(triggers.some((row) => row.tgname === name), name);
    const fks = (await c.query(`SELECT rn.nspname AS target FROM pg_constraint f JOIN pg_class l ON l.oid=f.conrelid JOIN pg_namespace ln ON ln.oid=l.relnamespace JOIN pg_class r ON r.oid=f.confrelid JOIN pg_namespace rn ON rn.oid=r.relnamespace WHERE f.contype='f' AND ln.nspname=$1`, [SCHEMA])).rows;
    for (const fk of fks) assert.equal(fk.target, SCHEMA);
    const digest = (await c.query(`SELECT attgenerated,pg_get_expr(adbin,adrelid) AS expr FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=$1::regclass AND a.attname='content_hash'`, [q('projection_result_version')])).rows[0];
    assert.equal(digest.attgenerated, 's'); assert.match(digest.expr, /snapshot_digest\(payload\)/);
    return `实际触发器=${JSON.stringify(triggers)}；${fks.length}个业务FK均在本Schema；实际摘要列=${JSON.stringify(digest)}`;
  }));
  await sub(t, '逻辑结果重复写入复用，载荷与验证不被覆盖', async () => {
    const ctx = await environment(); const work = await ready(ctx, 5);
    const repeated = await invoke('store_result', work.attempt.attempt_id, work.payload, work.result.result_ref);
    assert.equal(repeated.result_id, work.result.result_id);
    const validation = await invoke('verify_result', work.result.result_id, work.attempt.attempt_id); assert.equal(validation.verification_id, work.verification.verification_id);
    assert.equal((await publish(work)).outcome, 'published');
    await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_checkpoint')} SET current_watermark=999 WHERE last_successful_attempt_id=$1`, [work.attempt.attempt_id]), 'public fully qualified UPDATE', '23514', 'publication_read_only'));
    await assertActive(ctx, work, 5, 1);
    return '所有连接全新直连、search_path=public、业务对象全限定；结果/验证重复写入复用既有ID，合法发布与直接DML保护均生效';
  });
});


scenario('C：staging 同水位幂等、冲突与低水位保护', async (t) => {
  await sub(t, '同水位同内容复用、不同内容拒绝、低水位仅隔离', async () => {
    const ctx = await environment();
    const first = await ready(ctx, 5, { rebuild: true, goal: 10, from: 0 });
    assert.equal((await publish(first)).outcome, 'staged');
    const before = await publicationState(ctx);
    const same = await ready(ctx, 5, { rebuild: true, goal: 10, from: 1 });
    assert.equal((await publish(same)).outcome, 'staging_idempotent');
    assert.deepEqual((await publicationState(ctx)).checkpoints, before.checkpoints);
    const different = await ready(ctx, 5, { rebuild: true, goal: 10, from: 2, data: 'different staging snapshot' });
    const conflict = await publish(different); assert.equal(conflict.outcome, 'watermark_conflict');
    const lower = await ready(ctx, 3);
    const isolated = await publish(lower, 'staging'); assert.equal(isolated.outcome, 'isolated'); assert.equal(isolated.reason, 'lower_staging');
    const final = await publicationState(ctx); assert.deepEqual(final.checkpoints, before.checkpoints); assert.deepEqual(final.history, []);
    assert.equal((await taskState(same)).rebuild.status, 'running');
    return { stage: 'staging qualification', constraint: conflict.constraint, evidence: 'staging水位5同内容返回staging_idempotent且不换指针，不同内容明确冲突；水位3仅留隔离区；无active发布、无Rebuild switched' };
  });
});
