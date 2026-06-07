import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  checkGitRemote,
  checkNpmAuth,
  formatPublishPreflightReport,
} from '../scripts/publish-preflight.js';

test('publish preflight reports stale chat-app origin remote', async () => {
  const result = await checkGitRemote({
    run: async () => ({
      code: 0,
      stdout: 'C:\\Users\\jackj\\Github\\chat-app\n',
      stderr: '',
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /origin still points at chat-app/);
});

test('publish preflight reports missing npm login as an auth blocker', async () => {
  const result = await checkNpmAuth({
    run: async () => ({
      code: 1,
      stdout: '',
      stderr: 'npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in.',
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /npm adduser/);
});

test('publish preflight reports unreachable helios-forge origin remote', async () => {
  const calls = [];
  const result = await checkGitRemote({
    run: async (command, args) => {
      calls.push([command, args]);
      if (args.includes('get-url')) {
        return {
          code: 0,
          stdout: 'https://github.com/PhantomG27249/helios-forge.git\n',
          stderr: '',
        };
      }
      return {
        code: 1,
        stdout: '',
        stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/PhantomG27249/helios-forge.git/' not found",
      };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /not reachable/);
  assert.equal(calls.length, 2);
});

test('publish preflight formats actionable failed checks', () => {
  const report = formatPublishPreflightReport([
    { ok: true, label: 'package', message: 'package metadata is ready' },
    { ok: false, label: 'npm auth', message: 'Run npm adduser before publishing.' },
  ]);

  assert.match(report, /\[ok\] package: package metadata is ready/);
  assert.match(report, /\[fail\] npm auth: Run npm adduser before publishing\./);
});
