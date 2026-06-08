import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { captureBrowserPreview } from '../src/harness-sidecar/vlm/browserPreviewCapture.js';
import { runOcrWorker } from '../src/harness-sidecar/vlm/ocrWorker.js';
import { capturePdfPages } from '../src/harness-sidecar/vlm/pdfPageWorker.js';
import { captureVisualDiff } from '../src/harness-sidecar/vlm/visualDiffWorker.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-vlm-workers-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('browser preview worker reports unavailable without runtime', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureBrowserPreview({
      taskId: 'task_browser',
      workspaceRoot,
      url: 'http://127.0.0.1:3777/',
    });

    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'browser_runtime_required',
    });
  });
});

test('browser preview worker writes injected runtime output under visual task directory', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureBrowserPreview({
      taskId: 'task_browser',
      workspaceRoot,
      url: 'http://127.0.0.1:3777/',
      browserRuntime: {
        capture: async ({ url, outputPath }) => {
          await writeFile(outputPath, Buffer.from('png-bytes'));
          return { imagePath: outputPath, width: 640, height: 480, url };
        },
      },
    });

    assert.equal(result.status, 'captured');
    assert.equal(result.width, 640);
    assert.equal(result.height, 480);
    assert.equal(result.imagePath, path.join(workspaceRoot, '.harness', 'visual', 'task_browser', 'web-preview.png'));
    assert.equal(await readFile(result.imagePath, 'utf8'), 'png-bytes');
    assert.equal(JSON.stringify(result).includes('png-bytes'), false);
  });
});

test('visual workers reject artifact paths that escape the workspace', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    await assert.rejects(
      () => captureBrowserPreview({
        taskId: 'task_escape',
        workspaceRoot,
        url: 'http://127.0.0.1:3777/',
        outputPath: '../outside.png',
        browserRuntime: { capture: async () => ({}) },
      }),
      /must stay inside workspace/,
    );
  });
});

test('ocr worker limits returned metadata text and keeps binary content out of results', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const imagePath = path.join(workspaceRoot, '.harness', 'visual', 'task_ocr', 'web-preview.png');
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, Buffer.from('image-bytes'));

    const result = await runOcrWorker({
      taskId: 'task_ocr',
      workspaceRoot,
      imagePath,
      maxMetadataTextLength: 12,
      ocrRuntime: {
        recognize: async ({ imagePath }) => ({
          text: `full OCR text from ${path.basename(imagePath)}`,
          confidence: 0.88,
          rawImage: Buffer.from('image-bytes'),
        }),
      },
    });

    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'full OCR text from web-preview.png');
    assert.equal(result.metadataText, 'full OCR tex');
    assert.equal(result.truncated, true);
    assert.equal(result.confidence, 0.88);
    assert.equal(JSON.stringify(result).includes('image-bytes'), false);
  });
});

test('ocr worker reports unavailable without runtime', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await runOcrWorker({
      taskId: 'task_ocr',
      workspaceRoot,
      imagePath: path.join(workspaceRoot, '.harness', 'visual', 'task_ocr', 'web-preview.png'),
    });

    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'ocr_runtime_required',
    });
  });
});

test('pdf page worker writes injected runtime pages under visual task directory', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const pdfPath = path.join(workspaceRoot, 'docs', 'spec.pdf');
    await mkdir(path.dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, 'pdf');

    const result = await capturePdfPages({
      taskId: 'task_pdf',
      workspaceRoot,
      pdfPath,
      pdfRuntime: {
        renderPages: async ({ outputDir }) => {
          const imagePath = path.join(outputDir, 'page-1.png');
          await writeFile(imagePath, Buffer.from('page-bytes'));
          return {
            document: { title: 'Spec' },
            pages: [{ pageNumber: 1, imagePath, width: 816, height: 1056, textSnippet: 'Intro' }],
          };
        },
      },
    });

    assert.equal(result.status, 'captured');
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].imagePath, path.join(workspaceRoot, '.harness', 'visual', 'task_pdf', 'page-1.png'));
    assert.equal(JSON.stringify(result).includes('page-bytes'), false);
  });
});

test('pdf page worker reports unavailable without runtime', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await capturePdfPages({
      taskId: 'task_pdf',
      workspaceRoot,
      pdfPath: path.join(workspaceRoot, 'docs', 'spec.pdf'),
    });

    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'pdf_runtime_required',
    });
  });
});

test('visual diff worker writes injected runtime diff under visual task directory', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const beforePath = path.join(workspaceRoot, 'before.png');
    const afterPath = path.join(workspaceRoot, 'after.png');
    await writeFile(beforePath, 'before');
    await writeFile(afterPath, 'after');

    const result = await captureVisualDiff({
      taskId: 'task_diff',
      workspaceRoot,
      beforePath,
      afterPath,
      diffRuntime: {
        compare: async ({ outputPath }) => {
          await writeFile(outputPath, Buffer.from('diff-bytes'));
          return { diffPath: outputPath, changedPixels: 3, summary: 'three pixels changed' };
        },
      },
    });

    assert.equal(result.status, 'captured');
    assert.equal(result.diffPath, path.join(workspaceRoot, '.harness', 'visual', 'task_diff', 'visual-diff.png'));
    assert.equal(result.changedPixels, 3);
    assert.equal(result.summary, 'three pixels changed');
    assert.equal(JSON.stringify(result).includes('diff-bytes'), false);
  });
});

test('visual diff worker reports unavailable without runtime', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureVisualDiff({
      taskId: 'task_diff',
      workspaceRoot,
      beforePath: path.join(workspaceRoot, 'before.png'),
      afterPath: path.join(workspaceRoot, 'after.png'),
    });

    assert.deepEqual(result, {
      status: 'unavailable',
      reason: 'visual_diff_runtime_required',
    });
  });
});
