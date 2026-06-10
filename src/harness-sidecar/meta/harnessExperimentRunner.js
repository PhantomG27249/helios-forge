import { createHarnessRun } from './harnessRunStore.js';
import { harnessMetricsDominate } from './harnessFrontier.js';

async function invokeRunner(runner, args) {
  if (typeof runner === 'function') {
    return runner(args);
  }
  if (typeof runner?.run === 'function') {
    return runner.run(args);
  }
  throw new Error('runner must be a function or expose run');
}

function compareMetrics({ baselineMetrics = {}, candidateMetrics = {} } = {}) {
  if (harnessMetricsDominate(candidateMetrics, baselineMetrics)) {
    return {
      preferred: 'candidate',
      reasons: ['candidate_dominates_baseline'],
    };
  }
  if (harnessMetricsDominate(baselineMetrics, candidateMetrics)) {
    return {
      preferred: 'baseline',
      reasons: ['baseline_dominates_candidate'],
    };
  }
  return {
    preferred: 'tie',
    reasons: ['pareto_incomparable'],
  };
}

export async function runHarnessExperiment({
  workspaceRoot,
  runId,
  candidate = {},
  baseline = {},
  baselineRunner,
  candidateRunner,
  localAgentSummary = {},
  memoryProposals = [],
  sourcePatch = '',
  configPatch = '',
  promotion = {},
  rollback = {},
  lineage = {},
  traceManifest = {},
  metricLineage = {},
  replayEvidence = {},
  sweep = {},
} = {}) {
  const baselineMetrics = await invokeRunner(baselineRunner, { candidate: baseline, role: 'baseline' });
  const candidateMetrics = await invokeRunner(candidateRunner, { candidate, role: 'candidate' });
  const preference = {
    ...compareMetrics({ baselineMetrics, candidateMetrics }),
    evidenceOnly: true,
    authority: 'advisory',
    pairwise: {
      baseline: baselineMetrics,
      candidate: candidateMetrics,
    },
  };
  const evals = {
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    preference,
  };
  const run = workspaceRoot
    ? await createHarnessRun({
      workspaceRoot,
      runId,
      candidate,
      localAgentSummary,
      memoryProposals,
      sourcePatch,
      configPatch,
      evals,
      promotion: {
        ...promotion,
        preference,
      },
      rollback,
      lineage,
      traceManifest,
      metricLineage,
      replayEvidence,
      sweep,
    })
    : null;

  return {
    candidate,
    baseline,
    baselineMetrics,
    candidateMetrics,
    preference,
    evals,
    run,
  };
}
