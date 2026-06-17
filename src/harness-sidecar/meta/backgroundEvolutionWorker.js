import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  accumulateAutonomyEvidence,
  evaluateAutonomyEvidenceThresholds,
} from './autonomyEvidenceAccumulator.js';
import { buildOperatorDashboardSnapshot } from './operatorDashboardStore.js';
import { persistAutonomyProofArtifacts } from './autonomyProofRecorder.js';
import { applyPartialAutonomousImprovements } from './partialAutonomyApply.js';
import { runPostTaskRecursiveEvolutionHooks } from './recursiveEvolutionRuntimeHook.js';

const AUTONOMY_EVIDENCE_REL = '.harness/meta/autonomy-evidence.json';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseTime(value, fallback = null) {
  const source = value ?? fallback ?? Date.now();
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid background evolution timestamp: ${value}`);
  return date;
}

export function backgroundEvolutionEnabled(harnessConfig = {}) {
  const cap = harnessConfig.productionCapabilities?.backgroundEvolution;
  if (cap?.enabled === true || cap === true) return true;
  return harnessConfig.features?.backgroundEvolution === true;
}

function defaultPartialAutonomyThresholds(harnessConfig = {}) {
  return {
    minDashboardDepth: 1,
    maxRegressionCount: 0,
    ...(harnessConfig.partialAutonomy?.thresholds || {}),
  };
}

async function loadAutonomyEvidenceState(workspaceRoot) {
  const filePath = path.join(path.resolve(workspaceRoot), AUTONOMY_EVIDENCE_REL);
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function persistAutonomyEvidenceState(workspaceRoot, state) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const filePath = path.join(resolvedRoot, AUTONOMY_EVIDENCE_REL);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function runBackgroundEvolutionTick({
  workspaceRoot,
  harnessConfig = {},
  emitEvent,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const tickId = `background-${parseTime(typeof now === 'function' ? now() : now).toISOString().replace(/[-:.]/g, '')}`;

  const hookResults = await runPostTaskRecursiveEvolutionHooks({
    workspaceRoot,
    harnessConfig,
    task: { taskId: 'background-evolution', source: 'background' },
    emitEvent,
  });

  let autonomyState = await loadAutonomyEvidenceState(workspaceRoot);

  for (const entry of asArray(hookResults.replay?.ran)) {
    const report = entry.report;
    const dashboardSnapshot = entry.snapshot || (report ? buildOperatorDashboardSnapshot({
      rho: {
        scheduleId: entry.scheduleId,
        suiteId: report.suiteId,
        reportId: report.reportId,
        aggregateScore: report.aggregateScore,
        domainScores: report.domainScores,
        regressions: report.regressions?.length ?? 0,
        rollbackDrillRequired: report.rollbackDrillRequired === true,
      },
      now: typeof now === 'function' ? now() : now,
    }) : null);

    autonomyState = accumulateAutonomyEvidence({
      existing: autonomyState,
      replayReport: report,
      dashboardSnapshot,
    });
  }

  const thresholdEval = evaluateAutonomyEvidenceThresholds({
    state: autonomyState,
    thresholds: defaultPartialAutonomyThresholds(harnessConfig),
  });

  let partialApply = null;
  if (thresholdEval.eligible) {
    const replayReports = asArray(hookResults.replay?.ran).map((entry) => entry.report).filter(Boolean);
    partialApply = await applyPartialAutonomousImprovements({
      workspaceRoot,
      harnessConfig,
      autonomyState,
      replayReports,
      emitEvent,
      now,
    });
  }

  await persistAutonomyEvidenceState(workspaceRoot, autonomyState);
  await persistAutonomyProofArtifacts({
    workspaceRoot,
    autonomyState,
    harnessConfig,
    now,
  });

  return {
    evidenceOnly: true,
    canPromote: false,
    tickId,
    replay: hookResults.replay,
    campaigns: hookResults.campaigns,
    coordinated: hookResults.coordinated,
    autonomy: autonomyState,
    partialApply,
  };
}

export function createBackgroundEvolutionWorker({
  workspaceRoot,
  loadHarnessConfig,
  emitEvent,
  intervalMs = 300_000,
  now = () => new Date(),
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  let timer = null;
  let lastTickAt = null;
  let lastResult = null;
  let tickInFlight = null;

  async function runTick() {
    let harnessConfig = {};
    if (typeof loadHarnessConfig === 'function') {
      harnessConfig = (await loadHarnessConfig()) || {};
    }

    if (!backgroundEvolutionEnabled(harnessConfig)) {
      lastResult = {
        skipped: true,
        reason: 'background_evolution_disabled',
        evidenceOnly: true,
        canPromote: false,
      };
      return lastResult;
    }

    lastTickAt = typeof now === 'function' ? now() : new Date();
    lastResult = await runBackgroundEvolutionTick({
      workspaceRoot,
      harnessConfig,
      emitEvent,
      now,
    });
    return lastResult;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      if (tickInFlight) return;
      tickInFlight = runTick()
        .catch((error) => {
          lastResult = {
            error: error.message,
            evidenceOnly: true,
            canPromote: false,
          };
          return lastResult;
        })
        .finally(() => {
          tickInFlight = null;
        });
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function getStatus() {
    return {
      running: timer !== null,
      lastTickAt,
      lastResult,
      intervalMs,
    };
  }

  return {
    start,
    stop,
    runTick,
    getStatus,
  };
}
