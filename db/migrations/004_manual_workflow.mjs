// This execution mode accepts human text only. No Generation, approval or Canon placeholders.
export async function up(pgm) {
  const sql=s=>pgm.sql(s);
  const fn=(name,args,result,body,lang='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${result} LANGUAGE ${lang} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $fn$ ${body} $fn$;`);
  sql(`ALTER TABLE agent_book.context_grant ADD UNIQUE(context_grant_id,context_scope_id);
    ALTER TABLE agent_book.context_task_scope ADD UNIQUE(context_scope_id,novel_id,task_version_id,writer_actor_id);
    CREATE TABLE agent_book.manual_writing_grant (
      writing_grant_id uuid PRIMARY KEY,context_grant_id uuid NOT NULL,context_scope_id uuid NOT NULL,
      novel_id uuid NOT NULL,task_version_id uuid NOT NULL,writer_actor_id uuid NOT NULL,
      capability_set text NOT NULL CHECK(capability_set='manual_workflow_v1'),issued_by uuid NOT NULL REFERENCES agent_book.actor_principal,
      effective_at timestamptz NOT NULL,expires_at timestamptz,CHECK(expires_at IS NULL OR expires_at>effective_at),
      FOREIGN KEY(context_grant_id,context_scope_id) REFERENCES agent_book.context_grant(context_grant_id,context_scope_id),
      FOREIGN KEY(context_scope_id,novel_id,task_version_id,writer_actor_id) REFERENCES agent_book.context_task_scope(context_scope_id,novel_id,task_version_id,writer_actor_id),
      UNIQUE(writing_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id));
    CREATE TABLE agent_book.manual_writing_revocation (
      revocation_id uuid PRIMARY KEY,writing_grant_id uuid NOT NULL UNIQUE REFERENCES agent_book.manual_writing_grant,
      revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.workflow_run (
      workflow_run_id uuid PRIMARY KEY,novel_id uuid NOT NULL,scene_id uuid NOT NULL,task_version_id uuid NOT NULL,revision_id uuid NOT NULL,
      viewpoint_entity_id uuid NOT NULL,writer_actor_id uuid NOT NULL,context_bundle_id uuid NOT NULL,context_grant_id uuid NOT NULL,writing_grant_id uuid NOT NULL,
      execution_mode text NOT NULL CHECK(execution_mode='manual_input_v1'),input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),
      current_candidate_id uuid,current_selection_version bigint NOT NULL DEFAULT 0 CHECK(current_selection_version>=0),
      created_by uuid NOT NULL CHECK(created_by=writer_actor_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(novel_id,scene_id,task_version_id,revision_id,viewpoint_entity_id) REFERENCES agent_book.scene_task_version(novel_id,scene_id,scene_task_version_id,author_design_revision_id,viewpoint_entity_id),
      FOREIGN KEY(context_bundle_id,novel_id,task_version_id,writer_actor_id) REFERENCES agent_book.context_bundle(context_bundle_id,novel_id,task_version_id,writer_actor_id),
      FOREIGN KEY(writing_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id) REFERENCES agent_book.manual_writing_grant(writing_grant_id,novel_id,task_version_id,writer_actor_id,context_grant_id),
      UNIQUE(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id),UNIQUE(workflow_run_id,novel_id,task_version_id));
    CREATE TABLE agent_book.candidate_version (
      candidate_version_id uuid PRIMARY KEY,workflow_run_id uuid NOT NULL,novel_id uuid NOT NULL,task_version_id uuid NOT NULL,
      writer_actor_id uuid NOT NULL,context_bundle_id uuid NOT NULL,previous_candidate_id uuid,
      origin text NOT NULL CHECK(origin IN ('human_input','human_edit')),
      body_text text NOT NULL,body_hash text NOT NULL,body_bytes integer NOT NULL,
      text_protocol text NOT NULL CHECK(text_protocol='exact-utf8-v1'),edited_by uuid NOT NULL CHECK(edited_by=writer_actor_id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((origin='human_input' AND previous_candidate_id IS NULL) OR(origin='human_edit' AND previous_candidate_id IS NOT NULL)),
      CHECK(previous_candidate_id IS DISTINCT FROM candidate_version_id),
      FOREIGN KEY(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id) REFERENCES agent_book.workflow_run(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id),
      UNIQUE(workflow_run_id,candidate_version_id),
      FOREIGN KEY(workflow_run_id,previous_candidate_id) REFERENCES agent_book.candidate_version(workflow_run_id,candidate_version_id));
    ALTER TABLE agent_book.workflow_run ADD FOREIGN KEY(workflow_run_id,current_candidate_id) REFERENCES agent_book.candidate_version(workflow_run_id,candidate_version_id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE agent_book.workflow_candidate_selection_history (
      selection_id uuid PRIMARY KEY,workflow_run_id uuid NOT NULL REFERENCES agent_book.workflow_run,
      selection_version bigint NOT NULL CHECK(selection_version>=0),previous_selection_version bigint,candidate_version_id uuid,
      action text NOT NULL CHECK(action IN ('initialized','selected')),selected_by uuid NOT NULL REFERENCES agent_book.actor_principal,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((selection_version=0 AND action='initialized' AND previous_selection_version IS NULL AND candidate_version_id IS NULL)
        OR(selection_version>0 AND action='selected' AND previous_selection_version=selection_version-1 AND previous_selection_version IS NOT NULL AND candidate_version_id IS NOT NULL)),
      UNIQUE(workflow_run_id,selection_version),UNIQUE(workflow_run_id,selection_version,candidate_version_id),
      FOREIGN KEY(workflow_run_id,candidate_version_id) REFERENCES agent_book.candidate_version(workflow_run_id,candidate_version_id),
      FOREIGN KEY(workflow_run_id,previous_selection_version) REFERENCES agent_book.workflow_candidate_selection_history(workflow_run_id,selection_version));
    CREATE TABLE agent_book.manual_workflow_request (
      request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,
      operation text NOT NULL,scope_id uuid NOT NULL,request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,result jsonb NOT NULL,
      UNIQUE(actor_id,novel_id,operation,scope_id,request_key));
    CREATE TABLE agent_book.manual_workflow_audit (
      audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,task_version_id uuid,
      workflow_run_id uuid,operation text NOT NULL,decision text NOT NULL CHECK(decision IN ('allow','deny')),
      resource_type text NOT NULL CHECK(resource_type IN ('none','grant','workflow','candidate','selection')),
      resource_grant_id uuid REFERENCES agent_book.manual_writing_grant,resource_workflow_id uuid REFERENCES agent_book.workflow_run,
      resource_candidate_id uuid REFERENCES agent_book.candidate_version,resource_selection_id uuid REFERENCES agent_book.workflow_candidate_selection_history,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),
      FOREIGN KEY(workflow_run_id) REFERENCES agent_book.workflow_run,
      CHECK((resource_type='none' AND num_nonnulls(resource_grant_id,resource_workflow_id,resource_candidate_id,resource_selection_id)=0)
        OR(resource_type<>'none' AND num_nonnulls(resource_grant_id,resource_workflow_id,resource_candidate_id,resource_selection_id)=1
          AND CASE resource_type WHEN 'grant' THEN resource_grant_id IS NOT NULL WHEN 'workflow' THEN resource_workflow_id IS NOT NULL WHEN 'candidate' THEN resource_candidate_id IS NOT NULL WHEN 'selection' THEN resource_selection_id IS NOT NULL ELSE false END)));
  `);
  fn('_wf_grant_live','g uuid,a uuid,n uuid,t uuid','boolean',`DECLARE at_time timestamptz:=clock_timestamp(); BEGIN
    RETURN EXISTS(SELECT 1 FROM manual_writing_grant w WHERE w.writing_grant_id=g AND w.writer_actor_id=a AND w.novel_id=n AND w.task_version_id=t
      AND w.capability_set='manual_workflow_v1' AND w.effective_at<=at_time AND(w.expires_at IS NULL OR at_time<w.expires_at)
      AND NOT EXISTS(SELECT 1 FROM manual_writing_revocation r WHERE r.writing_grant_id=g)
      AND _ctx_grant_live(w.context_grant_id,a,n,t));END;`);
  fn('_wf_live','w workflow_run','boolean',`SELECT w.writer_actor_id=_caller() AND _wf_grant_live(w.writing_grant_id,_caller(),w.novel_id,w.task_version_id)
    AND EXISTS(SELECT 1 FROM context_bundle b WHERE b.context_bundle_id=w.context_bundle_id AND b.context_grant_id=w.context_grant_id AND b.revision_id=w.revision_id AND _ctx_bundle_live(b))`,'sql');
  fn('_wf_grant_id_guard','','trigger',`DECLARE id uuid; BEGIN
    PERFORM _lock_authorization();id:=(to_jsonb(NEW)->>TG_ARGV[0])::uuid;
    IF (TG_TABLE_NAME<>'capability_grant' AND EXISTS(SELECT 1 FROM capability_grant WHERE grant_id=id))
      OR(TG_TABLE_NAME<>'context_grant' AND EXISTS(SELECT 1 FROM context_grant WHERE context_grant_id=id))
      OR(TG_TABLE_NAME<>'manual_writing_grant' AND EXISTS(SELECT 1 FROM manual_writing_grant WHERE writing_grant_id=id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GRANT_ID_AMBIGUOUS';END IF;RETURN NEW;END;`);
  fn('_wf_input_guard','','trigger',`BEGIN
    IF TG_OP<>'UPDATE' OR (to_jsonb(NEW)-ARRAY['current_candidate_id','current_selection_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_candidate_id','current_selection_version'])
      OR NEW.current_selection_version<>OLD.current_selection_version+1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='WORKFLOW_INPUT_IMMUTABLE';END IF;RETURN NEW;END;`);
  fn('_wf_body_valid','body text','boolean',`SELECT body IS NOT NULL AND octet_length(convert_to(body,'UTF8')) BETWEEN 1 AND 262144
    AND body !~ ('['||chr(1)||'-'||chr(8)||chr(11)||chr(12)||chr(14)||'-'||chr(31)||chr(127)||'-'||chr(159)||']')
    AND length(regexp_replace(body,'[[:space:]   -     　﻿]','','g'))>0`,'sql');
  fn('_wf_candidate_guard','','trigger',`BEGIN
    IF NOT _wf_body_valid(NEW.body_text) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='BODY_INVALID';END IF;
    NEW.body_hash:=encode(sha256(convert_to(NEW.body_text,'UTF8')),'hex');NEW.body_bytes:=octet_length(convert_to(NEW.body_text,'UTF8'));RETURN NEW;END;`);
  fn('_wf_input_insert','','trigger',`BEGIN
    IF NOT EXISTS(SELECT 1 FROM context_bundle b WHERE b.context_bundle_id=NEW.context_bundle_id AND b.context_grant_id=NEW.context_grant_id AND b.revision_id=NEW.revision_id)
      OR NEW.current_candidate_id IS NOT NULL OR NEW.current_selection_version<>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='WORKFLOW_INPUT_INVALID';END IF;RETURN NEW;END;`);
  // Deferred checks protect both ordinary pointer DML and incomplete selection history at COMMIT.
  fn('_wf_selection_complete','','trigger',`DECLARE w workflow_run; last_row workflow_candidate_selection_history; target uuid; total bigint;BEGIN
    target:=NEW.workflow_run_id;SELECT * INTO STRICT w FROM workflow_run WHERE workflow_run_id=target;
    SELECT * INTO last_row FROM workflow_candidate_selection_history WHERE workflow_run_id=target ORDER BY selection_version DESC LIMIT 1;
    SELECT count(*) INTO total FROM workflow_candidate_selection_history WHERE workflow_run_id=target;
    IF last_row.selection_id IS NULL OR last_row.selection_version<>w.current_selection_version OR last_row.candidate_version_id IS DISTINCT FROM w.current_candidate_id
      OR total<>w.current_selection_version+1 OR EXISTS(SELECT 1 FROM workflow_candidate_selection_history WHERE workflow_run_id=target AND selected_by<>w.writer_actor_id)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='SELECTION_INCOMPLETE';END IF;RETURN NULL;END;`);
  fn('_wf_audit','id uuid,op text,n uuid,t uuid,w uuid,allowed boolean,kind text,resource uuid','void',`INSERT INTO manual_workflow_audit VALUES(id,_caller(),n,t,w,op,CASE WHEN allowed THEN 'allow' ELSE 'deny' END,kind,
    CASE WHEN kind='grant' THEN resource END,CASE WHEN kind='workflow' THEN resource END,CASE WHEN kind='candidate' THEN resource END,CASE WHEN kind='selection' THEN resource END,clock_timestamp())`,'sql');
  fn('_wf_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'task_version_id',a.task_version_id,'workflow_ref',a.workflow_run_id,
    'operation',a.operation,'decision',a.decision,'resource_type',a.resource_type,'resource_id',coalesce(a.resource_grant_id,a.resource_workflow_id,a.resource_candidate_id,a.resource_selection_id),'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]')
    FROM manual_workflow_audit a WHERE a.novel_id=n
      AND(a.task_version_id IS NULL OR EXISTS(SELECT 1 FROM scene_task_version v WHERE v.novel_id=n AND v.scene_task_version_id=a.task_version_id))
      AND(a.workflow_run_id IS NULL OR EXISTS(SELECT 1 FROM workflow_run w WHERE w.novel_id=n AND w.task_version_id=a.task_version_id AND w.workflow_run_id=a.workflow_run_id))
      AND CASE a.resource_type WHEN 'none' THEN true
        WHEN 'grant' THEN a.workflow_run_id IS NULL AND EXISTS(SELECT 1 FROM manual_writing_grant g WHERE g.writing_grant_id=a.resource_grant_id AND g.novel_id=n AND g.task_version_id=a.task_version_id)
        WHEN 'workflow' THEN EXISTS(SELECT 1 FROM workflow_run w WHERE w.workflow_run_id=a.resource_workflow_id AND w.workflow_run_id=a.workflow_run_id AND w.novel_id=n AND w.task_version_id=a.task_version_id)
        WHEN 'candidate' THEN EXISTS(SELECT 1 FROM candidate_version c JOIN workflow_run w USING(workflow_run_id) WHERE c.candidate_version_id=a.resource_candidate_id AND w.workflow_run_id=a.workflow_run_id AND w.novel_id=n AND w.task_version_id=a.task_version_id AND c.novel_id=n AND c.task_version_id=a.task_version_id AND c.context_bundle_id=w.context_bundle_id AND c.writer_actor_id=w.writer_actor_id)
        WHEN 'selection' THEN EXISTS(SELECT 1 FROM workflow_candidate_selection_history h JOIN workflow_run w USING(workflow_run_id) LEFT JOIN candidate_version c ON c.candidate_version_id=h.candidate_version_id WHERE h.selection_id=a.resource_selection_id AND w.workflow_run_id=a.workflow_run_id AND w.novel_id=n AND w.task_version_id=a.task_version_id AND(h.selection_version=0 OR c.workflow_run_id=w.workflow_run_id)) ELSE false END`,'sql');
  fn('_wf_history','w workflow_run,restricted boolean','jsonb',`SELECT jsonb_build_object('ok',true,'workflow_ref',w.workflow_run_id,'execution_mode',w.execution_mode,'current_candidate_ref',w.current_candidate_id,'selection_version',w.current_selection_version,
    'candidates',(SELECT coalesce(jsonb_agg(jsonb_build_object('candidate_ref',c.candidate_version_id,'previous_candidate_ref',c.previous_candidate_id,'origin',c.origin,'body',c.body_text,'body_hash',c.body_hash,'body_bytes',c.body_bytes,'text_protocol',c.text_protocol) ORDER BY c.created_at,c.candidate_version_id),'[]') FROM candidate_version c WHERE c.workflow_run_id=w.workflow_run_id),
    'selections',(SELECT coalesce(jsonb_agg(jsonb_build_object('selection_ref',h.selection_id,'selection_version',h.selection_version,'candidate_ref',h.candidate_version_id,'action',h.action) ORDER BY h.selection_version),'[]') FROM workflow_candidate_selection_history h WHERE h.workflow_run_id=w.workflow_run_id))
    ||CASE WHEN restricted THEN jsonb_build_object('input',to_jsonb(w),'bundle_ref',(SELECT public_bundle_ref FROM context_bundle WHERE context_bundle_id=w.context_bundle_id),'writing_authorization',(SELECT to_jsonb(g) FROM manual_writing_grant g WHERE g.writing_grant_id=w.writing_grant_id)) ELSE '{}'::jsonb END`,'sql');
  fn('_wf_grant_create','n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE cg context_grant;s context_task_scope;cutoff timestamptz;at_time timestamptz;support_count integer;requested timestamptz;BEGIN
    IF NOT _exact_keys(p,ARRAY['request_key','context_grant_id','expires_at']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
    SELECT * INTO cg FROM context_grant WHERE context_grant_id=(p->>'context_grant_id')::uuid;SELECT * INTO s FROM context_task_scope WHERE context_scope_id=cg.context_scope_id;
    IF s.novel_id IS DISTINCT FROM n OR NOT _ctx_grant_live(cg.context_grant_id,s.writer_actor_id,n,s.task_version_id) OR NOT _ctx_task_current(n,s.task_version_id) THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=s.task_version_id) FOR UPDATE;
    at_time:=clock_timestamp();
    SELECT count(*),min(g.expires_at) INTO support_count,cutoff FROM capability_grant g JOIN capability c USING(capability_id) JOIN data_scope d USING(data_scope_id)
      WHERE g.actor_id=_caller() AND d.novel_id=n AND c.capability_key IN ('design.read','design.freeze','task.read','task.create') AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at)
        AND NOT EXISTS(SELECT 1 FROM grant_revocation r WHERE r.grant_id=g.grant_id);
    IF support_count<>4 OR cg.effective_at>at_time OR(cg.expires_at IS NOT NULL AND cg.expires_at<=at_time) THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    cutoff:=least(cutoff,cg.expires_at);requested:=(p->>'expires_at')::timestamptz;cutoff:=least(cutoff,requested);
    IF cutoff IS NOT NULL AND cutoff<=clock_timestamp() THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    INSERT INTO manual_writing_grant VALUES(ids[1],cg.context_grant_id,s.context_scope_id,n,s.task_version_id,s.writer_actor_id,'manual_workflow_v1',_caller(),at_time,cutoff);
    RETURN jsonb_build_object('ok',true,'grant_id',ids[1]);END;`);
  fn('_wf_write','op text,n uuid,p jsonb,w workflow_run,b context_bundle,g uuid,ids uuid[]','jsonb',`DECLARE v scene_task_version;c candidate_version;next_version bigint;BEGIN
    IF op='workflow:create' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','writing_grant_id','bundle_ref','execution_mode']) OR p->>'execution_mode' IS DISTINCT FROM 'manual_input_v1' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      SELECT * INTO STRICT v FROM scene_task_version WHERE scene_task_version_id=b.task_version_id;
      INSERT INTO workflow_run VALUES(ids[1],n,v.scene_id,v.scene_task_version_id,v.author_design_revision_id,v.viewpoint_entity_id,_caller(),b.context_bundle_id,b.context_grant_id,g,'manual_input_v1',0,NULL,0,_caller(),clock_timestamp());
      INSERT INTO workflow_candidate_selection_history VALUES(ids[2],ids[1],0,NULL,NULL,'initialized',_caller(),clock_timestamp());
      RETURN jsonb_build_object('ok',true,'workflow_ref',ids[1],'selection_version',0);
    ELSIF op IN ('candidate:input','candidate:edit') THEN
      IF NOT _exact_keys(p,CASE WHEN op='candidate:input' THEN ARRAY['request_key','workflow_ref','body'] ELSE ARRAY['request_key','workflow_ref','previous_candidate_ref','body'] END)
        OR jsonb_typeof(p->'body') IS DISTINCT FROM 'string' OR NOT _wf_body_valid(p->>'body') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      IF op='candidate:edit' AND NOT EXISTS(SELECT 1 FROM candidate_version WHERE workflow_run_id=w.workflow_run_id AND candidate_version_id=(p->>'previous_candidate_ref')::uuid) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      INSERT INTO candidate_version VALUES(ids[1],w.workflow_run_id,n,w.task_version_id,_caller(),w.context_bundle_id,(p->>'previous_candidate_ref')::uuid,CASE WHEN op='candidate:input' THEN 'human_input' ELSE 'human_edit' END,p->>'body','computed',0,'exact-utf8-v1',_caller(),clock_timestamp()) RETURNING * INTO c;
      RETURN jsonb_build_object('ok',true,'candidate_ref',c.candidate_version_id,'previous_candidate_ref',c.previous_candidate_id,'body',c.body_text,'body_hash',c.body_hash,'body_bytes',c.body_bytes,'text_protocol',c.text_protocol,'origin',c.origin);
    ELSIF op='candidate:select' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref','candidate_ref','expected_selection_version']) OR jsonb_typeof(p->'expected_selection_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      IF NOT EXISTS(SELECT 1 FROM candidate_version WHERE workflow_run_id=w.workflow_run_id AND candidate_version_id=(p->>'candidate_ref')::uuid) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      IF w.current_selection_version<>(p->>'expected_selection_version')::bigint THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT');END IF;
      next_version:=w.current_selection_version+1;
      INSERT INTO workflow_candidate_selection_history VALUES(ids[1],w.workflow_run_id,next_version,w.current_selection_version,(p->>'candidate_ref')::uuid,'selected',_caller(),clock_timestamp());
      UPDATE workflow_run SET current_candidate_id=(p->>'candidate_ref')::uuid,current_selection_version=next_version WHERE workflow_run_id=w.workflow_run_id;
      RETURN jsonb_build_object('ok',true,'selection_ref',ids[1],'selection_version',next_version,'candidate_ref',(p->>'candidate_ref')::uuid);
    END IF;RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END;`);
  fn('api_manual_workflow','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE w workflow_run;b context_bundle;g uuid;t uuid;scope uuid;permitted boolean:=false;prior manual_workflow_request;digest text;result jsonb;typ text:='none';resource uuid;BEGIN
    PERFORM _lock_authorization();
    IF op='writing-grant:create' THEN permitted:=_ctx_manage(_caller(),n);
    ELSIF op='workflow:trace' THEN permitted:=_has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n);
    ELSIF op='workflow:audit' THEN permitted:=_has_capability(_caller(),'audit.read',n);
    ELSIF op IN ('workflow:create','candidate:input','candidate:edit','candidate:select','workflow:read') THEN
      IF op='workflow:create' THEN
        SELECT * INTO b FROM context_bundle WHERE novel_id=n AND public_bundle_ref=(p->>'bundle_ref')::uuid;g:=(p->>'writing_grant_id')::uuid;t:=b.task_version_id;
        permitted:=_wf_grant_live(g,_caller(),n,t) AND _ctx_bundle_live(b) AND EXISTS(SELECT 1 FROM manual_writing_grant WHERE writing_grant_id=g AND context_grant_id=b.context_grant_id);
      ELSE
        SELECT * INTO w FROM workflow_run WHERE novel_id=n AND workflow_run_id=(p->>'workflow_ref')::uuid;t:=w.task_version_id;permitted:=_wf_live(w);
      END IF;
    ELSE RETURN jsonb_build_object('ok',false,'error','UNSUPPORTED_OPERATION');END IF;
    IF NOT coalesce(permitted,false) THEN
      PERFORM _wf_audit(audit,op,(SELECT novel_id FROM novel WHERE novel_id=n),NULL,NULL,false,'none',NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    PERFORM 1 FROM novel WHERE novel_id=n FOR UPDATE;
    IF t IS NOT NULL THEN PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=t) FOR UPDATE;END IF;
    IF w.workflow_run_id IS NOT NULL THEN SELECT * INTO w FROM workflow_run WHERE workflow_run_id=w.workflow_run_id FOR UPDATE;END IF;
    BEGIN
      IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR cardinality(ids)<>16 OR array_position(ids,NULL) IS NOT NULL OR octet_length(p::text)>1800000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      IF op IN ('workflow:read','workflow:trace') THEN
        IF NOT _exact_keys(p,ARRAY['workflow_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
        IF op='workflow:trace' THEN SELECT * INTO w FROM workflow_run WHERE novel_id=n AND workflow_run_id=(p->>'workflow_ref')::uuid;END IF;
        IF w.workflow_run_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');ELSE result:=_wf_history(w,op='workflow:trace');typ:='workflow';resource:=w.workflow_run_id;t:=w.task_version_id;END IF;
      ELSIF op='workflow:audit' THEN
        IF p<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;result:=jsonb_build_object('ok',true,'events',_wf_events(n));
      ELSE
        IF jsonb_typeof(p->'request_key') IS DISTINCT FROM 'string' OR length(p->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
        scope:=CASE op WHEN 'workflow:create' THEN b.task_version_id WHEN 'writing-grant:create' THEN (p->>'context_grant_id')::uuid ELSE w.workflow_run_id END;
        digest:=encode(sha256(convert_to('manual-request-v1:'||op||':'||n::text||':'||p::text,'UTF8')),'hex');
        SELECT * INTO prior FROM manual_workflow_request WHERE actor_id=_caller() AND novel_id=n AND operation=op AND scope_id=scope AND request_key=p->>'request_key';
        IF prior.request_id IS NOT NULL THEN
          IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');ELSE result:=prior.result;END IF;
        ELSE
          IF op='writing-grant:create' THEN result:=_wf_grant_create(n,p,ids);ELSE result:=_wf_write(op,n,p,w,b,g,ids);END IF;
          IF (result->>'ok')::boolean THEN INSERT INTO manual_workflow_request VALUES(ids[16],_caller(),n,op,scope,p->>'request_key',digest,result);END IF;
        END IF;
        IF (result->>'ok')::boolean THEN
          IF op='writing-grant:create' THEN typ:='grant';resource:=(result->>'grant_id')::uuid;SELECT task_version_id INTO t FROM manual_writing_grant WHERE writing_grant_id=resource;
          ELSIF op='workflow:create' THEN typ:='workflow';resource:=(result->>'workflow_ref')::uuid;SELECT * INTO w FROM workflow_run WHERE workflow_run_id=resource;
          ELSIF op IN ('candidate:input','candidate:edit') THEN typ:='candidate';resource:=(result->>'candidate_ref')::uuid;
          ELSE typ:='selection';resource:=(result->>'selection_ref')::uuid;END IF;
        END IF;
      END IF;
    EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');typ:='none';resource:=NULL;
    END;
    PERFORM _wf_audit(audit,op,n,t,w.workflow_run_id,(result->>'ok')::boolean,typ,resource);RETURN result;END;`);
  // Preserve the old public revoke implementation under a private name; the new dispatcher handles only its new fixed grant type.
  sql('ALTER FUNCTION agent_book.api_revoke_grant(uuid,uuid) RENAME TO _revoke_pre_manual;REVOKE ALL ON FUNCTION agent_book._revoke_pre_manual(uuid,uuid) FROM PUBLIC;');
  fn('api_revoke_grant','p_grant uuid,p_audit uuid','jsonb',`DECLARE g manual_writing_grant;BEGIN
    PERFORM _lock_authorization();SELECT * INTO g FROM manual_writing_grant WHERE writing_grant_id=p_grant;
    IF g.writing_grant_id IS NULL THEN RETURN _revoke_pre_manual(p_grant,p_audit);END IF;
    IF NOT _ctx_manage(_caller(),g.novel_id) OR NOT _has_capability(_caller(),'grant.revoke',g.novel_id) THEN
      PERFORM _wf_audit(p_audit,'grant.revoke',g.novel_id,NULL,NULL,false,'none',NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    INSERT INTO manual_writing_revocation VALUES(p_audit,p_grant,_caller(),clock_timestamp()) ON CONFLICT(writing_grant_id) DO NOTHING;
    PERFORM _wf_audit(p_audit,'grant.revoke',g.novel_id,g.task_version_id,NULL,true,'grant',p_grant);RETURN jsonb_build_object('ok',true,'status','revoked');END;`);
  sql(`ALTER FUNCTION agent_book.api_read_audit(uuid,uuid) RENAME TO _read_audit_pre_manual;REVOKE ALL ON FUNCTION agent_book._read_audit_pre_manual(uuid,uuid) FROM PUBLIC;`);
  fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE result jsonb;BEGIN
    result:=_read_audit_pre_manual(p_novel,p_audit);IF (result->>'ok')::boolean THEN RETURN jsonb_set(result,'{events}',(result->'events')||_wf_events(p_novel));END IF;RETURN result;END;`);
  for(const table of ['manual_writing_grant','manual_writing_revocation','candidate_version','workflow_candidate_selection_history','manual_workflow_request','manual_workflow_audit'])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  sql(`CREATE TRIGGER workflow_input_guard BEFORE UPDATE OR DELETE ON agent_book.workflow_run FOR EACH ROW EXECUTE FUNCTION agent_book._wf_input_guard();
    CREATE TRIGGER workflow_truncate BEFORE TRUNCATE ON agent_book.workflow_run FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();
    CREATE TRIGGER workflow_insert BEFORE INSERT ON agent_book.workflow_run FOR EACH ROW EXECUTE FUNCTION agent_book._wf_input_insert();
    CREATE TRIGGER candidate_body_guard BEFORE INSERT ON agent_book.candidate_version FOR EACH ROW EXECUTE FUNCTION agent_book._wf_candidate_guard();
    CREATE TRIGGER writing_revocation_guard BEFORE INSERT ON agent_book.manual_writing_revocation FOR EACH ROW EXECUTE FUNCTION agent_book._guard_revocation();`);
  for(const [table,col]of [['capability_grant','grant_id'],['context_grant','context_grant_id'],['manual_writing_grant','writing_grant_id']])sql(`CREATE TRIGGER manual_grant_identity BEFORE INSERT ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._wf_grant_id_guard('${col}');`);
  for(const table of ['workflow_run','workflow_candidate_selection_history'])sql(`CREATE CONSTRAINT TRIGGER workflow_selection_complete AFTER INSERT OR UPDATE ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._wf_selection_complete();`);
  sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
    DO $acl$ DECLARE login record;BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION agent_book._revoke_pre_manual(uuid,uuid),agent_book._read_audit_pre_manual(uuid,uuid) FROM %I',login.db_login);
      IF login.role_key IN ('author','writer','auditor') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_manual_workflow(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);END IF;
      IF login.role_key='author' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_revoke_grant(uuid,uuid) TO %I',login.db_login);END IF;
      IF login.role_key='auditor' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_read_audit(uuid,uuid) TO %I',login.db_login);END IF;
    END LOOP;END $acl$;`);
}
export async function down(){throw new Error('Use an explicit reviewed forward migration');}
