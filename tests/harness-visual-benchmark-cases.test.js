import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVisualBenchmarkCases,
  recommendBudgetAwareVlmRoute,
} from '../src/harness-sidecar/vlm/visualBenchmarkCases.js';
import { buildVisualEvidenceBundle } from '../src/harness-sidecar/vlm/visualEvidence.js';

test('visual benchmark cases cover OCR PDF diagram chart and UI regression evidence', () => {
  const cases = buildVisualBenchmarkCases({
    taskId: 'task_visual_benchmark',
    verifierResult: { score: 0.62, confidence: 0.58 },
    artifacts: [
      {
        artifactId: 'ocr-shot',
        type: 'screenshot',
        artifacts: { image: '.harness/visual/ocr.png' },
        metadata: { ocrConfidence: 0.41, ocrTextLength: 36 },
      },
      {
        artifactId: 'pdf-page',
        type: 'pdf_page',
        artifacts: { image: '.harness/visual/page-1.png' },
        visualContext: { tokensEstimated: 862 },
      },
      {
        artifactId: 'diagram',
        type: 'diagram',
        path: '.harness/visual/diagram.png',
      },
      {
        artifactId: 'chart',
        type: 'plot',
        path: '.harness/visual/chart.png',
        metadata: { chartType: 'line' },
      },
      {
        artifactId: 'diff',
        type: 'visual_diff',
        artifacts: { diff: '.harness/visual/diff.png' },
      },
    ],
  });

  assert.deepEqual(cases.map((visualCase) => visualCase.benchmarkKind), [
    'ocr',
    'pdf',
    'diagram',
    'chart',
    'ui_regression',
  ]);
  assert.equal(cases[0].confidenceSignals.ocrConfidence, 0.41);
  assert.equal(cases[0].confidenceSignals.lowConfidence, true);
  assert.equal(cases[1].budget.tokensEstimated, 862);
  assert.deepEqual(cases[4].expectedArtifactKinds, ['visual_diff']);
});

test('budget aware VLM route downshifts costly confident cases and escalates low confidence cases', () => {
  const [chartCase] = buildVisualBenchmarkCases({
    taskId: 'task_chart',
    verifierResult: { score: 0.93, confidence: 0.88 },
    artifacts: [{ artifactId: 'chart', type: 'plot', path: '.harness/chart.png' }],
  });
  const downshift = recommendBudgetAwareVlmRoute({
    visualCase: chartCase,
    budget: { pressure: 0.94, remainingVisionTokens: 900 },
  });

  assert.equal(downshift.decision, 'downshift');
  assert.deepEqual(downshift.route, ['chart', 'vlm_fast']);
  assert.equal(downshift.maxVisionTokens, 900);

  const [ocrCase] = buildVisualBenchmarkCases({
    taskId: 'task_ocr',
    verifierResult: { score: 0.31, confidence: 0.35 },
    artifacts: [{ artifactId: 'ocr', type: 'screenshot', metadata: { ocrConfidence: 0.2 } }],
  });
  const escalated = recommendBudgetAwareVlmRoute({
    visualCase: ocrCase,
    budget: { pressure: 0.2, remainingVisionTokens: 6000 },
  });

  assert.equal(escalated.decision, 'escalate');
  assert.equal(escalated.route.includes('vlm_high_accuracy'), true);
});

test('visual evidence bundle exposes benchmark cases and embeds them in RHO verifier cases', () => {
  const bundle = buildVisualEvidenceBundle({
    taskId: 'task_visual_cases',
    verifierResult: {
      name: 'visual.verifier',
      passed: false,
      score: 0.4,
      confidence: 0.37,
      artifacts: [
        {
          artifactId: 'page-1',
          type: 'pdf_page',
          artifacts: { image: '.harness/visual/page-1.png' },
          metadata: { ocrConfidence: 0.33 },
        },
      ],
    },
  });

  assert.equal(bundle.visualCases[0].benchmarkKind, 'pdf');
  assert.equal(bundle.visualCases[0].confidenceSignals.lowConfidence, true);
  assert.equal(bundle.rhoCases[0].verifierCase.visualCase.caseId, bundle.visualCases[0].caseId);
  assert.equal(bundle.rhoCases[0].verifierCase.visualCase.benchmarkKind, 'pdf');
});

test('visual evidence drops unsafe or secret-shaped artifact paths from benchmark and RHO surfaces', () => {
  const bundle = buildVisualEvidenceBundle({
    taskId: 'task_visual_unsafe_paths',
    verifierResult: {
      name: 'visual.verifier',
      passed: false,
      artifacts: [
        {
          artifactId: 'traversal',
          type: 'screenshot',
          path: '../outside/secret-sk-test.png',
        },
        {
          artifactId: 'absolute',
          type: 'plot',
          path: 'C:\\Users\\jackj\\secret-chart.png',
        },
        {
          artifactId: 'safe',
          type: 'visual_diff',
          artifacts: { diff: '.harness/visual/diff.png' },
        },
      ],
    },
  });

  assert.deepEqual(bundle.visualCases.map((visualCase) => visualCase.artifactPaths), [
    [],
    [],
    ['.harness/visual/diff.png'],
  ]);
  assert.equal(bundle.nodes[0].path, null);
  assert.equal(bundle.nodes[1].path, null);
  assert.equal(bundle.nodes[2].path, '.harness/visual/diff.png');
  assert.deepEqual(bundle.rhoCases[0].verifierCase.visualArtifacts, []);
  assert.deepEqual(bundle.rhoCases[2].verifierCase.visualArtifacts.map((artifact) => artifact.path), [
    '.harness/visual/diff.png',
  ]);
  assert.equal(JSON.stringify(bundle).includes('secret-sk-test'), false);
});
