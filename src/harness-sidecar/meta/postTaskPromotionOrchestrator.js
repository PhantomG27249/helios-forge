import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runPromotionLoop } from './promotionLoop.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function promotionOrchestrationEnabled(harnessConfig = {}) {
  return harnessConfig?.evolution?.promotionOrchestration === true;
}

function deterministicRunner() {
  return {
    smoke: async () => ({ passed: true, evidenceOnly: true }),
    eval: async ({ candidate } = {}) => ({
      metrics: {
        quality: 0.75,
        safety: 0.9,
        cost: 0.5,
        latency: 0.5,
      },
      replay: { passed: true, candidateId: candidate?.candidateId || null },
      verifier: { passed: true },
      evidenceOnly: true,
      canPromote: false,
    }),
  };
}

export async function runPostTaskPromotionOrchestrator({
  workspaceRoot,
  harnessConfig = {},
  promotionBridgeResult = {},
  replayReports = [],
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const base = {
    evidenceOnly: true,
    canPromote: false,
  };

  if (!promotionOrchestrationEnabled(harnessConfig)) {
    return { ...base, skipped: 'promotion_orchestration_disabled' };
  }

  if (!promotionBridgeResult?.queuePath) {
    return { ...base, skipped: 'no_queued_proposal' };
  }

  const runLoop = deps.runPromotionLoop || runPromotionLoop;
  const candidateRun = promotionBridgeResult.candidateRun || {};
  const loopResult = await runLoop({
    workspaceRoot,
    target: candidateRun.target || 'tool_policy',
    candidateGenerator: async () => ({
      candidateId: candidateRun.candidateId || promotionBridgeResult.proposal?.proposalId,
      target: candidateRun.target || 'tool_policy',
      rationale: candidateRun.rationale || promotionBridgeResult.proposal?.summary,
      patch: candidateRun.patch,
      metrics: candidateRun.metrics || {},
      evidence: candidateRun.evidence || {},
    }),
    runner: deterministicRunner(),
    approval: null,
  });

  const auditPath = `${promotionBridgeResult.queuePath}.orchestration-audit.json`;
  const auditRecord = {
    queuedAt: promotionBridgeResult.proposal?.queuedAt,
    queuePath: promotionBridgeResult.queuePath,
    replayReportIds: asArray(replayReports).map((report) => report.reportId).filter(Boolean),
    loopResult,
    evidenceOnly: true,
    canPromote: false,
    authority: 'evidence_only',
  };

  const writeAudit = deps.writeAudit || (async (filePath, record) => {
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  });
  await writeAudit(auditPath, auditRecord);

  return {
    ...base,
    auditPath,
    loopResult,
  };
}

export async function readPromotionOrchestrationAudit(queuePath) {
  const auditPath = `${queuePath}.orchestration-audit.json`;
  return JSON.parse(await readFile(auditPath, 'utf8'));
}
