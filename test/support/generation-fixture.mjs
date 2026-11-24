import { randomUUID } from 'node:crypto';
import { executeCommand } from '../../src/foundation.mjs';
import { createValidationFixture } from './validation-fixture.mjs';
import { registerTestNovel } from '../../scripts/test-generation-initialize.mjs';
export async function createGenerationFixture(configs,actors,options={}){
 const f=await createValidationFixture(configs,actors,options);f.manualWorkflow=f.workflow;
 await registerTestNovel(configs.admin,f.novel);
 const call=async(who,op,p)=>{const r=await executeCommand(configs[who],op,{novel_id:f.novel,request:{request_key:randomUUID(),...p}});if(!r.ok)throw new Error('GENERATION_FIXTURE_FAILED');return r;};
 f.generationGrant=(await call(f.author,'generation-grant:create',{context_grant_id:f.contextGrant,expires_at:null})).grant_id;
 f.workflow=(await call(f.writer,'test-workflow:create',{generation_grant_id:f.generationGrant,bundle_ref:f.bundle,execution_mode:'test_generation_v1'})).workflow_ref;f.selection=0;f.candidate=null;
 return f;
}
