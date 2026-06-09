import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const GLOBAL_SKILL_PATH_PATTERNS = [
  /[\\/]\.pi[\\/]agent[\\/]extensions/i,
  /[\\/]\.codex[\\/]skills/i,
  /[\\/]\.codex[\\/]superpowers[\\/]skills/i,
  /[\\/]\.claude[\\/]skills/i,
  /[\\/]AppData[\\/]Roaming[\\/]Claude/i,
];

function requireWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSafeId(id, label = 'id') {
  const value = String(id || '').trim();
  if (!SAFE_ID_PATTERN.test(value) || value.includes('..') || path.isAbsolute(value)) {
    throw new Error(`Unsafe id for ${label}: ${id || '(empty)'}`);
  }
  return value;
}

function isInsideWorkspace(workspaceRoot, candidatePath) {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideWorkspace(workspaceRoot, candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (!isInsideWorkspace(workspaceRoot, resolved)) {
    throw new Error(`Path points outside workspace: ${candidatePath}`);
  }
  return resolved;
}

function isGlobalSkillWriteReference(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\//g, path.sep);
  return GLOBAL_SKILL_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function assertNoGlobalWriteTargets(value, keyPath = []) {
  if (value === null || value === undefined) return;
  const key = keyPath.at(-1);
  if (typeof value === 'string') {
    const isProvenancePath = ['sourceSkillPath', 'sourcePath', 'path'].includes(key)
      && keyPath.some((part) => ['source', 'sourceSkill', 'metadata'].includes(part));
    if (!isProvenancePath && isGlobalSkillWriteReference(value)) {
      throw new Error(`Candidate references a global skill write target at ${keyPath.join('.')}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoGlobalWriteTargets(entry, [...keyPath, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoGlobalWriteTargets(childValue, [...keyPath, childKey]);
    }
  }
}

function candidateDir(workspaceRoot, candidateId) {
  return path.join(workspaceRoot, '.harness', 'meta', 'skill-candidates', assertSafeId(candidateId, 'candidateId'));
}

function snapshotDir(workspaceRoot, snapshotId) {
  return path.join(workspaceRoot, '.harness', 'meta', 'skill-snapshots', assertSafeId(snapshotId, 'snapshotId'));
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeCandidate({ workspaceRoot, candidate, skillPath }) {
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate is required');
  const candidateId = assertSafeId(candidate.candidateId, 'candidateId');
  assertNoGlobalWriteTargets(candidate, ['candidate']);

  return {
    candidateId,
    status: 'shadow_only',
    createdAt: candidate.createdAt || new Date().toISOString(),
    ...candidate,
    candidateId,
    status: 'shadow_only',
    skill: {
      ...(candidate.skill || {}),
      id: candidate.skill?.id || candidateId,
      name: candidate.skill?.name || candidateId,
      path: assertInsideWorkspace(workspaceRoot, skillPath),
    },
    source: {
      rhoCaseIds: [],
      traceIds: [],
      failureModes: [],
      ...(candidate.source || {}),
    },
    safety: {
      secretsScan: 'pending',
      pathScan: 'pending',
      licenseScan: 'pending',
      globalWrite: false,
      ...(candidate.safety || {}),
      globalWrite: false,
    },
    rollback: {
      installRecordId: null,
      packageId: null,
      ...(candidate.rollback || {}),
    },
  };
}

export async function writeSkillCandidate({
  workspaceRoot,
  candidate,
  skillMarkdown,
  evaluation,
} = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  if (typeof skillMarkdown !== 'string' || !skillMarkdown.trim()) {
    throw new Error('skillMarkdown is required');
  }
  const candidateId = assertSafeId(candidate?.candidateId, 'candidateId');
  const dir = assertInsideWorkspace(root, candidateDir(root, candidateId));
  const skillPath = path.join(dir, 'SKILL.md');
  const normalized = normalizeCandidate({ workspaceRoot: root, candidate, skillPath });

  await mkdir(dir, { recursive: true });
  await writeFile(skillPath, skillMarkdown, 'utf8');
  await writeFile(path.join(dir, 'candidate.json'), `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  if (evaluation !== undefined) {
    await writeSkillCandidateEvaluation({ workspaceRoot: root, candidateId, evaluation });
  }
  return normalized;
}

export async function readSkillCandidate({ workspaceRoot, candidateId } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const dir = assertInsideWorkspace(root, candidateDir(root, candidateId));
  const candidate = JSON.parse(await readFile(path.join(dir, 'candidate.json'), 'utf8'));
  const skillMarkdown = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
  const evaluation = await readJsonIfPresent(path.join(dir, 'evaluation.json'));
  return {
    ...candidate,
    skillMarkdown,
    ...(evaluation ? { evaluation } : {}),
  };
}

export async function listSkillCandidates({ workspaceRoot } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const baseDir = path.join(root, '.harness', 'meta', 'skill-candidates');
  let entries = [];
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const candidates = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    candidates.push(await readSkillCandidate({ workspaceRoot: root, candidateId: entry.name }));
  }
  return candidates;
}

export async function writeSkillCandidateEvaluation({ workspaceRoot, candidateId, evaluation } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const dir = assertInsideWorkspace(root, candidateDir(root, candidateId));
  await stat(path.join(dir, 'candidate.json'));
  const record = {
    evaluatedAt: new Date().toISOString(),
    ...(evaluation || {}),
  };
  await writeFile(path.join(dir, 'evaluation.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export async function writeSourceSkillSnapshot({ workspaceRoot, sourceSkill, skillMarkdown } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  if (!sourceSkill || typeof sourceSkill !== 'object') throw new Error('sourceSkill is required');
  if (typeof skillMarkdown !== 'string' || !skillMarkdown.trim()) {
    throw new Error('skillMarkdown is required');
  }
  const snapshotId = assertSafeId(sourceSkill.snapshotId || sourceSkill.snapshotId, 'snapshotId');
  const dir = assertInsideWorkspace(root, snapshotDir(root, snapshotId));
  const metadataPath = path.join(dir, 'snapshot.json');
  const existing = await readJsonIfPresent(metadataPath);
  if (existing) throw new Error(`Source skill snapshot ${snapshotId} already exists and is immutable`);

  const skillPath = path.join(dir, 'SKILL.md');
  const metadata = {
    snapshotId,
    name: sourceSkill.name || snapshotId,
    sourcePath: sourceSkill.path || sourceSkill.sourcePath || null,
    sourceLicense: sourceSkill.license || sourceSkill.sourceLicense || 'unknown',
    permission: sourceSkill.permission || 'snapshot_for_local_evaluation_only',
    provenance: sourceSkill.provenance || {},
    immutable: true,
    createdAt: sourceSkill.createdAt || new Date().toISOString(),
    path: skillPath,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(skillPath, skillMarkdown, 'utf8');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

export async function readSourceSkillSnapshot({ workspaceRoot, snapshotId } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const dir = assertInsideWorkspace(root, snapshotDir(root, snapshotId));
  const metadata = JSON.parse(await readFile(path.join(dir, 'snapshot.json'), 'utf8'));
  const skillMarkdown = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
  return {
    metadata,
    skillMarkdown,
  };
}
