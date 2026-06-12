import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  appendA2aLineageHop,
  compactA2aLineageForDashboard,
} from '../src/harness-sidecar/interop/a2aMultiHopLineage.js';
import { buildSwarmA2AEnvelope } from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';

test('appends multi-hop A2A lineage with parent root message and trust metadata', () => {
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

  assert.deepEqual(lineage.map((hop) => hop.messageId), [
    'msg-agent',
    'msg-cell',
    'msg-swarm',
    'msg-local',
    'msg-global',
  ]);
  assert.equal(lineage[0].rootMessageId, 'msg-agent');
  assert.equal(lineage[1].parentMessageId, 'msg-agent');
  assert.equal(lineage[4].parentMessageId, 'msg-local');
  assert.equal(lineage[4].rootMessageId, 'msg-agent');
  assert.equal(lineage.every((hop) => hop.trust.authority === 'evidence_only'), true);
  assert.equal(lineage.every((hop) => hop.trust.canPromote === false), true);
});

test('A2A lineage rejects cycles and normalizes external verification escalation', () => {
  const lineage = appendA2aLineageHop({
    lineage: [],
    hop: { messageId: 'msg-root', from: 'agent', to: 'swarm', external: true, verified: true, canPromote: true },
  });

  assert.equal(lineage[0].trust.external, true);
  assert.equal(lineage[0].trust.verified, false);
  assert.equal(lineage[0].trust.canPromote, false);

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
});

test('compacts A2A lineage for dashboard without leaking secrets', () => {
  const lineage = appendA2aLineageHop({
    lineage: [],
    hop: {
      messageId: 'msg-secret',
      from: 'agent',
      to: 'swarm',
      layer: 'agent',
      taskId: 'task-1',
      token: 'ghp_should_not_leak',
      trust: { external: true, verified: true, authority: 'admin', canPromote: true },
    },
  });

  const compacted = compactA2aLineageForDashboard(lineage);
  assert.equal(compacted.hopCount, 1);
  assert.deepEqual(compacted.messageIds, ['msg-secret']);
  assert.equal(compacted.hops[0].trust.verified, false);
  assert.equal(compacted.hops[0].trust.authority, 'evidence_only');
  assert.equal(JSON.stringify(compacted).includes('ghp_should_not_leak'), false);
});

test('swarm A2A envelope preserves helper lineage and trust metadata', () => {
  const root = appendA2aLineageHop({
    lineage: [],
    hop: { messageId: 'msg-root', from: 'agent', to: 'SwarmCell', taskId: 'task-lineage' },
  });
  const lineage = appendA2aLineageHop({
    lineage: root,
    hop: { messageId: 'msg-child', from: 'SwarmCell', to: 'swarm', attemptId: 'attempt-lineage' },
  });

  const envelope = buildSwarmA2AEnvelope({
    task: { id: 'task-lineage', task: 'Continue lineage.' },
    attempt: { id: 'attempt-lineage' },
    durable: {
      messageId: 'msg-envelope',
      parentMessageId: 'msg-child',
      rootMessageId: 'msg-root',
    },
    lineage,
  });

  assert.equal(envelope.durable.messageId, 'msg-envelope');
  assert.equal(envelope.durable.parentMessageId, 'msg-child');
  assert.equal(envelope.durable.rootMessageId, 'msg-root');
  assert.deepEqual(envelope.durable.lineage.map((hop) => hop.messageId), ['msg-root', 'msg-child']);
  assert.equal(envelope.durable.lineage[0].trust.authority, 'evidence_only');
  assert.equal(envelope.durable.lineage[0].trust.canPromote, false);
});
