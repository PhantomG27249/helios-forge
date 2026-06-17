import { summarizeIcrEvidence } from './icrEvidence.js';
import {
  persistIcrCandidateFamily,
  persistIcrRhoReport,
} from './icrEvidenceStore.js';
import { buildIcrHarnessCapabilityInputs } from './icrStatusHandler.js';
import { icrLaneEnabled, runIcrLaneForTask } from './icrRuntimeCoordinator.js';

function rhoUpliftHeadline(rhoReport = {}) {
  if (!rhoReport || typeof rhoReport !== 'object') return null;
  if (rhoReport.upliftOverBaselines === true) return 'uplift_over_baselines';
  if (rhoReport.upliftOverBaselines === false) return 'no_uplift_over_baselines';
  const branchFamily = rhoReport.upliftMetrics?.icr_branch_family;
  if (branchFamily?.beatsBestSingle === true) return 'branch_family_beats_best_single';
  if (branchFamily?.beatsBestSingle === false) return 'branch_family_below_best_single';
  const preferred = rhoReport.familySummary?.rankings?.[0]?.preferred;
  if (preferred === 'candidate') return 'rho_prefers_candidate';
  if (preferred === 'baseline') return 'rho_prefers_baseline';
  return rhoReport.comparisonId ? 'rho_comparison_recorded' : null;
}

function buildLaneCompletedEvent({ task, family, rhoReport, icrConfig }) {
  const summary = summarizeIcrEvidence(family, icrConfig);
  return {
    type: 'icr.lane_completed',
    taskId: task.taskId ?? task.id ?? family.taskId ?? null,
    evidenceOnly: true,
    promotionAllowed: false,
    canPromote: false,
    summary: {
      branchCount: summary.branchCount,
      costGateStatus: summary.costGateStatus,
      rhoUpliftHeadline: rhoUpliftHeadline(rhoReport),
      candidateFamilyId: family.candidateFamilyId ?? family.familyId ?? null,
      finalCandidateId: summary.finalCandidateId ?? null,
    },
  };
}

function assertEventPayloadSafe(payload = {}) {
  const serialized = JSON.stringify(payload);
  const forbiddenSnippets = [
    'branch_memory',
    'critique_records',
    'pqf_records',
    'replaced_branches',
    'hypothesis_history',
    'private memory',
    'privateScore',
    'hidden hypothesis',
  ];
  for (const snippet of forbiddenSnippets) {
    if (serialized.includes(snippet)) {
      throw new Error(`ICR lane_completed event leaked hidden content: ${snippet}`);
    }
  }
}

export async function runPostTaskIcrHooks({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  emitEvent,
  runners = {},
  now,
} = {}) {
  if (!icrLaneEnabled(harnessConfig)) {
    return {
      ran: false,
      skipped: true,
      reason: 'icr_lane_disabled',
      evidenceOnly: true,
      promotionAllowed: false,
    };
  }

  const laneResult = await runIcrLaneForTask({
    task,
    harnessConfig,
    runners,
    now,
  });

  if (laneResult.skipped) {
    return {
      ran: false,
      skipped: true,
      reason: laneResult.reason ?? 'icr_lane_skipped',
      evidenceOnly: true,
      promotionAllowed: false,
    };
  }

  const icrConfig = harnessConfig.icr ?? {};
  const familyPersisted = await persistIcrCandidateFamily(workspaceRoot, laneResult.family);
  const artifacts = {
    family: familyPersisted,
  };

  if (laneResult.rhoReport) {
    artifacts.rhoReport = await persistIcrRhoReport(workspaceRoot, {
      ...laneResult.rhoReport,
      taskId: laneResult.rhoReport.taskId ?? laneResult.family.taskId ?? task.taskId ?? task.id,
    });
  }

  const capabilityInputs = await buildIcrHarnessCapabilityInputs({ workspaceRoot, harnessConfig });
  const eventPayload = buildLaneCompletedEvent({
    task,
    family: laneResult.family,
    rhoReport: laneResult.rhoReport,
    icrConfig,
  });
  assertEventPayloadSafe(eventPayload);

  if (typeof emitEvent === 'function') {
    await emitEvent(eventPayload);
  }

  return {
    ran: true,
    artifacts,
    capabilityInputs,
    evidenceOnly: true,
    promotionAllowed: false,
  };
}
