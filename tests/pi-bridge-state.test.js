import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHarnessSidecar } from '../src/harness-sidecar/server.js';
import { buildPiBridgeState } from '../src/harness-sidecar/pi/piBridgeState.js';

async function withWorkspace(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'helios-pi-bridge-state-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

test('buildPiBridgeState reports bridge health and missing default package diagnostics without repairing automatically', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const repoRoot = path.join(workspaceRoot, 'repo');
    await writeJson(path.join(repoRoot, 'packages', 'helios-research-harness', 'helios-package.json'), {
      id: 'helios-research-harness',
      name: 'Helios Research Harness',
      version: '0.1.0',
      skills: [{ id: 'deep-research', name: 'Deep Research', path: 'skills/deep-research/SKILL.md' }],
      piExtensions: [{ id: 'kwargs', name: 'Kwargs', path: 'extensions/kwargs.ts' }],
    });
    await writeText(
      path.join(repoRoot, 'packages', 'helios-research-harness', 'skills', 'deep-research', 'SKILL.md'),
      '# Deep Research\n\nUse for source-grounded research.\n',
    );

    const state = await buildPiBridgeState({
      workspaceRoot,
      repoRoot,
      piExtensionsDir: path.join(workspaceRoot, 'pi-extensions'),
      piState: {
        model: {
          provider: 'Zeus',
          id: 'qwen-thinking',
          args: '--chat-template-kwargs \'{"enable_thinking":true}\'',
        },
        extensions: [{ id: 'kwargs', installed: true }],
        reasoningParserForwarded: true,
      },
    });

    assert.deepEqual(state.bridgeHealth, {
      manifestPresent: false,
      manifestConsumedByPi: false,
      defaultPackageInstalled: false,
      piKwargsExtensionInstalled: false,
      piHeliosForgeExtensionInstalled: false,
      workspacePackageExtensions: {
        kwargs: false,
        heliosForge: false,
      },
      piGlobalExtensions: {
        kwargs: false,
        heliosForge: false,
      },
      reasoningParserForwarded: true,
      activeModelThinkingEnabled: true,
    });
    assert.deepEqual(
      state.diagnostics.missingDefaultPackage.map((entry) => entry.path),
      [
        path.join(workspaceRoot, '.harness', 'capabilities.json'),
        path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'),
        path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness'),
      ],
    );
    assert.equal(state.repairPlan.action, 'run_setup');
    assert.equal(state.repairPlan.automatic, false);
    assert.equal(state.repairPlan.command, 'npm run setup -- --workspace <workspaceRoot>');
    assert.equal(state.repairPlan.scriptPath, path.join(repoRoot, 'scripts', 'setup-helios-forge.js'));
  });
});

test('buildPiBridgeState reports installed package and manifest consumption when workspace state is present', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const repoRoot = path.join(workspaceRoot, 'repo');
    await writeJson(path.join(repoRoot, 'packages', 'helios-research-harness', 'helios-package.json'), {
      id: 'helios-research-harness',
      name: 'Helios Research Harness',
      version: '0.1.0',
      skills: [{ id: 'deep-research', name: 'Deep Research', path: 'skills/deep-research/SKILL.md' }],
      piExtensions: [
        { id: 'kwargs', name: 'Kwargs', path: 'extensions/kwargs.ts' },
        { id: 'helios-forge', name: 'Helios Forge', path: 'extensions/helios-forge.ts' },
      ],
    });
    await writeText(
      path.join(repoRoot, 'packages', 'helios-research-harness', 'skills', 'deep-research', 'SKILL.md'),
      '# Deep Research\n\nUse for source-grounded research.\n',
    );
    await writeJson(path.join(workspaceRoot, '.harness', 'capabilities.json'), {
      capabilities: [
        {
          id: 'helios-research-harness:pi_extension:kwargs',
          type: 'pi_extension',
          name: 'Model Args and Thinking Preservation',
          enabled: true,
          packageId: 'helios-research-harness',
          path: path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'extensions', 'kwargs.ts'),
        },
        {
          id: 'helios-research-harness:pi_extension:helios-forge',
          type: 'pi_extension',
          name: 'Helios Forge Bridge Metadata',
          enabled: true,
          packageId: 'helios-research-harness',
          path: path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'extensions', 'helios-forge.ts'),
        },
      ],
    });
    await writeJson(path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'), { capabilities: [] });
    await writeText(path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'extensions', 'kwargs.ts'), 'export default {}\n');
    await writeText(path.join(workspaceRoot, '.harness', 'packages', 'helios-research-harness', 'extensions', 'helios-forge.ts'), 'export default {}\n');
    await writeText(path.join(workspaceRoot, 'pi-extensions', 'kwargs.ts'), 'export default {}\n');
    await writeText(path.join(workspaceRoot, 'pi-extensions', 'helios-forge.ts'), 'export default {}\n');

    const state = await buildPiBridgeState({
      workspaceRoot,
      repoRoot,
      piExtensionsDir: path.join(workspaceRoot, 'pi-extensions'),
      manifestConsumedByPi: true,
      piState: {
        model: {
          provider: 'Zeus',
          id: 'qwen-no-thinking',
          args: '--chat-template-kwargs \'{"enable_thinking":false}\'',
        },
      },
    });

    assert.equal(state.bridgeHealth.manifestPresent, true);
    assert.equal(state.bridgeHealth.manifestConsumedByPi, true);
    assert.equal(state.bridgeHealth.defaultPackageInstalled, true);
    assert.equal(state.bridgeHealth.piKwargsExtensionInstalled, true);
    assert.equal(state.bridgeHealth.piHeliosForgeExtensionInstalled, true);
    assert.deepEqual(state.bridgeHealth.workspacePackageExtensions, {
      kwargs: true,
      heliosForge: true,
    });
    assert.deepEqual(state.bridgeHealth.piGlobalExtensions, {
      kwargs: true,
      heliosForge: true,
    });
    assert.equal(state.bridgeHealth.reasoningParserForwarded, false);
    assert.equal(state.bridgeHealth.activeModelThinkingEnabled, false);
    assert.equal(state.skillInventory.skills.length, 1);
    assert.equal(state.skillInventory.skills[0].id, 'helios-research-harness:skill:deep-research');
    assert.equal(state.diagnostics.missingDefaultPackage.length, 0);
    assert.equal(state.repairPlan, null);
  });
});

test('sidecar exposes safe Pi bridge state over HTTP', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
    await sidecar.start();
    try {
      const otherWorkspace = path.join(workspaceRoot, 'other-workspace');
      const response = await fetch(`${sidecar.url}/v1/pi-bridge/state?workspaceRoot=${encodeURIComponent(otherWorkspace)}`);
      assert.equal(response.status, 200);
      const body = await response.json();

      assert.equal(body.workspaceRoot, path.resolve(workspaceRoot));
      assert.notEqual(body.workspaceRoot, path.resolve(otherWorkspace));
      assert.equal(body.bridgeHealth.manifestPresent, false);
      assert.equal(body.bridgeHealth.defaultPackageInstalled, false);
      assert.ok(Array.isArray(body.skillInventory.skills));
      assert.equal(body.repairPlan.automatic, false);
      assert.equal(body.diagnostics.missingDefaultPackage.length, 3);
    } finally {
      await sidecar.stop();
    }
  });
});
