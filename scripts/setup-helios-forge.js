import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildRuntimeMountManifest,
  saveCapabilityRecord,
} from '../src/harness-sidecar/capabilities/capabilityStore.js';
import { installPiPackage } from '../src/harness-sidecar/capabilities/piPackageInstaller.js';
import { formatHarnessIcrYamlSection } from '../src/harness-sidecar/icr/icrHarnessDefaults.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledPackageRoot = path.join(repoRoot, 'packages', 'helios-research-harness');

const DEFAULT_CONFIG = [
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
  '',
].join('\n');

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureLocalConfig({ workspaceRoot, forceConfig = false }) {
  const configPath = path.join(workspaceRoot, '.harness', 'config.yaml');
  await mkdir(path.dirname(configPath), { recursive: true });

  if (!forceConfig && await exists(configPath)) {
    return { configPath, created: false };
  }

  await writeFile(configPath, DEFAULT_CONFIG, 'utf8');
  return { configPath, created: true };
}

export async function setupHeliosForge({
  workspaceRoot = repoRoot,
  bundledPackageRoot = path.join(repoRoot, 'packages', 'helios-research-harness'),
  forceConfig = false,
  now = () => new Date().toISOString(),
} = {}) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const config = await ensureLocalConfig({ workspaceRoot: resolvedWorkspaceRoot, forceConfig });
  const installedPackage = await installPiPackage({
    workspaceRoot: resolvedWorkspaceRoot,
    packageRoot: bundledPackageRoot,
    now,
  });

  for (const capability of installedPackage.capabilities) {
    await saveCapabilityRecord({
      workspaceRoot: resolvedWorkspaceRoot,
      record: capability,
    });
  }

  const manifest = await buildRuntimeMountManifest({
    workspaceRoot: resolvedWorkspaceRoot,
    profileId: 'default',
  });

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    config,
    packageRecord: installedPackage.packageRecord,
    installRoot: installedPackage.installRoot,
    capabilityCount: installedPackage.capabilities.length,
    runtimeManifestPath: manifest.manifestPath,
    runtimeCounts: manifest.counts,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      options.workspaceRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--force-config') {
      options.forceConfig = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown setup argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log([
    'Usage: npm run setup -- [options]',
    '',
    'Options:',
    '  --workspace <path>  Setup a different workspace root',
    '  --force-config      Replace .harness/config.yaml if it already exists',
    '  -h, --help          Show this help',
    '',
  ].join('\n'));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await setupHeliosForge(options);
  console.log(`workspace: ${result.workspaceRoot}`);
  console.log(`config: ${result.config.configPath}${result.config.created ? ' created' : ' preserved'}`);
  console.log(`package: ${result.packageRecord.name} ${result.packageRecord.version}`);
  console.log(`installed: ${result.installRoot}`);
  console.log(`capabilities: ${result.capabilityCount}`);
  console.log(`runtime manifest: ${result.runtimeManifestPath}`);
  console.log(`enabled: ${result.runtimeCounts.enabled}`);
}

const isDirectRun = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
