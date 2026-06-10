import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = path.resolve(import.meta.dirname, '..');
const extensionSource = path.join(repoRoot, 'packages', 'helios-research-harness', 'extensions', 'helios-forge.ts');
const execFileAsync = promisify(execFile);

async function importExtensionModule() {
  const raw = await readFile(extensionSource, 'utf8');
  const transpiled = raw
    .replace(/^import type .*;\r?\n/gm, '')
    .replace(/: ExtensionAPI/g, '')
    .replace(/: string\[\]/g, '')
    .replace(/: string/g, '')
    .replace(/: number/g, '')
    .replace(/: any/g, '')
    .replace(/: Record<string, any>/g, '')
    .replace(/ as Record<string, any>/g, '');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'helios-extension-import-'));
  const modulePath = path.join(tempDir, 'helios-forge.mjs');
  await writeFile(modulePath, transpiled, 'utf8');
  return import(pathToFileURL(modulePath).href);
}

test('helios package registers the Helios Forge Pi extension', async () => {
  const manifestPath = path.join(repoRoot, 'packages', 'helios-research-harness', 'helios-package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  assert.deepEqual(
    manifest.piExtensions.find((entry) => entry.id === 'helios-forge'),
    {
      id: 'helios-forge',
      name: 'Helios Forge Bridge Metadata',
      path: 'extensions/helios-forge.ts',
    },
  );
});

test('installer copies the package extension to the global Pi extension folder', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'helios-pi-home-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'install-pi-helios-extension.js');
  const result = await execFileAsync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: '',
    },
  });

  const installedPath = path.join(home, '.pi', 'agent', 'extensions', 'helios-forge.ts');
  assert.equal((await stat(installedPath)).isFile(), true);
  assert.match(result.stdout, /Installed Pi Helios Forge extension/);
  await rm(home, { recursive: true, force: true });
});

test('metadata builder emits a compact bridge warning when the manifest is missing', async () => {
  const { createBridgeMetadata } = await importExtensionModule();

  const metadata = createBridgeMetadata({
    manifestPath: path.join(os.tmpdir(), 'missing-helios-manifest.json'),
    readFile: () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
  });

  assert.deepEqual(metadata, {
    source: 'helios-forge',
    status: 'warning',
    warning: 'HELIOS_CAPABILITIES_MANIFEST is not available',
    manifestId: null,
    counts: {},
    refs: [],
  });
});

test('metadata builder exposes redacted bounded inventory from the manifest', async () => {
  const { createBridgeMetadata } = await importExtensionModule();
  const manifestPath = path.join(os.tmpdir(), 'capabilities.mount.json');
  const rawManifest = JSON.stringify({
    workspaceRoot: 'C:/secret/workspace',
    apiKey: 'sk-should-not-leak',
    capabilities: [
      {
        id: 'capability.secret',
        type: 'skill',
        name: 'Secret Skill',
        enabled: true,
        env: { OPENAI_API_KEY: 'sk-secret' },
        sourcePath: 'C:/private/full/path/SKILL.md',
        rawTrace: 'x'.repeat(5000),
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `capability.${index}`,
        type: 'template',
        name: `Capability ${index}`,
        path: `C:/private/${index}.md`,
      })),
    ],
  });

  const metadata = createBridgeMetadata({
    manifestPath,
    readFile: () => rawManifest,
    maxRefs: 4,
    maxBytes: 900,
  });

  assert.equal(metadata.status, 'ready');
  assert.match(metadata.manifestId, /^[a-f0-9]{16}$/);
  assert.equal(Object.hasOwn(metadata, 'manifestPath'), false);
  assert.deepEqual(metadata.counts, { skill: 1, template: 10 });
  assert.equal(metadata.refs.length, 4);
  assert.deepEqual(metadata.refs[0], {
    id: 'capability.secret',
    type: 'skill',
    name: 'Secret Skill',
    enabled: true,
  });
  assert.equal(JSON.stringify(metadata).includes('sk-secret'), false);
  assert.equal(JSON.stringify(metadata).includes(manifestPath), false);
  assert.equal(JSON.stringify(metadata).includes('C:/secret/workspace'), false);
  assert.equal(JSON.stringify(metadata).includes('C:/private'), false);
  assert.equal(JSON.stringify(metadata).includes('rawTrace'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(metadata), 'utf8') <= 900);
});
