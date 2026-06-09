import { scoreSelfConsistency } from './selfConsistency.js';
import { scoreSelfValidation } from './selfValidation.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectCoresetItems(coreset) {
  if (Array.isArray(coreset)) return coreset;
  return asArray(coreset?.items ?? coreset?.traces ?? coreset?.cases);
}

function caseId(item, index) {
  return String(item?.caseId ?? item?.taskId ?? item?.id ?? `case_${index + 1}`);
}

function summarizeValidation(rollouts) {
  const results = rollouts.map(scoreSelfValidation);
  const passedCount = results.filter((result) => result.passed).length;
  return {
    passed: rollouts.length > 0 && passedCount === rollouts.length,
    passedCount,
    total: rollouts.length,
    score: passedCount,
    results,
  };
}

async function runVariant({ item, itemIndex, groupSize, variant, runner }) {
  const rollouts = [];
  for (let rolloutIndex = 0; rolloutIndex < groupSize; rolloutIndex += 1) {
    rollouts.push(await runner({
      item,
      itemIndex,
      rolloutIndex,
      variant,
    }));
  }

  return {
    rollouts,
    validation: summarizeValidation(rollouts),
    consistency: scoreSelfConsistency({ rollouts }),
  };
}

export async function runRhoReplayBatch({
  coreset,
  groupSize = 1,
  baselineRunner,
  candidateRunner,
} = {}) {
  if (typeof baselineRunner !== 'function') throw new Error('baselineRunner must be a function');
  if (typeof candidateRunner !== 'function') throw new Error('candidateRunner must be a function');

  const safeGroupSize = Math.max(1, Math.floor(Number(groupSize) || 1));
  const items = collectCoresetItems(coreset);
  const cases = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const baseline = await runVariant({
      item,
      itemIndex,
      groupSize: safeGroupSize,
      variant: 'baseline',
      runner: baselineRunner,
    });
    const candidate = await runVariant({
      item,
      itemIndex,
      groupSize: safeGroupSize,
      variant: 'candidate',
      runner: candidateRunner,
    });

    cases.push({
      caseId: caseId(item, itemIndex),
      item,
      baseline,
      candidate,
    });
  }

  return {
    groupSize: safeGroupSize,
    caseCount: cases.length,
    cases,
  };
}
