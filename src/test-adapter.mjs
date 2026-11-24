import { createHash } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { exactFields,requireCondition } from './safety.mjs';
export const testAdapterId='fixed-test-v1';
// Pure fixed implementation: only the rendered approved Bundle request is consumed.
export async function runFixedTestAdapter(requestText,{signal}={}){
 const r=JSON.parse(requestText);
 requireCondition(exactFields(r,['protocol','provider','model','prompt_version','parameter_protocol','parameters','instruction','bundle_payload'])&&r.protocol==='test-request-v1'&&r.provider==='test'&&r.model==='test-text-v1'&&r.prompt_version==='test-prompt-v1'&&r.parameter_protocol==='test-parameters-v1'&&exactFields(r.parameters,['max_output_bytes'])&&r.parameters.max_output_bytes===4096&&r.instruction==='Only produce a deterministic test fragment from this approved Bundle.'&&typeof r.bundle_payload==='string','ADAPTER_INPUT_INVALID');
 await nextTurn(undefined,{signal});
 const hash=createHash('sha256').update(requestText,'utf8').digest('hex');
 return `[provider=test; adapter=fixed-test-v1]\nrequest-sha256=${hash}\n测试正文：人物停下脚步，观察四周。\n`;
}
