function signatureFor(genome) {
  const strategyName = genome.strategy?.name || 'unknown';
  const mutationKey = (genome.mutations || [])
    .map((mutation) => `${mutation.type}:${mutation.targetSubgoalId || ''}`)
    .sort()
    .join(',');
  const subgoalKey = (genome.subgoalIds || []).join(',');
  return `${strategyName}|${subgoalKey}|${mutationKey}`;
}

export function createDiversityTracker({ collapseThreshold = 0.25 } = {}) {
  return {
    score(genomes = []) {
      const signatures = genomes.map(signatureFor);
      const uniqueSignatures = new Set(signatures).size;
      const diversityScore = genomes.length <= 1
        ? 1
        : (uniqueSignatures - 1) / (genomes.length - 1);

      return {
        attempts: genomes.length,
        uniqueSignatures,
        diversityScore,
        collapsed: genomes.length > 0 && diversityScore <= collapseThreshold,
        signatures,
      };
    },
  };
}
