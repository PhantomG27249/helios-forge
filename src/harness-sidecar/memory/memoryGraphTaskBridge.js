import { chooseMemoryExtractionMode } from './modelAssistedExtractionPolicy.js';
import { createMemoryGraphRuntime } from './memoryGraphRuntime.js';

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

function featureEnabled(featureFlags = {}, name) {
  if (featureFlags[name] === true) return true;
  if (featureFlags[name] === false) return false;
  return featureFlags?.[name]?.enabled === true;
}

function gateConfig(featureFlags = {}) {
  return featureFlags.productionCapabilities || featureFlags;
}

function proposalToObservation(proposal = {}) {
  if (proposal.text || proposal.observation) {
    return {
      text: proposal.text || proposal.observation,
      source: proposal.passageId || proposal.factId || proposal.source || 'local_memory',
    };
  }
  if (proposal.subject && proposal.relation) {
    return {
      kind: 'fact',
      subject: proposal.subject,
      relation: proposal.relation,
      object: proposal.object,
      passageId: proposal.passageId || proposal.factId || proposal.source || 'local_memory',
    };
  }
  return proposal;
}

function evidenceOnlyResult(base = {}) {
  return {
    ...base,
    evidenceOnly: true,
    canPromote: false,
    promotionAuthority: false,
    activeWorkspaceMutation: false,
    authority: 'evidence_only',
  };
}

export async function ingestLocalMemoryProposals({
  workspaceRoot,
  proposals = [],
  runtime,
  featureFlags = {},
} = {}) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');

  const normalizedProposals = normalizeList(proposals);
  const extractionPolicy = chooseMemoryExtractionMode({
    config: gateConfig(featureFlags),
  });

  if (!featureEnabled(featureFlags, 'localMemoryGraph')) {
    return evidenceOnlyResult({
      ingested: false,
      skipped: true,
      proposalCount: normalizedProposals.length,
      reasons: ['local_memory_graph_disabled'],
      extractionMode: extractionPolicy.mode,
      requiredGuards: extractionPolicy.requiredGuards,
    });
  }

  const memoryRuntime = runtime || createMemoryGraphRuntime({ workspaceRoot });
  const observations = normalizedProposals.map(proposalToObservation);
  const firstProposal = normalizedProposals[0] || {};

  const ingestResult = await memoryRuntime.ingestObservations({
    agentId: firstProposal.agentId || firstProposal.cellId || 'local_memory',
    cellId: firstProposal.cellId || 'memory',
    observations,
    supportThreshold: 2,
  });

  return evidenceOnlyResult({
    ingested: true,
    skipped: false,
    proposalCount: normalizedProposals.length,
    reasons: extractionPolicy.reasons,
    extractionMode: extractionPolicy.mode,
    requiredGuards: extractionPolicy.requiredGuards,
    ingestResult,
  });
}
