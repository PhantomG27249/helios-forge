import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHeliosSkillInventory } from './heliosSkillBridge.js';
import { parseZeusArgs } from '../../pi/modelArgs.js';

const DEFAULT_PACKAGE_ID = 'helios-research-harness';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(moduleDir, '..', '..', '..');

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function modelArgsFromState(piState) {
  return piState?.model?.args
    || piState?.activeModel?.args
    || piState?.modelArgs
    || '';
}

function isThinkingEnabled(piState) {
  if (typeof piState?.activeModelThinkingEnabled === 'boolean') return piState.activeModelThinkingEnabled;
  const parsed = parseZeusArgs(modelArgsFromState(piState));
  const enabled = parsed?.chat_template_kwargs?.enable_thinking
    ?? parsed?.chat_template_kwargs?.preserve_thinking;
  return enabled === true;
}

function hasKwargsExtension(registry) {
  return hasPackagePiExtension(registry, 'kwargs');
}

function hasHeliosForgeExtension(registry) {
  return hasPackagePiExtension(registry, 'helios-forge');
}

function hasPackagePiExtension(registry, capabilityId) {
  return (Array.isArray(registry?.capabilities) ? registry.capabilities : []).some((capability) => (
    capability.type === 'pi_extension'
    && capability.enabled === true
    && capability.packageId === DEFAULT_PACKAGE_ID
    && (
      capability.capabilityId === capabilityId
      || capability.id === `${DEFAULT_PACKAGE_ID}:pi_extension:${capabilityId}`
      || String(capability.name || '').toLowerCase().includes(capabilityId)
    )
  ));
}

function defaultPiExtensionsDir() {
  const home = process.env.USERPROFILE || process.env.HOME;
  return home ? path.join(home, '.pi', 'agent', 'extensions') : null;
}

function createRepairPlan({ repoRoot, workspaceRoot }) {
  return {
    action: 'run_setup',
    automatic: false,
    command: 'npm run setup -- --workspace <workspaceRoot>',
    scriptPath: path.join(repoRoot, 'scripts', 'setup-helios-forge.js'),
    workspaceRoot,
  };
}

export async function buildPiBridgeState({
  workspaceRoot,
  repoRoot = defaultRepoRoot,
  piExtensionsDir = defaultPiExtensionsDir(),
  piState = {},
  manifestConsumedByPi = false,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const registryPath = path.join(resolvedWorkspaceRoot, '.harness', 'capabilities.json');
  const runtimeManifestPath = path.join(resolvedWorkspaceRoot, '.harness', 'runtime', 'capabilities.mount.json');
  const packagePath = path.join(resolvedWorkspaceRoot, '.harness', 'packages', DEFAULT_PACKAGE_ID);
  const kwargsExtensionPath = piExtensionsDir ? path.join(piExtensionsDir, 'kwargs.ts') : null;
  const heliosForgeExtensionPath = piExtensionsDir ? path.join(piExtensionsDir, 'helios-forge.ts') : null;

  const [
    registryPresent,
    manifestPresent,
    defaultPackageInstalled,
    globalKwargsExtensionPresent,
    globalHeliosForgeExtensionPresent,
  ] = await Promise.all([
    exists(registryPath),
    exists(runtimeManifestPath),
    exists(packagePath),
    kwargsExtensionPath ? exists(kwargsExtensionPath) : false,
    heliosForgeExtensionPath ? exists(heliosForgeExtensionPath) : false,
  ]);
  const registry = await readJsonIfPresent(registryPath);
  const workspaceKwargsExtensionRegistered = hasKwargsExtension(registry);
  const workspaceHeliosForgeExtensionRegistered = hasHeliosForgeExtension(registry);
  const skillInventory = await buildHeliosSkillInventory({
    workspaceRoot: resolvedWorkspaceRoot,
    repoRoot: resolvedRepoRoot,
  });
  const missingDefaultPackage = [
    { path: registryPath, present: registryPresent },
    { path: runtimeManifestPath, present: manifestPresent },
    { path: packagePath, present: defaultPackageInstalled },
  ].filter((entry) => !entry.present);

  const bridgeHealth = {
    manifestPresent,
    manifestConsumedByPi: manifestConsumedByPi === true,
    defaultPackageInstalled,
    piKwargsExtensionInstalled: workspaceKwargsExtensionRegistered || globalKwargsExtensionPresent,
    piHeliosForgeExtensionInstalled: workspaceHeliosForgeExtensionRegistered || globalHeliosForgeExtensionPresent,
    workspacePackageExtensions: {
      kwargs: workspaceKwargsExtensionRegistered,
      heliosForge: workspaceHeliosForgeExtensionRegistered,
    },
    piGlobalExtensions: {
      kwargs: globalKwargsExtensionPresent,
      heliosForge: globalHeliosForgeExtensionPresent,
    },
    reasoningParserForwarded: piState?.reasoningParserForwarded === true,
    activeModelThinkingEnabled: isThinkingEnabled(piState),
  };

  return {
    workspaceRoot: resolvedWorkspaceRoot,
    bridgeHealth,
    skillInventory,
    diagnostics: {
      missingDefaultPackage,
    },
    repairPlan: missingDefaultPackage.length
      ? createRepairPlan({ repoRoot: resolvedRepoRoot, workspaceRoot: resolvedWorkspaceRoot })
      : null,
  };
}
