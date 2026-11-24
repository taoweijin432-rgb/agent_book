/** 四域 Evidence 联合约束夹具。来源表及逐类型校验复用四个既有原型；非生产迁移。 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS evidence_unified_constraint_fixture;
    SET search_path TO evidence_unified_constraint_fixture, pg_catalog;

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
      workflow_run_id text REFERENCES workflow_run(workflow_run_id)
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
      CONSTRAINT ck_evidence_reference_domain_type CHECK (
(source_domain = 'author_design' AND source_object_type IN ('author_design_revision', 'design_object_version', 'design_constraint', 'outline_node', 'world_rule', 'temporal_constraint', 'foreshadowing_plan', 'ending_constraint'))
        OR (source_domain = 'candidate' AND source_object_type IN ('candidate_version', 'candidate_event', 'candidate_fact_proposal', 'candidate_state_transition', 'narrative_assertion'))
        OR (source_domain = 'canon' AND source_object_type IN ('canonical_text_version', 'canon_commit', 'story_event', 'canon_fact', 'state_transition', 'temporal_relation'))
        OR (source_domain = 'tool' AND source_object_type IN ('tool_call'))
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

    CREATE OR REPLACE FUNCTION raise_evidence_source_complete(message text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'evidence_source_complete',
        MESSAGE = message;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_design(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_design_source%ROWTYPE;
      revision_project text;
      target_project text;
      target_revision text;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_design_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'author_design'
         OR parent_row.source_version_id <> source_row.author_design_revision_id
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s parent identity does not match its Author Design source row', evidence_id)
        );
      END IF;

      SELECT project_id INTO revision_project
        FROM author_design_revision
       WHERE revision_id = source_row.author_design_revision_id;
      IF NOT FOUND OR revision_project <> parent_row.project_id THEN
        PERFORM raise_evidence_source_complete(
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
          PERFORM raise_evidence_source_complete(
            format('Evidence %s uses an unsupported Author Design source type', evidence_id)
          );
      END CASE;

      IF target_project IS NULL
         OR target_revision IS NULL
         OR target_project <> parent_row.project_id
         OR target_revision <> source_row.author_design_revision_id THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s target does not belong to the selected revision and project', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_candidate(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
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
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_candidate_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'candidate'
         OR parent_row.source_version_id <> source_row.candidate_version_id
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_source_complete(
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
        PERFORM raise_evidence_source_complete(
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
            PERFORM raise_evidence_source_complete(
              format('Evidence %s Narrative Assertion Candidate source chain does not match', evidence_id)
            );
          END IF;
          target_candidate := assertion_candidate;
        ELSE
          PERFORM raise_evidence_source_complete(
            format('Evidence %s uses an unsupported Candidate source type', evidence_id)
          );
      END CASE;

      IF source_row.source_object_type <> 'candidate_version'
         AND (target_project IS NULL
              OR target_candidate IS NULL
              OR target_project <> parent_row.project_id
              OR target_candidate <> source_row.candidate_version_id) THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s target does not belong to the selected Candidate and project', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_canon(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_row evidence_reference%ROWTYPE;
      source_row evidence_canon_source%ROWTYPE;
      commit_project text;
      commit_status text;
      target_project text;
      target_commit text;
      expected_source_version text;
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;
      IF NOT FOUND THEN
        RETURN;
      END IF;

      SELECT * INTO STRICT source_row
        FROM evidence_canon_source
       WHERE evidence_reference_id = evidence_id;

      IF parent_row.source_domain <> 'canon'
         OR parent_row.source_object_type <> source_row.source_object_type
         OR parent_row.source_object_id <> source_row.source_object_id THEN
        PERFORM raise_evidence_source_complete(
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
        PERFORM raise_evidence_source_complete(
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
          PERFORM raise_evidence_source_complete(
            format('Evidence %s uses an unsupported Canon source type', evidence_id)
          );
      END CASE;

      IF parent_row.source_version_id <> expected_source_version
         OR target_project IS NULL
         OR target_commit IS NULL
         OR target_project <> parent_row.project_id
         OR target_commit <> source_row.canon_commit_id THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s target, version, project, or creating Commit does not match', evidence_id)
        );
      END IF;
    END;
    $function$;

    CREATE OR REPLACE FUNCTION validate_evidence_tool(evidence_id text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
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
    BEGIN
      SELECT * INTO parent_row
        FROM evidence_reference
       WHERE evidence_reference_id = evidence_id;

      IF NOT FOUND THEN
        RETURN;
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
        PERFORM raise_evidence_source_complete(
          format('Evidence %s Tool Call execution chain is incomplete', evidence_id)
        );
      END IF;

      IF parent_row.source_domain <> 'tool'
         OR parent_row.source_object_type <> 'tool_call'
         OR parent_row.source_object_id <> source_row.tool_call_id
         OR parent_row.source_version_id <> tool_generation THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s parent identity does not match its Tool Call source', evidence_id)
        );
      END IF;

      IF parent_row.project_id <> tool_project
         OR tool_project <> generation_project
         OR generation_project <> workflow_project
         OR generation_project <> bundle_project
         OR generation_project <> workflow_task_project
         OR generation_project <> bundle_task_project THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s execution project ownership does not match', evidence_id)
        );
      END IF;

      IF bundle_workflow IS NOT NULL AND generation_workflow <> bundle_workflow THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s Generation Run and Context Bundle use different Workflow Runs', evidence_id)
        );
      END IF;

      IF workflow_task_version <> bundle_task_version THEN
        PERFORM raise_evidence_source_complete(
          format('Evidence %s Workflow Run and Context Bundle use different Scene Task Versions', evidence_id)
        );
      END IF;
    END;
    $function$;

    -- Count every support table before inspecting the selected domain's identity.
    -- Existing valid parents already have one immutable support; concurrent additions
    -- therefore each see at least two rows, without an exclusive container lock.
    CREATE FUNCTION validate_evidence_source(evidence_id text) RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      parent_domain text;
      support_count integer;
      support_domain text;
    BEGIN
      SELECT source_domain INTO parent_domain FROM evidence_reference
        WHERE evidence_reference_id = evidence_id;
      IF NOT FOUND THEN RETURN; END IF;
      SELECT count(*), min(domain) INTO support_count, support_domain FROM (
        SELECT 'author_design' AS domain FROM evidence_design_source WHERE evidence_reference_id = evidence_id
        UNION ALL SELECT 'candidate' FROM evidence_candidate_source WHERE evidence_reference_id = evidence_id
        UNION ALL SELECT 'canon' FROM evidence_canon_source WHERE evidence_reference_id = evidence_id
        UNION ALL SELECT 'tool' FROM evidence_tool_source WHERE evidence_reference_id = evidence_id
      ) AS supports;
      IF support_count <> 1 THEN
        PERFORM raise_evidence_source_complete(format('Evidence %s support_count=%s; expected 1', evidence_id, support_count));
      END IF;
      IF support_domain <> parent_domain THEN
        PERFORM raise_evidence_source_complete(format('Evidence %s support_domain=%s; parent_domain=%s', evidence_id, support_domain, parent_domain));
      END IF;
      CASE parent_domain
        WHEN 'author_design' THEN PERFORM validate_evidence_design(evidence_id);
        WHEN 'candidate' THEN PERFORM validate_evidence_candidate(evidence_id);
        WHEN 'canon' THEN PERFORM validate_evidence_canon(evidence_id);
        WHEN 'tool' THEN PERFORM validate_evidence_tool(evidence_id);
      END CASE;
    END;
    $function$;

    CREATE FUNCTION validate_evidence_source_trigger() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_OP IN ('UPDATE', 'DELETE') THEN
        PERFORM validate_evidence_source(OLD.evidence_reference_id);
      END IF;
      IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM validate_evidence_source(NEW.evidence_reference_id);
      END IF;
      RETURN NULL;
    END;
    $function$;

    CREATE FUNCTION reject_evidence_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
      END IF;
      RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'evidence_source_immutable',
        MESSAGE = format('%s rows are append-only', TG_TABLE_NAME);
    END;
    $function$;

    -- One field list per source table protects identity and ownership, not content.
    CREATE FUNCTION protect_source_ownership() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, evidence_unified_constraint_fixture, pg_temp
    AS $function$
    DECLARE
      field text;
      old_row jsonb := to_jsonb(OLD);
      new_row jsonb := to_jsonb(NEW);
    BEGIN
      FOREACH field IN ARRAY TG_ARGV LOOP
        IF old_row->field IS DISTINCT FROM new_row->field THEN
          PERFORM raise_evidence_source_complete(format('%s.%s source identity/ownership is immutable', TG_TABLE_NAME, field));
        END IF;
      END LOOP;
      IF TG_TABLE_NAME = 'canon_commit' AND old_row->>'status' IN ('committed', 'failed')
         AND old_row->'status' IS DISTINCT FROM new_row->'status' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'evidence_canon_commit_terminal',
          MESSAGE = 'Committed and failed states are terminal';
      END IF;
      IF TG_TABLE_NAME = 'tool_call' AND old_row->>'response_ref' IS NOT NULL
         AND old_row->'response_ref' IS DISTINCT FROM new_row->'response_ref' THEN
        PERFORM raise_evidence_source_complete('Tool Call existing result cannot be overwritten');
      END IF;
      RETURN NEW;
    END;
    $function$;

    CREATE CONSTRAINT TRIGGER evidence_reference_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_reference
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_source_trigger();
    CREATE TRIGGER evidence_reference_immutable BEFORE UPDATE OR DELETE ON evidence_reference
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
    CREATE TRIGGER evidence_reference_no_truncate BEFORE TRUNCATE ON evidence_reference
      FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();

    CREATE CONSTRAINT TRIGGER evidence_design_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_design_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_source_trigger();
    CREATE TRIGGER evidence_design_source_immutable BEFORE UPDATE OR DELETE ON evidence_design_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
    CREATE TRIGGER evidence_design_source_no_truncate BEFORE TRUNCATE ON evidence_design_source
      FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();

    CREATE CONSTRAINT TRIGGER evidence_candidate_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_candidate_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_source_trigger();
    CREATE TRIGGER evidence_candidate_source_immutable BEFORE UPDATE OR DELETE ON evidence_candidate_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
    CREATE TRIGGER evidence_candidate_source_no_truncate BEFORE TRUNCATE ON evidence_candidate_source
      FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();

    CREATE CONSTRAINT TRIGGER evidence_canon_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_canon_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_source_trigger();
    CREATE TRIGGER evidence_canon_source_immutable BEFORE UPDATE OR DELETE ON evidence_canon_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
    CREATE TRIGGER evidence_canon_source_no_truncate BEFORE TRUNCATE ON evidence_canon_source
      FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();

    CREATE CONSTRAINT TRIGGER evidence_tool_source_complete
      AFTER INSERT OR UPDATE OR DELETE ON evidence_tool_source
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_evidence_source_trigger();
    CREATE TRIGGER evidence_tool_source_immutable BEFORE UPDATE OR DELETE ON evidence_tool_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
    CREATE TRIGGER evidence_tool_source_no_truncate BEFORE TRUNCATE ON evidence_tool_source
      FOR EACH STATEMENT EXECUTE FUNCTION reject_evidence_mutation();

    CREATE TRIGGER scene_task_version_ownership_immutable BEFORE UPDATE ON scene_task_version
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('scene_task_version_id', 'project_id');

    CREATE TRIGGER workflow_run_ownership_immutable BEFORE UPDATE ON workflow_run
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('workflow_run_id', 'project_id', 'scene_task_version_id');

    CREATE TRIGGER context_bundle_ownership_immutable BEFORE UPDATE ON context_bundle
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('context_bundle_id', 'project_id', 'scene_task_version_id', 'workflow_run_id');

    CREATE TRIGGER generation_run_ownership_immutable BEFORE UPDATE ON generation_run
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('generation_run_id', 'project_id', 'workflow_run_id', 'context_bundle_id');

    CREATE TRIGGER tool_call_ownership_immutable BEFORE UPDATE ON tool_call
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('tool_call_id', 'project_id', 'generation_run_id', 'tool_name', 'request_ref');

    CREATE TRIGGER author_design_revision_ownership_immutable BEFORE UPDATE ON author_design_revision
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('revision_id', 'project_id');

    CREATE TRIGGER candidate_version_ownership_immutable BEFORE UPDATE ON candidate_version
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('candidate_version_id', 'project_id', 'workflow_run_id');

    CREATE TRIGGER narrative_assertion_ownership_immutable BEFORE UPDATE ON narrative_assertion
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('assertion_id', 'project_id', 'source_domain');

    CREATE TRIGGER canon_commit_ownership_immutable BEFORE UPDATE ON canon_commit
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('canon_commit_id', 'project_id');

    CREATE TRIGGER design_object_version_ownership_immutable BEFORE UPDATE ON design_object_version
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('design_object_version_id', 'project_id', 'revision_id');

    CREATE TRIGGER design_constraint_ownership_immutable BEFORE UPDATE ON design_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('design_constraint_id', 'project_id', 'revision_id');

    CREATE TRIGGER outline_node_ownership_immutable BEFORE UPDATE ON outline_node
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('outline_node_id', 'project_id', 'revision_id');

    CREATE TRIGGER world_rule_ownership_immutable BEFORE UPDATE ON world_rule
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('world_rule_id', 'project_id', 'revision_id');

    CREATE TRIGGER temporal_constraint_ownership_immutable BEFORE UPDATE ON temporal_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('temporal_constraint_id', 'project_id', 'revision_id');

    CREATE TRIGGER foreshadowing_plan_ownership_immutable BEFORE UPDATE ON foreshadowing_plan
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('foreshadowing_plan_id', 'project_id', 'revision_id');

    CREATE TRIGGER ending_constraint_ownership_immutable BEFORE UPDATE ON ending_constraint
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('ending_constraint_id', 'project_id', 'revision_id');

    CREATE TRIGGER candidate_event_ownership_immutable BEFORE UPDATE ON candidate_event
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('candidate_event_id', 'project_id', 'candidate_version_id');

    CREATE TRIGGER candidate_fact_proposal_ownership_immutable BEFORE UPDATE ON candidate_fact_proposal
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('candidate_fact_proposal_id', 'project_id', 'candidate_version_id');

    CREATE TRIGGER candidate_state_transition_ownership_immutable BEFORE UPDATE ON candidate_state_transition
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('candidate_state_transition_id', 'project_id', 'candidate_version_id');

    CREATE TRIGGER canonical_text_version_ownership_immutable BEFORE UPDATE ON canonical_text_version
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('canonical_text_version_id', 'project_id', 'canon_commit_id');

    CREATE TRIGGER story_event_ownership_immutable BEFORE UPDATE ON story_event
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('story_event_id', 'project_id', 'canon_commit_id');

    CREATE TRIGGER canon_fact_ownership_immutable BEFORE UPDATE ON canon_fact
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('canon_fact_id', 'project_id', 'canon_commit_id');

    CREATE TRIGGER state_transition_ownership_immutable BEFORE UPDATE ON state_transition
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('state_transition_id', 'project_id', 'canon_commit_id');

    CREATE TRIGGER temporal_relation_ownership_immutable BEFORE UPDATE ON temporal_relation
      FOR EACH ROW EXECUTE FUNCTION protect_source_ownership('temporal_relation_id', 'project_id', 'canon_commit_id');

    CREATE TRIGGER assertion_candidate_source_immutable
      BEFORE UPDATE OR DELETE ON narrative_assertion_candidate_source
      FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
  `);
}

export async function down(pgm) {
  // Keep the schema and migrator ledger so node-pg-migrate can record the rollback.
  pgm.sql(`
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_consumer_reference CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_tool_source CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_canon_source CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_candidate_source CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_design_source CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.evidence_reference CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.temporal_relation CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.state_transition CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.canon_fact CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.story_event CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.canonical_text_version CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.canon_commit CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.narrative_assertion_candidate_source CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.narrative_assertion CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.candidate_state_transition CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.candidate_fact_proposal CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.candidate_event CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.candidate_version CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.ending_constraint CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.foreshadowing_plan CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.temporal_constraint CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.world_rule CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.outline_node CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.design_constraint CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.design_object_version CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.author_design_revision CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.tool_call CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.generation_run CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.context_bundle CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.workflow_run CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.scene_task_version CASCADE;
    DROP TABLE IF EXISTS evidence_unified_constraint_fixture.project CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.protect_source_ownership() CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.reject_evidence_mutation() CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_source_trigger() CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_source(text) CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_tool(text) CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_canon(text) CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_candidate(text) CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.validate_evidence_design(text) CASCADE;
    DROP FUNCTION IF EXISTS evidence_unified_constraint_fixture.raise_evidence_source_complete(text) CASCADE;
  `);
}
