/**
 * Tool Evidence 来源完整性与去重约束验证夹具。
 * 这些对象位于独立 fixture schema，不是正式业务 Schema。
 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS evidence_tool_constraint_fixture;
    SET search_path TO evidence_tool_constraint_fixture, public;

    CREATE TABLE project (
      project_id text PRIMARY KEY
    );

    CREATE TABLE scene_task_version (
      scene_task_version_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id)
    );

    CREATE TABLE workflow_run (
      workflow_run_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      scene_task_version_id text NOT NULL REFERENCES scene_task_version(scene_task_version_id)
    );

    CREATE TABLE context_bundle (
      context_bundle_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      scene_task_version_id text NOT NULL REFERENCES scene_task_version(scene_task_version_id),
      workflow_run_id text NOT NULL REFERENCES workflow_run(workflow_run_id)
    );

    CREATE TABLE generation_run (
      generation_run_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      workflow_run_id text NOT NULL REFERENCES workflow_run(workflow_run_id),
      context_bundle_id text NOT NULL REFERENCES context_bundle(context_bundle_id)
    );

    CREATE TABLE tool_call (
      tool_call_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      generation_run_id text NOT NULL REFERENCES generation_run(generation_run_id),
      tool_name text NOT NULL,
      request_ref text NOT NULL,
      response_ref text
    );

    CREATE TABLE evidence_reference (
      evidence_reference_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      source_domain text NOT NULL,
      source_version_id text NOT NULL,
      source_object_type text NOT NULL,
      source_object_id text NOT NULL,
      locator text NOT NULL,
      evidence_kind text NOT NULL,
      CONSTRAINT ck_evidence_reference_tool_domain CHECK (source_domain = 'tool'),
      CONSTRAINT ck_evidence_reference_tool_type CHECK (source_object_type = 'tool_call'),
      CONSTRAINT ck_evidence_reference_locator_nonempty CHECK (btrim(locator) <> ''),
      CONSTRAINT ck_evidence_reference_kind_nonempty CHECK (btrim(evidence_kind) <> ''),
      CONSTRAINT uq_evidence_reference_full_identity UNIQUE (
        source_domain,
        source_version_id,
        source_object_type,
        source_object_id,
        locator,
        evidence_kind
      )
    );

    CREATE INDEX idx_evidence_reference_legacy_lookup
      ON evidence_reference(source_domain, source_version_id, locator, evidence_kind);

    CREATE TABLE evidence_tool_source (
      evidence_reference_id text PRIMARY KEY
        REFERENCES evidence_reference(evidence_reference_id),
      tool_call_id text NOT NULL
        CONSTRAINT fk_evidence_tool_call
        REFERENCES tool_call(tool_call_id),
      source_ref text NOT NULL,
      CONSTRAINT ck_evidence_tool_source_ref_nonempty CHECK (btrim(source_ref) <> '')
    );

    CREATE TABLE evidence_consumer_reference (
      consumer_reference_id text PRIMARY KEY,
      evidence_reference_id text NOT NULL REFERENCES evidence_reference(evidence_reference_id),
      consumer_kind text NOT NULL
    );

    CREATE OR REPLACE FUNCTION raise_evidence_tool_complete(message text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_tool_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_tool_complete',
        MESSAGE = message;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_tool(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_tool_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_tool_source%ROWTYPE;
      tool_project text;
      tool_generation text;
      generation_project text;
      workflow_project text;
      bundle_project text;
      workflow_task_project text;
      bundle_task_project text;
      workflow_task_version text;
      bundle_task_version text;
      generation_workflow text;
      bundle_workflow text;
      source_count integer;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT count(*) INTO source_count
        FROM evidence_tool_source
       WHERE evidence_reference_id = evidence_id;
      IF source_count <> 1 THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s must have exactly one Tool source row', evidence_id)
        );
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_tool_source
       WHERE evidence_reference_id = evidence_id;

      SELECT tc.project_id,
             tc.generation_run_id,
             gr.project_id,
             wr.project_id,
             cb.project_id,
             wstv.project_id,
             bstv.project_id,
             wr.scene_task_version_id,
             cb.scene_task_version_id,
             gr.workflow_run_id,
             cb.workflow_run_id
        INTO tool_project,
             tool_generation,
             generation_project,
             workflow_project,
             bundle_project,
             workflow_task_project,
             bundle_task_project,
             workflow_task_version,
             bundle_task_version,
             generation_workflow,
             bundle_workflow
        FROM tool_call tc
        JOIN generation_run gr ON gr.generation_run_id = tc.generation_run_id
        JOIN workflow_run wr ON wr.workflow_run_id = gr.workflow_run_id
        JOIN context_bundle cb ON cb.context_bundle_id = gr.context_bundle_id
        JOIN scene_task_version wstv
          ON wstv.scene_task_version_id = wr.scene_task_version_id
        JOIN scene_task_version bstv
          ON bstv.scene_task_version_id = cb.scene_task_version_id
       WHERE tc.tool_call_id = source_row.tool_call_id;

      IF NOT FOUND THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s Tool Call execution chain is incomplete', evidence_id)
        );
      END IF;

      IF parent_row.source_domain <> 'tool'
         OR parent_row.source_object_type <> 'tool_call'
         OR parent_row.source_object_id <> source_row.tool_call_id
         OR parent_row.source_version_id <> tool_generation THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s parent identity does not match its Tool Call source', evidence_id)
        );
      END IF;

      IF parent_row.project_id <> tool_project
         OR tool_project <> generation_project
         OR generation_project <> workflow_project
         OR generation_project <> bundle_project
         OR generation_project <> workflow_task_project
         OR generation_project <> bundle_task_project THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s execution project ownership does not match', evidence_id)
        );
      END IF;

      IF generation_workflow <> bundle_workflow THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s Generation Run and Context Bundle use different Workflow Runs', evidence_id)
        );
      END IF;

      IF workflow_task_version <> bundle_task_version THEN
        PERFORM raise_evidence_tool_complete(
          format('Evidence %s Workflow Run and Context Bundle use different Scene Task Versions', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_tool_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_tool_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'evidence_reference' THEN
        PERFORM validate_evidence_tool(COALESCE(NEW.evidence_reference_id, OLD.evidence_reference_id));
      ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM validate_evidence_tool(OLD.evidence_reference_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM validate_evidence_tool(NEW.evidence_reference_id);
        END IF;
      END IF;
      RETURN NULL;
    END;
    $function$;

    CREATE CONSTRAINT TRIGGER evidence_reference_complete
      AFTER INSERT OR UPDATE ON evidence_reference
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_tool_trigger();

    CREATE CONSTRAINT TRIGGER evidence_tool_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_tool_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_tool_trigger();

    CREATE OR REPLACE FUNCTION reject_evidence_tool_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_tool_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_tool_immutable',
        MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
    END;
    $function$;

    CREATE TRIGGER evidence_reference_immutable
      BEFORE UPDATE OR DELETE ON evidence_reference
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_tool_mutation();

    CREATE TRIGGER evidence_tool_source_immutable
      BEFORE UPDATE OR DELETE ON evidence_tool_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_tool_mutation();

    CREATE OR REPLACE FUNCTION protect_tool_source_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_tool_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      old_row jsonb := to_jsonb(OLD);
      new_row jsonb := to_jsonb(NEW);
    BEGIN
      IF TG_TABLE_NAME = 'scene_task_version'
         AND old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id' THEN
        PERFORM raise_evidence_tool_complete('Scene Task Version project ownership is immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'workflow_run'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'scene_task_version_id' IS DISTINCT FROM new_row->>'scene_task_version_id') THEN
        PERFORM raise_evidence_tool_complete('Workflow Run ownership and task binding are immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'context_bundle'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'scene_task_version_id' IS DISTINCT FROM new_row->>'scene_task_version_id'
              OR old_row->>'workflow_run_id' IS DISTINCT FROM new_row->>'workflow_run_id') THEN
        PERFORM raise_evidence_tool_complete('Context Bundle ownership and task binding are immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'generation_run'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'workflow_run_id' IS DISTINCT FROM new_row->>'workflow_run_id'
              OR old_row->>'context_bundle_id' IS DISTINCT FROM new_row->>'context_bundle_id') THEN
        PERFORM raise_evidence_tool_complete('Generation Run ownership and input binding are immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'tool_call'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'generation_run_id' IS DISTINCT FROM new_row->>'generation_run_id'
              OR old_row->>'tool_name' IS DISTINCT FROM new_row->>'tool_name'
              OR old_row->>'request_ref' IS DISTINCT FROM new_row->>'request_ref'
              OR (old_row->>'response_ref' IS NOT NULL
                  AND old_row->>'response_ref' IS DISTINCT FROM new_row->>'response_ref')) THEN
        PERFORM raise_evidence_tool_complete('Tool Call identity, input binding, and existing result are immutable in this fixture');
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER scene_task_version_ownership_immutable
      BEFORE UPDATE ON scene_task_version
      FOR EACH ROW EXECUTE FUNCTION protect_tool_source_ownership();
    CREATE TRIGGER workflow_run_ownership_immutable
      BEFORE UPDATE ON workflow_run
      FOR EACH ROW EXECUTE FUNCTION protect_tool_source_ownership();
    CREATE TRIGGER context_bundle_ownership_immutable
      BEFORE UPDATE ON context_bundle
      FOR EACH ROW EXECUTE FUNCTION protect_tool_source_ownership();
    CREATE TRIGGER generation_run_ownership_immutable
      BEFORE UPDATE ON generation_run
      FOR EACH ROW EXECUTE FUNCTION protect_tool_source_ownership();
    CREATE TRIGGER tool_call_ownership_immutable
      BEFORE UPDATE ON tool_call
      FOR EACH ROW EXECUTE FUNCTION protect_tool_source_ownership();
  `);
}

export async function down(pgm) {
  pgm.sql('DROP SCHEMA IF EXISTS evidence_tool_constraint_fixture CASCADE;');
}
