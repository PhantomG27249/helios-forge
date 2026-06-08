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
    assert.equal(result.artifacts.screenshot.metadata.ocrText, undefined);
    assert.equal(result.artifacts.screenshot.metadata.ocrTextLength, 'OCR for web-preview.png'.length);
    assert.equal(result.artifacts.screenshot.metadata.ocrConfidence, 0.91);
    assert.equal(await readFile(result.artifacts.screenshot.artifacts.image, 'utf8'), 'screenshot:http://127.0.0.1:3777/');
    assert.equal(await readFile(result.artifacts.visualDiff.artifacts.diff, 'utf8'), 'diff');
    assert.deepEqual(result.skipped, []);
    assert.equal(events.some((event) => event.type === 'vlm.production_screenshot_captured'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_pdf_pages_captured'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_ocr_completed'), true);
    assert.equal(events.some((event) => event.type === 'vlm.production_visual_diff_captured'), true);
    assert.equal(JSON.stringify(events).includes('screenshot:http'), false);
    assert.equal(JSON.stringify(result.artifacts.screenshot.metadata).includes('OCR for'), false);
  });
});

test('production capture redacts private URL components from artifact metadata', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureProductionVisualArtifacts({
      taskId: 'task_redact_url',
      workspaceRoot,
      targetUrl: 'http://user:pass@127.0.0.1:3777/path?token=secret#frag',
      captureAdapter: {
        screenshot: async ({ outputPath }) => {
          await writeFile(outputPath, 'screenshot');
          return { imagePath: outputPath, width: 100, height: 100 };
        },
      },
    });

    const serialized = JSON.stringify(result.artifacts.screenshot);
    assert.equal(serialized.includes('user'), false);
    assert.equal(serialized.includes('pass'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('#frag'), false);
    assert.equal(result.artifacts.screenshot.metadata.source.url, 'http://127.0.0.1:3777/path');
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

test('default production workers return unavailable statuses without embedding binary payloads', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const result = await captureProductionVisualArtifacts({
      taskId: 'task_default',
      workspaceRoot,
      targetUrl: 'http://127.0.0.1:3777/',
      beforePath: path.join(workspaceRoot, 'before.png'),
      afterPath: path.join(workspaceRoot, 'after.png'),
      emitEvent: (event) => events.push(event),
    });

    assert.equal(result.outputDir, path.join(workspaceRoot, '.harness', 'visual', 'task_default'));
    assert.equal(result.artifacts.screenshot, null);
    assert.equal(result.artifacts.visualDiff, null);
    assert.deepEqual(result.skipped, [
      { kind: 'screenshot', reason: 'browser_runtime_required' },
      { kind: 'visual_diff', reason: 'visual_diff_runtime_required' },
    ]);
    assert.equal(events.some((event) => event.type === 'vlm.production_artifacts_created'), true);
    assert.equal(JSON.stringify(events).includes('PNG'), false);
  });
});

test('production capture uses injected worker runtimes and limits OCR metadata text', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const pdfPath = path.join(workspaceRoot, 'docs', 'spec.pdf');
    const beforePath = path.join(workspaceRoot, 'before.png');
    const afterPath = path.join(workspaceRoot, 'after.png');
    await mkdir(path.dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, 'pdf');
    await writeFile(beforePath, 'before');
    await writeFile(afterPath, 'after');

    const result = await captureProductionVisualArtifacts({
      taskId: 'task_workers',
      workspaceRoot,
      targetUrl: 'http://127.0.0.1:3777/',
      pdfPath,
      beforePath,
      afterPath,
      maxOcrMetadataTextLength: 8,
      emitEvent: (event) => events.push(event),
      workerRuntimes: {
        browserRuntime: {
          capture: async ({ outputPath }) => {
            await writeFile(outputPath, Buffer.from('PNGDATA'));
            return { imagePath: outputPath, width: 320, height: 200 };
          },
        },
        ocrRuntime: {
          recognize: async () => ({ text: 'text that should be trimmed', confidence: 0.77 }),
        },
        pdfRuntime: {
          renderPages: async ({ outputDir }) => {
            const imagePath = path.join(outputDir, 'page-1.png');
            await writeFile(imagePath, Buffer.from('PDFPAGE'));
            return { pages: [{ pageNumber: 1, imagePath, width: 100, height: 200, textSnippet: 'Page' }] };
          },
        },
        visualDiffRuntime: {
          compare: async ({ outputPath }) => {
            await writeFile(outputPath, Buffer.from('DIFFDATA'));
            return { diffPath: outputPath, summary: 'changed' };
          },
        },
      },
    });

    assert.equal(result.artifacts.screenshot.metadata.ocrText, undefined);
    assert.equal(result.artifacts.screenshot.metadata.ocrTextLength, 8);
    assert.equal(result.ocr.text, 'text that should be trimmed');
    assert.equal(result.artifacts.pdfPages.length, 1);
    assert.equal(result.artifacts.visualDiff.summary, 'changed');
    assert.equal(result.outputDir, path.join(workspaceRoot, '.harness', 'visual', 'task_workers'));
    assert.equal(JSON.stringify(events).includes('PNGDATA'), false);
    assert.equal(JSON.stringify(result).includes('PNGDATA'), false);
  });
});
