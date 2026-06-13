import { createHash } from 'node:crypto';

import { sanitizeCandidateId } from '../meta/frontierStore.js';
import { detectPromptInjection } from '../security/promptInjectionFilter.js';
import { stableStringify } from './artifactManifest.js';
import { sanitizeVisualArtifactPath } from './visualBenchmarkCases.js';

const CASE_KIND_DEFAULTS = Object.freeze({
  ui_regression: Object.freeze(['visual_diff', 'screenshot']),
  pdf: Object.freeze(['pdf_page']),
  ocr: Object.freeze(['ocr']),
  chart: Object.freeze(['chart']),
  diagram: Object.freeze(['diagram']),
});

const QUARANTINED_TEXT = 'Visual evidence text was quarantined because prompt-injection patterns were detected.';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function stableString(value, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text || fallback;
}

function stableHash(value, chars = 16) {
  return createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, chars);
}

export function normalizeVisualReplayCaseKind(kind = '') {
  const normalized = String(kind || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['ui', 'ui_regression', 'screenshot', 'screenshot_diff', 'visual_diff', 'diff'].includes(normalized)) {
    return 'ui_regression';
  }
  if (['pdf', 'pdf_page', 'pdf_render', 'page', 'page_render'].includes(normalized)) return 'pdf';
  if (['ocr', 'ocr_text', 'text_recognition'].includes(normalized)) return 'ocr';
  if (['chart', 'plot', 'graph', 'figure_chart'].includes(normalized)) return 'chart';
  if (['diagram', 'mermaid', 'mermaid_diagram', 'flowchart'].includes(normalized)) return 'diagram';
  return 'ui_regression';
}

function artifactHash(artifact = {}) {
  return stableString(
    artifact.artifactHash ?? artifact.hash ?? artifact.sha256 ?? artifact.checksum,
    '',
  ) || stableHash({
    path: artifact.path,
    type: artifact.type ?? artifact.kind,
    content: artifact.content,
    metadata: artifact.metadata,
  });
}

function normalizeArtifact(artifact = {}, index = 0) {
  const path = sanitizeVisualArtifactPath(artifact.path ?? artifact.filePath ?? artifact.uri);
  return {
    artifactId: sanitizeCandidateId(artifact.artifactId ?? artifact.id ?? `artifact_${index + 1}`),
    type: stableString(artifact.type ?? artifact.kind, 'visual_artifact'),
    ...(path ? { path } : {}),
    artifactHash: artifactHash(artifact),
  };
}

function normalizeReplayCase(testCase = {}, index = 0) {
  const kind = normalizeVisualReplayCaseKind(
    testCase.kind ?? testCase.caseKind ?? testCase.benchmarkKind ?? testCase.type,
  );
  return {
    caseId: sanitizeCandidateId(testCase.caseId ?? testCase.id ?? `visual_case_${index + 1}`),
    kind,
    expectedArtifactKinds: [...CASE_KIND_DEFAULTS[kind]],
    artifacts: asArray(testCase.artifacts).map(normalizeArtifact),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    authority: 'visual_evidence_only',
    canPromote: false,
  };
}

export function createVisualReplaySuite({
  suiteId = 'visual-replay-suite',
  description = '',
  cases = [],
  tags = [],
} = {}) {
  return {
    schemaVersion: 1,
    suiteId: sanitizeCandidateId(suiteId),
    description,
    locked: true,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    authority: 'visual_evidence_only',
    canPromote: false,
    tags: asArray(tags).map(String).filter(Boolean),
    cases: asArray(cases).map(normalizeReplayCase),
  };
}

function normalizeSuite(suite = {}) {
  if (suite.schemaVersion === 1 && Array.isArray(suite.cases)) {
    return {
      ...suite,
      suiteId: sanitizeCandidateId(suite.suiteId || 'visual-replay-suite'),
      locked: true,
      visualEvidenceRequired: true,
      evidenceOnly: true,
      authority: 'visual_evidence_only',
      canPromote: false,
      cases: suite.cases.map(normalizeReplayCase),
    };
  }
  return createVisualReplaySuite(suite);
}

function resultForCase(results = [], testCase = {}) {
  const ids = new Set([testCase.caseId, sanitizeCandidateId(testCase.caseId)]);
  return asArray(results).find((result = {}) => (
    ids.has(result.caseId) || ids.has(sanitizeCandidateId(result.caseId ?? result.id))
  )) || {};
}

function quarantineForText(...texts) {
  const categories = new Set();
  for (const text of texts.map((value) => String(value || '')).filter(Boolean)) {
    const detection = detectPromptInjection(text);
    for (const category of detection.categories) categories.add(category);
  }
  return {
    status: categories.size > 0 ? 'quarantined' : 'clean',
    categories: [...categories].sort((left, right) => left.localeCompare(right)),
  };
}

function safeText(value, quarantine) {
  if (!value) return '';
  return quarantine.status === 'quarantined' ? QUARANTINED_TEXT : String(value);
}

function normalizeCaseResult({ testCase, result = {}, runId }) {
  const expectedHashes = testCase.artifacts.map((artifact) => artifact.artifactHash);
  const resultHashes = asArray(result.artifactHashes ?? result.artifactHash)
    .map(String)
    .filter(Boolean);
  const artifactHashes = [...new Set([...expectedHashes, ...resultHashes])].sort();
  const providedHashes = new Set(resultHashes);
  const artifactEvidencePresent = expectedHashes.length === 0
    ? resultHashes.length > 0
    : expectedHashes.some((hash) => providedHashes.has(hash));
  const passed = result.passed === true;
  const quarantine = quarantineForText(result.modelVisibleText, result.dashboardText, result.text);

  return {
    caseId: testCase.caseId,
    runId,
    kind: testCase.kind,
    passed,
    score: round(clamp01(result.score)),
    confidence: round(clamp01(result.confidence)),
    artifactHashes,
    artifactEvidencePresent,
    modelVisibleText: safeText(result.modelVisibleText ?? result.text, quarantine),
    dashboardText: safeText(result.dashboardText ?? result.modelVisibleText ?? result.text, quarantine),
    quarantine,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    authority: 'visual_evidence_only',
    canPromote: false,
  };
}

function metricsFor(caseResults = []) {
  const caseCount = caseResults.length;
  const passedCount = caseResults.filter((entry) => entry.passed).length;
  const failedEvidenceCount = caseResults.filter((entry) => (
    !entry.passed || entry.quarantine.status === 'quarantined'
  )).length;
  const artifactCovered = caseResults.filter((entry) => entry.artifactEvidencePresent).length;
  const scoreTotal = caseResults.reduce((sum, entry) => sum + entry.score, 0);
  const confidenceTotal = caseResults.reduce((sum, entry) => sum + entry.confidence, 0);
  return {
    caseCount,
    passedCount,
    failedCount: caseCount - passedCount,
    passRate: caseCount ? round(passedCount / caseCount) : 0,
    averageScore: caseCount ? round(scoreTotal / caseCount) : 0,
    averageConfidence: caseCount ? round(confidenceTotal / caseCount) : 0,
    artifactCoverage: caseCount ? round(artifactCovered / caseCount) : 0,
    failedEvidenceCount,
  };
}

function failedReason(caseResult = {}) {
  if (caseResult.quarantine?.status === 'quarantined') return 'prompt_injection_quarantined';
  if (caseResult.passed === false) return 'visual_evidence_failed';
  return 'visual_evidence_incomplete';
}

function rhoHardCase({ suite, caseResult }) {
  const caseId = `visual_replay:${caseResult.runId}:${caseResult.caseId}`;
  return {
    id: caseId,
    caseId,
    taskId: suite.suiteId,
    reason: failedReason(caseResult),
    reasons: [failedReason(caseResult)],
    source: 'visual_replay_failed',
    target: 'visual_policy',
    score: round(1 - caseResult.score),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    evidence: {
      authority: 'evidence_only',
      canPromote: false,
      artifactHashes: caseResult.artifactHashes,
      quarantine: caseResult.quarantine,
    },
    verifierCase: {
      kind: 'visual',
      score: caseResult.score,
      confidence: caseResult.confidence,
      visualCase: {
        caseId,
        taskId: suite.suiteId,
        benchmarkKind: caseResult.kind,
        confidenceSignals: {
          verifierScore: caseResult.score,
          verifierConfidence: caseResult.confidence,
          artifactSupported: caseResult.artifactEvidencePresent,
          lowConfidence: caseResult.confidence < 0.5 || caseResult.score < 0.5,
        },
        budget: { tokensEstimated: caseResult.kind === 'ocr' ? 1200 : 1600 },
      },
    },
  };
}

function besHardCase({ caseResult }) {
  return {
    caseId: `visual_replay:${caseResult.runId}:${caseResult.caseId}:bes`,
    source: 'visual_replay_failed',
    lane: 'visual',
    reasons: [failedReason(caseResult)],
    artifactHashes: caseResult.artifactHashes,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  };
}

function promotionSummary(caseResults = []) {
  const blockedReasons = new Set(['evidence_only_visual_replay']);
  if (caseResults.some((entry) => !entry.passed)) blockedReasons.add('visual_evidence_failed');
  if (caseResults.some((entry) => entry.quarantine.status === 'quarantined')) {
    blockedReasons.add('prompt_injection_quarantined');
  }
  return {
    allowed: false,
    blockedReasons: [...blockedReasons].sort((left, right) => left.localeCompare(right)),
  };
}

export function runVisualReplaySuite({
  suite,
  results = [],
  runId = 'visual-replay-run',
  candidateId = null,
  recordedAt = new Date().toISOString(),
} = {}) {
  const normalizedSuite = normalizeSuite(suite);
  const normalizedRunId = sanitizeCandidateId(runId);
  const caseResults = normalizedSuite.cases.map((testCase) => normalizeCaseResult({
    testCase,
    result: resultForCase(results, testCase),
    runId: normalizedRunId,
  }));
  const failedResults = caseResults.filter((entry) => (
    !entry.passed || entry.quarantine.status === 'quarantined'
  ));
  const promotionCandidates = caseResults
    .filter((entry) => entry.passed && entry.quarantine.status !== 'quarantined')
    .map((entry) => ({
      caseId: entry.caseId,
      kind: entry.kind,
      score: entry.score,
      confidence: entry.confidence,
      artifactHashes: entry.artifactHashes,
      visualEvidenceRequired: true,
      evidenceOnly: true,
      canPromote: false,
    }));

  return {
    schemaVersion: 1,
    runId: normalizedRunId,
    candidateId: candidateId ? sanitizeCandidateId(candidateId) : normalizedSuite.suiteId,
    suiteId: normalizedSuite.suiteId,
    recordedAt,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    authority: 'visual_evidence_only',
    canPromote: false,
    suite: normalizedSuite,
    caseResults,
    metrics: metricsFor(caseResults),
    artifactHashes: [...new Set(caseResults.flatMap((entry) => entry.artifactHashes))].sort(),
    promotionCandidates,
    promotion: promotionSummary(caseResults),
    rhoHardCases: failedResults.map((caseResult) => rhoHardCase({ suite: normalizedSuite, caseResult })),
    besHardCases: failedResults.map((caseResult) => besHardCase({ caseResult })),
  };
}
