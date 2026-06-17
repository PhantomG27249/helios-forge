import { runMetaHarnessCampaign } from './metaHarnessCampaignRunner.js';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isScheduleDue(schedule = {}, now = new Date()) {
  const intervalMs = Number(schedule.intervalMs ?? 0);
  if (!Number.isFinite(intervalMs) || intervalMs < 0) return false;
  if (intervalMs === 0) return true;

  const lastRunAt = parseTimestamp(schedule.lastRunAt);
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= intervalMs;
}

function stripPromotionClaims(value) {
  if (Array.isArray(value)) return value.map(stripPromotionClaims);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (['canPromote', 'promotionAuthority', 'activeWorkspaceMutation', 'applied', 'durableApplyApproved'].includes(key)) {
      return [key, false];
    }
    return [key, stripPromotionClaims(child)];
  }));
}

function evidenceOnlyReport(report = {}, schedule = {}, ranAt) {
  const sanitized = stripPromotionClaims(report);
  return {
    ...sanitized,
    scheduleId: schedule.id,
    campaignId: schedule.campaignId || sanitized.campaignId,
    ranAt,
    evidenceOnly: true,
    promotionEvidenceOnly: true,
    canPromote: false,
    promotionAuthority: false,
    activeWorkspaceMutation: false,
    authority: 'evidence_only',
  };
}

export async function runDueCampaignSchedules({
  workspaceRoot,
  schedules = [],
  campaignRunner = runMetaHarnessCampaign,
  store,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const currentTime = typeof now === 'function' ? now() : now;
  const ran = [];
  const skipped = [];

  for (const schedule of normalizeList(schedules)) {
    if (!isScheduleDue(schedule, currentTime)) {
      skipped.push({
        scheduleId: schedule.id,
        campaignId: schedule.campaignId,
        reason: 'not_due',
      });
      continue;
    }

    const campaignResult = await campaignRunner({
      campaign: {
        campaignId: schedule.campaignId || schedule.id,
        workspaceRoot,
        target: schedule.target || 'meta-harness',
        baselineMetrics: schedule.baselineMetrics,
        sourceTree: schedule.sourceTree,
        frontier: schedule.frontier,
      },
      maxCycles: schedule.maxCycles,
      frontier: schedule.frontier,
      proposer: schedule.proposer,
      evaluator: schedule.evaluator,
      variantRunner: schedule.variantRunner,
      now,
    });

    const report = evidenceOnlyReport(campaignResult, schedule, currentTime.toISOString());
    if (store?.saveReport) await store.saveReport(report);
    if (store?.saveScheduleState) {
      await store.saveScheduleState({
        scheduleId: schedule.id,
        lastRunAt: currentTime.toISOString(),
      });
    }

    ran.push({
      scheduleId: schedule.id,
      campaignId: report.campaignId,
      report,
    });
  }

  return {
    ran,
    skipped,
    evidenceOnly: true,
    canPromote: false,
    promotionAuthority: false,
    activeWorkspaceMutation: false,
    authority: 'evidence_only',
  };
}
