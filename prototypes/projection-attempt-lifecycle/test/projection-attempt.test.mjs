import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const SCHEMA = 'projection_attempt_fixture';
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
  return (await c.query(`SELECT ${q(name)}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS response`, args)).rows[0].response;
}
async function invoke(name, ...args) {
  return tx(async (c) => { const response = await call(c, name, ...args); await c.query('COMMIT'); return response; });
}
async function success(c, attemptId) { return call(c, 'accept_success', attemptId, resultHash, resultRef); }

async function seed(c, options = {}) {
  const projectId = id('project');
  const commitId = id('commit');
  const strategy = id('strategy');
  const outboxId = id('outbox');
  const taskId = id('task');
  await insert(c, 'project', { project_id: projectId });
  await insert(c, 'canon_commit', { canon_commit_id: commitId, project_id: projectId, canon_watermark: 1 });
  await insert(c, 'projection_policy', { strategy_version: strategy, timeout_ms: options.timeoutMs ?? 30_000 });
  await insert(c, 'projection_outbox', { outbox_id: outboxId, project_id: projectId, canon_commit_id: commitId, target: 'graph', scope_hash: 'sha256:scope', source_canon_watermark: 1, strategy_version: strategy, event_hash: 'sha256:event' });
  await insert(c, 'projection_task', { task_id: taskId, project_id: projectId, outbox_id: outboxId, target: 'graph', scope_hash: 'sha256:scope', strategy_version: strategy, status: options.status ?? 'pending' });
  return { taskId, projectId, commitId, strategy, outboxId, timeoutMs: options.timeoutMs ?? 30_000 };
}
async function task(options = {}) { return tx(async (c) => { const graph = await seed(c, options); await c.query('COMMIT'); return graph; }); }
async function processing(options = {}) {
  const graph = await task(options);
  const response = await invoke('claim_attempt', graph.taskId, options.worker ?? 'worker-v1');
  assert.equal(response.outcome, 'created');
  return { graph, attempt: response.attempt };
}
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

scenario('A：领取身份、策略时间与可执行 Task', async (t) => {
  await sub(t, '首次领取与未过期重复领取', async () => {
    const { graph, attempt } = await processing();
    const again = await invoke('claim_attempt', graph.taskId, 'worker-v2');
    assert.equal(again.outcome, 'in_progress');
    assert.equal(again.attempt.attempt_id, attempt.attempt_id);
    const saved = await assertHistory(graph.taskId, ['processing'], ['claimed']);
    await observe(async (c) => {
      const row = (await c.query(`SELECT extract(epoch FROM expires_at-started_at)*1000 AS duration,
        started_at <= clock_timestamp() AS started FROM ${q('projection_attempt')} WHERE attempt_id=$1`, [attempt.attempt_id])).rows[0];
      assert.equal(Number(row.duration), graph.timeoutMs); assert.equal(row.started, true);
    });
    assert.equal(saved.attempts[0].worker_version, 'worker-v1');
    assert.equal(attempt.attempt_no, 1); assert.equal(attempt.ended_at, null);
    return `created→in_progress，同一 attempt_id=${attempt.attempt_id}；时长来自策略 ${graph.timeoutMs}ms；单一 processing`;
  });
  await sub(t, '不同 Task 可使用相同 worker_version', async () => {
    const first = await processing({ worker: 'same-software-version' });
    const second = await processing({ worker: 'same-software-version' });
    assert.notEqual(first.attempt.attempt_id, second.attempt.attempt_id);
    for (const value of [first, second]) await assertHistory(value.graph.taskId, ['processing'], ['claimed']);
    return '两个不同 Task 各自首次领取成功；worker_version 相同，执行身份不同';
  });
  for (const status of ['completed', 'cancelled', 'abandoned', 'needs_rebuild']) await sub(t, `${status} 不自动恢复`, async () => {
    const graph = await task({ status });
    assert.equal((await invoke('claim_attempt', graph.taskId, 'worker-v1')).outcome, 'task_not_executable');
    await assertHistory(graph.taskId, [], []);
    const result = await tx((c) => expectSql(() => insert(c, 'projection_attempt', { task_id: graph.taskId, worker_version: 'v' }), 'direct INSERT', '55000', 'projection_task_not_executable'));
    return { ...result, evidence: '入口返回 task_not_executable；普通 INSERT 同样拒绝；无 Attempt/审计残留' };
  });
});

scenario('A：成功、截止拒绝、过期与执行失败', async (t) => {
  await sub(t, '截止前成功、幂等回读与终态不改写', async () => {
    const { graph, attempt } = await processing({ timeoutMs: 350 });
    const accepted = await invoke('accept_success', attempt.attempt_id, resultHash, resultRef);
    assert.equal(accepted.outcome, 'accepted_success');
    assert.equal((await invoke('accept_success', attempt.attempt_id, resultHash, resultRef)).outcome, 'idempotent_success');
    assert.equal((await invoke('accept_success', attempt.attempt_id, 'different-hash', 'different-ref')).outcome, 'already_terminal');
    const databaseTime = await past(attempt);
    assert.equal((await invoke('expire_attempt', attempt.attempt_id)).outcome, 'already_terminal');
    assert.equal((await invoke('claim_attempt', graph.taskId, 'v')).outcome, 'already_succeeded');
    assert.equal((await invoke('retry_attempt', attempt.attempt_id, 'v')).outcome, 'not_retryable');
    const saved = await assertHistory(graph.taskId, ['succeeded'], ['claimed', 'succeeded']);
    assert.equal(saved.attempts[0].result_hash, resultHash); assert.equal(saved.attempts[0].result_ref, resultRef);
    return `accepted_success→idempotent_success；截止后 ${databaseTime} 仍 succeeded；ended_at=${saved.attempts[0].ended_at} < expires_at=${attempt.expires_at}`;
  });
  await sub(t, '截止前不能过期，截止后清理前不能成功', async () => {
    const { graph, attempt } = await processing({ timeoutMs: 250 });
    assert.equal((await invoke('expire_attempt', attempt.attempt_id)).outcome, 'not_expired');
    const databaseTime = await past(attempt);
    assert.equal((await invoke('accept_success', attempt.attempt_id, resultHash, resultRef)).outcome, 'deadline_elapsed');
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    assert.equal((await invoke('expire_attempt', attempt.attempt_id)).outcome, 'expired');
    const saved = await assertHistory(graph.taskId, ['expired'], ['claimed', 'expired']);
    return `数据库时间=${databaseTime} >= expires_at=${attempt.expires_at}；清理前成功入口返回 deadline_elapsed，无结果写入；expired ended_at=${saved.attempts[0].ended_at}`;
  });
  for (const failureStatus of ['retryable_failure', 'permanent_failure']) await sub(t, failureStatus, async () => {
    const { graph, attempt } = await processing();
    const response = await invoke('record_failure', attempt.attempt_id, failureStatus, 'fixture://failure/detail');
    assert.equal(response.outcome, 'failure_recorded');
    assert.equal((await invoke('record_failure', attempt.attempt_id, failureStatus, 'fixture://different-detail')).outcome, 'already_terminal');
    const retry = await invoke('retry_attempt', attempt.attempt_id, 'worker-v2');
    assert.equal(retry.outcome, failureStatus === 'retryable_failure' ? 'retried' : 'not_retryable');
    await assertHistory(graph.taskId, failureStatus === 'retryable_failure' ? [failureStatus, 'processing'] : [failureStatus], failureStatus === 'retryable_failure' ? ['claimed', failureStatus, 'retried'] : ['claimed', failureStatus]);
    return `failure_recorded；原失败详情保留；重试返回 ${retry.outcome}，不将旧 Attempt 改回 processing`;
  });
});

scenario('B：重试新身份、旧 Worker 隔离与原子回滚', async (t) => {
  for (const mode of ['expired', 'processing_overdue', 'retryable_failure']) await sub(t, mode, async () => {
    const { graph, attempt } = await processing({ timeoutMs: mode === 'retryable_failure' ? 30_000 : 180 });
    if (mode === 'retryable_failure') await invoke('record_failure', attempt.attempt_id, 'retryable_failure', 'fixture://failure');
    else { await past(attempt); if (mode === 'expired') await invoke('expire_attempt', attempt.attempt_id); }
    const response = await invoke('retry_attempt', attempt.attempt_id, 'same-worker-software');
    assert.equal(response.outcome, 'retried');
    assert.equal(response.attempt.attempt_no, 2); assert.notEqual(response.attempt.attempt_id, attempt.attempt_id);
    assert.equal(response.attempt.previous_attempt_id, attempt.attempt_id); assert.equal(response.attempt.task_id, graph.taskId);
    assert.equal((await invoke('accept_success', attempt.attempt_id, resultHash, resultRef)).outcome, 'already_terminal');
    assert.equal((await invoke('record_failure', attempt.attempt_id, 'retryable_failure', 'fixture://late-failure')).outcome, 'already_terminal');
    assert.equal((await invoke('retry_attempt', attempt.attempt_id, 'v')).outcome, 'superseded');
    await assertHistory(graph.taskId, [mode === 'retryable_failure' ? mode : 'expired', 'processing'], ['claimed', mode === 'retryable_failure' ? mode : 'expired', 'retried']);
    return `新 attempt_id=${response.attempt.attempt_id}, attempt_no=2, Task不变；旧ID回写仅返回 already_terminal，不影响新执行`;
  });
  await sub(t, '未过期不能重试', async () => {
    const { graph, attempt } = await processing();
    assert.equal((await invoke('retry_attempt', attempt.attempt_id, 'v')).outcome, 'in_progress');
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    return 'in_progress，无新 Attempt/审计';
  });
  for (const disposition of ['ROLLBACK', 'insert_failure']) await sub(t, `过期与重试一起回滚/${disposition}`, async () => {
    const { graph, attempt } = await processing({ timeoutMs: 100 });
    await past(attempt);
    let createdId;
    let failure;
    await tx(async (c) => {
      if (disposition === 'insert_failure') {
        failure = await expectSql(() => call(c, 'retry_attempt', attempt.attempt_id, ' '), 'retry INSERT CHECK', '23514', 'ck_projection_attempt_worker');
      } else {
        const response = await call(c, 'retry_attempt', attempt.attempt_id, 'v2');
        assert.equal(response.outcome, 'retried'); createdId = response.attempt.attempt_id;
        const local = (await c.query(`SELECT status FROM ${q('projection_attempt')} WHERE task_id=$1 ORDER BY attempt_no`, [graph.taskId])).rows;
        assert.deepEqual(local.map((row) => row.status), ['expired', 'processing']);
        await c.query('ROLLBACK');
      }
    });
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    return failure ?? `事务内已创建 ${createdId} 并终结旧 Attempt；ROLLBACK 后独立连接仅见原 processing，expired/retried 审计均消失`;
  });
});

scenario('B：普通 DML 的身份、时间、终态及历史保护', async (t) => {
  const { graph, attempt } = await processing();
  const alternate = await task();
  const fields = {
    attempt_id: id('forged_attempt'), task_id: alternate.taskId, attempt_no: 99,
    previous_attempt_id: attempt.attempt_id, worker_version: 'different-worker-version',
    started_at: '2000-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z',
  };
  for (const [field, value] of Object.entries(fields)) await sub(t, `${field} 不可改写`, async () => {
    const error = await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET ${field}=$1 WHERE attempt_id=$2`, [value, attempt.attempt_id]), 'UPDATE', '23514', 'projection_attempt_identity'));
    await assertHistory(graph.taskId, ['processing'], ['claimed']); return error;
  });
  await sub(t, '直接 INSERT 伪造 succeeded', async () => tx((c) => expectSql(() => insert(c, 'projection_attempt', {
    task_id: alternate.taskId, status: 'succeeded', worker_version: 'v', result_hash: resultHash, result_ref: resultRef,
    started_at: '2000-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', ended_at: '2000-01-02T00:00:00Z',
  }), 'INSERT', '23514', 'projection_attempt_initial_state')));
  await sub(t, '不能自己指定领取时间', async () => tx((c) => expectSql(() => insert(c, 'projection_attempt', {
    task_id: alternate.taskId, worker_version: 'v', started_at: '2000-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z',
  }), 'INSERT', '23514', 'projection_attempt_time_authority')));
  await sub(t, '第二个 processing 不能直接 INSERT', async () => tx((c) => expectSql(() => insert(c, 'projection_attempt', { task_id: graph.taskId, worker_version: 'same-software' }), 'INSERT', '55000', 'projection_attempt_in_progress')));
  for (const terminalStatus of ['succeeded', 'retryable_failure', 'expired']) await sub(t, `UPDATE 伪造 ended_at/${terminalStatus}`, async () => tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET status=$1, ended_at=started_at WHERE attempt_id=$2`, [terminalStatus, attempt.attempt_id]), 'UPDATE', '23514', 'projection_attempt_time_authority')));
  for (const [hash, ref] of [[null, resultRef], [resultHash, null], [' ', resultRef], [resultHash, ' ']]) await sub(t, `成功结果必须完整/${JSON.stringify([hash, ref])}`, async () => tx((c) => expectSql(() => call(c, 'accept_success', attempt.attempt_id, hash, ref), 'success UPDATE CHECK', '23514', 'ck_projection_attempt_lifecycle')));
  for (const operation of ['DELETE', 'TRUNCATE']) await sub(t, `历史 ${operation}`, async () => {
    const error = await tx((c) => expectSql(() => c.query(operation === 'DELETE' ? `DELETE FROM ${q('projection_attempt')} WHERE attempt_id=$1` : `TRUNCATE ${q('projection_attempt')} CASCADE`, operation === 'DELETE' ? [attempt.attempt_id] : []), operation, '23514', 'projection_attempt_immutable'));
    await assertHistory(graph.taskId, ['processing'], ['claimed']); return error;
  });
  for (const status of ['succeeded', 'expired', 'retryable_failure', 'permanent_failure']) await sub(t, `终态不可改写/${status}`, async () => {
    const own = await processing({ timeoutMs: status === 'expired' ? 80 : 30_000 });
    if (status === 'succeeded') await invoke('accept_success', own.attempt.attempt_id, resultHash, resultRef);
    else if (status === 'expired') { await past(own.attempt); await invoke('expire_attempt', own.attempt.attempt_id); }
    else await invoke('record_failure', own.attempt.attempt_id, status, 'fixture://failure');
    const before = await state(own.graph.taskId);
    for (const change of ["status='processing'", "status='succeeded', result_hash='fake', result_ref='fake'", "ended_at=ended_at+interval '1 second'", "result_ref='overwritten'"]) {
      await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET ${change} WHERE attempt_id=$1`, [own.attempt.attempt_id]), 'UPDATE', '23514', 'projection_attempt_terminal'));
    }
    assert.equal((await invoke('record_failure', own.attempt.attempt_id, 'retryable_failure', 'fixture://overwrite')).outcome, 'already_terminal');
    assert.deepEqual(await state(own.graph.taskId), before);
    return `终态 ${status} 的状态、结果、时间覆盖均拒绝；失败入口返回 already_terminal，独立连接历史完全相同`;
  });
  await sub(t, '无变化 UPDATE 允许且不新增终态审计', async () => {
    await invoke('accept_success', attempt.attempt_id, resultHash, resultRef);
    const before = await state(graph.taskId);
    await tx(async (c) => {
      const result = await c.query(`UPDATE ${q('projection_attempt')} SET status=status, ended_at=ended_at, result_hash=result_hash, result_ref=result_ref, worker_version=worker_version, expires_at=expires_at WHERE attempt_id=$1`, [attempt.attempt_id]);
      assert.equal(result.rowCount, 1); await c.query('COMMIT');
    });
    assert.deepEqual(await state(graph.taskId), before);
    return '终态原值 UPDATE 真实提交成功，审计数量/时间/结果均不变';
  });
  await sub(t, '普通 DML 合法转换也使用数据库时间及原子审计', async () => {
    const directGraph = await task();
    const direct = await tx(async (c) => {
      const inserted = (await insert(c, 'projection_attempt', { task_id: directGraph.taskId, worker_version: 'direct-dml-software' })).rows[0];
      await c.query(`UPDATE ${q('projection_attempt')} SET status='succeeded', result_hash=$1, result_ref=$2 WHERE attempt_id=$3`, [resultHash, resultRef, inserted.attempt_id]);
      await c.query('COMMIT'); return inserted;
    });
    const saved = await assertHistory(directGraph.taskId, ['succeeded'], ['claimed', 'succeeded']);
    assert.equal(saved.attempts[0].attempt_id, direct.attempt_id);
    return '普通 INSERT 不能传入时间；合法 UPDATE 由数据库写 ended_at，并与 succeeded 审计同事务提交';
  });
});

scenario('C：完成路径锁等待跨过截止，必须在锁后重新取时', async (t) => {
  // Test both the operation's Task lock and the actual Attempt row lock. The
  // second variant detects a time cached between those two locks.
  for (const lockedTable of ['projection_task', 'projection_attempt']) await sub(t, lockedTable, async () => {
    const { graph, attempt } = await processing({ timeoutMs: 1400 });
    const [holder, worker, observer] = await Promise.all([connect(), connect(), connect()]);
    let holderPid; let workerPid; let waiting; let crossedAt; let returned; let initiatedAt;
    try {
      await begin(holder); await begin(worker);
      holderPid = await pid(holder); workerPid = await pid(worker);
      const column = lockedTable === 'projection_task' ? 'task_id' : 'attempt_id';
      const key = lockedTable === 'projection_task' ? graph.taskId : attempt.attempt_id;
      await holder.query(`SELECT 1 FROM ${q(lockedTable)} WHERE ${column}=$1 FOR UPDATE`, [key]);
      const before = (await observer.query('SELECT clock_timestamp() AS time, clock_timestamp() < $1::timestamptz AS before', [attempt.expires_at])).rows[0];
      assert.equal(before.before, true, 'operation must start before the deadline'); initiatedAt = before.time;
      const pending = success(worker, attempt.attempt_id); pending.catch(() => {});
      waiting = await blocked(observer, workerPid, holderPid);
      assert.equal((await observer.query('SELECT query_start < $1::timestamptz AS issued_before_deadline FROM pg_catalog.pg_stat_activity WHERE pid=$2', [attempt.expires_at, workerPid])).rows[0].issued_before_deadline, true);
      crossedAt = await waitPast(observer, attempt.expires_at);
      await holder.query('COMMIT');
      returned = await pending;
      assert.equal(returned.outcome, 'deadline_elapsed');
      await worker.query('COMMIT');
    } finally { await close(holder); await close(worker); await observer.end(); }
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    return { stage: 'success operation after lock wait', evidence: `发起=${initiatedAt} < 截止=${attempt.expires_at}；阻塞=${JSON.stringify(waiting)}；数据库时间=${crossedAt} >= 截止后先释放 holder PID=${holderPid}，worker PID=${workerPid} 才继续，返回 ${returned.outcome} 并 COMMIT；无结果/成功审计` };
  });
});

scenario('C：截止前接纳、截止后 COMMIT 或 ROLLBACK', async (t) => {
  for (const disposition of ['COMMIT', 'ROLLBACK']) await sub(t, disposition, async () => {
    const { graph, attempt } = await processing({ timeoutMs: 450 });
    const [writer, observer] = await Promise.all([connect(), connect()]);
    let accepted; let crossedAt; let commitAt;
    try {
      await begin(writer);
      accepted = await success(writer, attempt.attempt_id);
      assert.equal(accepted.outcome, 'accepted_success');
      const legal = (await writer.query(`SELECT ended_at < expires_at AS legal, ended_at FROM ${q('projection_attempt')} WHERE attempt_id=$1`, [attempt.attempt_id])).rows[0];
      assert.equal(legal.legal, true);
      const invisible = (await observer.query(`SELECT status,result_ref,ended_at FROM ${q('projection_attempt')} WHERE attempt_id=$1`, [attempt.attempt_id])).rows[0];
      assert.deepEqual(invisible, { status: 'processing', result_ref: null, ended_at: null });
      const uncommittedAudit = (await observer.query(`SELECT count(*)::int AS count FROM ${q('projection_attempt_audit')} WHERE attempt_id=$1 AND to_status='succeeded'`, [attempt.attempt_id])).rows[0];
      assert.equal(uncommittedAudit.count, 0);
      crossedAt = await waitPast(observer, attempt.expires_at);
      await writer.query(disposition);
      commitAt = (await observer.query('SELECT clock_timestamp() AS time')).rows[0].time;
    } finally { await close(writer); await observer.end(); }
    const saved = await assertHistory(graph.taskId, [disposition === 'COMMIT' ? 'succeeded' : 'processing'], disposition === 'COMMIT' ? ['claimed', 'succeeded'] : ['claimed']);
    if (disposition === 'COMMIT') {
      assert.equal(saved.attempts[0].result_hash, resultHash); assert.equal(saved.attempts[0].result_ref, resultRef);
      await observe(async (c) => assert.equal((await c.query(`SELECT ended_at=$2::timestamptz AS unchanged FROM ${q('projection_attempt')} WHERE attempt_id=$1`, [attempt.attempt_id, accepted.attempt.ended_at])).rows[0].unchanged, true));
    } else { assert.equal(saved.attempts[0].result_ref, null); assert.equal(saved.attempts[0].ended_at, null); }
    return { stage: disposition, evidence: `接受 ended_at=${accepted.attempt.ended_at} < expires_at=${attempt.expires_at}；未提交时独立观察仍为 processing、无结果和成功审计；数据库跨截止时间=${crossedAt}，${disposition} 后数据库时间=${commitAt}；持久化状态=${saved.attempts[0].status}` };
  });
});

async function orderedRace(graph, first, second, beforeRelease) {
  const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
  let firstReturn; let secondReturn; let wait; let aPid; let bPid; let releaseEvidence;
  try {
    await begin(a); await begin(b);
    aPid = await pid(a); bPid = await pid(b);
    firstReturn = await first(a);
    const pending = second(b); pending.catch(() => {});
    wait = await blocked(observer, bPid, aPid);
    if (beforeRelease) releaseEvidence = await beforeRelease(observer);
    await a.query('COMMIT');
    secondReturn = await pending;
    await b.query('COMMIT');
  } finally { await close(a); await close(b); await observer.end(); }
  return { firstReturn, secondReturn, evidence: `A PID=${aPid}, B PID=${bPid}; 阻塞=${JSON.stringify(wait)}；${releaseEvidence ?? ''}；先 A COMMIT 释放 Task/Attempt 锁，后 B 返回并首次 COMMIT；返回=${firstReturn.outcome}/${secondReturn.outcome}` };
}

scenario('D：同一 Task 的领取、清理、成功及重试竞争', async (t) => {
  await sub(t, '两个领取者', async () => {
    const graph = await task();
    const race = await orderedRace(graph, (c) => call(c, 'claim_attempt', graph.taskId, 'same-worker-version'), (c) => call(c, 'claim_attempt', graph.taskId, 'same-worker-version'));
    assert.equal(race.firstReturn.outcome, 'created'); assert.equal(race.secondReturn.outcome, 'in_progress');
    assert.equal(race.firstReturn.attempt.attempt_id, race.secondReturn.attempt.attempt_id);
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    return { stage: 'claim / COMMIT', evidence: race.evidence };
  });
  await sub(t, '两个过期清理者', async () => {
    const { graph, attempt } = await processing({ timeoutMs: 80 }); await past(attempt);
    const race = await orderedRace(graph, (c) => call(c, 'expire_attempt', attempt.attempt_id), (c) => call(c, 'expire_attempt', attempt.attempt_id));
    assert.equal(race.firstReturn.outcome, 'expired'); assert.equal(race.secondReturn.outcome, 'already_terminal');
    await assertHistory(graph.taskId, ['expired'], ['claimed', 'expired']);
    return { stage: 'expire / COMMIT', evidence: race.evidence };
  });
  for (const winner of ['success', 'expire']) await sub(t, `成功与过期/${winner} 先取得锁`, async () => {
    const { graph, attempt } = await processing({ timeoutMs: winner === 'success' ? 600 : 80 });
    if (winner === 'expire') await past(attempt);
    const race = await orderedRace(graph,
      (c) => winner === 'success' ? success(c, attempt.attempt_id) : call(c, 'expire_attempt', attempt.attempt_id),
      (c) => winner === 'success' ? call(c, 'expire_attempt', attempt.attempt_id) : success(c, attempt.attempt_id),
      winner === 'success' ? async (observer) => `数据库跨截止=${await waitPast(observer, attempt.expires_at)}` : undefined,
    );
    assert.equal(race.firstReturn.outcome, winner === 'success' ? 'accepted_success' : 'expired');
    assert.equal(race.secondReturn.outcome, 'already_terminal');
    await assertHistory(graph.taskId, [winner === 'success' ? 'succeeded' : 'expired'], ['claimed', winner === 'success' ? 'succeeded' : 'expired']);
    return { stage: 'success vs expire / COMMIT', evidence: race.evidence };
  });
  await sub(t, '两个重试者', async () => {
    const { graph, attempt } = await processing();
    await invoke('record_failure', attempt.attempt_id, 'retryable_failure', 'fixture://failure');
    const race = await orderedRace(graph, (c) => call(c, 'retry_attempt', attempt.attempt_id, 'v2'), (c) => call(c, 'retry_attempt', attempt.attempt_id, 'v3'));
    assert.equal(race.firstReturn.outcome, 'retried'); assert.equal(race.secondReturn.outcome, 'superseded');
    assert.equal(race.firstReturn.attempt.attempt_id, race.secondReturn.attempt.attempt_id);
    const saved = await assertHistory(graph.taskId, ['retryable_failure', 'processing'], ['claimed', 'retryable_failure', 'retried']);
    assert.equal(saved.attempts[1].attempt_no, 2);
    return { stage: 'retry / COMMIT', evidence: `${race.evidence}；仅一个新 ID 和 attempt_no=2，processing 总数=1` };
  });
  for (const first of ['old_worker', 'retry']) await sub(t, `旧 Worker 完成与过期重试/${first} 先取得锁`, async () => {
    const { graph, attempt } = await processing({ timeoutMs: 100 }); await past(attempt);
    const race = await orderedRace(graph,
      (c) => first === 'old_worker' ? success(c, attempt.attempt_id) : call(c, 'retry_attempt', attempt.attempt_id, 'same-software'),
      (c) => first === 'old_worker' ? call(c, 'retry_attempt', attempt.attempt_id, 'same-software') : success(c, attempt.attempt_id),
    );
    assert.equal(race.firstReturn.outcome, first === 'old_worker' ? 'deadline_elapsed' : 'retried');
    assert.equal(race.secondReturn.outcome, first === 'old_worker' ? 'retried' : 'already_terminal');
    const saved = await assertHistory(graph.taskId, ['expired', 'processing'], ['claimed', 'expired', 'retried']);
    assert.notEqual(saved.attempts[1].attempt_id, attempt.attempt_id);
    assert.equal(saved.attempts[1].result_ref, null);
    return { stage: 'old completion vs retry / COMMIT', evidence: `${race.evidence}；新执行 ID=${saved.attempts[1].attempt_id}；旧 ID 无法写新结果` };
  });
});

scenario('D：不同 Task 操作首次异步提交，无死锁重试', async (t) => {
  for (const operation of ['claim', 'success', 'retry']) await sub(t, operation, async () => {
    const graphs = []; const attempts = [];
    for (let i = 0; i < 2; i += 1) {
      if (operation === 'claim') graphs.push(await task());
      else {
        const own = await processing(); graphs.push(own.graph); attempts.push(own.attempt);
        if (operation === 'retry') await invoke('record_failure', own.attempt.attempt_id, 'retryable_failure', 'fixture://failure');
      }
    }
    const [a, b, observer] = await Promise.all([connect(), connect(), connect()]);
    let responses; let activity; let pids;
    try {
      await begin(a); await begin(b); pids = await Promise.all([pid(a), pid(b)]);
      responses = await Promise.all([a, b].map((c, i) => operation === 'claim' ? call(c, 'claim_attempt', graphs[i].taskId, 'same-software')
        : operation === 'success' ? success(c, attempts[i].attempt_id) : call(c, 'retry_attempt', attempts[i].attempt_id, 'same-software')));
      activity = (await observer.query(`SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_catalog.pg_stat_activity WHERE pid=ANY($1::int[]) ORDER BY pid`, [pids])).rows;
      assert.equal(activity.length, 2); assert.deepEqual(activity.flatMap((row) => row.blockers), []);
      const commits = await Promise.allSettled([a.query('COMMIT'), b.query('COMMIT')]);
      for (const commit of commits) assert.equal(commit.status, 'fulfilled', commit.reason?.message);
    } finally { await close(a); await close(b); await observer.end(); }
    assert.deepEqual(responses.map((row) => row.outcome), [operation === 'claim' ? 'created' : operation === 'success' ? 'accepted_success' : 'retried', operation === 'claim' ? 'created' : operation === 'success' ? 'accepted_success' : 'retried']);
    for (const graph of graphs) await assertHistory(graph.taskId, operation === 'claim' ? ['processing'] : operation === 'success' ? ['succeeded'] : ['retryable_failure', 'processing']);
    return { stage: 'first asynchronous COMMIT', evidence: `PID=${pids}; 返回=${responses.map((row) => row.outcome)}；观察=${JSON.stringify(activity)}；首次异步 COMMIT 均成功，无重试，独立连接回读各 Task 的历史与审计` };
  });
});

scenario('E：来源绑定与 Task 状态保护', async (t) => {
  const { graph, attempt } = await processing();
  const alternate = await task();
  const cases = [
    ['projection_task', 'task_id', graph.taskId, 'task_id', id('rebound_task')],
    ['projection_task', 'task_id', graph.taskId, 'project_id', alternate.projectId],
    ['projection_task', 'task_id', graph.taskId, 'outbox_id', alternate.outboxId],
    ['projection_task', 'task_id', graph.taskId, 'origin_type', 'rebuild'],
    ['projection_task', 'task_id', graph.taskId, 'target', 'vector'],
    ['projection_task', 'task_id', graph.taskId, 'scope_hash', 'different-scope'],
    ['projection_task', 'task_id', graph.taskId, 'strategy_version', alternate.strategy],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'canon_commit_id', alternate.commitId],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'project_id', alternate.projectId],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'scope_hash', 'changed-scope'],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'source_canon_watermark', 2],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'strategy_version', alternate.strategy],
    ['projection_outbox', 'outbox_id', graph.outboxId, 'target', 'vector'],
    ['projection_policy', 'strategy_version', graph.strategy, 'timeout_ms', 999_999],
    ['canon_commit', 'canon_commit_id', graph.commitId, 'project_id', alternate.projectId],
    ['canon_commit', 'canon_commit_id', graph.commitId, 'canon_watermark', 2],
  ];
  for (const [table, key, value, field, replacement] of cases) await sub(t, `${table}.${field}`, async () => tx((c) => expectSql(() => c.query(`UPDATE ${q(table)} SET ${field}=$1 WHERE ${key}=$2`, [replacement, value]), 'UPDATE', '23514', 'projection_input_immutable')));
  for (const field of ['project_id', 'target', 'scope_hash', 'strategy_version']) await sub(t, `新 Task 映射错误/${field}`, async () => tx((c) => expectSql(() => insert(c, 'projection_task', {
    task_id: id('bad_task'), project_id: graph.projectId, outbox_id: graph.outboxId, target: 'graph', scope_hash: 'sha256:scope', strategy_version: graph.strategy,
    [field]: { project_id: alternate.projectId, target: 'vector', scope_hash: 'wrong', strategy_version: alternate.strategy }[field],
  }), 'Task INSERT', '23514', 'projection_source_mapping')));
  await sub(t, '原值输入 UPDATE 合法，取消 Task 不自动恢复', async () => {
    await tx(async (c) => {
      await c.query(`UPDATE ${q('projection_task')} SET target=target, scope_hash=scope_hash, project_id=project_id WHERE task_id=$1`, [graph.taskId]);
      await c.query(`UPDATE ${q('projection_task')} SET status='cancelled' WHERE task_id=$1`, [graph.taskId]);
      await c.query('COMMIT');
    });
    assert.equal((await invoke('retry_attempt', attempt.attempt_id, 'v')).outcome, 'task_not_executable');
    assert.equal((await invoke('claim_attempt', graph.taskId, 'v')).outcome, 'task_not_executable');
    const error = await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_task')} SET status='pending' WHERE task_id=$1`, [graph.taskId]), 'Task UPDATE', '23514', 'projection_task_terminal'));
    await assertHistory(graph.taskId, ['processing'], ['claimed']); return error;
  });
});

scenario('E：状态与审计同事务，审计不可伪造或删除', async (t) => {
  for (const terminal of ['expired', 'retryable_failure', 'permanent_failure']) await sub(t, `${terminal} 回滚`, async () => {
    const { graph, attempt } = await processing({ timeoutMs: terminal === 'expired' ? 80 : 30_000 });
    if (terminal === 'expired') await past(attempt);
    await tx(async (c) => {
      const response = terminal === 'expired' ? await call(c, 'expire_attempt', attempt.attempt_id) : await call(c, 'record_failure', attempt.attempt_id, terminal, 'fixture://failure');
      assert.equal(response.outcome, terminal === 'expired' ? 'expired' : 'failure_recorded');
      assert.equal((await c.query(`SELECT count(*)::int AS count FROM ${q('projection_attempt_audit')} WHERE attempt_id=$1`, [attempt.attempt_id])).rows[0].count, 2);
      await c.query('ROLLBACK');
    });
    await assertHistory(graph.taskId, ['processing'], ['claimed']);
    return `${terminal} 和对应审计在事务内存在，ROLLBACK 后独立连接仅见 processing/claimed`;
  });
  await sub(t, '首次领取回滚不留下执行或 claimed 审计', async () => {
    const graph = await task();
    await tx(async (c) => { assert.equal((await call(c, 'claim_attempt', graph.taskId, 'v')).outcome, 'created'); await c.query('ROLLBACK'); });
    await assertHistory(graph.taskId, [], []); return 'Attempt 与 claimed 审计全部回滚';
  });
  const { graph, attempt } = await processing();
  for (const operation of ['UPDATE', 'DELETE', 'TRUNCATE']) await sub(t, `审计 ${operation}`, async () => tx((c) => expectSql(() => c.query(operation === 'UPDATE'
    ? `UPDATE ${q('projection_attempt_audit')} SET detail_ref='fake' WHERE attempt_id=$1`
    : operation === 'DELETE' ? `DELETE FROM ${q('projection_attempt_audit')} WHERE attempt_id=$1` : `TRUNCATE ${q('projection_attempt_audit')}`,
  operation === 'TRUNCATE' ? [] : [attempt.attempt_id]), operation, '23514', 'projection_attempt_audit_immutable')));
  await sub(t, '审计 INSERT 不得伪造成功历史', async () => tx((c) => expectSql(() => insert(c, 'projection_attempt_audit', {
    attempt_id: attempt.attempt_id, previous_attempt_id: null, from_status: 'processing', to_status: 'succeeded', event_kind: 'succeeded', occurred_at: attempt.started_at, detail_ref: resultRef,
  }), 'audit INSERT', '23514', 'projection_attempt_audit_mapping')));
  await sub(t, '审计无变化 UPDATE 不改变历史', async () => {
    const before = await state(graph.taskId);
    await tx(async (c) => { await c.query(`UPDATE ${q('projection_attempt_audit')} SET detail_ref=detail_ref WHERE attempt_id=$1`, [attempt.attempt_id]); await c.query('COMMIT'); });
    assert.deepEqual(await state(graph.taskId), before); return '原值审计 UPDATE 合法，未生成新审计';
  });
});

scenario('E：public 路径直连及数据库实际元数据', async (t) => {
  await sub(t, 'public 合法提交、截止拒绝和终态保护', async () => {
    const valid = await processing();
    assert.equal((await invoke('accept_success', valid.attempt.attempt_id, resultHash, resultRef)).outcome, 'accepted_success');
    await assertHistory(valid.graph.taskId, ['succeeded'], ['claimed', 'succeeded']);
    const error = await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET result_ref='fake' WHERE attempt_id=$1`, [valid.attempt.attempt_id]), 'public UPDATE', '23514', 'projection_attempt_terminal'));
    const late = await processing({ timeoutMs: 80 }); await past(late.attempt);
    assert.equal((await invoke('accept_success', late.attempt.attempt_id, resultHash, resultRef)).outcome, 'deadline_elapsed');
    const deadlineError = await tx((c) => expectSql(() => c.query(`UPDATE ${q('projection_attempt')} SET status='succeeded', result_hash=$1, result_ref=$2 WHERE attempt_id=$3`, [resultHash, resultRef, late.attempt.attempt_id]), 'public direct UPDATE', '55000', 'projection_attempt_deadline'));
    await assertHistory(late.graph.taskId, ['processing'], ['claimed']);
    return { ...deadlineError, evidence: `所有连接为全新 pg.Client，search_path=public、全限定业务对象；合法提交和 ${error.code}/${error.constraint} 终态保护均验证；${deadlineError.evidence}` };
  });
  await sub(t, '函数路径及 invoker 权限', async () => observe(async (c) => {
    const functions = (await c.query(`SELECT proname, proconfig, prosecdef FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 ORDER BY proname`, [SCHEMA])).rows;
    assert.equal(functions.length, 14);
    for (const fn of functions) { assert.deepEqual(fn.proconfig, [`search_path=pg_catalog, ${SCHEMA}, pg_temp`]); assert.equal(fn.prosecdef, false); }
    return `实际 pg_proc=${JSON.stringify(functions)}`;
  }));
  await sub(t, 'Attempt 编号唯一与单一 processing 部分唯一索引', async () => observe(async (c) => {
    const constraints = (await c.query(`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='u'`, [q('projection_attempt')])).rows;
    assert.deepEqual(constraints, [{ conname: 'uq_projection_attempt_number', definition: 'UNIQUE (task_id, attempt_no)' }]);
    const index = (await c.query(`SELECT indisunique, pg_get_indexdef(indexrelid) AS definition FROM pg_catalog.pg_index WHERE indexrelid=$1::regclass`, [q('uq_projection_attempt_processing')])).rows[0];
    assert.equal(index.indisunique, true); assert.match(index.definition, /WHERE \(status = 'processing'::text\)/);
    return `${JSON.stringify(constraints)}；${JSON.stringify(index)}`;
  }));
  await sub(t, '关键触发器实际挂载与严格比较符号', async () => observe(async (c) => {
    const rows = (await c.query(`SELECT c.relname,t.tgname,t.tgtype FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY tgname`, [SCHEMA])).rows;
    assert.equal(rows.length, 14);
    for (const [name, tgtype] of [['attempt_insert_guard', 7], ['attempt_update_guard', 27], ['attempt_no_truncate', 34], ['attempt_transition_audit', 21], ['attempt_audit_guard', 31]]) {
      assert.equal(rows.find((row) => row.tgname === name)?.tgtype, tgtype);
    }
    const definition = (await c.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [`${q('guard_attempt_update')}()`])).rows[0].definition;
    assert.match(definition, /decision_time := clock_timestamp\(\)/);
    assert.match(definition, /NEW.status = 'succeeded' AND decision_time >= OLD.expires_at/);
    assert.match(definition, /NEW.status = 'expired' AND decision_time < OLD.expires_at/);
    assert.doesNotMatch(definition.replace(/^\s*--.*$/gm, ''), /statement_timestamp\(\)|transaction_timestamp\(\)/);
    return `实际触发器=${JSON.stringify(rows)}；拒绝成功 >= 截止，拒绝过期 < 截止；锁后 clock_timestamp，成功接纳为严格 <，过期为 >=`;
  }));
  await sub(t, '业务 FK 仅限独立 Schema，无 Checkpoint/Rebuild/外部投影对象', async () => observe(async (c) => {
    const fks = (await c.query(`SELECT rn.nspname AS target FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class l ON l.oid=con.conrelid JOIN pg_catalog.pg_namespace ln ON ln.oid=l.relnamespace JOIN pg_catalog.pg_class r ON r.oid=con.confrelid JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace WHERE contype='f' AND ln.nspname=$1`, [SCHEMA])).rows;
    assert.ok(fks.length > 0); for (const fk of fks) assert.equal(fk.target, SCHEMA);
    const tables = (await c.query('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1 ORDER BY tablename', [SCHEMA])).rows.map((row) => row.tablename);
    assert.deepEqual(tables, ['canon_commit', 'pgmigrations', 'project', 'projection_attempt', 'projection_attempt_audit', 'projection_outbox', 'projection_policy', 'projection_task']);
    return `本 Schema 表=${tables}；${fks.length} 个 FK 全部在本 Schema，无外部来源借用`;
  }));
});
