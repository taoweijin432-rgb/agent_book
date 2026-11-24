import { randomUUID } from 'node:crypto';

// One deterministic test call per execution. No external network, retry or Canon authority.
export async function up(pgm) {
 const sql=s=>pgm.sql(s),fn=(n,a,r,b,l='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${n}(${a}) RETURNS ${r} LANGUAGE ${l} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $f$ ${b} $f$;`);
 const role=randomUUID(),prompt=randomUUID(),model=randomUUID();
 sql(`INSERT INTO agent_book.execution_role VALUES('${role}','test-adapter-executor',1,'active');
 CREATE TABLE agent_book.test_novel_registration(novel_id uuid PRIMARY KEY REFERENCES agent_book.novel,registration_id uuid NOT NULL UNIQUE,registered_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE agent_book.prompt_version(prompt_version_id uuid PRIMARY KEY,protocol text NOT NULL CHECK(protocol='test-prompt-v1'),template text NOT NULL CHECK(template='Only produce a deterministic test fragment from this approved Bundle.'),UNIQUE(protocol));
 CREATE TABLE agent_book.model_configuration(model_configuration_id uuid PRIMARY KEY,provider text NOT NULL CHECK(provider='test'),adapter_id text NOT NULL CHECK(adapter_id='fixed-test-v1'),model_id text NOT NULL CHECK(model_id='test-text-v1'),parameter_protocol text NOT NULL CHECK(parameter_protocol='test-parameters-v1'),UNIQUE(adapter_id));
 INSERT INTO agent_book.prompt_version VALUES('${prompt}','test-prompt-v1','Only produce a deterministic test fragment from this approved Bundle.');
 INSERT INTO agent_book.model_configuration VALUES('${model}','test','fixed-test-v1','test-text-v1','test-parameters-v1');
 CREATE TABLE agent_book.test_generation_grant(
  generation_grant_id uuid PRIMARY KEY,context_grant_id uuid NOT NULL,context_scope_id uuid NOT NULL,novel_id uuid NOT NULL REFERENCES agent_book.test_novel_registration,
  task_version_id uuid NOT NULL,writer_actor_id uuid NOT NULL,capability_set text NOT NULL CHECK(capability_set='test_generation_v1'),issued_by uuid NOT NULL REFERENCES agent_book.actor_principal,
  effective_at timestamptz NOT NULL,expires_at timestamptz,CHECK(expires_at IS NULL OR expires_at>effective_at),
  FOREIGN KEY(context_grant_id,context_scope_id) REFERENCES agent_book.context_grant(context_grant_id,context_scope_id),
  FOREIGN KEY(context_scope_id,novel_id,task_version_id,writer_actor_id) REFERENCES agent_book.context_task_scope(context_scope_id,novel_id,task_version_id,writer_actor_id),
  UNIQUE(generation_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id));
 CREATE TABLE agent_book.test_generation_revocation(revocation_id uuid PRIMARY KEY,generation_grant_id uuid NOT NULL UNIQUE REFERENCES agent_book.test_generation_grant,revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
 ALTER TABLE agent_book.workflow_run ADD COLUMN generation_grant_id uuid REFERENCES agent_book.test_generation_grant;
 ALTER TABLE agent_book.workflow_run ALTER COLUMN writing_grant_id DROP NOT NULL;
 ALTER TABLE agent_book.workflow_run DROP CONSTRAINT workflow_run_execution_mode_check;
 ALTER TABLE agent_book.workflow_run ADD CHECK((execution_mode='manual_input_v1' AND writing_grant_id IS NOT NULL AND generation_grant_id IS NULL) OR(execution_mode='test_generation_v1' AND writing_grant_id IS NULL AND generation_grant_id IS NOT NULL));
 ALTER TABLE agent_book.workflow_run ADD FOREIGN KEY(generation_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id) REFERENCES agent_book.test_generation_grant(generation_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id);
 CREATE TABLE agent_book.generation_run(
  generation_run_id uuid PRIMARY KEY,novel_id uuid NOT NULL REFERENCES agent_book.test_novel_registration,workflow_run_id uuid NOT NULL,task_version_id uuid NOT NULL,writer_actor_id uuid NOT NULL,
  context_bundle_id uuid NOT NULL,context_grant_id uuid NOT NULL,generation_grant_id uuid NOT NULL,revision_id uuid NOT NULL,input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),
  bundle_payload_hash text NOT NULL,selection_version bigint NOT NULL,selection_id uuid NOT NULL,prompt_version_id uuid NOT NULL REFERENCES agent_book.prompt_version,model_configuration_id uuid NOT NULL REFERENCES agent_book.model_configuration,
  request_protocol text NOT NULL CHECK(request_protocol='test-request-v1'),prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id) REFERENCES agent_book.workflow_run(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id),
  FOREIGN KEY(generation_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id) REFERENCES agent_book.test_generation_grant(generation_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id),
  FOREIGN KEY(workflow_run_id,selection_version) REFERENCES agent_book.workflow_candidate_selection_history(workflow_run_id,selection_version),
  FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
  UNIQUE(generation_run_id,workflow_run_id),UNIQUE(generation_run_id,novel_id,task_version_id,workflow_run_id));
 CREATE TABLE agent_book.model_call(
  model_call_id uuid PRIMARY KEY,generation_run_id uuid NOT NULL UNIQUE REFERENCES agent_book.generation_run,call_attempt_no integer NOT NULL CHECK(call_attempt_no=1),
  request_text text NOT NULL,request_hash text NOT NULL,request_bytes integer NOT NULL,request_protocol text NOT NULL CHECK(request_protocol='test-request-v1'),UNIQUE(model_call_id,generation_run_id));
 CREATE TABLE agent_book.model_call_start(
  model_call_id uuid PRIMARY KEY REFERENCES agent_book.model_call,start_id uuid NOT NULL UNIQUE,executor_actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),deadline_at timestamptz NOT NULL,CHECK(deadline_at>started_at),UNIQUE(model_call_id,start_id));
 CREATE TABLE agent_book.model_call_result(
  model_call_id uuid PRIMARY KEY REFERENCES agent_book.model_call,start_id uuid NOT NULL,outcome text NOT NULL CHECK(outcome IN ('succeeded','adapter_failed','timed_out','technical_failed')),
  response_text text,response_hash text,response_bytes integer,response_protocol text NOT NULL CHECK(response_protocol='test-response-utf8-v1'),elapsed_ms integer NOT NULL CHECK(elapsed_ms>=0),
  measurement_version text NOT NULL CHECK(measurement_version='test-bytes-v1'),token_in integer CHECK(token_in IS NULL),token_out integer CHECK(token_out IS NULL),cost_amount numeric CHECK(cost_amount IS NULL),cost_status text NOT NULL CHECK(cost_status='not_applicable_test'),
  observed_by uuid NOT NULL REFERENCES agent_book.actor_principal,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((response_text IS NULL AND response_hash IS NULL AND response_bytes IS NULL) OR(response_text IS NOT NULL AND response_hash IS NOT NULL AND response_bytes IS NOT NULL)),
  FOREIGN KEY(model_call_id,start_id) REFERENCES agent_book.model_call_start(model_call_id,start_id));
 ALTER TABLE agent_book.candidate_version ADD COLUMN generation_run_id uuid;
 ALTER TABLE agent_book.candidate_version ADD COLUMN model_call_id uuid;
 ALTER TABLE agent_book.candidate_version ADD COLUMN test_root_generation_id uuid;
 DO $c$ DECLARE c record;BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='agent_book.candidate_version'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%origin%' LOOP EXECUTE format('ALTER TABLE agent_book.candidate_version DROP CONSTRAINT %I',c.conname);END LOOP;END $c$;
 ALTER TABLE agent_book.candidate_version ADD CHECK((origin='human_input' AND previous_candidate_id IS NULL AND generation_run_id IS NULL AND model_call_id IS NULL) OR(origin='human_edit' AND previous_candidate_id IS NOT NULL AND generation_run_id IS NULL AND model_call_id IS NULL) OR(origin='test_generated' AND previous_candidate_id IS NULL AND generation_run_id IS NOT NULL AND model_call_id IS NOT NULL AND test_root_generation_id=generation_run_id AND test_root_generation_id IS NOT NULL));
 ALTER TABLE agent_book.candidate_version ADD FOREIGN KEY(generation_run_id,workflow_run_id) REFERENCES agent_book.generation_run(generation_run_id,workflow_run_id);
 ALTER TABLE agent_book.candidate_version ADD FOREIGN KEY(test_root_generation_id,workflow_run_id) REFERENCES agent_book.generation_run(generation_run_id,workflow_run_id);
 ALTER TABLE agent_book.candidate_version ADD FOREIGN KEY(model_call_id,generation_run_id) REFERENCES agent_book.model_call(model_call_id,generation_run_id);
 CREATE UNIQUE INDEX one_candidate_per_generation ON agent_book.candidate_version(generation_run_id) WHERE generation_run_id IS NOT NULL;
 CREATE TABLE agent_book.generation_finalization(
  generation_run_id uuid PRIMARY KEY REFERENCES agent_book.generation_run,model_call_id uuid NOT NULL UNIQUE REFERENCES agent_book.model_call,
  outcome text NOT NULL CHECK(outcome IN ('accepted','input_rejected','adapter_failed','technical_failed','interrupted')),reason_code text NOT NULL CHECK(reason_code IN ('ACCEPTED','INPUT_STALE','ADAPTER_FAILED','TIMED_OUT','TECHNICAL_FAILURE','INTERRUPTED')),
  candidate_version_id uuid REFERENCES agent_book.candidate_version,finalized_by uuid NOT NULL REFERENCES agent_book.actor_principal,finalized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((outcome='accepted')=(candidate_version_id IS NOT NULL)),FOREIGN KEY(model_call_id,generation_run_id) REFERENCES agent_book.model_call(model_call_id,generation_run_id));
 CREATE TABLE agent_book.test_generation_request(request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,operation text NOT NULL,scope_id uuid NOT NULL,request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,
  resource_kind text NOT NULL CHECK(resource_kind IN ('grant','workflow','run')),grant_id uuid REFERENCES agent_book.test_generation_grant,workflow_id uuid REFERENCES agent_book.workflow_run,run_id uuid REFERENCES agent_book.generation_run,
  CHECK((resource_kind='grant' AND grant_id IS NOT NULL AND workflow_id IS NULL AND run_id IS NULL) OR(resource_kind='workflow' AND grant_id IS NULL AND workflow_id IS NOT NULL AND run_id IS NULL) OR(resource_kind='run' AND grant_id IS NULL AND workflow_id IS NULL AND run_id IS NOT NULL)),UNIQUE(actor_id,novel_id,operation,scope_id,request_key));
 CREATE TABLE agent_book.test_generation_audit(audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,task_version_id uuid,workflow_run_id uuid,operation text NOT NULL,decision text NOT NULL CHECK(decision IN ('allow','deny')),
  run_id uuid REFERENCES agent_book.generation_run,grant_id uuid REFERENCES agent_book.test_generation_grant,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(num_nonnulls(run_id,grant_id)<=1),FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),FOREIGN KEY(workflow_run_id) REFERENCES agent_book.workflow_run);
 ALTER TABLE agent_book.approval_review DROP CONSTRAINT approval_review_review_protocol_check;
 ALTER TABLE agent_book.approval_review ADD CHECK(review_protocol IN ('approval-review-v1','approval-review-test-v1'));
 `);
 fn('_gen_sha','t text','text',`SELECT encode(sha256(convert_to(t,'UTF8')),'hex')`,'sql');
 fn('_gen_executor','','boolean',`SELECT EXISTS(SELECT 1 FROM actor_principal a JOIN actor_role ar USING(actor_id) JOIN execution_role r USING(role_id) WHERE a.actor_id=_caller() AND a.status='active' AND a.actor_type='service' AND r.role_key='test-adapter-executor' AND r.status='active')`,'sql');
 // Historical grant intervals/revocations use one supplied time. Runtime callers still pass database wall time after locking.
 // Actor/role status remains the existing current-state contract, not a complete historical identity reconstruction.
 fn('_gen_grant_live','id uuid,a uuid,n uuid,t uuid,at_time timestamptz','boolean',`SELECT EXISTS(
  SELECT 1 FROM test_generation_grant g JOIN context_grant cg USING(context_grant_id,context_scope_id)
    JOIN context_task_scope s USING(context_scope_id) JOIN actor_principal actor ON actor.actor_id=s.writer_actor_id
    JOIN execution_role role ON role.role_id=s.writer_role_id
  WHERE g.generation_grant_id=id AND g.writer_actor_id=a AND g.novel_id=n AND g.task_version_id=t
    AND s.writer_actor_id=a AND s.novel_id=n AND s.task_version_id=t AND s.format_version='context-task-scope-v1'
    AND g.capability_set='test_generation_v1' AND cg.capability_set='compile_and_read_v1'
    AND actor.status='active' AND role.role_key='writer' AND role.status='active'
    AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at)
    AND cg.effective_at<=at_time AND(cg.expires_at IS NULL OR at_time<cg.expires_at)
    AND NOT EXISTS(SELECT 1 FROM test_generation_revocation x WHERE x.generation_grant_id=id AND x.revoked_at<=at_time)
    AND NOT EXISTS(SELECT 1 FROM context_grant_revocation x WHERE x.context_grant_id=cg.context_grant_id AND x.revoked_at<=at_time))`,'sql');
 sql('ALTER FUNCTION agent_book._wf_live(agent_book.workflow_run) RENAME TO _wf_live_pre_generation;ALTER FUNCTION agent_book._val_writer_at(agent_book.workflow_run,timestamptz) RENAME TO _val_writer_pre_generation;');
 fn('_wf_live','w workflow_run','boolean',`SELECT CASE WHEN w.execution_mode='test_generation_v1' THEN w.writer_actor_id=_caller() AND _gen_grant_live(w.generation_grant_id,_caller(),w.novel_id,w.task_version_id,clock_timestamp()) AND _val_inputs_current(w) ELSE _wf_live_pre_generation(w) END`,'sql');
 fn('_val_writer_at','w workflow_run,at_time timestamptz','boolean',`SELECT CASE WHEN w.execution_mode='test_generation_v1' THEN _gen_grant_live(w.generation_grant_id,w.writer_actor_id,w.novel_id,w.task_version_id,at_time) ELSE _val_writer_pre_generation(w,at_time) END`,'sql');
 fn('_wf_grant_id_guard','','trigger',`DECLARE id uuid;BEGIN PERFORM _lock_authorization();id:=(to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 IF(TG_TABLE_NAME<>'capability_grant' AND EXISTS(SELECT 1 FROM capability_grant WHERE grant_id=id)) OR(TG_TABLE_NAME<>'context_grant' AND EXISTS(SELECT 1 FROM context_grant WHERE context_grant_id=id)) OR(TG_TABLE_NAME<>'manual_writing_grant' AND EXISTS(SELECT 1 FROM manual_writing_grant WHERE writing_grant_id=id)) OR(TG_TABLE_NAME<>'test_generation_grant' AND EXISTS(SELECT 1 FROM test_generation_grant WHERE generation_grant_id=id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GRANT_ID_AMBIGUOUS';END IF;RETURN NEW;END;`);
 fn('_gen_render','b context_bundle','text',`SELECT jsonb_build_object('protocol','test-request-v1','provider','test','model','test-text-v1','prompt_version','test-prompt-v1','parameter_protocol','test-parameters-v1','parameters',jsonb_build_object('max_output_bytes',4096),'instruction',(SELECT template FROM prompt_version WHERE protocol='test-prompt-v1'),'bundle_payload',b.payload_text)::text`,'sql');
 fn('_gen_response','request_text text','text',`SELECT '[provider=test; adapter=fixed-test-v1]'||E'\\n'||'request-sha256='||_gen_sha(request_text)||E'\\n'||'测试正文：人物停下脚步，观察四周。'||E'\\n'`,'sql');
 fn('_gen_inputs_live','g generation_run','boolean',`SELECT EXISTS(SELECT 1 FROM workflow_run w JOIN context_bundle b ON b.context_bundle_id=w.context_bundle_id WHERE w.workflow_run_id=g.workflow_run_id AND w.execution_mode='test_generation_v1' AND w.novel_id=g.novel_id AND w.task_version_id=g.task_version_id AND w.writer_actor_id=g.writer_actor_id AND w.revision_id=g.revision_id AND w.context_bundle_id=g.context_bundle_id AND w.context_grant_id=g.context_grant_id AND w.generation_grant_id=g.generation_grant_id AND w.current_selection_version=g.selection_version AND _val_writer_at(w,clock_timestamp()) AND _val_inputs_current(w) AND b.payload_hash=g.bundle_payload_hash AND b.payload_hash=_gen_sha(b.payload_text))`,'sql');
 fn('_gen_lock','n uuid,t uuid,w uuid','void',`BEGIN PERFORM 1 FROM novel WHERE novel_id=n FOR UPDATE;PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=t) FOR UPDATE;PERFORM 1 FROM workflow_run WHERE workflow_run_id=w FOR UPDATE;END;`);
 fn('_gen_run_guard','','trigger',`DECLARE w workflow_run;b context_bundle;BEGIN SELECT * INTO STRICT w FROM workflow_run WHERE workflow_run_id=NEW.workflow_run_id;SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=w.context_bundle_id;
 IF NEW.revision_id<>w.revision_id OR NEW.context_grant_id<>w.context_grant_id OR NEW.generation_grant_id IS DISTINCT FROM w.generation_grant_id OR NEW.bundle_payload_hash<>b.payload_hash OR NEW.selection_version<>w.current_selection_version OR NOT EXISTS(SELECT 1 FROM workflow_candidate_selection_history WHERE selection_id=NEW.selection_id AND workflow_run_id=w.workflow_run_id AND selection_version=NEW.selection_version) OR NOT _gen_inputs_live(NEW) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GENERATION_INPUT_INVALID';END IF;RETURN NEW;END;`);
 fn('_gen_call_guard','','trigger',`DECLARE b context_bundle;BEGIN SELECT b0.* INTO STRICT b FROM generation_run g JOIN context_bundle b0 USING(context_bundle_id) WHERE g.generation_run_id=NEW.generation_run_id;IF NEW.request_text<>_gen_render(b) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REQUEST_INVALID';END IF;NEW.request_hash:=_gen_sha(NEW.request_text);NEW.request_bytes:=octet_length(convert_to(NEW.request_text,'UTF8'));RETURN NEW;END;`);
 fn('_gen_result_guard','','trigger',`BEGIN IF NEW.response_text IS NOT NULL THEN IF octet_length(NEW.response_text)>262144 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESPONSE_TOO_LARGE';END IF;NEW.response_hash:=_gen_sha(NEW.response_text);NEW.response_bytes:=octet_length(convert_to(NEW.response_text,'UTF8'));END IF;
 IF NOT EXISTS(SELECT 1 FROM model_call_start WHERE model_call_id=NEW.model_call_id AND start_id=NEW.start_id AND executor_actor_id=NEW.observed_by) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CALL_EXECUTOR_MISMATCH';END IF;RETURN NEW;END;`);
 fn('_gen_candidate_guard','','trigger',`DECLARE prev candidate_version;g generation_run;r model_call_result;BEGIN
 IF NEW.origin='human_edit' THEN SELECT * INTO STRICT prev FROM candidate_version WHERE candidate_version_id=NEW.previous_candidate_id AND workflow_run_id=NEW.workflow_run_id;IF NEW.test_root_generation_id IS NOT NULL AND NEW.test_root_generation_id IS DISTINCT FROM prev.test_root_generation_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TEST_LINEAGE_IMMUTABLE';END IF;NEW.test_root_generation_id:=prev.test_root_generation_id;
 ELSIF NEW.origin='test_generated' THEN SELECT * INTO STRICT g FROM generation_run WHERE generation_run_id=NEW.generation_run_id;SELECT * INTO STRICT r FROM model_call_result WHERE model_call_id=NEW.model_call_id;
 IF NOT _gen_executor() OR g.workflow_run_id<>NEW.workflow_run_id OR r.outcome<>'succeeded' OR r.response_text IS DISTINCT FROM NEW.body_text OR r.response_text IS DISTINCT FROM _gen_response((SELECT request_text FROM model_call WHERE model_call_id=NEW.model_call_id)) OR NOT _gen_inputs_live(g) OR EXISTS(SELECT 1 FROM generation_finalization WHERE generation_run_id=g.generation_run_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GENERATED_SOURCE_INVALID';END IF;
 ELSIF NEW.test_root_generation_id IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GENERATED_SOURCE_INVALID';END IF;RETURN NEW;END;`);
 fn('_gen_complete','','trigger',`DECLARE id uuid;g generation_run;c model_call;f generation_finalization;candidate candidate_version;BEGIN
 id:=CASE WHEN TG_TABLE_NAME='candidate_version' THEN NEW.generation_run_id ELSE NEW.generation_run_id END;IF id IS NULL THEN RETURN NULL;END IF;SELECT * INTO STRICT g FROM generation_run WHERE generation_run_id=id;SELECT * INTO c FROM model_call WHERE generation_run_id=id;SELECT * INTO f FROM generation_finalization WHERE generation_run_id=id;
 IF c.model_call_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='CALL_REQUIRED';END IF;
 IF f.outcome='accepted' THEN SELECT * INTO candidate FROM candidate_version WHERE candidate_version_id=f.candidate_version_id;IF candidate.generation_run_id IS DISTINCT FROM id OR candidate.model_call_id IS DISTINCT FROM c.model_call_id OR candidate.origin<>'test_generated' OR NOT EXISTS(SELECT 1 FROM model_call_result r WHERE r.model_call_id=c.model_call_id AND r.outcome='succeeded' AND r.response_text=candidate.body_text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ACCEPTANCE_INCOMPLETE';END IF;
 ELSIF EXISTS(SELECT 1 FROM candidate_version WHERE generation_run_id=id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TERMINAL_REQUIRED';END IF;RETURN NULL;END;`);
 fn('_gen_visible','g generation_run','jsonb',`SELECT jsonb_build_object('ok',true,'run_ref',g.generation_run_id,'provider','test','test_only',true,'workflow_ref',g.workflow_run_id,'call_ref',c.model_call_id,'execution_state',coalesce(f.outcome,CASE WHEN s.model_call_id IS NULL THEN 'prepared' ELSE 'call_unresolved' END),'call_state',coalesce(r.outcome,CASE WHEN s.model_call_id IS NULL THEN 'dispatch_not_recorded' ELSE 'started_result_unknown' END),'admission_state',CASE WHEN f.outcome='accepted' THEN 'accepted' WHEN f.generation_run_id IS NULL THEN 'pending' ELSE 'rejected' END,'candidate_ref',f.candidate_version_id,'reason_code',f.reason_code,'not_commit_permit',true) FROM model_call c LEFT JOIN model_call_start s USING(model_call_id) LEFT JOIN model_call_result r USING(model_call_id) LEFT JOIN generation_finalization f ON f.generation_run_id=c.generation_run_id WHERE c.generation_run_id=g.generation_run_id`,'sql');
 fn('_gen_audit','id uuid,op text,n uuid,t uuid,w uuid,allowed boolean,r uuid,grant_ref uuid','void',`INSERT INTO test_generation_audit VALUES(id,_caller(),n,t,w,op,CASE WHEN allowed THEN 'allow' ELSE 'deny' END,r,grant_ref,clock_timestamp())`,'sql');
 fn('_gen_grant_create','n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE cg context_grant;s context_task_scope;at_time timestamptz:=clock_timestamp();cutoff timestamptz;total integer;BEGIN
 IF NOT _exact_keys(p,ARRAY['request_key','context_grant_id','expires_at']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 SELECT * INTO cg FROM context_grant WHERE context_grant_id=(p->>'context_grant_id')::uuid;SELECT * INTO s FROM context_task_scope WHERE context_scope_id=cg.context_scope_id;
 IF s.novel_id IS DISTINCT FROM n OR NOT _ctx_grant_live(cg.context_grant_id,s.writer_actor_id,n,s.task_version_id) OR NOT _ctx_task_current(n,s.task_version_id) THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 SELECT count(*),min(g.expires_at) INTO total,cutoff FROM capability_grant g JOIN capability c USING(capability_id) JOIN data_scope scope USING(data_scope_id) WHERE g.actor_id=_caller() AND scope.novel_id=n AND c.capability_key IN ('design.read','design.freeze','task.read','task.create') AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at) AND NOT EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id);
 IF total<>4 THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;cutoff:=least(cutoff,cg.expires_at,(p->>'expires_at')::timestamptz);
 IF cutoff IS NOT NULL AND cutoff<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 INSERT INTO test_generation_grant VALUES(ids[1],cg.context_grant_id,s.context_scope_id,n,s.task_version_id,s.writer_actor_id,'test_generation_v1',_caller(),at_time,cutoff);RETURN jsonb_build_object('ok',true,'grant_id',ids[1],'provider','test','test_only',true);END;`);
 fn('_gen_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,'workflow_ref',a.workflow_run_id,'run_ref',a.run_id,'grant_ref',a.grant_id,'provider','test','test_only',true,'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]') FROM test_generation_audit a
 WHERE a.novel_id=n AND(a.task_version_id IS NULL OR EXISTS(SELECT 1 FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=a.task_version_id)) AND(a.workflow_run_id IS NULL OR EXISTS(SELECT 1 FROM workflow_run WHERE novel_id=n AND task_version_id=a.task_version_id AND workflow_run_id=a.workflow_run_id))
 AND(a.run_id IS NULL OR EXISTS(SELECT 1 FROM generation_run g JOIN workflow_run w USING(workflow_run_id) JOIN context_bundle b ON b.context_bundle_id=g.context_bundle_id WHERE g.generation_run_id=a.run_id AND g.novel_id=n AND w.novel_id=n AND b.novel_id=n AND g.task_version_id=a.task_version_id AND g.workflow_run_id=a.workflow_run_id AND w.task_version_id=g.task_version_id AND w.context_bundle_id=g.context_bundle_id AND w.writer_actor_id=g.writer_actor_id AND b.task_version_id=g.task_version_id AND b.writer_actor_id=g.writer_actor_id))
 AND(a.grant_id IS NULL OR(a.workflow_run_id IS NULL AND EXISTS(SELECT 1 FROM test_generation_grant WHERE generation_grant_id=a.grant_id AND novel_id=n AND task_version_id=a.task_version_id)))`,'sql');
 fn('api_test_generation','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE w workflow_run;b context_bundle;v scene_task_version;g generation_run;grant_id uuid;t uuid;prior test_generation_request;digest text;scope uuid;resource uuid;typ text;result jsonb;allowed boolean;BEGIN
 PERFORM _lock_authorization();
 allowed:=EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=n);
 IF op='generation-grant:create' THEN allowed:=allowed AND _ctx_manage(_caller(),n);
 ELSIF op='generation:audit' THEN allowed:=allowed AND _has_capability(_caller(),'audit.read',n);
 ELSIF op='generation:trace' THEN allowed:=allowed AND _has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n);
 ELSIF op='test-workflow:create' THEN
 SELECT * INTO b FROM context_bundle WHERE novel_id=n AND public_bundle_ref=(p->>'bundle_ref')::uuid;t:=b.task_version_id;grant_id:=(p->>'generation_grant_id')::uuid;
 allowed:=allowed AND _gen_grant_live(grant_id,_caller(),n,t,clock_timestamp()) AND _ctx_bundle_live(b) AND EXISTS(SELECT 1 FROM test_generation_grant x WHERE x.generation_grant_id=grant_id AND x.context_grant_id=b.context_grant_id);
 ELSE
 IF op IN ('generation:read','generation:interrupt') THEN SELECT * INTO g FROM generation_run WHERE generation_run_id=(p->>'run_ref')::uuid AND novel_id=n;SELECT * INTO w FROM workflow_run WHERE workflow_run_id=g.workflow_run_id;
 ELSE SELECT * INTO w FROM workflow_run WHERE workflow_run_id=(p->>'workflow_ref')::uuid AND novel_id=n;END IF;
 allowed:=allowed AND w.execution_mode='test_generation_v1' AND(_wf_live(w) OR(op='generation:interrupt' AND _ctx_manage(_caller(),n)));t:=w.task_version_id;
 END IF;
 IF NOT coalesce(allowed,false) THEN PERFORM _gen_audit(audit,op,(SELECT novel_id FROM novel WHERE novel_id=n),NULL,NULL,false,NULL,NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 PERFORM _gen_lock(n,t,w.workflow_run_id);
 BEGIN
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR cardinality(ids)<>16 OR array_position(ids,NULL) IS NOT NULL OR octet_length(p::text)>20000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 IF op='generation:audit' THEN IF p<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;result:=jsonb_build_object('ok',true,'events',_gen_events(n));
 ELSIF op='generation:trace' THEN
 IF NOT _exact_keys(p,ARRAY['workflow_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 SELECT * INTO w FROM workflow_run WHERE workflow_run_id=(p->>'workflow_ref')::uuid AND novel_id=n;t:=w.task_version_id;
 IF w.workflow_run_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');ELSE result:=jsonb_build_object('ok',true,'provider','test','test_only',true,'runs',(SELECT coalesce(jsonb_agg(jsonb_build_object('input',to_jsonb(x),'state',_gen_visible(x),'call',to_jsonb(c),'start',to_jsonb(s),'result',to_jsonb(r),'finalization',to_jsonb(f)) ORDER BY x.prepared_at,x.generation_run_id),'[]') FROM generation_run x JOIN model_call c USING(generation_run_id) LEFT JOIN model_call_start s USING(model_call_id) LEFT JOIN model_call_result r USING(model_call_id) LEFT JOIN generation_finalization f ON f.generation_run_id=x.generation_run_id WHERE x.workflow_run_id=w.workflow_run_id));END IF;
 ELSIF op IN ('generation:read','generation:history') THEN
 IF NOT _exact_keys(p,CASE WHEN op='generation:read' THEN ARRAY['run_ref'] ELSE ARRAY['workflow_ref'] END) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 IF op='generation:read' THEN result:=_gen_visible(g);resource:=g.generation_run_id;ELSE result:=jsonb_build_object('ok',true,'provider','test','test_only',true,'runs',(SELECT coalesce(jsonb_agg(_gen_visible(x) ORDER BY x.prepared_at,x.generation_run_id),'[]') FROM generation_run x WHERE x.workflow_run_id=w.workflow_run_id));END IF;
 ELSE
 IF jsonb_typeof(p->'request_key') IS DISTINCT FROM 'string' OR length(p->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 scope:=CASE WHEN op='generation-grant:create' THEN (p->>'context_grant_id')::uuid WHEN op='test-workflow:create' THEN b.task_version_id ELSE w.workflow_run_id END;
 digest:=_gen_sha('test-generation-request-v1:'||op||':'||n::text||':'||p::text);SELECT * INTO prior FROM test_generation_request WHERE actor_id=_caller() AND novel_id=n AND operation=op AND scope_id=scope AND request_key=p->>'request_key';
 IF prior.request_id IS NOT NULL THEN
 IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
 ELSIF prior.resource_kind='run' THEN SELECT * INTO STRICT g FROM generation_run WHERE generation_run_id=prior.run_id;result:=_gen_visible(g)||jsonb_build_object('created',false);resource:=g.generation_run_id;
 ELSE result:=jsonb_build_object('ok',true,'provider','test','test_only',true,CASE WHEN prior.resource_kind='grant' THEN 'grant_id' ELSE 'workflow_ref' END,coalesce(prior.grant_id,prior.workflow_id));END IF;
 ELSE
 IF op='generation-grant:create' THEN result:=_gen_grant_create(n,p,ids);typ:='grant';grant_id:=(result->>'grant_id')::uuid;SELECT task_version_id INTO t FROM test_generation_grant WHERE generation_grant_id=grant_id;
 ELSIF op='test-workflow:create' THEN
 IF NOT _exact_keys(p,ARRAY['request_key','generation_grant_id','bundle_ref','execution_mode']) OR p->>'execution_mode' IS DISTINCT FROM 'test_generation_v1' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 SELECT * INTO STRICT v FROM scene_task_version WHERE scene_task_version_id=b.task_version_id;
 INSERT INTO workflow_run VALUES(ids[1],n,v.scene_id,v.scene_task_version_id,v.author_design_revision_id,v.viewpoint_entity_id,_caller(),b.context_bundle_id,b.context_grant_id,NULL,'test_generation_v1',0,NULL,0,_caller(),clock_timestamp(),grant_id) RETURNING * INTO w;
 INSERT INTO workflow_candidate_selection_history VALUES(ids[2],w.workflow_run_id,0,NULL,NULL,'initialized',_caller(),clock_timestamp());result:=jsonb_build_object('ok',true,'workflow_ref',w.workflow_run_id,'selection_version',0,'provider','test','test_only',true);typ:='workflow';
 ELSIF op='generation:prepare' THEN
 IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref','expected_selection_version','adapter_id','parameters']) OR p->>'adapter_id' IS DISTINCT FROM 'fixed-test-v1' OR p->'parameters' IS DISTINCT FROM '{"protocol":"test-parameters-v1","max_output_bytes":4096}'::jsonb OR jsonb_typeof(p->'expected_selection_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 IF w.current_selection_version<>(p->>'expected_selection_version')::bigint THEN result:=jsonb_build_object('ok',false,'error','SELECTION_CONFLICT');ELSE
 SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=w.context_bundle_id;
 INSERT INTO generation_run VALUES(ids[1],n,w.workflow_run_id,w.task_version_id,w.writer_actor_id,w.context_bundle_id,w.context_grant_id,w.generation_grant_id,w.revision_id,0,b.payload_hash,w.current_selection_version,(SELECT selection_id FROM workflow_candidate_selection_history WHERE workflow_run_id=w.workflow_run_id AND selection_version=w.current_selection_version),'${prompt}','${model}','test-request-v1',clock_timestamp()) RETURNING * INTO g;
 INSERT INTO model_call VALUES(ids[2],g.generation_run_id,1,_gen_render(b),'computed',0,'test-request-v1');result:=_gen_visible(g)||jsonb_build_object('created',true);resource:=g.generation_run_id;typ:='run';END IF;
 ELSIF op='generation:interrupt' THEN
 IF NOT _exact_keys(p,ARRAY['request_key','run_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 INSERT INTO generation_finalization SELECT g.generation_run_id,c.model_call_id,'interrupted','INTERRUPTED',NULL,_caller(),clock_timestamp() FROM model_call c WHERE c.generation_run_id=g.generation_run_id ON CONFLICT(generation_run_id) DO NOTHING;
 result:=_gen_visible(g);resource:=g.generation_run_id;typ:='run';
 ELSE RETURN jsonb_build_object('ok',false,'error','UNSUPPORTED_OPERATION');END IF;
 IF(result->>'ok')::boolean THEN INSERT INTO test_generation_request VALUES(ids[16],_caller(),n,op,scope,p->>'request_key',digest,typ,CASE WHEN typ='grant' THEN grant_id END,CASE WHEN typ='workflow' THEN w.workflow_run_id END,CASE WHEN typ='run' THEN resource END);END IF;
 END IF;
 END IF;
 EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');resource:=NULL;grant_id:=NULL;
 END;
 PERFORM _gen_audit(audit,op,n,t,w.workflow_run_id,(result->>'ok')::boolean,resource,CASE WHEN op='generation-grant:create' THEN grant_id END);RETURN result;END;`);
 fn('api_test_adapter','op text,run_ref uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE g generation_run;w workflow_run;c model_call;s model_call_start;r model_call_result;f generation_finalization;candidate_id uuid;outcome text;reason text;at_time timestamptz;response text;BEGIN
 PERFORM _lock_authorization();IF NOT _gen_executor() THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 SELECT * INTO g FROM generation_run WHERE generation_run_id=run_ref;IF g.generation_run_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 PERFORM _gen_lock(g.novel_id,g.task_version_id,g.workflow_run_id);SELECT * INTO STRICT w FROM workflow_run WHERE workflow_run_id=g.workflow_run_id;SELECT * INTO STRICT c FROM model_call WHERE generation_run_id=run_ref;SELECT * INTO s FROM model_call_start WHERE model_call_id=c.model_call_id;SELECT * INTO f FROM generation_finalization WHERE generation_run_id=run_ref;
 IF cardinality(ids)<>4 OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 IF op='start' THEN
 IF NOT _exact_keys(p,ARRAY['start_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 IF f.generation_run_id IS NOT NULL OR s.model_call_id IS NOT NULL THEN RETURN _gen_visible(g)||jsonb_build_object('claimed',false);END IF;
 IF NOT _gen_inputs_live(g) THEN INSERT INTO generation_finalization VALUES(run_ref,c.model_call_id,'input_rejected','INPUT_STALE',NULL,_caller(),clock_timestamp());PERFORM _gen_audit(audit,'adapter.start',g.novel_id,g.task_version_id,g.workflow_run_id,false,run_ref,NULL);RETURN _gen_visible(g)||jsonb_build_object('claimed',false);END IF;
 at_time:=clock_timestamp();INSERT INTO model_call_start VALUES(c.model_call_id,(p->>'start_id')::uuid,_caller(),at_time,at_time+interval '2 seconds');
 PERFORM _gen_audit(audit,'adapter.start',g.novel_id,g.task_version_id,g.workflow_run_id,true,run_ref,NULL);RETURN jsonb_build_object('ok',true,'claimed',true,'request_text',c.request_text,'call_ref',c.model_call_id,'start_id',p->>'start_id');
 END IF;
 IF op NOT IN ('finish','technical-finish') OR NOT _exact_keys(p,ARRAY['start_id','outcome','response_text','elapsed_ms']) OR s.start_id IS DISTINCT FROM (p->>'start_id')::uuid OR s.executor_actor_id IS DISTINCT FROM _caller() OR p->>'outcome' NOT IN ('succeeded','adapter_failed','timed_out','technical_failed') OR jsonb_typeof(p->'elapsed_ms') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 response:=p->>'response_text';IF(p->>'outcome'='succeeded' AND response IS NULL) OR octet_length(response)>262144 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
 SELECT * INTO r FROM model_call_result WHERE model_call_id=c.model_call_id;
 IF r.model_call_id IS NULL THEN INSERT INTO model_call_result VALUES(c.model_call_id,s.start_id,p->>'outcome',response,CASE WHEN response IS NOT NULL THEN _gen_sha(response) END,CASE WHEN response IS NOT NULL THEN octet_length(response) END,'test-response-utf8-v1',(p->>'elapsed_ms')::integer,'test-bytes-v1',NULL,NULL,NULL,'not_applicable_test',_caller(),clock_timestamp());
 ELSIF r.response_text IS DISTINCT FROM response OR r.outcome<>p->>'outcome' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RESULT_IMMUTABLE';END IF;
 IF f.generation_run_id IS NOT NULL THEN PERFORM _gen_audit(audit,'adapter.late-result',g.novel_id,g.task_version_id,g.workflow_run_id,false,run_ref,NULL);RETURN _gen_visible(g)||jsonb_build_object('late_result_ignored',true);END IF;
 IF op='technical-finish' THEN outcome:='technical_failed';reason:='TECHNICAL_FAILURE';
 ELSIF p->>'outcome'='technical_failed' THEN outcome:='technical_failed';reason:='TECHNICAL_FAILURE';
 ELSIF clock_timestamp()>=s.deadline_at OR p->>'outcome'='timed_out' THEN outcome:='adapter_failed';reason:='TIMED_OUT';
 ELSIF p->>'outcome'<>'succeeded' OR response IS DISTINCT FROM _gen_response(c.request_text) THEN outcome:='adapter_failed';reason:='ADAPTER_FAILED';
 ELSIF NOT _gen_inputs_live(g) THEN outcome:='input_rejected';reason:='INPUT_STALE';
 ELSE
 candidate_id:=ids[1];INSERT INTO candidate_version VALUES(candidate_id,g.workflow_run_id,g.novel_id,g.task_version_id,g.writer_actor_id,g.context_bundle_id,NULL,'test_generated',response,'computed',0,'exact-utf8-v1',g.writer_actor_id,clock_timestamp(),run_ref,c.model_call_id,run_ref);outcome:='accepted';reason:='ACCEPTED';
 END IF;
 INSERT INTO generation_finalization VALUES(run_ref,c.model_call_id,outcome,reason,candidate_id,_caller(),clock_timestamp());PERFORM _gen_audit(audit,'adapter.finish',g.novel_id,g.task_version_id,g.workflow_run_id,outcome='accepted',run_ref,NULL);RETURN _gen_visible(g);END;`);
 // Preserve legacy JSON byte meaning. Only new test reviews receive the extended protocol.
 sql('ALTER FUNCTION agent_book._ap_payload(agent_book.approval_review) RENAME TO _ap_payload_v1;');
 fn('_gen_candidate_marker','id uuid','jsonb',`SELECT jsonb_build_object('test_only',EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=c.novel_id),'provider',CASE WHEN c.test_root_generation_id IS NOT NULL THEN 'test' END,'generation_ref',c.generation_run_id,'call_ref',c.model_call_id,'test_root_generation_ref',c.test_root_generation_id) FROM candidate_version c WHERE c.candidate_version_id=id`,'sql');
 fn('_ap_payload','r approval_review','jsonb',`SELECT CASE r.review_protocol WHEN 'approval-review-v1' THEN _ap_payload_v1(r) WHEN 'approval-review-test-v1' THEN _ap_payload_v1(r)||jsonb_build_object('protocol','approval-review-test-v1','test_source',_gen_candidate_marker((SELECT candidate_version_id FROM validation_run WHERE validation_run_id=r.validation_run_id))) ELSE NULL END`,'sql');
 fn('_gen_review_protocol','','trigger',`BEGIN IF EXISTS(SELECT 1 FROM validation_run v JOIN test_novel_registration n USING(novel_id) WHERE v.validation_run_id=NEW.validation_run_id) THEN NEW.review_protocol:='approval-review-test-v1';END IF;RETURN NEW;END;`);
 sql('ALTER FUNCTION agent_book._wf_history(agent_book.workflow_run,boolean) RENAME TO _wf_history_pre_generation;');
 fn('_wf_history','w workflow_run,restricted boolean','jsonb',`DECLARE r jsonb;BEGIN r:=_wf_history_pre_generation(w,restricted);IF NOT EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=w.novel_id) THEN RETURN r;END IF;
 RETURN r||jsonb_build_object('test_only',true,'provider','test','candidates',(SELECT coalesce(jsonb_agg(x.value||_gen_candidate_marker((x.value->>'candidate_ref')::uuid) ORDER BY x.ordinality),'[]') FROM jsonb_array_elements(r->'candidates') WITH ORDINALITY x(value,ordinality)));END;`);
 sql('ALTER FUNCTION agent_book.api_manual_workflow(text,uuid,jsonb,uuid[],uuid) RENAME TO _manual_workflow_pre_generation;');
 fn('api_manual_workflow','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE r jsonb;BEGIN r:=_manual_workflow_pre_generation(op,n,p,ids,audit);IF(r->>'ok')::boolean AND r ? 'candidate_ref' AND EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=n) THEN RETURN r||_gen_candidate_marker((r->>'candidate_ref')::uuid);END IF;RETURN r;END;`);

 for(const name of ['_wf_events','_val_events','_ap_events']){
  sql(`ALTER FUNCTION agent_book.${name}(uuid) RENAME TO ${name}_pre_generation;`);
  fn(name,'n uuid','jsonb',`SELECT CASE WHEN EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=n) THEN (SELECT coalesce(jsonb_agg(value||jsonb_build_object('provider','test','test_only',true) ORDER BY ordinality),'[]') FROM jsonb_array_elements(${name}_pre_generation(n)) WITH ORDINALITY) ELSE ${name}_pre_generation(n) END`,'sql');
 }
 sql('ALTER FUNCTION agent_book._ap_decision_visible(agent_book.approval_decision) RENAME TO _ap_decision_pre_generation;');
 fn('_ap_decision_visible','d approval_decision','jsonb',`SELECT _ap_decision_pre_generation(d)||CASE WHEN EXISTS(SELECT 1 FROM test_novel_registration WHERE novel_id=d.novel_id) THEN jsonb_build_object('provider','test','test_only',true) ELSE '{}'::jsonb END`,'sql');
 sql('ALTER FUNCTION agent_book.api_revoke_grant(uuid,uuid) RENAME TO _revoke_pre_generation;');
 fn('api_revoke_grant','p_grant uuid,p_audit uuid','jsonb',`DECLARE g test_generation_grant;BEGIN PERFORM _lock_authorization();SELECT * INTO g FROM test_generation_grant WHERE generation_grant_id=p_grant;IF g.generation_grant_id IS NULL THEN RETURN _revoke_pre_generation(p_grant,p_audit);END IF;
 IF NOT _ctx_manage(_caller(),g.novel_id) OR NOT _has_capability(_caller(),'grant.revoke',g.novel_id) THEN PERFORM _gen_audit(p_audit,'grant.revoke',g.novel_id,NULL,NULL,false,NULL,NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
 INSERT INTO test_generation_revocation VALUES(p_audit,p_grant,_caller(),clock_timestamp()) ON CONFLICT(generation_grant_id) DO NOTHING;PERFORM _gen_audit(p_audit,'grant.revoke',g.novel_id,g.task_version_id,NULL,true,NULL,p_grant);RETURN jsonb_build_object('ok',true,'status','revoked');END;`);
 fn('_gen_revoke_invalidate','','trigger',`BEGIN PERFORM _ap_invalidate((SELECT novel_id FROM test_generation_grant WHERE generation_grant_id=NEW.generation_grant_id),'AUTHORIZATION_CHANGED');RETURN NEW;END;`);
 sql('ALTER FUNCTION agent_book.api_read_audit(uuid,uuid) RENAME TO _read_audit_pre_generation;');
 fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE r jsonb;BEGIN r:=_read_audit_pre_generation(p_novel,p_audit);IF(r->>'ok')::boolean THEN RETURN jsonb_set(r,'{events}',(r->'events')||_gen_events(p_novel));END IF;RETURN r;END;`);
 for(const table of ['test_novel_registration','prompt_version','model_configuration','test_generation_grant','test_generation_revocation','generation_run','model_call','model_call_start','model_call_result','generation_finalization','test_generation_request','test_generation_audit'])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
 sql(`CREATE TRIGGER generation_grant_identity BEFORE INSERT ON agent_book.test_generation_grant FOR EACH ROW EXECUTE FUNCTION agent_book._wf_grant_id_guard('generation_grant_id');
 CREATE TRIGGER generation_revocation_time BEFORE INSERT ON agent_book.test_generation_revocation FOR EACH ROW EXECUTE FUNCTION agent_book._guard_revocation();
 CREATE TRIGGER generation_revocation_invalidate AFTER INSERT ON agent_book.test_generation_revocation FOR EACH ROW EXECUTE FUNCTION agent_book._gen_revoke_invalidate();
 CREATE TRIGGER generation_input BEFORE INSERT ON agent_book.generation_run FOR EACH ROW EXECUTE FUNCTION agent_book._gen_run_guard();
 CREATE TRIGGER generation_request BEFORE INSERT ON agent_book.model_call FOR EACH ROW EXECUTE FUNCTION agent_book._gen_call_guard();
 CREATE TRIGGER generation_result BEFORE INSERT ON agent_book.model_call_result FOR EACH ROW EXECUTE FUNCTION agent_book._gen_result_guard();
 CREATE TRIGGER candidate_generation_source BEFORE INSERT ON agent_book.candidate_version FOR EACH ROW EXECUTE FUNCTION agent_book._gen_candidate_guard();
 CREATE TRIGGER approval_00_test_protocol BEFORE INSERT ON agent_book.approval_review FOR EACH ROW EXECUTE FUNCTION agent_book._gen_review_protocol();`);
 for(const table of ['generation_run','model_call','generation_finalization','candidate_version'])sql(`CREATE CONSTRAINT TRIGGER generation_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._gen_complete();`);
 sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
 DO $acl$ DECLARE login record;BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION agent_book._manual_workflow_pre_generation(text,uuid,jsonb,uuid[],uuid),agent_book._revoke_pre_generation(uuid,uuid),agent_book._read_audit_pre_generation(uuid,uuid) FROM %I',login.db_login);
 IF login.role_key IN ('author','writer','auditor') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_test_generation(text,uuid,jsonb,uuid[],uuid),agent_book.api_manual_workflow(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);END IF;
 IF login.role_key='author' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_revoke_grant(uuid,uuid) TO %I',login.db_login);END IF;
 IF login.role_key='auditor' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_read_audit(uuid,uuid) TO %I',login.db_login);END IF;
 END LOOP;END $acl$;`);
}
export async function down(){throw new Error('Use a reviewed forward migration');}
