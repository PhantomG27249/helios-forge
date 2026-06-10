import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSafeRunId(runId) {
  if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) {
    throw new Error(`Unsafe harness run id: ${runId || ''}`);
  }
  return runId;
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideRoot(root, target) {
  if (!isInsideRoot(root, target)) {
    throw new Error(`Harness run path escapes workspace: ${target}`);
  }
  return target;
}

function jsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function getHarnessRunRoot(workspaceRoot) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const runRoot = path.join(resolvedWorkspaceRoot, '.harness', 'meta', 'harness-runs');
  return assertInsideRoot(resolvedWorkspaceRoot, runRoot);
}

export async function createHarnessRun({
  workspaceRoot,
  runId,
  candidate = {},
  localAgentSummary = {},
  memoryProposals = [],
  sourcePatch = '',
  configPatch = '',
  evals = {},
  promotion = {},
  rollback = {},
  lineage = {},
  traceManifest = {},
  metricLineage = {},
  replayEvidence = {},
  sweep = {},
} = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const safeRunId = assertSafeRunId(runId);
  const runDir = assertInsideRoot(
    resolvedWorkspaceRoot,
    path.join(getHarnessRunRoot(resolvedWorkspaceRoot), safeRunId),
  );

  if (await pathExists(runDir)) {
    throw new Error(`Harness run already exists: ${safeRunId}`);
  }

  await mkdir(runDir, { recursive: true });

  const files = {
    candidate: path.join(runDir, 'candidate.json'),
    localAgentSummary: path.join(runDir, 'local-agent-summary.json'),
    memoryProposals: path.join(runDir, 'memory-proposals.json'),
    sourcePatch: path.join(runDir, 'source.patch'),
    configPatch: path.join(runDir, 'config.patch'),
    evals: path.join(runDir, 'evals.json'),
    promotion: path.join(runDir, 'promotion.json'),
    rollback: path.join(runDir, 'rollback.json'),
    lineage: path.join(runDir, 'lineage.json'),
    traceManifest: path.join(runDir, 'trace-manifest.json'),
    metricLineage: path.join(runDir, 'metric-lineage.json'),
    replayEvidence: path.join(runDir, 'replay-evidence.json'),
    sweep: path.join(runDir, 'sweep.json'),
  };

  for (const filePath of Object.values(files)) {
    assertInsideRoot(resolvedWorkspaceRoot, filePath);
  }

  await writeFile(files.candidate, jsonContent(normalizeObject(candidate)), 'utf8');
  await writeFile(files.localAgentSummary, jsonContent(normalizeObject(localAgentSummary)), 'utf8');
  await writeFile(files.memoryProposals, jsonContent(normalizeArray(memoryProposals)), 'utf8');
  await writeFile(files.sourcePatch, String(sourcePatch || ''), 'utf8');
  await writeFile(files.configPatch, String(configPatch || ''), 'utf8');
  await writeFile(files.evals, jsonContent(normalizeObject(evals)), 'utf8');
  await writeFile(files.promotion, jsonContent(normalizeObject(promotion)), 'utf8');
  await writeFile(files.rollback, jsonContent(normalizeObject(rollback)), 'utf8');
  await writeFile(files.lineage, jsonContent(normalizeObject(lineage)), 'utf8');
  await writeFile(files.traceManifest, jsonContent(normalizeObject(traceManifest)), 'utf8');
  await writeFile(files.metricLineage, jsonContent(normalizeObject(metricLineage)), 'utf8');
  await writeFile(files.replayEvidence, jsonContent(normalizeObject(replayEvidence)), 'utf8');
  await writeFile(files.sweep, jsonContent(normalizeObject(sweep)), 'utf8');

  return {
    schemaVersion: 1,
    runId: safeRunId,
    runDir,
    files,
  };
}
