import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditCitations } from '../src/harness-sidecar/research/citationAuditor.js';
import { createDeepResearchReport } from '../src/harness-sidecar/research/deepResearchManager.js';
import { compileResearchReport } from '../src/harness-sidecar/research/reportCompiler.js';
import { compareMetrics } from '../src/harness-sidecar/experiments/metricComparer.js';
import { proposeExperiment } from '../src/harness-sidecar/experiments/experimentManager.js';

test('deep research manager creates source-grounded report contracts', () => {
  const report = createDeepResearchReport({
    question: 'Which harness features matter most?',
    sources: [
      { sourceId: 'src_1', title: 'Harness plan', path: 'docs/plan.md', claims: ['Verifier evidence is required.'] },
    ],
  });

  assert.match(report.researchId, /^research_/);
  assert.equal(report.sourceMap.length, 1);
  assert.equal(report.claimEvidenceTable.length, 1);
  assert.deepEqual(report.contradictions, []);
  assert.equal(report.implementationHandoff.recommendations.length, 1);
});

test('citation auditor flags claims without evidence', () => {
  const audit = auditCitations({
    claims: [
      { claimId: 'c1', text: 'Verifier evidence is required.', evidence: ['src_1'] },
      { claimId: 'c2', text: 'Unsupported claim.', evidence: [] },
    ],
  });

  assert.equal(audit.verifiedCount, 1);
  assert.equal(audit.unverifiedClaims[0].claimId, 'c2');
});

test('report compiler emits markdown with source and recommendation sections', () => {
  const markdown = compileResearchReport({
    question: 'What should we build?',
    sourceMap: [{ sourceId: 'src_1', title: 'Plan', path: 'docs/plan.md' }],
    claimEvidenceTable: [{ claim: 'Use verifier loops.', evidence: ['src_1'] }],
    contradictions: [],
    implementationHandoff: { recommendations: ['Build verifier runner.'] },
  });

  assert.match(markdown, /## Source Map/);
  assert.match(markdown, /Build verifier runner/);
});

test('experiment manager proposals require approval before run commands', () => {
  const experiment = proposeExperiment({
    hypothesis: 'Verifier retries reduce false failures.',
    commands: ['npm test'],
    budget: { maxWallMinutes: 5 },
  });

  assert.match(experiment.experimentId, /^EXP/);
  assert.equal(experiment.status, 'approval_required');
  assert.equal(experiment.requiresApproval, true);
});

test('metric comparer reports metric deltas and noisy small changes', () => {
  const comparison = compareMetrics({
    baseline: { passRate: 0.7, cost: 1.0 },
    candidate: { passRate: 0.72, cost: 0.8 },
    noiseThreshold: 0.03,
  });

  assert.equal(comparison.deltas.passRate, 0.02);
  assert.equal(comparison.deltas.cost, -0.2);
  assert.equal(comparison.noisyMetrics.includes('passRate'), true);
});
