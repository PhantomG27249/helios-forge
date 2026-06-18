import { readdir } from 'node:fs/promises';

import { readTrace } from '../core/traceReader.js';
import {
  getCandidateArchiveRoot,
  readArchivedCandidate,
} from './candidateArchive.js';

const SAFE_CANDIDATE_ID = /^[A-Za-z0-9_-]+$/;

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function runtimeCandidatePrefix(taskId) {
  const normalized = String(taskId || '').trim();
  if (!normalized) return null;
  return `runtime_${normalized}_`;
}

function sortCandidates(records = []) {
  return [...records].sort((left, right) => {
    const timeOrder = String(right.archivedAt || '').localeCompare(String(left.archivedAt || ''));
    if (timeOrder !== 0) return timeOrder;
    return String(right.candidateId || '').localeCompare(String(left.candidateId || ''));
  });
}

async function listRuntimeMetaCandidates({ workspaceRoot, taskId }) {
  const prefix = runtimeCandidatePrefix(taskId);
  if (!prefix) return [];

  const archiveRoot = getCandidateArchiveRoot(workspaceRoot);
  let entries;
  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const candidateIds = entries
    .filter((entry) => entry.isDirectory()
      && SAFE_CANDIDATE_ID.test(entry.name)
      && entry.name.startsWith(prefix))
    .map((entry) => entry.name);

  const records = [];
  for (const candidateId of candidateIds) {
    try {
      records.push(await readArchivedCandidate({ workspaceRoot, candidateId }));
    } catch {
      // Skip unreadable candidate archives without failing the whole load.
    }
  }
  return sortCandidates(records);
}

function extractSwarmChampion(trace = {}) {
  const events = Array.isArray(trace.events) ? trace.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === 'swarm.champion_selected' && event.champion) {
      return normalizeObject(event.champion);
    }
  }
  return null;
}

function extractHarnessOptimizerArtifact(trace = {}) {
  const artifacts = Array.isArray(trace.summary?.artifacts) ? trace.summary.artifacts : [];
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const artifact = artifacts[index];
    if (!artifact || typeof artifact !== 'object') continue;
    if (artifact.type === 'meta_optimizer_proposal' || artifact.filename === 'meta-optimizer-proposal.json') {
      return artifact;
    }
  }
  return null;
}

export async function loadTaskEvolutionInputs({ workspaceRoot, taskId } = {}) {
  if (!workspaceRoot || !taskId) return {};

  const inputs = {};

  try {
    const candidates = await listRuntimeMetaCandidates({ workspaceRoot, taskId });
    if (candidates.length > 0) {
      inputs.metaCandidate = candidates[0];
    }
  } catch {
    // Missing or unreadable candidate archives should not block post-task evolution.
  }

  try {
    const trace = await readTrace({ workspaceRoot, taskId });
    const swarmChampion = extractSwarmChampion(trace);
    if (swarmChampion && Object.keys(swarmChampion).length > 0) {
      inputs.swarmChampion = swarmChampion;
    }

    const optimizerArtifact = extractHarnessOptimizerArtifact(trace);
    if (optimizerArtifact?.path) {
      inputs.harnessOptimizerProposalArtifactPath = optimizerArtifact.path;
    }
  } catch {
    // Missing traces or unsafe task ids should degrade to empty inputs.
  }

  return inputs;
}
