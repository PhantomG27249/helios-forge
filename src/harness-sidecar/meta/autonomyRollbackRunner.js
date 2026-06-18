import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  accumulateAutonomyEvidence,
  evaluateAutonomyEvidenceThresholds,
} from './autonomyEvidenceAccumulator.js';
import { recordRollbackDrill } from './governanceLoop.js';
import { LIVE_POLICY_REL } from './runtimePolicyStore.js';

const ROLLBACK_DRILLS_REL = '.harness/governance/rollback-drills.json';
const SNAPSHOTS_REL = '.harness/runtime/live-policy.snapshots';

const EVIDENCE_ONLY_FLAGS = Object.freeze({
  evidenceOnly: true,
  canPromote: false,
  authority: 'evidence_only',
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function safePolicyVersion(value) {
  const normalized = String(value || 'default')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'default';
}

function resolveNow(now = () => new Date()) {
  if (now instanceof Date) return now;
  const value = typeof now === 'function' ? now() : now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid rollback drill timestamp: ${value}`);
  return date;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeThresholds(thresholds = {}) {
  return {
    minRollbackDrillsPassed: Number(thresholds.minRollbackDrillsPassed ?? 1),
    maxRegressionCount: Number(thresholds.maxRegressionCount ?? 0),
    minDashboardDepth: Number(thresholds.minDashboardDepth ?? 0),
  };
}

export function evaluateL3LivePolicyApply({ autonomyState = {}, thresholds = {} } = {}) {
  const normalized = normalizeThresholds(thresholds);
  const thresholdEval = evaluateAutonomyEvidenceThresholds({
    state: autonomyState,
    thresholds: normalized,
  });

  return {
    allowed: thresholdEval.eligible,
    blockers: [...asArray(thresholdEval.blockers)],
    thresholds: thresholdEval.thresholds,
    state: autonomyState,
    autonomyLevel: 3,
    ...EVIDENCE_ONLY_FLAGS,
  };
}

export function processReplayReportForAutonomy({
  existing = {},
  replayReport,
  thresholds = {},
  targetLevel = 3,
} = {}) {
  const state = accumulateAutonomyEvidence({ existing, replayReport });
  const l3Apply = targetLevel >= 3
    ? evaluateL3LivePolicyApply({ autonomyState: state, thresholds })
    : null;

  return { state, l3Apply };
}

/**
 * Eligibility signal for promotionLoop.js (L4). Signal-only — never bypasses approval.
 */
export function derivePromotionLoopAutonomySignal({ autonomyState = {}, thresholds = {} } = {}) {
  const normalized = normalizeThresholds({
    minRollbackDrillsPassed: thresholds.minRollbackDrillsPassed ?? 1,
    maxRegressionCount: thresholds.maxRegressionCount ?? 0,
    minDashboardDepth: thresholds.minDashboardDepth ?? 1,
  });
  const thresholdEval = evaluateAutonomyEvidenceThresholds({
    state: autonomyState,
    thresholds: normalized,
  });

  return {
    l4Eligible: thresholdEval.eligible,
    blockers: [...asArray(thresholdEval.blockers)],
    thresholds: thresholdEval.thresholds,
    state: autonomyState,
    autonomyLevel: 4,
    signalOnly: true,
    promotionBypass: false,
    authority: 'eligibility_only',
    canPromote: false,
  };
}

async function persistRollbackDrillRecord(workspaceRoot, drill, resolvedNow) {
  const filePath = path.join(workspaceRoot, ROLLBACK_DRILLS_REL);
  const existing = (await readJsonIfExists(filePath)) || { drills: [] };
  const drills = [...asArray(existing.drills), {
    ...drill,
    ...EVIDENCE_ONLY_FLAGS,
  }];
  const passed = drills.filter((entry) => entry.status === 'passed').length;
  const failed = drills.filter((entry) => entry.status === 'failed').length;
  const payload = {
    ...existing,
    generatedAt: resolvedNow.toISOString(),
    drills,
    summary: {
      total: drills.length,
      passed,
      failed,
    },
    ...EVIDENCE_ONLY_FLAGS,
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export async function runAutonomyRollbackDrill({
  workspaceRoot,
  policyVersion,
  emitEvent,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (!policyVersion) throw new Error('policyVersion is required');

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedVersion = safePolicyVersion(policyVersion);
  const resolvedNow = resolveNow(now);
  const startedAt = resolvedNow.toISOString();

  const livePolicyPath = path.join(resolvedRoot, LIVE_POLICY_REL);
  const snapshotPath = path.join(resolvedRoot, SNAPSHOTS_REL, `${resolvedVersion}.json`);
  const snapshot = await readJsonIfExists(snapshotPath);
  const errors = [];
  let restoreVerified = false;

  if (!snapshot) {
    errors.push('snapshot_missing');
  } else {
    await mkdir(path.dirname(livePolicyPath), { recursive: true });
    await writeFile(livePolicyPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    const restored = await readJsonIfExists(livePolicyPath);
    restoreVerified = JSON.stringify(restored) === JSON.stringify(snapshot);
    if (!restoreVerified) errors.push('restore_verification_failed');
  }

  const completedAt = resolvedNow.toISOString();
  const base = recordRollbackDrill({
    candidateId: `live-policy-${resolvedVersion}`,
    startedAt,
    completedAt,
    restoreVerified,
    artifacts: restoreVerified
      ? [{ artifactId: resolvedVersion, path: LIVE_POLICY_REL, hash: `policy:${resolvedVersion}` }]
      : [],
    notes: errors.join('; '),
  });

  const blockers = [
    restoreVerified ? null : 'restore_verification_failed',
    snapshot ? null : 'snapshot_missing',
  ].filter(Boolean);

  const drill = {
    ...base,
    policyVersion: resolvedVersion,
    rollbackVerified: restoreVerified,
    status: restoreVerified ? 'passed' : 'failed',
    reversible: restoreVerified,
    blockers,
    errors,
    ...EVIDENCE_ONLY_FLAGS,
  };

  const rollbackPayload = await persistRollbackDrillRecord(resolvedRoot, drill, resolvedNow);

  const event = {
    type: 'governance.rollback_drill_completed',
    drillId: drill.drillId,
    policyVersion: resolvedVersion,
    status: drill.status,
    restoreVerified,
    rollbackDrillsPath: path.join(resolvedRoot, ROLLBACK_DRILLS_REL),
    ...EVIDENCE_ONLY_FLAGS,
  };

  if (typeof emitEvent === 'function') {
    await emitEvent(event);
  }

  return {
    ...drill,
    rollbackPayload,
    livePolicyPath,
    snapshotPath,
    autonomyState: accumulateAutonomyEvidence({
      rollbackDrill: { status: drill.status, drillId: drill.drillId },
    }),
  };
}
