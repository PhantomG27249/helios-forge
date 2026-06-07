import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildRuntimeMountManifest,
  deleteCapabilityRecord,
  loadCapabilityRegistry,
  saveCapabilityRecord,
} from '../src/harness-sidecar/capabilities/capabilityStore.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-capabilities-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('capability store returns UI-ready defaults when registry is absent', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const registry = await loadCapabilityRegistry({ workspaceRoot });

    assert.equal(registry.version, 1);
    assert.deepEqual(registry.capabilities, []);
    assert.deepEqual(registry.byType, {
      skill: [],
      mcp: [],
      pi_extension: [],
      profile: [],
      template: [],
      slash_command: [],
    });
    assert.deepEqual(registry.counts, {
      skill: 0,
      mcp: 0,
      pi_extension: 0,
      profile: 0,
      template: 0,
      slash_command: 0,
      enabled: 0,
    });
  });
});

test('capability store normalizes supported types and writes only project registry', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, 'tools'), { recursive: true });

    const savedSkill = await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'skill-one',
        type: 'Skill',
        name: 'Workspace Skill',
        path: 'tools',
        enabled: true,
      },
    });
    const savedMcp = await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'mcp-one',
        type: 'MCP',
        name: 'Workspace MCP',
        command: 'node server.js',
      },
    });
    const savedExtension = await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'pi-ext-one',
        type: 'pi-extension',
        name: 'Pi Extension',
        folder: 'tools',
      },
    });
    const savedProfile = await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'profile-one',
        type: 'profile',
        name: 'Profile',
      },
    });

    assert.equal(savedSkill.type, 'skill');
    assert.equal(savedMcp.type, 'mcp');
    assert.equal(savedExtension.type, 'pi_extension');
    assert.equal(savedProfile.type, 'profile');

    const registry = await loadCapabilityRegistry({ workspaceRoot });
    assert.deepEqual(Object.keys(registry.byType).sort(), ['mcp', 'pi_extension', 'profile', 'skill', 'slash_command', 'template']);
    assert.equal(registry.byType.skill.length, 1);
    assert.equal(registry.byType.mcp.length, 1);
    assert.equal(registry.byType.pi_extension.length, 1);
    assert.equal(registry.byType.profile.length, 1);

    const registryPath = path.join(workspaceRoot, '.harness', 'capabilities.json');
    const savedRegistry = JSON.parse(await readFile(registryPath, 'utf8'));
    assert.equal(savedRegistry.capabilities.length, 4);
  });
});

test('capability store rejects local paths outside the workspace', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await assert.rejects(
      () => saveCapabilityRecord({
        workspaceRoot,
        record: {
          id: 'bad-path',
          type: 'skill',
          name: 'Bad Path',
          path: '..',
        },
      }),
      /outside workspace/i,
    );

    await assert.rejects(
      () => saveCapabilityRecord({
        workspaceRoot,
        record: {
          id: 'global-pi',
          type: 'pi_extension',
          name: 'Global Pi',
          folder: 'C:\\Users\\jackj\\.pi\\agent\\extensions\\global-extension',
        },
      }),
      /outside workspace/i,
    );
  });
});

test('capability store redacts secret-like env values while preserving env var names', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const saved = await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'mcp-secret',
        type: 'mcp',
        name: 'Secret MCP',
        env: {
          OPENAI_API_KEY: 'sk-real-value',
          PLAIN_MODE: 'debug',
          SESSION_TOKEN: 'tok-real-value',
        },
      },
    });

    assert.deepEqual(Object.keys(saved.env).sort(), ['OPENAI_API_KEY', 'PLAIN_MODE', 'SESSION_TOKEN']);
    assert.equal(saved.env.OPENAI_API_KEY, '[redacted]');
    assert.equal(saved.env.SESSION_TOKEN, '[redacted]');
    assert.equal(saved.env.PLAIN_MODE, 'debug');
  });
});

test('capability store deletes records and builds enabled-only runtime manifest', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'enabled-skill',
        type: 'skill',
        name: 'Enabled Skill',
        enabled: true,
      },
    });
    await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'disabled-mcp',
        type: 'mcp',
        name: 'Disabled MCP',
        enabled: false,
      },
    });
    await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'enabled-profile',
        type: 'profile',
        name: 'Enabled Profile',
        enabled: true,
      },
    });
    await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'enabled-research-command',
        type: 'slash-command',
        name: 'Research Command',
        enabled: true,
      },
    });
    await saveCapabilityRecord({
      workspaceRoot,
      record: {
        id: 'enabled-brief-template',
        type: 'template',
        name: 'Brief Template',
        enabled: true,
      },
    });

    const afterDelete = await deleteCapabilityRecord({ workspaceRoot, capabilityId: 'enabled-profile' });
    assert.deepEqual(afterDelete.capabilities.map((record) => record.id), [
      'enabled-skill',
      'disabled-mcp',
      'enabled-research-command',
      'enabled-brief-template',
    ]);

    const manifest = await buildRuntimeMountManifest({ workspaceRoot, profileId: 'default' });
    assert.equal(manifest.profileId, 'default');
    assert.equal(manifest.manifestPath, path.join(workspaceRoot, '.harness', 'runtime', 'capabilities.mount.json'));
    assert.deepEqual(manifest.capabilities.map((record) => record.id), [
      'enabled-skill',
      'enabled-research-command',
      'enabled-brief-template',
    ]);
    assert.deepEqual(manifest.counts, {
      skill: 1,
      mcp: 0,
      pi_extension: 0,
      profile: 0,
      template: 1,
      slash_command: 1,
      enabled: 3,
    });

    const writtenManifest = JSON.parse(await readFile(manifest.manifestPath, 'utf8'));
    assert.deepEqual(writtenManifest.capabilities.map((record) => record.id), [
      'enabled-skill',
      'enabled-research-command',
      'enabled-brief-template',
    ]);
  });
});
