import { normalizeEvolutionOutput } from './swarmCellContracts.js';
import { runSwarmAttemptsBounded } from './swarmExecutor.js';
import { runSwarmCell } from './swarmCellRuntime.js';

const DEFAULT_MAX_CONCURRENCY = 3;

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueList(items) {
  return [...new Set(items)];
}

function mergeEvolutionOutputs(evolutionOutputs = []) {
  const normalized = evolutionOutputs.map((output) => normalizeEvolutionOutput(output || {}));
  const merged = normalizeEvolutionOutput({});

  merged.hardCaseTags = uniqueList(normalized.flatMap((output) => output.hardCaseTags || []));
  merged.evidenceRefs = uniqueList(normalized.flatMap((output) => output.evidenceRefs || []));
  merged.memoryProposals = normalized.flatMap((output) => output.memoryProposals || []);
  merged.evolutionLevelRefs = uniqueList(normalized.flatMap((output) => output.evolutionLevelRefs || []));

  const scalarFields = [
    'roleWeakness',
    'suggestedProfileChange',
    'suggestedSkill',
    'suggestedCodeChange',
    'suggestedVerifierChange',
    'suggestedPolicyChange',
    'suggestedMemoryPolicyChange',
    'suggestedMemoryChange',
  ];

  for (const field of scalarFields) {
    for (const output of normalized) {
      if (output[field] != null) merged[field] = output[field];
    }
  }

  const soulRefs = normalized.map((output) => output.soulRefs).filter(Boolean);
  if (soulRefs.length) merged.soulRefs = soulRefs[soulRefs.length - 1];

  merged.durableApplyRequested = normalized.some((output) => output.durableApplyRequested);
  merged.durableApplyApproved = false;

  return merged;
}

function resolveCellBudget({ cell, budget = {}, cellBudgets = [] } = {}) {
  const allocated = cellBudgets.find((entry) => entry.cellId === cell.cellId);
  return allocated?.budget || budget[cell.cellId] || budget;
}

function applyFeatureFlags(cell, featureFlags = {}) {
  if (!featureFlags?.localMetaHarness) return cell;
  return {
    ...cell,
    localMetaHarness: {
      ...(cell.localMetaHarness || {}),
      enabled: true,
    },
  };
}

export async function orchestrateNestedSwarm({
  workspaceRoot,
  cells = [],
  task = {},
  commandAdapter,
  featureFlags = {},
  budget = {},
  context = {},
} = {}) {
  const cellBudgets = asArray(budget.cells);
  const preparedCells = cells.map((cell) => applyFeatureFlags(cell, featureFlags));
  const concurrency = Math.min(DEFAULT_MAX_CONCURRENCY, Math.max(1, preparedCells.length));

  const cellResults = await runSwarmAttemptsBounded({
    attempts: preparedCells.map((cell, index) => ({ ...cell, attemptId: cell.cellId || `cell_${index + 1}` })),
    concurrency,
    runAttempt: async ({ attempt: cell, index }) => {
      const cellBudget = resolveCellBudget({ cell, budget, cellBudgets });
      const result = await runSwarmCell({
        workspaceRoot,
        cell,
        task,
        attempt: {
          attemptId: cell.cellId || `cell_${index + 1}`,
          strategy: cell.role || 'implementer',
        },
        role: cell.role || 'implementer',
        context: {
          ...context,
          nestedSwarm: true,
          featureFlags,
        },
        budget: cellBudget,
        outputContract: cell.outputContract || {},
        commandAdapter,
      });

      return {
        cellId: cell.cellId,
        role: cell.role,
        ...result,
      };
    },
  });

  const mergedEvolutionOutput = mergeEvolutionOutputs(cellResults.map((result) => result.evolutionOutput));

  return {
    cells: cellResults,
    mergedEvolutionOutput,
    evidenceOnly: true,
    canPromote: false,
  };
}
