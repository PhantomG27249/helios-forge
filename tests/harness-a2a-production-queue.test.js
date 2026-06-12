import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import { test } from 'node:test';

import { createA2AQueueProvider } from '../src/harness-sidecar/interop/a2aQueueProvider.js';
import { createA2AIssuerSecretProvider } from '../src/harness-sidecar/interop/a2aIssuerSecretProvider.js';
import {
  createDelegatedCapabilityToken,
  verifyDelegatedCapabilityToken,
} from '../src/harness-sidecar/interop/delegatedCapabilityTokens.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';

function agent() {
  return {
    id: 'agent.production',
    name: 'Production A2A',
    protocol: 'a2a',
    endpoint: {
      url: 'https://production.example.test/a2a',
      headers: { Authorization: 'Bearer should-not-persist' },
    },
    capabilities: ['repo.read', 'patch.apply'],
    trustLevel: 'internal',
  };
}

test('production queue provider defaults to workspace-local JSON and hydrates gateway state', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'helios-a2a-prod-'));
  try {
    const provider = createA2AQueueProvider({ workspaceRoot });
    assert.equal(normalize(provider.root), normalize(join(workspaceRoot, '.harness', 'a2a')));
    assert.equal(normalize(provider.path), normalize(join(workspaceRoot, '.harness', 'a2a', 'queue-state.json')));

    const first = new ExternalAgentGateway({
      now: () => 10_000,
      durableStore: provider,
      agents: [agent()],
    });
    const queued = first.enqueueTask({
      agentId: 'agent.production',
      task: {
        id: 'task-prod',
        correlationId: 'corr-prod',
        requiredCapabilities: ['repo.read'],
        prompt: 'Read with token=ghp_should_not_persist and password=plain-secret',
        context: { a2a: { note: 'Authorization: Bearer hidden-token' } },
      },
    });

    assert.equal(existsSync(provider.path), true);
    const raw = readFileSync(provider.path, 'utf8');
    assert.equal(raw.includes('ghp_should_not_persist'), false);
    assert.equal(raw.includes('plain-secret'), false);
    assert.equal(raw.includes('hidden-token'), false);
    assert.equal(raw.includes('should-not-persist'), false);

    const restored = new ExternalAgentGateway({
      now: () => 10_000,
      durableStore: createA2AQueueProvider({ workspaceRoot }),
      dispatch: async () => ({ ok: true }),
    });
    assert.equal(restored.getOutboxRecord(queued.messageId).correlationId, 'corr-prod');
    assert.equal((await restored.drainOutbox())[0].status, 'dispatched');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('production queue provider rejects path escapes and accepts injected stores', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'helios-a2a-prod-'));
  try {
    assert.throws(
      () => createA2AQueueProvider({ workspaceRoot, path: join(workspaceRoot, '..', 'outside.json') }),
      /escapes allowed root/,
    );

    let persisted = null;
    const provider = createA2AQueueProvider({
      store: {
        load: () => persisted,
        save: (state) => {
          persisted = state;
          return state;
        },
      },
    });
    const gateway = new ExternalAgentGateway({
      now: () => 11_000,
      durableStore: provider,
      agents: [agent()],
    });
    const queued = gateway.enqueueTask({
      agentId: 'agent.production',
      task: { id: 'task-injected', requiredCapabilities: ['repo.read'], prompt: 'Read.' },
    });
    const restored = new ExternalAgentGateway({ durableStore: provider });

    assert.equal(restored.getOutboxRecord(queued.messageId).taskId, 'task-injected');
    assert.equal(persisted.outbox.length, 1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('issuer secret provider resolves stable secrets without exposing raw values', () => {
  const provider = createA2AIssuerSecretProvider({
    issuerKeyRef: 'prod.a2a.issuer',
    env: { HELIOS_A2A_ISSUER_SECRET: 'stable-env-secret' },
  });
  const storeProvider = createA2AIssuerSecretProvider({
    issuerKeyRef: 'store.a2a.issuer',
    store: { get: (key) => (key === 'store.a2a.issuer' ? 'stable-store-secret' : null) },
  });

  assert.equal(provider.loadIssuerSecret(), 'stable-env-secret');
  assert.deepEqual(provider.describe(), {
    issuerKeyRef: 'prod.a2a.issuer',
    source: 'env',
    stable: true,
  });
  assert.equal(JSON.stringify(provider.describe()).includes('stable-env-secret'), false);
  assert.equal(storeProvider.loadIssuerSecret(), 'stable-store-secret');
  assert.equal(storeProvider.get('store.a2a.issuer'), 'stable-store-secret');

  assert.throws(
    () => createA2AIssuerSecretProvider({ requireStable: true, env: {} }).loadIssuerSecret(),
    /stable A2A issuer secret is required/,
  );
});

test('delegated tokens verify across restarts with issuer secret providers', () => {
  const issuerSecretProvider = createA2AIssuerSecretProvider({
    issuerSecret: 'stable-provider-secret',
    issuerKeyRef: 'prod.a2a.issuer',
  });
  const token = createDelegatedCapabilityToken({
    taskId: 'task-provider-token',
    agentId: 'agent.production',
    capabilities: ['patch.apply'],
    scopes: ['files:src/harness-sidecar/interop/**'],
    mode: 'mutation',
    issuedBy: 'owner',
    now: 12_000,
    ttlMs: 5_000,
    issuerSecretProvider,
  });

  assert.equal(verifyDelegatedCapabilityToken(token, {
    taskId: 'task-provider-token',
    agentId: 'agent.production',
    capability: 'patch.apply',
    scope: 'files:src/harness-sidecar/interop/**',
    mode: 'mutation',
    now: 12_500,
    issuerSecretProvider: createA2AIssuerSecretProvider({ issuerSecret: 'stable-provider-secret' }),
  }).valid, true);
  assert.deepEqual(verifyDelegatedCapabilityToken(token, {
    taskId: 'task-provider-token',
    agentId: 'agent.production',
    capability: 'patch.apply',
    mode: 'mutation',
    now: 12_500,
    issuerSecretProvider: createA2AIssuerSecretProvider({ issuerSecret: 'wrong-secret' }),
  }).reasons, ['invalid_signature']);

  const gateway = new ExternalAgentGateway({
    now: () => 12_500,
    requireStableIssuerSecret: true,
    issuerSecretStore: issuerSecretProvider,
    agents: [agent()],
  });
  const queued = gateway.enqueueTask({
    agentId: 'agent.production',
    approval: { approved: true, approvedBy: 'owner' },
    capabilityToken: token,
    task: {
      id: 'task-provider-token',
      mutation: true,
      requiredCapabilities: ['patch.apply'],
      requiredScopes: ['files:src/harness-sidecar/interop/**'],
      prompt: 'Apply scoped patch.',
    },
  });

  assert.equal(queued.status, 'queued');
});
