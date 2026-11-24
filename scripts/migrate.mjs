import { runner } from 'node-pg-migrate';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.mjs';
import { withConnection } from '../src/database.mjs';
import { requireCondition, safeFailure } from '../src/safety.mjs';
import { quote } from './administration.mjs';

export async function migrate(config, { firstBatchOnly = false } = {}) {
  requireCondition(!firstBatchOnly || (config.mode==='test' && process.env.AB_TEST_MODE==='1'), 'TEST_MIGRATION_MODE_REQUIRED');
  return withConnection(config, async client => {
    const metadata = (await client.query('SELECT * FROM agent_book_meta.installation')).rows[0];
    const login = (await client.query('SELECT session_user AS login')).rows[0].login;
    requireCondition(login === metadata?.migrator_login, 'MIGRATOR_REQUIRED');
    await client.query(`SET ROLE ${quote(metadata.owner_login)}`);
    try {
    let count=firstBatchOnly?1:Infinity;
    if(process.env.AB_TEST_MIGRATION_BOUNDARY && !firstBatchOnly){
      requireCondition(config.mode==='test'&&process.env.AB_TEST_MODE==='1'&&['2','3','4','5','6','7'].includes(process.env.AB_TEST_MIGRATION_BOUNDARY),'TEST_MIGRATION_MODE_REQUIRED');
      const exists=(await client.query("SELECT to_regclass('agent_book_meta.schema_migrations') IS NOT NULL present")).rows[0].present;
      const applied=exists?Number((await client.query('SELECT count(*) FROM agent_book_meta.schema_migrations')).rows[0].count):0;
      const boundary=Number(process.env.AB_TEST_MIGRATION_BOUNDARY);requireCondition(applied<=boundary,'TEST_BOUNDARY_ALREADY_EXCEEDED');count=boundary-applied;
      if(count===0)return {ok:true,migrations_applied:0};
    }
      const migrations = await runner({ dbClient: client, dir: fileURLToPath(new URL('../db/migrations', import.meta.url)),
        schema: 'agent_book', migrationsSchema: 'agent_book_meta', migrationsTable: 'schema_migrations',
        count, direction: 'up', checkOrder: true, singleTransaction: true, noLock: false, verbose: false,
        logger: { debug() {}, info() {}, warn() {}, error() {} } });
      return { ok: true, migrations_applied: migrations.length };
    } finally { await client.query('RESET ROLE'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let result;
  try { requireCondition(process.argv.length === 2, 'MIGRATION_ARGUMENTS_DENIED'); result = await migrate(await loadConfig(process.env.AB_CONFIG)); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({event:'migration_failed',sqlstate:/^[0-9A-Z]{5}$/.test(error.code??'')?error.code:'unavailable',position:/^[0-9]+$/.test(error.position??'')?Number(error.position):null})}\n`);
    result = safeFailure(error);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.ok ? 0 : 1;
}
