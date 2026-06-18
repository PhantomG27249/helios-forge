import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildDefaultHeldOutSuite,
  mergeHeldOutSuiteWithDefaults,
} from '../src/harness-sidecar/benchmarks/defaultHeldOutSuite.js';
import {
  detectWorkplaceTestRunner,
  parseShellCommand,
} from '../src/harness-sidecar/benchmarks/workplaceSuiteDetector.js';
import { scaffoldWorkplaceEvolution } from '../src/harness-sidecar/meta/harnessEvolutionDefaults.js';

test('parseShellCommand splits common test invocations', () => {
  assert.deepEqual(parseShellCommand('npm test'), {
    executable: 'npm',
    args: ['test'],
  });
  assert.deepEqual(parseShellCommand('node --test'), {
    executable: 'node',
    args: ['--test'],
  });
  assert.deepEqual(parseShellCommand('node --test tests/'), {
    executable: 'node',
    args: ['--test', 'tests/'],
  });
  assert.deepEqual(parseShellCommand('python -m pytest'), {
    executable: 'python',
    args: ['-m', 'pytest'],
  });
});

test('detectWorkplaceTestRunner finds npm test from package.json scripts.test', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-npm-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'jest --runInBand' } }),
    'utf8',
  );

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'npm-test');
  assert.equal(detected.executable, 'npm');
  assert.deepEqual(detected.args, ['test']);
});

test('detectWorkplaceTestRunner finds node --test from package.json scripts.test', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-node-test-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test tests/' } }),
    'utf8',
  );

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'node-test');
  assert.equal(detected.executable, 'node');
  assert.deepEqual(detected.args, ['--test', 'tests/']);
});

test('detectWorkplaceTestRunner finds python -m pytest from pyproject.toml markers', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-pytest-'));
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

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'pytest');
  assert.equal(detected.executable, 'python');
  assert.deepEqual(detected.args, ['-m', 'pytest']);
});

test('detectWorkplaceTestRunner finds pyproject.toml hatch test script pattern', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-hatch-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'pyproject.toml'),
    [
      '[tool.hatch.envs.default.scripts]',
      'test = "pytest -q"',
      '',
    ].join('\n'),
    'utf8',
  );

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'pyproject-script');
  assert.equal(detected.executable, 'pytest');
  assert.deepEqual(detected.args, ['-q']);
});

test('detectWorkplaceTestRunner uses workplace metadata primaryTestCommand', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-metadata-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const detected = await detectWorkplaceTestRunner(workspaceRoot, {
    benchmarks: {
      primaryTestCommand: 'python scripts/test_v3_paper.py',
    },
  });

  assert.equal(detected.type, 'metadata');
  assert.equal(detected.executable, 'python');
  assert.deepEqual(detected.args, ['scripts/test_v3_paper.py']);
});

test('detectWorkplaceTestRunner falls back to placeholder with advisory when no tests found', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-detector-placeholder-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'noop');
  assert.equal(detected.executable, 'node');
  assert.deepEqual(detected.args, ['-e', 'process.exit(0)']);
  assert.deepEqual(detected.advisory, { reason: 'placeholder_suite' });
});

test('buildDefaultHeldOutSuite adds placeholder_suite advisory metadata on fallback', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-suite-placeholder-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const suite = await buildDefaultHeldOutSuite({ workspaceRoot });
  assert.deepEqual(suite.advisory, { reason: 'placeholder_suite' });
});

test('mergeHeldOutSuiteWithDefaults preserves operator-edited cases by id', () => {
  const defaults = {
    id: 'workplace-smoke',
    schemaVersion: 1,
    cases: [
      {
        id: 'workplace-primary-test',
        domain: 'code',
        command: { executable: 'npm', args: ['test'] },
      },
      {
        id: 'workplace-exit-sanity',
        domain: 'safety',
        command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
      },
      {
        id: 'workplace-inline-pass',
        domain: 'code',
        command: { executable: 'node', args: ['-e', 'process.exit(0)'] },
      },
    ],
  };
  const operator = {
    id: 'workplace-smoke',
    operator: true,
    cases: [
      {
        id: 'workplace-primary-test',
        domain: 'code',
        description: 'Operator custom primary test',
        command: { executable: 'python', args: ['scripts/custom_tests.py'] },
      },
    ],
  };

  const merged = mergeHeldOutSuiteWithDefaults(operator, defaults);
  assert.equal(merged.operator, true);
  assert.equal(merged.cases.length, 3);

  const primary = merged.cases.find((benchmarkCase) => benchmarkCase.id === 'workplace-primary-test');
  assert.equal(primary.command.executable, 'python');
  assert.deepEqual(primary.command.args, ['scripts/custom_tests.py']);
  assert.ok(merged.cases.some((benchmarkCase) => benchmarkCase.id === 'workplace-exit-sanity'));
  assert.ok(merged.cases.some((benchmarkCase) => benchmarkCase.id === 'workplace-inline-pass'));
});

test('scaffoldWorkplaceEvolution merge-only repair keeps operator suite cases', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-scaffold-merge-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(workspaceRoot, '.harness', 'benchmarks', 'suites'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, '.harness', 'config.yaml'),
    [
      'project:',
      '  name: Merge Repair Workplace',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(workspaceRoot, '.harness', 'benchmarks', 'suites', 'workplace-smoke.json'),
    JSON.stringify({
      id: 'workplace-smoke',
      operator: true,
      cases: [
        {
          id: 'workplace-primary-test',
          domain: 'code',
          description: 'Operator custom primary test',
          command: { executable: 'python', args: ['scripts/custom_tests.py'] },
        },
      ],
    }, null, 2),
    'utf8',
  );

  await scaffoldWorkplaceEvolution({ workspaceRoot, harnessConfig: {} });

  const suite = JSON.parse(await readFile(
    path.join(workspaceRoot, '.harness', 'benchmarks', 'suites', 'workplace-smoke.json'),
    'utf8',
  ));

  assert.equal(suite.operator, true);
  const primary = suite.cases.find((benchmarkCase) => benchmarkCase.id === 'workplace-primary-test');
  assert.equal(primary.command.executable, 'python');
  assert.deepEqual(primary.command.args, ['scripts/custom_tests.py']);
  assert.ok(suite.cases.length >= 2, 'repair merge should add missing default cases');
  assert.ok(suite.cases.some((benchmarkCase) => benchmarkCase.id === 'workplace-exit-sanity'));
});
