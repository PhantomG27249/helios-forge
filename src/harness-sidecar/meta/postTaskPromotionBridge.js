import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { derivePromotionLoopAutonomySignal } from './autonomyRollbackRunner.js';
import { createChangeProposal } from './changeProposal.js';
import { evaluatePromotion } from './promotionPolicy.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function productionGateEnabled(harnessConfig = {}, gateName) {
  const gate = harnessConfig.productionCapabilities?.[gateName];
  return gate?.enabled === true || gate === true;
}

function resolveNow(now = () => new Date()) {
  if (now instanceof Date) return now;
  const value = typeof now === 'function' ? now() : now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid promotion bridge timestamp: ${value}`);
  return date;
}

function defaultL4Thresholds(harnessConfig = {}) {
  const gate = harnessConfig.productionCapabilities?.productionAutonomyPolicy
    || harnessConfig.productionAutonomyPolicy
    || {};
  return {
    minRollbackDrillsPassed: 1,
    maxRegressionCount: 0,
    minDashboardDepth: 1,
    ...(harnessConfig.partialAutonomy?.thresholds || {}),
    ...(gate.accumulatorThresholds || {}),
  };
}

function candidateScore(metrics = {}) {
  const quality = Number(metrics.quality ?? 0);
  const safety = Number(metrics.safety ?? 0);
  return quality * 0.6 + safety * 0.4;
}

function candidateIdOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.candidateId || value.id || null;
}

function extractCandidateRunFromCycle(cycle = {}) {
  const candidate = cycle.candidate || {};
  const metrics = cycle.metrics || candidate.metrics || {};
  const replayReport = cycle.replayReport || {};
  const evidence = cycle.evidence || candidate.evidence || {};
  const regressions = asArray(replayReport.regressions);

  return {
    candidateId: candidate.candidateId,
    target: candidate.target || 'tool_policy',
    rationale: candidate.rationale,
    patch: candidate.patch,
    smokePassed: cycle.smokePassed ?? candidate.smokePassed ?? true,
    metrics,
    evidence: {
      replay: evidence.replay || { passed: regressions.length === 0 },
      verifier: evidence.verifier,
      provenance: evidence.provenance || candidate.provenance || candidate.lineage,
    },
    rollback: candidate.rollback || cycle.rollback || cycle.promotion?.rollback,
    provenance: candidate.provenance || candidate.lineage,
  };
}

function extractBestFromCampaign(campaign = {}) {
  const cycles = asArray(campaign.cycles);
  if (!cycles.length) return null;

  for (let index = cycles.length - 1; index >= 0; index -= 1) {
    const winnerId = candidateIdOf(cycles[index].preference?.winner);
    if (winnerId) {
      const cycle = cycles.find((entry) => entry.candidate?.candidateId === winnerId) || cycles[index];
      return extractCandidateRunFromCycle(cycle);
    }
  }

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const cycle of cycles) {
    const candidateRun = extractCandidateRunFromCycle(cycle);
    if (!candidateRun?.candidateId) continue;
    const score = candidateScore(candidateRun.metrics);
    if (score > bestScore) {
      bestScore = score;
      best = candidateRun;
    }
  }
  return best;
}

function extractBestFromReplay(replayReport = {}) {
  const rankings = replayReport.familySummary?.rankings;
  if (Array.isArray(rankings) && rankings.length) {
    const winner = rankings[0];
    return {
      candidateId: winner.candidateId,
      target: winner.target || 'tool_policy',
      rationale: winner.rationale,
      patch: winner.patch,
      smokePassed: winner.smokePassed !== false,
      metrics: winner.metrics || {},
      evidence: winner.evidence || {},
      rollback: winner.rollback,
    };
  }

  const preferredId = replayReport.familySummary?.preferredCandidateId
    || replayReport.preferredCandidateId
    || replayReport.winnerCandidateId;
  if (preferredId) {
    return {
      candidateId: preferredId,
      target: replayReport.target || 'tool_policy',
      smokePassed: true,
      metrics: replayReport.metrics || {},
      evidence: replayReport.evidence || {},
      rollback: replayReport.rollback,
    };
  }

  if (replayReport.candidateId) {
    return extractCandidateRunFromCycle({ candidate: replayReport, metrics: replayReport.metrics });
  }

  return null;
}

export function buildPromotionCandidateFromEvidence({
  replayReports = [],
  campaignResults = [],
} = {}) {
  const campaigns = asArray(campaignResults).filter(Boolean);
  const replays = asArray(replayReports).filter(Boolean);

  if (campaigns.length) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const campaign of campaigns) {
      const candidateRun = extractBestFromCampaign(campaign);
      if (!candidateRun?.candidateId) continue;
      const score = candidateScore(candidateRun.metrics);
      if (score > bestScore) {
        bestScore = score;
        best = candidateRun;
      }
    }
    if (best) return best;
  }

  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const report of replays) {
    const candidateRun = extractBestFromReplay(report);
    if (!candidateRun?.candidateId) continue;
    const score = candidateScore(candidateRun.metrics);
    if (score > bestScore) {
      bestScore = score;
      best = candidateRun;
    }
  }
  return best;
}

function skippedResult({
  reason,
  l4Eligible = false,
  blockers,
} = {}) {
  return {
    evidenceOnly: true,
    canPromote: false,
    skipped: true,
    reason,
    l4Eligible,
    blockers,
    proposal: null,
    decision: null,
    queuePath: null,
  };
}

export async function runPostTaskPromotionBridge({
  workspaceRoot,
  harnessConfig = {},
  autonomyState = {},
  replayReports = [],
  campaignResults = [],
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  if (!productionGateEnabled(harnessConfig, 'productionAutonomyPolicy')) {
    return skippedResult({
      reason: 'production_autonomy_policy_gate_disabled',
      l4Eligible: false,
    });
  }

  const thresholds = defaultL4Thresholds(harnessConfig);
  const l4Signal = derivePromotionLoopAutonomySignal({ autonomyState, thresholds });

  if (!l4Signal.l4Eligible) {
    return skippedResult({
      reason: 'l4_not_eligible',
      l4Eligible: false,
      blockers: l4Signal.blockers,
    });
  }

  const candidateRun = buildPromotionCandidateFromEvidence({ replayReports, campaignResults });
  if (!candidateRun?.candidateId) {
    return skippedResult({
      reason: 'no_promotion_candidate',
      l4Eligible: true,
    });
  }

  const decision = evaluatePromotion({
    candidateRun,
    baselineFrontier: asArray(harnessConfig.evolution?.baselineFrontier),
    approvals: [],
  });

  const proposal = createChangeProposal({
    candidate: {
      candidateId: candidateRun.candidateId,
      target: candidateRun.target,
      rationale: candidateRun.rationale,
      patch: candidateRun.patch,
    },
    promotionDecision: decision,
    summary: `Post-task promotion proposal for ${candidateRun.candidateId}`,
  });

  const queueDir = path.join(path.resolve(workspaceRoot), '.harness', 'meta', 'promotion-queue');
  await mkdir(queueDir, { recursive: true });
  const queuePath = path.join(queueDir, `${proposal.proposalId}.json`);
  const queueRecord = {
    ...proposal,
    candidateRun,
    decision,
    l4Eligible: true,
    evidenceOnly: true,
    canPromote: false,
    queuedAt: resolveNow(now).toISOString(),
  };

  await writeFile(queuePath, `${JSON.stringify(queueRecord, null, 2)}\n`, 'utf8');

  return {
    evidenceOnly: true,
    canPromote: false,
    l4Eligible: true,
    proposal,
    decision,
    queuePath,
  };
}
