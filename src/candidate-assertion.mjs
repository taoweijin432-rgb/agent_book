import {randomUUID} from 'node:crypto';
import {exactFields,isUuid,SafeError} from './safety.mjs';
export const candidateAssertionOperations=Object.freeze(['assertion:register','candidate-evidence:register','assertion:history','assertion:audit']);
export function candidateAssertionArguments(op,input){
 if(!candidateAssertionOperations.includes(op)||!exactFields(input,['novel_id','request'])||!isUuid(input.novel_id)||!input.request||typeof input.request!=='object'||Array.isArray(input.request))throw new SafeError('INVALID_REQUEST');
 // JSON must not silently replace invalid UTF-16 with replacement characters before exact UTF-8 location verification.
 for(const value of [input.request.content,input.request.quote])if(value!==undefined&&(typeof value!=='string'||/[\uD800-\uDFFF]/u.test(value)||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)))throw new SafeError('INVALID_REQUEST');
 return[op,input.novel_id,JSON.stringify(input.request),Array.from({length:16},()=>randomUUID()),randomUUID()];
}
