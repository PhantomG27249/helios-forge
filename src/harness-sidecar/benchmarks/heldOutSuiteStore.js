import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { normalizeHeldOutSuite } from './heldOutSuiteSchema.js';

const DEFAULT_FS = {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSuiteId(id) {
  const suiteId = String(id || '').trim();
  if (!suiteId || !SAFE_ID_PATTERN.test(suiteId)) {
    throw new Error('suite id must contain only letters, numbers, underscores, or hyphens');
  }
  return suiteId;
}

function assertInsideRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }
  throw new Error('held-out suite store path escapes workspace root');
}

async function assertNoSymlinkAncestors({ fsImpl, root, target }) {
  if (typeof fsImpl.lstat !== 'function') return;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relativeDirectory = path.relative(resolvedRoot, path.dirname(resolvedTarget));
  const parts = relativeDirectory ? relativeDirectory.split(/[\\/]+/).filter(Boolean) : [];
  let cursor = resolvedRoot;

  for (const part of ['', ...parts]) {
    if (part) cursor = path.resolve(cursor, part);
    try {
      const stats = await fsImpl.lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error('held-out suite store path uses symlink or junction');
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertExistingAncestorsSafe({ fsImpl, root, target }) {
  if (typeof fsImpl.lstat !== 'function') return;
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relativeDirectory = path.relative(resolvedRoot, path.dirname(resolvedTarget));
  const parts = relativeDirectory ? relativeDirectory.split(/[\\/]+/).filter(Boolean) : [];
  let cursor = resolvedRoot;

  for (const part of ['', ...parts]) {
    if (part) cursor = path.resolve(cursor, part);
    try {
      const stats = await fsImpl.lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error('held-out suite store path uses symlink or junction');
      }
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertRealParentInsideRoot({ fsImpl, root, target }) {
  if (typeof fsImpl.realpath !== 'function') return;
  const rootReal = await fsImpl.realpath(root);
  const parentReal = await fsImpl.realpath(path.dirname(target));
  assertInsideRoot(rootReal, parentReal);
}

function suiteDirectory(workspaceRoot) {
  return path.join(workspaceRoot, '.harness', 'benchmarks', 'suites');
}

function suiteFilePath(workspaceRoot, id) {
  const root = assertWorkspaceRoot(workspaceRoot);
  const suiteId = assertSuiteId(id);
  const target = path.join(suiteDirectory(root), `${suiteId}.json`);
  return assertInsideRoot(suiteDirectory(root), target);
}

export function createHeldOutSuiteStore({ workspaceRoot, fsImpl = DEFAULT_FS } = {}) {
  const root = assertWorkspaceRoot(workspaceRoot);
  const suitesRoot = suiteDirectory(root);

  function suitePath(id) {
    return suiteFilePath(root, id);
  }

  async function saveSuite(suite) {
    const normalized = normalizeHeldOutSuite(suite);
    const filePath = suitePath(normalized.id);
    await assertExistingAncestorsSafe({ fsImpl, root, target: filePath });
    await fsImpl.mkdir(suitesRoot, { recursive: true });
    await assertNoSymlinkAncestors({ fsImpl, root, target: filePath });
    await assertRealParentInsideRoot({ fsImpl, root, target: filePath });
    await fsImpl.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
  }

  async function loadSuite(id) {
    const filePath = suitePath(id);
    await assertNoSymlinkAncestors({ fsImpl, root, target: filePath });
    const raw = await fsImpl.readFile(filePath, 'utf8');
    return normalizeHeldOutSuite(JSON.parse(raw));
  }

  async function listSuites() {
    let entries;
    try {
      await assertNoSymlinkAncestors({ fsImpl, root, target: path.join(suitesRoot, 'placeholder.json') });
      entries = await fsImpl.readdir(suitesRoot, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .sort();
    const suites = [];
    for (const id of files) {
      suites.push(await loadSuite(id));
    }
    return suites;
  }

  return {
    suitePath,
    saveSuite,
    loadSuite,
    listSuites,
  };
}
