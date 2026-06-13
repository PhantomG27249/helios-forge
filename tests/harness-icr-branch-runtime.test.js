import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runIcrBranch } from '../src/harness-sidecar/icr/icrBranchRuntime.js';

function createFakeRunners({ stopAfterIteration } = {}) {
  const calls = {
    strategy: [],
    hypothesis: [],
    executor: [],
    critique: [],
    correction: [],
    pqf: [],
    distiller: [],
  };

  return {
    calls,
    runners: {
      strategy: async (input) => {
        calls.strategy.push(input);
        return { strategy: `strategy:${input.branch.branchId}`, artifactId: 'artifact_strategy_1' };
      },
      hypothesis: async (input) => {
        calls.hypothesis.push(input);
        return {
          version: calls.hypothesis.length,
          hypotheses: [
            `hypothesis_v${calls.hypothesis.length}_a`,
            `hypothesis_v${calls.hypothesis.length}_b`,
          ],
          artifactId: `artifact_hypothesis_${calls.hypothesis.length}`,
        };
      },
      executor: async (input) => {
        calls.executor.push(input);
        return {
          candidateText: `candidate_${input.iterationIndex}_with_${input.hypotheses.version}`,
          artifactId: `artifact_candidate_${input.iterationIndex}`,
        };
      },
      critique: async (input) => {
        calls.critique.push(input);
        return {
          summary: `critique_${input.iterationIndex}`,
          score: input.iterationIndex / 10,
          artifactId: `artifact_critique_${input.iterationIndex}`,
        };
      },
      correction: async (input) => {
        calls.correction.push(input);
        return {
          summary: `correction_${input.iterationIndex}`,
          candidateText: `${input.candidateText}_corrected`,
          score: input.score + 0.5,
          artifactId: `artifact_correction_${input.iterationIndex}`,
          stop: input.iterationIndex === stopAfterIteration,
        };
      },
      pqf: async (input) => {
        calls.pqf.push(input);
        return {
          pqfId: `pqf_${input.iterationIndex}`,
          score: input.iterations.at(-1).score,
          kept: true,
          artifactId: `artifact_pqf_${input.iterationIndex}`,
        };
      },
      distiller: async (input) => {
        calls.distiller.push(input);
        return {
          distillationId: `distill_${input.iterationIndex}`,
          summary: `memory_${input.iterationIndex}`,
          artifactId: `artifact_distill_${input.iterationIndex}`,
        };
      },
    },
  };
}

test('records deterministic branch iterations with cadence artifacts and evidence-only authority', async () => {
  const { runners, calls } = createFakeRunners();

  const trace = await runIcrBranch({
    task: { taskId: 'task_icr_1', prompt: 'Improve the harness branch runtime.' },
    branch: { branchId: 'branch_alpha' },
    config: {
      correctionDepth: 5,
      hypothesisRefreshInterval: 2,
      pqfInterval: 2,
      distillationInterval: 3,
    },
    runners,
    now: () => '2026-06-12T00:00:00.000Z',
  });

  assert.equal(trace.kind, 'icr_branch_trace');
  assert.equal(trace.lane, 'icr');
  assert.equal(trace.branchId, 'branch_alpha');
  assert.equal(trace.strategy, 'strategy:branch_alpha');
  assert.equal(trace.evidenceOnly, true);
  assert.equal(trace.promotionAllowed, false);
  assert.equal(trace.iterations.length, 5);
  assert.deepEqual(trace.iterations.map((iteration) => iteration.iterationIndex), [1, 2, 3, 4, 5]);
  assert.deepEqual(trace.iterations.map((iteration) => iteration.hypothesisVersion), [1, 1, 2, 2, 3]);
  assert.deepEqual(calls.hypothesis.map((call) => call.iterationIndex), [1, 3, 5]);
  assert.deepEqual(calls.pqf.map((call) => call.iterationIndex), [2, 4]);
  assert.deepEqual(calls.distiller.map((call) => call.iterationIndex), [3]);
  assert.deepEqual(trace.pqfRecords.map((record) => record.pqfId), ['pqf_2', 'pqf_4']);
  assert.deepEqual(trace.distillationRecords.map((record) => record.distillationId), ['distill_3']);
  assert.deepEqual(trace.activeHypotheses, ['hypothesis_v3_a', 'hypothesis_v3_b']);
  assert.equal(trace.finalCandidate, 'candidate_5_with_3_corrected');

  for (const iteration of trace.iterations) {
    assert.match(iteration.inputDigest, /^icr_input_[a-f0-9]{16}$/);
    assert.equal(typeof iteration.candidateText, 'string');
    assert.equal(typeof iteration.critiqueSummary, 'string');
    assert.equal(typeof iteration.correctionSummary, 'string');
    assert.equal(typeof iteration.score, 'number');
    assert.deepEqual(Object.keys(iteration.artifactIds).sort(), [
      'correction',
      'critique',
      'executor',
      'hypothesis',
    ]);
  }

  const serialized = JSON.stringify(trace);
  assert.equal(serialized.includes('approval'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('apiKey'), false);
});

test('stops before correctionDepth when the correction runner returns a deterministic stop decision', async () => {
  const { runners, calls } = createFakeRunners({ stopAfterIteration: 3 });

  const trace = await runIcrBranch({
    task: { taskId: 'task_icr_stop', prompt: 'Stop after stable candidate.' },
    branch: { branchId: 'branch_stop', strategy: 'seeded' },
    config: {
      correctionDepth: 7,
      hypothesisRefreshInterval: 2,
      pqfInterval: 2,
      distillationInterval: 3,
    },
    runners,
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.equal(trace.iterations.length, 3);
  assert.equal(trace.iterations.at(-1).stopReason, 'runner_stop_decision');
  assert.deepEqual(calls.pqf.map((call) => call.iterationIndex), [2]);
  assert.deepEqual(calls.distiller.map((call) => call.iterationIndex), [3]);
  assert.equal(trace.finalCandidate, 'candidate_3_with_2_corrected');
});

test('strips secret and authority-shaped fields from runner records persisted in the trace', async () => {
  const { runners } = createFakeRunners();
  runners.pqf = async (input) => ({
    pqfId: `pqf_${input.iterationIndex}`,
    score: 0.8,
    artifactId: `artifact_pqf_${input.iterationIndex}`,
    approval: { granted: true },
    promotionAuthority: true,
    apiKey: 'raw-secret-value',
    nested: {
      Authorization: 'Bearer raw-secret-value',
      keptReason: 'candidate improved',
    },
  });
  runners.distiller = async (input) => ({
    distillationId: `distill_${input.iterationIndex}`,
    summary: 'compact memory',
    artifactId: `artifact_distill_${input.iterationIndex}`,
    secretToken: 'raw-secret-value',
    authority: 'approve',
  });
  runners.executor = async (input) => ({
    candidateText: `candidate ${input.iterationIndex} with Authorization: Bearer raw-secret-value from C:\\Users\\jackj\\private.txt`,
    artifactId: `artifact_candidate_${input.iterationIndex}`,
  });
  runners.critique = async (input) => ({
    summary: 'critique with password=hunter2',
    score: 0.8,
    artifactId: `artifact_critique_${input.iterationIndex}`,
  });
  runners.correction = async (input) => ({
    summary: 'correction with token=sk-should-redact',
    candidateText: `${input.candidateText} corrected with api_key=plain-secret`,
    score: 0.9,
    artifactId: `artifact_correction_${input.iterationIndex}`,
  });

  const trace = await runIcrBranch({
    task: { taskId: 'task_icr_sanitize', prompt: 'Sanitize runner records.' },
    branch: { branchId: 'branch_sanitize' },
    config: {
      correctionDepth: 2,
      hypothesisRefreshInterval: 2,
      pqfInterval: 2,
      distillationInterval: 2,
    },
    runners,
    now: '2026-06-12T00:00:00.000Z',
  });

  assert.equal(trace.pqfRecords[0].pqfId, 'pqf_2');
  assert.equal(trace.pqfRecords[0].nested.keptReason, 'candidate improved');
  assert.equal(trace.distillationRecords[0].distillationId, 'distill_2');

  const serialized = JSON.stringify(trace);
  assert.equal(serialized.includes('raw-secret-value'), false);
  assert.equal(serialized.includes('hunter2'), false);
  assert.equal(serialized.includes('sk-should-redact'), false);
  assert.equal(serialized.includes('plain-secret'), false);
  assert.equal(serialized.includes('C:\\Users\\jackj'), false);
  assert.equal(serialized.includes('approval'), false);
  assert.equal(serialized.includes('promotionAuthority'), false);
  assert.equal(serialized.includes('Authorization'), false);
  assert.equal(serialized.includes('secretToken'), false);
  assert.equal(serialized.includes('"authority"'), false);
});
