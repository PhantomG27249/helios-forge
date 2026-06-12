import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';
import {
  buildVisualBenchmarkCases,
  sanitizeVisualArtifactPath,
} from './visualBenchmarkCases.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function round(value) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function safeVisible(value, maxStringLength = 512) {
  return quarantineModelVisiblePayload(String(value ?? ''), { maxStringLength }).value;
}

function safePayload(value, maxStringLength = 512) {
  return quarantineModelVisiblePayload(value, { maxStringLength }).value;
}

function safeId(value, fallback) {
  const safe = safeVisible(value || fallback, 160);
  return safe || fallback;
}

function visualCaseInput(testCase = {}) {
  return {
    ...testCase,
    id: testCase.artifactId || testCase.id || testCase.caseId,
    artifactId: testCase.artifactId || testCase.id || testCase.caseId,
    type: testCase.artifactType || testCase.type || testCase.kind,
    path: testCase.artifactPath || testCase.path,
    artifacts: testCase.artifacts,
    metadata: testCase.metadata,
    benchmarkKind: testCase.benchmarkKind || testCase.visualCaseKind,
  };
}

function normalizeVisualCase({ testCase = {}, suiteId }) {
  const [benchmarkCase] = buildVisualBenchmarkCases({
    taskId: suiteId || 'visual_suite',
    artifacts: [visualCaseInput(testCase)],
  });
  if (!benchmarkCase) throw new Error('visual replay case is required');
  const artifactHash = safeVisible(testCase.artifactHash || testCase.hash || testCase.sha256, 160);
  if (!artifactHash) {
    throw new Error(`visual replay artifact hash is required for ${testCase.caseId || benchmarkCase.caseId}`);
  }
  return {
    ...benchmarkCase,
    caseId: safeId(testCase.caseId || benchmarkCase.caseId, benchmarkCase.caseId),
    sourceCaseId: safeId(testCase.caseId || benchmarkCase.artifactId, benchmarkCase.artifactId),
    artifactId: safeId(benchmarkCase.artifactId, 'visual_artifact'),
    artifactHash,
    artifactPaths: asArray(benchmarkCase.artifactPaths)
      .map((artifactPath) => sanitizeVisualArtifactPath(artifactPath))
      .filter(Boolean),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  };
}

function average(values = []) {
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return 0;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length);
}

function normalizeResult({ visualCase = {}, result = {} }) {
  const passed = result.passed === true || result.verdict?.passed === true;
  const score = clamp01(result.score ?? result.verdict?.score, passed ? 1 : 0);
  const confidence = clamp01(result.confidence ?? result.verdict?.confidence, score);
  return {
    caseId: visualCase.caseId,
    sourceCaseId: visualCase.sourceCaseId,
    benchmarkKind: visualCase.benchmarkKind,
    artifactId: visualCase.artifactId,
    artifactHash: visualCase.artifactHash,
    artifactPaths: visualCase.artifactPaths,
    passed,
    score,
    confidence,
    findings: safePayload(asArray(result.findings), 512),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  };
}

function aggregateKind(results = []) {
  return {
    caseCount: results.length,
    passedEvidenceCount: results.filter((result) => result.passed).length,
    failedEvidenceCount: results.filter((result) => !result.passed).length,
    averageScore: average(results.map((result) => result.score)),
    averageConfidence: average(results.map((result) => result.confidence)),
  };
}

function metricsByKind(results = []) {
  const grouped = new Map();
  for (const result of results) {
    const list = grouped.get(result.benchmarkKind) || [];
    list.push(result);
    grouped.set(result.benchmarkKind, list);
  }
  return Object.fromEntries([...grouped.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([kind, rows]) => [kind, aggregateKind(rows)]));
}

function hardCaseReason(result = {}) {
  if (result.benchmarkKind === 'ocr') return 'ocr_failure';
  if (result.benchmarkKind === 'ui_regression') return 'screenshot_diff_failure';
  return 'visual_false_negative';
}

function hardCaseFromResult(result = {}) {
  return {
    caseId: result.caseId,
    sourceCaseId: result.sourceCaseId,
    benchmarkKind: result.benchmarkKind,
    reason: hardCaseReason(result),
    visualCase: {
      caseId: result.caseId,
      benchmarkKind: result.benchmarkKind,
      confidenceSignals: {
        verifierScore: result.score,
        verifierConfidence: result.confidence,
        lowConfidence: result.confidence < 0.5 || result.score < 0.5,
      },
      budget: {},
    },
    score: result.score,
    confidence: result.confidence,
    artifactHash: result.artifactHash,
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
  };
}

export async function runVisualReplaySuite({
  suite = {},
  candidate = {},
  caseRunner,
  now = () => new Date(),
} = {}) {
  if (typeof caseRunner !== 'function') throw new Error('visual replay caseRunner is required');
  const suiteId = safeId(suite.suiteId || suite.id, 'visual-suite');
  const candidateId = safeId(candidate.candidateId || candidate.id, 'candidate');
  const visualCases = asArray(suite.cases).map((testCase) => normalizeVisualCase({ testCase, suiteId }));
  const cases = [];
  for (const visualCase of visualCases) {
    const result = await caseRunner({ visualCase, suite, candidate });
    cases.push(normalizeResult({ visualCase, result }));
  }
  const summary = {
    caseCount: cases.length,
    passedEvidenceCount: cases.filter((result) => result.passed).length,
    failedEvidenceCount: cases.filter((result) => !result.passed).length,
    averageScore: average(cases.map((result) => result.score)),
    averageConfidence: average(cases.map((result) => result.confidence)),
  };
  const hardCases = cases.filter((result) => !result.passed).map(hardCaseFromResult);

  return {
    schemaVersion: 1,
    reportId: `visual_replay:${suiteId}:${candidateId}`,
    suiteId,
    candidateId,
    recordedAt: now().toISOString(),
    visualEvidenceRequired: true,
    evidenceOnly: true,
    canPromote: false,
    summary,
    metrics: {
      ...summary,
      byKind: metricsByKind(cases),
    },
    cases,
    hardCases,
    rhoCases: hardCases.map((hardCase) => ({ ...hardCase, source: 'visual_replay' })),
    besHardCases: hardCases.map((hardCase) => ({ ...hardCase, lane: 'visual' })),
  };
}
