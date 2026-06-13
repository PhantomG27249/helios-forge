import {
  assertIcrEvidenceOnly,
  normalizeIcrConfig,
} from './icrContracts.js';
import {
  buildIcrBlindFinalJudgePacket,
  buildIcrSolutionPool,
  collectIcrReplacedBranches,
} from './icrSolutionPool.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function cloneJson(value, fallback = undefined) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeId(value, fallback) {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function padIndex(index) {
  return String(index + 1).padStart(3, '0');
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function taskIdFrom(task = {}) {
  return normalizeId(task.taskId ?? task.id ?? task.name, 'icr_task');
}

function buildBranchSeeds({ task, config, createdAt }) {
  const taskId = taskIdFrom(task);
  const breadth = config.branchBreadth;
  return Array.from({ length: breadth }, (_, index) => ({
    kind: 'icr_branch_seed',
    lane: 'icr',
    branchId: `icr_branch_${padIndex(index)}`,
    index: index + 1,
    seed: `${taskId}:${createdAt}:icr_branch_${padIndex(index)}`,
    taskId,
  }));
}

async function defaultRunIcrBranch(input) {
  const module = await import('./icrBranchRuntime.js');
  return module.runIcrBranch(input);
}

function branchRunnerFrom(runners = {}) {
  return runners.runIcrBranch ?? runners.runBranch ?? defaultRunIcrBranch;
}

function normalizeBranchTrace(trace, branch) {
  const normalizedTrace = cloneJson(trace ?? {}, {});
  const evidenceRecord = {
    ...normalizedTrace,
    kind: normalizedTrace.kind ?? 'icr_branch_trace',
    lane: 'icr',
    branchId: normalizeId(normalizedTrace.branchId, branch.branchId),
    branch: cloneJson(normalizedTrace.branch ?? branch, branch),
    evidenceOnly: normalizedTrace.evidenceOnly ?? true,
    promotionAllowed: normalizedTrace.promotionAllowed ?? false,
  };
  assertIcrEvidenceOnly(evidenceRecord);
  return evidenceRecord;
}

function toBesCandidate(candidate) {
  return {
    candidateId: candidate.candidateId,
    lane: 'icr',
    status: 'shadow_only',
    text: candidate.text,
    visibleMetrics: cloneJson(candidate.visibleMetrics, {}),
    evidence: {
      sources: ['icr_branch_trace', 'icr_solution_pool', 'icr_blind_final_judge_packet'],
      hasRequiredEvidence: true,
      summary: cloneJson(candidate.visibleMetrics, {}),
    },
    lineage: cloneJson(candidate.lineage, {
      parents: [candidate.branchId],
      operator: 'icr_branch_solution',
      compatibleFamily: 'icr',
    }),
    bes: cloneJson(candidate.bes, {
      candidateUnit: 'icr_solution',
      evidenceOnly: true,
      promotionAuthority: false,
    }),
    promotion: {
      allowed: false,
      blockedReasons: ['evidence_only_lane'],
    },
  };
}

function toRhoCandidate(candidate) {
  return {
    candidateId: candidate.candidateId,
    branchId: candidate.branchId,
    lane: 'icr',
    text: candidate.text,
    runner: candidate.runner,
    visibleMetrics: cloneJson(candidate.visibleMetrics, {}),
  };
}

function defaultFinalJudge(packet = {}) {
  const ranked = asArray(packet.candidates)
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      score: Number(candidate.visibleMetrics?.score ?? candidate.visibleMetrics?.correctness ?? 0),
    }))
    .sort((left, right) => (
      right.score - left.score
        || String(left.candidateId || '').localeCompare(String(right.candidateId || ''))
    ));
  return {
    selectedCandidateId: ranked[0]?.candidateId ?? null,
    summary: 'deterministic_visible_metric_judgment',
  };
}

function normalizeFinalJudgment(result = {}, packet = {}) {
  const selectedCandidateId = normalizeId(
    result.selectedCandidateId ?? result.winnerCandidateId ?? result.candidateId,
    packet.candidates?.[0]?.candidateId ?? 'icr_candidate',
  );
  const candidateIds = new Set(asArray(packet.candidates).map((candidate) => candidate.candidateId));
  if (!candidateIds.has(selectedCandidateId)) {
    throw new Error(`ICR final judge selected unknown candidate: ${selectedCandidateId}`);
  }
  return {
    kind: 'blind_judgment',
    lane: 'icr',
    selectedCandidateId,
    summary: String(result.summary ?? result.rationale ?? ''),
    artifactId: result.artifactId ? String(result.artifactId) : null,
    evidenceOnly: true,
    promotionAllowed: false,
  };
}

async function runBlindFinalJudge({ packet, runners = {} }) {
  const judge = typeof runners.finalJudge === 'function' ? runners.finalJudge : defaultFinalJudge;
  return normalizeFinalJudgment(await judge(packet), packet);
}

export async function runIcrCandidateFamily({
  task = {},
  config = {},
  runners = {},
  now = () => new Date(),
} = {}) {
  const normalizedConfig = normalizeIcrConfig(config);
  const createdAt = resolveNow(now);
  const branchSeeds = buildBranchSeeds({ task, config: normalizedConfig, createdAt });
  const runBranch = branchRunnerFrom(runners);
  const branchTraces = [];

  for (const branch of branchSeeds) {
    const trace = await runBranch({
      task,
      branch,
      config: normalizedConfig,
      runners,
      now,
    });
    branchTraces.push(normalizeBranchTrace(trace, branch));
  }

  const solutionPool = buildIcrSolutionPool({
    branchTraces,
    solutionPoolSize: normalizedConfig.solutionPoolSize,
  });
  const candidates = solutionPool.candidates;
  const finalJudgePacket = buildIcrBlindFinalJudgePacket({ candidates, task });
  const finalJudgment = await runBlindFinalJudge({ packet: finalJudgePacket, runners });
  const activeCandidates = candidates.filter((candidate) => candidate.active !== false);
  const besCandidates = activeCandidates.map(toBesCandidate);
  const rhoCandidateFamily = activeCandidates.map(toRhoCandidate);

  return {
    kind: 'icr_candidate_family',
    lane: 'icr',
    taskId: taskIdFrom(task),
    createdAt,
    branchSeeds,
    branchTraces,
    solutionPool,
    candidates,
    activeCandidates,
    replacedBranches: collectIcrReplacedBranches(branchTraces),
    finalJudgePacket,
    finalJudgment,
    finalCandidateId: finalJudgment.selectedCandidateId,
    besCandidates,
    rhoCandidateFamily,
    candidateCount: activeCandidates.length,
    evidenceOnly: true,
    promotionAllowed: false,
    evidenceAuthority: {
      evidenceOnly: true,
      promotionAuthority: false,
      blockedReasons: ['evidence_only_lane'],
    },
  };
}
