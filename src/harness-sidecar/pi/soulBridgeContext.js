import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

import { buildSoulPromptContext } from '../souls/soulPromptAdapter.js';
import { buildOversoulRuntimeContext } from '../souls/oversoulRuntime.js';
import { loadOversoul, loadSoul } from '../souls/soulStore.js';

const DEFAULT_AGENT_ID = 'primary';

async function agentSoulExists(workspaceRoot, agentId) {
  const soulPath = path.join(path.resolve(workspaceRoot), '.harness', 'souls', 'agents', agentId, 'soul.md');
  try {
    await access(soulPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadSoulBridgeContext({
  workspaceRoot,
  agentId = DEFAULT_AGENT_ID,
  maxChars = 900,
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  let soul = null;
  if (await agentSoulExists(workspaceRoot, agentId)) {
    soul = await loadSoul({ workspaceRoot, agentId });
  }
  const oversoul = await loadOversoul({ workspaceRoot });
  const oversoulRuntime = buildOversoulRuntimeContext({ oversoul });

  const markdown = buildSoulPromptContext({
    soul: {
      id: soul?.agentId || agentId,
      version: soul?.parsed?.version,
      promptAdapterNotes: soul?.parsed?.promptAdapterNotes,
    },
    oversoul: {
      id: oversoulRuntime.oversoulRef?.oversoulId,
      version: oversoulRuntime.oversoulRef?.oversoulVersion,
      promptAdapterNotes: oversoulRuntime.promptAdapterNotes,
    },
    maxChars,
  });

  return {
    agentId,
    markdown,
    oversoulRef: oversoulRuntime.oversoulRef,
    roleEcology: oversoulRuntime.roleEcology,
    strategyPosture: oversoulRuntime.strategyPosture,
    evidenceOnly: true,
    canPromote: false,
    authority: 'advisory_only',
  };
}
