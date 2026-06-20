import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildRuntimeMountManifest } from '../harness-sidecar/capabilities/capabilityStore.js';
import { loadHarnessConfig } from '../harness-sidecar/config/configLoader.js';
import {
  buildPiBridgeContextPack,
  renderPiBridgeContextMarkdown,
} from '../harness-sidecar/pi/piBridgeContextPack.js';
import { repairWorkplace } from './harnessConfigService.js';
import { getWorkplaceStatus } from './workplaceStatus.js';

export function runtimeManifestPath(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), '.harness', 'runtime', 'capabilities.mount.json');
}

export async function ensurePiWorkplaceBridge(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const before = await getWorkplaceStatus(resolvedRoot);
  const needsPackage = !before.bundledPackage?.present
    || !before.capabilitiesJson?.present
    || before.capabilitiesJson?.error
    || !before.runtimeMount?.present;

  let repair = null;
  if (needsPackage) {
    repair = await repairWorkplace(resolvedRoot);
  }

  if (!before.runtimeMount?.present || repair?.repairs?.includes('scaffold')) {
    await buildRuntimeMountManifest({ workspaceRoot: resolvedRoot, profileId: 'default' });
  }

  const after = await getWorkplaceStatus(resolvedRoot);
  let contextJsonPath = null;
  if (after.bundledPackage?.present) {
    try {
      await buildHeliosChatContext(resolvedRoot, { persistJson: true });
      contextJsonPath = piBridgeContextJsonPath(resolvedRoot);
    } catch {
      contextJsonPath = null;
    }
  }
  return {
    repaired: Boolean(repair?.repairs?.length),
    repairs: repair?.repairs || [],
    manifestPath: runtimeManifestPath(resolvedRoot),
    contextJsonPath,
    status: after,
  };
}

export function piBridgeContextJsonPath(workspaceRoot) {
  return path.join(path.resolve(workspaceRoot), '.harness', 'runtime', 'pi-bridge-context.json');
}

export async function persistPiBridgeContextJson(workspaceRoot, pack) {
  const filePath = piBridgeContextJsonPath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(pack)}\n`, 'utf8');
  return filePath;
}

export async function buildHeliosChatContext(workspaceRoot, options = {}) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const status = await getWorkplaceStatus(resolvedRoot);
  if (!status.harnessDir?.present) return null;

  let config;
  try {
    config = await loadHarnessConfig({ workspaceRoot: resolvedRoot });
  } catch {
    config = { features: {} };
  }

  if (!status.bundledPackage?.present) {
    return [
      '[Helios Forge]',
      'Helios package is not installed yet — open Settings → Workplace and run Initialize/Repair.',
      '[/Helios Forge]',
    ].join('\n');
  }

  const pack = await buildPiBridgeContextPack({
    workspaceRoot: resolvedRoot,
    harnessConfig: config,
    options,
  });
  if (options.persistJson !== false) {
    await persistPiBridgeContextJson(resolvedRoot, pack);
  }
  return renderPiBridgeContextMarkdown(pack, { maxChars: options.maxChars });
}

export function prependHeliosChatContext(message, context) {
  const body = String(message || '');
  if (!context || !body.trim()) return message;
  if (body.includes('[Helios Forge]')) return message;
  return `${context}\n\n${body}`;
}
