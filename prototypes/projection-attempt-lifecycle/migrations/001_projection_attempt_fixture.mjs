/** 只验证普通 Outbox Task 的 Attempt 历史与数据库接纳；非生产迁移。 */
export const shorthands = undefined;

export async function up(pgm) {
  pgm.sql(`
    CREATE SCHEMA IF NOT EXISTS projection_attempt_fixture;
    SET search_path TO projection_attempt_fixture, pg_catalog;

    CREATE TABLE project (project_id text PRIMARY KEY);
    CREATE TABLE canon_commit (
      canon_commit_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      status text NOT NULL DEFAULT 'committed' CHECK (status = 'committed'),
      canon_watermark bigint NOT NULL CHECK (canon_watermark > 0)
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
      scope_hash text NOT NULL,
      source_canon_watermark bigint NOT NULL,
      strategy_version text NOT NULL REFERENCES projection_policy,
      event_hash text NOT NULL,
      emitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT uq_projection_outbox_identity UNIQUE (canon_commit_id, target, strategy_version)
    );
    CREATE TABLE projection_task (
      task_id text PRIMARY KEY,
      project_id text NOT NULL REFERENCES project,
      origin_type text NOT NULL DEFAULT 'outbox',
      outbox_id text NOT NULL REFERENCES projection_outbox,
      target text NOT NULL,
      scope_hash text NOT NULL,
      strategy_version text NOT NULL REFERENCES projection_policy,
      status text NOT NULL DEFAULT 'pending',
      CONSTRAINT ck_projection_task_origin CHECK (origin_type = 'outbox'),
      CONSTRAINT ck_projection_task_status CHECK (status IN ('pending', 'completed', 'cancelled', 'abandoned', 'needs_rebuild'))
    );
    CREATE UNIQUE INDEX uq_projection_task_active_outbox
      ON projection_task(outbox_id, target, strategy_version) WHERE status IN ('pending', 'needs_rebuild');

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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$
    BEGIN
      RAISE EXCEPTION USING ERRCODE = code, CONSTRAINT = rule, MESSAGE = message;
    END;
    $fn$;

    CREATE FUNCTION protect_projection_inputs() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$
    DECLARE source_row record;
    BEGIN
      IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        PERFORM reject_attempt('projection_input_immutable', 'Fixture source and Task history cannot be removed');
      END IF;
      IF TG_OP = 'UPDATE' THEN
        IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
        IF TG_TABLE_NAME <> 'projection_task'
           OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
          PERFORM reject_attempt('projection_input_immutable', 'Source, target, scope, policy and project bindings are immutable');
        END IF;
        IF OLD.status <> 'pending' THEN
          PERFORM reject_attempt('projection_task_terminal', 'Non-pending Tasks cannot automatically resume');
        END IF;
        RETURN NEW;
      END IF;
      IF TG_TABLE_NAME = 'projection_outbox' THEN
        SELECT * INTO STRICT source_row FROM canon_commit WHERE canon_commit_id = NEW.canon_commit_id;
        IF NEW.project_id IS DISTINCT FROM source_row.project_id
           OR NEW.source_canon_watermark IS DISTINCT FROM source_row.canon_watermark THEN
          PERFORM reject_attempt('projection_source_mapping', 'Outbox must match the committed Canon project and source watermark');
        END IF;
      ELSIF TG_TABLE_NAME = 'projection_task' THEN
        SELECT * INTO STRICT source_row FROM projection_outbox WHERE outbox_id = NEW.outbox_id;
        IF NEW.project_id IS DISTINCT FROM source_row.project_id OR NEW.target IS DISTINCT FROM source_row.target
           OR NEW.scope_hash IS DISTINCT FROM source_row.scope_hash
           OR NEW.strategy_version IS DISTINCT FROM source_row.strategy_version THEN
          PERFORM reject_attempt('projection_source_mapping', 'Task must preserve Outbox project, target, scope and strategy');
        END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$;

    -- The executor holds the UPDATE target row before this trigger runs. This
    -- trigger never requests a Task lock; it only validates this locked Attempt.
    CREATE FUNCTION guard_attempt_update() RETURNS trigger
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE sql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$ SELECT jsonb_build_object('outcome', outcome, 'attempt', to_jsonb(a)) $fn$;

    CREATE FUNCTION lock_attempt(attempt_key text) RETURNS projection_attempt
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
    LANGUAGE sql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$ SELECT transition_attempt(attempt_key, 'succeeded', result_digest, result_location) $fn$;
    CREATE FUNCTION expire_attempt(attempt_key text) RETURNS jsonb
    LANGUAGE sql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$ SELECT transition_attempt(attempt_key, 'expired') $fn$;
    CREATE FUNCTION record_failure(attempt_key text, failure_status text, failure_location text) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
    AS $fn$
    BEGIN
      IF failure_status NOT IN ('retryable_failure', 'permanent_failure') THEN
        PERFORM reject_attempt('projection_attempt_failure_kind', 'Failure status must be retryable_failure or permanent_failure', '22023');
      END IF;
      RETURN transition_attempt(attempt_key, failure_status, NULL, NULL, failure_location);
    END;
    $fn$;

    CREATE FUNCTION retry_attempt(previous_key text, worker text) RETURNS jsonb
    LANGUAGE plpgsql SET search_path = pg_catalog, projection_attempt_fixture, pg_temp
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
  for (const table of ['canon_commit', 'projection_policy', 'projection_outbox', 'projection_task']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_inputs BEFORE INSERT OR UPDATE OR DELETE ON projection_attempt_fixture.${table}
        FOR EACH ROW EXECUTE FUNCTION projection_attempt_fixture.protect_projection_inputs();
      CREATE TRIGGER ${table}_no_truncate BEFORE TRUNCATE ON projection_attempt_fixture.${table}
        FOR EACH STATEMENT EXECUTE FUNCTION projection_attempt_fixture.protect_projection_inputs();
    `);
  }
}

export async function down(pgm) {
  pgm.sql(`
    DROP TABLE projection_attempt_fixture.projection_attempt_audit, projection_attempt_fixture.projection_attempt,
      projection_attempt_fixture.projection_task, projection_attempt_fixture.projection_outbox,
      projection_attempt_fixture.projection_policy, projection_attempt_fixture.canon_commit,
      projection_attempt_fixture.project CASCADE;
    DROP FUNCTION projection_attempt_fixture.reject_attempt(text, text, text), projection_attempt_fixture.protect_projection_inputs(),
      projection_attempt_fixture.guard_attempt_update(), projection_attempt_fixture.guard_attempt_insert(),
      projection_attempt_fixture.audit_attempt_transition(), projection_attempt_fixture.guard_attempt_audit(),
      projection_attempt_fixture.claim_attempt(text, text), projection_attempt_fixture.transition_attempt(text, text, text, text, text),
      projection_attempt_fixture.accept_success(text, text, text), projection_attempt_fixture.expire_attempt(text),
      projection_attempt_fixture.record_failure(text, text, text), projection_attempt_fixture.retry_attempt(text, text) CASCADE;
  `);
}
