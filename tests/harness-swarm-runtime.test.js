import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRolePrompt, ROLE_REGISTRY } from '../src/harness-sidecar/swarm/rolePrompts.js';
import { runSubagentAttempt } from '../src/harness-sidecar/swarm/subagentRunner.js';
import { reviewAttempt } from '../src/harness-sidecar/swarm/reviewer.js';
import { recombineApprovedOutputs } from '../src/harness-sidecar/swarm/recombiner.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('role prompt builder scopes role instructions to allowed files and output contract', () => {
  assert.equal(ROLE_REGISTRY.implementer.id, 'implementer');
  assert.equal(ROLE_REGISTRY.reviewer.id, 'reviewer');
  assert.equal(ROLE_REGISTRY.recombiner.id, 'recombiner');
  assert.equal(ROLE_REGISTRY.verifier.id, 'verifier');

  const prompt = buildRolePrompt({
    role: 'implementer',
    task: { taskId: 'task_runtime', goal: 'Add swarm runtime MVP primitives.' },
    attempt: { attemptId: 'attempt_1', strategy: 'minimal_patch' },
    context: {
      assignedFiles: ['src/harness-sidecar/swarm/reviewer.js'],
      forbiddenFiles: ['public/app.js'],
      notes: ['Keep existing selector behavior intact.'],
    },
    budget: { tokens: 1200, maxOutputChars: 200 },
    outputContract: { requiredFields: ['patch', 'verifierEvidence'] },
  });

  assert.equal(prompt.role.id, 'implementer');
  assert.match(prompt.text, /src\/harness-sidecar\/swarm\/reviewer\.js/);
  assert.match(prompt.text, /patch, verifierEvidence/);
  assert.match(prompt.text, /Keep existing selector behavior intact/);
  assert.doesNotMatch(prompt.text, /public\/app\.js/);
  assert.equal(prompt.scope.allowedFiles.length, 1);
});

test('subagent runner passes scoped budget and enforces output contract', async () => {
  const calls = [];
  const result = await runSubagentAttempt({
    task: { taskId: 'task_runner', goal: 'Produce a patch.' },
    attempt: { attemptId: 'attempt_1', strategy: 'test_first' },
    role: 'implementer',
    context: { assignedFiles: ['src/harness-sidecar/swarm/subagentRunner.js'] },
    budget: { tokens: 250, maxOutputChars: 12 },
    outputContract: { requiredFields: ['patch', 'verifierEvidence'] },
    commandAdapter: async (input) => {
      calls.push(input);
      return {
        patch: 'abcdefghijklmnop',
        verifierEvidence: ['node --test tests/harness-swarm-runtime.test.js'],
        score: 88,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].budget.tokens, 250);
  assert.match(calls[0].prompt.text, /test_first/);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.patch, 'abcdefghijklmnop');
  assert.equal(result.contract.valid, true);
  assert.equal(result.budget.truncatedOutput.patch, 'abcdefghijkl');
  assert.equal(result.budget.exceeded, true);
});

test('subagent runner marks attempts with missing output contract fields', async () => {
  const result = await runSubagentAttempt({
    task: { taskId: 'task_runner_contract', goal: 'Produce verifier evidence.' },
    attempt: { attemptId: 'attempt_2', strategy: 'minimal_patch' },
    role: 'implementer',
    outputContract: { requiredFields: ['patch', 'verifierEvidence'] },
    commandAdapter: async () => ({ patch: 'diff --git a/file b/file' }),
  });

  assert.equal(result.status, 'contract_failed');
  assert.deepEqual(result.contract.missingFields, ['verifierEvidence']);
});

test('reviewer rejects risky attempts and attempts missing verifier evidence', () => {
  const missingVerifier = reviewAttempt({
    attempt: {
      attemptId: 'attempt_missing',
      output: { patch: 'diff --git a/src/a.js b/src/a.js' },
      patchStats: { changedLines: 5 },
      verifierEvidence: [],
    },
  });
  const riskyPatch = reviewAttempt({
    attempt: {
      attemptId: 'attempt_risky',
      output: {
        patch: 'diff --git a/src/harness-sidecar/server.js b/src/harness-sidecar/server.js',
        verifierEvidence: ['node --test tests/harness-swarm-runtime.test.js'],
      },
      patchStats: { changedLines: 220 },
    },
    riskPolicy: {
      maxChangedLines: 100,
      forbiddenPaths: ['src/harness-sidecar/server.js'],
    },
  });

  assert.equal(missingVerifier.approved, false);
  assert.equal(missingVerifier.reasons.includes('missing_verifier_evidence'), true);
  assert.equal(riskyPatch.approved, false);
  assert.equal(riskyPatch.reasons.includes('patch_too_large'), true);
  assert.equal(riskyPatch.reasons.includes('forbidden_path_touched'), true);
});

test('recombiner builds a proposal from reviewer-approved partial outputs', () => {
  const proposal = recombineApprovedOutputs({
    taskId: 'task_recombine',
    reviews: [
      {
        approved: true,
        attemptId: 'attempt_1',
        score: 80,
        output: { patch: 'patch-a', summary: 'Adds runner.', verifierEvidence: ['runner test'] },
      },
      {
        approved: false,
        attemptId: 'attempt_2',
        output: { patch: 'patch-b', summary: 'Risky patch.', verifierEvidence: ['review test'] },
      },
      {
        approved: true,
        attemptId: 'attempt_3',
        score: 90,
        output: { patch: 'patch-c', summary: 'Adds reviewer.', verifierEvidence: ['reviewer test'] },
      },
    ],
  });

  assert.equal(proposal.taskId, 'task_recombine');
  assert.deepEqual(proposal.sourceAttemptIds, ['attempt_3', 'attempt_1']);
  assert.deepEqual(proposal.patches, ['patch-c', 'patch-a']);
  assert.match(proposal.summary, /Adds reviewer/);
  assert.deepEqual(proposal.verifierEvidence, ['reviewer test', 'runner test']);
});

test('swarm orchestrator schedules multiple attempts and selects champion from verifier evidence', async () => {
  const calledAttempts = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_orchestrate', goal: 'Add primitives.' },
    taskType: 'coding_bugfix',
    maxAttempts: 3,
    context: {
      assignedFiles: ['src/harness-sidecar/swarm/swarmOrchestrator.js'],
      forbiddenFiles: ['public/app.js'],
    },
    budget: { tokens: 900, maxOutputChars: 500 },
    outputContract: { requiredFields: ['patch', 'verifierEvidence'] },
    commandAdapter: async ({ attempt }) => {
      calledAttempts.push(attempt.attemptId);
      if (attempt.attemptId === 'attempt_1') {
        return { patch: 'patch-1', score: 95, verifierEvidence: [] };
      }
      if (attempt.attemptId === 'attempt_2') {
        return { patch: 'patch-2', score: 72, verifierEvidence: ['node --test focused'] };
      }
      return { patch: 'patch-3', score: 60, verifierEvidence: ['node --test focused'], patchStats: { changedLines: 2 } };
    },
  });

  assert.deepEqual(calledAttempts, ['attempt_1', 'attempt_2', 'attempt_3']);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.reviews.filter((review) => review.approved).length, 2);
  assert.equal(result.champion.attemptId, 'attempt_2');
  assert.equal(result.champion.verifierPassed, true);
  assert.deepEqual(result.champion.verifierEvidence, ['node --test focused']);
  assert.deepEqual(result.recombination.sourceAttemptIds, ['attempt_2', 'attempt_3']);
});
