import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRolePrompt, ROLE_REGISTRY } from '../src/harness-sidecar/swarm/rolePrompts.js';
import { runSubagentAttempt } from '../src/harness-sidecar/swarm/subagentRunner.js';
import { reviewAttempt } from '../src/harness-sidecar/swarm/reviewer.js';
import { recombineApprovedOutputs } from '../src/harness-sidecar/swarm/recombiner.js';
import { scheduleAttempts } from '../src/harness-sidecar/swarm/attemptScheduler.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';
import { loadDefaultAgentProfiles } from '../src/harness-sidecar/swarm/agentProfiles.js';

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
        evolutionOutput: { hardCaseTags: ['missing_context'] },
        score: 88,
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].budget.tokens, 250);
  assert.match(calls[0].prompt.text, /test_first/);
  assert.equal(result.status, 'completed');
  assert.equal(result.output.patch, 'abcdefghijklmnop');
  assert.deepEqual(result.evolutionOutput.hardCaseTags, ['missing_context']);
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

test('default swarm profiles expose browser tools only to visual specialists', () => {
  const profiles = loadDefaultAgentProfiles();
  const visualTools = profiles['visual-specialist'].toolCaps.allowed;
  const implementerTools = profiles.implementer.toolCaps.allowed;
  const browserTools = [
    'browser.session.create',
    'browser.navigate',
    'browser.screenshot',
    'browser.console.read',
    'browser.network.summary',
  ];

  for (const tool of browserTools) {
    assert.equal(visualTools.includes(tool), true, `${tool} should be visual-specialist scoped`);
    assert.equal(implementerTools.includes(tool), false, `${tool} should not be implementer scoped`);
  }
});

test('subagent runner fails attempts with forbidden local durable approval', async () => {
  const result = await runSubagentAttempt({
    task: { taskId: 'task_runner_local_approval', goal: 'Reject local approval.' },
    attempt: { attemptId: 'attempt_local_approval', strategy: 'guardrails' },
    role: 'implementer',
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
    commandAdapter: async () => ({
      summary: 'Tried to approve a durable change locally.',
      verifierEvidence: ['node --test tests/harness-swarm-runtime.test.js'],
      evolutionOutput: {
        durableApplyApproved: true,
        suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
      },
    }),
  });

  assert.equal(result.status, 'contract_failed');
  assert.equal(result.contract.valid, false);
  assert.equal(result.contract.reasons.includes('local_durable_approval_forbidden'), true);
});

test('subagent runner normalizes compact handoff and scores handoff quality deterministically', async () => {
  const result = await runSubagentAttempt({
    task: { taskId: 'task_runner_handoff', goal: 'Produce compact handoff.' },
    attempt: { attemptId: 'attempt_handoff', strategy: 'handoff_first' },
    role: 'implementer',
    outputContract: { requiredFields: ['summary', 'verifierEvidence'] },
    commandAdapter: async () => ({
      summary: 'Added compact handoff scoring for swarm attempts.',
      filesInspected: 'src/harness-sidecar/swarm/subagentRunner.js',
      filesChanged: ['src/harness-sidecar/swarm/subagentRunner.js'],
      verifierEvidence: ['node --test tests/harness-swarm-runtime.test.js'],
      testsRun: 'node --test tests/harness-swarm-runtime.test.js',
      blocker: '',
      nextAction: 'Run the focused swarm tests and commit the scoped change.',
      sourcePointers: ['subagentRunner.js:runSubagentAttempt'],
      risks: ['Scoring weights should stay deterministic.'],
    }),
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.compactHandoff, {
    summary: 'Added compact handoff scoring for swarm attempts.',
    filesInspected: ['src/harness-sidecar/swarm/subagentRunner.js'],
    filesChanged: ['src/harness-sidecar/swarm/subagentRunner.js'],
    commandsRun: [],
    testsRun: ['node --test tests/harness-swarm-runtime.test.js'],
    blocker: null,
    nextAction: 'Run the focused swarm tests and commit the scoped change.',
    sourcePointers: ['subagentRunner.js:runSubagentAttempt'],
    uncertainty: [],
    risks: ['Scoring weights should stay deterministic.'],
  });
  assert.equal(result.handoffQuality.score, 100);
  assert.deepEqual(result.handoffQuality.findings, []);
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
  const attemptEvents = [];
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
    onAttemptEvent: async (event) => {
      attemptEvents.push(event);
    },
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
  assert.deepEqual(attemptEvents.map((event) => event.type), [
    'swarm.subagent_started',
    'swarm.subagent_completed',
    'swarm.subagent_started',
    'swarm.subagent_completed',
    'swarm.subagent_started',
    'swarm.subagent_completed',
  ]);
  assert.deepEqual(
    attemptEvents
      .filter((event) => event.type === 'swarm.subagent_started')
      .map((event) => event.attemptId),
    ['attempt_1', 'attempt_2', 'attempt_3'],
  );
  assert.equal(attemptEvents[1].score, 95);
  assert.equal(attemptEvents[3].verifierPassed, true);
  assert.equal(result.attempts.length, 3);
  assert.equal(result.reviews.filter((review) => review.approved).length, 2);
  assert.equal(result.champion.attemptId, 'attempt_2');
  assert.equal(result.champion.verifierPassed, true);
  assert.deepEqual(result.champion.verifierEvidence, ['node --test focused']);
  assert.deepEqual(result.recombination.sourceAttemptIds, ['attempt_2', 'attempt_3']);
});

test('swarm orchestrator runs real command attempts inside isolated worktrees and cleans up', async () => {
  const lifecycle = [];
  const commandCwds = [];
  const verifierCwds = [];
  const worktreeManager = {
    async isGitRepo() {
      lifecycle.push(['isGitRepo']);
      return true;
    },
    async createAttemptWorktree({ taskId, attemptId }) {
      lifecycle.push(['create', taskId, attemptId]);
      return {
        available: true,
        taskId,
        attemptId,
        branchName: `harness/${taskId}/${attemptId}`,
        worktreePath: `C:\\repo\\.harness\\worktrees\\${taskId}\\${attemptId}`,
      };
    },
    async removeAttemptWorktree(attemptWorktree) {
      lifecycle.push(['remove', attemptWorktree.attemptId]);
    },
  };

  const result = await orchestrateSwarm({
    task: { taskId: 'task_worktree', goal: 'Run isolated attempts.' },
    taskType: 'coding_bugfix',
    maxAttempts: 2,
    workspaceRoot: 'C:\\repo',
    worktreeManager,
    command: 'npm run attempt',
    verifierCommand: 'node --test tests/harness-swarm-runtime.test.js',
    commandAdapter: async ({ attempt, cwd }) => {
      commandCwds.push([attempt.attemptId, cwd]);
      return {
        patch: `diff --git a/src/harness-sidecar/swarm/${attempt.attemptId}.js b/src/harness-sidecar/swarm/${attempt.attemptId}.js\n+ok\n`,
        stdout: 'attempt ok\n',
        exitCode: 0,
      };
    },
    verifierAdapter: async ({ attempt, cwd }) => {
      verifierCwds.push([attempt.attemptId, cwd]);
      return {
        stdout: `verified ${attempt.attemptId}\n`,
        exitCode: 0,
      };
    },
  });

  assert.deepEqual(commandCwds, [
    ['attempt_1', 'C:\\repo\\.harness\\worktrees\\task_worktree\\attempt_1'],
    ['attempt_2', 'C:\\repo\\.harness\\worktrees\\task_worktree\\attempt_2'],
  ]);
  assert.deepEqual(verifierCwds, commandCwds);
  assert.deepEqual(lifecycle, [
    ['isGitRepo'],
    ['create', 'task_worktree', 'attempt_1'],
    ['remove', 'attempt_1'],
    ['isGitRepo'],
    ['create', 'task_worktree', 'attempt_2'],
    ['remove', 'attempt_2'],
  ]);
  assert.equal(result.runMode.mode, 'real');
  assert.deepEqual(result.attempts.map((attempt) => attempt.worker.kind), [
    'worktree_command',
    'worktree_command',
  ]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.worktree.cleanedUp), [true, true]);
  assert.equal(result.attempts[0].verifierEvidence.length, 2);
  assert.equal(result.champion.verifierPassed, true);
});

test('swarm orchestrator cleans up worktree attempts after command adapter failure', async () => {
  const lifecycle = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_worktree_failure', goal: 'Clean up failed worktree.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    workspaceRoot: 'C:\\repo',
    worktreeManager: {
      async isGitRepo() {
        return true;
      },
      async createAttemptWorktree({ attemptId }) {
        lifecycle.push(['create', attemptId]);
        return {
          available: true,
          attemptId,
          branchName: `harness/task_worktree_failure/${attemptId}`,
          worktreePath: `C:\\repo\\.harness\\worktrees\\task_worktree_failure\\${attemptId}`,
        };
      },
      async removeAttemptWorktree(attemptWorktree) {
        lifecycle.push(['remove', attemptWorktree.attemptId]);
      },
    },
    commandAdapter: async () => {
      throw new Error('attempt command failed');
    },
  });

  assert.deepEqual(lifecycle, [
    ['create', 'attempt_1'],
    ['remove', 'attempt_1'],
  ]);
  assert.equal(result.attempts[0].status, 'failed');
  assert.equal(result.attempts[0].failure.reason, 'worktree_command_failed');
  assert.match(result.attempts[0].failure.message, /attempt command failed/);
  assert.equal(result.attempts[0].worktree.cleanedUp, true);
});

test('swarm orchestrator marks worktree attempt verifier failed when verifier adapter fails', async () => {
  const result = await orchestrateSwarm({
    task: { taskId: 'task_worktree_verifier_fail', goal: 'Report failed verifier.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    workspaceRoot: 'C:\\repo',
    worktreeManager: {
      async isGitRepo() {
        return true;
      },
      async createAttemptWorktree({ attemptId }) {
        return {
          available: true,
          attemptId,
          worktreePath: `C:\\repo\\.harness\\worktrees\\task_worktree_verifier_fail\\${attemptId}`,
        };
      },
      async removeAttemptWorktree() {},
    },
    commandAdapter: async () => ({
      patch: 'diff --git a/src/harness-sidecar/swarm/a.js b/src/harness-sidecar/swarm/a.js\n+ok\n',
      exitCode: 0,
    }),
    verifierAdapter: async () => ({
      stderr: 'not ok 1 - verifier failed\n',
      exitCode: 1,
    }),
  });

  assert.equal(result.attempts[0].score, 0);
  assert.equal(result.attempts[0].verifierPassed, false);
  assert.equal(result.attempts[0].verifierEvidence.at(-1).exitCode, 1);
});

test('swarm orchestrator preserves deterministic dry-run fallback without a model executor', async () => {
  const result = await orchestrateSwarm({
    task: { taskId: 'task_dry_run', goal: 'Stay deterministic offline.' },
    taskType: 'coding_bugfix',
    maxAttempts: 2,
  });

  assert.equal(result.runMode.mode, 'dry-run');
  assert.deepEqual(result.attempts.map((attempt) => attempt.strategy), ['reproduce_first', 'minimal_patch']);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['completed', 'completed']);
  assert.equal(result.attempts[0].worker.kind, 'deterministic_subagent');
});

test('swarm orchestrator calls a supplied model executor for independent attempts', async () => {
  const modelCalls = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_model_orchestrate', goal: 'Run independent model workers.' },
    taskType: 'coding_bugfix',
    maxAttempts: 2,
    modelExecutor: async (input) => {
      modelCalls.push(input);
      return {
        callId: `call_${input.attempt.attemptId}`,
        structured: {
          summary: `Model completed ${input.attempt.strategy}.`,
          patch: `diff --git a/${input.attempt.attemptId} b/${input.attempt.attemptId}`,
          verifierEvidence: [`verified ${input.attempt.attemptId}`],
          score: input.attempt.attemptId === 'attempt_1' ? 70 : 80,
        },
      };
    },
  });

  assert.deepEqual(modelCalls.map((call) => call.attempt.attemptId), ['attempt_1', 'attempt_2']);
  assert.deepEqual(modelCalls.map((call) => call.requestId), [
    'task_model_orchestrate:attempt_1:model_worker',
    'task_model_orchestrate:attempt_2:model_worker',
  ]);
  assert.equal(result.runMode.mode, 'model-driven');
  assert.deepEqual(result.attempts.map((attempt) => attempt.worker.kind), ['model_driven', 'model_driven']);
  assert.deepEqual(result.attempts.map((attempt) => attempt.model.requestId), [
    'task_model_orchestrate:attempt_1:model_worker',
    'task_model_orchestrate:attempt_2:model_worker',
  ]);
  assert.equal(result.champion.attemptId, 'attempt_2');
});

test('swarm orchestrator routes model-driven attempts through role-specific council profiles', async () => {
  const modelCalls = [];
  const events = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_model_council_routes', goal: 'Run role-specialized model workers.' },
    taskType: 'coding_bugfix',
    maxAttempts: 2,
    planner: {
      enabled: true,
      strategy: 'tooltree',
      task: 'route council attempts',
      rootState: { key: 'root' },
      budget: { maxIterations: 2, maxDepth: 1, exploration: 0 },
      expandNode: ({ state }) => (state.key === 'root'
        ? [
          { action: { strategy: 'minimal_patch' }, state: { key: 'patch' } },
          { action: { strategy: 'risk_review' }, state: { key: 'risk' } },
        ]
        : []),
      evaluateNode: ({ state }) => (state.key === 'patch' ? 0.8 : 0.7),
    },
    modelCouncil: {
      enabled: true,
      authority: 'evidence_only',
      canPromote: false,
      roleRoutes: {
        implementer: {
          role: 'implementer',
          modelProfile: 'implementer_model',
          endpointProfile: 'fast',
          endpoint: { baseUrl: 'http://fast.test/v1', modelId: 'fast-model' },
          authority: 'evidence_only',
          canPromote: false,
        },
        'risk-auditor': {
          role: 'risk-auditor',
          modelProfile: 'reviewer_model',
          endpointProfile: 'critic',
          endpoint: { baseUrl: 'http://critic.test/v1', modelId: 'critic-model' },
          authority: 'evidence_only',
          canPromote: false,
        },
      },
    },
    modelExecutor: async (input) => {
      modelCalls.push(input);
      return {
        callId: `call_${input.attempt.attemptId}`,
        profile: { name: input.profileName, model: `${input.profileName}_id` },
        structured: {
          summary: `Model completed ${input.attempt.strategy}.`,
          patch: `diff --git a/${input.attempt.attemptId} b/${input.attempt.attemptId}`,
          verifierEvidence: [`verified ${input.attempt.attemptId}`],
          score: input.profileName === 'implementer_model' ? 80 : 70,
        },
      };
    },
    onAttemptEvent: (event) => events.push(event),
  });

  assert.deepEqual(modelCalls.map((call) => call.profileName), [
    'implementer_model',
    'reviewer_model',
  ]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.model.route.modelProfile), [
    'implementer_model',
    'reviewer_model',
  ]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.model.route.endpointProfile), ['fast', 'critic']);
  assert.equal(result.modelCouncil.authority, 'evidence_only');
  assert.equal(result.modelCouncil.canPromote, false);
  assert.equal(result.modelCouncil.modelDiversity.uniqueModelProfiles, 2);
  assert.equal(events.some((event) => event.type === 'model_council.report_created'), true);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'swarm.subagent_started')
      .map((event) => event.model.profileName),
    ['implementer_model', 'reviewer_model'],
  );
});

test('swarm orchestrator records adaptive model router decisions and rewards as evidence only', async () => {
  const events = [];
  const rewards = [];
  const decisions = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_model_router_rewards', goal: 'Route and reward model choices.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    modelCouncil: {
      enabled: true,
      authority: 'evidence_only',
      canPromote: false,
      roleRoutes: {
        implementer: {
          role: 'implementer',
          modelProfile: 'baseline_model',
          endpointProfile: 'baseline',
          endpoint: { baseUrl: 'http://baseline.test/v1', modelId: 'baseline-model' },
          authority: 'evidence_only',
          canPromote: false,
        },
      },
    },
    modelRouter: {
      enabled: true,
      rewardWeights: { verifier: 0.4, reviewer: 0.2, councilAgreement: 0.15, safety: 0.15, latency: 0.05, cost: 0.05 },
      policy: {
        selectArm({ key, role, arms }) {
          const decision = {
            type: 'model_router.arm_selected',
            authority: 'evidence_only',
            canPromote: false,
            key,
            actionId: `router_${role}`,
            role,
            armId: 'router_model',
            modelProfile: 'router_model',
            endpointProfile: 'router_endpoint',
            posterior: { alpha: 1, beta: 1, observations: 0 },
            alternatives: arms.map((arm) => ({ armId: arm.armId, sampledValue: 0.5, observations: 0 })),
          };
          decisions.push(decision);
          return decision;
        },
      },
      state: {
        recordReward(reward) {
          rewards.push(reward);
        },
      },
    },
    modelExecutor: async (input) => ({
      callId: `call_${input.attempt.attemptId}`,
      profile: { name: input.profileName, model: `${input.profileName}_id` },
      structured: {
        summary: `Router selected ${input.profileName}.`,
        verifierEvidence: [`verified ${input.profileName}`],
        score: 88,
      },
    }),
    onAttemptEvent: (event) => events.push(event),
  });

  assert.equal(decisions.length, 1);
  assert.equal(rewards.length, 1);
  assert.equal(rewards[0].armId, 'router_model');
  assert.equal(events.findIndex((event) => event.type === 'model_router.arm_selected') < events.findIndex((event) => event.type === 'swarm.subagent_started'), true);
  assert.equal(events.some((event) => event.type === 'model_router.reward_recorded'), true);
  assert.equal(result.attempts[0].model.route.modelProfile, 'router_model');
  assert.equal(result.modelRouter.authority, 'evidence_only');
  assert.equal(result.modelRouter.canPromote, false);
  assert.deepEqual(result.modelRouter.decisions.map((decision) => decision.armId), ['router_model']);
  assert.deepEqual(result.modelRouter.rewards.map((reward) => reward.armId), ['router_model']);
});

test('swarm orchestrator preserves invalid model-driven evolution contracts', async () => {
  const result = await orchestrateSwarm({
    task: { taskId: 'task_model_contract_failure', goal: 'Reject local model approval.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    modelExecutor: async () => ({
      structured: {
        summary: 'Model proposed a local durable approval.',
        verifierEvidence: ['focused verifier evidence'],
        evolutionOutput: {
          durableApplyApproved: true,
          suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
        },
      },
    }),
  });

  assert.equal(result.attempts[0].status, 'contract_failed');
  assert.equal(result.attempts[0].contract.valid, false);
  assert.equal(result.attempts[0].contract.reasons.includes('local_durable_approval_forbidden'), true);
  assert.equal(result.attempts[0].evolutionOutput.durableApplyApproved, false);
});

test('swarm orchestrator ignores non-callable provider metadata for model execution', async () => {
  const result = await orchestrateSwarm({
    task: { taskId: 'task_provider_metadata', goal: 'Do not treat provider config as executor.' },
    taskType: 'coding_bugfix',
    maxAttempts: 1,
    provider: { name: 'metadata-only' },
  });

  assert.equal(result.runMode.mode, 'dry-run');
  assert.equal(result.attempts[0].worker.kind, 'deterministic_subagent');
  assert.equal(result.attempts[0].status, 'completed');
});

test('swarm orchestrator accepts model gateways with call methods', async () => {
  const calls = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_gateway_call', goal: 'Use gateway call method.' },
    maxAttempts: 1,
    modelGateway: {
      async call(input) {
        calls.push(input);
        return {
          structured: {
            summary: 'Gateway completed the attempt.',
            verifierEvidence: ['gateway evidence'],
            score: 81,
          },
        };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.runMode.mode, 'model-driven');
  assert.equal(result.attempts[0].worker.kind, 'model_driven');
  assert.equal(result.attempts[0].status, 'completed');
});

test('ToolTree planner strategy ranks and schedules attempts with plan metadata', () => {
  const attempts = scheduleAttempts({
    taskId: 'task_tooltree_schedule',
    taskType: 'coding_bugfix',
    maxAttempts: 2,
    planner: {
      enabled: true,
      strategy: 'tooltree',
      rootState: { key: 'root' },
      budget: { maxIterations: 3, maxDepth: 1, exploration: 0 },
      expandNode: ({ state }) => {
        if (state.key !== 'root') return [];
        return [
          { action: { strategy: 'slow_broad', focus: 'survey' }, state: { key: 'slow' } },
          { action: { strategy: 'fast_patch', focus: 'owned-files' }, state: { key: 'fast' } },
        ];
      },
      evaluateNode: ({ state }) => (state.key === 'fast' ? 0.9 : 0.2),
    },
  });

  assert.deepEqual(attempts.map((attempt) => attempt.strategy), ['fast_patch', 'slow_broad']);
  assert.deepEqual(attempts.map((attempt) => attempt.planning.strategy), ['tooltree', 'tooltree']);
  assert.deepEqual(attempts[0].planning.toolPlan.action, { strategy: 'fast_patch', focus: 'owned-files' });
  assert.equal(attempts[0].planning.rank, 1);
  assert.equal(attempts[0].planning.score, 0.9);
});

test('model worker failure in one attempt does not collapse remaining attempts', async () => {
  const attemptEvents = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_model_failure', goal: 'Keep trying after one model failure.' },
    taskType: 'coding_bugfix',
    maxAttempts: 3,
    onAttemptEvent: async (event) => attemptEvents.push(event),
    modelExecutor: async ({ attempt }) => {
      if (attempt.attemptId === 'attempt_2') {
        throw new Error('provider timeout');
      }
      return {
        callId: `call_${attempt.attemptId}`,
        structured: {
          summary: `Completed ${attempt.attemptId}.`,
          patch: `diff --git a/${attempt.attemptId} b/${attempt.attemptId}`,
          verifierEvidence: [`verified ${attempt.attemptId}`],
          score: attempt.attemptId === 'attempt_1' ? 50 : 90,
        },
      };
    },
  });

  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ['completed', 'failed', 'completed']);
  assert.equal(result.attempts[1].failure.reason, 'model_worker_failed');
  assert.match(result.attempts[1].failure.message, /provider timeout/);
  assert.equal(result.attempts[2].status, 'completed');
  assert.equal(result.champion.attemptId, 'attempt_3');
  assert.deepEqual(
    attemptEvents
      .filter((event) => event.type === 'swarm.subagent_completed')
      .map((event) => [event.attemptId, event.status, event.failure?.reason || null]),
    [
      ['attempt_1', 'completed', null],
      ['attempt_2', 'failed', 'model_worker_failed'],
      ['attempt_3', 'completed', null],
    ],
  );
});
