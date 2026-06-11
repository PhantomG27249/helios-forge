import {
  access,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { assertHarnessVariantDirectory } from './harnessVariantWorkspace.js';

const DEFAULT_ALLOWLIST = new Set(['node', 'npm', 'npx']);
const SKIP_ROOT_NAMES = new Set(['.git', '.harness', '.worktrees', 'node_modules']);
const DEFAULT_EXCLUDED_NAMES = new Set([
  ...SKIP_ROOT_NAMES,
  '.cache',
  '.next',
  'build',
  'coverage',
  'dist',
  'logs',
  'out',
  'temp',
  'tmp',
]);

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideRoot(root, target, label = 'path') {
  if (!isInsideRoot(root, target)) {
    throw new Error(`Source tree variant ${label} escapes workspace: ${target}`);
  }
  return target;
}

async function existingPathInfo(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoSymlinkAncestors({ root, target }) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  assertInsideRoot(resolvedRoot, resolvedTarget);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative) return;
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const info = await existingPathInfo(cursor);
    if (!info) return;
    if (info.isSymbolicLink()) {
      throw new Error(`Source tree variant path uses symlink or junction: ${cursor}`);
    }
  }
}

async function assertRealPathInsideRoot({ root, target }) {
  const rootReal = await realpath(root);
  const targetReal = await realpath(target);
  assertInsideRoot(rootReal, targetReal);
}

async function prepareSafeDirectory({ root, directory }) {
  await assertNoSymlinkAncestors({ root, target: directory });
  await mkdir(directory, { recursive: true });
  await assertNoSymlinkAncestors({ root, target: directory });
  await assertRealPathInsideRoot({ root, target: directory });
}

async function prepareSafeWriteTarget({ root, target }) {
  await prepareSafeDirectory({ root, directory: path.dirname(target) });
  await assertNoSymlinkAncestors({ root, target });
}

function assertRelativePath(filePath, label = 'path', options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error(`${label} is required`);
  }
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe ${label}: ${filePath}`);
  }
  const firstPart = normalized.split(path.sep).find(Boolean);
  if (DEFAULT_EXCLUDED_NAMES.has(firstPart) && !(options.allowHarnessArtifacts && firstPart === '.harness')) {
    throw new Error(`Unsafe ${label}: ${filePath}`);
  }
  return normalized;
}

function slashPath(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

function jsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, jsonContent(value && typeof value === 'object' ? value : {}), 'utf8');
}

async function updateManifest(variantRoot, updater) {
  const manifestPath = path.join(variantRoot, 'manifest.json');
  const manifest = await readJson(manifestPath);
  const nextManifest = updater({
    ...manifest,
    artifacts: {
      ...(manifest.artifacts || {}),
    },
    safeApply: {
      ...(manifest.safeApply || {}),
      evidenceOnly: true,
      authority: manifest.safeApply?.authority || 'advisory',
      activeWorkspaceMutation: false,
      promotionAuthority: false,
    },
  });
  await writeJson(manifestPath, nextManifest);
  return nextManifest;
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (DEFAULT_EXCLUDED_NAMES.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) {
      throw new Error(`Source tree variant source uses symlink or junction: ${fullPath}`);
    }
    if (info.isDirectory()) {
      files.push(...await listFiles(root, fullPath));
    } else if (info.isFile()) {
      files.push(slashPath(path.relative(root, fullPath)));
    }
  }
  return files;
}

async function copyTreeEntry({ workspaceRoot, sourcePath, destinationPath }) {
  await assertNoSymlinkAncestors({ root: workspaceRoot, target: sourcePath });
  const info = await existingPathInfo(sourcePath);
  if (!info) return [];
  if (info.isSymbolicLink()) {
    throw new Error(`Source tree variant source uses symlink or junction: ${sourcePath}`);
  }
  if (info.isDirectory()) {
    const copied = [];
    await prepareSafeDirectory({ root: workspaceRoot, directory: destinationPath });
    const entries = await readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      if (DEFAULT_EXCLUDED_NAMES.has(entry.name)) continue;
      copied.push(...await copyTreeEntry({
        workspaceRoot,
        sourcePath: path.join(sourcePath, entry.name),
        destinationPath: path.join(destinationPath, entry.name),
      }));
    }
    return copied;
  }
  if (!info.isFile()) return [];
  await prepareSafeWriteTarget({ root: workspaceRoot, target: destinationPath });
  await copyFile(sourcePath, destinationPath);
  return [slashPath(path.relative(path.dirname(destinationPath), destinationPath))];
}

async function copyRelativePath({ workspaceRoot, sourceTreeDir, relativePath }) {
  const safeRelativePath = assertRelativePath(relativePath);
  const sourcePath = assertInsideRoot(workspaceRoot, path.join(workspaceRoot, safeRelativePath), 'source path');
  const destinationPath = assertInsideRoot(workspaceRoot, path.join(sourceTreeDir, safeRelativePath), 'variant path');
  const before = await listFiles(sourceTreeDir).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  await copyTreeEntry({ workspaceRoot, sourcePath, destinationPath });
  const after = await listFiles(sourceTreeDir);
  const beforeSet = new Set(before);
  return after.filter((filePath) => !beforeSet.has(filePath)).sort();
}

async function listMaterializedRelativePath({ sourceTreeDir, relativePath }) {
  const safeRelativePath = assertRelativePath(relativePath);
  const targetPath = path.join(sourceTreeDir, safeRelativePath);
  const info = await existingPathInfo(targetPath);
  if (!info) return [];
  if (info.isSymbolicLink()) {
    throw new Error(`Source tree variant path uses symlink or junction: ${targetPath}`);
  }
  if (info.isFile()) return [slashPath(safeRelativePath)];
  if (info.isDirectory()) return listFiles(sourceTreeDir, targetPath);
  return [];
}

function uniquePaths(paths) {
  return [...new Set((paths || []).filter(Boolean))].sort();
}

async function defaultWorkspaceSourcePaths(workspaceRoot) {
  const entries = await readdir(workspaceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => !DEFAULT_EXCLUDED_NAMES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function normalizeCommand(command) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new Error('command is required');
  }
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    throw new Error(`Unsafe command: ${command}`);
  }
  return command;
}

function assertAllowlistedCommand(command, allowlist) {
  const safeCommand = normalizeCommand(command);
  if (!allowlist.has(safeCommand)) {
    throw new Error(`Command is not allowlisted: ${safeCommand}`);
  }
  return safeCommand;
}

function normalizeArgs(args = [], { workspaceRoot } = {}) {
  if (!Array.isArray(args)) throw new Error('args must be an array');
  const resolvedWorkspaceRoot = workspaceRoot
    ? path.resolve(workspaceRoot).replaceAll('/', '\\').toLowerCase()
    : null;
  return args.map((arg) => {
    const value = String(arg);
    const comparableValue = value.replaceAll('/', '\\').toLowerCase();
    const normalized = path.normalize(value);
    if (
      path.isAbsolute(value)
      || (resolvedWorkspaceRoot && comparableValue.includes(resolvedWorkspaceRoot))
      || normalized === '..'
      || normalized.startsWith(`..${path.sep}`)
      || value.includes('../')
      || value.includes('..\\')
    ) {
      throw new Error(`Unsafe command argument: ${value}`);
    }
    return value;
  });
}

function normalizeEnv(env = {}) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return {};
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)]));
}

async function copyArtifactFiles({
  workspaceRoot,
  sourceTreeDir,
  variantRoot,
  categoryRoot,
  relativePaths,
}) {
  const copied = [];
  for (const relativePath of uniquePaths(relativePaths)) {
    const safeRelativePath = assertRelativePath(relativePath, `${categoryRoot} artifact path`, {
      allowHarnessArtifacts: true,
    });
    const sourcePath = assertInsideRoot(sourceTreeDir, path.join(sourceTreeDir, safeRelativePath), 'artifact source');
    await assertNoSymlinkAncestors({ root: sourceTreeDir, target: sourcePath });
    const info = await existingPathInfo(sourcePath);
    if (!info) throw new Error(`Missing ${categoryRoot} artifact: ${relativePath}`);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Unsafe ${categoryRoot} artifact: ${relativePath}`);
    }
    const stripped = safeRelativePath.replace(/^\.harness[\\/]/, '');
    const destination = assertInsideRoot(
      workspaceRoot,
      path.join(variantRoot, 'variant-artifacts', stripped),
      'artifact destination',
    );
    await prepareSafeWriteTarget({ root: workspaceRoot, target: destination });
    await copyFile(sourcePath, destination);
    copied.push({
      path: slashPath(path.relative(variantRoot, destination)),
    });
  }
  return copied;
}

export function createSourceTreeVariantRunner({
  workspaceRoot,
  variantRoot,
  commandRunner,
} = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const resolvedVariantRoot = assertHarnessVariantDirectory({
    workspaceRoot: resolvedWorkspaceRoot,
    variantRoot,
  });
  const sourceTreeDir = assertInsideRoot(
    resolvedWorkspaceRoot,
    path.join(resolvedVariantRoot, 'source-tree'),
    'source tree',
  );
  const allowlist = DEFAULT_ALLOWLIST;

  async function prepareVariant({
    entrypoint,
    sourcePaths,
    configPaths = [],
  } = {}) {
    const safeEntrypoint = assertRelativePath(entrypoint, 'entrypoint');
    await assertNoSymlinkAncestors({ root: resolvedWorkspaceRoot, target: resolvedVariantRoot });
    await assertRealPathInsideRoot({ root: resolvedWorkspaceRoot, target: resolvedVariantRoot });
    if (await pathExists(sourceTreeDir)) {
      await assertNoSymlinkAncestors({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
      await assertRealPathInsideRoot({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
      await rm(sourceTreeDir, { recursive: true, force: true });
    }
    await prepareSafeDirectory({ root: resolvedWorkspaceRoot, directory: sourceTreeDir });

    const copiedSourceFiles = [];
    const sourceMaterializationPaths = sourcePaths === undefined
      ? await defaultWorkspaceSourcePaths(resolvedWorkspaceRoot)
      : sourcePaths;
    for (const sourcePath of uniquePaths([...sourceMaterializationPaths, safeEntrypoint])) {
      copiedSourceFiles.push(...await copyRelativePath({
        workspaceRoot: resolvedWorkspaceRoot,
        sourceTreeDir,
        relativePath: sourcePath,
      }));
    }
    const copiedConfigFiles = [];
    for (const configPath of uniquePaths(configPaths)) {
      await copyRelativePath({
        workspaceRoot: resolvedWorkspaceRoot,
        sourceTreeDir,
        relativePath: configPath,
      });
      copiedConfigFiles.push(...await listMaterializedRelativePath({
        sourceTreeDir,
        relativePath: configPath,
      }));
    }

    const sourceFiles = uniquePaths(copiedSourceFiles);
    const configFiles = uniquePaths(copiedConfigFiles);
    const sourceTreeManifest = {
      schemaVersion: 1,
      path: 'source-tree',
      entrypoint: slashPath(safeEntrypoint),
      sourceFiles: sourceFiles.map((filePath) => ({ path: filePath })),
      configFiles: configFiles.map((filePath) => ({ path: filePath })),
      activeWorkspaceMutation: false,
      evidenceOnly: true,
    };
    await writeJson(path.join(resolvedVariantRoot, 'source-tree-manifest.json'), sourceTreeManifest);
    const manifest = await updateManifest(resolvedVariantRoot, (current) => ({
      ...current,
      artifacts: {
        ...current.artifacts,
        sourceTree: {
          path: 'source-tree',
          manifest: 'source-tree-manifest.json',
          entrypoint: slashPath(safeEntrypoint),
          files: sourceTreeManifest.sourceFiles,
        },
        config: {
          ...(current.artifacts.config || {}),
          sourceTreeFiles: sourceTreeManifest.configFiles,
        },
      },
    }));
    return {
      schemaVersion: 1,
      variantRoot: resolvedVariantRoot,
      sourceTreeDir,
      entrypoint: slashPath(safeEntrypoint),
      manifest,
      sourceTreeManifest,
    };
  }

  async function runVariant({
    command,
    args = [],
    env = {},
    timeoutMs,
  } = {}) {
    if (typeof commandRunner !== 'function') {
      throw new Error('commandRunner is required');
    }
    const safeCommand = assertAllowlistedCommand(command, allowlist);
    const safeArgs = normalizeArgs(args, { workspaceRoot: resolvedWorkspaceRoot });
    await assertNoSymlinkAncestors({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
    await assertRealPathInsideRoot({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
    const result = await commandRunner({
      command: safeCommand,
      args: safeArgs,
      cwd: sourceTreeDir,
      env: normalizeEnv(env),
      timeoutMs,
      variantRoot: resolvedVariantRoot,
    });
    const runEvidence = {
      schemaVersion: 1,
      command: safeCommand,
      args: safeArgs,
      cwd: 'source-tree',
      result: {
        exitCode: Number(result?.exitCode ?? 0),
        stdout: String(result?.stdout || ''),
        stderr: String(result?.stderr || ''),
      },
      evidenceOnly: true,
      activeWorkspaceMutation: false,
    };
    await writeJson(path.join(resolvedVariantRoot, 'run-evidence.json'), runEvidence);
    const manifest = await updateManifest(resolvedVariantRoot, (current) => ({
      ...current,
      artifacts: {
        ...current.artifacts,
        run: { path: 'run-evidence.json' },
      },
    }));
    return {
      schemaVersion: 1,
      variantRoot: resolvedVariantRoot,
      sourceTreeDir,
      result: runEvidence.result,
      manifest,
    };
  }

  async function collectArtifacts({
    tracePaths = [],
    metricPaths = [],
    replayPaths = [],
  } = {}) {
    await assertNoSymlinkAncestors({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
    await assertRealPathInsideRoot({ root: resolvedWorkspaceRoot, target: sourceTreeDir });
    const sourceTreeManifest = await readJson(path.join(resolvedVariantRoot, 'source-tree-manifest.json'));
    const traceFiles = await copyArtifactFiles({
      workspaceRoot: resolvedWorkspaceRoot,
      sourceTreeDir,
      variantRoot: resolvedVariantRoot,
      categoryRoot: 'trace',
      relativePaths: tracePaths,
    });
    const metricFiles = await copyArtifactFiles({
      workspaceRoot: resolvedWorkspaceRoot,
      sourceTreeDir,
      variantRoot: resolvedVariantRoot,
      categoryRoot: 'metric',
      relativePaths: metricPaths,
    });
    const replayFiles = await copyArtifactFiles({
      workspaceRoot: resolvedWorkspaceRoot,
      sourceTreeDir,
      variantRoot: resolvedVariantRoot,
      categoryRoot: 'replay',
      relativePaths: replayPaths,
    });
    const artifacts = {
      source: {
        path: 'source-tree',
        files: (sourceTreeManifest.sourceFiles || []).map((file) => ({
          ...file,
          path: slashPath(path.join('source-tree', file.path)),
        })),
      },
      config: {
        files: (sourceTreeManifest.configFiles || []).map((file) => ({
          ...file,
          path: slashPath(path.join('source-tree', file.path)),
        })),
      },
      trace: {
        files: traceFiles,
      },
      metrics: {
        files: metricFiles,
      },
      replay: {
        files: replayFiles,
      },
    };
    const artifactManifest = {
      schemaVersion: 1,
      artifacts,
      evidenceOnly: true,
      activeWorkspaceMutation: false,
    };
    await writeJson(path.join(resolvedVariantRoot, 'variant-artifacts-manifest.json'), artifactManifest);
    const manifest = await updateManifest(resolvedVariantRoot, (current) => ({
      ...current,
      artifacts: {
        ...current.artifacts,
        sourceTreeArtifacts: { path: 'variant-artifacts-manifest.json' },
        source: artifacts.source.files,
        config: {
          ...(current.artifacts.config || {}),
          files: artifacts.config.files,
        },
        trace: {
          ...(current.artifacts.trace || {}),
          files: artifacts.trace.files,
        },
        metrics: {
          ...(current.artifacts.metrics || {}),
          files: artifacts.metrics.files,
        },
        replay: artifacts.replay,
      },
    }));
    return {
      schemaVersion: 1,
      variantRoot: resolvedVariantRoot,
      artifacts,
      manifest,
    };
  }

  return {
    prepareVariant,
    runVariant,
    collectArtifacts,
  };
}
