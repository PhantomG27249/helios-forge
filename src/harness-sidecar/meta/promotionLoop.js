import { applyChangeProposal, createChangeProposal } from './changeProposal.js';
import { archiveCandidate } from './candidateArchive.js';
import { generateCandidateChange } from './candidateGenerator.js';
import { createFrontierStore, sanitizeCandidateId } from './frontierStore.js';
import { evaluatePromotion } from './promotionPolicy.js';
import { inspectTrace } from './traceInspector.js';

function auditEvent(type, payload = {}) {
  return {
    type,
    at: new Date().toISOString(),
    ...payload,
  };
}

async function inspectTraceSummary({ traceSummary, traceDir }) {
  if (traceSummary) return traceSummary;
  if (!traceDir) throw new Error('traceDir or traceSummary is required');
  return inspectTrace({ traceDir });
}

async function invokeCandidateGenerator(candidateGenerator, args) {
  if (!candidateGenerator) {
    return generateCandidateChange(args);
  }
  if (typeof candidateGenerator === 'function') {
    return candidateGenerator(args);
  }
  if (typeof candidateGenerator.generate === 'function') {
    return candidateGenerator.generate(args);
  }
  if (typeof candidateGenerator.generateCandidateChange === 'function') {
    return candidateGenerator.generateCandidateChange(args);
  }
  throw new Error('candidateGenerator must be a function or expose generate');
}

async function invokeOptimizer(optimizer, args) {
  if (!optimizer) return null;
  if (typeof optimizer === 'function') {
    return optimizer(args);
  }
  if (typeof optimizer.optimize === 'function') {
    return optimizer.optimize(args);
  }
  if (typeof optimizer.propose === 'function') {
    return optimizer.propose(args);
  }
  throw new Error('optimizer must be a function or expose optimize/propose');
}

function normalizeCandidate(candidate) {
  if (!candidate?.candidateId) throw new Error('candidateId is required');
  return {
    ...candidate,
    candidateId: sanitizeCandidateId(candidate.candidateId),
    requiresApproval: true,
  };
}

function candidateIdOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return sanitizeCandidateId(value);
  return sanitizeCandidateId(value.candidateId || value.id);
}

function normalizeOptimizerResult(optimizerResult, generatedCandidate) {
  if (optimizerResult?.candidates && Array.isArray(optimizerResult.candidates)) {
    return {
      ...optimizerResult,
      candidates: optimizerResult.candidates.map(normalizeCandidate),
    };
  }

  const candidate = normalizeCandidate(optimizerResult || generatedCandidate);
  return {
    candidates: [candidate],
    preference: null,
    bes: null,
    coreset: null,
  };
}

function selectCandidateFromPreference(candidates, preference) {
  const preferredId = candidateIdOf(preference?.winner);
  if (preferredId) {
    const preferred = candidates.find((candidate) => candidate.candidateId === preferredId);
    if (preferred) return preferred;
  }
  return candidates[0];
}

async function runSmoke({ runner, candidate, traceSummary }) {
  if (typeof runner?.runSmoke === 'function') {
    return runner.runSmoke({ candidate, traceSummary });
  }
  if (typeof runner?.smoke === 'function') {
    return runner.smoke({ candidate, traceSummary });
  }
  throw new Error('runner.runSmoke is required');
}

async function runEval({ runner, candidate, traceSummary, smokeResult }) {
  if (typeof runner?.runEval === 'function') {
    return runner.runEval({ candidate, traceSummary, smokeResult });
  }
  if (typeof runner?.eval === 'function') {
    return runner.eval({ candidate, traceSummary, smokeResult });
  }
  throw new Error('runner.runEval is required');
}

function smokePassed(smokeResult) {
  if (typeof smokeResult === 'boolean') return smokeResult;
  return Boolean(smokeResult?.passed ?? smokeResult?.smokePassed);
}

function normalizeApproval(approval, candidateId) {
  if (approval === true) {
    return { candidateId, choice: 'approve' };
  }
  if (approval?.choice === 'approve' || approval?.approved === true) {
    if (approval.candidateId && sanitizeCandidateId(approval.candidateId) !== candidateId) {
      return null;
    }
    return {
      ...approval,
      candidateId,
      choice: 'approve',
    };
  }
  return null;
}

export async function runPromotionLoop({
  workspaceRoot,
  traceDir,
  traceSummary,
  target,
  candidateGenerator,
  optimizer,
  runner,
  applyAdapter,
  approval = null,
  safetyThreshold = 0.9,
  archiveCandidates = false,
  store = createFrontierStore({ workspaceRoot }),
} = {}) {
  const auditEvents = [];
  const inspectedTraceSummary = await inspectTraceSummary({ traceSummary, traceDir });

  const generatedCandidate = await invokeCandidateGenerator(candidateGenerator, {
    traceSummary: inspectedTraceSummary,
    target,
  });
  const optimizedCandidate = await invokeOptimizer(optimizer, {
    traceSummary: inspectedTraceSummary,
    target,
    candidate: generatedCandidate,
  });
  const optimizerResult = normalizeOptimizerResult(optimizedCandidate, generatedCandidate);
  const candidate = selectCandidateFromPreference(optimizerResult.candidates, optimizerResult.preference);
  auditEvents.push(auditEvent('meta.candidate_proposed', {
    candidateId: candidate.candidateId,
    target: candidate.target,
    candidateCount: optimizerResult.candidates.length,
  }));

  const smokeResult = await runSmoke({ runner, candidate, traceSummary: inspectedTraceSummary });
  auditEvents.push(auditEvent('meta.smoke_run', {
    candidateId: candidate.candidateId,
    smokePassed: smokePassed(smokeResult),
  }));

  const evalResult = await runEval({
    runner,
    candidate,
    traceSummary: inspectedTraceSummary,
    smokeResult,
  });
  const candidateRun = {
    candidateId: candidate.candidateId,
    smokePassed: smokePassed(smokeResult),
    smokeResult,
    metrics: evalResult?.metrics || evalResult || {},
    evaluatedAt: new Date().toISOString(),
  };

  const frontier = await store.load();
  const normalizedApproval = normalizeApproval(approval, candidate.candidateId);
  const decision = evaluatePromotion({
    candidateRun,
    baselineFrontier: frontier.baselineFrontier,
    approvals: normalizedApproval ? [normalizedApproval] : [],
    safetyThreshold,
  });
  auditEvents.push(auditEvent('meta.promotion_decision', {
    candidateId: candidate.candidateId,
    status: decision.status,
    reasons: decision.reasons,
  }));

  const proposal = createChangeProposal({
    candidate,
    promotionDecision: decision,
    summary: candidate.rationale,
  });
  auditEvents.push(auditEvent('meta.approval_required', {
    candidateId: candidate.candidateId,
    proposalId: proposal.proposalId,
  }));

  let applied = null;
  if (decision.status === 'promoted' && normalizedApproval) {
    applied = await applyChangeProposal({
      proposal,
      approved: true,
      applyAdapter,
    });
    auditEvents.push(auditEvent('meta.applied', {
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
    }));
  } else {
    auditEvents.push(auditEvent('meta.rejected', {
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
      reasons: decision.reasons,
    }));
  }

  const updatedFrontier = await store.recordDecision({
    candidate,
    candidateRun,
    decision,
    proposal,
    applied,
  });

  if (archiveCandidates) {
    for (const archivedCandidate of optimizerResult.candidates) {
      await archiveCandidate({
        workspaceRoot,
        candidate: archivedCandidate,
        candidateRun: archivedCandidate.candidateId === candidate.candidateId
          ? candidateRun
          : {
            candidateId: archivedCandidate.candidateId,
            smokePassed: false,
            metrics: {},
            evaluatedAt: candidateRun.evaluatedAt,
          },
        traceSummary: inspectedTraceSummary,
        preference: optimizerResult.preference || {},
      });
    }
    auditEvents.push(auditEvent('meta.candidates_archived', {
      candidateCount: optimizerResult.candidates.length,
    }));
  }

  return {
    traceSummary: inspectedTraceSummary,
    candidate,
    candidates: optimizerResult.candidates,
    preference: optimizerResult.preference || null,
    bes: optimizerResult.bes || null,
    coreset: optimizerResult.coreset || null,
    candidateRun,
    decision,
    proposal,
    applied,
    auditEvents,
    frontier: updatedFrontier,
  };
}
