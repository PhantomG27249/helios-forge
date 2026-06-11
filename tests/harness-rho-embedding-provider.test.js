import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRhoCoreset } from '../src/harness-sidecar/rho/coresetBuilder.js';
import { createEmbeddingProvider } from '../src/harness-sidecar/rho/embeddingProvider.js';

const enabledRhoEmbeddingGate = {
  modelBackedRhoEmbeddings: {
    enabled: true,
    mode: 'advisory',
    authority: 'evidence_only',
  },
};

test('deterministic fallback embeddings are stable by id and text', async () => {
  const provider = createEmbeddingProvider({ fallback: { dimensions: 12 } });

  const first = await provider.embedTextBatch([
    { id: 'case-a', text: 'repair websocket retry loop' },
    { id: 'case-b', text: 'rebuild memory graph provenance conflict' },
  ]);
  const second = await provider.embedTextBatch([
    { id: 'case-b', text: 'rebuild memory graph provenance conflict' },
    { id: 'case-a', text: 'repair websocket retry loop' },
  ]);

  assert.equal(first.embeddings.length, 2);
  assert.equal(first.embeddings[0].source, 'fallback');
  assert.equal(first.embeddings[0].embedding.length, 12);
  assert.deepEqual(
    first.embeddingById.get('case-a'),
    second.embeddingById.get('case-a'),
  );
  assert.deepEqual(
    first.embeddingById.get('case-b'),
    second.embeddingById.get('case-b'),
  );
  assert.equal(first.authority, 'evidence_only');
  assert.equal(first.promotionAllowed, false);
});

test('model-backed adapter is gated by productionCapabilities.modelBackedRhoEmbeddings', async () => {
  const calls = [];
  const modelProvider = {
    async embedTextBatch(inputs) {
      calls.push(inputs.map((input) => input.id));
      return inputs.map((input, index) => ({
        id: input.id,
        embedding: index === 0 ? [1, 0, 0] : [0, 1, 0],
      }));
    },
  };

  const disabled = createEmbeddingProvider({
    modelProvider,
    fallback: { dimensions: 6 },
    productionCapabilities: {
      modelBackedRhoEmbeddings: {
        enabled: false,
        mode: 'offline',
        authority: 'evidence_only',
      },
    },
  });
  const disabledResult = await disabled.embedTextBatch([{ id: 'offline', text: 'code failure' }]);

  assert.equal(calls.length, 0);
  assert.equal(disabledResult.embeddings[0].source, 'fallback');

  const enabled = createEmbeddingProvider({
    modelProvider,
    fallback: { dimensions: 6 },
    productionCapabilities: enabledRhoEmbeddingGate,
  });
  const enabledResult = await enabled.embedTextBatch([
    { id: 'model-a', text: 'visual verifier false negative' },
    { id: 'model-b', text: 'tool timeout hard case' },
  ]);

  assert.deepEqual(calls, [['model-a', 'model-b']]);
  assert.deepEqual(enabledResult.embeddingById.get('model-a'), [1, 0, 0]);
  assert.deepEqual(enabledResult.embeddingById.get('model-b'), [0, 1, 0]);
  assert.deepEqual(
    enabledResult.embeddings.map((entry) => entry.source),
    ['model', 'model'],
  );
  assert.equal(enabledResult.modelBacked, true);
  assert.equal(enabledResult.authority, 'evidence_only');
  assert.equal(enabledResult.promotionAllowed, false);
});

test('model-backed adapter failures degrade to deterministic fallback embeddings', async () => {
  const provider = createEmbeddingProvider({
    modelProvider: {
      async embedTextBatch() {
        throw new Error('embedding endpoint unavailable');
      },
    },
    fallback: { dimensions: 10 },
    productionCapabilities: enabledRhoEmbeddingGate,
  });

  const first = await provider.embedTextBatch([
    { id: 'provider-error-a', text: 'research replay failure' },
    { id: 'provider-error-b', text: 'safety quarantine hard case' },
  ]);
  const second = await provider.embedTextBatch([
    { id: 'provider-error-a', text: 'research replay failure' },
  ]);

  assert.deepEqual(
    first.embeddings.map((entry) => entry.source),
    ['fallback', 'fallback'],
  );
  assert.deepEqual(
    first.embeddings.map((entry) => entry.fallbackReason),
    ['model_provider_error', 'model_provider_error'],
  );
  assert.deepEqual(
    first.embeddingById.get('provider-error-a'),
    second.embeddingById.get('provider-error-a'),
  );
  assert.equal(first.modelBacked, false);
  assert.equal(first.modelProviderError?.type, 'model_provider_error');
  assert.equal(first.authority, 'evidence_only');
  assert.equal(first.promotionAllowed, false);
});

test('embedCaseBatch adapts RHO cases into precomputed embeddings for coreset selection', async () => {
  const modelProvider = {
    async embedTextBatch(inputs) {
      return inputs.map((input) => {
        if (input.id === 'code-a' || input.id === 'code-a-near') {
          return { id: input.id, embedding: [1, 0, 0, 0] };
        }
        if (input.id === 'memory-b') {
          return { id: input.id, embedding: [0, 1, 0, 0] };
        }
        return { id: input.id, embedding: [0, 0, 1, 0] };
      });
    },
  };
  const provider = createEmbeddingProvider({
    modelProvider,
    fallback: { dimensions: 8 },
    productionCapabilities: enabledRhoEmbeddingGate,
  });

  const embedded = await provider.embedCaseBatch([
    {
      id: 'code-a',
      domain: 'code',
      summary: 'repair sidecar websocket reconnect failure',
      status: 'failed',
    },
    {
      id: 'code-a-near',
      domain: 'code',
      summary: 'repair sidecar websocket retry failure',
      status: 'failed',
    },
    {
      id: 'memory-b',
      domain: 'memory',
      summary: 'resolve memory provenance contradiction',
      status: 'failed',
    },
    {
      id: 'visual-c',
      domain: 'visual',
      summary: 'catch visual verifier false negative',
      status: 'failed',
    },
  ]);

  const coreset = buildRhoCoreset({
    traces: [
      { taskId: 'code-a', status: 'failed', failureModes: ['same'] },
      { taskId: 'code-a-near', status: 'failed', failureModes: ['same'] },
      { taskId: 'memory-b', status: 'failed', failureModes: ['same'] },
      { taskId: 'visual-c', status: 'failed', failureModes: ['same'] },
    ],
    limit: 3,
    precomputedEmbeddings: embedded.embeddingById,
  });

  assert.equal(coreset.selection.strategy, 'embedding_dpp_like');
  assert.equal(coreset.selectedCount, 3);
  assert.equal(coreset.items.some((item) => item.taskId === 'code-a-near'), false);
  assert.deepEqual(
    coreset.items.map((item) => item.metadata.difficulty.band),
    ['hard', 'hard', 'hard'],
  );
  assert.deepEqual(
    coreset.items.map((item) => item.metadata.diversity.embeddingSource),
    ['provided', 'provided', 'provided'],
  );
  assert.deepEqual(
    coreset.items.map((item) => item.metadata.diversity.keys),
    [['same'], ['same'], ['same']],
  );
});
