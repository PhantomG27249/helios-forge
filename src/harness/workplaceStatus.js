import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from '../harness-sidecar/config/configLoader.js';

async function pathAccessible(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkItem({ filePath, validate }) {
  const present = await pathAccessible(filePath);
  const item = { present, path: filePath };
  if (!present) {
    return item;
  }
  if (validate) {
    try {
      await validate(filePath);
    } catch (error) {
      item.error = error.message;
    }
  }
  return item;
}

async function hasBundledPackage(packagesDir) {
  try {
    const entries = await readdir(packagesDir, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory());
  } catch {
    return false;
  }
}

export async function getWorkplaceStatus(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const harnessDir = path.join(resolvedRoot, '.harness');
  const configYamlPath = path.join(harnessDir, 'config.yaml');
  const capabilitiesJsonPath = path.join(harnessDir, 'capabilities.json');
  const runtimeMountPath = path.join(harnessDir, 'runtime', 'capabilities.mount.json');
  const bundledPackageDir = path.join(harnessDir, 'packages');

  const configYaml = await checkItem({
    filePath: configYamlPath,
    validate: async () => {
      await loadHarnessConfig({ workspaceRoot: resolvedRoot });
    },
  });

  const capabilitiesJson = await checkItem({
    filePath: capabilitiesJsonPath,
    validate: async (filePath) => {
      JSON.parse(await readFile(filePath, 'utf8'));
    },
  });

  const runtimeMount = await checkItem({
    filePath: runtimeMountPath,
    validate: async (filePath) => {
      JSON.parse(await readFile(filePath, 'utf8'));
    },
  });

  const bundledPackagePresent = await hasBundledPackage(bundledPackageDir);
  const bundledPackage = {
    present: bundledPackagePresent,
    path: bundledPackageDir,
  };

  const harnessDirPresent = await pathAccessible(harnessDir);
  const harnessDirStatus = {
    present: harnessDirPresent,
    path: harnessDir,
  };

  return {
    workspaceRoot: resolvedRoot,
    configYaml,
    capabilitiesJson,
    runtimeMount,
    bundledPackage,
    harnessDir: harnessDirStatus,
  };
}
