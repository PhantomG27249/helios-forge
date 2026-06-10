import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { redactSecrets } from './agentCards.js';

function redactSecretText(value = '') {
  return String(value || '')
    .replace(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/g, '$1[redacted]')
    .replace(/(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9_-]+/g, '$1[redacted]')
    .replace(/(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9_-]+/gi, '$1[redacted]')
    .replace(/(^|[^A-Za-z0-9])bearer\s+[A-Za-z0-9._-]+/gi, '$1Bearer [redacted]')
    .replace(/\b(password|passwd|token|secret|credential|authorization|api[_-]?key|[A-Z0-9_]*API[_-]?KEY)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');
}

function sanitizeDurableState(value) {
  if (typeof value === 'string') return redactSecretText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDurableState(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(redactSecrets(value)).map(([key, nestedValue]) => [
        key,
        sanitizeDurableState(nestedValue),
      ]),
    );
  }
  return value;
}

function assertInsideRoot(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedTarget;
  }
  throw new Error('A2A durable store path escapes allowed root');
}

function isSymlinkOrJunction(stats) {
  return stats.isSymbolicLink();
}

function assertNoSymlinkAncestors(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const targetDirectory = dirname(resolvedTarget);
  const rootStats = lstatSync(resolvedRoot);
  if (isSymlinkOrJunction(rootStats)) {
    throw new Error('A2A durable store path uses symlink or junction');
  }

  const relativeDirectory = relative(resolvedRoot, targetDirectory);
  const parts = relativeDirectory
    ? relativeDirectory.split(/[\\/]+/).filter(Boolean)
    : [];
  let cursor = resolvedRoot;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    if (!existsSync(cursor)) break;
    const stats = lstatSync(cursor);
    if (isSymlinkOrJunction(stats)) {
      throw new Error('A2A durable store path uses symlink or junction');
    }
  }
}

function assertRealParentInsideRoot(root, target) {
  const rootReal = realpathSync(root);
  const parentReal = realpathSync(dirname(target));
  const rel = relative(rootReal, parentReal);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return;
  }
  throw new Error('A2A durable store path escapes allowed root');
}

export function createJsonFileA2ADurableStore({ path, root } = {}) {
  if (!path || typeof path !== 'string') {
    throw new Error('A2A durable store requires a file path');
  }
  const storePath = root ? assertInsideRoot(root, path) : path;

  return {
    load() {
      if (!existsSync(storePath)) return null;
      if (root) {
        assertNoSymlinkAncestors(root, storePath);
        assertRealParentInsideRoot(root, storePath);
      }
      const raw = readFileSync(storePath, 'utf8').trim();
      if (!raw) return null;
      return JSON.parse(raw);
    },

    save(state) {
      if (root) {
        mkdirSync(root, { recursive: true });
        assertNoSymlinkAncestors(root, storePath);
      }
      mkdirSync(dirname(storePath), { recursive: true });
      if (root) {
        assertRealParentInsideRoot(root, storePath);
      }
      const sanitizedState = sanitizeDurableState(state || {});
      const temporaryPath = `${storePath}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(sanitizedState, null, 2)}\n`, 'utf8');
      renameSync(temporaryPath, storePath);
      return sanitizedState;
    },
  };
}
