import { createHash } from 'crypto';
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';

import { chunkTextFile } from './chunker.js';
import {
  WORKSPACE_INDEX_VERSION,
  defaultWorkspaceIndexStorePath,
  loadWorkspaceIndexStore,
  saveWorkspaceIndexStore,
} from './workspaceIndexStore.js';

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
]);

const EXCLUDED_PREFIXES = [
  '.harness/traces',
  '.harness/worktrees',
  '.harness/artifacts',
  '.harness/storage',
];

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function shouldExclude(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sameStat(previousFile, fileStat) {
  return (
    previousFile
    && previousFile.sizeBytes === fileStat.size
    && previousFile.mtimeMs === fileStat.mtimeMs
  );
}

function canReuseChunks(previousFile, maxLinesPerChunk) {
  return (
    previousFile
    && previousFile.maxLinesPerChunk === maxLinesPerChunk
    && Array.isArray(previousFile.chunks)
  );
}

export async function indexWorkspace({
  workspaceRoot,
  maxFileBytes = 64 * 1024,
  maxLinesPerChunk = 80,
  indexStorePath = defaultWorkspaceIndexStorePath(workspaceRoot),
}) {
  const items = [];
  const previousStore = await loadWorkspaceIndexStore(indexStorePath);
  const files = {};
  let reusedFileCount = 0;
  let changedFileCount = 0;
  let skippedFileCount = 0;

  async function walk(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(workspaceRoot, absolutePath));

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || shouldExclude(relativePath)) continue;
        await walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || shouldExclude(relativePath)) continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) continue;

      const fileStat = await stat(absolutePath);
      if (fileStat.size > maxFileBytes) {
        skippedFileCount += 1;
        continue;
      }

      const previousFile = previousStore?.files?.[relativePath];
      if (sameStat(previousFile, fileStat) && canReuseChunks(previousFile, maxLinesPerChunk)) {
        items.push(...previousFile.chunks);
        files[relativePath] = {
          ...previousFile,
          reused: true,
        };
        reusedFileCount += 1;
        continue;
      }

      const content = await readFile(absolutePath, 'utf8');
      const fileContentHash = hashContent(content);
      if (
        previousFile?.contentHash === fileContentHash
        && canReuseChunks(previousFile, maxLinesPerChunk)
      ) {
        items.push(...previousFile.chunks);
        files[relativePath] = {
          ...previousFile,
          sizeBytes: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
          reused: true,
        };
        reusedFileCount += 1;
        continue;
      }

      const chunks = chunkTextFile({
        path: relativePath,
        content,
        maxLinesPerChunk,
      }).map((chunk) => ({
          ...chunk,
          extension,
          sizeBytes: fileStat.size,
        }));
      items.push(...chunks);
      files[relativePath] = {
        path: relativePath,
        extension,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        contentHash: fileContentHash,
        maxLinesPerChunk,
        chunks,
        reused: false,
      };
      changedFileCount += 1;
    }
  }

  await walk(workspaceRoot);
  items.sort((a, b) => a.path.localeCompare(b.path) || a.lineStart - b.lineStart);
  const indexedAt = new Date().toISOString();
  const store = {
    version: WORKSPACE_INDEX_VERSION,
    workspaceRoot,
    indexedAt,
    maxFileBytes,
    maxLinesPerChunk,
    files,
  };
  await saveWorkspaceIndexStore(indexStorePath, store);
  return {
    workspaceRoot,
    indexedAt,
    metadata: {
      version: WORKSPACE_INDEX_VERSION,
      indexStorePath,
      fileCount: Object.keys(files).length,
      itemCount: items.length,
      reusedFileCount,
      changedFileCount,
      skippedFileCount,
    },
    items,
  };
}
