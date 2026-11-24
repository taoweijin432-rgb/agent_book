import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const outputPath = process.env.VERIFICATION_OUTPUT;
const mode = process.argv[2] ?? 'probe';
const schema = 'evidence_candidate_constraint_fixture';

assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.ok(['probe', 'regression'].includes(mode), 'mode must be probe or regression');

let sequence = 0;
function id(prefix) {
  sequence += 1;
  return `${prefix}_${Date.now()}_${process.pid}_${sequence}`;
}

async function newPublicClient() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query(`SET search_path TO public`);
  const { rows } = await client.query('SHOW search_path');
  assert.equal(rows[0].search_path, 'public');
  return client;
}

async function rollbackQuietly(client) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // The failed COMMIT may already have ended the transaction.
  }
}

function errorRecord(error, stage) {
  return {
    status: 'failed',
    stage,
    code: error?.code ?? null,
    constraint: error?.constraint ?? null,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function insertGraphAndEvidence(client, { withSupport = true } = {}) {
  const projectId = id('public_path_project');
  const workflowRunId = id('public_path_workflow');
  const candidateVersionId = id('public_path_candidate');
  const eventId = id('public_path_event');
  const evidenceId = id('public_path_evidence');

  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query(`SET LOCAL search_path TO public`);
  await client.query(`INSERT INTO ${schema}.project(project_id) VALUES ($1)`, [projectId]);
  await client.query(
    `INSERT INTO ${schema}.workflow_run(workflow_run_id, project_id) VALUES ($1, $2)`,
    [workflowRunId, projectId],
  );
  await client.query(
    `INSERT INTO ${schema}.candidate_version(candidate_version_id, project_id, workflow_run_id)
     VALUES ($1, $2, $3)`,
    [candidateVersionId, projectId, workflowRunId],
  );
  await client.query(
    `INSERT INTO ${schema}.candidate_event(candidate_event_id, project_id, candidate_version_id)
     VALUES ($1, $2, $3)`,
    [eventId, projectId, candidateVersionId],
  );
  await client.query(
    `INSERT INTO ${schema}.evidence_reference(
       evidence_reference_id, project_id, source_domain, source_version_id,
       source_object_type, source_object_id, locator, evidence_kind
     ) VALUES ($1, $2, 'candidate', $3, 'candidate_event', $4, 'chars:public-path', 'text_span')`,
    [evidenceId, projectId, candidateVersionId, eventId],
  );
  if (withSupport) {
    await client.query(
      `INSERT INTO ${schema}.evidence_candidate_source(
         evidence_reference_id, candidate_version_id, source_object_type, source_object_id,
         source_candidate_event_id
       ) VALUES ($1, $2, 'candidate_event', $3, $3)`,
      [evidenceId, candidateVersionId, eventId],
    );
  }
  return { projectId, workflowRunId, candidateVersionId, eventId, evidenceId };
}

async function runValidCommit() {
  const client = await newPublicClient();
  let ids;
  try {
    ids = await insertGraphAndEvidence(client);
    await client.query('COMMIT');
    const { rows } = await client.query(
      `SELECT er.evidence_reference_id, ecs.source_object_id
         FROM ${schema}.evidence_reference er
         JOIN ${schema}.evidence_candidate_source ecs USING (evidence_reference_id)
        WHERE er.evidence_reference_id = $1`,
      [ids.evidenceId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_object_id, ids.eventId);
    return { status: 'passed', stage: 'COMMIT', ids };
  } catch (error) {
    await rollbackQuietly(client);
    return { ...errorRecord(error, 'COMMIT'), ids };
  } finally {
    await client.end();
  }
}

async function runParentOnly() {
  const client = await newPublicClient();
  let ids;
  try {
    ids = await insertGraphAndEvidence(client, { withSupport: false });
    await client.query('COMMIT');
    return { status: 'unexpected_commit', stage: 'COMMIT', ids };
  } catch (error) {
    await rollbackQuietly(client);
    const result = { ...errorRecord(error, 'COMMIT'), ids };
    const check = await newPublicClient();
    try {
      const { rows } = await check.query(
        `SELECT count(*)::int AS count
           FROM ${schema}.evidence_reference
          WHERE evidence_reference_id = $1`,
        [ids.evidenceId],
      );
      result.persistedEvidence = rows[0].count;
    } finally {
      await check.end();
    }
    return result;
  } finally {
    await client.end();
  }
}

async function runMutations(validIds) {
  const evidenceClient = await newPublicClient();
  let evidenceMutation;
  try {
    await evidenceClient.query('BEGIN');
    await evidenceClient.query(
      `UPDATE ${schema}.evidence_reference SET locator = 'chars:changed'
        WHERE evidence_reference_id = $1`,
      [validIds.evidenceId],
    );
    evidenceMutation = { status: 'unexpected_update' };
  } catch (error) {
    evidenceMutation = errorRecord(error, 'UPDATE evidence_reference');
  } finally {
    await rollbackQuietly(evidenceClient);
    await evidenceClient.end();
  }

  const ownershipClient = await newPublicClient();
  let ownershipMutation;
  try {
    await ownershipClient.query('BEGIN');
    const otherProjectId = id('public_path_other_project');
    await ownershipClient.query(`INSERT INTO ${schema}.project(project_id) VALUES ($1)`, [otherProjectId]);
    await ownershipClient.query(
      `UPDATE ${schema}.candidate_event SET project_id = $2 WHERE candidate_event_id = $1`,
      [validIds.eventId, otherProjectId],
    );
    ownershipMutation = { status: 'unexpected_update' };
  } catch (error) {
    ownershipMutation = errorRecord(error, 'UPDATE candidate_event ownership');
  } finally {
    await rollbackQuietly(ownershipClient);
    await ownershipClient.end();
  }

  const check = await newPublicClient();
  try {
    const { rows } = await check.query(
      `SELECT er.locator, ce.project_id, ecs.source_object_id
         FROM ${schema}.evidence_reference er
         JOIN ${schema}.evidence_candidate_source ecs USING (evidence_reference_id)
         JOIN ${schema}.candidate_event ce ON ce.candidate_event_id = ecs.source_candidate_event_id
        WHERE er.evidence_reference_id = $1`,
      [validIds.evidenceId],
    );
    assert.equal(rows.length, 1);
    return { evidenceMutation, ownershipMutation, finalState: rows[0] };
  } finally {
    await check.end();
  }
}

const report = {
  mode,
  node: process.version,
  connectionSearchPath: 'public',
  sqlQualification: `${schema}.*`,
  validCommit: await runValidCommit(),
};

if (mode === 'regression') {
  assert.equal(report.validCommit.status, 'passed', report.validCommit.message);
  report.parentOnly = await runParentOnly();
  assert.equal(report.parentOnly.status, 'failed');
  assert.equal(report.parentOnly.code, '23514');
  assert.equal(report.parentOnly.constraint, 'evidence_candidate_complete');
  assert.equal(report.parentOnly.persistedEvidence, 0);
  report.mutations = await runMutations(report.validCommit.ids);
  assert.equal(report.mutations.evidenceMutation.code, '23514');
  assert.equal(report.mutations.evidenceMutation.constraint, 'evidence_candidate_immutable');
  assert.equal(report.mutations.ownershipMutation.code, '23514');
  assert.equal(report.mutations.ownershipMutation.constraint, 'evidence_candidate_complete');
  assert.equal(report.mutations.finalState.locator, 'chars:public-path');
  assert.equal(report.mutations.finalState.project_id, report.validCommit.ids.projectId);
  assert.equal(report.mutations.finalState.source_object_id, report.validCommit.ids.eventId);
}

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, serialized);
process.stdout.write(serialized);
