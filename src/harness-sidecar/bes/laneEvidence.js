import { normalizeEvolutionLevelRefs } from '../souls/evolutionLevels.js';
import { normalizeSoulRefList } from '../souls/soulEvidence.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function hasDenseSubgoalEvidence(denseSubgoals) {
  if (!isPresent(denseSubgoals)) return false;
  if (Number(denseSubgoals.total || 0) <= 0) return false;
  return Number(denseSubgoals.score || 0) > 0
    || (Array.isArray(denseSubgoals.satisfiedSubgoalIds) && denseSubgoals.satisfiedSubgoalIds.length > 0)
    || (Array.isArray(denseSubgoals.denseFeedback) && denseSubgoals.denseFeedback.length > 0);
}

function visualNodes(visualEvidence = {}) {
  const evidence = visualEvidence && typeof visualEvidence === 'object' ? visualEvidence : {};
  return asArray(evidence.nodes)
    .filter((node) => node && typeof node === 'object');
}

function visualArtifacts(visualEvidence = {}) {
  const evidence = visualEvidence && typeof visualEvidence === 'object' ? visualEvidence : {};
  return asArray(evidence.artifacts)
    .filter((artifact) => artifact && typeof artifact === 'object');
}

function hasVisualEvidence(visualEvidence) {
  return visualNodes(visualEvidence).length > 0 || visualArtifacts(visualEvidence).length > 0;
}

function objectId(value) {
  if (!value || typeof value !== 'object') return null;
  return value.candidateId ?? value.attemptId ?? value.id ?? value.policyId ?? null;
}

function recordId(value) {
  if (!value || typeof value !== 'object') return null;
  return value.frontierId ?? value.recordId ?? value.id ?? objectId(value);
}

function championRecords(archive) {
  if (!archive) return [];
  if (Array.isArray(archive)) return archive;
  return asArray(archive.champions ?? archive.records ?? archive.candidates);
}

function frontierRecords(frontier) {
  if (!frontier) return [];
  if (Array.isArray(frontier)) return frontier;
  return asArray(frontier.records ?? frontier.frontier ?? frontier.candidates);
}

function uniqueSorted(values = []) {
  return [...new Set(asArray(values).filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function externalPolicyEvidenceId(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  return evidence.policyDecisionId ?? evidence.decisionId ?? evidence.id ?? evidence.reviewId ?? null;
}

export function normalizeLaneEvidence({
  domain,
  rho,
  denseSubgoals,
  visualEvidence,
  adaptiveSearch,
  toolTree,
  trajectory,
  championArchive,
  frontier,
  verifierGenome,
  a2a,
  memoryGraph,
  externalPolicyEvidence,
  soulRefs,
  evolutionLevelRefs,
  extraSources = [],
} = {}) {
  const sources = new Set(asArray(extraSources).map(String).filter(Boolean));
  const normalizedSoulRefs = normalizeSoulRefList(soulRefs);
  const normalizedEvolutionLevelRefs = normalizeEvolutionLevelRefs(evolutionLevelRefs);

  if (isPresent(domain)) sources.add('domain_eval');
  if (isPresent(rho)) sources.add('rho_replay');
  if (hasDenseSubgoalEvidence(denseSubgoals)) sources.add('dense_subgoals');
  if (hasVisualEvidence(visualEvidence)) sources.add('visual_evidence');
  if (isPresent(adaptiveSearch)) sources.add('adaptive_search');
  if (isPresent(toolTree)) sources.add('tooltree');
  if (isPresent(trajectory)) sources.add('trajectory_operator');
  if (isPresent(championArchive)) sources.add('champion_archive');
  if (isPresent(frontier)) sources.add('frontier');
  if (isPresent(verifierGenome)) sources.add('verifier_genome');
  if (isPresent(a2a)) sources.add('a2a_lineage');
  if (isPresent(memoryGraph)) sources.add('memory_graph');
  if (isPresent(externalPolicyEvidence)) sources.add('external_policy_evidence');
  if (normalizedSoulRefs.length > 0) sources.add('soul_refs');
  if (normalizedEvolutionLevelRefs.length > 0) sources.add('evolution_level_refs');

  const normalizedSources = [...sources].sort((left, right) => left.localeCompare(right));
  const evidenceOnlySources = new Set(['evolution_level_refs', 'soul_refs']);
  const substantiveSources = normalizedSources.filter((source) => !evidenceOnlySources.has(source));
  return {
    sources: normalizedSources,
    hasRequiredEvidence: substantiveSources.length > 0,
    summary: {
      domainScore: Number.isFinite(Number(domain?.score)) ? Number(domain.score) : null,
      rhoValidationPassed: typeof rho?.validation?.passed === 'boolean' ? rho.validation.passed : null,
      denseSubgoalScore: Number.isFinite(Number(denseSubgoals?.score)) ? Number(denseSubgoals.score) : null,
      visualEvidenceCount: visualNodes(visualEvidence).length,
      visualArtifactCount: visualArtifacts(visualEvidence).length,
      visualEvidencePassed: typeof visualEvidence?.verdict?.passed === 'boolean'
        ? visualEvidence.verdict.passed
        : null,
      championArchiveIds: uniqueSorted(championRecords(championArchive).map(objectId)),
      frontierRecordIds: uniqueSorted(frontierRecords(frontier).map(recordId)),
      externalPolicyEvidenceId: externalPolicyEvidenceId(externalPolicyEvidence),
      soulRefCount: normalizedSoulRefs.length,
      evolutionLevelRefCount: normalizedEvolutionLevelRefs.length,
    },
  };
}

export function summarizeLanePromotion({
  candidate = {},
  evidence = {},
  rho,
  memoryGraph,
  externalPolicyEvidence,
} = {}) {
  const blockedReasons = new Set(['evidence_only_lane']);
  const status = String(candidate.status ?? '').trim().toLowerCase();

  if (['approved', 'approval_granted'].includes(status) || candidate.durableApplyApproved === true) {
    blockedReasons.add('candidate_claims_approval');
  }
  if (['applied', 'installed', 'promoted'].includes(status) || candidate.applied === true) {
    blockedReasons.add('candidate_claims_applied');
  }
  if (candidate.promotion?.allowed === true || candidate.promotionAllowed === true) {
    blockedReasons.add('candidate_claims_promotion');
  }
  if (rho?.validation?.passed === false) {
    blockedReasons.add('rho_validation_failed');
  }
  if (asArray(memoryGraph?.conflicts).length > 0) {
    blockedReasons.add('memory_conflict_flags_present');
  }
  if (!evidence.hasRequiredEvidence) {
    blockedReasons.add('missing_required_evidence');
  }
  if (!isPresent(externalPolicyEvidence)) {
    blockedReasons.add('missing_external_policy_evidence');
  }

  return {
    allowed: false,
    blockedReasons: [...blockedReasons].sort((left, right) => left.localeCompare(right)),
  };
}
