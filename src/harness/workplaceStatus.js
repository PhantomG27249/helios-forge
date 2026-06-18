import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from '../harness-sidecar/config/configLoader.js';
import { resolveSwarmModelEndpoint } from '../harness-sidecar/meta/harnessEvolutionDefaults.js';

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

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, '');
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].value;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (rawValue) {
      parent[key] = parseScalar(rawValue);
      continue;
    }

    const nextValue = {};
    parent[key] = nextValue;
    stack.push({ indent, value: nextValue });
  }

  return root;
}

function formatHeldOutCaseCommand(command) {
  if (typeof command === 'string') return command.trim() || null;
  if (!command || typeof command !== 'object') return null;
  const executable = command.executable || command.command;
  const args = Array.isArray(command.args) ? command.args : [];
  if (!executable) return null;
  return [executable, ...args.map((arg) => {
    const value = String(arg);
    return /[\s"]/.test(value) ? JSON.stringify(value) : value;
  })].join(' ').trim();
}

export async function normalizeHeldOutSuiteFile(workspaceRoot) {
  const suitePath = path.join(
    path.resolve(workspaceRoot),
    '.harness',
    'benchmarks',
    'suites',
    'workplace-smoke.json',
  );
  if (!(await pathAccessible(suitePath))) return;

  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  const cases = Array.isArray(suite.cases) ? suite.cases : [];
  let changed = false;
  for (const caseRecord of cases) {
    if (!caseRecord || typeof caseRecord !== 'object') continue;
    if (typeof caseRecord.command === 'string' && caseRecord.command.trim()) continue;
    const formatted = formatHeldOutCaseCommand(caseRecord.command);
    if (!formatted) continue;
    caseRecord.command = formatted;
    changed = true;
  }
  if (!changed) return;
  await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
}

export async function getWorkplaceStatus(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const harnessDir = path.join(resolvedRoot, '.harness');
  const configYamlPath = path.join(harnessDir, 'config.yaml');
  const capabilitiesJsonPath = path.join(harnessDir, 'capabilities.json');
  const runtimeMountPath = path.join(harnessDir, 'runtime', 'capabilities.mount.json');
  const bundledPackageDir = path.join(harnessDir, 'packages');
  const heldOutSuitePath = path.join(harnessDir, 'benchmarks', 'suites', 'workplace-smoke.json');

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

  const heldOutSuite = await checkItem({
    filePath: heldOutSuitePath,
    validate: async (filePath) => {
      const suite = JSON.parse(await readFile(filePath, 'utf8'));
      if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
        throw new Error('held-out suite must include at least one case');
      }
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

  let evolutionConfig = {
    present: false,
    syntheticReplay: null,
    defaultSuiteId: null,
  };
  let swarmEndpointConfigured = false;
  let swarmEndpointAdvisory = null;
  let fileConfig = {};

  if (configYaml.present && !configYaml.error) {
    try {
      fileConfig = parseSimpleYaml(await readFile(configYamlPath, 'utf8'));
      const harnessConfig = await loadHarnessConfig({ workspaceRoot: resolvedRoot });
      const evolution = harnessConfig.evolution || {};
      const fileEvolution = fileConfig.evolution || {};
      evolutionConfig = {
        present: Boolean(fileEvolution.defaultSuiteId),
        syntheticReplay: evolution.syntheticReplay ?? null,
        defaultSuiteId: evolution.defaultSuiteId ?? null,
        campaignMaxCycles: evolution.campaignMaxCycles ?? null,
        persistFrontier: evolution.persistFrontier ?? null,
      };
      const endpoint = resolveSwarmModelEndpoint(harnessConfig);
      swarmEndpointConfigured = Boolean(endpoint.baseUrl);
      swarmEndpointAdvisory = endpoint.advisory;
    } catch (error) {
      evolutionConfig.error = error.message;
    }
  }

  const evolutionReady = heldOutSuite.present
    && !heldOutSuite.error
    && evolutionConfig.present
    && !evolutionConfig.error;

  return {
    workspaceRoot: resolvedRoot,
    configYaml,
    capabilitiesJson,
    runtimeMount,
    bundledPackage,
    harnessDir: harnessDirStatus,
    heldOutSuite,
    evolutionConfig,
    swarmEndpointConfigured,
    swarmEndpointAdvisory,
    evolutionReady,
  };
}
