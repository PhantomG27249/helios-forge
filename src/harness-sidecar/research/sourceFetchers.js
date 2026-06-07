import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

function isExternalSource(source) {
  return Boolean(source.url)
    || source.type === 'external'
    || source.type === 'web'
    || source.type === 'url';
}

function normalizeBaseSource(source, index) {
  const sourceId = source.sourceId || `src_${index + 1}`;
  const locator = source.locator || source.path || source.url || sourceId;

  return {
    sourceId,
    title: source.title || sourceId,
    locator,
    ...('path' in source ? { path: source.path } : {}),
    ...('url' in source ? { url: source.url } : {}),
  };
}

function approvalRequiredSource(source, index, reason = 'external_source_fetch_requested') {
  return {
    ...normalizeBaseSource(source, index),
    type: 'external',
    status: 'approval_required',
    requiresApproval: true,
    approval: {
      reason,
      locator: source.url || source.locator,
    },
  };
}

async function fetchExternalSource({ source, index, fetchAdapter }) {
  if (typeof fetchAdapter !== 'function') {
    return approvalRequiredSource(source, index, 'external_fetch_adapter_required');
  }

  const fetched = await fetchAdapter(source);
  const content = typeof fetched === 'string' ? fetched : fetched?.content;

  return {
    ...normalizeBaseSource(source, index),
    type: 'external',
    status: 'fetched',
    content,
    contentType: typeof fetched === 'string'
      ? 'text/plain'
      : fetched?.contentType || 'text/plain',
  };
}

async function fetchLocalFileSource({ source, index, workspaceRoot }) {
  const locator = source.locator || source.path;
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot || process.cwd());
  const filePath = path.isAbsolute(locator)
    ? locator
    : path.join(resolvedWorkspaceRoot, locator);
  const resolvedFilePath = path.resolve(filePath);
  const relativePath = path.relative(resolvedWorkspaceRoot, resolvedFilePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Local source path is outside workspace root: ${locator}`);
  }

  const realWorkspaceRoot = await realpath(resolvedWorkspaceRoot);
  const realFilePath = await realpath(resolvedFilePath);
  const realRelativePath = path.relative(realWorkspaceRoot, realFilePath);
  if (realRelativePath.startsWith('..') || path.isAbsolute(realRelativePath)) {
    throw new Error(`Local source path is outside workspace root: ${locator}`);
  }

  const content = await readFile(resolvedFilePath, 'utf8');

  return {
    ...normalizeBaseSource(source, index),
    type: 'local_file',
    status: 'fetched',
    content,
    contentType: source.contentType || 'text/plain',
  };
}

function fetchTextSource(source, index) {
  return {
    ...normalizeBaseSource(source, index),
    type: source.type === 'local' ? 'text' : source.type || 'text',
    status: 'fetched',
    content: source.text ?? source.content,
    contentType: source.contentType || 'text/plain',
  };
}

export async function fetchSources({
  sources = [],
  workspaceRoot = process.cwd(),
  approvedExternal = false,
  fetchAdapter,
} = {}) {
  const fetched = [];

  for (const [index, source] of sources.entries()) {
    if (isExternalSource(source)) {
      fetched.push(approvedExternal
        ? await fetchExternalSource({ source, index, fetchAdapter })
        : approvalRequiredSource(source, index));
      continue;
    }

    if (source.path || source.locator) {
      fetched.push(await fetchLocalFileSource({ source, index, workspaceRoot }));
      continue;
    }

    fetched.push(fetchTextSource(source, index));
  }

  return fetched;
}
