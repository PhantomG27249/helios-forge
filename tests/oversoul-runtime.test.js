import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOversoulRuntimeContext } from '../src/harness-sidecar/souls/oversoulRuntime.js';
import { summarizeCapabilityGoalStatus } from '../src/harness-sidecar/meta/capabilityGoalStatus.js';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('oversoul runtime summarizes role ecology as advisory context only', () => {
  const context = buildOversoulRuntimeContext({
    oversoul: {
      id: 'helios',
      version: '4',
      sections: {
        'Role Ecology': '- Missing roles: visual, memory\n- Core roles: implementer, reviewer',
        'Strategy Posture': '- Exploration pressure: high\n- Evidence threshold: strict',
      },
      promptAdapterNotes: 'Prioritize visual reviewers.',
    },
    soulCoverage: { activeSoulCount: 2, missingSoulCount: 1 },
  });

  assert.equal(context.authority, 'advisory');
  assert.equal(context.canPromote, false);
  assert.equal(context.oversoulRef.oversoulVersion, '4');
  assert.deepEqual(context.roleEcology.missingRoles, ['memory', 'visual']);
  assert.equal(context.capabilitySignals[0].goalId, 'soul_coverage');
});

test('capability goal status includes soul and oversoul advisory rows', () => {
  const status = summarizeCapabilityGoalStatus({
    signals: [
      { goalId: 'soul_coverage', evidence: ['soul_records'], blockers: ['missing_runtime_store'] },
      { goalId: 'oversoul_coverage', evidence: ['oversoul_contract'] },
    ],
  });

  assert.equal(status.goals.some((goal) => goal.goalId === 'soul_coverage'), true);
  assert.equal(status.goals.find((goal) => goal.goalId === 'soul_coverage').canPromote, false);
});

test('swarm orchestrator carries oversoul context into scheduled attempts without authority', async () => {
  const result = await orchestrateSwarm({
    task: { taskId: 'task_oversoul', goal: 'test' },
    maxAttempts: 1,
    oversoulContext: buildOversoulRuntimeContext({
      oversoul: { id: 'helios', version: '2', sections: {}, promptAdapterNotes: 'Use reviewers.' },
    }),
  });

  assert.equal(result.oversoul.authority, 'advisory');
  assert.equal(result.attempts[0].oversoulRef.oversoulVersion, '2');
});
