import { randomUUID } from 'node:crypto';
import { executeCommand } from '../../src/foundation.mjs';
// A new legal design with no unsupported hard rules is created from the outset, never by removing an existing fixture rule.
export async function createValidationFixture(configs,actors,{author='authorA',writer='writerA',label='validation',secret='private',hard=false,expiresAt=null,body='人工校验正文',select=true}={}){
 const run=async(who,op,n,p)=>{const r=await executeCommand(configs[who],op,{novel_id:n,request:p});if(!r.ok)throw new Error('VALIDATION_FIXTURE_FAILED');return r;};
 const novel=await executeCommand(configs[author],'novel:create',{external_key:label+'-'+randomUUID().slice(0,8),title:'title '+secret});if(!novel.ok)throw new Error('FIXTURE_NOVEL_FAILED');const n=novel.novel_id;
 const write=(op,p)=>run(author,op,n,{request_key:randomUUID(),...p});
 const volume=(await write('volume:create',{position:1,title:secret})).id,chapter=(await write('chapter:create',{volume_id:volume,position:1,title:secret})).id;
 const scene=(await write('scene:create',{chapter_id:chapter,position:1,goal:secret})).id,character=(await write('entity:create',{entity_type:'character',name:secret})).id;
 const draft=(await write('design:draft',{base_revision_id:null})).draft_id;
 await write('design:edit',{draft_id:draft,expected_edit_version:1,content:{characters:[{design_key:'hero',entity_id:character,name:secret,description:{summary:secret,motivation:secret,traits:[secret]}}],constraints:[{rule_key:'declared',severity:hard?'hard':'soft',scope_kind:'novel',scope_id:null,rule_text:secret}]}});
 const revision=(await write('design:freeze',{draft_id:draft,expected_edit_version:2,expected_current_revision_id:null})).revision_id;
 const design=await run(author,'design:history',n,{}),object=design.objects[0].design_object_version_id,constraint=design.constraints[0].constraint_id;
 const taskInput={scene_id:scene,revision_id:revision,viewpoint_entity_id:character,input_canon_watermark:0,goal:secret,constraint_ids:hard?[]:[constraint],budget:{max_input_tokens:8000,max_output_tokens:2000},reader_scope:{format_version:'task-reader-v1',mode:'no_disclosure_claim'},compile:{format_version:'scene-task-v1',timeline:'linear',dependencies:'committed_only'}};
 const task=await write('task:create',taskInput);const writerId=actors.find(a=>a.label===writer).actorId;
 const cg=await write('context-grant:create',{task_version_id:task.version_id,writer_actor_id:writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:expiresAt});const publications=[];
 for(const[kind,type,id]of [['goal','author_design_revision',revision],['character','design_object_version',object],['constraint','design_constraint',constraint]]){
  const q=await write('projection:propose',{task_version_id:task.version_id,writer_actor_id:writerId,kind,source_object_type:type,source_object_id:id,safe_text:'仅为已批准写作指导',semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null});publications.push((await write('projection:publish',{proposal_id:q.proposal_id})).publication_id);
 }
 const bundle=await run(writer,'context:compile',n,{request_key:randomUUID(),task_version_id:task.version_id,max_bytes:65536});const grant=await write('writing-grant:create',{context_grant_id:cg.grant_id,expires_at:null});
 const workflow=await run(writer,'workflow:create',n,{request_key:randomUUID(),writing_grant_id:grant.grant_id,bundle_ref:bundle.bundle_ref,execution_mode:'manual_input_v1'});
 const candidate=await run(writer,'candidate:input',n,{request_key:randomUUID(),workflow_ref:workflow.workflow_ref,body});
 let selection=null;if(select)selection=await run(writer,'candidate:select',n,{request_key:randomUUID(),workflow_ref:workflow.workflow_ref,candidate_ref:candidate.candidate_ref,expected_selection_version:0});
 return{novel:n,author,writer,writerId,scene,character,revision,object,constraint,task:task.task_id,version:task.version_id,taskInput,contextGrant:cg.grant_id,contextPolicy:cg.policy_release_id,writing:grant.grant_id,bundle:bundle.bundle_ref,publications,workflow:workflow.workflow_ref,candidate:candidate.candidate_ref,selection:selection?.selection_version??0};
}
