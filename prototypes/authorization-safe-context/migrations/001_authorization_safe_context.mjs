const schema='authorization_safe_context_fixture';
export async function up(pgm){
  const prefix=process.env.PROTOTYPE_ROLE_PREFIX;
  if(!/^asc_[a-f0-9]{12}$/.test(prefix??''))throw new Error('unique role prefix required');
  const owner=`${prefix}_owner`;
  const sql=s=>pgm.sql(s);
  const fn=(name,args,result,body,language='plpgsql')=>sql(`CREATE FUNCTION ${schema}.${name}(${args}) RETURNS ${result} LANGUAGE ${language} SECURITY DEFINER SET search_path=pg_catalog,${schema},pg_temp AS $fn$ ${body} $fn$;`);
  sql(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
    CREATE TABLE ${schema}.actor_principal(actor_id text PRIMARY KEY,db_login name NOT NULL UNIQUE,kind text NOT NULL CHECK(kind IN ('author','writer','validator','auditor')),status text NOT NULL CHECK(status IN ('active','disabled')));
    CREATE TABLE ${schema}.authorization_gate(actor_id text PRIMARY KEY REFERENCES ${schema}.actor_principal);
    CREATE TABLE ${schema}.policy_gate(id integer PRIMARY KEY CHECK(id=1));INSERT INTO ${schema}.policy_gate VALUES(1);
    CREATE TABLE ${schema}.policy_event(event_no bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,policy_version text NOT NULL);
    INSERT INTO ${schema}.policy_event(policy_version) VALUES('safe-context-v1');
    CREATE TABLE ${schema}.project(project_id text PRIMARY KEY);
    CREATE TABLE ${schema}.scene(scene_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.project);
    CREATE TABLE ${schema}.character(character_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.project);
    CREATE TABLE ${schema}.design_revision(revision_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.project,body text NOT NULL);
    CREATE TABLE ${schema}.scene_task_version(task_id text PRIMARY KEY,scene_id text NOT NULL REFERENCES ${schema}.scene,project_id text NOT NULL REFERENCES ${schema}.project,
      viewpoint_id text NOT NULL REFERENCES ${schema}.character,assigned_actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      design_revision_id text NOT NULL REFERENCES ${schema}.design_revision,canon_watermark bigint NOT NULL CHECK(canon_watermark>=0),reader_scope text NOT NULL,
      budget integer NOT NULL CHECK(budget>=0),goal_code text NOT NULL CHECK(goal_code='courtyard'));
    CREATE TABLE ${schema}.workflow(workflow_id text PRIMARY KEY,task_id text NOT NULL REFERENCES ${schema}.scene_task_version);
    CREATE TABLE ${schema}.capability(capability_key text PRIMARY KEY,action text NOT NULL,resource_domain text NOT NULL);
    CREATE TABLE ${schema}.data_scope(scope_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.project,scene_id text REFERENCES ${schema}.scene,
      viewpoint_id text REFERENCES ${schema}.character,max_canon_watermark bigint NOT NULL,resource_classes text[] NOT NULL,allowed_propositions text[] NOT NULL,
      secret_scope_format_version text NOT NULL,default_decision text NOT NULL,scope_hash text NOT NULL);
    CREATE TABLE ${schema}.capability_grant(grant_id text PRIMARY KEY,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      capability_key text NOT NULL REFERENCES ${schema}.capability,data_scope_id text NOT NULL REFERENCES ${schema}.data_scope,
      effective_at timestamptz NOT NULL,expires_at timestamptz,CHECK(expires_at IS NULL OR expires_at>effective_at));
    CREATE TABLE ${schema}.grant_revocation(grant_id text PRIMARY KEY REFERENCES ${schema}.capability_grant,revoked_by text NOT NULL REFERENCES ${schema}.actor_principal,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE ${schema}.safe_projection_rule(project_id text NOT NULL REFERENCES ${schema}.project,rule_code text NOT NULL,rule_version text NOT NULL CHECK(rule_version='finite-projection-v1'),visible_text text NOT NULL,negative_text text,PRIMARY KEY(project_id,rule_code,rule_version));
    CREATE TABLE ${schema}.resource(resource_id text PRIMARY KEY,resource_key text NOT NULL,project_id text NOT NULL REFERENCES ${schema}.project,scene_id text REFERENCES ${schema}.scene,
      domain text NOT NULL CHECK(domain IN ('design','canon','secret')),revision_id text NOT NULL REFERENCES ${schema}.design_revision,
      version_no integer NOT NULL CHECK(version_no>0),source_version_id text NOT NULL,canon_watermark bigint NOT NULL,active boolean NOT NULL,
      resource_class text NOT NULL,proposition_key text,safe_code text NOT NULL,title text NOT NULL,path text NOT NULL,body text NOT NULL,metadata jsonb NOT NULL,
      UNIQUE(project_id,resource_key,version_no));
    CREATE TABLE ${schema}.knowledge_evidence(evidence_id text PRIMARY KEY,character_id text NOT NULL REFERENCES ${schema}.character,proposition_key text NOT NULL,
      value text NOT NULL CHECK(value IN ('known_true','known_false','unknown')),canon_watermark bigint NOT NULL,version_no integer NOT NULL,
      source_resource_id text NOT NULL REFERENCES ${schema}.resource,UNIQUE(character_id,proposition_key,canon_watermark,version_no));
    CREATE TABLE ${schema}.belief_evidence(evidence_id text PRIMARY KEY,character_id text NOT NULL REFERENCES ${schema}.character,proposition_key text NOT NULL,
      value text NOT NULL CHECK(value IN ('believed_true','believed_false','unknown')),canon_watermark bigint NOT NULL,version_no integer NOT NULL,
      source_resource_id text NOT NULL REFERENCES ${schema}.resource,UNIQUE(character_id,proposition_key,canon_watermark,version_no));
    CREATE TABLE ${schema}.reader_disclosure_evidence(evidence_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.project,proposition_key text NOT NULL,
      reader_scope text NOT NULL,value text NOT NULL CHECK(value IN ('confirmed','clue','hidden')),canon_watermark bigint NOT NULL,version_no integer NOT NULL,
      source_resource_id text NOT NULL REFERENCES ${schema}.resource,UNIQUE(project_id,proposition_key,reader_scope,canon_watermark,version_no));
    CREATE TABLE ${schema}.retrieval_hit(hit_id text PRIMARY KEY,task_id text NOT NULL REFERENCES ${schema}.scene_task_version,resource_id text NOT NULL,
      score integer NOT NULL,snippet text NOT NULL,title text NOT NULL,metadata jsonb NOT NULL);
    CREATE TABLE ${schema}.access_audit_record(audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      action text NOT NULL,task_id text REFERENCES ${schema}.scene_task_version,data_scope_id text REFERENCES ${schema}.data_scope,grant_id text REFERENCES ${schema}.capability_grant,
      decision text NOT NULL CHECK(decision IN ('allow','deny','filtered','redacted')),reason_code text NOT NULL,policy_version text NOT NULL,
      restricted_resource_id text REFERENCES ${schema}.resource,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE ${schema}.visibility_decision(decision_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      data_scope_id text NOT NULL REFERENCES ${schema}.data_scope,resource_id text NOT NULL REFERENCES ${schema}.resource,decision text NOT NULL CHECK(decision IN ('allow','filtered','redacted')),
      basis_hash text NOT NULL,policy_version text NOT NULL);
    CREATE TABLE ${schema}.context_bundle(bundle_id text PRIMARY KEY,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,task_id text NOT NULL REFERENCES ${schema}.scene_task_version,
      design_revision_id text NOT NULL REFERENCES ${schema}.design_revision,input_canon_watermark bigint NOT NULL,data_scope_id text NOT NULL REFERENCES ${schema}.data_scope,
      compile_grant_id text NOT NULL REFERENCES ${schema}.capability_grant,compiler_version text NOT NULL,policy_version text NOT NULL,budget_version text NOT NULL,
      payload jsonb NOT NULL,content_hash text NOT NULL,created_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(),UNIQUE(task_id,content_hash));
    CREATE TABLE ${schema}.context_item(item_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,bundle_id text NOT NULL REFERENCES ${schema}.context_bundle,
      item_order integer NOT NULL CHECK(item_order>0),item_type text NOT NULL,public_item jsonb NOT NULL,selected_reason text NOT NULL,
      UNIQUE(bundle_id,item_order));
    CREATE TABLE ${schema}.context_source_reference(reference_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,item_id text NOT NULL UNIQUE REFERENCES ${schema}.context_item,
      resource_id text NOT NULL REFERENCES ${schema}.resource,source_version_id text NOT NULL,source_digest text NOT NULL,
      knowledge_evidence_id text REFERENCES ${schema}.knowledge_evidence,belief_evidence_id text REFERENCES ${schema}.belief_evidence,
      disclosure_evidence_id text REFERENCES ${schema}.reader_disclosure_evidence,permission_basis jsonb NOT NULL,projection_rule_version text NOT NULL);
    CREATE TABLE ${schema}.generation_run(generation_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      workflow_id text NOT NULL REFERENCES ${schema}.workflow,task_id text NOT NULL REFERENCES ${schema}.scene_task_version,bundle_id text NOT NULL REFERENCES ${schema}.context_bundle);
    CREATE TABLE ${schema}.candidate_version(candidate_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,actor_id text NOT NULL REFERENCES ${schema}.actor_principal,
      workflow_id text NOT NULL REFERENCES ${schema}.workflow,task_id text NOT NULL REFERENCES ${schema}.scene_task_version,bundle_id text NOT NULL REFERENCES ${schema}.context_bundle,
      generation_id text NOT NULL REFERENCES ${schema}.generation_run,body text NOT NULL,content_hash text NOT NULL);
    CREATE TABLE ${schema}.validation_result(result_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,candidate_id text NOT NULL REFERENCES ${schema}.candidate_version,
      policy_version text NOT NULL,code text NOT NULL CHECK(code='REVIEW_VIEWPOINT'),internal_explanation jsonb NOT NULL);`);
  fn('digest','value text','text',"SELECT encode(sha256(convert_to(value,'UTF8')),'hex')",'sql');
  fn('current_policy','','text','SELECT policy_version FROM policy_event ORDER BY event_no DESC LIMIT 1','sql');
  fn('caller','','text','SELECT actor_id FROM actor_principal WHERE db_login=session_user','sql');
  fn('exact_request','r jsonb,keys text[]','boolean',`SELECT coalesce(jsonb_typeof(r)='object' AND r ?& keys AND (SELECT count(*) FROM jsonb_object_keys(r))=cardinality(keys),false)`,'sql');
  fn('audit','p_actor text,p_action text,p_task text,p_scope text,p_grant text,p_decision text,p_reason text,p_resource text DEFAULT NULL','void',`BEGIN
    INSERT INTO access_audit_record(actor_id,action,task_id,data_scope_id,grant_id,decision,reason_code,policy_version,restricted_resource_id)
      VALUES(p_actor,p_action,p_task,p_scope,p_grant,p_decision,p_reason,current_policy(),p_resource);
  END;`);
  fn('deny','p_action text,p_task text DEFAULT NULL,p_reason text DEFAULT \'not_authorized\'','jsonb',`BEGIN
    PERFORM audit(caller(),p_action,p_task,NULL,NULL,'deny',p_reason);
    RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');
  END;`);
  fn('grant_live','p_grant text','boolean',`SELECT EXISTS(SELECT 1 FROM capability_grant g JOIN actor_principal a USING(actor_id)
    WHERE g.grant_id=p_grant AND a.status='active' AND g.effective_at<=clock_timestamp() AND (g.expires_at IS NULL OR clock_timestamp()<g.expires_at)
    AND NOT EXISTS(SELECT 1 FROM grant_revocation r WHERE r.grant_id=g.grant_id))`,'sql');
  // A stable pre-existing gate, never an absent revocation row, serializes use and revocation.
  fn('authorize','p_task text,p_action text','jsonb',`DECLARE a actor_principal;t scene_task_version;g capability_grant;s data_scope;pol text;BEGIN
    PERFORM 1 FROM policy_gate WHERE id=1 FOR SHARE;
    SELECT * INTO a FROM actor_principal WHERE actor_id=caller();
    PERFORM 1 FROM authorization_gate WHERE actor_id=a.actor_id FOR UPDATE;
    SELECT * INTO a FROM actor_principal WHERE actor_id=a.actor_id;
    SELECT * INTO t FROM scene_task_version WHERE task_id=p_task FOR SHARE;
    pol:=current_policy();
    IF a.status IS DISTINCT FROM 'active' OR t.task_id IS NULL OR pol NOT IN ('safe-context-v1','safe-context-v2') THEN RETURN NULL;END IF;
    IF a.kind='writer' AND t.assigned_actor_id<>a.actor_id THEN RETURN NULL;END IF;
    FOR g IN SELECT * FROM capability_grant WHERE actor_id=a.actor_id AND capability_key=p_action ORDER BY grant_id LOOP
      IF NOT grant_live(g.grant_id) THEN CONTINUE;END IF;
      SELECT * INTO s FROM data_scope WHERE scope_id=g.data_scope_id;
      IF s.project_id<>t.project_id OR (s.scene_id IS NOT NULL AND s.scene_id<>t.scene_id) OR (s.viewpoint_id IS NOT NULL AND s.viewpoint_id<>t.viewpoint_id)
        OR t.canon_watermark>s.max_canon_watermark OR s.secret_scope_format_version<>'fixture-secret-scope-v1' OR s.default_decision<>'deny' THEN CONTINUE;END IF;
      RETURN jsonb_build_object('actor',a.actor_id,'scope',s.scope_id,'grant',g.grant_id,'policy',pol);
    END LOOP;RETURN NULL;
  END;`);
  fn('immutable','','trigger',`BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='IMMUTABLE_RECORD',CONSTRAINT='immutable_'||TG_TABLE_NAME;END;`);
  fn('policy_lock','','trigger',`BEGIN PERFORM 1 FROM policy_gate WHERE id=1 FOR UPDATE;RETURN NEW;END;`);
  fn('grant_guard','','trigger',`BEGIN
    PERFORM 1 FROM authorization_gate WHERE actor_id=NEW.actor_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM capability_grant g LEFT JOIN grant_revocation rev ON rev.grant_id=g.grant_id WHERE g.actor_id=NEW.actor_id AND g.capability_key=NEW.capability_key AND g.data_scope_id=NEW.data_scope_id
      AND tstzrange(g.effective_at,CASE WHEN rev.revoked_at IS NULL THEN g.expires_at WHEN rev.revoked_at<=g.effective_at THEN g.effective_at ELSE least(g.expires_at,rev.revoked_at) END,'[)') && tstzrange(NEW.effective_at,NEW.expires_at,'[)')) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='GRANT_OVERLAP',CONSTRAINT='grant_period_overlap';END IF;
    RETURN NEW;
  END;`);
  fn('scope_guard','','trigger',`BEGIN
    IF NEW.scene_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene WHERE scene_id=NEW.scene_id AND project_id=NEW.project_id)
      OR NEW.viewpoint_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM character WHERE character_id=NEW.viewpoint_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'SCOPE_BINDING';END IF;
    NEW.scope_hash:=digest((to_jsonb(NEW)-ARRAY['scope_id','scope_hash'])::text);RETURN NEW;
  END;`);
  fn('revocation_lock','','trigger',`BEGIN
    PERFORM 1 FROM authorization_gate WHERE actor_id=(SELECT actor_id FROM capability_grant WHERE grant_id=NEW.grant_id) FOR UPDATE;RETURN NEW;
  END;`);
  fn('resource_allowed','r resource,t scene_task_version,s data_scope','boolean',`SELECT r.project_id=t.project_id AND (r.scene_id IS NULL OR r.scene_id=t.scene_id)
    AND r.revision_id=t.design_revision_id AND r.canon_watermark<=t.canon_watermark AND r.active AND r.resource_class=ANY(s.resource_classes)
    AND (r.proposition_key IS NULL OR r.proposition_key=ANY(s.allowed_propositions))
    AND NOT EXISTS(SELECT 1 FROM resource newer WHERE newer.project_id=r.project_id AND newer.resource_key=r.resource_key AND newer.version_no>r.version_no
      AND newer.active AND newer.revision_id=t.design_revision_id AND newer.canon_watermark<=t.canon_watermark)`,'sql');
  fn('projection','r resource,t scene_task_version','jsonb',`DECLARE k knowledge_evidence;b belief_evidence;d reader_disclosure_evidence;kind text;content text;reason text;BEGIN
    SELECT * INTO k FROM knowledge_evidence WHERE character_id=t.viewpoint_id AND proposition_key=r.proposition_key AND canon_watermark<=t.canon_watermark ORDER BY canon_watermark DESC,version_no DESC LIMIT 1;
    SELECT * INTO b FROM belief_evidence WHERE character_id=t.viewpoint_id AND proposition_key=r.proposition_key AND canon_watermark<=t.canon_watermark ORDER BY canon_watermark DESC,version_no DESC LIMIT 1;
    SELECT * INTO d FROM reader_disclosure_evidence WHERE project_id=t.project_id AND proposition_key=r.proposition_key AND reader_scope=t.reader_scope AND canon_watermark<=t.canon_watermark ORDER BY canon_watermark DESC,version_no DESC LIMIT 1;
    CASE r.safe_code
      WHEN 'permanent_guard' THEN kind:='safety_constraint';reason:='mandatory_safe_guard';
      WHEN 'public_rain' THEN kind:='canon_fixture';reason:='authorized_canon_fixture';
      WHEN 'secret_clue' THEN
        IF k.value='known_true' AND coalesce(d.value,'hidden')<>'confirmed' THEN kind:='safe_clue';reason:='known_but_reader_limited';END IF;
      WHEN 'both_bridge' THEN
        IF k.value='known_true' AND d.value='confirmed' THEN kind:='known_fact_fixture';reason:='knowledge_and_reader_confirmed';END IF;
      WHEN 'belief_door' THEN
        IF b.value IN ('believed_true','believed_false') AND d.value='confirmed' THEN kind:='character_belief';reason:='belief_only_not_fact';END IF;
      WHEN 'negative_lamp' THEN
        IF k.value='known_false' AND d.value='confirmed' THEN kind:='explicit_negative_knowledge';reason:='explicit_negative_evidence';END IF;
      ELSE RETURN NULL;
    END CASE;
    IF kind IS NULL THEN RETURN NULL;END IF;
    SELECT CASE WHEN r.safe_code='belief_door' AND b.value='believed_false' THEN negative_text ELSE visible_text END INTO content FROM safe_projection_rule WHERE project_id=t.project_id AND rule_code=r.safe_code AND rule_version='finite-projection-v1';
    IF content IS NULL THEN RETURN NULL;END IF;
    RETURN jsonb_build_object('kind',kind,'text',content,'reason',reason,'knowledge_evidence_id',k.evidence_id,'belief_evidence_id',b.evidence_id,'disclosure_evidence_id',d.evidence_id);
  END;`);
  fn('check_bundle','p_bundle text,p_action text','jsonb',`DECLARE b context_bundle;auth jsonb;BEGIN
    SELECT * INTO b FROM context_bundle WHERE bundle_id=p_bundle;
    IF b.bundle_id IS NULL THEN RETURN NULL;END IF;
    auth:=authorize(b.task_id,p_action);
    IF auth IS NULL OR b.actor_id IS DISTINCT FROM caller() OR b.data_scope_id IS DISTINCT FROM auth->>'scope'
      OR b.policy_version IS DISTINCT FROM auth->>'policy' OR NOT grant_live(b.compile_grant_id) THEN RETURN NULL;END IF;
    RETURN auth;
  END;`);
  fn('known_task','r jsonb','text',`SELECT task_id FROM scene_task_version WHERE task_id=r->>'task_id'`,'sql');
  fn('make_payload','p_id text,t scene_task_version,p_policy text,p_items jsonb','jsonb',`SELECT jsonb_build_object('context_ref',p_id,'format_version','safe-payload-v1',
    'compiler_version','fixture-compiler-v1','policy_version',p_policy,'budget_version','fixture-character-budget-v1',
    'canon_watermark',t.canon_watermark,'viewpoint','limited_character','missing_knowledge','unknown','items',p_items)`,'sql');
  fn('api_compile_context','r jsonb','jsonb',`DECLARE auth jsonb;t scene_task_version;s data_scope;res resource;hit record;proj jsonb;chosen jsonb:='[]';items jsonb:='[]';
    entry jsonb;bundle text:=gen_random_uuid()::text;payload jsonb;item_id text;position integer:=0;guard_count integer:=0;
  BEGIN
    IF NOT exact_request(r,ARRAY['task_id']) THEN RETURN deny('compile_context',known_task(r),'invalid_request');END IF;
    auth:=authorize(r->>'task_id','compile_context');IF auth IS NULL THEN RETURN deny('compile_context',known_task(r));END IF;
    SELECT * INTO t FROM scene_task_version WHERE task_id=r->>'task_id';SELECT * INTO s FROM data_scope WHERE scope_id=auth->>'scope';
    -- 授权范围先物化，排序只能看到已授权的候选 ID，不读取检索载荷。
    FOR res IN WITH authorized AS MATERIALIZED(SELECT resource_id FROM resource rr WHERE resource_allowed(rr,t,s))
      SELECT rr.* FROM authorized a JOIN resource rr USING(resource_id)
      LEFT JOIN LATERAL(SELECT max(score) AS score FROM retrieval_hit h WHERE h.task_id=t.task_id AND h.resource_id=rr.resource_id) rank ON true
      ORDER BY (rr.safe_code='permanent_guard') DESC,rank.score DESC NULLS LAST,rr.resource_key COLLATE "C" LOOP
      proj:=projection(res,t);IF proj IS NULL THEN CONTINUE;END IF;
      position:=position+1;IF proj->>'kind'='safety_constraint' THEN guard_count:=guard_count+1;END IF;
      chosen:=chosen||jsonb_build_array(jsonb_build_object('resource',res.resource_id,'projection',proj));
      items:=items||jsonb_build_array(jsonb_build_object('order',position,'kind',proj->>'kind','text',proj->>'text'));
    END LOOP;
    FOR hit IN SELECT h.resource_id,rr.resource_id AS actual_id FROM retrieval_hit h LEFT JOIN resource rr ON rr.resource_id=h.resource_id WHERE h.task_id=t.task_id ORDER BY h.hit_id LOOP
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(chosen) e WHERE e->>'resource'=hit.actual_id) THEN
        PERFORM audit(caller(),'retrieval_filter',t.task_id,s.scope_id,auth->>'grant','filtered','unverified_or_ineligible_hit',hit.actual_id);
      END IF;
    END LOOP;
    IF guard_count<>1 THEN RETURN deny('compile_context',t.task_id,'mandatory_guard_unavailable');END IF;
    payload:=make_payload(bundle,t,auth->>'policy',items);
    IF char_length(payload::text)>t.budget THEN RETURN deny('compile_context',t.task_id,'budget_cannot_preserve_safety');END IF;
    INSERT INTO context_bundle(bundle_id,actor_id,task_id,design_revision_id,input_canon_watermark,data_scope_id,compile_grant_id,compiler_version,policy_version,budget_version,payload,content_hash)
      VALUES(bundle,caller(),t.task_id,t.design_revision_id,t.canon_watermark,s.scope_id,auth->>'grant','fixture-compiler-v1',auth->>'policy','fixture-character-budget-v1',payload,digest(payload::text));
    position:=0;
    FOR entry IN SELECT value FROM jsonb_array_elements(chosen) LOOP
      position:=position+1;proj:=entry->'projection';SELECT * INTO res FROM resource WHERE resource_id=entry->>'resource';
      INSERT INTO context_item(bundle_id,item_order,item_type,public_item,selected_reason)
        VALUES(bundle,position,proj->>'kind',items->(position-1),proj->>'reason') RETURNING context_item.item_id INTO item_id;
      INSERT INTO context_source_reference(item_id,resource_id,source_version_id,source_digest,knowledge_evidence_id,belief_evidence_id,disclosure_evidence_id,permission_basis,projection_rule_version)
        VALUES(item_id,res.resource_id,res.source_version_id,digest(res.body),proj->>'knowledge_evidence_id',proj->>'belief_evidence_id',proj->>'disclosure_evidence_id',auth,'finite-projection-v1');
      INSERT INTO visibility_decision(actor_id,data_scope_id,resource_id,decision,basis_hash,policy_version)
        VALUES(caller(),s.scope_id,res.resource_id,CASE WHEN res.domain='secret' THEN 'redacted' ELSE 'allow' END,
        digest(jsonb_build_array(t.task_id,t.canon_watermark,s.scope_hash,auth,proj,'finite-projection-v1')::text),auth->>'policy');
      PERFORM audit(caller(),'context_projection',t.task_id,s.scope_id,auth->>'grant',CASE WHEN res.domain='secret' THEN 'redacted' ELSE 'allow' END,proj->>'reason',res.resource_id);
    END LOOP;
    PERFORM audit(caller(),'compile_context',t.task_id,s.scope_id,auth->>'grant','allow','bundle_frozen');
    RETURN jsonb_build_object('ok',true,'bundle_id',bundle,'content_hash',digest(payload::text),'payload',payload,'model_input',payload::text);
  END;`);
  fn('api_get_context','r jsonb','jsonb',`DECLARE b context_bundle;auth jsonb;BEGIN
    IF NOT exact_request(r,ARRAY['bundle_id']) THEN RETURN deny('read_context',NULL,'invalid_request');END IF;
    SELECT * INTO b FROM context_bundle WHERE bundle_id=r->>'bundle_id';auth:=check_bundle(r->>'bundle_id','read_context');
    IF auth IS NULL THEN RETURN deny('read_context',b.task_id);END IF;
    PERFORM audit(caller(),'read_context',b.task_id,auth->>'scope',auth->>'grant','allow','current_authorization_checked');
    RETURN jsonb_build_object('ok',true,'bundle_id',b.bundle_id,'payload',b.payload,'content_hash',b.content_hash,'model_input',b.payload::text);
  END;`);
  fn('api_create_generation','r jsonb','jsonb',`DECLARE b context_bundle;w workflow;auth jsonb;result text;BEGIN
    IF NOT exact_request(r,ARRAY['workflow_id','bundle_id']) THEN RETURN deny('generate_context',NULL,'invalid_request');END IF;
    SELECT * INTO b FROM context_bundle WHERE bundle_id=r->>'bundle_id';SELECT * INTO w FROM workflow WHERE workflow_id=r->>'workflow_id';auth:=check_bundle(r->>'bundle_id','generate_context');
    IF auth IS NULL OR w.task_id IS DISTINCT FROM b.task_id THEN RETURN deny('generate_context',b.task_id);END IF;
    INSERT INTO generation_run(actor_id,workflow_id,task_id,bundle_id) VALUES(caller(),w.workflow_id,w.task_id,b.bundle_id) RETURNING generation_id INTO result;
    PERFORM audit(caller(),'generate_context',b.task_id,auth->>'scope',auth->>'grant','allow','reference_only_no_model_call');
    RETURN jsonb_build_object('ok',true,'generation_id',result);
  END;`);
  fn('api_write_candidate','r jsonb','jsonb',`DECLARE b context_bundle;w workflow;g generation_run;auth jsonb;result text;BEGIN
    IF NOT exact_request(r,ARRAY['workflow_id','bundle_id','generation_id','body']) OR length(r->>'body') NOT BETWEEN 1 AND 10000 THEN RETURN deny('write_candidate',NULL,'invalid_request');END IF;
    SELECT * INTO b FROM context_bundle WHERE bundle_id=r->>'bundle_id';SELECT * INTO w FROM workflow WHERE workflow_id=r->>'workflow_id';SELECT * INTO g FROM generation_run WHERE generation_id=r->>'generation_id';
    auth:=check_bundle(r->>'bundle_id','write_candidate');
    IF auth IS NULL OR w.task_id IS DISTINCT FROM b.task_id OR g.actor_id IS DISTINCT FROM caller() OR g.workflow_id IS DISTINCT FROM w.workflow_id
      OR g.bundle_id IS DISTINCT FROM b.bundle_id OR g.task_id IS DISTINCT FROM b.task_id THEN RETURN deny('write_candidate',b.task_id);END IF;
    INSERT INTO candidate_version(actor_id,workflow_id,task_id,bundle_id,generation_id,body,content_hash)
      VALUES(caller(),w.workflow_id,b.task_id,b.bundle_id,g.generation_id,r->>'body',digest(r->>'body')) RETURNING candidate_id INTO result;
    PERFORM audit(caller(),'write_candidate',b.task_id,auth->>'scope',auth->>'grant','allow','authorized_workflow_bundle_chain');
    RETURN jsonb_build_object('ok',true,'candidate_id',result);
  END;`);
  fn('api_read_design','r jsonb','jsonb',`DECLARE auth jsonb;t scene_task_version;s data_scope;result jsonb;BEGIN
    IF NOT exact_request(r,ARRAY['task_id']) THEN RETURN deny('read_design',known_task(r),'invalid_request');END IF;
    auth:=authorize(r->>'task_id','read_design');IF auth IS NULL THEN RETURN deny('read_design',known_task(r));END IF;
    SELECT * INTO t FROM scene_task_version WHERE task_id=r->>'task_id';
    SELECT * INTO s FROM data_scope WHERE scope_id=auth->>'scope';
    SELECT jsonb_build_object('revision',jsonb_build_object('revision_id',d.revision_id,'project_id',d.project_id),'restricted_resources',(SELECT jsonb_agg(to_jsonb(rr) ORDER BY resource_id) FROM resource rr WHERE resource_allowed(rr,t,s) AND rr.domain IN ('design','secret'))) INTO result FROM design_revision d WHERE d.revision_id=t.design_revision_id;
    PERFORM audit(caller(),'read_design',t.task_id,auth->>'scope',auth->>'grant','allow','authorized_author_design');RETURN jsonb_build_object('ok',true,'design',result);
  END;`);
  fn('api_inspect_validation','r jsonb','jsonb',`DECLARE c candidate_version;auth jsonb;s data_scope;detail jsonb;result validation_result;BEGIN
    IF NOT exact_request(r,ARRAY['candidate_id']) THEN RETURN deny('validate',NULL,'invalid_request');END IF;
    SELECT * INTO c FROM candidate_version WHERE candidate_id=r->>'candidate_id';auth:=authorize(c.task_id,'validate');IF auth IS NULL THEN RETURN deny('validate',c.task_id);END IF;
    SELECT * INTO s FROM data_scope WHERE scope_id=auth->>'scope';
    SELECT jsonb_build_object('explanation','restricted_fixture_validation_only','sources',jsonb_agg(jsonb_build_object('id',rr.resource_id,'title',rr.title,'path',rr.path,'nested',rr.metadata,'raw',rr.body))) INTO detail
      FROM resource rr JOIN scene_task_version t ON t.project_id=rr.project_id AND t.design_revision_id=rr.revision_id WHERE t.task_id=c.task_id AND resource_allowed(rr,t,s);
    INSERT INTO validation_result(candidate_id,policy_version,code,internal_explanation) VALUES(c.candidate_id,auth->>'policy','REVIEW_VIEWPOINT',detail) RETURNING * INTO result;
    PERFORM audit(caller(),'validate',c.task_id,auth->>'scope',auth->>'grant','allow','restricted_validation');RETURN jsonb_build_object('ok',true,'result',to_jsonb(result));
  END;`);
  fn('api_validation_feedback','r jsonb','jsonb',`DECLARE c candidate_version;auth jsonb;v validation_result;BEGIN
    IF NOT exact_request(r,ARRAY['candidate_id']) THEN RETURN deny('validation_feedback',NULL,'invalid_request');END IF;
    SELECT * INTO c FROM candidate_version WHERE candidate_id=r->>'candidate_id';auth:=authorize(c.task_id,'validation_feedback');
    IF auth IS NULL OR c.actor_id IS DISTINCT FROM caller() THEN RETURN deny('validation_feedback',c.task_id);END IF;
    SELECT * INTO v FROM validation_result WHERE candidate_id=c.candidate_id ORDER BY result_id DESC LIMIT 1;
    IF v.result_id IS NOT NULL AND v.policy_version IS DISTINCT FROM current_policy() THEN RETURN deny('validation_feedback',c.task_id,'stale_policy');END IF;
    PERFORM audit(caller(),'validation_feedback',c.task_id,auth->>'scope',auth->>'grant','allow','finite_feedback_projection');
    RETURN jsonb_build_object('ok',true,'status',CASE WHEN v.result_id IS NULL THEN 'NOT_CHECKED' ELSE 'REVIEW_VIEWPOINT' END,
      'message',CASE WHEN v.result_id IS NULL THEN '尚无校验反馈。' ELSE '请复核候选的视角边界，仅使用本场景已提供的信息。' END);
  END;`);
  // 审计范围独立核对被引用资源；历史追溯不要求 active、当前版本或当前 Design。
  fn('audit_resource_in_scope','r resource,s data_scope','boolean',`SELECT coalesce(r.resource_id IS NOT NULL AND r.project_id=s.project_id
    AND (r.scene_id IS NULL OR s.scene_id IS NULL OR r.scene_id=s.scene_id)
    AND r.canon_watermark<=s.max_canon_watermark AND r.resource_class=ANY(s.resource_classes)
    AND (r.proposition_key IS NULL OR r.proposition_key=ANY(s.allowed_propositions)),false)`,'sql');
  fn('api_read_audit','r jsonb','jsonb',`DECLARE auth jsonb;t scene_task_version;s data_scope;BEGIN
    IF NOT exact_request(r,ARRAY['task_id']) THEN RETURN deny('read_audit',known_task(r),'invalid_request');END IF;
    auth:=authorize(r->>'task_id','read_audit');IF auth IS NULL THEN RETURN deny('read_audit',known_task(r));END IF;SELECT * INTO t FROM scene_task_version WHERE task_id=r->>'task_id';
    SELECT * INTO s FROM data_scope WHERE scope_id=auth->>'scope';
    PERFORM audit(caller(),'read_audit',t.task_id,auth->>'scope',auth->>'grant','allow','restricted_audit_reader');
    RETURN jsonb_build_object('ok',true,'events',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY audit_id),'[]') FROM access_audit_record a JOIN scene_task_version st USING(task_id) WHERE st.project_id=s.project_id AND st.canon_watermark<=s.max_canon_watermark AND (s.scene_id IS NULL OR st.scene_id=s.scene_id) AND (s.viewpoint_id IS NULL OR st.viewpoint_id=s.viewpoint_id)
        AND (a.restricted_resource_id IS NULL OR EXISTS(SELECT 1 FROM resource rr WHERE rr.resource_id=a.restricted_resource_id AND audit_resource_in_scope(rr,s)))),
      'source_refs',(SELECT coalesce(jsonb_agg(to_jsonb(sr) ORDER BY reference_id),'[]') FROM context_source_reference sr JOIN context_item i USING(item_id) JOIN context_bundle b USING(bundle_id) JOIN scene_task_version st USING(task_id) JOIN resource rr ON rr.resource_id=sr.resource_id WHERE st.project_id=t.project_id AND st.canon_watermark<=s.max_canon_watermark AND (s.scene_id IS NULL OR st.scene_id=s.scene_id) AND (s.viewpoint_id IS NULL OR st.viewpoint_id=s.viewpoint_id) AND audit_resource_in_scope(rr,s)));
  END;`);
  fn('api_revoke_grant','r jsonb','jsonb',`DECLARE g capability_grant;s data_scope;t text;auth jsonb;BEGIN
    IF NOT exact_request(r,ARRAY['grant_id']) THEN RETURN deny('manage_grant',NULL,'invalid_request');END IF;
    SELECT * INTO g FROM capability_grant WHERE grant_id=r->>'grant_id';IF NOT FOUND THEN RETURN deny('manage_grant');END IF;SELECT * INTO s FROM data_scope WHERE scope_id=g.data_scope_id;
    PERFORM 1 FROM policy_gate WHERE id=1 FOR SHARE;
    PERFORM 1 FROM authorization_gate WHERE actor_id IN(caller(),g.actor_id) ORDER BY actor_id COLLATE "C" FOR UPDATE;
    SELECT task_id INTO t FROM scene_task_version WHERE project_id=s.project_id AND (s.scene_id IS NULL OR scene_id=s.scene_id) ORDER BY task_id COLLATE "C" LIMIT 1;
    auth:=authorize(t,'manage_grant');IF auth IS NULL THEN RETURN deny('manage_grant',t);END IF;
    INSERT INTO grant_revocation(grant_id,revoked_by) VALUES(g.grant_id,caller()) ON CONFLICT DO NOTHING;
    PERFORM audit(caller(),'manage_grant',t,auth->>'scope',auth->>'grant','allow','grant_revoked');RETURN jsonb_build_object('ok',true);
  END;`);
  fn('fixture_binding_guard','','trigger',`DECLARE t scene_task_version;rr resource;p text;BEGIN
    IF TG_TABLE_NAME='scene_task_version' THEN
      IF NOT EXISTS(SELECT 1 FROM scene s JOIN character c ON c.project_id=s.project_id JOIN design_revision d ON d.project_id=s.project_id WHERE s.scene_id=NEW.scene_id AND c.character_id=NEW.viewpoint_id AND d.revision_id=NEW.design_revision_id AND s.project_id=NEW.project_id) THEN RAISE EXCEPTION 'FIXTURE_TASK_BINDING';END IF;
    ELSIF TG_TABLE_NAME='resource' THEN
      IF NOT EXISTS(SELECT 1 FROM design_revision WHERE revision_id=NEW.revision_id AND project_id=NEW.project_id) OR NEW.scene_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene WHERE scene_id=NEW.scene_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'FIXTURE_RESOURCE_BINDING';END IF;
    ELSE
      SELECT * INTO rr FROM resource WHERE resource_id=NEW.source_resource_id;
      IF TG_TABLE_NAME='reader_disclosure_evidence' THEN p:=NEW.project_id;
      ELSE SELECT project_id INTO p FROM character WHERE character_id=NEW.character_id;END IF;
      IF rr.domain IS DISTINCT FROM 'canon' OR rr.project_id IS DISTINCT FROM p OR rr.proposition_key IS DISTINCT FROM NEW.proposition_key OR rr.canon_watermark>NEW.canon_watermark THEN RAISE EXCEPTION 'FIXTURE_EVIDENCE_BINDING';END IF;
    END IF;RETURN NEW;
  END;`);
  fn('bundle_insert_guard','','trigger',`BEGIN NEW.created_transaction:=pg_current_xact_id();RETURN NEW;END;`);
  fn('bundle_child_guard','','trigger',`DECLARE b context_bundle;BEGIN
    IF TG_TABLE_NAME='context_item' THEN SELECT * INTO b FROM context_bundle WHERE bundle_id=NEW.bundle_id;
    ELSE SELECT cb.* INTO b FROM context_bundle cb JOIN context_item i USING(bundle_id) WHERE i.item_id=NEW.item_id;END IF;
    IF b.created_transaction IS DISTINCT FROM pg_current_xact_id() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='FROZEN_BUNDLE_APPEND',CONSTRAINT='frozen_bundle_append';END IF;RETURN NEW;
  END;`);
  fn('assert_bundle','p_bundle text','void',`DECLARE b context_bundle;t scene_task_version;s data_scope;i context_item;ref context_source_reference;rr resource;proj jsonb;items jsonb;n integer:=0;guards integer:=0;BEGIN
    SELECT * INTO b FROM context_bundle WHERE bundle_id=p_bundle;SELECT * INTO t FROM scene_task_version WHERE task_id=b.task_id;SELECT * INTO s FROM data_scope WHERE scope_id=b.data_scope_id;
    IF b.actor_id IS DISTINCT FROM t.assigned_actor_id OR b.design_revision_id IS DISTINCT FROM t.design_revision_id OR b.input_canon_watermark IS DISTINCT FROM t.canon_watermark
      OR b.compiler_version<>'fixture-compiler-v1' OR b.budget_version<>'fixture-character-budget-v1' THEN RAISE EXCEPTION 'BUNDLE_INPUT_BINDING';END IF;
    FOR i IN SELECT * FROM context_item WHERE bundle_id=p_bundle ORDER BY item_order LOOP
      n:=n+1;SELECT * INTO ref FROM context_source_reference WHERE item_id=i.item_id;SELECT * INTO rr FROM resource WHERE resource_id=ref.resource_id;proj:=projection(rr,t);
      IF i.item_order<>n OR ref.reference_id IS NULL OR NOT resource_allowed(rr,t,s) OR proj IS NULL OR ref.source_version_id IS DISTINCT FROM rr.source_version_id OR ref.source_digest IS DISTINCT FROM digest(rr.body)
        OR ref.projection_rule_version<>'finite-projection-v1' OR ref.permission_basis->>'scope' IS DISTINCT FROM b.data_scope_id
        OR ref.permission_basis->>'policy' IS DISTINCT FROM b.policy_version OR ref.permission_basis->>'actor' IS DISTINCT FROM b.actor_id OR ref.permission_basis->>'grant' IS DISTINCT FROM b.compile_grant_id
        OR ref.knowledge_evidence_id IS DISTINCT FROM proj->>'knowledge_evidence_id' OR ref.belief_evidence_id IS DISTINCT FROM proj->>'belief_evidence_id'
        OR ref.disclosure_evidence_id IS DISTINCT FROM proj->>'disclosure_evidence_id'
        OR i.public_item IS DISTINCT FROM jsonb_build_object('order',n,'kind',proj->>'kind','text',proj->>'text') OR i.item_type IS DISTINCT FROM proj->>'kind' OR i.selected_reason IS DISTINCT FROM proj->>'reason'
        THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BUNDLE_SOURCE_BINDING',CONSTRAINT='bundle_source_binding';END IF;
      IF i.item_type='safety_constraint' THEN guards:=guards+1;END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(public_item ORDER BY item_order),'[]') INTO items FROM context_item WHERE bundle_id=p_bundle;
    IF guards<>1 OR n=0 OR b.payload IS DISTINCT FROM make_payload(b.bundle_id,t,b.policy_version,items) OR b.content_hash IS DISTINCT FROM digest(b.payload::text)
      OR char_length(b.payload::text)>t.budget THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BUNDLE_COMPLETENESS',CONSTRAINT='bundle_completeness';END IF;
  END;`);
  fn('bundle_complete','','trigger',`DECLARE bid text;BEGIN
    IF TG_TABLE_NAME='context_bundle' THEN bid:=NEW.bundle_id;ELSIF TG_TABLE_NAME='context_item' THEN bid:=NEW.bundle_id;
    ELSE SELECT bundle_id INTO bid FROM context_item WHERE item_id=NEW.item_id;END IF;
    PERFORM assert_bundle(bid);RETURN NEW;
  END;`);
  // 对所有实际入口统一做结构与字符串类型检查，不能由任意 JSON 值触发 SQL 解释。
  sql(`CREATE OR REPLACE FUNCTION ${schema}.exact_request(r jsonb,keys text[]) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,${schema},pg_temp AS $fn$
    BEGIN IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN false;END IF;
      RETURN r ?& keys AND (SELECT count(*) FROM jsonb_object_keys(r))=cardinality(keys)
        AND NOT EXISTS(SELECT 1 FROM unnest(keys) k WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'string');END;$fn$;
    CREATE TRIGGER policy_lock BEFORE INSERT ON ${schema}.policy_event FOR EACH ROW EXECUTE FUNCTION ${schema}.policy_lock();
    CREATE TRIGGER scope_guard BEFORE INSERT ON ${schema}.data_scope FOR EACH ROW EXECUTE FUNCTION ${schema}.scope_guard();
    CREATE TRIGGER grant_guard BEFORE INSERT ON ${schema}.capability_grant FOR EACH ROW EXECUTE FUNCTION ${schema}.grant_guard();
    CREATE TRIGGER revocation_lock BEFORE INSERT ON ${schema}.grant_revocation FOR EACH ROW EXECUTE FUNCTION ${schema}.revocation_lock();
    CREATE TRIGGER bundle_insert BEFORE INSERT ON ${schema}.context_bundle FOR EACH ROW EXECUTE FUNCTION ${schema}.bundle_insert_guard();`);
  for(const table of ['scene_task_version','resource','knowledge_evidence','belief_evidence','reader_disclosure_evidence'])sql(`CREATE TRIGGER fixture_binding BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.fixture_binding_guard();`);
  for(const table of ['context_item','context_source_reference'])sql(`CREATE TRIGGER frozen_append BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.bundle_child_guard();`);
  for(const table of ['context_bundle','context_item','context_source_reference'])sql(`CREATE CONSTRAINT TRIGGER bundle_complete AFTER INSERT ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.bundle_complete();`);
  sql(`DO $do$ DECLARE t record;BEGIN FOR t IN SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='${schema}' LOOP
      EXECUTE format('CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON ${schema}.%I FOR EACH ROW EXECUTE FUNCTION ${schema}.immutable()',t.tablename);
      EXECUTE format('CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON ${schema}.%I FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.immutable()',t.tablename);
      EXECUTE format('ALTER TABLE ${schema}.%I OWNER TO ${owner}',t.tablename);
    END LOOP;END;$do$;
    DO $do$ DECLARE f record;BEGIN FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${schema}' LOOP
      EXECUTE format('ALTER FUNCTION %s OWNER TO ${owner}',f.signature);
    END LOOP;END;$do$;
    ALTER SCHEMA ${schema} OWNER TO ${owner};
    REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schema} FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${schema} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);
}
export async function down(pgm){pgm.sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);}
