import { randomUUID } from 'node:crypto';

export class SafeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function safeFailure(error) {
  return { ok: false, error: error instanceof SafeError ? error.code : 'REQUEST_FAILED' };
}

// Build records from fixed fields, never from request/exception spreads.
export function logRecord(operation, outcome) {
  return { event: 'command_result', operation, outcome, request_id: randomUUID() };
}

export function requireCondition(value, code) {
  if (!value) throw new SafeError(code);
}

export const isUuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function exactFields(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
