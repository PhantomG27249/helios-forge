import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { captureBrowserPreview } from './browserPreviewCapture.js';
import { runOcrWorker } from './ocrWorker.js';
import { createPdfPageArtifacts } from './pdfRenderer.js';
import { capturePdfPages } from './pdfPageWorker.js';
import { createScreenshotArtifact } from './screenshotTool.js';
import { createVisualDiffArtifact } from './visualDiff.js';
import { captureVisualDiff } from './visualDiffWorker.js';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

function resolveInsideWorkspace({ workspaceRoot, targetPath, label }) {
  const resolved = path.resolve(workspaceRoot, targetPath || '');
  if (!isUnderRoot(workspaceRoot, resolved)) {
    throw new Error(`${label} must stay inside workspace`);
  }
  return resolved;
}

async function emitMaybe(emitEvent, event) {
  if (typeof emitEvent === 'function') {
    await emitEvent(event);
  }
}

function normalizePageResult(result = {}) {
  if (Array.isArray(result)) {
    return { document: {}, pages: result };
  }
  return {
    document: result.document || {},
    pages: Array.isArray(result.pages) ? result.pages : [],
  };
}

function defaultOutputDir(taskId) {
  return path.join('.harness', 'visual', taskId);
}

function createDefaultWorkerAdapter({ workspaceRoot, workerRuntimes = {}, maxOcrMetadataTextLength }) {
  return {
    screenshot: ({ url, outputPath, taskId }) => captureBrowserPreview({
      taskId,
      workspaceRoot,
      url,
      outputPath,
      browserRuntime: workerRuntimes.browserRuntime,
    }),
    ocr: ({ imagePath, taskId }) => runOcrWorker({
      taskId,
      workspaceRoot,
      imagePath,
      ocrRuntime: workerRuntimes.ocrRuntime,
      maxMetadataTextLength: maxOcrMetadataTextLength,
    }),
    pdfPages: ({ pdfPath, outputDir, taskId }) => capturePdfPages({
      taskId,
      workspaceRoot,
      pdfPath,
      outputDir,
      pdfRuntime: workerRuntimes.pdfRuntime,
    }),
    visualDiff: ({ beforePath, afterPath, outputPath, taskId }) => captureVisualDiff({
      taskId,
      workspaceRoot,
      beforePath,
      afterPath,
      outputPath,
      diffRuntime: workerRuntimes.visualDiffRuntime,
    }),
  };
}

function isUnavailable(result) {
  return result?.status === 'unavailable';
}

export async function captureProductionVisualArtifacts({
  taskId,
  workspaceRoot,
  targetUrl,
  pdfPath,
  beforePath,
  afterPath,
  outputDir,
  captureAdapter,
  workerRuntimes = {},
  maxOcrMetadataTextLength = 2048,
  emitEvent,
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const resolvedOutputDir = resolveInsideWorkspace({
    workspaceRoot,
    targetPath: outputDir || defaultOutputDir(taskId),
    label: 'outputDir',
  });
  await mkdir(resolvedOutputDir, { recursive: true });
  const activeCaptureAdapter = captureAdapter ?? createDefaultWorkerAdapter({
    workspaceRoot,
    workerRuntimes,
    maxOcrMetadataTextLength,
  });

  const artifacts = {
    screenshot: null,
    pdfPages: [],
    visualDiff: null,
  };
  const skipped = [];
  let ocr = null;

  if (targetUrl) {
    if (typeof activeCaptureAdapter.screenshot === 'function') {
      const outputPath = path.join(resolvedOutputDir, 'web-preview.png');
      const captured = await activeCaptureAdapter.screenshot({ url: targetUrl, outputPath, taskId });
      if (isUnavailable(captured)) {
        skipped.push({ kind: 'screenshot', reason: captured.reason });
      } else {
        const imagePath = captured?.imagePath || outputPath;
        artifacts.screenshot = createScreenshotArtifact({
          taskId,
          imagePath,
          viewport: {
            width: captured?.width || captured?.viewport?.width || 0,
            height: captured?.height || captured?.viewport?.height || 0,
          },
          source: { type: 'web_preview', url: targetUrl },
          summary: `Production web preview screenshot for ${targetUrl}`,
        });
        await emitMaybe(emitEvent, {
          type: 'vlm.production_screenshot_captured',
          taskId,
          artifactId: artifacts.screenshot.artifactId,
          imagePath,
          width: artifacts.screenshot.metadata.viewport.width,
          height: artifacts.screenshot.metadata.viewport.height,
        });

        if (typeof activeCaptureAdapter.ocr === 'function') {
          ocr = await activeCaptureAdapter.ocr({ imagePath, taskId });
          if (isUnavailable(ocr)) {
            skipped.push({ kind: 'ocr', reason: ocr.reason });
          } else {
            const metadataText = Object.hasOwn(ocr || {}, 'metadataText')
              ? String(ocr.metadataText || '')
              : String(ocr?.text || '').slice(0, maxOcrMetadataTextLength);
            artifacts.screenshot.metadata = {
              ...artifacts.screenshot.metadata,
              ocrText: metadataText,
              ocrConfidence: ocr?.confidence,
              ocrTextTruncated: Boolean(ocr?.truncated),
            };
            await emitMaybe(emitEvent, {
              type: 'vlm.production_ocr_completed',
              taskId,
              sourceArtifactId: artifacts.screenshot.artifactId,
              textLength: String(ocr?.text || '').length,
              metadataTextLength: metadataText.length,
              confidence: ocr?.confidence,
            });
          }
        }
      }
    } else {
      skipped.push({ kind: 'screenshot', reason: 'adapter_missing' });
    }
  }

  if (pdfPath) {
    if (typeof activeCaptureAdapter.pdfPages === 'function') {
      const rawPageResult = await activeCaptureAdapter.pdfPages({
        pdfPath,
        outputDir: resolvedOutputDir,
        taskId,
      });
      if (isUnavailable(rawPageResult)) {
        skipped.push({ kind: 'pdf_pages', reason: rawPageResult.reason });
      } else {
        const pageResult = normalizePageResult(rawPageResult);
        artifacts.pdfPages = createPdfPageArtifacts({
          taskId,
          pdfPath,
          document: pageResult.document,
          pages: pageResult.pages,
        });
        await emitMaybe(emitEvent, {
          type: 'vlm.production_pdf_pages_captured',
          taskId,
          pdfPath,
          pageCount: artifacts.pdfPages.length,
          artifactIds: artifacts.pdfPages.map((artifact) => artifact.artifactId),
        });
      }
    } else {
      skipped.push({ kind: 'pdf_pages', reason: 'adapter_missing' });
    }
  }

  if (beforePath && afterPath) {
    if (typeof activeCaptureAdapter.visualDiff === 'function') {
      const outputPath = path.join(resolvedOutputDir, 'visual-diff.png');
      const diffResult = await activeCaptureAdapter.visualDiff({
        beforePath,
        afterPath,
        outputPath,
        taskId,
      });
      if (isUnavailable(diffResult)) {
        skipped.push({ kind: 'visual_diff', reason: diffResult.reason });
      } else {
        artifacts.visualDiff = createVisualDiffArtifact({
          taskId,
          beforePath,
          afterPath,
          diffPath: diffResult?.diffPath || outputPath,
          summary: diffResult?.summary || 'Production visual diff captured.',
        });
        await emitMaybe(emitEvent, {
          type: 'vlm.production_visual_diff_captured',
          taskId,
          artifactId: artifacts.visualDiff.artifactId,
          diffPath: artifacts.visualDiff.artifacts.diff,
          summary: artifacts.visualDiff.summary,
        });
      }
    } else {
      skipped.push({ kind: 'visual_diff', reason: 'adapter_missing' });
    }
  }

  const result = {
    taskId,
    outputDir: resolvedOutputDir,
    artifacts,
    ocr,
    skipped,
  };
  await emitMaybe(emitEvent, {
    type: 'vlm.production_artifacts_created',
    taskId,
    outputDir: resolvedOutputDir,
    artifactIds: [
      artifacts.screenshot?.artifactId,
      ...artifacts.pdfPages.map((artifact) => artifact.artifactId),
      artifacts.visualDiff?.artifactId,
    ].filter(Boolean),
    skipped,
  });
  return result;
}
