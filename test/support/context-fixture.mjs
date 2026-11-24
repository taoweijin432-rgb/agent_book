import { randomUUID } from 'node:crypto';
import { executeCommand } from '../../src/foundation.mjs';
import { createDesignFixture } from './design-fixture.mjs';
export async function createContextFixture(configs,actors,{author='authorA',writer='writerA',label='manual',secret='private fixture',expiresAt=null}={}){
  const f=await createDesignFixture(configs[author],label,secret);
  const request=async(op,p)=>{const r=await executeCommand(configs[author],op,{novel_id:f.novel,request:{request_key:randomUUID(),...p}});if(!r.ok)throw new Error('CONTEXT_FIXTURE_FAILED');return r;};
  const writerId=actors.find(a=>a.label===writer).actorId;
  const grant=await request('context-grant:create',{task_version_id:f.version,writer_actor_id:writerId,allow_revision:true,allow_object:true,allow_constraint:true,expires_at:expiresAt});
  const publications=[];
  for(const [kind,type,id]of [['goal','author_design_revision',f.revision],['character','design_object_version',f.object],['constraint','design_constraint',f.constraint],['constraint','design_constraint',f.soft]]){
    const q=await request('projection:propose',{task_version_id:f.version,writer_actor_id:writerId,kind,source_object_type:type,source_object_id:id,safe_text:`已批准的 ${kind} 写作指导`,semantics:'author_intent_only',format_version:'safe-projection-v1',policy_version:'safe-context-v1',replaces_publication_id:null});
    publications.push((await request('projection:publish',{proposal_id:q.proposal_id})).publication_id);
  }
  const bundle=await executeCommand(configs[writer],'context:compile',{novel_id:f.novel,request:{request_key:randomUUID(),task_version_id:f.version,max_bytes:65536}});
  if(!bundle.ok)throw new Error('CONTEXT_FIXTURE_COMPILE_FAILED');
  return {...f,author,writer,writerId,contextGrant:grant.grant_id,policy:grant.policy_release_id,publications,bundle:bundle.bundle_ref};
}
