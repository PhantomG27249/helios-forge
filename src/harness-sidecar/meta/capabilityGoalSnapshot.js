import { buildIcrHarnessCapabilityInputs } from '../icr/icrStatusHandler.js';
import { summarizeCapabilityGoalStatus } from './capabilityGoalStatus.js';
import { loadPersistedProductionSignals } from './productionEvidenceIndex.js';

export async function loadCapabilityGoalInputs({ workspaceRoot, harnessConfig = {} } = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const [{ signals }, { icrEvidence, icrConfig }] = await Promise.all([
    loadPersistedProductionSignals({ workspaceRoot }),
    buildIcrHarnessCapabilityInputs({ workspaceRoot, harnessConfig }),
  ]);

  return {
    signals,
    icrEvidence,
    icrConfig,
  };
}

export async function buildCapabilityGoalSnapshot({ workspaceRoot, harnessConfig = {} } = {}) {
  const inputs = await loadCapabilityGoalInputs({ workspaceRoot, harnessConfig });
  return summarizeCapabilityGoalStatus(inputs);
}
