import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyCompactionArtifact } from '../src/harness-sidecar/context/compactionVerifier.js';
import { createEmptyCompactionArtifact } from '../src/harness-sidecar/context/compactionSchema.js';

test('compaction verifier catches lost constraints, files, tests, and priority-zero items', () => {
  const artifact = createEmptyCompactionArtifact({
    objective: 'Fix approval responsiveness.',
    userConstraints: [],
    activeFiles: [],
    failingTests: [],
    sourcePointers: [],
  });

  const result = verifyCompactionArtifact({
    artifact,
    originalItems: [
      {
        id: 'constraint-no-external',
        type: 'user_constraint',
        priority: 0,
        content: 'No external calls.',
        sourcePointer: { path: 'docs/plan.md', line: 4 },
      },
      {
        id: 'active-app',
        type: 'active_file',
        path: 'public/app.js',
        priority: 1,
        sourcePointer: { path: 'public/app.js', line: 513 },
      },
      {
        id: 'failing-test',
        type: 'failing_test',
        command: 'npm test -- tests/harness-ui-discoverability.test.js',
        priority: 1,
      },
    ],
  });

  assert.equal(result.passed, false);
  assert.equal(result.findings.some((finding) => finding.reason === 'lost_user_constraint'), true);
  assert.equal(result.findings.some((finding) => finding.reason === 'lost_active_file'), true);
  assert.equal(result.findings.some((finding) => finding.reason === 'lost_failing_test'), true);
  assert.equal(result.findings.some((finding) => finding.reason === 'lost_priority_zero_item'), true);
  assert.equal(result.score < 0.7, true);
});

test('compaction verifier catches hallucinated decisions and stale assumptions', () => {
  const artifact = createEmptyCompactionArtifact({
    objective: 'Continue context work.',
    decisions: [
      { id: 'decision_fake', summary: 'The full test suite was skipped.', sourcePointer: null },
    ],
    sourcePointers: [{ path: 'tests/harness-context-window-manager.test.js', line: 1 }],
    environmentState: { server: 'stopped' },
  });

  const result = verifyCompactionArtifact({
    artifact,
    traceEvents: [
      { type: 'decision.recorded', decision: { id: 'decision_real', summary: 'Run focused tests first.' } },
      { type: 'environment.state', state: { server: 'running' } },
    ],
  });

  assert.equal(result.passed, false);
  assert.equal(result.findings.some((finding) => finding.reason === 'hallucinated_decision'), true);
  assert.equal(result.findings.some((finding) => finding.reason === 'stale_environment_state'), true);
});

test('compaction verifier passes a source-backed continuation artifact', () => {
  const artifact = createEmptyCompactionArtifact({
    objective: 'Fix compaction.',
    userConstraints: [{ id: 'constraint-no-external', content: 'No external calls.' }],
    activeFiles: [{ path: 'src/harness-sidecar/context/compaction.js' }],
    failingTests: [{ command: 'npm test -- tests/harness-compaction-schema.test.js' }],
    decisions: [{ id: 'decision_real', summary: 'Use deterministic verification.', sourcePointer: { eventId: 'event_1' } }],
    sourcePointers: [{ path: 'src/harness-sidecar/context/compaction.js', line: 1 }],
  });

  const result = verifyCompactionArtifact({
    artifact,
    originalItems: [
      { id: 'constraint-no-external', type: 'user_constraint', priority: 0 },
      { id: 'file', type: 'active_file', path: 'src/harness-sidecar/context/compaction.js' },
      { id: 'test', type: 'failing_test', command: 'npm test -- tests/harness-compaction-schema.test.js' },
    ],
    traceEvents: [
      { type: 'decision.recorded', decision: { id: 'decision_real' }, eventId: 'event_1' },
    ],
  });

  assert.equal(result.passed, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.score, 1);
});
