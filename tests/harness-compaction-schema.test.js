import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  REQUIRED_COMPACTION_FIELDS,
  createEmptyCompactionArtifact,
  normalizeSourcePointer,
  validateCompactionArtifact,
} from '../src/harness-sidecar/context/compactionSchema.js';
import { compactContextItems } from '../src/harness-sidecar/context/compaction.js';
import { planCompaction } from '../src/harness-sidecar/context/compactionPlanner.js';

test('compaction artifact schema includes all continuation-critical fields', () => {
  const artifact = createEmptyCompactionArtifact({
    objective: 'Fix the context packer.',
    sourcePointers: [{ path: 'src/harness-sidecar/context/compaction.js', line: 12 }],
  });

  for (const field of REQUIRED_COMPACTION_FIELDS) {
    assert.equal(Object.hasOwn(artifact, field), true, `missing ${field}`);
  }

  const validation = validateCompactionArtifact(artifact);
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.missingFields, []);
});

test('source pointers normalize paths, line numbers, labels, and event ids', () => {
  assert.deepEqual(
    normalizeSourcePointer({
      path: 'src/harness-sidecar/context/workingMemory.js',
      line: '42',
      label: 'working-memory pack',
      eventId: 'evt_1',
    }),
    {
      path: 'src/harness-sidecar/context/workingMemory.js',
      line: 42,
      label: 'working-memory pack',
      eventId: 'evt_1',
    },
  );

  assert.equal(normalizeSourcePointer(null), null);
  assert.equal(normalizeSourcePointer({ path: '../secret.txt' }), null);
});

test('compactContextItems returns a structured artifact while preserving legacy pack fields', () => {
  const result = compactContextItems({
    maxTokens: 80,
    artifact: { objective: 'Continue the Helios task.' },
    items: [
      {
        id: 'constraint',
        type: 'user_constraint',
        priority: 0,
        content: 'No external calls.',
        tokensEstimated: 20,
        sourcePointer: { path: 'docs/plan.md', line: 3 },
      },
      {
        id: 'large-log',
        type: 'raw_log',
        priority: 7,
        content: 'x'.repeat(1000),
        tokensEstimated: 100,
      },
    ],
  });

  assert.equal(result.items.some((item) => item.id === 'constraint'), true);
  assert.deepEqual(result.excluded, ['large-log']);
  assert.equal(result.artifact.objective, 'Continue the Helios task.');
  assert.equal(result.artifact.userConstraints[0].content, 'No external calls.');
  assert.deepEqual(result.artifact.sourcePointers, [
    { path: 'docs/plan.md', line: 3 },
  ]);
});

test('compactContextItems keeps all items when no token budget is provided', () => {
  const result = compactContextItems({
    items: [
      { id: 'constraint', type: 'user_constraint', priority: 0, content: 'Keep this.', tokensEstimated: 20 },
      { id: 'note', type: 'note', priority: 5, content: 'Normal context.', tokensEstimated: 100 },
    ],
  });

  assert.deepEqual(result.items.map((item) => item.id), ['constraint', 'note']);
  assert.deepEqual(result.excluded, []);
});

test('compaction planner selects profiles and must-keep items from task and pressure state', () => {
  const plan = planCompaction({
    task: { taskId: 'task_visual', kind: 'visual' },
    pressureState: { pressurePercent: 91, maxTokens: 12000 },
    items: [
      { id: 'instructions', type: 'instruction', priority: 0, tokensEstimated: 100 },
      { id: 'screenshot', type: 'visual_artifact', priority: 2, tokensEstimated: 300 },
      { id: 'debug-log', type: 'raw_log', priority: 8, tokensEstimated: 2000 },
    ],
  });

  assert.equal(plan.profile, 'visual');
  assert.equal(plan.trigger, 'auto');
  assert.equal(plan.mustKeepItemIds.includes('instructions'), true);
  assert.equal(plan.mustKeepItemIds.includes('screenshot'), true);
  assert.equal(plan.actions.includes('rebuild_context_pack'), true);
  assert.equal(plan.expectedArtifactFields.includes('sourcePointers'), true);
});
