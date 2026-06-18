import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SHADOW_POLICY_REL = '.harness/runtime/shadow-policy.json';
export const LIVE_POLICY_REL = '.harness/runtime/live-policy.json';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function mergeRuntimePolicyDocuments({ shadow = null, live = null } = {}) {
  const shadowDoc = asObject(shadow);
  const liveDoc = live ? asObject(live) : null;

  if (!liveDoc) {
    return {
      ...shadowDoc,
      policyHints: asObject(shadowDoc.policyHints),
      partialAutonomy: asObject(shadowDoc.partialAutonomy),
      harnessAdjustments: asObject(shadowDoc.harnessAdjustments),
      sources: { shadow: Boolean(shadow), live: false },
    };
  }

  return {
    ...shadowDoc,
    ...liveDoc,
    policyHints: {
      ...asObject(shadowDoc.policyHints),
      ...asObject(liveDoc.policyHints),
    },
    partialAutonomy: {
      ...asObject(shadowDoc.partialAutonomy),
      ...asObject(liveDoc.partialAutonomy),
    },
    harnessAdjustments: {
      ...asObject(shadowDoc.harnessAdjustments),
      ...asObject(liveDoc.harnessAdjustments),
      adaptiveSearch: {
        ...asObject(asObject(shadowDoc.harnessAdjustments).adaptiveSearch),
        ...asObject(asObject(liveDoc.harnessAdjustments).adaptiveSearch),
      },
      icr: {
        ...asObject(asObject(shadowDoc.harnessAdjustments).icr),
        ...asObject(asObject(liveDoc.harnessAdjustments).icr),
      },
    },
    sources: { shadow: Boolean(shadow), live: true },
  };
}

export async function loadRuntimePolicy({ workspaceRoot } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const resolvedRoot = path.resolve(workspaceRoot);
  const shadowPolicyPath = path.join(resolvedRoot, SHADOW_POLICY_REL);
  const livePolicyPath = path.join(resolvedRoot, LIVE_POLICY_REL);

  const shadow = await readJsonIfExists(shadowPolicyPath);
  const live = await readJsonIfExists(livePolicyPath);

  const merged = mergeRuntimePolicyDocuments({ shadow, live });

  return {
    ...merged,
    shadowPolicyPath,
    livePolicyPath,
  };
}
