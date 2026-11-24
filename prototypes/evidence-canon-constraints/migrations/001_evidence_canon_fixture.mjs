/**
 * Evidence Canon 来源完整性与去重约束验证夹具。
 * 这些对象位于独立 fixture schema，不是正式业务 Schema 或完整 Canon Commit。
 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS evidence_canon_constraint_fixture;
    SET search_path TO evidence_canon_constraint_fixture, public;

    CREATE TABLE project (
      project_id text PRIMARY KEY
    );

    CREATE TABLE canon_commit (
      canon_commit_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      status text NOT NULL,
      CONSTRAINT ck_canon_commit_status CHECK (status IN ('preparing', 'committed', 'failed'))
    );

    CREATE TABLE canonical_text_version (
      canonical_text_version_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE story_event (
      story_event_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE canon_fact (
      canon_fact_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE state_transition (
      state_transition_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE temporal_relation (
      temporal_relation_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
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
      CONSTRAINT ck_evidence_reference_canon_domain CHECK (source_domain = 'canon'),
      CONSTRAINT ck_evidence_reference_canon_type CHECK (
        source_object_type IN (
          'canonical_text_version',
          'canon_commit',
          'story_event',
          'canon_fact',
          'state_transition',
          'temporal_relation'
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

    CREATE TABLE evidence_canon_source (
      evidence_reference_id text PRIMARY KEY
        REFERENCES evidence_reference(evidence_reference_id),
      canonical_text_version_id text
        CONSTRAINT fk_evidence_canon_text_version
        REFERENCES canonical_text_version(canonical_text_version_id),
      canon_commit_id text NOT NULL
        CONSTRAINT fk_evidence_canon_commit
        REFERENCES canon_commit(canon_commit_id),
      source_object_type text NOT NULL,
      source_object_id text NOT NULL,
      source_story_event_id text
        CONSTRAINT fk_evidence_canon_story_event
        REFERENCES story_event(story_event_id),
      source_canon_fact_id text
        CONSTRAINT fk_evidence_canon_fact
        REFERENCES canon_fact(canon_fact_id),
      source_state_transition_id text
        CONSTRAINT fk_evidence_canon_state_transition
        REFERENCES state_transition(state_transition_id),
      source_temporal_relation_id text
        CONSTRAINT fk_evidence_canon_temporal_relation
        REFERENCES temporal_relation(temporal_relation_id),
      CONSTRAINT ck_evidence_canon_source_type CHECK (
        source_object_type IN (
          'canonical_text_version',
          'canon_commit',
          'story_event',
          'canon_fact',
          'state_transition',
          'temporal_relation'
        )
      ),
      CONSTRAINT ck_evidence_canon_source_target_shape CHECK (
        (source_object_type = 'canonical_text_version'
          AND source_object_id = canonical_text_version_id
          AND canonical_text_version_id IS NOT NULL
          AND source_story_event_id IS NULL
          AND source_canon_fact_id IS NULL
          AND source_state_transition_id IS NULL
          AND source_temporal_relation_id IS NULL)
        OR
        (source_object_type = 'canon_commit'
          AND source_object_id = canon_commit_id
          AND canonical_text_version_id IS NULL
          AND source_story_event_id IS NULL
          AND source_canon_fact_id IS NULL
          AND source_state_transition_id IS NULL
          AND source_temporal_relation_id IS NULL)
        OR
        (source_object_type = 'story_event'
          AND source_object_id = source_story_event_id
          AND canonical_text_version_id IS NULL
          AND source_story_event_id IS NOT NULL
          AND source_canon_fact_id IS NULL
          AND source_state_transition_id IS NULL
          AND source_temporal_relation_id IS NULL)
        OR
        (source_object_type = 'canon_fact'
          AND source_object_id = source_canon_fact_id
          AND canonical_text_version_id IS NULL
          AND source_story_event_id IS NULL
          AND source_canon_fact_id IS NOT NULL
          AND source_state_transition_id IS NULL
          AND source_temporal_relation_id IS NULL)
        OR
        (source_object_type = 'state_transition'
          AND source_object_id = source_state_transition_id
          AND canonical_text_version_id IS NULL
          AND source_story_event_id IS NULL
          AND source_canon_fact_id IS NULL
          AND source_state_transition_id IS NOT NULL
          AND source_temporal_relation_id IS NULL)
        OR
        (source_object_type = 'temporal_relation'
          AND source_object_id = source_temporal_relation_id
          AND canonical_text_version_id IS NULL
          AND source_story_event_id IS NULL
          AND source_canon_fact_id IS NULL
          AND source_state_transition_id IS NULL
          AND source_temporal_relation_id IS NOT NULL)
      )
    );

    CREATE OR REPLACE FUNCTION raise_evidence_canon_complete(message text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_canon_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_canon_complete',
        MESSAGE = message;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_canon(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_canon_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_canon_source%ROWTYPE;
      commit_project text;
      commit_status text;
      target_project text;
      target_commit text;
      expected_source_version text;
      source_count integer;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT count(*) INTO source_count
        FROM evidence_canon_source
       WHERE evidence_reference_id = evidence_id;
      IF source_count <> 1 THEN
        PERFORM raise_evidence_canon_complete(
          format('Evidence %s must have exactly one Canon source row', evidence_id)
        );
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_canon_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'canon'
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_canon_complete(
          format('Evidence %s parent identity does not match its Canon source row', evidence_id)
        );
      END IF;

      SELECT project_id, status
        INTO commit_project, commit_status
        FROM canon_commit
       WHERE canon_commit_id = source_row.canon_commit_id;
      IF NOT FOUND
         OR commit_status <> 'committed'
         OR parent_row.project_id <> commit_project THEN
        PERFORM raise_evidence_canon_complete(
          format('Evidence %s Commit is absent, not committed, or outside the project', evidence_id)
        );
      END IF;

      CASE source_row.source_object_type
        WHEN 'canonical_text_version' THEN
          expected_source_version := source_row.canonical_text_version_id;
          SELECT project_id, canon_commit_id
            INTO target_project, target_commit
            FROM canonical_text_version
           WHERE canonical_text_version_id = source_row.canonical_text_version_id;
        WHEN 'canon_commit' THEN
          expected_source_version := source_row.canon_commit_id;
          target_project := commit_project;
          target_commit := source_row.canon_commit_id;
        WHEN 'story_event' THEN
          expected_source_version := source_row.canon_commit_id;
          SELECT project_id, canon_commit_id
            INTO target_project, target_commit
            FROM story_event
           WHERE story_event_id = source_row.source_story_event_id;
        WHEN 'canon_fact' THEN
          expected_source_version := source_row.canon_commit_id;
          SELECT project_id, canon_commit_id
            INTO target_project, target_commit
            FROM canon_fact
           WHERE canon_fact_id = source_row.source_canon_fact_id;
        WHEN 'state_transition' THEN
          expected_source_version := source_row.canon_commit_id;
          SELECT project_id, canon_commit_id
            INTO target_project, target_commit
            FROM state_transition
           WHERE state_transition_id = source_row.source_state_transition_id;
        WHEN 'temporal_relation' THEN
          expected_source_version := source_row.canon_commit_id;
          SELECT project_id, canon_commit_id
            INTO target_project, target_commit
            FROM temporal_relation
           WHERE temporal_relation_id = source_row.source_temporal_relation_id;
        ELSE
          PERFORM raise_evidence_canon_complete(
            format('Evidence %s uses an unsupported Canon source type', evidence_id)
          );
      END CASE;

      IF parent_row.source_version_id <> expected_source_version
         OR target_project IS NULL
         OR target_commit IS NULL
         OR target_project <> parent_row.project_id
         OR target_commit <> source_row.canon_commit_id THEN
        PERFORM raise_evidence_canon_complete(
          format('Evidence %s target, version, project, or creating Commit does not match', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_canon_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_canon_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'evidence_reference' THEN
        PERFORM validate_evidence_canon(COALESCE(NEW.evidence_reference_id, OLD.evidence_reference_id));
      ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM validate_evidence_canon(OLD.evidence_reference_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM validate_evidence_canon(NEW.evidence_reference_id);
        END IF;
      END IF;
      RETURN NULL;
    END;
    $function$;

    CREATE CONSTRAINT TRIGGER evidence_reference_complete
      AFTER INSERT OR UPDATE ON evidence_reference
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_canon_trigger();

    CREATE CONSTRAINT TRIGGER evidence_canon_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_canon_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_canon_trigger();

    CREATE OR REPLACE FUNCTION reject_evidence_canon_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_canon_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_canon_immutable',
        MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
    END;
    $function$;

    CREATE TRIGGER evidence_reference_immutable
      BEFORE UPDATE OR DELETE ON evidence_reference
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_canon_mutation();

    CREATE TRIGGER evidence_canon_source_immutable
      BEFORE UPDATE OR DELETE ON evidence_canon_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_canon_mutation();

    CREATE OR REPLACE FUNCTION protect_canon_source_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_canon_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      old_row jsonb := to_jsonb(OLD);
      new_row jsonb := to_jsonb(NEW);
    BEGIN
      IF TG_TABLE_NAME = 'canon_commit' THEN
        IF old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id' THEN
          PERFORM raise_evidence_canon_complete('Canon Commit project ownership is immutable in this fixture');
        END IF;
        IF old_row->>'status' IN ('committed', 'failed')
           AND old_row->>'status' IS DISTINCT FROM new_row->>'status' THEN
          RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'evidence_canon_commit_terminal',
            MESSAGE = 'Committed and failed Canon Commit states are terminal in this fixture';
        END IF;
      ELSIF TG_TABLE_NAME IN (
        'canonical_text_version', 'story_event', 'canon_fact',
        'state_transition', 'temporal_relation'
      ) AND (
        old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
        OR old_row->>'canon_commit_id' IS DISTINCT FROM new_row->>'canon_commit_id'
      ) THEN
        PERFORM raise_evidence_canon_complete('Canon source project and creating Commit are immutable in this fixture');
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER canon_commit_ownership_and_status
      BEFORE UPDATE ON canon_commit
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
    CREATE TRIGGER canonical_text_version_ownership_immutable
      BEFORE UPDATE ON canonical_text_version
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
    CREATE TRIGGER story_event_ownership_immutable
      BEFORE UPDATE ON story_event
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
    CREATE TRIGGER canon_fact_ownership_immutable
      BEFORE UPDATE ON canon_fact
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
    CREATE TRIGGER state_transition_ownership_immutable
      BEFORE UPDATE ON state_transition
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
    CREATE TRIGGER temporal_relation_ownership_immutable
      BEFORE UPDATE ON temporal_relation
      FOR EACH ROW EXECUTE FUNCTION protect_canon_source_ownership();
  `);
}

export async function down(pgm) {
  pgm.sql('DROP SCHEMA IF EXISTS evidence_canon_constraint_fixture CASCADE;');
}
