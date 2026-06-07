import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredFiles = [
  'package.json',
  'src/server.js',
  'src/electron/main.js',
  'src/electron/preload.js',
  'public/index.html',
];

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function checkFile(root, relativePath, errors, checked) {
  const filePath = path.join(root, relativePath);
  checked.push(relativePath);

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      errors.push(`${relativePath} is not a file`);
      return;
    }
    if (fileStat.size === 0) {
      errors.push(`${relativePath} is empty`);
    }
  } catch {
    errors.push(`${relativePath} is missing`);
  }
}

export async function checkReleaseFiles(root = process.cwd()) {
  const errors = [];
  const checked = [];

  for (const relativePath of requiredFiles) {
    await checkFile(root, relativePath, errors, checked);
  }

  let packageJson = null;
  try {
    packageJson = await readJson(path.join(root, 'package.json'));
  } catch (error) {
    errors.push(`package.json could not be read: ${error.message}`);
  }

  if (packageJson) {
    if (packageJson.type !== 'module') {
      errors.push('package.json type must be "module"');
    }
    if (packageJson.main !== 'src/electron/main.js') {
      errors.push('package.json main must point to src/electron/main.js');
    }
    if (packageJson.scripts?.electron !== 'electron src/electron/main.js') {
      errors.push('package.json scripts.electron must point to src/electron/main.js');
    }
    if (!packageJson.scripts?.test) {
      errors.push('package.json scripts.test is missing');
    }
    if (!packageJson.dependencies?.ws) {
      errors.push('package.json dependencies.ws is missing');
    }
    if (!packageJson.devDependencies?.electron) {
      errors.push('package.json devDependencies.electron is missing');
    }
  }

  try {
    await access(path.join(root, 'package-lock.json'));
    checked.push('package-lock.json');
  } catch {
    errors.push('package-lock.json is missing');
  }

  return { ok: errors.length === 0, errors, checked };
}

async function main() {
  const result = await checkReleaseFiles(process.cwd());
  for (const item of result.checked) {
    console.log(`checked ${item}`);
  }
  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`release smoke failed: ${error}`);
    }
    process.exitCode = 1;
  }
}

const isDirectRun = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
