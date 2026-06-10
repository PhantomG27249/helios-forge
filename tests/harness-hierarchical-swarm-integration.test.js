import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('swarm orchestration emits local meta and memory hierarchy feedback', async () => {
  const events = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_hierarchical', task: 'test hierarchical loop' },
    context: { assignedFiles: ['src/harness-sidecar/swarm/swarmOrchestrator.js'] },
    featureFlags: { localMetaHarness: true, localMemoryGraph: true },
    commandAdapter: async () => ({
      summary: 'done',
      verifierEvidence: ['node --test'],
      evolutionOutput: { hardCaseTags: ['missing_context'] },
    }),
    emitEvent: (event) => events.push(event),
  });

  assert.equal(result.attempts.length > 0, true);
  assert.equal(events.some((event) => event.type === 'local_meta.completed'), true);
  assert.equal(events.some((event) => event.type === 'local_memory.proposed'), true);
});

test('memory hierarchy feedback can run without local meta feedback', async () => {
  const events = [];
  await orchestrateSwarm({
    task: { taskId: 'task_memory_only', task: 'test memory only loop' },
    featureFlags: { localMetaHarness: false, localMemoryGraph: true },
    outputContract: { requiredFields: ['summary', 'evolutionOutput'] },
    commandAdapter: async () => ({
      summary: 'memory found',
      evolutionOutput: {
        memoryProposals: [{ factId: 'fact_1', subject: 'A', relation: 'requires', object: 'B' }],
      },
    }),
    emitEvent: (event) => events.push(event),
  });

  assert.equal(events.some((event) => event.type === 'local_meta.completed'), false);
  const memoryEvent = events.find((event) => event.type === 'local_memory.proposed');
  assert.equal(Boolean(memoryEvent), true);
  assert.equal(memoryEvent.proposalCount, 1);
  assert.equal(memoryEvent.memoryProposals[0].factId, 'fact_1');
});

test('memory hierarchy feedback dedupes local meta candidate proposals', async () => {
  const events = [];
  await orchestrateSwarm({
    task: { taskId: 'task_memory_dedupe', task: 'test memory dedupe loop' },
    featureFlags: { localMetaHarness: true, localMemoryGraph: true },
    outputContract: { requiredFields: ['summary', 'evolutionOutput'] },
    commandAdapter: async () => ({
      summary: 'memory found',
      evolutionOutput: {
        memoryProposals: [{ factId: 'fact_1', subject: 'A', relation: 'requires', object: 'B' }],
      },
    }),
    emitEvent: (event) => events.push(event),
  });

  const memoryEvent = events.find((event) => event.type === 'local_memory.proposed');
  assert.equal(memoryEvent.proposalCount, 1);
  assert.equal(memoryEvent.memoryProposals.length, 1);
});
