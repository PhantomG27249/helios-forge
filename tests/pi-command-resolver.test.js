import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { resolvePiCommand } from '../src/pi/resolvePiCommand.js';

test('pi command resolver uses PATH command when available', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helios-pi-path-'));
  try {
    const bin = path.join(root, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'pi.cmd'), '@echo off\n', 'utf8');

    const command = resolvePiCommand({
      env: { Path: bin, USERPROFILE: root, ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      platform: 'win32',
    });

    assert.equal(command.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(command.args, ['/d', '/s', '/c', path.join(bin, 'pi.cmd')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pi command resolver falls back to local pi-node install on Windows', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'helios-pi-home-'));
  try {
    const installDir = path.join(root, 'AppData', 'Local', 'pi-node', 'current');
    await mkdir(installDir, { recursive: true });
    await writeFile(path.join(installDir, 'pi.cmd'), '@echo off\n', 'utf8');

    const command = resolvePiCommand({
      env: { Path: '', USERPROFILE: root, ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      platform: 'win32',
    });

    assert.equal(command.command, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepEqual(command.args, ['/d', '/s', '/c', path.join(installDir, 'pi.cmd')]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
