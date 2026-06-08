import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectVerifiersForTask } from '../src/harness-sidecar/tools/verifierSelector.js';

const registry = {
  verifiers: [
    {
      name: 'unit',
      command: 'npm test',
      kind: 'unit',
      appliesTo: ['**/*.js'],
      tags: ['default'],
    },
    {
      name: 'release-smoke',
      command: 'npm run release:smoke',
      kind: 'smoke',
      appliesTo: ['package.json', 'src/server.js', 'src/harness-sidecar/**/*.js'],
      tags: ['default', 'smoke'],
    },
    {
      name: 'vlm-focused',
      command: 'npm test -- tests/harness-vlm-native.test.js',
      kind: 'visual',
      appliesTo: ['src/harness-sidecar/vlm/**/*.js'],
      tags: ['vlm'],
    },
    {
      name: 'sidecar-focused',
      command: 'npm test -- tests/harness-sidecar.test.js',
      kind: 'integration',
      appliesTo: ['src/harness-sidecar/**/*.js'],
      tags: ['sidecar'],
    },
  ],
};

test('verifier selector chooses unit verifier for ordinary js changes', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_unit', task: 'edit app js' },
    changedFiles: ['public/app.js'],
    registry,
  });

  assert.equal(selected[0].name, 'unit');
  assert.equal(selected[0].reason, 'default_js_change');
});

test('verifier selector chooses focused sidecar and smoke verifiers for runtime changes', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_sidecar', task: 'change sidecar runtime' },
    changedFiles: ['src/harness-sidecar/server.js'],
    registry,
  });

  assert.deepEqual(selected.map((verifier) => verifier.name), ['sidecar-focused', 'release-smoke', 'unit']);
  assert.equal(selected[0].reason, 'sidecar_runtime_change');
});

test('verifier selector chooses vlm focused verifier for visual worker changes', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_vlm', task: 'capture browser screenshot' },
    changedFiles: ['src/harness-sidecar/vlm/browserPreviewCapture.js'],
    registry,
  });

  assert.equal(selected[0].name, 'vlm-focused');
  assert.equal(selected[0].reason, 'vlm_change');
});

test('verifier selector falls back to smoke/default for unknown changes and recent failures', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_docs', task: 'docs update' },
    changedFiles: ['docs/plan.md'],
    recentFailures: ['unit'],
    registry,
    maxVerifiers: 2,
  });

  assert.deepEqual(selected.map((verifier) => verifier.name), ['unit', 'release-smoke']);
  assert.equal(selected[0].reason, 'recent_failure');
});
