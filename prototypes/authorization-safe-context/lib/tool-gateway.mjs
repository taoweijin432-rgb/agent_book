import pg from 'pg';
import { randomUUID } from 'node:crypto';

const schema='authorization_safe_context_fixture';
const endpoints=Object.freeze({compile_context:'api_compile_context',read_context:'api_get_context',generate_context:'api_create_generation',write_candidate:'api_write_candidate',
  read_design:'api_read_design',validate:'api_inspect_validation',validation_feedback:'api_validation_feedback',read_audit:'api_read_audit',manage_grant:'api_revoke_grant'});
const writerActions=new Set(['compile_context','read_context','generate_context','write_candidate','validation_feedback']);

// Identity handles and credentials belong to the trusted host, never to request JSON.
// Each dispatch opens and closes its own real login connection; there is no SET ROLE or cross-principal cache.
export function createToolGateway(identityRegistry,{clientFactory=config=>new pg.Client(config)}={}){
  const logs=[],traces=[],modelChannels=[];
  async function dispatch(identityHandle,operation,input){
    const identity=identityRegistry.get(identityHandle);
    const name=endpoints[operation];
    const requestId=randomUUID();
    let client;let response;let outcome='denied';
    try{
      if(!identity||!name){response={ok:false,error:'ACCESS_DENIED'};return response;}
      client=clientFactory(identity.config);await client.connect();
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('SET LOCAL search_path TO public');
      await client.query("SET LOCAL statement_timeout='8s'");await client.query("SET LOCAL lock_timeout='6s'");
      const row=(await client.query(`SELECT ${schema}.${name}($1::jsonb) AS result`,[input])).rows[0];
      // Denials are ordinary results, so their database audit survives COMMIT.
      await client.query('COMMIT');response=row.result;outcome=response.ok?'allowed':'denied';return response;
    }catch{
      if(client){try{await client.query('ROLLBACK');}catch{/* No raw database diagnostics cross this boundary. */}}
      response={ok:false,error:'SAFE_REQUEST_FAILED'};outcome='failed';return response;
    }finally{
      if(client){try{await client.end();}catch{/* Close failures expose no diagnostic payload. */}}
      const record={event:'tool_result',operation:name?operation:'unsupported',outcome,request_id:requestId};
      logs.push(record);traces.push({operation:record.operation,outcome,request_id:requestId});
      if(identity?.audience==='writer'&&response)modelChannels.push({channel:writerActions.has(operation)?operation:'error',response});
    }
  }
  return {bindIdentity:handle=>Object.freeze({call:(operation,input)=>dispatch(handle,operation,input)}),logs,traces,modelChannels,exportEvaluation:()=>logs.map(({operation,outcome})=>({operation,outcome}))};
}
