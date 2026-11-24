// Manual intent only. Approval availability is checked again by any future Canon transaction.
export async function up(pgm){
 const sql=s=>pgm.sql(s),fn=(name,args,type,body,lang='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${type} LANGUAGE ${lang} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $f$ ${body} $f$;`);
 sql(`ALTER TABLE agent_book.validation_run ADD UNIQUE(validation_run_id,novel_id);
 ALTER TABLE agent_book.validation_run ADD UNIQUE(validation_run_id,workflow_run_id);
 ALTER TABLE agent_book.workflow_run ADD UNIQUE(workflow_run_id,novel_id);
 ALTER TABLE agent_book.context_bundle ADD UNIQUE(context_bundle_id,novel_id,task_version_id);
 CREATE TABLE agent_book.approval_policy_release (
   release_id uuid PRIMARY KEY,novel_id uuid NOT NULL REFERENCES agent_book.novel,generation bigint NOT NULL CHECK(generation>0),previous_release_id uuid,
   policy_version text NOT NULL CHECK(policy_version='manual-approval-v1'),content_hash text NOT NULL,issued_by uuid NOT NULL REFERENCES agent_book.actor_principal,issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   CHECK((generation=1 AND previous_release_id IS NULL) OR(generation>1 AND previous_release_id IS NOT NULL)),
   UNIQUE(novel_id,generation),UNIQUE(novel_id,release_id),FOREIGN KEY(novel_id,previous_release_id) REFERENCES agent_book.approval_policy_release(novel_id,release_id));
 CREATE TABLE agent_book.approval_validation_epoch (
   validation_run_id uuid PRIMARY KEY REFERENCES agent_book.validation_run,workflow_run_id uuid NOT NULL REFERENCES agent_book.workflow_run,
   generation bigint NOT NULL CHECK(generation>0),previous_generation bigint,CHECK((generation=1 AND previous_generation IS NULL) OR(generation>1 AND previous_generation=generation-1 AND previous_generation IS NOT NULL)),
   UNIQUE(workflow_run_id,generation),UNIQUE(workflow_run_id,validation_run_id,generation),FOREIGN KEY(validation_run_id,workflow_run_id) REFERENCES agent_book.validation_run(validation_run_id,workflow_run_id),FOREIGN KEY(workflow_run_id,previous_generation) REFERENCES agent_book.approval_validation_epoch(workflow_run_id,generation));
 CREATE TABLE agent_book.approval_workflow_state (
   workflow_run_id uuid PRIMARY KEY REFERENCES agent_book.workflow_run,current_validation_run_id uuid,validation_generation bigint NOT NULL DEFAULT 0 CHECK(validation_generation>=0),
   current_decision_id uuid,decision_version bigint NOT NULL DEFAULT 0 CHECK(decision_version>=0),
   CHECK((current_validation_run_id IS NULL)=(validation_generation=0)),CHECK((current_decision_id IS NULL)=(decision_version=0)),
   FOREIGN KEY(workflow_run_id,current_validation_run_id,validation_generation) REFERENCES agent_book.approval_validation_epoch(workflow_run_id,validation_run_id,generation) DEFERRABLE INITIALLY DEFERRED);
 CREATE TABLE agent_book.approval_review (
   review_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,validation_run_id uuid NOT NULL,validation_generation bigint NOT NULL,
   policy_release_id uuid NOT NULL,decision_version bigint NOT NULL CHECK(decision_version>=0),review_protocol text NOT NULL CHECK(review_protocol='approval-review-v1'),review_hash text NOT NULL,
   reviewed_by uuid NOT NULL REFERENCES agent_book.actor_principal,reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   FOREIGN KEY(validation_run_id,novel_id) REFERENCES agent_book.validation_run(validation_run_id,novel_id),
   FOREIGN KEY(workflow_run_id,validation_run_id,validation_generation) REFERENCES agent_book.approval_validation_epoch(workflow_run_id,validation_run_id,generation),
   FOREIGN KEY(novel_id,policy_release_id) REFERENCES agent_book.approval_policy_release(novel_id,release_id),UNIQUE(review_id,novel_id,workflow_run_id));
 CREATE TABLE agent_book.approval_decision (
   decision_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,decision_version bigint NOT NULL CHECK(decision_version>0),previous_decision_id uuid,
   kind text NOT NULL CHECK(kind IN ('approve','reject','withdraw')),decided_by uuid NOT NULL REFERENCES agent_book.actor_principal,decided_at timestamptz NOT NULL,authority_end timestamptz,
   CHECK((decision_version=1 AND previous_decision_id IS NULL) OR(decision_version>1 AND previous_decision_id IS NOT NULL)),
   FOREIGN KEY(workflow_run_id,novel_id) REFERENCES agent_book.workflow_run(workflow_run_id,novel_id),
   UNIQUE(workflow_run_id,decision_version),UNIQUE(workflow_run_id,decision_id),UNIQUE(workflow_run_id,decision_id,decision_version),UNIQUE(decision_id,novel_id,workflow_run_id),
   FOREIGN KEY(workflow_run_id,previous_decision_id) REFERENCES agent_book.approval_decision(workflow_run_id,decision_id));
 CREATE TABLE agent_book.approval_record (
   approval_id uuid PRIMARY KEY REFERENCES agent_book.approval_decision,review_id uuid NOT NULL,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,task_version_id uuid NOT NULL,
   candidate_version_id uuid NOT NULL,candidate_content_hash text NOT NULL,context_bundle_id uuid NOT NULL,bundle_payload_hash text NOT NULL,revision_id uuid NOT NULL,
   input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),validation_run_id uuid NOT NULL,validation_generation bigint NOT NULL,validation_release_id uuid NOT NULL,
   selection_id uuid NOT NULL,selection_version bigint NOT NULL,approval_policy_version text NOT NULL CHECK(approval_policy_version='manual-approval-v1'),approval_release_id uuid NOT NULL,
   review_hash text NOT NULL,confirmed_soft_constraint_ids jsonb NOT NULL,decision_scope text NOT NULL CHECK(decision_scope='finite_coverage_only_v1'),
   FOREIGN KEY(approval_id,novel_id,workflow_run_id) REFERENCES agent_book.approval_decision(decision_id,novel_id,workflow_run_id),
   FOREIGN KEY(review_id,novel_id,workflow_run_id) REFERENCES agent_book.approval_review(review_id,novel_id,workflow_run_id),
   FOREIGN KEY(validation_run_id,novel_id,task_version_id,workflow_run_id) REFERENCES agent_book.validation_run(validation_run_id,novel_id,task_version_id,workflow_run_id),
   FOREIGN KEY(workflow_run_id,validation_run_id,validation_generation) REFERENCES agent_book.approval_validation_epoch(workflow_run_id,validation_run_id,generation),
   FOREIGN KEY(workflow_run_id,selection_id,selection_version,candidate_version_id) REFERENCES agent_book.workflow_candidate_selection_history(workflow_run_id,selection_id,selection_version,candidate_version_id),
   FOREIGN KEY(context_bundle_id,novel_id,task_version_id) REFERENCES agent_book.context_bundle(context_bundle_id,novel_id,task_version_id),
   FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
   FOREIGN KEY(novel_id,approval_release_id) REFERENCES agent_book.approval_policy_release(novel_id,release_id),FOREIGN KEY(novel_id,validation_release_id) REFERENCES agent_book.validation_policy_release(novel_id,release_id),
   UNIQUE(approval_id,novel_id,workflow_run_id));
 CREATE TABLE agent_book.approval_authority (
   decision_id uuid NOT NULL REFERENCES agent_book.approval_decision,capability_key text NOT NULL CHECK(capability_key IN ('design.read','design.freeze','task.read','task.create')),
   grant_id uuid NOT NULL REFERENCES agent_book.capability_grant,PRIMARY KEY(decision_id,capability_key),UNIQUE(decision_id,grant_id));
 CREATE TABLE agent_book.approval_withdrawal (
   decision_id uuid PRIMARY KEY REFERENCES agent_book.approval_decision,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,withdrawn_approval_id uuid NOT NULL,
   FOREIGN KEY(decision_id,novel_id,workflow_run_id) REFERENCES agent_book.approval_decision(decision_id,novel_id,workflow_run_id),
   FOREIGN KEY(withdrawn_approval_id,novel_id,workflow_run_id) REFERENCES agent_book.approval_record(approval_id,novel_id,workflow_run_id));
 CREATE TABLE agent_book.approval_invalidation_record (
   approval_id uuid PRIMARY KEY REFERENCES agent_book.approval_record,reason_code text NOT NULL CHECK(reason_code IN ('SELECTION_CHANGED','NEW_VALIDATION','INPUT_CHANGED','POLICY_CHANGED','AUTHORIZATION_CHANGED','DECISION_REPLACED','DETECTED_UNAVAILABLE')),
   detected_by uuid REFERENCES agent_book.actor_principal,detected_at timestamptz NOT NULL DEFAULT clock_timestamp());
 CREATE TABLE agent_book.approval_command_request (
   request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,operation text NOT NULL,scope_id uuid NOT NULL,
   request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,resource_kind text NOT NULL CHECK(resource_kind IN ('review','decision','policy')),
   review_id uuid REFERENCES agent_book.approval_review,decision_id uuid REFERENCES agent_book.approval_decision,policy_id uuid REFERENCES agent_book.approval_policy_release,
   CHECK((resource_kind='review' AND review_id IS NOT NULL AND decision_id IS NULL AND policy_id IS NULL) OR(resource_kind='decision' AND decision_id IS NOT NULL AND review_id IS NULL AND policy_id IS NULL) OR(resource_kind='policy' AND policy_id IS NOT NULL AND review_id IS NULL AND decision_id IS NULL)),UNIQUE(actor_id,novel_id,operation,scope_id,request_key));
 CREATE TABLE agent_book.approval_access_audit (
   audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,task_version_id uuid,workflow_run_id uuid,operation text NOT NULL,
   decision text NOT NULL CHECK(decision IN ('allow','deny')),resource_kind text NOT NULL CHECK(resource_kind IN ('none','review','decision','policy')),
   review_id uuid REFERENCES agent_book.approval_review,decision_id uuid REFERENCES agent_book.approval_decision,policy_id uuid REFERENCES agent_book.approval_policy_release,
   created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),FOREIGN KEY(workflow_run_id) REFERENCES agent_book.workflow_run,
   CHECK((resource_kind='none' AND num_nonnulls(review_id,decision_id,policy_id)=0) OR(resource_kind='review' AND review_id IS NOT NULL AND decision_id IS NULL AND policy_id IS NULL) OR(resource_kind='decision' AND decision_id IS NOT NULL AND review_id IS NULL AND policy_id IS NULL) OR(resource_kind='policy' AND policy_id IS NOT NULL AND review_id IS NULL AND decision_id IS NULL)));
 ALTER TABLE agent_book.approval_workflow_state ADD FOREIGN KEY(workflow_run_id,current_decision_id,decision_version) REFERENCES agent_book.approval_decision(workflow_run_id,decision_id,decision_version) DEFERRABLE INITIALLY DEFERRED;`);
 fn('_ap_hash','kind text,p jsonb','text',`SELECT encode(sha256(convert_to('approval-jsonb-v1:'||kind||E'\\n'||p::text,'UTF8')),'hex')`,'sql');
 fn('_ap_policy','n uuid','uuid',`SELECT release_id FROM approval_policy_release WHERE novel_id=n ORDER BY generation DESC LIMIT 1`,'sql');
 fn('_ap_soft','v uuid','jsonb',`SELECT coalesce(jsonb_agg(constraint_id ORDER BY constraint_id),'[]') FROM validation_check WHERE validation_run_id=v AND NOT required AND outcome='unknown' AND code='RULE_NOT_CHECKED'`,'sql');
 fn('_ap_soft_confirmation','p jsonb','jsonb',`DECLARE total integer;distinct_total integer;result jsonb;BEGIN
   IF jsonb_typeof(p) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SOFT_CONFIRMATION_INVALID';END IF;
   SELECT count(*),count(DISTINCT (value#>>'{}')::uuid),coalesce(jsonb_agg((value#>>'{}')::uuid ORDER BY (value#>>'{}')::uuid),'[]') INTO total,distinct_total,result FROM jsonb_array_elements(p);
   IF total<>distinct_total THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SOFT_CONFIRMATION_INVALID';END IF;RETURN result;END;`);
 fn('_ap_payload','r approval_review','jsonb',`SELECT jsonb_build_object('protocol','approval-review-v1','decision_scope','finite_coverage_only_v1','workflow_ref',r.workflow_run_id,'decision_version',r.decision_version,
   'candidate',jsonb_build_object('candidate_ref',c.candidate_version_id,'body',c.body_text,'body_hash',c.body_hash,'text_protocol',c.text_protocol),
   'bundle',jsonb_build_object('bundle_ref',b.public_bundle_ref,'payload_text',b.payload_text,'payload_hash',b.payload_hash),
   'selection',jsonb_build_object('selection_ref',v.selection_id,'selection_version',v.selection_version),
   'validation',to_jsonb(v)||jsonb_build_object('generation',r.validation_generation,'checks',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.position) FROM validation_check d WHERE d.validation_run_id=v.validation_run_id)),
   'unchecked_soft_constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('constraint_id',c.constraint_id,'rule_key',c.rule_key,'rule_text',c.rule_text,'severity',c.severity,'scope_kind',c.scope_kind,'code',d.code) ORDER BY c.constraint_id),'[]') FROM validation_check d JOIN design_constraint c USING(constraint_id,novel_id,revision_id) WHERE d.validation_run_id=v.validation_run_id AND NOT d.required AND d.outcome='unknown' AND d.code='RULE_NOT_CHECKED'),
   'required_soft_confirmation',_ap_soft(v.validation_run_id),'approval_policy',(SELECT to_jsonb(p) FROM approval_policy_release p WHERE p.release_id=r.policy_release_id))
   FROM validation_run v JOIN candidate_version c USING(candidate_version_id) JOIN context_bundle b ON b.context_bundle_id=v.context_bundle_id WHERE v.validation_run_id=r.validation_run_id AND v.workflow_run_id=r.workflow_run_id AND v.novel_id=r.novel_id`,'sql');
 fn('_ap_validation_complete','id uuid','boolean',`DECLARE v validation_run;expected jsonb;actual jsonb;BEGIN
   SELECT * INTO v FROM validation_run WHERE validation_run_id=id;IF v.validation_run_id IS NULL THEN RETURN false;END IF;
   SELECT jsonb_agg(to_jsonb(e) ORDER BY e.position) INTO expected FROM _val_expected(v.workflow_run_id,v.candidate_version_id,v.selection_id,v.executed_at) e;
   SELECT jsonb_agg(jsonb_build_object('position',d.position,'check_key',d.check_key,'check_version',d.check_version,'required',d.required,'constraint_id',d.constraint_id,'outcome',d.outcome,'code',d.code) ORDER BY d.position) INTO actual FROM validation_check d WHERE d.validation_run_id=id;
   RETURN actual IS NOT DISTINCT FROM expected AND jsonb_array_length(actual)=v.expected_checks AND v.check_set_hash=_val_hash('check-set',_val_set(expected)) AND v.result_hash=_val_hash('results',expected) AND v.overall=_val_overall(expected);END;`);
 fn('_ap_review_current','r approval_review','boolean',`SELECT r.review_id IS NOT NULL AND r.policy_release_id=_ap_policy(r.novel_id) AND r.review_hash=_ap_hash('review',_ap_payload(r))
   AND EXISTS(SELECT 1 FROM approval_workflow_state s JOIN validation_run v ON v.validation_run_id=s.current_validation_run_id WHERE s.workflow_run_id=r.workflow_run_id AND s.current_validation_run_id=r.validation_run_id AND s.validation_generation=r.validation_generation AND s.decision_version=r.decision_version AND _val_applicable(v) AND _ap_validation_complete(v.validation_run_id))`,'sql');
 fn('_ap_authority_live','id uuid','boolean',`DECLARE d approval_decision;at_time timestamptz:=clock_timestamp();BEGIN
   SELECT * INTO d FROM approval_decision WHERE decision_id=id;
   RETURN (d.authority_end IS NULL OR at_time<d.authority_end) AND (SELECT count(*) FROM approval_authority WHERE decision_id=id)=4
     AND NOT EXISTS(SELECT 1 FROM approval_authority s JOIN capability_grant g USING(grant_id) JOIN actor_principal a ON a.actor_id=g.actor_id WHERE s.decision_id=id AND(a.status<>'active' OR g.actor_id<>d.decided_by OR g.effective_at>at_time OR(g.expires_at IS NOT NULL AND at_time>=g.expires_at) OR EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id)));END;`);
 fn('_ap_usable','id uuid','boolean',`SELECT EXISTS(SELECT 1 FROM approval_record a JOIN approval_decision d ON d.decision_id=a.approval_id JOIN approval_workflow_state s ON s.workflow_run_id=a.workflow_run_id JOIN validation_run v ON v.validation_run_id=a.validation_run_id
   WHERE a.approval_id=id AND d.kind='approve' AND s.current_decision_id=id AND s.decision_version=d.decision_version AND s.current_validation_run_id=a.validation_run_id AND s.validation_generation=a.validation_generation
     AND a.approval_release_id=_ap_policy(a.novel_id) AND a.validation_release_id=_val_policy(a.novel_id) AND v.overall='passed' AND _val_applicable(v) AND _ap_validation_complete(v.validation_run_id) AND _ap_authority_live(id)
     AND NOT EXISTS(SELECT 1 FROM approval_invalidation_record x WHERE x.approval_id=id) AND NOT EXISTS(SELECT 1 FROM approval_withdrawal x WHERE x.withdrawn_approval_id=id))`,'sql');
 fn('_ap_invalidate','n uuid,reason text','void',`INSERT INTO approval_invalidation_record SELECT a.approval_id,reason,_caller(),clock_timestamp() FROM approval_record a JOIN approval_decision d ON d.decision_id=a.approval_id WHERE a.novel_id=n AND d.kind='approve' AND NOT _ap_usable(a.approval_id) ON CONFLICT(approval_id) DO NOTHING`,'sql');
 // AFTER triggers observe actual completed DML. Public entrypoints already hold the common gate; no BEFORE-row lock-order assumption is used.
 fn('_ap_change','','trigger',`BEGIN INSERT INTO approval_workflow_state(workflow_run_id) VALUES(NEW.workflow_run_id);RETURN NEW;END;`);
 // Validation generation is explicit and transactional; old 005 runs are deliberately not ordered or elected current during upgrade.
 fn('_ap_validation_insert','','trigger',`DECLARE s approval_workflow_state;BEGIN
   SELECT * INTO STRICT s FROM approval_workflow_state WHERE workflow_run_id=NEW.workflow_run_id FOR UPDATE;
   INSERT INTO approval_validation_epoch VALUES(NEW.validation_run_id,NEW.workflow_run_id,s.validation_generation+1,CASE WHEN s.validation_generation>0 THEN s.validation_generation END);
   UPDATE approval_workflow_state SET current_validation_run_id=NEW.validation_run_id,validation_generation=s.validation_generation+1 WHERE workflow_run_id=NEW.workflow_run_id;
   PERFORM _ap_invalidate(NEW.novel_id,'NEW_VALIDATION');RETURN NEW;END;`);
 fn('_ap_source_changed','','trigger',`DECLARE n uuid;reason text:='INPUT_CHANGED';BEGIN
   IF TG_TABLE_NAME IN ('workflow_run','scene_task','design_head','context_policy_release','validation_policy_release','approval_policy_release') THEN n:=NEW.novel_id;
     IF TG_TABLE_NAME='workflow_run' THEN reason:='SELECTION_CHANGED';END IF;
     IF TG_TABLE_NAME IN ('context_policy_release','validation_policy_release','approval_policy_release') THEN reason:='POLICY_CHANGED';END IF;
   ELSIF TG_TABLE_NAME IN ('safe_projection_revocation','safe_projection_supersession') THEN
     SELECT q.novel_id INTO n FROM safe_projection_publication p JOIN safe_projection_proposal q USING(proposal_id) WHERE p.publication_id=CASE WHEN TG_TABLE_NAME='safe_projection_revocation' THEN (to_jsonb(NEW)->>'publication_id')::uuid ELSE (to_jsonb(NEW)->>'old_publication_id')::uuid END;
   ELSIF TG_TABLE_NAME='grant_revocation' THEN SELECT s.novel_id INTO n FROM capability_grant g JOIN data_scope s USING(data_scope_id) WHERE g.grant_id=NEW.grant_id;reason:='AUTHORIZATION_CHANGED';
   ELSIF TG_TABLE_NAME='context_grant_revocation' THEN SELECT s.novel_id INTO n FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=NEW.context_grant_id;reason:='AUTHORIZATION_CHANGED';
   ELSIF TG_TABLE_NAME='manual_writing_revocation' THEN SELECT novel_id INTO n FROM manual_writing_grant WHERE writing_grant_id=NEW.writing_grant_id;reason:='AUTHORIZATION_CHANGED';END IF;
   IF n IS NOT NULL THEN PERFORM _ap_invalidate(n,reason);END IF;RETURN NEW;END;`);
 fn('_ap_state_guard','','trigger',`BEGIN
   IF TG_OP<>'UPDATE' OR NEW.workflow_run_id<>OLD.workflow_run_id OR NOT(
     (NEW.current_decision_id IS NOT DISTINCT FROM OLD.current_decision_id AND NEW.decision_version=OLD.decision_version AND NEW.validation_generation=OLD.validation_generation+1 AND NEW.current_validation_run_id IS DISTINCT FROM OLD.current_validation_run_id)
     OR(NEW.current_validation_run_id IS NOT DISTINCT FROM OLD.current_validation_run_id AND NEW.validation_generation=OLD.validation_generation AND NEW.decision_version=OLD.decision_version+1 AND NEW.current_decision_id IS DISTINCT FROM OLD.current_decision_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVAL_HEAD_INVALID';END IF;RETURN NEW;END;`);
 fn('_ap_state_complete','','trigger',`DECLARE s approval_workflow_state;wid uuid;BEGIN
   wid:=NEW.workflow_run_id;SELECT * INTO STRICT s FROM approval_workflow_state WHERE workflow_run_id=wid;
   IF s.validation_generation<>(SELECT count(*) FROM approval_validation_epoch WHERE workflow_run_id=wid) OR s.validation_generation<>coalesce((SELECT max(generation) FROM approval_validation_epoch WHERE workflow_run_id=wid),0)
     OR s.decision_version<>(SELECT count(*) FROM approval_decision WHERE workflow_run_id=wid) OR s.decision_version<>coalesce((SELECT max(decision_version) FROM approval_decision WHERE workflow_run_id=wid),0)
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVAL_HEAD_INCOMPLETE';END IF;RETURN NULL;END;`);
 fn('_ap_review_guard','','trigger',`DECLARE v validation_run;s approval_workflow_state;BEGIN
   SELECT * INTO STRICT v FROM validation_run WHERE validation_run_id=NEW.validation_run_id;SELECT * INTO STRICT s FROM approval_workflow_state WHERE workflow_run_id=NEW.workflow_run_id;
   NEW.review_hash:=_ap_hash('review',_ap_payload(NEW));
   IF v.novel_id<>NEW.novel_id OR v.workflow_run_id<>NEW.workflow_run_id OR NEW.policy_release_id IS DISTINCT FROM _ap_policy(NEW.novel_id) OR NEW.validation_run_id IS DISTINCT FROM s.current_validation_run_id OR NEW.validation_generation<>s.validation_generation OR NEW.decision_version<>s.decision_version OR NOT _val_applicable(v) OR NOT _ap_validation_complete(v.validation_run_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REVIEW_INPUT_INVALID';END IF;RETURN NEW;END;`);
 fn('_ap_record_guard','','trigger',`DECLARE r approval_review;v validation_run;d approval_decision;BEGIN
   SELECT * INTO STRICT r FROM approval_review WHERE review_id=NEW.review_id;SELECT * INTO STRICT v FROM validation_run WHERE validation_run_id=r.validation_run_id;SELECT * INTO STRICT d FROM approval_decision WHERE decision_id=NEW.approval_id;
   IF d.kind NOT IN ('approve','reject') OR NOT _ap_review_current(r) OR d.decided_by<>r.reviewed_by OR d.decision_version<>r.decision_version+1
     OR NEW.task_version_id<>v.task_version_id OR NEW.candidate_version_id<>v.candidate_version_id OR NEW.candidate_content_hash<>v.candidate_content_hash OR NEW.context_bundle_id<>v.context_bundle_id OR NEW.bundle_payload_hash<>v.bundle_payload_hash OR NEW.revision_id<>v.revision_id OR NEW.input_canon_watermark<>v.input_canon_watermark
     OR NEW.validation_run_id<>v.validation_run_id OR NEW.validation_generation<>r.validation_generation OR NEW.validation_release_id<>v.release_id OR NEW.selection_id<>v.selection_id OR NEW.selection_version<>v.selection_version OR NEW.approval_release_id<>r.policy_release_id OR NEW.review_hash<>r.review_hash OR NEW.confirmed_soft_constraint_ids IS DISTINCT FROM _ap_soft(v.validation_run_id)
     OR(d.kind='approve' AND v.overall<>'passed') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVAL_BINDING_INVALID';END IF;RETURN NEW;END;`);
 fn('_ap_decision_complete','','trigger',`DECLARE id uuid;d approval_decision;total integer;cutoff timestamptz;BEGIN
   id:=coalesce((to_jsonb(NEW)->>'decision_id')::uuid,(to_jsonb(NEW)->>'approval_id')::uuid);SELECT * INTO STRICT d FROM approval_decision WHERE decision_id=id;
   SELECT count(*),min(g.expires_at) INTO total,cutoff FROM approval_authority s JOIN capability_grant g USING(grant_id) JOIN capability c USING(capability_id) JOIN data_scope scope USING(data_scope_id)
     WHERE s.decision_id=id AND c.capability_key=s.capability_key AND g.actor_id=d.decided_by AND scope.novel_id=d.novel_id AND g.effective_at<=d.decided_at AND(g.expires_at IS NULL OR d.decided_at<g.expires_at) AND NOT EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id AND x.revoked_at<=d.decided_at);
   IF total<>4 OR cutoff IS DISTINCT FROM d.authority_end OR(d.decision_version>1 AND NOT EXISTS(SELECT 1 FROM approval_decision prev WHERE prev.decision_id=d.previous_decision_id AND prev.workflow_run_id=d.workflow_run_id AND prev.decision_version=d.decision_version-1))
     OR(d.kind IN ('approve','reject') AND((SELECT count(*) FROM approval_record WHERE approval_id=id)<>1 OR EXISTS(SELECT 1 FROM approval_withdrawal WHERE decision_id=id)))
     OR(d.kind='withdraw' AND((SELECT count(*) FROM approval_withdrawal WHERE decision_id=id)<>1 OR EXISTS(SELECT 1 FROM approval_record WHERE approval_id=id)))
     OR(d.kind='withdraw' AND NOT EXISTS(SELECT 1 FROM approval_withdrawal x JOIN approval_decision prev ON prev.decision_id=x.withdrawn_approval_id WHERE x.decision_id=id AND prev.kind='approve' AND prev.decision_id=d.previous_decision_id))
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVAL_DECISION_INCOMPLETE';END IF;RETURN NULL;END;`);
 fn('_ap_review_visible','r approval_review','jsonb',`SELECT jsonb_build_object('ok',true,'review_ref',r.review_id,'review_hash',r.review_hash,'review',_ap_payload(r),'explicit_confirmation_only',true)`,'sql');
 fn('_ap_decision_visible','d approval_decision','jsonb',`SELECT jsonb_build_object('ok',true,'recorded',true,'decision_ref',d.decision_id,'decision_version',d.decision_version,'kind',d.kind,'currently_usable',CASE WHEN d.kind='approve' THEN _ap_usable(d.decision_id) ELSE false END,'not_commit_permit',true)`,'sql');
 fn('_ap_audit','id uuid,op text,n uuid,t uuid,w uuid,allowed boolean,kind text,resource uuid','void',`INSERT INTO approval_access_audit VALUES(id,_caller(),n,t,w,op,CASE WHEN allowed THEN 'allow' ELSE 'deny' END,kind,CASE WHEN kind='review' THEN resource END,CASE WHEN kind='decision' THEN resource END,CASE WHEN kind='policy' THEN resource END,clock_timestamp())`,'sql');
 fn('_ap_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,'workflow_ref',a.workflow_run_id,'task_version_id',a.task_version_id,'resource_kind',a.resource_kind,'resource_id',coalesce(a.review_id,a.decision_id,a.policy_id),'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]') FROM approval_access_audit a
   WHERE a.novel_id=n AND(a.task_version_id IS NULL OR EXISTS(SELECT 1 FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=a.task_version_id))
   AND(a.workflow_run_id IS NULL OR EXISTS(SELECT 1 FROM workflow_run WHERE novel_id=n AND task_version_id=a.task_version_id AND workflow_run_id=a.workflow_run_id))
   AND CASE a.resource_kind WHEN 'none' THEN true WHEN 'policy' THEN a.workflow_run_id IS NULL AND a.task_version_id IS NULL AND EXISTS(SELECT 1 FROM approval_policy_release WHERE release_id=a.policy_id AND novel_id=n)
     WHEN 'review' THEN EXISTS(SELECT 1 FROM approval_review r JOIN validation_run v USING(validation_run_id) WHERE r.review_id=a.review_id AND r.novel_id=n AND v.novel_id=n AND v.task_version_id=a.task_version_id AND r.workflow_run_id=a.workflow_run_id AND v.workflow_run_id=a.workflow_run_id)
     WHEN 'decision' THEN EXISTS(SELECT 1 FROM approval_decision d JOIN workflow_run w USING(workflow_run_id) WHERE d.decision_id=a.decision_id AND d.novel_id=n AND w.novel_id=n AND w.task_version_id=a.task_version_id AND d.workflow_run_id=a.workflow_run_id AND((d.kind IN ('approve','reject') AND EXISTS(SELECT 1 FROM approval_record r JOIN approval_review q USING(review_id) JOIN validation_run v ON v.validation_run_id=r.validation_run_id WHERE r.approval_id=d.decision_id AND r.novel_id=n AND q.novel_id=n AND r.workflow_run_id=d.workflow_run_id AND q.workflow_run_id=d.workflow_run_id AND v.workflow_run_id=d.workflow_run_id AND v.novel_id=n AND r.task_version_id=w.task_version_id)) OR(d.kind='withdraw' AND EXISTS(SELECT 1 FROM approval_withdrawal x JOIN approval_record r ON r.approval_id=x.withdrawn_approval_id WHERE x.decision_id=d.decision_id AND x.novel_id=n AND r.novel_id=n AND x.workflow_run_id=w.workflow_run_id AND r.workflow_run_id=w.workflow_run_id)))) ELSE false END`,'sql');
 fn('_ap_history','w workflow_run','jsonb',`SELECT jsonb_build_object('ok',true,'state',(SELECT to_jsonb(s) FROM approval_workflow_state s WHERE s.workflow_run_id=w.workflow_run_id),
   'reviews',(SELECT coalesce(jsonb_agg(jsonb_build_object('record',to_jsonb(r),'review',_ap_payload(r)) ORDER BY r.reviewed_at,r.review_id),'[]') FROM approval_review r WHERE r.workflow_run_id=w.workflow_run_id),
   'decisions',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('approval',(SELECT to_jsonb(a) FROM approval_record a WHERE a.approval_id=d.decision_id),'authority',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.capability_key) FROM approval_authority s WHERE s.decision_id=d.decision_id),'withdrawal',(SELECT to_jsonb(x) FROM approval_withdrawal x WHERE x.decision_id=d.decision_id),'invalidation',(SELECT to_jsonb(x) FROM approval_invalidation_record x WHERE x.approval_id=d.decision_id),'currently_usable',CASE WHEN d.kind='approve' THEN _ap_usable(d.decision_id) ELSE false END) ORDER BY d.decision_version),'[]') FROM approval_decision d WHERE d.workflow_run_id=w.workflow_run_id))`,'sql');
 fn('_ap_write_decision','op text,w workflow_run,p jsonb,ids uuid[]','jsonb',`DECLARE s approval_workflow_state;r approval_review;v validation_run;d approval_decision;sources jsonb;source record;at_time timestamptz:=clock_timestamp();cutoff timestamptz;soft jsonb;kind text;BEGIN
   SELECT * INTO STRICT s FROM approval_workflow_state WHERE workflow_run_id=w.workflow_run_id;
   IF jsonb_typeof(p->'expected_decision_version') IS DISTINCT FROM 'number' OR s.decision_version<>(p->>'expected_decision_version')::bigint THEN RETURN jsonb_build_object('ok',false,'error','DECISION_CONFLICT');END IF;
   IF op='approval:withdraw' THEN
     IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref','approval_ref','expected_decision_version']) OR s.current_decision_id IS DISTINCT FROM (p->>'approval_ref')::uuid OR NOT EXISTS(SELECT 1 FROM approval_decision prev WHERE prev.decision_id=s.current_decision_id AND prev.kind='approve') THEN RETURN jsonb_build_object('ok',false,'error','DECISION_CONFLICT');END IF;kind:='withdraw';
   ELSE
     IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref','review_ref','expected_decision_version','review_hash','confirmed_soft_constraint_ids']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
     SELECT * INTO r FROM approval_review WHERE review_id=(p->>'review_ref')::uuid AND novel_id=w.novel_id AND workflow_run_id=w.workflow_run_id;
     IF r.review_id IS NULL OR r.reviewed_by<>_caller() OR NOT _ap_review_current(r) OR p->>'review_hash' IS DISTINCT FROM r.review_hash THEN RETURN jsonb_build_object('ok',false,'error','REVIEW_STALE');END IF;
     SELECT * INTO STRICT v FROM validation_run WHERE validation_run_id=r.validation_run_id;soft:=_ap_soft_confirmation(p->'confirmed_soft_constraint_ids');
     IF soft IS DISTINCT FROM _ap_soft(v.validation_run_id) THEN RETURN jsonb_build_object('ok',false,'error','SOFT_CONFIRMATION_REQUIRED');END IF;
     IF op='approval:approve' AND v.overall<>'passed' THEN RETURN jsonb_build_object('ok',false,'error','VALIDATION_NOT_PASSED');END IF;kind:=CASE WHEN op='approval:approve' THEN 'approve' ELSE 'reject' END;
   END IF;
   SELECT jsonb_agg(jsonb_build_object('grant_id',g.grant_id,'capability_key',c.capability_key,'expires_at',g.expires_at) ORDER BY c.capability_key),min(g.expires_at) INTO sources,cutoff FROM capability_grant g JOIN capability c USING(capability_id) JOIN data_scope scope USING(data_scope_id)
     WHERE g.actor_id=_caller() AND scope.novel_id=w.novel_id AND c.capability_key IN ('design.read','design.freeze','task.read','task.create') AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at) AND NOT EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id);
   IF jsonb_array_length(sources) IS DISTINCT FROM 4 OR(cutoff IS NOT NULL AND cutoff<=clock_timestamp()) THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
   INSERT INTO approval_decision VALUES(ids[1],w.novel_id,w.workflow_run_id,s.decision_version+1,s.current_decision_id,kind,_caller(),at_time,cutoff) RETURNING * INTO d;
   FOR source IN SELECT * FROM jsonb_to_recordset(sources) AS x(grant_id uuid,capability_key text,expires_at timestamptz) LOOP INSERT INTO approval_authority VALUES(d.decision_id,source.capability_key,source.grant_id);END LOOP;
   IF kind='withdraw' THEN INSERT INTO approval_withdrawal VALUES(d.decision_id,w.novel_id,w.workflow_run_id,s.current_decision_id);
   ELSE INSERT INTO approval_record VALUES(d.decision_id,r.review_id,w.novel_id,w.workflow_run_id,v.task_version_id,v.candidate_version_id,v.candidate_content_hash,v.context_bundle_id,v.bundle_payload_hash,v.revision_id,0,v.validation_run_id,r.validation_generation,v.release_id,v.selection_id,v.selection_version,'manual-approval-v1',r.policy_release_id,r.review_hash,soft,'finite_coverage_only_v1');END IF;
   UPDATE approval_workflow_state SET current_decision_id=d.decision_id,decision_version=d.decision_version WHERE workflow_run_id=w.workflow_run_id;
   PERFORM _ap_invalidate(w.novel_id,'DECISION_REPLACED');RETURN _ap_decision_visible(d);END;`);
 fn('api_manual_approval','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE w workflow_run;s approval_workflow_state;r approval_review;d approval_decision;v validation_run;prior approval_command_request;result jsonb;policy uuid;wid uuid;t uuid;resource uuid;typ text:='none';scope uuid;digest text;generation_no bigint;allowed boolean;BEGIN
   PERFORM _lock_authorization();allowed:=CASE WHEN op IN ('approval:approve','approval:reject','approval:withdraw','approval-policy:publish') THEN _ctx_manage(_caller(),n)
     WHEN op IN ('approval:review','approval:history','approval:current') THEN _has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n) WHEN op='approval:audit' THEN _has_capability(_caller(),'audit.read',n) ELSE false END;
   IF NOT coalesce(allowed,false) THEN PERFORM _ap_audit(audit,op,(SELECT novel_id FROM novel WHERE novel_id=n),NULL,NULL,false,'none',NULL);RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
   PERFORM 1 FROM novel WHERE novel_id=n FOR UPDATE;
   BEGIN
     IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR cardinality(ids)<>32 OR array_position(ids,NULL) IS NOT NULL OR octet_length(p::text)>30000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
     IF op='approval:audit' THEN
       IF p<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;result:=jsonb_build_object('ok',true,'events',_ap_events(n));
     ELSE
       IF op<>'approval-policy:publish' THEN
         wid:=(p->>'workflow_ref')::uuid;SELECT * INTO w FROM workflow_run WHERE workflow_run_id=wid AND novel_id=n;t:=w.task_version_id;
         IF w.workflow_run_id IS NULL THEN wid:=NULL;result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');ELSE
           PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=t) FOR UPDATE;
           SELECT * INTO w FROM workflow_run WHERE workflow_run_id=wid FOR UPDATE;
           PERFORM 1 FROM validation_policy_release WHERE release_id=_val_policy(n) FOR UPDATE;PERFORM 1 FROM approval_policy_release WHERE release_id=_ap_policy(n) FOR UPDATE;
           SELECT * INTO STRICT s FROM approval_workflow_state WHERE workflow_run_id=wid FOR UPDATE;
         END IF;
       END IF;
       IF result IS NULL THEN
         PERFORM _ap_invalidate(n,'DETECTED_UNAVAILABLE');policy:=_ap_policy(n);
         IF op IN ('approval:history','approval:current') THEN
           IF NOT _exact_keys(p,ARRAY['workflow_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
           IF op='approval:history' THEN result:=_ap_history(w);ELSE
             SELECT * INTO d FROM approval_decision WHERE decision_id=s.current_decision_id;
             IF d.decision_id IS NULL OR NOT _ap_usable(d.decision_id) THEN result:=jsonb_build_object('ok',false,'error','APPROVAL_UNAVAILABLE');ELSE result:=_ap_decision_visible(d);typ:='decision';resource:=d.decision_id;END IF;
           END IF;
         ELSE
           IF jsonb_typeof(p->'request_key') IS DISTINCT FROM 'string' OR length(p->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
           scope:=CASE WHEN op='approval-policy:publish' THEN n ELSE w.workflow_run_id END;digest:=_ap_hash('request',jsonb_build_object('operation',op,'novel_id',n,'request',p));
           SELECT * INTO prior FROM approval_command_request WHERE actor_id=_caller() AND novel_id=n AND operation=op AND scope_id=scope AND request_key=p->>'request_key';
           IF prior.request_id IS NOT NULL THEN
             IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
             ELSIF prior.resource_kind='review' THEN SELECT * INTO STRICT r FROM approval_review WHERE review_id=prior.review_id;IF _ap_review_current(r) THEN result:=_ap_review_visible(r);ELSE result:=jsonb_build_object('ok',false,'error','REVIEW_STALE');END IF;
             ELSIF prior.resource_kind='decision' THEN SELECT * INTO STRICT d FROM approval_decision WHERE decision_id=prior.decision_id;IF d.kind='approve' AND NOT _ap_usable(d.decision_id) THEN result:=jsonb_build_object('ok',false,'error','APPROVAL_UNAVAILABLE');ELSE result:=_ap_decision_visible(d);END IF;
             ELSE result:=jsonb_build_object('ok',true,'release_id',prior.policy_id);END IF;
             typ:=prior.resource_kind;resource:=coalesce(prior.review_id,prior.decision_id,prior.policy_id);
           ELSE
             IF op='approval-policy:publish' THEN
               IF NOT _exact_keys(p,ARRAY['request_key','expected_release_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
               IF policy IS DISTINCT FROM (p->>'expected_release_id')::uuid THEN result:=jsonb_build_object('ok',false,'error','VERSION_CONFLICT');ELSE
                 SELECT coalesce(max(generation),0)+1 INTO generation_no FROM approval_policy_release WHERE novel_id=n;
                 INSERT INTO approval_policy_release VALUES(ids[1],n,generation_no,policy,'manual-approval-v1',_ap_hash('policy',jsonb_build_object('policy','manual-approval-v1','scope','finite_coverage_only_v1','automatic',false)),_caller(),clock_timestamp());
                 result:=jsonb_build_object('ok',true,'release_id',ids[1]);typ:='policy';resource:=ids[1];
               END IF;
             ELSIF op='approval:review' THEN
               IF NOT _exact_keys(p,ARRAY['request_key','workflow_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
               IF policy IS NULL OR s.current_validation_run_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','NO_CURRENT_VALIDATION');ELSE
                 SELECT * INTO STRICT v FROM validation_run WHERE validation_run_id=s.current_validation_run_id;
                 IF NOT _val_applicable(v) OR NOT _ap_validation_complete(v.validation_run_id) THEN result:=jsonb_build_object('ok',false,'error','REVIEW_STALE');ELSE
                   INSERT INTO approval_review VALUES(ids[1],n,w.workflow_run_id,v.validation_run_id,s.validation_generation,policy,s.decision_version,'approval-review-v1','computed',_caller(),clock_timestamp()) RETURNING * INTO r;
                   result:=_ap_review_visible(r);typ:='review';resource:=r.review_id;
                 END IF;
               END IF;
             ELSE result:=_ap_write_decision(op,w,p,ids);IF(result->>'ok')::boolean THEN typ:='decision';resource:=(result->>'decision_ref')::uuid;END IF;END IF;
             IF(result->>'ok')::boolean THEN INSERT INTO approval_command_request VALUES(ids[32],_caller(),n,op,scope,p->>'request_key',digest,typ,CASE WHEN typ='review' THEN resource END,CASE WHEN typ='decision' THEN resource END,CASE WHEN typ='policy' THEN resource END);END IF;
           END IF;
         END IF;
       END IF;
     END IF;
   EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range THEN result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');typ:='none';resource:=NULL;
   END;
   IF NOT(result->>'ok')::boolean THEN typ:='none';resource:=NULL;END IF;PERFORM _ap_audit(audit,op,n,t,wid,(result->>'ok')::boolean,typ,resource);RETURN result;END;`);
 // Same policy contents may be republished, but predecessor generation is still exact.
 fn('_ap_policy_guard','','trigger',`BEGIN IF NEW.content_hash<>_ap_hash('policy',jsonb_build_object('policy','manual-approval-v1','scope','finite_coverage_only_v1','automatic',false)) OR(NEW.generation>1 AND NOT EXISTS(SELECT 1 FROM approval_policy_release WHERE release_id=NEW.previous_release_id AND novel_id=NEW.novel_id AND generation=NEW.generation-1)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='APPROVAL_POLICY_INVALID';END IF;RETURN NEW;END;`);
 fn('_val_response','r validation_run','jsonb',`SELECT jsonb_build_object('ok',true,'recorded',true,'validation_ref',r.validation_run_id,'overall',r.overall,'current_applicable',_val_applicable(r),'covered_checks_pass',r.overall='passed' AND _val_applicable(r),'approval_implemented',true,'automatic_approval',false)`,'sql');
 sql('ALTER FUNCTION agent_book.api_read_audit(uuid,uuid) RENAME TO _read_audit_pre_approval;');
 fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE r jsonb;BEGIN r:=_read_audit_pre_approval(p_novel,p_audit);IF(r->>'ok')::boolean THEN RETURN jsonb_set(r,'{events}',(r->'events')||_ap_events(p_novel));END IF;RETURN r;END;`);
 for(const table of ['approval_policy_release','approval_validation_epoch','approval_review','approval_decision','approval_record','approval_authority','approval_withdrawal','approval_invalidation_record','approval_command_request','approval_access_audit'])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
 sql(`CREATE TRIGGER approval_head_guard BEFORE UPDATE OR DELETE ON agent_book.approval_workflow_state FOR EACH ROW EXECUTE FUNCTION agent_book._ap_state_guard();CREATE TRIGGER approval_head_truncate BEFORE TRUNCATE ON agent_book.approval_workflow_state FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();
   CREATE TRIGGER approval_workflow_init AFTER INSERT ON agent_book.workflow_run FOR EACH ROW EXECUTE FUNCTION agent_book._ap_change();
   CREATE TRIGGER approval_validation_epoch AFTER INSERT ON agent_book.validation_run FOR EACH ROW EXECUTE FUNCTION agent_book._ap_validation_insert();
   CREATE TRIGGER approval_review_guard BEFORE INSERT ON agent_book.approval_review FOR EACH ROW EXECUTE FUNCTION agent_book._ap_review_guard();
   CREATE TRIGGER approval_record_guard BEFORE INSERT ON agent_book.approval_record FOR EACH ROW EXECUTE FUNCTION agent_book._ap_record_guard();
   CREATE TRIGGER approval_policy_guard BEFORE INSERT ON agent_book.approval_policy_release FOR EACH ROW EXECUTE FUNCTION agent_book._ap_policy_guard();`);
 for(const table of ['approval_workflow_state','approval_decision','approval_validation_epoch'])sql(`CREATE CONSTRAINT TRIGGER approval_state_complete AFTER INSERT OR UPDATE ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._ap_state_complete();`);
 for(const table of ['approval_decision','approval_record','approval_authority','approval_withdrawal'])sql(`CREATE CONSTRAINT TRIGGER approval_decision_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._ap_decision_complete();`);
 for(const [table,event]of [['workflow_run','UPDATE'],['scene_task','UPDATE'],['design_head','UPDATE'],['safe_projection_revocation','INSERT'],['safe_projection_supersession','INSERT'],['context_policy_release','INSERT'],['validation_policy_release','INSERT'],['approval_policy_release','INSERT'],['grant_revocation','INSERT'],['context_grant_revocation','INSERT'],['manual_writing_revocation','INSERT']])sql(`CREATE TRIGGER approval_source_invalidation AFTER ${event} ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._ap_source_changed();`);
 sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
 DO $acl$ DECLARE login record;BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION agent_book._read_audit_pre_approval(uuid,uuid) FROM %I',login.db_login);
   IF login.role_key IN ('author','auditor') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_manual_approval(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);END IF;
   IF login.role_key='auditor' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_read_audit(uuid,uuid) TO %I',login.db_login);END IF;END LOOP;END $acl$;`);
 // Backfill after all DDL: deferred FK checks on existing workflows must not precede ALTER/CREATE TRIGGER.
 sql('INSERT INTO agent_book.approval_workflow_state(workflow_run_id) SELECT workflow_run_id FROM agent_book.workflow_run;');
}
export async function down(){throw new Error('Use a reviewed forward migration');}
