import { listTraces, readTrace } from '../core/traceReader.js';
import { buildRhoCoreset } from '../rho/coresetBuilder.js';
import { mineSkillNeedsFromRho } from './skillNeedMiner.js';
import { generateSkillCandidates, runSkillCandidateBesLane } from './skillEvolution.js';
import { evaluateSkillCandidate } from './skillCandidateEvaluator.js';
import { writeSkillCandidate } from './skillCandidateStore.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildSkillEvolutionSearchContext } from './skillEvolutionScheduler.js';

const DEFAULT_TRACE_LIMIT = 8;
const MAX_NEEDS_PER_TICK = 1;
const MAX_CANDIDATES_PER_TICK = 2;

export function skillEvolutionEnabled(harnessConfig = {}) {
  return harnessConfig?.features?.skillEvolution !== false;
}

function subgoalCompletionFromSummary(summary) {
  if (Number.isFinite(summary?.latestState?.subgoalScore?.percent)) {
    return summary.latestState.subgoalScore.percent / 100;
  }
  return undefined;
}

function traceFromDetail(recentTrace, detail) {
  const failures = detail.summary?.failures || [];
  return {
    traceId: detail.taskId,
    taskId: detail.taskId,
    events: detail.events,
    summary: detail.summary,
    failures,
    failureModes: failures.map((failure) => failure.category).filter(Boolean),
    budgetGates: detail.events.filter((event) => event.type === 'budget.gate'),
    status: detail.summary?.latestState?.status || recentTrace.latestTaskEvent?.status,
    subgoalCompletion: subgoalCompletionFromSummary(detail.summary),
    verifierEvidence: detail.events.some((event) => event.verifierEvidence?.missing === true)
      ? { missing: true }
      : undefined,
  };
}

export async function loadRecentTraceSummaries({
  workspaceRoot,
  limit = DEFAULT_TRACE_LIMIT,
  deps = {},
} = {}) {
  const listFn = deps.listTraces || listTraces;
  const readFn = deps.readTrace || readTrace;
  const recentTraceSummaries = await listFn({ workspaceRoot });
  const safeLimit = Math.max(
    0,
    Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : DEFAULT_TRACE_LIMIT,
  );
  const traces = [];
  for (const recentTrace of recentTraceSummaries.slice(0, safeLimit)) {
    const detail = await readFn({ workspaceRoot, taskId: recentTrace.taskId });
    traces.push(traceFromDetail(recentTrace, detail));
  }
  return traces;
}

function baseResult() {
  return {
    evidenceOnly: true,
    canPromote: false,
    needs: [],
    persisted: [],
    schedulerAction: null,
  };
}

export async function runSkillEvolutionPostTask({
  workspaceRoot,
  harnessConfig = {},
  task = {},
  deps = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  if (!skillEvolutionEnabled(harnessConfig)) {
    return { ...baseResult(), skipped: 'skill_evolution_disabled' };
  }

  const loadTraces = deps.loadRecentTraceSummaries || loadRecentTraceSummaries;
  const buildCoreset = deps.buildRhoCoreset || buildRhoCoreset;
  const mineNeeds = deps.mineSkillNeedsFromRho || mineSkillNeedsFromRho;
  const generateCandidates = deps.generateSkillCandidates || generateSkillCandidates;
  const evaluateCandidateFn = deps.evaluateSkillCandidate || evaluateSkillCandidate;
  const writeCandidate = deps.writeSkillCandidate || writeSkillCandidate;
  const buildSearchContext = deps.buildSkillEvolutionSearchContext || buildSkillEvolutionSearchContext;
  const nowFn = deps.now || (() => new Date());

  const traceLimit = harnessConfig?.skillEvolution?.traceLimit ?? DEFAULT_TRACE_LIMIT;
  const coresetLimit = harnessConfig?.skillEvolution?.coresetLimit ?? traceLimit;
  const existingCapabilities = deps.existingCapabilities ?? harnessConfig?.installedCapabilities ?? [];

  const traces = await loadTraces({ workspaceRoot, limit: traceLimit, deps });
  const coreset = buildCoreset({
    traces,
    limit: coresetLimit,
    diversityKey: (trace) => trace.failureModes?.[0] || trace.status || trace.taskId,
  });

  if (!coreset?.items?.length) {
    return { ...baseResult(), skipped: 'empty_coreset' };
  }

  const needs = mineNeeds({ coreset, traces, existingCapabilities });
  if (!needs.length) {
    return { ...baseResult(), skipped: 'no_skill_needs' };
  }

  const topNeeds = needs.slice(0, MAX_NEEDS_PER_TICK);
  const persisted = [];
  const evaluations = [];
  const allCandidates = [];

  for (const skillNeed of topNeeds) {
    const candidates = generateCandidates({
      skillNeed,
      count: MAX_CANDIDATES_PER_TICK,
      now: nowFn,
    });

    for (const generated of candidates) {
      const evaluation = evaluateCandidateFn({
        candidate: generated,
        baseline: task?.baseline || {},
        replayResults: deps.replayResults || [],
        staticInputs: deps.staticInputs || {},
      });
      evaluations.push(evaluation);

      const saved = await writeCandidate({
        workspaceRoot,
        candidate: {
          ...generated.candidate,
          createdAt: generated.createdAt,
          genome: generated.genome,
          target: generated.target,
          status: generated.status,
          applied: generated.applied,
        },
        skillMarkdown: generated.skillMarkdown,
        evaluation,
      });

      persisted.push({
        candidateId: saved.candidateId,
        needId: skillNeed.needId,
        evaluation,
        path: saved.skill?.path || null,
      });
      allCandidates.push(generated);

      if (harnessConfig?.skillEvolution?.besLane !== false) {
        try {
          const besLane = await (deps.runSkillCandidateBesLane || runSkillCandidateBesLane)({
            taskId: task.taskId || 'skill_evolution_post_task',
            skillNeed,
            count: 1,
            now: nowFn,
          });
          const candidatePath = path.join(
            path.resolve(workspaceRoot),
            '.harness',
            'meta',
            'skill-candidates',
            saved.candidateId,
            'candidate.json',
          );
          const existing = JSON.parse(await readFile(candidatePath, 'utf8'));
          await writeFile(candidatePath, `${JSON.stringify({
            ...existing,
            besLane: {
              evidence: besLane,
              evidenceOnly: true,
              canPromote: false,
            },
          }, null, 2)}\n`, 'utf8');
        } catch {
          // BES lane evidence is advisory-only; post-task must not fail on lane errors.
        }
      }
    }
  }

  const searchContext = buildSearchContext({
    skillNeed: topNeeds[0],
    candidates: allCandidates,
    evaluations,
    budget: {
      remainingIterations: harnessConfig?.skillEvolution?.remainingIterations ?? 0,
    },
  });

  return {
    evidenceOnly: true,
    canPromote: false,
    needs,
    persisted,
    schedulerAction: searchContext.selectAction(),
  };
}
