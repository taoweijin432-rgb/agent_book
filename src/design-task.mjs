import { randomUUID } from 'node:crypto';
import { exactFields, isUuid, SafeError } from './safety.mjs';

export const designTaskOperations = Object.freeze(['volume:create','chapter:create','scene:create','entity:create','structure:read',
  'design:draft','design:edit','design:freeze','design:history','task:create','task:append','task:history']);

// Scope is always a real Novel. Actor and policy facts are not client parameters.
export function designTaskArguments(operation,input) {
  if (!designTaskOperations.includes(operation) || !exactFields(input,['novel_id','request']) || !isUuid(input.novel_id)
    || !input.request || typeof input.request!=='object' || Array.isArray(input.request)) throw new SafeError('INVALID_REQUEST');
  return [operation,input.novel_id,JSON.stringify(input.request),Array.from({length:128},()=>randomUUID()),randomUUID()];
}
