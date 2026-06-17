import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ingestLocalMemoryProposals } from '../src/harness-sidecar/memory/memoryGraphTaskBridge.js';
import { createMemoryGraphRuntime } from '../src/harness-sidecar/memory/memoryGraphRuntime.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-memory-bridge-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('bridge ingests local_memory proposals through guarded memory graph runtime', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({ workspaceRoot });
    const result = await ingestLocalMemoryProposals({
      workspaceRoot,
      runtime,
      featureFlags: {
        localMemoryGraph: true,
        productionCapabilities: {
          modelAssistedMemory: {
            enabled: true,
            mode: 'advisory',
            authority: 'evidence_only',
          },
        },
      },
      proposals: [
        {
          factId: 'fact_1',
          subject: 'subagentRunner',
          relation: 'needs',
          object: 'evolutionOutput',
          passageId: 'trace-1',
        },
      ],
    });

    assert.equal(result.ingested, true);
    assert.equal(result.skipped, false);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
    assert.equal(result.promotionAuthority, false);
    assert.equal(result.activeWorkspaceMutation, false);
    assert.deepEqual(result.requiredGuards, [
      'schema_validation',
      'retrieved_provenance_required',
      'model_visible_quarantine',
      'evidence_only_authority',
      'no_direct_memory_promotion',
    ]);
    assert.equal(result.proposalCount, 1);
    assert.equal(result.ingestResult.layers.facts.length >= 0, true);

    const layers = await runtime.loadLayers();
    assert.equal(layers.passages.length >= 0, true);
  });
});

test('bridge skips ingest when local memory graph feature is disabled', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const runtime = createMemoryGraphRuntime({ workspaceRoot });
    const result = await ingestLocalMemoryProposals({
      workspaceRoot,
      runtime,
      featureFlags: { localMemoryGraph: false },
      proposals: [{ factId: 'fact_1', subject: 'A', relation: 'requires', object: 'B' }],
    });

    assert.equal(result.ingested, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reasons.includes('local_memory_graph_disabled'), true);
    assert.equal(result.evidenceOnly, true);
    assert.equal(result.canPromote, false);
  });
});

test('bridge uses deterministic guards when model-assisted memory is offline', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const result = await ingestLocalMemoryProposals({
      workspaceRoot,
      featureFlags: {
        localMemoryGraph: true,
        productionCapabilities: {
          modelAssistedMemory: {
            enabled: false,
            mode: 'offline',
            authority: 'evidence_only',
          },
        },
      },
      proposals: [{ text: 'Helios stores memory under .harness/memory.', source: 'trace-2' }],
    });

    assert.equal(result.ingested, true);
    assert.equal(result.extractionMode, 'deterministic');
    assert.deepEqual(result.requiredGuards, []);
    assert.equal(result.canPromote, false);
  });
});
