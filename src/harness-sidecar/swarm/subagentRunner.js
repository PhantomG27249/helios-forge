import { buildRolePrompt } from './rolePrompts.js';

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

    return {
      attemptId: attempt.attemptId,
      strategy: attempt.strategy,
      role,
      status: missingFields.length ? 'contract_failed' : 'completed',
      output,
      prompt,
      verifierEvidence,
      score: output?.score || 0,
      patchStats: inferPatchStats(output),
      contract: {
        requiredFields,
        missingFields,
        valid: missingFields.length === 0,
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
      prompt,
      verifierEvidence: [],
      score: 0,
      patchStats: { changedLines: 0 },
      contract: {
        requiredFields: outputContract.requiredFields || [],
        missingFields: outputContract.requiredFields || [],
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
