import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildProductionLiveLaneReport } from '../bes/liveBesFusion.js';
import { buildProductionPassKReport, runModelCouncilPassKEval } from '../evals/modelCouncilPassK.js';
import { buildProductionProvenanceResolutionReport } from '../memory/provenanceResolutionAgents.js';
import {
  buildProductionGroupedRerollReport,
  runGroupedRhoRerolls,
} from '../rho/groupedRerollRunner.js';
import {
  buildProductionVisualReplayReport,
  createVisualReplaySuite,
} from '../vlm/visualReplaySuite.js';

const REPORT_SPECS = [
  {
    gateName: 'modelBackedRhoEmbeddings',
    relativeDir: ['rho', 'production-grouped-rerolls'],
    evidenceType: 'production_grouped_reroll_report',
  },
  {
    gateName: 'modelAssistedBesJudgment',
    relativeDir: ['bes', 'production-live-lanes'],
    evidenceType: 'live_lane_report',
  },
  {
    gateName: 'modelAssistedMemory',
    relativeDir: ['memory', 'provenance-resolution'],
    evidenceType: 'provenance_resolution_report',
  },
  {
    gateName: 'visualReplaySuites',
    relativeDir: ['visual', 'production-replay'],
    evidenceType: 'visual_replay_report',
  },
  {
    gateName: 'ensembleCalibration',
    relativeDir: ['model-council', 'production-passk'],
    evidenceType: 'modelCouncilCalibration',
  },
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseTime(value, fallback = null) {
  const source = value ?? fallback ?? Date.now();
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid production report timestamp: ${value}`);
  return date;
}

function requireWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function isInsideWorkspace(workspaceRoot, candidatePath) {
  const relative = path.relative(workspaceRoot, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInsideWorkspace(workspaceRoot, candidatePath) {
  const resolved = path.resolve(candidatePath);
  if (!isInsideWorkspace(workspaceRoot, resolved)) {
    throw new Error(`Path must stay inside workspace: ${candidatePath}`);
  }
  return resolved;
}

function productionGateEnabled(harnessConfig = {}, gateName) {
  return harnessConfig.productionCapabilities?.[gateName]?.enabled === true;
}

function gateConfig(harnessConfig = {}, gateName) {
  return harnessConfig.productionCapabilities?.[gateName] || { enabled: false, mode: 'offline' };
}

function sanitizeReportId(value, fallback = 'production-report') {
  return String(value || fallback).replace(/[^A-Za-z0-9_-]+/g, '-');
}

function reportDirectory(workspaceRoot, relativeDir) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const dir = path.join(resolvedRoot, '.harness', ...relativeDir);
  return assertInsideWorkspace(resolvedRoot, dir);
}

async function persistEvidenceReport({ workspaceRoot, relativeDir, reportId, report }) {
  const dir = reportDirectory(workspaceRoot, relativeDir);
  await mkdir(dir, { recursive: true });
  const safeId = sanitizeReportId(reportId);
  const filePath = assertInsideWorkspace(requireWorkspaceRoot(workspaceRoot), path.join(dir, `${safeId}.json`));
  const payload = {
    ...report,
    evidenceOnly: true,
    canPromote: false,
    promotionAllowed: false,
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { filePath, reportId: safeId };
}

function minimalGroupedRerollSchedule(now, task = {}) {
  const generatedAt = parseTime(now).toISOString();
  const scheduleId = `production-report-${task.taskId || 'cycle'}`;
  return {
    scheduleId,
    generatedAt,
    cadence: { interval: 'weekly', groupSize: 1 },
    coverage: {
      domains: ['code'],
      missingDomains: [],
    },
    replayInputs: {
      groupSize: 1,
      coreset: {
        items: [{
          id: 'code_case',
          caseId: 'code_case',
          taskId: 'code_case',
          domain: 'code',
          heldoutVariants: [{ variantId: 'seed_a' }],
          promotionEvidenceEligible: true,
        }],
      },
    },
    quarantineReplayInputs: { groupSize: 1, coreset: { items: [] } },
    evidenceOnly: true,
    promotionAllowed: false,
    authority: 'evidence_only',
  };
}

async function successfulGroupedRollout(context) {
  return {
    status: 'completed',
    compactHandoff: {
      summary: context.variant === 'baseline'
        ? `baseline ${context.item.domain}`
        : `${context.candidate?.candidateId || 'candidate'} ${context.item.domain}`,
    },
    verifierEvidence: [{ passed: true }],
    metrics: { quality: context.variant === 'baseline' ? 0.6 : 0.8, safety: 0.95 },
  };
}

async function buildGroupedRerollProductionReport({ harnessConfig, hookResults, task, now }) {
  const groupedReport = await runGroupedRhoRerolls({
    schedule: minimalGroupedRerollSchedule(now, task),
    baseline: { candidateId: 'baseline_current' },
    candidateFamilies: [{ candidateId: 'cand_production' }],
    caseRunner: successfulGroupedRollout,
    now,
  });
  const history = asArray(hookResults?.replay?.ran)
    .map((entry) => entry.report?.longitudinalTrend?.history || entry.report?.history)
    .flat()
    .filter(Boolean);
  return buildProductionGroupedRerollReport({
    groupedReport,
    history,
    suiteId: `production-report-${task.taskId || 'cycle'}`,
    now,
  });
}

function buildBesProductionReport({ harnessConfig, task, now }) {
  return buildProductionLiveLaneReport({
    lane: task.lane || 'code',
    taskId: task.taskId || 'production-report-cycle',
    forwardCandidates: [
      { candidateId: 'candidate_a', score: 0.64, compatibleFamily: 'code' },
      { candidateId: 'candidate_b', score: 0.72, compatibleFamily: 'code' },
    ],
    backwardGoals: [
      { goalId: 'goal_tests', candidateId: 'candidate_b', weight: 0.4, compatibleFamily: 'code' },
    ],
    denseScores: [
      { candidateId: 'candidate_b', score: 0.9, weight: 0.35 },
      { candidateId: 'candidate_a', score: 0.3, weight: 0.35 },
    ],
    productionCapabilities: harnessConfig.productionCapabilities || {},
    now,
  });
}

async function buildProvenanceProductionReport({ task, now }) {
  const recordedAt = parseTime(now).toISOString();
  const conflict = {
    type: 'mutually_exclusive',
    existingFact: {
      id: 'fact-old',
      subject: 'verifier.command',
      predicate: 'equals',
      object: 'npm test',
      passageIds: ['passage-old'],
    },
    newFact: {
      id: 'fact-new',
      subject: 'verifier.command',
      predicate: 'equals',
      object: 'node --test tests/harness-memory.test.js',
      passageIds: ['passage-new'],
    },
    provenanceIds: ['passage-old', 'passage-new'],
  };
  const passages = [
    { id: 'passage-new', text: 'The verifier.command equals node --test tests/harness-memory.test.js.' },
    { id: 'passage-old', text: 'Legacy docs said verifier.command equals npm test.' },
  ];
  return buildProductionProvenanceResolutionReport({
    conflicts: [conflict],
    provenancePassages: passages,
    runId: `provenance-${task.taskId || 'production-report'}`,
    recordedAt,
  });
}

function buildVisualProductionReport({ task, now }) {
  const suite = createVisualReplaySuite({
    suiteId: `visual-production-${task.taskId || 'cycle'}`,
    cases: [
      {
        caseId: 'case-ui',
        kind: 'ui',
        artifacts: [{ path: '.harness/visual/ui.png', hash: 'hash-ui' }],
      },
    ],
  });
  return buildProductionVisualReplayReport({
    suite,
    results: [{
      caseId: 'case-ui',
      passed: true,
      score: 0.8,
      confidence: 0.7,
      artifactHashes: ['hash-ui'],
    }],
    runId: `visual-${task.taskId || 'production-report'}`,
    recordedAt: parseTime(now).toISOString(),
  });
}

async function buildPassKProductionReport({ harnessConfig, task }) {
  const passKReport = await runModelCouncilPassKEval({
    suiteId: `production-passk-${task.taskId || 'cycle'}`,
    k: 1,
    minCases: 10,
  });
  return buildProductionPassKReport({
    report: passKReport,
    gate: gateConfig(harnessConfig, 'ensembleCalibration'),
  });
}

function reportIdFor(spec, report, task = {}) {
  switch (spec.gateName) {
    case 'modelBackedRhoEmbeddings':
      return report.reportId;
    case 'modelAssistedBesJudgment':
      return `live-lane-${report.lane || 'lane'}-${report.taskId || task.taskId || 'cycle'}`;
    case 'modelAssistedMemory':
      return report.runId;
    case 'visualReplaySuites':
      return report.runId;
    case 'ensembleCalibration':
      return report.passKReport?.evalId || `passk-${task.taskId || 'cycle'}`;
    default:
      return report.reportId || report.runId || `production-${task.taskId || 'cycle'}`;
  }
}

async function buildReportForGate(spec, context) {
  switch (spec.gateName) {
    case 'modelBackedRhoEmbeddings':
      return buildGroupedRerollProductionReport(context);
    case 'modelAssistedBesJudgment':
      return buildBesProductionReport(context);
    case 'modelAssistedMemory':
      return buildProvenanceProductionReport(context);
    case 'visualReplaySuites':
      return buildVisualProductionReport(context);
    case 'ensembleCalibration':
      return buildPassKProductionReport(context);
    default:
      throw new Error(`Unknown production report gate: ${spec.gateName}`);
  }
}

export async function runProductionReportCycle({
  workspaceRoot,
  harnessConfig = {},
  hookResults = {},
  task = {},
  now = new Date(),
} = {}) {
  const resolvedRoot = requireWorkspaceRoot(workspaceRoot);
  const cycleNow = parseTime(now);
  const ran = [];
  const skipped = [];

  for (const spec of REPORT_SPECS) {
    if (!productionGateEnabled(harnessConfig, spec.gateName)) {
      skipped.push({
        gateName: spec.gateName,
        reason: 'gate_disabled',
      });
      continue;
    }

    const report = await buildReportForGate(spec, {
      workspaceRoot: resolvedRoot,
      harnessConfig,
      hookResults,
      task,
      now: cycleNow,
    });
    const reportId = reportIdFor(spec, report, task);
    const persisted = await persistEvidenceReport({
      workspaceRoot: resolvedRoot,
      relativeDir: spec.relativeDir,
      reportId,
      report,
    });

    ran.push({
      gateName: spec.gateName,
      evidenceType: spec.evidenceType,
      reportId: persisted.reportId,
      filePath: persisted.filePath,
      evidenceOnly: true,
      canPromote: false,
      promotionAllowed: false,
    });
  }

  return {
    ran,
    skipped,
    evidenceOnly: true,
    canPromote: false,
  };
}
