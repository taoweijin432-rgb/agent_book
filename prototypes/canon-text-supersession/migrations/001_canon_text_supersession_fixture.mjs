const schema = 'canon_text_supersession_fixture';
const path = `pg_catalog, ${schema}, pg_temp`;

export async function up(pgm) {
  const sql = (value) => pgm.sql(value);
  const fn = (name, args, returns, body, language = 'plpgsql') => sql(`CREATE OR REPLACE FUNCTION ${schema}.${name}(${args}) RETURNS ${returns} LANGUAGE ${language} SET search_path = ${path} AS $fn$ ${body} $fn$;`);
  fn('current_watermark', 'p_project text', 'bigint', `DECLARE value bigint; BEGIN SELECT coalesce(max(success_commit_sequence),0) INTO value FROM canon_commit WHERE project_id=p_project AND result='committed'; RETURN value; END;`);
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
      rule_version text NOT NULL REFERENCES ${schema}.rule_version,
      approval_policy_version text NOT NULL REFERENCES ${schema}.approval_policy_version,
      PRIMARY KEY(project_id,baseline_version));
    CREATE VIEW ${schema}.current_baseline AS SELECT DISTINCT ON(project_id) h.*,${schema}.current_watermark(h.project_id) AS canon_watermark FROM ${schema}.baseline_history h ORDER BY project_id,baseline_version DESC;
    CREATE TABLE ${schema}.chapter (chapter_id text PRIMARY KEY, project_id text NOT NULL REFERENCES ${schema}.novel);
    CREATE TABLE ${schema}.scene (scene_id text PRIMARY KEY, chapter_id text NOT NULL REFERENCES ${schema}.chapter);
    CREATE TABLE ${schema}.canonical_text_identity_root (
      canonical_text_identity_id text PRIMARY KEY, chapter_id text NOT NULL REFERENCES ${schema}.chapter,
      scene_id text NOT NULL REFERENCES ${schema}.scene, UNIQUE(chapter_id,scene_id));
    CREATE TABLE ${schema}.scene_task_version (
      task_version_id text PRIMARY KEY, project_id text NOT NULL REFERENCES ${schema}.novel, scene_id text NOT NULL REFERENCES ${schema}.scene,
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
  fn('validation_base_hash', 'p_candidate text,p_design text,p_canon bigint,p_rule text', 'text', `
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
      IF NOT EXISTS(SELECT 1 FROM scene s JOIN chapter ch USING(chapter_id) WHERE s.scene_id=NEW.scene_id AND ch.project_id=p) THEN PERFORM reject('task_scene_project'); END IF;
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
    IF prior.project_id IS NOT NULL AND ROW(NEW.revision_id,NEW.rule_version,NEW.approval_policy_version) IS NOT DISTINCT FROM ROW(prior.revision_id,prior.rule_version,prior.approval_policy_version) THEN PERFORM reject('baseline_no_change'); END IF;
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
  fn('candidate_base_reasons', 'p_candidate text,p_validation text', 'text[]', `DECLARE c candidate_version; w workflow_run; t scene_task_version; b context_bundle; g generation_run; v validation_run; d author_design_revision; base current_baseline; reasons text[]:='{}';
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
  fn('change_baseline', 'p_project text,p_expected integer,p_design text,p_rule text,p_policy text', 'jsonb', `DECLARE b baseline_history;
  BEGIN
    PERFORM lock_scope(p_project);
    INSERT INTO baseline_history VALUES(p_project,p_expected+1,p_design,p_rule,p_policy) RETURNING * INTO b;
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
  sql(`
    CREATE TABLE ${schema}.projection_target_config (
      config_id text PRIMARY KEY, targets jsonb NOT NULL,
      CHECK(targets='[{"target":"fixture_graph","strategy_version":"fixture-graph-v1"},{"target":"fixture_vector","strategy_version":"fixture-vector-v1"}]'::jsonb));
    INSERT INTO ${schema}.projection_target_config VALUES('fixture-targets-v1','[{"target":"fixture_graph","strategy_version":"fixture-graph-v1"},{"target":"fixture_vector","strategy_version":"fixture-vector-v1"}]');
    CREATE TABLE ${schema}.canon_commit (
      canon_commit_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id text NOT NULL REFERENCES ${schema}.novel,
      workflow_id text NOT NULL REFERENCES ${schema}.workflow_identity,
      candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      selection_version integer NOT NULL, approval_id text NOT NULL REFERENCES ${schema}.approval_record,
      approval_policy_version text NOT NULL REFERENCES ${schema}.approval_policy_version,
      idempotency_key text NOT NULL CHECK(length(idempotency_key)>0),
      digest_spec_version text NOT NULL CHECK(digest_spec_version='canon-text-supersession-request-v1'),
      request_payload jsonb NOT NULL, payload_hash text NOT NULL,
      projection_config_id text NOT NULL REFERENCES ${schema}.projection_target_config,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark>=0),
      success_commit_sequence bigint NOT NULL CHECK(success_commit_sequence>0),
      canon_watermark bigint NOT NULL CHECK(canon_watermark=success_commit_sequence),
      result text NOT NULL CHECK(result='committed'),
      canonical_text_identity_id text NOT NULL REFERENCES ${schema}.canonical_text_identity_root,
      canonical_text_version_id text NOT NULL UNIQUE, created_transaction xid8 NOT NULL DEFAULT pg_current_xact_id(), committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(project_id,idempotency_key), UNIQUE(project_id,success_commit_sequence));
    CREATE TABLE ${schema}.canonical_text_version (
      canonical_text_version_id text PRIMARY KEY,
      canonical_text_identity_id text NOT NULL REFERENCES ${schema}.canonical_text_identity_root,
      version_no integer NOT NULL CHECK(version_no>0),
      canon_commit_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_commit,
      body text NOT NULL, content_hash text NOT NULL, text_length integer NOT NULL CHECK(text_length>=0),
      UNIQUE(canonical_text_identity_id,version_no));
    ALTER TABLE ${schema}.canon_commit ADD CONSTRAINT commit_text_version_fk FOREIGN KEY(canonical_text_version_id)
      REFERENCES ${schema}.canonical_text_version DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE ${schema}.canon_commit_item (
      commit_item_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,
      target_type text NOT NULL CHECK(target_type IN ('canonical_text','story_event','canon_fact','state_transition')), target_id text NOT NULL, source_mapping_id text,
      UNIQUE(canon_commit_id,target_type,target_id));
    CREATE TABLE ${schema}.canon_commit_item_text_target (
      commit_item_id text PRIMARY KEY REFERENCES ${schema}.canon_commit_item,
      canonical_text_version_id text NOT NULL UNIQUE REFERENCES ${schema}.canonical_text_version);
    CREATE TABLE ${schema}.projection_outbox (
      outbox_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,
      target text NOT NULL, scope_key text NOT NULL, scope_hash text NOT NULL,
      source_canon_watermark bigint NOT NULL, strategy_version text NOT NULL,
      event_payload jsonb NOT NULL, event_hash text NOT NULL,
      emitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(canon_commit_id,target,strategy_version));
    CREATE VIEW ${schema}.canonical_text_identity AS SELECT i.*,v.canonical_text_version_id AS current_canonical_text_version_id
      FROM ${schema}.canonical_text_identity_root i LEFT JOIN ${schema}.canonical_text_version v USING(canonical_text_identity_id)
      LEFT JOIN ${schema}.canon_commit cc ON cc.canon_commit_id=v.canon_commit_id AND cc.result='committed';
    CREATE VIEW ${schema}.canon_watermark AS SELECT n.project_id,${schema}.current_watermark(n.project_id) AS canon_watermark FROM ${schema}.novel n;
  `);
  fn('lock_novel', 'p_project text', 'void', `BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN PERFORM reject('read_committed_required'); END IF;
    PERFORM 1 FROM novel WHERE project_id=p_project FOR UPDATE;
    IF NOT FOUND THEN PERFORM reject('project_missing'); END IF;
  END;`);
  fn('structure_guard', '', 'trigger', `DECLARE p text; actual_chapter text;
  BEGIN
    IF TG_TABLE_NAME='chapter' THEN p:=NEW.project_id;
    ELSE SELECT project_id INTO p FROM chapter WHERE chapter_id=NEW.chapter_id;
    END IF;
    PERFORM lock_novel(p);
    IF TG_TABLE_NAME='canonical_text_identity_root' THEN
      SELECT chapter_id INTO actual_chapter FROM scene WHERE scene_id=NEW.scene_id;
      IF actual_chapter IS DISTINCT FROM NEW.chapter_id THEN PERFORM reject('text_identity_scene_chapter'); END IF;
    END IF;
    RETURN NEW;
  END;`);
  // Only frozen request inputs enter the digest. Live selection, invalidations and current watermark are deliberately excluded.
  fn('canonical_request', 'p_project text,r jsonb', 'jsonb', `DECLARE expected text[]:=ARRAY['digest_spec_version','mode','workflow_id','candidate_version_id','selection_version','approval_id','input_canon_watermark','canonical_text_identity_id','projection_config_id','structured_outputs'];
    c candidate_version; w workflow_identity; t scene_task_version; a approval_record; v validation_run; i canonical_text_identity_root; config projection_target_config;
  BEGIN
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN PERFORM reject('request_object_required'); END IF;
    IF r ? 'batch' THEN PERFORM reject('batch_not_supported'); END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k<>ALL(expected)) THEN PERFORM reject('unknown_request_field'); END IF;
    IF NOT r ?& expected THEN PERFORM reject('missing_request_field'); END IF;
    IF r->>'digest_spec_version' IS DISTINCT FROM 'canon-text-supersession-request-v1' THEN PERFORM reject('unknown_digest_version'); END IF;
    IF r->>'mode' IS NULL OR r->>'mode' NOT IN ('initial_text','revise_text') THEN PERFORM reject('revision_mode_not_supported'); END IF;
    PERFORM assert_request_intent(r);
    r:=normalize_request(r);
    IF EXISTS(SELECT 1 FROM unnest(ARRAY['workflow_id','candidate_version_id','approval_id','canonical_text_identity_id','projection_config_id']) k WHERE jsonb_typeof(r->k) IS DISTINCT FROM 'string' OR length(r->>k)=0) THEN PERFORM reject('request_identity_type'); END IF;
    IF jsonb_typeof(r->'selection_version') IS DISTINCT FROM 'number' OR (r->>'selection_version') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(r->'input_canon_watermark') IS DISTINCT FROM 'number' OR (r->>'input_canon_watermark') !~ '^(0|[1-9][0-9]*)$' THEN PERFORM reject('request_version_type'); END IF;
    SELECT * INTO c FROM candidate_version WHERE candidate_version_id=r->>'candidate_version_id';
    SELECT * INTO w FROM workflow_identity WHERE workflow_id=c.workflow_id;
    SELECT * INTO t FROM scene_task_version WHERE task_version_id=w.task_version_id;
    SELECT * INTO a FROM approval_record WHERE approval_id=r->>'approval_id';
    SELECT * INTO v FROM validation_run WHERE validation_run_id=a.validation_run_id;
    SELECT * INTO i FROM canonical_text_identity_root WHERE canonical_text_identity_id=r->>'canonical_text_identity_id';
    SELECT * INTO config FROM projection_target_config WHERE config_id=r->>'projection_config_id';
    IF c.candidate_version_id IS NULL OR a.approval_id IS NULL OR i.canonical_text_identity_id IS NULL OR config.config_id IS NULL THEN PERFORM reject('request_input_missing'); END IF;
    IF t.project_id IS DISTINCT FROM p_project THEN PERFORM reject('request_project_mismatch'); END IF;
    RETURN jsonb_build_array('canon-text-supersession-request-v1',p_project,r,
      jsonb_build_object('candidate_id',c.candidate_version_id,'body_hash',digest_text(c.body),'workflow_id',c.workflow_id,
        'task_version_id',t.task_version_id,'scene_id',t.scene_id,'bundle_id',c.bundle_id,
        'bundle_hash',(SELECT digest_text(content) FROM context_bundle WHERE bundle_id=c.bundle_id),
        'design_id',t.revision_id,'design_hash',(SELECT digest_text(content::text) FROM author_design_revision WHERE revision_id=t.revision_id),
        'task_input_canon',t.input_canon_watermark,'approval_id',a.approval_id,'approval_binding',approval_binding(a),'decision',a.decision,
        'validation',to_jsonb(v),'rule_hash',(SELECT digest_text(content::text) FROM rule_version WHERE version_id=v.rule_set_version),
        'approval_policy_hash',(SELECT digest_text(content::text) FROM approval_policy_version WHERE version_id=a.approval_policy_version),
        'revision_input',revision_input(c.candidate_version_id),'text_identity',to_jsonb(i),'projection_manifest',config.targets,'frozen_proposals',(SELECT manifest FROM candidate_submission_manifest WHERE candidate_version_id=c.candidate_version_id),'conversion_version','fixture-conversion-v1'));
  END;`);
  fn('scope_digest', 'p_project text,p_scene text', 'text', `SELECT digest_text(jsonb_build_array('fixture-scene-scope-v1',p_project,p_scene)::text)`, 'sql');
  fn('text_outbox_event', 'cc canon_commit,p_target text,p_strategy text', 'jsonb', `SELECT jsonb_build_object(
    'event_type','fixture_canon_structured_committed_v1','project_id',cc.project_id,'canon_commit_id',cc.canon_commit_id,
    'canonical_text_version_id',cc.canonical_text_version_id,'scene_id',t.scene_id,'source_canon_watermark',cc.canon_watermark,
    'target',p_target,'strategy_version',p_strategy,'projection_config_id',cc.projection_config_id,'payload_hash',cc.payload_hash)
    FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id) WHERE c.candidate_version_id=cc.candidate_version_id`, 'sql');
  fn('commit_guard', '', 'trigger', `DECLARE r jsonb; checked jsonb; t scene_task_version; i canonical_text_identity_root; before_watermark bigint;
  BEGIN
    PERFORM lock_novel(NEW.project_id); r:=NEW.request_payload;
    NEW.created_transaction:=pg_current_xact_id();
    PERFORM check_submission_set(NEW.candidate_version_id,r->'structured_outputs',false);
    IF NEW.payload_hash IS DISTINCT FROM digest_text(canonical_request(NEW.project_id,r)::text) THEN PERFORM reject('request_payload_hash'); END IF;
    IF ROW(NEW.workflow_id,NEW.candidate_version_id,NEW.selection_version,NEW.approval_id,NEW.input_canon_watermark,NEW.canonical_text_identity_id,NEW.projection_config_id,NEW.digest_spec_version)
      IS DISTINCT FROM ROW(r->>'workflow_id',r->>'candidate_version_id',(r->>'selection_version')::integer,r->>'approval_id',(r->>'input_canon_watermark')::bigint,r->>'canonical_text_identity_id',r->>'projection_config_id',r->>'digest_spec_version') THEN PERFORM reject('commit_request_binding'); END IF;
    PERFORM lock_scope(NEW.project_id);
    before_watermark:=current_watermark(NEW.project_id);
    IF NEW.input_canon_watermark<>before_watermark THEN PERFORM reject('stale_canon_watermark'); END IF;
    checked:=check_admission(NEW.project_id,NEW.workflow_id,NEW.candidate_version_id,NEW.approval_id,NEW.selection_version);
    IF NOT (checked->>'accepted')::boolean THEN PERFORM reject('admission_'||(checked->'reasons'->>0)); END IF;
    PERFORM check_submission_set(NEW.candidate_version_id,r->'structured_outputs',true);
    SELECT st.* INTO t FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version st USING(task_version_id) WHERE c.candidate_version_id=NEW.candidate_version_id;
    SELECT * INTO i FROM canonical_text_identity_root WHERE canonical_text_identity_id=NEW.canonical_text_identity_id;
    IF i.scene_id IS DISTINCT FROM t.scene_id OR NOT EXISTS(SELECT 1 FROM chapter WHERE chapter_id=i.chapter_id AND project_id=NEW.project_id) THEN PERFORM reject('commit_text_scope'); END IF;
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=i.canonical_text_identity_id FOR UPDATE;
    PERFORM assert_revision_admission(NEW);
    IF NEW.approval_policy_version IS DISTINCT FROM (SELECT approval_policy_version FROM approval_record WHERE approval_id=NEW.approval_id) THEN PERFORM reject('commit_approval_policy'); END IF;
    IF NEW.success_commit_sequence<>before_watermark+1 OR NEW.canon_watermark<>NEW.success_commit_sequence THEN PERFORM reject('commit_sequence_invalid'); END IF;
    RETURN NEW;
  END;`);
  fn('commit_effects', '', 'trigger', `BEGIN
    INSERT INTO approval_invalidation_record(approval_id,reason_code,trigger_type,trigger_version)
      SELECT a.approval_id,'canon_advanced','canon_commit',NEW.canon_commit_id FROM approval_record a
      WHERE candidate_project(a.candidate_version_id)=NEW.project_id ORDER BY a.approval_id
      ON CONFLICT(approval_id,reason_code,trigger_version) DO NOTHING;
    INSERT INTO operation_audit(project_id,event_kind,subject_id,evidence) VALUES(NEW.project_id,'canon_commit',NEW.canon_commit_id,
      jsonb_build_object('request_digest',NEW.payload_hash,'sequence',NEW.success_commit_sequence,'durability','requires_outer_commit'));
    RETURN NEW;
  END;`);
  fn('core_child_guard', '', 'trigger', `DECLARE cc canon_commit;
  BEGIN
    IF TG_TABLE_NAME='canon_commit_item_text_target' THEN
      SELECT cm.* INTO cc FROM canon_commit cm JOIN canon_commit_item ci USING(canon_commit_id) WHERE ci.commit_item_id=NEW.commit_item_id;
    ELSE SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=NEW.canon_commit_id;
    END IF;
    IF cc.canon_commit_id IS NULL THEN PERFORM reject('child_commit_missing'); END IF;
    PERFORM lock_novel(cc.project_id); PERFORM lock_scope(cc.project_id);
    IF cc.created_transaction IS DISTINCT FROM pg_current_xact_id() THEN PERFORM reject('historical_output_append'); END IF;
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=cc.canonical_text_identity_id FOR UPDATE;
    PERFORM 1 FROM canon_commit WHERE canon_commit_id=cc.canon_commit_id FOR UPDATE;
    RETURN NEW;
  END;`);
  // Completeness is checked at real COMMIT, including direct INSERTs. Successful historical approval need not remain live afterward.
  fn('assert_text_core_complete', 'p_commit text', 'void', `DECLARE cc canon_commit; textrow canonical_text_version; cand candidate_version; item canon_commit_item; task scene_task_version; manifest jsonb;
  BEGIN
    SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=p_commit;
    IF NOT FOUND THEN PERFORM reject('commit_missing'); END IF;
    SELECT * INTO textrow FROM canonical_text_version WHERE canon_commit_id=p_commit;
    IF NOT FOUND THEN PERFORM reject('commit_text_missing'); END IF;
    SELECT * INTO cand FROM candidate_version WHERE candidate_version_id=cc.candidate_version_id;
    SELECT st.* INTO task FROM workflow_identity w JOIN scene_task_version st USING(task_version_id) WHERE w.workflow_id=cc.workflow_id;
    IF textrow.canonical_text_version_id IS DISTINCT FROM cc.canonical_text_version_id OR textrow.canonical_text_identity_id IS DISTINCT FROM cc.canonical_text_identity_id
      OR textrow.body IS DISTINCT FROM cand.body OR textrow.content_hash IS DISTINCT FROM digest_text(textrow.body) OR textrow.content_hash IS DISTINCT FROM cand.content_hash
      OR textrow.text_length IS DISTINCT FROM char_length(textrow.body) THEN PERFORM reject('commit_text_binding'); END IF;
    SELECT * INTO item FROM canon_commit_item WHERE canon_commit_id=p_commit AND target_type='canonical_text';
    IF NOT FOUND THEN PERFORM reject('commit_item_missing'); END IF;
    IF item.target_type<>'canonical_text' OR item.target_id IS DISTINCT FROM textrow.canonical_text_version_id THEN PERFORM reject('commit_item_binding'); END IF;
    IF NOT EXISTS(SELECT 1 FROM canon_commit_item_text_target WHERE commit_item_id=item.commit_item_id AND canonical_text_version_id=textrow.canonical_text_version_id) THEN PERFORM reject('commit_text_support_missing'); END IF;
    SELECT targets INTO manifest FROM projection_target_config WHERE config_id=cc.projection_config_id;
    IF (SELECT coalesce(jsonb_agg(jsonb_build_object('target',target,'strategy_version',strategy_version) ORDER BY target),'[]'::jsonb) FROM projection_outbox WHERE canon_commit_id=p_commit) IS DISTINCT FROM manifest THEN PERFORM reject('commit_outbox_set'); END IF;
    IF EXISTS(SELECT 1 FROM projection_outbox o WHERE o.canon_commit_id=p_commit AND
      (o.scope_key IS DISTINCT FROM task.scene_id OR o.scope_hash IS DISTINCT FROM scope_digest(cc.project_id,task.scene_id)
      OR o.source_canon_watermark IS DISTINCT FROM cc.canon_watermark OR o.event_payload IS DISTINCT FROM expected_outbox_event(cc,o.target,o.strategy_version)
      OR o.event_hash IS DISTINCT FROM digest_text(o.event_payload::text))) THEN PERFORM reject('commit_outbox_binding'); END IF;
  END;`);
  fn('commit_complete_trigger', '', 'trigger', `DECLARE commit_id text; BEGIN
    IF TG_TABLE_NAME='canon_commit_item_text_target' THEN SELECT canon_commit_id INTO commit_id FROM canon_commit_item WHERE commit_item_id=NEW.commit_item_id;
    ELSE commit_id:=NEW.canon_commit_id; END IF;
    PERFORM assert_commit_complete(commit_id); RETURN NEW;
  END;`);
  fn('text_commit_response', 'p_commit text,p_result text', 'jsonb', `SELECT jsonb_build_object('result',p_result,'requires_outer_commit',true,
    'canon_commit_id',cc.canon_commit_id,'canonical_text_version_id',cc.canonical_text_version_id,'success_commit_sequence',cc.success_commit_sequence,
    'canon_watermark',cc.canon_watermark,'payload_hash',cc.payload_hash,
    'commit_item_id',(SELECT commit_item_id FROM canon_commit_item WHERE canon_commit_id=p_commit AND target_type='canonical_text'),
    'outbox_ids',(SELECT jsonb_agg(outbox_id ORDER BY target) FROM projection_outbox WHERE canon_commit_id=p_commit)) FROM canon_commit cc WHERE cc.canon_commit_id=p_commit`, 'sql');
  fn('commit_text', 'p_project text,p_key text,r jsonb', 'jsonb', `DECLARE previous canon_commit; fresh canon_commit; request_hash text; candidate candidate_version; item_id text; entry jsonb; payload jsonb; scene_id text;
  BEGIN
    PERFORM lock_novel(p_project);
    SELECT * INTO previous FROM canon_commit WHERE project_id=p_project AND idempotency_key=p_key;
    request_hash:=digest_text(canonical_request(p_project,r)::text);
    IF previous.canon_commit_id IS NOT NULL THEN
      IF previous.payload_hash IS DISTINCT FROM request_hash THEN PERFORM reject('commit_idempotency_conflict'); END IF;
      RETURN commit_response(previous.canon_commit_id,'replayed');
    END IF;
    SELECT * INTO candidate FROM candidate_version WHERE candidate_version_id=r->>'candidate_version_id';
    INSERT INTO canon_commit(project_id,workflow_id,candidate_version_id,selection_version,approval_id,approval_policy_version,idempotency_key,digest_spec_version,
      request_payload,payload_hash,projection_config_id,input_canon_watermark,success_commit_sequence,canon_watermark,result,canonical_text_identity_id,canonical_text_version_id)
      VALUES(p_project,r->>'workflow_id',candidate.candidate_version_id,(r->>'selection_version')::integer,r->>'approval_id',
        (SELECT approval_policy_version FROM approval_record WHERE approval_id=r->>'approval_id'),p_key,r->>'digest_spec_version',r,request_hash,r->>'projection_config_id',
        (r->>'input_canon_watermark')::bigint,current_watermark(p_project)+1,current_watermark(p_project)+1,'committed',r->>'canonical_text_identity_id',gen_random_uuid()::text) RETURNING * INTO fresh;
    INSERT INTO canonical_text_version VALUES(fresh.canonical_text_version_id,fresh.canonical_text_identity_id,next_text_version(fresh.candidate_version_id),fresh.canon_commit_id,candidate.body,digest_text(candidate.body),char_length(candidate.body));
    INSERT INTO canon_commit_item(canon_commit_id,target_type,target_id) VALUES(fresh.canon_commit_id,'canonical_text',fresh.canonical_text_version_id) RETURNING commit_item_id INTO item_id;
    INSERT INTO canon_commit_item_text_target VALUES(item_id,fresh.canonical_text_version_id);
    PERFORM write_structured_outputs(fresh);
    PERFORM write_supersession(fresh);
    SELECT t.scene_id INTO scene_id FROM workflow_identity w JOIN scene_task_version t USING(task_version_id) WHERE w.workflow_id=fresh.workflow_id;
    FOR entry IN SELECT value FROM jsonb_array_elements((SELECT targets FROM projection_target_config WHERE config_id=fresh.projection_config_id)) LOOP
      payload:=expected_outbox_event(fresh,entry->>'target',entry->>'strategy_version');
      INSERT INTO projection_outbox(canon_commit_id,target,scope_key,scope_hash,source_canon_watermark,strategy_version,event_payload,event_hash)
        VALUES(fresh.canon_commit_id,entry->>'target',scene_id,scope_digest(p_project,scene_id),fresh.canon_watermark,entry->>'strategy_version',payload,digest_text(payload::text));
    END LOOP;
    RETURN commit_response(fresh.canon_commit_id,'created_in_transaction');
  END;`);
  for (const table of ['chapter','scene','canonical_text_identity_root']) sql(`CREATE TRIGGER structure_guard BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.structure_guard();`);
  sql(`CREATE TRIGGER commit_guard BEFORE INSERT ON ${schema}.canon_commit FOR EACH ROW EXECUTE FUNCTION ${schema}.commit_guard();
    CREATE TRIGGER commit_effects AFTER INSERT ON ${schema}.canon_commit FOR EACH ROW EXECUTE FUNCTION ${schema}.commit_effects();`);
  for (const table of ['canonical_text_version','canon_commit_item','canon_commit_item_text_target','projection_outbox']) sql(`CREATE TRIGGER child_guard BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.core_child_guard();`);
  for (const table of ['canon_commit','canonical_text_version','canon_commit_item','canon_commit_item_text_target','projection_outbox']) {
    sql(`CREATE CONSTRAINT TRIGGER atomic_completeness AFTER INSERT ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.commit_complete_trigger();`);
  }
  for (const table of ['chapter','scene','canonical_text_identity_root','projection_target_config','canon_commit','canonical_text_version','canon_commit_item','canon_commit_item_text_target','projection_outbox']) {
    sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.immutable();
      CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON ${schema}.${table} FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.immutable();`);
  }
  for (const view of ['canonical_text_identity','canon_watermark']) sql(`CREATE TRIGGER readonly_view INSTEAD OF INSERT OR UPDATE OR DELETE ON ${schema}.${view} FOR EACH ROW EXECUTE FUNCTION ${schema}.readonly_view();`);


  sql(`
    CREATE UNIQUE INDEX one_text_item ON ${schema}.canon_commit_item(canon_commit_id) WHERE target_type='canonical_text';
    CREATE TABLE ${schema}.entity(entity_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.novel);
    CREATE TABLE ${schema}.state_dimension(state_dimension_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.novel,dimension_key text NOT NULL);
    CREATE TABLE ${schema}.fixture_world_record (
      record_id text PRIMARY KEY,project_id text NOT NULL REFERENCES ${schema}.novel,subject_entity_id text NOT NULL REFERENCES ${schema}.entity,
      predicate text NOT NULL,value jsonb NOT NULL,provenance text NOT NULL CHECK(provenance='fixture-observation-v1'),record_hash text NOT NULL);
    CREATE TABLE ${schema}.narrative_assertion (
      assertion_id text PRIMARY KEY,candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      source_domain text NOT NULL CHECK(source_domain='candidate'),assertion_type text NOT NULL CHECK(assertion_type IN ('direct_observation','lie','rumor','unknown')),
      assertion_payload jsonb NOT NULL,locator jsonb NOT NULL,assertion_hash text NOT NULL,source_content_hash text NOT NULL,
      hash_spec_version text NOT NULL CHECK(hash_spec_version='fixture-assertion-v1'),extractor_version text NOT NULL CHECK(extractor_version='fixture-extractor-v1'),
      UNIQUE(candidate_version_id,assertion_hash,extractor_version));
    CREATE TABLE ${schema}.narrative_assertion_candidate_source (
      assertion_id text PRIMARY KEY REFERENCES ${schema}.narrative_assertion,
      candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,source_version_id text NOT NULL REFERENCES ${schema}.candidate_version);
    CREATE TABLE ${schema}.assertion_confirmation_basis (
      basis_id text PRIMARY KEY,assertion_id text NOT NULL UNIQUE REFERENCES ${schema}.narrative_assertion,
      record_id text NOT NULL REFERENCES ${schema}.fixture_world_record,rule_version text NOT NULL CHECK(rule_version='fixture-confirm-v1'),basis_hash text NOT NULL);
    CREATE TABLE ${schema}.candidate_event (
      candidate_event_id text PRIMARY KEY,candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      assertion_id text NOT NULL REFERENCES ${schema}.narrative_assertion,event_key text NOT NULL,subject_entity_id text NOT NULL REFERENCES ${schema}.entity,
      predicate text NOT NULL,object_ref text REFERENCES ${schema}.entity,story_time_ref text,
      object_hash text NOT NULL,object_hash_spec_version text NOT NULL CHECK(object_hash_spec_version='fixture-proposal-v1'),UNIQUE(candidate_version_id,event_key));
    CREATE TABLE ${schema}.candidate_fact_proposal (
      candidate_fact_proposal_id text PRIMARY KEY,candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      assertion_id text NOT NULL REFERENCES ${schema}.narrative_assertion,subject_entity_id text NOT NULL REFERENCES ${schema}.entity,
      fact_key text NOT NULL,proposed_value jsonb NOT NULL,effective_scope text NOT NULL CHECK(length(effective_scope)>0),
      object_hash text NOT NULL,object_hash_spec_version text NOT NULL CHECK(object_hash_spec_version='fixture-proposal-v1'),UNIQUE(candidate_version_id,fact_key,effective_scope));
    CREATE TABLE ${schema}.candidate_state_transition (
      candidate_state_transition_id text PRIMARY KEY,candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,
      assertion_id text NOT NULL REFERENCES ${schema}.narrative_assertion,entity_id text NOT NULL REFERENCES ${schema}.entity,
      state_dimension_id text NOT NULL REFERENCES ${schema}.state_dimension,transition_key text NOT NULL,from_value jsonb,to_value jsonb NOT NULL,
      object_hash text NOT NULL,object_hash_spec_version text NOT NULL CHECK(object_hash_spec_version='fixture-proposal-v1'),UNIQUE(candidate_version_id,entity_id,state_dimension_id));
    CREATE VIEW ${schema}.all_candidate_proposals AS
      SELECT 'candidate_event'::text AS kind,candidate_event_id AS id,candidate_version_id,assertion_id,object_hash,to_jsonb(p)-'object_hash' AS payload FROM ${schema}.candidate_event p
      UNION ALL SELECT 'candidate_fact_proposal',candidate_fact_proposal_id,candidate_version_id,assertion_id,object_hash,to_jsonb(p)-'object_hash' FROM ${schema}.candidate_fact_proposal p
      UNION ALL SELECT 'candidate_state_transition',candidate_state_transition_id,candidate_version_id,assertion_id,object_hash,to_jsonb(p)-'object_hash' FROM ${schema}.candidate_state_transition p;
    CREATE TABLE ${schema}.candidate_submission_manifest (
      candidate_version_id text PRIMARY KEY REFERENCES ${schema}.candidate_version,manifest jsonb NOT NULL,manifest_hash text NOT NULL,
      digest_spec_version text NOT NULL CHECK(digest_spec_version='fixture-frozen-set-v1'));
  `);
  fn('jsonb_object_length_fixture','v jsonb','integer',`SELECT CASE WHEN jsonb_typeof(v)='object' THEN (SELECT count(*)::integer FROM jsonb_object_keys(v)) ELSE -1 END`,'sql');
  fn('check_locator','body text,loc jsonb','boolean',`SELECT coalesce(jsonb_typeof(loc)='object' AND loc ?& ARRAY['start','end','quote'] AND jsonb_object_length_fixture(loc)=3
    AND jsonb_typeof(loc->'start')='number' AND jsonb_typeof(loc->'end')='number'
    AND (loc->>'start')::integer>=0 AND (loc->>'end')::integer>(loc->>'start')::integer AND (loc->>'end')::integer<=char_length(body)
    AND substring(body FROM (loc->>'start')::integer+1 FOR (loc->>'end')::integer-(loc->>'start')::integer)=loc->>'quote',false)`, 'sql');
  fn('input_set_lock','p_candidate text','void',`BEGIN
    PERFORM lock_scope(candidate_project(p_candidate));
    IF EXISTS(SELECT 1 FROM candidate_submission_manifest WHERE candidate_version_id=p_candidate) THEN PERFORM reject('candidate_set_frozen'); END IF;
  END;`);
  fn('proposal_hash','kind text,payload jsonb','text',`SELECT digest_text(jsonb_build_array('fixture-proposal-v1',kind,payload-'object_hash')::text)`,'sql');
  fn('proposal_asserted_value','kind text,p jsonb','jsonb',`SELECT CASE kind
    WHEN 'candidate_event' THEN jsonb_build_object('subject',p->>'subject_entity_id','predicate',p->>'predicate','value',jsonb_build_object('object_ref',p->'object_ref'))
    WHEN 'candidate_fact_proposal' THEN jsonb_build_object('subject',p->>'subject_entity_id','predicate',p->>'fact_key','value',p->'proposed_value')
    WHEN 'candidate_state_transition' THEN jsonb_build_object('subject',p->>'entity_id','predicate',p->>'state_dimension_id','value',p->'to_value') END`,'sql');
  fn('structured_input_guard','','trigger',`DECLARE p text; a narrative_assertion; c candidate_version; wr fixture_world_record; expected text; value jsonb;
  BEGIN
    IF TG_TABLE_NAME IN ('entity','state_dimension','fixture_world_record') THEN
      PERFORM lock_scope(NEW.project_id);
      IF TG_TABLE_NAME='fixture_world_record' THEN
        IF NOT EXISTS(SELECT 1 FROM entity WHERE entity_id=NEW.subject_entity_id AND project_id=NEW.project_id) THEN PERFORM reject('world_record_project'); END IF;
        expected:=digest_text((to_jsonb(NEW)-'record_hash')::text);
        IF NEW.record_hash IS NOT NULL AND NEW.record_hash<>expected THEN PERFORM reject('world_record_hash'); END IF; NEW.record_hash:=expected;
      END IF; RETURN NEW;
    END IF;
    IF TG_TABLE_NAME IN ('narrative_assertion_candidate_source','assertion_confirmation_basis') THEN SELECT * INTO a FROM narrative_assertion WHERE assertion_id=NEW.assertion_id;p:=a.candidate_version_id;
    ELSE p:=NEW.candidate_version_id; END IF;
    PERFORM input_set_lock(p);SELECT * INTO c FROM candidate_version WHERE candidate_version_id=p;
    IF TG_TABLE_NAME='narrative_assertion' THEN
      IF NEW.source_content_hash IS DISTINCT FROM digest_text(c.body) THEN PERFORM reject('assertion_source_hash'); END IF;
      IF NOT check_locator(c.body,NEW.locator) THEN PERFORM reject('assertion_locator'); END IF;
      expected:=digest_text(jsonb_build_array('fixture-assertion-v1',to_jsonb(NEW)-'assertion_hash')::text);
      IF NEW.assertion_hash IS NOT NULL AND NEW.assertion_hash<>expected THEN PERFORM reject('assertion_actual_hash'); END IF; NEW.assertion_hash:=expected;
    ELSIF TG_TABLE_NAME='narrative_assertion_candidate_source' THEN
      IF NEW.candidate_version_id IS DISTINCT FROM a.candidate_version_id OR NEW.source_version_id IS DISTINCT FROM a.candidate_version_id THEN PERFORM reject('assertion_source_candidate'); END IF;
    ELSIF TG_TABLE_NAME='assertion_confirmation_basis' THEN
      SELECT * INTO wr FROM fixture_world_record WHERE record_id=NEW.record_id;
      IF a.assertion_type<>'direct_observation' OR wr.project_id IS DISTINCT FROM candidate_project(p)
        OR a.assertion_payload IS DISTINCT FROM jsonb_build_object('subject',wr.subject_entity_id,'predicate',wr.predicate,'value',wr.value) THEN PERFORM reject('confirmation_rule_mismatch'); END IF;
      expected:=digest_text(jsonb_build_array('fixture-confirm-v1',NEW.basis_id,a.assertion_hash,wr.record_id,wr.record_hash)::text);
      IF NEW.basis_hash IS NOT NULL AND NEW.basis_hash<>expected THEN PERFORM reject('confirmation_hash'); END IF;NEW.basis_hash:=expected;
    ELSE
      SELECT * INTO a FROM narrative_assertion WHERE assertion_id=NEW.assertion_id;
      IF a.candidate_version_id IS DISTINCT FROM p THEN PERFORM reject('proposal_assertion_candidate'); END IF;
      value:=proposal_asserted_value(TG_TABLE_NAME,to_jsonb(NEW));
      IF a.assertion_payload IS DISTINCT FROM value THEN PERFORM reject('proposal_assertion_content'); END IF;
      IF NOT EXISTS(SELECT 1 FROM entity WHERE entity_id=value->>'subject' AND project_id=candidate_project(p)) THEN PERFORM reject('proposal_entity_project'); END IF;
      IF TG_TABLE_NAME='candidate_event' THEN
        IF NEW.story_time_ref IS NOT NULL THEN PERFORM reject('event_time_not_supported'); END IF;
        IF NEW.object_ref IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entity WHERE entity_id=NEW.object_ref AND project_id=candidate_project(p)) THEN PERFORM reject('event_object_project'); END IF;
      ELSIF TG_TABLE_NAME='candidate_state_transition' THEN
        IF NEW.from_value IS NOT NULL THEN PERFORM reject('state_history_not_supported'); END IF;
        IF NOT EXISTS(SELECT 1 FROM state_dimension WHERE state_dimension_id=NEW.state_dimension_id AND project_id=candidate_project(p)) THEN PERFORM reject('dimension_project'); END IF;
      END IF;
      expected:=proposal_hash(TG_TABLE_NAME,to_jsonb(NEW));
      IF NEW.object_hash IS NOT NULL AND NEW.object_hash<>expected THEN PERFORM reject('proposal_actual_hash'); END IF;NEW.object_hash:=expected;
    END IF;RETURN NEW;
  END;`);
  fn('revision_input','p_candidate text','jsonb',`BEGIN RETURN (SELECT jsonb_build_object('intent',to_jsonb(i),'old_version',
    jsonb_build_object('id',v.canonical_text_version_id,'identity',v.canonical_text_identity_id,'version_no',v.version_no,
      'actual_body_hash',digest_text(v.body),'canon_commit_id',v.canon_commit_id))
    FROM candidate_revision_intent i JOIN canonical_text_version v ON v.canonical_text_version_id=i.expected_old_text_version_id
    WHERE i.candidate_version_id=p_candidate);END;`);
  fn('candidate_manifest','p_candidate text','jsonb',`SELECT jsonb_build_object('version','fixture-frozen-set-v1','candidate_id',p_candidate,
    'revision',revision_input(p_candidate),'members',coalesce(jsonb_agg(jsonb_build_object('type',p.kind,'id',p.id,'payload',p.payload,'object_hash',proposal_hash(p.kind,p.payload),
      'assertion',to_jsonb(a),'assertion_source',to_jsonb(s),'confirmation_basis',to_jsonb(b),'confirmation_record',to_jsonb(w)) ORDER BY p.kind COLLATE "C",p.id COLLATE "C") FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb))
    FROM all_candidate_proposals p JOIN narrative_assertion a ON a.assertion_id=p.assertion_id
    LEFT JOIN narrative_assertion_candidate_source s ON s.assertion_id=a.assertion_id
    LEFT JOIN assertion_confirmation_basis b ON b.assertion_id=a.assertion_id LEFT JOIN fixture_world_record w ON w.record_id=b.record_id
    WHERE p.candidate_version_id=p_candidate`,'sql');
  fn('manifest_ids','p_candidate text','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('type',e->>'type','id',e->>'id') ORDER BY e->>'type' COLLATE "C",e->>'id' COLLATE "C"),'[]'::jsonb)
    FROM candidate_submission_manifest m CROSS JOIN LATERAL jsonb_array_elements(m.manifest->'members') e WHERE m.candidate_version_id=p_candidate`,'sql');
  fn('assert_assertion_source','p_assertion text','void',`DECLARE a narrative_assertion;BEGIN
    SELECT * INTO a FROM narrative_assertion WHERE assertion_id=p_assertion;
    IF NOT EXISTS(SELECT 1 FROM narrative_assertion_candidate_source WHERE assertion_id=p_assertion AND candidate_version_id=a.candidate_version_id AND source_version_id=a.candidate_version_id) THEN PERFORM reject('assertion_source_missing'); END IF;
  END;`);
  fn('assertion_source_complete','','trigger',`BEGIN PERFORM assert_assertion_source(NEW.assertion_id);RETURN NEW;END;`);
  fn('freeze_guard','','trigger',`DECLARE actual jsonb;a record;BEGIN
    PERFORM lock_scope(candidate_project(NEW.candidate_version_id));
    FOR a IN SELECT assertion_id FROM narrative_assertion WHERE candidate_version_id=NEW.candidate_version_id ORDER BY assertion_id LOOP PERFORM assert_assertion_source(a.assertion_id);END LOOP;
    actual:=candidate_manifest(NEW.candidate_version_id);
    IF NEW.manifest IS DISTINCT FROM actual OR NEW.manifest_hash IS DISTINCT FROM digest_text(actual::text) THEN PERFORM reject('frozen_manifest_mismatch');END IF;
    RETURN NEW;
  END;`);
  fn('freeze_candidate','p_candidate text','jsonb',`DECLARE m candidate_submission_manifest;actual jsonb;BEGIN
    PERFORM lock_scope(candidate_project(p_candidate));SELECT * INTO m FROM candidate_submission_manifest WHERE candidate_version_id=p_candidate;
    IF FOUND THEN RETURN to_jsonb(m);END IF;actual:=candidate_manifest(p_candidate);
    INSERT INTO candidate_submission_manifest VALUES(p_candidate,actual,digest_text(actual::text),'fixture-frozen-set-v1') RETURNING * INTO m;RETURN to_jsonb(m);
  END;`);
  fn('validation_input_hash','p_candidate text,p_design text,p_canon bigint,p_rule text','text',`DECLARE m candidate_submission_manifest;BEGIN
    SELECT * INTO m FROM candidate_submission_manifest WHERE candidate_version_id=p_candidate;
    IF NOT FOUND THEN PERFORM reject('candidate_set_not_frozen');END IF;
    RETURN digest_text(jsonb_build_array('validation-text-supersession-v1',validation_base_hash(p_candidate,p_design,p_canon,p_rule),m.manifest_hash,candidate_manifest(p_candidate),'fixture-conversion-v1')::text);
  END;`);
  fn('check_submission_set','p_candidate text,requested jsonb,check_existing boolean','void',`DECLARE m candidate_submission_manifest;p record;a narrative_assertion;basis assertion_confirmation_basis;BEGIN
    SELECT * INTO m FROM candidate_submission_manifest WHERE candidate_version_id=p_candidate;
    IF NOT FOUND THEN PERFORM reject('candidate_set_not_frozen');END IF;
    IF m.manifest IS DISTINCT FROM candidate_manifest(p_candidate) OR m.manifest_hash IS DISTINCT FROM digest_text(m.manifest::text) THEN PERFORM reject('frozen_set_changed');END IF;
    IF normalize_set(requested) IS DISTINCT FROM manifest_ids(p_candidate) THEN PERFORM reject('request_frozen_set_mismatch');END IF;
    FOR p IN SELECT * FROM all_candidate_proposals WHERE candidate_version_id=p_candidate ORDER BY kind,id LOOP
      SELECT * INTO a FROM narrative_assertion WHERE assertion_id=p.assertion_id;PERFORM assert_assertion_source(a.assertion_id);
      SELECT * INTO basis FROM assertion_confirmation_basis WHERE assertion_id=p.assertion_id;
      IF basis.basis_id IS NULL OR a.assertion_type<>'direct_observation' THEN PERFORM reject('proposal_confirmation_missing');END IF;
      IF check_existing AND p.kind='candidate_fact_proposal' AND EXISTS(SELECT 1 FROM canon_fact WHERE project_id=candidate_project(p_candidate) AND fact_key=p.payload->>'fact_key' AND effective_scope=p.payload->>'effective_scope') THEN PERFORM reject('fact_initial_only');END IF;
      IF check_existing AND p.kind='candidate_state_transition' AND EXISTS(SELECT 1 FROM state_transition WHERE project_id=candidate_project(p_candidate) AND entity_id=p.payload->>'entity_id' AND state_dimension_id=p.payload->>'state_dimension_id') THEN PERFORM reject('state_initial_only');END IF;
    END LOOP;
  END;`);
  fn('candidate_reasons','p_candidate text,p_validation text','text[]',`DECLARE reasons text[];BEGIN
    reasons:=candidate_base_reasons(p_candidate,p_validation);
    BEGIN PERFORM check_submission_set(p_candidate,manifest_ids(p_candidate),false);
    EXCEPTION WHEN SQLSTATE 'P0001' THEN reasons:=array_append(reasons,SQLERRM);END;
    RETURN reasons;
  END;`);
  fn('normalize_set','members jsonb','jsonb',`DECLARE canonical jsonb;BEGIN
    IF jsonb_typeof(members) IS DISTINCT FROM 'array' THEN PERFORM reject('proposal_set_array_required');END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(members) e WHERE jsonb_typeof(e)<>'object' OR jsonb_object_length_fixture(e)<>2 OR NOT(e ?& ARRAY['type','id'])
      OR jsonb_typeof(e->'type') IS DISTINCT FROM 'string' OR e->>'type' NOT IN ('candidate_event','candidate_fact_proposal','candidate_state_transition') OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string' OR length(e->>'id')=0) THEN PERFORM reject('proposal_set_entry');END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(members))<>(SELECT count(DISTINCT e) FROM jsonb_array_elements(members) e) THEN PERFORM reject('duplicate_proposal');END IF;
    SELECT coalesce(jsonb_agg(e ORDER BY e->>'type' COLLATE "C",e->>'id' COLLATE "C"),'[]'::jsonb) INTO canonical FROM jsonb_array_elements(members) e;RETURN canonical;
  END;`);
  fn('normalize_request','r jsonb','jsonb',`BEGIN RETURN jsonb_set(r,'{structured_outputs}',normalize_set(r->'structured_outputs'));END;`);
  sql(`
    CREATE TABLE ${schema}.evidence_reference (
      evidence_reference_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      source_domain text NOT NULL CHECK(source_domain='canon'),source_version_id text NOT NULL,
      source_object_type text NOT NULL CHECK(source_object_type='canonical_text_version'),source_object_id text NOT NULL,
      locator jsonb NOT NULL,evidence_kind text NOT NULL CHECK(evidence_kind='fixture_assertion_span'),
      UNIQUE(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind));
    CREATE TABLE ${schema}.evidence_canon_source (
      evidence_reference_id text PRIMARY KEY REFERENCES ${schema}.evidence_reference,
      canonical_text_version_id text NOT NULL REFERENCES ${schema}.canonical_text_version,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit);
    CREATE TABLE ${schema}.story_event (
      story_event_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,project_id text NOT NULL REFERENCES ${schema}.novel,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,event_key text NOT NULL,subject_entity_id text NOT NULL REFERENCES ${schema}.entity,
      predicate text NOT NULL,object_ref text REFERENCES ${schema}.entity,story_time_interval_id text CHECK(story_time_interval_id IS NULL),
      evidence_reference_id text NOT NULL REFERENCES ${schema}.evidence_reference,UNIQUE(canon_commit_id,event_key));
    CREATE TABLE ${schema}.canon_fact (
      canon_fact_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,project_id text NOT NULL REFERENCES ${schema}.novel,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,fact_key text NOT NULL,fact_value jsonb NOT NULL,effective_scope text NOT NULL,
      active_from_sequence bigint NOT NULL,evidence_reference_id text NOT NULL REFERENCES ${schema}.evidence_reference,
      UNIQUE(project_id,fact_key,effective_scope));
    CREATE TABLE ${schema}.state_transition (
      state_transition_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,project_id text NOT NULL REFERENCES ${schema}.novel,
      canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,entity_id text NOT NULL REFERENCES ${schema}.entity,
      state_dimension_id text NOT NULL REFERENCES ${schema}.state_dimension,transition_key text NOT NULL,
      from_value jsonb CHECK(from_value IS NULL),to_value jsonb NOT NULL,evidence_reference_id text NOT NULL REFERENCES ${schema}.evidence_reference,
      UNIQUE(project_id,entity_id,state_dimension_id));
    CREATE VIEW ${schema}.all_canon_objects AS
      SELECT 'story_event'::text AS kind,story_event_id AS id,project_id,canon_commit_id,evidence_reference_id,to_jsonb(p)-ARRAY['story_event_id','evidence_reference_id'] AS payload FROM ${schema}.story_event p
      UNION ALL SELECT 'canon_fact',canon_fact_id,project_id,canon_commit_id,evidence_reference_id,to_jsonb(p)-ARRAY['canon_fact_id','evidence_reference_id'] FROM ${schema}.canon_fact p
      UNION ALL SELECT 'state_transition',state_transition_id,project_id,canon_commit_id,evidence_reference_id,to_jsonb(p)-ARRAY['state_transition_id','evidence_reference_id'] FROM ${schema}.state_transition p;
    CREATE TABLE ${schema}.canon_commit_item_story_event_target (
      commit_item_id text PRIMARY KEY REFERENCES ${schema}.canon_commit_item,story_event_id text NOT NULL UNIQUE REFERENCES ${schema}.story_event);
    CREATE TABLE ${schema}.canon_commit_item_fact_target (
      commit_item_id text PRIMARY KEY REFERENCES ${schema}.canon_commit_item,canon_fact_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_fact);
    CREATE TABLE ${schema}.canon_commit_item_state_target (
      commit_item_id text PRIMARY KEY REFERENCES ${schema}.canon_commit_item,state_transition_id text NOT NULL UNIQUE REFERENCES ${schema}.state_transition);
    CREATE VIEW ${schema}.all_item_targets AS
      SELECT commit_item_id,'canonical_text'::text AS kind,canonical_text_version_id AS id FROM ${schema}.canon_commit_item_text_target
      UNION ALL SELECT commit_item_id,'story_event',story_event_id FROM ${schema}.canon_commit_item_story_event_target
      UNION ALL SELECT commit_item_id,'canon_fact',canon_fact_id FROM ${schema}.canon_commit_item_fact_target
      UNION ALL SELECT commit_item_id,'state_transition',state_transition_id FROM ${schema}.canon_commit_item_state_target;
    CREATE TABLE ${schema}.candidate_to_canon_mapping (
      mapping_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,canon_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,
      candidate_version_id text NOT NULL REFERENCES ${schema}.candidate_version,candidate_object_type text NOT NULL CHECK(candidate_object_type IN ('candidate_event','candidate_fact_proposal','candidate_state_transition')),
      candidate_object_id text NOT NULL,canon_commit_item_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_commit_item,
      candidate_object_hash text NOT NULL,candidate_content_hash text NOT NULL,
      UNIQUE(canon_commit_id,candidate_object_type,candidate_object_id));
    CREATE TABLE ${schema}.candidate_to_canon_candidate_source (
      mapping_id text PRIMARY KEY REFERENCES ${schema}.candidate_to_canon_mapping,
      candidate_object_type text NOT NULL CHECK(candidate_object_type IN ('candidate_event','candidate_fact_proposal','candidate_state_transition')),candidate_object_id text NOT NULL,
      candidate_event_id text REFERENCES ${schema}.candidate_event,candidate_fact_proposal_id text REFERENCES ${schema}.candidate_fact_proposal,
      candidate_state_transition_id text REFERENCES ${schema}.candidate_state_transition,
      CHECK(num_nonnulls(candidate_event_id,candidate_fact_proposal_id,candidate_state_transition_id)=1));
    ALTER TABLE ${schema}.canon_commit_item ADD CONSTRAINT item_source_mapping_fk FOREIGN KEY(source_mapping_id)
      REFERENCES ${schema}.candidate_to_canon_mapping DEFERRABLE INITIALLY DEFERRED;
  `);
  fn('target_kind','kind text','text',`SELECT CASE kind WHEN 'candidate_event' THEN 'story_event' WHEN 'candidate_fact_proposal' THEN 'canon_fact' WHEN 'candidate_state_transition' THEN 'state_transition' END`,'sql');
  fn('expected_canon_fields','kind text,p jsonb,cc canon_commit','jsonb',`SELECT jsonb_build_object('project_id',cc.project_id,'canon_commit_id',cc.canon_commit_id)||CASE kind
    WHEN 'candidate_event' THEN jsonb_build_object('event_key',p->'event_key','subject_entity_id',p->'subject_entity_id','predicate',p->'predicate','object_ref',p->'object_ref','story_time_interval_id',NULL)
    WHEN 'candidate_fact_proposal' THEN jsonb_build_object('fact_key',p->'fact_key','fact_value',p->'proposed_value','effective_scope',p->'effective_scope','active_from_sequence',cc.success_commit_sequence)
    WHEN 'candidate_state_transition' THEN jsonb_build_object('entity_id',p->'entity_id','state_dimension_id',p->'state_dimension_id','transition_key',p->'transition_key','from_value',NULL,'to_value',p->'to_value') END`,'sql');
  fn('row_commit_id','table_name text,r jsonb','text',`DECLARE result text;BEGIN
    IF table_name='evidence_reference' THEN SELECT canon_commit_id INTO result FROM canonical_text_version WHERE canonical_text_version_id=r->>'source_object_id';
    ELSIF table_name='candidate_to_canon_candidate_source' THEN SELECT canon_commit_id INTO result FROM candidate_to_canon_mapping WHERE mapping_id=r->>'mapping_id';
    ELSIF table_name IN ('canon_commit_item_story_event_target','canon_commit_item_fact_target','canon_commit_item_state_target') THEN SELECT canon_commit_id INTO result FROM canon_commit_item WHERE commit_item_id=r->>'commit_item_id';
    ELSE result:=r->>'canon_commit_id';END IF;RETURN result;
  END;`);
  fn('structured_child_guard','','trigger',`DECLARE cc canon_commit;BEGIN
    SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=row_commit_id(TG_TABLE_NAME,to_jsonb(NEW));
    IF NOT FOUND THEN PERFORM reject('child_commit_missing');END IF;
    PERFORM lock_novel(cc.project_id);PERFORM lock_scope(cc.project_id);
    IF cc.created_transaction IS DISTINCT FROM pg_current_xact_id() THEN PERFORM reject('historical_output_append');END IF;
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=cc.canonical_text_identity_id FOR UPDATE;
    PERFORM 1 FROM canon_commit WHERE canon_commit_id=cc.canon_commit_id FOR UPDATE;RETURN NEW;
  END;`);
  fn('ensure_text_evidence','cc canon_commit,a narrative_assertion','text',`DECLARE evidence_id text;BEGIN
    INSERT INTO evidence_reference(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind)
      VALUES('canon',cc.canonical_text_version_id,'canonical_text_version',cc.canonical_text_version_id,a.locator,'fixture_assertion_span')
      ON CONFLICT(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind) DO NOTHING RETURNING evidence_reference_id INTO evidence_id;
    IF evidence_id IS NULL THEN SELECT evidence_reference_id INTO evidence_id FROM evidence_reference WHERE source_domain='canon' AND source_version_id=cc.canonical_text_version_id AND source_object_type='canonical_text_version' AND source_object_id=cc.canonical_text_version_id AND locator=a.locator AND evidence_kind='fixture_assertion_span';
    ELSE INSERT INTO evidence_canon_source VALUES(evidence_id,cc.canonical_text_version_id,cc.canon_commit_id);END IF;RETURN evidence_id;
  END;`);
  fn('write_structured_outputs','cc canon_commit','void',`DECLARE p record;a narrative_assertion;ev text;obj text;item text;mapping text;kind text;column_name text;support_table text;data jsonb;BEGIN
    FOR p IN SELECT pr.* FROM all_candidate_proposals pr WHERE pr.candidate_version_id=cc.candidate_version_id ORDER BY pr.kind COLLATE "C",pr.id COLLATE "C" LOOP
      SELECT * INTO a FROM narrative_assertion WHERE assertion_id=p.assertion_id;ev:=ensure_text_evidence(cc,a);obj:=gen_random_uuid()::text;item:=gen_random_uuid()::text;mapping:=gen_random_uuid()::text;
      kind:=target_kind(p.kind);column_name:=CASE kind WHEN 'story_event' THEN 'story_event_id' WHEN 'canon_fact' THEN 'canon_fact_id' ELSE 'state_transition_id' END;
      data:=expected_canon_fields(p.kind,p.payload,cc)||jsonb_build_object(column_name,obj,'evidence_reference_id',ev);
      EXECUTE format('INSERT INTO %I.%I SELECT * FROM jsonb_populate_record(NULL::%I.%I,$1)','${schema}',kind,'${schema}',kind) USING data;
      INSERT INTO canon_commit_item VALUES(item,cc.canon_commit_id,kind,obj,mapping);
      INSERT INTO candidate_to_canon_mapping VALUES(mapping,cc.canon_commit_id,cc.candidate_version_id,p.kind,p.id,item,p.object_hash,(SELECT content_hash FROM candidate_version WHERE candidate_version_id=cc.candidate_version_id));
      INSERT INTO candidate_to_canon_candidate_source VALUES(mapping,p.kind,p.id,CASE WHEN p.kind='candidate_event' THEN p.id END,CASE WHEN p.kind='candidate_fact_proposal' THEN p.id END,CASE WHEN p.kind='candidate_state_transition' THEN p.id END);
      support_table:=CASE kind WHEN 'story_event' THEN 'canon_commit_item_story_event_target' WHEN 'canon_fact' THEN 'canon_commit_item_fact_target' ELSE 'canon_commit_item_state_target' END;
      EXECUTE format('INSERT INTO %I.%I VALUES($1,$2)','${schema}',support_table) USING item,obj;
    END LOOP;
  END;`);
  fn('supersession_output','p_commit text','jsonb',`BEGIN RETURN (SELECT jsonb_build_object(
    'relations',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY relation_id),'[]'::jsonb) FROM supersession_relation r WHERE canon_commit_id=p_commit),
    'targets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY target_ref_id),'[]'::jsonb) FROM canon_relation_target t WHERE created_by_commit_id=p_commit)));END;`);
  fn('supersession_event','cc canon_commit','jsonb',`BEGIN RETURN (SELECT jsonb_build_object(
    'event_type',CASE WHEN cc.request_payload->>'mode'='revise_text' THEN 'fixture_canon_text_revised_v1' ELSE 'fixture_canon_text_initial_v1' END,
    'canonical_text_identity_id',cc.canonical_text_identity_id,'new_text_version_id',cc.canonical_text_version_id,
    'old_text_version_id',(SELECT expected_old_text_version_id FROM candidate_revision_intent WHERE candidate_version_id=cc.candidate_version_id),
    'supersession_relation_id',(SELECT relation_id FROM supersession_relation WHERE canon_commit_id=cc.canon_commit_id)));END;`);
  fn('commit_output_manifest','p_commit text','jsonb',`SELECT jsonb_build_object('version','fixture-complete-output-v1',
    'supersession',supersession_output(p_commit),'text_version_id',(SELECT canonical_text_version_id FROM canon_commit WHERE canon_commit_id=p_commit),
    'objects',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY kind,id),'[]'::jsonb) FROM all_canon_objects o WHERE canon_commit_id=p_commit),
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY target_type,target_id),'[]'::jsonb) FROM canon_commit_item i WHERE canon_commit_id=p_commit),
    'targets',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.kind,t.id),'[]'::jsonb) FROM all_item_targets t JOIN canon_commit_item i USING(commit_item_id) WHERE i.canon_commit_id=p_commit),
    'mappings',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY candidate_object_type,candidate_object_id),'[]'::jsonb) FROM candidate_to_canon_mapping m WHERE canon_commit_id=p_commit),
    'mapping_sources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.candidate_object_type,s.candidate_object_id),'[]'::jsonb) FROM candidate_to_canon_candidate_source s JOIN candidate_to_canon_mapping m USING(mapping_id) WHERE m.canon_commit_id=p_commit),
    'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY evidence_reference_id),'[]'::jsonb) FROM evidence_reference e JOIN canonical_text_version v ON v.canonical_text_version_id=e.source_object_id WHERE v.canon_commit_id=p_commit),
    'evidence_sources',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY evidence_reference_id),'[]'::jsonb) FROM evidence_canon_source s WHERE s.canon_commit_id=p_commit))`,'sql');
  fn('expected_outbox_event','cc canon_commit,p_target text,p_strategy text','jsonb',`SELECT text_outbox_event(cc,p_target,p_strategy)||supersession_event(cc)||jsonb_build_object('complete_output',commit_output_manifest(cc.canon_commit_id),'output_hash',digest_text(commit_output_manifest(cc.canon_commit_id)::text),'conversion_version','fixture-conversion-v1')`,'sql');
  fn('commit_response','p_commit text,p_result text','jsonb',`SELECT text_commit_response(p_commit,p_result)||jsonb_build_object('complete_output',commit_output_manifest(p_commit))`,'sql');
  fn('assert_item_target','i canon_commit_item','void',`DECLARE t record;BEGIN
    IF (SELECT count(*) FROM all_item_targets WHERE commit_item_id=i.commit_item_id)<>1 THEN PERFORM reject('item_target_cardinality');END IF;
    SELECT * INTO t FROM all_item_targets WHERE commit_item_id=i.commit_item_id;
    IF t.kind IS DISTINCT FROM i.target_type THEN PERFORM reject('item_target_type');END IF;
    IF t.id IS DISTINCT FROM i.target_id THEN PERFORM reject('item_target_id');END IF;
  END;`);
  fn('assert_evidence','p_id text,cc canon_commit,loc jsonb','void',`DECLARE e evidence_reference;s evidence_canon_source;v canonical_text_version;BEGIN
    SELECT * INTO e FROM evidence_reference WHERE evidence_reference_id=p_id;
    SELECT * INTO s FROM evidence_canon_source WHERE evidence_reference_id=p_id;
    IF s.evidence_reference_id IS NULL THEN PERFORM reject('evidence_source_missing');END IF;
    IF e.source_version_id IS DISTINCT FROM cc.canonical_text_version_id OR e.source_object_id IS DISTINCT FROM cc.canonical_text_version_id OR s.canonical_text_version_id IS DISTINCT FROM cc.canonical_text_version_id OR s.canon_commit_id IS DISTINCT FROM cc.canon_commit_id THEN PERFORM reject('evidence_source_scope');END IF;
    SELECT * INTO v FROM canonical_text_version WHERE canonical_text_version_id=s.canonical_text_version_id;
    IF NOT check_locator(v.body,e.locator) OR e.locator IS DISTINCT FROM loc THEN PERFORM reject('evidence_locator');END IF;
  END;`);
  fn('assert_mapping','m candidate_to_canon_mapping,cc canon_commit','void',`DECLARE s candidate_to_canon_candidate_source;i canon_commit_item;p record;o record;actual_kind text;actual_id text;a narrative_assertion;BEGIN
    SELECT * INTO s FROM candidate_to_canon_candidate_source WHERE mapping_id=m.mapping_id;
    IF NOT FOUND THEN PERFORM reject('mapping_source_missing');END IF;
    actual_kind:=CASE WHEN s.candidate_event_id IS NOT NULL THEN 'candidate_event' WHEN s.candidate_fact_proposal_id IS NOT NULL THEN 'candidate_fact_proposal' ELSE 'candidate_state_transition' END;
    actual_id:=coalesce(s.candidate_event_id,s.candidate_fact_proposal_id,s.candidate_state_transition_id);
    IF m.candidate_object_type IS DISTINCT FROM s.candidate_object_type OR actual_kind IS DISTINCT FROM s.candidate_object_type THEN PERFORM reject('mapping_source_type');END IF;
    IF m.candidate_object_id IS DISTINCT FROM s.candidate_object_id OR actual_id IS DISTINCT FROM s.candidate_object_id THEN PERFORM reject('mapping_source_id');END IF;
    SELECT * INTO p FROM all_candidate_proposals WHERE kind=actual_kind AND id=actual_id;
    IF m.candidate_version_id IS DISTINCT FROM cc.candidate_version_id OR p.candidate_version_id IS DISTINCT FROM m.candidate_version_id
      OR (SELECT workflow_id FROM candidate_version WHERE candidate_version_id=m.candidate_version_id) IS DISTINCT FROM cc.workflow_id THEN PERFORM reject('mapping_candidate_workflow');END IF;
    IF m.candidate_object_hash IS DISTINCT FROM proposal_hash(p.kind,p.payload) THEN PERFORM reject('mapping_object_hash');END IF;
    IF m.candidate_content_hash IS DISTINCT FROM (SELECT digest_text(body) FROM candidate_version WHERE candidate_version_id=m.candidate_version_id) THEN PERFORM reject('mapping_content_hash');END IF;
    SELECT * INTO i FROM canon_commit_item WHERE commit_item_id=m.canon_commit_item_id;
    IF i.canon_commit_id IS DISTINCT FROM cc.canon_commit_id OR i.source_mapping_id IS DISTINCT FROM m.mapping_id THEN PERFORM reject('mapping_item_backref');END IF;
    IF i.target_type IS DISTINCT FROM target_kind(p.kind) THEN PERFORM reject('mapping_target_type');END IF;
    SELECT * INTO o FROM all_canon_objects WHERE kind=i.target_type AND id=i.target_id;
    IF o.id IS NULL OR o.canon_commit_id IS DISTINCT FROM cc.canon_commit_id OR o.project_id IS DISTINCT FROM cc.project_id THEN PERFORM reject('canon_object_scope');END IF;
    IF o.id=p.id THEN PERFORM reject('canon_source_identity_reused');END IF;
    IF o.payload IS DISTINCT FROM expected_canon_fields(p.kind,p.payload,cc) THEN PERFORM reject('canon_conversion_content');END IF;
    SELECT * INTO a FROM narrative_assertion WHERE assertion_id=p.assertion_id;
    PERFORM assert_evidence(o.evidence_reference_id,cc,a.locator);
  END;`);
  fn('assert_commit_complete','p_commit text','void',`DECLARE cc canon_commit;i canon_commit_item;m candidate_to_canon_mapping;expected integer;actual_set jsonb;BEGIN
    SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=p_commit;
    PERFORM assert_text_chain(cc.canonical_text_identity_id);
    PERFORM assert_text_core_complete(p_commit);
    expected:=jsonb_array_length(manifest_ids(cc.candidate_version_id));
    FOR i IN SELECT * FROM canon_commit_item WHERE canon_commit_id=p_commit ORDER BY commit_item_id LOOP
      PERFORM assert_item_target(i);
      IF i.target_type='canonical_text' THEN IF i.source_mapping_id IS NOT NULL THEN PERFORM reject('text_item_mapping_forbidden');END IF;
      ELSIF NOT EXISTS(SELECT 1 FROM candidate_to_canon_mapping WHERE mapping_id=i.source_mapping_id AND canon_commit_item_id=i.commit_item_id AND canon_commit_id=p_commit) THEN PERFORM reject('item_mapping_missing');END IF;
    END LOOP;
    IF (SELECT count(*) FROM canon_commit_item WHERE canon_commit_id=p_commit)<>expected+1 THEN PERFORM reject('commit_item_count');END IF;
    IF (SELECT count(*) FROM all_canon_objects WHERE canon_commit_id=p_commit)<>expected THEN PERFORM reject('canon_object_count');END IF;
    IF (SELECT count(*) FROM candidate_to_canon_mapping WHERE canon_commit_id=p_commit)<>expected THEN PERFORM reject('mapping_count');END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('type',candidate_object_type,'id',candidate_object_id) ORDER BY candidate_object_type COLLATE "C",candidate_object_id COLLATE "C"),'[]'::jsonb) INTO actual_set FROM candidate_to_canon_mapping WHERE canon_commit_id=p_commit;
    IF actual_set IS DISTINCT FROM manifest_ids(cc.candidate_version_id) THEN PERFORM reject('mapping_frozen_set');END IF;
    FOR m IN SELECT * FROM candidate_to_canon_mapping WHERE canon_commit_id=p_commit ORDER BY candidate_object_type,candidate_object_id LOOP PERFORM assert_mapping(m,cc);END LOOP;
    IF EXISTS(SELECT 1 FROM all_canon_objects o WHERE o.canon_commit_id=p_commit AND NOT EXISTS(SELECT 1 FROM canon_commit_item ci WHERE ci.canon_commit_id=p_commit AND ci.target_type=o.kind AND ci.target_id=o.id)) THEN PERFORM reject('canon_object_item_missing');END IF;
    IF EXISTS(SELECT 1 FROM evidence_reference e JOIN canonical_text_version v ON v.canonical_text_version_id=e.source_object_id WHERE v.canon_commit_id=p_commit AND NOT EXISTS(SELECT 1 FROM all_canon_objects o WHERE o.canon_commit_id=p_commit AND o.evidence_reference_id=e.evidence_reference_id)) THEN PERFORM reject('evidence_unused');END IF;
  END;`);
  fn('structured_complete_trigger','','trigger',`BEGIN PERFORM assert_commit_complete(row_commit_id(TG_TABLE_NAME,to_jsonb(NEW)));RETURN NEW;END;`);
  const structuredInputs=['entity','state_dimension','fixture_world_record','narrative_assertion','narrative_assertion_candidate_source','assertion_confirmation_basis','candidate_event','candidate_fact_proposal','candidate_state_transition'];
  const structuredChildren=['evidence_reference','evidence_canon_source','story_event','canon_fact','state_transition','canon_commit_item_story_event_target','canon_commit_item_fact_target','canon_commit_item_state_target','candidate_to_canon_mapping','candidate_to_canon_candidate_source'];
  for(const table of structuredInputs)sql(`CREATE TRIGGER structured_input BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.structured_input_guard();`);
  sql(`CREATE TRIGGER freeze_guard BEFORE INSERT ON ${schema}.candidate_submission_manifest FOR EACH ROW EXECUTE FUNCTION ${schema}.freeze_guard();`);
  for(const table of ['narrative_assertion','narrative_assertion_candidate_source'])sql(`CREATE CONSTRAINT TRIGGER assertion_source_complete AFTER INSERT ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.assertion_source_complete();`);
  for(const table of structuredChildren)sql(`CREATE TRIGGER structured_child BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.structured_child_guard();
    CREATE CONSTRAINT TRIGGER structured_complete AFTER INSERT ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.structured_complete_trigger();`);
  for(const table of [...structuredInputs,'candidate_submission_manifest',...structuredChildren])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON ${schema}.${table} FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.immutable();`);

  // Revision intent is an immutable input, never a mutable approval shortcut.
  sql(`CREATE TABLE ${schema}.candidate_revision_intent (
    candidate_version_id text PRIMARY KEY REFERENCES ${schema}.candidate_version,
    canonical_text_identity_id text NOT NULL REFERENCES ${schema}.canonical_text_identity_root,
    expected_old_text_version_id text NOT NULL REFERENCES ${schema}.canonical_text_version,
    reason text NOT NULL CHECK(length(btrim(reason))>0),
    revision_contract_version text NOT NULL CHECK(revision_contract_version='fixture-text-revision-v1'));
    CREATE TABLE ${schema}.canon_relation_target (
      target_ref_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      relation_kind text NOT NULL CHECK(relation_kind='supersession'),
      target_type text NOT NULL CHECK(target_type='canonical_text'),
      target_commit_id text REFERENCES ${schema}.canon_commit,
      target_text_version_id text NOT NULL REFERENCES ${schema}.canonical_text_version,
      target_story_event_id text REFERENCES ${schema}.story_event,
      target_fact_id text REFERENCES ${schema}.canon_fact,
      target_state_transition_id text REFERENCES ${schema}.state_transition,
      created_by_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,
      CONSTRAINT text_relation_target_shape CHECK(num_nonnulls(target_commit_id,target_text_version_id,target_story_event_id,target_fact_id,target_state_transition_id)=1),
      CONSTRAINT one_successor_per_old_text UNIQUE(target_text_version_id));
    CREATE TABLE ${schema}.supersession_relation (
      relation_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      canon_commit_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_commit,
      target_ref_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_relation_target DEFERRABLE INITIALLY DEFERRED,
      replacement_commit_id text NOT NULL REFERENCES ${schema}.canon_commit,
      reason text NOT NULL CHECK(length(btrim(reason))>0), UNIQUE(target_ref_id,replacement_commit_id));`);

  fn('revision_intent_guard','','trigger',`DECLARE task scene_task_version; old canonical_text_version; root canonical_text_identity_root; cc canon_commit;
  BEGIN
    PERFORM input_set_lock(NEW.candidate_version_id);
    SELECT t.* INTO task FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id) WHERE c.candidate_version_id=NEW.candidate_version_id;
    SELECT * INTO root FROM canonical_text_identity_root WHERE canonical_text_identity_id=NEW.canonical_text_identity_id;
    SELECT * INTO old FROM canonical_text_version WHERE canonical_text_version_id=NEW.expected_old_text_version_id;
    SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=old.canon_commit_id;
    IF root.scene_id IS DISTINCT FROM task.scene_id OR NOT EXISTS(SELECT 1 FROM chapter WHERE chapter_id=root.chapter_id AND project_id=task.project_id)
      OR cc.project_id IS DISTINCT FROM task.project_id OR old.canonical_text_identity_id IS DISTINCT FROM root.canonical_text_identity_id THEN PERFORM reject('revision_intent_scope');END IF;
    IF cc.result IS DISTINCT FROM 'committed' OR cc.canonical_text_version_id IS DISTINCT FROM old.canonical_text_version_id THEN PERFORM reject('revision_old_not_successful');END IF;
    IF cc.candidate_version_id=NEW.candidate_version_id THEN PERFORM reject('revision_new_candidate_required');END IF;
    RETURN NEW;
  END;`);
  fn('assert_request_intent','r jsonb','void',`DECLARE i candidate_revision_intent;BEGIN
    SELECT * INTO i FROM candidate_revision_intent WHERE candidate_version_id=r->>'candidate_version_id';
    IF r->>'mode'='initial_text' THEN
      IF i.candidate_version_id IS NOT NULL THEN PERFORM reject('initial_has_revision_intent');END IF;
      RETURN;
    END IF;
    IF i.candidate_version_id IS NULL THEN PERFORM reject('revision_intent_required');END IF;
    IF i.canonical_text_identity_id IS DISTINCT FROM r->>'canonical_text_identity_id' THEN PERFORM reject('revision_intent_request_identity');END IF;
    IF r->'structured_outputs' IS DISTINCT FROM '[]'::jsonb OR manifest_ids(i.candidate_version_id)<>'[]'::jsonb THEN PERFORM reject('revision_new_structured_forbidden');END IF;
  END;`);
  // Validate every edge before deriving current. Version arithmetic precludes cycles;
  // unique identity/version and unique old target preclude alternate forks.
  fn('assert_text_chain','p_identity text','text',`DECLARE v canonical_text_version; cc canon_commit; intent candidate_revision_intent;
    rel supersession_relation; target canon_relation_target; previous canonical_text_version; n integer:=0; root canonical_text_identity_root; p text;
  BEGIN
    SELECT * INTO root FROM canonical_text_identity_root WHERE canonical_text_identity_id=p_identity;
    SELECT project_id INTO p FROM chapter WHERE chapter_id=root.chapter_id;
    FOR v IN SELECT * FROM canonical_text_version WHERE canonical_text_identity_id=p_identity ORDER BY version_no LOOP
      n:=n+1;SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=v.canon_commit_id;
      IF v.version_no<>n THEN PERFORM reject('text_chain_version_gap');END IF;
      IF cc.result IS DISTINCT FROM 'committed' OR cc.canonical_text_version_id IS DISTINCT FROM v.canonical_text_version_id
        OR cc.canonical_text_identity_id IS DISTINCT FROM p_identity OR cc.project_id IS DISTINCT FROM p
        OR NOT EXISTS(SELECT 1 FROM workflow_identity w JOIN scene_task_version t USING(task_version_id) WHERE w.workflow_id=cc.workflow_id AND t.scene_id=root.scene_id)
        THEN PERFORM reject('text_chain_commit_scope');END IF;
      SELECT * INTO intent FROM candidate_revision_intent WHERE candidate_version_id=cc.candidate_version_id;
      IF n=1 THEN
        IF cc.request_payload->>'mode' IS DISTINCT FROM 'initial_text' OR intent.candidate_version_id IS NOT NULL
          OR EXISTS(SELECT 1 FROM supersession_relation WHERE canon_commit_id=cc.canon_commit_id)
          OR EXISTS(SELECT 1 FROM canon_relation_target WHERE created_by_commit_id=cc.canon_commit_id) THEN PERFORM reject('initial_supersession_forbidden');END IF;
      ELSE
        IF cc.request_payload->>'mode' IS DISTINCT FROM 'revise_text' OR intent.canonical_text_identity_id IS DISTINCT FROM p_identity
          OR intent.expected_old_text_version_id IS DISTINCT FROM previous.canonical_text_version_id THEN PERFORM reject('text_chain_old_binding');END IF;
        IF (SELECT count(*) FROM supersession_relation WHERE canon_commit_id=cc.canon_commit_id)<>1 THEN PERFORM reject('supersession_missing');END IF;
        SELECT * INTO rel FROM supersession_relation WHERE canon_commit_id=cc.canon_commit_id;
        SELECT * INTO target FROM canon_relation_target WHERE target_ref_id=rel.target_ref_id;
        IF target.target_ref_id IS NULL THEN PERFORM reject('supersession_target_missing');END IF;
        IF (SELECT count(*) FROM canon_relation_target WHERE created_by_commit_id=cc.canon_commit_id)<>1
          OR target.created_by_commit_id IS DISTINCT FROM cc.canon_commit_id OR rel.replacement_commit_id IS DISTINCT FROM cc.canon_commit_id
          OR target.target_text_version_id IS DISTINCT FROM previous.canonical_text_version_id
          OR target.relation_kind IS DISTINCT FROM 'supersession' OR target.target_type IS DISTINCT FROM 'canonical_text'
          OR rel.reason IS DISTINCT FROM intent.reason THEN PERFORM reject('supersession_binding');END IF;
        IF cc.success_commit_sequence<=(SELECT success_commit_sequence FROM canon_commit WHERE canon_commit_id=previous.canon_commit_id) THEN PERFORM reject('supersession_future_or_cycle');END IF;
        IF manifest_ids(cc.candidate_version_id)<>'[]'::jsonb OR EXISTS(SELECT 1 FROM all_canon_objects WHERE canon_commit_id IN (cc.canon_commit_id,previous.canon_commit_id)) THEN PERFORM reject('revision_structured_forbidden');END IF;
      END IF;
      previous:=v;
    END LOOP;
    RETURN previous.canonical_text_version_id;
  END;`);
  fn('assert_revision_admission','cc canon_commit','void',`DECLARE i candidate_revision_intent;current_id text;old canonical_text_version;BEGIN
    PERFORM assert_request_intent(cc.request_payload);
    current_id:=assert_text_chain(cc.canonical_text_identity_id);
    IF cc.request_payload->>'mode'='initial_text' THEN
      IF current_id IS NOT NULL THEN PERFORM reject('initial_identity_already_committed');END IF;RETURN;
    END IF;
    SELECT * INTO i FROM candidate_revision_intent WHERE candidate_version_id=cc.candidate_version_id;
    IF i.expected_old_text_version_id IS DISTINCT FROM current_id THEN PERFORM reject('revision_old_not_current');END IF;
    SELECT * INTO old FROM canonical_text_version WHERE canonical_text_version_id=current_id FOR UPDATE;
    PERFORM 1 FROM canon_commit WHERE canon_commit_id=old.canon_commit_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM all_canon_objects WHERE canon_commit_id=old.canon_commit_id) THEN PERFORM reject('revision_old_structured_forbidden');END IF;
    IF cc.candidate_version_id=(SELECT candidate_version_id FROM canon_commit WHERE canon_commit_id=old.canon_commit_id)
      OR cc.approval_id=(SELECT approval_id FROM canon_commit WHERE canon_commit_id=old.canon_commit_id) THEN PERFORM reject('revision_new_approval_required');END IF;
  END;`);
  fn('next_text_version','p_candidate text','integer',`SELECT coalesce((SELECT v.version_no+1 FROM candidate_revision_intent i JOIN canonical_text_version v ON v.canonical_text_version_id=i.expected_old_text_version_id WHERE i.candidate_version_id=p_candidate),1)`,'sql');
  fn('write_supersession','cc canon_commit','void',`DECLARE intent candidate_revision_intent;ref text;BEGIN
    SELECT * INTO intent FROM candidate_revision_intent WHERE candidate_version_id=cc.candidate_version_id;
    IF NOT FOUND THEN RETURN;END IF;
    INSERT INTO canon_relation_target(relation_kind,target_type,target_text_version_id,created_by_commit_id)
      VALUES('supersession','canonical_text',intent.expected_old_text_version_id,cc.canon_commit_id) RETURNING target_ref_id INTO ref;
    INSERT INTO supersession_relation(canon_commit_id,target_ref_id,replacement_commit_id,reason) VALUES(cc.canon_commit_id,ref,cc.canon_commit_id,intent.reason);
  END;`);


  fn('relation_child_guard','','trigger',`DECLARE cc canon_commit;target_project text;BEGIN
    IF TG_TABLE_NAME='canon_relation_target' THEN SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=NEW.created_by_commit_id;
    ELSE SELECT * INTO cc FROM canon_commit WHERE canon_commit_id=NEW.canon_commit_id;END IF;
    IF cc.canon_commit_id IS NULL THEN PERFORM reject('child_commit_missing');END IF;
    PERFORM lock_scope(cc.project_id);
    IF cc.created_transaction IS DISTINCT FROM pg_current_xact_id() THEN PERFORM reject('historical_output_append');END IF;
    -- 跨项目目标在 FK 检查可能取得其他项目 Canon 行锁之前拒绝。
    IF TG_TABLE_NAME='canon_relation_target' THEN
      SELECT c.project_id INTO target_project FROM canonical_text_version v JOIN canon_commit c USING(canon_commit_id) WHERE v.canonical_text_version_id=NEW.target_text_version_id;
    ELSE SELECT project_id INTO target_project FROM canon_commit WHERE canon_commit_id=NEW.replacement_commit_id;END IF;
    IF target_project IS NOT NULL AND target_project<>cc.project_id THEN PERFORM reject('relation_target_project_mismatch');END IF;
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=cc.canonical_text_identity_id FOR UPDATE;
    RETURN NEW;
  END;`);
  fn('relation_complete_trigger','','trigger',`DECLARE c text;BEGIN
    IF TG_TABLE_NAME='canon_relation_target' THEN c:=NEW.created_by_commit_id;ELSE c:=NEW.canon_commit_id;END IF;
    PERFORM assert_commit_complete(c);RETURN NEW;
  END;`);
  sql(`CREATE OR REPLACE VIEW ${schema}.canonical_text_identity AS SELECT i.*,${schema}.assert_text_chain(i.canonical_text_identity_id) AS current_canonical_text_version_id FROM ${schema}.canonical_text_identity_root i;
    CREATE TRIGGER revision_intent_guard BEFORE INSERT ON ${schema}.candidate_revision_intent FOR EACH ROW EXECUTE FUNCTION ${schema}.revision_intent_guard();`);
  for(const table of ['canon_relation_target','supersession_relation']) sql(`CREATE TRIGGER relation_child_guard BEFORE INSERT ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.relation_child_guard();
    CREATE CONSTRAINT TRIGGER relation_complete AFTER INSERT ON ${schema}.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${schema}.relation_complete_trigger();`);
  for(const table of ['candidate_revision_intent','canon_relation_target','supersession_relation']) sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON ${schema}.${table} FOR EACH ROW EXECUTE FUNCTION ${schema}.immutable();
    CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON ${schema}.${table} FOR EACH STATEMENT EXECUTE FUNCTION ${schema}.immutable();`);

}

export async function down(pgm) {
  pgm.sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
