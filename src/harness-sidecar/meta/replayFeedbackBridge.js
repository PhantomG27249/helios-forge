import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { quarantineModelVisiblePayload } from '../security/modelVisibleQuarantine.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function formatDelta(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'unknown';
  return String(Math.round(numeric * 1_000_000) / 1_000_000);
}

function extractTimestamp(record = {}) {
  const candidates = [
    record.updatedAt,
    record.generatedAt,
    record.createdAt,
    record.completedAt,
    record.timestamp,
  ];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  return 0;
}

function quarantineFeedbackItem(item) {
  const result = quarantineModelVisiblePayload(item);
  return {
    ...result.value,
    quarantined: result.quarantined,
  };
}

export function buildReplayFeedbackItems({ latestReplayReport, longitudinalTrend } = {}) {
  if (!latestReplayReport || typeof latestReplayReport !== 'object') return [];

  const reportId = latestReplayReport.reportId || 'unknown';
  const suiteId = latestReplayReport.suiteId || 'unknown';
  const aggregateScore = latestReplayReport.aggregateScore;
  const trend = longitudinalTrend && typeof longitudinalTrend === 'object'
    ? longitudinalTrend
    : latestReplayReport.longitudinalTrend;
  const delta = trend?.latestImprovementDelta ?? trend?.aggregateDelta ?? aggregateScore;
  const classification = trend?.classification || 'unknown';
  const regressionCount = asArray(latestReplayReport.regressions).length;
  const modelVisibleDetails = quarantineModelVisiblePayload({
    reportId,
    suiteId,
    aggregateScore,
    artifactPath: latestReplayReport.artifactPath,
    nested: latestReplayReport.nested,
    regressions: asArray(latestReplayReport.regressions).map((entry) => ({
      caseId: entry?.caseId,
      domain: entry?.domain,
      reasons: entry?.reasons,
    })),
  }).value;

  const items = [
    quarantineFeedbackItem({
      type: 'replay.evidence',
      summary: `replay ${reportId} on ${suiteId}: aggregate score ${formatDelta(aggregateScore)}, delta ${formatDelta(delta)} (${classification})`,
      reportId,
      suiteId,
      aggregateScore,
      regressionCount,
      classification,
      details: modelVisibleDetails,
      evidenceOnly: true,
      canPromote: false,
      authority: 'evidence_only',
    }),
  ];

  if (regressionCount > 0) {
    items.push(quarantineFeedbackItem({
      type: 'replay.regression_warning',
      summary: `regression warning: ${regressionCount} replay regression(s) detected — review before promoting`,
      reportId,
      regressionCount,
      evidenceOnly: true,
      canPromote: false,
      authority: 'evidence_only',
    }));
  }

  return items;
}

async function readReplayReports(replayDir) {
  let entries;
  try {
    entries = await readdir(replayDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const reports = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(replayDir, entry.name);
    const raw = await readFile(filePath, 'utf8');
    const content = JSON.parse(raw);
    if (!content || typeof content !== 'object') continue;
    reports.push({
      filePath,
      content,
      timestamp: extractTimestamp(content),
    });
  }
  return reports;
}

export async function loadLatestReplayReport({ workspaceRoot } = {}) {
  if (!workspaceRoot) return null;

  const replayDir = path.join(
    path.resolve(workspaceRoot),
    '.harness',
    'benchmarks',
    'replay-cycles',
  );
  const reports = await readReplayReports(replayDir);
  if (!reports.length) return null;

  reports.sort((left, right) => {
    if (right.timestamp !== left.timestamp) return right.timestamp - left.timestamp;
    return right.filePath.localeCompare(left.filePath);
  });
  return reports[0].content;
}

export function bridgeReplayFeedbackFromEvent(event = {}) {
  const report = event.replayReport || event.report || null;
  if (!report) return [];

  return buildReplayFeedbackItems({
    latestReplayReport: report,
    longitudinalTrend: event.longitudinalTrend || report.longitudinalTrend,
  });
}

export async function bridgeReplayFeedback({ workspaceRoot, event } = {}) {
  const fromEvent = bridgeReplayFeedbackFromEvent(event);
  if (fromEvent.length > 0) return fromEvent;

  const latestReplayReport = await loadLatestReplayReport({ workspaceRoot });
  if (!latestReplayReport) return [];

  return buildReplayFeedbackItems({
    latestReplayReport,
    longitudinalTrend: latestReplayReport.longitudinalTrend,
  });
}
