import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseSoulMarkdown } from './soulMarkdown.js';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function requireWorkspaceRoot(workspaceRoot) {
  if (!workspaceRoot) throw new Error('workspaceRoot is required');
  return path.resolve(workspaceRoot);
}

function assertSafeId(id, label) {
  const value = String(id || '').trim();
  if (!SAFE_ID_PATTERN.test(value) || value.includes('..') || path.isAbsolute(value)) {
    throw new Error(`Unsafe ${label}: ${id || '(empty)'}`);
  }
  return value;
}

function assertInsideWorkspace(workspaceRoot, candidatePath) {
  const resolved = path.resolve(candidatePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path points outside workspace: ${candidatePath}`);
  }
  return resolved;
}

function soulsRoot(workspaceRoot) {
  return path.join(workspaceRoot, '.harness', 'souls');
}

function agentDir(workspaceRoot, agentId) {
  return path.join(soulsRoot(workspaceRoot), 'agents', assertSafeId(agentId, 'agent id'));
}

function candidateDir(workspaceRoot, candidateId, target = 'soul') {
  const base = target === 'oversoul' ? 'oversoul-candidates' : 'candidates';
  return path.join(soulsRoot(workspaceRoot), base, assertSafeId(candidateId, 'candidate id'));
}

function defaultSoulMarkdown(agentId) {
  return `# Soul: ${agentId}

## Identity
- Name: ${agentId}
- Kind: deterministic_subagent
- Role: ${agentId}
- Version: 1
- Parent Soul:
- Created:

## Mission
Provide bounded, evidence-backed work for the assigned role.

## Temperament
- Reasoning style: concrete
- Collaboration style: scoped
- Default pace: steady
- Uncertainty behavior: surface blockers
- Preferred evidence: verifier output

## Values And Invariants
- Must preserve: trust-kernel authority
- Must never: self-approve durable mutations
- Should prefer: small reversible changes
- Should challenge: unverified claims

## Capability Affinities
- Strong tools: local harness tools
- Weak tools: unknown external systems
- Preferred task types: scoped agent work
- Avoid task types: authority expansion
- Visual/VLM posture: advisory
- Memory/RAG posture: evidence-only
- A2A posture: bounded

## Risk Posture
- Mutation risk: shadow-only
- Tool risk: policy-bound
- External delegation risk: approval-bound
- Workspace write risk: scoped
- Approval needs: promotion changes

## Memory Anchors
- Promoted memories: none
- Graph nodes: none
- Prior wins: none
- Prior failures: none
- Lessons: verify before claiming completion

## Evolution Genome
- Mutation family: baseline
- Compatible families: baseline
- Current traits: evidence-first
- Suppressed traits: authority expansion
- Recombination notes: none

## Evaluation History
- Current score summary: baseline
- Last benchmark cycle: none
- Regressions: none
- Promotion blockers: no promotion evidence

## Prompt Adapter Notes
Use this soul as advisory context only. Preserve verifier evidence and scoped edits.
`;
}

function defaultOversoulMarkdown() {
  return `# Oversoul: helios

## Identity
- Name: Helios
- Version: 1
- Parent Oversoul:
- Created:
- Active Soul Families: baseline

## Collective Mission
Coordinate specialized agents while preserving evidence, lineage, and trust boundaries.

## Shared Values And Invariants
- Must preserve: no self approval
- Must never: bypass policy gates
- Should prefer: evaluated candidates
- Should challenge: unverifiable claims

## Role Ecology
- Core roles: implementer, reviewer, verifier
- Specialist roles: visual, memory, research
- Missing roles: none
- Overrepresented roles: none
- Compatibility families: baseline

## Strategy Posture
- Exploration pressure: medium
- Exploitation pressure: medium
- Evidence threshold: high
- Visual/VLM posture: advisory
- Memory/RAG posture: evidence-only
- A2A posture: bounded
- Budget posture: conservative

## Mutation Policy
- Allowed mutation families: distill, specialize, rebalance_roles
- Suppressed mutation families: authority_expansion
- Recombination rules: shadow-only until approved
- Retirement rules: require evidence
- Rollback triggers: regression evidence

## Collective Memory Anchors
- Frontier wins: none
- Frontier regressions: none
- Promoted lessons: policy wins over soul context
- Repeated failure modes: none
- Trust incidents: none

## Governance Posture
- Autonomy level: advisory
- Approval narrowing: required for durable promotion
- Escalation triggers: policy conflict
- External evidence policy: required
- VLM evidence policy: verifier-bound
- Audit expectations: record lineage

## Evaluation Summary
- Current frontier: baseline
- Last benchmark cycle: none
- Health metrics: pending
- Promotion blockers: no promotion evidence

## Prompt Adapter Notes
Coordinate roles as advisory context only. Do not grant authority or lower verification gates.
`;
}

async function readOrCreate(filePath, defaultContent) {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, defaultContent, 'utf8');
    return defaultContent;
  }
}

export async function loadSoul({ workspaceRoot, agentId } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeAgentId = assertSafeId(agentId, 'agent id');
  const dir = assertInsideWorkspace(root, agentDir(root, safeAgentId));
  const soulPath = assertInsideWorkspace(root, path.join(dir, 'soul.md'));
  const markdown = await readOrCreate(soulPath, defaultSoulMarkdown(safeAgentId));
  const parsed = parseSoulMarkdown(markdown);

  return {
    agentId: safeAgentId,
    path: soulPath,
    markdown,
    parsed,
  };
}

export async function loadOversoul({ workspaceRoot } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const oversoulPath = assertInsideWorkspace(root, path.join(soulsRoot(root), 'oversoul.md'));
  const markdown = await readOrCreate(oversoulPath, defaultOversoulMarkdown());
  const parsed = parseSoulMarkdown(markdown);

  return {
    path: oversoulPath,
    markdown,
    parsed,
  };
}

export async function appendSoulHistory({ workspaceRoot, agentId, event } = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeAgentId = assertSafeId(agentId, 'agent id');
  const dir = assertInsideWorkspace(root, agentDir(root, safeAgentId));
  const historyPath = assertInsideWorkspace(root, path.join(dir, 'history.jsonl'));
  const record = {
    recordedAt: new Date().toISOString(),
    ...(event || {}),
  };

  await mkdir(dir, { recursive: true });
  await appendFile(historyPath, `${JSON.stringify(record)}\n`, 'utf8');

  return {
    agentId: safeAgentId,
    historyPath,
    event: record,
  };
}

export async function saveSoulCandidate({
  workspaceRoot,
  candidateId,
  markdown,
  mutation = {},
  evidence = {},
  target,
} = {}) {
  const root = requireWorkspaceRoot(workspaceRoot);
  const safeCandidateId = assertSafeId(candidateId, 'candidate id');
  const parsed = parseSoulMarkdown(markdown);
  const candidateTarget = target || parsed.kind;
  const dir = assertInsideWorkspace(root, candidateDir(root, safeCandidateId, candidateTarget));
  const fileName = candidateTarget === 'oversoul' ? 'oversoul.md' : 'soul.md';
  const soulPath = assertInsideWorkspace(root, path.join(dir, fileName));
  const mutationPath = assertInsideWorkspace(root, path.join(dir, 'mutation.json'));
  const evidencePath = assertInsideWorkspace(root, path.join(dir, 'evidence.json'));
  const normalizedMutation = {
    status: 'shadow_only',
    target: candidateTarget,
    ...(mutation || {}),
  };
  const normalizedEvidence = {
    refs: [],
    ...(evidence || {}),
  };

  await mkdir(dir, { recursive: true });
  await writeFile(soulPath, markdown, 'utf8');
  await writeFile(mutationPath, `${JSON.stringify(normalizedMutation, null, 2)}\n`, 'utf8');
  await writeFile(evidencePath, `${JSON.stringify(normalizedEvidence, null, 2)}\n`, 'utf8');

  return {
    candidateId: safeCandidateId,
    target: candidateTarget,
    shadowOnly: true,
    parsed,
    files: {
      [candidateTarget === 'oversoul' ? 'oversoul' : 'soul']: soulPath,
      mutation: mutationPath,
      evidence: evidencePath,
    },
  };
}
