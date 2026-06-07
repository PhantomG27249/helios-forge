import { copyFile, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const MANIFEST_FILE = 'helios-package.json';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CAPABILITY_KINDS = [
  {
    manifestKey: 'skills',
    type: 'skill',
    defaultPath: (id) => path.join('skills', id, 'SKILL.md'),
  },
  {
    manifestKey: 'templates',
    type: 'template',
    defaultPath: (id) => path.join('templates', `${id}.md`),
  },
  {
    manifestKey: 'slashCommands',
    type: 'slash_command',
    defaultPath: (id) => path.join('slash-commands', `${id}.json`),
  },
  {
    manifestKey: 'piExtensions',
    type: 'pi_extension',
    defaultPath: (id) => path.join('extensions', `${id}.ts`),
  },
];

function requireValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function assertSafeId(id, label) {
  if (!SAFE_ID_PATTERN.test(id) || id.includes('..')) {
    throw new Error(`Unsafe ${label}: ${id}`);
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertNotGlobalPiPath(candidatePath) {
  const globalPiRoot = path.resolve(homedir(), '.pi');
  if (isInside(globalPiRoot, path.resolve(candidatePath))) {
    throw new Error('Package installer will not write to global Pi paths');
  }
}

async function realpathIfExists(candidatePath) {
  try {
    return await realpath(candidatePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveInside(root, relativePath, label) {
  const rawPath = requireValue(relativePath, `${label} path`);
  if (path.isAbsolute(rawPath) || rawPath.includes('\0')) {
    throw new Error(`${label} path points outside package root`);
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, rawPath);
  if (!isInside(resolvedRoot, resolvedPath)) {
    throw new Error(`${label} path points outside package root`);
  }
  return resolvedPath;
}

async function resolveDeclaredSourceFile({ packageRoot, relativePath, label }) {
  const sourcePath = resolveInside(packageRoot, relativePath, label);
  const sourceStat = await lstat(sourcePath);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`${label} path points outside package root`);
  }
  if (!sourceStat.isFile()) {
    throw new Error(`${label} path must reference a file`);
  }

  const realPackageRoot = await realpath(packageRoot);
  const realSourcePath = await realpath(sourcePath);
  if (!isInside(realPackageRoot, realSourcePath)) {
    throw new Error(`${label} path points outside package root`);
  }

  return sourcePath;
}

async function assertSafeInstallDestination({ workspaceRoot, installRoot }) {
  if (!isInside(workspaceRoot, installRoot)) {
    throw new Error('Unsafe package destination: install path must stay inside the workspace');
  }

  assertNotGlobalPiPath(workspaceRoot);
  assertNotGlobalPiPath(installRoot);

  const realWorkspaceRoot = await realpathIfExists(workspaceRoot);
  if (realWorkspaceRoot) {
    assertNotGlobalPiPath(realWorkspaceRoot);
  }

  const relativeInstallPath = path.relative(workspaceRoot, installRoot);
  const segments = relativeInstallPath.split(path.sep).filter(Boolean);
  let currentPath = workspaceRoot;

  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    let currentStat;
    try {
      currentStat = await lstat(currentPath);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }

    if (currentStat.isSymbolicLink()) {
      throw new Error('Unsafe package destination: package path contains a symlink');
    }

    const realCurrentPath = await realpath(currentPath);
    if (realWorkspaceRoot && !isInside(realWorkspaceRoot, realCurrentPath)) {
      throw new Error('Unsafe package destination: package path resolves outside the workspace');
    }
    assertNotGlobalPiPath(realCurrentPath);
  }
}

function deriveIdFromPath(entryPath) {
  const normalizedPath = String(entryPath).replace(/\\/g, '/');
  const basename = path.posix.basename(normalizedPath);
  if (basename.toLowerCase() === 'skill.md') {
    return path.posix.basename(path.posix.dirname(normalizedPath));
  }
  return basename.replace(/\.[^.]+$/, '');
}

function looksLikePath(value) {
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]+$/.test(value);
}

function normalizeEntry({ entry, kind }) {
  if (typeof entry === 'string') {
    const value = requireValue(entry, kind.type);
    const entryPath = looksLikePath(value) ? value : kind.defaultPath(value);
    const id = looksLikePath(value) ? deriveIdFromPath(value) : value;
    assertSafeId(id, `${kind.type} id`);
    return {
      id,
      name: id,
      relativePath: entryPath,
      manifestEntry: entry,
    };
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${kind.manifestKey} entries must be strings or objects`);
  }

  const explicitPath = entry.path || entry.file || entry.entrypoint;
  const id = requireValue(entry.id || (explicitPath ? deriveIdFromPath(explicitPath) : ''), `${kind.type} id`);
  assertSafeId(id, `${kind.type} id`);

  return {
    id,
    name: String(entry.name || id).trim(),
    relativePath: explicitPath || kind.defaultPath(id),
    manifestEntry: entry,
  };
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Package manifest must be a JSON object');
  }

  const id = requireValue(manifest.id, 'Package id');
  assertSafeId(id, 'package id');
  const name = requireValue(manifest.name, 'Package name');
  const version = requireValue(manifest.version, 'Package version');

  return {
    ...manifest,
    id,
    name,
    version,
    skills: Array.isArray(manifest.skills) ? manifest.skills : [],
    templates: Array.isArray(manifest.templates) ? manifest.templates : [],
    slashCommands: Array.isArray(manifest.slashCommands) ? manifest.slashCommands : [],
    piExtensions: Array.isArray(manifest.piExtensions) ? manifest.piExtensions : [],
  };
}

async function readManifest(packageRoot) {
  const manifestPath = path.join(packageRoot, MANIFEST_FILE);
  const rawManifest = await readFile(manifestPath, 'utf8');
  try {
    return normalizeManifest(JSON.parse(rawManifest));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid ${MANIFEST_FILE}: ${error.message}`);
    }
    throw error;
  }
}

async function normalizeDeclaredFiles({ manifest, packageRoot, installRoot }) {
  const declaredFiles = [];

  for (const kind of CAPABILITY_KINDS) {
    for (const entry of manifest[kind.manifestKey]) {
      const normalizedEntry = normalizeEntry({ entry, kind });
      const sourcePath = await resolveDeclaredSourceFile({
        packageRoot,
        relativePath: normalizedEntry.relativePath,
        label: kind.type,
      });

      const relativePath = path.relative(path.resolve(packageRoot), sourcePath);
      const installedPath = path.join(installRoot, relativePath);
      declaredFiles.push({
        ...normalizedEntry,
        type: kind.type,
        sourcePath,
        installedPath,
        relativePath,
      });
    }
  }

  return declaredFiles;
}

async function copyDeclaredFiles(files) {
  for (const file of files) {
    await mkdir(path.dirname(file.installedPath), { recursive: true });
    await copyFile(file.sourcePath, file.installedPath);
  }
}

function createPackageRecord({ manifest, installRoot, packageRoot, installedAt }) {
  return {
    id: `package:${manifest.id}`,
    type: 'package',
    packageId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    path: installRoot,
    sourcePath: packageRoot,
    installedAt,
  };
}

function createCapabilityRecords({ manifest, files }) {
  return files.map((file) => {
    const record = {
      id: `${manifest.id}:${file.type}:${file.id}`,
      type: file.type,
      capabilityId: file.id,
      packageId: manifest.id,
      packageName: manifest.name,
      packageVersion: manifest.version,
      name: file.name,
      enabled: file.manifestEntry?.enabled !== false,
      path: file.installedPath,
      pathOrCommandOrUrl: file.installedPath,
      sourcePath: file.sourcePath,
      approvalMode: file.manifestEntry?.approvalMode || 'inherit',
      manifestEntry: file.manifestEntry,
    };

    if (file.type === 'pi_extension') {
      record.folder = path.dirname(file.installedPath);
    }

    return record;
  });
}

export async function installPiPackage({ workspaceRoot, packageRoot, now = () => new Date().toISOString() } = {}) {
  const resolvedWorkspaceRoot = path.resolve(requireValue(workspaceRoot, 'workspaceRoot'));
  const resolvedPackageRoot = path.resolve(requireValue(packageRoot, 'packageRoot'));
  const manifest = await readManifest(resolvedPackageRoot);
  const installRoot = path.join(resolvedWorkspaceRoot, '.harness', 'packages', manifest.id);

  await assertSafeInstallDestination({
    workspaceRoot: resolvedWorkspaceRoot,
    installRoot,
  });

  const declaredFiles = await normalizeDeclaredFiles({
    manifest,
    packageRoot: resolvedPackageRoot,
    installRoot,
  });

  await rm(installRoot, { recursive: true, force: true });
  await mkdir(installRoot, { recursive: true });
  await copyDeclaredFiles(declaredFiles);

  const installedAt = now();
  const packageRecord = createPackageRecord({
    manifest,
    installRoot,
    packageRoot: resolvedPackageRoot,
    installedAt,
  });
  const capabilities = createCapabilityRecords({ manifest, files: declaredFiles });

  return {
    packageRecord,
    capabilities,
    installRoot,
    manifest,
  };
}
