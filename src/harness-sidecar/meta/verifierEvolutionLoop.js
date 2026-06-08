import { buildRhoCoreset } from '../rho/coresetBuilder.js';
import { BesMetaOptimizer } from './besMetaOptimizer.js';
import { createChangeProposal } from './changeProposal.js';
import { archiveVerifierCandidate } from './verifierEvolutionArchive.js';
import { runVerifierCandidate } from './verifierCandidateRunner.js';
import { createVerifierGenome, validateVerifierGenome } from './verifierGenome.js';
import { evaluatePromotion } from './promotionPolicy.js';

function registryVerifiers(registry = {}) {
  if (Array.isArray(registry)) return registry;
  if (Array.isArray(registry.verifiers)) return registry.verifiers;
  if (typeof registry.list === 'function') return registry.list();
  return [];
}

function genomeFromVerifier(verifier) {
  if (!verifier?.name) return null;
  try {
    return createVerifierGenome({ verifier });
  } catch {
    return null;
  }
}

function normalizeCandidate(candidate = {}) {
  const verifierGenome = candidate.verifierGenome || candidate.genome;
  if (!verifierGenome || !validateVerifierGenome(verifierGenome).valid) {
    throw new Error(`Verifier evolution candidate ${candidate.candidateId || ''} is missing a safe verifierGenome`);
  }
  return {
    ...candidate,
    candidateId: verifierGenome.genomeId,
    target: 'verifier_policy',
    verifierGenome,
    requiresApproval: true,
    status: 'approval_required',
    applied: false,
  };
}

async function invokeOptimizer(optimizer, args) {
  const selectedOptimizer = optimizer || new BesMetaOptimizer({ maxCandidates: 4 });
  if (typeof selectedOptimizer === 'function') return selectedOptimizer(args);
  if (typeof selectedOptimizer.propose === 'function') return selectedOptimizer.propose(args);
  if (typeof selectedOptimizer.optimize === 'function') return selectedOptimizer.optimize(args);
  throw new Error('optimizer must be a function or expose propose/optimize');
}

function heldOutCasesFromCoreset(coreset) {
  return (coreset.items || [])
    .filter((item) => item.source === 'verifier_case')
    .map((item) => item.verifierCase)
    .filter(Boolean);
}

export async function runVerifierEvolutionLoop({
  workspaceRoot,
  registry,
  verifierCases = [],
  baselineResults = [],
  baselineVerifierMetrics = {},
  approvals = [],
  optimizer,
  verifierRunner,
  toolRegistry,
  emitEvent = () => {},
  limit,
  verifierPolicy = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  if (typeof verifierRunner !== 'function') throw new Error('verifierRunner is required');

  await emitEvent({
    type: 'verifier_evolution.started',
    verifierCaseCount: verifierCases.length,
  });

  const coreset = buildRhoCoreset({
    verifierCases,
    limit: limit ?? Math.max(verifierCases.length, 1),
  });
  await emitEvent({
    type: 'verifier_evolution.coreset_selected',
    selectedCount: coreset.selectedCount,
    totalCandidates: coreset.totalCandidates,
  });

  const parentCandidates = registryVerifiers(registry)
    .map((verifier) => {
      const verifierGenome = genomeFromVerifier(verifier);
      return verifierGenome ? { verifierGenome } : null;
    })
    .filter(Boolean);
  const optimizerResult = await invokeOptimizer(optimizer, {
    target: 'verifier_policy',
    coreset,
    verifierCases,
    parentCandidates,
    traceSummary: {
      failureModes: [...new Set((coreset.items || []).flatMap((item) => item.reasons || []))],
    },
  });
  const candidates = (optimizerResult?.candidates || []).map(normalizeCandidate);

  await emitEvent({
    type: 'verifier_evolution.candidates_generated',
    candidateCount: candidates.length,
  });

  const heldOutCases = heldOutCasesFromCoreset(coreset);
  const runs = [];
  const decisions = [];
  const proposals = [];
  const archived = [];

  for (const candidate of candidates) {
    const run = await runVerifierCandidate({
      genome: candidate.verifierGenome,
      heldOutCases,
      baselineResults,
      verifierRunner,
      toolRegistry,
      emitEvent,
    });
    runs.push(run);

    await emitEvent({
      type: 'verifier_evolution.candidate_completed',
      candidateId: candidate.candidateId,
      metrics: run.metrics,
    });

    const decision = evaluatePromotion({
      candidateRun: {
        ...run,
        target: 'verifier_policy',
        verifierGenome: candidate.verifierGenome,
      },
      baselineVerifierMetrics,
      baselineResults,
      approvals,
      verifierPolicy,
    });
    decisions.push(decision);
    await emitEvent({
      type: 'verifier_evolution.promotion_evaluated',
      candidateId: candidate.candidateId,
      status: decision.status,
      reasons: decision.reasons,
    });

    const archiveRecord = await archiveVerifierCandidate({
      workspaceRoot,
      genome: candidate.verifierGenome,
      run,
      decision,
    });
    archived.push(archiveRecord);

    const proposal = createChangeProposal({
      candidate,
      promotionDecision: decision,
      summary: candidate.rationale || `Verifier policy proposal for ${candidate.verifierGenome.verifier.name}`,
    });
    proposals.push(proposal);
    await emitEvent({
      type: 'verifier_evolution.proposal_created',
      candidateId: candidate.candidateId,
      proposalId: proposal.proposalId,
      approvalRequired: true,
    });
  }

  return {
    promoted: false,
    coreset,
    candidates,
    runs,
    decisions,
    proposals,
    archived,
    bes: optimizerResult?.bes || null,
  };
}
