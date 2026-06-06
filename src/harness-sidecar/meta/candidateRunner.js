export function recordCandidateRun({ candidateId, smokePassed, metrics = {} }) {
  return {
    candidateId,
    smokePassed,
    metrics: {
      quality: metrics.quality ?? 0,
      cost: metrics.cost ?? 1,
      latency: metrics.latency ?? 1,
      safety: metrics.safety ?? 0,
    },
    evaluatedAt: new Date().toISOString(),
  };
}
