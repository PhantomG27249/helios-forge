import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';

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

function estimateTokens(text) {
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function indexWorkspace({ workspaceRoot, maxFileBytes = 64 * 1024 }) {
  const items = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
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
      if (fileStat.size > maxFileBytes) continue;

      const content = await readFile(absolutePath, 'utf8');
      const snippet = content.slice(0, 1200);
      items.push({
        type: 'file_snippet',
        path: relativePath,
        extension,
        sizeBytes: fileStat.size,
        snippet,
        tokensEstimated: estimateTokens(snippet),
      });
    }
  }

  await walk(workspaceRoot);
  items.sort((a, b) => a.path.localeCompare(b.path));
  return {
    workspaceRoot,
    indexedAt: new Date().toISOString(),
    items,
  };
}
