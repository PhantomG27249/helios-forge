import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildProductionProvenanceResolutionReport } from '../src/harness-sidecar/memory/provenanceResolutionAgents.js';

const FIXED_NOW = new Date('2026-06-17T12:00:00.000Z');

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

const passages = [
  { id: 'passage-new', text: 'The verifier.command equals node --test tests/harness-memory.test.js.' },
  { id: 'passage-old', text: 'Legacy docs said verifier.command equals npm test.' },
];

test('buildProductionProvenanceResolutionReport emits evidence-only production envelope', async () => {
  const report = await buildProductionProvenanceResolutionReport({
    conflicts: [conflict],
    provenancePassages: passages,
    modelResolver: async () => ({
      verdict: 'supported',
      confidence: 0.86,
      provenanceRefs: ['passage-new'],
      reasons: ['Fresh retrieved provenance supports the new fact.'],
    }),
    runId: 'provenance-run-1',
    recordedAt: FIXED_NOW.toISOString(),
  });

  assert.equal(report.evidenceType, 'provenance_resolution_report');
  assert.equal(report.evidenceOnly, true);
  assert.equal(report.canPromote, false);
  assert.equal(report.promotionEvidenceOnly, true);
  assert.equal(report.promotionAllowed, false);
  assert.equal(report.modelEvidenceOnly, true);
  assert.equal(report.authority, 'evidence_only');
  assert.equal(report.runId, 'provenance-run-1');
  assert.equal(report.recordedAt, FIXED_NOW.toISOString());
  assert.equal(report.summary.conflictCount, 1);
  assert.equal(report.summary.supportedCount, 1);
  assert.equal(report.resolutions.length, 1);
  assert.equal(report.resolutions[0].verdict, 'supported');
  assert.equal(report.resolutions[0].promotionAllowed, false);
});

test('buildProductionProvenanceResolutionReport summarizes mixed verdicts across conflicts', async () => {
  const secondConflict = {
    ...conflict,
    newFact: {
      ...conflict.newFact,
      object: 'npm run verify',
    },
  };

  const report = await buildProductionProvenanceResolutionReport({
    conflicts: [conflict, secondConflict],
    provenancePassages: passages,
    modelResolver: async ({ conflict: activeConflict }) => ({
      verdict: activeConflict.newFact.object.includes('verify') ? 'contradicted' : 'supported',
      confidence: 0.7,
      provenanceRefs: ['passage-new'],
      reasons: ['Model verdict for production report aggregation.'],
    }),
    runId: 'provenance-run-2',
    recordedAt: FIXED_NOW.toISOString(),
  });

  assert.equal(report.summary.conflictCount, 2);
  assert.equal(report.summary.supportedCount, 1);
  assert.equal(report.summary.contradictedCount, 1);
  assert.equal(report.summary.insufficientEvidenceCount, 0);
  assert.deepEqual(
    report.resolutions.map((entry) => entry.verdict),
    ['supported', 'contradicted'],
  );
});

test('buildProductionProvenanceResolutionReport forces evidence-only flags on nested resolutions', async () => {
  const report = await buildProductionProvenanceResolutionReport({
    conflicts: [conflict],
    provenancePassages: passages,
    modelResolver: async () => ({
      verdict: 'supported',
      confidence: 0.9,
      provenanceRefs: ['passage-new'],
      promotionAllowed: true,
      canPromote: true,
      modelEvidenceOnly: false,
      reasons: ['Authority claims must be stripped in production envelope.'],
    }),
    runId: 'provenance-run-3',
    recordedAt: FIXED_NOW.toISOString(),
  });

  assert.equal(report.canPromote, false);
  assert.equal(report.promotionEvidenceOnly, true);
  assert.equal(report.modelEvidenceOnly, true);
  assert.equal(report.resolutions[0].promotionAllowed, false);
  assert.equal(report.resolutions[0].modelEvidenceOnly, true);
});
