import { verifyDenseSubgoals } from './denseSubgoalVerifier.js';
import { recordLineage } from './globalLineageTracker.js';
import { getBesLaneContract } from './laneContracts.js';
import { normalizeLaneEvidence, summarizeLanePromotion } from './laneEvidence.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function cloneJson(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function collectEvidenceText({ candidate, hardCases, domain }) {
  return [
    candidate?.rationale,
    candidate?.reasons,
    candidate?.evidence,
    domain?.reasons,
    hardCases.map((hardCase) => hardCase?.reasons ?? hardCase?.summary ?? hardCase?.caseId),
  ].flat(Infinity).filter(Boolean).map((entry) => {
    if (typeof entry === 'string') return entry;
    return JSON.stringify(entry);
  });
}

function buildGoalTree({ lane, taskId, hardCases }) {
  return {
    rootGoalId: `${normalizeId(taskId, 'task')}:${normalizeId(lane, 'lane')}`,
    hardCaseIds: asArray(hardCases).map((hardCase, index) => (
      normalizeId(hardCase?.caseId ?? hardCase?.id, `case_${index + 1}`)
    )),
  };
}

function normalizeRhoReplay(result) {
  if (!result) return null;
  if (result.validation || result.preference || result.consistency) return cloneJson(result);

  const cases = asArray(result.cases);
  if (cases.length === 0) return cloneJson(result);
  const failed = cases.filter((entry) => entry?.candidate?.validation?.passed === false);
  return {
    ...cloneJson(result),
    validation: {
      passed: failed.length === 0,
      failedCount: failed.length,
      total: cases.length,
    },
  };
}

function a2aContext(a2a = {}) {
  if (!a2a || typeof a2a !== 'object') return {};
  return a2a.payload || a2a.message?.context || a2a.task?.context?.a2a || {};
}

async function evaluateCandidate({ evaluator, candidate, lane, taskId, hardCases, contract }) {
  if (typeof evaluator !== 'function') return null;
  const result = await evaluator({ candidate, lane, taskId, hardCases, contract });
  return result ? cloneJson(result) : null;
}

async function runReplay({ replayRunner, candidate, lane, taskId, hardCases }) {
  if (typeof replayRunner !== 'function') return null;
  return normalizeRhoReplay(await replayRunner({ candidate, lane, taskId, hardCases }));
}

export async function runBesLaneRuntime({
  lane,
  taskId,
  candidates = [],
  hardCases = [],
  denseSubgoals = [],
  evaluator,
  replayRunner,
  a2aEnvelope,
  memoryGraphContext,
  adaptiveSearch,
  toolTree,
  trajectory,
  championArchive,
  frontier,
  verifierGenome,
  now = new Date().toISOString(),
} = {}) {
  const contract = getBesLaneContract(lane);
  const normalizedHardCases = cloneJson(asArray(hardCases), []);
  const normalizedCandidates = [];

  for (let index = 0; index < asArray(candidates).length; index += 1) {
    const candidate = asArray(candidates)[index] ?? {};
    const candidateId = normalizeId(
      candidate.candidateId ?? candidate.policyId ?? candidate.attemptId ?? candidate.id,
      `${contract.lane}_candidate_${index + 1}`,
    );
    const domain = await evaluateCandidate({
      evaluator,
      candidate,
      lane: contract.lane,
      taskId,
      hardCases: normalizedHardCases,
      contract,
    });
    const rho = await runReplay({
      replayRunner,
      candidate,
      lane: contract.lane,
      taskId,
      hardCases: normalizedHardCases,
    });
    const denseSubgoalResult = verifyDenseSubgoals({
      subgoals: denseSubgoals,
      evidence: collectEvidenceText({ candidate, hardCases: normalizedHardCases, domain }),
    });
    const a2a = cloneJson(candidate.a2a ?? a2aEnvelope, null);
    const a2aMetadata = a2aContext(a2a);
    const memoryGraph = cloneJson(candidate.memoryGraph ?? memoryGraphContext, null);
    const evidenceSummary = normalizeLaneEvidence({
      domain,
      rho,
      denseSubgoals: denseSubgoalResult,
      adaptiveSearch: candidate.adaptiveSearch ?? adaptiveSearch,
      toolTree: candidate.toolTree ?? toolTree,
      trajectory: candidate.trajectory ?? trajectory,
      championArchive: candidate.championArchive ?? championArchive,
      frontier: candidate.frontier ?? frontier,
      verifierGenome: candidate.verifierGenome ?? verifierGenome,
      a2a,
      memoryGraph,
    });
    const lineage = recordLineage({
      candidateId,
      parents: candidate.parents ?? candidate.lineage?.parents ?? a2aMetadata?.lineage?.parents ?? [],
      operator: candidate.operator ?? candidate.lineage?.operator ?? 'seed',
      lane: contract.lane,
      localLineage: candidate.lineage ?? a2aMetadata?.lineage,
    });
    const promotion = summarizeLanePromotion({
      candidate,
      evidence: evidenceSummary,
      rho,
      memoryGraph,
    });

    normalizedCandidates.push({
      ...cloneJson(candidate, {}),
      candidateId,
      status: candidate.status ?? 'shadow_only',
      lane: contract.lane,
      contract,
      lineage,
      bes: {
        goalTree: buildGoalTree({ lane: contract.lane, taskId, hardCases: normalizedHardCases }),
        denseSubgoals: denseSubgoalResult,
      },
      evidence: {
        ...(domain ? { domain } : {}),
        ...(rho ? { rho } : {}),
        denseSubgoals: denseSubgoalResult,
        ...evidenceSummary,
      },
      ...(a2a ? { a2a } : {}),
      ...(memoryGraph ? { memoryGraph } : {}),
      promotion,
      updatedAt: now,
    });
  }

  return {
    lane: contract.lane,
    taskId: normalizeId(taskId, 'task'),
    contract,
    hardCases: normalizedHardCases,
    candidateCount: normalizedCandidates.length,
    candidates: normalizedCandidates,
    updatedAt: now,
  };
}
