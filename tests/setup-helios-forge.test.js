import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { setupHeliosForge } from '../scripts/setup-helios-forge.js';

async function withTempRoot(prefix, fn) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test('setup creates local harness config, installs bundled package, and mounts capabilities', async () => {
  await withTempRoot('helios-setup-', async (workspaceRoot) => {
    const result = await setupHeliosForge({
      workspaceRoot,
      now: () => '2026-06-07T12:00:00.000Z',
    });

    assert.equal(result.workspaceRoot, workspaceRoot);
    assert.equal(result.config.created, true);
    assert.equal(result.packageRecord.packageId, 'helios-research-harness');
    assert.equal(result.capabilityCount, 10);
    assert.equal(result.runtimeCounts.enabled, 10);
    assert.equal(result.runtimeCounts.skill, 3);
    assert.equal(result.runtimeCounts.template, 3);
    assert.equal(result.runtimeCounts.slash_command, 3);
    assert.equal(result.runtimeCounts.pi_extension, 1);

    const configPath = path.join(workspaceRoot, '.harness', 'config.yaml');
    const registryPath = path.join(workspaceRoot, '.harness', 'capabilities.json');
    const runtimeManifestPath = path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json');
    assert.equal(result.config.configPath, configPath);
    assert.equal(result.runtimeManifestPath, runtimeManifestPath);
    const configText = await readFile(configPath, 'utf8');
    assert.match(configText, /name: Helios Forge/);
    assert.match(configText, /modelDrivenSwarm: true/);
    assert.match(configText, /piNativeSwarm: true/);
    assert.match(configText, /autonomousToolLoop: true/);
    assert.match(configText, /adaptiveSearch: true/);
    assert.match(configText, /safeApply: true/);
    assert.match(configText, /mode: advisory/);

    const registry = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(registry.capabilities.length, 10);
    assert.equal(
      registry.capabilities.every((capability) => capability.path.startsWith(path.join(workspaceRoot, '.harness', 'packages'))),
      true,
    );

    const manifest = JSON.parse(await readFile(runtimeManifestPath, 'utf8'));
    assert.equal(manifest.profileId, 'default');
    assert.equal(manifest.capabilities.length, 10);
    assert.equal(manifest.byType.slash_command.length, 3);
    assert.equal(await exists(path.join(workspaceRoot, '.pi')), false);
  });
});

test('setup preserves existing config unless forceConfig is requested', async () => {
  await withTempRoot('helios-setup-', async (workspaceRoot) => {
    const configPath = path.join(workspaceRoot, '.harness', 'config.yaml');
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, 'project:\n  name: Existing Workspace\n', 'utf8');

    const preserved = await setupHeliosForge({ workspaceRoot });
    assert.equal(preserved.config.created, false);
    assert.equal(await readFile(configPath, 'utf8'), 'project:\n  name: Existing Workspace\n');

    const replaced = await setupHeliosForge({ workspaceRoot, forceConfig: true });
    assert.equal(replaced.config.created, true);
    assert.match(await readFile(configPath, 'utf8'), /name: Helios Forge/);
  });
});
