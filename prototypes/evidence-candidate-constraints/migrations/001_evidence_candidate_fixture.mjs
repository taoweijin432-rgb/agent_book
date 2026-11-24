/**
 * Evidence Candidate 来源完整性与去重约束验证夹具。
 * 这些对象位于独立 fixture schema，不是正式业务 Schema。
 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS evidence_candidate_constraint_fixture;
    SET search_path TO evidence_candidate_constraint_fixture, public;

    CREATE TABLE project (
      project_id text PRIMARY KEY
    );

    CREATE TABLE workflow_run (
      workflow_run_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id)
    );

    CREATE TABLE candidate_version (
      candidate_version_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      workflow_run_id text NOT NULL REFERENCES workflow_run(workflow_run_id)
    );

    CREATE TABLE candidate_event (
      candidate_event_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id)
    );

    CREATE TABLE candidate_fact_proposal (
      candidate_fact_proposal_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id)
    );

    CREATE TABLE candidate_state_transition (
      candidate_state_transition_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id)
    );

    CREATE TABLE narrative_assertion (
      assertion_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      source_domain text NOT NULL,
      CONSTRAINT ck_narrative_assertion_source_domain CHECK (source_domain IN ('candidate', 'canon'))
    );

    CREATE TABLE narrative_assertion_candidate_source (
      assertion_id text PRIMARY KEY REFERENCES narrative_assertion(assertion_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id),
      source_version_id text NOT NULL,
      CONSTRAINT ck_assertion_candidate_source_version CHECK (source_version_id = candidate_version_id)
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
      CONSTRAINT ck_evidence_reference_candidate_domain CHECK (source_domain = 'candidate'),
      CONSTRAINT ck_evidence_reference_candidate_type CHECK (
        source_object_type IN (
          'candidate_version',
          'candidate_event',
          'candidate_fact_proposal',
          'candidate_state_transition',
          'narrative_assertion'
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

    CREATE TABLE evidence_candidate_source (
      evidence_reference_id text PRIMARY KEY
        REFERENCES evidence_reference(evidence_reference_id),
      candidate_version_id text NOT NULL
        REFERENCES candidate_version(candidate_version_id),
      source_object_type text NOT NULL,
      source_object_id text NOT NULL,
      source_candidate_event_id text
        CONSTRAINT fk_evidence_candidate_event
        REFERENCES candidate_event(candidate_event_id),
      source_candidate_fact_proposal_id text
        CONSTRAINT fk_evidence_candidate_fact_proposal
        REFERENCES candidate_fact_proposal(candidate_fact_proposal_id),
      source_candidate_state_transition_id text
        CONSTRAINT fk_evidence_candidate_state_transition
        REFERENCES candidate_state_transition(candidate_state_transition_id),
      source_assertion_id text
        CONSTRAINT fk_evidence_candidate_assertion
        REFERENCES narrative_assertion(assertion_id),
      CONSTRAINT ck_evidence_candidate_source_type CHECK (
        source_object_type IN (
          'candidate_version',
          'candidate_event',
          'candidate_fact_proposal',
          'candidate_state_transition',
          'narrative_assertion'
        )
      ),
      CONSTRAINT ck_evidence_candidate_source_target_shape CHECK (
        (source_object_type = 'candidate_version'
          AND source_object_id = candidate_version_id
          AND source_candidate_event_id IS NULL
          AND source_candidate_fact_proposal_id IS NULL
          AND source_candidate_state_transition_id IS NULL
          AND source_assertion_id IS NULL)
        OR
        (source_object_type = 'candidate_event'
          AND source_object_id = source_candidate_event_id
          AND source_candidate_event_id IS NOT NULL
          AND source_candidate_fact_proposal_id IS NULL
          AND source_candidate_state_transition_id IS NULL
          AND source_assertion_id IS NULL)
        OR
        (source_object_type = 'candidate_fact_proposal'
          AND source_object_id = source_candidate_fact_proposal_id
          AND source_candidate_event_id IS NULL
          AND source_candidate_fact_proposal_id IS NOT NULL
          AND source_candidate_state_transition_id IS NULL
          AND source_assertion_id IS NULL)
        OR
        (source_object_type = 'candidate_state_transition'
          AND source_object_id = source_candidate_state_transition_id
          AND source_candidate_event_id IS NULL
          AND source_candidate_fact_proposal_id IS NULL
          AND source_candidate_state_transition_id IS NOT NULL
          AND source_assertion_id IS NULL)
        OR
        (source_object_type = 'narrative_assertion'
          AND source_object_id = source_assertion_id
          AND source_candidate_event_id IS NULL
          AND source_candidate_fact_proposal_id IS NULL
          AND source_candidate_state_transition_id IS NULL
          AND source_assertion_id IS NOT NULL)
      )
    );

    CREATE TABLE evidence_consumer_reference (
      consumer_reference_id text PRIMARY KEY,
      evidence_reference_id text NOT NULL REFERENCES evidence_reference(evidence_reference_id),
      consumer_kind text NOT NULL
    );

    CREATE OR REPLACE FUNCTION raise_evidence_candidate_complete(message text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_candidate_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_candidate_complete',
        MESSAGE = message;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_candidate(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_candidate_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_candidate_source%ROWTYPE;
      candidate_project text;
      workflow_project text;
      target_project text;
      target_candidate text;
      assertion_domain text;
      assertion_candidate text;
      assertion_source_version text;
      source_count integer;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT count(*) INTO source_count
        FROM evidence_candidate_source
       WHERE evidence_reference_id = evidence_id;
      IF source_count <> 1 THEN
        PERFORM raise_evidence_candidate_complete(
          format('Evidence %s must have exactly one Candidate source row', evidence_id)
        );
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_candidate_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'candidate'
         OR parent_row.source_version_id <> source_row.candidate_version_id
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_candidate_complete(
          format('Evidence %s parent identity does not match its Candidate source row', evidence_id)
        );
      END IF;

      SELECT cv.project_id, wr.project_id
        INTO candidate_project, workflow_project
        FROM candidate_version cv
        JOIN workflow_run wr ON wr.workflow_run_id = cv.workflow_run_id
       WHERE cv.candidate_version_id = source_row.candidate_version_id;
      IF NOT FOUND
         OR parent_row.project_id <> candidate_project
         OR candidate_project <> workflow_project THEN
        PERFORM raise_evidence_candidate_complete(
          format('Evidence %s Candidate, Workflow Run, and project ownership do not match', evidence_id)
        );
      END IF;

      CASE source_row.source_object_type
        WHEN 'candidate_version' THEN
          NULL;
        WHEN 'candidate_event' THEN
          SELECT project_id, candidate_version_id
            INTO target_project, target_candidate
            FROM candidate_event
           WHERE candidate_event_id = source_row.source_candidate_event_id;
        WHEN 'candidate_fact_proposal' THEN
          SELECT project_id, candidate_version_id
            INTO target_project, target_candidate
            FROM candidate_fact_proposal
           WHERE candidate_fact_proposal_id = source_row.source_candidate_fact_proposal_id;
        WHEN 'candidate_state_transition' THEN
          SELECT project_id, candidate_version_id
            INTO target_project, target_candidate
            FROM candidate_state_transition
           WHERE candidate_state_transition_id = source_row.source_candidate_state_transition_id;
        WHEN 'narrative_assertion' THEN
          SELECT na.project_id, na.source_domain, nas.candidate_version_id, nas.source_version_id
            INTO target_project, assertion_domain, assertion_candidate, assertion_source_version
            FROM narrative_assertion na
            LEFT JOIN narrative_assertion_candidate_source nas
              ON nas.assertion_id = na.assertion_id
           WHERE na.assertion_id = source_row.source_assertion_id;
          IF NOT FOUND
             OR assertion_domain <> 'candidate'
             OR assertion_candidate IS NULL
             OR assertion_candidate <> source_row.candidate_version_id
             OR assertion_source_version <> source_row.candidate_version_id THEN
            PERFORM raise_evidence_candidate_complete(
              format('Evidence %s Narrative Assertion Candidate source chain does not match', evidence_id)
            );
          END IF;
          target_candidate := assertion_candidate;
        ELSE
          PERFORM raise_evidence_candidate_complete(
            format('Evidence %s uses an unsupported Candidate source type', evidence_id)
          );
      END CASE;

      IF source_row.source_object_type <> 'candidate_version'
         AND (target_project IS NULL
              OR target_candidate IS NULL
              OR target_project <> parent_row.project_id
              OR target_candidate <> source_row.candidate_version_id) THEN
        PERFORM raise_evidence_candidate_complete(
          format('Evidence %s target does not belong to the selected Candidate and project', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_candidate_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_candidate_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_TABLE_NAME = 'evidence_reference' THEN
        PERFORM validate_evidence_candidate(COALESCE(NEW.evidence_reference_id, OLD.evidence_reference_id));
      ELSE
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          PERFORM validate_evidence_candidate(OLD.evidence_reference_id);
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          PERFORM validate_evidence_candidate(NEW.evidence_reference_id);
        END IF;
      END IF;
      RETURN NULL;
    END;
    $function$;

    CREATE CONSTRAINT TRIGGER evidence_reference_complete
      AFTER INSERT OR UPDATE ON evidence_reference
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_candidate_trigger();

    CREATE CONSTRAINT TRIGGER evidence_candidate_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_candidate_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_candidate_trigger();

    CREATE OR REPLACE FUNCTION reject_evidence_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_candidate_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_candidate_immutable',
        MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
    END;
    $function$;

    CREATE TRIGGER evidence_reference_immutable
      BEFORE UPDATE OR DELETE ON evidence_reference
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

    CREATE TRIGGER evidence_candidate_source_immutable
      BEFORE UPDATE OR DELETE ON evidence_candidate_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();

    CREATE OR REPLACE FUNCTION protect_source_ownership()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_candidate_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      old_row jsonb := to_jsonb(OLD);
      new_row jsonb := to_jsonb(NEW);
    BEGIN
      IF TG_TABLE_NAME = 'workflow_run'
         AND old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id' THEN
        PERFORM raise_evidence_candidate_complete('Workflow Run project ownership is immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'candidate_version'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'workflow_run_id' IS DISTINCT FROM new_row->>'workflow_run_id') THEN
        PERFORM raise_evidence_candidate_complete('Candidate Version ownership is immutable in this fixture');
      ELSIF TG_TABLE_NAME IN ('candidate_event', 'candidate_fact_proposal', 'candidate_state_transition')
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'candidate_version_id' IS DISTINCT FROM new_row->>'candidate_version_id') THEN
        PERFORM raise_evidence_candidate_complete('Candidate child ownership is immutable in this fixture');
      ELSIF TG_TABLE_NAME = 'narrative_assertion'
         AND (old_row->>'project_id' IS DISTINCT FROM new_row->>'project_id'
              OR old_row->>'source_domain' IS DISTINCT FROM new_row->>'source_domain') THEN
        PERFORM raise_evidence_candidate_complete('Narrative Assertion ownership is immutable in this fixture');
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE TRIGGER workflow_run_ownership_immutable
      BEFORE UPDATE ON workflow_run
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();
    CREATE TRIGGER candidate_version_ownership_immutable
      BEFORE UPDATE ON candidate_version
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();
    CREATE TRIGGER candidate_event_ownership_immutable
      BEFORE UPDATE ON candidate_event
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();
    CREATE TRIGGER candidate_fact_proposal_ownership_immutable
      BEFORE UPDATE ON candidate_fact_proposal
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();
    CREATE TRIGGER candidate_state_transition_ownership_immutable
      BEFORE UPDATE ON candidate_state_transition
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();
    CREATE TRIGGER narrative_assertion_ownership_immutable
      BEFORE UPDATE ON narrative_assertion
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership();

    CREATE TRIGGER assertion_candidate_source_immutable
      BEFORE UPDATE OR DELETE ON narrative_assertion_candidate_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
  `);
}

export async function down(pgm) {
  pgm.sql('DROP SCHEMA IF EXISTS evidence_candidate_constraint_fixture CASCADE;');
}
