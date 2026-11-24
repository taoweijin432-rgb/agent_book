import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PROTOTYPE_SCHEMA ?? 'time_interval_constraint_fixture';
const RESULTS_PATH = process.env.PROTOTYPE_RESULTS_PATH ?? '.test-results.json';
assert.ok(DATABASE_URL, 'DATABASE_URL is required');

const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const outcomes = [];
const expectedEvidence = {
  '八种来源类型的合法创建路径': 'COMMIT 成功；8 种 source_type 各自绑定数量为 1',
  '区间无绑定时 INSERT 成功但 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete；区间未持久化',
  '顺序重复绑定使用不同主键并因 time_interval_id 唯一约束失败': 'INSERT SQLSTATE 23505；constraint uq_time_interval_source_interval；原绑定数量仍为 1',
  '即时 CHECK 失败记录 SQLSTATE 与约束名': 'INSERT SQLSTATE 23514；constraint ck_time_interval_source_target_shape',
  '即时 FK 失败记录 SQLSTATE 与约束名': 'INSERT SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey',
  '即时约束合法但跨项目归属在 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  '来源对象区间引用更新破坏关系时 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  '删除被绑定来源对象不能成功提交': 'DELETE SQLSTATE 23503；constraint time_interval_source_candidate_event_id_fkey；原绑定保留',
  '删除绑定不能提交留下孤立区间': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete；原绑定保留',
  '两个连接竞争同一区间主键：A 提交则 B 冲突': 'A COMMIT 成功；B SQLSTATE 23505；constraint time_interval_pkey；绑定数量 1',
  '两个连接竞争同一区间主键：A 回滚则 B 完成': 'A ROLLBACK；B COMMIT 成功；绑定数量 1',
  '更新来源绑定同时校验旧区间和新区间': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete；回滚后旧区间绑定保留，新区间未持久化',
  '合法更新区间元数据仍可提交': 'COMMIT 成功；绑定仍指向同一区间',
  'Temporal Constraint 所属 Revision 归属不一致时 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  'Candidate Version 归属链不一致时 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  'Workflow Run 归属链不一致时 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  'Canon Commit 归属链不一致时 COMMIT 失败': 'COMMIT SQLSTATE 23514；constraint time_interval_source_complete',
  'Author Design Revision 归属更新不能破坏已绑定来源': 'UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留',
  'Candidate Version 归属更新不能破坏已绑定来源': 'UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留',
  'Workflow Run 归属更新不能破坏已绑定来源': 'UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留',
  'Canon Commit 项目归属更新不能破坏已绑定来源': 'UPDATE SQLSTATE 23514；constraint time_interval_source_complete；原项目归属保留',
  '已绑定 Canon Commit 从 committed 改为 preparing 不能提交': 'UPDATE SQLSTATE 23514；constraint time_interval_source_complete；状态仍为 committed',
  '五类区间引用对象不得借用其他对象的区间': 'INSERT 路径和 UPDATE 路径均在 COMMIT 以 SQLSTATE 23514；constraint time_interval_source_complete 拒绝；原合法绑定保留',
  '容器非法更新被即时拒绝后来源可合法创建': '参数化覆盖 Revision、Workflow Run、Candidate Version、Canon Commit；容器身份/归属 UPDATE 在语句阶段以 23514/time_interval_source_complete 拒绝，随后来源首次 COMMIT 成功',
  '并发归属保护：来源绑定先持锁，容器后尝试': '参数化覆盖 Revision、Workflow Run、Canon Commit；观察连接确认容器 DML 被来源 PID 阻塞；释放后容器 UPDATE 以 23514/time_interval_source_complete 拒绝；来源提交或回滚状态均独立检查',
  '合法来源并发创建默认延后 COMMIT': '参数化覆盖 Temporal Constraint、Candidate Event、Story Event；A/B 均首次 COMMIT 成功；两套来源、区间及绑定均持久化；无 40P01',
  '父子无变化更新不形成反向等待': 'A/B 均首次 COMMIT 成功；未观察到互相阻塞；Workflow Run、Candidate Version、来源对象和绑定保持一致',
};
let sequence = 0;

async function clientWithIsolation() {
  const client = await pool.connect();
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  const { rows } = await client.query('SHOW transaction_isolation');
  assert.equal(rows[0].transaction_isolation, 'read committed');
  await client.query(`SET LOCAL search_path TO ${SCHEMA}, public`);
  return client;
}

async function committedClient() {
  const client = await pool.connect();
  await client.query(`SET search_path TO ${SCHEMA}, public`);
  return client;
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The connection may already be closed or failed; cleanup continues.
  }
}

async function scenario(name, fn) {
  test(name, async () => {
    try {
      const evidence = await fn();
      outcomes.push({ name, status: 'passed', evidence: evidence ?? expectedEvidence[name] ?? '' });
    } catch (error) {
      outcomes.push({
        name,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
        constraint: error?.constraint ?? null,
        evidence: expectedEvidence[name] ?? '',
      });
      throw error;
    }
  });
}

function id(prefix) {
  sequence += 1;
  return `${prefix}_${Date.now()}_${sequence}`;
}

async function seedProject(client, projectId = id('project')) {
  await client.query('INSERT INTO project(project_id) VALUES ($1)', [projectId]);
  return projectId;
}

async function seedCandidateContainers(client, projectId) {
  const workflowRunId = id('workflow');
  const candidateVersionId = id('candidate');
  await client.query('INSERT INTO workflow_run(workflow_run_id, project_id) VALUES ($1, $2)', [workflowRunId, projectId]);
  await client.query('INSERT INTO candidate_version(candidate_version_id, project_id, workflow_run_id) VALUES ($1, $2, $3)', [candidateVersionId, projectId, workflowRunId]);
  return { workflowRunId, candidateVersionId };
}

async function seedCanonContainer(client, projectId) {
  const canonCommitId = id('commit');
  await client.query('INSERT INTO canon_commit(canon_commit_id, project_id, status) VALUES ($1, $2, $3)', [canonCommitId, projectId, 'committed']);
  return { canonCommitId };
}

async function insertInterval(client, { projectId, intervalId = id('interval'), sourceDomain, sourceVersionId = id('source_version'), intervalKey = id('interval_key') }) {
  await client.query(
    `INSERT INTO time_interval(time_interval_id, project_id, source_domain, source_version_id, interval_key, time_kind)
     VALUES ($1, $2, $3, $4, $5, 'relative')`,
    [intervalId, projectId, sourceDomain, sourceVersionId, intervalKey],
  );
  return { intervalId, sourceVersionId };
}

async function bind(client, {
  intervalId,
  sourceDomain,
  sourceVersionId,
  sourceType,
  intervalSourceId = id('interval_source'),
  targetColumn,
  targetId,
}) {
  const targets = {
    temporal_constraint_id: null,
    candidate_event_id: null,
    candidate_fact_proposal_id: null,
    candidate_state_transition_id: null,
    canonical_text_version_id: null,
    story_event_id: null,
    canon_fact_id: null,
    state_transition_id: null,
  };
  targets[targetColumn] = targetId;
  await client.query(
    `INSERT INTO time_interval_source(
       interval_source_id, time_interval_id, source_domain, source_version_id, source_type,
       temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id,
       candidate_state_transition_id, canonical_text_version_id, story_event_id,
       canon_fact_id, state_transition_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      intervalSourceId,
      intervalId,
      sourceDomain,
      sourceVersionId,
      sourceType,
      targets.temporal_constraint_id,
      targets.candidate_event_id,
      targets.candidate_fact_proposal_id,
      targets.candidate_state_transition_id,
      targets.canonical_text_version_id,
      targets.story_event_id,
      targets.canon_fact_id,
      targets.state_transition_id,
    ],
  );
  return intervalSourceId;
}

async function createValidSource(client, type, { projectId, intervalId, sourceId: suppliedSourceId } = {}) {
  const localProjectId = projectId ?? id(`project_${type}`);
  if (!projectId) await seedProject(client, localProjectId);

  if (type === 'temporal_constraint') {
    const revisionId = id('revision');
    await client.query('INSERT INTO author_design_revision(revision_id, project_id) VALUES ($1,$2)', [revisionId, localProjectId]);
    const sourceId = suppliedSourceId ?? id('temporal_constraint');
    await client.query('INSERT INTO temporal_constraint(temporal_constraint_id, project_id, revision_id, interval_id) VALUES ($1,$2,$3,$4)', [sourceId, localProjectId, revisionId, intervalId]);
    return { projectId: localProjectId, sourceId, revisionId, sourceDomain: 'author_design', sourceType: type, targetColumn: 'temporal_constraint_id' };
  }

  if (type.startsWith('candidate_')) {
    const { workflowRunId, candidateVersionId } = await seedCandidateContainers(client, localProjectId);
    const sourceId = suppliedSourceId ?? id(type);
    if (type === 'candidate_event') {
      await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [sourceId, localProjectId, candidateVersionId, intervalId]);
      return { projectId: localProjectId, sourceId, workflowRunId, candidateVersionId, sourceDomain: 'candidate', sourceType: type, targetColumn: 'candidate_event_id' };
    }
    if (type === 'candidate_fact_proposal') {
      await client.query('INSERT INTO candidate_fact_proposal(candidate_fact_proposal_id, project_id, candidate_version_id) VALUES ($1,$2,$3)', [sourceId, localProjectId, candidateVersionId]);
      return { projectId: localProjectId, sourceId, workflowRunId, candidateVersionId, sourceDomain: 'candidate', sourceType: type, targetColumn: 'candidate_fact_proposal_id' };
    }
    await client.query('INSERT INTO candidate_state_transition(candidate_state_transition_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [sourceId, localProjectId, candidateVersionId, intervalId]);
    return { projectId: localProjectId, sourceId, workflowRunId, candidateVersionId, sourceDomain: 'candidate', sourceType: type, targetColumn: 'candidate_state_transition_id' };
  }

  const { canonCommitId } = await seedCanonContainer(client, localProjectId);
  const sourceId = suppliedSourceId ?? id(type);
  if (type === 'canonical_text_version') {
    await client.query('INSERT INTO canonical_text_version(canonical_text_version_id, project_id, canon_commit_id) VALUES ($1,$2,$3)', [sourceId, localProjectId, canonCommitId]);
    return { projectId: localProjectId, sourceId, canonCommitId, sourceDomain: 'canon', sourceType: type, targetColumn: 'canonical_text_version_id' };
  }
  if (type === 'story_event') {
    await client.query('INSERT INTO story_event(story_event_id, project_id, canon_commit_id, story_time_interval_id) VALUES ($1,$2,$3,$4)', [sourceId, localProjectId, canonCommitId, intervalId]);
    return { projectId: localProjectId, sourceId, canonCommitId, sourceDomain: 'canon', sourceType: type, targetColumn: 'story_event_id' };
  }
  if (type === 'canon_fact') {
    await client.query('INSERT INTO canon_fact(canon_fact_id, project_id, canon_commit_id) VALUES ($1,$2,$3)', [sourceId, localProjectId, canonCommitId]);
    return { projectId: localProjectId, sourceId, canonCommitId, sourceDomain: 'canon', sourceType: type, targetColumn: 'canon_fact_id' };
  }
  await client.query('INSERT INTO state_transition(state_transition_id, project_id, canon_commit_id, story_time_interval_id) VALUES ($1,$2,$3,$4)', [sourceId, localProjectId, canonCommitId, intervalId]);
  return { projectId: localProjectId, sourceId, canonCommitId, sourceDomain: 'canon', sourceType: type, targetColumn: 'state_transition_id' };
}

async function countBindings(client, intervalId) {
  const { rows } = await client.query('SELECT count(*)::int AS count FROM time_interval_source WHERE time_interval_id = $1', [intervalId]);
  return rows[0].count;
}

async function commitError(client) {
  try {
    await client.query('COMMIT');
    return null;
  } catch (error) {
    await rollbackQuietly(client);
    return error;
  }
}

async function statementError(client, text, params = []) {
  try {
    await client.query(text, params);
    return null;
  } catch (error) {
    await rollbackQuietly(client);
    return error;
  }
}


async function assertBoundSourceIntact(client, type, bound) {
  const interval = await client.query(
    'SELECT project_id, source_domain, source_version_id FROM time_interval WHERE time_interval_id = $1',
    [bound.intervalId],
  );
  assert.equal(interval.rows.length, 1);
  assert.equal(interval.rows[0].project_id, bound.projectId);
  assert.equal(interval.rows[0].source_version_id, bound.source.sourceId);

  const binding = await client.query(
    `SELECT time_interval_id, source_domain, source_version_id, source_type,
            temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id,
            candidate_state_transition_id, canonical_text_version_id, story_event_id,
            canon_fact_id, state_transition_id
       FROM time_interval_source
      WHERE time_interval_id = $1`,
    [bound.intervalId],
  );
  assert.equal(binding.rows.length, 1);
  assert.equal(binding.rows[0].time_interval_id, bound.intervalId);
  assert.equal(binding.rows[0].source_domain, bound.source.sourceDomain);
  assert.equal(binding.rows[0].source_version_id, bound.source.sourceId);
  assert.equal(binding.rows[0].source_type, type);
  assert.equal(binding.rows[0][`${type}_id`], bound.source.sourceId);

  let source;
  if (type === 'temporal_constraint') {
    source = await client.query('SELECT project_id, revision_id, interval_id FROM temporal_constraint WHERE temporal_constraint_id = $1', [bound.source.sourceId]);
    assert.equal(source.rows[0].revision_id, bound.source.revisionId);
    assert.equal(source.rows[0].interval_id, bound.intervalId);
  } else if (type === 'candidate_event') {
    source = await client.query('SELECT project_id, candidate_version_id, story_time_ref FROM candidate_event WHERE candidate_event_id = $1', [bound.source.sourceId]);
    assert.equal(source.rows[0].candidate_version_id, bound.source.candidateVersionId);
    assert.equal(source.rows[0].story_time_ref, bound.intervalId);
  } else if (type === 'story_event') {
    source = await client.query('SELECT project_id, canon_commit_id, story_time_interval_id FROM story_event WHERE story_event_id = $1', [bound.source.sourceId]);
    assert.equal(source.rows[0].canon_commit_id, bound.source.canonCommitId);
    assert.equal(source.rows[0].story_time_interval_id, bound.intervalId);
  } else {
    throw new Error(`assertBoundSourceIntact does not cover ${type}`);
  }
  assert.equal(source.rows.length, 1);
  assert.equal(source.rows[0].project_id, bound.projectId);
}

async function seedBoundSource(client, type, projectId = id(`bound_${type}`)) {
  await seedProject(client, projectId);
  const sourceId = id(`bound_source_${type}`);
  const intervalId = id(`bound_interval_${type}`);
  const sourceDomain = type === 'temporal_constraint' ? 'author_design' : type.startsWith('candidate_') ? 'candidate' : 'canon';
  await insertInterval(client, { projectId, intervalId, sourceDomain, sourceVersionId: sourceId });
  const source = await createValidSource(client, type, { projectId, intervalId, sourceId });
  await bind(client, {
    intervalId,
    sourceDomain: source.sourceDomain,
    sourceVersionId: source.sourceId,
    sourceType: source.sourceType,
    targetColumn: source.targetColumn,
    targetId: source.sourceId,
  });
  return { projectId, sourceId, intervalId, source };
}

async function waitForLock(observer, pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `SELECT wait_event_type, wait_event
         FROM pg_stat_activity
        WHERE pid = $1`,
      [pid],
    );
    if (rows[0]?.wait_event_type === 'Lock') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for backend ${pid} to show a Lock wait`);
}

async function waitForSpecificBlock(observer, waitingPid, blockerPid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `SELECT wait_event_type, wait_event, pg_blocking_pids($1) AS blockers
         FROM pg_stat_activity
        WHERE pid = $1`,
      [waitingPid],
    );
    const row = rows[0];
    if (row?.wait_event_type === 'Lock' && (row.blockers ?? []).map(Number).includes(Number(blockerPid))) return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for backend ${waitingPid} to be blocked by ${blockerPid}`);
}

before(async () => {
  const client = await committedClient();
  await client.query(`SET default_transaction_isolation = 'read committed'`);
  client.release();
});

after(async () => {
  await writeFile(RESULTS_PATH, JSON.stringify({
    database: 'PostgreSQL',
    isolation: 'read committed',
    schema: SCHEMA,
    outcomes,
  }, null, 2));
  await pool.end();
});

const allSourceTypes = [
  'temporal_constraint',
  'candidate_event',
  'candidate_fact_proposal',
  'candidate_state_transition',
  'canonical_text_version',
  'story_event',
  'canon_fact',
  'state_transition',
];

scenario('八种来源类型的合法创建路径', async () => {
  for (const type of allSourceTypes) {
    const client = await clientWithIsolation();
    try {
      const projectId = await seedProject(client, id(`valid_${type}`));
      const sourceVersionId = id(`source_version_${type}`);
      const { intervalId } = await insertInterval(client, { projectId, sourceDomain: type === 'temporal_constraint' ? 'author_design' : type.startsWith('candidate_') ? 'candidate' : 'canon', sourceVersionId });
      const source = await createValidSource(client, type, { projectId, intervalId, sourceId: sourceVersionId });
      assert.equal(source.sourceId, sourceVersionId, 'source_version_id must equal source object id');
      await bind(client, { intervalId, sourceDomain: source.sourceDomain, sourceVersionId: source.sourceId, sourceType: source.sourceType, targetColumn: source.targetColumn, targetId: source.sourceId });
      await client.query('COMMIT');
      const check = await committedClient();
      try {
        assert.equal(await countBindings(check, intervalId), 1);
      } finally {
        check.release();
      }
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }
});

scenario('区间无绑定时 INSERT 成功但 COMMIT 失败', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const intervalId = id('orphan_interval');
  await insertInterval(client, { projectId, intervalId, sourceDomain: 'candidate', sourceVersionId: id('unused_source') });
  await assert.rejects(
    client.query('COMMIT'),
    (error) => error.code === '23514' && error.constraint === 'time_interval_source_complete',
  );
  await rollbackQuietly(client);
  client.release();
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT 1 FROM time_interval WHERE time_interval_id = $1', [intervalId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('顺序重复绑定使用不同主键并因 time_interval_id 唯一约束失败', async () => {
  const prep = await clientWithIsolation();
  const projectId = await seedProject(prep);
  const intervalId = id('duplicate_interval');
  const sourceVersionId = id('duplicate_source');
  await insertInterval(prep, { projectId, intervalId, sourceDomain: 'candidate', sourceVersionId });
  const source = await createValidSource(prep, 'candidate_fact_proposal', { projectId, intervalId, sourceId: sourceVersionId });
  await bind(prep, { intervalId, sourceDomain: source.sourceDomain, sourceVersionId: source.sourceId, sourceType: source.sourceType, targetColumn: source.targetColumn, targetId: source.sourceId, intervalSourceId: id('binding_one') });
  await prep.query('COMMIT');
  prep.release();

  const client = await clientWithIsolation();
  const duplicateError = await (async () => {
    try {
      await bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId, sourceType: 'candidate_fact_proposal', targetColumn: 'candidate_fact_proposal_id', targetId: source.sourceId, intervalSourceId: id('binding_two') });
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(duplicateError);
  assert.equal(duplicateError.code, '23505');
  assert.equal(duplicateError.constraint, 'uq_time_interval_source_interval');
  await rollbackQuietly(client);
  client.release();
  const check = await committedClient();
  try {
    assert.equal(await countBindings(check, intervalId), 1);
  } finally {
    check.release();
  }
});

scenario('即时 CHECK 失败记录 SQLSTATE 与约束名', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const intervalId = id('check_interval');
  const sourceVersionId = id('check_source');
  await insertInterval(client, { projectId, intervalId, sourceDomain: 'candidate', sourceVersionId });
  const source = await createValidSource(client, 'candidate_fact_proposal', { projectId, intervalId });
  await assert.rejects(
    bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId, sourceType: 'candidate_event', targetColumn: 'candidate_fact_proposal_id', targetId: source.sourceId }),
    (error) => error.code === '23514' && error.constraint === 'ck_time_interval_source_target_shape',
  );
  await rollbackQuietly(client);
  client.release();
});

scenario('即时 FK 失败记录 SQLSTATE 与约束名', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const intervalId = id('fk_interval');
  const sourceVersionId = id('missing_event');
  await insertInterval(client, { projectId, intervalId, sourceDomain: 'candidate', sourceVersionId });
  await assert.rejects(
    bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: 'does_not_exist' }),
    (error) => error.code === '23503' && error.constraint === 'time_interval_source_candidate_event_id_fkey',
  );
  await rollbackQuietly(client);
  client.release();
});

scenario('即时约束合法但跨项目归属在 COMMIT 失败', async () => {
  const client = await clientWithIsolation();
  const projectA = await seedProject(client);
  const projectB = await seedProject(client);
  const { candidateVersionId } = await seedCandidateContainers(client, projectB);
  const sourceId = id('cross_project_event');
  await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id) VALUES ($1,$2,$3)', [sourceId, projectB, candidateVersionId]);
  const intervalId = id('cross_project_interval');
  await insertInterval(client, { projectId: projectA, intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId });
  await bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: sourceId });
  await assert.rejects(client.query('COMMIT'), (error) => error.code === '23514' && error.constraint === 'time_interval_source_complete');
  await rollbackQuietly(client);
  client.release();
});

scenario('来源对象区间引用更新破坏关系时 COMMIT 失败', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const { candidateVersionId } = await seedCandidateContainers(client, projectId);
  const sourceA = id('update_event');
  const factSourceId = id('update_fact');
  const intervalA = id('update_interval_a');
  const intervalB = id('update_interval_b');
  await insertInterval(client, { projectId, intervalId: intervalA, sourceDomain: 'candidate', sourceVersionId: sourceA });
  await insertInterval(client, { projectId, intervalId: intervalB, sourceDomain: 'candidate', sourceVersionId: factSourceId });
  const factSource = await createValidSource(client, 'candidate_fact_proposal', { projectId, intervalId: intervalB, sourceId: factSourceId });
  await bind(client, { intervalId: intervalB, sourceDomain: 'candidate', sourceVersionId: factSource.sourceId, sourceType: factSource.sourceType, targetColumn: factSource.targetColumn, targetId: factSource.sourceId });
  await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [sourceA, projectId, candidateVersionId, intervalA]);
  await bind(client, { intervalId: intervalA, sourceDomain: 'candidate', sourceVersionId: sourceA, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: sourceA });
  await client.query('COMMIT');
  client.release();

  const broken = await clientWithIsolation();
  await broken.query('UPDATE candidate_event SET story_time_ref = $1 WHERE candidate_event_id = $2', [intervalB, sourceA]);
  await assert.rejects(broken.query('COMMIT'), (error) => error.code === '23514' && error.constraint === 'time_interval_source_complete');
  await rollbackQuietly(broken);
  broken.release();
});


scenario('更新来源绑定同时校验旧区间和新区间', async () => {
  let client;
  let fixture;
  try {
    client = await clientWithIsolation();
    const projectId = await seedProject(client);
    const { candidateVersionId } = await seedCandidateContainers(client, projectId);
    const sourceId = id('binding_move_fact');
    const oldIntervalId = id('binding_move_old');
    await insertInterval(client, { projectId, intervalId: oldIntervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, intervalKey: id('move_key_old') });
    await client.query('INSERT INTO candidate_fact_proposal(candidate_fact_proposal_id, project_id, candidate_version_id) VALUES ($1,$2,$3)', [sourceId, projectId, candidateVersionId]);
    await bind(client, { intervalId: oldIntervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, sourceType: 'candidate_fact_proposal', targetColumn: 'candidate_fact_proposal_id', targetId: sourceId });
    await client.query('COMMIT');
    fixture = { projectId, sourceId, oldIntervalId };
    client.release();
    client = null;

    client = await clientWithIsolation();
    const newIntervalId = id('binding_move_new');
    await insertInterval(client, { projectId, intervalId: newIntervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, intervalKey: id('move_key_new') });
    await client.query('UPDATE time_interval_source SET time_interval_id = $1 WHERE time_interval_id = $2', [newIntervalId, oldIntervalId]);
    const error = await commitError(client);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
    fixture.newIntervalId = newIntervalId;
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    assert.equal(await countBindings(check, fixture.oldIntervalId), 1);
    assert.equal(await countBindings(check, fixture.newIntervalId), 0);
    const { rows } = await check.query('SELECT 1 FROM time_interval WHERE time_interval_id = $1', [fixture.newIntervalId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('合法更新区间元数据仍可提交', async () => {
  let client;
  const fixture = {};
  try {
    client = await clientWithIsolation();
    const bound = await seedBoundSource(client, 'candidate_fact_proposal');
    fixture.intervalId = bound.intervalId;
    await client.query('COMMIT');
    client.release();
    client = null;

    client = await clientWithIsolation();
    await client.query('UPDATE time_interval SET interval_key = $1 WHERE time_interval_id = $2', [id('updated_key'), fixture.intervalId]);
    await client.query('COMMIT');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    assert.equal(await countBindings(check, fixture.intervalId), 1);
  } finally {
    check.release();
  }
});

scenario('Temporal Constraint 所属 Revision 归属不一致时 COMMIT 失败', async () => {
  let client;
  const intervalId = id('temporal_cross_revision_interval');
  const sourceId = id('temporal_cross_revision');
  try {
    client = await clientWithIsolation();
    const projectA = await seedProject(client);
    const projectB = await seedProject(client);
    await insertInterval(client, { projectId: projectA, intervalId, sourceDomain: 'author_design', sourceVersionId: sourceId });
    const revisionId = id('revision_other_project');
    await client.query('INSERT INTO author_design_revision(revision_id, project_id) VALUES ($1,$2)', [revisionId, projectB]);
    await client.query('INSERT INTO temporal_constraint(temporal_constraint_id, project_id, revision_id, interval_id) VALUES ($1,$2,$3,$4)', [sourceId, projectA, revisionId, intervalId]);
    await bind(client, { intervalId, sourceDomain: 'author_design', sourceVersionId: sourceId, sourceType: 'temporal_constraint', targetColumn: 'temporal_constraint_id', targetId: sourceId });
    const error = await commitError(client);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT 1 FROM time_interval WHERE time_interval_id = $1', [intervalId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('Candidate Version 归属链不一致时 COMMIT 失败', async () => {
  let client;
  const intervalId = id('candidate_other_version_interval');
  const sourceId = id('candidate_other_version');
  try {
    client = await clientWithIsolation();
    const projectA = await seedProject(client);
    const projectB = await seedProject(client);
    const { candidateVersionId } = await seedCandidateContainers(client, projectB);
    await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id) VALUES ($1,$2,$3)', [sourceId, projectA, candidateVersionId]);
    await insertInterval(client, { projectId: projectA, intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId });
    await bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: sourceId });
    const error = await commitError(client);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT 1 FROM candidate_event WHERE candidate_event_id = $1', [sourceId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('Workflow Run 归属链不一致时 COMMIT 失败', async () => {
  let client;
  const intervalId = id('candidate_other_workflow_interval');
  const sourceId = id('candidate_other_workflow_event');
  try {
    client = await clientWithIsolation();
    const projectA = await seedProject(client);
    const projectB = await seedProject(client);
    const workflowRunId = id('workflow_other_project');
    const candidateVersionId = id('candidate_other_workflow');
    await client.query('INSERT INTO workflow_run(workflow_run_id, project_id) VALUES ($1,$2)', [workflowRunId, projectB]);
    await client.query('INSERT INTO candidate_version(candidate_version_id, project_id, workflow_run_id) VALUES ($1,$2,$3)', [candidateVersionId, projectA, workflowRunId]);
    await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id) VALUES ($1,$2,$3)', [sourceId, projectA, candidateVersionId]);
    await insertInterval(client, { projectId: projectA, intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId });
    await bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: sourceId });
    const error = await commitError(client);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT 1 FROM candidate_event WHERE candidate_event_id = $1', [sourceId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('Canon Commit 归属链不一致时 COMMIT 失败', async () => {
  let client;
  const intervalId = id('story_other_commit_interval');
  const sourceId = id('story_other_commit');
  try {
    client = await clientWithIsolation();
    const projectA = await seedProject(client);
    const projectB = await seedProject(client);
    const canonCommitId = id('canon_other_project');
    await client.query('INSERT INTO canon_commit(canon_commit_id, project_id, status) VALUES ($1,$2,$3)', [canonCommitId, projectB, 'committed']);
    await client.query('INSERT INTO story_event(story_event_id, project_id, canon_commit_id) VALUES ($1,$2,$3)', [sourceId, projectA, canonCommitId]);
    await insertInterval(client, { projectId: projectA, intervalId, sourceDomain: 'canon', sourceVersionId: sourceId });
    await bind(client, { intervalId, sourceDomain: 'canon', sourceVersionId: sourceId, sourceType: 'story_event', targetColumn: 'story_event_id', targetId: sourceId });
    const error = await commitError(client);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT 1 FROM story_event WHERE story_event_id = $1', [sourceId]);
    assert.equal(rows.length, 0);
  } finally {
    check.release();
  }
});

scenario('Author Design Revision 归属更新不能破坏已绑定来源', async () => {
  let client;
  let bound;
  let otherProject;
  try {
    client = await clientWithIsolation();
    bound = await seedBoundSource(client, 'temporal_constraint');
    otherProject = await seedProject(client);
    await client.query('COMMIT');
    client.release();
    client = null;
    client = await clientWithIsolation();
    const error = await statementError(client, 'UPDATE author_design_revision SET project_id = $1 WHERE revision_id = $2', [otherProject, bound.source.revisionId]);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const revision = await check.query('SELECT project_id FROM author_design_revision WHERE revision_id = $1', [bound.source.revisionId]);
    assert.equal(revision.rows[0].project_id, bound.projectId);
    await assertBoundSourceIntact(check, 'temporal_constraint', bound);
  } finally {
    check.release();
  }

});

scenario('Candidate Version 归属更新不能破坏已绑定来源', async () => {
  let client;
  let bound;
  let otherProject;
  try {
    client = await clientWithIsolation();
    bound = await seedBoundSource(client, 'candidate_event');
    otherProject = await seedProject(client);
    await client.query('COMMIT');
    client.release();
    client = null;
    client = await clientWithIsolation();
    const error = await statementError(client, 'UPDATE candidate_version SET project_id = $1 WHERE candidate_version_id = $2', [otherProject, bound.source.candidateVersionId]);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const candidate = await check.query('SELECT project_id, workflow_run_id FROM candidate_version WHERE candidate_version_id = $1', [bound.source.candidateVersionId]);
    assert.equal(candidate.rows[0].project_id, bound.projectId);
    assert.equal(candidate.rows[0].workflow_run_id, bound.source.workflowRunId);
    await assertBoundSourceIntact(check, 'candidate_event', bound);
  } finally {
    check.release();
  }

});

scenario('Workflow Run 归属更新不能破坏已绑定来源', async () => {
  let client;
  let bound;
  let otherProject;
  try {
    client = await clientWithIsolation();
    bound = await seedBoundSource(client, 'candidate_event');
    otherProject = await seedProject(client);
    await client.query('COMMIT');
    client.release();
    client = null;
    client = await clientWithIsolation();
    const error = await statementError(client, 'UPDATE workflow_run SET project_id = $1 WHERE workflow_run_id = $2', [otherProject, bound.source.workflowRunId]);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const workflow = await check.query('SELECT project_id FROM workflow_run WHERE workflow_run_id = $1', [bound.source.workflowRunId]);
    assert.equal(workflow.rows[0].project_id, bound.projectId);
    const candidate = await check.query('SELECT project_id, workflow_run_id FROM candidate_version WHERE candidate_version_id = $1', [bound.source.candidateVersionId]);
    assert.equal(candidate.rows[0].project_id, bound.projectId);
    assert.equal(candidate.rows[0].workflow_run_id, bound.source.workflowRunId);
    await assertBoundSourceIntact(check, 'candidate_event', bound);
  } finally {
    check.release();
  }

});

scenario('Canon Commit 项目归属更新不能破坏已绑定来源', async () => {
  let client;
  let bound;
  let otherProject;
  try {
    client = await clientWithIsolation();
    bound = await seedBoundSource(client, 'story_event');
    otherProject = await seedProject(client);
    await client.query('COMMIT');
    client.release();
    client = null;
    client = await clientWithIsolation();
    const error = await statementError(client, 'UPDATE canon_commit SET project_id = $1 WHERE canon_commit_id = $2', [otherProject, bound.source.canonCommitId]);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const commit = await check.query('SELECT project_id, status FROM canon_commit WHERE canon_commit_id = $1', [bound.source.canonCommitId]);
    assert.equal(commit.rows[0].project_id, bound.projectId);
    assert.equal(commit.rows[0].status, 'committed');
    await assertBoundSourceIntact(check, 'story_event', bound);
  } finally {
    check.release();
  }

});

scenario('已绑定 Canon Commit 从 committed 改为 preparing 不能提交', async () => {
  let client;
  let bound;
  try {
    client = await clientWithIsolation();
    bound = await seedBoundSource(client, 'story_event');
    await client.query('COMMIT');
    client.release();
    client = null;
    client = await clientWithIsolation();
    const error = await statementError(client, 'UPDATE canon_commit SET status = $1 WHERE canon_commit_id = $2', ['preparing', bound.source.canonCommitId]);
    assert.ok(error);
    assert.equal(error.code, '23514');
    assert.equal(error.constraint, 'time_interval_source_complete');
  } finally {
    if (client) {
      await rollbackQuietly(client);
      client.release();
    }
  }
  const check = await committedClient();
  try {
    const { rows } = await check.query('SELECT status FROM canon_commit WHERE canon_commit_id = $1', [bound.source.canonCommitId]);
    assert.equal(rows[0].status, 'committed');
    assert.equal(await countBindings(check, bound.intervalId), 1);
  } finally {
    check.release();
  }
});

scenario('五类区间引用对象不得借用其他对象的区间', async () => {
  const refTypes = ['temporal_constraint', 'candidate_event', 'candidate_state_transition', 'story_event', 'state_transition'];
  for (const type of refTypes) {
    const table = type;
    const updateColumn = {
      temporal_constraint: 'interval_id',
      candidate_event: 'story_time_ref',
      candidate_state_transition: 'story_time_ref',
      story_event: 'story_time_interval_id',
      state_transition: 'story_time_interval_id',
    }[type];
    let seedClient;
    let bound;
    try {
      seedClient = await clientWithIsolation();
      bound = await seedBoundSource(seedClient, type);
      await seedClient.query('COMMIT');
    } finally {
      if (seedClient) {
        await rollbackQuietly(seedClient);
        seedClient.release();
      }
    }

    let insertClient;
    const insertedSourceId = id(`borrow_insert_${type}`);
    try {
      insertClient = await clientWithIsolation();
      await createValidSource(insertClient, type, { projectId: bound.projectId, intervalId: bound.intervalId, sourceId: insertedSourceId });
      const error = await commitError(insertClient);
      assert.ok(error, `${type} INSERT path unexpectedly committed`);
      assert.equal(error.code, '23514');
      assert.equal(error.constraint, 'time_interval_source_complete');
    } finally {
      if (insertClient) {
        await rollbackQuietly(insertClient);
        insertClient.release();
      }
    }

    let updateClient;
    const updateSourceId = id(`borrow_update_${type}`);
    try {
      updateClient = await clientWithIsolation();
      await createValidSource(updateClient, type, { projectId: bound.projectId, intervalId: null, sourceId: updateSourceId });
      await updateClient.query('COMMIT');
    } finally {
      if (updateClient) {
        await rollbackQuietly(updateClient);
        updateClient.release();
      }
    }

    try {
      updateClient = await clientWithIsolation();
      await updateClient.query(`UPDATE ${table} SET ${updateColumn} = $1 WHERE ${type}_id = $2`, [bound.intervalId, updateSourceId]);
      const error = await commitError(updateClient);
      assert.ok(error, `${type} UPDATE path unexpectedly committed`);
      assert.equal(error.code, '23514');
      assert.equal(error.constraint, 'time_interval_source_complete');
    } finally {
      if (updateClient) {
        await rollbackQuietly(updateClient);
        updateClient.release();
      }
    }

    const check = await committedClient();
    try {
      assert.equal(await countBindings(check, bound.intervalId), 1);
      const { rows: insertedRows } = await check.query(`SELECT 1 FROM ${table} WHERE ${type}_id = $1`, [insertedSourceId]);
      assert.equal(insertedRows.length, 0);
      const { rows } = await check.query(`SELECT * FROM ${table} WHERE ${type}_id = $1`, [updateSourceId]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0][updateColumn], null);
    } finally {
      check.release();
    }
  }
});

scenario('删除被绑定来源对象不能成功提交', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const { candidateVersionId } = await seedCandidateContainers(client, projectId);
  const intervalId = id('delete_source_interval');
  const sourceId = id('delete_source_event');
  await insertInterval(client, { projectId, intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId });
  await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [sourceId, projectId, candidateVersionId, intervalId]);
  await bind(client, { intervalId, sourceDomain: 'candidate', sourceVersionId: sourceId, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: sourceId });
  await client.query('COMMIT');
  client.release();

  const broken = await clientWithIsolation();
  await assert.rejects(
    broken.query('DELETE FROM candidate_event WHERE candidate_event_id = $1', [sourceId]),
    (error) => error.code === '23503' && error.constraint === 'time_interval_source_candidate_event_id_fkey',
  );
  await rollbackQuietly(broken);
  broken.release();

  const check = await committedClient();
  try {
    assert.equal(await countBindings(check, intervalId), 1);
  } finally {
    check.release();
  }
});

scenario('删除绑定不能提交留下孤立区间', async () => {
  const client = await clientWithIsolation();
  const projectId = await seedProject(client);
  const intervalId = id('delete_binding_interval');
  const sourceId = id('delete_temporal_constraint');
  const interval = await insertInterval(client, { projectId, intervalId, sourceDomain: 'author_design', sourceVersionId: sourceId });
  const source = await createValidSource(client, 'temporal_constraint', { projectId, intervalId, sourceId });
  await bind(client, { intervalId: interval.intervalId, sourceDomain: source.sourceDomain, sourceVersionId: source.sourceId, sourceType: source.sourceType, targetColumn: source.targetColumn, targetId: source.sourceId });
  await client.query('COMMIT');
  client.release();

  const broken = await clientWithIsolation();
  await broken.query('DELETE FROM time_interval_source WHERE time_interval_id = $1', [intervalId]);
  await assert.rejects(broken.query('COMMIT'), (error) => error.code === '23514' && error.constraint === 'time_interval_source_complete');
  await rollbackQuietly(broken);
  broken.release();

  const check = await committedClient();
  try {
    assert.equal(await countBindings(check, intervalId), 1);
  } finally {
    check.release();
  }
});


const protectedRaceConfigs = [
  {
    label: 'Author Design Revision',
    sourceType: 'temporal_constraint',
    sourceDomain: 'author_design',
    sourceTable: 'temporal_constraint',
    sourceIdColumn: 'temporal_constraint_id',
    intervalColumn: 'interval_id',
    containerType: 'author_design_revision',
    mutate: async (client, fixture) => client.query('UPDATE author_design_revision SET project_id = $1 WHERE revision_id = $2', [fixture.otherProjectId, fixture.containerId]),
    containerState: (fixture) => ({ projectId: fixture.projectId }),
  },
  {
    label: 'Workflow Run',
    sourceType: 'candidate_event',
    sourceDomain: 'candidate',
    sourceTable: 'candidate_event',
    sourceIdColumn: 'candidate_event_id',
    intervalColumn: 'story_time_ref',
    containerType: 'workflow_run',
    mutate: async (client, fixture) => client.query('UPDATE workflow_run SET project_id = $1 WHERE workflow_run_id = $2', [fixture.otherProjectId, fixture.containerId]),
    containerState: (fixture) => ({ projectId: fixture.projectId }),
  },
  {
    label: 'Candidate Version',
    sourceType: 'candidate_event',
    sourceDomain: 'candidate',
    sourceTable: 'candidate_event',
    sourceIdColumn: 'candidate_event_id',
    intervalColumn: 'story_time_ref',
    containerType: 'candidate_version',
    mutate: async (client, fixture) => client.query('UPDATE candidate_version SET project_id = $1 WHERE candidate_version_id = $2', [fixture.otherProjectId, fixture.containerId]),
    containerState: (fixture) => ({ projectId: fixture.projectId }),
  },
  {
    label: 'Canon Commit',
    sourceType: 'story_event',
    sourceDomain: 'canon',
    sourceTable: 'story_event',
    sourceIdColumn: 'story_event_id',
    intervalColumn: 'story_time_interval_id',
    containerType: 'canon_commit',
    mutate: async (client, fixture) => client.query('UPDATE canon_commit SET status = $1 WHERE canon_commit_id = $2', ['preparing', fixture.containerId]),
    containerState: (fixture) => ({ status: 'committed' }),
  },
];

async function prepareProtectedRaceFixture(client, config) {
  const projectId = await seedProject(client);
  const otherProjectId = await seedProject(client);
  const sourceId = id(`race_${config.sourceType}`);
  let containerId;
  let candidateVersionId = null;
  let workflowRunId = null;
  if (config.sourceType === 'temporal_constraint') {
    containerId = id('race_revision');
    await client.query('INSERT INTO author_design_revision(revision_id, project_id) VALUES ($1,$2)', [containerId, projectId]);
  } else if (config.sourceType === 'candidate_event') {
    workflowRunId = id('race_workflow');
    candidateVersionId = id('race_candidate');
    containerId = config.containerType === 'candidate_version' ? candidateVersionId : workflowRunId;
    await client.query('INSERT INTO workflow_run(workflow_run_id, project_id) VALUES ($1,$2)', [workflowRunId, projectId]);
    await client.query('INSERT INTO candidate_version(candidate_version_id, project_id, workflow_run_id) VALUES ($1,$2,$3)', [candidateVersionId, projectId, workflowRunId]);
  } else {
    containerId = id('race_commit');
    await client.query('INSERT INTO canon_commit(canon_commit_id, project_id, status) VALUES ($1,$2,$3)', [containerId, projectId, 'committed']);
  }
  return { projectId, otherProjectId, sourceId, containerId, candidateVersionId, workflowRunId };
}

async function createProtectedRaceSource(client, config, fixture) {
  const intervalId = id(`race_interval_${config.sourceType}`);
  await insertInterval(client, {
    projectId: fixture.projectId,
    intervalId,
    sourceDomain: config.sourceDomain,
    sourceVersionId: fixture.sourceId,
    intervalKey: id(`race_key_${config.sourceType}`),
  });
  if (config.sourceType === 'temporal_constraint') {
    await client.query('INSERT INTO temporal_constraint(temporal_constraint_id, project_id, revision_id, interval_id) VALUES ($1,$2,$3,$4)', [fixture.sourceId, fixture.projectId, fixture.containerId, intervalId]);
  } else if (config.sourceType === 'candidate_event') {
    await client.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [fixture.sourceId, fixture.projectId, fixture.candidateVersionId, intervalId]);
  } else {
    await client.query('INSERT INTO story_event(story_event_id, project_id, canon_commit_id, story_time_interval_id) VALUES ($1,$2,$3,$4)', [fixture.sourceId, fixture.projectId, fixture.containerId, intervalId]);
  }
  await bind(client, {
    intervalId,
    sourceDomain: config.sourceDomain,
    sourceVersionId: fixture.sourceId,
    sourceType: config.sourceType,
    targetColumn: `${config.sourceType}_id`,
    targetId: fixture.sourceId,
  });
  return intervalId;
}

async function queryProtectedRaceState(observer, config, fixture) {
  const container = config.containerType === 'author_design_revision'
    ? await observer.query('SELECT project_id AS value FROM author_design_revision WHERE revision_id = $1', [fixture.containerId])
    : config.containerType === 'workflow_run'
      ? await observer.query('SELECT project_id AS value FROM workflow_run WHERE workflow_run_id = $1', [fixture.containerId])
      : config.containerType === 'candidate_version'
        ? await observer.query('SELECT project_id AS value FROM candidate_version WHERE candidate_version_id = $1', [fixture.containerId])
        : await observer.query('SELECT status AS value FROM canon_commit WHERE canon_commit_id = $1', [fixture.containerId]);
  const sourceContainerColumn = config.containerType === 'author_design_revision'
    ? 'revision_id'
    : config.containerType === 'workflow_run' || config.containerType === 'candidate_version'
      ? 'candidate_version_id'
      : 'canon_commit_id';
  const source = await observer.query(`SELECT project_id, ${sourceContainerColumn} AS container_id FROM ${config.sourceTable} WHERE ${config.sourceIdColumn} = $1`, [fixture.sourceId]);
  const interval = await observer.query('SELECT time_interval_id FROM time_interval_source WHERE source_version_id = $1', [fixture.sourceId]);
  return { containerValue: container.rows[0]?.value ?? null, source: source.rows, interval: interval.rows };
}

async function runRejectedContainerUpdateThenCreateSource(config) {
  const seed = await committedClient();
  const fixture = await prepareProtectedRaceFixture(seed, config);
  seed.release();
  const holder = await clientWithIsolation();
  const racer = await clientWithIsolation();
  const observer = await committedClient();
  let holderError = null;
  try {
    try {
      await config.mutate(holder, fixture);
      await holder.query('SET CONSTRAINTS ALL IMMEDIATE');
    } catch (error) {
      holderError = { code: error.code, constraint: error.constraint, message: error.message };
      await rollbackQuietly(holder);
    }
    assert.ok(holderError);
    assert.equal(holderError.code, '23514');
    assert.equal(holderError.constraint, 'time_interval_source_complete');

    await racer.query("SET LOCAL statement_timeout = '5s'");
    await createProtectedRaceSource(racer, config, fixture);
    await racer.query('COMMIT');
    const state = await queryProtectedRaceState(observer, config, fixture);
    assert.equal(state.source.length, 1);
    assert.equal(state.interval.length, 1);
    assert.equal(state.containerValue, config.containerState(fixture).projectId ?? config.containerState(fixture).status);
    return `${config.label}: container UPDATE immediately rejected ${holderError.code}/${holderError.constraint}; source COMMIT succeeded; no retry`;
  } finally {
    await rollbackQuietly(holder);
    await rollbackQuietly(racer);
    observer.release();
    holder.release();
    racer.release();
  }
}

async function runBindingFirstProtectedRace(config, rollbackSource) {
  const seed = await committedClient();
  const fixture = await prepareProtectedRaceFixture(seed, config);
  seed.release();
  const sourceHolder = await clientWithIsolation();
  const containerWriter = await clientWithIsolation();
  const observer = await committedClient();
  let sourcePid;
  let writerPid;
  try {
    await createProtectedRaceSource(sourceHolder, config, fixture);
    await sourceHolder.query('SET CONSTRAINTS ALL IMMEDIATE');
    sourcePid = (await sourceHolder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    writerPid = (await containerWriter.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await containerWriter.query("SET LOCAL lock_timeout = '5s'");
    const writerResultPromise = (async () => {
      try {
        await config.mutate(containerWriter, fixture);
        await containerWriter.query('SET CONSTRAINTS ALL IMMEDIATE');
        await containerWriter.query('COMMIT');
        return { ok: true };
      } catch (error) {
        await rollbackQuietly(containerWriter);
        return { ok: false, code: error.code, constraint: error.constraint, message: error.message };
      }
    })();
    const block = await waitForSpecificBlock(observer, writerPid, sourcePid);
    const sourceResult = rollbackSource
      ? await sourceHolder.query('ROLLBACK').then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code, constraint: error.constraint }))
      : await sourceHolder.query('COMMIT').then(() => ({ ok: true }), (error) => ({ ok: false, code: error.code, constraint: error.constraint }));
    const writerResult = await writerResultPromise;
    assert.deepEqual(sourceResult, { ok: true });
    assert.equal(writerResult.ok, false);
    assert.equal(writerResult.code, '23514');
    assert.equal(writerResult.constraint, 'time_interval_source_complete');
    const state = await queryProtectedRaceState(observer, config, fixture);
    if (rollbackSource) {
      assert.equal(state.source.length, 0);
      assert.equal(state.interval.length, 0);
    } else {
      assert.equal(state.source.length, 1);
      assert.equal(state.interval.length, 1);
    }
    assert.equal(state.containerValue, config.containerState(fixture).projectId ?? config.containerState(fixture).status);
    return `${config.label}: writer blocked by PID ${sourcePid}; wait=${block.wait_event}; source=${rollbackSource ? 'rollback' : 'commit'}; container UPDATE rejected ${writerResult.code}/${writerResult.constraint}`;
  } finally {
    await rollbackQuietly(sourceHolder);
    await rollbackQuietly(containerWriter);
    observer.release();
    sourceHolder.release();
    containerWriter.release();
  }
}


async function runLegalSharedContainerRace(config) {
  const seed = await committedClient();
  const base = await prepareProtectedRaceFixture(seed, config);
  seed.release();
  const fixtureA = { ...base, sourceId: id(`legal_${config.sourceType}_a`) };
  const fixtureB = { ...base, sourceId: id(`legal_${config.sourceType}_b`) };
  const a = await clientWithIsolation();
  const b = await clientWithIsolation();
  const observer = await committedClient();
  let aPid;
  let bPid;
  try {
    const intervalA = await createProtectedRaceSource(a, config, fixtureA);
    const intervalB = await createProtectedRaceSource(b, config, fixtureB);
    await a.query("SET LOCAL deadlock_timeout = '100ms'");
    await b.query("SET LOCAL deadlock_timeout = '100ms'");
    await a.query("SET LOCAL statement_timeout = '5s'");
    await b.query("SET LOCAL statement_timeout = '5s'");
    aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

    let finished = false;
    const commitPromise = Promise.all([
      a.query('COMMIT').then(() => ({ side: 'A', ok: true }), (error) => ({ side: 'A', ok: false, code: error.code, constraint: error.constraint, message: error.message })),
      b.query('COMMIT').then(() => ({ side: 'B', ok: true }), (error) => ({ side: 'B', ok: false, code: error.code, constraint: error.constraint, message: error.message })),
    ]).finally(() => { finished = true; });
    const observed = [];
    const deadline = Date.now() + 5000;
    while (!finished && Date.now() < deadline) {
      const { rows } = await observer.query(
        `SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
           FROM pg_stat_activity WHERE pid IN ($1,$2)`,
        [aPid, bPid],
      );
      for (const row of rows) {
        if (row.wait_event_type === 'Lock') observed.push(row);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const results = await commitPromise;
    assert.deepEqual(results.map((r) => r.ok), [true, true]);
    assert.equal(results.some((r) => r.code === '40P01'), false);

    const stateA = await queryProtectedRaceState(observer, config, fixtureA);
    const stateB = await queryProtectedRaceState(observer, config, fixtureB);
    assert.equal(stateA.source.length, 1);
    assert.equal(stateB.source.length, 1);
    assert.equal(stateA.interval.length, 1);
    assert.equal(stateB.interval.length, 1);
    assert.equal(stateA.containerValue, config.containerState(base).projectId ?? config.containerState(base).status);
    assert.equal(stateB.containerValue, config.containerState(base).projectId ?? config.containerState(base).status);
    return `${config.label}: A/B COMMIT 成功；intervals=${intervalA},${intervalB}; observed_lock_samples=${observed.length}`;
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    observer.release();
    a.release();
    b.release();
  }
}

scenario('合法来源并发创建默认延后 COMMIT', async () => {
  const evidence = [];
  for (const config of protectedRaceConfigs.filter((item) => ['temporal_constraint', 'candidate_event', 'story_event'].includes(item.sourceType) && item.containerType !== 'candidate_version')) {
    evidence.push(await runLegalSharedContainerRace(config));
  }
  return evidence.join(' | ');
});


scenario('父子无变化更新不形成反向等待', async () => {
  let seed;
  let a;
  let b;
  let observer;
  let bound;
  try {
    seed = await clientWithIsolation();
    bound = await seedBoundSource(seed, 'candidate_event');
    await seed.query('COMMIT');
    seed.release();
    seed = null;

    a = await clientWithIsolation();
    b = await clientWithIsolation();
    observer = await committedClient();
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await a.query("SET LOCAL statement_timeout = '5s'");
    await b.query("SET LOCAL statement_timeout = '5s'");
    await a.query('UPDATE workflow_run SET project_id = project_id WHERE workflow_run_id = $1', [bound.source.workflowRunId]);
    await b.query('UPDATE candidate_version SET project_id = project_id WHERE candidate_version_id = $1', [bound.source.candidateVersionId]);

    let finished = false;
    const commits = Promise.all([
      a.query('COMMIT').then(() => ({ side: 'A', ok: true }), (error) => ({ side: 'A', ok: false, code: error.code, constraint: error.constraint, message: error.message })),
      b.query('COMMIT').then(() => ({ side: 'B', ok: true }), (error) => ({ side: 'B', ok: false, code: error.code, constraint: error.constraint, message: error.message })),
    ]).finally(() => { finished = true; });
    const observed = [];
    const deadline = Date.now() + 5000;
    while (!finished && Date.now() < deadline) {
      const { rows } = await observer.query(
        `SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blockers
           FROM pg_stat_activity WHERE pid IN ($1,$2)`,
        [aPid, bPid],
      );
      observed.push(...rows.filter((row) => row.wait_event_type === 'Lock'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const results = await commits;
    assert.deepEqual(results.map((result) => result.ok), [true, true]);
    assert.equal(results.some((result) => result.code === '40P01'), false);
    const state = await queryProtectedRaceState(observer, {
      containerType: 'workflow_run',
      sourceTable: 'candidate_event',
      sourceIdColumn: 'candidate_event_id',
    }, {
      containerId: bound.source.workflowRunId,
      sourceId: bound.source.sourceId,
    });
    assert.equal(state.containerValue, bound.projectId);
    assert.equal(state.source.length, 1);
    assert.equal(state.interval.length, 1);
    assert.equal(observed.length, 0);
    return `A/B COMMIT 成功；observed_lock_samples=${observed.length}`;
  } finally {
    for (const client of [seed, a, b]) {
      if (client) {
        await rollbackQuietly(client);
        client.release();
      }
    }
    if (observer) observer.release();
  }
});

scenario('容器非法更新被即时拒绝后来源可合法创建', async () => {
  const evidence = [];
  for (const config of protectedRaceConfigs) {
    evidence.push(await runRejectedContainerUpdateThenCreateSource(config));
  }
  return evidence.join(' | ');
});

scenario('并发归属保护：来源绑定先持锁，容器后尝试', async () => {
  const evidence = [];
  for (const config of protectedRaceConfigs) {
    evidence.push(await runBindingFirstProtectedRace(config, false));
  }
  evidence.push(await runBindingFirstProtectedRace(protectedRaceConfigs[2], true));
  return evidence.join(' | ');
});

async function concurrentCase({ rollbackA }) {
  const seed = await committedClient();
  const projectId = await seedProject(seed);
  const { candidateVersionId } = await seedCandidateContainers(seed, projectId);
  seed.release();

  const a = await clientWithIsolation();
  const b = await clientWithIsolation();
  const observer = await committedClient();
  const intervalId = id(rollbackA ? 'race_rollback' : 'race_commit');
  const eventA = id('race_event_a');
  const eventB = id('race_event_b');

  await a.query('INSERT INTO time_interval(time_interval_id, project_id, source_domain, source_version_id, interval_key, time_kind) VALUES ($1,$2,$3,$4,$5,$6)', [intervalId, projectId, 'candidate', eventA, id('race_key'), 'relative']);
  await a.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [eventA, projectId, candidateVersionId, intervalId]);
  await bind(a, { intervalId, sourceDomain: 'candidate', sourceVersionId: eventA, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: eventA });

  const { rows: pidRows } = await b.query('SELECT pg_backend_pid() AS pid');
  const bPid = pidRows[0].pid;
  await b.query("SET LOCAL lock_timeout = '5s'");
  const bInsert = b.query('INSERT INTO time_interval(time_interval_id, project_id, source_domain, source_version_id, interval_key, time_kind) VALUES ($1,$2,$3,$4,$5,$6)', [intervalId, projectId, 'candidate', eventB, id('race_key_b'), 'relative']).then(() => null, (error) => error);

  try {
    const lockInfo = await waitForLock(observer, bPid, 5000);
    if (rollbackA) {
      await a.query('ROLLBACK');
      const bError = await bInsert;
      assert.equal(bError, null);
      await b.query('INSERT INTO candidate_event(candidate_event_id, project_id, candidate_version_id, story_time_ref) VALUES ($1,$2,$3,$4)', [eventB, projectId, candidateVersionId, intervalId]);
      await bind(b, { intervalId, sourceDomain: 'candidate', sourceVersionId: eventB, sourceType: 'candidate_event', targetColumn: 'candidate_event_id', targetId: eventB });
      await b.query('COMMIT');
    } else {
      await a.query('COMMIT');
      const bError = await bInsert;
      assert.ok(bError);
      assert.equal(bError.code, '23505');
      assert.equal(bError.constraint, 'time_interval_pkey');
      await rollbackQuietly(b);
    }

    const { rows } = await observer.query('SELECT count(*)::int AS count FROM time_interval_source WHERE time_interval_id = $1', [intervalId]);
    assert.equal(rows[0].count, 1);
    return rollbackA
      ? `B wait_event_type=${lockInfo.wait_event_type}; wait_event=${lockInfo.wait_event}; A ROLLBACK 后 B COMMIT 成功；final binding count=1`
      : `B wait_event_type=${lockInfo.wait_event_type}; wait_event=${lockInfo.wait_event}; B SQLSTATE 23505；constraint time_interval_pkey；final binding count=1`;
  } finally {
    await rollbackQuietly(a);
    await rollbackQuietly(b);
    observer.release();
    a.release();
    b.release();
  }
}

scenario('两个连接竞争同一区间主键：A 提交则 B 冲突', async () => {
  return concurrentCase({ rollbackA: false });
});

scenario('两个连接竞争同一区间主键：A 回滚则 B 完成', async () => {
  return concurrentCase({ rollbackA: true });
});
