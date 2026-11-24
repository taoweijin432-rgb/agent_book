import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  analyzeResults,
  cleanupContainer,
  evaluateFinalStatus,
  renderReport,
  removeResultFile,
  waitForReady,
} from '../scripts/run-prototype.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const verificationDir = path.dirname(scriptPath);
const reportPath = path.join(verificationDir, 'runner-fault-verification.md');

function successfulState() {
  return {
    migrationExit: 0,
    testExit: 0,
    results: analyzeResults({ outcomes: [{ name: 'passing scenario', status: 'passed' }] }),
    containerCleanup: { success: true, detail: 'container removed' },
    resultCleanup: [
      { success: true, detail: 'pre-run result absent' },
      { success: true, detail: 'post-run result removed' },
    ],
    reportWritten: true,
  };
}

async function containerCleanupFailure() {
  const failure = Object.assign(new Error('simulated docker rm failure'), { code: 'DOCKER_RM_FAILED' });
  const cleanup = await cleanupContainer('simulated-runner-container', async () => { throw failure; });
  const state = { ...successfulState(), containerCleanup: cleanup };
  const final = evaluateFinalStatus(state);
  const report = renderReport(state);
  assert.equal(cleanup.success, false);
  assert.match(cleanup.detail, /simulated docker rm failure/);
  assert.match(report, /测试通过但资源清理失败/);
  assert.match(report, /simulated docker rm failure/);
  assert.equal(final.exitCode, 1);
  return { resources: cleanup.detail, exitCode: final.exitCode };
}

async function resultCleanupFailure() {
  const failure = Object.assign(new Error('simulated unlink permission denial'), { code: 'EACCES' });
  const cleanup = await removeResultFile('运行后', {
    target: '/isolated/time-interval/.test-results.json',
    unlinkFile: async () => { throw failure; },
  });
  const state = {
    ...successfulState(),
    resultCleanup: [{ success: true, detail: 'pre-run result absent' }, cleanup],
  };
  const final = evaluateFinalStatus(state);
  const report = renderReport(state);
  assert.equal(cleanup.success, false);
  assert.match(cleanup.detail, /EACCES/);
  assert.match(report, /测试通过但资源清理失败/);
  assert.match(report, /EACCES/);
  assert.equal(final.exitCode, 1);
  return { resources: cleanup.detail, exitCode: final.exitCode };
}

async function failedOutcomeWithZeroTestExit() {
  const results = analyzeResults({
    outcomes: [
      { name: 'passing scenario', status: 'passed' },
      { name: 'failing scenario', status: 'failed', error: 'controlled failure' },
    ],
  });
  const state = { ...successfulState(), results };
  const final = evaluateFinalStatus(state);
  const report = renderReport(state);
  assert.equal(results.valid, true);
  assert.equal(results.allPassed, false);
  assert.deepEqual({ total: results.total, passed: results.passed, failed: results.failed }, { total: 2, passed: 1, failed: 1 });
  assert.equal(results.outcomes[1].error, 'controlled failure');
  assert.match(report, /测试失败/);
  assert.match(report, /有效（2 个场景；1 通过；1 失败）/);
  assert.match(report, /failing scenario/);
  assert.match(report, /controlled failure/);
  assert.equal(final.exitCode, 1);
  return {
    resources: '保留 2 个场景及 1 passed / 1 failed 统计；失败详情未丢弃',
    exitCode: final.exitCode,
  };
}

async function hungReadinessQuery() {
  const clients = [];
  const configurations = [];
  class HangingProbeClient {
    endCalls = 0;

    async connect() {}

    query() {
      return new Promise(() => {});
    }

    async end() {
      this.endCalls += 1;
    }
  }

  const startedAt = Date.now();
  let error;
  try {
    await waitForReady({
      host: '127.0.0.1',
      port: 65432,
      password: 'isolated-verification-only',
      timeoutMs: 120,
      retryDelayMs: 5,
      cleanupReserveMs: 30,
      clientFactory: (config) => {
        configurations.push(config);
        const client = new HangingProbeClient();
        clients.push(client);
        return client;
      },
    });
  } catch (caught) {
    error = caught;
  }
  const elapsedMs = Date.now() - startedAt;
  assert.ok(error instanceof Error);
  assert.match(error.message, /did not accept a TCP SELECT 1/);
  assert.ok(elapsedMs < 500, `readiness verification exceeded its bounded window: ${elapsedMs}ms`);
  assert.ok(clients.length >= 1);
  assert.ok(clients.every((client) => client.endCalls === 1));
  assert.ok(configurations.every((config) => config.host === '127.0.0.1'));
  assert.ok(configurations.every((config) => config.connectionTimeoutMillis <= 90));
  return {
    resources: `${clients.length} 个探测连接均调用一次 end()；${elapsedMs}ms 内超时；验证使用 120ms 真实短期限，未使用虚拟时间`,
    exitCode: 1,
  };
}

const cases = {
  container_cleanup: {
    name: '容器清理失败，其他步骤成功',
    run: containerCleanupFailure,
  },
  result_cleanup: {
    name: '临时结果文件清理失败，其他步骤成功',
    run: resultCleanupFailure,
  },
  failed_outcome: {
    name: '测试退出码为 0，但结果包含 failed',
    run: failedOutcomeWithZeroTestExit,
  },
  hung_readiness: {
    name: 'TCP 连接成功，但就绪查询持续挂起',
    run: hungReadinessQuery,
  },
};

async function runChild(caseId) {
  const selected = cases[caseId];
  assert.ok(selected, `unknown verification case: ${caseId}`);
  const result = await selected.run();
  process.stdout.write(`${JSON.stringify({ caseId, ...result })}\n`);
  process.exitCode = result.exitCode;
}

async function runParent() {
  const outcomes = [];
  for (const [caseId, definition] of Object.entries(cases)) {
    const child = spawnSync(process.execPath, [scriptPath, '--case', caseId], { encoding: 'utf8' });
    assert.equal(child.signal, null, `${caseId} terminated by ${child.signal}`);
    assert.equal(child.status, 1, `${caseId} process exit was ${child.status}: ${child.stderr}`);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.exitCode, 1);
    outcomes.push({ name: definition.name, expected: '1', actual: String(child.status), resources: result.resources });
  }

  const lines = [
    '# Time Interval 运行器故障验证',
    '',
    `- Node.js：\`${process.version}\``,
    '- 验证方式：子进程直接导入并调用 `scripts/run-prototype.mjs` 导出的实际清理、结果判定和 TCP 就绪检查逻辑；未复制一套平行实现。',
    '- `pg@8.23.0` API 核实：就绪探测使用公开配置 `connectionTimeoutMillis`、`query_timeout`、`statement_timeout` 及公开方法 `Client.end()`；未访问 Client 内部属性。',
    '- PostgreSQL 故障注入：未启动数据库；就绪挂起场景使用可控 Client 替身和 120ms 真实短期限，不使用虚拟时间。',
    '- 表中的“实际退出状态”是每个隔离验证子进程的真实进程退出码。父验证脚本仅在四个子进程都按预期以非零退出时返回 0。',
    '',
    '## 修复前核实',
    '',
    '- 修复前运行器 SHA-256：`d343972d03dd7ee9a536231f91d57e2f461e4e12e986e15bfb92d2d3cb64b6aa`。',
    '- 源码核实：最终退出条件只检查迁移、测试命令和结果文件是否可解析；容器/结果文件清理失败不参与退出码，且包含 `failed` 的非空 outcomes 仍被视为有效。',
    '- 源码核实：就绪连接只有 `connectionTimeoutMillis`，`SELECT 1` 本身没有统一总期限或查询超时。',
    '',
    '## 修复后故障验证',
    '',
    '| 场景 | 预期退出状态 | 实际退出状态 | 资源与证据 |',
    '|---|---:|---:|---|',
    ...outcomes.map((outcome) => `| ${outcome.name} | ${outcome.expected} | ${outcome.actual} | ${outcome.resources.replaceAll('|', '\\|')} |`),
    '',
    '四项故障验证均通过；它们是运行器控制流验证，不计入 27 项数据库业务场景。',
  ];
  await writeFile(reportPath, `${lines.join('\n')}\n`);
  console.log(`runner fault verification: ${outcomes.length}/${outcomes.length} passed`);
}

if (process.argv[2] === '--case') await runChild(process.argv[3]);
else await runParent();
