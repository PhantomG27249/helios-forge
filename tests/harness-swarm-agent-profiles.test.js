import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  getAgentProfile,
  loadDefaultAgentProfiles,
  selectAgentProfileForAttempt,
} from '../src/harness-sidecar/swarm/agentProfiles.js';
import { buildRolePrompt } from '../src/harness-sidecar/swarm/rolePrompts.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('default agent profiles are safe and deny dangerous tools', () => {
  const profiles = loadDefaultAgentProfiles();
  for (const profileId of [
    'implementer',
    'reviewer',
    'recombiner',
    'visual-specialist',
    'test-specialist',
    'risk-auditor',
    'researcher',
  ]) {
    const profile = getAgentProfile({ profiles, profileId });
    assert.equal(profile.id, profileId);
    assert.equal(profile.toolCaps.dangerousToolsAllowed, false);
    assert.equal(profile.toolCaps.denied.includes('shell.rm_rf'), true);
    assert.equal(Array.isArray(profile.outputContract.requiredFields), true);
  }
});

test('visual specialist has VLM access metadata', () => {
  const profile = getAgentProfile({
    profiles: loadDefaultAgentProfiles(),
    profileId: 'visual-specialist',
  });

  assert.equal(profile.vlm.allowed, true);
  assert.equal(profile.visualArtifacts.allowed, true);
  assert.equal(profile.outputContract.requiredFields.includes('visualEvidence'), true);
});

test('risk auditor cannot mutate the workspace', () => {
  const profile = getAgentProfile({
    profiles: loadDefaultAgentProfiles(),
    profileId: 'risk-auditor',
  });

  assert.equal(profile.workspace.mutationAllowed, false);
  assert.equal(profile.worktree.required, false);
  assert.equal(profile.toolCaps.denied.includes('git.apply'), true);
});

test('profile output contract feeds prompt builder', () => {
  const profile = getAgentProfile({
    profiles: loadDefaultAgentProfiles(),
    profileId: 'risk-auditor',
  });
  const prompt = buildRolePrompt({
    role: 'reviewer',
    profile,
    task: { taskId: 'task_prompt', goal: 'Audit patch risk.' },
    attempt: { attemptId: 'attempt_a', strategy: 'risk_scan' },
    context: { allowedFiles: ['src/harness-sidecar/swarm/rolePrompts.js'] },
    budget: { maxOutputChars: 500 },
  });

  assert.match(prompt.text, /Profile: risk-auditor/);
  assert.match(prompt.text, /Workspace mutation: denied/);
  assert.match(prompt.text, /Dangerous tools: denied/);
  assert.match(prompt.text, /riskFindings/);
  assert.deepEqual(prompt.outputContract.requiredFields, profile.outputContract.requiredFields);
});

test('profile selector routes visual and test attempts to specialist profiles', () => {
  const profiles = loadDefaultAgentProfiles();
  assert.equal(
    selectAgentProfileForAttempt({
      profiles,
      attempt: { specialization: 'visual-specialist' },
      task: { taskType: 'visual_ui' },
    }).id,
    'visual-specialist',
  );
  assert.equal(
    selectAgentProfileForAttempt({
      profiles,
      attempt: { strategy: 'add_focused_tests' },
      task: { taskType: 'coding_bugfix' },
    }).id,
    'test-specialist',
  );
});

test('profile selector ignores generic goal-tree source keys for normal implementer attempts', () => {
  const profiles = loadDefaultAgentProfiles();
  const profile = selectAgentProfileForAttempt({
    profiles,
    attempt: { strategy: 'minimal_patch' },
    task: {
      taskType: 'coding_bugfix',
      task: 'Fix the runtime handoff contract path.',
    },
    goalTree: {
      nodes: [
        {
          id: 'goal_1',
          description: 'Resolve malformed tool call',
          source: 'rho_failure',
        },
      ],
    },
  });

  assert.equal(profile.id, 'implementer');
});

test('orchestrator attaches selected profile metadata to attempts', async () => {
  const seen = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_profile_orchestrator', taskType: 'visual_ui' },
    taskType: 'visual_ui',
    maxAttempts: 1,
    planner: {
      enabled: true,
      evolutionPlanner: {
        enabled: true,
        evolutionArchive: [
          {
            candidateId: 'visual_candidate',
            strategy: 'inspect_visual_artifacts',
            evidence: [{ note: 'visual VLM artifact' }],
            score: 0.8,
            correct: true,
          },
        ],
      },
    },
    commandAdapter: async ({ attempt, prompt }) => {
      seen.push({ attempt, prompt });
      return { patch: 'patch', verifierEvidence: ['profile evidence'], score: 80 };
    },
  });

  assert.equal(seen[0].attempt.profile.id, 'visual-specialist');
  assert.match(seen[0].prompt.text, /Profile: visual-specialist/);
  assert.equal(result.attempts[0].profile.id, 'visual-specialist');
});
