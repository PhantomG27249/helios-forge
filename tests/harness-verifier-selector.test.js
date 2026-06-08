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
      name: 'visual-ui',
      command: null,
      tool: 'visual.verifier.run',
      kind: 'visual',
      appliesTo: ['public/**/*.js', 'public/**/*.html', 'src/harness-sidecar/vlm/**/*.js'],
      tags: ['visual', 'vlm', 'ui'],
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

test('verifier selector chooses visual verifier for public js changes with unit companion', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_unit', task: 'edit app js' },
    changedFiles: ['public/app.js'],
    registry,
  });

  assert.deepEqual(selected.map((verifier) => verifier.name), ['visual-ui', 'unit']);
  assert.equal(selected[0].reason, 'visual_surface_change');
});

test('verifier selector chooses visual verifier for public html changes', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_html', task: 'edit index html' },
    changedFiles: ['public/index.html'],
    registry,
  });

  assert.deepEqual(selected.map((verifier) => verifier.name), ['visual-ui']);
  assert.equal(selected[0].reason, 'visual_surface_change');
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

test('verifier selector chooses visual verifier for visual worker changes with code companions', () => {
  const selected = selectVerifiersForTask({
    task: { taskId: 'task_vlm', task: 'capture browser screenshot' },
    changedFiles: ['src/harness-sidecar/vlm/visualVerifier.js'],
    registry,
  });

  assert.equal(selected[0].name, 'visual-ui');
  assert.equal(selected[0].reason, 'vlm_change');
  assert.equal(selected.some((verifier) => verifier.name === 'unit'), true);
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
  assert.equal(selected.some((verifier) => verifier.name === 'visual-ui'), false);
});
