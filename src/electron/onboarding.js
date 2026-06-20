import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { setupHeliosForge } from '../../scripts/setup-helios-forge.js';

const ONBOARDING_FILE = 'onboarding.json';

export function onboardingStatePath(userDataDir) {
  return path.join(userDataDir, ONBOARDING_FILE);
}

export async function loadOnboardingState(userDataDir, fs = { readFile }) {
  try {
    const raw = await fs.readFile(onboardingStatePath(userDataDir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      completed: false,
      workspaceRoot: null,
      lastSetupAt: null,
    };
  }
}

export async function saveOnboardingState(userDataDir, state, fs = { mkdir, writeFile }) {
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.writeFile(onboardingStatePath(userDataDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return state;
}

async function workplaceLooksReady(workspaceRoot, exists = existsSync, read = readFile) {
  const harnessDir = path.join(workspaceRoot, '.harness');
  if (!exists(path.join(harnessDir, 'config.yaml'))) {
    return false;
  }
  const capabilitiesPath = path.join(harnessDir, 'capabilities.json');
  if (!exists(capabilitiesPath)) {
    return false;
  }
  try {
    JSON.parse(await read(capabilitiesPath, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

export async function ensureWorkspaceReady({
  workspaceRoot,
  bundledPackageRoot,
  setupHeliosForgeImpl = setupHeliosForge,
  exists = existsSync,
  now = () => new Date().toISOString(),
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  if (await workplaceLooksReady(resolvedRoot, exists)) {
    return {
      workspaceRoot: resolvedRoot,
      setupRan: false,
      alreadyReady: true,
    };
  }

  const result = await setupHeliosForgeImpl({
    workspaceRoot: resolvedRoot,
    bundledPackageRoot,
    forceConfig: false,
    now,
  });

  return {
    workspaceRoot: resolvedRoot,
    setupRan: true,
    alreadyReady: false,
    capabilityCount: result.capabilityCount,
    runtimeManifestPath: result.runtimeManifestPath,
  };
}
