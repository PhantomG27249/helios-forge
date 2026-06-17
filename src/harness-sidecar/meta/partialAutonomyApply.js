import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { evaluateProposalTrustBoundary } from '../core/trustKernelGateway.js';

const SHADOW_POLICY_REL = '.harness/runtime/shadow-policy.json';
const LEDGER_REL = '.harness/meta/partial-autonomy-applied.json';

const FORBIDDEN_WRITE_PATHS = [
  'src/',
  'package.json',
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function backgroundEvolutionEnabled(harnessConfig = {}) {
  const cap = harnessConfig.productionCapabilities?.backgroundEvolution;
  if (cap?.enabled === true || cap === true) return true;
  return harnessConfig.features?.backgroundEvolution === true;
}

export function partialAutonomyEnabled(harnessConfig = {}) {
  const setting = harnessConfig.partialAutonomy?.enabled;
  if (setting === false) return false;
  if (setting === true) return true;
  return backgroundEvolutionEnabled(harnessConfig);
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

export function extractPolicyHintsFromReplayReport(report = {}) {
  if (!report || typeof report !== 'object') return {};
  return {
    reportId: report.reportId,
    suiteId: report.suiteId,
    aggregateScore: report.aggregateScore,
    domainScores: report.domainScores,
    regressionCount: asArray(report.regressions).length,
    rollbackDrillRequired: report.rollbackDrillRequired === true,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };
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

function mergeShadowPolicy(existing = {}, hints = {}, meta = {}) {
  return {
    schemaVersion: 1,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
    ...existing,
    policyHints: {
      ...(existing.policyHints && typeof existing.policyHints === 'object' ? existing.policyHints : {}),
      ...hints,
    },
    partialAutonomy: {
      ...(existing.partialAutonomy && typeof existing.partialAutonomy === 'object' ? existing.partialAutonomy : {}),
      level: 1,
      levelName: 'shadow',
      ...meta,
    },
    updatedAt: meta.updatedAt,
  };
}

export async function applyPartialAutonomousImprovements({
  workspaceRoot,
  harnessConfig = {},
  autonomyState = {},
  replayReports = [],
  emitEvent,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const resolvedRoot = path.resolve(workspaceRoot);
  const ledgerPath = path.join(resolvedRoot, LEDGER_REL);
  const shadowPolicyPath = path.join(resolvedRoot, SHADOW_POLICY_REL);

  const disabledResult = {
    applied: false,
    evidenceOnly: true,
    canPromote: false,
    ledgerPath,
    shadowPolicyPath,
    reason: 'partial_autonomy_disabled',
  };

  if (!partialAutonomyEnabled(harnessConfig)) {
    return disabledResult;
  }

  for (const relativePath of [SHADOW_POLICY_REL, LEDGER_REL]) {
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
      paths: [SHADOW_POLICY_REL],
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
  const hints = extractPolicyHintsFromReplayReport(report);
  const updatedAt = (typeof now === 'function' ? now() : now).toISOString();

  const existingShadow = (await readJsonIfExists(shadowPolicyPath)) || {};
  const shadowPolicy = mergeShadowPolicy(existingShadow, hints, {
    updatedAt,
    autonomyDepth: autonomyState.dashboardDepth || 0,
    regressionCount: autonomyState.regressionCount || 0,
  });

  await mkdir(path.dirname(shadowPolicyPath), { recursive: true });
  await writeFile(shadowPolicyPath, `${JSON.stringify(shadowPolicy, null, 2)}\n`, 'utf8');

  const existingLedger = (await readJsonIfExists(ledgerPath)) || { entries: [] };
  const entries = asArray(existingLedger.entries);
  entries.push({
    appliedAt: updatedAt,
    replayReportId: report?.reportId || null,
    shadowPolicyPath: SHADOW_POLICY_REL,
    ledgerPath: LEDGER_REL,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
    policyHints: hints,
  });

  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify({ ...existingLedger, entries }, null, 2)}\n`, 'utf8');

  const result = {
    applied: true,
    evidenceOnly: true,
    canPromote: false,
    ledgerPath,
    shadowPolicyPath,
  };

  if (typeof emitEvent === 'function') {
    await emitEvent({
      type: 'partial_autonomy.applied',
      ...result,
      replayReportId: report?.reportId || null,
    });
  }

  return result;
}
