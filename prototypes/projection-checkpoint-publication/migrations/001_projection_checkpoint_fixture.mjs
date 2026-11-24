/** 完整快照发布夹具，保留上一批 Attempt 历史与数据库接纳；非生产迁移。 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS projection_checkpoint_fixture;
    SET search_path TO projection_checkpoint_fixture, pg_catalog;

    CREATE TABLE project (project_id text PRIMARY KEY);
    CREATE TABLE canon_commit (
      canon_commit_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
      canon_watermark bigint NOT NULL CHECK (canon_watermark > 0),
      UNIQUE(project_id, canon_watermark)
    );
    CREATE TABLE projection_policy (
      strategy_version text PRIMARY KEY,
      timeout_ms integer NOT NULL,
      CONSTRAINT ck_projection_policy_timeout CHECK (timeout_ms > 0)
    );
    CREATE TABLE projection_outbox (
      outbox_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      canon_commit_id text NOT NULL REFERENCES canon_commit,
      target text NOT NULL,
      scope_key text NOT NULL DEFAULT '$root',
      scope_hash text NOT NULL,
      source_canon_watermark bigint NOT NULL,
      strategy_version text NOT NULL REFERENCES projection_policy,
      event_hash text NOT NULL,
      emitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT uq_projection_outbox_identity UNIQUE (canon_commit_id, target, strategy_version)
    );
    CREATE FUNCTION normalized_scope(project_key text, scope_key text) RETURNS text
    LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$ SELECT encode(sha256(convert_to(jsonb_build_array(project_key, COALESCE(NULLIF(btrim(scope_key), ''), '$root'))::text, 'UTF8')), 'hex') $fn$;

    CREATE TABLE projection_rebuild_record (
      rebuild_record_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      target text NOT NULL,
      scope_key text NOT NULL DEFAULT '$root',
      scope_hash text NOT NULL,
      strategy_version text NOT NULL REFERENCES projection_policy,
      source_outbox_id text REFERENCES projection_outbox,
      source_commit_id text REFERENCES canon_commit,
      source_from_watermark bigint NOT NULL CHECK (source_from_watermark >= 0),
      target_watermark bigint NOT NULL,
      status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','running','verified','switched','abandoned')),
      verified_at timestamptz,
      switched_at timestamptz,
      switch_reason text,
      switched_attempt_id text,
      CONSTRAINT ck_rebuild_source CHECK (source_outbox_id IS NOT NULL OR source_commit_id IS NOT NULL),
      CONSTRAINT ck_rebuild_range CHECK (target_watermark >= source_from_watermark),
      CONSTRAINT uq_rebuild_scope UNIQUE(project_id,target,scope_hash,strategy_version,source_from_watermark,target_watermark),
      CONSTRAINT ck_rebuild_switch_reason CHECK (status <> 'switched' OR (switched_at IS NOT NULL AND switched_attempt_id IS NOT NULL AND switch_reason IS NOT NULL AND btrim(switch_reason) <> ''))
    );

    CREATE TABLE projection_task (
      task_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      origin_type text NOT NULL DEFAULT 'outbox',
      outbox_id text REFERENCES projection_outbox,
      rebuild_record_id text REFERENCES projection_rebuild_record,
      snapshot_commit_id text NOT NULL REFERENCES canon_commit,
      source_watermark bigint NOT NULL,
      scope_key text NOT NULL DEFAULT '$root',
      target text NOT NULL,
      scope_hash text NOT NULL,
      strategy_version text NOT NULL REFERENCES projection_policy,
      status text NOT NULL DEFAULT 'pending',
      CONSTRAINT ck_projection_task_origin CHECK ((origin_type = 'outbox' AND outbox_id IS NOT NULL AND rebuild_record_id IS NULL) OR (origin_type = 'rebuild' AND outbox_id IS NULL AND rebuild_record_id IS NOT NULL)),
      CONSTRAINT ck_projection_task_status CHECK (status IN ('pending', 'completed', 'cancelled', 'abandoned', 'needs_rebuild'))
    );
    CREATE UNIQUE INDEX uq_projection_task_active_outbox
      ON projection_task(outbox_id, target, strategy_version) WHERE origin_type='outbox' AND status IN ('pending', 'needs_rebuild');

    CREATE TABLE projection_attempt (
      attempt_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      task_id text NOT NULL REFERENCES projection_task,
      attempt_no integer NOT NULL CHECK (attempt_no > 0),
      previous_attempt_id text REFERENCES projection_attempt,
      status text NOT NULL DEFAULT 'processing',
      started_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      ended_at timestamptz,
      result_hash text,
      result_ref text,
      failure_detail_ref text,
      worker_version text NOT NULL,
      CONSTRAINT uq_projection_attempt_number UNIQUE (task_id, attempt_no),
      CONSTRAINT ck_projection_attempt_worker CHECK (btrim(worker_version) <> ''),
      CONSTRAINT ck_projection_attempt_times CHECK (expires_at > started_at AND (ended_at IS NULL OR ended_at >= started_at)),
      CONSTRAINT ck_projection_attempt_lifecycle CHECK (
        (status = 'processing' AND ended_at IS NULL AND result_hash IS NULL AND result_ref IS NULL AND failure_detail_ref IS NULL)
        OR (status = 'succeeded' AND ended_at IS NOT NULL AND ended_at < expires_at
            AND result_hash IS NOT NULL AND btrim(result_hash) <> ''
            AND result_ref IS NOT NULL AND btrim(result_ref) <> '' AND failure_detail_ref IS NULL)
        OR (status = 'expired' AND ended_at IS NOT NULL AND ended_at >= expires_at
            AND result_hash IS NULL AND result_ref IS NULL AND failure_detail_ref IS NULL)
        OR (status IN ('retryable_failure', 'permanent_failure') AND ended_at IS NOT NULL
            AND result_hash IS NULL AND result_ref IS NULL
            AND failure_detail_ref IS NOT NULL AND btrim(failure_detail_ref) <> '')
      )
    );
    CREATE UNIQUE INDEX uq_projection_attempt_processing ON projection_attempt(task_id) WHERE status = 'processing';

    CREATE TABLE projection_attempt_audit (
      audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      attempt_id text NOT NULL REFERENCES projection_attempt,
      previous_attempt_id text REFERENCES projection_attempt,
      from_status text,
      to_status text NOT NULL,
      event_kind text NOT NULL,
      occurred_at timestamptz NOT NULL,
      detail_ref text NOT NULL,
      CONSTRAINT uq_projection_attempt_audit_state UNIQUE (attempt_id, to_status)
    );

    CREATE FUNCTION reject_attempt(rule text, message text, code text DEFAULT '23514') RETURNS void
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = code, CONSTRAINT = rule, MESSAGE = message;
    END;
    $fn$;

    CREATE FUNCTION protect_projection_inputs() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE source_row record; commit_row canon_commit%ROWTYPE; proof record;
    BEGIN
      IF TG_OP IN ('DELETE','TRUNCATE') THEN PERFORM reject_attempt('projection_input_immutable','Source and governance history cannot be removed'); END IF;
      IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
        IF TG_TABLE_NAME = 'projection_task' THEN
          IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN PERFORM reject_attempt('projection_input_immutable','Task input bindings are immutable'); END IF;
          IF OLD.status <> 'pending' THEN PERFORM reject_attempt('projection_task_terminal','A non-pending Task cannot resume or erase its history'); END IF;
          IF NEW.status='completed' AND NOT EXISTS (
            SELECT 1 FROM publication_receipt p JOIN projection_attempt a USING(attempt_id)
             WHERE a.task_id=OLD.task_id AND p.outcome IN ('published','idempotent')) THEN
            PERFORM reject_attempt('publication_task_completion','Task completion requires a validated publication receipt');
          END IF;
          RETURN NEW;
        ELSIF TG_TABLE_NAME = 'projection_rebuild_record' THEN
          IF (to_jsonb(NEW)-ARRAY['status','verified_at','switched_at','switch_reason','switched_attempt_id']) IS DISTINCT FROM
             (to_jsonb(OLD)-ARRAY['status','verified_at','switched_at','switch_reason','switched_attempt_id']) THEN
            PERFORM reject_attempt('projection_input_immutable','Rebuild identity, sources, range, target and policy are immutable');
          END IF;
          IF OLD.status IN ('switched','abandoned') THEN PERFORM reject_attempt('publication_rebuild_terminal','Rebuild terminal history is immutable'); END IF;
          IF NEW.status='switched' THEN
            SELECT p.* INTO proof FROM publication_receipt p JOIN projection_attempt a USING(attempt_id)
              JOIN projection_task t USING(task_id) WHERE t.rebuild_record_id=OLD.rebuild_record_id
              AND p.attempt_id=NEW.switched_attempt_id AND p.outcome IN ('published','idempotent') ORDER BY p.receipt_no DESC LIMIT 1;
            IF NOT FOUND OR proof.watermark < OLD.target_watermark THEN PERFORM reject_attempt('publication_rebuild_switch','Rebuild switch requires a qualifying publication at its target'); END IF;
            IF NEW.switched_at IS NOT NULL OR NEW.verified_at IS NOT NULL THEN PERFORM reject_attempt('publication_governance_time','Switch times are database assigned'); END IF;
            NEW.verified_at:=clock_timestamp(); NEW.switched_at:=NEW.verified_at;
            RETURN NEW;
          END IF;
          IF (NEW.verified_at,NEW.switched_at,NEW.switch_reason,NEW.switched_attempt_id) IS DISTINCT FROM
             (OLD.verified_at,OLD.switched_at,OLD.switch_reason,OLD.switched_attempt_id)
             OR NOT ((OLD.status='requested' AND NEW.status='running') OR NEW.status='abandoned') THEN
            PERFORM reject_attempt('publication_rebuild_transition','Only start, abandon, or proven switch is implemented');
          END IF;
          RETURN NEW;
        END IF;
        PERFORM reject_attempt('projection_input_immutable','Source and policy versions are immutable');
      END IF;
      IF TG_TABLE_NAME IN ('projection_outbox','projection_rebuild_record','projection_task') THEN
        NEW.scope_key:=COALESCE(NULLIF(btrim(NEW.scope_key),''),'$root');
        IF NEW.scope_hash IS NOT NULL AND NEW.scope_hash<>normalized_scope(NEW.project_id,NEW.scope_key) THEN PERFORM reject_attempt('projection_source_mapping','Scope normalization must include the project'); END IF;
        NEW.scope_hash:=normalized_scope(NEW.project_id,NEW.scope_key);
      END IF;
      IF TG_TABLE_NAME='projection_outbox' THEN
        SELECT * INTO STRICT commit_row FROM canon_commit WHERE canon_commit_id=NEW.canon_commit_id;
        IF NEW.project_id<>commit_row.project_id OR NEW.source_canon_watermark<>commit_row.canon_watermark THEN PERFORM reject_attempt('projection_source_mapping','Outbox project/watermark must match committed Canon'); END IF;
      ELSIF TG_TABLE_NAME='projection_rebuild_record' THEN
        IF NEW.status NOT IN ('requested','running') OR NEW.switched_at IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.switched_attempt_id IS NOT NULL THEN PERFORM reject_attempt('publication_rebuild_initial','A Rebuild cannot start already verified or switched'); END IF;
        IF NEW.source_outbox_id IS NOT NULL THEN
          SELECT * INTO STRICT source_row FROM projection_outbox WHERE outbox_id=NEW.source_outbox_id;
          IF (NEW.project_id,NEW.target,NEW.scope_hash,NEW.strategy_version) IS DISTINCT FROM (source_row.project_id,source_row.target,source_row.scope_hash,source_row.strategy_version) THEN PERFORM reject_attempt('projection_source_mapping','Rebuild source Outbox mapping mismatch'); END IF;
        END IF;
        IF NEW.source_commit_id IS NOT NULL THEN
          SELECT * INTO STRICT commit_row FROM canon_commit WHERE canon_commit_id=NEW.source_commit_id;
          IF NEW.project_id<>commit_row.project_id THEN PERFORM reject_attempt('projection_source_mapping','Rebuild source Commit project mismatch'); END IF;
        END IF;
        IF NEW.target_watermark>COALESCE((SELECT max(canon_watermark) FROM canon_commit WHERE project_id=NEW.project_id),0) THEN PERFORM reject_attempt('projection_source_mapping','Rebuild target must reference an existing committed Canon boundary'); END IF;
      ELSIF TG_TABLE_NAME='projection_task' THEN
        SELECT * INTO STRICT commit_row FROM canon_commit WHERE canon_commit_id=NEW.snapshot_commit_id;
        IF (NEW.project_id,NEW.source_watermark) IS DISTINCT FROM (commit_row.project_id,commit_row.canon_watermark) THEN PERFORM reject_attempt('projection_source_mapping','Task snapshot must match its actual committed Canon version'); END IF;
        IF NEW.origin_type='outbox' THEN
          SELECT * INTO STRICT source_row FROM projection_outbox WHERE outbox_id=NEW.outbox_id;
          IF (NEW.snapshot_commit_id,NEW.source_watermark) IS DISTINCT FROM (source_row.canon_commit_id,source_row.source_canon_watermark) THEN PERFORM reject_attempt('projection_source_mapping','Ordinary Task must use the Outbox snapshot'); END IF;
        ELSIF NEW.origin_type='rebuild' THEN
          SELECT * INTO STRICT source_row FROM projection_rebuild_record WHERE rebuild_record_id=NEW.rebuild_record_id;
          IF NEW.source_watermark<source_row.source_from_watermark THEN PERFORM reject_attempt('projection_source_mapping','Rebuild snapshot precedes its source range'); END IF;
        ELSE PERFORM reject_attempt('projection_source_mapping','Unsupported Task origin'); END IF;
        IF (NEW.project_id,NEW.target,NEW.scope_hash,NEW.strategy_version) IS DISTINCT FROM (source_row.project_id,source_row.target,source_row.scope_hash,source_row.strategy_version) THEN PERFORM reject_attempt('projection_source_mapping','Task source project/target/scope/strategy mismatch'); END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$;


    -- The executor holds the UPDATE target row before this trigger runs. This
    -- trigger never requests a Task lock; it only validates this locked Attempt.
    CREATE FUNCTION guard_attempt_update() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE decision_time timestamptz;
    BEGIN
      IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        PERFORM reject_attempt('projection_attempt_immutable', 'Attempt execution history is append-only');
      END IF;
      IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
      IF (NEW.attempt_id, NEW.task_id, NEW.attempt_no, NEW.previous_attempt_id, NEW.started_at, NEW.expires_at, NEW.worker_version)
         IS DISTINCT FROM
         (OLD.attempt_id, OLD.task_id, OLD.attempt_no, OLD.previous_attempt_id, OLD.started_at, OLD.expires_at, OLD.worker_version) THEN
        PERFORM reject_attempt('projection_attempt_identity', 'Attempt identity, input binding, worker version and deadline are immutable');
      END IF;
      IF OLD.status <> 'processing' THEN
        PERFORM reject_attempt('projection_attempt_terminal', 'A terminal Attempt cannot be overwritten or restarted');
      END IF;
      IF NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
        PERFORM reject_attempt('projection_attempt_time_authority', 'Only the locked database transition assigns ended_at');
      END IF;
      IF NEW.status NOT IN ('succeeded', 'expired', 'retryable_failure', 'permanent_failure') THEN
        PERFORM reject_attempt('projection_attempt_transition', 'Only processing to a terminal state is allowed');
      END IF;
      -- Deliberately after the executor has locked the Attempt, never now() or
      -- statement_timestamp(). COMMIT time must not re-evaluate this decision.
      decision_time := clock_timestamp();
      IF NEW.status = 'succeeded' AND decision_time >= OLD.expires_at THEN
        PERFORM reject_attempt('projection_attempt_deadline', 'Success acceptance deadline elapsed', '55000');
      END IF;
      IF NEW.status = 'expired' AND decision_time < OLD.expires_at THEN
        PERFORM reject_attempt('projection_attempt_not_expired', 'Attempt has not reached its deadline', '55000');
      END IF;
      NEW.ended_at := decision_time;
      RETURN NEW;
    END;
    $fn$;

    -- INSERT has no pre-existing Attempt target row. It may safely take Task
    -- first, then the one latest Attempt, and allocate the new sequential ID.
    CREATE FUNCTION guard_attempt_insert() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE task_row projection_task%ROWTYPE; prior projection_attempt%ROWTYPE; timeout_ms integer;
    BEGIN
      IF NEW.status IS DISTINCT FROM 'processing' THEN
        PERFORM reject_attempt('projection_attempt_initial_state', 'New Attempts must start processing');
      END IF;
      IF NEW.started_at IS NOT NULL OR NEW.expires_at IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
        PERFORM reject_attempt('projection_attempt_time_authority', 'Worker-supplied creation or acceptance times are forbidden');
      END IF;
      SELECT * INTO STRICT task_row FROM projection_task WHERE task_id = NEW.task_id FOR UPDATE;
      IF task_row.status <> 'pending' THEN
        PERFORM reject_attempt('projection_task_not_executable', 'Only pending Tasks can create Attempts', '55000');
      END IF;
      SELECT * INTO prior FROM projection_attempt WHERE task_id = NEW.task_id ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        IF prior.status = 'processing' THEN
          IF clock_timestamp() < prior.expires_at THEN
            PERFORM reject_attempt('projection_attempt_in_progress', 'An unexpired processing Attempt already exists', '55000');
          END IF;
          UPDATE projection_attempt SET status = 'expired' WHERE attempt_id = prior.attempt_id;
          prior.status := 'expired';
        END IF;
        IF prior.status NOT IN ('expired', 'retryable_failure') THEN
          PERFORM reject_attempt('projection_attempt_not_retryable', 'Succeeded or permanent failure Attempts cannot automatically retry', '55000');
        END IF;
      END IF;
      IF NEW.attempt_no IS NOT NULL AND NEW.attempt_no <> COALESCE(prior.attempt_no, 0) + 1 THEN
        PERFORM reject_attempt('projection_attempt_number', 'Attempt number must follow the latest execution');
      END IF;
      IF NEW.previous_attempt_id IS NOT NULL AND NEW.previous_attempt_id IS DISTINCT FROM prior.attempt_id THEN
        PERFORM reject_attempt('projection_attempt_identity', 'Retry must bind the previous execution of this Task');
      END IF;
      SELECT p.timeout_ms INTO STRICT timeout_ms FROM projection_policy p WHERE p.strategy_version = task_row.strategy_version;
      NEW.attempt_no := COALESCE(prior.attempt_no, 0) + 1;
      NEW.previous_attempt_id := prior.attempt_id;
      NEW.started_at := clock_timestamp();
      NEW.expires_at := NEW.started_at + timeout_ms * interval '1 millisecond';
      RETURN NEW;
    END;
    $fn$;

    CREATE FUNCTION audit_attempt_transition() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NULL; END IF;
      END IF;
      INSERT INTO projection_attempt_audit(attempt_id, previous_attempt_id, from_status, to_status, event_kind, occurred_at, detail_ref)
        VALUES (NEW.attempt_id, NEW.previous_attempt_id,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
          NEW.status,
          CASE WHEN TG_OP = 'INSERT' THEN CASE WHEN NEW.previous_attempt_id IS NULL THEN 'claimed' ELSE 'retried' END ELSE NEW.status END,
          CASE WHEN TG_OP = 'INSERT' THEN NEW.started_at ELSE NEW.ended_at END,
          CASE WHEN NEW.status = 'succeeded' THEN NEW.result_ref
               WHEN NEW.status IN ('retryable_failure', 'permanent_failure') THEN NEW.failure_detail_ref
               WHEN NEW.status = 'expired' THEN 'database://deadline-reached'
               ELSE 'database://task-policy-claim' END);
      RETURN NULL;
    END;
    $fn$;

    CREATE FUNCTION guard_attempt_audit() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE a projection_attempt%ROWTYPE; expected_kind text; expected_detail text;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
      END IF;
      IF TG_OP <> 'INSERT' THEN PERFORM reject_attempt('projection_attempt_audit_immutable', 'Execution audit is append-only'); END IF;
      SELECT * INTO STRICT a FROM projection_attempt WHERE attempt_id = NEW.attempt_id;
      expected_kind := CASE WHEN a.status = 'processing' THEN CASE WHEN a.previous_attempt_id IS NULL THEN 'claimed' ELSE 'retried' END ELSE a.status END;
      expected_detail := CASE WHEN a.status = 'processing' THEN 'database://task-policy-claim'
                             WHEN a.status = 'succeeded' THEN a.result_ref
                             WHEN a.status = 'expired' THEN 'database://deadline-reached' ELSE a.failure_detail_ref END;
      IF NEW.to_status IS DISTINCT FROM a.status OR NEW.previous_attempt_id IS DISTINCT FROM a.previous_attempt_id
         OR NEW.occurred_at IS DISTINCT FROM COALESCE(a.ended_at, a.started_at)
         OR NEW.from_status IS DISTINCT FROM (CASE WHEN a.status = 'processing' THEN NULL ELSE 'processing' END)
         OR NEW.event_kind IS DISTINCT FROM expected_kind OR NEW.detail_ref IS DISTINCT FROM expected_detail THEN
        PERFORM reject_attempt('projection_attempt_audit_mapping', 'Audit must describe the actual locked transition');
      END IF;
      RETURN NEW;
    END;
    $fn$;

    CREATE TRIGGER attempt_insert_guard BEFORE INSERT ON projection_attempt FOR EACH ROW EXECUTE FUNCTION guard_attempt_insert();
    CREATE TRIGGER attempt_update_guard BEFORE UPDATE OR DELETE ON projection_attempt FOR EACH ROW EXECUTE FUNCTION guard_attempt_update();
    CREATE TRIGGER attempt_no_truncate BEFORE TRUNCATE ON projection_attempt FOR EACH STATEMENT EXECUTE FUNCTION guard_attempt_update();
    CREATE TRIGGER attempt_transition_audit AFTER INSERT OR UPDATE ON projection_attempt FOR EACH ROW EXECUTE FUNCTION audit_attempt_transition();
    CREATE TRIGGER attempt_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON projection_attempt_audit FOR EACH ROW EXECUTE FUNCTION guard_attempt_audit();
    CREATE TRIGGER attempt_audit_no_truncate BEFORE TRUNCATE ON projection_attempt_audit FOR EACH STATEMENT EXECUTE FUNCTION guard_attempt_audit();

    CREATE FUNCTION attempt_response(outcome text, a projection_attempt) RETURNS jsonb
    LANGUAGE sql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$ SELECT jsonb_build_object('outcome', outcome, 'attempt', to_jsonb(a)) $fn$;

    CREATE FUNCTION lock_attempt(attempt_key text) RETURNS projection_attempt
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE task_key text; a projection_attempt%ROWTYPE;
    BEGIN
      SELECT task_id INTO task_key FROM projection_attempt WHERE attempt_id = attempt_key;
      IF NOT FOUND THEN PERFORM reject_attempt('projection_attempt_not_found', 'Unknown Attempt ID', 'P0002'); END IF;
      -- Initial lookup is unlocked; task_id cannot change and history cannot be deleted.
      PERFORM 1 FROM projection_task WHERE task_id = task_key FOR UPDATE;
      SELECT * INTO STRICT a FROM projection_attempt WHERE attempt_id = attempt_key FOR UPDATE;
      RETURN a;
    END;
    $fn$;

    CREATE FUNCTION claim_attempt(task_key text, worker text) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE task_row projection_task%ROWTYPE; a projection_attempt%ROWTYPE;
    BEGIN
      SELECT * INTO STRICT task_row FROM projection_task WHERE task_id = task_key FOR UPDATE;
      IF task_row.status <> 'pending' THEN RETURN attempt_response('task_not_executable', NULL); END IF;
      SELECT * INTO a FROM projection_attempt WHERE task_id = task_key ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE;
      IF FOUND THEN
        RETURN attempt_response(CASE WHEN a.status = 'succeeded' THEN 'already_succeeded'
          WHEN a.status = 'processing' AND clock_timestamp() < a.expires_at THEN 'in_progress'
          WHEN a.status = 'permanent_failure' THEN 'not_retryable' ELSE 'retry_required' END, a);
      END IF;
      INSERT INTO projection_attempt(task_id, worker_version) VALUES (task_key, worker) RETURNING * INTO a;
      RETURN attempt_response('created', a);
    END;
    $fn$;

    CREATE FUNCTION transition_attempt(attempt_key text, terminal_status text, result_digest text DEFAULT NULL,
      result_location text DEFAULT NULL, failure_location text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE a projection_attempt%ROWTYPE; rejected_rule text;
    BEGIN
      IF terminal_status NOT IN ('succeeded', 'expired', 'retryable_failure', 'permanent_failure') THEN
        PERFORM reject_attempt('projection_attempt_transition', 'Unsupported terminal status', '22023');
      END IF;
      a := lock_attempt(attempt_key);
      IF a.status <> 'processing' THEN
        IF a.status = 'succeeded' AND terminal_status = 'succeeded' AND a.result_hash IS NOT DISTINCT FROM result_digest
           AND a.result_ref IS NOT DISTINCT FROM result_location THEN RETURN attempt_response('idempotent_success', a); END IF;
        RETURN attempt_response('already_terminal', a);
      END IF;
      BEGIN
        -- The row trigger takes a fresh clock_timestamp at the final transition
        -- decision, after all lock waits, and assigns the same value to ended_at.
        UPDATE projection_attempt SET status = terminal_status, result_hash = result_digest,
          result_ref = result_location, failure_detail_ref = failure_location
          WHERE attempt_id = attempt_key RETURNING * INTO a;
      EXCEPTION WHEN SQLSTATE '55000' THEN
        GET STACKED DIAGNOSTICS rejected_rule = CONSTRAINT_NAME;
        IF rejected_rule = 'projection_attempt_deadline' THEN RETURN attempt_response('deadline_elapsed', a); END IF;
        IF rejected_rule = 'projection_attempt_not_expired' THEN RETURN attempt_response('not_expired', a); END IF;
        RAISE;
      END;
      RETURN attempt_response(CASE terminal_status WHEN 'succeeded' THEN 'accepted_success'
        WHEN 'expired' THEN 'expired' ELSE 'failure_recorded' END, a);
    END;
    $fn$;

    CREATE FUNCTION accept_success(attempt_key text, result_digest text, result_location text) RETURNS jsonb
    LANGUAGE sql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$ SELECT transition_attempt(attempt_key, 'succeeded', result_digest, result_location) $fn$;
    CREATE FUNCTION expire_attempt(attempt_key text) RETURNS jsonb
    LANGUAGE sql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$ SELECT transition_attempt(attempt_key, 'expired') $fn$;
    CREATE FUNCTION record_failure(attempt_key text, failure_status text, failure_location text) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    BEGIN
      IF failure_status NOT IN ('retryable_failure', 'permanent_failure') THEN
        PERFORM reject_attempt('projection_attempt_failure_kind', 'Failure status must be retryable_failure or permanent_failure', '22023');
      END IF;
      RETURN transition_attempt(attempt_key, failure_status, NULL, NULL, failure_location);
    END;
    $fn$;

    CREATE FUNCTION retry_attempt(previous_key text, worker text) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp
    AS $fn$
    DECLARE prior projection_attempt%ROWTYPE; latest projection_attempt%ROWTYPE; task_status text;
    BEGIN
      prior := lock_attempt(previous_key);
      SELECT status INTO STRICT task_status FROM projection_task WHERE task_id = prior.task_id;
      IF task_status <> 'pending' THEN RETURN attempt_response('task_not_executable', prior); END IF;
      -- Only one existing latest row; a new Attempt follows it in attempt_no order.
      SELECT * INTO STRICT latest FROM projection_attempt WHERE task_id = prior.task_id ORDER BY attempt_no DESC LIMIT 1 FOR UPDATE;
      IF latest.attempt_id <> prior.attempt_id THEN RETURN attempt_response('superseded', latest); END IF;
      IF prior.status = 'processing' AND clock_timestamp() < prior.expires_at THEN RETURN attempt_response('in_progress', prior); END IF;
      IF prior.status NOT IN ('processing', 'expired', 'retryable_failure') THEN RETURN attempt_response('not_retryable', prior); END IF;
      INSERT INTO projection_attempt(task_id, worker_version) VALUES (prior.task_id, worker) RETURNING * INTO latest;
      RETURN attempt_response('retried', latest);
    END;
    $fn$;
  `);
  await publicationUp(pgm);
  for (const table of ['canon_commit', 'projection_policy', 'projection_outbox', 'projection_task', 'projection_rebuild_record']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_inputs BEFORE INSERT OR UPDATE OR DELETE ON projection_checkpoint_fixture.${table}
        FOR EACH ROW EXECUTE FUNCTION projection_checkpoint_fixture.protect_projection_inputs();
      CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON projection_checkpoint_fixture.${table}
        FOR EACH STATEMENT EXECUTE FUNCTION projection_checkpoint_fixture.protect_projection_inputs();
    `);
  }
}


async function publicationUp(pgm) {
  pgm.sql(`
    ALTER TABLE projection_rebuild_record ADD CONSTRAINT fk_rebuild_switched_attempt FOREIGN KEY(switched_attempt_id) REFERENCES projection_attempt;
    CREATE FUNCTION snapshot_digest(snapshot jsonb) RETURNS text LANGUAGE sql IMMUTABLE
      SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$ SELECT encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') $fn$;
    CREATE TABLE projection_result_version (
      result_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      attempt_id text NOT NULL REFERENCES projection_attempt,
      project_id text NOT NULL REFERENCES project,
      origin_type text NOT NULL, source_id text NOT NULL, target text NOT NULL,
      normalized_scope_hash text NOT NULL, strategy_version text NOT NULL REFERENCES projection_policy,
      watermark bigint NOT NULL, payload jsonb NOT NULL,
      content_hash text GENERATED ALWAYS AS (snapshot_digest(payload)) STORED,
      claimed_hash text NOT NULL, result_ref text NOT NULL UNIQUE,
      stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT uq_result_snapshot UNIQUE(attempt_id,origin_type,source_id,project_id,target,normalized_scope_hash,strategy_version,watermark,content_hash)
    );
    CREATE TABLE result_permission_fixture (
      result_id text PRIMARY KEY REFERENCES projection_result_version,
      decision text NOT NULL CHECK(decision IN ('allow','deny')), basis text NOT NULL CHECK(btrim(basis)<>'')
    );
    CREATE TABLE projection_result_verification (
      verification_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      result_id text NOT NULL REFERENCES projection_result_version, attempt_id text NOT NULL REFERENCES projection_attempt,
      rule_version text NOT NULL DEFAULT 'fixture-integrity-v1' CHECK(rule_version='fixture-integrity-v1'),
      project_id text NOT NULL, origin_type text NOT NULL, source_id text NOT NULL, target text NOT NULL,
      normalized_scope_hash text NOT NULL, strategy_version text NOT NULL, watermark bigint NOT NULL,
      content_hash text NOT NULL, permission_basis text NOT NULL, passed boolean NOT NULL, reason text NOT NULL, verified_at timestamptz NOT NULL,
      UNIQUE(result_id,attempt_id,rule_version)
    );
    CREATE TABLE publication_identity (
      identity_id text PRIMARY KEY, project_id text NOT NULL REFERENCES project, target text NOT NULL,
      normalized_scope_hash text NOT NULL, strategy_version text NOT NULL REFERENCES projection_policy,
      CONSTRAINT uq_publication_identity UNIQUE(target,normalized_scope_hash,strategy_version)
    );
    -- Immutable identity/lock slots. Current values are derived from validated receipts.
    CREATE TABLE checkpoint_slot (
      checkpoint_id text PRIMARY KEY DEFAULT gen_random_uuid()::text, identity_id text NOT NULL REFERENCES publication_identity,
      target text NOT NULL, normalized_scope_hash text NOT NULL, strategy_version text NOT NULL,
      state text NOT NULL CHECK(state IN ('active','staging')),
      CONSTRAINT uq_projection_checkpoint_identity UNIQUE(target,normalized_scope_hash,strategy_version,state), UNIQUE(identity_id,state)
    );
    CREATE TABLE publication_receipt (
      receipt_id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      attempt_id text NOT NULL REFERENCES projection_attempt, result_id text NOT NULL REFERENCES projection_result_version,
      requested_state text NOT NULL CHECK(requested_state IN ('active','staging')), reason text NOT NULL,
      identity_id text NOT NULL REFERENCES publication_identity, receipt_no bigint NOT NULL,
      project_id text NOT NULL, target text NOT NULL, normalized_scope_hash text NOT NULL, strategy_version text NOT NULL,
      watermark bigint NOT NULL, content_hash text NOT NULL, verification_id text NOT NULL REFERENCES projection_result_verification,
      outcome text NOT NULL CHECK(outcome IN ('published','idempotent','staged','staging_idempotent','isolated')), reason_code text NOT NULL, accepted_at timestamptz NOT NULL,
      UNIQUE(identity_id,receipt_no), UNIQUE(attempt_id,result_id,requested_state,outcome)
    );
    CREATE TABLE projection_task_invalidation (
      task_id text PRIMARY KEY REFERENCES projection_task, kind text NOT NULL CHECK(kind IN ('cancelled','abandoned')),
      reason text NOT NULL CHECK(btrim(reason)<>''), invalidated_at timestamptz NOT NULL
    );
    CREATE FUNCTION immutable_publication_data() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF TG_TABLE_NAME='projection_result_version' THEN
          IF (to_jsonb(NEW)-'content_hash') IS NOT DISTINCT FROM (to_jsonb(OLD)-'content_hash') THEN RETURN NEW; END IF;
        ELSIF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW;
        END IF;
      END IF;
      PERFORM reject_attempt('publication_immutable','Versioned results, validations, identity slots and publication history are append-only'); RETURN NULL;
    END;
    $fn$;
    CREATE FUNCTION deny_publication_view_write() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    BEGIN PERFORM reject_attempt('publication_read_only','Checkpoint, active pointer and publication history derive only from validated receipts'); RETURN NULL; END;
    $fn$;
    CREATE FUNCTION guard_result_mapping() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE t projection_task%ROWTYPE;
    BEGIN
      SELECT task.* INTO STRICT t FROM projection_task task JOIN projection_attempt a USING(task_id) WHERE a.attempt_id=NEW.attempt_id;
      IF (NEW.project_id,NEW.origin_type,NEW.source_id,NEW.target,NEW.normalized_scope_hash,NEW.strategy_version,NEW.watermark)
        IS DISTINCT FROM (t.project_id,t.origin_type,COALESCE(t.outbox_id,t.rebuild_record_id),t.target,t.scope_hash,t.strategy_version,t.source_watermark) THEN
        PERFORM reject_attempt('publication_result_mapping','Result project/target/scope/strategy/source/watermark must match its actual Attempt and Task');
      END IF; RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER result_mapping BEFORE INSERT ON projection_result_version FOR EACH ROW EXECUTE FUNCTION guard_result_mapping();
    CREATE FUNCTION store_result(attempt_key text,snapshot jsonb,location text,worker_digest text DEFAULT NULL) RETURNS projection_result_version LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE r projection_result_version%ROWTYPE; t projection_task%ROWTYPE; digest text;
    BEGIN
      SELECT task.* INTO STRICT t FROM projection_task task JOIN projection_attempt a USING(task_id) WHERE a.attempt_id=attempt_key;
      digest:=snapshot_digest(snapshot);
      INSERT INTO projection_result_version(attempt_id,project_id,origin_type,source_id,target,normalized_scope_hash,strategy_version,watermark,payload,claimed_hash,result_ref)
        VALUES(attempt_key,t.project_id,t.origin_type,COALESCE(t.outbox_id,t.rebuild_record_id),t.target,t.scope_hash,t.strategy_version,t.source_watermark,snapshot,COALESCE(worker_digest,digest),location)
        ON CONFLICT ON CONSTRAINT uq_result_snapshot DO NOTHING RETURNING * INTO r;
      IF NOT FOUND THEN SELECT * INTO STRICT r FROM projection_result_version WHERE attempt_id=attempt_key AND content_hash=digest; END IF; RETURN r;
    END;
    $fn$;
    CREATE FUNCTION result_problem(result_key text,attempt_key text) RETURNS text LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE r projection_result_version%ROWTYPE; a projection_attempt%ROWTYPE; t projection_task%ROWTYPE; permission text; digest text;
    BEGIN
      SELECT * INTO STRICT r FROM projection_result_version WHERE result_id=result_key;
      SELECT * INTO STRICT a FROM projection_attempt WHERE attempt_id=attempt_key;
      SELECT * INTO STRICT t FROM projection_task WHERE task_id=a.task_id;
      IF r.attempt_id<>a.attempt_id THEN RETURN 'attempt_result_mismatch'; END IF;
      IF a.status<>'succeeded' OR a.ended_at IS NULL OR a.ended_at>=a.expires_at THEN RETURN 'attempt_not_eligible'; END IF;
      IF (r.project_id,r.origin_type,r.source_id,r.target,r.normalized_scope_hash,r.strategy_version,r.watermark)
        IS DISTINCT FROM (t.project_id,t.origin_type,COALESCE(t.outbox_id,t.rebuild_record_id),t.target,t.scope_hash,t.strategy_version,t.source_watermark) THEN RETURN 'result_mapping'; END IF;
      digest:=encode(sha256(convert_to(r.payload::text,'UTF8')),'hex');
      IF digest<>r.content_hash OR digest<>r.claimed_hash OR digest<>a.result_hash THEN RETURN 'content_hash_mismatch'; END IF;
      IF r.result_ref<>a.result_ref THEN RETURN 'result_ref_mismatch'; END IF;
      IF r.payload->>'format' IS DISTINCT FROM 'complete_snapshot_v1' OR jsonb_typeof(r.payload->'snapshot') IS DISTINCT FROM 'object' THEN RETURN 'snapshot_format_invalid'; END IF;
      IF (r.payload->>'project_id',r.payload->>'target',r.payload->>'scope',r.payload->>'strategy',r.payload->>'watermark')
         IS DISTINCT FROM (r.project_id,r.target,r.normalized_scope_hash,r.strategy_version,r.watermark::text) THEN RETURN 'payload_mapping'; END IF;
      SELECT decision INTO permission FROM result_permission_fixture WHERE result_id=result_key;
      IF permission IS NULL THEN RETURN 'permission_missing'; END IF;
      IF permission<>'allow' THEN RETURN 'permission_denied'; END IF; RETURN NULL;
    END;
    $fn$;
    CREATE FUNCTION derive_result_verification() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE r projection_result_version%ROWTYPE; problem text;
    BEGIN
      IF NEW.passed IS NOT NULL OR NEW.reason IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.content_hash IS NOT NULL THEN PERFORM reject_attempt('publication_validation_derived','Verification verdict and evidence must be database derived'); END IF;
      SELECT * INTO STRICT r FROM projection_result_version WHERE result_id=NEW.result_id;
      problem:=result_problem(NEW.result_id,NEW.attempt_id);
      NEW.project_id:=r.project_id; NEW.origin_type:=r.origin_type; NEW.source_id:=r.source_id; NEW.target:=r.target;
      NEW.normalized_scope_hash:=r.normalized_scope_hash; NEW.strategy_version:=r.strategy_version; NEW.watermark:=r.watermark; NEW.content_hash:=r.content_hash;
      NEW.permission_basis:=COALESCE((SELECT basis FROM result_permission_fixture WHERE result_id=NEW.result_id),'fixture permission missing');
      NEW.passed:=problem IS NULL; NEW.reason:=COALESCE(problem,'verified_complete_snapshot'); NEW.verified_at:=clock_timestamp(); RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER verification_derived BEFORE INSERT ON projection_result_verification FOR EACH ROW EXECUTE FUNCTION derive_result_verification();
    CREATE FUNCTION verify_result(result_key text,attempt_key text) RETURNS projection_result_verification LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE v projection_result_verification%ROWTYPE;
    BEGIN
      INSERT INTO projection_result_verification(result_id,attempt_id) VALUES(result_key,attempt_key) ON CONFLICT(result_id,attempt_id,rule_version) DO NOTHING RETURNING * INTO v;
      IF NOT FOUND THEN SELECT * INTO STRICT v FROM projection_result_verification WHERE result_id=result_key AND attempt_id=attempt_key AND rule_version='fixture-integrity-v1'; END IF; RETURN v;
    END;
    $fn$;
    CREATE FUNCTION guard_identity_slot() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE i publication_identity%ROWTYPE;
    BEGIN
      IF TG_TABLE_NAME='publication_identity' THEN
        IF NEW.identity_id<>encode(sha256(convert_to(jsonb_build_array(NEW.target,NEW.normalized_scope_hash,NEW.strategy_version)::text,'UTF8')),'hex')
          OR NOT EXISTS(SELECT 1 FROM projection_task WHERE project_id=NEW.project_id AND target=NEW.target AND scope_hash=NEW.normalized_scope_hash AND strategy_version=NEW.strategy_version) THEN PERFORM reject_attempt('publication_identity_mapping','Identity must match a project-qualified Task scope'); END IF;
      ELSE
        SELECT * INTO STRICT i FROM publication_identity WHERE identity_id=NEW.identity_id;
        IF (NEW.target,NEW.normalized_scope_hash,NEW.strategy_version) IS DISTINCT FROM (i.target,i.normalized_scope_hash,i.strategy_version) THEN PERFORM reject_attempt('publication_identity_mapping','Checkpoint slot identity mismatch'); END IF;
      END IF; RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER identity_mapping BEFORE INSERT ON publication_identity FOR EACH ROW EXECUTE FUNCTION guard_identity_slot();
    CREATE TRIGGER checkpoint_slot_mapping BEFORE INSERT ON checkpoint_slot FOR EACH ROW EXECUTE FUNCTION guard_identity_slot();
    CREATE FUNCTION guard_publication_receipt() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE a projection_attempt%ROWTYPE; t projection_task%ROWTYPE; r projection_result_version%ROWTYPE;
      rebuild projection_rebuild_record%ROWTYPE; current_head publication_receipt%ROWTYPE;
      identity_key text; problem text; validation projection_result_verification%ROWTYPE; stage_watermark bigint;
    BEGIN
      IF NEW.outcome IS NOT NULL OR NEW.receipt_no IS NOT NULL OR NEW.identity_id IS NOT NULL OR NEW.accepted_at IS NOT NULL OR NEW.watermark IS NOT NULL OR NEW.verification_id IS NOT NULL OR NEW.project_id IS NOT NULL THEN PERFORM reject_attempt('publication_receipt_derived','Publication outputs cannot be supplied or forged'); END IF;
      a:=lock_attempt(NEW.attempt_id); SELECT * INTO STRICT t FROM projection_task WHERE task_id=a.task_id; SELECT * INTO STRICT r FROM projection_result_version WHERE result_id=NEW.result_id;
      IF t.status NOT IN ('pending','completed') OR EXISTS(SELECT 1 FROM projection_task_invalidation WHERE task_id=t.task_id) THEN PERFORM reject_attempt('publication_source_ineligible','Task publication qualification was lost','55000'); END IF;
      IF t.origin_type='rebuild' THEN
        SELECT * INTO STRICT rebuild FROM projection_rebuild_record WHERE rebuild_record_id=t.rebuild_record_id FOR UPDATE;
        IF rebuild.status NOT IN ('running','verified') AND NOT (rebuild.status='switched' AND rebuild.switched_attempt_id=a.attempt_id) THEN PERFORM reject_attempt('publication_rebuild_ineligible','Rebuild publication qualification was lost','55000'); END IF;
      END IF;
      problem:=result_problem(r.result_id,a.attempt_id);
      IF problem IS NOT NULL THEN PERFORM reject_attempt('publication_'||problem,problem,'55000'); END IF;
      SELECT * INTO validation FROM projection_result_verification WHERE result_id=r.result_id AND attempt_id=a.attempt_id AND rule_version='fixture-integrity-v1';
      IF NOT FOUND OR NOT validation.passed THEN PERFORM reject_attempt('publication_verification_failed','A passing bound verification record is required','55000'); END IF;
      identity_key:=encode(sha256(convert_to(jsonb_build_array(t.target,t.scope_hash,t.strategy_version)::text,'UTF8')),'hex');
      INSERT INTO publication_identity(identity_id,project_id,target,normalized_scope_hash,strategy_version) VALUES(identity_key,t.project_id,t.target,t.scope_hash,t.strategy_version) ON CONFLICT DO NOTHING;
      PERFORM 1 FROM publication_identity WHERE identity_id=identity_key FOR UPDATE;
      INSERT INTO checkpoint_slot(identity_id,target,normalized_scope_hash,strategy_version,state) SELECT identity_key,t.target,t.scope_hash,t.strategy_version,state FROM unnest(ARRAY['active','staging']) state ORDER BY state ON CONFLICT DO NOTHING;
      SELECT * INTO current_head FROM publication_receipt WHERE identity_id=identity_key AND outcome='published' ORDER BY receipt_no DESC LIMIT 1;
      IF EXISTS(SELECT 1 FROM publication_receipt WHERE identity_id=identity_key AND outcome IN ('published','staged')
          AND watermark=r.watermark AND content_hash<>r.content_hash) THEN
        PERFORM reject_attempt('publication_watermark_conflict','Same watermark has a different previously accepted snapshot digest','55000');
      END IF;
      NEW.outcome:='published'; NEW.reason_code:='advance';
      IF NEW.requested_state='staging' THEN NEW.outcome:='staged'; NEW.reason_code:='explicit_staging';
      ELSIF t.origin_type='rebuild' AND r.watermark<rebuild.target_watermark THEN NEW.outcome:='staged'; NEW.reason_code:='below_rebuild_target';
      ELSIF current_head.receipt_id IS NOT NULL AND r.watermark<current_head.watermark THEN NEW.outcome:='staged'; NEW.reason_code:='lower_active';
      ELSIF current_head.receipt_id IS NOT NULL AND r.watermark=current_head.watermark THEN
        IF r.content_hash<>current_head.content_hash THEN PERFORM reject_attempt('publication_watermark_conflict','Same watermark has a different actual snapshot digest','55000'); END IF;
        NEW.outcome:='idempotent'; NEW.reason_code:='same_content';
      END IF;
      SELECT max(watermark) INTO stage_watermark FROM publication_receipt WHERE identity_id=identity_key AND outcome='staged';
      IF NEW.outcome='staged' AND r.watermark<stage_watermark THEN NEW.outcome:='isolated'; NEW.reason_code:='lower_staging';
      ELSIF NEW.outcome='staged' AND r.watermark=stage_watermark THEN NEW.outcome:='staging_idempotent'; END IF;
      NEW.identity_id:=identity_key; NEW.project_id:=r.project_id; NEW.target:=r.target; NEW.normalized_scope_hash:=r.normalized_scope_hash; NEW.strategy_version:=r.strategy_version;
      NEW.watermark:=r.watermark; NEW.content_hash:=r.content_hash; NEW.verification_id:=validation.verification_id;
      SELECT COALESCE(max(receipt_no),0)+1 INTO NEW.receipt_no FROM publication_receipt WHERE identity_id=identity_key;
      NEW.accepted_at:=clock_timestamp(); RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER publication_receipt_guard BEFORE INSERT ON publication_receipt FOR EACH ROW EXECUTE FUNCTION guard_publication_receipt();
    CREATE FUNCTION apply_publication_governance() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE t projection_task%ROWTYPE;
    BEGIN
      IF NEW.outcome NOT IN ('published','idempotent') THEN RETURN NULL; END IF;
      SELECT task.* INTO STRICT t FROM projection_task task JOIN projection_attempt a USING(task_id) WHERE a.attempt_id=NEW.attempt_id;
      UPDATE projection_task SET status='completed' WHERE task_id=t.task_id AND status='pending';
      IF t.origin_type='rebuild' THEN UPDATE projection_rebuild_record SET status='switched',switched_attempt_id=NEW.attempt_id,switch_reason=NEW.reason WHERE rebuild_record_id=t.rebuild_record_id AND status IN ('running','verified'); END IF; RETURN NULL;
    END;
    $fn$;
    CREATE TRIGGER publication_governance AFTER INSERT ON publication_receipt FOR EACH ROW EXECUTE FUNCTION apply_publication_governance();
    CREATE FUNCTION guard_task_invalidation() RETURNS trigger LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE task_status text;
    BEGIN
      IF NEW.invalidated_at IS NOT NULL THEN PERFORM reject_attempt('publication_governance_time','Invalidation time is database assigned'); END IF;
      SELECT status INTO STRICT task_status FROM projection_task WHERE task_id=NEW.task_id FOR UPDATE;
      IF task_status='pending' THEN UPDATE projection_task SET status=NEW.kind WHERE task_id=NEW.task_id; END IF; NEW.invalidated_at:=clock_timestamp(); RETURN NEW;
    END;
    $fn$;
    CREATE TRIGGER task_invalidation_guard BEFORE INSERT ON projection_task_invalidation FOR EACH ROW EXECUTE FUNCTION guard_task_invalidation();
    CREATE FUNCTION invalidate_task(task_key text,kind text,explanation text) RETURNS projection_task_invalidation LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE invalidation projection_task_invalidation%ROWTYPE;
    BEGIN
      PERFORM 1 FROM projection_task WHERE task_id=task_key FOR UPDATE;
      INSERT INTO projection_task_invalidation(task_id,kind,reason) VALUES(task_key,kind,explanation) ON CONFLICT DO NOTHING RETURNING * INTO invalidation;
      IF NOT FOUND THEN SELECT * INTO STRICT invalidation FROM projection_task_invalidation WHERE task_id=task_key; END IF; RETURN invalidation;
    END;
    $fn$;
    CREATE VIEW projection_checkpoint WITH (security_invoker=true) AS
      WITH active_head AS (SELECT DISTINCT ON(identity_id) * FROM publication_receipt WHERE outcome='published' ORDER BY identity_id,receipt_no DESC),
      stage_head AS (SELECT DISTINCT ON(identity_id) * FROM publication_receipt WHERE outcome='staged' ORDER BY identity_id,receipt_no DESC),
      current_heads AS (SELECT h.*,'active'::text AS state FROM active_head h UNION ALL SELECT h.*,'staging'::text FROM stage_head h WHERE NOT EXISTS (SELECT 1 FROM publication_receipt p WHERE p.attempt_id=h.attempt_id AND p.outcome IN ('published','idempotent')))
      SELECT s.checkpoint_id,h.identity_id,h.project_id,h.target,h.normalized_scope_hash,h.strategy_version,h.watermark AS current_watermark,h.attempt_id AS last_successful_attempt_id,h.result_id,h.receipt_id,h.state
      FROM current_heads h JOIN checkpoint_slot s ON s.identity_id=h.identity_id AND s.state=h.state;
    CREATE VIEW projection_active_pointer WITH (security_invoker=true) AS SELECT * FROM projection_checkpoint WHERE state='active';
    CREATE VIEW projection_publication_history WITH (security_invoker=true) AS SELECT * FROM publication_receipt WHERE outcome='published';
    CREATE VIEW active_projection WITH (security_invoker=true) AS SELECT p.*,r.payload,r.content_hash FROM projection_active_pointer p JOIN projection_result_version r USING(result_id);
    CREATE FUNCTION publication_watermarks(result_key text) RETURNS jsonb LANGUAGE sql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
      SELECT jsonb_build_object('canon_watermark',c.watermark,'active_watermark',p.current_watermark,'pending_watermark',r.watermark,'lag',c.watermark-COALESCE(p.current_watermark,0),'behind_canon',COALESCE(p.current_watermark,0)<c.watermark)
      FROM projection_result_version r CROSS JOIN LATERAL (SELECT max(canon_watermark) AS watermark FROM canon_commit WHERE project_id=r.project_id) c
      LEFT JOIN projection_active_pointer p ON (p.target,p.normalized_scope_hash,p.strategy_version)=(r.target,r.normalized_scope_hash,r.strategy_version) WHERE r.result_id=result_key
    $fn$;
    CREATE FUNCTION publish_result(attempt_key text,result_key text,requested text DEFAULT 'active',explanation text DEFAULT 'fixture snapshot publication') RETURNS jsonb LANGUAGE plpgsql
    SET search_path = pg_catalog, projection_checkpoint_fixture, pg_temp AS $fn$
    DECLARE receipt publication_receipt%ROWTYPE; rule text;
    BEGIN
      BEGIN
        INSERT INTO publication_receipt(attempt_id,result_id,requested_state,reason) VALUES(attempt_key,result_key,requested,explanation) ON CONFLICT(attempt_id,result_id,requested_state,outcome) DO NOTHING RETURNING * INTO receipt;
        IF NOT FOUND THEN SELECT * INTO STRICT receipt FROM publication_receipt WHERE attempt_id=attempt_key AND result_id=result_key AND requested_state=requested ORDER BY receipt_no DESC LIMIT 1; END IF;
      EXCEPTION WHEN SQLSTATE '55000' THEN
        GET STACKED DIAGNOSTICS rule=CONSTRAINT_NAME;
        IF rule NOT LIKE 'publication_%' THEN RAISE; END IF;
        RETURN jsonb_build_object('outcome',substr(rule,13),'constraint',rule)||publication_watermarks(result_key);
      END;
      RETURN jsonb_build_object('outcome',receipt.outcome,'reason',receipt.reason_code,'receipt_id',receipt.receipt_id)||publication_watermarks(result_key);
    END;
    $fn$;
  `);
  for (const table of ['projection_result_version','result_permission_fixture','projection_result_verification','publication_identity','checkpoint_slot','publication_receipt','projection_task_invalidation']) {
    pgm.sql(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON projection_checkpoint_fixture.${table} FOR EACH ROW EXECUTE FUNCTION projection_checkpoint_fixture.immutable_publication_data();
      CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON projection_checkpoint_fixture.${table} FOR EACH STATEMENT EXECUTE FUNCTION projection_checkpoint_fixture.immutable_publication_data();`);
  }
  for (const view of ['projection_checkpoint','projection_active_pointer','projection_publication_history','active_projection']) {
    pgm.sql(`CREATE TRIGGER ${view}_read_only INSTEAD OF INSERT OR UPDATE OR DELETE ON projection_checkpoint_fixture.${view} FOR EACH ROW EXECUTE FUNCTION projection_checkpoint_fixture.deny_publication_view_write();`);
  }
}
export async function down(pgm) {
  pgm.sql(`DO $rollback$ DECLARE obj record; BEGIN
    FOR obj IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='projection_checkpoint_fixture' AND c.relkind='v' LOOP EXECUTE format('DROP VIEW IF EXISTS projection_checkpoint_fixture.%I CASCADE',obj.relname); END LOOP;
    FOR obj IN SELECT tablename FROM pg_tables WHERE schemaname='projection_checkpoint_fixture' AND tablename<>'pgmigrations' LOOP EXECUTE format('DROP TABLE IF EXISTS projection_checkpoint_fixture.%I CASCADE',obj.tablename); END LOOP;
    FOR obj IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='projection_checkpoint_fixture' LOOP EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE',obj.signature); END LOOP;
  END $rollback$;`);
}
