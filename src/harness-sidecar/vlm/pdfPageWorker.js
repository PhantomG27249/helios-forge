import { mkdir } from 'node:fs/promises';
import path from 'node:path';

function isUnderRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
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

export async function capturePdfPages({
  taskId,
  workspaceRoot,
  pdfPath,
  outputDir,
  pdfRuntime,
} = {}) {
  if (!pdfRuntime || typeof pdfRuntime.renderPages !== 'function') {
    return { status: 'unavailable', reason: 'pdf_runtime_required' };
  }
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }
  if (!taskId) {
    throw new Error('taskId is required');
  }

  const taskDir = path.join(workspaceRoot, '.harness', 'visual', taskId);
  const resolvedOutputDir = outputDir ? path.resolve(taskDir, outputDir) : taskDir;
  if (!isUnderRoot(taskDir, resolvedOutputDir)) {
    throw new Error('outputDir must stay inside .harness/visual task directory');
  }
  if (pdfPath && !isUnderRoot(workspaceRoot, pdfPath)) {
    throw new Error('pdfPath must stay inside workspace');
  }

  await mkdir(resolvedOutputDir, { recursive: true });
  const pageResult = normalizePageResult(await pdfRuntime.renderPages({
    pdfPath: pdfPath ? path.resolve(pdfPath) : pdfPath,
    outputDir: resolvedOutputDir,
    taskId,
  }));

  for (const page of pageResult.pages) {
    if (!isUnderRoot(taskDir, page.imagePath || '')) {
      throw new Error('page imagePath must stay inside .harness/visual task directory');
    }
  }

  return {
    status: 'captured',
    document: pageResult.document,
    pages: pageResult.pages.map((page) => ({
      pageNumber: page.pageNumber,
      imagePath: path.resolve(page.imagePath),
      width: page.width || 0,
      height: page.height || 0,
      textSnippet: page.textSnippet,
    })),
  };
}
