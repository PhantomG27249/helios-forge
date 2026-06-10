import { copyFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repoRoot, 'packages', 'helios-research-harness', 'extensions', 'helios-forge.ts');
const home = process.env.USERPROFILE || process.env.HOME;

if (!home) {
  throw new Error('USERPROFILE or HOME must be set to install the Pi Helios Forge extension');
}

const targetDir = path.join(home, '.pi', 'agent', 'extensions');
const target = path.join(targetDir, 'helios-forge.ts');

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);

console.log(`Installed Pi Helios Forge extension to ${target}`);
