import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { installPiPackage } from '../src/harness-sidecar/capabilities/piPackageInstaller.js';

async function withTempRoot(prefix, fn) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
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

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test('installs a local helios package into workspace .harness and returns capability records', async () => {
  await withTempRoot('helios-package-installer-', async (root) => {
    const workspaceRoot = path.join(root, 'workspace');
    const packageRoot = path.join(root, 'package');

    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: 'research-kit',
      name: 'Research Kit',
      version: '1.2.3',
      skills: [
        { id: 'literature-review', name: 'Literature Review', path: 'skills/literature-review/SKILL.md' },
      ],
      templates: [
        { id: 'bugfix', name: 'Bugfix Plan', path: 'templates/bugfix.md' },
      ],
      slashCommands: [
        { id: 'research', name: 'Research Command', path: 'slash-commands/research.json' },
      ],
      piExtensions: [
        { id: 'kwargs', name: 'Kwargs Extension', path: 'extensions/kwargs.ts' },
      ],
    });
    await writeText(path.join(packageRoot, 'skills/literature-review/SKILL.md'), '# Literature Review\n');
    await writeText(path.join(packageRoot, 'templates/bugfix.md'), '# Bugfix\n');
    await writeJson(path.join(packageRoot, 'slash-commands/research.json'), { command: 'research' });
    await writeText(path.join(packageRoot, 'extensions/kwargs.ts'), 'export default {}\n');
    await writeText(path.join(packageRoot, 'ignored.txt'), 'must not be copied\n');

    const result = await installPiPackage({
      workspaceRoot,
      packageRoot,
      now: () => '2026-06-07T12:00:00.000Z',
    });

    const installRoot = path.join(workspaceRoot, '.harness', 'packages', 'research-kit');
    assert.equal(result.installRoot, installRoot);
    assert.equal(result.packageRecord.id, 'package:research-kit');
    assert.equal(result.packageRecord.type, 'package');
    assert.equal(result.packageRecord.packageId, 'research-kit');
    assert.equal(result.packageRecord.name, 'Research Kit');
    assert.equal(result.packageRecord.version, '1.2.3');
    assert.equal(result.packageRecord.path, installRoot);
    assert.equal(result.packageRecord.installedAt, '2026-06-07T12:00:00.000Z');

    assert.deepEqual(
      result.capabilities.map((capability) => [capability.type, capability.id, capability.packageId]),
      [
        ['skill', 'research-kit:skill:literature-review', 'research-kit'],
        ['template', 'research-kit:template:bugfix', 'research-kit'],
        ['slash_command', 'research-kit:slash_command:research', 'research-kit'],
        ['pi_extension', 'research-kit:pi_extension:kwargs', 'research-kit'],
      ],
    );

    const installedSkill = path.join(installRoot, 'skills/literature-review/SKILL.md');
    const installedTemplate = path.join(installRoot, 'templates/bugfix.md');
    const installedSlashCommand = path.join(installRoot, 'slash-commands/research.json');
    const installedExtension = path.join(installRoot, 'extensions/kwargs.ts');

    assert.equal(await readFile(installedSkill, 'utf8'), '# Literature Review\n');
    assert.equal(await readFile(installedTemplate, 'utf8'), '# Bugfix\n');
    assert.deepEqual(JSON.parse(await readFile(installedSlashCommand, 'utf8')), { command: 'research' });
    assert.equal(await readFile(installedExtension, 'utf8'), 'export default {}\n');
    assert.equal(await exists(path.join(installRoot, 'ignored.txt')), false);

    assert.deepEqual(
      result.capabilities.map((capability) => capability.path),
      [installedSkill, installedTemplate, installedSlashCommand, installedExtension],
    );
  });
});

test('rejects unsafe package ids before creating an install directory', async () => {
  await withTempRoot('helios-package-installer-', async (root) => {
    const workspaceRoot = path.join(root, 'workspace');
    const packageRoot = path.join(root, 'package');

    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: '../global-pi',
      name: 'Bad Package',
      version: '1.0.0',
      skills: [],
      templates: [],
      slashCommands: [],
      piExtensions: [],
    });

    await assert.rejects(
      () => installPiPackage({ workspaceRoot, packageRoot }),
      /unsafe package id/i,
    );

    assert.equal(await exists(path.join(workspaceRoot, '.harness', 'packages')), false);
  });
});

test('rejects manifest asset paths that escape the package root', async () => {
  await withTempRoot('helios-package-installer-', async (root) => {
    const workspaceRoot = path.join(root, 'workspace');
    const packageRoot = path.join(root, 'package');

    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: 'escape-kit',
      name: 'Escape Kit',
      version: '1.0.0',
      skills: [
        { id: 'outside', name: 'Outside Skill', path: '../outside/SKILL.md' },
      ],
      templates: [],
      slashCommands: [],
      piExtensions: [],
    });

    await assert.rejects(
      () => installPiPackage({ workspaceRoot, packageRoot }),
      /outside package root/i,
    );

    assert.equal(await exists(path.join(workspaceRoot, '.harness', 'packages', 'escape-kit')), false);
  });
});

test('rejects manifest assets that resolve through symlinks outside the package root', async (t) => {
  await withTempRoot('helios-package-installer-', async (root) => {
    const workspaceRoot = path.join(root, 'workspace');
    const packageRoot = path.join(root, 'package');
    const outsideRoot = path.join(root, 'outside');

    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: 'symlink-kit',
      name: 'Symlink Kit',
      version: '1.0.0',
      skills: [
        { id: 'outside', name: 'Outside Skill', path: 'skills/outside/SKILL.md' },
      ],
      templates: [],
      slashCommands: [],
      piExtensions: [],
    });
    await writeText(path.join(outsideRoot, 'SKILL.md'), '# Outside\n');
    await mkdir(path.join(packageRoot, 'skills'), { recursive: true });
    try {
      await symlink(outsideRoot, path.join(packageRoot, 'skills', 'outside'), 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP') {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => installPiPackage({ workspaceRoot, packageRoot }),
      /outside package root/i,
    );
  });
});

test('rejects workspace package destinations that resolve through symlinks', async (t) => {
  await withTempRoot('helios-package-installer-', async (root) => {
    const workspaceRoot = path.join(root, 'workspace');
    const packageRoot = path.join(root, 'package');
    const redirectedPackages = path.join(root, 'redirected-packages');

    await writeJson(path.join(packageRoot, 'helios-package.json'), {
      id: 'redirect-kit',
      name: 'Redirect Kit',
      version: '1.0.0',
      skills: [],
      templates: [],
      slashCommands: [],
      piExtensions: [],
    });
    await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
    await mkdir(redirectedPackages, { recursive: true });
    try {
      await symlink(redirectedPackages, path.join(workspaceRoot, '.harness', 'packages'), 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP') {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => installPiPackage({ workspaceRoot, packageRoot }),
      /unsafe package destination/i,
    );
  });
});
