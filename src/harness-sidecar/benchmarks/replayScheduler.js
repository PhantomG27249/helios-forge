import { buildOperatorDashboardSnapshot } from '../meta/operatorDashboardStore.js';
import { runReplayCycle } from './replayCycleRunner.js';

function parseTime(value, fallback = null) {
  const source = value ?? fallback ?? Date.now();
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid replay schedule timestamp: ${value}`);
  return date;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isScheduleDue(schedule = {}, nowDate) {
  if (schedule.nextRunAt) {
    return parseTime(schedule.nextRunAt).getTime() <= nowDate.getTime();
  }

  const intervalMs = Number(schedule.intervalMs ?? 0);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return true;
  if (!schedule.lastRunAt) return true;

  const lastRunAt = parseTime(schedule.lastRunAt).getTime();
  return nowDate.getTime() >= lastRunAt + intervalMs;
}

function normalizeEvidenceOnlyReport(report, schedule) {
  return {
    ...report,
    scheduleId: schedule.id,
    canPromote: false,
    promotionEvidenceOnly: true,
    authority: 'evidence_only',
  };
}

function buildReplayDashboardSnapshot({ schedule, report, now }) {
  return buildOperatorDashboardSnapshot({
    rho: {
      scheduleId: schedule.id,
      suiteId: report.suiteId,
      reportId: report.reportId,
      aggregateScore: report.aggregateScore,
      domainScores: report.domainScores,
      regressions: report.regressions?.length ?? 0,
      rollbackDrillRequired: report.rollbackDrillRequired === true,
    },
    now,
  });
}

export async function runDueReplaySchedules({
  workspaceRoot,
  schedules = [],
  suiteLoader,
  baselineRunner,
  candidateRunner,
  store,
  budget = {},
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (typeof suiteLoader !== 'function') throw new Error('suiteLoader is required');
  if (typeof baselineRunner !== 'function') throw new Error('baselineRunner is required');

  const nowDate = parseTime(typeof now === 'function' ? now() : now);
  const ran = [];
  const skipped = [];

  for (const schedule of asArray(schedules)) {
    const scheduleId = String(schedule?.id ?? '').trim() || 'schedule';
    if (!isScheduleDue(schedule, nowDate)) {
      skipped.push({ scheduleId, reason: 'not_due' });
      continue;
    }

    const suite = await suiteLoader(schedule.suiteId ?? schedule.id);
    const report = normalizeEvidenceOnlyReport(
      await runReplayCycle({
        suite,
        candidates: schedule.candidates,
        baselineRunner,
        candidateRunner,
        budget,
        now: () => nowDate,
      }),
      schedule,
    );

    if (typeof store?.saveReport === 'function') {
      await store.saveReport(report);
    }

    if (typeof store?.saveSnapshot === 'function') {
      await store.saveSnapshot(buildReplayDashboardSnapshot({ schedule, report, now: () => nowDate }));
    }

    ran.push({
      scheduleId,
      report,
    });
  }

  return { ran, skipped };
}
