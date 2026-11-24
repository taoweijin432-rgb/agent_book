import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { withConnection,inTransaction } from './database.mjs';
import { loadConfig } from './config.mjs';
import { exactFields,isUuid,requireCondition,SafeError,safeFailure } from './safety.mjs';
import { runFixedTestAdapter } from './test-adapter.mjs';
export const testGenerationOperations=Object.freeze(['generation-grant:create','test-workflow:create','generation:prepare','generation:read','generation:history','generation:trace','generation:audit','generation:interrupt']);
export function testGenerationArguments(op,input){
 requireCondition(testGenerationOperations.includes(op)&&exactFields(input,['novel_id','request'])&&isUuid(input.novel_id)&&input.request&&typeof input.request==='object'&&!Array.isArray(input.request),'INVALID_REQUEST');
 return[op,input.novel_id,JSON.stringify(input.request),Array.from({length:16},randomUUID),randomUUID()];
}
export async function generationApi(config,op,input){
 const args=testGenerationArguments(op,input);
 return withConnection(config,c=>inTransaction(c,async tx=>(await tx.query('SELECT agent_book.api_test_generation($1,$2,$3,$4,$5) r',args)).rows[0].r));
}
export async function adapterApi(config,op,run,p){
 return withConnection(config,c=>inTransaction(c,async tx=>(await tx.query('SELECT agent_book.api_test_adapter($1,$2,$3,$4,$5) r',[op,run,JSON.stringify(p),Array.from({length:4},randomUUID),randomUUID()])).rows[0].r));
}
const signalOutcome=e=>e?.name==='AbortError'||e?.name==='TimeoutError'?'timed_out':e instanceof SafeError&&e.code==='ADAPTER_INPUT_INVALID'?'adapter_failed':'technical_failed';
// Observer is a trusted host lifecycle hook, never parsed from the writer request.
export async function executeTestGeneration(config,input,{executorConfig,onPhase=async()=>{},signal}={}){
 requireCondition(config.mode==='test'&&process.env.AB_TEST_MODE==='1','EXPLICIT_TEST_CONFIGURATION_REQUIRED');
 const executor=executorConfig??await loadConfig(process.env.AB_TEST_EXECUTOR_CONFIG);
 requireCondition(executor.mode==='test'&&executor.instanceId===config.instanceId&&executor.database===config.database&&executor.port===config.port&&executor.host===config.host&&executor.user!==config.user,'EXECUTOR_CONFIGURATION_REQUIRED');
 const prepared=await generationApi(config,'generation:prepare',input);if(!prepared.ok||!prepared.created)return prepared;
 await onPhase('prepared',{run_ref:prepared.run_ref});
 const startId=randomUUID(),start=await adapterApi(executor,'start',prepared.run_ref,{start_id:startId});if(!start.ok||!start.claimed)return start;
 const began=performance.now(),timeoutSignal=AbortSignal.timeout(2000),callSignal=signal?AbortSignal.any([signal,timeoutSignal]):timeoutSignal;let response=null,outcome='succeeded';
 try{
  await onPhase('started',{run_ref:prepared.run_ref,call_ref:start.call_ref});
  response=await runFixedTestAdapter(start.request_text,{signal:callSignal});
  await onPhase('response',{run_ref:prepared.run_ref});
 }catch(e){outcome=signalOutcome(e);}
 const observation={start_id:startId,outcome,response_text:response,elapsed_ms:Math.round(performance.now()-began)};
 let result;
 try{result=await adapterApi(executor,'finish',prepared.run_ref,observation);}
 catch(e){
  // A real response may exist despite a failed COMMIT. Persist facts in a separate controlled transaction.
  try{result=await adapterApi(executor,'technical-finish',prepared.run_ref,observation);}catch{return {ok:false,error:'CALL_RECORDING_UNCONFIRMED',run_ref:prepared.run_ref,provider:'test',test_only:true};}
 }
 await onPhase('accepted',{run_ref:prepared.run_ref});
 // The caller may have lost authorization while the trusted adapter was running.
 const authorized=await generationApi(config,'generation:read',{novel_id:input.novel_id,request:{run_ref:prepared.run_ref}});
 if(!authorized.ok)return authorized;return result;
}
