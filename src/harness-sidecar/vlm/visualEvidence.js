function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function artifactPath(artifact = {}) {
  if (typeof artifact.path === 'string') return artifact.path;
  if (typeof artifact.artifacts?.image === 'string') return artifact.artifacts.image;
  if (typeof artifact.artifacts?.diff === 'string') return artifact.artifacts.diff;
  if (typeof artifact.artifacts?.after === 'string') return artifact.artifacts.after;
  if (typeof artifact.artifacts?.before === 'string') return artifact.artifacts.before;
  return null;
}

function visualReason(verifierResult = {}) {
  if (verifierResult.reason === 'visual_artifact_unavailable') return 'vlm_missed_artifact';
  if (verifierResult.modelPassed === true && verifierResult.passed === false) return 'visual_false_positive';
  if (verifierResult.passed === false) return 'visual_false_negative';
  return 'screenshot_diff_failure';
}

function buildNode({ taskId, artifact, verifierResult, index }) {
  const artifactId = stableString(artifact.artifactId ?? artifact.id, `artifact_${index + 1}`);
  return {
    id: `visual_evidence:${taskId}:${artifactId}`,
    type: 'visual_evidence',
    artifactId,
    artifactType: artifact.type || 'visual_artifact',
    path: artifactPath(artifact),
    passed: verifierResult.passed === true,
    score: Number.isFinite(Number(verifierResult.score)) ? Number(verifierResult.score) : null,
    confidence: Number.isFinite(Number(verifierResult.confidence)) ? Number(verifierResult.confidence) : null,
    findings: asArray(verifierResult.findings),
  };
}

export function buildVisualEvidenceBundle({
  taskId = 'visual_task',
  verifierResult = {},
  artifacts,
} = {}) {
  const normalizedTaskId = stableString(taskId, 'visual_task');
  const visualArtifacts = asArray(artifacts ?? verifierResult.artifacts)
    .filter((artifact) => artifact && typeof artifact === 'object');
  const nodes = visualArtifacts.map((artifact, index) => buildNode({
    taskId: normalizedTaskId,
    artifact,
    verifierResult,
    index,
  }));
  const reason = visualReason(verifierResult);
  const rhoCases = nodes.map((node) => ({
    caseId: node.id,
    taskId: normalizedTaskId,
    reason,
    source: 'visual_evidence',
    verifierCase: {
      kind: 'visual',
      verifier: verifierResult.name || 'visual.verifier',
      score: node.score,
      confidence: node.confidence,
      visualArtifacts: node.path ? [{ type: node.artifactType, path: node.path }] : [],
      findings: node.findings,
    },
  }));

  return {
    nodes,
    artifacts: visualArtifacts,
    verdict: {
      passed: verifierResult.passed === true,
      score: Number.isFinite(Number(verifierResult.score)) ? Number(verifierResult.score) : null,
      confidence: Number.isFinite(Number(verifierResult.confidence)) ? Number(verifierResult.confidence) : null,
      reason,
    },
    rhoCases,
    memoryGraph: {
      nodeIds: nodes.map((node) => node.id),
      nodes,
      edges: nodes.map((node) => ({
        from: `task:${normalizedTaskId}`,
        to: node.id,
        type: 'has_visual_evidence',
      })),
      conflicts: [],
    },
  };
}
