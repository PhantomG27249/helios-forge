import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function readPackageJson(root = repoRoot) {
  const content = await readFile(path.join(root, 'package.json'), 'utf8');
  return JSON.parse(content);
}

export async function checkPackageMetadata({ root = repoRoot } = {}) {
  const packageJson = await readPackageJson(root);
  if (packageJson.name !== 'helios-forge') {
    return {
      ok: false,
      label: 'package',
      message: `package.json name is "${packageJson.name}", expected "helios-forge".`,
    };
  }
  if (!packageJson.version) {
    return { ok: false, label: 'package', message: 'package.json version is missing.' };
  }
  return {
    ok: true,
    label: 'package',
    message: `${packageJson.name}@${packageJson.version} is ready for npm packaging.`,
  };
}

export async function checkGitRemote({ run = runCommand } = {}) {
  const result = await run('git', ['remote', 'get-url', 'origin']);
  const remote = result.stdout.trim();
  if (result.code !== 0 || !remote) {
    return {
      ok: false,
      label: 'git remote',
      message: 'origin remote is missing; create the GitHub repo and set origin before publishing.',
    };
  }
  if (/chat-app/i.test(remote)) {
    return {
      ok: false,
      label: 'git remote',
      message: `origin still points at chat-app (${remote}); set it to the helios-forge GitHub repo.`,
    };
  }
  if (!/helios-forge/i.test(remote)) {
    return {
      ok: false,
      label: 'git remote',
      message: `origin points at ${remote}; expected a helios-forge repository.`,
    };
  }
  const reachability = await run('git', ['ls-remote', '--heads', 'origin']);
  if (reachability.code !== 0) {
    const details = `${reachability.stdout}\n${reachability.stderr}`.trim();
    return {
      ok: false,
      label: 'git remote',
      message: `origin points at ${remote}, but it is not reachable. Create the GitHub repo or fix access, then push. ${details}`,
    };
  }
  return { ok: true, label: 'git remote', message: `origin points at ${remote}.` };
}

export async function checkNpmAuth({ run = runCommand } = {}) {
  const result = await run('npm', ['whoami']);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) {
    return { ok: true, label: 'npm auth', message: `logged in as ${result.stdout.trim()}.` };
  }
  if (/ENEEDAUTH|need auth|logged in/i.test(output)) {
    return {
      ok: false,
      label: 'npm auth',
      message: 'npm is not logged in. Run `npm adduser`, then retry `npm publish`.',
    };
  }
  return {
    ok: false,
    label: 'npm auth',
    message: `npm auth check failed: ${output.trim() || 'unknown error'}`,
  };
}

export async function checkNpmPackageName({ packageName = 'helios-forge', run = runCommand } = {}) {
  const result = await run('npm', ['view', packageName, 'version']);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code === 0) {
    return {
      ok: false,
      label: 'npm name',
      message: `${packageName} already exists on npm at version ${result.stdout.trim()}; bump the version or choose a new name.`,
    };
  }
  if (/E404|Not Found/i.test(output)) {
    return { ok: true, label: 'npm name', message: `${packageName} is currently available on npm.` };
  }
  return {
    ok: false,
    label: 'npm name',
    message: `could not confirm npm package availability: ${output.trim() || 'unknown error'}`,
  };
}

export function formatPublishPreflightReport(checks) {
  return checks
    .map((check) => `[${check.ok ? 'ok' : 'fail'}] ${check.label}: ${check.message}`)
    .join('\n');
}

export async function runPublishPreflight() {
  const metadata = await checkPackageMetadata();
  const checks = [
    metadata,
    await checkGitRemote(),
    await checkNpmAuth(),
    await checkNpmPackageName({ packageName: metadata.ok ? 'helios-forge' : undefined }),
  ];
  return { ok: checks.every((check) => check.ok), checks };
}

async function main() {
  const result = await runPublishPreflight();
  console.log(formatPublishPreflightReport(result.checks));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isDirectRun = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}
