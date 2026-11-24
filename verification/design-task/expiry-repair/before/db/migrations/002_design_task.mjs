import { randomUUID } from 'node:crypto';

const capabilityKeys = ['structure.manage','design.read','design.edit','design.freeze','task.read','task.create','task.append'];
export async function up(pgm) {
  // Read only the trusted first-batch creation evidence, under the existing stable gate.
  await pgm.db.query('SELECT agent_book._lock_authorization()');
  const existing = (await pgm.db.query(`SELECT n.novel_id, a.actor_id,
    count(a.access_audit_id) OVER(PARTITION BY n.novel_id)::int AS records
    FROM agent_book.novel n LEFT JOIN agent_book.access_audit_record a ON a.novel_id=n.novel_id
      AND a.operation='novel.create' AND a.decision='allow' AND a.resource_type='novel' AND a.resource_novel_id=n.novel_id`)).rows;
  for (const row of existing) {
    const trusted = row.actor_id && row.records === 1 && (await pgm.db.query(`SELECT EXISTS(
      SELECT 1 FROM agent_book.actor_role ar JOIN agent_book.execution_role r USING(role_id)
      WHERE ar.actor_id=$1 AND r.role_key='author') AS valid`,[row.actor_id])).rows[0].valid;
    if (!trusted) { const error = new Error('AUTHOR_CREATION_PROVENANCE_REQUIRED'); error.code='AUTHOR_CREATION_PROVENANCE_REQUIRED'; throw error; }
  }
  const sql = statement => pgm.sql(statement);
  const fn = (name,args,returns,body,language='plpgsql') => sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${returns}
    LANGUAGE ${language} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $body$ ${body} $body$;`);
  for (const key of capabilityKeys) sql(`INSERT INTO agent_book.capability VALUES('${randomUUID()}','${key}','novel','${key.endsWith('.read')?'read':'administer'}');
    INSERT INTO agent_book.role_capability SELECT r.role_id,c.capability_id FROM agent_book.execution_role r CROSS JOIN agent_book.capability c WHERE r.role_key='author' AND c.capability_key='${key}';`);
  sql(`ALTER TABLE agent_book.entity ADD UNIQUE(novel_id,entity_id,entity_type);
    CREATE TABLE agent_book.design_authority_upgrade (
      novel_id uuid PRIMARY KEY REFERENCES agent_book.novel, creator_id uuid NOT NULL REFERENCES agent_book.actor_principal,
      disposition text NOT NULL CHECK(disposition IN ('seeded','withheld_revoked_or_expired')), recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.design_draft (
      draft_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, base_revision_id uuid,
      edit_version integer NOT NULL CHECK(edit_version>0), content jsonb NOT NULL,
      created_by uuid NOT NULL REFERENCES agent_book.actor_principal, UNIQUE(novel_id,draft_id));
    CREATE TABLE agent_book.author_design_revision (
      revision_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, revision_no integer NOT NULL CHECK(revision_no>0),
      draft_id uuid NOT NULL UNIQUE, base_revision_id uuid, request_key text NOT NULL,
      digest_spec_version text NOT NULL CHECK(digest_spec_version='ab-jsonb-v1'), content jsonb NOT NULL,
      canonical_text text NOT NULL, content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
      frozen_by uuid NOT NULL REFERENCES agent_book.actor_principal, frozen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(novel_id,revision_id), UNIQUE(novel_id,revision_no), UNIQUE(novel_id,request_key),
      FOREIGN KEY(novel_id,draft_id) REFERENCES agent_book.design_draft(novel_id,draft_id),
      FOREIGN KEY(novel_id,base_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id));
    ALTER TABLE agent_book.design_draft ADD FOREIGN KEY(novel_id,base_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id);
    CREATE TABLE agent_book.design_object_identity (
      design_object_identity_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, design_key text NOT NULL,
      object_type text NOT NULL CHECK(object_type='character'), entity_id uuid NOT NULL,
      UNIQUE(novel_id,design_key), UNIQUE(novel_id,design_object_identity_id,object_type,entity_id),
      FOREIGN KEY(novel_id,entity_id,object_type) REFERENCES agent_book.entity(novel_id,entity_id,entity_type));
    CREATE TABLE agent_book.design_object_version (
      design_object_version_id uuid PRIMARY KEY, novel_id uuid NOT NULL, revision_id uuid NOT NULL,
      design_object_identity_id uuid NOT NULL, object_type text NOT NULL CHECK(object_type='character'), entity_id uuid NOT NULL,
      name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 300), core_attributes jsonb NOT NULL,
      UNIQUE(design_object_identity_id,revision_id), UNIQUE(novel_id,revision_id,design_object_identity_id,entity_id),
      FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,design_object_identity_id,object_type,entity_id) REFERENCES agent_book.design_object_identity(novel_id,design_object_identity_id,object_type,entity_id));
    CREATE TABLE agent_book.design_to_entity_binding (
      binding_id uuid PRIMARY KEY, novel_id uuid NOT NULL, author_design_revision_id uuid NOT NULL,
      design_object_identity_id uuid NOT NULL, entity_id uuid NOT NULL, binding_role text NOT NULL CHECK(binding_role='character'),
      UNIQUE(author_design_revision_id,design_object_identity_id),
      FOREIGN KEY(novel_id,author_design_revision_id,design_object_identity_id,entity_id)
        REFERENCES agent_book.design_object_version(novel_id,revision_id,design_object_identity_id,entity_id));
    CREATE TABLE agent_book.design_constraint (
      constraint_id uuid PRIMARY KEY, novel_id uuid NOT NULL, revision_id uuid NOT NULL,
      constraint_type text NOT NULL CHECK(constraint_type='author_rule_v1'), rule_key text NOT NULL,
      severity text NOT NULL CHECK(severity IN ('hard','soft')), rule_text text NOT NULL CHECK(length(btrim(rule_text)) BETWEEN 1 AND 4000),
      scope_kind text NOT NULL CHECK(scope_kind IN ('novel','scene','character')), scene_id uuid, character_entity_id uuid,
      entity_type text NOT NULL DEFAULT 'character' CHECK(entity_type='character'),
      CHECK((scope_kind='novel' AND scene_id IS NULL AND character_entity_id IS NULL)
        OR(scope_kind='scene' AND scene_id IS NOT NULL AND character_entity_id IS NULL)
        OR(scope_kind='character' AND scene_id IS NULL AND character_entity_id IS NOT NULL)),
      UNIQUE(novel_id,revision_id,constraint_id), UNIQUE(revision_id,rule_key),
      FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,scene_id) REFERENCES agent_book.scene(novel_id,scene_id),
      FOREIGN KEY(novel_id,character_entity_id,entity_type) REFERENCES agent_book.entity(novel_id,entity_id,entity_type));
    CREATE TABLE agent_book.design_activation (
      activation_id uuid PRIMARY KEY, novel_id uuid NOT NULL, activation_no integer NOT NULL CHECK(activation_no>0),
      revision_id uuid NOT NULL UNIQUE, previous_revision_id uuid, activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(novel_id,activation_no,revision_id),
      FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,previous_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id));
    CREATE TABLE agent_book.design_head (
      novel_id uuid PRIMARY KEY REFERENCES agent_book.novel, activation_no integer NOT NULL, current_revision_id uuid NOT NULL,
      FOREIGN KEY(novel_id,activation_no,current_revision_id) REFERENCES agent_book.design_activation(novel_id,activation_no,revision_id));
    CREATE TABLE agent_book.scene_task (
      scene_task_id uuid PRIMARY KEY, novel_id uuid NOT NULL, scene_id uuid NOT NULL, request_key text NOT NULL,
      current_version_id uuid NOT NULL, UNIQUE(novel_id,scene_id,scene_task_id), UNIQUE(scene_id,request_key),
      FOREIGN KEY(novel_id,scene_id) REFERENCES agent_book.scene(novel_id,scene_id));
    CREATE TABLE agent_book.scene_task_version (
      scene_task_version_id uuid PRIMARY KEY, scene_task_id uuid NOT NULL, novel_id uuid NOT NULL, scene_id uuid NOT NULL,
      version_no integer NOT NULL CHECK(version_no>0), previous_version_id uuid,
      author_design_revision_id uuid NOT NULL, input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),
      viewpoint_entity_id uuid NOT NULL, viewpoint_type text NOT NULL CHECK(viewpoint_type='character'),
      goal text NOT NULL CHECK(length(btrim(goal)) BETWEEN 1 AND 4000),
      max_input_tokens integer NOT NULL CHECK(max_input_tokens BETWEEN 1 AND 1000000),
      max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 1000000),
      reader_format text NOT NULL CHECK(reader_format='task-reader-v1'), reader_mode text NOT NULL CHECK(reader_mode='no_disclosure_claim'),
      compile_format text NOT NULL CHECK(compile_format='scene-task-v1'), timeline text NOT NULL CHECK(timeline='linear'),
      dependencies text NOT NULL CHECK(dependencies='committed_only'),
      digest_spec_version text NOT NULL CHECK(digest_spec_version='ab-jsonb-v1'), canonical_text text NOT NULL,
      version_hash text NOT NULL CHECK(version_hash~'^[0-9a-f]{64}$'),
      UNIQUE(scene_task_id,version_no), UNIQUE(novel_id,scene_task_id,scene_task_version_id),
      UNIQUE(novel_id,author_design_revision_id,scene_task_version_id),
      CHECK((version_no=1 AND previous_version_id IS NULL) OR(version_no>1 AND previous_version_id IS NOT NULL)),
      FOREIGN KEY(novel_id,scene_id,scene_task_id) REFERENCES agent_book.scene_task(novel_id,scene_id,scene_task_id),
      FOREIGN KEY(novel_id,scene_task_id,previous_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_id,scene_task_version_id),
      FOREIGN KEY(novel_id,author_design_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,viewpoint_entity_id,viewpoint_type) REFERENCES agent_book.entity(novel_id,entity_id,entity_type));
    ALTER TABLE agent_book.scene_task ADD FOREIGN KEY(novel_id,scene_task_id,current_version_id)
      REFERENCES agent_book.scene_task_version(novel_id,scene_task_id,scene_task_version_id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE agent_book.task_constraint_ref (
      novel_id uuid NOT NULL, revision_id uuid NOT NULL, scene_task_version_id uuid NOT NULL, constraint_id uuid NOT NULL,
      PRIMARY KEY(scene_task_version_id,constraint_id),
      FOREIGN KEY(novel_id,revision_id,scene_task_version_id) REFERENCES agent_book.scene_task_version(novel_id,author_design_revision_id,scene_task_version_id),
      FOREIGN KEY(novel_id,revision_id,constraint_id) REFERENCES agent_book.design_constraint(novel_id,revision_id,constraint_id));
    CREATE TABLE agent_book.design_task_request (
      request_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel, actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,
      operation text NOT NULL, request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),
      digest_spec_version text NOT NULL CHECK(digest_spec_version='ab-jsonb-v1'), canonical_text text NOT NULL,
      request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'), result jsonb NOT NULL,
      UNIQUE(novel_id,actor_id,operation,request_key));
  `);
  fn('_design_digest','kind text,payload jsonb','text',`SELECT encode(sha256(convert_to('ab-jsonb-v1:'||kind||E'\\n'||payload::text,'UTF8')),'hex')`,'sql');
  fn('_exact_keys','value jsonb,keys text[]','boolean',`SELECT coalesce(jsonb_typeof(value)='object' AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(value) k) IS NOT DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(keys) k),false)`,'sql');
  fn('_normalize_design','payload jsonb','jsonb',`DECLARE x jsonb; BEGIN
    IF NOT _exact_keys(payload,ARRAY['characters','constraints']) OR jsonb_typeof(payload->'characters')<>'array' OR jsonb_typeof(payload->'constraints')<>'array'
      OR jsonb_array_length(payload->'characters')>16 OR jsonb_array_length(payload->'constraints')>16 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    FOR x IN SELECT * FROM jsonb_array_elements(payload->'characters') LOOP
      IF EXISTS(SELECT 1 FROM jsonb_each(x) e WHERE e.value='null'::jsonb) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF NOT _exact_keys(x,ARRAY['design_key','entity_id','name','description']) OR (x->>'design_key') !~ '^[a-z][a-z0-9_-]{0,63}$'
        OR jsonb_typeof(x->'name')<>'string' OR length(btrim(x->>'name')) NOT BETWEEN 1 AND 300
        OR NOT _exact_keys(x->'description',ARRAY['summary','motivation','traits'])
        OR jsonb_typeof(x->'description'->'summary')<>'string' OR length(btrim(x->'description'->>'summary')) NOT BETWEEN 1 AND 4000
        OR jsonb_typeof(x->'description'->'motivation')<>'string' OR length(btrim(x->'description'->>'motivation')) NOT BETWEEN 1 AND 4000
        OR jsonb_typeof(x->'description'->'traits')<>'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(x->'description'->'traits') v WHERE jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 200)
        OR jsonb_array_length(x->'description'->'traits')>20 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    END LOOP;
    FOR x IN SELECT * FROM jsonb_array_elements(payload->'constraints') LOOP
      IF EXISTS(SELECT 1 FROM jsonb_each(x) e WHERE e.key<>'scope_id' AND e.value='null'::jsonb) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF NOT _exact_keys(x,ARRAY['rule_key','severity','scope_kind','scope_id','rule_text']) OR (x->>'rule_key') !~ '^[a-z][a-z0-9_-]{0,63}$'
        OR x->>'severity' NOT IN ('hard','soft') OR x->>'scope_kind' NOT IN ('novel','scene','character')
        OR jsonb_typeof(x->'rule_text')<>'string' OR length(btrim(x->>'rule_text')) NOT BETWEEN 1 AND 4000
        OR ((x->>'scope_kind'='novel') IS DISTINCT FROM (x->'scope_id'='null'::jsonb)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    END LOOP;
    IF (SELECT count(*)<>count(DISTINCT v->>'design_key') FROM jsonb_array_elements(payload->'characters') v)
      OR (SELECT count(*)<>count(DISTINCT v->>'rule_key') FROM jsonb_array_elements(payload->'constraints') v)
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    RETURN jsonb_build_object('characters',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'design_key'),'[]') FROM jsonb_array_elements(payload->'characters') v),
      'constraints',(SELECT coalesce(jsonb_agg(v ORDER BY v->>'rule_key'),'[]') FROM jsonb_array_elements(payload->'constraints') v));
  END;`);
  fn('_check_design_references','p_novel uuid,payload jsonb','void',`DECLARE x jsonb; BEGIN
    FOR x IN SELECT * FROM jsonb_array_elements(payload->'characters') LOOP
      IF NOT EXISTS(SELECT 1 FROM entity WHERE novel_id=p_novel AND entity_id=(x->>'entity_id')::uuid AND entity_type='character')
        OR EXISTS(SELECT 1 FROM design_object_identity WHERE novel_id=p_novel AND design_key=x->>'design_key' AND entity_id<>(x->>'entity_id')::uuid)
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
    END LOOP;
    FOR x IN SELECT * FROM jsonb_array_elements(payload->'constraints') LOOP
      IF x->>'scope_kind'='scene' AND NOT EXISTS(SELECT 1 FROM scene WHERE novel_id=p_novel AND scene_id=(x->>'scope_id')::uuid)
        OR x->>'scope_kind'='character' AND NOT EXISTS(SELECT 1 FROM entity WHERE novel_id=p_novel AND entity_id=(x->>'scope_id')::uuid AND entity_type='character')
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
    END LOOP;
  END;`);
  fn('_draft_guard','','trigger',`BEGIN
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DRAFT_HISTORY_REQUIRED'; END IF;
    IF (to_jsonb(NEW)-ARRAY['content','edit_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['content','edit_version'])
      OR NEW.edit_version<>OLD.edit_version+1 OR EXISTS(SELECT 1 FROM author_design_revision WHERE draft_id=OLD.draft_id)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DRAFT_FROZEN_OR_IDENTITY_CHANGED'; END IF;
    NEW.content:=_normalize_design(NEW.content); PERFORM _check_design_references(NEW.novel_id,NEW.content); RETURN NEW;
  END;`);
  fn('_design_head_guard','','trigger',`BEGIN
    IF TG_OP='DELETE' OR TG_OP='TRUNCATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HEAD_IMMUTABLE_IDENTITY'; END IF;
    IF TG_OP='UPDATE' AND (NEW.novel_id<>OLD.novel_id OR NEW.activation_no<>OLD.activation_no+1
      OR NOT EXISTS(SELECT 1 FROM design_activation WHERE novel_id=NEW.novel_id AND activation_no=NEW.activation_no AND revision_id=NEW.current_revision_id AND previous_revision_id=OLD.current_revision_id))
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HEAD_PREDECESSOR_REQUIRED'; END IF;
    IF TG_OP='INSERT' AND NEW.activation_no<>1 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HEAD_PREDECESSOR_REQUIRED'; END IF;
    RETURN NEW;
  END;`);
  fn('_task_head_guard','','trigger',`BEGIN
    IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TASK_IDENTITY_IMMUTABLE'; END IF;
    IF (to_jsonb(NEW)-'current_version_id') IS DISTINCT FROM (to_jsonb(OLD)-'current_version_id')
      OR NOT EXISTS(SELECT 1 FROM scene_task_version n JOIN scene_task_version o ON o.scene_task_version_id=OLD.current_version_id
        WHERE n.scene_task_version_id=NEW.current_version_id AND n.scene_task_id=OLD.scene_task_id AND n.previous_version_id=OLD.current_version_id AND n.version_no=o.version_no+1)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TASK_PREDECESSOR_REQUIRED'; END IF; RETURN NEW;
  END;`);
  fn('_revision_payload','p_revision uuid','jsonb',`SELECT jsonb_build_object('characters',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('design_key',i.design_key,'entity_id',v.entity_id,'name',v.name,'description',v.core_attributes) ORDER BY i.design_key),'[]')
      FROM design_object_version v JOIN design_object_identity i USING(design_object_identity_id) WHERE v.revision_id=p_revision),
    'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('rule_key',rule_key,'severity',severity,'scope_kind',scope_kind,
      'scope_id',coalesce(scene_id,character_entity_id),'rule_text',rule_text) ORDER BY rule_key),'[]') FROM design_constraint WHERE revision_id=p_revision))`,'sql');
  fn('_revision_complete','','trigger',`DECLARE rid uuid; r author_design_revision; BEGIN
    rid:=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='design_to_entity_binding' THEN 'author_design_revision_id' ELSE 'revision_id' END)::uuid;
    SELECT * INTO STRICT r FROM author_design_revision WHERE revision_id=rid;
    IF r.content<>_revision_payload(rid) OR r.canonical_text<>r.content::text OR r.content_hash<>_design_digest('frozen',r.content)
      OR (SELECT count(*) FROM design_to_entity_binding WHERE author_design_revision_id=rid)<>(SELECT count(*) FROM design_object_version WHERE revision_id=rid)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='REVISION_CONTENT_INCOMPLETE'; END IF; RETURN NULL;
  END;`);
  fn('_task_payload','p_version uuid','jsonb',`SELECT jsonb_build_object('scene_id',scene_id,'revision_id',author_design_revision_id,'viewpoint_entity_id',viewpoint_entity_id,
    'input_canon_watermark',input_canon_watermark,'goal',goal,'constraint_ids',(SELECT coalesce(jsonb_agg(constraint_id ORDER BY constraint_id),'[]') FROM task_constraint_ref WHERE scene_task_version_id=p_version),
    'budget',jsonb_build_object('max_input_tokens',max_input_tokens,'max_output_tokens',max_output_tokens),
    'reader_scope',jsonb_build_object('format_version',reader_format,'mode',reader_mode),
    'compile',jsonb_build_object('format_version',compile_format,'timeline',timeline,'dependencies',dependencies)) FROM scene_task_version WHERE scene_task_version_id=p_version`,'sql');
  fn('_task_complete','','trigger',`DECLARE v scene_task_version; BEGIN
    SELECT * INTO STRICT v FROM scene_task_version WHERE scene_task_version_id=NEW.scene_task_version_id;
    IF (v.version_no>1 AND NOT EXISTS(SELECT 1 FROM scene_task_version p WHERE p.scene_task_version_id=v.previous_version_id AND p.scene_task_id=v.scene_task_id AND p.version_no=v.version_no-1))
      OR NOT EXISTS(SELECT 1 FROM scene_task t JOIN scene_task_version h ON h.scene_task_version_id=t.current_version_id
        WHERE t.scene_task_id=v.scene_task_id AND h.version_no=(SELECT max(version_no) FROM scene_task_version WHERE scene_task_id=v.scene_task_id))
      OR v.canonical_text<>_task_payload(v.scene_task_version_id)::text OR v.version_hash<>_design_digest('task',_task_payload(v.scene_task_version_id))
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='TASK_CONTENT_INCOMPLETE'; END IF; RETURN NULL;
  END;`);
  fn('_structure_write','op text,n uuid,p jsonb,ids uuid[]','jsonb',`BEGIN
    IF op='volume:create' AND _exact_keys(p,ARRAY['request_key','position','title']) THEN
      INSERT INTO volume VALUES(ids[1],n,(p->>'position')::integer,p->>'title','active');
    ELSIF op='chapter:create' AND _exact_keys(p,ARRAY['request_key','volume_id','position','title']) THEN
      INSERT INTO chapter VALUES(ids[1],n,(p->>'volume_id')::uuid,(p->>'position')::integer,p->>'title','active');
    ELSIF op='scene:create' AND _exact_keys(p,ARRAY['request_key','chapter_id','position','goal']) THEN
      INSERT INTO scene VALUES(ids[1],n,(p->>'chapter_id')::uuid,(p->>'position')::integer,p->>'goal','active');
    ELSIF op='entity:create' AND _exact_keys(p,ARRAY['request_key','entity_type','name']) AND p->>'entity_type' IN ('character','location','organization','item','concept') THEN
      INSERT INTO entity VALUES(ids[1],n,p->>'entity_type',p->>'name','active');
    ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    IF op IN ('volume:create','chapter:create') AND length(btrim(p->>'title')) NOT BETWEEN 1 AND 300
      OR op='scene:create' AND length(btrim(p->>'goal')) NOT BETWEEN 1 AND 4000
      OR op='entity:create' AND length(btrim(p->>'name')) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    RETURN jsonb_build_object('ok',true,'id',ids[1]);
  END;`);
  fn('_draft_write','op text,n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE d design_draft; payload jsonb; BEGIN
    IF op='design:draft' AND _exact_keys(p,ARRAY['request_key','base_revision_id']) THEN
      IF p->>'base_revision_id' IS NULL THEN payload:='{"characters":[],"constraints":[]}';
      ELSE SELECT content INTO payload FROM author_design_revision WHERE novel_id=n AND revision_id=(p->>'base_revision_id')::uuid;
        IF payload IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
      END IF;
      INSERT INTO design_draft VALUES(ids[1],n,(p->>'base_revision_id')::uuid,1,payload,_caller());
      RETURN jsonb_build_object('ok',true,'draft_id',ids[1],'edit_version',1);
    ELSIF op='design:edit' AND _exact_keys(p,ARRAY['request_key','draft_id','expected_edit_version','content']) THEN
      SELECT * INTO d FROM design_draft WHERE novel_id=n AND draft_id=(p->>'draft_id')::uuid FOR UPDATE;
      IF d.draft_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
      IF d.edit_version<>(p->>'expected_edit_version')::integer OR EXISTS(SELECT 1 FROM author_design_revision WHERE draft_id=d.draft_id)
        THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT'); END IF;
      payload:=_normalize_design(p->'content'); PERFORM _check_design_references(n,payload);
      UPDATE design_draft SET content=payload,edit_version=edit_version+1 WHERE draft_id=d.draft_id;
      RETURN jsonb_build_object('ok',true,'draft_id',d.draft_id,'edit_version',d.edit_version+1);
    END IF; RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';
  END;`);
  fn('_freeze_design','n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE d design_draft; head design_head; x jsonb; i integer:=0; identity_id uuid; BEGIN
    IF NOT _exact_keys(p,ARRAY['request_key','draft_id','expected_edit_version','expected_current_revision_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    SELECT * INTO head FROM design_head WHERE novel_id=n FOR UPDATE;
    SELECT * INTO d FROM design_draft WHERE novel_id=n AND draft_id=(p->>'draft_id')::uuid FOR UPDATE;
    IF d.draft_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
    IF d.edit_version<>(p->>'expected_edit_version')::integer OR head.current_revision_id IS DISTINCT FROM (p->>'expected_current_revision_id')::uuid
      OR EXISTS(SELECT 1 FROM author_design_revision WHERE draft_id=d.draft_id) THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT'); END IF;
    d.content:=_normalize_design(d.content); PERFORM _check_design_references(n,d.content);
    IF jsonb_array_length(d.content->'characters')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='EMPTY_DESIGN'; END IF;
    INSERT INTO author_design_revision VALUES(ids[2],n,coalesce(head.activation_no,0)+1,d.draft_id,d.base_revision_id,p->>'request_key',
      'ab-jsonb-v1',d.content,d.content::text,_design_digest('frozen',d.content),_caller(),clock_timestamp());
    FOR x IN SELECT * FROM jsonb_array_elements(d.content->'characters') LOOP
      i:=i+1; SELECT design_object_identity_id INTO identity_id FROM design_object_identity WHERE novel_id=n AND design_key=x->>'design_key';
      IF identity_id IS NULL THEN identity_id:=ids[10+i];
        INSERT INTO design_object_identity VALUES(identity_id,n,x->>'design_key','character',(x->>'entity_id')::uuid); END IF;
      INSERT INTO design_object_version VALUES(ids[30+i],n,ids[2],identity_id,'character',(x->>'entity_id')::uuid,x->>'name',x->'description');
      INSERT INTO design_to_entity_binding VALUES(ids[50+i],n,ids[2],identity_id,(x->>'entity_id')::uuid,'character');
    END LOOP; i:=0;
    FOR x IN SELECT * FROM jsonb_array_elements(d.content->'constraints') LOOP
      i:=i+1; INSERT INTO design_constraint(constraint_id,novel_id,revision_id,constraint_type,rule_key,severity,rule_text,scope_kind,scene_id,character_entity_id)
        VALUES(ids[70+i],n,ids[2],'author_rule_v1',x->>'rule_key',x->>'severity',x->>'rule_text',x->>'scope_kind',
        CASE WHEN x->>'scope_kind'='scene' THEN (x->>'scope_id')::uuid END,CASE WHEN x->>'scope_kind'='character' THEN (x->>'scope_id')::uuid END);
    END LOOP;
    INSERT INTO design_activation VALUES(ids[3],n,coalesce(head.activation_no,0)+1,ids[2],head.current_revision_id,clock_timestamp());
    IF head.current_revision_id IS NULL THEN INSERT INTO design_head VALUES(n,1,ids[2]);
    ELSE UPDATE design_head SET activation_no=head.activation_no+1,current_revision_id=ids[2] WHERE novel_id=n; END IF;
    RETURN jsonb_build_object('ok',true,'revision_id',ids[2],'revision_no',coalesce(head.activation_no,0)+1,'content_hash',_design_digest('frozen',d.content),'digest_spec_version','ab-jsonb-v1');
  END;`);
  fn('_normalize_task','p jsonb','jsonb',`DECLARE payload jsonb:=p-ARRAY['request_key','task_id','expected_version_id']; BEGIN
    IF NOT _exact_keys(payload,ARRAY['scene_id','revision_id','viewpoint_entity_id','input_canon_watermark','goal','constraint_ids','budget','reader_scope','compile'])
      OR NOT _exact_keys(payload->'budget',ARRAY['max_input_tokens','max_output_tokens'])
      OR payload->'reader_scope'<>'{"format_version":"task-reader-v1","mode":"no_disclosure_claim"}'::jsonb
      OR payload->'compile'<>'{"format_version":"scene-task-v1","timeline":"linear","dependencies":"committed_only"}'::jsonb
      OR jsonb_typeof(payload->'constraint_ids')<>'array' OR jsonb_array_length(payload->'constraint_ids')>16
      OR jsonb_typeof(payload->'budget'->'max_input_tokens') IS DISTINCT FROM 'number' OR jsonb_typeof(payload->'budget'->'max_output_tokens') IS DISTINCT FROM 'number'
      OR payload->'input_canon_watermark'<>'0'::jsonb OR jsonb_typeof(payload->'goal')<>'string'
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='UNSUPPORTED_TASK_PARAMETERS'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'constraint_ids') x WHERE jsonb_typeof(x)<>'string')
      OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(payload->'constraint_ids') x)
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    RETURN jsonb_set(payload,'{constraint_ids}',(SELECT coalesce(jsonb_agg(x ORDER BY (x#>>'{}')::uuid),'[]') FROM jsonb_array_elements(payload->'constraint_ids') x));
  END;`);
  fn('_write_task','op text,n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE payload jsonb; t scene_task; v scene_task_version; task_id uuid; number integer; x jsonb; BEGIN
    payload:=_normalize_task(p);
    IF op='task:create' AND p ?| ARRAY['task_id','expected_version_id'] OR op='task:append' AND NOT p ?& ARRAY['task_id','expected_version_id'] THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    IF NOT EXISTS(SELECT 1 FROM design_head WHERE novel_id=n AND current_revision_id=(payload->>'revision_id')::uuid)
      THEN RETURN jsonb_build_object('ok',false,'error','DESIGN_NOT_CURRENT'); END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'constraint_ids') AS hit(value) JOIN design_constraint c ON c.constraint_id=(hit.value#>>'{}')::uuid
      WHERE c.novel_id=n AND c.revision_id=(payload->>'revision_id')::uuid AND ((c.scope_kind='scene' AND c.scene_id<>(payload->>'scene_id')::uuid) OR(c.scope_kind='character' AND c.character_entity_id<>(payload->>'viewpoint_entity_id')::uuid)))
      THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='CONSTRAINT_SCOPE_MISMATCH'; END IF;
    IF op='task:create' THEN task_id:=ids[3]; number:=1;
      INSERT INTO scene_task VALUES(task_id,n,(payload->>'scene_id')::uuid,p->>'request_key',ids[4]);
    ELSE
      SELECT * INTO t FROM scene_task WHERE novel_id=n AND scene_task_id=(p->>'task_id')::uuid FOR UPDATE;
      IF t.scene_task_id IS NULL OR t.scene_id<>(payload->>'scene_id')::uuid THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REFERENCE'; END IF;
      IF t.current_version_id IS DISTINCT FROM (p->>'expected_version_id')::uuid THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT'); END IF;
      SELECT * INTO STRICT v FROM scene_task_version WHERE scene_task_version_id=t.current_version_id;
      task_id:=t.scene_task_id; number:=v.version_no+1;
    END IF;
    INSERT INTO scene_task_version VALUES(ids[4],task_id,n,(payload->>'scene_id')::uuid,number,v.scene_task_version_id,
      (payload->>'revision_id')::uuid,0,(payload->>'viewpoint_entity_id')::uuid,'character',payload->>'goal',
      (payload->'budget'->>'max_input_tokens')::integer,(payload->'budget'->>'max_output_tokens')::integer,
      'task-reader-v1','no_disclosure_claim','scene-task-v1','linear','committed_only','ab-jsonb-v1',payload::text,_design_digest('task',payload));
    FOR x IN SELECT * FROM jsonb_array_elements(payload->'constraint_ids') LOOP
      INSERT INTO task_constraint_ref VALUES(n,(payload->>'revision_id')::uuid,ids[4],(x#>>'{}')::uuid);
    END LOOP;
    IF op='task:append' THEN UPDATE scene_task SET current_version_id=ids[4] WHERE scene_task_id=task_id; END IF;
    RETURN jsonb_build_object('ok',true,'task_id',task_id,'version_id',ids[4],'version_no',number,'version_hash',_design_digest('task',payload),'digest_spec_version','ab-jsonb-v1');
  END;`);
  fn('_design_task_history','op text,n uuid','jsonb',`BEGIN
    IF op='design:history' THEN RETURN jsonb_build_object('ok',true,'current_revision_id',(SELECT current_revision_id FROM design_head WHERE novel_id=n),
      'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.draft_id),'[]') FROM design_draft d WHERE novel_id=n),
      'revisions',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY revision_no),'[]') FROM author_design_revision r WHERE novel_id=n),
      'objects',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.revision_id,v.design_object_identity_id),'[]') FROM design_object_version v WHERE novel_id=n),
      'bindings',(SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.binding_id),'[]') FROM design_to_entity_binding b WHERE novel_id=n),
      'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.revision_id,c.rule_key),'[]') FROM design_constraint c WHERE novel_id=n),
      'activations',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.activation_no),'[]') FROM design_activation a WHERE novel_id=n));
    ELSIF op='task:history' THEN RETURN jsonb_build_object('ok',true,
      'tasks',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.scene_task_id),'[]') FROM scene_task t WHERE novel_id=n),
      'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.scene_task_id,v.version_no),'[]') FROM scene_task_version v WHERE novel_id=n),
      'constraint_refs',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.scene_task_version_id,c.constraint_id),'[]') FROM task_constraint_ref c WHERE novel_id=n));
    ELSIF op='structure:read' THEN RETURN jsonb_build_object('ok',true,
      'volumes',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY display_order),'[]') FROM volume v WHERE novel_id=n),
      'chapters',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY chapter_no),'[]') FROM chapter v WHERE novel_id=n),
      'scenes',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY scene_no),'[]') FROM scene v WHERE novel_id=n),
      'entities',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY entity_id),'[]') FROM entity v WHERE novel_id=n));
    END IF; RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';
  END;`);
  fn('api_design_task','p_operation text,p_novel uuid,p_request jsonb,p_ids uuid[],p_audit uuid','jsonb',`DECLARE cap text; read_cap text; prior design_task_request; result jsonb; request_payload jsonb; request_hash text; BEGIN
    PERFORM _lock_authorization();
    cap:=CASE WHEN p_operation IN ('volume:create','chapter:create','scene:create','entity:create','structure:read') THEN 'structure.manage'
      WHEN p_operation IN ('design:draft','design:edit') THEN 'design.edit' WHEN p_operation='design:freeze' THEN 'design.freeze'
      WHEN p_operation='design:history' THEN 'design.read' WHEN p_operation='task:create' THEN 'task.create'
      WHEN p_operation='task:append' THEN 'task.append' WHEN p_operation='task:history' THEN 'task.read' END;
    read_cap:=CASE WHEN p_operation LIKE 'design:%' THEN 'design.read' WHEN p_operation LIKE 'task:%' THEN 'task.read' ELSE 'structure.manage' END;
    IF cap IS NULL THEN RETURN jsonb_build_object('ok',false,'error','UNSUPPORTED_OPERATION'); END IF;
    IF NOT _has_capability(_caller(),cap,p_novel) OR NOT _has_capability(_caller(),read_cap,p_novel) THEN
      RETURN _denied(p_audit,cap,(SELECT novel_id FROM novel WHERE novel_id=p_novel)); END IF;
    PERFORM 1 FROM novel WHERE novel_id=p_novel FOR UPDATE;
    BEGIN
      IF p_operation IN ('structure:read','design:history','task:history') THEN
        IF p_request<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        result:=_design_task_history(p_operation,p_novel);
      ELSE
        IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>200000 OR jsonb_typeof(p_request->'request_key') IS DISTINCT FROM 'string'
          OR length(p_request->>'request_key') NOT BETWEEN 1 AND 100 OR cardinality(p_ids)<>128 OR array_position(p_ids,NULL) IS NOT NULL
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_each(p_request) e WHERE e.value='null'::jsonb AND e.key NOT IN ('base_revision_id','expected_current_revision_id')) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        IF EXISTS(SELECT 1 FROM jsonb_each(p_request) e WHERE e.key IN ('position','expected_edit_version') AND (jsonb_typeof(e.value)<>'number' OR (e.value#>>'{}') !~ '^[0-9]+$'))
          OR EXISTS(SELECT 1 FROM jsonb_each(p_request) e WHERE e.key IN ('title','name','goal','entity_type') AND jsonb_typeof(e.value)<>'string')
          THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        request_payload:=p_request;
        IF p_operation='design:edit' THEN request_payload:=jsonb_set(request_payload,'{content}',_normalize_design(p_request->'content')); END IF;
        IF p_operation IN ('task:create','task:append') THEN request_payload:=request_payload||_normalize_task(p_request); END IF;
        request_hash:=_design_digest('request',jsonb_build_object('operation',p_operation,'novel_id',p_novel,'request',request_payload));
        SELECT * INTO prior FROM design_task_request WHERE novel_id=p_novel AND actor_id=_caller() AND operation=p_operation AND request_key=p_request->>'request_key';
        IF prior.request_id IS NOT NULL THEN
          IF prior.request_hash<>request_hash THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT'); ELSE result:=prior.result; END IF;
        ELSE
          IF p_operation IN ('volume:create','chapter:create','scene:create','entity:create') THEN result:=_structure_write(p_operation,p_novel,request_payload,p_ids);
          ELSIF p_operation IN ('design:draft','design:edit') THEN result:=_draft_write(p_operation,p_novel,request_payload,p_ids);
          ELSIF p_operation='design:freeze' THEN result:=_freeze_design(p_novel,request_payload,p_ids);
          ELSE result:=_write_task(p_operation,p_novel,request_payload,p_ids); END IF;
          IF (result->>'ok')::boolean THEN
            INSERT INTO design_task_request VALUES(p_ids[128],p_novel,_caller(),p_operation,p_request->>'request_key','ab-jsonb-v1',
              jsonb_build_object('operation',p_operation,'novel_id',p_novel,'request',request_payload)::text,request_hash,result);
          END IF;
        END IF;
      END IF;
    EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range THEN
      result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');
    END;
    PERFORM _audit(p_audit,p_operation,p_novel,(result->>'ok')::boolean,'novel',p_novel); RETURN result;
  END;`);
  // Preserve the public creation signature, but require the enlarged application UUID set.
  fn('api_create_novel','p_novel uuid,p_external text,p_title text,p_ids uuid[],p_audit uuid','jsonb',`DECLARE a uuid; r uuid; key text; i integer:=1; BEGIN
    PERFORM _lock_authorization(); a:=_caller();
    IF NOT _has_capability(a,'novel.create',NULL) THEN RETURN _denied(p_audit,'novel.create',NULL); END IF;
    IF coalesce(cardinality(p_ids),0)<>10 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'IDENTITY_SET_INVALID'; END IF;
    SELECT role_id INTO STRICT r FROM actor_role WHERE actor_id=a;
    INSERT INTO novel(novel_id,external_key,title) VALUES(p_novel,p_external,p_title);
    INSERT INTO data_scope(data_scope_id,scope_kind,novel_id,format_version,default_decision) VALUES(p_ids[1],'novel',p_novel,'foundation-scope-v1','deny');
    FOREACH key IN ARRAY ARRAY['novel.read','grant.revoke','structure.manage','design.read','design.edit','design.freeze','task.read','task.create','task.append'] LOOP
      i:=i+1; INSERT INTO capability_grant(grant_id,actor_id,role_id,capability_id,data_scope_id,effective_at)
        SELECT p_ids[i],a,r,c.capability_id,p_ids[1],clock_timestamp() FROM capability c WHERE capability_key=key;
    END LOOP;
    PERFORM _audit(p_audit,'novel.create',p_novel,true,'novel',p_novel);
    RETURN jsonb_build_object('ok',true,'novel_id',p_novel,'canon_watermark',0,'canon_status','not_implemented');
  END;`);
  // Backfill never restores revoked/expired foundational ownership grants. Creation-startup revocation is intentionally independent.
  for (const row of existing) {
    const eligible = (await pgm.db.query(`SELECT agent_book._has_capability($1,'novel.read',$2) AND agent_book._has_capability($1,'grant.revoke',$2) AS eligible`,[row.actor_id,row.novel_id])).rows[0].eligible;
    sql(`INSERT INTO agent_book.design_authority_upgrade VALUES('${row.novel_id}','${row.actor_id}','${eligible?'seeded':'withheld_revoked_or_expired'}',clock_timestamp());`);
    if (eligible) for (const key of capabilityKeys) sql(`INSERT INTO agent_book.capability_grant
      SELECT '${randomUUID()}',ar.actor_id,ar.role_id,c.capability_id,s.data_scope_id,clock_timestamp(),
        (SELECT min(g.expires_at) FROM agent_book.capability_grant g JOIN agent_book.capability ca USING(capability_id)
          WHERE g.actor_id=ar.actor_id AND g.data_scope_id=s.data_scope_id AND ca.capability_key IN ('novel.read','grant.revoke') AND g.effective_at<=clock_timestamp()
          AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp()) AND NOT EXISTS(SELECT 1 FROM agent_book.grant_revocation x WHERE x.grant_id=g.grant_id))
      FROM agent_book.actor_role ar CROSS JOIN agent_book.capability c CROSS JOIN agent_book.data_scope s
      WHERE ar.actor_id='${row.actor_id}' AND c.capability_key='${key}' AND s.novel_id='${row.novel_id}';`);
  }
  for (const table of ['design_authority_upgrade','author_design_revision','design_object_identity','design_object_version','design_to_entity_binding',
    'design_constraint','design_activation','scene_task_version','task_constraint_ref','design_task_request']) sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();
      CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  sql(`CREATE TRIGGER draft_guard BEFORE UPDATE OR DELETE ON agent_book.design_draft FOR EACH ROW EXECUTE FUNCTION agent_book._draft_guard();
    CREATE TRIGGER draft_truncate BEFORE TRUNCATE ON agent_book.design_draft FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();
    CREATE TRIGGER head_guard BEFORE INSERT OR UPDATE OR DELETE ON agent_book.design_head FOR EACH ROW EXECUTE FUNCTION agent_book._design_head_guard();
    CREATE TRIGGER head_truncate BEFORE TRUNCATE ON agent_book.design_head FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();
    CREATE TRIGGER task_guard BEFORE UPDATE OR DELETE ON agent_book.scene_task FOR EACH ROW EXECUTE FUNCTION agent_book._task_head_guard();
    CREATE TRIGGER task_truncate BEFORE TRUNCATE ON agent_book.scene_task FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  for (const table of ['author_design_revision','design_object_version','design_constraint','design_to_entity_binding']) sql(`CREATE CONSTRAINT TRIGGER revision_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._revision_complete();`);
  for (const table of ['scene_task_version','task_constraint_ref']) sql(`CREATE CONSTRAINT TRIGGER task_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._task_complete();`);
  sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
    DO $acl$ DECLARE login record; BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry WHERE role_key='author' LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_design_task(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);
    END LOOP; END $acl$;`);
}
export async function down() { throw new Error('Design/task rollback requires an explicit forward migration'); }
