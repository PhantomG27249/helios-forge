import path from 'node:path';

import { buildRuntimeMountManifest } from '../harness-sidecar/capabilities/capabilityStore.js';
import { loadHarnessConfig } from '../harness-sidecar/config/configLoader.js';
import { buildHeliosSkillInventory } from '../harness-sidecar/pi/heliosSkillBridge.js';
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
    || !before.runtimeMount?.present;

  let repair = null;
  if (needsPackage) {
    repair = await repairWorkplace(resolvedRoot);
  }

  if (!before.runtimeMount?.present || repair?.repairs?.includes('scaffold')) {
    await buildRuntimeMountManifest({ workspaceRoot: resolvedRoot, profileId: 'default' });
  }

  const after = await getWorkplaceStatus(resolvedRoot);
  return {
    repaired: Boolean(repair?.repairs?.length),
    repairs: repair?.repairs || [],
    manifestPath: runtimeManifestPath(resolvedRoot),
    status: after,
  };
}

export async function buildHeliosChatContext(workspaceRoot) {
  const resolvedRoot = path.resolve(workspaceRoot);
  const status = await getWorkplaceStatus(resolvedRoot);
  if (!status.harnessDir?.present) return null;

  let config;
  try {
    config = await loadHarnessConfig({ workspaceRoot: resolvedRoot });
  } catch {
    config = { features: {} };
  }

  const features = config.features || {};
  const inventory = await buildHeliosSkillInventory({ workspaceRoot: resolvedRoot });
  const skills = inventory.skills.slice(0, 12);

  const lines = [
    '[Helios Forge]',
    'This workplace is wired for Helios Forge harness capabilities.',
  ];

  if (!status.bundledPackage?.present) {
    lines.push('Helios package is not installed yet — open Settings → Workplace and run Initialize/Repair.');
    lines.push('[/Helios Forge]');
    return lines.join('\n');
  }

  if (features.deepResearch) {
    lines.push('Deep research is enabled for this workplace.');
    lines.push('Use the deep-research skill and the /deep-research slash command for source-grounded research with citations and contradiction tracking.');
  }
  if (features.swarm) {
    lines.push('Swarm orchestration is enabled — /harness and /research slash commands can launch harness tasks.');
  }

  if (skills.length) {
    lines.push('Available Helios skills:');
    for (const skill of skills) {
      const label = skill.name || skill.id;
      const detail = skill.description ? ` — ${skill.description}` : '';
      lines.push(`- ${label}${detail}`);
    }
  }

  lines.push('Slash commands: /harness, /research, /deep-research, /forge');
  lines.push('[/Helios Forge]');
  return lines.join('\n');
}

export function prependHeliosChatContext(message, context) {
  const body = String(message || '');
  if (!context || !body.trim()) return message;
  if (body.includes('[Helios Forge]')) return message;
  return `${context}\n\n${body}`;
}
