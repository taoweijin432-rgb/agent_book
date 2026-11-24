// Finite author-approved guidance only; no Canon, knowledge/disclosure reconstruction or model calls.
export async function up(pgm) {
  const sql=text=>pgm.sql(text);
  const fn=(name,args,result,body,language='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${result}
    LANGUAGE ${language} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $body$ ${body} $body$;`);
  sql(`ALTER TABLE agent_book.design_object_version ADD UNIQUE(novel_id,revision_id,design_object_version_id);
    ALTER TABLE agent_book.scene_task_version ADD UNIQUE(novel_id,scene_task_version_id);
    ALTER TABLE agent_book.scene_task_version ADD UNIQUE(novel_id,scene_id,scene_task_version_id,author_design_revision_id,viewpoint_entity_id);
    CREATE TABLE agent_book.evidence_reference (
      evidence_reference_id uuid PRIMARY KEY, novel_id uuid NOT NULL REFERENCES agent_book.novel,
      source_domain text NOT NULL CHECK(source_domain='author_design'), source_version_id uuid NOT NULL,
      source_object_type text NOT NULL CHECK(source_object_type IN ('author_design_revision','design_object_version','design_constraint')),
      source_object_id uuid NOT NULL, locator text NOT NULL CHECK(locator='whole:v1'), evidence_kind text NOT NULL CHECK(evidence_kind='author_intent'),
      UNIQUE(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind),
      UNIQUE(evidence_reference_id,novel_id,source_version_id,source_object_type,source_object_id),
      FOREIGN KEY(novel_id,source_version_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id));
    CREATE TABLE agent_book.evidence_design_source (
      evidence_reference_id uuid PRIMARY KEY, novel_id uuid NOT NULL, author_design_revision_id uuid NOT NULL,
      source_object_type text NOT NULL, source_object_id uuid NOT NULL,
      source_author_design_revision_id uuid, source_design_object_version_id uuid, source_design_constraint_id uuid,
      CHECK((source_object_type='author_design_revision' AND source_author_design_revision_id=source_object_id AND source_author_design_revision_id=author_design_revision_id AND source_author_design_revision_id IS NOT NULL AND source_design_object_version_id IS NULL AND source_design_constraint_id IS NULL)
        OR(source_object_type='design_object_version' AND source_design_object_version_id=source_object_id AND source_design_object_version_id IS NOT NULL AND source_author_design_revision_id IS NULL AND source_design_constraint_id IS NULL)
        OR(source_object_type='design_constraint' AND source_design_constraint_id=source_object_id AND source_design_constraint_id IS NOT NULL AND source_author_design_revision_id IS NULL AND source_design_object_version_id IS NULL)),
      FOREIGN KEY(evidence_reference_id,novel_id,author_design_revision_id,source_object_type,source_object_id)
        REFERENCES agent_book.evidence_reference(evidence_reference_id,novel_id,source_version_id,source_object_type,source_object_id),
      FOREIGN KEY(novel_id,source_author_design_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,author_design_revision_id,source_design_object_version_id) REFERENCES agent_book.design_object_version(novel_id,revision_id,design_object_version_id),
      FOREIGN KEY(novel_id,author_design_revision_id,source_design_constraint_id) REFERENCES agent_book.design_constraint(novel_id,revision_id,constraint_id));
    ALTER TABLE agent_book.evidence_reference ADD FOREIGN KEY(evidence_reference_id) REFERENCES agent_book.evidence_design_source DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE agent_book.context_task_scope (
      context_scope_id uuid PRIMARY KEY, novel_id uuid NOT NULL, scene_id uuid NOT NULL, task_version_id uuid NOT NULL,
      revision_id uuid NOT NULL, viewpoint_entity_id uuid NOT NULL, writer_actor_id uuid NOT NULL, writer_role_id uuid NOT NULL,
      format_version text NOT NULL CHECK(format_version='context-task-scope-v1'),
      allow_revision boolean NOT NULL,allow_object boolean NOT NULL,allow_constraint boolean NOT NULL,
      CHECK(allow_revision OR allow_object OR allow_constraint),
      FOREIGN KEY(novel_id,scene_id,task_version_id,revision_id,viewpoint_entity_id)
        REFERENCES agent_book.scene_task_version(novel_id,scene_id,scene_task_version_id,author_design_revision_id,viewpoint_entity_id),
      FOREIGN KEY(writer_actor_id,writer_role_id) REFERENCES agent_book.actor_role(actor_id,role_id));
    CREATE TABLE agent_book.context_grant (
      context_grant_id uuid PRIMARY KEY,context_scope_id uuid NOT NULL REFERENCES agent_book.context_task_scope,
      capability_set text NOT NULL CHECK(capability_set='compile_and_read_v1'),issued_by uuid NOT NULL REFERENCES agent_book.actor_principal,
      effective_at timestamptz NOT NULL,expires_at timestamptz,CHECK(expires_at IS NULL OR expires_at>effective_at));
    CREATE TABLE agent_book.context_grant_revocation (
      revocation_id uuid PRIMARY KEY,context_grant_id uuid NOT NULL UNIQUE REFERENCES agent_book.context_grant,
      revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.context_policy_release (
      policy_release_id uuid PRIMARY KEY,novel_id uuid NOT NULL,task_version_id uuid NOT NULL,version_no integer NOT NULL CHECK(version_no IN (1,2)),
      policy_version text NOT NULL,CHECK(policy_version='safe-context-v'||version_no),previous_release_id uuid,
      published_by uuid NOT NULL REFERENCES agent_book.actor_principal,
      CHECK((version_no=1 AND previous_release_id IS NULL) OR(version_no=2 AND previous_release_id IS NOT NULL)),
      UNIQUE(task_version_id,version_no),UNIQUE(novel_id,task_version_id,policy_release_id),
      FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),
      FOREIGN KEY(novel_id,task_version_id,previous_release_id) REFERENCES agent_book.context_policy_release(novel_id,task_version_id,policy_release_id));
    CREATE TABLE agent_book.safe_projection_proposal (
      proposal_id uuid PRIMARY KEY,novel_id uuid NOT NULL,scene_id uuid NOT NULL,task_version_id uuid NOT NULL,revision_id uuid NOT NULL,
      viewpoint_entity_id uuid NOT NULL,writer_actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,
      kind text NOT NULL CHECK(kind IN ('goal','character','constraint')),
      source_object_type text NOT NULL,source_object_id uuid NOT NULL,
      source_revision_id uuid,source_object_version_id uuid,source_constraint_id uuid,
      CHECK((kind='goal' AND source_object_type='author_design_revision' AND source_revision_id=revision_id AND source_object_id=revision_id AND source_revision_id IS NOT NULL AND source_object_version_id IS NULL AND source_constraint_id IS NULL)
        OR(kind='character' AND source_object_type='design_object_version' AND source_object_version_id=source_object_id AND source_object_version_id IS NOT NULL AND source_revision_id IS NULL AND source_constraint_id IS NULL)
        OR(kind='constraint' AND source_object_type='design_constraint' AND source_constraint_id=source_object_id AND source_constraint_id IS NOT NULL AND source_revision_id IS NULL AND source_object_version_id IS NULL)),
      semantics text NOT NULL CHECK(semantics='author_intent_only'),format_version text NOT NULL CHECK(format_version='safe-projection-v1'),
      policy_release_id uuid NOT NULL,safe_text text NOT NULL CHECK(length(btrim(safe_text)) BETWEEN 1 AND 12000),
      replaces_publication_id uuid,created_by uuid NOT NULL REFERENCES agent_book.actor_principal,
      content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
      FOREIGN KEY(novel_id,scene_id,task_version_id,revision_id,viewpoint_entity_id) REFERENCES agent_book.scene_task_version(novel_id,scene_id,scene_task_version_id,author_design_revision_id,viewpoint_entity_id),
      FOREIGN KEY(novel_id,task_version_id,policy_release_id) REFERENCES agent_book.context_policy_release(novel_id,task_version_id,policy_release_id),
      FOREIGN KEY(novel_id,source_revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,revision_id,source_object_version_id) REFERENCES agent_book.design_object_version(novel_id,revision_id,design_object_version_id),
      FOREIGN KEY(novel_id,revision_id,source_constraint_id) REFERENCES agent_book.design_constraint(novel_id,revision_id,constraint_id));
    CREATE TABLE agent_book.safe_projection_publication (
      publication_id uuid PRIMARY KEY,proposal_id uuid NOT NULL UNIQUE REFERENCES agent_book.safe_projection_proposal,
      evidence_reference_id uuid NOT NULL REFERENCES agent_book.evidence_reference,
      approved_by uuid NOT NULL REFERENCES agent_book.actor_principal,approved_hash text NOT NULL,published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(publication_id,evidence_reference_id));
    ALTER TABLE agent_book.safe_projection_proposal ADD FOREIGN KEY(replaces_publication_id) REFERENCES agent_book.safe_projection_publication;
    CREATE TABLE agent_book.safe_projection_supersession (
      old_publication_id uuid PRIMARY KEY REFERENCES agent_book.safe_projection_publication,
      new_publication_id uuid NOT NULL UNIQUE REFERENCES agent_book.safe_projection_publication);
    CREATE TABLE agent_book.safe_projection_revocation (
      revocation_id uuid PRIMARY KEY,publication_id uuid NOT NULL UNIQUE REFERENCES agent_book.safe_projection_publication,
      revoked_by uuid NOT NULL REFERENCES agent_book.actor_principal,revoked_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE agent_book.context_bundle (
      context_bundle_id uuid PRIMARY KEY,public_bundle_ref uuid NOT NULL UNIQUE CHECK(public_bundle_ref<>context_bundle_id),novel_id uuid NOT NULL,
      task_version_id uuid NOT NULL,revision_id uuid NOT NULL,writer_actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,
      context_grant_id uuid NOT NULL REFERENCES agent_book.context_grant,policy_release_id uuid NOT NULL,
      compiler_version text NOT NULL CHECK(compiler_version='safe-compiler-v1'),digest_spec_version text NOT NULL CHECK(digest_spec_version='ctx-jsonb-v1'),
      budget_version text NOT NULL CHECK(budget_version='utf8-byte-v1'),input_canon_watermark bigint NOT NULL CHECK(input_canon_watermark=0),
      payload_text text NOT NULL,payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),
      limit_bytes integer NOT NULL CHECK(limit_bytes BETWEEN 128 AND 65536),used_bytes integer NOT NULL CHECK(used_bytes<=limit_bytes),
      declared_input_tokens integer NOT NULL,declared_output_tokens integer NOT NULL,
      expected_items integer NOT NULL CHECK(expected_items>0),publication_ids uuid[] NOT NULL,
      compiled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(context_bundle_id,novel_id,task_version_id,writer_actor_id),
      FOREIGN KEY(novel_id,task_version_id,policy_release_id) REFERENCES agent_book.context_policy_release(novel_id,task_version_id,policy_release_id),
      FOREIGN KEY(novel_id,revision_id) REFERENCES agent_book.author_design_revision(novel_id,revision_id),
      FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id));
    CREATE TABLE agent_book.context_item (
      context_item_id uuid PRIMARY KEY,context_bundle_id uuid NOT NULL REFERENCES agent_book.context_bundle,
      position integer NOT NULL CHECK(position>0),kind text NOT NULL CHECK(kind IN ('goal','character','constraint')),
      publication_id uuid NOT NULL REFERENCES agent_book.safe_projection_publication,
      selection_reason text NOT NULL CHECK(selection_reason='required_approved_guidance_v1'),
      UNIQUE(context_bundle_id,position),UNIQUE(context_bundle_id,publication_id),UNIQUE(context_item_id,publication_id));
    CREATE TABLE agent_book.context_item_source (
      context_item_id uuid PRIMARY KEY,publication_id uuid NOT NULL,evidence_reference_id uuid NOT NULL,
      FOREIGN KEY(context_item_id,publication_id) REFERENCES agent_book.context_item(context_item_id,publication_id),
      FOREIGN KEY(publication_id,evidence_reference_id) REFERENCES agent_book.safe_projection_publication(publication_id,evidence_reference_id));
    ALTER TABLE agent_book.context_item ADD FOREIGN KEY(context_item_id) REFERENCES agent_book.context_item_source DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE agent_book.context_compilation (
      compilation_id uuid PRIMARY KEY,context_bundle_id uuid NOT NULL UNIQUE REFERENCES agent_book.context_bundle,
      compiled_by uuid NOT NULL REFERENCES agent_book.actor_principal,request_key text NOT NULL,
      UNIQUE(compiled_by,request_key,context_bundle_id));
    ALTER TABLE agent_book.context_bundle ADD UNIQUE(context_bundle_id,writer_actor_id);
    ALTER TABLE agent_book.context_compilation ADD FOREIGN KEY(context_bundle_id,compiled_by) REFERENCES agent_book.context_bundle(context_bundle_id,writer_actor_id);
    ALTER TABLE agent_book.context_bundle ADD FOREIGN KEY(context_bundle_id) REFERENCES agent_book.context_compilation(context_bundle_id) DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE agent_book.context_command_request (
      request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,
      operation text NOT NULL,request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,result jsonb NOT NULL,
      UNIQUE(actor_id,novel_id,operation,request_key));
    CREATE TABLE agent_book.context_access_audit (
      audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,
      task_version_id uuid,operation text NOT NULL,decision text NOT NULL CHECK(decision IN ('allow','deny')),
      resource_type text NOT NULL CHECK(resource_type IN ('none','grant','projection','bundle','evidence','policy')),
      resource_grant_id uuid REFERENCES agent_book.context_grant,resource_publication_id uuid REFERENCES agent_book.safe_projection_publication,
      resource_bundle_id uuid REFERENCES agent_book.context_bundle,resource_evidence_id uuid REFERENCES agent_book.evidence_reference,
      resource_policy_id uuid REFERENCES agent_book.context_policy_release,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(novel_id,task_version_id) REFERENCES agent_book.scene_task_version(novel_id,scene_task_version_id),
      CHECK((resource_type='none' AND num_nonnulls(resource_grant_id,resource_publication_id,resource_bundle_id,resource_evidence_id,resource_policy_id)=0)
        OR(resource_type<>'none' AND num_nonnulls(resource_grant_id,resource_publication_id,resource_bundle_id,resource_evidence_id,resource_policy_id)=1
          AND CASE resource_type WHEN 'grant' THEN resource_grant_id IS NOT NULL WHEN 'projection' THEN resource_publication_id IS NOT NULL
            WHEN 'bundle' THEN resource_bundle_id IS NOT NULL WHEN 'evidence' THEN resource_evidence_id IS NOT NULL WHEN 'policy' THEN resource_policy_id IS NOT NULL ELSE false END)));
  `);
  fn('_ctx_hash','kind text,payload jsonb','text',`SELECT encode(sha256(convert_to('ctx-jsonb-v1:'||kind||E'\\n'||payload::text,'UTF8')),'hex')`,'sql');
  fn('_ctx_manage','actor uuid,n uuid','boolean',`SELECT _has_capability(actor,'design.read',n) AND _has_capability(actor,'design.freeze',n) AND _has_capability(actor,'task.read',n) AND _has_capability(actor,'task.create',n)`,'sql');
  fn('_ctx_trace_allowed','actor uuid,n uuid','boolean',`SELECT (_has_capability(actor,'design.read',n) AND _has_capability(actor,'task.read',n)) OR _has_capability(actor,'audit.read',n)`,'sql');
  fn('_ctx_task_current','n uuid,t uuid','boolean',`SELECT EXISTS(SELECT 1 FROM scene_task_version v JOIN scene_task s USING(scene_task_id)
    JOIN design_head h ON h.novel_id=v.novel_id WHERE v.novel_id=n AND v.scene_task_version_id=t AND s.current_version_id=t AND h.current_revision_id=v.author_design_revision_id AND v.input_canon_watermark=0)`,'sql');
  fn('_ctx_policy','t uuid','uuid',`SELECT policy_release_id FROM context_policy_release WHERE task_version_id=t ORDER BY version_no DESC LIMIT 1`,'sql');
  fn('_ctx_grant_live','g_id uuid,actor uuid,n uuid,t uuid','boolean',`DECLARE at_time timestamptz:=clock_timestamp(); BEGIN
    RETURN EXISTS(SELECT 1 FROM context_grant g JOIN context_task_scope s USING(context_scope_id)
      JOIN actor_principal a ON a.actor_id=s.writer_actor_id JOIN execution_role r ON r.role_id=s.writer_role_id
      WHERE g.context_grant_id=g_id AND a.actor_id=actor AND a.status='active' AND r.role_key='writer' AND r.status='active'
        AND s.novel_id=n AND s.task_version_id=t AND s.format_version='context-task-scope-v1' AND g.capability_set='compile_and_read_v1'
        AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at)
        AND NOT EXISTS(SELECT 1 FROM context_grant_revocation x WHERE x.context_grant_id=g_id));
  END;`);
  fn('_ctx_publication_live','pub uuid','boolean',`SELECT EXISTS(SELECT 1 FROM safe_projection_publication WHERE publication_id=pub)
    AND NOT EXISTS(SELECT 1 FROM safe_projection_revocation WHERE publication_id=pub)
    AND NOT EXISTS(SELECT 1 FROM safe_projection_supersession WHERE old_publication_id=pub)`,'sql');
  // This is a structural source selection: no raw goal, name, attributes, rule text or titles are selected.
  fn('_ctx_required','t uuid','TABLE(kind text,source_type text,source_id uuid,priority integer)',`SELECT 'constraint','design_constraint',c.constraint_id,1 FROM scene_task_version v JOIN design_constraint c ON c.novel_id=v.novel_id AND c.revision_id=v.author_design_revision_id
      WHERE v.scene_task_version_id=t AND ((c.severity='hard' AND(c.scope_kind='novel' OR c.scene_id=v.scene_id OR c.character_entity_id=v.viewpoint_entity_id))
        OR EXISTS(SELECT 1 FROM task_constraint_ref r WHERE r.scene_task_version_id=t AND r.constraint_id=c.constraint_id))
    UNION ALL SELECT 'goal','author_design_revision',author_design_revision_id,2 FROM scene_task_version WHERE scene_task_version_id=t
    UNION ALL SELECT 'character','design_object_version',o.design_object_version_id,3 FROM scene_task_version v JOIN design_object_version o ON o.novel_id=v.novel_id AND o.revision_id=v.author_design_revision_id AND o.entity_id=v.viewpoint_entity_id WHERE v.scene_task_version_id=t`,'sql');
  fn('_ctx_selected','scope_id uuid,policy uuid','TABLE(publication_id uuid,evidence_id uuid,kind text,safe_text text,priority integer,source_id uuid)',`SELECT p.publication_id,p.evidence_reference_id,q.kind,q.safe_text,r.priority,r.source_id
    FROM context_task_scope s CROSS JOIN LATERAL _ctx_required(s.task_version_id) r
      JOIN safe_projection_proposal q ON q.task_version_id=s.task_version_id AND q.writer_actor_id=s.writer_actor_id AND q.kind=r.kind AND q.source_object_type=r.source_type AND q.source_object_id=r.source_id
      JOIN safe_projection_publication p ON p.proposal_id=q.proposal_id
    WHERE s.context_scope_id=scope_id AND q.policy_release_id=policy AND _ctx_publication_live(p.publication_id)
      AND CASE r.source_type WHEN 'author_design_revision' THEN s.allow_revision WHEN 'design_object_version' THEN s.allow_object WHEN 'design_constraint' THEN s.allow_constraint ELSE false END`,'sql');
  fn('_ctx_render','pubs uuid[]','text',`SELECT jsonb_build_object('format_version','safe-context-payload-v1','semantics','author_intent_only',
    'items',coalesce(jsonb_agg(jsonb_build_object('kind',q.kind,'text',q.safe_text) ORDER BY u.position),'[]'))::text
    FROM unnest(pubs) WITH ORDINALITY u(pub,position) JOIN safe_projection_publication p ON p.publication_id=u.pub JOIN safe_projection_proposal q USING(proposal_id)`,'sql');
  fn('_ctx_evidence','n uuid,rev uuid,typ text,obj uuid,id uuid','uuid',`DECLARE existing uuid; BEGIN
    SELECT evidence_reference_id INTO existing FROM evidence_reference WHERE source_domain='author_design' AND source_version_id=rev AND source_object_type=typ AND source_object_id=obj AND locator='whole:v1' AND evidence_kind='author_intent';
    IF existing IS NOT NULL THEN RETURN existing; END IF;
    INSERT INTO evidence_reference VALUES(id,n,'author_design',rev,typ,obj,'whole:v1','author_intent');
    INSERT INTO evidence_design_source VALUES(id,n,rev,typ,obj,CASE WHEN typ='author_design_revision' THEN obj END,CASE WHEN typ='design_object_version' THEN obj END,CASE WHEN typ='design_constraint' THEN obj END);RETURN id;
  END;`);
  fn('_ctx_scope_guard','','trigger',`BEGIN
    PERFORM _lock_authorization();
    IF NOT EXISTS(SELECT 1 FROM execution_role WHERE role_id=NEW.writer_role_id AND role_key='writer') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='WRITER_SCOPE_REQUIRED'; END IF;RETURN NEW;
  END;`);
  fn('_ctx_grant_guard','','trigger',`BEGIN
    PERFORM _lock_authorization();
    IF EXISTS(SELECT 1 FROM capability_grant WHERE grant_id=NEW.context_grant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GRANT_ID_AMBIGUOUS'; END IF;RETURN NEW;
  END;`);
  fn('_ctx_base_grant_guard','','trigger',`BEGIN
    PERFORM _lock_authorization();IF EXISTS(SELECT 1 FROM context_grant WHERE context_grant_id=NEW.grant_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='GRANT_ID_AMBIGUOUS'; END IF;RETURN NEW;
  END;`);
  fn('_ctx_proposal_guard','','trigger',`BEGIN
    PERFORM _lock_authorization();
    IF NOT EXISTS(SELECT 1 FROM actor_role ar JOIN execution_role r USING(role_id) WHERE ar.actor_id=NEW.writer_actor_id AND r.role_key='writer')
      OR NOT EXISTS(SELECT 1 FROM _ctx_required(NEW.task_version_id) r WHERE r.kind=NEW.kind AND r.source_type=NEW.source_object_type AND r.source_id=NEW.source_object_id)
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PROJECTION_SOURCE_SCOPE_INVALID'; END IF;
    IF NEW.replaces_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM safe_projection_publication pub JOIN safe_projection_proposal q USING(proposal_id) WHERE pub.publication_id=NEW.replaces_publication_id AND q.novel_id=NEW.novel_id AND q.task_version_id=NEW.task_version_id AND q.writer_actor_id=NEW.writer_actor_id AND q.kind=NEW.kind AND q.source_object_type=NEW.source_object_type AND q.source_object_id=NEW.source_object_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PUBLICATION_PREDECESSOR_SCOPE'; END IF;
    NEW.content_hash:=_ctx_hash('projection',to_jsonb(NEW)-ARRAY['content_hash','proposal_id','created_by']); RETURN NEW;
  END;`);
  fn('_ctx_publication_guard','','trigger',`DECLARE q safe_projection_proposal; e evidence_reference; prior uuid; BEGIN
    PERFORM _lock_authorization();SELECT * INTO STRICT q FROM safe_projection_proposal WHERE proposal_id=NEW.proposal_id;
    SELECT * INTO STRICT e FROM evidence_reference WHERE evidence_reference_id=NEW.evidence_reference_id;
    SELECT p.publication_id INTO prior FROM safe_projection_publication p JOIN safe_projection_proposal previous_proposal USING(proposal_id) WHERE previous_proposal.task_version_id=q.task_version_id AND previous_proposal.writer_actor_id=q.writer_actor_id AND previous_proposal.kind=q.kind AND previous_proposal.source_object_type=q.source_object_type AND previous_proposal.source_object_id=q.source_object_id AND NOT EXISTS(SELECT 1 FROM safe_projection_supersession x WHERE x.old_publication_id=p.publication_id);
    IF prior IS DISTINCT FROM q.replaces_publication_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PUBLICATION_PREDECESSOR_REQUIRED'; END IF;
    IF q.content_hash<>NEW.approved_hash OR e.novel_id<>q.novel_id OR e.source_version_id<>q.revision_id OR e.source_object_type<>q.source_object_type OR e.source_object_id<>q.source_object_id
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='PUBLICATION_SOURCE_MISMATCH'; END IF;RETURN NEW;
  END;`);
  fn('_ctx_bundle_check','','trigger',`DECLARE bid uuid; b context_bundle; actual uuid[]; required_count integer; body text; BEGIN
    IF TG_TABLE_NAME='context_bundle' THEN bid:=NEW.context_bundle_id;
    ELSIF TG_TABLE_NAME='context_compilation' THEN bid:=NEW.context_bundle_id;
    ELSE SELECT context_bundle_id INTO bid FROM context_item WHERE context_item_id=NEW.context_item_id; END IF;
    SELECT * INTO STRICT b FROM context_bundle WHERE context_bundle_id=bid;
    SELECT array_agg(i.publication_id ORDER BY i.position) INTO actual FROM context_item i JOIN context_item_source s USING(context_item_id,publication_id) WHERE i.context_bundle_id=bid;
    SELECT count(*) INTO required_count FROM _ctx_required(b.task_version_id);
    body:=_ctx_render(b.publication_ids);
    IF cardinality(actual) IS DISTINCT FROM b.expected_items OR b.expected_items<>required_count OR actual IS DISTINCT FROM b.publication_ids
      OR (SELECT count(*) FROM context_item WHERE context_bundle_id=bid)<>b.expected_items
      OR (SELECT min(position)<>1 OR max(position)<>b.expected_items FROM context_item WHERE context_bundle_id=bid)
      OR NOT EXISTS(SELECT 1 FROM _ctx_required(b.task_version_id) WHERE kind='character')
      OR EXISTS(SELECT 1 FROM context_item i JOIN safe_projection_publication p USING(publication_id) JOIN safe_projection_proposal q USING(proposal_id)
        WHERE i.context_bundle_id=bid AND(q.novel_id<>b.novel_id OR q.task_version_id<>b.task_version_id OR q.revision_id<>b.revision_id OR q.writer_actor_id<>b.writer_actor_id OR q.policy_release_id<>b.policy_release_id OR q.kind<>i.kind))
      OR actual IS DISTINCT FROM (SELECT array_agg(p.publication_id ORDER BY r.priority,r.source_id) FROM context_item i JOIN safe_projection_publication p USING(publication_id) JOIN safe_projection_proposal q USING(proposal_id)
        JOIN _ctx_required(b.task_version_id) r ON r.kind=q.kind AND r.source_type=q.source_object_type AND r.source_id=q.source_object_id WHERE i.context_bundle_id=bid)
      OR b.payload_text<>body OR b.payload_hash<>encode(sha256(convert_to(body,'UTF8')),'hex') OR b.used_bytes<>octet_length(convert_to(body,'UTF8'))
      OR NOT EXISTS(SELECT 1 FROM scene_task_version v WHERE v.scene_task_version_id=b.task_version_id AND v.author_design_revision_id=b.revision_id AND v.max_input_tokens=b.declared_input_tokens AND v.max_output_tokens=b.declared_output_tokens)
      OR NOT EXISTS(SELECT 1 FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=b.context_grant_id AND s.task_version_id=b.task_version_id AND s.novel_id=b.novel_id AND s.writer_actor_id=b.writer_actor_id AND NOT EXISTS(SELECT 1 FROM context_item i JOIN safe_projection_publication p USING(publication_id) JOIN safe_projection_proposal q USING(proposal_id) WHERE i.context_bundle_id=bid AND NOT CASE q.source_object_type WHEN 'author_design_revision' THEN s.allow_revision WHEN 'design_object_version' THEN s.allow_object WHEN 'design_constraint' THEN s.allow_constraint ELSE false END))
      THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FROZEN_CONTEXT_INCOMPLETE'; END IF;RETURN NULL;
  END;`);
  fn('_ctx_bundle_live','b context_bundle','boolean',`BEGIN
    RETURN b.writer_actor_id=_caller() AND _ctx_grant_live(b.context_grant_id,_caller(),b.novel_id,b.task_version_id)
      AND _ctx_task_current(b.novel_id,b.task_version_id) AND b.policy_release_id=_ctx_policy(b.task_version_id)
      AND NOT EXISTS(SELECT 1 FROM unnest(b.publication_ids) x WHERE NOT _ctx_publication_live(x));
  END;`);
  fn('_ctx_visible','b context_bundle','jsonb',`SELECT jsonb_build_object('ok',true,'bundle_ref',b.public_bundle_ref,'payload_text',b.payload_text,'payload_hash',b.payload_hash,
    'compiler_version',b.compiler_version,'policy_version',(SELECT policy_version FROM context_policy_release WHERE policy_release_id=b.policy_release_id),
    'budget',jsonb_build_object('format_version',b.budget_version,'limit_bytes',b.limit_bytes,'used_bytes',b.used_bytes,
      'declared_input_tokens',b.declared_input_tokens,'declared_output_tokens',b.declared_output_tokens,'real_token_budget_verified',false,'model_call_admitted',false))`,'sql');
  fn('_ctx_audit','id uuid,op text,n uuid,t uuid,allowed boolean,typ text,resource uuid','void',`BEGIN
    INSERT INTO context_access_audit VALUES(id,_caller(),n,t,op,CASE WHEN allowed THEN 'allow' ELSE 'deny' END,typ,
      CASE WHEN typ='grant' THEN resource END,CASE WHEN typ='projection' THEN resource END,CASE WHEN typ='bundle' THEN resource END,
      CASE WHEN typ='evidence' THEN resource END,CASE WHEN typ='policy' THEN resource END,clock_timestamp());
  END;`);
  fn('_ctx_resource_visible','a context_access_audit,n uuid','boolean',`BEGIN
    IF a.novel_id IS DISTINCT FROM n THEN RETURN false; END IF;
    IF a.task_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=a.task_version_id) THEN RETURN false; END IF;
    IF a.resource_type='none' THEN RETURN true; END IF;
    IF a.task_version_id IS NULL THEN RETURN false; END IF;
    IF a.resource_type='grant' THEN RETURN EXISTS(SELECT 1 FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=a.resource_grant_id AND s.novel_id=n AND s.task_version_id=a.task_version_id);
    ELSIF a.resource_type='projection' THEN RETURN EXISTS(SELECT 1 FROM safe_projection_publication p JOIN safe_projection_proposal q USING(proposal_id) JOIN evidence_reference e USING(evidence_reference_id) WHERE p.publication_id=a.resource_publication_id AND q.novel_id=n AND e.novel_id=n AND q.task_version_id=a.task_version_id AND q.revision_id=e.source_version_id AND e.source_object_type=q.source_object_type AND e.source_object_id=q.source_object_id);
    ELSIF a.resource_type='bundle' THEN RETURN EXISTS(SELECT 1 FROM context_bundle b WHERE b.context_bundle_id=a.resource_bundle_id AND b.novel_id=n AND b.task_version_id=a.task_version_id);
    ELSIF a.resource_type='evidence' THEN RETURN EXISTS(SELECT 1 FROM evidence_reference e JOIN scene_task_version v ON v.author_design_revision_id=e.source_version_id WHERE e.evidence_reference_id=a.resource_evidence_id AND e.novel_id=n AND v.novel_id=n AND v.scene_task_version_id=a.task_version_id);
    ELSIF a.resource_type='policy' THEN RETURN EXISTS(SELECT 1 FROM context_policy_release p WHERE p.policy_release_id=a.resource_policy_id AND p.novel_id=n AND p.task_version_id=a.task_version_id); END IF;RETURN false;
  END;`);
  fn('_ctx_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,
    'task_version_id',a.task_version_id,'resource_type',a.resource_type,'resource_id',coalesce(a.resource_grant_id,a.resource_publication_id,a.resource_bundle_id,a.resource_evidence_id,a.resource_policy_id),'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]')
    FROM context_access_audit a WHERE _ctx_resource_visible(a,n)`,'sql');
  fn('_ctx_author_write','op text,n uuid,p jsonb,ids uuid[]','jsonb',`DECLARE v scene_task_version; writer uuid; role_id uuid; scope_id uuid; policy uuid; q safe_projection_proposal; prior uuid; ev uuid; requested_end timestamptz; authority_end timestamptz; authority_count integer; at_time timestamptz; BEGIN
    IF op='projection:publish' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','proposal_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      SELECT * INTO q FROM safe_projection_proposal WHERE novel_id=n AND proposal_id=(p->>'proposal_id')::uuid;
      IF q.proposal_id IS NULL OR NOT _ctx_task_current(n,q.task_version_id) OR q.policy_release_id<>_ctx_policy(q.task_version_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      SELECT pub.publication_id INTO prior FROM safe_projection_publication pub JOIN safe_projection_proposal previous_proposal USING(proposal_id)
        WHERE previous_proposal.task_version_id=q.task_version_id AND previous_proposal.writer_actor_id=q.writer_actor_id AND previous_proposal.kind=q.kind AND previous_proposal.source_object_type=q.source_object_type AND previous_proposal.source_object_id=q.source_object_id
          AND NOT EXISTS(SELECT 1 FROM safe_projection_supersession x WHERE x.old_publication_id=pub.publication_id);
      IF prior IS DISTINCT FROM q.replaces_publication_id THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT'); END IF;
      PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=q.task_version_id) FOR UPDATE;
      ev:=_ctx_evidence(n,q.revision_id,q.source_object_type,q.source_object_id,ids[8]);
      INSERT INTO safe_projection_publication VALUES(ids[2],q.proposal_id,ev,_caller(),q.content_hash,clock_timestamp());
      IF prior IS NOT NULL THEN INSERT INTO safe_projection_supersession VALUES(prior,ids[2]); END IF;
      RETURN jsonb_build_object('ok',true,'publication_id',ids[2]);
    ELSIF op='projection:revoke' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','publication_id']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      SELECT prop.* INTO q FROM safe_projection_publication pub JOIN safe_projection_proposal prop USING(proposal_id) WHERE pub.publication_id=(p->>'publication_id')::uuid AND prop.novel_id=n;
      IF q.proposal_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=q.task_version_id) FOR UPDATE;
      INSERT INTO safe_projection_revocation VALUES(ids[3],(p->>'publication_id')::uuid,_caller(),clock_timestamp()) ON CONFLICT(publication_id) DO NOTHING;
      RETURN jsonb_build_object('ok',true,'status','revoked');
    END IF;
    SELECT * INTO v FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=(p->>'task_version_id')::uuid;
    IF v.scene_task_version_id IS NULL OR NOT _ctx_task_current(n,v.scene_task_version_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    PERFORM 1 FROM scene_task WHERE scene_task_id=v.scene_task_id FOR UPDATE;
    policy:=_ctx_policy(v.scene_task_version_id);
    IF op='context-grant:create' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','task_version_id','writer_actor_id','allow_revision','allow_object','allow_constraint','expires_at'])
        OR jsonb_typeof(p->'allow_revision')<>'boolean' OR jsonb_typeof(p->'allow_object')<>'boolean' OR jsonb_typeof(p->'allow_constraint')<>'boolean'
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      writer:=(p->>'writer_actor_id')::uuid;
      SELECT ar.role_id INTO role_id FROM actor_role ar JOIN execution_role r USING(role_id) JOIN actor_principal a USING(actor_id) WHERE ar.actor_id=writer AND r.role_key='writer' AND a.status='active';
      IF role_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF policy IS NULL THEN INSERT INTO context_policy_release VALUES(ids[95],n,v.scene_task_version_id,1,'safe-context-v1',NULL,_caller());policy:=ids[95]; END IF;
      requested_end:=(p->>'expires_at')::timestamptz;
      at_time:=clock_timestamp();
      SELECT count(*),min(g.expires_at) INTO authority_count,authority_end FROM capability_grant g JOIN capability c USING(capability_id) JOIN data_scope s USING(data_scope_id)
        WHERE g.actor_id=_caller() AND s.novel_id=n AND c.capability_key IN ('design.read','design.freeze','task.read','task.create')
          AND g.effective_at<=at_time AND(g.expires_at IS NULL OR at_time<g.expires_at) AND NOT EXISTS(SELECT 1 FROM grant_revocation x WHERE x.grant_id=g.grant_id);
      IF authority_count<>4 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='AUTHORITY_EXPIRED'; END IF;
      requested_end:=CASE WHEN requested_end IS NULL THEN authority_end WHEN authority_end IS NULL THEN requested_end ELSE least(requested_end,authority_end) END;
      IF requested_end IS NOT NULL AND requested_end<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='AUTHORITY_EXPIRED'; END IF;
      INSERT INTO context_task_scope VALUES(ids[1],n,v.scene_id,v.scene_task_version_id,v.author_design_revision_id,v.viewpoint_entity_id,writer,role_id,'context-task-scope-v1',(p->>'allow_revision')::boolean,(p->>'allow_object')::boolean,(p->>'allow_constraint')::boolean);
      INSERT INTO context_grant VALUES(ids[2],ids[1],'compile_and_read_v1',_caller(),clock_timestamp(),requested_end);
      RETURN jsonb_build_object('ok',true,'grant_id',ids[2],'policy_release_id',policy);
    ELSIF op='context-policy:publish' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','task_version_id','expected_release_id','policy_version']) OR p->>'policy_version'<>'safe-context-v2' OR policy IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF policy IS DISTINCT FROM (p->>'expected_release_id')::uuid THEN RETURN jsonb_build_object('ok',false,'error','VERSION_CONFLICT'); END IF;
      INSERT INTO context_policy_release VALUES(ids[2],n,v.scene_task_version_id,2,'safe-context-v2',policy,_caller());
      RETURN jsonb_build_object('ok',true,'policy_release_id',ids[2]);
    ELSIF op='projection:propose' THEN
      IF NOT _exact_keys(p,ARRAY['request_key','task_version_id','writer_actor_id','kind','source_object_type','source_object_id','safe_text','semantics','format_version','policy_version','replaces_publication_id'])
        OR jsonb_typeof(p->'safe_text')<>'string' OR policy IS NULL OR p->>'policy_version' IS DISTINCT FROM (SELECT policy_version FROM context_policy_release WHERE policy_release_id=policy)
        THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      INSERT INTO safe_projection_proposal VALUES(ids[1],n,v.scene_id,v.scene_task_version_id,v.author_design_revision_id,v.viewpoint_entity_id,(p->>'writer_actor_id')::uuid,
        p->>'kind',p->>'source_object_type',(p->>'source_object_id')::uuid,
        CASE WHEN p->>'source_object_type'='author_design_revision' THEN (p->>'source_object_id')::uuid END,
        CASE WHEN p->>'source_object_type'='design_object_version' THEN (p->>'source_object_id')::uuid END,
        CASE WHEN p->>'source_object_type'='design_constraint' THEN (p->>'source_object_id')::uuid END,
        p->>'semantics',p->>'format_version',policy,p->>'safe_text',(p->>'replaces_publication_id')::uuid,_caller(),'computed');
      RETURN jsonb_build_object('ok',true,'proposal_id',ids[1]);
    END IF;RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';
  END;`);
  fn('_ctx_compile','n uuid,t uuid,g_id uuid,p jsonb,ids uuid[]','jsonb',`DECLARE v scene_task_version; pubs uuid[]; policy uuid; scope uuid; body text; limit_size integer; i integer:=0; row record; BEGIN
    IF NOT _exact_keys(p,ARRAY['request_key','task_version_id','max_bytes']) OR jsonb_typeof(p->'max_bytes')<>'number' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
    limit_size:=(p->>'max_bytes')::integer;
    IF limit_size NOT BETWEEN 128 AND 65536 OR NOT _ctx_task_current(n,t) THEN RETURN jsonb_build_object('ok',false,'error','CONTEXT_UNAVAILABLE'); END IF;
    SELECT * INTO STRICT v FROM scene_task_version WHERE novel_id=n AND scene_task_version_id=t;
    PERFORM 1 FROM scene_task WHERE scene_task_id=v.scene_task_id FOR UPDATE;
    SELECT context_scope_id INTO STRICT scope FROM context_grant WHERE context_grant_id=g_id;policy:=_ctx_policy(t);
    SELECT array_agg(x.publication_id ORDER BY x.priority,x.source_id) INTO pubs FROM _ctx_selected(scope,policy) x;
    IF cardinality(pubs) IS DISTINCT FROM (SELECT count(*)::integer FROM _ctx_required(t)) OR NOT EXISTS(SELECT 1 FROM _ctx_required(t) WHERE kind='character')
      THEN RETURN jsonb_build_object('ok',false,'error','CONTEXT_UNAVAILABLE'); END IF;
    body:=_ctx_render(pubs);
    IF octet_length(convert_to(body,'UTF8'))>limit_size THEN RETURN jsonb_build_object('ok',false,'error','CONTEXT_UNAVAILABLE'); END IF;
    INSERT INTO context_bundle VALUES(ids[1],ids[2],n,t,v.author_design_revision_id,_caller(),g_id,policy,'safe-compiler-v1','ctx-jsonb-v1','utf8-byte-v1',0,
      body,encode(sha256(convert_to(body,'UTF8')),'hex'),limit_size,octet_length(convert_to(body,'UTF8')),v.max_input_tokens,v.max_output_tokens,cardinality(pubs),pubs,clock_timestamp());
    FOR row IN SELECT * FROM _ctx_selected(scope,policy) x ORDER BY x.priority,x.source_id LOOP
      i:=i+1;INSERT INTO context_item VALUES(ids[10+i],ids[1],i,row.kind,row.publication_id,'required_approved_guidance_v1');
      INSERT INTO context_item_source VALUES(ids[10+i],row.publication_id,row.evidence_id);
    END LOOP;
    INSERT INTO context_compilation VALUES(ids[4],ids[1],_caller(),p->>'request_key');
    RETURN _ctx_visible((SELECT b FROM context_bundle b WHERE context_bundle_id=ids[1]));
  END;`);
  fn('_ctx_trace','n uuid,ref uuid','jsonb',`DECLARE b context_bundle; BEGIN
    SELECT * INTO b FROM context_bundle WHERE novel_id=n AND public_bundle_ref=ref;
    IF b.context_bundle_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED'); END IF;
    IF (SELECT count(*) FROM context_item i JOIN context_item_source s USING(context_item_id,publication_id) JOIN safe_projection_publication pub USING(publication_id,evidence_reference_id) JOIN safe_projection_proposal q USING(proposal_id) JOIN evidence_reference e USING(evidence_reference_id) JOIN evidence_design_source d USING(evidence_reference_id) WHERE i.context_bundle_id=b.context_bundle_id AND q.novel_id=n AND q.task_version_id=b.task_version_id AND q.revision_id=b.revision_id AND q.writer_actor_id=b.writer_actor_id AND q.policy_release_id=b.policy_release_id AND e.novel_id=n AND e.source_version_id=b.revision_id AND e.source_object_type=q.source_object_type AND e.source_object_id=q.source_object_id AND d.novel_id=n AND d.author_design_revision_id=b.revision_id)<>b.expected_items THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED'); END IF;
    RETURN jsonb_build_object('ok',true,'bundle',to_jsonb(b),
      'authorization',(SELECT jsonb_build_object('grant',to_jsonb(g),'scope',to_jsonb(s),'revocation',(SELECT to_jsonb(r) FROM context_grant_revocation r WHERE r.context_grant_id=g.context_grant_id)) FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=b.context_grant_id AND s.novel_id=n AND s.task_version_id=b.task_version_id AND s.writer_actor_id=b.writer_actor_id),
      'policy',(SELECT to_jsonb(p) FROM context_policy_release p WHERE p.policy_release_id=b.policy_release_id AND p.novel_id=n AND p.task_version_id=b.task_version_id),
      'items',(SELECT coalesce(jsonb_agg(jsonb_build_object('item',to_jsonb(i),'source',to_jsonb(s),
      'publication',to_jsonb(p),'revocation',(SELECT to_jsonb(r) FROM safe_projection_revocation r WHERE r.publication_id=p.publication_id),'supersession',(SELECT to_jsonb(x) FROM safe_projection_supersession x WHERE x.old_publication_id=p.publication_id),'proposal',to_jsonb(q),'evidence',to_jsonb(e),'design_source',to_jsonb(d)) ORDER BY i.position),'[]')
      FROM context_item i JOIN context_item_source s USING(context_item_id,publication_id) JOIN safe_projection_publication p USING(publication_id,evidence_reference_id)
      JOIN safe_projection_proposal q USING(proposal_id) JOIN evidence_reference e USING(evidence_reference_id) JOIN evidence_design_source d USING(evidence_reference_id)
      WHERE i.context_bundle_id=b.context_bundle_id));
  END;`);
  fn('api_safe_context','p_operation text,p_novel uuid,p_request jsonb,p_ids uuid[],p_audit uuid','jsonb',`DECLARE t uuid; g uuid; b context_bundle; result jsonb; prior context_command_request; digest text; permitted boolean:=false; BEGIN
    PERFORM _lock_authorization();
    IF p_operation IN ('context:compile','context:read') THEN
      IF p_operation='context:compile' THEN t:=(p_request->>'task_version_id')::uuid;
      ELSE SELECT * INTO b FROM context_bundle WHERE novel_id=p_novel AND public_bundle_ref=(p_request->>'bundle_ref')::uuid;t:=b.task_version_id; END IF;
      IF p_operation='context:read' THEN g:=b.context_grant_id;
      ELSE SELECT cg.context_grant_id INTO g FROM context_grant cg JOIN context_task_scope s USING(context_scope_id)
        WHERE s.writer_actor_id=_caller() AND s.novel_id=p_novel AND s.task_version_id=t AND _ctx_grant_live(cg.context_grant_id,_caller(),p_novel,t)
        ORDER BY cg.effective_at DESC,cg.context_grant_id LIMIT 1; END IF;
      permitted:=g IS NOT NULL AND _ctx_grant_live(g,_caller(),p_novel,t);
    ELSIF p_operation IN ('context:trace','context:audit') THEN permitted:=_ctx_trace_allowed(_caller(),p_novel);
    ELSIF p_operation IN ('context-grant:create','context-policy:publish','projection:propose','projection:publish','projection:revoke') THEN permitted:=_ctx_manage(_caller(),p_novel);
    ELSE RETURN jsonb_build_object('ok',false,'error','UNSUPPORTED_OPERATION'); END IF;
    IF NOT coalesce(permitted,false) THEN
      PERFORM _ctx_audit(p_audit,p_operation,(SELECT novel_id FROM novel WHERE novel_id=p_novel),NULL,false,'none',NULL);
      RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED'); END IF;
    PERFORM 1 FROM novel WHERE novel_id=p_novel FOR UPDATE;
    BEGIN
      IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR cardinality(p_ids)<>128 OR array_position(p_ids,NULL) IS NOT NULL OR octet_length(p_request::text)>100000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
      IF p_operation='context:read' THEN
        IF NOT _exact_keys(p_request,ARRAY['bundle_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        IF NOT _ctx_bundle_live(b) THEN result:=jsonb_build_object('ok',false,'error','CONTEXT_UNAVAILABLE'); ELSE result:=_ctx_visible(b); END IF;
      ELSIF p_operation='context:trace' THEN
        IF NOT _exact_keys(p_request,ARRAY['bundle_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        result:=_ctx_trace(p_novel,(p_request->>'bundle_ref')::uuid);
      ELSIF p_operation='context:audit' THEN
        IF p_request<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        result:=jsonb_build_object('ok',true,'events',_ctx_events(p_novel));
      ELSE
        IF jsonb_typeof(p_request->'request_key') IS DISTINCT FROM 'string' OR length(p_request->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST'; END IF;
        digest:=_ctx_hash('request',jsonb_build_object('operation',p_operation,'novel_id',p_novel,'request',p_request));
        SELECT * INTO prior FROM context_command_request WHERE actor_id=_caller() AND novel_id=p_novel AND operation=p_operation AND request_key=p_request->>'request_key';
        IF prior.request_id IS NOT NULL THEN
          IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
          ELSIF p_operation='context:compile' THEN
            SELECT * INTO b FROM context_bundle WHERE public_bundle_ref=(prior.result->>'bundle_ref')::uuid AND novel_id=p_novel;
            IF NOT _ctx_bundle_live(b) THEN result:=jsonb_build_object('ok',false,'error','CONTEXT_UNAVAILABLE'); ELSE result:=_ctx_visible(b); END IF;
          ELSE result:=prior.result; END IF;
        ELSE
          IF p_operation='context:compile' THEN result:=_ctx_compile(p_novel,t,g,p_request,p_ids);ELSE result:=_ctx_author_write(p_operation,p_novel,p_request,p_ids); END IF;
          IF (result->>'ok')::boolean THEN INSERT INTO context_command_request VALUES(p_ids[128],_caller(),p_novel,p_operation,p_request->>'request_key',digest,result); END IF;
        END IF;
      END IF;
    EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range OR invalid_datetime_format OR datetime_field_overflow THEN
      result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');
    END;
    IF (result->>'ok')::boolean THEN
      IF p_operation='context-grant:create' THEN SELECT s.task_version_id INTO t FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=(result->>'grant_id')::uuid;
        PERFORM _ctx_audit(p_audit,p_operation,p_novel,t,true,'grant',(result->>'grant_id')::uuid);RETURN result;
      ELSIF p_operation='projection:publish' THEN SELECT q.task_version_id INTO t FROM safe_projection_publication pub JOIN safe_projection_proposal q USING(proposal_id) WHERE pub.publication_id=(result->>'publication_id')::uuid;
        PERFORM _ctx_audit(p_audit,p_operation,p_novel,t,true,'projection',(result->>'publication_id')::uuid);RETURN result;
      ELSIF p_operation='projection:revoke' THEN SELECT q.task_version_id INTO t FROM safe_projection_publication pub JOIN safe_projection_proposal q USING(proposal_id) WHERE pub.publication_id=(p_request->>'publication_id')::uuid AND q.novel_id=p_novel;
        PERFORM _ctx_audit(p_audit,p_operation,p_novel,t,true,'projection',(p_request->>'publication_id')::uuid);RETURN result;
      ELSIF p_operation='context-policy:publish' THEN SELECT task_version_id INTO t FROM context_policy_release WHERE policy_release_id=(result->>'policy_release_id')::uuid;
        PERFORM _ctx_audit(p_audit,p_operation,p_novel,t,true,'policy',(result->>'policy_release_id')::uuid);RETURN result; END IF;
    END IF;
    IF p_operation IN ('context:read','context:compile') AND (result->>'ok')::boolean THEN
      SELECT * INTO b FROM context_bundle WHERE public_bundle_ref=(result->>'bundle_ref')::uuid;
      PERFORM _ctx_audit(p_audit,p_operation,p_novel,b.task_version_id,true,'bundle',b.context_bundle_id);
    ELSE PERFORM _ctx_audit(p_audit,p_operation,p_novel,t,(result->>'ok')::boolean,'none',NULL); END IF;RETURN result;
  END;`);
  // The existing revoke command works for both fixed Novel grants and explicit Task-context grants.
  fn('api_revoke_grant','p_grant uuid,p_audit uuid','jsonb',`DECLARE n uuid; t uuid; BEGIN
    PERFORM _lock_authorization();SELECT s.novel_id INTO n FROM capability_grant g JOIN data_scope s USING(data_scope_id) WHERE g.grant_id=p_grant AND s.scope_kind='novel';
    IF n IS NOT NULL THEN
      IF NOT _has_capability(_caller(),'grant.revoke',n) THEN RETURN _denied(p_audit,'grant.revoke',n); END IF;
      INSERT INTO grant_revocation VALUES(p_audit,p_grant,_caller(),clock_timestamp()) ON CONFLICT(grant_id) DO NOTHING;
      PERFORM _audit(p_audit,'grant.revoke',n,true,'grant',p_grant);
    ELSE
      SELECT s.novel_id,s.task_version_id INTO n,t FROM context_grant g JOIN context_task_scope s USING(context_scope_id) WHERE g.context_grant_id=p_grant;
      IF n IS NULL OR NOT _has_capability(_caller(),'grant.revoke',n) OR NOT _ctx_manage(_caller(),n) THEN RETURN _denied(p_audit,'grant.revoke',n); END IF;
      INSERT INTO context_grant_revocation VALUES(p_audit,p_grant,_caller(),clock_timestamp()) ON CONFLICT(context_grant_id) DO NOTHING;
      PERFORM _ctx_audit(p_audit,'grant.revoke',n,t,true,'grant',p_grant);
    END IF;RETURN jsonb_build_object('ok',true,'status','revoked');
  END;`);
  fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE events jsonb; BEGIN
    PERFORM _lock_authorization();IF NOT _has_capability(_caller(),'audit.read',p_novel) THEN RETURN _denied(p_audit,'audit.read',(SELECT novel_id FROM novel WHERE novel_id=p_novel)); END IF;
    PERFORM _audit(p_audit,'audit.read',p_novel,true,'novel',p_novel);
    SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.access_audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,'resource_type',a.resource_type,
      'resource_id',coalesce(a.resource_novel_id,a.resource_grant_id),'created_at',a.created_at) ORDER BY a.created_at,a.access_audit_id),'[]') INTO events FROM access_audit_record a WHERE a.novel_id=p_novel AND _audit_resource_visible(a,p_novel);
    RETURN jsonb_build_object('ok',true,'events',events||_ctx_events(p_novel));
  END;`);
  for(const table of ['evidence_reference','evidence_design_source','context_task_scope','context_grant','context_grant_revocation','context_policy_release','safe_projection_proposal',
    'safe_projection_publication','safe_projection_supersession','safe_projection_revocation','context_bundle','context_item','context_item_source','context_compilation','context_command_request','context_access_audit']) {
    sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();
      CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
  }
  sql(`CREATE TRIGGER context_scope_guard BEFORE INSERT ON agent_book.context_task_scope FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_scope_guard();
    CREATE TRIGGER context_grant_guard BEFORE INSERT ON agent_book.context_grant FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_grant_guard();
    CREATE TRIGGER context_id_guard BEFORE INSERT ON agent_book.capability_grant FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_base_grant_guard();
    CREATE TRIGGER projection_guard BEFORE INSERT ON agent_book.safe_projection_proposal FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_proposal_guard();
    CREATE TRIGGER publication_guard BEFORE INSERT ON agent_book.safe_projection_publication FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_publication_guard();`);
  for(const table of ['context_bundle','context_item','context_item_source','context_compilation'])sql(`CREATE CONSTRAINT TRIGGER context_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._ctx_bundle_check();`);
  sql(`REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
    DO $acl$ DECLARE login record; BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry WHERE role_key IN ('author','writer','auditor') LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_safe_context(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);
    END LOOP;END $acl$;`);
}
export async function down(){throw new Error('Safe context rollback requires an explicit forward migration');}
