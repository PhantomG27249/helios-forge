import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scoreMemoryCorpus } from '../src/harness-sidecar/memory/memoryEvals.js';

test('memory scale evals report dashboard-safe paper metrics without authority', () => {
  const corpus = scoreMemoryCorpus({
    records: [
      {
        memoryId: 'fact-active-supported',
        type: 'fact',
        summary: 'Active fact is backed by current evidence.',
        status: 'active',
        object: 'graph-rag',
        expectedObject: 'graph-rag',
        evidence: ['traces/memory/fact-active.jsonl'],
        provenance: [{ sourceId: 'trace-1', artifactId: 'traces/memory/fact-active.jsonl' }],
        reviewStatus: 'reviewed',
        validatorBacked: true,
        visualEvidence: [{ artifactId: 'screenshots/memory-panel.png' }],
      },
      {
        memoryId: 'fact-active-wrong',
        type: 'fact',
        summary: 'Active fact is missing the right object.',
        status: 'active',
        object: 'lexical',
        expectedObject: 'graph-rag',
        evidence: ['traces/memory/fact-active-wrong.jsonl'],
        provenance: [],
        reviewStatus: 'reviewed',
        validatorBacked: true,
      },
      {
        memoryId: 'procedure-visual',
        type: 'procedure',
        summary: 'Visual evidence exists for dashboard rendering.',
        evidence: ['screenshots/memory-flow.png'],
        provenanceRefs: ['screen-1'],
        reviewStatus: 'reviewed',
        validatorBacked: true,
        evidenceModalities: ['visual'],
      },
    ],
    conflicts: [
      {
        conflictId: 'conflict-good',
        action: 'quarantine',
        correctAction: 'quarantine',
        evidence: ['traces/conflicts/good.jsonl'],
      },
      {
        conflictId: 'conflict-bad',
        action: 'discard',
        correctAction: 'needs_review',
        evidence: ['traces/conflicts/bad.jsonl'],
      },
    ],
    retrievalResults: [
      {
        queryId: 'q-hit',
        expectedIds: ['fact-active-supported'],
        retrievedIds: ['fact-active-supported', 'procedure-visual'],
        tokensEstimated: 100,
      },
      {
        queryId: 'q-miss',
        expectedIds: ['missing-fact'],
        retrievedIds: ['fact-active-wrong'],
        tokensEstimated: 100,
      },
    ],
    graph: {
      nodes: [
        { id: 'fact-active-supported' },
        { id: 'fact-active-wrong' },
        { id: 'procedure-visual' },
        { id: 'trace-1' },
      ],
      edges: [
        { from: 'fact-active-supported', to: 'trace-1' },
        { from: 'procedure-visual', to: 'fact-active-supported' },
      ],
    },
    budget: { tokenBudget: 400 },
    migrations: [
      {
        migrationId: 'memory-schema-v2',
        status: 'completed',
        evidence: ['migrations/memory-schema-v2.jsonl'],
        migratedRecords: 10,
        failedRecords: 0,
      },
      {
        migrationId: 'memory-schema-v3',
        status: 'failed',
        evidence: [],
        migratedRecords: 7,
        failedRecords: 3,
      },
    ],
    decay: [
      { memoryId: 'fact-active-supported', status: 'fresh', evidence: ['traces/decay/fresh.jsonl'] },
      { memoryId: 'fact-active-wrong', status: 'stale', action: 'quarantined', evidence: ['traces/decay/stale.jsonl'] },
      { memoryId: 'procedure-visual', status: 'stale', action: 'pending', evidence: [] },
    ],
    consolidation: [
      {
        queueId: 'consolidate-supported',
        status: 'resolved',
        memoryIds: ['fact-active-supported', 'procedure-visual'],
        evidence: ['traces/consolidation/resolved.jsonl'],
      },
      {
        queueId: 'consolidate-pending',
        status: 'needs_review',
        memoryIds: ['fact-active-wrong'],
        evidence: [],
      },
    ],
  });

  assert.equal(corpus.evidenceOnly, true);
  assert.equal(corpus.canPromote, false);
  assert.equal(corpus.metrics.activeFactPrecision, 50);
  assert.equal(corpus.metrics.conflictQuality, 50);
  assert.equal(corpus.metrics.provenanceCoverage, 67);
  assert.equal(corpus.metrics.connectivity, 50);
  assert.equal(corpus.metrics.retrievalHitRate, 50);
  assert.equal(corpus.metrics.budgetEfficiency, 50);
  assert.equal(corpus.metrics.migrationHealth, 50);
  assert.equal(corpus.metrics.decayConsolidationHealth, 60);
  assert.equal(corpus.metrics.visualEvidenceCoverage, 67);
});
