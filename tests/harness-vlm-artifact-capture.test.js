import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { captureProductionVisualArtifacts } from '../src/harness-sidecar/vlm/productionArtifactCapture.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-vlm-capture-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('captures web screenshot, OCR, PDF pages, and visual diff through injected adapters', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const beforePath = path.join(workspaceRoot, 'before.png');
    const afterPath = path.join(workspaceRoot, 'after.png');
    const pdfPath = path.join(workspaceRoot, 'docs', 'spec.pdf');
    await writeFile(beforePath, 'before');
    await writeFile(afterPath, 'after');
    await mkdir(path.dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, 'pdf');

    const result = await captureProductionVisualArtifacts({
      taskId: 'task_visual',
      workspaceRoot,
      targetUrl: 'http://127.0.0.1:3777/',
      pdfPath,
      beforePath,
      afterPath,
      outputDir: '.harness/visual/task_visual',
      emitEvent: (event) => events.push(event),
      captureAdapter: {
        screenshot: async ({ outputPath, url }) => {
          await writeFile(outputPath, `screenshot:${url}`);
          return { imagePath: outputPath, width: 1280, height: 720 };
        },
        pdfPages: async ({ outputDir }) => {
          const pagePath = path.join(outputDir, 'spec-page-1.png');
          await writeFile(pagePath, 'page');
          return {
            document: { title: 'Spec' },
            pages: [{ pageNumber: 1, imagePath: pagePath, width: 816, height: 1056, textSnippet: 'Intro' }],
          };
        },
        ocr: async ({ imagePath }) => ({ text: `OCR for ${path.basename(imagePath)}`, confidence: 0.91 }),
        visualDiff: async ({ outputPath }) => {
          await writeFile(outputPath, 'diff');
          return { diffPath: outputPath, summary: 'one pixel changed' };
        },
      },
    });

    assert.equal(result.artifacts.screenshot.type, 'screenshot');
    assert.equal(result.artifacts.pdfPages.length, 1);
    assert.equal(result.artifacts.visualDiff.type, 'visual_diff');
    assert.equal(result.ocr.text, 'OCR for web-preview.png');
    assert.equal(result.artifacts.screenshot.metadata.ocrText, 'OCR for web-preview.png');
    assert.equal(result.artifacts.screenshot.metadata.ocrConfidence, 0.91);
    assert.equal(await readFile(result.artifacts.screenshot.artifacts.image, 'utf8'), 'screenshot:http://127.0.0.1:3777/');
    assert.equal(await readFile(result.artifacts.visualDiff.artifacts.diff, 'utf8'), 'diff');
    assert.deepEqual(result.skipped, []);
    assert.equal(events.some((event) => event.type === 'vlm.production_screenshot_captured'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_pdf_pages_captured'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_ocr_completed'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_visual_diff_captured'), true);
    assert.equal(JSON.stringify(events).includes('screenshot:http'), false);
  });
});

test('rejects output directories that escape the workspace', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await assert.rejects(
      () => captureProductionVisualArtifacts({
        taskId: 'task_escape',
        workspaceRoot,
        targetUrl: 'http://127.0.0.1:3777/',
        outputDir: '../outside',
        captureAdapter: { screenshot: async () => ({}) },
      }),
      /must stay inside workspace/,
    );
  });
});

test('skips missing adapter capabilities without failing the whole capture', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureProductionVisualArtifacts({
      taskId: 'task_skip',
      workspaceRoot,
      targetUrl: 'http://127.0.0.1:3777/',
      beforePath: path.join(workspaceRoot, 'before.png'),
      afterPath: path.join(workspaceRoot, 'after.png'),
      outputDir: '.harness/visual/task_skip',
      captureAdapter: {},
    });

    assert.equal(result.artifacts.screenshot, null);
    assert.equal(result.artifacts.visualDiff, null);
    assert.deepEqual(result.skipped.map((item) => item.kind), ['screenshot', 'visual_diff']);
  });
});
