import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ensureWorkspaceReady,
  loadOnboardingState,
  onboardingStatePath,
  saveOnboardingState,
} from '../src/electron/onboarding.js';

async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadOnboardingState returns defaults when file is missing', async () => {
  await withTempDir('electron-onboarding-', async (userDataDir) => {
    const state = await loadOnboardingState(userDataDir);
    assert.equal(state.completed, false);
    assert.equal(state.workspaceRoot, null);
  });
});

test('saveOnboardingState persists onboarding.json', async () => {
  await withTempDir('electron-onboarding-', async (userDataDir) => {
    const saved = await saveOnboardingState(userDataDir, {
      completed: true,
      workspaceRoot: 'C:\\work',
      lastSetupAt: '2026-06-16T00:00:00.000Z',
    });

    assert.equal(saved.completed, true);
    const loaded = await loadOnboardingState(userDataDir);
    assert.equal(loaded.workspaceRoot, 'C:\\work');
    assert.equal(onboardingStatePath(userDataDir).endsWith('onboarding.json'), true);
  });
});

test('ensureWorkspaceReady skips setup when workplace already has harness files', async () => {
  await withTempDir('electron-onboarding-', async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'config.yaml'), 'project:\n  name: Existing\n', 'utf8');
    await writeFile(path.join(harnessDir, 'capabilities.json'), '{"capabilities":[]}', 'utf8');

    let setupCalls = 0;
    const result = await ensureWorkspaceReady({
      workspaceRoot,
      bundledPackageRoot: path.join(workspaceRoot, 'unused-package'),
      setupHeliosForgeImpl: async () => {
        setupCalls += 1;
        return {};
      },
    });

    assert.equal(result.alreadyReady, true);
    assert.equal(result.setupRan, false);
    assert.equal(setupCalls, 0);
  });
});

test('ensureWorkspaceReady runs setup when capabilities.json is invalid JSON', async () => {
  await withTempDir('electron-onboarding-', async (workspaceRoot) => {
    const harnessDir = path.join(workspaceRoot, '.harness');
    await mkdir(harnessDir, { recursive: true });
    await writeFile(path.join(harnessDir, 'config.yaml'), 'project:\n  name: Existing\n', 'utf8');
    await writeFile(
      path.join(harnessDir, 'capabilities.json'),
      '{"capabilities":[]}\n{"capabilities":[]}\n',
      'utf8',
    );

    let setupCalls = 0;
    const result = await ensureWorkspaceReady({
      workspaceRoot,
      bundledPackageRoot: path.join(workspaceRoot, 'unused-package'),
      setupHeliosForgeImpl: async () => {
        setupCalls += 1;
        return { capabilityCount: 11 };
      },
    });

    assert.equal(result.alreadyReady, false);
    assert.equal(result.setupRan, true);
    assert.equal(setupCalls, 1);
  });
});

test('ensureWorkspaceReady runs setupHeliosForge when harness is missing', async () => {
  await withTempDir('electron-onboarding-', async (workspaceRoot) => {
    const calls = [];
    const result = await ensureWorkspaceReady({
      workspaceRoot,
      bundledPackageRoot: 'C:\\bundled\\helios-research-harness',
      setupHeliosForgeImpl: async (options) => {
        calls.push(options);
        return {
          capabilityCount: 11,
          runtimeManifestPath: path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'),
        };
      },
    });

    assert.equal(result.setupRan, true);
    assert.equal(result.alreadyReady, false);
    assert.equal(result.capabilityCount, 11);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].bundledPackageRoot, 'C:\\bundled\\helios-research-harness');
  });
});
