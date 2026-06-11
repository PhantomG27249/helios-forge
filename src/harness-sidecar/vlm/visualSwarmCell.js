import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
import { sanitizeVisualArtifactPath } from './visualBenchmarkCases.js';

export const ACCEPTED_VISUAL_TASK_KINDS = Object.freeze([
  'screenshot',
  'ui_state',
  'diagram',
  'plot',
  'pdf',
  'ocr',
  'chart',
  'generated_artifact',
]);

const ACCEPTED_KIND_SET = new Set(ACCEPTED_VISUAL_TASK_KINDS);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function nonEmptyString(value, fallback = null) {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function strictNonEmptyString(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  const text = value.trim();
  return text || fallback;
}

function normalizeEvidenceRefs(value) {
  const refs = asArray(value);
  const invalidRef = refs.some((item) => !strictNonEmptyString(item));
  if (invalidRef) {
    throw new Error('visual SwarmCell evidenceRefs must be non-empty strings');
  }

  return refs
    .map((item) => strictNonEmptyString(item))
    .filter(Boolean);
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const text = strictNonEmptyString(value);
    if (text) return text;
  }
  return null;
}

function artifactPath(source = {}) {
  const paths = [
    source.path,
    source.artifacts?.path,
    source.artifacts?.image,
    source.artifacts?.diff,
    source.artifacts?.after,
    source.artifacts?.before,
  ].map((path) => strictNonEmptyString(path)).filter(Boolean);

  if (paths.length === 0) return { safePath: null, unsafePath: false };

  const safePaths = paths.map((path) => sanitizeVisualArtifactPath(path));
  return {
    safePath: safePaths.find(Boolean) ?? null,
    unsafePath: safePaths.some((safePath) => safePath === null),
  };
}

function artifactHash(artifact = {}) {
  const hashFields = [
    artifact.artifactHash,
    artifact.hash,
    artifact.digest,
    artifact.sha256,
    artifact.checksum,
    artifact.artifacts?.artifactHash,
    artifact.artifacts?.hash,
    artifact.artifacts?.digest,
    artifact.artifacts?.sha256,
  ];
  const invalidHash = hashFields.some((value) => value !== undefined && !strictNonEmptyString(value));
  if (invalidHash) {
    throw new Error('visual SwarmCell artifact hash must be a non-empty string');
  }

  return firstNonEmptyString(
    artifact.artifactHash,
    artifact.hash,
    artifact.digest,
    artifact.sha256,
    artifact.checksum,
    artifact.artifacts?.artifactHash,
    artifact.artifacts?.hash,
    artifact.artifacts?.digest,
    artifact.artifacts?.sha256,
  );
}

function normalizeArtifact(artifact = {}, index = 0) {
  const source = artifact && typeof artifact === 'object' && !Array.isArray(artifact) ? artifact : {};
  const { safePath, unsafePath } = artifactPath(source);
  const hash = artifactHash(source);

  return {
    artifactId: nonEmptyString(source.artifactId ?? source.id, `visual_artifact_${index + 1}`),
    type: nonEmptyString(source.type, 'visual_artifact'),
    ...(safePath ? { path: safePath } : {}),
    ...(hash ? { artifactHash: hash, hash } : {}),
    __unsafeArtifactPath: unsafePath,
  };
}

function isVisualImpacting(task = {}) {
  return task.visualImpacting === true
    || task.visualImpact === true
    || task.visualEvidenceRequired === true
    || ACCEPTED_KIND_SET.has(task.kind);
}

export function validateVisualSwarmCellEvidence({
  task = {},
  evidenceRefs,
  artifacts,
  visualEvidence = {},
} = {}) {
  const normalizedEvidenceRefs = normalizeEvidenceRefs(
    evidenceRefs ?? task.evidenceRefs ?? visualEvidence.evidenceRefs,
  );
  if (normalizedEvidenceRefs.length === 0) {
    throw new Error('visual SwarmCell evidenceRefs are required');
  }

  const normalizedArtifacts = asArray(artifacts ?? visualEvidence.artifacts ?? task.artifacts)
    .filter((artifact) => artifact && typeof artifact === 'object')
    .map((artifact, index) => normalizeArtifact(artifact, index));

  if (isVisualImpacting(task)) {
    if (normalizedArtifacts.length === 0) {
      throw new Error('visual SwarmCell visual artifacts are required for visual-impacting evidence');
    }
    const unsafePath = normalizedArtifacts.find((artifact) => artifact.__unsafeArtifactPath);
    if (unsafePath) {
      throw new Error(`visual SwarmCell artifact path is unsafe for ${unsafePath.artifactId}`);
    }
    const missingHash = normalizedArtifacts.find((artifact) => !artifact.artifactHash);
    if (missingHash) {
      throw new Error(`visual SwarmCell artifact hash is required for ${missingHash.artifactId}`);
    }
  }

  const contractArtifacts = normalizedArtifacts.map(({ __unsafeArtifactPath, ...artifact }) => artifact);

  return {
    valid: true,
    evidenceRefs: normalizedEvidenceRefs,
    artifacts: contractArtifacts,
    evidenceOnly: true,
    promotionAllowed: false,
    applyAllowed: false,
  };
}

export function normalizeVisualSwarmCellTask(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const kind = nonEmptyString(source.kind, 'screenshot');
  if (!ACCEPTED_KIND_SET.has(kind)) {
    throw new Error(`Unsupported visual task kind: ${kind}`);
  }

  const evidence = validateVisualSwarmCellEvidence({
    task: { ...source, kind, visualImpacting: true },
    evidenceRefs: source.evidenceRefs,
    artifacts: source.artifacts,
    visualEvidence: source.visualEvidence,
  });

  return {
    taskId: nonEmptyString(source.taskId, 'visual_task'),
    kind,
    goal: nonEmptyString(source.goal, ''),
    visualImpacting: true,
    evidenceRefs: evidence.evidenceRefs,
    artifacts: evidence.artifacts,
    evidenceOnly: true,
  };
}

export function createVisualSwarmCell({
  modelVisibleSummary = null,
  featureGate = 'productionCapabilities.visualSwarmCell',
} = {}) {
  const quarantinedSummary = modelVisibleSummary
    ? quarantineModelVisiblePayload(modelVisibleSummary)
    : { value: null, quarantined: false, reasons: [], redacted: false };

  return {
    cellId: 'visual',
    role: 'visual_vlm',
    localAgents: ['visual_vlm', 'verifier', 'reviewer'],
    featureGate,
    authority: 'evidence_only',
    evidenceOnly: true,
    actions: ['capture', 'observe', 'verify', 'summarize'],
    acceptedTaskKinds: [...ACCEPTED_VISUAL_TASK_KINDS],
    localMetaHarness: { enabled: true },
    localMemoryGraph: { enabled: true },
    mutationPolicy: { durableApply: 'global_only' },
    outputContract: {
      requiredFields: ['summary', 'evolutionOutput', 'evidenceRefs'],
      visualEvidenceRequired: true,
      artifactHashesRequired: true,
      evolutionOutput: { required: true },
    },
    modelVisibleSummary: quarantinedSummary,
  };
}

export function isVisualSwarmCellEnabled(config = {}) {
  return config?.productionCapabilities?.visualSwarmCell?.enabled === true
    || config?.features?.visualArtifacts === true;
}
