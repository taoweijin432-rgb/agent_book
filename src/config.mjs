import { readFile } from 'node:fs/promises';
import { SafeError, exactFields, isUuid, requireCondition } from './safety.mjs';

export function validateConfig(value, { allowTest = false } = {}) {
  const keys = ['mode', 'host', 'port', 'database', 'user', 'password', 'instanceId'];
  requireCondition(exactFields(value, keys), 'CONFIG_INVALID');
  requireCondition(value.mode === 'local' || (allowTest && value.mode === 'test'), 'CONFIG_MODE_DENIED');
  requireCondition(['127.0.0.1', '::1'].includes(value.host), 'LOCAL_TARGET_REQUIRED');
  requireCondition(Number.isInteger(value.port) && value.port > 0 && value.port <= 65535, 'CONFIG_INVALID');
  requireCondition(/^agent_book_[a-z0-9_]+$/.test(value.database), 'EXPLICIT_DATABASE_REQUIRED');
  for (const key of ['user', 'password']) {
    requireCondition(typeof value[key] === 'string' && value[key].length > 0
      && !value[key].startsWith('REPLACE_'), 'CREDENTIALS_REQUIRED');
  }
  requireCondition(isUuid(value.instanceId), 'INSTANCE_ID_REQUIRED');
  return Object.freeze({ ...value });
}

export async function loadConfig(path, env = process.env) {
  requireCondition(typeof path === 'string' && path.length > 0, 'CONFIG_PATH_REQUIRED');
  try {
    return validateConfig(JSON.parse(await readFile(path, 'utf8')), { allowTest: env.AB_TEST_MODE === '1' });
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError('CONFIG_UNREADABLE');
  }
}
