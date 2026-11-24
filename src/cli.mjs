import {candidateAssertionOperations} from './candidate-assertion.mjs';
import { testGenerationOperations } from './test-generation.mjs';
import {manualApprovalOperations} from './manual-approval.mjs';
import { finiteValidationOperations } from './finite-validation.mjs';
import { manualWorkflowOperations } from './manual-workflow.mjs';
import { safeContextOperations } from './safe-context.mjs';
import { readFile } from 'node:fs/promises';
import { designTaskOperations } from './design-task.mjs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.mjs';
import { executeCommand } from './foundation.mjs';
import { SafeError, safeFailure } from './safety.mjs';

export async function main(args = process.argv.slice(2), env = process.env) {
  try {
    const [operation, ...rest] = args;
    const config = await loadConfig(env.AB_CONFIG, env);
    if (operation === 'config:check' && rest.length === 0) return { ok: true, configuration: 'valid', mode: config.mode };
    let input = {};
    if ([...candidateAssertionOperations,'generation:execute',...testGenerationOperations,...designTaskOperations,...safeContextOperations,...manualWorkflowOperations,...finiteValidationOperations,...manualApprovalOperations].includes(operation) && rest.length===2) {
      let request; try { request=JSON.parse(await readFile(rest[1],'utf8')); } catch { throw new SafeError('INVALID_REQUEST_FILE'); }
      input={novel_id:rest[0],request};
    } else if (operation === 'novel:create' && rest.length === 2) input = { external_key: rest[0], title: rest[1] };
    else if (['novel:read', 'audit:read'].includes(operation) && rest.length === 1) input = { novel_id: rest[0] };
    else if (operation === 'grant:revoke' && rest.length === 1) input = { grant_id: rest[0] };
    else if (!['identity','creation:revoke'].includes(operation) || rest.length !== 0) throw new SafeError('UNSUPPORTED_COMMAND_OR_ARGUMENTS');
    return await executeCommand(config, operation, input, { logger: record => process.stderr.write(`${JSON.stringify(record)}\n`) });
  } catch (error) { return safeFailure(error); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const response = await main();
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = response.ok ? 0 : 1;
}
