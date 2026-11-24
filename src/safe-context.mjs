import { randomUUID } from 'node:crypto';
import { exactFields,isUuid,SafeError } from './safety.mjs';
export const safeContextOperations=Object.freeze(['context-grant:create','context-policy:publish','projection:propose','projection:publish','projection:revoke',
  'context:compile','context:read','context:trace','context:audit']);
export function safeContextArguments(operation,input){
  if(!safeContextOperations.includes(operation)||!exactFields(input,['novel_id','request'])||!isUuid(input.novel_id)||!input.request||typeof input.request!=='object'||Array.isArray(input.request))throw new SafeError('INVALID_REQUEST');
  return [operation,input.novel_id,JSON.stringify(input.request),Array.from({length:128},()=>randomUUID()),randomUUID()];
}
