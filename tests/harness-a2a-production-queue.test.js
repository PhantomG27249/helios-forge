import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createA2aQueueProvider } from '../src/harness-sidecar/interop/a2aQueueProvider.js';
import { createIssuerSecretProvider } from '../src/harness-sidecar/interop/a2aIssuerSecretProvider.js';
import { createJsonFileA2ADurableStore } from '../src/harness-sidecar/interop/a2aDurableStore.js';
import {
  createDelegatedCapabilityToken,
  verifyDelegatedCapabilityToken,
} from '../src/harness-sidecar/interop/delegatedCapabilityTokens.js';
import { ExternalAgentGateway } from '../src/harness-sidecar/interop/externalAgentGateway.js';

test('A2A queue provider adapts production queue contracts to durable load and save', () => {
  const calls = [];
  let stored = {
    outbox: [{
      messageId: 'msg-existing',
      taskId: 'task-existing',
      endpoint: { headers: { Authorization: 'Bearer must-redact' } },
    }],
  };
  const provider = createA2aQueueProvider({
    adapter: {
      load: () => stored,
      save: (state) => {
        calls.push(state);
        stored = state;
      },
    },
  });

  assert.deepEqual(provider.load().outbox.map((record) => record.messageId), ['msg-existing']);

  const queued = provider.enqueue('outbox', {
    messageId: 'msg-new',
    taskId: 'task-new',
    payload: {
      prompt: 'Summarize this without token=ghp_never_visible',
      apiKey: 'sk-never-visible',
    },
  });

  assert.equal(queued.messageId, 'msg-new');
  assert.deepEqual(provider.list('outbox').map((record) => record.messageId), [
    'msg-existing',
    'msg-new',
  ]);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(calls[0]).includes('ghp_never_visible'), false);
  assert.equal(JSON.stringify(calls[0]).includes('sk-never-visible'), false);
});

test('A2A queue provider uses JSON durable fallback with restart hydration and root constraints', () => {
  const root = mkdtempSync(join(tmpdir(), 'helios-a2a-provider-'));
  const storePath = join(root, 'queues', 'a2a.json');
  try {
    const firstProvider = createA2aQueueProvider({
      durableStore: { path: storePath, root },
    });
    firstProvider.save({
      outbox: [{
        messageId: 'msg-json',
        taskId: 'task-json',
        prompt: 'Queue with password=hunter2 and api_key=plain-secret',
      }],
    });

    assert.equal(existsSync(storePath), true);
    assert.equal(readFileSync(storePath, 'utf8').includes('hunter2'), false);
    assert.equal(readFileSync(storePath, 'utf8').includes('plain-secret'), false);

    const restoredProvider = createA2aQueueProvider({
      durableStore: { path: storePath, root },
    });
    assert.deepEqual(restoredProvider.load().outbox.map((record) => record.messageId), ['msg-json']);

    assert.throws(
      () => createA2aQueueProvider({
        durableStore: { path: join(root, '..', 'outside.json'), root },
      }),
      /escapes allowed root/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('issuer secret provider performs stable lookup while redacting model-visible descriptions', () => {
  const secretStore = new Map([
    ['issuer:stable-writer', 'stable-writer-secret'],
  ]);
  const provider = createIssuerSecretProvider({
    env: { HELIOS_A2A_ISSUER_SECRET: 'env-default-secret' },
    secretStore,
    fallback: 'fallback-secret',
  });

  assert.equal(
    provider.getIssuerSecret({ keyRef: 'issuer:stable-writer', issuerId: 'agent.stable-writer' }),
    'stable-writer-secret',
  );
  assert.equal(
    provider.getIssuerSecret({ issuerId: 'agent.env-default' }),
    'env-default-secret',
  );
  assert.equal(
    provider.getIssuerSecret({ keyRef: 'issuer:missing', issuerId: 'agent.fallback' }),
    'fallback-secret',
  );

  const visible = JSON.stringify({
    description: provider.describe({ keyRef: 'issuer:stable-writer' }),
    json: provider,
    string: String(provider),
  });
  assert.equal(visible.includes('stable-writer-secret'), false);
  assert.equal(visible.includes('env-default-secret'), false);
  assert.equal(visible.includes('fallback-secret'), false);
  assert.match(visible, /issuer:stable-writer/);
});

test('delegated capability tokens can sign and verify with stable issuer secret providers', () => {
  const provider = createIssuerSecretProvider({
    secretStore: {
      get: (key) => (key === 'issuer:writer' ? 'writer-secret' : undefined),
    },
  });
  const token = createDelegatedCapabilityToken({
    taskId: 'task-provider-token',
    agentId: 'agent.writer',
    capabilities: ['patch.apply'],
    scopes: ['files:src/harness-sidecar/interop/**'],
    mode: 'mutation',
    issuedBy: 'owner',
    issuerKeyRef: 'issuer:writer',
    issuerSecretProvider: provider,
    now: 8_000,
    ttlMs: 5_000,
  });

  assert.equal(token.secret, undefined);
  assert.equal(token.issuerSecret, undefined);
  assert.equal(token.issuerKeyRef, 'issuer:writer');
  assert.equal(JSON.stringify(token).includes('writer-secret'), false);
  assert.equal(verifyDelegatedCapabilityToken(token, {
    taskId: 'task-provider-token',
    agentId: 'agent.writer',
    capability: 'patch.apply',
    scope: 'files:src/harness-sidecar/interop/**',
    mode: 'mutation',
    issuerSecretProvider: provider,
    now: 8_500,
  }).valid, true);
  assert.deepEqual(verifyDelegatedCapabilityToken(token, {
    taskId: 'task-provider-token',
    agentId: 'agent.writer',
    capability: 'patch.apply',
    scope: 'files:src/harness-sidecar/interop/**',
    mode: 'mutation',
    issuerSecretProvider: createIssuerSecretProvider({ fallback: 'wrong-secret' }),
    now: 8_500,
  }).reasons, ['invalid_signature']);
});

test('queue and issuer providers preserve gateway mutation checks without model-visible secret leakage', () => {
  const root = mkdtempSync(join(tmpdir(), 'helios-a2a-gateway-provider-'));
  const storePath = join(root, 'a2a-state.json');
  try {
    const queueProvider = createA2aQueueProvider({
      durableStore: createJsonFileA2ADurableStore({ path: storePath, root }),
    });
    const issuerSecretProvider = createIssuerSecretProvider({
      secretStore: new Map([['issuer:writer', 'writer-secret']]),
    });
    const token = createDelegatedCapabilityToken({
      taskId: 'task-secret-safe',
      agentId: 'agent.writer',
      capabilities: ['patch.apply'],
      scopes: ['files:src/harness-sidecar/interop/**'],
      mode: 'mutation',
      issuedBy: 'owner',
      issuerKeyRef: 'issuer:writer',
      issuerSecretProvider,
      now: 9_000,
      ttlMs: 5_000,
    });
    const gateway = new ExternalAgentGateway({
      durableStore: queueProvider,
      issuerSecret: issuerSecretProvider.getIssuerSecret({ keyRef: 'issuer:writer' }),
      now: () => 9_500,
      agents: [{
        id: 'agent.writer',
        name: 'Writer',
        protocol: 'a2a',
        endpoint: {
          url: 'https://writer.example.test/a2a',
          headers: { Authorization: 'Bearer transport-secret' },
        },
        capabilities: ['patch.apply'],
        trustLevel: 'internal',
      }],
    });

    const queued = gateway.enqueueTask({
      agentId: 'agent.writer',
      approval: { approved: true, approvedBy: 'owner' },
      capabilityToken: token,
      task: {
        id: 'task-secret-safe',
        mutation: true,
        requiredCapabilities: ['patch.apply'],
        requiredScopes: ['files:src/harness-sidecar/interop/**'],
        prompt: 'Apply patch with OPENAI_API_KEY=plainsecret token=ghp_never_model_visible',
        context: {
          a2a: {
            modelRoute: {
              peerId: 'agent.writer',
              role: 'implementer',
              modelProfile: 'external-writer',
            },
          },
          'patch.apply': {
            diff: 'diff --git a/src/harness-sidecar/interop/a2a.js b/src/harness-sidecar/interop/a2a.js',
            password: 'never-model-visible',
          },
        },
      },
    });

    const modelVisible = JSON.stringify({
      queued,
      snapshot: gateway.snapshotDurableState(),
      provider: queueProvider.describe(),
      issuer: issuerSecretProvider.describe({ keyRef: 'issuer:writer' }),
      file: readFileSync(storePath, 'utf8'),
    });
    assert.equal(modelVisible.includes('writer-secret'), false);
    assert.equal(modelVisible.includes('transport-secret'), false);
    assert.equal(modelVisible.includes('ghp_never_model_visible'), false);
    assert.equal(modelVisible.includes('plainsecret'), false);
    assert.equal(modelVisible.includes('never-model-visible'), false);
    assert.equal(queued.envelope.task.context.a2a?.trust?.verified, false);
    assert.equal(queued.envelope.task.context.a2a?.trust?.external, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
