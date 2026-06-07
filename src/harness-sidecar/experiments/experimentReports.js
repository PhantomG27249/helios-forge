export function compileExperimentReport({
  experiment,
  runs = [],
  metricComparison = {},
  decision = {},
}) {
  const metricLines = Object.entries(metricComparison.deltas || {})
    .map(([metric, delta]) => `- ${metric}: ${delta}`);
  const runLines = runs.map((run) => `- ${run.runId}: ${run.status} (${run.command || 'no command'})`);

  return [
    `# Experiment ${experiment.experimentId}`,
    '',
    '## Hypothesis',
    experiment.hypothesis || '',
    '',
    '## Runs',
    ...(runLines.length ? runLines : ['- No runs recorded.']),
    '',
    '## Metrics',
    ...(metricLines.length ? metricLines : ['- No metrics recorded.']),
    '',
    '## Noise',
    `Noisy metrics: ${(metricComparison.noisyMetrics || []).join(', ') || 'none'}`,
    '',
    '## Decision',
    decision.conclusion || 'pending',
    ...((decision.reasons || []).map((reason) => `- ${reason}`)),
    '',
  ].join('\n');
}
