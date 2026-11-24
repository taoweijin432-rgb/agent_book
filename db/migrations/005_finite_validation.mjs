// Finite deterministic validation only. Execution is attributed to the real author, never a validator impersonation.
export async function up(pgm){
  const sql=s=>pgm.sql(s);
  const fn=(name,args,type,body,lang='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${type} LANGUAGE ${lang} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $f$ ${body} $f$;`);
  sql(`ALTER TABLE agent_book.workflow_candidate_selection_history ADD UNIQUE(workflow_run_id,selection_id,selection_version,candidate_version_id);
    CREATE TABLE agent_book.validation_policy_release (
      release_id uuid PRIMARY KEY,novel_id uuid NOT NULL REFERENCES agent_book.novel,generation bigint NOT NULL CHECK(generation>0),previous_release_id uuid,
      implementation_version text NOT NULL CHECK(implementation_version='finite-validator-v1'),ruleset_version text NOT NULL CHECK(ruleset_version='finite-rules-v1'),
      policy_version text NOT NULL CHECK(policy_version='finite-validation-v1'),review_max_bytes integer NOT NULL CHECK(review_max_bytes=65536),
      content_hash text NOT NULL,issued_by uuid NOT NULL REFERENCES agent_book.actor_principal,issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((generation=1 AND previous_release_id IS NULL) OR(generation>1 AND previous_release_id IS NOT NULL)),
      UNIQUE(novel_id,generation),UNIQUE(novel_id,release_id),FOREIGN KEY(novel_id,previous_release_id) REFERENCES agent_book.validation_policy_release(novel_id,release_id));
    CREATE TABLE agent_book.validation_run (
      validation_run_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,task_version_id uuid NOT NULL,
      candidate_version_id uuid NOT NULL,candidate_content_hash text NOT NULL,selection_id uuid NOT NULL,selection_version bigint NOT NULL CHECK(selection_version>0),
      context_bundle_id uuid NOT NULL,bundle_payload_hash text NOT NULL,revision_id uuid NOT NULL,writer_actor_id uuid NOT NULL,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),release_id uuid NOT NULL,
      implementation_version text NOT NULL CHECK(implementation_version='finite-validator-v1'),digest_version text NOT NULL CHECK(digest_version='validation-jsonb-v1'),
      required_check_set jsonb NOT NULL,check_set_hash text NOT NULL,expected_checks integer NOT NULL CHECK(expected_checks>=6),
      overall text NOT NULL CHECK(overall IN ('passed','failed','unknown')),result_hash text NOT NULL,
      executed_by uuid NOT NULL REFERENCES agent_book.actor_principal,executed_at timestamptz NOT NULL,completed_at timestamptz NOT NULL CHECK(completed_at>=executed_at),
      FOREIGN KEY(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id) REFERENCES agent_book.workflow_run(workflow_run_id,novel_id,task_version_id,writer_actor_id,context_bundle_id),
      FOREIGN KEY(workflow_run_id,candidate_version_id) REFERENCES agent_book.candidate_version(workflow_run_id,candidate_version_id),
      FOREIGN KEY(workflow_run_id,selection_id,selection_version,candidate_version_id) REFERENCES agent_book.workflow_candidate_selection_history(workflow_run_id,selection_id,selection_version,candidate_version_id),
      FOREIGN KEY(context_bundle_id,novel_id,task_version_id,writer_actor_id) REFERENCES agent_book.context_bundle(context_bundle_id,novel_id,task_version_id,writer_actor_id),
      FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,release_id) REFERENCES agent_book.validation_policy_release(novel_id,release_id),
      UNIQUE(validation_run_id,novel_id,task_version_id,workflow_run_id),UNIQUE(validation_run_id,novel_id,revision_id));
    CREATE TABLE agent_book.validation_check (
      validation_check_id uuid PRIMARY KEY,validation_run_id uuid NOT NULL,novel_id uuid NOT NULL,revision_id uuid NOT NULL,
      position integer NOT NULL CHECK(position>0),check_key text NOT NULL,check_version text NOT NULL CHECK(check_version IN ('finite-check-v1','author-rule-unimplemented-v1')),
      required boolean NOT NULL,constraint_id uuid,outcome text NOT NULL CHECK(outcome IN ('passed','failed','unknown')),code text NOT NULL,
      FOREIGN KEY(validation_run_id,novel_id,revision_id) REFERENCES agent_book.validation_run(validation_run_id,novel_id,revision_id),
      FOREIGN KEY(novel_id,revision_id,constraint_id) REFERENCES agent_book.design_constraint(novel_id,revision_id,constraint_id),
      UNIQUE(validation_run_id,position),UNIQUE(validation_run_id,check_key));
    CREATE TABLE agent_book.validation_command_request (
      request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,
      operation text NOT NULL,scope_id uuid NOT NULL,request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,
      resource_run_id uuid REFERENCES agent_book.validation_run,resource_release_id uuid REFERENCES agent_book.validation_policy_release,
      CHECK(num_nonnulls(resource_run_id,resource_release_id)=1),UNIQUE(actor_id,novel_id,operation,scope_id,request_key));
    CREATE TABLE agent_book.validation_access_audit (
      audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,task_version_id uuid,workflow_run_id uuid,
      operation text NOT NULL,decision text NOT NULL CHECK(decision IN ('allow','deny')),resource_type text NOT NULL CHECK(resource_type IN ('none','run','release')),
      resource_run_id uuid REFERENCES agent_book.validation_run,resource_release_id uuid REFERENCES agent_book.validation_policy_release,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),FOREIGN KEY(workflow_run_id) REFERENCES agent_book.workflow_run,
      CHECK((resource_type='none' AND resource_run_id IS NULL AND resource_release_id IS NULL)
        OR(resource_type='run' AND resource_run_id IS NOT NULL AND resource_release_id IS NULL)
        OR(resource_type='release' AND resource_run_id IS NULL AND resource_release_id IS NOT NULL)));
  `);
  fn('_val_hash','kind text,p jsonb','text',`SELECT encode(sha256(convert_to('validation-jsonb-v1:'||kind||E'\\n'||p::text,'UTF8')),'hex')`,'sql');
  fn('_val_policy','n uuid','uuid',`SELECT release_id FROM validation_policy_release WHERE novel_id=n ORDER BY generation DESC LIMIT 1`,'sql');
  fn('_val_policy_guard','','trigger',`BEGIN
    IF NEW.generation>1 AND NOT EXISTS(SELECT 1 FROM validation_policy_release WHERE novel_id=NEW.novel_id AND release_id=NEW.previous_release_id AND generation=NEW.generation-1) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='POLICY_PREDECESSOR_INVALID';END IF;
    NEW.content_hash:=_val_hash('policy',jsonb_build_object('implementation','finite-validator-v1','ruleset','finite-rules-v1','policy','finite-validation-v1','review_max_bytes',65536));RETURN NEW;END;`);
  // Evaluate the *actual writer*. This does not use _caller() or assume the caller is the writer.
  fn('_val_writer_at','w workflow_run,at_time timestamptz','boolean',`SELECT EXISTS(SELECT 1 FROM manual_writing_grant g JOIN context_grant cg USING(context_grant_id,context_scope_id)
    JOIN context_task_scope s USING(context_scope_id) JOIN actor_principal a ON a.actor_id=s.writer_actor_id JOIN execution_role role ON role.role_id=s.writer_role_id
    WHERE g.writing_grant_id=w.writing_grant_id AND g.context_grant_id=w.context_grant_id AND g.novel_id=w.novel_id AND g.task_version_id=w.task_version_id AND g.writer_actor_id=w.writer_actor_id
      AND s.novel_id=w.novel_id AND s.task_version_id=w.task_version_id AND s.writer_actor_id=w.writer_actor_id AND s.scene_id=w.scene_id AND s.viewpoint_entity_id=w.viewpoint_entity_id AND s.revision_id=w.revision_id
      AND s.format_version='context-task-scope-v1' AND g.capability_set='manual_workflow_v1' AND cg.capability_set='compile_and_read_v1'
      AND a.status='active' AND role.role_key='writer' AND role.status='active'
      AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at) AND cg.effective_at<=at_time AND(cg.expires_at IS NULL OR at_time<cg.expires_at)
      AND NOT EXISTS(SELECT 1 FROM manual_writing_revocation r WHERE r.writing_grant_id=g.writing_grant_id AND r.revoked_at<=at_time)
      AND NOT EXISTS(SELECT 1 FROM context_grant_revocation r WHERE r.context_grant_id=cg.context_grant_id AND r.revoked_at<=at_time))`,'sql');
  fn('_val_inputs_current','w workflow_run','boolean',`SELECT _ctx_task_current(w.novel_id,w.task_version_id)
    AND EXISTS(SELECT 1 FROM context_bundle b WHERE b.context_bundle_id=w.context_bundle_id AND b.novel_id=w.novel_id AND b.task_version_id=w.task_version_id AND b.revision_id=w.revision_id AND b.writer_actor_id=w.writer_actor_id AND b.context_grant_id=w.context_grant_id
      AND b.policy_release_id=_ctx_policy(w.task_version_id) AND NOT EXISTS(SELECT 1 FROM unnest(b.publication_ids) p WHERE NOT _ctx_publication_live(p)))`,'sql');
  fn('_val_constraints','w workflow_run','TABLE(constraint_id uuid,severity text)',`SELECT c.constraint_id,c.severity FROM design_constraint c WHERE c.novel_id=w.novel_id AND c.revision_id=w.revision_id
    AND(c.scope_kind='novel' OR c.scene_id=w.scene_id OR c.character_entity_id=w.viewpoint_entity_id OR EXISTS(SELECT 1 FROM task_constraint_ref r WHERE r.scene_task_version_id=w.task_version_id AND r.constraint_id=c.constraint_id))`,'sql');
  fn('_val_expected','w_id uuid,c_id uuid,h_id uuid,at_time timestamptz','TABLE("position" integer,check_key text,check_version text,required boolean,constraint_id uuid,outcome text,code text)',`DECLARE w workflow_run;c candidate_version;b context_bundle;v scene_task_version;BEGIN
    SELECT * INTO STRICT w FROM workflow_run WHERE workflow_run_id=w_id;SELECT * INTO STRICT c FROM candidate_version WHERE candidate_version_id=c_id;SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=w.context_bundle_id;SELECT * INTO STRICT v FROM scene_task_version WHERE scene_task_version_id=w.task_version_id;
    RETURN QUERY SELECT x.pos,x.key,'finite-check-v1',true,NULL::uuid,CASE WHEN x.valid THEN 'passed' ELSE 'failed' END,CASE WHEN x.valid THEN 'CHECK_PASSED' ELSE x.problem END FROM (VALUES
      (1,'selection_binding',EXISTS(SELECT 1 FROM workflow_candidate_selection_history h WHERE h.selection_id=h_id AND h.workflow_run_id=w_id AND h.candidate_version_id=c_id),'SELECTION_BINDING_INVALID'),
      (2,'body_protocol',c.text_protocol='exact-utf8-v1' AND _wf_body_valid(c.body_text) AND c.body_hash=encode(sha256(convert_to(c.body_text,'UTF8')),'hex') AND c.body_bytes=octet_length(convert_to(c.body_text,'UTF8')),'BODY_INTEGRITY_INVALID'),
      (3,'input_bindings',c.workflow_run_id=w_id AND c.novel_id=w.novel_id AND c.task_version_id=w.task_version_id AND c.context_bundle_id=w.context_bundle_id AND c.writer_actor_id=w.writer_actor_id AND b.revision_id=w.revision_id AND b.task_version_id=v.scene_task_version_id AND b.novel_id=w.novel_id AND b.writer_actor_id=w.writer_actor_id AND v.author_design_revision_id=w.revision_id AND v.input_canon_watermark=0 AND w.input_canon_watermark=0 AND b.input_canon_watermark=0,'INPUT_BINDING_INVALID'),
      (4,'writer_authorization',_val_writer_at(w,at_time) AND _val_inputs_current(w),'WRITER_INPUT_INVALID'),
      (5,'bundle_payload',b.payload_hash=encode(sha256(convert_to(b.payload_text,'UTF8')),'hex') AND b.used_bytes=octet_length(convert_to(b.payload_text,'UTF8')),'BUNDLE_INTEGRITY_INVALID'),
      (6,'review_bytes',octet_length(convert_to(c.body_text,'UTF8'))<=65536,'REVIEW_BYTE_LIMIT')) x(pos,key,valid,problem);
    RETURN QUERY SELECT 6+row_number() OVER(ORDER BY q.constraint_id)::integer,'rule:'||q.constraint_id::text,'author-rule-unimplemented-v1',q.severity='hard',q.constraint_id,'unknown',CASE WHEN q.severity='hard' THEN 'RULE_UNSUPPORTED' ELSE 'RULE_NOT_CHECKED' END FROM _val_constraints(w) q;
  END;`);
  fn('_val_set','p_rows jsonb','jsonb',`SELECT coalesce(jsonb_agg(value-ARRAY['outcome','code'] ORDER BY (value->>'position')::integer),'[]') FROM jsonb_array_elements(p_rows)`,'sql');
  fn('_val_overall','p_rows jsonb','text',`SELECT CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE (x->>'required')::boolean AND x->>'outcome'='failed') THEN 'failed'
    WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE (x->>'required')::boolean AND x->>'outcome'='unknown') THEN 'unknown'
    WHEN jsonb_array_length(p_rows)>=6 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x WHERE (x->>'required')::boolean AND x->>'outcome' IS DISTINCT FROM 'passed') THEN 'passed' ELSE 'unknown' END`,'sql');
  fn('_val_complete','','trigger',`DECLARE id uuid;r validation_run;c candidate_version;w workflow_run;b context_bundle;actual jsonb;expected jsonb;defs jsonb;BEGIN
    id:=NEW.validation_run_id;SELECT * INTO STRICT r FROM validation_run WHERE validation_run_id=id;SELECT * INTO STRICT c FROM candidate_version WHERE candidate_version_id=r.candidate_version_id;SELECT * INTO STRICT w FROM workflow_run WHERE workflow_run_id=r.workflow_run_id;SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=r.context_bundle_id;
    SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.position),'[]') INTO expected FROM _val_expected(r.workflow_run_id,r.candidate_version_id,r.selection_id,r.executed_at) e;
    SELECT coalesce(jsonb_agg(jsonb_build_object('position',d.position,'check_key',d.check_key,'check_version',d.check_version,'required',d.required,'constraint_id',d.constraint_id,'outcome',d.outcome,'code',d.code) ORDER BY d.position),'[]') INTO actual FROM validation_check d WHERE d.validation_run_id=id;
    defs:=_val_set(expected);
    IF actual IS DISTINCT FROM expected OR r.expected_checks<>jsonb_array_length(expected) OR r.required_check_set IS DISTINCT FROM defs OR r.check_set_hash<>_val_hash('check-set',defs) OR r.result_hash<>_val_hash('results',expected) OR r.overall<>_val_overall(expected)
      OR r.candidate_content_hash<>c.body_hash OR r.candidate_content_hash<>encode(sha256(convert_to(c.body_text,'UTF8')),'hex') OR r.bundle_payload_hash<>b.payload_hash OR r.bundle_payload_hash<>encode(sha256(convert_to(b.payload_text,'UTF8')),'hex')
      OR r.revision_id<>w.revision_id OR r.release_id IS DISTINCT FROM _val_policy(r.novel_id) OR r.executed_at>clock_timestamp() OR w.current_candidate_id IS DISTINCT FROM r.candidate_version_id OR w.current_selection_version<>r.selection_version OR NOT EXISTS(SELECT 1 FROM workflow_candidate_selection_history h WHERE h.selection_id=r.selection_id AND h.selection_version=r.selection_version AND h.workflow_run_id=r.workflow_run_id AND h.candidate_version_id=r.candidate_version_id)
      OR NOT EXISTS(SELECT 1 FROM actor_principal a JOIN actor_role ar USING(actor_id) JOIN execution_role role USING(role_id) WHERE a.actor_id=r.executed_by AND a.status='active' AND role.role_key='author')
      OR NOT EXISTS(SELECT 1 FROM validation_policy_release p WHERE p.release_id=r.release_id AND p.novel_id=r.novel_id AND p.implementation_version=r.implementation_version AND p.issued_at<=r.executed_at)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='VALIDATION_INCOMPLETE';END IF;RETURN NULL;END;`);
  // This unified predicate is the future approval integration point; result status is a separate mandatory gate.
  fn('_val_applicable','r validation_run','boolean',`SELECT EXISTS(SELECT 1 FROM workflow_run w JOIN candidate_version c ON c.candidate_version_id=r.candidate_version_id JOIN context_bundle b ON b.context_bundle_id=w.context_bundle_id
    WHERE w.workflow_run_id=r.workflow_run_id AND w.novel_id=r.novel_id AND w.task_version_id=r.task_version_id AND w.current_candidate_id=r.candidate_version_id AND w.current_selection_version=r.selection_version
      AND w.revision_id=r.revision_id AND w.context_bundle_id=r.context_bundle_id AND w.writer_actor_id=r.writer_actor_id AND c.workflow_run_id=w.workflow_run_id AND c.body_hash=r.candidate_content_hash AND c.body_hash=encode(sha256(convert_to(c.body_text,'UTF8')),'hex')
      AND b.payload_hash=r.bundle_payload_hash AND b.payload_hash=encode(sha256(convert_to(b.payload_text,'UTF8')),'hex') AND _val_policy(r.novel_id)=r.release_id
      AND _val_writer_at(w,clock_timestamp()) AND _val_inputs_current(w)
      AND EXISTS(SELECT 1 FROM workflow_candidate_selection_history h WHERE h.selection_id=r.selection_id AND h.workflow_run_id=w.workflow_run_id AND h.selection_version=w.current_selection_version AND h.candidate_version_id=w.current_candidate_id))`,'sql');
  fn('_val_audit','id uuid,op text,n uuid,t uuid,w uuid,allowed boolean,typ text,resource uuid','void',`INSERT INTO validation_access_audit VALUES(id,_caller(),n,t,w,op,CASE WHEN allowed THEN 'allow' ELSE 'deny' END,typ,CASE WHEN typ='run' THEN resource END,CASE WHEN typ='release' THEN resource END,clock_timestamp())`,'sql');
  fn('_val_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,'task_version_id',a.task_version_id,'workflow_ref',a.workflow_run_id,'resource_type',a.resource_type,'resource_id',coalesce(a.resource_run_id,a.resource_release_id),'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]') FROM validation_access_audit a
    WHERE a.novel_id=n AND(a.task_version_id IS NULL OR EXISTS(SELECT 1 FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=a.task_version_id))
      AND(a.workflow_run_id IS NULL OR EXISTS(SELECT 1 FROM workflow_run WHERE novel_id=n AND task_version_id=a.task_version_id AND workflow_run_id=a.workflow_run_id))
      AND CASE a.resource_type WHEN 'none' THEN true WHEN 'release' THEN a.task_version_id IS NULL AND a.workflow_run_id IS NULL AND EXISTS(SELECT 1 FROM validation_policy_release WHERE release_id=a.resource_release_id AND novel_id=n)
        WHEN 'run' THEN EXISTS(SELECT 1 FROM validation_run r JOIN workflow_run w USING(workflow_run_id) JOIN candidate_version c ON c.candidate_version_id=r.candidate_version_id JOIN workflow_candidate_selection_history h ON h.selection_id=r.selection_id JOIN context_bundle b ON b.context_bundle_id=r.context_bundle_id WHERE r.validation_run_id=a.resource_run_id AND r.novel_id=n AND w.novel_id=n AND r.task_version_id=a.task_version_id AND w.task_version_id=a.task_version_id AND r.workflow_run_id=a.workflow_run_id AND c.workflow_run_id=w.workflow_run_id AND c.task_version_id=w.task_version_id AND c.novel_id=n AND h.workflow_run_id=w.workflow_run_id AND h.candidate_version_id=c.candidate_version_id AND h.selection_version=r.selection_version AND b.novel_id=n AND b.task_version_id=w.task_version_id AND b.writer_actor_id=w.writer_actor_id AND r.revision_id=w.revision_id) ELSE false END`,'sql');
  fn('_val_record','w workflow_run,c candidate_version,h workflow_candidate_selection_history,policy uuid,ids uuid[]','uuid',`DECLARE at_time timestamptz:=clock_timestamp();p_rows jsonb;defs jsonb;b context_bundle;i integer:=0;e record;BEGIN
    SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=w.context_bundle_id;
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position) INTO p_rows FROM _val_expected(w.workflow_run_id,c.candidate_version_id,h.selection_id,at_time) x;defs:=_val_set(p_rows);
    IF jsonb_array_length(p_rows)>112 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CHECK_BUDGET_EXCEEDED';END IF;
    INSERT INTO validation_run VALUES(ids[1],w.novel_id,w.workflow_run_id,w.task_version_id,c.candidate_version_id,encode(sha256(convert_to(c.body_text,'UTF8')),'hex'),h.selection_id,h.selection_version,b.context_bundle_id,encode(sha256(convert_to(b.payload_text,'UTF8')),'hex'),w.revision_id,w.writer_actor_id,0,policy,'finite-validator-v1','validation-jsonb-v1',defs,_val_hash('check-set',defs),jsonb_array_length(p_rows),_val_overall(p_rows),_val_hash('results',p_rows),_caller(),at_time,clock_timestamp());
    FOR e IN SELECT * FROM jsonb_to_recordset(p_rows) AS x("position" integer,check_key text,check_version text,required boolean,constraint_id uuid,outcome text,code text) ORDER BY position LOOP
      i:=i+1;INSERT INTO validation_check VALUES(ids[8+i],ids[1],w.novel_id,w.revision_id,e.position,e.check_key,e.check_version,e.required,e.constraint_id,e.outcome,e.code);
    END LOOP;RETURN ids[1];END;`);
  fn('_val_response','r validation_run','jsonb',`SELECT jsonb_build_object('ok',true,'recorded',true,'validation_ref',r.validation_run_id,'overall',r.overall,'current_applicable',_val_applicable(r),'covered_checks_pass',r.overall='passed' AND _val_applicable(r),'approval_implemented',false)`,'sql');
  fn('api_finite_validation','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE w workflow_run;r validation_run;c candidate_version;h workflow_candidate_selection_history;prior validation_command_request;result jsonb;policy uuid;scope uuid;digest text;generation_no bigint;resource uuid;typ text:='none';t uuid;wid uuid;allowed boolean;BEGIN
    PERFORM _lock_authorization();
    allowed:=CASE WHEN op IN ('validation:run','validation-policy:publish') THEN _ctx_manage(_caller(),n)
      WHEN op IN ('validation:history','validation:current') THEN _has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n)
      WHEN op='validation:audit' THEN _has_capability(_caller(),'audit.read',n) ELSE false END;
    IF NOT coalesce(allowed,false) THEN PERFORM _val_audit(audit,op,(SELECT novel_id FROM novel WHERE novel_id=n),NULL,NULL,false,'none',NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
    PERFORM 1 FROM novel WHERE novel_id=n FOR UPDATE;
    BEGIN
      IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR cardinality(ids)<>128 OR array_position(ids,NULL) IS NOT NULL OR octet_length(p::text)>20000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
      IF op='validation:audit' THEN
        IF p<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;result:=jsonb_build_object('ok',true,'events',_val_events(n));
      ELSE
        IF op='validation:current' THEN SELECT * INTO r FROM validation_run WHERE validation_run_id=(p->>'validation_ref')::uuid AND novel_id=n;wid:=r.workflow_run_id;
        ELSIF op<>'validation-policy:publish' THEN wid:=(p->>'workflow_ref')::uuid;END IF;
        IF wid IS NOT NULL THEN
          SELECT * INTO w FROM workflow_run WHERE novel_id=n AND workflow_run_id=wid;t:=w.task_version_id;
          PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=t) FOR UPDATE;
          SELECT * INTO w FROM workflow_run WHERE novel_id=n AND workflow_run_id=wid FOR UPDATE;IF w.workflow_run_id IS NULL THEN wid:=NULL;END IF;
        END IF;
        policy:=_val_policy(n);PERFORM 1 FROM validation_policy_release WHERE release_id=policy FOR UPDATE;
        IF op='validation:current' THEN
          IF NOT _exact_keys(p,ARRAY['validation_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
          IF r.validation_run_id IS NULL OR NOT _val_applicable(r) THEN result:=jsonb_build_object('ok',false,'error','VALIDATION_STALE');ELSE result:=_val_response(r);typ:='run';resource:=r.validation_run_id;END IF;
        ELSIF op='validation:history' THEN
          IF NOT _exact_keys(p,ARRAY['workflow_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
          IF w.workflow_run_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');ELSE
            result:=jsonb_build_object('ok',true,'runs',(SELECT coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('current_applicable',_val_applicable(v),'covered_checks_pass',v.overall='passed' AND _val_applicable(v),'checks',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.position) FROM validation_check d WHERE d.validation_run_id=v.validation_run_id)) ORDER BY v.executed_at,v.validation_run_id),'[]') FROM validation_run v WHERE v.novel_id=n AND v.workflow_run_id=w.workflow_run_id));END IF;
        ELSE
          IF jsonb_typeof(p->'request_key') IS DISTINCT FROM 'string' OR length(p->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
          IF op='validation-policy:publish' THEN
            IF NOT _exact_keys(p,ARRAY['request_key','expected_release_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;scope:=n;
          ELSE
            IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref','expected_candidate_ref','expected_selection_version']) OR jsonb_typeof(p->'expected_selection_version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
            IF w.workflow_run_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;scope:=w.workflow_run_id;
          END IF;
          digest:=_val_hash('request',jsonb_build_object('operation',op,'novel_id',n,'request',p));
          SELECT * INTO prior FROM validation_command_request WHERE actor_id=_caller() AND novel_id=n AND operation=op AND scope_id=scope AND request_key=p->>'request_key';
          IF prior.request_id IS NOT NULL THEN
            IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
            ELSIF op='validation-policy:publish' THEN result:=jsonb_build_object('ok',true,'release_id',prior.resource_release_id);
            ELSE SELECT * INTO STRICT r FROM validation_run WHERE validation_run_id=prior.resource_run_id;IF NOT _val_applicable(r) THEN result:=jsonb_build_object('ok',false,'error','VALIDATION_STALE');ELSE result:=_val_response(r);END IF;END IF;
          ELSIF op='validation-policy:publish' THEN
            IF policy IS DISTINCT FROM (p->>'expected_release_id')::uuid THEN result:=jsonb_build_object('ok',false,'error','VERSION_CONFLICT');ELSE
              SELECT coalesce(max(generation),0)+1 INTO generation_no FROM validation_policy_release WHERE novel_id=n;
              INSERT INTO validation_policy_release VALUES(ids[1],n,generation_no,policy,'finite-validator-v1','finite-rules-v1','finite-validation-v1',65536,'computed',_caller(),clock_timestamp());
              result:=jsonb_build_object('ok',true,'release_id',ids[1]);INSERT INTO validation_command_request VALUES(ids[128],_caller(),n,op,scope,p->>'request_key',digest,NULL,ids[1]);END IF;
          ELSE
            IF w.current_candidate_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','NO_CURRENT_SELECTION');
            ELSIF w.current_candidate_id IS DISTINCT FROM (p->>'expected_candidate_ref')::uuid OR w.current_selection_version<>(p->>'expected_selection_version')::bigint THEN result:=jsonb_build_object('ok',false,'error','VERSION_CONFLICT');
            ELSIF NOT _val_writer_at(w,clock_timestamp()) OR NOT _val_inputs_current(w) THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');
            ELSIF policy IS NULL THEN result:=jsonb_build_object('ok',false,'error','NO_VALIDATION_POLICY');ELSE
              SELECT * INTO STRICT c FROM candidate_version WHERE workflow_run_id=w.workflow_run_id AND candidate_version_id=w.current_candidate_id;
              SELECT * INTO STRICT h FROM workflow_candidate_selection_history WHERE workflow_run_id=w.workflow_run_id AND selection_version=w.current_selection_version AND candidate_version_id=c.candidate_version_id;
              resource:=_val_record(w,c,h,policy,ids);SELECT * INTO STRICT r FROM validation_run WHERE validation_run_id=resource;result:=_val_response(r);
              INSERT INTO validation_command_request VALUES(ids[128],_caller(),n,op,scope,p->>'request_key',digest,r.validation_run_id,NULL);
            END IF;
          END IF;
          IF (result->>'ok')::boolean THEN
            IF op='validation-policy:publish' THEN typ:='release';resource:=(result->>'release_id')::uuid;ELSE typ:='run';resource:=(result->>'validation_ref')::uuid;END IF;
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range THEN result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');typ:='none';resource:=NULL;
    END;
    PERFORM _val_audit(audit,op,n,t,wid,(result->>'ok')::boolean,typ,resource);RETURN result;END;`);
  sql('ALTER FUNCTION agent_book.api_read_audit(uuid,uuid) RENAME TO _read_audit_pre_validation;');
  fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE r jsonb;BEGIN r:=_read_audit_pre_validation(p_novel,p_audit);IF(r->>'ok')::boolean THEN RETURN jsonb_set(r,'{events}',(r->'events')||_val_events(p_novel));END IF;RETURN r;END;`);
  for(const table of ['validation_policy_release','validation_run','validation_check','validation_command_request','validation_access_audit'])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  for(const table of ['validation_run','validation_check'])sql(`CREATE CONSTRAINT TRIGGER validation_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._val_complete();`);
  sql(`CREATE TRIGGER validation_policy_guard BEFORE INSERT ON agent_book.validation_policy_release FOR EACH ROW EXECUTE FUNCTION agent_book._val_policy_guard();
    REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
    DO $acl$ DECLARE login record;BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION agent_book._read_audit_pre_validation(uuid,uuid) FROM %I',login.db_login);
      IF login.role_key IN ('author','auditor') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_finite_validation(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);END IF;
      IF login.role_key='auditor' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_read_audit(uuid,uuid) TO %I',login.db_login);END IF;
    END LOOP;END $acl$;`);
}
export async function down(){throw new Error('Use a reviewed forward migration');}
