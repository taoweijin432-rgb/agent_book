import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { withConnection,inTransaction } from '../src/database.mjs';
import { loadConfig } from '../src/config.mjs';
import { exactFields,isUuid,requireCondition,safeFailure } from '../src/safety.mjs';
import { quote } from './administration.mjs';

async function trusted(config,action){
 requireCondition(config.mode==='test'&&process.env.AB_TEST_MODE==='1','EXPLICIT_TEST_CONFIGURATION_REQUIRED');
 return withConnection(config,c=>inTransaction(c,async tx=>{requireCondition((await tx.query('SELECT rolsuper FROM pg_roles WHERE rolname=session_user')).rows[0].rolsuper,'INITIALIZER_REQUIRED');return action(tx);}));
}
export async function registerTestNovel(config,novelId){
 requireCondition(isUuid(novelId),'INVALID_REQUEST');
 return trusted(config,async c=>{await c.query('INSERT INTO agent_book.test_novel_registration VALUES($1,$2,clock_timestamp()) ON CONFLICT(novel_id) DO NOTHING',[novelId,randomUUID()]);return{ok:true,test_scope_registered:true};});
}
// The trusted host holds this restricted credential; it is never a writer request field.
export async function initializeTestExecutor(config,{login,password}){
 requireCondition(typeof login==='string'&&/^[a-z][a-z0-9_]{0,50}$/.test(login)&&typeof password==='string'&&/^[a-zA-Z0-9_-]{24,128}$/.test(password),'PROVISION_INVALID');
 return trusted(config,async c=>{
  requireCondition((await c.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[login])).rows[0].n===0,'ROLE_ALREADY_EXISTS');
  await c.query(`CREATE ROLE ${quote(login)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`);
  await c.query(`GRANT CONNECT ON DATABASE ${quote(config.database)} TO ${quote(login)};GRANT USAGE ON SCHEMA agent_book,agent_book_meta TO ${quote(login)};GRANT EXECUTE ON FUNCTION agent_book_meta.instance_identity(),agent_book.api_identity(uuid),agent_book.api_test_adapter(text,uuid,jsonb,uuid[],uuid) TO ${quote(login)}`);
  const id=randomUUID();await c.query("INSERT INTO agent_book.actor_principal VALUES($1,'service','test-adapter-executor',$2,'active')",[id,login]);
  await c.query("INSERT INTO agent_book.actor_role SELECT $1,role_id FROM agent_book.execution_role WHERE role_key='test-adapter-executor'",[id]);return{ok:true,actor_id:id};
 });
}
export async function main(args=process.argv.slice(2)){
 try{const config=await loadConfig(process.env.AB_CONFIG);if(args.length===2&&args[0]==='--register-novel')return await registerTestNovel(config,args[1]);
 if(args.length===2&&args[0]==='--executor-file'){const p=JSON.parse(await readFile(args[1],'utf8'));requireCondition(exactFields(p,['login','password']),'PROVISION_INVALID');return await initializeTestExecutor(config,p);}throw new Error('ARGUMENTS_DENIED');
 }catch(e){return safeFailure(e);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await main();process.stdout.write(JSON.stringify(r)+'\n');process.exitCode=r.ok?0:1;}
