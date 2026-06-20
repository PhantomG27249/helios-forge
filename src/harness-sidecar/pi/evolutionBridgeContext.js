import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { buildReplayFeedbackItems, loadLatestReplayReport } from '../meta/replayFeedbackBridge.js';

const FRONTIER_REL = '.harness/benchmarks/frontier-dashboard.jsonl';
const GOALS_REL = '.harness/meta/evolution-goals.json';
const PROMOTION_QUEUE_REL = '.harness/meta/promotion-queue';

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function summarizeFrontier(workspaceRoot, limit = 5) {
  const filePath = path.join(path.resolve(workspaceRoot), FRONTIER_REL);
  try {
    const raw = await readFile(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const entries = lines.slice(-limit).map((line) => JSON.parse(line));
    if (entries.length < 2) {
      return { entryCount: entries.length, trend: 'insufficient_data' };
    }
    const first = Number(entries[0]?.aggregateScore ?? entries[0]?.replayReport?.aggregateScore);
    const last = Number(entries.at(-1)?.aggregateScore ?? entries.at(-1)?.replayReport?.aggregateScore);
    const delta = Number.isFinite(first) && Number.isFinite(last) ? last - first : null;
    return {
      entryCount: entries.length,
      trend: delta === null ? 'unknown' : (delta >= 0 ? 'stable_or_up' : 'down'),
      delta,
      evidenceOnly: true,
      canPromote: false,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function countPromotionQueue(workspaceRoot) {
  const queueDir = path.join(path.resolve(workspaceRoot), PROMOTION_QUEUE_REL);
  try {
    const entries = await readdir(queueDir);
    return entries.filter((name) => name.endsWith('.json')).length;
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

export async function loadEvolutionBridgeContext({ workspaceRoot } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const goalsRecord = await readJsonIfPresent(path.join(path.resolve(workspaceRoot), GOALS_REL));
  const latestReplay = await loadLatestReplayReport({ workspaceRoot });
  const replayFeedback = buildReplayFeedbackItems({ latestReplayReport: latestReplay });
  const frontier = await summarizeFrontier(workspaceRoot);
  const promotionQueueCount = await countPromotionQueue(workspaceRoot);

  const goalLabels = (Array.isArray(goalsRecord?.goals) ? goalsRecord.goals : [])
    .slice(0, 6)
    .map((goal) => goal.label || goal.goalId)
    .filter(Boolean);

  return {
    goals: goalLabels,
    replayFeedback,
    latestReplay: latestReplay ? {
      reportId: latestReplay.reportId,
      suiteId: latestReplay.suiteId,
      aggregateScore: latestReplay.aggregateScore,
      regressionCount: Array.isArray(latestReplay.regressions) ? latestReplay.regressions.length : 0,
    } : null,
    frontier,
    promotionQueueCount,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
}
