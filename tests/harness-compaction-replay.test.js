import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateCompactionReplay } from '../src/harness-sidecar/context/compactionReplay.js';
import { createEmptyCompactionArtifact } from '../src/harness-sidecar/context/compactionSchema.js';

test('compaction replay rewards token reduction only when continuation-critical data survives', () => {
  const strong = evaluateCompactionReplay({
    trace: { taskId: 'task_ok', tokensBefore: 10000 },
    artifact: createEmptyCompactionArtifact({
      objective: 'Continue implementation.',
      userConstraints: [{ id: 'constraint-no-external', content: 'No external calls.' }],
      activeFiles: [{ path: 'src/harness-sidecar/context/compaction.js' }],
      sourcePointers: [{ path: 'src/harness-sidecar/context/compaction.js', line: 1 }],
    }),
    originalItems: [
      { id: 'constraint-no-external', type: 'user_constraint', priority: 0 },
      { id: 'active-file', type: 'active_file', path: 'src/harness-sidecar/context/compaction.js' },
    ],
    tokensAfter: 3000,
  });

  const weak = evaluateCompactionReplay({
    trace: { taskId: 'task_bad', tokensBefore: 10000 },
    artifact: createEmptyCompactionArtifact({
      objective: 'Continue implementation.',
      sourcePointers: [],
    }),
    originalItems: [
      { id: 'constraint-no-external', type: 'user_constraint', priority: 0 },
      { id: 'active-file', type: 'active_file', path: 'src/harness-sidecar/context/compaction.js' },
    ],
    tokensAfter: 1500,
  });

  assert.equal(strong.score > weak.score, true);
  assert.equal(strong.failureModes.length, 0);
  assert.equal(weak.failureModes.includes('compaction_lost_constraint'), true);
  assert.equal(weak.failureModes.includes('compaction_lost_file'), true);
  assert.equal(weak.rhoReason, 'compaction_lost_constraint');
});

test('compaction replay accepts an injected continuation probe without model calls', () => {
  const replay = evaluateCompactionReplay({
    trace: { taskId: 'task_probe', tokensBefore: 4000 },
    artifact: createEmptyCompactionArtifact({
      objective: 'Continue implementation.',
      sourcePointers: [{ path: 'docs/plan.md', line: 2 }],
    }),
    tokensAfter: 2000,
    continuationProbe: ({ artifact }) => ({
      passed: artifact.objective === 'Continue implementation.',
      findings: [],
    }),
  });

  assert.equal(replay.continuationRisk, 'low');
  assert.equal(replay.failureModes.includes('compaction_probe_failed'), false);
});
