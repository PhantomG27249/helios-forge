import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const installScript = path.join(repoRoot, 'scripts', 'install-pi-kwargs-extension.js');

test('installer copies kwargs extension from bundled research harness package', async () => {
  const script = await readFile(installScript, 'utf8');

  assert.match(script, /packages['"],\s*['"]helios-research-harness['"],\s*['"]extensions['"],\s*['"]kwargs\.ts/);
});

test('installer preserves BOM handling, normalizes image input, and installs bundled kwargs extension', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'helios-pi-home-'));
  try {
    const agentDir = path.join(home, '.pi', 'agent');
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      path.join(agentDir, 'models.json'),
      '\uFEFF' +
        JSON.stringify({
          providers: {
            Zeus: {
              models: [
                {
                  id: 'example/ebft-model',
                  input: ['text'],
                  args: '--reasoning-parser qwen3 --chat-template-kwargs \'{"enable_thinking":false}\'',
                },
              ],
            },
          },
        }),
      'utf8',
    );

    const result = spawnSync(process.execPath, [installScript], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    const installed = await readFile(path.join(agentDir, 'extensions', 'kwargs.ts'), 'utf8');
    const bundled = await readFile(path.join(repoRoot, 'packages', 'helios-research-harness', 'extensions', 'kwargs.ts'), 'utf8');
    assert.equal(installed, bundled);

    const normalized = await readFile(path.join(agentDir, 'models.json'), 'utf8');
    assert.equal(normalized.charCodeAt(0), 123);
    const config = JSON.parse(normalized);
    assert.deepEqual(config.providers.Zeus.models[0].input, ['text', 'image']);
    assert.equal(
      config.providers.Zeus.models[0].args,
      '--reasoning-parser qwen3 --chat-template-kwargs \'{"enable_thinking":false}\'',
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
