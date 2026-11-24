// Manual narrative claims and exact source location only; neither semantic verification nor Canon.
export async function up(pgm){
 const sql=s=>pgm.sql(s);
 const fn=(name,args,type,body,lang='plpgsql')=>sql(`CREATE OR REPLACE FUNCTION agent_book.${name}(${args}) RETURNS ${type} LANGUAGE ${lang} SECURITY DEFINER SET search_path=pg_catalog,agent_book,pg_temp AS $f$ ${body} $f$;`);
 // All replacements and the validation of existing Design rows execute in the migration's single transaction.
 sql(`ALTER TABLE agent_book.evidence_reference
   DROP CONSTRAINT evidence_reference_source_domain_check,
   DROP CONSTRAINT evidence_reference_source_object_type_check,
   DROP CONSTRAINT evidence_reference_locator_check,
   DROP CONSTRAINT evidence_reference_evidence_kind_check,
   DROP CONSTRAINT evidence_reference_novel_id_source_version_id_fkey,
   DROP CONSTRAINT evidence_reference_evidence_reference_id_fkey,
   ADD CONSTRAINT evidence_supported_shape CHECK(
     (source_domain='author_design' AND source_object_type IN ('author_design_revision','design_object_version','design_constraint') AND locator='whole:v1' AND evidence_kind='author_intent')
     OR(source_domain='candidate' AND source_object_type IN ('candidate_version','narrative_assertion')
       AND locator~'^utf8-byte-range-v1:(0|[1-9][0-9]{0,5}):(0|[1-9][0-9]{0,5})$'
       AND evidence_kind=CASE source_object_type WHEN 'candidate_version' THEN 'candidate_text_v1' ELSE 'narrative_assertion_v1' END));
 ALTER TABLE agent_book.candidate_version ADD CONSTRAINT candidate_source_identity UNIQUE(novel_id,workflow_run_id,candidate_version_id);
 CREATE TABLE agent_book.narrative_assertion (
   assertion_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,candidate_version_id uuid NOT NULL,
   source_domain text NOT NULL CHECK(source_domain='candidate'),source_content_hash text NOT NULL CHECK(source_content_hash~'^[0-9a-f]{64}$'),
   assertion_type text NOT NULL CHECK(assertion_type='narrated_claim_v1'),assertion_text text NOT NULL CHECK(octet_length(assertion_text) BETWEEN 1 AND 16384 AND length(btrim(assertion_text))>0),
   assertion_hash text NOT NULL CHECK(assertion_hash~'^[0-9a-f]{64}$'),hash_spec_version text NOT NULL CHECK(hash_spec_version='assertion-jsonb-v1'),
   extractor_version text NOT NULL CHECK(extractor_version='human-curation-v1'),
   locator_version text NOT NULL CHECK(locator_version='utf8-byte-range-v1'),start_byte integer NOT NULL,end_byte integer NOT NULL,
   quote_text text NOT NULL,CHECK(start_byte>=0 AND end_byte>start_byte AND end_byte<=262144),
   registered_by uuid NOT NULL REFERENCES agent_book.actor_principal,registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   CONSTRAINT assertion_candidate_owner FOREIGN KEY(novel_id,workflow_run_id,candidate_version_id) REFERENCES agent_book.candidate_version(novel_id,workflow_run_id,candidate_version_id),
   UNIQUE(assertion_id,novel_id,workflow_run_id,candidate_version_id),UNIQUE(candidate_version_id,assertion_hash,extractor_version));
 CREATE TABLE agent_book.narrative_assertion_candidate_source (
   assertion_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,candidate_version_id uuid NOT NULL,source_version_id uuid NOT NULL,
   CHECK(source_version_id=candidate_version_id),
   CONSTRAINT assertion_source_owner FOREIGN KEY(assertion_id,novel_id,workflow_run_id,candidate_version_id) REFERENCES agent_book.narrative_assertion(assertion_id,novel_id,workflow_run_id,candidate_version_id),
   CONSTRAINT assertion_source_candidate FOREIGN KEY(novel_id,workflow_run_id,candidate_version_id) REFERENCES agent_book.candidate_version(novel_id,workflow_run_id,candidate_version_id));
 ALTER TABLE agent_book.narrative_assertion ADD CONSTRAINT assertion_source_required FOREIGN KEY(assertion_id) REFERENCES agent_book.narrative_assertion_candidate_source DEFERRABLE INITIALLY DEFERRED;
 CREATE TABLE agent_book.evidence_candidate_source (
   evidence_reference_id uuid PRIMARY KEY,novel_id uuid NOT NULL,workflow_run_id uuid NOT NULL,candidate_version_id uuid NOT NULL,
   source_object_type text NOT NULL,source_object_id uuid NOT NULL,source_assertion_id uuid,
   CONSTRAINT evidence_candidate_target_shape CHECK(
     (source_object_type='candidate_version' AND source_object_id=candidate_version_id AND source_assertion_id IS NULL)
     OR(source_object_type='narrative_assertion' AND source_assertion_id IS NOT NULL AND source_object_id=source_assertion_id)),
   CONSTRAINT evidence_candidate_parent FOREIGN KEY(evidence_reference_id,novel_id,candidate_version_id,source_object_type,source_object_id)
     REFERENCES agent_book.evidence_reference(evidence_reference_id,novel_id,source_version_id,source_object_type,source_object_id),
   CONSTRAINT evidence_candidate_owner FOREIGN KEY(novel_id,workflow_run_id,candidate_version_id) REFERENCES agent_book.candidate_version(novel_id,workflow_run_id,candidate_version_id),
   CONSTRAINT evidence_assertion_owner FOREIGN KEY(source_assertion_id,novel_id,workflow_run_id,candidate_version_id) REFERENCES agent_book.narrative_assertion(assertion_id,novel_id,workflow_run_id,candidate_version_id));
 CREATE TABLE agent_book.narrative_assertion_evidence (
   assertion_id uuid PRIMARY KEY REFERENCES agent_book.narrative_assertion,
   assertion_evidence_id uuid NOT NULL REFERENCES agent_book.evidence_reference,
   text_evidence_id uuid NOT NULL REFERENCES agent_book.evidence_reference,CHECK(assertion_evidence_id<>text_evidence_id));
 ALTER TABLE agent_book.narrative_assertion ADD CONSTRAINT assertion_evidence_required FOREIGN KEY(assertion_id) REFERENCES agent_book.narrative_assertion_evidence DEFERRABLE INITIALLY DEFERRED;
 CREATE TABLE agent_book.assertion_command_request (
   request_id uuid PRIMARY KEY,actor_id uuid NOT NULL REFERENCES agent_book.actor_principal,novel_id uuid NOT NULL REFERENCES agent_book.novel,
   operation text NOT NULL,scope_id uuid NOT NULL REFERENCES agent_book.candidate_version,request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 100),request_hash text NOT NULL,
   assertion_id uuid REFERENCES agent_book.narrative_assertion,evidence_reference_id uuid NOT NULL REFERENCES agent_book.evidence_reference,
   UNIQUE(actor_id,novel_id,operation,scope_id,request_key));
 CREATE TABLE agent_book.assertion_access_audit (
   audit_id uuid PRIMARY KEY,actor_id uuid REFERENCES agent_book.actor_principal,novel_id uuid REFERENCES agent_book.novel,
   task_version_id uuid REFERENCES agent_book.scene_task_version,workflow_run_id uuid REFERENCES agent_book.workflow_run,candidate_version_id uuid REFERENCES agent_book.candidate_version,
   operation text NOT NULL,decision text NOT NULL CHECK(decision IN ('allow','deny')),
   assertion_id uuid REFERENCES agent_book.narrative_assertion,evidence_reference_id uuid REFERENCES agent_book.evidence_reference,
   created_at timestamptz NOT NULL DEFAULT clock_timestamp());`);
 fn('_na_hash','kind text,p jsonb','text',`SELECT encode(sha256(convert_to('assertion-jsonb-v1:'||kind||E'\\n'||p::text,'UTF8')),'hex')`,'sql');
 fn('_na_locator','lo integer,hi integer','text',`SELECT 'utf8-byte-range-v1:'||lo||':'||hi`,'sql');
 fn('_na_range','c candidate_version,lo integer,hi integer,q text','boolean',`DECLARE bytes bytea:=convert_to(c.body_text,'UTF8');BEGIN
   IF lo IS NULL OR hi IS NULL OR lo<0 OR hi<=lo OR hi>octet_length(bytes) OR q IS NULL OR c.text_protocol<>'exact-utf8-v1'
     OR c.body_hash<>encode(sha256(bytes),'hex') OR c.body_bytes<>octet_length(bytes) THEN RETURN false;END IF;
   -- Decoding both the prefix and the selected bytes proves both endpoints are character boundaries.
   PERFORM convert_from(substring(bytes FROM 1 FOR lo),'UTF8');
   RETURN convert_from(substring(bytes FROM lo+1 FOR hi-lo),'UTF8')=q AND convert_to(q,'UTF8')=substring(bytes FROM lo+1 FOR hi-lo);
   EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RETURN false;END;`);
 fn('_na_payload','a narrative_assertion','jsonb',`SELECT jsonb_build_object('novel_id',a.novel_id,'workflow_ref',a.workflow_run_id,'candidate_ref',a.candidate_version_id,
   'source_content_hash',a.source_content_hash,'assertion_type',a.assertion_type,'assertion_text',a.assertion_text,'extractor_version',a.extractor_version,
   'locator_version',a.locator_version,'start_byte',a.start_byte,'end_byte',a.end_byte,'quote',a.quote_text)`,'sql');
 fn('_na_assertion_guard','','trigger',`DECLARE c candidate_version;BEGIN
   SELECT * INTO c FROM candidate_version WHERE candidate_version_id=NEW.candidate_version_id;
   IF NOT coalesce(_na_range(c,NEW.start_byte,NEW.end_byte,NEW.quote_text),false) OR NEW.source_content_hash IS DISTINCT FROM c.body_hash
     OR NEW.assertion_hash IS DISTINCT FROM _na_hash('content',_na_payload(NEW)) OR NOT _wf_body_valid(NEW.assertion_text)
     OR NOT EXISTS(SELECT 1 FROM actor_principal a JOIN actor_role ar USING(actor_id) JOIN execution_role r USING(role_id) WHERE a.actor_id=NEW.registered_by AND r.role_key='author')
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ASSERTION_CONTENT_INVALID',CONSTRAINT='assertion_content_integrity';END IF;RETURN NEW;END;`);
 fn('_na_evidence_valid','id uuid','boolean',`DECLARE e evidence_reference;s evidence_candidate_source;d evidence_design_source;c candidate_version;a narrative_assertion;lo integer;hi integer;BEGIN
   SELECT * INTO e FROM evidence_reference WHERE evidence_reference_id=id;IF e.evidence_reference_id IS NULL THEN RETURN false;END IF;
   IF (SELECT count(*) FROM(SELECT evidence_reference_id FROM evidence_design_source WHERE evidence_reference_id=id UNION ALL SELECT evidence_reference_id FROM evidence_candidate_source WHERE evidence_reference_id=id) u)<>1 THEN RETURN false;END IF;
   IF e.source_domain='author_design' THEN
     SELECT * INTO d FROM evidence_design_source WHERE evidence_reference_id=id;
     RETURN d.evidence_reference_id IS NOT NULL AND d.novel_id=e.novel_id AND d.author_design_revision_id=e.source_version_id AND d.source_object_type=e.source_object_type AND d.source_object_id=e.source_object_id;
   END IF;
   SELECT * INTO s FROM evidence_candidate_source WHERE evidence_reference_id=id;
   SELECT * INTO c FROM candidate_version WHERE candidate_version_id=s.candidate_version_id;
   IF s.evidence_reference_id IS NULL OR e.source_domain<>'candidate' OR e.novel_id<>s.novel_id OR e.source_version_id<>s.candidate_version_id OR e.source_object_type<>s.source_object_type OR e.source_object_id<>s.source_object_id
     OR c.novel_id IS DISTINCT FROM s.novel_id OR c.workflow_run_id IS DISTINCT FROM s.workflow_run_id THEN RETURN false;END IF;
   lo:=split_part(e.locator,':',2)::integer;hi:=split_part(e.locator,':',3)::integer;
   IF NOT coalesce(_na_range(c,lo,hi,convert_from(substring(convert_to(c.body_text,'UTF8') FROM lo+1 FOR hi-lo),'UTF8')),false) THEN RETURN false;END IF;
   IF s.source_object_type='candidate_version' THEN RETURN s.source_object_id=c.candidate_version_id AND s.source_assertion_id IS NULL;END IF;
   SELECT * INTO a FROM narrative_assertion WHERE assertion_id=s.source_assertion_id;
   RETURN a.assertion_id IS NOT NULL AND a.source_domain='candidate' AND a.novel_id=s.novel_id AND a.workflow_run_id=s.workflow_run_id AND a.candidate_version_id=s.candidate_version_id
     AND e.locator=_na_locator(a.start_byte,a.end_byte) AND EXISTS(SELECT 1 FROM narrative_assertion_candidate_source x WHERE x.assertion_id=a.assertion_id AND x.novel_id=s.novel_id AND x.workflow_run_id=s.workflow_run_id AND x.candidate_version_id=s.candidate_version_id AND x.source_version_id=e.source_version_id);
   EXCEPTION WHEN data_exception THEN RETURN false;END;`);
 fn('_na_evidence_complete','','trigger',`BEGIN
   IF NOT _na_evidence_valid(NEW.evidence_reference_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EVIDENCE_SOURCE_INCOMPLETE',CONSTRAINT='evidence_source_complete';END IF;RETURN NULL;END;`);
 fn('_na_assertion_complete','','trigger',`DECLARE a narrative_assertion;l narrative_assertion_evidence;te evidence_reference;ae evidence_reference;BEGIN
   SELECT * INTO a FROM narrative_assertion WHERE assertion_id=NEW.assertion_id;SELECT * INTO l FROM narrative_assertion_evidence WHERE assertion_id=a.assertion_id;
   SELECT * INTO te FROM evidence_reference WHERE evidence_reference_id=l.text_evidence_id;SELECT * INTO ae FROM evidence_reference WHERE evidence_reference_id=l.assertion_evidence_id;
   IF a.assertion_id IS NULL OR l.assertion_id IS NULL OR NOT EXISTS(SELECT 1 FROM narrative_assertion_candidate_source x WHERE x.assertion_id=a.assertion_id AND x.candidate_version_id=a.candidate_version_id AND x.source_version_id=a.candidate_version_id)
     OR NOT _na_evidence_valid(l.text_evidence_id) OR NOT _na_evidence_valid(l.assertion_evidence_id)
     OR te.source_domain IS DISTINCT FROM 'candidate' OR te.novel_id IS DISTINCT FROM a.novel_id OR te.source_version_id IS DISTINCT FROM a.candidate_version_id OR te.source_object_type IS DISTINCT FROM 'candidate_version' OR te.source_object_id IS DISTINCT FROM a.candidate_version_id
     OR ae.source_domain IS DISTINCT FROM 'candidate' OR ae.novel_id IS DISTINCT FROM a.novel_id OR ae.source_version_id IS DISTINCT FROM a.candidate_version_id OR ae.source_object_type IS DISTINCT FROM 'narrative_assertion' OR ae.source_object_id IS DISTINCT FROM a.assertion_id
     OR te.locator IS DISTINCT FROM _na_locator(a.start_byte,a.end_byte) OR ae.locator IS DISTINCT FROM te.locator
     THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='ASSERTION_SOURCE_INCOMPLETE',CONSTRAINT='assertion_source_complete';END IF;RETURN NULL;END;`);
 // The six-column unique index arbitrates concurrent inserts. No exclusive Candidate container lock is required here.
 fn('_na_evidence','c candidate_version,typ text,obj uuid,lo integer,hi integer,id uuid','uuid',`DECLARE found uuid;BEGIN
   INSERT INTO evidence_reference VALUES(id,c.novel_id,'candidate',c.candidate_version_id,typ,obj,_na_locator(lo,hi),CASE typ WHEN 'candidate_version' THEN 'candidate_text_v1' ELSE 'narrative_assertion_v1' END)
     ON CONFLICT(source_domain,source_version_id,source_object_type,source_object_id,locator,evidence_kind) DO NOTHING RETURNING evidence_reference_id INTO found;
   IF found IS NULL THEN SELECT evidence_reference_id INTO STRICT found FROM evidence_reference WHERE source_domain='candidate' AND source_version_id=c.candidate_version_id AND source_object_type=typ AND source_object_id=obj AND locator=_na_locator(lo,hi) AND evidence_kind=CASE typ WHEN 'candidate_version' THEN 'candidate_text_v1' ELSE 'narrative_assertion_v1' END;
   ELSE INSERT INTO evidence_candidate_source VALUES(found,c.novel_id,c.workflow_run_id,c.candidate_version_id,typ,obj,CASE WHEN typ='narrative_assertion' THEN obj END);END IF;RETURN found;END;`);
 fn('_na_register','op text,c candidate_version,p jsonb,ids uuid[]','jsonb',`DECLARE a narrative_assertion;found uuid;te uuid;ae uuid;lo integer:=(p->'locator'->>'start')::integer;hi integer:=(p->'locator'->>'end')::integer;BEGIN
   IF NOT _exact_keys(p,CASE WHEN op='assertion:register' THEN ARRAY['request_key','workflow_ref','candidate_ref','assertion_type','content','locator','quote'] ELSE ARRAY['request_key','workflow_ref','candidate_ref','locator','quote'] END)
     OR NOT _exact_keys(p->'locator',ARRAY['format','start','end']) OR p->'locator'->>'format' IS DISTINCT FROM 'utf8-byte-range-v1'
     OR jsonb_typeof(p->'locator'->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'locator'->'end') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p->'quote') IS DISTINCT FROM 'string' OR NOT coalesce(_na_range(c,lo,hi,p->>'quote'),false)
     THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_LOCATION';END IF;
   te:=_na_evidence(c,'candidate_version',c.candidate_version_id,lo,hi,ids[2]);
   IF op='candidate-evidence:register' THEN RETURN jsonb_build_object('ok',true,'evidence_ref',te);END IF;
   IF p->>'assertion_type' IS DISTINCT FROM 'narrated_claim_v1' OR jsonb_typeof(p->'content') IS DISTINCT FROM 'string' OR NOT _wf_body_valid(p->>'content') OR octet_length(p->>'content')>16384 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
   a.assertion_id:=ids[1];a.novel_id:=c.novel_id;a.workflow_run_id:=c.workflow_run_id;a.candidate_version_id:=c.candidate_version_id;a.source_domain:='candidate';a.source_content_hash:=encode(sha256(convert_to(c.body_text,'UTF8')),'hex');
   a.assertion_type:=p->>'assertion_type';a.assertion_text:=p->>'content';a.hash_spec_version:='assertion-jsonb-v1';a.extractor_version:='human-curation-v1';a.locator_version:='utf8-byte-range-v1';a.start_byte:=lo;a.end_byte:=hi;a.quote_text:=p->>'quote';a.registered_by:=_caller();a.registered_at:=clock_timestamp();a.assertion_hash:=_na_hash('content',_na_payload(a));
   INSERT INTO narrative_assertion SELECT a.* ON CONFLICT(candidate_version_id,assertion_hash,extractor_version) DO NOTHING RETURNING assertion_id INTO found;
   IF found IS NULL THEN SELECT assertion_id INTO STRICT found FROM narrative_assertion WHERE candidate_version_id=c.candidate_version_id AND assertion_hash=a.assertion_hash AND extractor_version=a.extractor_version;
   ELSE INSERT INTO narrative_assertion_candidate_source VALUES(found,c.novel_id,c.workflow_run_id,c.candidate_version_id,c.candidate_version_id);END IF;
   ae:=_na_evidence(c,'narrative_assertion',found,lo,hi,ids[3]);
   INSERT INTO narrative_assertion_evidence VALUES(found,ae,te) ON CONFLICT(assertion_id) DO NOTHING;
   RETURN jsonb_build_object('ok',true,'assertion_ref',found,'evidence_ref',ae,'text_evidence_ref',te,'semantic_verification','not_performed','approval_coverage','excluded');END;`);
 fn('_na_events','n uuid','jsonb',`SELECT coalesce(jsonb_agg(jsonb_build_object('audit_id',a.audit_id,'actor_id',a.actor_id,'operation',a.operation,'decision',a.decision,
   'task_version_id',a.task_version_id,'workflow_ref',a.workflow_run_id,'candidate_ref',a.candidate_version_id,'assertion_ref',a.assertion_id,'evidence_ref',a.evidence_reference_id,'created_at',a.created_at) ORDER BY a.created_at,a.audit_id),'[]')
   FROM assertion_access_audit a WHERE a.novel_id=n AND(a.workflow_run_id IS NULL AND a.task_version_id IS NULL AND a.candidate_version_id IS NULL AND a.assertion_id IS NULL AND a.evidence_reference_id IS NULL OR
     EXISTS(SELECT 1 FROM workflow_run w JOIN candidate_version c ON c.workflow_run_id=w.workflow_run_id
       WHERE w.workflow_run_id=a.workflow_run_id AND w.novel_id=n AND w.task_version_id=a.task_version_id AND c.candidate_version_id=a.candidate_version_id AND c.novel_id=n AND c.task_version_id=w.task_version_id
       AND(a.assertion_id IS NULL OR EXISTS(SELECT 1 FROM narrative_assertion x JOIN narrative_assertion_candidate_source s USING(assertion_id,novel_id,workflow_run_id,candidate_version_id) WHERE x.assertion_id=a.assertion_id AND x.novel_id=n AND x.workflow_run_id=w.workflow_run_id AND x.candidate_version_id=c.candidate_version_id AND s.source_version_id=c.candidate_version_id))
       AND(a.evidence_reference_id IS NULL OR EXISTS(SELECT 1 FROM evidence_reference e JOIN evidence_candidate_source s USING(evidence_reference_id) WHERE e.evidence_reference_id=a.evidence_reference_id AND e.novel_id=n AND e.source_domain='candidate' AND e.source_version_id=c.candidate_version_id AND s.novel_id=n AND s.workflow_run_id=w.workflow_run_id AND s.candidate_version_id=c.candidate_version_id AND _na_evidence_valid(e.evidence_reference_id)
         AND(e.source_object_type='candidate_version' OR e.source_object_id=a.assertion_id)))))`,'sql');
 fn('_na_history','c candidate_version','jsonb',`SELECT jsonb_build_object('ok',true,'candidate_ref',c.candidate_version_id,'body_hash',c.body_hash,'test_only',(_gen_candidate_marker(c.candidate_version_id)->'test_only'),
   'semantic_verification','not_performed','approval_coverage','excluded',
   'assertions',(SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('candidate_source',to_jsonb(s),'evidence_link',to_jsonb(l)) ORDER BY a.registered_at,a.assertion_id),'[]') FROM narrative_assertion a JOIN narrative_assertion_candidate_source s USING(assertion_id) JOIN narrative_assertion_evidence l USING(assertion_id) WHERE a.candidate_version_id=c.candidate_version_id),
   'evidence',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('candidate_source',to_jsonb(s)) ORDER BY e.evidence_reference_id),'[]') FROM evidence_reference e JOIN evidence_candidate_source s USING(evidence_reference_id) WHERE s.candidate_version_id=c.candidate_version_id))`,'sql');
 fn('api_candidate_assertion','op text,n uuid,p jsonb,ids uuid[],audit uuid','jsonb',`DECLARE c candidate_version;w workflow_run;prior assertion_command_request;result jsonb;digest text;permitted boolean;BEGIN
   PERFORM _lock_authorization();
   IF op IN ('assertion:register','candidate-evidence:register') THEN permitted:=_ctx_manage(_caller(),n);
   ELSIF op='assertion:history' THEN permitted:=_has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n);
   ELSIF op='assertion:audit' THEN permitted:=_has_capability(_caller(),'audit.read',n);
   ELSE RETURN jsonb_build_object('ok',false,'error','UNSUPPORTED_OPERATION');END IF;
   IF NOT coalesce(permitted,false) THEN
     INSERT INTO assertion_access_audit VALUES(audit,_caller(),(SELECT novel_id FROM novel WHERE novel_id=n),NULL,NULL,NULL,op,'deny',NULL,NULL,clock_timestamp());RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;
   PERFORM 1 FROM novel WHERE novel_id=n FOR UPDATE;
   BEGIN
     IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR cardinality(ids)<>16 OR array_position(ids,NULL) IS NOT NULL OR octet_length(p::text)>1800000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
     IF op='assertion:audit' THEN
       IF p<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
       IF NOT _has_capability(_caller(),'audit.read',n) THEN RETURN jsonb_build_object('ok',false,'error','ACCESS_DENIED');END IF;RETURN jsonb_build_object('ok',true,'events',_na_events(n));
     END IF;
     SELECT * INTO w FROM workflow_run WHERE workflow_run_id=(p->>'workflow_ref')::uuid AND novel_id=n;
     PERFORM 1 FROM scene_task WHERE scene_task_id=(SELECT scene_task_id FROM scene_task_version WHERE scene_task_version_id=w.task_version_id) FOR UPDATE;
     SELECT * INTO w FROM workflow_run WHERE workflow_run_id=w.workflow_run_id FOR UPDATE;
     SELECT * INTO c FROM candidate_version WHERE candidate_version_id=(p->>'candidate_ref')::uuid AND workflow_run_id=w.workflow_run_id AND novel_id=n;
     IF NOT (CASE WHEN op='assertion:history' THEN _has_capability(_caller(),'design.read',n) AND _has_capability(_caller(),'task.read',n) ELSE _ctx_manage(_caller(),n) END) THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');
     ELSIF c.candidate_version_id IS NULL THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');
     ELSIF op='assertion:history' THEN
       IF NOT _exact_keys(p,ARRAY['workflow_ref','candidate_ref']) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;result:=_na_history(c);
     ELSIF NOT coalesce(_val_writer_at(w,clock_timestamp()) AND _val_inputs_current(w),false) THEN result:=jsonb_build_object('ok',false,'error','INPUT_STALE');
     ELSE
       -- Recheck management grants after all locks, using DB wall time rather than transaction time.
       IF NOT _ctx_manage(_caller(),n) THEN result:=jsonb_build_object('ok',false,'error','ACCESS_DENIED');
       ELSE
         IF jsonb_typeof(p->'request_key') IS DISTINCT FROM 'string' OR length(p->>'request_key') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='INVALID_REQUEST';END IF;
         digest:=_na_hash('request',jsonb_build_object('operation',op,'novel_id',n,'request',p));
         SELECT * INTO prior FROM assertion_command_request WHERE actor_id=_caller() AND novel_id=n AND operation=op AND scope_id=c.candidate_version_id AND request_key=p->>'request_key';
         IF prior.request_id IS NOT NULL THEN
           IF prior.request_hash<>digest THEN result:=jsonb_build_object('ok',false,'error','IDEMPOTENCY_CONFLICT');
           ELSE result:=jsonb_build_object('ok',true,'assertion_ref',prior.assertion_id,'evidence_ref',prior.evidence_reference_id,'replayed',true,'semantic_verification','not_performed','approval_coverage','excluded');END IF;
         ELSE
           result:=_na_register(op,c,p,ids);
           INSERT INTO assertion_command_request VALUES(ids[16],_caller(),n,op,c.candidate_version_id,p->>'request_key',digest,(result->>'assertion_ref')::uuid,(result->>'evidence_ref')::uuid);
         END IF;
       END IF;
     END IF;
   EXCEPTION WHEN invalid_parameter_value OR invalid_text_representation OR not_null_violation OR foreign_key_violation OR unique_violation OR check_violation OR numeric_value_out_of_range OR character_not_in_repertoire THEN
     result:=jsonb_build_object('ok',false,'error','INVALID_REQUEST');
   END;
   INSERT INTO assertion_access_audit VALUES(audit,_caller(),n,CASE WHEN c.candidate_version_id IS NOT NULL THEN w.task_version_id END,CASE WHEN c.candidate_version_id IS NOT NULL THEN w.workflow_run_id END,c.candidate_version_id,op,CASE WHEN(result->>'ok')::boolean THEN 'allow' ELSE 'deny' END,(result->>'assertion_ref')::uuid,(result->>'evidence_ref')::uuid,clock_timestamp());
   RETURN result;END;`);
 // Context audit is a Design-source consumer too. UUID equality across source domains grants no visibility.
 sql('ALTER FUNCTION agent_book._ctx_resource_visible(agent_book.context_access_audit,uuid) RENAME TO _ctx_resource_visible_pre_assertion;');
 fn('_ctx_resource_visible','a context_access_audit,n uuid','boolean',`BEGIN
   IF a.resource_type='evidence' AND NOT EXISTS(SELECT 1 FROM evidence_reference e JOIN evidence_design_source d USING(evidence_reference_id)
     WHERE e.evidence_reference_id=a.resource_evidence_id AND e.source_domain='author_design' AND e.novel_id=n AND d.novel_id=n AND _na_evidence_valid(e.evidence_reference_id)) THEN RETURN false;END IF;
   RETURN _ctx_resource_visible_pre_assertion(a,n);END;`);
 sql('ALTER FUNCTION agent_book.api_read_audit(uuid,uuid) RENAME TO _read_audit_pre_assertion;');
 fn('api_read_audit','p_novel uuid,p_audit uuid','jsonb',`DECLARE r jsonb;BEGIN r:=_read_audit_pre_assertion(p_novel,p_audit);IF(r->>'ok')::boolean THEN RETURN jsonb_set(r,'{events}',(r->'events')||_na_events(p_novel));END IF;RETURN r;END;`);
 for(const table of ['narrative_assertion','narrative_assertion_candidate_source','evidence_candidate_source','narrative_assertion_evidence','assertion_command_request','assertion_access_audit'])sql(`CREATE TRIGGER immutable_rows BEFORE UPDATE OR DELETE ON agent_book.${table} FOR EACH ROW EXECUTE FUNCTION agent_book._immutable();CREATE TRIGGER immutable_truncate BEFORE TRUNCATE ON agent_book.${table} FOR EACH STATEMENT EXECUTE FUNCTION agent_book._immutable();`);
 for(const table of ['evidence_reference','evidence_design_source','evidence_candidate_source'])sql(`CREATE CONSTRAINT TRIGGER evidence_source_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._na_evidence_complete();`);
 for(const table of ['narrative_assertion','narrative_assertion_candidate_source','narrative_assertion_evidence'])sql(`CREATE CONSTRAINT TRIGGER assertion_source_complete AFTER INSERT ON agent_book.${table} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION agent_book._na_assertion_complete();`);
 sql(`CREATE TRIGGER assertion_content_guard BEFORE INSERT ON agent_book.narrative_assertion FOR EACH ROW EXECUTE FUNCTION agent_book._na_assertion_guard();
   DO $verify$ DECLARE row record;BEGIN FOR row IN SELECT evidence_reference_id FROM agent_book.evidence_reference LOOP IF NOT agent_book._na_evidence_valid(row.evidence_reference_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='EXISTING_EVIDENCE_INVALID';END IF;END LOOP;END $verify$;
   REVOKE ALL ON ALL TABLES IN SCHEMA agent_book FROM PUBLIC;REVOKE ALL ON ALL FUNCTIONS IN SCHEMA agent_book FROM PUBLIC;
   DO $acl$ DECLARE login record;BEGIN FOR login IN SELECT * FROM agent_book_meta.login_registry LOOP
     EXECUTE format('REVOKE ALL ON FUNCTION agent_book._read_audit_pre_assertion(uuid,uuid) FROM %I',login.db_login);
     IF login.role_key IN ('author','auditor') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_candidate_assertion(text,uuid,jsonb,uuid[],uuid) TO %I',login.db_login);END IF;
     IF login.role_key='auditor' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION agent_book.api_read_audit(uuid,uuid) TO %I',login.db_login);END IF;
   END LOOP;END $acl$;`);
}
export async function down(){throw new Error('Use a reviewed forward migration');}
