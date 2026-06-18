import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { buildDefaultHeldOutSuite } from '../benchmarks/defaultHeldOutSuite.js';

const WORKPLACE_SMOKE_SUITE_ID = 'workplace-smoke';

const BENCHMARKS_README = `# Workplace benchmarks

Held-out suites in \`suites/\` feed meta-harness replay after each completed task.

- Default suite: \`${WORKPLACE_SMOKE_SUITE_ID}\` (\`suites/${WORKPLACE_SMOKE_SUITE_ID}.json\`)
- Edit case \`command\` fields to match your project's test runner
- Replay uses real process exit codes, not synthetic scores, unless \`evolution.syntheticReplay: true\`
- Set \`models.swarmBaseUrl\` in \`.harness/config.yaml\` for model-driven swarm
- Use Settings -> Workplace -> Repair to merge missing evolution config keys
- Campaign reports and replay cycles are evidence-only; promotion stays operator-controlled
`;

export function buildDefaultEvolutionConfig() {
  return {
    syntheticReplay: false,
    defaultSuiteId: WORKPLACE_SMOKE_SUITE_ID,
    campaignMaxCycles: 3,
    persistFrontier: true,
    requireSwarmEndpoint: true,
  };
}

function formatYamlScalar(value) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string' && /[:#\n]/.test(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatEvolutionYamlSection(overrides = {}) {
  const config = {
    ...buildDefaultEvolutionConfig(),
    ...overrides,
  };

  const lines = ['evolution:'];
  for (const [key, value] of Object.entries(config)) {
    lines.push(`  ${key}: ${formatYamlScalar(value)}`);
  }
  return lines.join('\n');
}

function mergeEvolutionDefaults(existingEvolution = {}) {
  return {
    ...buildDefaultEvolutionConfig(),
    ...(existingEvolution && typeof existingEvolution === 'object' ? existingEvolution : {}),
  };
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

function serializeSimpleYaml(value, indent = 0) {
  const lines = [];
  const prefix = ' '.repeat(indent);

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        lines.push(`${prefix}-`);
        lines.push(serializeSimpleYaml(item, indent + 2));
      } else {
        lines.push(`${prefix}- ${formatYamlScalar(item)}`);
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
    lines.push(`${prefix}${key}: ${formatYamlScalar(entry)}`);
  }

  return lines.join('\n');
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveProfile(modelProfiles, profileId) {
  if (!modelProfiles || typeof modelProfiles !== 'object') return null;
  if (profileId && modelProfiles[profileId]) {
    return modelProfiles[profileId];
  }
  if ('baseUrl' in modelProfiles || 'model' in modelProfiles) {
    return modelProfiles;
  }
  return null;
}

export function resolveSwarmModelEndpoint(harnessConfig = {}, modelProfiles = {}) {
  const configUrl = harnessConfig?.models?.swarmBaseUrl;
  if (configUrl) {
    return {
      baseUrl: String(configUrl).trim(),
      advisory: null,
    };
  }

  const profileId = harnessConfig?.defaults?.swarmModelProfile
    || harnessConfig?.defaults?.modelProfile;
  const profile = resolveProfile(modelProfiles, profileId);
  const profileUrl = profile?.baseUrl;
  if (profileUrl) {
    return {
      baseUrl: String(profileUrl).trim(),
      advisory: null,
    };
  }

  return {
    baseUrl: null,
    advisory: {
      reason: 'swarm_endpoint_unconfigured',
      setupHint: 'Set models.swarmBaseUrl in .harness/config.yaml or HELIOS_SWARM_MODEL_BASE_URL',
    },
  };
}

async function mergeEvolutionIntoConfig({ workspaceRoot }) {
  const configPath = path.join(path.resolve(workspaceRoot), '.harness', 'config.yaml');
  let configObject = {};

  if (await fileExists(configPath)) {
    configObject = parseSimpleYaml(await readFile(configPath, 'utf8'));
  }

  const mergedEvolution = mergeEvolutionDefaults(configObject.evolution);
  const changed = JSON.stringify(configObject.evolution || {}) !== JSON.stringify(mergedEvolution);
  configObject.evolution = mergedEvolution;

  if (changed || !(await fileExists(configPath))) {
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${serializeSimpleYaml(configObject)}\n`, 'utf8');
  }

  return configPath;
}

export async function scaffoldWorkplaceEvolution({
  workspaceRoot,
  harnessConfig = {},
  force = false,
} = {}) {
  const root = path.resolve(workspaceRoot);
  const suite = await buildDefaultHeldOutSuite({ workspaceRoot: root });
  const benchmarksRoot = path.join(root, '.harness', 'benchmarks');
  const suitesRoot = path.join(benchmarksRoot, 'suites');
  const suitePath = path.join(suitesRoot, `${WORKPLACE_SMOKE_SUITE_ID}.json`);
  const readmePath = path.join(benchmarksRoot, 'README.md');

  await mkdir(suitesRoot, { recursive: true });

  if (force || !(await fileExists(suitePath))) {
    await writeFile(suitePath, `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
  }

  if (force || !(await fileExists(readmePath))) {
    await writeFile(readmePath, BENCHMARKS_README, 'utf8');
  }

  const configPath = await mergeEvolutionIntoConfig({ workspaceRoot: root });

  return {
    suitePath,
    readmePath,
    configPath,
    suiteId: WORKPLACE_SMOKE_SUITE_ID,
    evolution: mergeEvolutionDefaults(harnessConfig?.evolution),
  };
}
