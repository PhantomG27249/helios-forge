import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createScreenshotArtifact } from '../src/harness-sidecar/vlm/screenshotTool.js';
import { createPdfPageArtifacts } from '../src/harness-sidecar/vlm/pdfRenderer.js';
import { createFigureCropArtifact } from '../src/harness-sidecar/vlm/figureCropper.js';
import { analyzePlot } from '../src/harness-sidecar/vlm/plotAnalyzer.js';
import { interpretDiagram } from '../src/harness-sidecar/vlm/diagramInterpreter.js';
import { createVisualContextItem } from '../src/harness-sidecar/vlm/visualContextPolicy.js';

test('screenshot artifacts are deterministic manifests with viewport context estimates', () => {
  const input = {
    taskId: 'task-vlm',
    imagePath: '.harness/artifacts/home.png',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    source: { kind: 'existing_image', path: 'public/home.png' },
  };

  const first = createScreenshotArtifact(input);
  const second = createScreenshotArtifact(input);

  assert.deepEqual(first, second);
  assert.equal(first.type, 'screenshot');
  assert.match(first.artifactId, /^screenshot_[a-f0-9]{12}$/);
  assert.deepEqual(first.artifacts, { image: '.harness/artifacts/home.png' });
  assert.deepEqual(first.metadata.viewport, { width: 1440, height: 900, deviceScaleFactor: 1 });
  assert.equal(first.visualContext.imageCount, 1);
  assert.equal(first.visualContext.pixelCount, 1296000);
  assert.equal(first.visualContext.tokensEstimated, 1296);

  const contextItem = createVisualContextItem(first);
  assert.equal(contextItem.tokensEstimated, 1296);
  assert.equal(contextItem.reason, first.summary);
});

test('pdf renderer creates deterministic page artifact manifests from supplied page images', () => {
  const pages = createPdfPageArtifacts({
    taskId: 'task-pdf',
    pdfPath: 'docs/spec.pdf',
    document: { title: 'Spec', pageCount: 2 },
    pages: [
      { pageNumber: 1, imagePath: '.harness/pdf/spec-1.png', width: 816, height: 1056, textSnippet: 'Intro' },
      { pageNumber: 2, imagePath: '.harness/pdf/spec-2.png', width: 816, height: 1056, textSnippet: 'Diagram' },
    ],
  });

  assert.equal(pages.length, 2);
  assert.deepEqual(pages, createPdfPageArtifacts({
    taskId: 'task-pdf',
    pdfPath: 'docs/spec.pdf',
    document: { title: 'Spec', pageCount: 2 },
    pages: [
      { pageNumber: 1, imagePath: '.harness/pdf/spec-1.png', width: 816, height: 1056, textSnippet: 'Intro' },
      { pageNumber: 2, imagePath: '.harness/pdf/spec-2.png', width: 816, height: 1056, textSnippet: 'Diagram' },
    ],
  }));
  assert.match(pages[0].artifactId, /^pdf_page_[a-f0-9]{12}$/);
  assert.match(pages[1].artifactId, /^pdf_page_[a-f0-9]{12}$/);
  assert.notEqual(pages[0].artifactId, pages[1].artifactId);
  assert.equal(pages[0].type, 'pdf_page');
  assert.deepEqual(pages[0].artifacts, { image: '.harness/pdf/spec-1.png', pdf: 'docs/spec.pdf' });
  assert.deepEqual(pages[0].metadata.page, { pageNumber: 1, width: 816, height: 1056, textSnippet: 'Intro' });
  assert.equal(pages[0].visualContext.tokensEstimated, 862);
  assert.equal(pages[1].metadata.document.title, 'Spec');
});

test('figure cropper records source bounds and target path metadata', () => {
  const crop = createFigureCropArtifact({
    taskId: 'task-crop',
    sourceArtifactId: 'screenshot_abc',
    sourcePath: '.harness/artifacts/home.png',
    targetPath: '.harness/artifacts/home-chart-crop.png',
    bounds: { x: 120, y: 80, width: 640, height: 360 },
    sourceDimensions: { width: 1440, height: 900 },
    label: 'revenue chart',
  });

  assert.equal(crop.type, 'figure_crop');
  assert.match(crop.artifactId, /^figure_crop_[a-f0-9]{12}$/);
  assert.deepEqual(crop.artifacts, {
    source: '.harness/artifacts/home.png',
    crop: '.harness/artifacts/home-chart-crop.png',
  });
  assert.deepEqual(crop.metadata.bounds, { x: 120, y: 80, width: 640, height: 360 });
  assert.equal(crop.metadata.sourceArtifactId, 'screenshot_abc');
  assert.equal(crop.visualContext.pixelCount, 230400);
  assert.equal(crop.visualContext.tokensEstimated, 230);
});

test('plot analyzer summarizes series and returns verifier-like evidence', () => {
  const input = {
    taskId: 'task-plot',
    plotId: 'latency-plot',
    title: 'Latency by build',
    series: [
      { name: 'baseline', points: [{ x: 1, y: 120 }, { x: 2, y: 110 }, { x: 3, y: 105 }] },
      { name: 'candidate', points: [{ x: 1, y: 118 }, { x: 2, y: 96 }, { x: 3, y: 84 }] },
    ],
    statistics: { yUnit: 'ms', threshold: 100 },
  };
  const analysis = analyzePlot(input);

  assert.deepEqual(analysis, analyzePlot(input));
  assert.equal(analysis.type, 'plot_analysis');
  assert.match(analysis.artifactId, /^plot_analysis_[a-f0-9]{12}$/);
  assert.equal(analysis.summary, 'Plot "Latency by build" has 2 series and 6 points.');
  assert.deepEqual(analysis.observations.seriesNames, ['baseline', 'candidate']);
  assert.deepEqual(analysis.observations.yRange, { min: 84, max: 120 });
  assert.equal(analysis.observations.trends.baseline.direction, 'decreasing');
  assert.equal(analysis.observations.trends.candidate.delta, -34);
  assert.equal(analysis.evidence.verifier, 'vlm.plot_analyzer');
  assert.equal(analysis.evidence.status, 'passed');
  assert.equal(analysis.evidence.metrics.seriesCount, 2);
  assert.equal(analysis.evidence.metrics.pointsAnalyzed, 6);
  assert.equal(analysis.visualContext.tokensEstimated, 220);
});

test('diagram interpreter structures nodes, edges, text, and verifier-like evidence', () => {
  const input = {
    taskId: 'task-diagram',
    diagramId: 'pipeline',
    nodes: [
      { id: 'input', label: 'Input', type: 'source' },
      { id: 'worker', label: 'Worker', type: 'process' },
      { id: 'output', label: 'Output', type: 'sink' },
    ],
    edges: [
      { from: 'input', to: 'worker', label: 'dispatches' },
      { from: 'worker', to: 'output', label: 'emits' },
    ],
    text: ['retry on failure', 'human approval gate'],
  };
  const interpretation = interpretDiagram(input);

  assert.deepEqual(interpretation, interpretDiagram(input));
  assert.equal(interpretation.type, 'diagram_interpretation');
  assert.match(interpretation.artifactId, /^diagram_interpretation_[a-f0-9]{12}$/);
  assert.equal(interpretation.summary, 'Diagram "pipeline" has 3 nodes, 2 edges, and 2 text annotations.');
  assert.deepEqual(interpretation.observations.nodeLabels, ['Input', 'Worker', 'Output']);
  assert.deepEqual(interpretation.observations.flows, ['Input -> Worker (dispatches)', 'Worker -> Output (emits)']);
  assert.deepEqual(interpretation.observations.textAnnotations, ['retry on failure', 'human approval gate']);
  assert.equal(interpretation.evidence.verifier, 'vlm.diagram_interpreter');
  assert.equal(interpretation.evidence.status, 'passed');
  assert.equal(interpretation.evidence.metrics.edgeCount, 2);
  assert.equal(interpretation.visualContext.tokensEstimated, 196);
});
