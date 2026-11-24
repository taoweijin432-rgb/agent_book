import {candidateAssertionOperations,candidateAssertionArguments} from './candidate-assertion.mjs';
import { testGenerationArguments,testGenerationOperations,executeTestGeneration } from './test-generation.mjs';
import {manualApprovalOperations,manualApprovalArguments} from './manual-approval.mjs';
import { finiteValidationOperations,finiteValidationArguments } from './finite-validation.mjs';
import { manualWorkflowArguments,manualWorkflowOperations } from './manual-workflow.mjs';
import { safeContextArguments,safeContextOperations } from './safe-context.mjs';
import { designTaskArguments, designTaskOperations } from './design-task.mjs';
import { randomUUID } from 'node:crypto';
import { inTransaction, withConnection } from './database.mjs';
import { exactFields, isUuid, logRecord, SafeError, safeFailure } from './safety.mjs';

const endpoints = Object.freeze({ ...Object.fromEntries(candidateAssertionOperations.map(op=>[op,'api_candidate_assertion'])), ...Object.fromEntries(testGenerationOperations.map(op=>[op,'api_test_generation'])), ...Object.fromEntries(manualApprovalOperations.map(op=>[op,'api_manual_approval'])), ...Object.fromEntries(finiteValidationOperations.map(op=>[op,'api_finite_validation'])), ...Object.fromEntries(manualWorkflowOperations.map(op=>[op,'api_manual_workflow'])), ...Object.fromEntries(safeContextOperations.map(op=>[op,'api_safe_context'])), ...Object.fromEntries(designTaskOperations.map(op=>[op,'api_design_task'])), 'identity': 'api_identity', 'creation:revoke': 'api_revoke_creation', 'novel:create': 'api_create_novel',
  'novel:read': 'api_read_novel', 'grant:revoke': 'api_revoke_grant', 'audit:read': 'api_read_audit' });

function argumentsFor(operation, input) {
  if(candidateAssertionOperations.includes(operation))return candidateAssertionArguments(operation,input);
  if(testGenerationOperations.includes(operation))return testGenerationArguments(operation,input);
  if(manualApprovalOperations.includes(operation))return manualApprovalArguments(operation,input);
  if (finiteValidationOperations.includes(operation)) return finiteValidationArguments(operation,input);
  if (manualWorkflowOperations.includes(operation)) return manualWorkflowArguments(operation,input);
  if (safeContextOperations.includes(operation)) return safeContextArguments(operation,input);
  if (designTaskOperations.includes(operation)) return designTaskArguments(operation,input);
  const audit = randomUUID();
  if (['identity','creation:revoke'].includes(operation) && exactFields(input, [])) return [audit];
  if (operation === 'novel:create' && exactFields(input, ['external_key', 'title'])
    && typeof input.external_key === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.external_key)
    && typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= 300) {
    return [randomUUID(), input.external_key, input.title, Array.from({ length: 10 }, () => randomUUID()), audit];
  }
  const key = operation === 'grant:revoke' ? 'grant_id' : 'novel_id';
  if (['novel:read', 'audit:read', 'grant:revoke'].includes(operation)
    && exactFields(input, [key]) && isUuid(input[key])) return [input[key], audit];
  throw new SafeError('INVALID_REQUEST');
}

// Credentials bind one host-side identity. No actor selector or administrator fallback.
export async function executeCommand(config, operation, input = {}, { logger = () => {}, generationRuntime = {} } = {}) {
  let response;
  try {
    if(operation==='generation:execute'){
      response=await executeTestGeneration(config,input,generationRuntime);
      logger(logRecord(operation,response.ok?'allowed':'denied'));return response;
    }
    if(testGenerationOperations.includes(operation)&&(config.mode!=='test'||process.env.AB_TEST_MODE!=='1'))throw new SafeError('EXPLICIT_TEST_CONFIGURATION_REQUIRED');
    const endpoint = endpoints[operation];
    if (!endpoint) throw new SafeError('UNSUPPORTED_OPERATION');
    const args = [...candidateAssertionOperations,...finiteValidationOperations,...manualApprovalOperations,...testGenerationOperations].includes(operation) ? null : argumentsFor(operation, input);
    response = await withConnection(config, async client => {
      if (finiteValidationOperations.includes(operation) && !(await client.query("SELECT to_regprocedure('agent_book.api_finite_validation(text,uuid,jsonb,uuid[],uuid)') IS NOT NULL present")).rows[0].present) return {ok:false,error:'UNSUPPORTED_OPERATION'};
      if(manualApprovalOperations.includes(operation)&&!(await client.query("SELECT to_regprocedure('agent_book.api_manual_approval(text,uuid,jsonb,uuid[],uuid)') IS NOT NULL present")).rows[0].present)return {ok:false,error:'UNSUPPORTED_OPERATION'};
      if(testGenerationOperations.includes(operation)&&!(await client.query("SELECT to_regprocedure('agent_book.api_test_generation(text,uuid,jsonb,uuid[],uuid)') IS NOT NULL present")).rows[0].present)return {ok:false,error:'UNSUPPORTED_OPERATION'};
      if(candidateAssertionOperations.includes(operation)&&!(await client.query("SELECT to_regprocedure('agent_book.api_candidate_assertion(text,uuid,jsonb,uuid[],uuid)') IS NOT NULL present")).rows[0].present)return {ok:false,error:'UNSUPPORTED_OPERATION'};
      const parameters=args??argumentsFor(operation,input);
      return inTransaction(client, async transaction => {
      const placeholders = parameters.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await transaction.query(`SELECT agent_book.${endpoint}(${placeholders}) AS result`, parameters);
      return rows[0].result;
      });
    });
  } catch (error) {
    // A newer CLI may run against an explicitly older migration boundary. No absent API is invoked successfully.
    response = [...candidateAssertionOperations,...manualWorkflowOperations,...finiteValidationOperations,...manualApprovalOperations,...testGenerationOperations].includes(operation) && error.code==='42883' ? {ok:false,error:'UNSUPPORTED_OPERATION'} : safeFailure(error);
  }
  const outcome = response.ok ? 'allowed' : response.error === 'REQUEST_FAILED' ? 'failed' : 'denied';
  logger(logRecord(Object.hasOwn(endpoints, operation) ? operation : 'unsupported', outcome));
  return response;
}
