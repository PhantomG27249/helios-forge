export function classifyNoise({ deltas = {}, thresholds = {}, defaultThreshold = 0 } = {}) {
  const noisyMetrics = [];
  const meaningfulMetrics = [];

  for (const [metricName, delta] of Object.entries(deltas)) {
    const threshold = thresholds[metricName] ?? defaultThreshold;
    if (Math.abs(delta) < threshold) {
      noisyMetrics.push(metricName);
    } else {
      meaningfulMetrics.push(metricName);
    }
  }

  return {
    noisyMetrics,
    meaningfulMetrics,
    hasMeaningfulChange: meaningfulMetrics.length > 0,
  };
}
