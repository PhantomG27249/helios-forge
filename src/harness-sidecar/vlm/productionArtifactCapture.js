import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { createPdfPageArtifacts } from './pdfRenderer.js';
import { createScreenshotArtifact } from './screenshotTool.js';
import { createVisualDiffArtifact } from './visualDiff.js';

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

export async function captureProductionVisualArtifacts({
  taskId,
  workspaceRoot,
  targetUrl,
  pdfPath,
  beforePath,
  afterPath,
  outputDir = '.harness/visual',
  captureAdapter = {},
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
    targetPath: outputDir,
    label: 'outputDir',
  });
  await mkdir(resolvedOutputDir, { recursive: true });

  const artifacts = {
    screenshot: null,
    pdfPages: [],
    visualDiff: null,
  };
  const skipped = [];
  let ocr = null;

  if (targetUrl) {
    if (typeof captureAdapter.screenshot === 'function') {
      const outputPath = path.join(resolvedOutputDir, 'web-preview.png');
      const captured = await captureAdapter.screenshot({ url: targetUrl, outputPath });
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

      if (typeof captureAdapter.ocr === 'function') {
        ocr = await captureAdapter.ocr({ imagePath, taskId });
        artifacts.screenshot.metadata = {
          ...artifacts.screenshot.metadata,
          ocrText: String(ocr?.text || ''),
          ocrConfidence: ocr?.confidence,
        };
        await emitMaybe(emitEvent, {
          type: 'vlm.production_ocr_completed',
          taskId,
          sourceArtifactId: artifacts.screenshot.artifactId,
          textLength: String(ocr?.text || '').length,
          confidence: ocr?.confidence,
        });
      }
    } else {
      skipped.push({ kind: 'screenshot', reason: 'adapter_missing' });
    }
  }

  if (pdfPath) {
    if (typeof captureAdapter.pdfPages === 'function') {
      const pageResult = normalizePageResult(await captureAdapter.pdfPages({
        pdfPath,
        outputDir: resolvedOutputDir,
        taskId,
      }));
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
    } else {
      skipped.push({ kind: 'pdf_pages', reason: 'adapter_missing' });
    }
  }

  if (beforePath && afterPath) {
    if (typeof captureAdapter.visualDiff === 'function') {
      const outputPath = path.join(resolvedOutputDir, 'visual-diff.png');
      const diffResult = await captureAdapter.visualDiff({
        beforePath,
        afterPath,
        outputPath,
        taskId,
      });
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
    } else {
      skipped.push({ kind: 'visual_diff', reason: 'adapter_missing' });
    }
  }

  return {
    taskId,
    outputDir: resolvedOutputDir,
    artifacts,
    ocr,
    skipped,
  };
}
