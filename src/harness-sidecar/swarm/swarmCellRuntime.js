import { runLocalMetaHarness } from '../meta/localMetaHarness.js';
import { runSubagentAttempt } from './subagentRunner.js';
import {
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from './swarmCellContracts.js';

function mergeReasons(...reasonLists) {
  return [...new Set(reasonLists.flatMap((reasons) => (Array.isArray(reasons) ? reasons : [])))];
}

export async function runSwarmCell({
  workspaceRoot,
  cell = {},
  task = {},
  attempt = {},
  role = cell.role || 'implementer',
  context = {},
  budget = {},
  outputContract = cell.outputContract || {},
  commandAdapter,
} = {}) {
  const attemptResult = await runSubagentAttempt({
    task,
    attempt,
    role,
    context: {
      ...context,
      cellId: cell.cellId,
    },
    budget,
    outputContract,
    commandAdapter,
  });
  const normalized = normalizeSwarmCellOutput({
    taskOutput: attemptResult.taskOutput,
    evolutionOutput: attemptResult.evolutionOutput,
  });
  const normalizedContract = validateSwarmCellContract(normalized);
  const contract = {
    ...attemptResult.contract,
    reasons: mergeReasons(attemptResult.contract?.reasons, normalizedContract.reasons),
    valid: Boolean(attemptResult.contract?.valid && normalizedContract.valid),
  };
  const runtimeResult = {
    ...attemptResult,
    taskOutput: normalized.taskOutput,
    evolutionOutput: normalized.evolutionOutput,
    contract,
    localMeta: null,
  };

  if (cell.localMetaHarness?.enabled) {
    runtimeResult.localMeta = await runLocalMetaHarness({
      workspaceRoot,
      cell,
      attempt: runtimeResult,
      archive: cell.localMetaHarness.archive !== false,
    });
  }

  return runtimeResult;
}
