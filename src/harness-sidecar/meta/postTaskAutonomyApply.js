import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateAutonomyEvidenceThresholds } from './autonomyEvidenceAccumulator.js';
import { evaluateL3LivePolicyApply } from './autonomyRollbackRunner.js';
import {
  applyPartialAutonomousImprovements,
  extractPolicyHintsFromReplayReport,
} from './partialAutonomyApply.js';
import { applyRuntimePolicyToHarnessConfig, computeAdaptiveSearchActionDelta, ICR_CAPS_BY_LEVEL } from './runtimePolicyConsumer.js';
import { LIVE_POLICY_REL } from './runtimePolicyStore.js';
import { evaluateProposalTrustBoundary } from '../core/trustKernelGateway.js';

const SNAPSHOTS_REL = '.harness/runtime/live-policy.snapshots';

const FORBIDDEN_WRITE_PATHS = [
  'src/',
  'package.json',
];

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

function isForbiddenWritePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  return FORBIDDEN_WRITE_PATHS.some((forbidden) => (
    normalized === forbidden.replace(/\/$/, '')
    || normalized.startsWith(forbidden)
  ));
}

function latestReplayReport(replayReports = []) {
  const reports = asArray(replayReports).filter(Boolean);
  return reports.length ? reports[reports.length - 1] : null;
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

export function defaultPartialAutonomyThresholds(harnessConfig = {}) {
  return {
    minDashboardDepth: 1,
    maxRegressionCount: 0,
    ...(harnessConfig.partialAutonomy?.thresholds || {}),
  };
}

export function defaultL3LivePolicyThresholds(harnessConfig = {}) {
  return {
    minRollbackDrillsPassed: 1,
    maxRegressionCount: 0,
    minDashboardDepth: 1,
    ...(harnessConfig.partialAutonomy?.thresholds || {}),
  };
}

function resolveMaxAutonomyLevel(harnessConfig = {}) {
  const maxLevel = Number(harnessConfig?.partialAutonomy?.maxLevel ?? 2);
  return Number.isFinite(maxLevel) ? maxLevel : 2;
}

function buildLivePolicyDocument({
  harnessConfig,
  replayReport,
  autonomyState,
  policyVersion,
  updatedAt,
}) {
  const hints = extractPolicyHintsFromReplayReport(replayReport);
  const l3Caps = ICR_CAPS_BY_LEVEL[3];
  const baseMaxActions = Number(harnessConfig.adaptiveSearch?.maxActionsPerTask ?? 8);
  const scoreDelta = computeAdaptiveSearchActionDelta(hints.aggregateScore);
  const proposedPolicy = {
    schemaVersion: 1,
    policyVersion,
    policyHints: hints,
    partialAutonomy: {
      level: 3,
      levelName: 'reversible',
      autonomyDepth: autonomyState.dashboardDepth || 0,
      regressionCount: autonomyState.regressionCount || 0,
    },
    harnessAdjustments: {
      adaptiveSearch: {
        maxActionsPerTask: baseMaxActions + scoreDelta,
      },
      icr: {
        branchBreadth: l3Caps.branchBreadth,
        correctionDepth: l3Caps.correctionDepth,
      },
    },
    evidenceOnly: false,
    canPromote: false,
    authority: 'reversible_runtime',
    updatedAt,
  };

  const consumerResult = applyRuntimePolicyToHarnessConfig(harnessConfig, proposedPolicy);
  return {
    ...proposedPolicy,
    harnessAdjustments: {
      adaptiveSearch: {
        maxActionsPerTask: consumerResult.harnessConfig.adaptiveSearch?.maxActionsPerTask,
      },
      icr: {
        branchBreadth: consumerResult.harnessConfig.icr?.branchBreadth,
        correctionDepth: consumerResult.harnessConfig.icr?.correctionDepth,
      },
    },
    consumerResult,
  };
}

async function applyLiveRuntimePolicy({
  workspaceRoot,
  harnessConfig = {},
  replayReports = [],
  autonomyState = {},
  emitEvent,
  now = () => new Date(),
} = {}) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const livePolicyPath = path.join(resolvedRoot, LIVE_POLICY_REL);
  const snapshotRelDir = SNAPSHOTS_REL;

  const disabledResult = {
    applied: false,
    evidenceOnly: true,
    canPromote: false,
    livePolicyPath,
    reason: 'live_policy_apply_blocked',
  };

  for (const relativePath of [LIVE_POLICY_REL, snapshotRelDir]) {
    if (isForbiddenWritePath(relativePath)) {
      return {
        ...disabledResult,
        reason: 'forbidden_write_path',
        path: relativePath,
      };
    }
  }

  const trustBoundary = evaluateProposalTrustBoundary({
    workspaceRoot: resolvedRoot,
    proposal: {
      kind: 'local_config',
      paths: [LIVE_POLICY_REL],
    },
  });

  if (!trustBoundary.allowed) {
    return {
      ...disabledResult,
      reason: 'trust_boundary_blocked',
      trustBoundary,
    };
  }

  const report = latestReplayReport(replayReports);
  const updatedAt = (typeof now === 'function' ? now() : now).toISOString();
  const policyVersion = safePolicyVersion(report?.reportId || updatedAt);
  const livePolicyDocument = buildLivePolicyDocument({
    harnessConfig,
    replayReport: report,
    autonomyState,
    policyVersion,
    updatedAt,
  });

  const existingLive = await readJsonIfExists(livePolicyPath);
  const snapshotPath = path.join(resolvedRoot, snapshotRelDir, `${policyVersion}.json`);
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(
    snapshotPath,
    `${JSON.stringify(existingLive || {}, null, 2)}\n`,
    'utf8',
  );

  const { consumerResult, ...policyToWrite } = livePolicyDocument;
  await mkdir(path.dirname(livePolicyPath), { recursive: true });
  await writeFile(livePolicyPath, `${JSON.stringify(policyToWrite, null, 2)}\n`, 'utf8');

  const result = {
    applied: true,
    evidenceOnly: false,
    canPromote: false,
    authority: 'reversible_runtime',
    livePolicyPath,
    snapshotPath,
    policyVersion,
    consumerResult,
  };

  if (typeof emitEvent === 'function') {
    await emitEvent({
      type: 'partial_autonomy.live_policy_applied',
      ...result,
      replayReportId: report?.reportId || null,
    });
  }

  return result;
}

export async function runAutonomyApplyOrchestrator({
  workspaceRoot,
  harnessConfig = {},
  replayReports = [],
  autonomyState = {},
  emitEvent,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const thresholdEval = evaluateAutonomyEvidenceThresholds({
    state: autonomyState,
    thresholds: defaultPartialAutonomyThresholds(harnessConfig),
  });

  let partialApply = null;
  let livePolicyApply = null;

  if (!thresholdEval.eligible) {
    return {
      thresholdEval,
      partialApply,
      livePolicyApply,
      evidenceOnly: true,
      canPromote: false,
      authority: 'evidence_only',
    };
  }

  partialApply = await applyPartialAutonomousImprovements({
    workspaceRoot,
    harnessConfig,
    autonomyState,
    replayReports,
    emitEvent,
    now,
  });

  const maxLevel = resolveMaxAutonomyLevel(harnessConfig);
  const l3Eval = evaluateL3LivePolicyApply({
    autonomyState,
    thresholds: defaultL3LivePolicyThresholds(harnessConfig),
  });

  if (maxLevel >= 3 && l3Eval.allowed && partialApply?.applied) {
    livePolicyApply = await applyLiveRuntimePolicy({
      workspaceRoot,
      harnessConfig,
      replayReports,
      autonomyState,
      emitEvent,
      now,
    });
  }

  return {
    thresholdEval,
    partialApply,
    livePolicyApply,
    l3Eval: maxLevel >= 3 ? l3Eval : null,
    evidenceOnly: livePolicyApply?.applied ? false : true,
    canPromote: false,
    authority: livePolicyApply?.applied ? 'reversible_runtime' : 'evidence_only',
  };
}

export async function runPostTaskAutonomyApply(options = {}) {
  return runAutonomyApplyOrchestrator(options);
}
