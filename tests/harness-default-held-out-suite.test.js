import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildDefaultHeldOutSuite,
  detectWorkplaceTestRunner,
} from '../src/harness-sidecar/benchmarks/defaultHeldOutSuite.js';

function runSuiteCaseCommand(workspaceRoot, benchmarkCase) {
  const command = benchmarkCase.command;
  assert.ok(command?.executable, 'case command executable is required');
  const useShell = process.platform === 'win32' && command.executable === 'npm';
  return spawnSync(command.executable, command.args || [], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: useShell,
  });
}

test('detectWorkplaceTestRunner prefers node --test when package.json scripts.test uses it', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-node-test-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test' } }),
    'utf8',
  );

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'node-test');
  assert.equal(detected.executable, 'node');
  assert.deepEqual(detected.args, ['--test']);
});

test('detectWorkplaceTestRunner uses npm test for other package.json test scripts', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-npm-test-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    'utf8',
  );

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'npm-test');
  assert.equal(detected.executable, 'npm');
  assert.deepEqual(detected.args, ['test']);
});

test('detectWorkplaceTestRunner detects python pytest projects', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-pytest-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(workspaceRoot, 'pyproject.toml'), '[tool.pytest.ini_options]\n', 'utf8');

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'pytest');
  assert.equal(detected.executable, 'python');
  assert.deepEqual(detected.args, ['-m', 'pytest']);
});

test('detectWorkplaceTestRunner falls back to node exit sanity command', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-fallback-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const detected = await detectWorkplaceTestRunner(workspaceRoot);
  assert.equal(detected.type, 'noop');
  assert.equal(detected.executable, 'node');
  assert.deepEqual(detected.args, ['-e', 'process.exit(0)']);
});

test('buildDefaultHeldOutSuite returns 2-3 cases with real exit codes', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-suite-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(workspaceRoot, 'tests'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --test' } }),
    'utf8',
  );
  await writeFile(
    path.join(workspaceRoot, 'tests', 'smoke.test.js'),
    'import test from "node:test";\ntest("smoke", () => {});\n',
    'utf8',
  );

  const suite = await buildDefaultHeldOutSuite({ workspaceRoot });

  assert.equal(suite.id, 'workplace-smoke');
  assert.ok(suite.cases.length >= 2 && suite.cases.length <= 3);
  assert.ok(suite.domains.includes('code'));

  for (const benchmarkCase of suite.cases) {
    const result = runSuiteCaseCommand(workspaceRoot, benchmarkCase);
    assert.equal(
      result.status,
      0,
      `case ${benchmarkCase.id} exited ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
});

test('buildDefaultHeldOutSuite npm-test case runs with real exit code', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-held-out-npm-suite-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    'utf8',
  );

  const suite = await buildDefaultHeldOutSuite({ workspaceRoot });
  const primary = suite.cases.find((benchmarkCase) => benchmarkCase.id === 'workplace-primary-test');
  assert.ok(primary);
  assert.equal(primary.command.executable, 'npm');

  const result = runSuiteCaseCommand(workspaceRoot, primary);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
