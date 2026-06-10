import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { runHarnessExperiment } from './harnessExperimentRunner.js';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`Unsafe ${label}: ${value || ''}`);
  }
  return value;
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideRoot(root, target) {
  if (!isInsideRoot(root, target)) {
    throw new Error(`Harness variant path escapes workspace: ${target}`);
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
      throw new Error(`Harness variant path uses symlink or junction: ${cursor}`);
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
  const parent = path.dirname(target);
  await prepareSafeDirectory({ root, directory: parent });
  await assertNoSymlinkAncestors({ root, target });
}

function assertRelativeArtifactPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('artifact path is required');
  }
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe artifact path: ${filePath}`);
  }
  return normalized;
}

function jsonContent(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function candidateIdOf(candidate) {
  return assertSafeId(candidate?.candidateId, 'candidate id');
}

async function writeJsonArtifact(filePath, value) {
  await writeFile(filePath, jsonContent(normalizeObject(value)), 'utf8');
  return filePath;
}

export function getHarnessVariantRoot(workspaceRoot) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const variantRoot = path.join(resolvedWorkspaceRoot, '.harness', 'meta', 'harness-variants');
  return assertInsideRoot(resolvedWorkspaceRoot, variantRoot);
}

export async function createHarnessVariantWorkspace({
  workspaceRoot,
  cycleId,
  candidate = {},
  sourceFiles = {},
  config = {},
  traceManifest = {},
  metricManifest = {},
} = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const safeCycleId = assertSafeId(cycleId, 'cycle id');
  const safeCandidateId = candidateIdOf(candidate);
  const variantDir = assertInsideRoot(
    resolvedWorkspaceRoot,
    path.join(getHarnessVariantRoot(resolvedWorkspaceRoot), safeCycleId, safeCandidateId),
  );
  const sourceDir = assertInsideRoot(resolvedWorkspaceRoot, path.join(variantDir, 'src'));

  await prepareSafeDirectory({ root: resolvedWorkspaceRoot, directory: sourceDir });

  const sourceArtifacts = [];
  for (const [relativePath, content] of Object.entries(sourceFiles || {})) {
    const safeRelativePath = assertRelativeArtifactPath(relativePath);
    const destination = assertInsideRoot(resolvedWorkspaceRoot, path.join(sourceDir, safeRelativePath));
    await prepareSafeWriteTarget({ root: resolvedWorkspaceRoot, target: destination });
    await writeFile(destination, String(content || ''), 'utf8');
    sourceArtifacts.push({
      path: path.relative(variantDir, destination).replaceAll(path.sep, '/'),
    });
  }

  const files = {
    manifest: path.join(variantDir, 'manifest.json'),
    config: path.join(variantDir, 'config.json'),
    traceManifest: path.join(variantDir, 'trace-manifest.json'),
    metricManifest: path.join(variantDir, 'metric-manifest.json'),
  };

  for (const filePath of Object.values(files)) {
    assertInsideRoot(resolvedWorkspaceRoot, filePath);
    await prepareSafeWriteTarget({ root: resolvedWorkspaceRoot, target: filePath });
  }

  await writeJsonArtifact(files.config, config);
  await writeJsonArtifact(files.traceManifest, traceManifest);
  await writeJsonArtifact(files.metricManifest, metricManifest);

  const manifest = {
    schemaVersion: 1,
    cycleId: safeCycleId,
    variantId: safeCandidateId,
    candidate: {
      ...normalizeObject(candidate),
      candidateId: safeCandidateId,
    },
    safeApply: {
      evidenceOnly: true,
      authority: 'advisory',
      activeWorkspaceMutation: false,
      promotionAuthority: false,
    },
    artifacts: {
      source: sourceArtifacts,
      config: { path: 'config.json' },
      trace: { path: 'trace-manifest.json' },
      metrics: { path: 'metric-manifest.json' },
    },
  };
  await writeJsonArtifact(files.manifest, manifest);

  return {
    schemaVersion: 1,
    cycleId: safeCycleId,
    variantId: safeCandidateId,
    variantDir,
    files,
    manifest,
  };
}

async function invokeProposer(proposer, args) {
  if (typeof proposer === 'function') return proposer(args);
  if (typeof proposer?.propose === 'function') return proposer.propose(args);
  throw new Error('propose must be a function or expose propose');
}

async function invokeEvaluator(evaluator, args) {
  if (typeof evaluator === 'function') return evaluator(args);
  if (typeof evaluator?.evaluate === 'function') return evaluator.evaluate(args);
  throw new Error('evaluate must be a function or expose evaluate');
}

export async function runHarnessVariantCycles({
  workspaceRoot,
  cyclePrefix = 'meta_loop',
  cycles = 1,
  target,
  traceSummary = {},
  propose,
  evaluate,
  baselineMetrics = { quality: 0, safety: 1, cost: 1, latency: 1 },
} = {}) {
  const resolvedWorkspaceRoot = assertWorkspaceRoot(workspaceRoot);
  const safeCyclePrefix = assertSafeId(cyclePrefix, 'cycle prefix');
  const totalCycles = Number(cycles);
  if (!Number.isInteger(totalCycles) || totalCycles < 1) {
    throw new Error('cycles must be a positive integer');
  }

  const results = [];
  let previousMetrics = null;

  for (let cycleIndex = 0; cycleIndex < totalCycles; cycleIndex += 1) {
    const cycleId = `${safeCyclePrefix}_${cycleIndex}`;
    const previousCandidateIds = results.map((cycle) => cycle.candidate.candidateId);
    const proposal = await invokeProposer(propose, {
      cycleIndex,
      cycleId,
      target,
      traceSummary,
      previousMetrics,
      previousCandidateIds,
    });
    const candidate = {
      ...normalizeObject(proposal),
      candidateId: candidateIdOf(proposal),
      target: proposal.target || target,
      requiresApproval: true,
      patch: {
        ...(proposal.patch || {}),
        applied: false,
      },
    };
    const variant = await createHarnessVariantWorkspace({
      workspaceRoot: resolvedWorkspaceRoot,
      cycleId,
      candidate,
      sourceFiles: proposal.sourceFiles || {},
      config: proposal.config || {},
      traceManifest: proposal.traceManifest || {},
      metricManifest: proposal.metricManifest || {},
    });
    const candidateMetrics = await invokeEvaluator(evaluate, {
      cycleIndex,
      cycleId,
      target,
      traceSummary,
      candidate,
      variant,
      previousMetrics,
      previousCandidateIds,
    });
    const experiment = await runHarnessExperiment({
      workspaceRoot: resolvedWorkspaceRoot,
      runId: cycleId,
      candidate,
      baseline: { candidateId: 'baseline' },
      baselineRunner: async () => baselineMetrics,
      candidateRunner: async () => candidateMetrics,
      sourcePatch: '',
      configPatch: '',
      promotion: {
        evidenceOnly: true,
        authority: 'advisory',
        activeWorkspaceMutation: false,
      },
      lineage: {
        variantWorkspace: variant.variantDir,
        previousCandidateIds,
      },
      traceManifest: proposal.traceManifest || {},
      metricLineage: proposal.metricManifest || {},
      replayEvidence: {
        traceSummary,
        previousCandidateIds,
      },
      sweep: {
        cyclePrefix: safeCyclePrefix,
        cycleIndex,
        cycles: totalCycles,
        previousCandidateIds,
      },
    });

    previousMetrics = candidateMetrics;
    results.push({
      cycleIndex,
      cycleId,
      candidate,
      variant,
      metrics: candidateMetrics,
      preference: experiment.preference,
      run: experiment.run,
    });
  }

  return {
    schemaVersion: 1,
    cyclePrefix: safeCyclePrefix,
    cycles: results,
  };
}
