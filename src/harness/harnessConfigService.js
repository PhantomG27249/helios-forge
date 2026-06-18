import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from '../harness-sidecar/config/configLoader.js';
import {
  buildDefaultHarnessIcrConfig,
  formatHarnessIcrYamlSection,
} from '../harness-sidecar/icr/icrHarnessDefaults.js';
import {
  formatEvolutionYamlSection,
  scaffoldWorkplaceEvolution,
} from '../harness-sidecar/meta/harnessEvolutionDefaults.js';
import { setupHeliosForge } from '../../scripts/setup-helios-forge.js';
import { getWorkplaceStatus, normalizeHeldOutSuiteFile } from './workplaceStatus.js';

const STANDARD_CONFIG_YAML = [
  'project:',
  '  name: Helios Forge',
  'defaults:',
  '  modelProfile: alphahelion_ebft5',
  '  contextProfile: coding_small',
  '  swarmModelProfile: alphahelion_ebft5',
  'budgets:',
  '  maxToolCalls: 20',
  '  maxWallMinutes: 15',
  'permissions:',
  '  mode: safe_edit',
  'features:',
  '  swarm: true',
  '  modelDrivenSwarm: true',
  '  piNativeSwarm: true',
  '  worktreeSwarm: true',
  '  autonomousToolLoop: true',
  '  deepResearch: true',
  '  experiments: true',
  '  visualArtifacts: true',
  '  verifierEvolution: true',
  '  adaptiveSearch: true',
  '  safeApply: true',
  'adaptiveSearch:',
  '  mode: advisory',
  '  maxActionsPerTask: 8',
  '  allowProfileSwitching: true',
  formatHarnessIcrYamlSection({ enabled: true, includeProductionGate: true }),
  formatEvolutionYamlSection(),
  'models:',
  '  # Set swarmBaseUrl for model-driven swarm (OpenAI-compatible endpoint)',
  '  swarmBaseUrl: null',
  '  swarmModelId: null',
  '',
].join('\n');

export const CONFIG_PRESETS = {
  minimal: {
    project: { name: 'Helios Forge' },
    defaults: {
      modelProfile: 'qwen36_vlm_fast',
      contextProfile: 'coding_small',
    },
    budgets: {
      maxToolCalls: 10,
      maxWallMinutes: 10,
    },
    permissions: {
      mode: 'safe_edit',
    },
    features: {
      swarm: false,
      modelDrivenSwarm: false,
      piNativeSwarm: false,
      multiModelSwarm: false,
      worktreeSwarm: false,
      autonomousToolLoop: false,
      deepResearch: false,
      experiments: false,
      visualArtifacts: false,
      verifierEvolution: false,
      adaptiveSearch: false,
      safeApply: false,
    },
    modelCouncil: {
      enabled: false,
      endpointProfiles: {},
      roles: {},
    },
  },
  standard: STANDARD_CONFIG_YAML,
  multi_model_swarm: {
    project: { name: 'Helios Forge' },
    defaults: {
      modelProfile: 'qwen36_vlm_fast',
      contextProfile: 'coding_small',
      swarmModelProfile: 'qwen36_vlm_deep',
    },
    budgets: {
      maxToolCalls: 20,
      maxWallMinutes: 15,
    },
    permissions: {
      mode: 'safe_edit',
    },
    features: {
      swarm: true,
      modelDrivenSwarm: true,
      piNativeSwarm: true,
      multiModelSwarm: true,
      deepResearch: true,
      adaptiveSearch: true,
    },
    modelCouncil: {
      enabled: true,
      mode: 'advisory',
      roles: {
        researcher: {
          modelProfile: 'qwen36_vlm_deep',
          endpointProfile: 'local_deep',
        },
        critic: {
          modelProfile: 'qwen36_vlm_fast',
          endpointProfile: 'local_fast',
        },
      },
      endpointProfiles: {
        local_deep: {
          baseUrl: 'http://localhost:8000/v1',
          modelId: 'provider/model-id',
          supportsVision: true,
          healthEnabled: true,
        },
        local_fast: {
          baseUrl: 'http://localhost:8001/v1',
          modelId: 'provider/model-id-fast',
          supportsVision: false,
          healthEnabled: true,
        },
      },
    },
    swarmExecution: {
      concurrency: 2,
      workerMode: 'model_driven',
    },
    adaptiveSearch: {
      mode: 'advisory',
      maxActionsPerTask: 8,
      allowProfileSwitching: true,
    },
    icr: buildDefaultHarnessIcrConfig({ enabled: true }),
    productionCapabilities: {
      icrLane: {
        enabled: true,
        mode: 'advisory',
        authority: 'evidence_only',
      },
    },
  },
};

function formatScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /[:#\n]/.test(value)) return JSON.stringify(value);
  return String(value);
}

function serializeSimpleYaml(value, indent = 0) {
  const lines = [];
  const prefix = ' '.repeat(indent);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        lines.push(`${prefix}-`);
        lines.push(serializeSimpleYaml(item, indent + 2));
      } else {
        lines.push(`${prefix}- ${formatScalar(item)}`);
      }
    }
    return lines.join('\n');
  }

  for (const [key, entry] of Object.entries(value || {})) {
    if (entry === undefined) continue;
    if (Array.isArray(entry)) {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeSimpleYaml(entry, indent + 2));
      continue;
    }
    if (entry && typeof entry === 'object') {
      lines.push(`${prefix}${key}:`);
      lines.push(serializeSimpleYaml(entry, indent + 2));
      continue;
    }
    lines.push(`${prefix}${key}: ${formatScalar(entry)}`);
  }

  return lines.join('\n');
}

function deepMerge(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      merged[key] = deepMerge(base[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
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
    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) {
        const current = stack[stack.length - 1];
        if (!current.parent || !current.key || Object.keys(parent).length > 0) {
          throw new Error('YAML list item has no array parent');
        }
        const arrayValue = [];
        current.parent[current.key] = arrayValue;
        current.value = arrayValue;
        arrayValue.push(parseScalar(line.slice(2)));
        continue;
      }
      parent.push(parseScalar(line.slice(2)));
      continue;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      throw new Error(`Invalid YAML line: ${line}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    if (rawValue) {
      parent[key] = parseScalar(rawValue);
      continue;
    }

    const nextValue = {};
    parent[key] = nextValue;
    stack.push({ indent, value: nextValue, key, parent });
  }

  return root;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^["']|["']$/g, '');
}

function configPath(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), '.harness', 'config.yaml');
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readRawConfig(workspaceRoot) {
  const yamlPath = configPath(workspaceRoot);
  if (!(await fileExists(yamlPath))) {
    return {};
  }
  return parseSimpleYaml(await readFile(yamlPath, 'utf8'));
}

async function writeConfig(workspaceRoot, configObject) {
  const yamlPath = configPath(workspaceRoot);
  await mkdir(path.dirname(yamlPath), { recursive: true });
  const yamlText = `${serializeSimpleYaml(configObject)}\n`;
  await writeFile(yamlPath, yamlText, 'utf8');
  return yamlPath;
}

function resolvePreset(presetId) {
  const preset = CONFIG_PRESETS[presetId];
  if (!preset) {
    throw new Error(`Unknown config preset: ${presetId}`);
  }
  if (typeof preset === 'string') {
    return parseSimpleYaml(preset);
  }
  return structuredClone(preset);
}

export async function getHarnessConfig(workspaceRoot) {
  const yamlPath = configPath(workspaceRoot);
  const config = await loadHarnessConfig({ workspaceRoot });
  return { config, path: yamlPath };
}

export async function patchHarnessConfig(workspaceRoot, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Config patch must be a plain object');
  }
  const current = await readRawConfig(workspaceRoot);
  const merged = deepMerge(current, patch);
  const yamlPath = await writeConfig(workspaceRoot, merged);
  const config = await loadHarnessConfig({ workspaceRoot });
  return { config, path: yamlPath, patch: merged };
}

export async function applyConfigPreset(workspaceRoot, { presetId, mode = 'merge' } = {}) {
  const preset = resolvePreset(presetId);
  let nextConfig;
  if (mode === 'replace') {
    nextConfig = preset;
  } else if (mode === 'merge') {
    const current = await readRawConfig(workspaceRoot);
    nextConfig = deepMerge(preset, current);
  } else {
    throw new Error(`Unknown preset apply mode: ${mode}`);
  }
  const yamlPath = await writeConfig(workspaceRoot, nextConfig);
  const config = await loadHarnessConfig({ workspaceRoot });
  return { config, path: yamlPath, presetId, mode };
}

export { setupHeliosForge as initializeWorkplace };

export async function repairWorkplace(workspaceRoot) {
  const before = await getWorkplaceStatus(workspaceRoot);
  const repairs = [];

  if (!before.configYaml?.present) {
    await applyConfigPreset(workspaceRoot, { presetId: 'standard', mode: 'replace' });
    repairs.push('config');
  }

  const needsScaffold = !before.capabilitiesJson?.present
    || !before.runtimeMount?.present
    || !before.bundledPackage?.present
    || !before.harnessDir?.present;

  if (needsScaffold) {
    await setupHeliosForge({ workspaceRoot, forceConfig: false });
    repairs.push('scaffold');
  }

  const statusBeforeEvolution = await getWorkplaceStatus(workspaceRoot);
  const needsEvolutionScaffold = !statusBeforeEvolution.heldOutSuite?.present
    || !statusBeforeEvolution.evolutionConfig?.present;
  if (needsEvolutionScaffold) {
    await scaffoldWorkplaceEvolution({ workspaceRoot });
    await normalizeHeldOutSuiteFile(workspaceRoot);
    repairs.push('evolution');
  }

  const after = await getWorkplaceStatus(workspaceRoot);
  return { repairs, before, after };
}
