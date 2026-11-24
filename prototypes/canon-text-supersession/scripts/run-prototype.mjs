import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'postgres:18.6';
const container = `canon-text-supersession-fixture-${process.pid}-${Date.now()}`;
const database = 'canon_text_supersession';
const schema = 'canon_text_supersession_fixture';
const password = randomBytes(24).toString('hex');
const resultPath = path.join(root, '.test-results.json');
const reportPath = path.join(root, 'verification', 'runner-result.md');
const readinessTimeoutMs = 30_000;
const readinessCleanupReserveMs = 500;

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

function runInherit(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  return result.status ?? 1;
}

function databaseUrl(port, databaseName = database) {
  return `postgres://postgres:${password}@127.0.0.1:${port}/${databaseName}`;
}

async function withTcpClient(port, databaseName, action) {
  const client = new Client({ connectionString: databaseUrl(port, databaseName) });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

function remainingTime(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function withinTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeReadinessClient(client, deadline) {
  const timeoutMs = remainingTime(deadline);
  if (timeoutMs <= 0) throw new Error('Readiness probe deadline expired before the probe connection closed');
  await withinTimeout(client.end(), timeoutMs, 'Readiness probe connection did not close before the total deadline');
}

export async function probeTcpReadiness({
  host = '127.0.0.1',
  port,
  user = 'postgres',
  password: probePassword,
  databaseName = 'postgres',
  deadline,
  cleanupReserveMs = readinessCleanupReserveMs,
  clientFactory = (config) => new Client(config),
}) {
  const availableMs = remainingTime(deadline);
  if (availableMs <= cleanupReserveMs) {
    throw new Error('Insufficient time remains for a readiness probe and connection cleanup');
  }
  const operationDeadline = deadline - cleanupReserveMs;
  const initialOperationMs = remainingTime(operationDeadline);
  const client = clientFactory({
    host,
    port,
    user,
    password: probePassword,
    database: databaseName,
    connectionTimeoutMillis: initialOperationMs,
    query_timeout: initialOperationMs,
    statement_timeout: initialOperationMs,
  });

  let result;
  let operationError = null;
  try {
    await withinTimeout(
      client.connect(),
      remainingTime(operationDeadline),
      `TCP readiness connection to ${host}:${port} exceeded the total deadline`,
    );
    const queryTimeoutMs = remainingTime(operationDeadline);
    if (queryTimeoutMs <= 0) throw new Error('Readiness deadline expired before SELECT 1');
    result = await withinTimeout(
      client.query({ text: 'SELECT 1 AS ready', query_timeout: queryTimeoutMs }),
      queryTimeoutMs,
      `TCP readiness SELECT 1 on ${host}:${port} exceeded the total deadline`,
    );
  } catch (error) {
    operationError = error;
  }

  let cleanupError = null;
  try {
    await closeReadinessClient(client, deadline);
  } catch (error) {
    cleanupError = error;
  }
  if (operationError && cleanupError) {
    throw new AggregateError([operationError, cleanupError], 'Readiness probe and probe connection cleanup both failed');
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;
  if (result.rows[0]?.ready !== 1) throw new Error('TCP readiness query returned an unexpected value');
}

export async function waitForReady({
  host = '127.0.0.1',
  port,
  password: probePassword,
  timeoutMs = readinessTimeoutMs,
  retryDelayMs = 250,
  cleanupReserveMs = readinessCleanupReserveMs,
  clientFactory,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (remainingTime(deadline) > cleanupReserveMs) {
    try {
      await probeTcpReadiness({ host, port, password: probePassword, deadline, cleanupReserveMs, clientFactory });
      return;
    } catch (error) {
      lastError = error;
    }
    const delayMs = Math.min(retryDelayMs, remainingTime(deadline));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`PostgreSQL did not accept a TCP SELECT 1 on ${host}:${port} within ${timeoutMs}ms${detail}`);
}

export async function removeResultFile(stage, { target = resultPath, unlinkFile = unlink } = {}) {
  try {
    await unlinkFile(target);
    return { success: true, detail: `${stage}：已删除 ${path.basename(target)}` };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { success: true, detail: `${stage}：结果文件不存在，无需清理` };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, detail: `${stage}：清理失败（${error?.code ?? 'unknown'}：${message}）` };
  }
}

export async function cleanupContainer(containerName, removeContainer = () => run('docker', ['rm', '-f', containerName])) {
  try {
    await removeContainer();
    return { success: true, detail: `已删除本轮容器 ${containerName}；未执行全局 Docker 清理` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, detail: `清理失败：本轮容器 ${containerName} 未确认删除（${message}）` };
  }
}

export function analyzeResults(value) {
  if (!value || !Array.isArray(value.outcomes) || value.outcomes.length === 0) {
    throw new Error('结果 JSON 缺少非空 outcomes 数组');
  }
  for (const outcome of value.outcomes) {
    if (!outcome || typeof outcome.name !== 'string' || !['passed', 'failed'].includes(outcome.status)) {
      throw new Error('结果 JSON 包含无效场景记录');
    }
  }
  const passed = value.outcomes.filter((outcome) => outcome.status === 'passed').length;
  const failed = value.outcomes.filter((outcome) => outcome.status === 'failed').length;
  const parameterizedSubscenarios = value.parameterizedSubscenarios ?? {};
  for (const [name, count] of Object.entries(parameterizedSubscenarios)) {
    if (!name || !Number.isInteger(count) || count < 0) {
      throw new Error('结果 JSON 包含无效参数化子场景统计');
    }
  }
  return {
    valid: true,
    allPassed: failed === 0,
    passed,
    failed,
    total: value.outcomes.length,
    outcomes: value.outcomes,
    subscenarios: value.subscenarios ?? [],
    parameterizedSubscenarios,
    parameterizedTotal: Object.values(parameterizedSubscenarios).reduce((sum, count) => sum + count, 0),
    reason: null,
  };
}

async function loadCurrentResults({ testStarted, target = resultPath }) {
  if (!testStarted) {
    return { valid: false, allPassed: false, passed: 0, failed: 0, total: 0, outcomes: [], parameterizedSubscenarios: {}, parameterizedTotal: 0, reason: '测试未启动' };
  }
  try {
    return analyzeResults(JSON.parse(await readFile(target, 'utf8')));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, allPassed: false, passed: 0, failed: 0, total: 0, outcomes: [], parameterizedSubscenarios: {}, parameterizedTotal: 0, reason: `测试未生成可解析的新结果：${message}` };
  }
}

export function evaluateFinalStatus(state) {
  const failures = [];
  if (state.migrationExit !== 0) failures.push(`迁移未成功（退出码 ${state.migrationExit ?? '未执行'}）`);
  if (state.testExit !== 0) failures.push(`测试命令未成功（退出码 ${state.testExit ?? '未执行'}）`);
  if (!state.results.valid) failures.push(`未取得有效测试结果（${state.results.reason}）`);
  else if (!state.results.allPassed) failures.push(`测试结果包含 ${state.results.failed} 个 failed 场景`);
  if (!state.containerCleanup.success) failures.push('本轮容器未确认清理');
  if (!state.resultCleanup.length || state.resultCleanup.some((item) => !item.success)) failures.push('本轮临时结果文件未确认清理');
  if (!state.reportWritten) failures.push('运行报告未成功写入');
  return { exitCode: failures.length === 0 ? 0 : 1, failures };
}

function runStatusLabel(state) {
  if (!state.results.valid) return '未取得有效测试结果';
  if (state.testExit !== 0 || !state.results.allPassed) return '测试失败';
  if (!state.containerCleanup.success || state.resultCleanup.some((item) => !item.success)) return '测试通过但资源清理失败';
  return '成功';
}

export function renderReport(state) {
  const prospectiveState = { ...state, reportWritten: true };
  const finalStatus = evaluateFinalStatus(prospectiveState);
  const resultStatus = state.results.valid
    ? `有效（${state.results.total} 个顶层测试；${state.results.passed} 通过；${state.results.failed} 失败；${state.results.parameterizedTotal} 个参数化子场景）`
    : `**未取得有效测试结果**（${state.results.reason}）`;
  const lines = [
    '# 正文修订与 Supersession 原子提交原型一键运行报告',
    '',
    '- 本报告由 `pnpm prototype` 生成并保存到 `verification/runner-result.md`。',
    `- PostgreSQL 镜像：\`${image}\``,
    `- 实际镜像 digest：\`${state.digest}\``,
    `- PostgreSQL Server 版本：\`${state.postgresVersion}\``,
    `- 实际运行时间（Asia/Shanghai）：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    `- pnpm：${state.pnpmVersion ?? 'unknown'}`,
    `- Docker：${state.dockerVersion ?? 'unknown'}`,
    `- 最终退出码：${finalStatus.exitCode}`,
    `- Node.js：\`${process.version}\``,
    '- 依赖：`node-pg-migrate@9.0.0`、`pg@8.23.0`',
    '- 迁移命令：`pnpm run migrate:up`',
    '- 测试命令：`pnpm test`',
    `- 数据库就绪路径：宿主机 TCP \`127.0.0.1:${state.port ?? '未分配'}\` 上执行 \`SELECT 1\``,
    `- 测试数据库：\`${database}\``,
    `- 测试 Schema：\`${schema}\``,
    '- 事务隔离级别：`READ COMMITTED`（测试连接显式设置并验证）',
    `- 迁移命令退出码：\`${state.migrationExit ?? '未执行'}\``,
    `- 测试命令退出码：\`${state.testExit ?? '未执行'}\``,
    `- 测试结果状态：${resultStatus}`,
    `- 运行状态：**${runStatusLabel(state)}**`,
    `- 容器清理结果：${state.containerCleanup.detail}`,
    `- 临时结果清理：${state.resultCleanup.map((item) => item.detail).join('；')}`,
    '- 报告写入状态：成功',
    `- 最终退出条件：${finalStatus.exitCode === 0 ? '全部满足' : `不满足（${finalStatus.failures.join('；')}）`}`,
    '',
    '## 场景结果',
    '',
    '| 场景 | 状态 | 关键证据 | 错误 | SQLSTATE | 约束 |',
    '|---|---|---|---|---|---|',
  ];
  for (const outcome of state.results.outcomes) {
    lines.push(`| ${outcome.name} | ${outcome.status} | ${(outcome.evidence ?? '').replaceAll('|', '\\|')} | ${(outcome.error ?? '').replaceAll('|', '\\|')} | ${outcome.code ?? ''} | ${outcome.constraint ?? ''} |`);
  }
  if (!state.results.valid) lines.push(`| 未取得有效测试结果 | 未执行 | ${state.results.reason}；未读取或展示任何旧场景记录 | | | |`);
  lines.push('', '## 参数化子场景统计', '', '| 分组 | 子场景数 |', '|---|---:|');
  for (const [name, count] of Object.entries(state.results.parameterizedSubscenarios)) {
    lines.push(`| ${name} | ${count} |`);
  }
  lines.push(`| 合计 | ${state.results.parameterizedTotal} |`);
  lines.push('', '## 实测子场景与失败阶段', '', '| 分组 / 子场景 | 状态 | 阶段 | SQLSTATE | 约束 | 证据 |', '|---|---|---|---|---|---|');
  for (const row of state.results.subscenarios ?? []) {
    const safe = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
    lines.push(`| ${safe(row.group)} / ${safe(row.name)} | ${row.status} | ${safe(row.stage)} | ${row.code ?? ''} | ${row.constraint ?? ''} | ${safe(row.evidence ?? row.error)} |`);
  }
  lines.push('', '## 范围声明', '', '- 本原型验证纯正文版本链、审批覆盖的修订意图、替代关系、Item、水位、审计及全部 Outbox 原子性；函数返回仍需外层 COMMIT。', '- 不实现结构化事实撤销、Publication、Impact Assessment、下游自动修订、真实权限或外部投影。');
  return `${lines.join('\n')}\n`;
}

async function writeReport(state) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, renderReport(state));
}

async function main() {
  const state = {
    port: null,
    digest: 'unknown',
    postgresVersion: 'unknown',
    migrationExit: null,
    testExit: null,
    testStarted: false,
    results: { valid: false, allPassed: false, passed: 0, failed: 0, total: 0, outcomes: [], parameterizedSubscenarios: {}, parameterizedTotal: 0, reason: '尚未读取' },
    containerCleanup: { success: false, detail: '尚未尝试' },
    resultCleanup: [],
    reportWritten: false,
  };

  try {
    const preRunCleanup = await removeResultFile('运行前');
    state.resultCleanup.push(preRunCleanup);
    if (!preRunCleanup.success) throw new Error(preRunCleanup.detail);

    state.pnpmVersion = run('pnpm', ['--version']).trim();
    state.dockerVersion = run('docker', ['--version']).trim();
    const imageInspect = JSON.parse(run('docker', ['image', 'inspect', image]))[0];
    state.digest = imageInspect.RepoDigests?.[0] ?? imageInspect.Id;
    run('docker', ['run', '-d', '--rm', '--name', container, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', image]);
    const portOutput = run('docker', ['port', container, '5432/tcp']).trim();
    const match = portOutput.match(/127\.0\.0\.1:(\d+)/);
    if (!match) throw new Error(`Unable to determine local port from docker port output: ${portOutput}`);
    state.port = Number(match[1]);
    await waitForReady({ port: state.port, password });
    await withTcpClient(state.port, 'postgres', (client) => client.query(`CREATE DATABASE ${database}`));
    state.postgresVersion = await withTcpClient(state.port, database, async (client) => (await client.query('SHOW server_version')).rows[0].server_version);

    const env = { ...process.env, DATABASE_URL: databaseUrl(state.port), PROTOTYPE_SCHEMA: schema, PROTOTYPE_RESULTS_PATH: resultPath };
    state.migrationExit = runInherit('pnpm', ['run', 'migrate:up'], env);
    if (state.migrationExit === 0) {
      state.testStarted = true;
      state.testExit = runInherit('pnpm', ['test'], env);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (state.migrationExit === null) state.migrationExit = 1;
    if (state.testExit === null && state.testStarted) state.testExit = 1;
  } finally {
    state.containerCleanup = await cleanupContainer(container);
    state.results = await loadCurrentResults({ testStarted: state.testStarted });
    state.resultCleanup.push(await removeResultFile('运行后'));
    try {
      await writeReport(state);
      state.reportWritten = true;
    } catch (error) {
      console.error(`Failed to write runner report: ${error instanceof Error ? error.message : error}`);
    }
  }

  process.exitCode = evaluateFinalStatus(state).exitCode;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) await main();
