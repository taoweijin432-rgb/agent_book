const schema = 'canon_commit_atomic_fixture';
const path = `pg_catalog, ${schema}, pg_temp`;

export async function up(pgm) {
  const sql = (value) => pgm.sql(value);
  const fn = (name, args, returns, body, language = 'plpgsql') => sql(`CREATE FUNCTION ${schema}.${name}(${args}) RETURNS ${returns} LANGUAGE ${language} SET search_path = ${path} AS $fn$ ${body} $fn$;`);
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
      digest_spec_version text NOT NULL CHECK(digest_spec_version='canon-request-v1'),
      request_payload jsonb NOT NULL, payload_hash text NOT NULL,
      projection_config_id text NOT NULL REFERENCES ${schema}.projection_target_config,
      input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark>=0),
      success_commit_sequence bigint NOT NULL CHECK(success_commit_sequence>0),
      canon_watermark bigint NOT NULL CHECK(canon_watermark=success_commit_sequence),
      result text NOT NULL CHECK(result='committed'),
      canonical_text_identity_id text NOT NULL REFERENCES ${schema}.canonical_text_identity_root,
      canonical_text_version_id text NOT NULL UNIQUE, committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(project_id,idempotency_key), UNIQUE(project_id,success_commit_sequence));
    CREATE TABLE ${schema}.canonical_text_version (
      canonical_text_version_id text PRIMARY KEY,
      canonical_text_identity_id text NOT NULL REFERENCES ${schema}.canonical_text_identity_root,
      version_no integer NOT NULL CHECK(version_no=1),
      canon_commit_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_commit,
      body text NOT NULL, content_hash text NOT NULL, text_length integer NOT NULL CHECK(text_length>=0),
      UNIQUE(canonical_text_identity_id,version_no));
    ALTER TABLE ${schema}.canon_commit ADD CONSTRAINT commit_text_version_fk FOREIGN KEY(canonical_text_version_id)
      REFERENCES ${schema}.canonical_text_version DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE ${schema}.canon_commit_item (
      commit_item_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      canon_commit_id text NOT NULL UNIQUE REFERENCES ${schema}.canon_commit,
      target_type text NOT NULL CHECK(target_type='canonical_text'), target_id text NOT NULL,
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
    IF r->>'digest_spec_version' IS DISTINCT FROM 'canon-request-v1' THEN PERFORM reject('unknown_digest_version'); END IF;
    IF r->>'mode' IS DISTINCT FROM 'initial_text' THEN PERFORM reject('revision_not_supported'); END IF;
    IF r->'structured_outputs' IS DISTINCT FROM '{"events":[],"facts":[],"state_transitions":[],"assertions":[],"temporal_relations":[],"mappings":[]}'::jsonb THEN PERFORM reject('structured_outputs_not_supported'); END IF;
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
    RETURN jsonb_build_array('canon-request-v1',p_project,r,
      jsonb_build_object('candidate_id',c.candidate_version_id,'body_hash',digest_text(c.body),'workflow_id',c.workflow_id,
        'task_version_id',t.task_version_id,'scene_id',t.scene_id,'bundle_id',c.bundle_id,
        'bundle_hash',(SELECT digest_text(content) FROM context_bundle WHERE bundle_id=c.bundle_id),
        'design_id',t.revision_id,'design_hash',(SELECT digest_text(content::text) FROM author_design_revision WHERE revision_id=t.revision_id),
        'task_input_canon',t.input_canon_watermark,'approval_id',a.approval_id,'approval_binding',approval_binding(a),'decision',a.decision,
        'validation',to_jsonb(v),'rule_hash',(SELECT digest_text(content::text) FROM rule_version WHERE version_id=v.rule_set_version),
        'approval_policy_hash',(SELECT digest_text(content::text) FROM approval_policy_version WHERE version_id=a.approval_policy_version),
        'text_identity',to_jsonb(i),'projection_manifest',config.targets));
  END;`);
  fn('scope_digest', 'p_project text,p_scene text', 'text', `SELECT digest_text(jsonb_build_array('fixture-scene-scope-v1',p_project,p_scene)::text)`, 'sql');
  fn('expected_outbox_event', 'cc canon_commit,p_target text,p_strategy text', 'jsonb', `SELECT jsonb_build_object(
    'event_type','fixture_canon_text_committed_v1','project_id',cc.project_id,'canon_commit_id',cc.canon_commit_id,
    'canonical_text_version_id',cc.canonical_text_version_id,'scene_id',t.scene_id,'source_canon_watermark',cc.canon_watermark,
    'target',p_target,'strategy_version',p_strategy,'projection_config_id',cc.projection_config_id,'payload_hash',cc.payload_hash)
    FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version t USING(task_version_id) WHERE c.candidate_version_id=cc.candidate_version_id`, 'sql');
  fn('commit_guard', '', 'trigger', `DECLARE r jsonb; checked jsonb; t scene_task_version; i canonical_text_identity_root; before_watermark bigint;
  BEGIN
    PERFORM lock_novel(NEW.project_id); r:=NEW.request_payload;
    IF NEW.payload_hash IS DISTINCT FROM digest_text(canonical_request(NEW.project_id,r)::text) THEN PERFORM reject('request_payload_hash'); END IF;
    IF ROW(NEW.workflow_id,NEW.candidate_version_id,NEW.selection_version,NEW.approval_id,NEW.input_canon_watermark,NEW.canonical_text_identity_id,NEW.projection_config_id,NEW.digest_spec_version)
      IS DISTINCT FROM ROW(r->>'workflow_id',r->>'candidate_version_id',(r->>'selection_version')::integer,r->>'approval_id',(r->>'input_canon_watermark')::bigint,r->>'canonical_text_identity_id',r->>'projection_config_id',r->>'digest_spec_version') THEN PERFORM reject('commit_request_binding'); END IF;
    PERFORM lock_scope(NEW.project_id);
    before_watermark:=current_watermark(NEW.project_id);
    IF NEW.input_canon_watermark<>before_watermark THEN PERFORM reject('stale_canon_watermark'); END IF;
    checked:=check_admission(NEW.project_id,NEW.workflow_id,NEW.candidate_version_id,NEW.approval_id,NEW.selection_version);
    IF NOT (checked->>'accepted')::boolean THEN PERFORM reject('admission_'||(checked->'reasons'->>0)); END IF;
    SELECT st.* INTO t FROM candidate_version c JOIN workflow_identity w USING(workflow_id) JOIN scene_task_version st USING(task_version_id) WHERE c.candidate_version_id=NEW.candidate_version_id;
    SELECT * INTO i FROM canonical_text_identity_root WHERE canonical_text_identity_id=NEW.canonical_text_identity_id;
    IF i.scene_id IS DISTINCT FROM t.scene_id OR NOT EXISTS(SELECT 1 FROM chapter WHERE chapter_id=i.chapter_id AND project_id=NEW.project_id) THEN PERFORM reject('commit_text_scope'); END IF;
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=i.canonical_text_identity_id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM canonical_text_version WHERE canonical_text_identity_id=i.canonical_text_identity_id) THEN PERFORM reject('revision_not_supported'); END IF;
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
    PERFORM 1 FROM canonical_text_identity_root WHERE canonical_text_identity_id=cc.canonical_text_identity_id FOR UPDATE;
    PERFORM 1 FROM canon_commit WHERE canon_commit_id=cc.canon_commit_id FOR UPDATE;
    RETURN NEW;
  END;`);
  // Completeness is checked at real COMMIT, including direct INSERTs. Successful historical approval need not remain live afterward.
  fn('assert_commit_complete', 'p_commit text', 'void', `DECLARE cc canon_commit; textrow canonical_text_version; cand candidate_version; item canon_commit_item; task scene_task_version; manifest jsonb;
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
    SELECT * INTO item FROM canon_commit_item WHERE canon_commit_id=p_commit;
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
  fn('commit_response', 'p_commit text,p_result text', 'jsonb', `SELECT jsonb_build_object('result',p_result,'requires_outer_commit',true,
    'canon_commit_id',cc.canon_commit_id,'canonical_text_version_id',cc.canonical_text_version_id,'success_commit_sequence',cc.success_commit_sequence,
    'canon_watermark',cc.canon_watermark,'payload_hash',cc.payload_hash,
    'commit_item_id',(SELECT commit_item_id FROM canon_commit_item WHERE canon_commit_id=p_commit),
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
    INSERT INTO canonical_text_version VALUES(fresh.canonical_text_version_id,fresh.canonical_text_identity_id,1,fresh.canon_commit_id,candidate.body,digest_text(candidate.body),char_length(candidate.body));
    INSERT INTO canon_commit_item(canon_commit_id,target_type,target_id) VALUES(fresh.canon_commit_id,'canonical_text',fresh.canonical_text_version_id) RETURNING commit_item_id INTO item_id;
    INSERT INTO canon_commit_item_text_target VALUES(item_id,fresh.canonical_text_version_id);
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


}

export async function down(pgm) {
  pgm.sql(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`);
}
