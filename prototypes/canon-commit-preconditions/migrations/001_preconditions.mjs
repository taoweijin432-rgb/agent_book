const schema = 'canon_commit_precondition_fixture';
const path = `pg_catalog, ${schema}, pg_temp`;

export async function up(pgm) {
  const sql = (value) => pgm.sql(value);
  const fn = (name, args, returns, body, language = 'plpgsql') => sql(`CREATE FUNCTION ${schema}.${name}(${args}) RETURNS ${returns} LANGUAGE ${language} SET search_path = ${path} AS $fn$ ${body} $fn$;`);
  sql(`
    CREATE TABLE ${schema}.novel (project_id text PRIMARY KEY);
    CREATE TABLE ${schema}.author_design_revision (
      revision_id text PRIMARY KEY, project_id text NOT NULL REFERENCES ${schema}.novel,
      status text NOT NULL CHECK(status IN ('draft','frozen')), content jsonb NOT NULL);
    CREATE TABLE ${schema}.rule_version (version_id text PRIMARY KEY, content jsonb NOT NULL);
    CREATE TABLE ${schema}.approval_policy_version (version_id text PRIMARY KEY, content jsonb NOT NULL);
    CREATE TABLE ${schema}.baseline_history (
      project_id text NOT NULL REFERENCES ${schema}.novel, baseline_version integer NOT NULL CHECK(baseline_version>0),
      revision_id text NOT NULL REFERENCES ${schema}.author_design_revision,
      canon_watermark bigint NOT NULL CHECK(canon_watermark>=0),
      rule_version text NOT NULL REFERENCES ${schema}.rule_version,
      approval_policy_version text NOT NULL REFERENCES ${schema}.approval_policy_version,
      PRIMARY KEY(project_id,baseline_version));
    CREATE VIEW ${schema}.current_baseline AS SELECT DISTINCT ON(project_id) * FROM ${schema}.baseline_history ORDER BY project_id,baseline_version DESC;
    CREATE TABLE ${schema}.scene_task_version (
      task_version_id text PRIMARY KEY, project_id text NOT NULL REFERENCES ${schema}.novel,
      revision_id text NOT NULL REFERENCES ${schema}.author_design_revision,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark>=0), content jsonb NOT NULL);
    CREATE TABLE ${schema}.context_bundle (
      bundle_id text PRIMARY KEY, task_version_id text NOT NULL REFERENCES ${schema}.scene_task_version,
      content text NOT NULL, content_hash text NOT NULL);
    CREATE TABLE ${schema}.workflow_identity (
      workflow_id text PRIMARY KEY, task_version_id text NOT NULL REFERENCES ${schema}.scene_task_version);
    CREATE TABLE ${schema}.generation_run (
      generation_id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES ${schema}.workflow_identity,
      bundle_id text NOT NULL REFERENCES ${schema}.context_bundle, input_bundle_hash text NOT NULL);
    CREATE TABLE ${schema}.candidate_version (
      candidate_version_id text PRIMARY KEY, workflow_id text NOT NULL REFERENCES ${schema}.workflow_identity,
      bundle_id text NOT NULL REFERENCES ${schema}.context_bundle,
      generation_id text REFERENCES ${schema}.generation_run,
      predecessor_id text REFERENCES ${schema}.candidate_version,
      origin text NOT NULL CHECK(origin IN ('model','human_edit')),
      bundle_basis text NOT NULL CHECK(bundle_basis IN ('direct','inherited')),
      edit_basis text, body text NOT NULL, content_hash text NOT NULL,
      CHECK((origin='model' AND generation_id IS NOT NULL AND predecessor_id IS NULL AND edit_basis IS NULL AND bundle_basis='direct')
         OR (origin='human_edit' AND predecessor_id IS NOT NULL AND edit_basis IS NOT NULL AND length(edit_basis)>0)));
    CREATE TABLE ${schema}.candidate_selection_history (
      workflow_id text NOT NULL REFERENCES ${schema}.workflow_identity,
      selection_version integer NOT NULL CHECK(selection_version>0),
      previous_candidate_id text REFERENCES ${schema}.candidate_version,
      candidate_version_id text REFERENCES ${schema}.candidate_version,
      PRIMARY KEY(workflow_id,selection_version));
    CREATE VIEW ${schema}.workflow_run AS SELECT w.workflow_id,w.task_version_id,
      h.candidate_version_id AS current_candidate_id,coalesce(h.selection_version,0) AS current_selection_version,
      CASE WHEN h.candidate_version_id IS NULL THEN 'unselected' ELSE 'selected' END::text AS state
      FROM ${schema}.workflow_identity w LEFT JOIN LATERAL
      (SELECT * FROM ${schema}.candidate_selection_history s WHERE s.workflow_id=w.workflow_id ORDER BY selection_version DESC LIMIT 1) h ON true;
    CREATE TABLE ${schema}.validation_run (
      validation_run_id text PRIMARY KEY, candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      request_key text NOT NULL, author_design_revision_id text NOT NULL REFERENCES ${schema}.author_design_revision,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark>=0), rule_set_version text NOT NULL REFERENCES ${schema}.rule_version,
      validator_version text NOT NULL CHECK(validator_version='fixture-validator-v1'),
      input_hash text NOT NULL, result text NOT NULL CHECK(result IN ('running','pass','fail','inconclusive','invalidated')),
      UNIQUE(candidate_version_id,request_key));
    CREATE TABLE ${schema}.validation_hard_issue (
      issue_id text PRIMARY KEY, validation_run_id text NOT NULL REFERENCES ${schema}.validation_run,
      rule_code text NOT NULL, resolved boolean NOT NULL);
    CREATE TABLE ${schema}.approval_record (
      approval_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      request_key text NOT NULL, candidate_content_hash text NOT NULL,
      context_bundle_id text NOT NULL REFERENCES ${schema}.context_bundle,
      author_design_revision_id text NOT NULL REFERENCES ${schema}.author_design_revision,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark>=0),
      validation_run_id text NOT NULL REFERENCES ${schema}.validation_run,
      approval_policy_version text NOT NULL REFERENCES ${schema}.approval_policy_version,
      decision text NOT NULL CHECK(decision IN ('approved','rejected')),
      actor text NOT NULL CHECK(length(actor)>0), reason text NOT NULL CHECK(length(reason)>0),
      decided_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(candidate_version_id,request_key));
    CREATE TABLE ${schema}.approval_invalidation_record (
      invalidation_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      approval_id text NOT NULL REFERENCES ${schema}.approval_record,
      reason_code text NOT NULL CHECK(length(reason_code)>0), trigger_type text NOT NULL CHECK(length(trigger_type)>0),
      trigger_version text NOT NULL CHECK(length(trigger_version)>0), detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(approval_id,reason_code,trigger_version));
    CREATE TABLE ${schema}.operation_audit (
      audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, project_id text NOT NULL REFERENCES ${schema}.novel,
      event_kind text NOT NULL, subject_id text NOT NULL, evidence jsonb NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
  `);
  fn('digest_text', 'value text', 'text', "SELECT encode(sha256(convert_to(value,'UTF8')),'hex')", 'sql');
  fn('reject', 'reason text', 'void', "BEGIN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE=reason,CONSTRAINT=reason; END;");
  fn('immutable', '', 'trigger', "BEGIN PERFORM reject('immutable_'||TG_TABLE_NAME); RETURN NULL; END;");
  fn('readonly_view', '', 'trigger', "BEGIN PERFORM reject('readonly_'||TG_TABLE_NAME); RETURN NULL; END;");
  // Novel is the stable guard even when no Approval Invalidation row exists. All legal writers take it first.
  fn('lock_scope', 'p_project text', 'void', `BEGIN
    IF current_setting('transaction_isolation') <> 'read committed' THEN PERFORM reject('read_committed_required'); END IF;
    PERFORM 1 FROM novel WHERE project_id=p_project FOR UPDATE;
    IF NOT FOUND THEN PERFORM reject('project_missing'); END IF;
    PERFORM 1 FROM workflow_identity w JOIN scene_task_version t USING(task_version_id) WHERE t.project_id=p_project ORDER BY w.workflow_id FOR UPDATE OF w;
    PERFORM 1 FROM candidate_selection_history h JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id)
      WHERE t.project_id=p_project ORDER BY h.workflow_id,h.selection_version FOR UPDATE OF h;
    PERFORM 1 FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id)
      WHERE t.project_id=p_project ORDER BY c.candidate_version_id FOR UPDATE OF c;
    PERFORM 1 FROM approval_record a JOIN candidate_version c USING(candidate_version_id) JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id)
      WHERE t.project_id=p_project ORDER BY a.approval_id FOR UPDATE OF a;
    PERFORM 1 FROM validation_run v JOIN candidate_version c USING(candidate_version_id) JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id)
      WHERE t.project_id=p_project ORDER BY v.validation_run_id FOR UPDATE OF v;
  END;`);
  fn('workflow_project', 'p_workflow text', 'text', `SELECT t.project_id FROM workflow_identity w JOIN scene_task_version t USING(task_version_id) WHERE w.workflow_id=p_workflow`, 'sql');
  fn('candidate_project', 'p_candidate text', 'text', `SELECT workflow_project(c.workflow_id) FROM candidate_version c WHERE c.candidate_version_id=p_candidate`, 'sql');
  fn('validation_input_hash', 'p_candidate text,p_design text,p_canon bigint,p_rule text', 'text', `
    SELECT digest_text(jsonb_build_array('validation-input-v1',c.candidate_version_id,digest_text(c.body),c.workflow_id,w.task_version_id,
      c.bundle_id,digest_text(b.content),t.content,p_design,d.content,p_canon,p_rule,r.content,'fixture-validator-v1')::text)
    FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id)
    JOIN context_bundle b ON b.bundle_id=c.bundle_id JOIN author_design_revision d ON d.revision_id=p_design
    JOIN rule_version r ON r.version_id=p_rule WHERE c.candidate_version_id=p_candidate`, 'sql');
  fn('input_guard', '', 'trigger', `DECLARE p text; w workflow_identity; b context_bundle; t scene_task_version; g generation_run; prior candidate_version;
  BEGIN
    IF TG_TABLE_NAME IN ('author_design_revision','scene_task_version') THEN p:=NEW.project_id;
    ELSIF TG_TABLE_NAME IN ('workflow_identity','context_bundle') THEN SELECT project_id INTO p FROM scene_task_version WHERE task_version_id=NEW.task_version_id;
    ELSIF TG_TABLE_NAME IN ('generation_run','candidate_version') THEN p:=workflow_project(NEW.workflow_id);
    ELSIF TG_TABLE_NAME='validation_run' THEN p:=candidate_project(NEW.candidate_version_id);
    ELSE SELECT candidate_project(candidate_version_id) INTO p FROM validation_run WHERE validation_run_id=NEW.validation_run_id;
    END IF;
    PERFORM lock_scope(p);
    IF TG_TABLE_NAME='scene_task_version' THEN
      IF NOT EXISTS(SELECT 1 FROM author_design_revision WHERE revision_id=NEW.revision_id AND project_id=p) THEN PERFORM reject('task_design_project'); END IF;
    ELSIF TG_TABLE_NAME='context_bundle' THEN
      IF NEW.content_hash IS DISTINCT FROM digest_text(NEW.content) THEN PERFORM reject('bundle_actual_hash'); END IF;
    ELSIF TG_TABLE_NAME IN ('generation_run','candidate_version') THEN
      SELECT * INTO w FROM workflow_identity WHERE workflow_id=NEW.workflow_id;
      SELECT * INTO b FROM context_bundle WHERE bundle_id=NEW.bundle_id;
      IF b.task_version_id IS DISTINCT FROM w.task_version_id THEN PERFORM reject('bundle_task_chain'); END IF;
      IF TG_TABLE_NAME='generation_run' THEN
        IF NEW.input_bundle_hash IS DISTINCT FROM b.content_hash THEN PERFORM reject('generation_bundle_hash'); END IF;
      ELSE
        IF NEW.content_hash IS DISTINCT FROM digest_text(NEW.body) THEN PERFORM reject('candidate_actual_hash'); END IF;
        IF NEW.generation_id IS NOT NULL THEN
          SELECT * INTO g FROM generation_run WHERE generation_id=NEW.generation_id;
          IF g.workflow_id IS DISTINCT FROM NEW.workflow_id OR g.bundle_id IS DISTINCT FROM NEW.bundle_id THEN PERFORM reject('candidate_generation_chain'); END IF;
        END IF;
        IF NEW.predecessor_id IS NOT NULL THEN
          SELECT * INTO prior FROM candidate_version WHERE candidate_version_id=NEW.predecessor_id;
          IF prior.workflow_id IS DISTINCT FROM NEW.workflow_id THEN PERFORM reject('predecessor_workflow'); END IF;
          IF NEW.bundle_basis='inherited' AND prior.bundle_id IS DISTINCT FROM NEW.bundle_id THEN PERFORM reject('inherited_bundle'); END IF;
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME='validation_run' THEN
      SELECT st.* INTO t FROM candidate_version c JOIN workflow_identity wi USING(workflow_id) JOIN scene_task_version st USING(task_version_id) WHERE c.candidate_version_id=NEW.candidate_version_id;
      IF NEW.author_design_revision_id IS DISTINCT FROM t.revision_id OR NEW.input_canon_watermark IS DISTINCT FROM t.input_canon_watermark THEN PERFORM reject('validation_snapshot'); END IF;
      IF NEW.input_hash IS DISTINCT FROM validation_input_hash(NEW.candidate_version_id,NEW.author_design_revision_id,NEW.input_canon_watermark,NEW.rule_set_version) THEN PERFORM reject('validation_input_hash'); END IF;
    END IF;
    RETURN NEW;
  END;`);
  fn('selection_guard', '', 'trigger', `DECLARE w workflow_run;
  BEGIN
    PERFORM lock_scope(workflow_project(NEW.workflow_id)); SELECT * INTO w FROM workflow_run WHERE workflow_id=NEW.workflow_id;
    IF NEW.selection_version<>w.current_selection_version+1 THEN PERFORM reject('selection_version_conflict'); END IF;
    IF NEW.previous_candidate_id IS DISTINCT FROM w.current_candidate_id THEN PERFORM reject('selection_previous_mismatch'); END IF;
    IF NEW.candidate_version_id IS NOT DISTINCT FROM w.current_candidate_id THEN PERFORM reject('selection_no_change'); END IF;
    IF NEW.candidate_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM candidate_version WHERE candidate_version_id=NEW.candidate_version_id AND workflow_id=NEW.workflow_id) THEN PERFORM reject('selection_candidate_workflow'); END IF;
    RETURN NEW;
  END;`);
  fn('invalidation_guard', '', 'trigger', `DECLARE p text;
  BEGIN
    SELECT candidate_project(candidate_version_id) INTO p FROM approval_record WHERE approval_id=NEW.approval_id;
    PERFORM lock_scope(p);
    IF EXISTS(SELECT 1 FROM approval_invalidation_record WHERE approval_id=NEW.approval_id AND reason_code=NEW.reason_code AND trigger_version=NEW.trigger_version AND trigger_type IS DISTINCT FROM NEW.trigger_type) THEN PERFORM reject('invalidation_identity_conflict'); END IF;
    RETURN NEW;
  END;`);
  fn('selection_effects', '', 'trigger', `BEGIN
    INSERT INTO approval_invalidation_record(approval_id,reason_code,trigger_type,trigger_version)
      SELECT a.approval_id,'selection_changed','selection',NEW.workflow_id||':'||NEW.selection_version FROM approval_record a JOIN candidate_version c USING(candidate_version_id)
      WHERE c.workflow_id=NEW.workflow_id ORDER BY a.approval_id ON CONFLICT(approval_id,reason_code,trigger_version) DO NOTHING;
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence) VALUES(workflow_project(NEW.workflow_id),'selection',NEW.workflow_id,to_jsonb(NEW));
    RETURN NEW;
  END;`);
  fn('baseline_guard', '', 'trigger', `DECLARE prior current_baseline;
  BEGIN
    PERFORM lock_scope(NEW.project_id); SELECT * INTO prior FROM current_baseline WHERE project_id=NEW.project_id;
    IF NEW.baseline_version<>coalesce(prior.baseline_version,0)+1 THEN PERFORM reject('baseline_version_conflict'); END IF;
    IF NOT EXISTS(SELECT 1 FROM author_design_revision WHERE revision_id=NEW.revision_id AND project_id=NEW.project_id) THEN PERFORM reject('baseline_design_project'); END IF;
    IF NEW.canon_watermark<coalesce(prior.canon_watermark,0) THEN PERFORM reject('fixture_watermark_regression'); END IF;
    IF prior.project_id IS NOT NULL AND ROW(NEW.revision_id,NEW.canon_watermark,NEW.rule_version,NEW.approval_policy_version) IS NOT DISTINCT FROM ROW(prior.revision_id,prior.canon_watermark,prior.rule_version,prior.approval_policy_version) THEN PERFORM reject('baseline_no_change'); END IF;
    RETURN NEW;
  END;`);
  fn('baseline_effects', '', 'trigger', `BEGIN
    INSERT INTO approval_invalidation_record(approval_id,reason_code,trigger_type,trigger_version)
      SELECT a.approval_id,'baseline_changed','baseline',NEW.project_id||':'||NEW.baseline_version FROM approval_record a
      WHERE candidate_project(a.candidate_version_id)=NEW.project_id ORDER BY a.approval_id ON CONFLICT(approval_id,reason_code,trigger_version) DO NOTHING;
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence) VALUES(NEW.project_id,'baseline',NEW.project_id,to_jsonb(NEW));
    RETURN NEW;
  END;`);
  // Reasons are shared by Approval creation and admission. Admission always recalculates them under the stable Novel lock.
  fn('candidate_reasons', 'p_candidate text,p_validation text', 'text[]', `DECLARE c candidate_version; w workflow_run; t scene_task_version; b context_bundle; g generation_run; v validation_run; d author_design_revision; base current_baseline; reasons text[]:='{}';
  BEGIN
    SELECT * INTO c FROM candidate_version WHERE candidate_version_id=p_candidate;
    IF NOT FOUND THEN RETURN ARRAY['candidate_missing']; END IF;
    SELECT * INTO w FROM workflow_run WHERE workflow_id=c.workflow_id;
    SELECT * INTO t FROM scene_task_version WHERE task_version_id=w.task_version_id;
    SELECT * INTO b FROM context_bundle WHERE bundle_id=c.bundle_id;
    SELECT * INTO base FROM current_baseline WHERE project_id=t.project_id;
    SELECT * INTO d FROM author_design_revision WHERE revision_id=t.revision_id;
    SELECT * INTO v FROM validation_run WHERE validation_run_id=p_validation;
    IF w.current_candidate_id IS DISTINCT FROM p_candidate THEN reasons:=array_append(reasons,'not_current_candidate'); END IF;
    IF b.task_version_id IS DISTINCT FROM w.task_version_id THEN reasons:=array_append(reasons,'bundle_task_chain'); END IF;
    IF c.content_hash IS DISTINCT FROM digest_text(c.body) THEN reasons:=array_append(reasons,'candidate_actual_hash'); END IF;
    IF b.content_hash IS DISTINCT FROM digest_text(b.content) THEN reasons:=array_append(reasons,'bundle_actual_hash'); END IF;
    IF c.generation_id IS NOT NULL THEN
      SELECT * INTO g FROM generation_run WHERE generation_id=c.generation_id;
      IF g.workflow_id IS DISTINCT FROM c.workflow_id OR g.bundle_id IS DISTINCT FROM c.bundle_id OR g.input_bundle_hash IS DISTINCT FROM digest_text(b.content) THEN reasons:=array_append(reasons,'generation_chain'); END IF;
    END IF;
    IF d.status IS DISTINCT FROM 'frozen' THEN reasons:=array_append(reasons,'design_not_frozen'); END IF;
    IF base.revision_id IS DISTINCT FROM t.revision_id THEN reasons:=array_append(reasons,'design_baseline_changed'); END IF;
    IF base.canon_watermark IS DISTINCT FROM t.input_canon_watermark THEN reasons:=array_append(reasons,'canon_baseline_changed'); END IF;
    IF v.validation_run_id IS NULL THEN reasons:=array_append(reasons,'validation_missing'); RETURN reasons; END IF;
    IF v.candidate_version_id IS DISTINCT FROM p_candidate OR v.author_design_revision_id IS DISTINCT FROM t.revision_id OR v.input_canon_watermark IS DISTINCT FROM t.input_canon_watermark THEN reasons:=array_append(reasons,'validation_binding'); END IF;
    IF v.input_hash IS DISTINCT FROM validation_input_hash(p_candidate,t.revision_id,t.input_canon_watermark,v.rule_set_version) THEN reasons:=array_append(reasons,'validation_input_hash'); END IF;
    IF v.rule_set_version IS DISTINCT FROM base.rule_version THEN reasons:=array_append(reasons,'validation_rules_changed'); END IF;
    IF v.result IS DISTINCT FROM 'pass' THEN reasons:=array_append(reasons,'validation_'||coalesce(v.result,'missing')); END IF;
    IF EXISTS(SELECT 1 FROM validation_hard_issue WHERE validation_run_id=p_validation AND NOT resolved) THEN reasons:=array_append(reasons,'unresolved_hard_issue'); END IF;
    RETURN reasons;
  END;`);
  fn('approval_binding', 'a approval_record', 'jsonb', `SELECT jsonb_build_object('candidate_version_id',a.candidate_version_id,'candidate_content_hash',a.candidate_content_hash,
    'context_bundle_id',a.context_bundle_id,'author_design_revision_id',a.author_design_revision_id,'input_canon_watermark',a.input_canon_watermark,
    'validation_run_id',a.validation_run_id,'approval_policy_version',a.approval_policy_version)`, 'sql');
  fn('approval_guard', '', 'trigger', `DECLARE c candidate_version; w workflow_run; t scene_task_version; base current_baseline; reasons text[];
  BEGIN
    PERFORM lock_scope(candidate_project(NEW.candidate_version_id));
    SELECT * INTO c FROM candidate_version WHERE candidate_version_id=NEW.candidate_version_id;
    SELECT * INTO w FROM workflow_run WHERE workflow_id=c.workflow_id;
    SELECT * INTO t FROM scene_task_version WHERE task_version_id=w.task_version_id;
    SELECT * INTO base FROM current_baseline WHERE project_id=t.project_id;
    IF w.current_candidate_id IS DISTINCT FROM NEW.candidate_version_id THEN PERFORM reject('approval_not_current'); END IF;
    IF NEW.candidate_content_hash IS DISTINCT FROM c.content_hash THEN PERFORM reject('approval_content_hash'); END IF;
    IF NEW.context_bundle_id IS DISTINCT FROM c.bundle_id THEN PERFORM reject('approval_bundle'); END IF;
    IF NEW.author_design_revision_id IS DISTINCT FROM t.revision_id THEN PERFORM reject('approval_design'); END IF;
    IF NEW.input_canon_watermark IS DISTINCT FROM t.input_canon_watermark THEN PERFORM reject('approval_canon'); END IF;
    IF NEW.approval_policy_version IS DISTINCT FROM base.approval_policy_version THEN PERFORM reject('approval_policy'); END IF;
    IF NOT EXISTS(SELECT 1 FROM validation_run WHERE validation_run_id=NEW.validation_run_id AND candidate_version_id=NEW.candidate_version_id) THEN PERFORM reject('approval_validation'); END IF;
    IF NEW.decision='approved' THEN
      reasons:=candidate_reasons(NEW.candidate_version_id,NEW.validation_run_id);
      IF cardinality(reasons)>0 THEN PERFORM reject(reasons[1]); END IF;
    END IF;
    RETURN NEW;
  END;`);
  fn('approval_effects', '', 'trigger', `BEGIN
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence)
      SELECT candidate_project(NEW.candidate_version_id),'approval',NEW.approval_id,
        jsonb_build_object('binding',approval_binding(NEW),'decision',NEW.decision,'actor',NEW.actor,'reason',NEW.reason,
          'selection_version_evidence',w.current_selection_version,'evidence_contract','fixture-approval-evidence-v1')
      FROM candidate_version c JOIN workflow_run w USING(workflow_id) WHERE c.candidate_version_id=NEW.candidate_version_id;
    RETURN NEW;
  END;`);
  fn('invalidation_effects', '', 'trigger', `BEGIN
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence)
      SELECT candidate_project(candidate_version_id),'invalidation',NEW.invalidation_id,to_jsonb(NEW) FROM approval_record WHERE approval_id=NEW.approval_id;
    RETURN NEW;
  END;`);
  fn('select_candidate', 'p_workflow text,p_candidate text,p_expected integer', 'jsonb', `DECLARE w workflow_run;
  BEGIN
    PERFORM lock_scope(workflow_project(p_workflow)); SELECT * INTO w FROM workflow_run WHERE workflow_id=p_workflow;
    IF p_expected IS DISTINCT FROM w.current_selection_version THEN PERFORM reject('selection_version_conflict'); END IF;
    IF w.current_candidate_id IS NOT DISTINCT FROM p_candidate THEN RETURN jsonb_build_object('result','no_change','selection_version',w.current_selection_version); END IF;
    INSERT INTO candidate_selection_history VALUES(p_workflow,w.current_selection_version+1,w.current_candidate_id,p_candidate);
    RETURN jsonb_build_object('result','changed','selection_version',w.current_selection_version+1,'candidate_version_id',p_candidate);
  END;`);
  fn('record_approval', 'p_candidate text,p_key text,p_binding jsonb,p_decision text,p_actor text,p_reason text', 'jsonb', `DECLARE old approval_record; fresh approval_record; payload jsonb;
  BEGIN
    PERFORM lock_scope(candidate_project(p_candidate));
    SELECT * INTO old FROM approval_record WHERE candidate_version_id=p_candidate AND request_key=p_key;
    IF FOUND THEN
      IF p_binding IS DISTINCT FROM approval_binding(old) OR ROW(p_decision,p_actor,p_reason) IS DISTINCT FROM ROW(old.decision,old.actor,old.reason) THEN PERFORM reject('approval_request_conflict'); END IF;
      RETURN jsonb_build_object('result','replayed','approval',to_jsonb(old));
    END IF;
    IF jsonb_typeof(p_binding) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_binding))<>7 OR p_binding->>'candidate_version_id' IS DISTINCT FROM p_candidate THEN PERFORM reject('approval_binding_shape'); END IF;
    payload:=p_binding||jsonb_build_object('candidate_version_id',p_candidate,'request_key',p_key,'decision',p_decision,'actor',p_actor,'reason',p_reason);
    SELECT * INTO fresh FROM jsonb_populate_record(NULL::approval_record,payload);
    INSERT INTO approval_record(candidate_version_id,request_key,candidate_content_hash,context_bundle_id,author_design_revision_id,input_canon_watermark,validation_run_id,approval_policy_version,decision,actor,reason)
      VALUES(fresh.candidate_version_id,fresh.request_key,fresh.candidate_content_hash,fresh.context_bundle_id,fresh.author_design_revision_id,fresh.input_canon_watermark,fresh.validation_run_id,fresh.approval_policy_version,fresh.decision,fresh.actor,fresh.reason) RETURNING * INTO fresh;
    RETURN jsonb_build_object('result','created','approval',to_jsonb(fresh));
  END;`);
  fn('invalidate_approval', 'p_approval text,p_reason text,p_type text,p_version text', 'jsonb', `DECLARE inv approval_invalidation_record; p text;
  BEGIN
    SELECT candidate_project(candidate_version_id) INTO p FROM approval_record WHERE approval_id=p_approval;
    PERFORM lock_scope(p);
    SELECT * INTO inv FROM approval_invalidation_record WHERE approval_id=p_approval AND reason_code=p_reason AND trigger_version=p_version;
    IF FOUND THEN
      IF inv.trigger_type IS DISTINCT FROM p_type THEN PERFORM reject('invalidation_identity_conflict'); END IF;
      RETURN jsonb_build_object('result','replayed','invalidation',to_jsonb(inv));
    END IF;
    INSERT INTO approval_invalidation_record(approval_id,reason_code,trigger_type,trigger_version) VALUES(p_approval,p_reason,p_type,p_version) RETURNING * INTO inv;
    RETURN jsonb_build_object('result','created','invalidation',to_jsonb(inv));
  END;`);
  fn('change_baseline', 'p_project text,p_expected integer,p_design text,p_canon bigint,p_rule text,p_policy text', 'jsonb', `DECLARE b baseline_history;
  BEGIN
    PERFORM lock_scope(p_project);
    INSERT INTO baseline_history VALUES(p_project,p_expected+1,p_design,p_canon,p_rule,p_policy) RETURNING * INTO b;
    RETURN to_jsonb(b);
  END;`);
  fn('check_admission', 'p_project text,p_workflow text,p_candidate text,p_approval text,p_expected integer', 'jsonb', `DECLARE c candidate_version; w workflow_run; t scene_task_version; a approval_record; b current_baseline; reasons text[]; result jsonb; latest candidate_selection_history;
  BEGIN
    SELECT * INTO c FROM candidate_version WHERE candidate_version_id=p_candidate;
    IF c.candidate_version_id IS NULL THEN RETURN jsonb_build_object('accepted',false,'reasons',ARRAY['candidate_missing']); END IF;
    PERFORM lock_scope(candidate_project(p_candidate));
    SELECT * INTO c FROM candidate_version WHERE candidate_version_id=p_candidate;
    SELECT * INTO w FROM workflow_run WHERE workflow_id=c.workflow_id;
    SELECT * INTO t FROM scene_task_version WHERE task_version_id=w.task_version_id;
    SELECT * INTO b FROM current_baseline WHERE project_id=t.project_id;
    SELECT * INTO a FROM approval_record WHERE approval_id=p_approval;
    SELECT * INTO latest FROM candidate_selection_history WHERE workflow_id=w.workflow_id ORDER BY selection_version DESC LIMIT 1;
    reasons:='{}';
    IF t.project_id IS DISTINCT FROM p_project THEN reasons:=array_append(reasons,'project_mismatch'); END IF;
    IF c.workflow_id IS DISTINCT FROM p_workflow THEN reasons:=array_append(reasons,'workflow_mismatch'); END IF;
    IF w.current_selection_version IS DISTINCT FROM p_expected THEN reasons:=array_append(reasons,'selection_version_conflict'); END IF;
    IF w.current_selection_version IS DISTINCT FROM coalesce(latest.selection_version,0) OR w.current_candidate_id IS DISTINCT FROM latest.candidate_version_id THEN reasons:=array_append(reasons,'selection_history_mismatch'); END IF;
    IF a.approval_id IS NULL THEN reasons:=array_append(reasons,'approval_missing');
    ELSE
      IF a.candidate_version_id IS DISTINCT FROM p_candidate THEN reasons:=array_append(reasons,'approval_candidate_identity'); END IF;
      IF a.decision IS DISTINCT FROM 'approved' THEN reasons:=array_append(reasons,'approval_rejected'); END IF;
      IF a.candidate_content_hash IS DISTINCT FROM c.content_hash THEN reasons:=array_append(reasons,'approval_content_hash'); END IF;
      IF a.context_bundle_id IS DISTINCT FROM c.bundle_id THEN reasons:=array_append(reasons,'approval_bundle'); END IF;
      IF a.author_design_revision_id IS DISTINCT FROM t.revision_id THEN reasons:=array_append(reasons,'approval_design'); END IF;
      IF a.input_canon_watermark IS DISTINCT FROM t.input_canon_watermark THEN reasons:=array_append(reasons,'approval_canon'); END IF;
      IF a.approval_policy_version IS DISTINCT FROM b.approval_policy_version THEN reasons:=array_append(reasons,'approval_policy'); END IF;
      IF EXISTS(SELECT 1 FROM approval_invalidation_record WHERE approval_id=a.approval_id) THEN reasons:=array_append(reasons,'approval_invalidated'); END IF;
    END IF;
    reasons:=reasons||candidate_reasons(p_candidate,a.validation_run_id);
    result:=jsonb_build_object('accepted',cardinality(reasons)=0,'reasons',reasons,'scope','transaction_check_only',
      'actual',jsonb_build_object('project_id',t.project_id,'workflow_id',w.workflow_id,'task_version_id',t.task_version_id,
        'candidate_version_id',c.candidate_version_id,'candidate_content_hash',digest_text(c.body),'context_bundle_id',c.bundle_id,
        'selection_version',w.current_selection_version,'latest_selection_history',to_jsonb(latest),'design_revision_id',t.revision_id,'input_canon_watermark',t.input_canon_watermark,
        'baseline',to_jsonb(b),'design_status',(SELECT status FROM author_design_revision WHERE revision_id=t.revision_id),
        'bundle_actual_hash',(SELECT digest_text(content) FROM context_bundle WHERE bundle_id=c.bundle_id),'generation_id',c.generation_id,
        'approval_id',a.approval_id,'approval_decision',a.decision,'approval_binding',approval_binding(a),
        'invalidations',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.invalidation_id),'[]'::jsonb) FROM approval_invalidation_record i WHERE i.approval_id=a.approval_id),
        'validation_run_id',a.validation_run_id,'validation',(SELECT to_jsonb(v) FROM validation_run v WHERE v.validation_run_id=a.validation_run_id),
        'recomputed_validation_input_hash',validation_input_hash(p_candidate,t.revision_id,t.input_canon_watermark,(SELECT rule_set_version FROM validation_run WHERE validation_run_id=a.validation_run_id))));
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence) VALUES(t.project_id,'admission_check',p_candidate,result);
    RETURN result;
  END;`);
  const inputs = ['author_design_revision','scene_task_version','context_bundle','workflow_identity','generation_run','candidate_version','validation_run','validation_hard_issue'];
  for (const table of inputs) sql(`CREATE TRIGGER input_guard BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.input_guard();`);
  for (const [table, prefix] of [['candidate_selection_history','selection'],['baseline_history','baseline'],['approval_record','approval'],['approval_invalidation_record','invalidation']]) {
    sql(`CREATE TRIGGER ${prefix}_guard BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.${prefix}_guard();
      CREATE TRIGGER ${prefix}_effects AFTER INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.${prefix}_effects();`);
  }
  for (const table of ['novel','rule_version','approval_policy_version',...inputs,'baseline_history','candidate_selection_history','approval_record','approval_invalidation_record','operation_audit']) {
    sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.immutable();
      CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON ${schema}.${table} FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.immutable();`);
  }
  for (const view of ['workflow_run','current_baseline']) sql(`CREATE TRIGGER readonly_view INSTEAD OF INSERT OR UPDATE OR DELETE ON ${schema}.${view} FOR EACH ROW EXECUTE FUNCTION ${schema}.readonly_view();`);
}

export async function down(pgm) {
  pgm.sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
