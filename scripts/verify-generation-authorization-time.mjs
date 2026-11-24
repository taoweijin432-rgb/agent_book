import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {prepareInstance,cleanup} from './verify-foundation.mjs';
import {migrate} from './migrate.mjs';import {bootstrap} from './administration.mjs';
import {initializeTestExecutor} from './test-generation-initialize.mjs';
import {runHistoricalTimeExperiments} from '../test/generation-authorization-time.mjs';
import {scanSecrets,imageDigest} from './verification-support.mjs';
import {requireCondition} from '../src/safety.mjs';
const output=path.resolve(import.meta.dirname,'../verification/test-generation-time-repair');
export async function main(args=process.argv.slice(2)){
 requireCondition(args.length===1&&['--before','--after'].includes(args[0]),'EXPLICIT_EXPERIMENT_REQUIRED');const stage=args[0].slice(2),file=path.join(output,stage+'-experiment.json');
 try{await readFile(file);throw Object.assign(new Error('EVIDENCE_ALREADY_EXISTS'),{code:'EVIDENCE_ALREADY_EXISTS'});}catch(e){if(e.code!=='ENOENT')throw e;}
 process.env.AB_TEST_MODE='1';const dir=await mkdtemp(path.join(os.tmpdir(),'agent-book-authorization-time-')),resources=[],s={stage,runId:randomUUID(),startedAt:new Date().toISOString(),imageDigest};let secrets=[];
 try{
  const bytes=await readFile(path.resolve(import.meta.dirname,'../db/migrations/007_test_generation.mjs'));s.migrationSha256=createHash('sha256').update(bytes).digest('hex');if(stage==='before')requireCondition(bytes.equals(await readFile(path.join(output,'before/db/migrations/007_test_generation.mjs'))),'ORIGINAL_MIGRATION_REQUIRED');
  const i=await prepareInstance(dir,s.runId,'authorization-time',resources);s.migration=await migrate(i.configs.migrator);await bootstrap(i.configs.admin);i.executor={...i.configs.writerA,user:'ab_time_'+randomBytes(5).toString('hex'),password:randomBytes(24).toString('hex')};await initializeTestExecutor(i.configs.admin,{login:i.executor.user,password:i.executor.password});secrets=[i.executor.password,...Object.values(i.configs).map(c=>c.password)];
  const result=await runHistoricalTimeExperiments(i,{expectFixed:stage==='after',beforeOnly:stage==='before'});secrets.push(...result.markers);delete result.markers;s.result=result;s.leaks=scanSecrets([s],secrets);requireCondition(s.leaks===0,'DISCLOSURE');s.valid=true;
 }catch(e){s.failure={code:/^[A-Z0-9_]+$/.test(e.code??'')?e.code:'EXPERIMENT_FAILED',line:Number(e.stack?.match(/generation-authorization-time.mjs:(\d+):/)?.[1]??0)};}
 finally{s.containerCleanup=await cleanup(resources);await rm(dir,{recursive:true,force:true});s.temporaryCleanup=true;s.ok=s.valid===true&&s.containerCleanup&&s.temporaryCleanup&&!s.failure;await mkdir(output,{recursive:true});await writeFile(file,JSON.stringify(s,null,2)+'\n');}
 process.stdout.write(JSON.stringify({stage,ok:s.ok,cases:s.result?.cases?.map(c=>({name:c.name,commit:c.evidence.commit,persisted:c.evidence.persisted})),failure:s.failure,cleanup:s.containerCleanup})+'\n');process.exitCode=s.ok?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
