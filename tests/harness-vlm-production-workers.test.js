import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { captureBrowserPreview } from '../src/harness-sidecar/vlm/browserPreviewCapture.js';
import { captureProductionVisualArtifacts } from '../src/harness-sidecar/vlm/productionArtifactCapture.js';
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

test('browser preview worker denies external URLs before invoking runtime capture', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const captureCalls = [];
    const result = await captureBrowserPreview({
      taskId: 'task_browser_policy',
      workspaceRoot,
      url: 'https://example.com/private',
      browserRuntime: {
        capture: async (args) => {
          captureCalls.push(args);
          return {};
        },
      },
    });

    assert.equal(result.status, 'denied');
    assert.equal(result.kind, 'policy');
    assert.equal(result.reason, 'external_origin_not_allowlisted');
    assert.deepEqual(captureCalls, []);
  });
});

test('browser preview worker returns sanitized browser evidence from runtime capture', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const result = await captureBrowserPreview({
      taskId: 'task_browser_evidence',
      workspaceRoot,
      url: 'http://127.0.0.1:3777/',
      browserRuntime: {
        capture: async ({ outputPath }) => {
          await writeFile(outputPath, Buffer.from('png-bytes'));
          return {
            imagePath: outputPath,
            width: 800,
            height: 600,
            browserEvidence: {
              consoleErrors: [
                { type: 'error', text: 'Hydration failed', location: { url: 'http://127.0.0.1/app?token=secret' } },
              ],
              failedRequests: [
                {
                  url: 'http://user:pass@127.0.0.1:3777/api?token=secret',
                  method: 'POST',
                  status: 500,
                  requestHeaders: { Authorization: 'Bearer secret', Cookie: 'sid=secret', 'X-Trace-Id': 'trace-1' },
                  responseHeaders: { 'Set-Cookie': 'sid=next', 'Content-Type': 'application/json' },
                  requestBody: '{"password":"secret"}',
                  responseBody: '{"stack":"secret"}',
                },
              ],
              networkSummary: [
                {
                  url: 'http://127.0.0.1:3777/app?session=secret',
                  status: 200,
                  responseBody: '<html>raw</html>',
                  requestHeaders: { Cookie: 'sid=secret' },
                },
              ],
              domSnapshotPath: path.join(workspaceRoot, '.harness', 'visual', 'task_browser_evidence', 'dom.json'),
              domHtml: '<html><body>secret</body></html>',
            },
          };
        },
      },
    });

    assert.equal(result.status, 'captured');
    assert.equal(result.browserEvidence.consoleErrors.length, 1);
    assert.equal(result.browserEvidence.failedRequests[0].url, 'http://127.0.0.1:3777/api');
    assert.equal(result.browserEvidence.failedRequests[0].requestHeaders.Authorization, '[redacted]');
    assert.equal(result.browserEvidence.failedRequests[0].requestHeaders.Cookie, '[redacted]');
    assert.equal(result.browserEvidence.failedRequests[0].requestHeaders['X-Trace-Id'], 'trace-1');
    assert.equal(result.browserEvidence.failedRequests[0].responseHeaders['Set-Cookie'], '[redacted]');
    assert.equal(result.browserEvidence.networkSummary[0].url, 'http://127.0.0.1:3777/app');
    assert.equal(result.browserEvidence.domSnapshotPath, path.join(workspaceRoot, '.harness', 'visual', 'task_browser_evidence', 'dom.json'));
    const serialized = JSON.stringify(result.browserEvidence);
    assert.equal(serialized.includes('Bearer secret'), false);
    assert.equal(serialized.includes('sid=secret'), false);
    assert.equal(serialized.includes('password'), false);
    assert.equal(serialized.includes('<html>'), false);
  });
});

test('production visual capture denies external targetUrl before invoking screenshot adapter', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const screenshotCalls = [];
    const result = await captureProductionVisualArtifacts({
      taskId: 'task_production_policy',
      workspaceRoot,
      targetUrl: 'https://example.com/private',
      captureAdapter: {
        screenshot: async (args) => {
          screenshotCalls.push(args);
          return {};
        },
      },
    });

    assert.equal(result.artifacts.screenshot, null);
    assert.deepEqual(result.skipped, [{
      kind: 'screenshot',
      reason: 'external_origin_not_allowlisted',
    }]);
    assert.deepEqual(screenshotCalls, []);
  });
});

test('production visual capture attaches browser evidence metadata and emits evidence events', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const events = [];
    const result = await captureProductionVisualArtifacts({
      taskId: 'task_production_evidence',
      workspaceRoot,
      targetUrl: 'http://127.0.0.1:3777/?token=secret',
      emitEvent: (event) => events.push(event),
      captureAdapter: {
        screenshot: async ({ outputPath }) => {
          await writeFile(outputPath, Buffer.from('png-bytes'));
          return {
            imagePath: outputPath,
            width: 320,
            height: 240,
            browserEvidence: {
              consoleErrors: [{ text: 'ReferenceError: missingWidget' }],
              failedRequests: [
                {
                  url: 'http://127.0.0.1:3777/api?token=secret',
                  status: 503,
                  responseBody: 'raw failure body',
                  requestHeaders: { Authorization: 'Bearer secret' },
                },
              ],
              networkSummary: [{ url: 'http://127.0.0.1:3777/app?secret=1', status: 200 }],
              domSnapshotPath: path.join(workspaceRoot, '.harness', 'visual', 'task_production_evidence', 'dom.json'),
            },
          };
        },
      },
    });

    assert.equal(result.artifacts.screenshot.metadata.browserEvidence.consoleErrors.length, 1);
    assert.equal(result.artifacts.screenshot.metadata.browserEvidence.failedRequests[0].url, 'http://127.0.0.1:3777/api');
    assert.equal(result.artifacts.screenshot.metadata.browserEvidence.failedRequests[0].requestHeaders.Authorization, '[redacted]');
    assert.equal(
      result.artifacts.screenshot.metadata.browserEvidence.domSnapshotPath,
      path.join(workspaceRoot, '.harness', 'visual', 'task_production_evidence', 'dom.json'),
    );
    assert.equal(events.some((event) => event.type === 'vlm.production_browser_evidence_captured'), true);
    const serialized = JSON.stringify({ events, metadata: result.artifacts.screenshot.metadata.browserEvidence });
    assert.equal(serialized.includes('Bearer secret'), false);
    assert.equal(serialized.includes('raw failure body'), false);
    assert.equal(serialized.includes('secret=1'), false);
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
