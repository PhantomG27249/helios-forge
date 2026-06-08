import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateMemoryPolicyCandidate,
  proposeMemoryPolicies,
} from '../src/harness-sidecar/meta/memoryPolicyEvolution.js';

test('memory policy candidates expose MemGraphRAG construction and retrieval knobs in shadow mode', () => {
  const candidates = proposeMemoryPolicies({
    coreset: {
      items: [
        { taskId: 'logical', reasons: ['memgraph_logical_conflict'] },
        { taskId: 'fragmented', reasons: ['memgraph_fragmentation'] },
        { taskId: 'stall', reasons: ['memgraph_pending_activation_stall'] },
      ],
    },
    baselinePolicy: {
      schemaThreshold: 3,
      conflictThreshold: 0.8,
      bridgingThreshold: 0.82,
      pendingTtl: 7,
      retrievalRestartProbability: 0.15,
      maxBridgeItems: 2,
    },
    maxCandidates: 3,
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates.every((candidate) => candidate.status === 'shadow_only'), true);
  assert.equal(candidates.some((candidate) => candidate.schemaThreshold < 3), true);
  assert.equal(candidates.some((candidate) => candidate.conflictThreshold < 0.8), true);
  assert.equal(candidates.some((candidate) => candidate.bridgingThreshold < 0.82), true);
  assert.equal(candidates.some((candidate) => candidate.pendingTtl < 7), true);
  assert.equal(candidates.some((candidate) => candidate.retrievalRestartProbability > 0.15), true);
  assert.equal(candidates.some((candidate) => candidate.maxBridgeItems < 2), true);
});

test('memory policy evaluator rewards relevant MemGraphRAG knobs without allowing provenance-free promotion', () => {
  const scored = evaluateMemoryPolicyCandidate({
    candidate: {
      status: 'shadow_only',
      schemaThreshold: 2,
      conflictThreshold: 0.72,
      bridgingThreshold: 0.76,
      pendingTtl: 3,
      retrievalRestartProbability: 0.22,
      maxBridgeItems: 1,
      provenanceRequired: true,
    },
    memoryCase: {
      reasons: [
        'memgraph_logical_conflict',
        'memgraph_fragmentation',
        'memgraph_pending_activation_stall',
      ],
      provenance: ['trace_memgraph_001'],
    },
  });
  const unsafe = evaluateMemoryPolicyCandidate({
    candidate: {
      status: 'promote',
      provenanceRequired: false,
      schemaThreshold: 1,
    },
    memoryCase: {
      reasons: ['memgraph_pending_activation_stall'],
      provenance: [],
    },
  });

  assert.equal(scored.safetyStatus, 'shadow_only');
  assert.equal(scored.score > 0.5, true);
  assert.equal(scored.reasons.includes('schema_threshold_addresses_activation_stall'), true);
  assert.equal(scored.reasons.includes('bridge_cap_addresses_fragmentation_noise'), true);
  assert.equal(unsafe.safetyStatus, 'blocked');
  assert.equal(unsafe.reasons.includes('provenance_required_for_memory_promotion'), true);
});
