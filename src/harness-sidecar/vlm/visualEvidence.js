import {
  buildVisualBenchmarkCases,
  sanitizeVisualArtifactPath,
} from './visualBenchmarkCases.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function artifactPath(artifact = {}) {
  if (typeof artifact.path === 'string') return sanitizeVisualArtifactPath(artifact.path);
  if (typeof artifact.artifacts?.image === 'string') return sanitizeVisualArtifactPath(artifact.artifacts.image);
  if (typeof artifact.artifacts?.diff === 'string') return sanitizeVisualArtifactPath(artifact.artifacts.diff);
  if (typeof artifact.artifacts?.after === 'string') return sanitizeVisualArtifactPath(artifact.artifacts.after);
  if (typeof artifact.artifacts?.before === 'string') return sanitizeVisualArtifactPath(artifact.artifacts.before);
  return null;
}

function artifactHash(artifact = {}) {
  const hash = artifact.hash
    ?? artifact.artifactHash
    ?? artifact.sha256
    ?? artifact.checksum
    ?? artifact.artifacts?.hash
    ?? artifact.artifacts?.sha256;
  return hash ? stableString(hash, null) : null;
}

function sanitizedArtifactRecord(artifact = {}) {
  const sanitized = { ...artifact };
  const safePath = artifactPath(artifact);
  if (safePath) sanitized.path = safePath;
  else delete sanitized.path;
  if (artifact.artifacts && typeof artifact.artifacts === 'object') {
    const nested = {};
    for (const [key, value] of Object.entries(artifact.artifacts)) {
      if (typeof value !== 'string') {
        nested[key] = value;
        continue;
      }
      const safeNestedPath = sanitizeVisualArtifactPath(value);
      if (safeNestedPath) nested[key] = safeNestedPath;
    }
    sanitized.artifacts = nested;
  }
  return sanitized;
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
    artifactHash: artifactHash(artifact),
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
  const visualCases = buildVisualBenchmarkCases({
    taskId: normalizedTaskId,
    verifierResult,
    artifacts: visualArtifacts.map((artifact) => sanitizedArtifactRecord(artifact)),
  });
  const nodes = visualArtifacts.map((artifact, index) => buildNode({
    taskId: normalizedTaskId,
    artifact,
    verifierResult,
    index,
  }));
  const reason = visualReason(verifierResult);
  const rhoCases = nodes.map((node, index) => ({
    caseId: node.id,
    taskId: normalizedTaskId,
    reason,
    source: 'visual_evidence',
    verifierCase: {
      kind: 'visual',
      verifier: verifierResult.name || 'visual.verifier',
      score: node.score,
      confidence: node.confidence,
      visualCase: visualCases[index] || null,
      visualArtifacts: node.path ? [{
        type: node.artifactType,
        path: node.path,
        ...(node.artifactHash ? { hash: node.artifactHash } : {}),
      }] : [],
      findings: node.findings,
    },
  }));

  return {
    nodes,
    artifacts: visualArtifacts.map((artifact) => sanitizedArtifactRecord(artifact)),
    visualCases,
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
