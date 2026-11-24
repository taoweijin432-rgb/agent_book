import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { requireCondition, safeFailure } from '../src/safety.mjs';
import { initialize } from './administration.mjs';

export async function main() {
  try {
    requireCondition(process.argv.slice(2).length === 1 && process.argv[2] === '--confirm-empty-target', 'EMPTY_TARGET_CONFIRMATION_REQUIRED');
    const config = await loadConfig(process.env.AB_CONFIG);
    requireCondition(process.env.AB_PROVISION, 'PROVISION_PATH_REQUIRED');
    return await initialize(config, JSON.parse(await readFile(process.env.AB_PROVISION, 'utf8')));
  } catch (error) { return safeFailure(error); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(); process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok ? 0 : 1;
}
