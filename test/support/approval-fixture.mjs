import{randomUUID}from'node:crypto';import{executeCommand}from'../../src/foundation.mjs';import{createValidationFixture}from'./validation-fixture.mjs';
export async function createApprovalFixture(configs,actors,options={}){
 const f=await createValidationFixture(configs,actors,options),call=async(op,p)=>{const r=await executeCommand(configs[f.author],op,{novel_id:f.novel,request:{request_key:randomUUID(),...p}});if(!r.ok)throw new Error('APPROVAL_FIXTURE_FAILED');return r;};
 f.validationPolicy=(await call('validation-policy:publish',{expected_release_id:null})).release_id;
 f.validation=(await call('validation:run',{workflow_ref:f.workflow,expected_candidate_ref:f.candidate,expected_selection_version:f.selection})).validation_ref;
 f.approvalPolicy=(await call('approval-policy:publish',{expected_release_id:null})).release_id;
 return f;
}
