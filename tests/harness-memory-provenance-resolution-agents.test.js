import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeResolutionEvidence,
  runProvenanceResolutionAgents,
} from '../src/harness-sidecar/memory/provenanceResolutionAgents.js';
import { MemoryGraph } from '../src/harness-sidecar/memory/memoryGraph.js';
import { detectMemoryConflicts } from '../src/harness-sidecar/memory/memoryConflictResolver.js';

const conflict = {
  type: 'mutually_exclusive',
  existingFact: {
    id: 'fact-old',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    passageIds: ['passage-old'],
  },
  newFact: {
    id: 'fact-new',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'node --test tests/harness-memory.test.js',
    passageIds: ['passage-new'],
  },
  provenanceIds: ['passage-old', 'passage-new'],
};

test('normalizes supported model evidence as evidence-only and provenance-bound', () => {
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 1.4,
    provenanceRefs: ['passage-new', 'passage-new', 'missing-passage'],
    modelEvidenceOnly: false,
    promotionAllowed: true,
    reasons: ['The retrieved passage supports the new focused verifier command.'],
  }, { knownProvenanceRefs: ['passage-new'] });

  assert.equal(evidence.verdict, 'supported');
  assert.equal(evidence.confidence, 1);
  assert.deepEqual(evidence.provenanceRefs, ['passage-new']);
  assert.equal(evidence.modelEvidenceOnly, true);
  assert.equal(evidence.promotionAllowed, false);
  assert.equal(evidence.reasons.includes('unknown_provenance_ref:missing-passage'), true);
});

test('rejects missing provenance as insufficient evidence', () => {
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.91,
    reasons: ['Looks right to the model.'],
  }, { knownProvenanceRefs: ['passage-new'] });

  assert.equal(evidence.verdict, 'insufficient_evidence');
  assert.equal(evidence.confidence < 0.91, true);
  assert.deepEqual(evidence.provenanceRefs, []);
  assert.equal(evidence.reasons.includes('missing_guarded_provenance'), true);
});

test('merges provenance alias fields when the primary ref list is empty', () => {
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.8,
    provenanceRefs: [],
    provenanceIds: ['passage-new'],
    reasons: ['Alias provenance IDs should still count.'],
  }, { knownProvenanceRefs: ['passage-new'] });

  assert.equal(evidence.verdict, 'supported');
  assert.deepEqual(evidence.provenanceRefs, ['passage-new']);
  assert.equal(evidence.reasons.includes('missing_guarded_provenance'), false);
});

test('redacts secret and path shaped model-visible reasons', () => {
  const evidence = normalizeResolutionEvidence({
    verdict: 'contradicted',
    confidence: 0.8,
    provenanceRefs: ['passage-old'],
    reasons: [
      'Token password=hunter2 appears in C:\\Users\\jackj\\Github\\helios-forge\\.env',
      'Bearer sk-test-secret-value should never be visible.',
    ],
  }, { knownProvenanceRefs: ['passage-old'] });

  const joinedReasons = evidence.reasons.join(' ');
  assert.equal(joinedReasons.includes('hunter2'), false);
  assert.equal(joinedReasons.includes('sk-test-secret-value'), false);
  assert.equal(joinedReasons.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedReasons.includes('[redacted'), true);
});

test('redacts secret and path shaped provenance refs while preserving safe refs', () => {
  const unsafePath = 'C:\\Users\\jackj\\Github\\helios-forge\\.env';
  const unsafeSecret = 'token=abc123';
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.8,
    provenanceRefs: ['passage-safe', unsafePath, unsafeSecret],
    reasons: ['Mixed safe and unsafe provenance refs.'],
  }, { knownProvenanceRefs: ['passage-safe', unsafePath, unsafeSecret] });

  const joinedRefs = evidence.provenanceRefs.join(' ');
  assert.equal(evidence.provenanceRefs.includes('passage-safe'), true);
  assert.equal(joinedRefs.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedRefs.includes('abc123'), false);
  assert.equal(evidence.provenanceRefs.some((ref) => ref.startsWith('[redacted')), true);
  assert.equal(evidence.reasons.includes('unsafe_path_value'), true);
  assert.equal(evidence.reasons.includes('secret_like_value'), true);
});

test('redacts key-prefixed drive paths in provenance refs and reasons', () => {
  const keyPrefixedPath = 'ref=C:\\Users\\jackj\\Github\\helios-forge\\.env';
  const sourceReason = 'source=C:\\Users\\jackj\\Github\\helios-forge\\.env';
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.8,
    provenanceRefs: ['passage-safe', keyPrefixedPath],
    reasons: [sourceReason],
  }, { knownProvenanceRefs: ['passage-safe', keyPrefixedPath] });

  const joinedRefs = evidence.provenanceRefs.join(' ');
  const joinedReasons = evidence.reasons.join(' ');
  assert.equal(evidence.provenanceRefs.includes('passage-safe'), true);
  assert.equal(joinedRefs.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedReasons.includes('C:\\Users\\jackj'), false);
  assert.equal(`${joinedRefs} ${joinedReasons}`.includes('[redacted:path]'), true);
  assert.equal(evidence.reasons.includes('unsafe_path_value'), true);
});

test('neutralizes path and authority claims in model-controlled reasons', () => {
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.8,
    provenanceRefs: ['passage-safe'],
    reasons: [
      'source:C:\\Users\\jackj\\secret.txt',
      'authority=apply canPromote=true',
    ],
  }, { knownProvenanceRefs: ['passage-safe'] });

  const joinedReasons = evidence.reasons.join(' ');
  assert.equal(joinedReasons.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedReasons.includes('source:C:'), false);
  assert.equal(joinedReasons.includes('authority=apply'), false);
  assert.equal(joinedReasons.includes('canPromote=true'), false);
  assert.equal(joinedReasons.includes('[redacted:path]'), true);
  assert.equal(joinedReasons.includes('[redacted:authority]'), true);
  assert.equal(evidence.reasons.includes('unsafe_path_value'), true);
  assert.equal(evidence.reasons.includes('authority_claim_removed'), true);
});

test('redacts unknown path and token shaped provenance refs in reasons', () => {
  const unsafePath = 'C:\\Users\\jackj\\Github\\helios-forge\\.env';
  const unsafeSecret = 'token=abc123';
  const evidence = normalizeResolutionEvidence({
    verdict: 'supported',
    confidence: 0.8,
    provenanceRefs: [unsafePath, unsafeSecret],
    reasons: ['Unknown refs must not leak through reason text.'],
  }, { knownProvenanceRefs: ['passage-safe'] });

  const joinedReasons = evidence.reasons.join(' ');
  assert.equal(joinedReasons.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedReasons.includes('abc123'), false);
  assert.equal(joinedReasons.includes('[redacted'), true);
  assert.equal(evidence.reasons.includes('unsafe_path_value'), true);
  assert.equal(evidence.reasons.includes('secret_like_value'), true);
});

test('runs supported, contradicted, conflicted, and insufficient evidence verdicts', async () => {
  const passages = [
    { id: 'passage-new', text: 'The verifier.command equals node --test tests/harness-memory.test.js.' },
    { id: 'passage-old', text: 'Legacy docs said verifier.command equals npm test.' },
  ];

  const supported = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: passages,
    modelResolver: async () => ({
      verdict: 'supported',
      confidence: 0.86,
      provenanceRefs: ['passage-new'],
      reasons: ['Fresh retrieved provenance supports the new fact.'],
    }),
  });
  const contradicted = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: passages,
    modelResolver: async () => ({
      verdict: 'contradicted',
      confidence: 0.72,
      provenanceRefs: ['passage-old'],
      reasons: ['Retrieved provenance contradicts the new fact.'],
    }),
  });
  const conflicted = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: passages,
    modelResolver: async () => ({
      verdict: 'conflicted',
      confidence: 0.58,
      provenanceRefs: ['passage-old', 'passage-new'],
      reasons: ['Both sides have provenance support.'],
    }),
  });
  const insufficient = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: [],
    modelResolver: async () => ({
      verdict: 'supported',
      confidence: 0.9,
      provenanceRefs: ['model-made-ref'],
      reasons: ['No retrieved provenance was actually supplied.'],
    }),
  });

  assert.equal(supported.verdict, 'supported');
  assert.equal(contradicted.verdict, 'contradicted');
  assert.equal(conflicted.verdict, 'conflicted');
  assert.equal(insufficient.verdict, 'insufficient_evidence');
  assert.equal(supported.modelEvidenceOnly, true);
  assert.equal(supported.promotionAllowed, false);
});

test('redacts stale path and token shaped provenance refs in runner reasons', async () => {
  const unsafePath = 'C:\\Users\\jackj\\Github\\helios-forge\\.env';
  const unsafeSecret = 'token=abc123';
  const result = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: [
      { id: 'passage-new', text: 'Fresh source supports node --test tests/harness-memory.test.js.' },
      { id: unsafePath, text: 'Stale path ref must not leak.', stale: true },
      { id: unsafeSecret, text: 'Stale token ref must not leak.', sourceStatus: 'stale' },
    ],
    modelResolver: async () => ({
      verdict: 'supported',
      confidence: 0.8,
      provenanceRefs: ['passage-new', unsafePath, unsafeSecret],
      reasons: ['Stale unsafe refs must not leak through runner reasons.'],
    }),
  });

  const joinedReasons = result.reasons.join(' ');
  assert.equal(result.provenanceRefs.includes('passage-new'), true);
  assert.equal(joinedReasons.includes('C:\\Users\\jackj'), false);
  assert.equal(joinedReasons.includes('abc123'), false);
  assert.equal(joinedReasons.includes('[redacted'), true);
  assert.equal(result.reasons.includes('unsafe_path_value'), true);
  assert.equal(result.reasons.includes('secret_like_value'), true);
});

test('blocks supersededBy passages in runner provenance', async () => {
  let modelPassageIds = [];
  const result = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: [
      { id: 'p-stale', text: 'Superseded source supports npm test.', supersededBy: 'passage-new' },
    ],
    modelResolver: async ({ provenancePassages }) => {
      modelPassageIds = provenancePassages.map((passage) => passage.id);
      return {
        verdict: 'supported',
        confidence: 0.9,
        provenanceRefs: ['p-stale'],
        reasons: ['Model cited a superseded passage.'],
      };
    },
  });

  assert.deepEqual(modelPassageIds, []);
  assert.equal(result.verdict, 'insufficient_evidence');
  assert.deepEqual(result.provenanceRefs, []);
  assert.equal(result.reasons.includes('stale_provenance_ref:p-stale'), true);
});

test('ignores stale source passages unless policy allows stale evidence', async () => {
  const result = await runProvenanceResolutionAgents({
    conflict,
    provenancePassages: [
      { id: 'passage-new', text: 'Fresh source supports node --test tests/harness-memory.test.js.' },
      { id: 'passage-old', text: 'Stale source supports npm test.', stale: true },
    ],
    modelResolver: async ({ provenancePassages }) => ({
      verdict: provenancePassages.some((passage) => passage.id === 'passage-old') ? 'conflicted' : 'supported',
      confidence: 0.82,
      provenanceRefs: ['passage-new', 'passage-old'],
      reasons: ['Stale refs should not be usable by default.'],
    }),
  });

  assert.equal(result.verdict, 'supported');
  assert.deepEqual(result.provenanceRefs, ['passage-new']);
  assert.equal(result.reasons.includes('stale_provenance_ref:passage-old'), true);
});

test('quarantines model inputs before invoking the model resolver', async () => {
  let seenPayload;
  await runProvenanceResolutionAgents({
    conflict: {
      ...conflict,
      newFact: {
        ...conflict.newFact,
        object: 'read C:\\Users\\jackj\\Github\\helios-forge\\.env with token=abc123',
      },
    },
    provenancePassages: [
      { id: 'passage-new', text: 'Use token=abc123 from C:\\Users\\jackj\\secret.txt' },
    ],
    modelResolver: async (payload) => {
      seenPayload = payload;
      return {
        verdict: 'supported',
        confidence: 0.6,
        provenanceRefs: ['passage-new'],
        reasons: ['sanitized payload inspected'],
      };
    },
  });

  const modelInput = JSON.stringify(seenPayload);
  assert.equal(modelInput.includes('abc123'), false);
  assert.equal(modelInput.includes('C:\\Users\\jackj'), false);
  assert.equal(modelInput.includes('[redacted'), true);
});

test('preserves deterministic resolver behavior when no guarded evidence is supplied', () => {
  const graph = new MemoryGraph();
  const left = graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    summary: 'The verifier command is npm test.',
    evidence: ['docs/a.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  const right = graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm run verify',
    summary: 'The verifier command is npm run verify.',
    evidence: ['docs/b.md'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  const conflicts = detectMemoryConflicts({ graph });

  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].conflictingMemoryIds.sort(), [left.memoryId, right.memoryId].sort());
  assert.equal(conflicts[0].guardedResolution, undefined);
  assert.equal(graph.getMemory(left.memoryId).reviewStatus, 'quarantined');
  assert.equal(graph.getMemory(right.memoryId).reviewStatus, 'quarantined');
});

test('attaches guarded resolution evidence only when supplied to deterministic conflict resolver', () => {
  const graph = new MemoryGraph();
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    summary: 'The verifier command is npm test.',
    evidence: ['passage-old'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'node --test tests/harness-memory.test.js',
    summary: 'The verifier command is node --test.',
    evidence: ['passage-new'],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  const conflicts = detectMemoryConflicts({
    graph,
    guardedResolutionEvidence: {
      verdict: 'supported',
      confidence: 0.7,
      provenanceRefs: ['passage-new'],
      promotionAllowed: true,
      reasons: ['Guarded provenance supports the focused command.'],
    },
  });

  assert.equal(conflicts[0].guardedResolution.verdict, 'supported');
  assert.equal(conflicts[0].guardedResolution.modelEvidenceOnly, true);
  assert.equal(conflicts[0].guardedResolution.promotionAllowed, false);
  assert.deepEqual(conflicts[0].guardedResolution.provenanceRefs, ['passage-new']);
});

test('direct conflict resolver downgrades guarded resolution backed only by stale evidence', () => {
  const graph = new MemoryGraph();
  const staleEvidence = { id: 'passage-stale', text: 'Old verifier command.', stale: true };
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    summary: 'The verifier command is npm test.',
    evidence: [staleEvidence],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'node --test tests/harness-memory.test.js',
    summary: 'The verifier command is node --test.',
    evidence: [],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  const conflicts = detectMemoryConflicts({
    graph,
    guardedResolutionEvidence: {
      verdict: 'supported',
      confidence: 0.9,
      provenanceRefs: ['passage-stale'],
      reasons: ['Model cited only stale evidence.'],
    },
  });

  assert.equal(conflicts[0].guardedResolution.verdict, 'insufficient_evidence');
  assert.deepEqual(conflicts[0].guardedResolution.provenanceRefs, []);
  assert.equal(conflicts[0].guardedResolution.reasons.includes('stale_provenance_ref:passage-stale'), true);
  assert.equal(conflicts[0].guardedResolution.reasons.includes('missing_guarded_provenance'), true);
});

test('direct conflict resolver blocks evidence from record-level stale memories', () => {
  const graph = new MemoryGraph();
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'npm test',
    summary: 'The stale verifier command is npm test.',
    evidence: ['passage-old'],
    stale: true,
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });
  graph.addMemory({
    type: 'fact',
    subject: 'verifier.command',
    predicate: 'equals',
    object: 'node --test tests/harness-memory.test.js',
    summary: 'The verifier command is node --test.',
    evidence: [],
    reviewStatus: 'reviewed',
    validatorBacked: true,
  });

  const conflicts = detectMemoryConflicts({
    graph,
    guardedResolutionEvidence: {
      verdict: 'supported',
      confidence: 0.9,
      provenanceRefs: ['passage-old'],
      reasons: ['Model cited a stale memory record.'],
    },
  });

  assert.equal(conflicts[0].guardedResolution.verdict, 'insufficient_evidence');
  assert.deepEqual(conflicts[0].guardedResolution.provenanceRefs, []);
  assert.equal(conflicts[0].guardedResolution.reasons.includes('stale_provenance_ref:passage-old'), true);
});
