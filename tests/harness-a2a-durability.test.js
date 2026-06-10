import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildA2AStreamEnvelope,
  buildSwarmA2AEnvelope,
} from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';
import {
  createDelegatedCapabilityToken,
  verifyDelegatedCapabilityToken,
} from '../src/harness-sidecar/interop/delegatedCapabilityTokens.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';

test('gateway durably records outbound A2A work and retries it with stable correlation metadata', async () => {
  const dispatched = [];
  const events = [];
  let timestamp = 1_000;
  const gateway = new ExternalAgentGateway({
    now: () => timestamp,
    emitEvent: (event) => events.push(event),
    agents: [{
      id: 'agent.retry',
      name: 'Retry Agent',
      protocol: 'a2a',
      endpoint: { url: 'https://retry.example.test/a2a' },
      capabilities: ['repo.read'],
      trustLevel: 'verified',
    }],
    dispatch: async (envelope) => {
      dispatched.push(envelope);
      if (dispatched.length === 1) throw new Error('temporary network failure');
      return { ok: true, accepted: envelope.durable.messageId };
    },
  });

  const queued = gateway.enqueueTask({
    agentId: 'agent.retry',
    retryPolicy: { maxAttempts: 3, backoffMs: 250 },
    task: {
      id: 'task-retry',
      correlationId: 'corr-123',
      requiredCapabilities: ['repo.read'],
      prompt: 'Read the package metadata.',
      context: { 'repo.read': { files: ['package.json'] } },
    },
  });

  assert.equal(queued.status, 'queued');
  assert.equal(queued.attempts, 0);
  assert.equal(queued.correlationId, 'corr-123');
  assert.equal(queued.envelope.durable.direction, 'outbox');
  assert.equal(queued.envelope.durable.messageId, queued.messageId);
  assert.equal(queued.envelope.durable.correlationId, 'corr-123');
  assert.equal(queued.envelope.durable.retryPolicy.maxAttempts, 3);

  const firstDrain = await gateway.drainOutbox();
  assert.equal(firstDrain[0].status, 'retry_scheduled');
  assert.equal(firstDrain[0].attempts, 1);
  assert.equal(firstDrain[0].nextAttemptAt, 1_250);

  timestamp = 1_249;
  assert.deepEqual(await gateway.drainOutbox(), []);

  timestamp = 1_250;
  const secondDrain = await gateway.drainOutbox();
  assert.equal(secondDrain[0].status, 'dispatched');
  assert.equal(secondDrain[0].attempts, 2);
  assert.equal(secondDrain[0].response.accepted, queued.messageId);
  assert.deepEqual(dispatched.map((envelope) => envelope.durable.messageId), [
    queued.messageId,
    queued.messageId,
  ]);
  assert.deepEqual(events.map((event) => event.type), [
    'external_agent.outbox_queued',
    'external_agent.retry_scheduled',
    'external_agent.dispatched',
  ]);
});

test('gateway stores inbound A2A envelopes idempotently and tracks progress plus cancellation', () => {
  const gateway = new ExternalAgentGateway({
    now: () => 2_000,
    agents: [{
      id: 'agent.worker',
      name: 'Worker',
      protocol: 'a2a',
      endpoint: { url: 'https://worker.example.test/a2a' },
      capabilities: ['repo.read'],
    }],
  });

  const inbound = buildSwarmA2AEnvelope({
    from: 'agent.worker',
    to: 'helios.sidecar',
    task: { id: 'task-inbox', task: 'Report status' },
    attempt: { id: 'attempt-inbox' },
  });
  inbound.durable = {
    direction: 'inbox',
    messageId: 'msg-inbox-1',
    correlationId: 'corr-inbox',
  };

  const accepted = gateway.receiveEnvelope(inbound);
  const duplicate = gateway.receiveEnvelope(inbound);
  const progress = gateway.recordProgress({
    messageId: 'msg-inbox-1',
    percent: 45,
    detail: 'reading files',
  });
  const cancelled = gateway.cancelMessage({
    messageId: 'msg-inbox-1',
    reason: 'superseded',
  });

  assert.equal(accepted.status, 'received');
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(gateway.listInbox()[0].messageId, 'msg-inbox-1');
  assert.equal(progress.envelope.message.kind, 'progress');
  assert.equal(progress.envelope.message.percent, 45);
  assert.equal(progress.envelope.durable.correlationId, 'corr-inbox');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.envelope.message.kind, 'cancel');
  assert.equal(gateway.getInboxRecord('msg-inbox-1').status, 'cancelled');
});

test('durable enqueue does not bypass mutation approval and scoped delegated trust', () => {
  const gateway = new ExternalAgentGateway({
    now: () => 4_000,
    agents: [{
      id: 'agent.writer',
      name: 'Writer',
      protocol: 'a2a',
      endpoint: { url: 'https://writer.example.test/a2a' },
      capabilities: ['patch.apply'],
      trustLevel: 'internal',
    }],
  });
  const token = createDelegatedCapabilityToken({
    taskId: 'task-durable-write',
    agentId: 'agent.writer',
    capabilities: ['patch.apply'],
    scopes: ['files:src/harness-sidecar/interop/**'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 4_000,
    ttlMs: 5_000,
  });

  assert.throws(
    () => gateway.enqueueTask({
      agentId: 'agent.writer',
      approval: { approved: true, approvedBy: 'owner' },
      task: {
        id: 'task-durable-write',
        mutation: true,
        prompt: 'Apply this patch without declaring capabilities.',
      },
    }),
    /mutation_capability_required/,
  );
  assert.throws(
    () => gateway.enqueueTask({
      agentId: 'agent.writer',
      approval: { approved: true, approvedBy: 'owner' },
      task: {
        id: 'task-durable-write',
        mutation: true,
        requiredCapabilities: ['patch.apply'],
        prompt: 'Apply this patch without delegated trust.',
      },
    }),
    /delegated_capability_token_required/,
  );
  assert.throws(
    () => gateway.enqueueTask({
      agentId: 'agent.writer',
      task: {
        id: 'task-durable-write',
        mutation: true,
        requiredCapabilities: ['patch.apply'],
        requiredScopes: ['files:src/harness-sidecar/interop/**'],
        prompt: 'Apply this patch.',
      },
    }),
    /mutation_requires_approval/,
  );
  assert.throws(
    () => gateway.enqueueTask({
      agentId: 'agent.writer',
      approval: { approved: true, approvedBy: 'owner' },
      capabilityToken: token,
      task: {
        id: 'task-durable-write',
        mutation: true,
        requiredCapabilities: ['patch.apply'],
        requiredScopes: ['files:tests/**'],
        prompt: 'Apply this patch.',
      },
    }),
    /scope_not_delegated/,
  );

  const queued = gateway.enqueueTask({
    agentId: 'agent.writer',
    approval: { approved: true, approvedBy: 'owner' },
    capabilityToken: token,
    task: {
      id: 'task-durable-write',
      mutation: true,
      requiredCapabilities: ['patch.apply'],
      requiredScopes: ['files:src/harness-sidecar/interop/**'],
      prompt: 'Apply this patch.',
    },
  });

  assert.equal(queued.status, 'queued');
  assert.equal(queued.envelope.mode, 'mutation');
});

test('gateway can hydrate and save durable A2A queues through an injected store', async () => {
  let persisted = null;
  const durableStore = {
    load: () => persisted,
    save: (state) => {
      persisted = state;
    },
  };

  const firstGateway = new ExternalAgentGateway({
    now: () => 5_000,
    durableStore,
    agents: [{
      id: 'agent.persisted',
      name: 'Persisted',
      protocol: 'a2a',
      endpoint: { url: 'https://persisted.example.test/a2a' },
      capabilities: ['repo.read'],
    }],
  });
  const queued = firstGateway.enqueueTask({
    agentId: 'agent.persisted',
    task: {
      id: 'task-persisted',
      correlationId: 'corr-persisted',
      requiredCapabilities: ['repo.read'],
      prompt: 'Read persisted state.',
    },
  });
  firstGateway.receiveEnvelope({
    protocol: 'a2a',
    from: 'agent.persisted',
    to: 'helios.sidecar',
    durable: {
      direction: 'inbox',
      messageId: 'msg-persisted',
      correlationId: 'corr-persisted',
    },
    message: { kind: 'result' },
  });

  const dispatched = [];
  const restoredGateway = new ExternalAgentGateway({
    now: () => 5_000,
    durableStore,
    agents: [{
      id: 'agent.persisted',
      name: 'Persisted',
      protocol: 'a2a',
      endpoint: { url: 'https://persisted.example.test/a2a' },
      capabilities: ['repo.read'],
    }],
    dispatch: async (envelope) => {
      dispatched.push(envelope);
      return { ok: true };
    },
  });

  assert.equal(restoredGateway.getOutboxRecord(queued.messageId).correlationId, 'corr-persisted');
  assert.equal(restoredGateway.getInboxRecord('msg-persisted').status, 'received');

  const drained = await restoredGateway.drainOutbox();
  assert.equal(drained[0].status, 'dispatched');
  assert.equal(dispatched[0].durable.messageId, queued.messageId);
  assert.equal(persisted.outbox[0].status, 'dispatched');
});

test('gateway uses injected issuer secret stores for restart-stable delegated tokens', () => {
  let secret = 'stable-test-issuer-secret';
  const issuerSecretStore = {
    load: () => secret,
    save: (nextSecret) => {
      secret = nextSecret;
    },
  };
  const gateway = new ExternalAgentGateway({
    now: () => 6_000,
    issuerSecretStore,
    agents: [{
      id: 'agent.stable-writer',
      name: 'Stable Writer',
      protocol: 'a2a',
      endpoint: { url: 'https://stable-writer.example.test/a2a' },
      capabilities: ['patch.apply'],
      trustLevel: 'internal',
    }],
  });
  const token = createDelegatedCapabilityToken({
    taskId: 'task-stable-token',
    agentId: 'agent.stable-writer',
    capabilities: ['patch.apply'],
    scopes: ['files:src/harness-sidecar/interop/**'],
    mode: 'mutation',
    issuedBy: 'owner',
    issuerSecret: secret,
    now: 6_000,
    ttlMs: 5_000,
  });

  const queued = gateway.enqueueTask({
    agentId: 'agent.stable-writer',
    approval: { approved: true, approvedBy: 'owner' },
    capabilityToken: token,
    task: {
      id: 'task-stable-token',
      mutation: true,
      requiredCapabilities: ['patch.apply'],
      requiredScopes: ['files:src/harness-sidecar/interop/**'],
      prompt: 'Apply scoped patch.',
    },
  });

  assert.equal(queued.status, 'queued');
  assert.equal(secret, 'stable-test-issuer-secret');
});

test('gateway can require stable issuer secret injection before durable mutation delegation', () => {
  const gateway = new ExternalAgentGateway({
    now: () => 6_500,
    requireStableIssuerSecret: true,
    agents: [{
      id: 'agent.no-secret',
      name: 'No Secret Writer',
      protocol: 'a2a',
      endpoint: { url: 'https://no-secret.example.test/a2a' },
      capabilities: ['patch.apply'],
      trustLevel: 'internal',
    }],
  });
  const token = createDelegatedCapabilityToken({
    taskId: 'task-no-secret',
    agentId: 'agent.no-secret',
    capabilities: ['patch.apply'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 6_500,
    ttlMs: 5_000,
  });

  assert.throws(
    () => gateway.enqueueTask({
      agentId: 'agent.no-secret',
      approval: { approved: true, approvedBy: 'owner' },
      capabilityToken: token,
      task: {
        id: 'task-no-secret',
        mutation: true,
        requiredCapabilities: ['patch.apply'],
        prompt: 'Apply patch.',
      },
    }),
    /issuer_secret_required/,
  );
});

test('gateway persists peer endpoint descriptors for restart discovery without socket probes', () => {
  let persisted = null;
  let dispatchTouched = false;
  const durableStore = {
    load: () => persisted,
    save: (state) => {
      persisted = state;
    },
  };
  const firstGateway = new ExternalAgentGateway({
    durableStore,
    agents: [{
      id: 'agent.visual-peer',
      name: 'Visual Peer',
      protocol: 'a2a',
      endpoint: { url: 'https://visual-peer.example.test/a2a', socket: 'must-not-open' },
      capabilities: ['visual.verify'],
      trustLevel: 'verified',
    }],
  });

  firstGateway.persistDurableState();

  const restoredGateway = new ExternalAgentGateway({
    durableStore,
    dispatch: async () => {
      dispatchTouched = true;
      return { ok: true };
    },
  });
  const peers = restoredGateway.discoverPeers({
    protocol: 'a2a',
    capabilities: ['visual.verify'],
    minTrustLevel: 'verified',
  });

  assert.equal(dispatchTouched, false);
  assert.deepEqual(peers.map((peer) => peer.id), ['agent.visual-peer']);
  assert.deepEqual(persisted.peerEndpoints.map((peer) => peer.endpoint.url), ['https://visual-peer.example.test/a2a']);
  assert.equal(peers[0].endpoint.socket, undefined);
});

test('gateway discovers viable peers by A2A capability, availability, and trust', () => {
  const gateway = new ExternalAgentGateway({
    agents: [
      {
        id: 'agent.good',
        name: 'Good Peer',
        protocol: 'a2a',
        endpoint: { url: 'https://good.example.test/a2a' },
        capabilities: ['repo.read', 'code.review'],
        trustLevel: 'verified',
      },
      {
        id: 'agent.low',
        name: 'Low Trust Peer',
        protocol: 'a2a',
        endpoint: { url: 'https://low.example.test/a2a' },
        capabilities: ['repo.read', 'code.review'],
        trustLevel: 'public',
      },
      {
        id: 'agent.http',
        name: 'HTTP Peer',
        protocol: 'http',
        endpoint: { url: 'https://http.example.test/dispatch' },
        capabilities: ['repo.read', 'code.review'],
        trustLevel: 'internal',
      },
    ],
  });

  const peers = gateway.discoverPeers({
    protocol: 'a2a',
    capabilities: ['repo.read', 'code.review'],
    minTrustLevel: 'verified',
  });

  assert.deepEqual(peers.map((peer) => peer.id), ['agent.good']);
  assert.equal(peers[0].endpoint.url, 'https://good.example.test/a2a');
});

test('stream envelopes preserve ordered chunks, progress, cancellation, and correlation ids', () => {
  const chunk = buildA2AStreamEnvelope({
    streamId: 'stream-1',
    sequence: 2,
    correlationId: 'corr-stream',
    from: 'agent.stream',
    to: 'helios.sidecar',
    event: 'chunk',
    payload: { text: 'partial result', token: 'sk-should-redact' },
    progress: { percent: 25 },
  });
  const cancelled = buildA2AStreamEnvelope({
    streamId: 'stream-1',
    sequence: 3,
    correlationId: 'corr-stream',
    from: 'agent.stream',
    to: 'helios.sidecar',
    event: 'cancel',
    cancellation: { reason: 'user_requested' },
  });

  assert.equal(chunk.message.kind, 'stream_chunk');
  assert.equal(chunk.message.stream.sequence, 2);
  assert.equal(chunk.message.progress.percent, 25);
  assert.equal(chunk.durable.correlationId, 'corr-stream');
  assert.equal(JSON.stringify(chunk).includes('sk-should-redact'), false);
  assert.equal(cancelled.message.kind, 'stream_cancel');
  assert.equal(cancelled.message.cancellation.reason, 'user_requested');
});

test('swarm A2A envelopes preserve multi-hop durable lineage alongside scoped context lineage', () => {
  const envelope = buildSwarmA2AEnvelope({
    from: 'agent.parent',
    to: 'agent.child',
    task: { id: 'task-lineage', task: 'Continue the delegated review.' },
    attempt: { id: 'attempt-lineage' },
    context: {
      lineage: {
        rootTaskId: 'task-root',
        hops: ['helios.sidecar', 'agent.parent'],
      },
    },
    durable: {
      messageId: 'msg-child',
      correlationId: 'corr-lineage',
      parentMessageId: 'msg-parent',
      rootMessageId: 'msg-root',
    },
    lineage: [
      { messageId: 'msg-root', from: 'helios.sidecar', to: 'agent.parent' },
      { messageId: 'msg-parent', from: 'agent.parent', to: 'agent.child' },
    ],
  });

  assert.equal(envelope.durable.messageId, 'msg-child');
  assert.equal(envelope.durable.parentMessageId, 'msg-parent');
  assert.equal(envelope.durable.rootMessageId, 'msg-root');
  assert.deepEqual(envelope.durable.lineage.map((hop) => hop.messageId), ['msg-root', 'msg-parent']);
  assert.deepEqual(envelope.message.context.lineage.hops, ['helios.sidecar', 'agent.parent']);
});

test('delegated capability tokens bind signed trust to scopes as well as capability and mode', () => {
  const token = createDelegatedCapabilityToken({
    taskId: 'task-scope',
    agentId: 'agent.scoped',
    capabilities: ['patch.apply'],
    scopes: ['files:src/harness-sidecar/interop/**'],
    mode: 'mutation',
    issuedBy: 'owner',
    issuerSecret: 'test-secret',
    now: 3_000,
    ttlMs: 5_000,
  });

  assert.deepEqual(token.scopes, ['files:src/harness-sidecar/interop/**']);
  assert.equal(
    verifyDelegatedCapabilityToken(token, {
      taskId: 'task-scope',
      agentId: 'agent.scoped',
      capability: 'patch.apply',
      scope: 'files:src/harness-sidecar/interop/**',
      mode: 'mutation',
      issuerSecret: 'test-secret',
      now: 3_500,
    }).valid,
    true,
  );
  assert.deepEqual(
    verifyDelegatedCapabilityToken(token, {
      taskId: 'task-scope',
      agentId: 'agent.scoped',
      capability: 'patch.apply',
      scope: 'files:tests/**',
      mode: 'mutation',
      issuerSecret: 'test-secret',
      now: 3_500,
    }).reasons,
    ['scope_not_delegated'],
  );
  assert.deepEqual(
    verifyDelegatedCapabilityToken({ ...token, scopes: ['files:**'] }, {
      taskId: 'task-scope',
      agentId: 'agent.scoped',
      capability: 'patch.apply',
      scope: 'files:**',
      mode: 'mutation',
      issuerSecret: 'test-secret',
      now: 3_500,
    }).reasons,
    ['invalid_signature'],
  );
});
