import { randomUUID } from 'node:crypto';
import { exactFields,isUuid,SafeError } from './safety.mjs';
export const manualWorkflowOperations=Object.freeze(['writing-grant:create','workflow:create','candidate:input','candidate:edit','candidate:select','workflow:read','workflow:trace','workflow:audit']);
// JSON must not silently replace unpaired UTF-16 surrogates before PostgreSQL receives exact UTF-8 text.
export function manualWorkflowArguments(operation,input){
  if(!manualWorkflowOperations.includes(operation)||!exactFields(input,['novel_id','request'])||!isUuid(input.novel_id)||!input.request||typeof input.request!=='object'||Array.isArray(input.request))throw new SafeError('INVALID_REQUEST');
  const body=input.request.body;
  if(body!==undefined&&(typeof body!=='string'||/[\uD800-\uDFFF]/u.test(body)||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(body)||body.trim().length===0||Buffer.byteLength(body,'utf8')>262144))throw new SafeError('INVALID_REQUEST');
  return [operation,input.novel_id,JSON.stringify(input.request),Array.from({length:16},()=>randomUUID()),randomUUID()];
}
