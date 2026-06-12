import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runVisualReplaySuite } from '../src/harness-sidecar/vlm/visualReplaySuite.js';

test('visual replay suite normalizes multimodal cases and blocks failed evidence from promotion', async () => {
  const report = await runVisualReplaySuite({
    suite: {
      suiteId: 'visual-prod',
      cases: [
        { caseId: 'ui', benchmarkKind: 'ui_regression', artifactHash: 'sha256:ui', artifactPath: '.harness/visual/ui/diff.png' },
        { caseId: 'pdf', artifactType: 'pdf_page', artifactHash: 'sha256:pdf', artifactPath: '.harness/visual/pdf/page.png' },
        { caseId: 'ocr', artifactType: 'screenshot', metadata: { ocrConfidence: 0.42 }, artifactHash: 'sha256:ocr', artifactPath: '.harness/visual/ocr/page.png' },
        { caseId: 'chart', artifactType: 'chart', artifactHash: 'sha256:chart', artifactPath: '.harness/visual/chart.png' },
        { caseId: 'diagram', artifactType: 'diagram', artifactHash: 'sha256:diagram', artifactPath: '.harness/visual/diagram.png' },
      ],
    },
    candidate: { candidateId: 'candidate-a' },
    caseRunner: async ({ visualCase }) => ({
      passed: ['ui_regression', 'chart', 'diagram'].includes(visualCase.benchmarkKind),
      score: visualCase.benchmarkKind === 'ocr' ? 0.38 : 0.82,
      confidence: visualCase.benchmarkKind === 'pdf' ? 0.44 : 0.79,
      artifactHash: visualCase.artifactHash,
      findings: [`result for ${visualCase.benchmarkKind}`],
    }),
    now: () => new Date('2026-06-12T12:00:00.000Z'),
  });

  assert.equal(report.suiteId, 'visual-prod');
  assert.equal(report.candidateId, 'candidate-a');
  assert.equal(report.visualEvidenceRequired, true);
  assert.equal(report.evidenceOnly, true);
  assert.equal(report.canPromote, false);
  assert.equal(report.summary.caseCount, 5);
  assert.equal(report.summary.failedEvidenceCount, 2);
  assert.equal(report.summary.passedEvidenceCount, 3);
  assert.equal(report.metrics.byKind.ui_regression.caseCount, 1);
  assert.equal(report.metrics.byKind.pdf.failedEvidenceCount, 1);
  assert.equal(report.metrics.byKind.ocr.failedEvidenceCount, 1);
  assert.equal(report.metrics.byKind.chart.averageScore, 0.82);
  assert.equal(report.metrics.byKind.diagram.averageConfidence, 0.79);
  assert.equal(report.hardCases.length, 2);
  assert.equal(report.hardCases.every((entry) => entry.visualEvidenceRequired === true), true);
  assert.equal(report.hardCases.every((entry) => entry.evidenceOnly === true), true);
  assert.equal(report.rhoCases.length, 2);
  assert.equal(report.besHardCases.length, 2);
});

test('visual replay suite rejects missing artifact hashes and redacts unsafe model-visible fields', async () => {
  await assert.rejects(
    () => runVisualReplaySuite({
      suite: { cases: [{ caseId: 'missing-hash', artifactType: 'chart', artifactPath: '.harness/visual/chart.png' }] },
      candidate: { candidateId: 'candidate' },
      caseRunner: async () => ({ passed: true }),
    }),
    /artifact hash is required/,
  );

  const report = await runVisualReplaySuite({
    suite: {
      suiteId: 'api_key=sk-suite-secret',
      cases: [{
        caseId: 'api_key=sk-case-secret',
        artifactType: 'chart',
        artifactHash: 'sha256:safe',
        artifactPath: 'C:\\Users\\jackj\\secret.png',
      }],
    },
    candidate: { candidateId: 'api_key=sk-candidate-secret' },
    caseRunner: async () => ({
      passed: false,
      score: 0.2,
      confidence: 0.3,
      findings: ['ghp_visual_finding_should_not_leak'],
    }),
  });
  const visible = JSON.stringify(report);

  assert.equal(visible.includes('sk-suite-secret'), false);
  assert.equal(visible.includes('sk-case-secret'), false);
  assert.equal(visible.includes('sk-candidate-secret'), false);
  assert.equal(visible.includes('ghp_visual_finding_should_not_leak'), false);
  assert.deepEqual(report.cases[0].artifactPaths, []);
  assert.equal(report.canPromote, false);
});
