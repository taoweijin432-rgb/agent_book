/**
 * Evidence Author Design 来源完整性与去重约束验证夹具。
 * 这些对象位于独立 fixture schema，不是正式业务 Schema。
 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS evidence_design_constraint_fixture;
    SET search_path TO evidence_design_constraint_fixture, public;

    CREATE TABLE project (
      project_id text PRIMARY KEY
    );

    CREATE TABLE author_design_revision (
      revision_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id)
    );

    CREATE TABLE design_object_version (
      design_object_version_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE design_constraint (
      design_constraint_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE outline_node (
      outline_node_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE world_rule (
      world_rule_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE temporal_constraint (
      temporal_constraint_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE foreshadowing_plan (
      foreshadowing_plan_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
    );

    CREATE TABLE ending_constraint (
      ending_constraint_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id)
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
      CONSTRAINT ck_evidence_reference_design_domain CHECK (source_domain = 'author_design'),
      CONSTRAINT ck_evidence_reference_design_type CHECK (
        source_object_type IN (
          'author_design_revision',
          'design_object_version',
          'design_constraint',
          'outline_node',
          'world_rule',
          'temporal_constraint',
          'foreshadowing_plan',
          'ending_constraint'
        )
      ),
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

    CREATE TABLE evidence_design_source (
      evidence_reference_id text PRIMARY KEY
        REFERENCES evidence_reference(evidence_reference_id),
      author_design_revision_id text NOT NULL
        REFERENCES author_design_revision(revision_id),
      source_object_type text NOT NULL,
      source_object_id text NOT NULL,
      source_author_design_revision_id text
        CONSTRAINT fk_evidence_design_revision
        REFERENCES author_design_revision(revision_id),
      source_design_object_version_id text
        CONSTRAINT fk_evidence_design_object_version
        REFERENCES design_object_version(design_object_version_id),
      source_design_constraint_id text
        CONSTRAINT fk_evidence_design_constraint
        REFERENCES design_constraint(design_constraint_id),
      source_outline_node_id text
        CONSTRAINT fk_evidence_design_outline_node
        REFERENCES outline_node(outline_node_id),
      source_world_rule_id text
        CONSTRAINT fk_evidence_design_world_rule
        REFERENCES world_rule(world_rule_id),
      source_temporal_constraint_id text
        CONSTRAINT fk_evidence_design_temporal_constraint
        REFERENCES temporal_constraint(temporal_constraint_id),
      source_foreshadowing_plan_id text
        CONSTRAINT fk_evidence_design_foreshadowing_plan
        REFERENCES foreshadowing_plan(foreshadowing_plan_id),
      source_ending_constraint_id text
        CONSTRAINT fk_evidence_design_ending_constraint
        REFERENCES ending_constraint(ending_constraint_id),
      CONSTRAINT ck_evidence_design_source_type CHECK (
        source_object_type IN (
          'author_design_revision',
          'design_object_version',
          'design_constraint',
          'outline_node',
          'world_rule',
          'temporal_constraint',
          'foreshadowing_plan',
          'ending_constraint'
        )
      ),
      CONSTRAINT ck_evidence_design_source_target_shape CHECK (
        (source_object_type = 'author_design_revision'
          AND source_author_design_revision_id IS NOT NULL
          AND source_object_id = source_author_design_revision_id
          AND source_author_design_revision_id = author_design_revision_id
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'design_object_version'
          AND source_object_id = source_design_object_version_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NOT NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'design_constraint'
          AND source_object_id = source_design_constraint_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NOT NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'outline_node'
          AND source_object_id = source_outline_node_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NOT NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'world_rule'
          AND source_object_id = source_world_rule_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NOT NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'temporal_constraint'
          AND source_object_id = source_temporal_constraint_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NOT NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'foreshadowing_plan'
          AND source_object_id = source_foreshadowing_plan_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NOT NULL
          AND source_ending_constraint_id IS NULL)
        OR
        (source_object_type = 'ending_constraint'
          AND source_object_id = source_ending_constraint_id
          AND source_author_design_revision_id IS NULL
          AND source_design_object_version_id IS NULL
          AND source_design_constraint_id IS NULL
          AND source_outline_node_id IS NULL
          AND source_world_rule_id IS NULL
          AND source_temporal_constraint_id IS NULL
          AND source_foreshadowing_plan_id IS NULL
          AND source_ending_constraint_id IS NOT NULL)
      )
    );

    CREATE OR REPLACE FUNCTION raise_evidence_design_complete(message text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_design_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_design_complete',
        MESSAGE = message;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_design(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_design_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_design_source%ROWTYPE;
      revision_project text;
      target_project text;
      target_revision text;
      source_count integer;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT count(*) INTO source_count
        FROM evidence_design_source
       WHERE evidence_reference_id = evidence_id;
      IF source_count <> 1 THEN
        PERFORM raise_evidence_design_complete(
          format('Evidence %s must have exactly one Author Design source row', evidence_id)
        );
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_design_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'author_design'
         OR parent_row.source_version_id <> source_row.author_design_revision_id
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_design_complete(
          format('Evidence %s parent identity does not match its Author Design source row', evidence_id)
        );
      END IF;

      SELECT project_id INTO revision_project
        FROM author_design_revision
       WHERE revision_id = source_row.author_design_revision_id;
      IF NOT FOUND OR revision_project <> parent_row.project_id THEN
        PERFORM raise_evidence_design_complete(
          format('Evidence %s revision and project ownership do not match', evidence_id)
        );
      END IF;

      CASE source_row.source_object_type
        WHEN 'author_design_revision' THEN
          target_project := revision_project;
          target_revision := source_row.source_author_design_revision_id;
        WHEN 'design_object_version' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM design_object_version
           WHERE design_object_version_id = source_row.source_design_object_version_id;
        WHEN 'design_constraint' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM design_constraint
           WHERE design_constraint_id = source_row.source_design_constraint_id;
        WHEN 'outline_node' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM outline_node
           WHERE outline_node_id = source_row.source_outline_node_id;
        WHEN 'world_rule' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM world_rule
           WHERE world_rule_id = source_row.source_world_rule_id;
        WHEN 'temporal_constraint' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM temporal_constraint
           WHERE temporal_constraint_id = source_row.source_temporal_constraint_id;
        WHEN 'foreshadowing_plan' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM foreshadowing_plan
           WHERE foreshadowing_plan_id = source_row.source_foreshadowing_plan_id;
        WHEN 'ending_constraint' THEN
          SELECT project_id, revision_id INTO target_project, target_revision
            FROM ending_constraint
           WHERE ending_constraint_id = source_row.source_ending_constraint_id;
        ELSE
          PERFORM raise_evidence_design_complete(
            format('Evidence %s uses an unsupported Author Design source type', evidence_id)
          );
      END CASE;

      IF target_project IS NULL
         OR target_revision IS NULL
         OR target_project <> parent_row.project_id
         OR target_revision <> source_row.author_design_revision_id THEN
        PERFORM raise_evidence_design_complete(
          format('Evidence %s target does not belong to the selected revision and project', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_design_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_design_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'evidence_reference' THEN
        PERFORM validate_evidence_design(COALESCE(NEW.evidence_reference_id, OLD.evidence_reference_id));
      ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM validate_evidence_design(OLD.evidence_reference_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM validate_evidence_design(NEW.evidence_reference_id);
        END IF;
      END IF;
      RETURN NULL;
    END;
    $function$;

    CREATE CONSTRAINT TRIGGER evidence_reference_complete
      AFTER INSERT OR UPDATE ON evidence_reference
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_design_trigger();

    CREATE CONSTRAINT TRIGGER evidence_design_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_design_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_design_trigger();

    CREATE OR REPLACE FUNCTION reject_evidence_design_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_design_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_design_immutable',
        MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
    END;
    $function$;

    CREATE TRIGGER evidence_reference_immutable
      BEFORE UPDATE OR DELETE ON evidence_reference
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_design_mutation();

    CREATE TRIGGER evidence_design_source_immutable
      BEFORE UPDATE OR DELETE ON evidence_design_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_design_mutation();

    CREATE OR REPLACE FUNCTION protect_design_source_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_design_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      old_row jsonb := to_jsonb(OLD);
      new_row jsonb := to_jsonb(NEW);
    BEGIN
      IF TG_TABLE_NAME = 'author_design_revision'
         AND old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id' THEN
        PERFORM raise_evidence_design_complete('Author Design Revision project ownership is immutable in this fixture');
      ELSIF TG_TABLE_NAME <> 'author_design_revision'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'revision_id' IS DISTINCT FROM new_row->>'revision_id') THEN
        PERFORM raise_evidence_design_complete('Author Design source ownership is immutable in this fixture');
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER author_design_revision_ownership_immutable
      BEFORE UPDATE ON author_design_revision
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER design_object_version_ownership_immutable
      BEFORE UPDATE ON design_object_version
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER design_constraint_ownership_immutable
      BEFORE UPDATE ON design_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER outline_node_ownership_immutable
      BEFORE UPDATE ON outline_node
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER world_rule_ownership_immutable
      BEFORE UPDATE ON world_rule
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER temporal_constraint_ownership_immutable
      BEFORE UPDATE ON temporal_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER foreshadowing_plan_ownership_immutable
      BEFORE UPDATE ON foreshadowing_plan
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
    CREATE TRIGGER ending_constraint_ownership_immutable
      BEFORE UPDATE ON ending_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_design_source_ownership();
  `);
}

export async function down(pgm) {
  pgm.sql('DROP SCHEMA IF EXISTS evidence_design_constraint_fixture CASCADE;');
}
