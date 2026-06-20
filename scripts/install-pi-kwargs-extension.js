import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureModelImageInput } from '../src/pi/modelConfig.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = path.join(repoRoot, 'packages', 'helios-research-harness', 'extensions');
const bundledExtensions = ['kwargs.ts', 'helios-forge.ts'];
const home = process.env.USERPROFILE || process.env.HOME;
const targetDir = path.join(home, '.pi', 'agent', 'extensions');
const target = path.join(targetDir, 'kwargs.ts');

await mkdir(targetDir, { recursive: true });
for (const fileName of bundledExtensions) {
  await copyFile(path.join(extensionsDir, fileName), path.join(targetDir, fileName));
}

// Pi's JSON parser currently does not tolerate a UTF-8 BOM in models.json.
const modelsPath = path.join(home, '.pi', 'agent', 'models.json');
try {
  const raw = await readFile(modelsPath, 'utf8');
  const normalized = ensureModelImageInput(raw);
  await writeFile(modelsPath, normalized.rawJson, { encoding: 'utf8' });
} catch {
  // The extension can be installed before models.json exists.
}

console.log(`Installed Pi kwargs + Helios Forge extensions to ${targetDir}`);
