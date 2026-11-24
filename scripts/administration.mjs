import { randomUUID } from 'node:crypto';
import { inTransaction, withConnection } from '../src/database.mjs';
import { exactFields, isUuid, requireCondition } from '../src/safety.mjs';

export const quote = value => `"${value.replaceAll('"', '""')}"`;
const literal = value => `'${value.replaceAll("'", "''")}'`;
const kinds = new Set(['author','writer','validator','commit-service','projection-worker','auditor']);

export function validateProvision(value) {
  requireCondition(exactFields(value, ['owner', 'migrator', 'actors'])
    && /^[a-z][a-z0-9_]{0,50}$/.test(value.owner), 'PROVISION_INVALID');
  requireCondition(exactFields(value.migrator, ['login', 'password']) && Array.isArray(value.actors)
    && value.actors.length >= 6, 'PROVISION_INVALID');
  const entries = [value.migrator, ...value.actors];
  for (const entry of entries) {
    requireCondition(/^[a-z][a-z0-9_]{0,50}$/.test(entry.login)
      && typeof entry.password === 'string' && /^[a-zA-Z0-9_-]{24,128}$/.test(entry.password)
      && !entry.password.startsWith('REPLACE_'), 'PROVISION_INVALID');
  }
  for (const actor of value.actors) requireCondition(exactFields(actor, ['actorId','login','password','role','status'])
    && isUuid(actor.actorId) && kinds.has(actor.role) && ['active','disabled'].includes(actor.status), 'PROVISION_INVALID');
  requireCondition([...kinds].every(kind => value.actors.some(actor => actor.role === kind)), 'PROVISION_ROLES_REQUIRED');
  requireCondition(new Set([value.owner, ...entries.map(entry => entry.login)]).size === entries.length + 1
    && new Set(value.actors.map(actor => actor.actorId)).size === value.actors.length, 'PROVISION_IDENTITIES_UNIQUE');
  return value;
}

// Only explicit empty-target initialization can establish an installation marker.
export async function initialize(config, provision) {
  validateProvision(provision);
  return withConnection(config, client => inTransaction(client, async c => {
    const empty = await c.query(`SELECT NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public'))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
        WHERE ns.nspname='public') AS empty`);
    requireCondition(empty.rows[0].empty, 'EMPTY_TARGET_REQUIRED');
    const names = [provision.owner, provision.migrator.login, ...provision.actors.map(actor => actor.login)];
    const existing = await c.query('SELECT count(*)::int AS count FROM pg_catalog.pg_roles WHERE rolname=ANY($1::name[])', [names]);
    requireCondition(existing.rows[0].count === 0, 'ROLE_ALREADY_EXISTS');
    await c.query(`CREATE ROLE ${quote(provision.owner)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
    for (const entry of [provision.migrator, ...provision.actors]) {
      await c.query(`CREATE ROLE ${quote(entry.login)} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${literal(entry.password)}`);
    }
    await c.query(`GRANT ${quote(provision.owner)} TO ${quote(provision.migrator.login)} WITH INHERIT FALSE, SET TRUE`);
    await c.query(`REVOKE ALL ON DATABASE ${quote(config.database)} FROM PUBLIC`);
    for (const name of names.filter(name => name !== provision.owner)) await c.query(`GRANT CONNECT ON DATABASE ${quote(config.database)} TO ${quote(name)}`);
    await c.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    for (const schema of ['agent_book', 'agent_book_meta']) await c.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${quote(provision.owner)}`);
    await c.query(`SET LOCAL ROLE ${quote(provision.owner)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
      CREATE TABLE agent_book_meta.installation(instance_id uuid PRIMARY KEY,owner_login name NOT NULL,migrator_login name NOT NULL);
      CREATE TABLE agent_book_meta.login_registry(actor_id uuid PRIMARY KEY,db_login name NOT NULL UNIQUE,role_key text NOT NULL,status text NOT NULL);
      CREATE FUNCTION agent_book_meta.instance_identity() RETURNS uuid LANGUAGE sql SECURITY DEFINER
        SET search_path=pg_catalog,agent_book_meta,pg_temp AS 'SELECT instance_id FROM installation';
      REVOKE ALL ON FUNCTION agent_book_meta.instance_identity() FROM PUBLIC;`);
    await c.query(`GRANT SELECT ON agent_book_meta.installation TO ${quote(provision.migrator.login)}`);
    await c.query('INSERT INTO agent_book_meta.installation VALUES($1,$2,$3)', [config.instanceId, provision.owner, provision.migrator.login]);
    for (const actor of provision.actors) await c.query('INSERT INTO agent_book_meta.login_registry VALUES($1,$2,$3,$4)', [actor.actorId, actor.login, actor.role, actor.status]);
    for (const name of names.filter(name => name !== provision.owner)) {
      await c.query(`GRANT USAGE ON SCHEMA agent_book_meta TO ${quote(name)};
        GRANT EXECUTE ON FUNCTION agent_book_meta.instance_identity() TO ${quote(name)}`);
    }
    return { ok: true, initialized: true };
  }), { initialized: false });
}

// Administrative bootstrap is not a runtime grant endpoint; registry was sealed at initialization.
export async function bootstrap(config) {
  return withConnection(config, client => inTransaction(client, async c => {
    const admin = await c.query('SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=session_user');
    requireCondition(admin.rows[0]?.rolsuper, 'INITIALIZER_REQUIRED');
    const registry = (await c.query('SELECT * FROM agent_book_meta.login_registry ORDER BY db_login')).rows;
    for (const actor of registry) {
      const type = ['author','auditor'].includes(actor.role_key) ? 'user' : actor.role_key === 'writer' ? 'agent' : 'service';
      await c.query(`INSERT INTO agent_book.actor_principal VALUES($1,$2,$3,$4,$5) ON CONFLICT(actor_id) DO NOTHING`, [actor.actor_id,type,actor.role_key,actor.db_login,actor.status]);
      await c.query(`INSERT INTO agent_book.actor_role SELECT $1,role_id FROM agent_book.execution_role WHERE role_key=$2 ON CONFLICT(actor_id) DO NOTHING`, [actor.actor_id,actor.role_key]);
      if (actor.role_key === 'author') await c.query(`INSERT INTO agent_book.novel_creation_authorization(authorization_id,actor_id,role_id,capability_id,effective_at)
        SELECT $1,ar.actor_id,ar.role_id,cap.capability_id,clock_timestamp() FROM agent_book.actor_role ar CROSS JOIN agent_book.capability cap
        WHERE ar.actor_id=$2 AND cap.capability_key='novel.create' AND NOT EXISTS(SELECT 1 FROM agent_book.novel_creation_authorization WHERE actor_id=$2)`, [randomUUID(),actor.actor_id]);
    }
    return { ok: true, principals: registry.length, startup_authorization: 'create_new_novel_only' };
  }));
}

export async function initializeNovelReader(config, { actorId, novelId }) {
  requireCondition(isUuid(actorId) && isUuid(novelId), 'PROVISION_INVALID');
  return withConnection(config, client => inTransaction(client, async c => {
    const admin = await c.query('SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=session_user');
    requireCondition(admin.rows[0]?.rolsuper, 'INITIALIZER_REQUIRED');
    const actor = (await c.query(`SELECT ar.role_id,r.role_key FROM agent_book.actor_role ar
      JOIN agent_book.execution_role r USING(role_id) WHERE actor_id=$1`, [actorId])).rows[0];
    requireCondition(actor && ['writer','auditor'].includes(actor.role_key), 'READER_ROLE_REQUIRED');
    const scope = (await c.query("SELECT data_scope_id FROM agent_book.data_scope WHERE novel_id=$1 AND scope_kind='novel'", [novelId])).rows[0];
    requireCondition(scope, 'NOVEL_SCOPE_REQUIRED');
    const capability = actor.role_key === 'writer' ? 'novel.read' : 'audit.read';
    const grantId = randomUUID();
    await c.query(`INSERT INTO agent_book.capability_grant(grant_id,actor_id,role_id,capability_id,data_scope_id,effective_at)
      SELECT $1,$2,$3,capability_id,$4,clock_timestamp() FROM agent_book.capability WHERE capability_key=$5`, [grantId,actorId,actor.role_id,scope.data_scope_id,capability]);
    return { ok: true, grant_id: grantId };
  }));
}
