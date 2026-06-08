import { verifierFromGenome, validateVerifierGenome } from './verifierGenome.js';

const BASELINE_SAFETY_TAGS = new Set(['unit', 'smoke', 'security']);

function roundMetric(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function caseShouldPass(caseRecord = {}) {
  return caseRecord.expected?.shouldPass !== false;
}

function caseTags(caseRecord = {}) {
  return Array.isArray(caseRecord.expected?.tags) ? caseRecord.expected.tags : [];
}

function isBaselineSafetyCase(caseRecord = {}) {
  return caseTags(caseRecord).some((tag) => BASELINE_SAFETY_TAGS.has(tag));
}

function normalizeVerifierResults(results) {
  if (!Array.isArray(results)) return [];
  return results.map((result = {}) => ({
    ...result,
    passed: result.passed === true,
    cost: Number.isFinite(result.cost) ? result.cost : 0,
    durationMs: Number.isFinite(result.durationMs)
      ? result.durationMs
      : Number.isFinite(result.latencyMs)
        ? result.latencyMs
        : 0,
  }));
}

function candidatePassed(results) {
  return results.length > 0 && results.every((result) => result.passed);
}

function classify({ expectedPass, passed }) {
  if (!expectedPass && !passed) return 'truePositive';
  if (expectedPass && passed) return 'trueNegative';
  if (expectedPass && !passed) return 'falsePositive';
  return 'falseNegative';
}

function computeFlakiness(caseResults) {
  if (!caseResults.length) return 0;
  const byCase = new Map();
  for (const caseResult of caseResults) {
    const entries = byCase.get(caseResult.caseId) || [];
    entries.push(caseResult.passed);
    byCase.set(caseResult.caseId, entries);
  }
  const flakyCases = [...byCase.values()].filter((entries) => new Set(entries).size > 1).length;
  return roundMetric(flakyCases / byCase.size);
}

function baselineSafetyPassed(baselineResults = []) {
  const safetyResults = baselineResults
    .filter((result = {}) => BASELINE_SAFETY_TAGS.has(result.kind) || BASELINE_SAFETY_TAGS.has(result.name));
  return safetyResults.length > 0 && safetyResults.every((result) => result.passed !== false);
}

export async function runVerifierCandidate({
  genome,
  heldOutCases = [],
  baselineResults = [],
  verifierRunner,
  toolRegistry,
  emitEvent = () => {},
} = {}) {
  const validation = validateVerifierGenome(genome);
  if (!validation.valid) throw new Error(validation.errors[0]);
  if (typeof verifierRunner !== 'function') throw new Error('verifierRunner is required');

  const verifier = verifierFromGenome(genome);
  const candidateId = genome.genomeId;
  const startedAt = new Date().toISOString();
  const caseResults = [];
  const counts = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  };
  let totalCost = 0;
  let totalLatencyMs = 0;
  let resultCount = 0;
  const safetyFailures = [];

  await emitEvent({
    type: 'verifier_evolution.candidate_started',
    candidateId,
    verifier: verifier.name,
  });

  for (const caseRecord of heldOutCases) {
    const results = normalizeVerifierResults(await verifierRunner({
      genome,
      verifier,
      caseRecord,
      task: caseRecord.task,
      changedFiles: caseRecord.changedFiles || [],
      toolRegistry,
    }));
    const passed = candidatePassed(results);
    const expectedPass = caseShouldPass(caseRecord);
    const classification = classify({ expectedPass, passed });
    counts[classification] += 1;

    for (const result of results) {
      totalCost += result.cost;
      totalLatencyMs += result.durationMs;
      resultCount += 1;
    }

    if (isBaselineSafetyCase(caseRecord) && !passed) {
      safetyFailures.push(caseRecord.caseId);
    }

    const completedCase = {
      caseId: caseRecord.caseId,
      taskId: caseRecord.task?.taskId,
      expectedPass,
      passed,
      classification,
      changedFiles: caseRecord.changedFiles || [],
      resultCount: results.length,
      results,
    };
    caseResults.push(completedCase);

    await emitEvent({
      type: 'verifier_evolution.case_completed',
      candidateId,
      caseId: completedCase.caseId,
      passed,
      classification,
    });
  }

  if (!baselineSafetyPassed(baselineResults)) {
    safetyFailures.push('baseline_results');
  }

  const precisionDenominator = counts.truePositive + counts.falsePositive;
  const recallDenominator = counts.truePositive + counts.falseNegative;
  const metrics = {
    ...counts,
    precision: precisionDenominator ? roundMetric(counts.truePositive / precisionDenominator) : 0,
    recall: recallDenominator ? roundMetric(counts.truePositive / recallDenominator) : 0,
    flakiness: computeFlakiness(caseResults),
    averageCost: resultCount ? roundMetric(totalCost / resultCount) : 0,
    averageLatencyMs: resultCount ? roundMetric(totalLatencyMs / resultCount) : 0,
    safetyPassed: safetyFailures.length === 0,
  };
  const run = {
    candidateId,
    genomeId: genome.genomeId,
    startedAt,
    completedAt: new Date().toISOString(),
    metrics,
    cases: caseResults,
    safety: {
      passed: metrics.safetyPassed,
      failures: [...new Set(safetyFailures)],
    },
  };

  await emitEvent({
    type: 'verifier_evolution.candidate_completed',
    candidateId,
    metrics,
    safetyPassed: metrics.safetyPassed,
  });

  return run;
}
