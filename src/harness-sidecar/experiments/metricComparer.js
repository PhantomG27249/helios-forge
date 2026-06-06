function roundDelta(value) {
  return Math.round(value * 1000000) / 1000000;
}

export function compareMetrics({ baseline = {}, candidate = {}, noiseThreshold = 0 }) {
  const metricNames = [...new Set([
    ...Object.keys(baseline),
    ...Object.keys(candidate),
  ])];

  const deltas = {};
  const noisyMetrics = [];

  for (const metricName of metricNames) {
    const delta = roundDelta((candidate[metricName] || 0) - (baseline[metricName] || 0));
    deltas[metricName] = delta;
    if (Math.abs(delta) < noiseThreshold) {
      noisyMetrics.push(metricName);
    }
  }

  return {
    deltas,
    noisyMetrics,
  };
}
