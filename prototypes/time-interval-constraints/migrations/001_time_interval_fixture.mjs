/**
 * 第一批 Time Interval 来源绑定约束验证原型。
 * 这些对象位于独立 fixture schema，不是正式业务 Schema。
 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS time_interval_constraint_fixture;
    SET search_path TO time_interval_constraint_fixture, public;

    CREATE TABLE project (
      project_id text PRIMARY KEY
    );

    CREATE TABLE author_design_revision (
      revision_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id)
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

    CREATE TABLE canon_commit (
      canon_commit_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      status text NOT NULL,
      CONSTRAINT ck_canon_commit_status CHECK (status IN ('preparing', 'committed'))
    );

    CREATE TABLE time_interval (
      time_interval_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      source_domain text NOT NULL,
      source_version_id text NOT NULL,
      interval_key text NOT NULL,
      time_kind text NOT NULL,
      start_value text,
      end_value text,
      CONSTRAINT ck_time_interval_source_domain CHECK (source_domain IN ('author_design', 'candidate', 'canon')),
      CONSTRAINT ck_time_interval_time_kind CHECK (time_kind IN ('absolute', 'relative', 'unknown')),
      CONSTRAINT uq_time_interval_key UNIQUE (project_id, source_domain, source_version_id, interval_key)
    );

    CREATE TABLE temporal_constraint (
      temporal_constraint_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      revision_id text NOT NULL REFERENCES author_design_revision(revision_id),
      interval_id text REFERENCES time_interval(time_interval_id),
      CONSTRAINT uq_temporal_constraint_revision_id UNIQUE (revision_id, temporal_constraint_id)
    );

    CREATE TABLE candidate_event (
      candidate_event_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id),
      story_time_ref text REFERENCES time_interval(time_interval_id)
    );

    CREATE TABLE candidate_fact_proposal (
      candidate_fact_proposal_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id)
    );

    CREATE TABLE candidate_state_transition (
      candidate_state_transition_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      candidate_version_id text NOT NULL REFERENCES candidate_version(candidate_version_id),
      story_time_ref text REFERENCES time_interval(time_interval_id)
    );

    CREATE TABLE canonical_text_version (
      canonical_text_version_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE story_event (
      story_event_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id),
      story_time_interval_id text REFERENCES time_interval(time_interval_id)
    );

    CREATE TABLE canon_fact (
      canon_fact_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id)
    );

    CREATE TABLE state_transition (
      state_transition_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project(project_id),
      canon_commit_id text NOT NULL REFERENCES canon_commit(canon_commit_id),
      story_time_interval_id text REFERENCES time_interval(time_interval_id)
    );

    CREATE TABLE time_interval_source (
      interval_source_id text PRIMARY KEY,
      time_interval_id text NOT NULL REFERENCES time_interval(time_interval_id),
      source_domain text NOT NULL,
      source_version_id text NOT NULL,
      source_type text NOT NULL,
      temporal_constraint_id text REFERENCES temporal_constraint(temporal_constraint_id),
      candidate_event_id text REFERENCES candidate_event(candidate_event_id),
      candidate_fact_proposal_id text REFERENCES candidate_fact_proposal(candidate_fact_proposal_id),
      candidate_state_transition_id text REFERENCES candidate_state_transition(candidate_state_transition_id),
      canonical_text_version_id text REFERENCES canonical_text_version(canonical_text_version_id),
      story_event_id text REFERENCES story_event(story_event_id),
      canon_fact_id text REFERENCES canon_fact(canon_fact_id),
      state_transition_id text REFERENCES state_transition(state_transition_id),
      CONSTRAINT uq_time_interval_source_interval UNIQUE (time_interval_id),
      CONSTRAINT ck_time_interval_source_domain CHECK (source_domain IN ('author_design', 'candidate', 'canon')),
      CONSTRAINT ck_time_interval_source_type CHECK (source_type IN (
        'temporal_constraint', 'candidate_event', 'candidate_fact_proposal',
        'candidate_state_transition', 'canonical_text_version', 'story_event',
        'canon_fact', 'state_transition'
      )),
      CONSTRAINT ck_time_interval_source_target_shape CHECK (
        (source_type = 'temporal_constraint' AND source_domain = 'author_design' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND temporal_constraint_id IS NOT NULL) OR
        (source_type = 'candidate_event' AND source_domain = 'candidate' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND candidate_event_id IS NOT NULL) OR
        (source_type = 'candidate_fact_proposal' AND source_domain = 'candidate' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND candidate_fact_proposal_id IS NOT NULL) OR
        (source_type = 'candidate_state_transition' AND source_domain = 'candidate' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND candidate_state_transition_id IS NOT NULL) OR
        (source_type = 'canonical_text_version' AND source_domain = 'canon' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND canonical_text_version_id IS NOT NULL) OR
        (source_type = 'story_event' AND source_domain = 'canon' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND story_event_id IS NOT NULL) OR
        (source_type = 'canon_fact' AND source_domain = 'canon' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND canon_fact_id IS NOT NULL) OR
        (source_type = 'state_transition' AND source_domain = 'canon' AND num_nonnulls(temporal_constraint_id, candidate_event_id, candidate_fact_proposal_id, candidate_state_transition_id, canonical_text_version_id, story_event_id, canon_fact_id, state_transition_id) = 1 AND state_transition_id IS NOT NULL)
      )
    );

    CREATE OR REPLACE FUNCTION lock_time_interval_container(p_container_type text, p_container_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    BEGIN
      IF p_container_id IS NULL THEN
        RETURN;
      ELSIF p_container_type = 'author_design_revision' THEN
        PERFORM 1 FROM author_design_revision WHERE revision_id = p_container_id FOR NO KEY UPDATE;
      ELSIF p_container_type = 'workflow_run' THEN
        PERFORM 1 FROM workflow_run WHERE workflow_run_id = p_container_id FOR NO KEY UPDATE;
      ELSIF p_container_type = 'candidate_version' THEN
        PERFORM 1
        FROM workflow_run wr
        JOIN candidate_version cv ON cv.workflow_run_id = wr.workflow_run_id
        WHERE cv.candidate_version_id = p_container_id
        FOR NO KEY UPDATE OF wr;
        PERFORM 1 FROM candidate_version WHERE candidate_version_id = p_container_id FOR NO KEY UPDATE;
      ELSIF p_container_type = 'canon_commit' THEN
        PERFORM 1 FROM canon_commit WHERE canon_commit_id = p_container_id FOR NO KEY UPDATE;
      ELSE
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'unknown source container type';
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION reject_container_identity_update()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    BEGIN
      IF TG_TABLE_NAME = 'author_design_revision' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'author design revision project is immutable';
        END IF;
      ELSIF TG_TABLE_NAME = 'workflow_run' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'workflow run project is immutable';
        END IF;
      ELSIF TG_TABLE_NAME = 'candidate_version' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.workflow_run_id IS DISTINCT FROM OLD.workflow_run_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'candidate version container identity is immutable';
        END IF;
      ELSIF TG_TABLE_NAME = 'canon_commit' THEN
        IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'canon commit project is immutable';
        END IF;
        IF OLD.status = 'committed' AND NEW.status IS DISTINCT FROM OLD.status THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'committed canon commit status is immutable';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE OR REPLACE FUNCTION lock_time_interval_source_dependencies(p_source_type text, p_source_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    DECLARE
      v_container_id text;
      v_workflow_run_id text;
    BEGIN
      IF p_source_id IS NULL THEN
        RETURN;
      ELSIF p_source_type = 'temporal_constraint' THEN
        SELECT revision_id INTO v_container_id
        FROM temporal_constraint WHERE temporal_constraint_id = p_source_id;
        PERFORM lock_time_interval_container('author_design_revision', v_container_id);
        PERFORM 1 FROM temporal_constraint WHERE temporal_constraint_id = p_source_id FOR UPDATE;
      ELSIF p_source_type IN ('candidate_event', 'candidate_fact_proposal', 'candidate_state_transition') THEN
        IF p_source_type = 'candidate_event' THEN
          SELECT candidate_version_id INTO v_container_id
          FROM candidate_event WHERE candidate_event_id = p_source_id;
        ELSIF p_source_type = 'candidate_fact_proposal' THEN
          SELECT candidate_version_id INTO v_container_id
          FROM candidate_fact_proposal WHERE candidate_fact_proposal_id = p_source_id;
        ELSE
          SELECT candidate_version_id INTO v_container_id
          FROM candidate_state_transition WHERE candidate_state_transition_id = p_source_id;
        END IF;
        SELECT workflow_run_id INTO v_workflow_run_id
        FROM candidate_version WHERE candidate_version_id = v_container_id;
        PERFORM lock_time_interval_container('workflow_run', v_workflow_run_id);
        PERFORM lock_time_interval_container('candidate_version', v_container_id);
        IF p_source_type = 'candidate_event' THEN
          PERFORM 1 FROM candidate_event WHERE candidate_event_id = p_source_id FOR UPDATE;
        ELSIF p_source_type = 'candidate_fact_proposal' THEN
          PERFORM 1 FROM candidate_fact_proposal WHERE candidate_fact_proposal_id = p_source_id FOR UPDATE;
        ELSE
          PERFORM 1 FROM candidate_state_transition WHERE candidate_state_transition_id = p_source_id FOR UPDATE;
        END IF;
      ELSIF p_source_type IN ('canonical_text_version', 'story_event', 'canon_fact', 'state_transition') THEN
        IF p_source_type = 'canonical_text_version' THEN
          SELECT canon_commit_id INTO v_container_id
          FROM canonical_text_version WHERE canonical_text_version_id = p_source_id;
        ELSIF p_source_type = 'story_event' THEN
          SELECT canon_commit_id INTO v_container_id
          FROM story_event WHERE story_event_id = p_source_id;
        ELSIF p_source_type = 'canon_fact' THEN
          SELECT canon_commit_id INTO v_container_id
          FROM canon_fact WHERE canon_fact_id = p_source_id;
        ELSE
          SELECT canon_commit_id INTO v_container_id
          FROM state_transition WHERE state_transition_id = p_source_id;
        END IF;
        PERFORM lock_time_interval_container('canon_commit', v_container_id);
        IF p_source_type = 'canonical_text_version' THEN
          PERFORM 1 FROM canonical_text_version WHERE canonical_text_version_id = p_source_id FOR UPDATE;
        ELSIF p_source_type = 'story_event' THEN
          PERFORM 1 FROM story_event WHERE story_event_id = p_source_id FOR UPDATE;
        ELSIF p_source_type = 'canon_fact' THEN
          PERFORM 1 FROM canon_fact WHERE canon_fact_id = p_source_id FOR UPDATE;
        ELSE
          PERFORM 1 FROM state_transition WHERE state_transition_id = p_source_id FOR UPDATE;
        END IF;
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_time_interval_source(p_interval_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    DECLARE
      v_interval time_interval%ROWTYPE;
      v_source time_interval_source%ROWTYPE;
      v_count integer;
      v_project_id text;
      v_source_version_id text;
      v_interval_ref text;
      v_container_id text;
      v_interval_id text;
    BEGIN
      SELECT * INTO v_interval FROM time_interval WHERE time_interval_id = p_interval_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT count(*) INTO v_count FROM time_interval_source WHERE time_interval_id = p_interval_id;
      IF v_count <> 1 THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'time_interval_source_complete',
          MESSAGE = format('time_interval %s must have exactly one source binding; found %s', p_interval_id, v_count);
      END IF;

      SELECT * INTO v_source FROM time_interval_source WHERE time_interval_id = p_interval_id;
      PERFORM lock_time_interval_source_dependencies(
        v_source.source_type,
        COALESCE(
          v_source.temporal_constraint_id,
          v_source.candidate_event_id,
          v_source.candidate_fact_proposal_id,
          v_source.candidate_state_transition_id,
          v_source.canonical_text_version_id,
          v_source.story_event_id,
          v_source.canon_fact_id,
          v_source.state_transition_id
        )
      );
      SELECT * INTO v_interval FROM time_interval WHERE time_interval_id = p_interval_id FOR UPDATE;
      IF v_source.source_domain <> v_interval.source_domain THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source domain does not match interval';
      END IF;
      IF v_source.source_version_id <> v_interval.source_version_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source version does not match interval';
      END IF;

      v_project_id := NULL;
      v_source_version_id := NULL;
      v_interval_ref := NULL;
      v_container_id := NULL;
      IF v_source.source_type = 'temporal_constraint' THEN
        SELECT project_id, temporal_constraint_id, interval_id, revision_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM temporal_constraint WHERE temporal_constraint_id = v_source.temporal_constraint_id;
      ELSIF v_source.source_type = 'candidate_event' THEN
        SELECT project_id, candidate_event_id, story_time_ref, candidate_version_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM candidate_event WHERE candidate_event_id = v_source.candidate_event_id;
      ELSIF v_source.source_type = 'candidate_fact_proposal' THEN
        SELECT project_id, candidate_fact_proposal_id, NULL::text, candidate_version_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM candidate_fact_proposal WHERE candidate_fact_proposal_id = v_source.candidate_fact_proposal_id;
      ELSIF v_source.source_type = 'candidate_state_transition' THEN
        SELECT project_id, candidate_state_transition_id, story_time_ref, candidate_version_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM candidate_state_transition WHERE candidate_state_transition_id = v_source.candidate_state_transition_id;
      ELSIF v_source.source_type = 'canonical_text_version' THEN
        SELECT project_id, canonical_text_version_id, NULL::text, canon_commit_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM canonical_text_version WHERE canonical_text_version_id = v_source.canonical_text_version_id;
      ELSIF v_source.source_type = 'story_event' THEN
        SELECT project_id, story_event_id, story_time_interval_id, canon_commit_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM story_event WHERE story_event_id = v_source.story_event_id;
      ELSIF v_source.source_type = 'canon_fact' THEN
        SELECT project_id, canon_fact_id, NULL::text, canon_commit_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM canon_fact WHERE canon_fact_id = v_source.canon_fact_id;
      ELSIF v_source.source_type = 'state_transition' THEN
        SELECT project_id, state_transition_id, story_time_interval_id, canon_commit_id
          INTO v_project_id, v_source_version_id, v_interval_ref, v_container_id
        FROM state_transition WHERE state_transition_id = v_source.state_transition_id;
      END IF;

      IF v_source_version_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source object does not exist';
      END IF;
      IF v_source_version_id <> v_source.source_version_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source_version_id does not equal source object id';
      END IF;
      IF v_project_id <> v_interval.project_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source project does not match interval project';
      END IF;
      IF v_interval_ref IS NOT NULL AND v_interval_ref <> p_interval_id THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'source object interval reference does not match binding';
      END IF;

      IF v_source.source_type = 'temporal_constraint' AND v_interval.source_domain <> 'author_design' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'temporal constraint requires author_design';
      ELSIF v_source.source_type IN ('candidate_event', 'candidate_fact_proposal', 'candidate_state_transition') AND v_interval.source_domain <> 'candidate' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'candidate source requires candidate domain';
      ELSIF v_source.source_type IN ('canonical_text_version', 'story_event', 'canon_fact', 'state_transition') AND v_interval.source_domain <> 'canon' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'canon source requires canon domain';
      END IF;

      IF v_source.source_type = 'temporal_constraint' THEN
        IF NOT EXISTS (
          SELECT 1 FROM author_design_revision r
          WHERE r.revision_id = v_container_id
            AND r.project_id = v_project_id
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'author design revision project does not match source';
        END IF;
      ELSIF v_source.source_type IN ('candidate_event', 'candidate_fact_proposal', 'candidate_state_transition') THEN
        IF NOT EXISTS (
          SELECT 1
          FROM candidate_version cv
          JOIN workflow_run wr ON wr.workflow_run_id = cv.workflow_run_id
          WHERE cv.candidate_version_id = v_container_id
            AND cv.project_id = v_project_id
            AND wr.project_id = cv.project_id
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'candidate container project chain does not match source';
        END IF;
      ELSIF v_source.source_type IN ('canonical_text_version', 'story_event', 'canon_fact', 'state_transition') THEN
        IF NOT EXISTS (
          SELECT 1 FROM canon_commit cc
          WHERE cc.canon_commit_id = v_container_id
            AND cc.project_id = v_project_id
            AND cc.status = 'committed'
        ) THEN
          RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'canon commit project or status is invalid';
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1 FROM temporal_constraint tc
        WHERE tc.interval_id = p_interval_id
          AND (v_source.source_type <> 'temporal_constraint' OR tc.temporal_constraint_id <> v_source.temporal_constraint_id)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'temporal constraint interval reference does not match binding';
      END IF;
      IF EXISTS (
        SELECT 1 FROM candidate_event ce
        WHERE ce.story_time_ref = p_interval_id
          AND (v_source.source_type <> 'candidate_event' OR ce.candidate_event_id <> v_source.candidate_event_id)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'candidate event interval reference does not match binding';
      END IF;
      IF EXISTS (
        SELECT 1 FROM candidate_state_transition cst
        WHERE cst.story_time_ref = p_interval_id
          AND (v_source.source_type <> 'candidate_state_transition' OR cst.candidate_state_transition_id <> v_source.candidate_state_transition_id)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'candidate state transition interval reference does not match binding';
      END IF;
      IF EXISTS (
        SELECT 1 FROM story_event se
        WHERE se.story_time_interval_id = p_interval_id
          AND (v_source.source_type <> 'story_event' OR se.story_event_id <> v_source.story_event_id)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'story event interval reference does not match binding';
      END IF;
      IF EXISTS (
        SELECT 1 FROM state_transition st
        WHERE st.story_time_interval_id = p_interval_id
          AND (v_source.source_type <> 'state_transition' OR st.state_transition_id <> v_source.state_transition_id)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'time_interval_source_complete', MESSAGE = 'state transition interval reference does not match binding';
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_time_interval_ids(p_first text, p_second text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    DECLARE
      v_interval_id text;
    BEGIN
      FOR v_interval_id IN
        SELECT DISTINCT interval_id
        FROM (VALUES (p_first), (p_second)) AS candidates(interval_id)
        WHERE interval_id IS NOT NULL
      LOOP
        PERFORM validate_time_interval_source(v_interval_id);
      END LOOP;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_time_interval_bindings_for_source(p_source_type text, p_source_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    DECLARE
      v_interval_id text;
    BEGIN
      PERFORM lock_time_interval_source_dependencies(p_source_type, p_source_id);
      FOR v_interval_id IN
        SELECT time_interval_id
        FROM time_interval_source
        WHERE (p_source_type = 'temporal_constraint' AND temporal_constraint_id = p_source_id)
           OR (p_source_type = 'candidate_event' AND candidate_event_id = p_source_id)
           OR (p_source_type = 'candidate_fact_proposal' AND candidate_fact_proposal_id = p_source_id)
           OR (p_source_type = 'candidate_state_transition' AND candidate_state_transition_id = p_source_id)
           OR (p_source_type = 'canonical_text_version' AND canonical_text_version_id = p_source_id)
           OR (p_source_type = 'story_event' AND story_event_id = p_source_id)
           OR (p_source_type = 'canon_fact' AND canon_fact_id = p_source_id)
           OR (p_source_type = 'state_transition' AND state_transition_id = p_source_id)
        ORDER BY time_interval_id
      LOOP
        PERFORM validate_time_interval_source(v_interval_id);
      END LOOP;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_time_interval_bindings_for_container(p_container_type text, p_container_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    DECLARE
      v_interval_id text;
    BEGIN
      PERFORM lock_time_interval_container(p_container_type, p_container_id);
      IF p_container_type = 'author_design_revision' THEN
        FOR v_interval_id IN
          SELECT tis.time_interval_id
          FROM time_interval_source tis
          JOIN temporal_constraint tc ON tc.temporal_constraint_id = tis.temporal_constraint_id
          WHERE tis.source_type = 'temporal_constraint' AND tc.revision_id = p_container_id
        LOOP
          PERFORM validate_time_interval_source(v_interval_id);
        END LOOP;
      ELSIF p_container_type = 'workflow_run' THEN
        FOR v_interval_id IN
          SELECT DISTINCT affected.time_interval_id
          FROM (
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_event ce ON ce.candidate_event_id = tis.candidate_event_id
            JOIN candidate_version cv ON cv.candidate_version_id = ce.candidate_version_id
            WHERE tis.source_type = 'candidate_event' AND cv.workflow_run_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_fact_proposal cfp ON cfp.candidate_fact_proposal_id = tis.candidate_fact_proposal_id
            JOIN candidate_version cv ON cv.candidate_version_id = cfp.candidate_version_id
            WHERE tis.source_type = 'candidate_fact_proposal' AND cv.workflow_run_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_state_transition cst ON cst.candidate_state_transition_id = tis.candidate_state_transition_id
            JOIN candidate_version cv ON cv.candidate_version_id = cst.candidate_version_id
            WHERE tis.source_type = 'candidate_state_transition' AND cv.workflow_run_id = p_container_id
          ) affected
          ORDER BY affected.time_interval_id
        LOOP
          PERFORM validate_time_interval_source(v_interval_id);
        END LOOP;
      ELSIF p_container_type = 'candidate_version' THEN
        FOR v_interval_id IN
          SELECT DISTINCT affected.time_interval_id
          FROM (
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_event ce ON ce.candidate_event_id = tis.candidate_event_id
            WHERE tis.source_type = 'candidate_event' AND ce.candidate_version_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_fact_proposal cfp ON cfp.candidate_fact_proposal_id = tis.candidate_fact_proposal_id
            WHERE tis.source_type = 'candidate_fact_proposal' AND cfp.candidate_version_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN candidate_state_transition cst ON cst.candidate_state_transition_id = tis.candidate_state_transition_id
            WHERE tis.source_type = 'candidate_state_transition' AND cst.candidate_version_id = p_container_id
          ) affected
          ORDER BY affected.time_interval_id
        LOOP
          PERFORM validate_time_interval_source(v_interval_id);
        END LOOP;
      ELSIF p_container_type = 'canon_commit' THEN
        FOR v_interval_id IN
          SELECT DISTINCT affected.time_interval_id
          FROM (
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN canonical_text_version ctv ON ctv.canonical_text_version_id = tis.canonical_text_version_id
            WHERE tis.source_type = 'canonical_text_version' AND ctv.canon_commit_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN story_event se ON se.story_event_id = tis.story_event_id
            WHERE tis.source_type = 'story_event' AND se.canon_commit_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN canon_fact cf ON cf.canon_fact_id = tis.canon_fact_id
            WHERE tis.source_type = 'canon_fact' AND cf.canon_commit_id = p_container_id
            UNION ALL
            SELECT tis.time_interval_id
            FROM time_interval_source tis
            JOIN state_transition st ON st.state_transition_id = tis.state_transition_id
            WHERE tis.source_type = 'state_transition' AND st.canon_commit_id = p_container_id
          ) affected
          ORDER BY affected.time_interval_id
        LOOP
          PERFORM validate_time_interval_source(v_interval_id);
        END LOOP;
      END IF;
    END;
    $$;

    CREATE OR REPLACE FUNCTION validate_time_interval_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = time_interval_constraint_fixture, public
    AS $$
    BEGIN
      IF TG_TABLE_NAME = 'time_interval' THEN
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'DELETE' THEN OLD.time_interval_id ELSE NEW.time_interval_id END,
          NULL
        );
      ELSIF TG_TABLE_NAME = 'time_interval_source' THEN
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.time_interval_id END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.time_interval_id END
        );
      ELSIF TG_TABLE_NAME = 'temporal_constraint' THEN
        PERFORM lock_time_interval_source_dependencies('temporal_constraint', CASE WHEN TG_OP = 'DELETE' THEN OLD.temporal_constraint_id ELSE NEW.temporal_constraint_id END);
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.interval_id END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.interval_id END
        );
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('temporal_constraint', OLD.temporal_constraint_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('temporal_constraint', NEW.temporal_constraint_id); END IF;
      ELSIF TG_TABLE_NAME = 'candidate_event' THEN
        PERFORM lock_time_interval_source_dependencies('candidate_event', CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_event_id ELSE NEW.candidate_event_id END);
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.story_time_ref END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.story_time_ref END
        );
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('candidate_event', OLD.candidate_event_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('candidate_event', NEW.candidate_event_id); END IF;
      ELSIF TG_TABLE_NAME = 'candidate_fact_proposal' THEN
        PERFORM lock_time_interval_source_dependencies('candidate_fact_proposal', CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_fact_proposal_id ELSE NEW.candidate_fact_proposal_id END);
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('candidate_fact_proposal', OLD.candidate_fact_proposal_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('candidate_fact_proposal', NEW.candidate_fact_proposal_id); END IF;
      ELSIF TG_TABLE_NAME = 'candidate_state_transition' THEN
        PERFORM lock_time_interval_source_dependencies('candidate_state_transition', CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_state_transition_id ELSE NEW.candidate_state_transition_id END);
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.story_time_ref END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.story_time_ref END
        );
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('candidate_state_transition', OLD.candidate_state_transition_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('candidate_state_transition', NEW.candidate_state_transition_id); END IF;
      ELSIF TG_TABLE_NAME = 'canonical_text_version' THEN
        PERFORM lock_time_interval_source_dependencies('canonical_text_version', CASE WHEN TG_OP = 'DELETE' THEN OLD.canonical_text_version_id ELSE NEW.canonical_text_version_id END);
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('canonical_text_version', OLD.canonical_text_version_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('canonical_text_version', NEW.canonical_text_version_id); END IF;
      ELSIF TG_TABLE_NAME = 'story_event' THEN
        PERFORM lock_time_interval_source_dependencies('story_event', CASE WHEN TG_OP = 'DELETE' THEN OLD.story_event_id ELSE NEW.story_event_id END);
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.story_time_interval_id END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.story_time_interval_id END
        );
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('story_event', OLD.story_event_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('story_event', NEW.story_event_id); END IF;
      ELSIF TG_TABLE_NAME = 'canon_fact' THEN
        PERFORM lock_time_interval_source_dependencies('canon_fact', CASE WHEN TG_OP = 'DELETE' THEN OLD.canon_fact_id ELSE NEW.canon_fact_id END);
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('canon_fact', OLD.canon_fact_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('canon_fact', NEW.canon_fact_id); END IF;
      ELSIF TG_TABLE_NAME = 'state_transition' THEN
        PERFORM lock_time_interval_source_dependencies('state_transition', CASE WHEN TG_OP = 'DELETE' THEN OLD.state_transition_id ELSE NEW.state_transition_id END);
        PERFORM validate_time_interval_ids(
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.story_time_interval_id END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.story_time_interval_id END
        );
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_source('state_transition', OLD.state_transition_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_source('state_transition', NEW.state_transition_id); END IF;
      ELSIF TG_TABLE_NAME = 'author_design_revision' THEN
        IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NULL; END IF;
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_container('author_design_revision', OLD.revision_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_container('author_design_revision', NEW.revision_id); END IF;
      ELSIF TG_TABLE_NAME = 'workflow_run' THEN
        IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id THEN RETURN NULL; END IF;
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_container('workflow_run', OLD.workflow_run_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_container('workflow_run', NEW.workflow_run_id); END IF;
      ELSIF TG_TABLE_NAME = 'candidate_version' THEN
        IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND NEW.workflow_run_id IS NOT DISTINCT FROM OLD.workflow_run_id THEN RETURN NULL; END IF;
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_container('candidate_version', OLD.candidate_version_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_container('candidate_version', NEW.candidate_version_id); END IF;
      ELSIF TG_TABLE_NAME = 'canon_commit' THEN
        IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
        IF TG_OP <> 'INSERT' THEN PERFORM validate_time_interval_bindings_for_container('canon_commit', OLD.canon_commit_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM validate_time_interval_bindings_for_container('canon_commit', NEW.canon_commit_id); END IF;
      END IF;
      RETURN NULL;
    END;
    $$;

    CREATE TRIGGER author_design_revision_identity_immutable
      BEFORE UPDATE ON author_design_revision
      FOR EACH ROW EXECUTE FUNCTION reject_container_identity_update();

    CREATE TRIGGER workflow_run_identity_immutable
      BEFORE UPDATE ON workflow_run
      FOR EACH ROW EXECUTE FUNCTION reject_container_identity_update();

    CREATE TRIGGER candidate_version_identity_immutable
      BEFORE UPDATE ON candidate_version
      FOR EACH ROW EXECUTE FUNCTION reject_container_identity_update();

    CREATE TRIGGER canon_commit_identity_immutable
      BEFORE UPDATE ON canon_commit
      FOR EACH ROW EXECUTE FUNCTION reject_container_identity_update();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_interval
      AFTER INSERT OR UPDATE ON time_interval
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_binding
      AFTER INSERT OR UPDATE OR DELETE ON time_interval_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_temporal_constraint
      AFTER INSERT OR UPDATE OR DELETE ON temporal_constraint
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_candidate_event
      AFTER INSERT OR UPDATE OR DELETE ON candidate_event
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_candidate_fact
      AFTER INSERT OR UPDATE OR DELETE ON candidate_fact_proposal
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_candidate_state
      AFTER INSERT OR UPDATE OR DELETE ON candidate_state_transition
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_canonical_text
      AFTER INSERT OR UPDATE OR DELETE ON canonical_text_version
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_story_event
      AFTER INSERT OR UPDATE OR DELETE ON story_event
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_canon_fact
      AFTER INSERT OR UPDATE OR DELETE ON canon_fact
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_state_transition
      AFTER INSERT OR UPDATE OR DELETE ON state_transition
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();


    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_author_design_revision
      AFTER INSERT OR UPDATE OR DELETE ON author_design_revision
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_workflow_run
      AFTER INSERT OR UPDATE OR DELETE ON workflow_run
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_candidate_version
      AFTER INSERT OR UPDATE OR DELETE ON candidate_version
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();

    CREATE CONSTRAINT TRIGGER time_interval_source_complete_on_canon_commit
      AFTER INSERT OR UPDATE OR DELETE ON canon_commit
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_time_interval_trigger();
  `);
}

export async function down(pgm) {
  pgm.sql('DROP SCHEMA IF EXISTS time_interval_constraint_fixture CASCADE;');
}
