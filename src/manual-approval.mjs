import { randomUUID } from 'node:crypto';
import { exactFields,isUuid,SafeError } from './safety.mjs';
export const manualApprovalOperations=Object.freeze(['approval-policy:publish','approval:review','approval:approve','approval:reject','approval:withdraw','approval:history','approval:current','approval:audit']);
export function manualApprovalArguments(op,input){
 if(!manualApprovalOperations.includes(op)||!exactFields(input,['novel_id','request'])||!isUuid(input.novel_id)||!input.request||typeof input.request!=='object'||Array.isArray(input.request))throw new SafeError('INVALID_REQUEST');
 return[op,input.novel_id,JSON.stringify(input.request),Array.from({length:32},()=>randomUUID()),randomUUID()];
}
