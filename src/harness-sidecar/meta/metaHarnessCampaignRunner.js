import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runHarnessExperiment } from './harnessExperimentRunner.js';
import { updateHarnessFrontier } from './harnessFrontier.js';
import { createSourceTreeVariantRunner } from './sourceTreeVariantRunner.js';
import {
  createHarnessVariantWorkspace,
  readHarnessVariantProposerContext,
} from './harnessVariantWorkspace.js';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new Error(`Unsafe ${label}: ${value || ''}`);
  }
  return value;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error('maxCycles must be a positive integer');
  }
  return number;
}

async function invokeProposer(proposer, args) {
  if (typeof proposer === 'function') return proposer(args);
  if (typeof proposer?.propose === 'function') return proposer.propose(args);
  throw new Error('proposer must be a function or expose propose');
}

async function invokeEvaluator(evaluator, args) {
  if (typeof evaluator === 'function') return evaluator(args);
  if (typeof evaluator?.evaluate === 'function') return evaluator.evaluate(args);
  throw new Error('evaluator must be a function or expose evaluate');
}

function publicCampaign(campaign = {}) {
  const { workspaceRoot, ...safeCampaign } = campaign;
  return safeCampaign;
}

function sourceTreeRunnerConfig(sourceTree = {}) {
  const { commandRunner, ...config } = normalizeObject(sourceTree);
  return config;
}

function normalizeVariantRunner({ variantRunner, sourceTree, workspaceRoot, variant }) {
  if (variantRunner) return variantRunner;
  if (typeof sourceTree?.commandRunner === 'function') {
    return createSourceTreeVariantRunner({
      workspaceRoot,
      variantRoot: variant.variantDir,
      commandRunner: sourceTree.commandRunner,
    });
  }
  return null;
}

function assertNoActiveMutationClaims(value, label = 'variant result', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (value.activeWorkspaceMutation === true) {
    throw new Error(`${label} claimed active workspace mutation`);
  }
  if (value.promotionAuthority === true) {
    throw new Error(`${label} claimed promotion authority`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object') {
      assertNoActiveMutationClaims(child, `${label}.${key}`, seen);
    }
  }
}

function assertRelativeArtifactPath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('replay artifact path is required');
  }
  const normalized = path.normalize(filePath);
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Unsafe replay artifact path: ${filePath}`);
  }
  return normalized;
}

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readReplayReportFromArtifacts({ variant, artifacts } = {}) {
  const replayFiles = asArray(artifacts?.replay?.files);
  for (const file of replayFiles) {
    const relativePath = assertRelativeArtifactPath(file?.path);
    const reportPath = path.resolve(variant.variantDir, relativePath);
    if (!isInsideRoot(variant.variantDir, reportPath)) {
      throw new Error(`Replay artifact path escapes variant: ${file?.path}`);
    }
    try {
      const parsed = JSON.parse(await readFile(reportPath, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

async function runVariantRunnerObject({ variantRunner, sourceTree, variant, cycleArgs }) {
  const runnerSourceTree = sourceTreeRunnerConfig(sourceTree);
  const prepared = typeof variantRunner?.prepareVariant === 'function'
    ? await variantRunner.prepareVariant({
      ...runnerSourceTree,
      variantRoot: variant.variantDir,
      variant,
      ...cycleArgs,
    })
    : null;
  const run = typeof variantRunner?.runVariant === 'function'
    ? await variantRunner.runVariant({
      ...(runnerSourceTree.run || {}),
      variantRoot: variant.variantDir,
      variant,
      prepared,
      ...cycleArgs,
    })
    : null;
  const collected = typeof variantRunner?.collectArtifacts === 'function'
    ? await variantRunner.collectArtifacts({
      ...(runnerSourceTree.collect || {}),
      variantRoot: variant.variantDir,
      variant,
      prepared,
      run,
      ...cycleArgs,
    })
    : null;
  const result = {
    prepared,
    run,
    collected,
    sourceTreeManifest: prepared?.sourceTreeManifest || null,
    artifacts: collected?.artifacts || null,
    replayReport: collected?.replayReport || run?.replayReport || prepared?.replayReport || null,
  };
  assertNoActiveMutationClaims(result);
  return result;
}

async function invokeVariantRunner({ variantRunner, sourceTree, workspaceRoot, variant, cycleArgs }) {
  const runner = normalizeVariantRunner({ variantRunner, sourceTree, workspaceRoot, variant });
  if (!runner) return {};
  const runnerSourceTree = sourceTreeRunnerConfig(sourceTree);
  if (typeof runner === 'function') {
    const result = normalizeObject(await runner({
      ...cycleArgs,
      variant,
      variantRoot: variant.variantDir,
      sourceTree: runnerSourceTree,
    }));
    assertNoActiveMutationClaims(result);
    return result;
  }
  return runVariantRunnerObject({ variantRunner: runner, sourceTree, variant, cycleArgs });
}

function metricsFromEvaluation(evaluation) {
  const normalized = normalizeObject(evaluation);
  return normalizeObject(normalized.metrics || normalized);
}

function replayReportFrom({ evaluation, variantResult }) {
  return normalizeObject(evaluation).replayReport
    || normalizeObject(variantResult).replayReport
    || null;
}

function replayReportId(report) {
  if (!report || typeof report !== 'object') return null;
  return report.replayId || report.reportId || report.id || null;
}

function promotionRecord({ frontierDecision, timestamp }) {
  return {
    evidenceOnly: true,
    authority: 'advisory',
    activeWorkspaceMutation: false,
    promotionAuthority: false,
    frontierDecision,
    evaluatedAt: timestamp,
  };
}

export async function runMetaHarnessCampaign({
  campaign,
  proposer,
  evaluator,
  variantRunner,
  frontier,
  maxCycles,
  now = () => new Date(),
} = {}) {
  const normalizedCampaign = normalizeObject(campaign);
  const workspaceRoot = normalizedCampaign.workspaceRoot;
  if (!workspaceRoot) throw new Error('campaign.workspaceRoot is required');
  const campaignId = assertSafeId(normalizedCampaign.campaignId || 'meta_harness_campaign', 'campaign id');
  const totalCycles = normalizePositiveInteger(maxCycles, normalizedCampaign.maxCycles || 1);
  const target = normalizedCampaign.target || 'meta-harness';
  const baselineMetrics = normalizeObject(normalizedCampaign.baselineMetrics);
  const safeCampaign = publicCampaign(normalizedCampaign);
  let currentFrontier = Array.isArray(frontier)
    ? [...frontier]
    : [...(Array.isArray(normalizedCampaign.frontier) ? normalizedCampaign.frontier : [])];

  const cycles = [];
  const previousReplayReports = [];
  let previousMetrics = null;

  for (let cycleIndex = 0; cycleIndex < totalCycles; cycleIndex += 1) {
    const cycleId = `${campaignId}_${cycleIndex}`;
    const previousCandidateIds = cycles.map((cycle) => cycle.candidate.candidateId);
    const priorContext = await readHarnessVariantProposerContext({
      workspaceRoot,
      variantRefs: cycles.map((cycle) => cycle.variant),
    });
    const proposal = await invokeProposer(proposer, {
      campaign: safeCampaign,
      cycleIndex,
      cycleId,
      target,
      frontier: currentFrontier,
      priorContext,
      previousMetrics,
      previousCandidateIds,
      previousReplayReports,
    });
    const candidate = {
      ...normalizeObject(proposal),
      candidateId: assertSafeId(proposal?.candidateId, 'candidate id'),
      target: proposal?.target || target,
      requiresApproval: true,
      patch: {
        ...(normalizeObject(proposal?.patch)),
        applied: false,
      },
    };
    const variant = await createHarnessVariantWorkspace({
      workspaceRoot,
      cycleId,
      candidate,
      sourceFiles: proposal?.sourceFiles || {},
      config: proposal?.config || {},
      traceManifest: proposal?.traceManifest || {},
      metricManifest: proposal?.metricManifest || {},
      traceArtifacts: proposal?.traceArtifacts || {},
      metricArtifacts: proposal?.metricArtifacts || {},
      lineage: {
        ...normalizeObject(proposal?.lineage),
        campaignId,
        previousCandidateIds,
      },
    });
    const cycleArgs = {
      campaign: safeCampaign,
      cycleIndex,
      cycleId,
      target,
      candidate,
      previousMetrics,
      previousCandidateIds,
      previousReplayReports,
    };
    const variantResult = await invokeVariantRunner({
      variantRunner,
      sourceTree: normalizeObject(normalizedCampaign.sourceTree),
      workspaceRoot,
      variant,
      cycleArgs,
    });
    const artifactReplayReport = await readReplayReportFromArtifacts({
      variant,
      artifacts: variantResult.artifacts,
    });
    const evaluation = await invokeEvaluator(evaluator, {
      ...cycleArgs,
      variant,
      variantResult,
      replayReport: replayReportFrom({ evaluation: variantResult, variantResult }) || artifactReplayReport,
    });
    const metrics = metricsFromEvaluation(evaluation);
    const replayReport = replayReportFrom({ evaluation, variantResult }) || artifactReplayReport;
    const frontierBefore = currentFrontier;
    currentFrontier = updateHarnessFrontier({
      current: currentFrontier,
      candidate: {
        candidateId: candidate.candidateId,
        metrics,
      },
    });
    const frontierDecision = {
      beforeCount: frontierBefore.length,
      afterCount: currentFrontier.length,
      accepted: currentFrontier.some((entry) => entry.candidateId === candidate.candidateId),
    };
    const timestamp = now().toISOString();
    const promotion = promotionRecord({ frontierDecision, timestamp });
    const previousReplayReportIds = previousReplayReports.map(replayReportId).filter(Boolean);
    const experiment = await runHarnessExperiment({
      workspaceRoot,
      runId: cycleId,
      candidate,
      baseline: { candidateId: 'baseline' },
      baselineRunner: async () => baselineMetrics,
      candidateRunner: async () => metrics,
      promotion,
      lineage: {
        campaignId,
        variantWorkspace: variant.variantDir,
        previousCandidateIds,
      },
      traceManifest: proposal?.traceManifest || {},
      metricLineage: proposal?.metricManifest || {},
      replayEvidence: {
        report: replayReport,
        previousReplayReportIds,
        variantArtifacts: variantResult.artifacts || null,
      },
      sweep: {
        campaignId,
        cycleIndex,
        cycles: totalCycles,
        previousCandidateIds,
      },
    });

    const cycleResult = {
      schemaVersion: 1,
      cycleIndex,
      cycleId,
      candidate,
      variant,
      metrics,
      replayReport,
      sourceTree: variantResult,
      frontier: currentFrontier,
      frontierDecision,
      preference: experiment.preference,
      promotion,
      run: experiment.run,
    };
    cycles.push(cycleResult);
    previousMetrics = metrics;
    if (replayReport) previousReplayReports.push(replayReport);
  }

  return {
    schemaVersion: 1,
    campaignId,
    target,
    cycles,
    frontier: currentFrontier,
    replayReports: previousReplayReports,
    evidenceOnly: true,
    activeWorkspaceMutation: false,
  };
}
