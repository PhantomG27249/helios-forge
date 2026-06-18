import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  appendLongitudinalFrontierCycle,
  createHeldOutBenchmarkSuite,
  normalizeBenchmarkMetrics,
  summarizeLongitudinalFrontier,
} from './longitudinalFrontier.js';
import { sanitizeCandidateId } from './frontierStore.js';

const EVIDENCE_ONLY_FLAGS = Object.freeze({
  evidenceOnly: true,
  canPromote: false,
  authority: 'evidence_only',
});

const FRONTIER_DASHBOARD_REL = '.harness/benchmarks/frontier-dashboard.jsonl';
const BACKGROUND_TICKS_REL = '.harness/meta/background-ticks';

const PROMOTION_KEYS = new Set([
  'canPromote',
  'promotionAuthority',
  'activeWorkspaceMutation',
  'applied',
  'durableApplyApproved',
  'promotionAllowed',
]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function resolveRecordedAt(recordedAt, ...fallbacks) {
  for (const value of [recordedAt, ...fallbacks]) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function stripPromotionClaims(value) {
  if (Array.isArray(value)) return value.map(stripPromotionClaims);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (PROMOTION_KEYS.has(key)) return [key, false];
    return [key, stripPromotionClaims(child)];
  }));
}

function evidenceOnlyValue(value) {
  return {
    ...stripPromotionClaims(value),
    ...EVIDENCE_ONLY_FLAGS,
  };
}

function defaultMetricsFromReplay(replayReport = {}) {
  const quality = Number(replayReport.aggregateScore ?? replayReport.metrics?.quality);
  return normalizeBenchmarkMetrics({
    quality: Number.isFinite(quality) ? quality : 0,
    safety: replayReport.metrics?.safety ?? 0.9,
    reliability: replayReport.metrics?.reliability ?? 0.8,
    cost: replayReport.metrics?.cost ?? 0.5,
    latency: replayReport.metrics?.latency ?? 0.5,
    maintainability: replayReport.metrics?.maintainability ?? 0.7,
    visualConfidence: replayReport.metrics?.visualConfidence ?? 0.6,
    memoryHealth: replayReport.metrics?.memoryHealth ?? 0.75,
    trustRisk: replayReport.metrics?.trustRisk ?? 0.2,
  });
}

function extractBenchmarkResults(replayReport = {}, campaignReport = {}) {
  const replayReportId = replayReport.reportId || null;
  const campaignReportId = campaignReport.reportId || campaignReport.campaignId || null;
  const cycles = asArray(campaignReport.cycles);

  if (cycles.length > 0) {
    return cycles.map((cycle, index) => ({
      candidateId: sanitizeCandidateId(
        cycle.candidate?.candidateId || cycle.cycleId || `candidate-${index}`,
      ),
      metrics: normalizeBenchmarkMetrics({
        ...defaultMetricsFromReplay(replayReport),
        ...(cycle.metrics || {}),
      }),
      source: {
        replayReportId,
        campaignReportId,
        cycleIndex: cycle.cycleIndex ?? index,
      },
    }));
  }

  const frontier = asArray(campaignReport.frontier);
  if (frontier.length > 0) {
    return frontier.map((entry) => ({
      candidateId: sanitizeCandidateId(entry.candidateId),
      metrics: normalizeBenchmarkMetrics({
        ...defaultMetricsFromReplay(replayReport),
        ...(entry.metrics || {}),
      }),
      source: { replayReportId, campaignReportId },
    }));
  }

  return [{
    candidateId: sanitizeCandidateId(replayReport.reportId || 'replay-candidate'),
    metrics: defaultMetricsFromReplay(replayReport),
    source: { replayReportId, campaignReportId },
  }];
}

function buildCycleId(replayReport = {}, recordedAt) {
  const base = sanitizeCandidateId(replayReport.reportId || 'runtime');
  const stamp = recordedAt.replace(/[^0-9]/g, '').slice(0, 14);
  return `cycle-${base}-${stamp || '00000000000000'}`;
}

function buildFrontierDashboardEntry({
  replayReport = {},
  campaignReport = {},
  recordedAt,
} = {}) {
  const resolvedAt = resolveRecordedAt(
    recordedAt,
    replayReport.generatedAt,
    campaignReport.generatedAt,
    campaignReport.ranAt,
  );
  const suiteId = sanitizeCandidateId(replayReport.suiteId || 'meta-harness-holdout');
  const results = extractBenchmarkResults(replayReport, campaignReport);

  return evidenceOnlyValue({
    schemaVersion: 1,
    recordedAt: resolvedAt,
    cycleId: buildCycleId(replayReport, resolvedAt),
    suiteId,
    replayReportId: replayReport.reportId || null,
    campaignReportId: campaignReport.reportId || campaignReport.campaignId || null,
    results,
  });
}

export async function readFrontierDashboardEntries(workspaceRoot) {
  const filePath = path.join(resolveWorkspaceRoot(workspaceRoot), FRONTIER_DASHBOARD_REL);
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((entry) => evidenceOnlyValue(entry));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendFrontierDashboardEntry({
  workspaceRoot,
  replayReport = {},
  campaignReport = {},
  recordedAt,
} = {}) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const entry = buildFrontierDashboardEntry({ replayReport, campaignReport, recordedAt });
  const filePath = path.join(resolvedRoot, FRONTIER_DASHBOARD_REL);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export async function writeBackgroundTickRecord({
  workspaceRoot,
  tickId,
  hookResults = {},
  recordedAt,
} = {}) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  if (!tickId) throw new Error('tickId is required');

  const safeTickId = sanitizeCandidateId(String(tickId));
  const record = evidenceOnlyValue({
    schemaVersion: 1,
    tickId: safeTickId,
    recordedAt: resolveRecordedAt(recordedAt, hookResults.recordedAt),
    hookResults: stripPromotionClaims(hookResults),
  });

  const filePath = path.join(resolvedRoot, BACKGROUND_TICKS_REL, `${safeTickId}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

function resolveSuiteForEntry(entry = {}, fallbackSuiteId = 'meta-harness-holdout') {
  return createHeldOutBenchmarkSuite({
    suiteId: entry.suiteId || fallbackSuiteId,
    cases: [{ caseId: 'post-task-cycle' }],
  });
}

export async function summarizeFrontierFromHistory({
  workspaceRoot,
  history = {},
  suite,
  entries,
} = {}) {
  const resolvedEntries = entries ?? (workspaceRoot
    ? await readFrontierDashboardEntries(workspaceRoot)
    : []);

  let accumulated = history;
  for (const entry of resolvedEntries) {
    accumulated = appendLongitudinalFrontierCycle({
      history: accumulated,
      suite: suite || resolveSuiteForEntry(entry),
      cycleId: entry.cycleId,
      results: asArray(entry.results),
      budget: entry.budget,
      recordedAt: entry.recordedAt,
    });
  }

  const summary = summarizeLongitudinalFrontier(accumulated);
  return {
    history: accumulated,
    summary,
    ...EVIDENCE_ONLY_FLAGS,
  };
}
