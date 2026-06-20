import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { evaluateProposalTrustBoundary } from '../core/trustKernelGateway.js';
import { createHeldOutSuiteStore } from '../benchmarks/heldOutSuiteStore.js';
import { ingestLocalMemoryProposals } from '../memory/memoryGraphTaskBridge.js';
import { accumulateAutonomyEvidence } from './autonomyEvidenceAccumulator.js';
import { persistAutonomyProofArtifacts } from './autonomyProofRecorder.js';
import { scaffoldWorkplaceEvolution } from './harnessEvolutionDefaults.js';
import { runProductionReportCycle } from './productionReportOrchestrator.js';
import { runA2aPeerCycle } from '../interop/a2aPeerCycleRunner.js';
import { runPostTaskIcrHooks } from '../icr/icrPostTaskHook.js';
import { createDeterministicIcrRunners } from '../icr/icrRuntimeCoordinator.js';
import { runAutonomyRollbackDrill } from './autonomyRollbackRunner.js';
import { runPostTaskAutonomyApply } from './postTaskAutonomyApply.js';
import { runPostTaskPromotionOrchestrator } from './postTaskPromotionOrchestrator.js';
import { runPostTaskPromotionBridge } from './postTaskPromotionBridge.js';
import { coordinateRecursiveEvolution } from './recursiveEvolutionCoordinator.js';
import {
  createReplayEvidenceStore,
  runPostTaskEvolutionOrchestrator,
} from './postTaskEvolutionOrchestrator.js';
import { scaffoldWorkplaceEvolutionGoals } from './workplaceEvolutionGoals.js';
import { runSkillEvolutionPostTask } from '../skills/skillEvolutionPostTask.js';

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectReplayReports(replay) {
  return asArray(replay?.ran).map((entry) => entry.report).filter(Boolean);
}

function replayResultsHaveRegression(replay) {
  return asArray(replay?.ran).some((entry) => {
    const report = entry?.report;
    if (!report) return false;
    return asArray(report.regressions).length > 0 || report.rollbackDrillRequired === true;
  });
}

function isBackgroundEvolutionTask(task = {}) {
  return task.source === 'background' || task.taskId === 'background-evolution';
}

function productionGateEnabled(harnessConfig = {}, gateName) {
  const gate = harnessConfig.productionCapabilities?.[gateName];
  return gate?.enabled === true || gate === true;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureEvolutionWorkplaceReady({
  workspaceRoot,
  harnessConfig = {},
} = {}) {
  const replayGate = productionGateEnabled(harnessConfig, 'operatorDashboards');
  const campaignGate = productionGateEnabled(harnessConfig, 'sourceTreeVariants');
  if (!replayGate && !campaignGate) return;

  await scaffoldWorkplaceEvolution({ workspaceRoot });
  await scaffoldWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig });
  await normalizeHeldOutSuiteCommands(workspaceRoot);

  if (campaignGate) {
    const root = path.resolve(workspaceRoot);
    const packageJsonPath = path.join(root, 'package.json');
    const runnerPath = path.join(root, 'runner.js');
    if (!(await fileExists(packageJsonPath))) {
      await writeFile(packageJsonPath, '{"type":"module"}\n', 'utf8');
    }
    if (!(await fileExists(runnerPath))) {
      await writeFile(runnerPath, 'export const baseline = true;\n', 'utf8');
    }
  }
}

function formatHeldOutCaseCommand(command) {
  if (typeof command === 'string') return command.trim() || null;
  if (!command || typeof command !== 'object') return null;
  const executable = command.executable || command.command;
  const args = Array.isArray(command.args) ? command.args : [];
  if (!executable) return null;
  const parts = [executable, ...args.map((arg) => {
    const value = String(arg);
    return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  })];
  return parts.join(' ').trim();
}

async function normalizeHeldOutSuiteCommands(workspaceRoot) {
  const suitePath = path.join(
    path.resolve(workspaceRoot),
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  if (!(await fileExists(suitePath))) return;

  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  const cases = Array.isArray(suite.cases) ? suite.cases : [];
  let changed = false;
  for (const caseRecord of cases) {
    if (!caseRecord || typeof caseRecord !== 'object') continue;
    if (typeof caseRecord.command === 'string' && caseRecord.command.trim()) continue;
    const formatted = formatHeldOutCaseCommand(caseRecord.command);
    if (!formatted) continue;
    caseRecord.command = formatted;
    changed = true;
  }
  if (!changed) return;
  await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
}

function createCommandPreservingSuiteStore({ workspaceRoot }) {
  const store = createHeldOutSuiteStore({ workspaceRoot });
  return {
    ...store,
    async loadSuite(suiteId) {
      const filePath = store.suitePath(suiteId);
      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      const normalized = await store.loadSuite(suiteId);
      const commandById = new Map(
        (Array.isArray(raw.cases) ? raw.cases : []).map((caseRecord) => [caseRecord.id, caseRecord.command]),
      );
      return {
        ...normalized,
        cases: normalized.cases.map((caseRecord) => {
          const command = formatHeldOutCaseCommand(
            commandById.get(caseRecord.id) ?? caseRecord.command,
          );
          return command ? { ...caseRecord, command } : caseRecord;
        }),
      };
    },
  };
}

export { createReplayEvidenceStore };

export function buildGovernanceTrustInput({ workspaceRoot, proposal = {} } = {}) {
  return {
    evaluate: true,
    workspaceRoot,
    proposal,
  };
}

export function evaluateApplyTrustBoundary({ workspaceRoot, proposal = {}, evidence = {}, visual = {} } = {}) {
  return evaluateProposalTrustBoundary({ workspaceRoot, proposal, evidence, visual });
}

export async function runPostTaskRecursiveEvolutionHooks({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  memoryProposals = [],
  rollbackDrill = null,
  emitEvent,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const results = {
    evidenceOnly: true,
    canPromote: false,
    memoryBridge: null,
    replay: null,
    campaigns: null,
    coordinated: null,
    autonomy: null,
    autonomyApply: null,
    regressionRollback: null,
    productionReports: null,
    a2aPeerCycle: null,
    icr: null,
    promotion: null,
    skillEvolution: null,
    evolutionGoals: null,
  };

  await ensureEvolutionWorkplaceReady({ workspaceRoot, harnessConfig });

  if (asArray(memoryProposals).length > 0) {
      results.memoryBridge = await ingestLocalMemoryProposals({
        workspaceRoot,
        proposals: memoryProposals,
        featureFlags: {
          localMemoryGraph: harnessConfig.features?.localMemoryGraph !== false,
          productionCapabilities: harnessConfig.productionCapabilities || {},
        },
      });
      if (typeof emitEvent === 'function') {
        await emitEvent({
          type: 'memory_graph.ingest_completed',
          taskId: task.taskId,
          ...results.memoryBridge,
        });
      }
    }

  const evolutionResults = await runPostTaskEvolutionOrchestrator({
    workspaceRoot,
    harnessConfig,
    task: {
      ...task,
      source: task.source === 'background' ? undefined : task.source,
    },
    emitEvent,
    deps: {
      createHeldOutSuiteStore: ({ workspaceRoot: suiteWorkspaceRoot }) => (
        createCommandPreservingSuiteStore({ workspaceRoot: suiteWorkspaceRoot })
      ),
    },
  });
  results.replay = evolutionResults.replay;
  results.campaigns = evolutionResults.campaigns;
  results.coordinated = evolutionResults.coordinated;

  const replayReports = collectReplayReports(evolutionResults.replay);

  let autonomyState = {};
  if (rollbackDrill) {
      autonomyState = accumulateAutonomyEvidence({
        existing: autonomyState,
        rollbackDrill: {
          ...rollbackDrill,
          status: rollbackDrill.restoreVerified === false ? 'failed' : 'passed',
        },
      });
      autonomyState.drills = [{
        ...rollbackDrill,
        status: rollbackDrill.restoreVerified === false ? 'failed' : 'passed',
      }];
  }
  for (const entry of asArray(results.replay?.ran)) {
    autonomyState = accumulateAutonomyEvidence({
      existing: autonomyState,
      replayReport: entry.report,
      dashboardSnapshot: entry.snapshot,
    });
  }

  if (replayResultsHaveRegression(evolutionResults.replay)) {
    const latestReport = replayReports[replayReports.length - 1];
    const policyVersion = latestReport?.reportId || `regression-${task.taskId || 'unknown'}`;
    try {
      results.regressionRollback = await runAutonomyRollbackDrill({
        workspaceRoot,
        policyVersion,
        emitEvent,
      });
      autonomyState = accumulateAutonomyEvidence({
        existing: autonomyState,
        rollbackDrill: {
          ...results.regressionRollback,
          status: results.regressionRollback.status
            || (results.regressionRollback.restoreVerified === false ? 'failed' : 'passed'),
        },
      });
    } catch (error) {
      results.regressionRollback = {
        status: 'failed',
        reason: error.message,
        evidenceOnly: true,
        canPromote: false,
      };
    }
  }

  if (!isBackgroundEvolutionTask(task)) {
    results.autonomyApply = await runPostTaskAutonomyApply({
      workspaceRoot,
      harnessConfig,
      replayReports,
      autonomyState,
      emitEvent,
    });
  }

  results.autonomy = autonomyState;

  const campaignReports = asArray(results.campaigns?.ran).map((entry) => entry.report).filter(Boolean);
  results.promotion = await runPostTaskPromotionBridge({
    workspaceRoot,
    harnessConfig,
    autonomyState,
    replayReports,
    campaignResults: campaignReports,
  });
  results.promotionOrchestration = await runPostTaskPromotionOrchestrator({
    workspaceRoot,
    harnessConfig,
    promotionBridgeResult: results.promotion,
    replayReports,
  });
  results.coordinated = coordinateRecursiveEvolution({
    replayReports,
    campaignResults: campaignReports,
    promotionLoopResult: results.promotion,
  });

  results.skillEvolution = await runSkillEvolutionPostTask({
    workspaceRoot,
    harnessConfig,
    task,
    deps: {
      replayResults: replayReports,
    },
  });

  if (typeof emitEvent === 'function' && results.skillEvolution?.persisted?.length) {
    await emitEvent({
      type: 'skill_evolution.candidates_persisted',
      taskId: task.taskId,
      persisted: results.skillEvolution.persisted,
      evidenceOnly: true,
      canPromote: false,
    });
  }

  if (typeof emitEvent === 'function' && results.promotion?.proposal) {
    await emitEvent({
      type: 'promotion.proposal_queued',
      taskId: task.taskId,
      proposalId: results.promotion.proposal.proposalId,
      queuePath: results.promotion.queuePath,
      evidenceOnly: true,
      canPromote: false,
    });
  }

  results.productionReports = await runProductionReportCycle({
    workspaceRoot,
    harnessConfig,
    task,
  });

  if (productionGateEnabled(harnessConfig, 'productionA2aTransport')
    && productionGateEnabled(harnessConfig, 'productionA2aQueues')) {
    const peerWorkspaceRoot = path.join(path.resolve(workspaceRoot), '.harness', 'a2a', 'peer-workspace');
    await mkdir(peerWorkspaceRoot, { recursive: true });
    results.a2aPeerCycle = await runA2aPeerCycle({
      localWorkspaceRoot: workspaceRoot,
      peerWorkspaceRoot,
      harnessConfig,
    });
  }

  results.icr = await runPostTaskIcrHooks({
    workspaceRoot,
    harnessConfig,
    task,
    emitEvent,
    runners: createDeterministicIcrRunners(),
  });

  await persistAutonomyProofArtifacts({
    workspaceRoot,
    autonomyState,
    harnessConfig,
  });

  return results;
}
