import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { requireCondition } from '../src/safety.mjs';

export const image = 'postgres:18.6';
export const imageDigest = 'postgres@sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae';
export const runFile = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: 60000, ...options });

async function bounded(promise, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('READINESS_DEADLINE')), Math.max(1, milliseconds));
  })]); } finally { clearTimeout(timer); }
}

export async function waitForReady(config, { timeout = 30000, clientFactory = options => new pg.Client(options) } = {}) {
  const deadline = Date.now() + timeout;
  while (deadline - Date.now() > 500) {
    const remaining = deadline - Date.now() - 400;
    const client = clientFactory({ ...config, connectionTimeoutMillis: remaining, query_timeout: remaining, statement_timeout: remaining });
    let ready = false;
    try {
      await bounded(client.connect(), remaining);
      const result = await bounded(client.query('SELECT 1 AS ready'), deadline - Date.now() - 300);
      ready = result.rows[0]?.ready === 1;
    } catch { /* The total deadline, not an unbounded driver query, controls readiness. */ }
    await bounded(client.end(), deadline - Date.now());
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - Date.now()))));
  }
  throw new Error('READINESS_DEADLINE');
}

export function analyzeResults(value, runId) {
  requireCondition(value?.runId === runId && Array.isArray(value.groups) && value.groups.length > 0, 'RESULT_INVALID');
  for (const group of value.groups) {
    requireCondition(typeof group.name === 'string' && ['passed','failed'].includes(group.status)
      && Array.isArray(group.cases) && group.cases.length > 0, 'RESULT_INVALID');
    for (const entry of group.cases) requireCondition(typeof entry.name === 'string'
      && ['passed','failed'].includes(entry.status), 'RESULT_INVALID');
  }
  const cases = value.groups.flatMap(group => group.cases);
  return { topLevel: value.groups.length, topPassed: value.groups.filter(group=>group.status==='passed').length, topFailed: value.groups.filter(group=>group.status==='failed').length, subscenarios: cases.length, skipped: 0,
    allPassed: value.groups.every(group => group.status === 'passed') && cases.every(entry => entry.status === 'passed'),
    failed: cases.filter(entry => entry.status === 'failed').length };
}

export function finalExit(state) {
  return !state.failureCode && state.migrationExit === 0 && state.testExit === 0 && state.resultsValid === true
    && state.allPassed === true && state.cleanup === true && state.reportWritten === true ? 0 : 1;
}

export async function migrationThenTest(migrate, test) {
  const migration = await migrate();
  if (migration.status !== 0) return { migrationExit: migration.status ?? 1, testStarted: false, testExit: null };
  const result = await test();
  return { migrationExit: 0, testStarted: true, testExit: result.status ?? 1 };
}

export function scanSecrets(values, markers) {
  const serialized = values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');
  return markers.filter(marker => typeof marker === 'string' && marker.length > 0 && serialized.includes(marker)).length;
}

// No dependency/cache traversal and no following cached directory aliases.
export async function protectedFiles(root) {
  const files = {};
  const excluded = new Set(['node_modules','.pnpm-store','.git','.cache','__pycache__']);
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name) || ['.DS_Store','.test-results.json'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) files[path.relative(root, absolute)] = createHash('sha256').update(await readFile(absolute)).digest('hex');
    }
  }
  await walk(path.join(root, 'docs'));
  await walk(path.join(root, 'prototypes'));
  delete files['docs/16-prototype-consolidation-and-implementation-plan.md'];
  return files;
}
