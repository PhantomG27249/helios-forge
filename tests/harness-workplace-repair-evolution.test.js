import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { repairWorkplace } from '../src/harness/harnessConfigService.js';

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function seedCompleteOperatorWorkplace(workspaceRoot, {
  projectName = 'Operator Custom Workplace',
  maxToolCalls = 42,
} = {}) {
  const harnessDir = path.join(workspaceRoot, '.harness');
  await mkdir(path.join(harnessDir, 'runtime'), { recursive: true });
  await mkdir(path.join(harnessDir, 'packages', 'helios-research-harness'), { recursive: true });
  await writeFile(
    path.join(harnessDir, 'config.yaml'),
    [
      'project:',
      `  name: ${projectName}`,
      'budgets:',
      `  maxToolCalls: ${maxToolCalls}`,
      'defaults:',
      '  modelProfile: alphahelion_ebft5',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(harnessDir, 'capabilities.json'),
    JSON.stringify({ capabilities: [{ id: 'helios-research-harness:skill:demo', path: 'demo' }] }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(harnessDir, 'runtime', 'capabilities.mount.json'),
    JSON.stringify({ profileId: 'default', capabilities: [] }, null, 2),
    'utf8',
  );
  await writeFile(path.join(harnessDir, 'packages', 'helios-research-harness', '.installed'), 'ok\n', 'utf8');
}

test('G6: repairWorkplace upgrades existing workplace without wiping operator config', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-repair-evolution-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const projectName = 'Operator Custom Workplace';
  const maxToolCalls = 42;
  await seedCompleteOperatorWorkplace(workspaceRoot, { projectName, maxToolCalls });

  const result = await repairWorkplace(workspaceRoot);
  assert.ok(
    result.repairs.includes('evolution') || result.repairs.includes('evolution_scaffold'),
    'repairWorkplace should report evolution scaffold merge for complete workplaces missing evolution assets',
  );

  const configPath = path.join(workspaceRoot, '.harness', 'config.yaml');
  const configText = await readFile(configPath, 'utf8');
  assert.match(configText, new RegExp(`name: ${projectName}`));
  assert.match(configText, /maxToolCalls: 42/);
  assert.match(configText, /evolution:/);
  assert.match(configText, /syntheticReplay: false/);
  assert.match(configText, /defaultSuiteId: workplace-smoke/);

  const suitePath = path.join(
    workspaceRoot,
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  assert.ok(
    await exists(suitePath),
    'repairWorkplace must scaffold workplace-smoke held-out suite without wiping operator config',
  );

  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.equal(suite.id, 'workplace-smoke');
  assert.ok(Array.isArray(suite.cases) && suite.cases.length >= 2);
});

test('G6: repairWorkplace preserves operator evolution overrides during scaffold merge', async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-repair-evolution-preserve-'));
  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const harnessDir = path.join(workspaceRoot, '.harness');
  await mkdir(path.join(harnessDir, 'runtime'), { recursive: true });
  await mkdir(path.join(harnessDir, 'packages', 'helios-research-harness'), { recursive: true });
  await writeFile(
    path.join(harnessDir, 'config.yaml'),
    [
      'project:',
      '  name: Operator Evolution Overrides',
      'evolution:',
      '  syntheticReplay: true',
      '  campaignMaxCycles: 9',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(harnessDir, 'capabilities.json'),
    JSON.stringify({ capabilities: [] }, null, 2),
    'utf8',
  );
  await writeFile(
    path.join(harnessDir, 'runtime', 'capabilities.mount.json'),
    JSON.stringify({ profileId: 'default', capabilities: [] }, null, 2),
    'utf8',
  );
  await writeFile(path.join(harnessDir, 'packages', 'helios-research-harness', '.installed'), 'ok\n', 'utf8');
  await mkdir(path.join(harnessDir, 'benchmarks', 'suites'), { recursive: true });
  await writeFile(
    path.join(harnessDir, 'benchmarks', 'suites', 'workplace-smoke.json'),
    JSON.stringify({ id: 'workplace-smoke', operator: true }, null, 2),
    'utf8',
  );

  await repairWorkplace(workspaceRoot);

  const configText = await readFile(path.join(harnessDir, 'config.yaml'), 'utf8');
  assert.match(configText, /name: Operator Evolution Overrides/);
  assert.match(configText, /syntheticReplay: true/);
  assert.match(configText, /campaignMaxCycles: 9/);
  assert.match(configText, /defaultSuiteId: workplace-smoke/);

  const suite = JSON.parse(await readFile(
    path.join(harnessDir, 'benchmarks', 'suites', 'workplace-smoke.json'),
    'utf8',
  ));
  assert.equal(suite.operator, true, 'repair must not overwrite operator-authored suite JSON');
});
