const THRESHOLDS = {
  strict: { passThreshold: 0.9, confidenceThreshold: 0.75 },
  balanced: { passThreshold: 0.75, confidenceThreshold: 0.6 },
  exploratory: { passThreshold: 0.6, confidenceThreshold: 0.45 },
};

function normalizeExpected(expected) {
  if (expected === undefined || expected === null) return [];
  return Array.isArray(expected) ? expected : [expected];
}

export function createVisualVerifierRubric({
  goal,
  expected = [],
  artifactTypes = [],
  strictness = 'balanced',
} = {}) {
  const normalizedStrictness = THRESHOLDS[strictness] ? strictness : 'balanced';
  const normalizedExpected = normalizeExpected(expected);
  const normalizedArtifactTypes = normalizeExpected(artifactTypes);
  const thresholds = THRESHOLDS[normalizedStrictness];
  const prompt = [
    'You are the Helios visual verifier.',
    `Goal: ${goal || 'No explicit goal provided.'}`,
    `Artifact types: ${normalizedArtifactTypes.length ? normalizedArtifactTypes.join(', ') : 'none'}`,
    `Expected evidence: ${normalizedExpected.length ? normalizedExpected.join('; ') : 'none'}`,
    'Judge whether the supplied visual artifacts satisfy the goal. Return one JSON object with score, confidence, findings, and optional passed.',
  ].join('\n');

  return {
    rubricVersion: 1,
    strictness: normalizedStrictness,
    prompt,
    expected: normalizedExpected,
    passThreshold: thresholds.passThreshold,
    confidenceThreshold: thresholds.confidenceThreshold,
  };
}
