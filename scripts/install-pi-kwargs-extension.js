import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repoRoot, 'src', 'pi', 'extensions', 'kwargs.ts');
const home = process.env.USERPROFILE || process.env.HOME;
const targetDir = path.join(home, '.pi', 'agent', 'extensions');
const target = path.join(targetDir, 'kwargs.ts');

await mkdir(targetDir, { recursive: true });
await copyFile(source, target);

// Pi's JSON parser currently does not tolerate a UTF-8 BOM in models.json.
const modelsPath = path.join(home, '.pi', 'agent', 'models.json');
try {
  const raw = await readFile(modelsPath, 'utf8');
  await writeFile(modelsPath, raw.replace(/^\uFEFF/, ''), { encoding: 'utf8' });
} catch {
  // The extension can be installed before models.json exists.
}

console.log(`Installed Pi kwargs extension to ${target}`);
