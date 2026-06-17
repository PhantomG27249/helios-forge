import { normalizeIcrConfig } from './icrContracts.js';
import { runIcrCandidateFamily } from './icrCandidateFamily.js';
import { runIcrRhoReplayComparison } from './icrReplayAdapter.js';

const EVIDENCE_ONLY_RESULT = Object.freeze({
  evidenceOnly: true,
  promotionAllowed: false,
});

function sampleTrace(branchId, text, score, overrides = {}) {
  return {
    kind: 'icr_branch_trace',
    lane: 'icr',
    branchId,
    solution: { text },
    metrics: { score, tokens: 1000, latencyMs: 80 },
    branch_memory: [{ note: `${branchId} private memory` }],
    critique_records: [{ critique: `${branchId} critique` }],
    pqf_records: [{ privateScore: score + 0.1 }],
    hypothesis_history: [`${branchId} hidden hypothesis`],
    replaced_branches: [],
    evidenceOnly: true,
    promotionAllowed: false,
    ...overrides,
  };
}

function replayReport(label, {
  preferred = 'candidate',
  scoreDelta = 0.2,
} = {}) {
  return {
    groupSize: 1,
    caseCount: 1,
    familySummary: {
      preferredCandidateId: label,
      promotionAllowed: false,
      authority: 'evidence_only',
      rankings: [{
        candidateId: label,
        preferred,
        scoreDelta,
        promotionAllowed: false,
        authority: 'evidence_only',
      }],
    },
  };
}

export function icrLaneEnabled(harnessConfig = {}) {
  return harnessConfig.icr?.enabled === true;
}

export function createDeterministicIcrRunners(fixture = {}) {
  const {
    branchTexts = {},
    branchScores = {},
    finalJudge,
    bestSingleRunner,
    repeatedSamplingRunner,
    staticCouncilRunner,
    rhoRunner,
    now = () => new Date('2026-06-17T12:00:00.000Z'),
  } = fixture;

  return {
    now,
    runIcrBranch: async ({ branch }) => {
      const branchId = branch.branchId;
      const text = branchTexts[branchId] ?? `solution from ${branchId}`;
      const score = branchScores[branchId] ?? branch.index ?? 1;
      return sampleTrace(branchId, text, score);
    },
    ...(typeof finalJudge === 'function' ? { finalJudge } : {}),
    bestSingleRunner: bestSingleRunner ?? (async () => ({ status: 'completed' })),
    repeatedSamplingRunner: repeatedSamplingRunner ?? (async () => ({ status: 'completed' })),
    staticCouncilRunner: staticCouncilRunner ?? (async () => ({ status: 'completed' })),
    rhoRunner: rhoRunner ?? (async (input) => replayReport(
      input.comparisonLabel ?? input.candidateFamily?.[0]?.candidateId ?? 'icr_candidate_family',
    )),
  };
}

export async function runIcrLaneForTask({
  task = {},
  harnessConfig = {},
  runners = {},
  now = () => new Date(),
  includeRhoComparison,
  rhoRunner,
} = {}) {
  if (!icrLaneEnabled(harnessConfig)) {
    return {
      skipped: true,
      reason: 'icr_lane_disabled',
      ...EVIDENCE_ONLY_RESULT,
    };
  }

  const icrConfig = normalizeIcrConfig(harnessConfig.icr ?? {});
  const family = await runIcrCandidateFamily({
    task,
    config: icrConfig,
    runners,
    now: runners.now ?? now,
  });

  const shouldCompare = includeRhoComparison === true
    || harnessConfig.icr?.includeRhoComparison === true;

  let rhoReport;
  if (shouldCompare) {
    rhoReport = await runIcrRhoReplayComparison({
      task,
      suite: harnessConfig.icr?.suite ?? { items: [{ taskId: task.taskId ?? task.id ?? 'case_1' }] },
      config: icrConfig,
      runners: {
        ...runners,
        now: runners.now ?? now,
      },
      rhoRunner: rhoRunner ?? runners.rhoRunner,
    });
  }

  return {
    skipped: false,
    family,
    ...(rhoReport ? { rhoReport } : {}),
    ...EVIDENCE_ONLY_RESULT,
  };
}
