const CASE_KIND_DEFAULTS = {
  ocr: {
    expectedArtifactKinds: ['screenshot', 'ocr'],
    route: ['ocr', 'vlm_fast'],
    escalationRoute: ['ocr', 'vlm_high_accuracy'],
    downshiftRoute: ['ocr'],
    tokensEstimated: 1200,
  },
  pdf: {
    expectedArtifactKinds: ['pdf_page'],
    route: ['pdf', 'ocr', 'vlm_fast'],
    escalationRoute: ['pdf', 'ocr', 'vlm_high_accuracy'],
    downshiftRoute: ['pdf', 'ocr'],
    tokensEstimated: 1600,
  },
  diagram: {
    expectedArtifactKinds: ['diagram'],
    route: ['diagram', 'vlm_fast'],
    escalationRoute: ['diagram', 'vlm_high_accuracy'],
    downshiftRoute: ['diagram', 'vlm_fast'],
    tokensEstimated: 1800,
  },
  chart: {
    expectedArtifactKinds: ['chart'],
    route: ['chart', 'vlm_fast'],
    escalationRoute: ['chart', 'vlm_high_accuracy'],
    downshiftRoute: ['chart', 'vlm_fast'],
    tokensEstimated: 1800,
  },
  ui_regression: {
    expectedArtifactKinds: ['visual_diff'],
    route: ['screenshot', 'diff', 'vlm_fast'],
    escalationRoute: ['screenshot', 'diff', 'vlm_high_accuracy'],
    downshiftRoute: ['screenshot', 'diff'],
    tokensEstimated: 1400,
  },
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(0, Math.min(1, normalized));
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

export function sanitizeVisualArtifactPath(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) return null;
  const normalized = raw.replaceAll('\\', '/').split('/').filter(Boolean);
  if (normalized.includes('..')) return null;
  const joined = normalized.join('/');
  if (/(sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_-]+|password\s*[:=]|token\s*[:=]|secret\s*[:=]|api[_-]?key\s*[:=])/i.test(joined)) {
    return null;
  }
  return joined;
}

function artifactId(artifact = {}, index = 0) {
  return stableString(artifact.artifactId ?? artifact.id, `artifact_${index + 1}`);
}

function artifactType(artifact = {}) {
  return stableString(artifact.type ?? artifact.kind, 'visual_artifact').toLowerCase();
}

function hasOcrSignal(artifact = {}) {
  return artifact.metadata?.ocrConfidence !== undefined
    || artifact.metadata?.ocrTextLength !== undefined
    || artifact.visualContext?.kind === 'ocr'
    || artifact.ocrConfidence !== undefined;
}

function inferBenchmarkKind(artifact = {}) {
  const type = artifactType(artifact);
  const explicit = artifact.benchmarkKind || artifact.visualCaseKind || artifact.metadata?.benchmarkKind;
  if (CASE_KIND_DEFAULTS[explicit]) return explicit;
  if (type.includes('pdf')) return 'pdf';
  if (type.includes('diagram')) return 'diagram';
  if (type.includes('chart') || type.includes('plot')) return 'chart';
  if (type.includes('diff') || type.includes('regression')) return 'ui_regression';
  if (hasOcrSignal(artifact)) return 'ocr';
  return 'ui_regression';
}

function signalNumber(...values) {
  for (const value of values) {
    const normalized = Number(value);
    if (Number.isFinite(normalized)) return clamp01(normalized);
  }
  return null;
}

function confidenceSignals({ artifact = {}, verifierResult = {} }) {
  const verifierScore = signalNumber(verifierResult.score);
  const verifierConfidence = signalNumber(verifierResult.confidence);
  const ocrConfidence = signalNumber(artifact.metadata?.ocrConfidence, artifact.ocrConfidence);
  const artifactSupported = Boolean(artifactPath(artifact));
  const values = [verifierScore, verifierConfidence, ocrConfidence].filter((value) => value !== null);
  const aggregateConfidence = values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000
    : null;

  return {
    verifierScore,
    verifierConfidence,
    ocrConfidence,
    artifactSupported,
    evidenceCount: artifactSupported ? 1 : 0,
    aggregateConfidence,
    lowConfidence: values.some((value) => value < 0.5) || artifactSupported === false,
  };
}

function tokenEstimate({ artifact = {}, benchmarkKind }) {
  const explicit = Number(
    artifact.visualContext?.tokensEstimated
      ?? artifact.tokensEstimated
      ?? artifact.metadata?.tokensEstimated,
  );
  if (Number.isFinite(explicit) && explicit > 0) return Math.ceil(explicit);
  return CASE_KIND_DEFAULTS[benchmarkKind]?.tokensEstimated ?? 1200;
}

export function buildVisualBenchmarkCases({
  taskId = 'visual_task',
  verifierResult = {},
  artifacts,
} = {}) {
  const normalizedTaskId = stableString(taskId, 'visual_task');
  return asArray(artifacts ?? verifierResult.artifacts)
    .filter((artifact) => artifact && typeof artifact === 'object')
    .map((artifact, index) => {
      const id = artifactId(artifact, index);
      const benchmarkKind = inferBenchmarkKind(artifact);
      const defaults = CASE_KIND_DEFAULTS[benchmarkKind];
      const signals = confidenceSignals({ artifact, verifierResult });
      const tokensEstimated = tokenEstimate({ artifact, benchmarkKind });
      return {
        caseId: `visual_case:${normalizedTaskId}:${id}`,
        taskId: normalizedTaskId,
        artifactId: id,
        benchmarkKind,
        artifactType: artifact.type || 'visual_artifact',
        artifactPaths: [artifactPath(artifact)].filter(Boolean),
        expectedArtifactKinds: defaults.expectedArtifactKinds,
        confidenceSignals: signals,
        budget: {
          tokensEstimated,
          routeCost: tokensEstimated >= 1800 ? 'high' : tokensEstimated >= 1400 ? 'medium' : 'low',
        },
        routeHints: {
          preferredRoute: defaults.route,
          escalationRoute: defaults.escalationRoute,
          downshiftRoute: defaults.downshiftRoute,
        },
      };
    });
}

function budgetPressure(budget = {}) {
  if (Number.isFinite(Number(budget.pressure))) return clamp01(budget.pressure);
  if (Number.isFinite(Number(budget.budgetPressure))) return clamp01(budget.budgetPressure);
  if (Number.isFinite(Number(budget.budgetPercent))) return clamp01(Number(budget.budgetPercent) / 100);
  return 0;
}

export function recommendBudgetAwareVlmRoute({ visualCase = {}, budget = {} } = {}) {
  const kind = CASE_KIND_DEFAULTS[visualCase.benchmarkKind] ? visualCase.benchmarkKind : 'ui_regression';
  const defaults = CASE_KIND_DEFAULTS[kind];
  const pressure = budgetPressure(budget);
  const remainingVisionTokens = Number(budget.remainingVisionTokens ?? budget.remainingTokens);
  const maxVisionTokens = Number.isFinite(remainingVisionTokens) && remainingVisionTokens > 0
    ? Math.floor(remainingVisionTokens)
    : null;
  const tokensEstimated = Number(visualCase.budget?.tokensEstimated ?? defaults.tokensEstimated);
  const lowConfidence = visualCase.confidenceSignals?.lowConfidence === true;
  const constrained = pressure >= 0.85 || (maxVisionTokens !== null && tokensEstimated > maxVisionTokens);
  const decision = constrained ? 'downshift' : lowConfidence ? 'escalate' : 'standard';
  const route = decision === 'downshift'
    ? defaults.downshiftRoute
    : decision === 'escalate'
      ? defaults.escalationRoute
      : defaults.route;

  return {
    decision,
    route,
    budget: {
      pressure,
      remainingVisionTokens: maxVisionTokens,
      tokensEstimated,
    },
    maxVisionTokens,
    reasons: [
      constrained ? 'visual_budget_pressure' : null,
      lowConfidence ? 'low_visual_confidence' : null,
    ].filter(Boolean),
  };
}
