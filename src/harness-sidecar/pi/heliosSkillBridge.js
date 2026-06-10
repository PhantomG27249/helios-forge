import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PACKAGE_ID = 'helios-research-harness';
const GENERATED_PACKAGE_ID = 'generated-skills';
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SOURCE_ORDER = {
  bundled_package: 0,
  runtime_mount: 1,
  capability_registry: 2,
  generated_skill_candidate: 3,
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDir, '..', '..', '..');

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSafeId(value) {
  const id = String(value || '').trim();
  return SAFE_ID_PATTERN.test(id) && !id.includes('..') && !path.isAbsolute(id);
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function shortDescription(markdown) {
  const lines = String(markdown || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const description = lines.find((line) => !line.startsWith('#')) || '';
  return description.length > 160 ? `${description.slice(0, 157)}...` : description;
}

function hashContent(content) {
  if (!content) return null;
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

function makeRelativePath(workspaceRoot, repoRoot, absolutePath) {
  const resolvedPath = path.resolve(absolutePath);
  const resolvedWorkspace = path.resolve(workspaceRoot);
  const resolvedRepo = path.resolve(repoRoot);
  if (isInside(resolvedWorkspace, resolvedPath)) return path.relative(resolvedWorkspace, resolvedPath);
  if (isInside(resolvedRepo, resolvedPath)) return path.relative(resolvedRepo, resolvedPath);
  return null;
}

function pushIgnored(diagnostics, entry, reason) {
  diagnostics.ignored.push({
    id: entry?.id || entry?.capabilityId || entry?.candidateId || null,
    name: entry?.name || entry?.skill?.name || null,
    reason,
  });
}

function normalizePackageSkillEntry(entry) {
  if (typeof entry === 'string') {
    return {
      id: entry,
      name: entry,
      relativePath: path.join('skills', entry, 'SKILL.md'),
      enabled: true,
    };
  }
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: String(entry.id || '').trim(),
    name: String(entry.name || entry.id || '').trim(),
    relativePath: String(entry.path || entry.file || entry.entrypoint || '').trim(),
    enabled: entry.enabled !== false,
  };
}

async function addInventorySkill({ inventory, seen, workspaceRoot, repoRoot, skill }) {
  if (seen.has(skill.id)) return;
  seen.add(skill.id);
  const markdown = skill.absolutePath ? await readTextIfPresent(skill.absolutePath) : '';
  inventory.skills.push({
    id: skill.id,
    name: skill.name || skill.id,
    source: skill.source,
    version: skill.version || null,
    hash: skill.hash ?? null,
    relativePath: skill.relativePath,
    enabled: true,
    description: skill.description ?? shortDescription(markdown),
  });
}

async function collectBundledPackageSkills({ workspaceRoot, repoRoot, diagnostics, inventory, seen }) {
  const packageRoot = path.join(repoRoot, 'packages', DEFAULT_PACKAGE_ID);
  const manifest = await readJsonIfPresent(path.join(packageRoot, 'helios-package.json'));
  if (!manifest) return;

  for (const rawEntry of Array.isArray(manifest.skills) ? manifest.skills : []) {
    const entry = normalizePackageSkillEntry(rawEntry);
    if (!entry || !isSafeId(entry.id)) {
      pushIgnored(diagnostics, entry || rawEntry, 'unsafe_id');
      continue;
    }
    if (!entry.enabled) {
      pushIgnored(diagnostics, { id: `${manifest.id}:skill:${entry.id}`, name: entry.name }, 'disabled_capability');
      continue;
    }
    if (!entry.relativePath || path.isAbsolute(entry.relativePath) || entry.relativePath.includes('\0')) {
      pushIgnored(diagnostics, { id: `${manifest.id}:skill:${entry.id}`, name: entry.name }, 'path_outside_package');
      continue;
    }

    const absolutePath = path.resolve(packageRoot, entry.relativePath);
    if (!isInside(path.resolve(packageRoot), absolutePath)) {
      pushIgnored(diagnostics, { id: `${manifest.id}:skill:${entry.id}`, name: entry.name }, 'path_outside_package');
      continue;
    }

    await addInventorySkill({
      inventory,
      seen,
      workspaceRoot,
      repoRoot,
      skill: {
        id: `${manifest.id}:skill:${entry.id}`,
        name: entry.name || entry.id,
        source: 'bundled_package',
        version: manifest.version || null,
        absolutePath,
        relativePath: makeRelativePath(workspaceRoot, repoRoot, absolutePath),
      },
    });
  }
}

async function collectCapabilitySkills({ workspaceRoot, repoRoot, filePath, source, diagnostics, inventory, seen }) {
  const registry = await readJsonIfPresent(filePath);
  for (const entry of Array.isArray(registry?.capabilities) ? registry.capabilities : []) {
    if (entry?.type !== 'skill') continue;
    const id = String(entry.id || '').trim();
    if (!isSafeId(id.replace(/:/g, '-'))) {
      pushIgnored(diagnostics, entry, 'unsafe_id');
      continue;
    }
    if (entry.enabled !== true) {
      pushIgnored(diagnostics, entry, 'disabled_capability');
      continue;
    }

    const rawPath = entry.path || entry.pathOrCommandOrUrl || entry.file;
    if (!rawPath) {
      pushIgnored(diagnostics, entry, 'missing_path');
      continue;
    }
    const absolutePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(workspaceRoot, rawPath);
    if (!isInside(path.resolve(workspaceRoot), absolutePath)) {
      pushIgnored(diagnostics, entry, 'path_outside_workspace');
      continue;
    }

    await addInventorySkill({
      inventory,
      seen,
      workspaceRoot,
      repoRoot,
      skill: {
        id,
        name: entry.name || entry.capabilityId || id,
        source,
        version: entry.packageVersion || entry.version || null,
        absolutePath,
        relativePath: makeRelativePath(workspaceRoot, repoRoot, absolutePath),
      },
    });
  }
}

async function collectGeneratedSkillCandidates({ workspaceRoot, repoRoot, diagnostics, inventory, seen }) {
  const candidatesRoot = path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates');
  let entries = [];
  try {
    entries = await readdir(candidatesRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = await readJsonIfPresent(path.join(candidatesRoot, entry.name, 'candidate.json'));
    if (!candidate) continue;
    if (candidate.status !== 'applied') {
      pushIgnored(diagnostics, candidate, 'generated_candidate_not_approved');
      continue;
    }
    const skillId = String(candidate.skill?.id || candidate.candidateId || '').trim();
    if (!isSafeId(skillId)) {
      pushIgnored(diagnostics, candidate, 'unsafe_id');
      continue;
    }
    const rawPath = candidate.skill?.path
      || path.join(workspaceRoot, '.harness', 'packages', GENERATED_PACKAGE_ID, 'skills', skillId, 'SKILL.md');
    const absolutePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(workspaceRoot, rawPath);
    const generatedRoot = path.join(workspaceRoot, '.harness', 'packages', GENERATED_PACKAGE_ID);
    if (!isInside(path.resolve(generatedRoot), absolutePath)) {
      pushIgnored(diagnostics, candidate, 'path_outside_workspace');
      continue;
    }

    const markdown = await readTextIfPresent(absolutePath);
    await addInventorySkill({
      inventory,
      seen,
      workspaceRoot,
      repoRoot,
      skill: {
        id: candidate.rollback?.installRecordId || `${GENERATED_PACKAGE_ID}:skill:${skillId}`,
        name: candidate.skill?.name || skillId,
        source: 'generated_skill_candidate',
        version: candidate.version || null,
        hash: hashContent(markdown),
        absolutePath,
        relativePath: makeRelativePath(workspaceRoot, repoRoot, absolutePath),
        description: shortDescription(markdown),
      },
    });
  }
}

export async function buildHeliosSkillInventory({
  workspaceRoot,
  repoRoot = defaultRepoRoot,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const inventory = {
    workspaceRoot: resolvedWorkspaceRoot,
    skills: [],
    diagnostics: {
      ignored: [],
    },
  };
  const seen = new Set();

  await collectBundledPackageSkills({
    workspaceRoot: resolvedWorkspaceRoot,
    repoRoot: resolvedRepoRoot,
    diagnostics: inventory.diagnostics,
    inventory,
    seen,
  });
  await collectCapabilitySkills({
    workspaceRoot: resolvedWorkspaceRoot,
    repoRoot: resolvedRepoRoot,
    filePath: path.join(resolvedWorkspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'),
    source: 'runtime_mount',
    diagnostics: inventory.diagnostics,
    inventory,
    seen,
  });
  await collectCapabilitySkills({
    workspaceRoot: resolvedWorkspaceRoot,
    repoRoot: resolvedRepoRoot,
    filePath: path.join(resolvedWorkspaceRoot, '.harness', 'capabilities.json'),
    source: 'capability_registry',
    diagnostics: inventory.diagnostics,
    inventory,
    seen,
  });
  await collectGeneratedSkillCandidates({
    workspaceRoot: resolvedWorkspaceRoot,
    repoRoot: resolvedRepoRoot,
    diagnostics: inventory.diagnostics,
    inventory,
    seen,
  });

  inventory.skills.sort((a, b) => (
    (SOURCE_ORDER[a.source] ?? 99) - (SOURCE_ORDER[b.source] ?? 99)
    || a.id.localeCompare(b.id)
  ));
  return inventory;
}

export async function pathExists(filePath) {
  return exists(filePath);
}
