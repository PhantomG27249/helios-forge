import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildWorkplaceEvolutionGoals,
  persistWorkplaceEvolutionGoals,
  scaffoldWorkplaceEvolutionGoals,
} from '../src/harness-sidecar/meta/workplaceEvolutionGoals.js';

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const BUILTIN_GOAL_IDS = [
  'primary_test_pass',
  'replay_no_regression',
  'skill_gap_closure',
  'frontier_uplift',
];

test('buildWorkplaceEvolutionGoals scaffolds npm-test primary goal for node package.json repos', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-goals-node-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'jest --runInBand' } }),
    'utf8',
  );

  const goals = await buildWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig: {} });
  assert.ok(Array.isArray(goals));
  assert.equal(goals.length, BUILTIN_GOAL_IDS.length);

  for (const goalId of BUILTIN_GOAL_IDS) {
    const goal = goals.find((entry) => entry.goalId === goalId);
    assert.ok(goal, `missing built-in goal ${goalId}`);
    assert.equal(goal.schemaVersion, 1);
    assert.ok(typeof goal.label === 'string' && goal.label.length > 0);
    assert.ok(typeof goal.metric === 'string' && goal.metric.length > 0);
    assert.ok(Array.isArray(goal.evidencePaths) && goal.evidencePaths.length > 0);
  }

  const primary = goals.find((entry) => entry.goalId === 'primary_test_pass');
  assert.equal(primary.runnerType, 'npm-test');
  assert.equal(primary.targetCommand, 'npm test');
  assert.equal(primary.stack, 'node');
});

test('buildWorkplaceEvolutionGoals detects python stack from pyproject.toml', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-goals-python-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'pyproject.toml'),
    [
      '[tool.pytest.ini_options]',
      'testpaths = ["tests"]',
      '',
    ].join('\n'),
    'utf8',
  );

  const goals = await buildWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig: {} });
  const primary = goals.find((entry) => entry.goalId === 'primary_test_pass');

  assert.equal(primary.stack, 'python');
  assert.equal(primary.runnerType, 'pytest');
  assert.equal(primary.targetCommand, 'python -m pytest');
});

test('persistWorkplaceEvolutionGoals writes evidence-only evolution-goals.json', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-goals-persist-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test tests/' } }),
    'utf8',
  );

  const goals = await buildWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig: {} });
  const result = await persistWorkplaceEvolutionGoals({ workspaceRoot, goals });

  const goalsPath = path.join(workspaceRoot, '.harness', 'meta', 'evolution-goals.json');
  assert.ok(await exists(goalsPath));
  assert.equal(result.path, goalsPath);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);
  assert.equal(result.authority, 'evidence_only');

  const persisted = JSON.parse(await readFile(goalsPath, 'utf8'));
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.evidenceOnly, true);
  assert.equal(persisted.canPromote, false);
  assert.equal(persisted.authority, 'evidence_only');
  assert.ok(Array.isArray(persisted.goals));
  assert.equal(persisted.goals.length, BUILTIN_GOAL_IDS.length);

  for (const goal of persisted.goals) {
    assert.equal(goal.evidenceOnly, true);
    assert.equal(goal.canPromote, false);
  }
});

test('scaffoldWorkplaceEvolutionGoals merge preserves operator-added goals and edits', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-evolution-goals-scaffold-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'jest --runInBand' } }),
    'utf8',
  );

  const metaDir = path.join(workspaceRoot, '.harness', 'meta');
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    path.join(metaDir, 'evolution-goals.json'),
    JSON.stringify({
      schemaVersion: 1,
      goals: [
        {
          goalId: 'operator_custom_goal',
          label: 'Operator custom KPI',
          metric: 'operator_defined',
          evidencePaths: ['.harness/meta/operator-notes.json'],
          schemaVersion: 1,
        },
        {
          goalId: 'primary_test_pass',
          label: 'Operator primary test label',
          metric: 'operator_exit_code',
          targetCommand: 'npm run test:ci',
          evidencePaths: ['.harness/meta/custom-evidence.json'],
          schemaVersion: 1,
        },
      ],
    }, null, 2),
    'utf8',
  );

  const result = await scaffoldWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig: {} });
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);

  const persisted = JSON.parse(await readFile(result.path, 'utf8'));
  const byId = new Map(persisted.goals.map((goal) => [goal.goalId, goal]));

  assert.ok(byId.has('operator_custom_goal'));
  assert.equal(byId.get('operator_custom_goal').label, 'Operator custom KPI');

  assert.equal(byId.get('primary_test_pass').label, 'Operator primary test label');
  assert.equal(byId.get('primary_test_pass').targetCommand, 'npm run test:ci');
  assert.equal(byId.get('primary_test_pass').metric, 'operator_exit_code');

  for (const goalId of BUILTIN_GOAL_IDS) {
    assert.ok(byId.has(goalId), `scaffold must include built-in goal ${goalId}`);
  }
});
