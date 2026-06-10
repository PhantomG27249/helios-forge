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

function uniqueSorted(values = []) {
  return [...new Set(asArray(values).filter(Boolean).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function replayFailureReasons(rho) {
  if (rho?.validation?.passed !== false) return [];
  return asArray(rho.validation.reasons ?? rho.validation.failures ?? rho.validation.error ?? 'rho_validation_failed')
    .map((reason) => (typeof reason === 'string' ? reason : JSON.stringify(reason)));
}

function materialPromotionRejectionReasons(promotion = {}) {
  const ignored = new Set(['evidence_only_lane', 'missing_required_evidence']);
  return asArray(promotion.blockedReasons).filter((reason) => !ignored.has(reason));
}

function buildFutureHardCases({ lane, taskId, candidateId, rho, promotion }) {
  const hardCases = [];
  const replayReasons = replayFailureReasons(rho);
  if (replayReasons.length > 0) {
    hardCases.push({
      caseId: `${normalizeId(taskId, 'task')}:${normalizeId(lane, 'lane')}:${normalizeId(candidateId, 'candidate')}:replay`,
      source: 'rho_replay_failed',
      candidateId,
      lane,
      reasons: replayReasons,
    });
  }

  const rejectionReasons = materialPromotionRejectionReasons(promotion);
  if (replayReasons.length === 0 && rejectionReasons.length > 0) {
    hardCases.push({
      caseId: `${normalizeId(taskId, 'task')}:${normalizeId(lane, 'lane')}:${normalizeId(candidateId, 'candidate')}:rejection`,
      source: 'promotion_rejected',
      candidateId,
      lane,
      reasons: rejectionReasons,
    });
  }

  return hardCases;
}

export function summarizeBesLaneRuntimeResult(laneResult = {}) {
  const candidates = asArray(laneResult.candidates);
  const ranked = [...candidates].sort((left, right) => (
    Number(right.evidence?.summary?.domainScore ?? right.evidence?.domain?.score ?? 0)
      - Number(left.evidence?.summary?.domainScore ?? left.evidence?.domain?.score ?? 0)
      || String(left.candidateId || left.policyId || '').localeCompare(String(right.candidateId || right.policyId || ''))
  ));

  return {
    lane: laneResult.lane || null,
    taskId: laneResult.taskId || null,
    candidateCount: candidates.length,
    bestCandidateId: ranked[0]?.candidateId || ranked[0]?.policyId || null,
    evidenceSources: uniqueSorted(candidates.flatMap((candidate) => candidate.evidence?.sources || [])),
    blockedReasons: uniqueSorted(candidates.flatMap((candidate) => candidate.promotion?.blockedReasons || [])),
    promotionAllowed: candidates.some((candidate) => candidate.promotion?.allowed === true),
    updatedAt: laneResult.updatedAt || ranked[0]?.updatedAt || null,
  };
}

function a2aContext(a2a = {}) {
  if (!a2a || typeof a2a !== 'object') return {};
  return a2a.payload || a2a.message?.context || a2a.task?.context?.a2a || {};
}

function visualMemoryGraph(visualEvidence = {}) {
  if (!visualEvidence || typeof visualEvidence !== 'object') return null;
  if (visualEvidence.memoryGraph && typeof visualEvidence.memoryGraph === 'object') {
    return cloneJson(visualEvidence.memoryGraph, null);
  }
  const nodes = asArray(visualEvidence.nodes).filter((node) => node?.id);
  if (nodes.length === 0) return null;
  return {
    nodeIds: nodes.map((node) => node.id),
    nodes: cloneJson(nodes, []),
    edges: [],
    conflicts: [],
  };
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
  const futureHardCases = [];

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
    const visualEvidence = cloneJson(candidate.visualEvidence, null);
    const memoryGraph = cloneJson(
      candidate.memoryGraph ?? memoryGraphContext ?? visualMemoryGraph(visualEvidence),
      null,
    );
    const evidenceSummary = normalizeLaneEvidence({
      domain,
      rho,
      denseSubgoals: denseSubgoalResult,
      visualEvidence,
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

    const normalizedCandidate = {
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
      ...(visualEvidence ? { visualEvidence } : {}),
      ...(memoryGraph ? { memoryGraph } : {}),
      promotion,
      updatedAt: now,
    };

    futureHardCases.push(...buildFutureHardCases({
      lane: contract.lane,
      taskId,
      candidateId,
      rho,
      promotion,
    }));
    normalizedCandidates.push(normalizedCandidate);
  }

  return {
    lane: contract.lane,
    taskId: normalizeId(taskId, 'task'),
    contract,
    hardCases: normalizedHardCases,
    futureHardCases,
    candidateCount: normalizedCandidates.length,
    candidates: normalizedCandidates,
    updatedAt: now,
  };
}

export async function runBesLaneRuntimeWithEvents({
  emitEvent,
  runLane,
  ...runtimeInput
} = {}) {
  const lane = getBesLaneContract(runtimeInput.lane).lane;
  const taskId = normalizeId(runtimeInput.taskId, 'task');
  const startedAt = runtimeInput.now || new Date().toISOString();

  if (typeof emitEvent === 'function') {
    await emitEvent({
      type: 'bes_lane.started',
      lane,
      taskId,
      candidateCount: asArray(runtimeInput.candidates).length,
      hardCaseCount: asArray(runtimeInput.hardCases).length,
      startedAt,
    });
  }

  try {
    const result = typeof runLane === 'function'
      ? await runLane()
      : await runBesLaneRuntime({ ...runtimeInput, lane, taskId });
    const summary = summarizeBesLaneRuntimeResult(result);

    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'bes_lane.completed',
        ...summary,
        completedAt: summary.updatedAt || new Date().toISOString(),
      });
    }

    return result;
  } catch (error) {
    if (typeof emitEvent === 'function') {
      await emitEvent({
        type: 'bes_lane.blocked',
        lane,
        taskId,
        reason: error.message || String(error),
        blockedAt: new Date().toISOString(),
      });
    }
    throw error;
  }
}
