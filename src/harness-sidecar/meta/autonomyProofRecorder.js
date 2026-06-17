import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateAutonomyEvidenceThresholds } from './autonomyEvidenceAccumulator.js';

const AUTONOMY_SUMMARY_REL = '.harness/governance/autonomy-summary.json';
const ROLLBACK_DRILLS_REL = '.harness/governance/rollback-drills.json';

const EVIDENCE_ONLY_FLAGS = Object.freeze({
  evidenceOnly: true,
  canPromote: false,
  promotionAllowed: false,
  authority: 'evidence_only',
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function productionAutonomyPolicyEnabled(harnessConfig = {}) {
  const gate = harnessConfig.productionCapabilities?.productionAutonomyPolicy
    || harnessConfig.productionAutonomyPolicy
    || {};
  return gate.enabled === true;
}

function resolveWorkspaceRoot(workspaceRoot) {
  const resolved = path.resolve(workspaceRoot);
  if (!resolved) throw new Error('workspaceRoot is required');
  return resolved;
}

function resolveNow(now = () => new Date()) {
  if (now instanceof Date) return now;
  const value = typeof now === 'function' ? now() : now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid autonomy proof timestamp: ${value}`);
  return date;
}

async function readJsonIfPresent(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveAccumulatorThresholds(harnessConfig = {}, policyEnabled = false) {
  const gate = harnessConfig.productionCapabilities?.productionAutonomyPolicy
    || harnessConfig.productionAutonomyPolicy
    || {};
  const configured = {
    ...(harnessConfig.partialAutonomy?.thresholds || {}),
    ...(gate.accumulatorThresholds || {}),
  };
  if (policyEnabled && Object.keys(configured).length === 0) {
    return {
      minRollbackDrillsPassed: 1,
      maxRegressionCount: 0,
      minDashboardDepth: 1,
    };
  }
  return configured;
}

function evidenceStateFromAutonomy(autonomyState = {}) {
  return {
    rollbackDrills: {
      total: autonomyState.rollbackDrills?.total ?? 0,
      passed: autonomyState.rollbackDrills?.passed ?? 0,
      failed: autonomyState.rollbackDrills?.failed ?? 0,
    },
    regressionCount: autonomyState.regressionCount ?? 0,
    dashboardDepth: autonomyState.dashboardDepth ?? 0,
    dashboardSnapshotIds: [...asArray(autonomyState.dashboardSnapshotIds)],
    ...EVIDENCE_ONLY_FLAGS,
  };
}

function dashboardSafeSummary(autonomyState = {}, thresholdEval = {}) {
  return {
    ...evidenceStateFromAutonomy(autonomyState),
    eligible: thresholdEval.eligible === true,
    blockers: [...asArray(thresholdEval.blockers)],
    thresholds: thresholdEval.thresholds || {},
  };
}

function buildBasicAutonomySummary(autonomyState = {}, resolvedNow) {
  return {
    ...evidenceStateFromAutonomy(autonomyState),
    generatedAt: resolvedNow.toISOString(),
    productionAutonomyPolicyEnabled: false,
    proofMode: 'basic',
    ...EVIDENCE_ONLY_FLAGS,
  };
}

function buildFullAutonomySummary(autonomyState = {}, thresholdEval = {}, resolvedNow) {
  return {
    ...dashboardSafeSummary(autonomyState, thresholdEval),
    thresholdEvaluation: {
      eligible: thresholdEval.eligible === true,
      blockers: [...asArray(thresholdEval.blockers)],
      thresholds: thresholdEval.thresholds || {},
      ...EVIDENCE_ONLY_FLAGS,
    },
    generatedAt: resolvedNow.toISOString(),
    productionAutonomyPolicyEnabled: true,
    proofMode: 'full',
    level4ReadyCandidate: false,
    ...EVIDENCE_ONLY_FLAGS,
  };
}

function buildRollbackPayload(autonomyState = {}, resolvedNow) {
  const drills = asArray(autonomyState.drills).map((drill) => ({
    ...drill,
    ...EVIDENCE_ONLY_FLAGS,
  }));

  return {
    generatedAt: resolvedNow.toISOString(),
    drills,
    summary: {
      total: autonomyState.rollbackDrills?.total ?? 0,
      passed: autonomyState.rollbackDrills?.passed ?? 0,
      failed: autonomyState.rollbackDrills?.failed ?? 0,
    },
    ...EVIDENCE_ONLY_FLAGS,
  };
}

export async function persistAutonomyProofArtifacts({
  workspaceRoot,
  autonomyState = {},
  harnessConfig = {},
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const resolvedNow = resolveNow(now);
  const policyEnabled = productionAutonomyPolicyEnabled(harnessConfig);
  const thresholds = resolveAccumulatorThresholds(harnessConfig, policyEnabled);
  const thresholdEval = policyEnabled
    ? evaluateAutonomyEvidenceThresholds({ state: autonomyState, thresholds })
    : null;

  const autonomySummary = policyEnabled
    ? buildFullAutonomySummary(autonomyState, thresholdEval, resolvedNow)
    : buildBasicAutonomySummary(autonomyState, resolvedNow);
  const rollbackPayload = buildRollbackPayload(autonomyState, resolvedNow);

  const governanceDir = path.join(resolvedRoot, '.harness', 'governance');
  await mkdir(governanceDir, { recursive: true });
  await writeFile(
    path.join(resolvedRoot, AUTONOMY_SUMMARY_REL),
    `${JSON.stringify(autonomySummary, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(resolvedRoot, ROLLBACK_DRILLS_REL),
    `${JSON.stringify(rollbackPayload, null, 2)}\n`,
    'utf8',
  );

  return {
    autonomySummary,
    rollbackPayload,
    ...EVIDENCE_ONLY_FLAGS,
  };
}

export async function loadAutonomyProofArtifacts(workspaceRoot) {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const autonomySummary = await readJsonIfPresent(path.join(resolvedRoot, AUTONOMY_SUMMARY_REL));
  const rollbackPayload = await readJsonIfPresent(path.join(resolvedRoot, ROLLBACK_DRILLS_REL));

  const autonomyEvidence = autonomySummary ? evidenceStateFromAutonomy(autonomySummary) : null;

  return {
    autonomySummary,
    rollbackPayload,
    autonomyEvidence,
    ...EVIDENCE_ONLY_FLAGS,
  };
}
