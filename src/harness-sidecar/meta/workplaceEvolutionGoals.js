import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { detectWorkplaceTestRunner } from '../benchmarks/workplaceSuiteDetector.js';

const EVOLUTION_GOALS_REL = path.join('.harness', 'meta', 'evolution-goals.json');
const SCHEMA_VERSION = 1;

const BUILTIN_GOAL_IDS = Object.freeze([
  'primary_test_pass',
  'replay_no_regression',
  'skill_gap_closure',
  'frontier_uplift',
]);

const EVIDENCE_ONLY_FLAGS = Object.freeze({
  evidenceOnly: true,
  canPromote: false,
  authority: 'evidence_only',
});

function resolveWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function evolutionGoalsPath(workspaceRoot) {
  return path.join(resolveWorkspaceRoot(workspaceRoot), EVOLUTION_GOALS_REL);
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function formatTargetCommand(runner = {}) {
  const executable = String(runner.executable || '').trim();
  if (!executable) return undefined;
  return [executable, ...(runner.args || [])].join(' ').trim();
}

function inferStack(runner = {}) {
  if (runner.type === 'pytest' || runner.type === 'pyproject-script') {
    return 'python';
  }
  if (runner.type === 'npm-test' || runner.type === 'node-test' || runner.type === 'metadata') {
    return 'node';
  }
  if (runner.source === 'package.json') return 'node';
  if (runner.source === 'pyproject.toml') return 'python';
  return 'unknown';
}

function withEvidenceOnly(goal = {}) {
  return {
    ...goal,
    ...EVIDENCE_ONLY_FLAGS,
    schemaVersion: SCHEMA_VERSION,
  };
}

function buildStaticGoals(harnessConfig = {}) {
  const defaultSuiteId = harnessConfig?.evolution?.defaultSuiteId || 'workplace-smoke';

  return [
    {
      goalId: 'replay_no_regression',
      label: 'Replay shows no regression',
      metric: 'no_regression_delta',
      evidencePaths: [
        '.harness/benchmarks/frontier-dashboard.jsonl',
        '.harness/meta/replay-reports',
        `.harness/benchmarks/suites/${defaultSuiteId}.json`,
      ],
    },
    {
      goalId: 'skill_gap_closure',
      label: 'Close mined skill gaps',
      metric: 'skill_need_resolution',
      evidencePaths: [
        '.harness/meta/skill-candidates',
        '.harness/meta/traces',
      ],
    },
    {
      goalId: 'frontier_uplift',
      label: 'Improve longitudinal frontier quality',
      metric: 'quality_trend_uplift',
      evidencePaths: [
        '.harness/benchmarks/frontier-dashboard.jsonl',
        '.harness/meta/longitudinal-frontier',
      ],
    },
  ];
}

export async function buildWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig = {} } = {}) {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const runner = await detectWorkplaceTestRunner(root, harnessConfig);
  const stack = await detectStack(root, runner);
  const defaultSuiteId = harnessConfig?.evolution?.defaultSuiteId || 'workplace-smoke';

  const primaryGoal = {
    goalId: 'primary_test_pass',
    label: 'Primary workplace test passes',
    metric: 'exit_code_zero',
    targetCommand: formatTargetCommand(runner),
    runnerType: runner.type,
    stack,
    evidencePaths: [
      `.harness/benchmarks/suites/${defaultSuiteId}.json`,
      '.harness/meta/replay-reports',
    ],
  };

  return [
    withEvidenceOnly(primaryGoal),
    ...buildStaticGoals(harnessConfig).map(withEvidenceOnly),
  ];
}

async function detectStack(workspaceRoot, runner = {}) {
  if (await fileExists(path.join(workspaceRoot, 'package.json'))) {
    return 'node';
  }
  if (await fileExists(path.join(workspaceRoot, 'pyproject.toml'))) {
    return 'python';
  }
  return inferStack(runner);
}

function mergeEvolutionGoals(defaultGoals = [], existingGoals = []) {
  const defaultById = new Map(defaultGoals.map((goal) => [goal.goalId, goal]));
  const existingById = new Map(existingGoals.map((goal) => [goal.goalId, goal]));
  const merged = [];

  for (const goal of existingGoals) {
    if (!BUILTIN_GOAL_IDS.includes(goal.goalId)) {
      merged.push(withEvidenceOnly(goal));
    }
  }

  for (const goalId of BUILTIN_GOAL_IDS) {
    const defaultGoal = defaultById.get(goalId);
    const existingGoal = existingById.get(goalId);
    if (existingGoal) {
      merged.push(withEvidenceOnly({
        ...defaultGoal,
        ...existingGoal,
        goalId,
      }));
      continue;
    }
    if (defaultGoal) {
      merged.push(withEvidenceOnly(defaultGoal));
    }
  }

  return merged;
}

export async function persistWorkplaceEvolutionGoals({ workspaceRoot, goals = [] } = {}) {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const goalsPath = evolutionGoalsPath(root);
  const normalizedGoals = goals.map(withEvidenceOnly);
  const runner = await detectWorkplaceTestRunner(root);
  const stack = await detectStack(root, runner);

  const record = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    stack,
    runnerType: runner.type,
    goals: normalizedGoals,
    ...EVIDENCE_ONLY_FLAGS,
  };

  await mkdir(path.dirname(goalsPath), { recursive: true });
  await writeFile(goalsPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  return {
    path: goalsPath,
    record,
    goals: normalizedGoals,
    ...EVIDENCE_ONLY_FLAGS,
  };
}

export async function scaffoldWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig = {} } = {}) {
  const root = resolveWorkspaceRoot(workspaceRoot);
  const goalsPath = evolutionGoalsPath(root);
  const defaultGoals = await buildWorkplaceEvolutionGoals({ workspaceRoot: root, harnessConfig });

  const existing = await readJsonIfPresent(goalsPath);
  const existingGoals = Array.isArray(existing?.goals) ? existing.goals : [];
  const mergedGoals = mergeEvolutionGoals(defaultGoals, existingGoals);

  return persistWorkplaceEvolutionGoals({
    workspaceRoot: root,
    goals: mergedGoals,
  });
}
