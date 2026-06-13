import { access, readFile } from 'fs/promises';
import path from 'path';

export const DEFAULT_HARNESS_CONFIG = {
  project: {
    name: 'Helios Forge',
  },
  defaults: {
    modelProfile: 'qwen36_vlm_fast',
    contextProfile: 'coding_small',
  },
  budgets: {
    maxToolCalls: 20,
    maxWallMinutes: 15,
  },
  permissions: {
    mode: 'safe_edit',
    allowedTools: [],
    riskyTools: [],
  },
  features: {
    swarm: false,
    modelDrivenSwarm: false,
    piNativeSwarm: false,
    multiModelSwarm: false,
    adaptiveModelRouter: false,
    deepResearch: false,
    experiments: false,
    visualArtifacts: false,
    adaptiveSearch: false,
  },
  modelCouncil: {
    enabled: false,
    mode: 'advisory',
    diversityRequired: 2,
    disagreementThreshold: 0.35,
    roles: {},
    endpointProfiles: {},
  },
  modelRouter: {
    enabled: false,
    mode: 'advisory',
    strategy: 'thompson_sampling',
    minEvidencePerArm: 5,
    explorationFloor: 0.05,
    maxArmsPerDecision: 8,
    rewardWeights: {
      verifier: 0.4,
      reviewer: 0.2,
      councilAgreement: 0.15,
      safety: 0.15,
      latency: 0.05,
      cost: 0.05,
    },
    persistence: {
      enabled: false,
      path: '.harness/model-router-state.json',
    },
  },
  adaptiveSearch: {
    mode: 'advisory',
    maxActionsPerTask: 8,
    allowProfileSwitching: true,
  },
  icr: {
    enabled: false,
    mode: 'evidence_only',
  },
};

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

  for (const [sectionName, section] of Object.entries(root)) {
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    for (const [key, value] of Object.entries(section)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        section[key] = [];
      }
    }
  }

  return root;
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

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadHarnessConfig({ workspaceRoot }) {
  const configDir = path.join(workspaceRoot, '.harness');
  const yamlPath = path.join(configDir, 'config.yaml');
  const ymlPath = path.join(configDir, 'config.yml');
  const jsonPath = path.join(configDir, 'config.json');

  let loaded = {};
  if (await fileExists(yamlPath)) {
    loaded = parseSimpleYaml(await readFile(yamlPath, 'utf8'));
  } else if (await fileExists(ymlPath)) {
    loaded = parseSimpleYaml(await readFile(ymlPath, 'utf8'));
  } else if (await fileExists(jsonPath)) {
    loaded = JSON.parse(await readFile(jsonPath, 'utf8'));
  }

  return deepMerge(DEFAULT_HARNESS_CONFIG, loaded);
}
