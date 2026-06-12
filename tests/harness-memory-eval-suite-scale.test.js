import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateMemoryRecord, scoreMemoryCorpus } from '../src/harness-sidecar/memory/memoryEvals.js';

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
  assert.equal(corpus.metrics.connectivity, 75);
  assert.equal(corpus.metrics.retrievalHitRate, 50);
  assert.equal(corpus.metrics.budgetEfficiency, 50);
  assert.equal(corpus.metrics.migrationHealth, 50);
  assert.equal(corpus.metrics.decayConsolidationHealth, 60);
  assert.equal(corpus.metrics.visualEvidenceCoverage, 67);
});

test('memory eval outputs summarize records without leaking dashboard-unsafe fields', () => {
  const record = {
    memoryId: 'unsafe-memory',
    type: 'fact',
    summary: 'Safe summary for dashboard.',
    evidence: ['traces/memory/safe.jsonl'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
    secret: 'sk-live-secret',
    apiToken: 'token-secret-value',
    unsafePath: 'C:\\Users\\jackj\\.ssh\\id_rsa',
    traversalPath: '..\\..\\secrets.env',
    apply: true,
    promote: true,
    approved: true,
    verified: true,
    nested: { token: 'nested-secret' },
  };

  const evaluation = evaluateMemoryRecord(record);
  const corpus = scoreMemoryCorpus({ records: [record] });
  const dashboardJson = JSON.stringify({ evaluation, corpusEvaluations: corpus.evaluations });

  assert.equal(evaluation.evidenceOnly, true);
  assert.equal(evaluation.canPromote, false);
  assert.equal(corpus.evaluations[0].evidenceOnly, true);
  assert.equal(corpus.evaluations[0].canPromote, false);
  assert.deepEqual(Object.keys(evaluation.record).sort(), [
    'evidenceCount',
    'evidenceRefs',
    'memoryId',
    'reviewStatus',
    'status',
    'summary',
    'type',
    'validatorBacked',
  ].sort());
  assert.equal(dashboardJson.includes('sk-live-secret'), false);
  assert.equal(dashboardJson.includes('token-secret-value'), false);
  assert.equal(dashboardJson.includes('id_rsa'), false);
  assert.equal(dashboardJson.includes('secrets.env'), false);
  assert.equal(dashboardJson.includes('"apply"'), false);
  assert.equal(dashboardJson.includes('"promote"'), false);
  assert.equal(dashboardJson.includes('"approved"'), false);
  assert.equal(dashboardJson.includes('"verified"'), false);
});

test('budget efficiency rewards lower usage over exhaustion or overage', () => {
  const lowUsage = scoreMemoryCorpus({
    retrievalResults: [{ queryId: 'q-low', expectedIds: ['a'], retrievedIds: ['a'], tokensEstimated: 100 }],
    budget: { tokenBudget: 400 },
  });
  const exhausted = scoreMemoryCorpus({
    retrievalResults: [{ queryId: 'q-full', expectedIds: ['a'], retrievedIds: ['a'], tokensEstimated: 400 }],
    budget: { tokenBudget: 400 },
  });
  const overage = scoreMemoryCorpus({
    retrievalResults: [{ queryId: 'q-over', expectedIds: ['a'], retrievedIds: ['a'], tokensEstimated: 450 }],
    budget: { tokenBudget: 400 },
  });

  assert.equal(lowUsage.metrics.budgetEfficiency, 75);
  assert.equal(exhausted.metrics.budgetEfficiency, 0);
  assert.equal(overage.metrics.budgetEfficiency, 0);
  assert.equal(lowUsage.metrics.budgetEfficiency > exhausted.metrics.budgetEfficiency, true);
});

test('connectivity ignores duplicate, cyclic, and nonexistent-node edges', () => {
  const corpus = scoreMemoryCorpus({
    graph: {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'a', to: 'missing' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    },
  });

  assert.equal(corpus.metrics.connectivity, 75);
});

test('connectivity scores a fully connected tree as complete graph coverage', () => {
  const corpus = scoreMemoryCorpus({
    graph: {
      nodes: [{ id: 'memory-a' }, { id: 'memory-b' }, { id: 'memory-c' }],
      edges: [
        { from: 'memory-a', to: 'memory-b' },
        { from: 'memory-b', to: 'memory-c' },
      ],
    },
  });

  assert.equal(corpus.metrics.connectivity, 100);
});
