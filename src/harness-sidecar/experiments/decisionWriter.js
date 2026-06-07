let decisionCounter = 0;

function makeDecisionId() {
  decisionCounter += 1;
  return `decision_${String(decisionCounter).padStart(4, '0')}`;
}

export function writeExperimentDecision({
  experiment,
  runs = [],
  metricComparison = {},
  noiseDecision = {},
  artifacts = [],
}) {
  const passedRun = runs.some((run) => run.status === 'passed');
  const hasMeaningfulChange = Boolean(noiseDecision.hasMeaningfulChange);
  const conclusion = passedRun && hasMeaningfulChange ? 'accept' : 'needs_review';

  return {
    decisionId: makeDecisionId(),
    experimentId: experiment.experimentId,
    hypothesis: experiment.hypothesis,
    conclusion,
    reasons: [
      passedRun ? 'passing_run' : 'no_passing_run',
      hasMeaningfulChange ? 'meaningful_metric_change' : 'no_meaningful_metric_change',
    ],
    evidence: {
      runIds: runs.map((run) => run.runId),
      artifactIds: artifacts.map((artifact) => artifact.artifactId),
      metricDeltas: metricComparison.deltas || {},
      noisyMetrics: metricComparison.noisyMetrics || [],
    },
    createdAt: new Date().toISOString(),
  };
}
