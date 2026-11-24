import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { requireCondition, safeFailure } from '../src/safety.mjs';
import { bootstrap, initializeNovelReader } from './administration.mjs';

export async function main(args = process.argv.slice(2)) {
  try {
    const config = await loadConfig(process.env.AB_CONFIG);
    if (args.length === 0) return await bootstrap(config);
    requireCondition(args.length === 3 && args[0] === '--initialize-reader', 'UNSUPPORTED_BOOTSTRAP_ARGUMENTS');
    return await initializeNovelReader(config, { actorId: args[1], novelId: args[2] });
  } catch (error) { return safeFailure(error); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(); process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok ? 0 : 1;
}
