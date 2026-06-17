import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  CONFIG_PRESETS,
  applyConfigPreset,
  getHarnessConfig,
  patchHarnessConfig,
} from '../src/harness/harnessConfigService.js';
import { getWorkplaceStatus } from '../src/harness/workplaceStatus.js';

async function withTempWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-workplace-'));
  try {
    await testFn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('getWorkplaceStatus reports missing harness artifacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const status = await getWorkplaceStatus(workspaceRoot);

    assert.equal(status.workspaceRoot, workspaceRoot);
    assert.equal(status.harnessDir.present, false);
    assert.equal(status.configYaml.present, false);
    assert.equal(status.capabilitiesJson.present, false);
    assert.equal(status.runtimeMount.present, false);
    assert.equal(status.bundledPackage.present, false);
    assert.match(status.configYaml.path, /[\\/]\.harness[\\/]config\.yaml$/);
  });
});

test('getWorkplaceStatus validates present artifacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(path.join(harnessDir, 'runtime'), { recursive: true });
    await mkdir(path.join(harnessDir, 'packages', 'helios-research-harness'), { recursive: true });
    await writeFile(
      path.join(harnessDir, 'config.yaml'),
      'project:\n  name: Test\n',
      'utf8',
    );
    await writeFile(
      path.join(harnessDir, 'capabilities.json'),
      JSON.stringify({ capabilities: [] }),
      'utf8',
    );
    await writeFile(
      path.join(harnessDir, 'runtime', 'capabilities.mount.json'),
      JSON.stringify({ profileId: 'default', capabilities: [] }),
      'utf8',
    );

    const status = await getWorkplaceStatus(workspaceRoot);

    assert.equal(status.harnessDir.present, true);
    assert.equal(status.configYaml.present, true);
    assert.equal(status.configYaml.error, undefined);
    assert.equal(status.capabilitiesJson.present, true);
    assert.equal(status.runtimeMount.present, true);
    assert.equal(status.bundledPackage.present, true);
  });
});

test('getWorkplaceStatus surfaces config parse errors', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'config.yaml'), 'invalid yaml line\n', 'utf8');

    const status = await getWorkplaceStatus(workspaceRoot);

    assert.equal(status.configYaml.present, true);
    assert.match(status.configYaml.error, /Invalid YAML line/);
  });
});

test('getHarnessConfig returns merged defaults when file is absent', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { config, path: configPath } = await getHarnessConfig(workspaceRoot);

    assert.match(configPath, /[\\/]\.harness[\\/]config\.yaml$/);
    assert.equal(config.project.name, 'Helios Forge');
    assert.equal(config.defaults.modelProfile, 'qwen36_vlm_fast');
  });
});

test('patchHarnessConfig deep merges and writes yaml', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(
      path.join(harnessDir, 'config.yaml'),
      'project:\n  name: Existing\nbudgets:\n  maxToolCalls: 10\n',
      'utf8',
    );

    const result = await patchHarnessConfig(workspaceRoot, {
      budgets: { maxWallMinutes: 25 },
      features: { swarm: true },
    });

    assert.equal(result.config.project.name, 'Existing');
    assert.equal(result.config.budgets.maxToolCalls, 10);
    assert.equal(result.config.budgets.maxWallMinutes, 25);
    assert.equal(result.config.features.swarm, true);

    const written = await readFile(path.join(harnessDir, 'config.yaml'), 'utf8');
    assert.match(written, /name: Existing/);
    assert.match(written, /maxWallMinutes: 25/);
    assert.match(written, /swarm: true/);
  });
});

test('applyConfigPreset merge preserves existing keys', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(
      path.join(harnessDir, 'config.yaml'),
      'project:\n  name: Custom\n',
      'utf8',
    );

    const result = await applyConfigPreset(workspaceRoot, {
      presetId: 'minimal',
      mode: 'merge',
    });

    assert.equal(result.presetId, 'minimal');
    assert.equal(result.mode, 'merge');
    assert.equal(result.config.project.name, 'Custom');
    assert.equal(result.config.features.swarm, false);
    assert.equal(result.config.budgets.maxToolCalls, 10);
  });
});

test('applyConfigPreset replace writes standard installer defaults', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(
      path.join(harnessDir, 'config.yaml'),
      'project:\n  name: Custom\n',
      'utf8',
    );

    const result = await applyConfigPreset(workspaceRoot, {
      presetId: 'standard',
      mode: 'replace',
    });

    assert.equal(result.config.defaults.modelProfile, 'alphahelion_ebft5');
    assert.equal(result.config.features.modelDrivenSwarm, true);
    assert.equal(result.config.features.adaptiveSearch, true);

    const written = await readFile(path.join(harnessDir, 'config.yaml'), 'utf8');
    assert.match(written, /modelProfile: alphahelion_ebft5/);
    assert.match(written, /modelDrivenSwarm: true/);
    assert.doesNotMatch(written, /name: Custom/);
  });
});

test('applyConfigPreset multi_model_swarm enables council scaffold', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await applyConfigPreset(workspaceRoot, {
      presetId: 'multi_model_swarm',
      mode: 'replace',
    });

    assert.equal(result.config.features.multiModelSwarm, true);
    assert.equal(result.config.modelCouncil.enabled, true);
    assert.equal(result.config.modelCouncil.roles.researcher.endpointProfile, 'local_deep');
    assert.equal(result.config.modelCouncil.endpointProfiles.local_deep.baseUrl, 'http://localhost:8000/v1');
    assert.equal(result.config.swarmExecution.workerMode, 'model_driven');
  });
});

test('CONFIG_PRESETS includes minimal, standard, and multi_model_swarm', () => {
  assert.ok(CONFIG_PRESETS.minimal);
  assert.ok(CONFIG_PRESETS.standard);
  assert.ok(CONFIG_PRESETS.multi_model_swarm);
  assert.equal(typeof CONFIG_PRESETS.standard, 'string');
  assert.match(CONFIG_PRESETS.standard, /modelDrivenSwarm: true/);
});
