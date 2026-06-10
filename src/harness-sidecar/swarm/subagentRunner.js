import { buildRolePrompt } from './rolePrompts.js';
import {
  normalizeEvolutionOutput,
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from './swarmCellContracts.js';

function missingRequiredFields(output, requiredFields = []) {
  return requiredFields.filter((field) => output?.[field] === undefined || output?.[field] === null);
}

function truncateOutput(output = {}, maxOutputChars) {
  if (!maxOutputChars) return { truncatedOutput: { ...output }, exceeded: false };

  let exceeded = false;
  const truncatedOutput = Object.fromEntries(Object.entries(output).map(([key, value]) => {
    if (typeof value !== 'string' || value.length <= maxOutputChars) {
      return [key, value];
    }
    exceeded = true;
    return [key, value.slice(0, maxOutputChars)];
  }));

  return { truncatedOutput, exceeded };
}

function inferPatchStats(output = {}) {
  if (output.patchStats) return output.patchStats;
  if (typeof output.patch !== 'string') return { changedLines: 0 };
  const changedLines = output.patch
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !line.startsWith('+++') && !line.startsWith('---'))
    .length;
  return { changedLines };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizedList(value) {
  return asArray(value)
    .flatMap((item) => {
      if (typeof item === 'string') return item.split('\n');
      return [item];
    })
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => {
      if (typeof item === 'string') return item.length > 0;
      return item !== undefined && item !== null;
    });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function nullableString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractChangedFilesFromPatch(patch) {
  if (typeof patch !== 'string') return [];
  return normalizedList(
    patch.split('\n')
      .map((line) => {
        const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
        return match?.[2];
      }),
  );
}

export function normalizeCompactHandoff(output = {}) {
  const handoff = output?.compactHandoff || output?.handoff || {};
  const filesChanged = normalizedList(
    handoff.filesChanged
      ?? handoff.changedFiles
      ?? output.filesChanged
      ?? output.changedFiles
      ?? extractChangedFilesFromPatch(output.patch),
  );
  return {
    summary: firstString(handoff.summary, output.summary),
    filesInspected: normalizedList(handoff.filesInspected ?? handoff.inspectedFiles ?? output.filesInspected ?? output.inspectedFiles),
    filesChanged,
    commandsRun: normalizedList(handoff.commandsRun ?? handoff.commands ?? output.commandsRun ?? output.commands),
    testsRun: normalizedList(handoff.testsRun ?? handoff.testCommands ?? output.testsRun ?? output.testCommands ?? output.verifierCommands ?? output.verifierEvidence),
    blocker: nullableString(handoff.blocker ?? output.blocker),
    nextAction: nullableString(handoff.nextAction ?? handoff.nextStep ?? output.nextAction ?? output.nextStep),
    sourcePointers: normalizedList(handoff.sourcePointers ?? handoff.sources ?? output.sourcePointers ?? output.sources),
    uncertainty: normalizedList(handoff.uncertainty ?? handoff.uncertainties ?? handoff.uncertaintyFlags ?? output.uncertainty ?? output.uncertainties ?? output.uncertaintyFlags),
    risks: normalizedList(handoff.risks ?? output.risks),
  };
}

export function scoreCompactHandoff(compactHandoff = {}) {
  const findings = [];
  let score = 0;

  if (compactHandoff.summary) score += 20;
  else findings.push('missing_summary');

  if (compactHandoff.filesInspected?.length) score += 10;
  else findings.push('missing_files_inspected');

  if (compactHandoff.filesChanged?.length) score += 10;
  else findings.push('missing_files_changed');

  if (compactHandoff.commandsRun?.length || compactHandoff.testsRun?.length) score += 20;
  else findings.push('missing_commands_or_tests');

  if (compactHandoff.blocker || compactHandoff.nextAction) score += 15;
  else findings.push('missing_blocker_or_next_action');

  if (compactHandoff.sourcePointers?.length) score += 10;
  else findings.push('missing_source_pointers');

  if (compactHandoff.uncertainty?.length || compactHandoff.risks?.length) score += 15;
  else findings.push('missing_uncertainty_or_risk_flags');

  return {
    score,
    findings,
    status: score >= 70 ? 'acceptable' : 'low_quality',
  };
}

async function dryRunAdapter() {
  return {
    summary: 'Dry run completed without invoking an external agent.',
    patch: '',
    verifierEvidence: [],
    score: 0,
  };
}

export async function runSubagentAttempt({
  task = {},
  attempt = {},
  role = 'implementer',
  context = {},
  budget = {},
  outputContract = {},
  commandAdapter = dryRunAdapter,
}) {
  const prompt = buildRolePrompt({ role, task, attempt, context, budget, outputContract });
  const startedAt = new Date().toISOString();

  try {
    const output = await commandAdapter({
      task,
      attempt,
      role,
      context,
      budget,
      outputContract,
      prompt,
    });
    const requiredFields = outputContract.requiredFields || [];
    const missingFields = missingRequiredFields(output, requiredFields);
    const { truncatedOutput, exceeded } = truncateOutput(output, budget.maxOutputChars);
    const verifierEvidence = output?.verifierEvidence || [];
    const compactHandoff = normalizeCompactHandoff(output);
    const handoffQuality = scoreCompactHandoff(compactHandoff);
    const swarmCellOutput = normalizeSwarmCellOutput({
      taskOutput: output,
      evolutionOutput: output?.evolutionOutput || output?.evolution || {},
    });
    const swarmCellContract = validateSwarmCellContract({
      taskOutput: output,
      evolutionOutput: output?.evolutionOutput || output?.evolution || {},
    });
    const contractValid = missingFields.length === 0 && swarmCellContract.valid;

    return {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      role,
      status: contractValid ? 'completed' : 'contract_failed',
      output,
      taskOutput: swarmCellOutput.taskOutput,
      evolutionOutput: swarmCellOutput.evolutionOutput,
      compactHandoff,
      handoffQuality,
      prompt,
      verifierEvidence,
      score: output?.score || 0,
      patchStats: inferPatchStats(output),
      contract: {
        requiredFields,
        missingFields,
        reasons: swarmCellContract.reasons,
        valid: contractValid,
      },
      budget: {
        ...budget,
        exceeded,
        truncatedOutput,
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      role,
      status: 'failed',
      output: null,
      taskOutput: null,
      evolutionOutput: normalizeEvolutionOutput({}),
      prompt,
      verifierEvidence: [],
      score: 0,
      patchStats: { changedLines: 0 },
      contract: {
        requiredFields: outputContract.requiredFields || [],
        missingFields: outputContract.requiredFields || [],
        reasons: ['attempt_failed'],
        valid: false,
      },
      budget: {
        ...budget,
        exceeded: false,
        truncatedOutput: {},
      },
      error: error.message,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
