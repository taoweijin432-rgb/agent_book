import pg from 'pg';
import { requireCondition } from './safety.mjs';

export function connectionOptions(config) {
  return { host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password, connectionTimeoutMillis: 5000, statement_timeout: 8000,
    query_timeout: 9000, lock_timeout: 6000, application_name: 'agent-book-foundation' };
}

export async function withConnection(config, action, { initialized = true } = {}) {
  const client = new pg.Client(connectionOptions(config));
  try {
    await client.connect();
    if (initialized) {
      const { rows } = await client.query('SELECT agent_book_meta.instance_identity() AS id');
      requireCondition(rows[0]?.id === config.instanceId, 'INSTANCE_MISMATCH');
    }
    return await action(client);
  } finally {
    await client.end();
  }
}

export async function inTransaction(client, action) {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    await client.query('SET LOCAL search_path TO pg_catalog');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
