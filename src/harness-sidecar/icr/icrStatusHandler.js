import { normalizeIcrConfig } from './icrContracts.js';
import { estimateIcrCompute, sanitizeIcrEvidenceForDashboard } from './icrEvidence.js';
import {
  loadIcrEvidenceForCapabilityGoals,
  loadRecentIcrEvidence,
} from './icrEvidenceStore.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function icrLaneGate(harnessConfig = {}) {
  return harnessConfig.productionCapabilities?.icrLane ?? {
    enabled: false,
    mode: 'offline',
    authority: 'evidence_only',
  };
}

function hasRhoRegression(report = {}) {
  if (asArray(report.regressions).length > 0) return true;
  if (report.upliftOverBaselines === false || report.heldoutUpliftProven === false) return true;
  const metrics = [report.upliftMetrics?.icr_branch_family, report.upliftMetrics?.icr_bes_lane_fusion]
    .filter(Boolean);
  return metrics.some((entry) => (
    entry.beatsBestSingle === false
      || asArray(entry.cheaperBaselineLosses).length > 0
      || Number(entry.scoreDelta ?? 0) < 0
  ));
}

function summarizeCostGateStatus(families = [], config = {}) {
  const statuses = families.map((family) => estimateIcrCompute(family, {
    ...config,
    ...family.config,
  }).costGateStatus);
  if (statuses.length === 0) return null;
  if (statuses.includes('exceeded')) return 'exceeded';
  return 'within_limit';
}

function sanitizeStatusItem(record = {}, config = {}) {
  return sanitizeIcrEvidenceForDashboard(record, {
    ...config,
    ...record.config,
  });
}

export async function buildIcrEvidenceStatus({ workspaceRoot, harnessConfig = {} } = {}) {
  const gate = icrLaneGate(harnessConfig);
  const gateEnabled = gate.enabled === true;
  const icrConfig = normalizeIcrConfig(harnessConfig.icr ?? {});
  const { families, rhoReports } = gateEnabled
    ? await loadRecentIcrEvidence(workspaceRoot)
    : { families: [], rhoReports: [] };

  const sanitizedFamilies = families.map((family) => sanitizeStatusItem(family, icrConfig));
  const sanitizedReports = rhoReports.map((report) => sanitizeStatusItem({
    ...report,
    kind: report.kind ?? 'icr_rho_replay_comparison',
  }, icrConfig));
  const items = [...sanitizedFamilies, ...sanitizedReports];

  const latestFamily = families[0] ?? null;
  const rhoRegressionCount = rhoReports.filter((report) => hasRhoRegression(report)).length;

  return {
    type: 'icrStatus',
    evidenceOnly: true,
    canPromote: false,
    gate: {
      name: 'icrLane',
      enabled: gateEnabled,
      mode: gate.mode || 'offline',
      authority: 'evidence_only',
    },
    summary: {
      itemCount: items.length,
      available: items.length > 0,
      latestTaskId: latestFamily?.taskId ?? null,
      costGateStatus: summarizeCostGateStatus(families, icrConfig),
      rhoRegressionCount,
    },
    items,
  };
}

export async function buildIcrHarnessCapabilityInputs({ workspaceRoot, harnessConfig = {} } = {}) {
  const icrConfig = normalizeIcrConfig(harnessConfig.icr ?? {});
  const icrEvidence = await loadIcrEvidenceForCapabilityGoals(workspaceRoot, icrConfig);
  return {
    icrEvidence,
    icrConfig,
  };
}
