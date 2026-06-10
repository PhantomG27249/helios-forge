import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createHarnessStatusSnapshot, summarizeBesLaneStatus } from '../src/harness-sidecar/server.js';

test('status snapshot includes BES lane evidence without approval authority', () => {
  const laneResult = {
    lane: 'memory',
    taskId: 'task-memory',
    updatedAt: '2026-06-09T12:00:00.000Z',
    candidates: [
      {
        candidateId: 'memory_policy_1',
        promotion: { allowed: false, blockedReasons: ['evidence_only_lane'] },
        evidence: { sources: ['domain_eval', 'memory_graph'] },
      },
    ],
  };

  const summary = summarizeBesLaneStatus(laneResult);
  const snapshot = createHarnessStatusSnapshot({ besLanes: [laneResult] });

  assert.equal(summary.lane, 'memory');
  assert.equal(summary.candidateCount, 1);
  assert.equal(summary.bestCandidateId, 'memory_policy_1');
  assert.equal(summary.promotionAllowed, false);
  assert.deepEqual(summary.blockedReasons, ['evidence_only_lane']);
  assert.equal(snapshot.besLanes[0].lane, 'memory');
  assert.equal(snapshot.besLanes[0].promotionAllowed, false);
});
