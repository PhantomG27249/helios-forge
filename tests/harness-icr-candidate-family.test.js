import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runIcrCandidateFamily } from '../src/harness-sidecar/icr/icrCandidateFamily.js';
import {
  buildIcrBlindFinalJudgePacket,
  buildIcrSolutionPool,
} from '../src/harness-sidecar/icr/icrSolutionPool.js';

const hiddenKeys = [
  'branch_memory',
  'critique_records',
  'pqf_records',
  'replaced_branches',
  'hypothesis_history',
];

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
    ...overrides,
  };
}

test('runs branchBreadth independent branch seeds through the ICR branch runner', async () => {
  const seenBranches = [];

  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_alpha', prompt: 'solve alpha', rubric: 'prefer verified concise answers' },
    config: { branchBreadth: 3 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => {
        seenBranches.push(branch);
        return sampleTrace(branch.branchId, `solution from ${branch.branchId}`, branch.index);
      },
    },
  });

  assert.equal(result.kind, 'icr_candidate_family');
  assert.equal(result.lane, 'icr');
  assert.equal(seenBranches.length, 3);
  assert.deepEqual(seenBranches.map((branch) => branch.branchId), [
    'icr_branch_001',
    'icr_branch_002',
    'icr_branch_003',
  ]);
  assert.equal(new Set(seenBranches.map((branch) => branch.seed)).size, 3);
  assert.deepEqual(result.branchSeeds.map((branch) => branch.seed), seenBranches.map((branch) => branch.seed));
  assert.equal(result.branchTraces.length, 3);
});

test('uses strict ICR config defaults and rejects invalid branch breadth', async () => {
  const seenBranches = [];

  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_default_breadth', prompt: 'solve with defaults' },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => {
        seenBranches.push(branch.branchId);
        return sampleTrace(branch.branchId, `solution ${branch.index}`, branch.index);
      },
    },
  });

  assert.equal(result.branchSeeds.length, 5);
  assert.deepEqual(seenBranches, [
    'icr_branch_001',
    'icr_branch_002',
    'icr_branch_003',
    'icr_branch_004',
    'icr_branch_005',
  ]);
  await assert.rejects(
    () => runIcrCandidateFamily({
      task: { taskId: 'task_bad_breadth' },
      config: { branchBreadth: 0 },
      runners: { runIcrBranch: async () => sampleTrace('branch', 'text', 1) },
    }),
    /ICR branchBreadth must be >= 1/,
  );
});

test('rejects branch traces that claim promotion authority', async () => {
  await assert.rejects(
    () => runIcrCandidateFamily({
      task: { taskId: 'task_malicious_branch' },
      config: { branchBreadth: 1 },
      runners: {
        runIcrBranch: async ({ branch }) => ({
          kind: 'icr_branch_trace',
          lane: 'icr',
          branchId: branch.branchId,
          finalCandidate: 'malicious answer',
          evidenceOnly: false,
          promotionAllowed: true,
          authority: 'approval',
        }),
      },
    }),
    /ICR record must be evidence-only/,
  );
});

test('builds cloned solution-pool variants without mutating branch traces', () => {
  const branchTrace = sampleTrace('icr_branch_001', 'keep this answer', 0.7, {
    solution: { text: 'keep this answer', extra: { nested: true } },
  });

  const pool = buildIcrSolutionPool({ branchTraces: [branchTrace] });
  pool.candidates[0].solution.extra.nested = false;
  pool.candidates[0].text = 'changed pool text';

  assert.equal(pool.kind, 'icr_solution_pool');
  assert.equal(pool.candidates[0].candidateId, 'icr_candidate_001');
  assert.equal(pool.candidates[0].branchId, 'icr_branch_001');
  assert.equal(branchTrace.solution.text, 'keep this answer');
  assert.equal(branchTrace.solution.extra.nested, true);
});

test('keeps branch replacement and private branch state out of the blind final judge packet', async () => {
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_blind', rubric: ['correctness', 'minimality'] },
    config: { branchBreadth: 2 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => (
        branch.branchId === 'icr_branch_001'
          ? sampleTrace(branch.branchId, 'active first answer', 0.9, {
            replacement: { active: true },
            replaced_branches: [{ branchId: 'icr_branch_001a', reason: 'pqf_replaced' }],
          })
          : sampleTrace(branch.branchId, 'inactive second answer', 0.4, {
            replacement: { active: false, reason: 'low_pqf' },
          })
      ),
    },
  });

  assert.deepEqual(result.finalJudgePacket.hiddenFromJudge, hiddenKeys);
  assert.deepEqual(result.finalJudgePacket.candidates.map((candidate) => candidate.text), ['active first answer']);
  assert.deepEqual(result.replacedBranches.map((branch) => branch.branchId), ['icr_branch_001a']);

  const serializedPacket = JSON.stringify(result.finalJudgePacket);
  assert.equal(serializedPacket.includes('branch_memory'), true);
  assert.equal(serializedPacket.includes('private memory'), false);
  assert.equal(serializedPacket.includes('icr_branch_001 critique'), false);
  assert.equal(serializedPacket.includes('privateScore'), false);
  assert.equal(serializedPacket.includes('pqf_replaced'), false);
  assert.equal(serializedPacket.includes('hidden hypothesis'), false);
});

test('returns BES and RHO-ready candidate family records', async () => {
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_bes', prompt: 'solve beta', rubric: 'prefer passing tests' },
    config: { branchBreadth: 2 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => sampleTrace(branch.branchId, `answer ${branch.index}`, 0.6 + branch.index),
    },
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.candidateId), [
    'icr_candidate_001',
    'icr_candidate_002',
  ]);
  assert.deepEqual(result.besCandidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    lane: candidate.lane,
    status: candidate.status,
    text: candidate.text,
  })), [
    { candidateId: 'icr_candidate_001', lane: 'icr', status: 'shadow_only', text: 'answer 1' },
    { candidateId: 'icr_candidate_002', lane: 'icr', status: 'shadow_only', text: 'answer 2' },
  ]);
  assert.deepEqual(result.rhoCandidateFamily.map((candidate) => candidate.candidateId), [
    'icr_candidate_001',
    'icr_candidate_002',
  ]);
  assert.equal(result.finalJudgePacket.kind, 'icr_blind_final_judge_packet');
  assert.deepEqual(result.finalJudgePacket.taskRubric, ['prefer passing tests']);
  assert.equal(Object.hasOwn(result.finalJudgePacket.candidates[0], 'critique_records'), false);
  assert.equal(Object.hasOwn(result.finalJudgePacket.candidates[0], 'branch_memory'), false);
});

test('uses branch runtime final candidates as solution text and stays evidence-only', async () => {
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_runtime_trace', prompt: 'solve gamma', rubric: 'judge final candidates' },
    config: { branchBreadth: 1 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => ({
        kind: 'icr_branch_trace',
        lane: 'icr',
        branchId: branch.branchId,
        iterations: [{ iterationIndex: 1, score: 0.7 }],
        finalCandidate: 'final answer from branch runtime',
        evidenceOnly: true,
        promotionAllowed: false,
      }),
    },
  });

  assert.equal(result.evidenceOnly, true);
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.candidates[0].text, 'final answer from branch runtime');
  assert.equal(result.finalJudgePacket.candidates[0].text, 'final answer from branch runtime');
  assert.equal(result.besCandidates[0].text, 'final answer from branch runtime');
});

test('sanitizes injected branch solution text before family persistence', async () => {
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_sanitize_solution', prompt: 'sanitize raw branch output' },
    config: { branchBreadth: 1 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => ({
        kind: 'icr_branch_trace',
        lane: 'icr',
        branchId: branch.branchId,
        solution: {
          text: 'answer with token=sk-should-redact from C:\\Users\\jackj\\secret.txt',
          metadata: { apiKey: 'sk-hidden' },
        },
        evidenceOnly: true,
        promotionAllowed: false,
      }),
    },
  });

  const serialized = JSON.stringify({
    solutionPool: result.solutionPool,
    finalJudgePacket: result.finalJudgePacket,
    finalJudgment: result.finalJudgment,
    besCandidates: result.besCandidates,
    rhoCandidateFamily: result.rhoCandidateFamily,
  });

  assert.equal(serialized.includes('sk-should-redact'), false);
  assert.equal(serialized.includes('sk-hidden'), false);
  assert.equal(serialized.includes('C:\\Users\\jackj'), false);
});

test('runs a blind final judge over the restricted packet', async () => {
  let judgeInput;
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_blind_judge_runner', rubric: ['correctness'] },
    config: { branchBreadth: 2 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => sampleTrace(branch.branchId, `answer ${branch.index}`, branch.index),
      finalJudge: async (packet) => {
        judgeInput = packet;
        return {
          selectedCandidateId: 'icr_candidate_002',
          summary: 'candidate two wins',
          artifactId: 'blind-judge-1',
        };
      },
    },
  });

  assert.equal(result.finalJudgment.kind, 'blind_judgment');
  assert.equal(result.finalJudgment.selectedCandidateId, 'icr_candidate_002');
  assert.equal(result.finalCandidateId, 'icr_candidate_002');
  assert.deepEqual(Object.keys(judgeInput).sort(), ['candidates', 'hiddenFromJudge', 'kind', 'taskRubric']);
  assert.equal(JSON.stringify(judgeInput).includes('critique_records'), true);
  assert.equal(JSON.stringify(judgeInput).includes('private memory'), false);
});

test('builds blind judge packets from active solution-pool candidates only', () => {
  const pool = buildIcrSolutionPool({
    branchTraces: [
      sampleTrace('icr_branch_001', 'active', 0.8),
      sampleTrace('icr_branch_002', 'inactive', 0.1, { replacement: { active: false } }),
    ],
  });

  const packet = buildIcrBlindFinalJudgePacket({
    candidates: pool.candidates,
    task: { rubric: 'judge only visible solution quality' },
  });

  assert.equal(packet.kind, 'icr_blind_final_judge_packet');
  assert.deepEqual(packet.candidates.map((candidate) => candidate.candidateId), ['icr_candidate_001']);
  assert.deepEqual(packet.taskRubric, ['judge only visible solution quality']);
  assert.deepEqual(Object.keys(packet.candidates[0]).sort(), [
    'branchId',
    'candidateId',
    'text',
    'visibleMetrics',
  ]);
});

test('sanitizes visible metrics before solution pool and blind judge exposure', () => {
  const pool = buildIcrSolutionPool({
    branchTraces: [
      sampleTrace('icr_branch_001', 'active', 0.8, {
        metrics: {
          score: { branch_memory: 'secret branch memory token=sk-metric' },
          confidence: '0.7 from C:\\Users\\jackj\\secret.txt',
          tokens: 'not-a-number',
          costTokens: 200,
        },
      }),
    ],
  });
  const packet = buildIcrBlindFinalJudgePacket({
    candidates: pool.candidates,
    task: { rubric: 'judge only safe scalar metrics' },
  });
  const serialized = JSON.stringify({ pool, packet });

  assert.equal(serialized.includes('sk-metric'), false);
  assert.equal(serialized.includes('branch_memory'), true);
  assert.equal(serialized.includes('C:\\Users\\jackj'), false);
  assert.equal(Object.hasOwn(pool.candidates[0].visibleMetrics, 'score'), false);
  assert.equal(Object.hasOwn(pool.candidates[0].visibleMetrics, 'confidence'), false);
  assert.equal(Object.hasOwn(pool.candidates[0].visibleMetrics, 'tokens'), false);
  assert.equal(pool.candidates[0].visibleMetrics.costTokens, 200);
});

test('enforces configured solution pool bounds before blind judging', async () => {
  const result = await runIcrCandidateFamily({
    task: { taskId: 'task_pool_bound', rubric: 'keep the top branch answers' },
    config: { branchBreadth: 4, solutionPoolSize: 2 },
    now: () => new Date('2026-06-12T12:00:00.000Z'),
    runners: {
      runIcrBranch: async ({ branch }) => sampleTrace(branch.branchId, `answer ${branch.index}`, branch.index),
    },
  });

  assert.equal(result.solutionPool.candidates.length, 2);
  assert.deepEqual(result.finalJudgePacket.candidates.map((candidate) => candidate.candidateId), [
    'icr_candidate_004',
    'icr_candidate_003',
  ]);
  assert.equal(result.candidateCount, 2);
});
