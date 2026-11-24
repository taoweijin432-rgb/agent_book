import { randomUUID } from 'node:crypto';
import { exactFields,isUuid,SafeError } from './safety.mjs';
export const finiteValidationOperations=Object.freeze(['validation-policy:publish','validation:run','validation:history','validation:current','validation:audit']);
export function finiteValidationArguments(op,input){
  if(!finiteValidationOperations.includes(op)||!exactFields(input,['novel_id','request'])||!isUuid(input.novel_id)||!input.request||typeof input.request!=='object'||Array.isArray(input.request))throw new SafeError('INVALID_REQUEST');
  return[op,input.novel_id,JSON.stringify(input.request),Array.from({length:128},()=>randomUUID()),randomUUID()];
}
