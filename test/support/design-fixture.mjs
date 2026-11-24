import { randomUUID } from 'node:crypto';
import { executeCommand } from '../../src/foundation.mjs';
import { requireCondition } from '../../src/safety.mjs';
export async function createDesignFixture(config,label,secret='fixture author intent'){
  const call=async(op,input)=>{const r=await executeCommand(config,op,input);requireCondition(r.ok,'FIXTURE_COMMAND_FAILED');return r;};
  const novel=(await call('novel:create',{external_key:label,title:`title ${secret}`})).novel_id;
  const write=(op,request)=>call(op,{novel_id:novel,request:{request_key:randomUUID(),...request}});
  const volume=(await write('volume:create',{position:1,title:`volume ${secret}`})).id;
  const chapter=(await write('chapter:create',{volume_id:volume,position:1,title:`chapter ${secret}`})).id;
  const scene=(await write('scene:create',{chapter_id:chapter,position:1,goal:`scene ${secret}`})).id;
  const character=(await write('entity:create',{entity_type:'character',name:`name ${secret}`})).id;
  const draft=(await write('design:draft',{base_revision_id:null})).draft_id;
  await write('design:edit',{draft_id:draft,expected_edit_version:1,content:{characters:[{design_key:'hero',entity_id:character,name:`character ${secret}`,description:{summary:`summary ${secret}`,motivation:`motivation ${secret}`,traits:[secret]}}],
    constraints:[{rule_key:'required',severity:'hard',scope_kind:'novel',scope_id:null,rule_text:`rule ${secret}`},{rule_key:'tasksoft',severity:'soft',scope_kind:'scene',scope_id:scene,rule_text:`rule soft ${secret}`} ]}});
  const revision=(await write('design:freeze',{draft_id:draft,expected_edit_version:2,expected_current_revision_id:null})).revision_id;
  const history=await call('design:history',{novel_id:novel,request:{}});
  const constraint=history.constraints.find(c=>c.rule_key==='required').constraint_id,soft=history.constraints.find(c=>c.rule_key==='tasksoft').constraint_id;
  const object=history.objects[0].design_object_version_id;
  const taskInput={scene_id:scene,revision_id:revision,viewpoint_entity_id:character,input_canon_watermark:0,goal:`task goal metadata ${secret}`,constraint_ids:[soft],
    budget:{max_input_tokens:8000,max_output_tokens:2000},reader_scope:{format_version:'task-reader-v1',mode:'no_disclosure_claim'},compile:{format_version:'scene-task-v1',timeline:'linear',dependencies:'committed_only'}};
  const task=await write('task:create',taskInput);
  return {novel,volume,chapter,scene,character,draft,revision,object,constraint,soft,task:task.task_id,version:task.version_id,taskInput};
}
