import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendA2aLineageHop,
  compactA2aLineageForDashboard,
  normalizeA2aLineage,
} from '../src/harness-sidecar/interop/a2aMultiHopLineage.js';

test('appendA2aLineageHop chains multi-hop parent and root message ids', () => {
  let lineage = [];
  for (const hop of [
    { messageId: 'msg-agent', from: 'agent', to: 'SwarmCell', layer: 'agent' },
    { messageId: 'msg-cell', from: 'SwarmCell', to: 'swarm', layer: 'swarm_cell' },
    { messageId: 'msg-swarm', from: 'swarm', to: 'local-harness', layer: 'swarm' },
    { messageId: 'msg-local', from: 'local-harness', to: 'global-harness', layer: 'local_harness' },
    { messageId: 'msg-global', from: 'global-harness', to: 'operator', layer: 'global_harness' },
  ]) {
    lineage = appendA2aLineageHop({ lineage, hop });
  }

  assert.equal(lineage.length, 5);
  assert.equal(lineage[0].rootMessageId, 'msg-agent');
  assert.equal(lineage[1].parentMessageId, 'msg-agent');
  assert.equal(lineage[4].parentMessageId, 'msg-local');
  assert.equal(lineage[4].rootMessageId, 'msg-agent');
  assert.equal(lineage.every((entry) => entry.trust.authority === 'evidence_only'), true);
  assert.equal(lineage.every((entry) => entry.trust.canPromote === false), true);
});

test('appendA2aLineageHop rejects duplicate and self-referential cycles', () => {
  const lineage = appendA2aLineageHop({
    lineage: [],
    hop: { messageId: 'msg-root', from: 'agent', to: 'swarm' },
  });

  assert.throws(
    () => appendA2aLineageHop({ lineage, hop: { messageId: 'msg-root', from: 'swarm', to: 'agent' } }),
    /cycle/i,
  );
  assert.throws(
    () => appendA2aLineageHop({
      lineage,
      hop: { messageId: 'msg-child', parentMessageId: 'msg-child', from: 'swarm', to: 'agent' },
    }),
    /cycle/i,
  );
  assert.throws(
    () => appendA2aLineageHop({
      lineage,
      hop: { messageId: 'msg-missing-parent', parentMessageId: 'msg-unknown', from: 'swarm', to: 'agent' },
    }),
    /parent is not in lineage/i,
  );
});

test('normalizeA2aLineage rejects forward parent cycles across hops', () => {
  assert.throws(
    () => normalizeA2aLineage([
      { messageId: 'msg-a', parentMessageId: 'msg-b' },
      { messageId: 'msg-b', parentMessageId: 'msg-a' },
    ]),
    /cycle/i,
  );
});

test('compactA2aLineageForDashboard compacts multi-hop lineage without leaking secrets', () => {
  let lineage = [];
  for (const hop of [
    { messageId: 'msg-root', from: 'agent', to: 'SwarmCell', taskId: 'task-1' },
    {
      messageId: 'msg-child',
      from: 'SwarmCell',
      to: 'swarm',
      attemptId: 'attempt-1',
      token: 'ghp_should_not_leak',
      trust: { external: true, verified: true, authority: 'admin', canPromote: true },
    },
  ]) {
    lineage = appendA2aLineageHop({ lineage, hop });
  }

  const compacted = compactA2aLineageForDashboard(lineage);

  assert.equal(compacted.hopCount, 2);
  assert.deepEqual(compacted.messageIds, ['msg-root', 'msg-child']);
  assert.equal(compacted.rootMessageId, 'msg-root');
  assert.equal(compacted.lastMessageId, 'msg-child');
  assert.equal(compacted.hops[1].parentMessageId, 'msg-root');
  assert.equal(compacted.hops[1].trust.verified, false);
  assert.equal(compacted.hops[1].trust.authority, 'evidence_only');
  assert.equal(compacted.hops[1].trust.canPromote, false);
  assert.equal(JSON.stringify(compacted).includes('ghp_should_not_leak'), false);
});
