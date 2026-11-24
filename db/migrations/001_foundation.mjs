import { randomUUID } from 'node:crypto';

// Formal foundation only. No prototype imports, Candidate, Canon or projection objects.
export async function up(pgm) {
  const sql = statement => pgm.sql(statement);
  const fn = (name, args, returns, body, language = 'plpgsql') => sql(`
    CREATE FUNCTION agent_book.${name}(${args}) RETURNS ${returns}
    LANGUAGE ${language} SECURITY DEFINER
    SET search_path=pg_catalog,agent_book,pg_temp AS $body$ ${body} $body$;
  `);
  sql(`
    CREATE TABLE agent_book.novel (
      novel_id uuid PRIMARY KEY, external_key text NOT NULL UNIQUE CHECK(external_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
      title text NOT NULL CHECK(length(btrim(title))>0 AND length(title)<=300),
      status text NOT NULL DEFAULT 'active' CHECK(status='active'), created_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.volume (
      volume_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel,
      display_order integer NOT NULL CHECK(display_order>0), title text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status='active'),
      UNIQUE(novel_id,volume_id), UNIQUE(novel_id,display_order));
    CREATE TABLE agent_book.chapter (
      chapter_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, volume_id uuid NOT NULL,
      chapter_no integer NOT NULL CHECK(chapter_no>0), title text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status='active'),
      FOREIGN KEY(novel_id,volume_id) REFERENCES agent_book.volume(novel_id,volume_id),
      UNIQUE(novel_id,chapter_id), UNIQUE(volume_id,chapter_no));
    CREATE TABLE agent_book.scene (
      scene_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, chapter_id uuid NOT NULL,
      scene_no integer NOT NULL CHECK(scene_no>0), goal_ref text, status text NOT NULL DEFAULT 'active' CHECK(status='active'),
      FOREIGN KEY(novel_id,chapter_id) REFERENCES agent_book.chapter(novel_id,chapter_id),
      UNIQUE(novel_id,scene_id), UNIQUE(chapter_id,scene_no));
    CREATE TABLE agent_book.entity (
      entity_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel,
      entity_type text NOT NULL CHECK(entity_type IN ('character','location','organization','item','concept')),
      display_name text, lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle='active'), UNIQUE(novel_id,entity_id));
    CREATE TABLE agent_book.actor_principal (
      actor_id uuid PRIMARY KEY, actor_type text NOT NULL CHECK(actor_type IN ('user','agent','service')),
      display_name text NOT NULL, db_login name NOT NULL UNIQUE,
      status text NOT NULL CHECK(status IN ('active','disabled')));
    CREATE TABLE agent_book.execution_role (
      role_id uuid PRIMARY KEY, role_key text NOT NULL, version_no integer NOT NULL CHECK(version_no=1),
      status text NOT NULL CHECK(status='active'), UNIQUE(role_key,version_no));
    CREATE TABLE agent_book.capability (
      capability_id uuid PRIMARY KEY, capability_key text NOT NULL UNIQUE,
      resource_domain text NOT NULL CHECK(resource_domain IN ('novel','authorization','audit')),
      action text NOT NULL CHECK(action IN ('read','administer')));
    CREATE TABLE agent_book.actor_role (
      actor_id uuid PRIMARY KEY REFERENCES agent_book.actor_principal, role_id uuid NOT NULL REFERENCES agent_book.execution_role,
      UNIQUE(actor_id,role_id));
    CREATE TABLE agent_book.role_capability (
      role_id uuid NOT NULL REFERENCES agent_book.execution_role, capability_id uuid NOT NULL REFERENCES agent_book.capability,
      PRIMARY KEY(role_id,capability_id));
    CREATE TABLE agent_book.data_scope (
      data_scope_id uuid PRIMARY KEY, scope_kind text NOT NULL CHECK(scope_kind='novel'),
      novel_id uuid NOT NULL REFERENCES agent_book.novel, format_version text NOT NULL CHECK(format_version='foundation-scope-v1'),
      default_decision text NOT NULL CHECK(default_decision='deny'),
      scope_hash text NOT NULL CHECK(scope_hash ~ '^[0-9a-f]{64}$'));
    CREATE UNIQUE INDEX scope_novel_identity ON agent_book.data_scope(novel_id) WHERE scope_kind='novel';
    CREATE TABLE agent_book.capability_grant (
      grant_id uuid PRIMARY KEY, actor_id uuid NOT NULL, role_id uuid NOT NULL, capability_id uuid NOT NULL,
      data_scope_id uuid NOT NULL REFERENCES agent_book.data_scope, effective_at timestamptz NOT NULL,
      expires_at timestamptz, CHECK(expires_at IS NULL OR expires_at>effective_at),
      FOREIGN KEY(actor_id,role_id) REFERENCES agent_book.actor_role(actor_id,role_id),
      FOREIGN KEY(role_id,capability_id) REFERENCES agent_book.role_capability(role_id,capability_id));
    CREATE TABLE agent_book.novel_creation_authorization (
      authorization_id uuid PRIMARY KEY, actor_id uuid NOT NULL UNIQUE, role_id uuid NOT NULL, capability_id uuid NOT NULL,
      effective_at timestamptz NOT NULL, expires_at timestamptz, CHECK(expires_at IS NULL OR expires_at>effective_at),
      FOREIGN KEY(actor_id,role_id) REFERENCES agent_book.actor_role(actor_id,role_id),
      FOREIGN KEY(role_id,capability_id) REFERENCES agent_book.role_capability(role_id,capability_id));
    CREATE TABLE agent_book.creation_authorization_revocation (
      revocation_id uuid PRIMARY KEY, authorization_id uuid NOT NULL UNIQUE REFERENCES agent_book.novel_creation_authorization,
      revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal, revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.grant_revocation (
      revocation_id uuid PRIMARY KEY, grant_id uuid NOT NULL UNIQUE REFERENCES agent_book.capability_grant,
      revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal,
      revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.authorization_gate (gate_key integer PRIMARY KEY CHECK(gate_key=1));
    INSERT INTO agent_book.authorization_gate VALUES(1);
    CREATE TABLE agent_book.access_audit_record (
      access_audit_id uuid PRIMARY KEY, actor_id uuid REFERENCES agent_book.actor_principal,
      novel_id uuid REFERENCES agent_book.novel, operation text NOT NULL,
      decision text NOT NULL CHECK(decision IN ('allow','deny')),
      resource_type text NOT NULL CHECK(resource_type IN ('none','novel','grant')),
      resource_novel_id uuid REFERENCES agent_book.novel,
      resource_grant_id uuid REFERENCES agent_book.capability_grant,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK((resource_type='none' AND resource_novel_id IS NULL AND resource_grant_id IS NULL)
        OR (resource_type='novel' AND resource_novel_id IS NOT NULL AND resource_grant_id IS NULL)
        OR (resource_type='grant' AND resource_grant_id IS NOT NULL AND resource_novel_id IS NULL)));
    CREATE INDEX audit_novel_time ON agent_book.access_audit_record(novel_id,created_at,access_audit_id);
    CREATE INDEX grant_actor_capability ON agent_book.capability_grant(actor_id,capability_id,data_scope_id);
  `);
  const roles = Object.fromEntries(['author','writer','validator','commit-service','projection-worker','auditor'].map(key => [key, randomUUID()]));
  const capabilities = Object.fromEntries(['novel.create','novel.read','grant.revoke','audit.read'].map(key => [key, randomUUID()]));
  for (const [key, id] of Object.entries(roles)) sql(`INSERT INTO agent_book.execution_role VALUES('${id}','${key}',1,'active');`);
  for (const [key, id] of Object.entries(capabilities)) {
    const domain = key.startsWith('novel.') ? 'novel' : key.startsWith('grant.') ? 'authorization' : 'audit';
    const action = key.endsWith('.read') ? 'read' : 'administer';
    sql(`INSERT INTO agent_book.capability VALUES('${id}','${key}','${domain}','${action}');`);
  }
  for (const [role, keys] of Object.entries({ author: ['novel.create','novel.read','grant.revoke'], writer: ['novel.read'], auditor: ['audit.read'] })) {
    for (const key of keys) sql(`INSERT INTO agent_book.role_capability VALUES('${roles[role]}','${capabilities[key]}');`);
  }
  fn('_caller', '', 'uuid', 'SELECT actor_id FROM actor_principal WHERE db_login=session_user', 'sql');
  fn('_lock_authorization', '', 'void', `BEGIN
    IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'ISOLATION_NOT_SUPPORTED'; END IF;
    PERFORM 1 FROM authorization_gate WHERE gate_key=1 FOR UPDATE;
  END;`);
  fn('_has_capability', 'p_actor uuid,p_capability text,p_novel uuid', 'boolean', `DECLARE decision_time timestamptz; BEGIN
    decision_time:=clock_timestamp();
    IF p_capability='novel.create' THEN
      RETURN p_novel IS NULL AND EXISTS(SELECT 1 FROM actor_principal a JOIN novel_creation_authorization g USING(actor_id)
        JOIN capability c USING(capability_id) JOIN execution_role r USING(role_id)
        WHERE a.actor_id=p_actor AND a.status='active' AND r.status='active' AND c.capability_key='novel.create'
          AND g.effective_at<=decision_time AND (g.expires_at IS NULL OR decision_time<g.expires_at)
          AND NOT EXISTS(SELECT 1 FROM creation_authorization_revocation x WHERE x.authorization_id=g.authorization_id));
    END IF;
    RETURN EXISTS(SELECT 1 FROM actor_principal a JOIN capability_grant g USING(actor_id)
      JOIN capability c USING(capability_id) JOIN execution_role r USING(role_id)
      JOIN data_scope s USING(data_scope_id)
      WHERE a.actor_id=p_actor AND a.status='active' AND r.status='active' AND c.capability_key=p_capability
        AND s.default_decision='deny' AND s.format_version='foundation-scope-v1'
        AND p_capability<>'novel.create' AND s.scope_kind='novel' AND s.novel_id=p_novel
        AND g.effective_at<=decision_time AND (g.expires_at IS NULL OR decision_time<g.expires_at)
        AND NOT EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id));
  END;`);
  fn('_audit', 'p_id uuid,p_operation text,p_novel uuid,p_allowed boolean,p_type text,p_resource uuid', 'void', `BEGIN
    INSERT INTO access_audit_record(access_audit_id,actor_id,novel_id,operation,decision,resource_type,resource_novel_id,resource_grant_id)
      VALUES(p_id,_caller(),p_novel,p_operation,CASE WHEN p_allowed THEN 'allow' ELSE 'deny' END,p_type,
        CASE WHEN p_type='novel' THEN p_resource END,CASE WHEN p_type='grant' THEN p_resource END);
  END;`);
  fn('_denied', 'p_id uuid,p_operation text,p_novel uuid', 'jsonb', `BEGIN
    PERFORM _audit(p_id,p_operation,p_novel,false,'none',NULL);
    RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');
  END;`);
  fn('_immutable', '', 'trigger', `BEGIN
    RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='foundation_immutable',MESSAGE='HISTORY_IMMUTABLE';
  END;`);
  fn('_guard_scope', '', 'trigger', `BEGIN
    PERFORM _lock_authorization();
    NEW.scope_hash:=encode(sha256(convert_to(NEW.scope_kind||':'||NEW.novel_id::text,'UTF8')),'hex'); RETURN NEW;
  END;`);
  fn('_guard_grant', '', 'trigger', `DECLARE kind text; key text; BEGIN
    PERFORM _lock_authorization();
    SELECT scope_kind INTO kind FROM data_scope WHERE data_scope_id=NEW.data_scope_id;
    SELECT capability_key INTO key FROM capability WHERE capability_id=NEW.capability_id;
    IF key='novel.create' OR kind IS DISTINCT FROM 'novel' THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='grant_scope_kind',MESSAGE='GRANT_SCOPE_INVALID';
    END IF;
    IF EXISTS(SELECT 1 FROM capability_grant g LEFT JOIN grant_revocation x USING(grant_id)
      WHERE g.actor_id=NEW.actor_id AND g.capability_id=NEW.capability_id AND g.data_scope_id=NEW.data_scope_id
        AND NEW.effective_at < least(coalesce(g.expires_at,'infinity'::timestamptz),coalesce(x.revoked_at,'infinity'::timestamptz))
        AND g.effective_at<coalesce(NEW.expires_at,'infinity'::timestamptz)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='grant_validity_overlap',MESSAGE='GRANT_PERIOD_OVERLAP';
    END IF; RETURN NEW;
  END;`);
  fn('_guard_revocation', '', 'trigger', `BEGIN
    PERFORM _lock_authorization(); NEW.revoked_at:=clock_timestamp(); RETURN NEW;
  END;`);
  fn('_guard_creation_authorization', '', 'trigger', `BEGIN
    PERFORM _lock_authorization();
    IF (SELECT capability_key FROM capability WHERE capability_id=NEW.capability_id) IS DISTINCT FROM 'novel.create' THEN
      RAISE EXCEPTION USING ERRCODE='23514',CONSTRAINT='creation_capability',MESSAGE='CREATION_CAPABILITY_REQUIRED';
    END IF; RETURN NEW;
  END;`);
  fn('api_identity', 'p_audit uuid', 'jsonb', `DECLARE a actor_principal; role_code text; BEGIN
    PERFORM _lock_authorization(); SELECT * INTO a FROM actor_principal WHERE actor_id=_caller();
    IF a.status IS DISTINCT FROM 'active' THEN RETURN _denied(p_audit,'identity',NULL); END IF;
    SELECT r.role_key INTO role_code FROM actor_role ar JOIN execution_role r USING(role_id) WHERE ar.actor_id=a.actor_id;
    PERFORM _audit(p_audit,'identity',NULL,true,'none',NULL);
    RETURN jsonb_build_object('ok',true,'actor_id',a.actor_id,'role',role_code,'connection_identity',session_user);
  END;`);
  // IDs are opaque application UUIDs; no caller-supplied actor/role/scope policy exists.
  fn('api_create_novel', 'p_novel uuid,p_external text,p_title text,p_ids uuid[],p_audit uuid', 'jsonb', `DECLARE a uuid; r uuid; key text; i integer:=1; BEGIN
    PERFORM _lock_authorization(); a:=_caller();
    IF NOT _has_capability(a,'novel.create',NULL) THEN RETURN _denied(p_audit,'novel.create',NULL); END IF;
    IF coalesce(cardinality(p_ids),0)<>3 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'IDENTITY_SET_INVALID'; END IF;
    SELECT role_id INTO STRICT r FROM actor_role WHERE actor_id=a;
    INSERT INTO novel(novel_id,external_key,title) VALUES(p_novel,p_external,p_title);
    INSERT INTO data_scope(data_scope_id,scope_kind,novel_id,format_version,default_decision)
      VALUES(p_ids[1],'novel',p_novel,'foundation-scope-v1','deny');
    FOREACH key IN ARRAY ARRAY['novel.read','grant.revoke'] LOOP
      i:=i+1;
      INSERT INTO capability_grant(grant_id,actor_id,role_id,capability_id,data_scope_id,effective_at)
        SELECT p_ids[i],a,r,c.capability_id,p_ids[1],clock_timestamp() FROM capability c WHERE capability_key=key;
    END LOOP;
    PERFORM _audit(p_audit,'novel.create',p_novel,true,'novel',p_novel);
    RETURN jsonb_build_object('ok',true,'novel_id',p_novel,'canon_watermark',0,'canon_status','not_implemented');
  END;`);
  fn('api_revoke_creation', 'p_audit uuid', 'jsonb', `DECLARE authority uuid; BEGIN
    PERFORM _lock_authorization();
    IF NOT _has_capability(_caller(),'novel.create',NULL) THEN RETURN _denied(p_audit,'creation.revoke',NULL); END IF;
    SELECT authorization_id INTO STRICT authority FROM novel_creation_authorization WHERE actor_id=_caller();
    INSERT INTO creation_authorization_revocation(revocation_id,authorization_id,revoked_by) VALUES(p_audit,authority,_caller());
    PERFORM _audit(p_audit,'creation.revoke',NULL,true,'none',NULL);
    RETURN jsonb_build_object('ok',true,'status','creation_revoked');
  END;`);
  fn('api_read_novel', 'p_novel uuid,p_audit uuid', 'jsonb', `DECLARE n novel; BEGIN
    PERFORM _lock_authorization();
    SELECT * INTO n FROM novel WHERE novel_id=p_novel;
    IF n.novel_id IS NULL OR NOT _has_capability(_caller(),'novel.read',p_novel) THEN
      RETURN _denied(p_audit,'novel.read',n.novel_id);
    END IF;
    PERFORM _audit(p_audit,'novel.read',p_novel,true,'novel',p_novel);
    RETURN jsonb_build_object('ok',true,'novel',jsonb_build_object('novel_id',n.novel_id,'external_key',n.external_key,'title',n.title),
      'canon_watermark',0,'canon_status','not_implemented');
  END;`);
  fn('api_revoke_grant', 'p_grant uuid,p_audit uuid', 'jsonb', `DECLARE n uuid; BEGIN
    PERFORM _lock_authorization();
    SELECT s.novel_id INTO n FROM capability_grant g JOIN data_scope s USING(data_scope_id)
      WHERE g.grant_id=p_grant AND s.scope_kind='novel';
    IF n IS NULL OR NOT _has_capability(_caller(),'grant.revoke',n) THEN RETURN _denied(p_audit,'grant.revoke',n); END IF;
    INSERT INTO grant_revocation(revocation_id,grant_id,revoked_by) VALUES(p_audit,p_grant,_caller()) ON CONFLICT(grant_id) DO NOTHING;
    PERFORM _audit(p_audit,'grant.revoke',n,true,'grant',p_grant);
    RETURN jsonb_build_object('ok',true,'status','revoked');
  END;`);
  fn('_audit_resource_visible', 'p_record access_audit_record,p_novel uuid', 'boolean', `BEGIN
    IF p_record.resource_type='none' THEN RETURN true;
    ELSIF p_record.resource_type='novel' THEN
      RETURN EXISTS(SELECT 1 FROM novel WHERE novel_id=p_record.resource_novel_id AND novel_id=p_novel);
    ELSIF p_record.resource_type='grant' THEN
      RETURN EXISTS(SELECT 1 FROM capability_grant g JOIN data_scope s USING(data_scope_id)
        WHERE g.grant_id=p_record.resource_grant_id AND s.scope_kind='novel' AND s.novel_id=p_novel);
    END IF; RETURN false;
  END;`);
  fn('api_read_audit', 'p_novel uuid,p_audit uuid', 'jsonb', `DECLARE events jsonb; BEGIN
    PERFORM _lock_authorization();
    IF NOT _has_capability(_caller(),'audit.read',p_novel) THEN
      RETURN _denied(p_audit,'audit.read',(SELECT novel_id FROM novel WHERE novel_id=p_novel));
    END IF;
    PERFORM _audit(p_audit,'audit.read',p_novel,true,'novel',p_novel);
    SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.access_audit_id,'actor_id',a.actor_id,
      'operation',a.operation,'decision',a.decision,'resource_type',a.resource_type,
      'resource_id',coalesce(a.resource_novel_id,a.resource_grant_id),'created_at',a.created_at)
      ORDER BY a.created_at,a.access_audit_id),'[]'::jsonb) INTO events FROM access_audit_record a
      WHERE a.novel_id=p_novel AND _audit_resource_visible(a,p_novel);
    RETURN jsonb_build_object('ok',true,'events',events);
  END;`);
  sql(`CREATE TRIGGER scope_guard BEFORE INSERT ON agent_book.data_scope FOR EACH ROW EXECUTE FUNCTION agent_book._guard_scope();
    CREATE TRIGGER creation_authority_guard BEFORE INSERT ON agent_book.novel_creation_authorization FOR EACH ROW EXECUTE FUNCTION agent_book._guard_creation_authorization();
    CREATE TRIGGER creation_revocation_guard BEFORE INSERT ON agent_book.creation_authorization_revocation FOR EACH ROW EXECUTE FUNCTION agent_book._guard_revocation();
    CREATE TRIGGER grant_guard BEFORE INSERT ON agent_book.capability_grant FOR EACH ROW EXECUTE FUNCTION agent_book._guard_grant();
    CREATE TRIGGER revocation_guard BEFORE INSERT ON agent_book.grant_revocation FOR EACH ROW EXECUTE FUNCTION agent_book._guard_revocation();`);
  for (const table of ['novel','volume','chapter','scene','entity','actor_principal','execution_role','capability','actor_role','role_capability',
    'data_scope','capability_grant','novel_creation_authorization','creation_authorization_revocation','grant_revocation','authorization_gate','access_audit_record']) {
    sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();
      CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  }
  sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
    DO $acl$ DECLARE login record; f text; functions text[]; BEGIN
      FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
        EXECUTE format('GRANT USAGE ON SCHEMA agent_book TO %I',login.db_login);
        functions:=ARRAY['api_identity(uuid)'];
        IF login.role_key='author' THEN functions:=functions||ARRAY['api_revoke_creation(uuid)','api_create_novel(uuid,text,text,uuid[],uuid)','api_read_novel(uuid,uuid)','api_revoke_grant(uuid,uuid)'];
        ELSIF login.role_key='writer' THEN functions:=functions||ARRAY['api_read_novel(uuid,uuid)'];
        ELSIF login.role_key='auditor' THEN functions:=functions||ARRAY['api_read_audit(uuid,uuid)']; END IF;
        FOREACH f IN ARRAY functions LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.%s TO %I',f,login.db_login); END LOOP;
      END LOOP;
    END $acl$;`);
}

export async function down() {
  throw new Error('Foundation rollback requires an explicit forward migration; no destructive automatic down');
}
