# Hierarchical Swarm Meta-Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local/global self-improving swarm architecture: each SwarmCell gets local memory, local BES/RHO/meta optimization, and evolution output, while the global meta-harness performs replay, frontier comparison, durable memory promotion, and trust-kernel-gated apply.

**Architecture:** Implement this as a staged extension of the existing `src/harness-sidecar` subsystems. Local loops produce evidence and proposals; global loops compare and archive candidates; trust-kernel boundaries prevent local or global optimizers from self-authorizing durable changes.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules under `src/harness-sidecar/{swarm,meta,memory,rho,bes,core,rag}`, workspace-local `.harness` artifacts.

---

## Implementation Status

Status as of 2026-06-09: the first implementation pass is complete on branch `codex/hierarchical-swarm-meta-harness`.

Committed checkpoints:

- `bb68002 feat: add swarmcell evolution contracts`
- `24bb2e3 fix: enforce swarmcell contract failures`
- `51488d1 feat: add local meta harness runtime`
- `ae636f6 fix: preserve local evolution proposal fields`
- `887d343 fix: preserve local meta candidate evidence`
- `9337f26 feat: add local global memory graph runtime`
- `8afddc9 fix: load memory graph runtime snapshots`
- `40fbbd8 fix: include hierarchical graph retrieval context`
- `e5c8214 fix: honor hierarchical memory budgets`
- `e4fc78e feat: add rho replay and bes lane contracts`
- `f6a3bae fix: harden rho bes evidence scoring`
- `6f86ff6 fix: reject failed rho validation evidence`
- `4d607ca feat: add global harness experiments and trust gates`
- `99ba406 fix: harden harness trust boundaries`
- `8fb8ed4 fix: require source patch path metadata`
- `45d6da1 feat: wire hierarchical swarm loop visibility`

Implemented scope:

- Chunk 1: SwarmCell contracts, registry, worker evolution-output threading, and durable local-approval rejection.
- Chunk 2: local meta-harness, local evolution loop, candidate archive, local promotion blocker, and SwarmCell runtime hook.
- Chunk 3: local memory graph, SwarmCell graph merge, global memory promotion, extraction society scaffold, memory graph runtime, and hierarchical retriever.
- Chunk 4: RHO replay batches, self-validation, self-consistency, self-preference, BES lane contracts, trajectory operators, dense subgoal verifier, and lineage tracker.
- Chunk 5: harness run store, experiment runner, frontier update, trust-kernel boundary checks, and hardened source-patch metadata validation.
- Chunk 6: orchestrator/server/UI wiring for `local_meta.completed`, independently gated `local_memory.proposed`, and harness experiment operator visibility.

Verification from the completed pass:

```powershell
node --test tests/harness-swarmcell-contracts.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-rho-replay-batch.test.js tests/harness-bes-lane-contracts.test.js tests/harness-meta-experiment-runs.test.js tests/harness-trust-kernel-boundary.test.js tests/harness-hierarchical-swarm-integration.test.js
```

Result: 44/44 passing.

```powershell
node --test tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js tests/harness-memgraphrag-construction.test.js tests/harness-memory-aware-graph-retriever.test.js tests/harness-rho-coreset.test.js tests/harness-rho-preference.test.js tests/harness-bidirectional-bes.test.js tests/harness-shinka-evolution.test.js tests/harness-meta-promotion-loop.test.js tests/harness-auto-approval-policy.test.js tests/harness-ui-discoverability.test.js
```

Result: 86/86 passing.

```powershell
npm run release:smoke
```

Result: passing.

Known caveat: the repo-wide `npm test` had an unrelated UI asset-version mismatch in `tests/chat-image-paste.test.js`; that was outside this plan's scope.

---

## Source Documents

- `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`
- `docs/architecture/paper-implementation-alignment.md`
- `docs/architecture/feature-architecture-map.md`
- `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md`

## Execution Model

Use one fresh subagent per chunk. Each subagent should:

- read only the source documents and files listed in its chunk;
- write tests first;
- keep changes scoped to its chunk;
- run the focused tests listed in the chunk;
- run `npm run release:smoke`;
- commit its completed chunk before the next subagent starts, unless the operator says not to commit.

Recommended commit messages:

- `feat: add swarmcell evolution contracts`
- `feat: add local meta harness runtime`
- `feat: add local global memory graph runtime`
- `feat: add rho replay and bes lane contracts`
- `feat: add global harness experiments and trust gates`

## File Structure

### Swarm Contracts

- Create `src/harness-sidecar/swarm/swarmCellContracts.js`
  - Owns SwarmCell record normalization, `taskOutput`, `evolutionOutput`, and evidence contract validation.
- Create `src/harness-sidecar/swarm/swarmCellRegistry.js`
  - Owns default SwarmCell definitions and role lookup.
- Create `src/harness-sidecar/swarm/swarmCellRuntime.js`
  - Runs a SwarmCell by calling existing swarm workers plus local meta/memory hooks.
- Modify `src/harness-sidecar/swarm/subagentRunner.js`
  - Normalizes evolution output in every subagent attempt.
- Modify `src/harness-sidecar/swarm/modelDrivenWorker.js`
  - Preserves model-provided evolution output.
- Modify `src/harness-sidecar/swarm/piNativeWorker.js`
  - Preserves Pi-native evolution output.

### Local Meta-Harness

- Create `src/harness-sidecar/meta/localCandidateArchive.js`
  - Stores local candidate records under `.harness/meta/local-candidates/<cell-id>/<candidate-id>/`.
- Create `src/harness-sidecar/meta/localEvolutionLoop.js`
  - Runs local hard-case tagging, local BES mutation, and local replay summaries.
- Create `src/harness-sidecar/meta/localMetaHarness.js`
  - Orchestrates local meta-harness input/output for a SwarmCell.
- Create `src/harness-sidecar/meta/localPromotionBlocker.js`
  - Ensures local meta-harnesses never mark durable apply as approved.

### Local And Global Memory

- Create `src/harness-sidecar/memory/localMemoryGraph.js`
  - Fast speculative graph for one agent.
- Create `src/harness-sidecar/memory/swarmCellMemoryGraph.js`
  - Merges local agent graphs into a SwarmCell graph.
- Create `src/harness-sidecar/memory/memoryExtractionSociety.js`
  - Sidecar-local roles for passage collection, schema proposal, fact extraction, contradiction critique, and merge planning.
- Create `src/harness-sidecar/memory/globalMemoryPromotion.js`
  - Converts stable local/SwarmCell facts into global promotion proposals.
- Create `src/harness-sidecar/memory/memoryGraphRuntime.js`
  - Loads/persists global layers and runs extraction, conflict adjudication, graph construction, and eval hooks.
- Create `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
  - Combines schema, active facts, passages, bridges, and graph summary into task context.

### RHO/BES Completion

- Create `src/harness-sidecar/rho/replayBatchRunner.js`
  - Runs grouped replay attempts for selected coreset items.
- Create `src/harness-sidecar/rho/selfValidation.js`
  - Scores within-trajectory validity signals.
- Create `src/harness-sidecar/rho/selfConsistency.js`
  - Scores cross-rollout agreement signals.
- Create `src/harness-sidecar/rho/selfPreferenceJudge.js`
  - Compares baseline and candidate grouped rollouts.
- Create `src/harness-sidecar/bes/laneContracts.js`
  - Defines candidate units and verifier units for each lane.
- Create `src/harness-sidecar/bes/trajectoryOperators.js`
  - Provides expansion, deletion, translocation, crossover, and recombination operators.
- Create `src/harness-sidecar/bes/denseSubgoalVerifier.js`
  - Produces dense scoring for lane subgoals.
- Create `src/harness-sidecar/bes/globalLineageTracker.js`
  - Tracks candidate ancestry across local/global BES.

### Global Experiments And Trust Gates

- Create `src/harness-sidecar/meta/harnessRunStore.js`
  - Stores `.harness/meta/harness-runs/<run-id>/` records.
- Create `src/harness-sidecar/meta/harnessExperimentRunner.js`
  - Runs baseline/candidate replay comparison and writes promotion evidence.
- Create `src/harness-sidecar/meta/harnessFrontier.js`
  - Maintains global frontier across quality, safety, cost, latency, reliability, and maintainability.
- Create `src/harness-sidecar/core/trustKernelBoundary.js`
  - Centralizes checks that local/global optimizers cannot weaken trust rules.

---

## Chunk 1: SwarmCell Contracts And Evolution Output

**Subagent:** `swarm-contracts-worker`

**Goal:** Every subagent and SwarmCell returns normalized `taskOutput`, `evolutionOutput`, and evidence fields without changing current swarm behavior.

**Files:**
- Create: `src/harness-sidecar/swarm/swarmCellContracts.js`
- Create: `src/harness-sidecar/swarm/swarmCellRegistry.js`
- Create: `tests/harness-swarmcell-contracts.test.js`
- Modify: `src/harness-sidecar/swarm/subagentRunner.js`
- Modify: `src/harness-sidecar/swarm/modelDrivenWorker.js`
- Modify: `src/harness-sidecar/swarm/piNativeWorker.js`
- Modify: `tests/harness-swarm-runtime.test.js`
- Modify: `tests/harness-swarm-model-worker.test.js`
- Modify: `tests/harness-swarm-pi-native-worker.test.js`

### Task 1: Add SwarmCell contract normalization

- [ ] **Step 1: Write failing tests**

Create `tests/harness-swarmcell-contracts.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEvolutionOutput,
  normalizeSwarmCellOutput,
  validateSwarmCellContract,
} from '../src/harness-sidecar/swarm/swarmCellContracts.js';

test('normalizes missing evolution output to an explicit empty proposal', () => {
  const output = normalizeSwarmCellOutput({
    summary: 'patched verifier',
    verifierEvidence: ['npm test'],
  });

  assert.equal(output.taskOutput.summary, 'patched verifier');
  assert.deepEqual(output.evolutionOutput.hardCaseTags, []);
  assert.equal(output.evolutionOutput.durableApplyRequested, false);
});

test('rejects local evolution output that claims durable approval', () => {
  const validation = validateSwarmCellContract({
    taskOutput: { summary: 'ok' },
    evolutionOutput: {
      suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
      durableApplyApproved: true,
    },
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes('local_durable_approval_forbidden'), true);
});

test('normalizes evolution evidence lists', () => {
  const output = normalizeEvolutionOutput({
    hardCaseTags: 'swarm_missing_verifier_evidence',
    suggestedPolicyChange: { lane: 'verifier' },
    evidenceRefs: 'trace:task-1',
  });

  assert.deepEqual(output.hardCaseTags, ['swarm_missing_verifier_evidence']);
  assert.deepEqual(output.evidenceRefs, ['trace:task-1']);
  assert.equal(output.suggestedPolicyChange.lane, 'verifier');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/harness-swarmcell-contracts.test.js`

Expected: FAIL with module not found for `swarmCellContracts.js`.

- [ ] **Step 3: Implement minimal contract module**

Create `src/harness-sidecar/swarm/swarmCellContracts.js` with exports:

```js
function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

export function normalizeEvolutionOutput(output = {}) {
  return {
    hardCaseTags: asArray(output.hardCaseTags),
    roleWeakness: output.roleWeakness || null,
    suggestedProfileChange: output.suggestedProfileChange || null,
    suggestedSkill: output.suggestedSkill || null,
    suggestedPolicyChange: output.suggestedPolicyChange || null,
    suggestedVerifierChange: output.suggestedVerifierChange || null,
    suggestedMemoryPolicyChange: output.suggestedMemoryPolicyChange || null,
    suggestedCodeChange: output.suggestedCodeChange || null,
    memoryProposals: asArray(output.memoryProposals),
    evidenceRefs: asArray(output.evidenceRefs),
    durableApplyRequested: output.durableApplyRequested === true,
    durableApplyApproved: output.durableApplyApproved === true,
  };
}

export function normalizeTaskOutput(output = {}) {
  return {
    summary: output.summary || output.taskOutput?.summary || null,
    patch: output.patch || output.taskOutput?.patch || '',
    verifierEvidence: asArray(output.verifierEvidence || output.taskOutput?.verifierEvidence),
    artifacts: asArray(output.artifacts || output.taskOutput?.artifacts),
  };
}

export function normalizeSwarmCellOutput(output = {}) {
  return {
    taskOutput: normalizeTaskOutput(output.taskOutput || output),
    evolutionOutput: normalizeEvolutionOutput(output.evolutionOutput || output.evolution || {}),
    evidence: {
      traceRefs: asArray(output.evidence?.traceRefs || output.traceRefs),
      verifierRefs: asArray(output.evidence?.verifierRefs || output.verifierRefs),
      replayRefs: asArray(output.evidence?.replayRefs || output.replayRefs),
      riskRefs: asArray(output.evidence?.riskRefs || output.riskRefs),
    },
  };
}

export function validateSwarmCellContract(output = {}) {
  const normalized = output.taskOutput ? output : normalizeSwarmCellOutput(output);
  const reasons = [];
  if (!normalized.taskOutput?.summary) reasons.push('missing_task_summary');
  if (normalized.evolutionOutput?.durableApplyApproved === true) {
    reasons.push('local_durable_approval_forbidden');
  }
  return { valid: reasons.length === 0, reasons, output: normalized };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/harness-swarmcell-contracts.test.js`

Expected: PASS.

### Task 2: Add default SwarmCell registry

- [ ] **Step 1: Extend failing test**

Add to `tests/harness-swarmcell-contracts.test.js`:

```js
import { getDefaultSwarmCells, resolveSwarmCell } from '../src/harness-sidecar/swarm/swarmCellRegistry.js';

test('default swarm cells declare local meta and memory policies', () => {
  const cells = getDefaultSwarmCells();
  const code = resolveSwarmCell('code');

  assert.equal(cells.length >= 6, true);
  assert.equal(code.cellId, 'code');
  assert.equal(code.localMetaHarness.enabled, true);
  assert.equal(code.localMemoryGraph.enabled, true);
  assert.equal(Array.isArray(code.localAgents), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/harness-swarmcell-contracts.test.js`

Expected: FAIL with module not found for `swarmCellRegistry.js`.

- [ ] **Step 3: Implement registry**

Create `src/harness-sidecar/swarm/swarmCellRegistry.js`:

```js
const DEFAULT_CELLS = [
  ['code', ['implementer', 'test_writer', 'patch_minimizer']],
  ['verifier', ['command_verifier', 'flake_critic', 'coverage_critic']],
  ['memory_rag', ['passage_collector', 'schema_proposer', 'fact_extractor', 'contradiction_critic']],
  ['research', ['source_finder', 'citation_auditor', 'contradiction_finder']],
  ['visual_vlm', ['screenshot_worker', 'ocr_worker', 'layout_critic']],
  ['safety_review', ['secret_scanner', 'permission_critic', 'rollback_checker']],
];

function createCell([cellId, localAgents]) {
  return {
    cellId,
    role: cellId,
    localAgents,
    localMetaHarness: { enabled: true },
    localMemoryGraph: { enabled: true },
    mutationPolicy: { durableApply: 'global_only' },
    outputContract: {
      requiredFields: ['summary'],
      evolutionOutput: true,
    },
  };
}

export function getDefaultSwarmCells() {
  return DEFAULT_CELLS.map(createCell);
}

export function resolveSwarmCell(cellId, cells = getDefaultSwarmCells()) {
  const found = cells.find((cell) => cell.cellId === cellId || cell.role === cellId);
  if (!found) throw new Error(`Unknown SwarmCell: ${cellId}`);
  return found;
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/harness-swarmcell-contracts.test.js`

Expected: PASS.

### Task 3: Thread evolution output through subagent workers

- [ ] **Step 1: Update failing tests**

Add assertions in existing worker tests:

- `tests/harness-swarm-runtime.test.js`: `runSubagentAttempt` result includes `evolutionOutput`.
- `tests/harness-swarm-model-worker.test.js`: model output `evolutionOutput` survives normalization.
- `tests/harness-swarm-pi-native-worker.test.js`: Pi-native compact handoff includes evolution output.

Use this assertion shape:

```js
assert.deepEqual(result.evolutionOutput.hardCaseTags, ['missing_context']);
assert.equal(result.contract.valid, true);
```

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```powershell
node --test tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js
```

Expected: FAIL because workers do not expose normalized `evolutionOutput`.

- [ ] **Step 3: Modify worker implementations**

In `src/harness-sidecar/swarm/subagentRunner.js`:

- import `normalizeEvolutionOutput`;
- compute `const evolutionOutput = normalizeEvolutionOutput(output?.evolutionOutput || output?.evolution || {});`;
- add `evolutionOutput` to success result;
- add empty normalized `evolutionOutput` to failure result.

In `src/harness-sidecar/swarm/modelDrivenWorker.js` and `src/harness-sidecar/swarm/piNativeWorker.js`:

- preserve `evolutionOutput` from model/Pi result;
- never set `durableApplyApproved` based on model output.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests/harness-swarmcell-contracts.test.js tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\swarm tests\harness-swarmcell-contracts.test.js tests\harness-swarm-runtime.test.js tests\harness-swarm-model-worker.test.js tests\harness-swarm-pi-native-worker.test.js
git commit -m "feat: add swarmcell evolution contracts"
```

---

## Chunk 2: Local Meta-Harness Runtime

**Subagent:** `local-meta-harness-worker`

**Goal:** Each SwarmCell can run a local meta-harness loop that records tactical failures, proposes scoped mutations, archives local candidates, and blocks durable self-approval.

**Files:**
- Create: `src/harness-sidecar/meta/localCandidateArchive.js`
- Create: `src/harness-sidecar/meta/localEvolutionLoop.js`
- Create: `src/harness-sidecar/meta/localMetaHarness.js`
- Create: `src/harness-sidecar/meta/localPromotionBlocker.js`
- Create: `tests/harness-local-meta-harness.test.js`
- Modify: `src/harness-sidecar/swarm/swarmCellRuntime.js`
- Modify: `tests/harness-swarmcell-runtime.test.js`

### Task 1: Add local promotion blocker

- [ ] **Step 1: Write failing test**

Create `tests/harness-local-meta-harness.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { blockLocalDurablePromotion } from '../src/harness-sidecar/meta/localPromotionBlocker.js';

test('local meta-harness cannot approve durable apply', () => {
  const result = blockLocalDurablePromotion({
    candidateId: 'local_code_1',
    durableApplyApproved: true,
    suggestedCodeChange: { path: 'src/harness-sidecar/server.js' },
  });

  assert.equal(result.durableApplyApproved, false);
  assert.equal(result.forwardToGlobal, true);
  assert.equal(result.reasons.includes('local_meta_harness_cannot_self_authorize'), true);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement blocker**

Create `src/harness-sidecar/meta/localPromotionBlocker.js`:

```js
export function blockLocalDurablePromotion(candidate = {}) {
  const needsGlobal = Boolean(
    candidate.durableApplyApproved ||
    candidate.suggestedCodeChange ||
    candidate.suggestedVerifierChange ||
    candidate.suggestedMemoryPolicyChange ||
    candidate.suggestedPolicyChange,
  );
  return {
    ...candidate,
    durableApplyApproved: false,
    localOnly: true,
    forwardToGlobal: needsGlobal,
    reasons: [
      ...(candidate.reasons || []),
      ...(needsGlobal ? ['local_meta_harness_cannot_self_authorize'] : []),
    ],
  };
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: PASS.

### Task 2: Add local candidate archive

- [ ] **Step 1: Extend failing tests**

Add:

```js
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { archiveLocalCandidate } from '../src/harness-sidecar/meta/localCandidateArchive.js';

test('archives local candidate under cell scoped directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-local-meta-'));
  const record = await archiveLocalCandidate({
    workspaceRoot,
    cellId: 'code',
    candidate: { candidateId: 'lc_1', mutationType: 'prompt_reorder' },
    evidence: { traceRefs: ['trace:1'] },
  });

  const saved = JSON.parse(await readFile(record.recordPath, 'utf8'));
  assert.equal(saved.cellId, 'code');
  assert.equal(saved.candidate.candidateId, 'lc_1');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: FAIL with module not found.

- [ ] **Step 3: Implement archive**

Create `src/harness-sidecar/meta/localCandidateArchive.js` using the safe-id pattern from `candidateArchive.js`.

Required export:

```js
export async function archiveLocalCandidate({ workspaceRoot, cellId, candidate, evidence }) {
  // write .harness/meta/local-candidates/<cell-id>/<candidate-id>/candidate.json
}
```

Record shape:

```js
{
  schemaVersion: 1,
  cellId,
  candidateId,
  archivedAt,
  candidate,
  evidence,
  scope: 'local_meta_harness'
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: PASS.

### Task 3: Add local evolution loop

- [ ] **Step 1: Extend failing test**

Add:

```js
import { runLocalEvolutionLoop } from '../src/harness-sidecar/meta/localEvolutionLoop.js';

test('local evolution loop tags hard cases and proposes local BES mutation', () => {
  const result = runLocalEvolutionLoop({
    cellId: 'code',
    attempt: {
      attemptId: 'a1',
      status: 'completed',
      evolutionOutput: {
        hardCaseTags: ['missing_context'],
        suggestedProfileChange: { contextBudget: 'larger' },
      },
    },
  });

  assert.equal(result.cellId, 'code');
  assert.equal(result.hardCaseTags.includes('missing_context'), true);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].scope, 'local');
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement minimal loop**

Create `src/harness-sidecar/meta/localEvolutionLoop.js`.

Implementation requirements:

- consume attempt `evolutionOutput.hardCaseTags`;
- create candidate IDs as `local_<cellId>_<n>`;
- include `mutationType`, `target`, `scope: 'local'`, and `forwardToGlobal`;
- call `blockLocalDurablePromotion`.

- [ ] **Step 4: Add orchestrator**

Create `src/harness-sidecar/meta/localMetaHarness.js` with:

```js
export async function runLocalMetaHarness({
  workspaceRoot,
  cell,
  attempt,
  archive = true,
} = {}) {
  // run local evolution loop; archive candidates when workspaceRoot and archive true
}
```

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/harness-local-meta-harness.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src\harness-sidecar\meta tests\harness-local-meta-harness.test.js
git commit -m "feat: add local meta harness runtime"
```

---

## Chunk 3: Local And Global MemGraphRAG Runtime

**Subagent:** `memory-graph-runtime-worker`

**Goal:** Add local agent graphs, SwarmCell graph merging, global promotion proposals, extraction society roles, persistent global runtime, and hierarchical retrieval.

**Files:**
- Create: `src/harness-sidecar/memory/localMemoryGraph.js`
- Create: `src/harness-sidecar/memory/swarmCellMemoryGraph.js`
- Create: `src/harness-sidecar/memory/memoryExtractionSociety.js`
- Create: `src/harness-sidecar/memory/globalMemoryPromotion.js`
- Create: `src/harness-sidecar/memory/memoryGraphRuntime.js`
- Create: `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
- Create: `tests/harness-local-global-memory-graph.test.js`
- Modify: `tests/harness-memgraphrag-construction.test.js`
- Modify: `tests/harness-memory-aware-graph-retriever.test.js`

### Task 1: Add local memory graph

- [ ] **Step 1: Write failing test**

Create `tests/harness-local-global-memory-graph.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalMemoryGraph, addLocalObservation } from '../src/harness-sidecar/memory/localMemoryGraph.js';

test('local memory graph accepts speculative observations', () => {
  const graph = createLocalMemoryGraph({ agentId: 'code.impl' });
  addLocalObservation(graph, {
    kind: 'fact',
    subject: 'subagentRunner',
    relation: 'needs',
    object: 'evolutionOutput',
    passageId: 'trace-1',
  });

  assert.equal(graph.agentId, 'code.impl');
  assert.equal(graph.facts[0].status, 'local_pending');
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/harness-local-global-memory-graph.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement local graph**

Create `src/harness-sidecar/memory/localMemoryGraph.js`.

Required exports:

- `createLocalMemoryGraph({ agentId, taskId })`
- `addLocalObservation(graph, observation)`
- `localGraphToMemoryProposal(graph)`

Use existing schema/fact/passage vocabulary from `globalMemoryLayers.js`.

- [ ] **Step 4: Run test**

Run: `node --test tests/harness-local-global-memory-graph.test.js`

Expected: PASS.

### Task 2: Add SwarmCell graph merge and global promotion proposal

- [ ] **Step 1: Extend failing test**

Add:

```js
import { mergeSwarmCellMemoryGraphs } from '../src/harness-sidecar/memory/swarmCellMemoryGraph.js';
import { proposeGlobalMemoryPromotions } from '../src/harness-sidecar/memory/globalMemoryPromotion.js';

test('swarm cell memory merge promotes stable repeated local facts', () => {
  const left = createLocalMemoryGraph({ agentId: 'code.impl' });
  const right = createLocalMemoryGraph({ agentId: 'code.test' });
  addLocalObservation(left, { kind: 'fact', subject: 'A', relation: 'requires', object: 'B', passageId: 'p1' });
  addLocalObservation(right, { kind: 'fact', subject: 'A', relation: 'requires', object: 'B', passageId: 'p2' });

  const merged = mergeSwarmCellMemoryGraphs({ cellId: 'code', localGraphs: [left, right] });
  const proposal = proposeGlobalMemoryPromotions({ swarmCellGraph: merged, supportThreshold: 2 });

  assert.equal(proposal.facts.length, 1);
  assert.equal(proposal.facts[0].status, 'pending');
  assert.deepEqual(proposal.facts[0].passageIds, ['p1', 'p2']);
});
```

- [ ] **Step 2: Run test**

Run: `node --test tests/harness-local-global-memory-graph.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement merge and promotion**

Create `src/harness-sidecar/memory/swarmCellMemoryGraph.js` and `globalMemoryPromotion.js`.

Requirements:

- deterministic sorting;
- combine duplicate facts by subject/relation/object;
- preserve provenance passage IDs;
- only promote facts with support count >= threshold;
- keep promoted global facts `status: 'pending'`, not `active`.

- [ ] **Step 4: Run test**

Run: `node --test tests/harness-local-global-memory-graph.test.js`

Expected: PASS.

### Task 3: Add memory extraction society and global runtime

- [ ] **Step 1: Extend failing test**

Add:

```js
import { runMemoryExtractionSociety } from '../src/harness-sidecar/memory/memoryExtractionSociety.js';
import { createMemoryGraphRuntime } from '../src/harness-sidecar/memory/memoryGraphRuntime.js';

test('memory extraction society produces passages schemas facts and critique', () => {
  const result = runMemoryExtractionSociety({
    cellId: 'memory_rag',
    observations: [{ text: 'Helios uses local meta harnesses.', source: 'trace-1' }],
  });

  assert.equal(result.passages.length, 1);
  assert.equal(Array.isArray(result.schemas), true);
  assert.equal(Array.isArray(result.facts), true);
  assert.equal(Array.isArray(result.contradictions), true);
});

test('global memory runtime persists pending layers and constructs graph', async () => {
  const runtime = createMemoryGraphRuntime({ workspaceRoot: await makeTempWorkspace() });
  const result = await runtime.ingestPromotion({
    passages: [{ passageId: 'p1', text: 'A requires B.' }],
    schemas: [{ headType: 'module', relation: 'requires', tailType: 'feature', frequency: 2 }],
    facts: [{ subject: 'A', relation: 'requires', object: 'B', passageIds: ['p1'] }],
  });

  assert.equal(result.layers.facts.length, 1);
  assert.equal(result.graph.stats.passageCount, 1);
});
```

Implement `makeTempWorkspace` in the test with `mkdtemp`.

- [ ] **Step 2: Run test**

Run: `node --test tests/harness-local-global-memory-graph.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement extraction society**

Create deterministic heuristics in `memoryExtractionSociety.js`:

- passages from observation text/source;
- schemas from explicit `subjectType/relation/objectType` when present;
- facts from explicit observation fields;
- contradictions from duplicate subject/relation with different objects.

- [ ] **Step 4: Implement memory graph runtime**

Create `memoryGraphRuntime.js`:

- load `.harness/memory/global-layers.json` if present;
- create layers with `createGlobalMemoryLayers`;
- ingest proposals with `upsertPassage`, `upsertSchema`, `upsertFact`;
- run `activateStableSchemas`;
- run existing conflict adjudication if available;
- run `constructMemoryGuidedGraph`;
- persist `global-layers.json` and `global-graph.json`.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/harness-local-global-memory-graph.test.js tests/harness-memgraphrag-construction.test.js tests/harness-memory-aware-graph-retriever.test.js
```

Expected: PASS.

### Task 4: Add hierarchical memory retriever

- [ ] **Step 1: Write failing test**

Add to `tests/harness-local-global-memory-graph.test.js`:

```js
import { retrieveHierarchicalMemoryContext } from '../src/harness-sidecar/rag/hierarchicalMemoryRetriever.js';

test('hierarchical retriever returns schema fact passage and graph summary context', () => {
  const context = retrieveHierarchicalMemoryContext({
    query: 'A requires B',
    layers: {
      schemas: [{ id: 'schema_module_requires_feature', headType: 'module', relation: 'requires', tailType: 'feature', status: 'stable' }],
      facts: [{ id: 'fact_a_requires_b', subject: 'A', relation: 'requires', object: 'B', status: 'active', passageIds: ['p1'] }],
      passages: [{ passageId: 'p1', text: 'A requires B.' }],
    },
    graph: { nodes: [], edges: [], stats: { activeFactCount: 1 } },
  });

  assert.equal(context.items.some((item) => item.kind === 'active_fact'), true);
  assert.equal(context.items.some((item) => item.kind === 'passage'), true);
  assert.equal(context.summary.activeFactCount, 1);
});
```

- [ ] **Step 2: Implement retriever**

Create `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`.

Requirements:

- deterministic scoring by query token overlap;
- bounded `maxItems`;
- return `items` with `kind`, `score`, `text`, `provenance`;
- return `summary` with schema/fact/passage counts.

- [ ] **Step 3: Run tests and commit**

Run:

```powershell
node --test tests/harness-local-global-memory-graph.test.js tests/harness-memgraphrag-construction.test.js tests/harness-memory-aware-graph-retriever.test.js
npm run release:smoke
```

Expected: PASS.

Commit:

```powershell
git add src\harness-sidecar\memory src\harness-sidecar\rag tests\harness-local-global-memory-graph.test.js tests\harness-memgraphrag-construction.test.js tests\harness-memory-aware-graph-retriever.test.js
git commit -m "feat: add local global memory graph runtime"
```

---

## Chunk 4: RHO Replay And BES Lane Contracts

**Subagent:** `rho-bes-completion-worker`

**Goal:** Close the RHO/BES paper gaps enough for harness-level use: grouped replay, self-validation, self-consistency, self-preference, lane contracts, trajectory operators, dense subgoal verification, and global lineage.

**Files:**
- Create: `src/harness-sidecar/rho/replayBatchRunner.js`
- Create: `src/harness-sidecar/rho/selfValidation.js`
- Create: `src/harness-sidecar/rho/selfConsistency.js`
- Create: `src/harness-sidecar/rho/selfPreferenceJudge.js`
- Create: `src/harness-sidecar/bes/laneContracts.js`
- Create: `src/harness-sidecar/bes/trajectoryOperators.js`
- Create: `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- Create: `src/harness-sidecar/bes/globalLineageTracker.js`
- Create: `tests/harness-rho-replay-batch.test.js`
- Create: `tests/harness-bes-lane-contracts.test.js`
- Modify: `tests/harness-rho-preference.test.js`
- Modify: `tests/harness-bidirectional-bes.test.js`

### Task 1: Add self-validation and self-consistency

- [ ] **Step 1: Write failing tests**

Create `tests/harness-rho-replay-batch.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreSelfValidation } from '../src/harness-sidecar/rho/selfValidation.js';
import { scoreSelfConsistency } from '../src/harness-sidecar/rho/selfConsistency.js';

test('self-validation rewards verifier-backed complete trajectories', () => {
  const score = scoreSelfValidation({
    status: 'completed',
    verifierEvidence: [{ passed: true }],
    compactHandoff: { summary: 'done', testsRun: ['npm test'] },
  });

  assert.equal(score.passed, true);
  assert.equal(score.reasons.includes('verifier_passed'), true);
});

test('self-consistency detects agreement across grouped rollouts', () => {
  const score = scoreSelfConsistency({
    rollouts: [
      { output: { summary: 'use local meta harness' } },
      { output: { summary: 'use local meta harness' } },
      { output: { summary: 'different' } },
    ],
  });

  assert.equal(score.consistent, true);
  assert.equal(score.majorityCount, 2);
});
```

- [ ] **Step 2: Implement modules**

Create `selfValidation.js` and `selfConsistency.js`.

Use simple deterministic signals:

- validation passes with completed status plus verifier passed or test evidence;
- consistency groups normalized summaries and requires majority.

- [ ] **Step 3: Run test**

Run: `node --test tests/harness-rho-replay-batch.test.js`

Expected: PASS.

### Task 2: Add replay batch runner and self-preference judge

- [ ] **Step 1: Extend failing tests**

Add:

```js
import { runRhoReplayBatch } from '../src/harness-sidecar/rho/replayBatchRunner.js';
import { judgeSelfPreference } from '../src/harness-sidecar/rho/selfPreferenceJudge.js';

test('replay batch runs grouped baseline and candidate attempts', async () => {
  const result = await runRhoReplayBatch({
    coreset: { items: [{ taskId: 'task-1', trace: { task: 'x' } }] },
    groupSize: 2,
    baselineRunner: async () => ({ status: 'completed', output: { summary: 'baseline' }, verifierEvidence: [] }),
    candidateRunner: async () => ({ status: 'completed', output: { summary: 'candidate' }, verifierEvidence: [{ passed: true }] }),
  });

  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].baseline.rollouts.length, 2);
  assert.equal(result.cases[0].candidate.rollouts.length, 2);
});

test('self-preference prefers candidate with stronger validation and consistency', () => {
  const decision = judgeSelfPreference({
    baseline: { validation: { score: 1 }, consistency: { score: 0.5 } },
    candidate: { validation: { score: 2 }, consistency: { score: 1 } },
  });

  assert.equal(decision.preferred, 'candidate');
});
```

- [ ] **Step 2: Implement modules**

Requirements:

- `runRhoReplayBatch` accepts `coreset`, `groupSize`, `baselineRunner`, `candidateRunner`;
- produce per-case baseline/candidate rollouts;
- attach validation/consistency summaries;
- `judgeSelfPreference` returns `preferred`, `scoreDelta`, and reasons.

- [ ] **Step 3: Run tests**

Run:

```powershell
node --test tests/harness-rho-replay-batch.test.js tests/harness-rho-preference.test.js
```

Expected: PASS.

### Task 3: Add BES lane contracts and trajectory operators

- [ ] **Step 1: Write failing tests**

Create `tests/harness-bes-lane-contracts.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getBesLaneContract } from '../src/harness-sidecar/bes/laneContracts.js';
import { applyTrajectoryOperator } from '../src/harness-sidecar/bes/trajectoryOperators.js';
import { verifyDenseSubgoals } from '../src/harness-sidecar/bes/denseSubgoalVerifier.js';
import { recordLineage } from '../src/harness-sidecar/bes/globalLineageTracker.js';

test('BES lane contracts define candidate and verifier units', () => {
  const contract = getBesLaneContract('memory');
  assert.equal(contract.lane, 'memory');
  assert.equal(contract.candidateUnit, 'graph_policy');
  assert.equal(contract.verifierUnit, 'memory_eval');
});

test('trajectory operators mutate candidate steps deterministically', () => {
  const result = applyTrajectoryOperator({
    operator: 'deletion',
    trajectory: ['read', 'irrelevant', 'patch'],
    targetIndex: 1,
  });

  assert.deepEqual(result.trajectory, ['read', 'patch']);
  assert.equal(result.operator, 'deletion');
});

test('dense subgoal verifier scores partial completion', () => {
  const result = verifyDenseSubgoals({
    subgoals: [{ id: 'tests', requiredEvidence: 'npm test' }],
    evidence: ['npm test'],
  });

  assert.equal(result.score, 1);
});

test('global lineage tracker records parent candidates', () => {
  const lineage = recordLineage({
    candidateId: 'global_1',
    parents: ['local_a', 'local_b'],
    operator: 'crossover',
  });

  assert.deepEqual(lineage.parents, ['local_a', 'local_b']);
});
```

- [ ] **Step 2: Implement modules**

Implement:

- lane contracts for `code`, `verifier`, `memory`, `research`, `skill`, `swarm`;
- operators `expansion`, `deletion`, `translocation`, `crossover`, `recombination`;
- dense verifier with evidence string matching;
- lineage record normalization with deterministic sorting.

- [ ] **Step 3: Run BES tests**

Run:

```powershell
node --test tests/harness-bes-lane-contracts.test.js tests/harness-bidirectional-bes.test.js tests/harness-shinka-evolution.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src\harness-sidecar\rho src\harness-sidecar\bes tests\harness-rho-replay-batch.test.js tests\harness-bes-lane-contracts.test.js tests\harness-rho-preference.test.js tests\harness-bidirectional-bes.test.js
git commit -m "feat: add rho replay and bes lane contracts"
```

---

## Chunk 5: Global Harness Experiments And Trust Kernel Boundaries

**Subagent:** `global-experiment-trust-worker`

**Goal:** Store full Meta-Harness-style experiment runs, compare candidates on a Pareto frontier, and prove no local/global optimizer can bypass trust-kernel boundaries.

**Files:**
- Create: `src/harness-sidecar/meta/harnessRunStore.js`
- Create: `src/harness-sidecar/meta/harnessExperimentRunner.js`
- Create: `src/harness-sidecar/meta/harnessFrontier.js`
- Create: `src/harness-sidecar/core/trustKernelBoundary.js`
- Create: `tests/harness-meta-experiment-runs.test.js`
- Create: `tests/harness-trust-kernel-boundary.test.js`
- Modify: `tests/harness-meta-candidate-archive.test.js`
- Modify: `tests/harness-meta-promotion-loop.test.js`
- Modify: `tests/harness-auto-approval-policy.test.js`

### Task 1: Add harness run store

- [ ] **Step 1: Write failing test**

Create `tests/harness-meta-experiment-runs.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { createHarnessRun } from '../src/harness-sidecar/meta/harnessRunStore.js';

test('harness run store writes full experiment directory', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-harness-run-'));
  const run = await createHarnessRun({
    workspaceRoot,
    runId: 'run_1',
    candidate: { candidateId: 'cand_1' },
    localAgentSummary: { cellId: 'code' },
    memoryProposals: [{ factId: 'fact_1' }],
  });

  const candidate = JSON.parse(await readFile(path.join(run.runDir, 'candidate.json'), 'utf8'));
  assert.equal(candidate.candidateId, 'cand_1');
});
```

- [ ] **Step 2: Implement store**

Create `harnessRunStore.js`.

Write these files:

- `candidate.json`
- `local-agent-summary.json`
- `memory-proposals.json`
- `source.patch`
- `config.patch`
- `evals.json`
- `promotion.json`
- `rollback.json`

Use safe IDs and workspace-contained paths.

- [ ] **Step 3: Run test**

Run: `node --test tests/harness-meta-experiment-runs.test.js`

Expected: PASS.

### Task 2: Add experiment runner and frontier

- [ ] **Step 1: Extend failing test**

Add:

```js
import { runHarnessExperiment } from '../src/harness-sidecar/meta/harnessExperimentRunner.js';
import { updateHarnessFrontier } from '../src/harness-sidecar/meta/harnessFrontier.js';

test('experiment runner records baseline candidate and preference evidence', async () => {
  const result = await runHarnessExperiment({
    candidate: { candidateId: 'cand_1' },
    baselineRunner: async () => ({ quality: 0.5, safety: 0.9, cost: 0.2, latency: 0.2 }),
    candidateRunner: async () => ({ quality: 0.7, safety: 0.9, cost: 0.2, latency: 0.2 }),
  });

  assert.equal(result.preference.preferred, 'candidate');
});

test('frontier keeps non-dominated candidate', () => {
  const frontier = updateHarnessFrontier({
    current: [],
    candidate: { candidateId: 'cand_1', metrics: { quality: 0.8, safety: 0.9, cost: 0.2, latency: 0.2 } },
  });

  assert.equal(frontier.length, 1);
});
```

- [ ] **Step 2: Implement runner and frontier**

Requirements:

- runner compares baseline/candidate metrics;
- runner records pairwise self-preference as evidence, not authority;
- frontier uses quality/safety higher-is-better and cost/latency lower-is-better;
- dominated candidates are rejected with reasons.

- [ ] **Step 3: Run tests**

Run: `node --test tests/harness-meta-experiment-runs.test.js`

Expected: PASS.

### Task 3: Add trust-kernel boundary tests

- [ ] **Step 1: Write failing tests**

Create `tests/harness-trust-kernel-boundary.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTrustKernelBoundary } from '../src/harness-sidecar/core/trustKernelBoundary.js';

test('trust kernel rejects verifier floor weakening', () => {
  const result = evaluateTrustKernelBoundary({
    proposal: {
      kind: 'verifier_policy',
      changes: { minVerifierPasses: 0 },
    },
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reasons.includes('verifier_floor_weakened'), true);
});

test('trust kernel rejects global path mutation by optimizer', () => {
  const result = evaluateTrustKernelBoundary({
    proposal: {
      kind: 'source_patch',
      requestedBy: 'local_meta_harness',
      paths: ['C:/Users/jackj/.codex/skills/global/SKILL.md'],
    },
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reasons.includes('path_outside_workspace'), true);
});

test('trust kernel requires approval for source patches', () => {
  const result = evaluateTrustKernelBoundary({
    proposal: {
      kind: 'source_patch',
      requestedBy: 'global_meta_harness',
      paths: ['C:/Users/jackj/Github/helios-forge/src/harness-sidecar/server.js'],
    },
    workspaceRoot: 'C:/Users/jackj/Github/helios-forge',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.requiresApproval, true);
});
```

- [ ] **Step 2: Implement trust boundary**

Create `src/harness-sidecar/core/trustKernelBoundary.js`.

Rules:

- reject path outside workspace;
- reject verifier minimum weakening;
- reject audit disable;
- reject secret redaction disable;
- reject auto-merge by default;
- require approval for source patches, verifier config apply, memory deletion, capability install, and trust-kernel mutation.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
node --test tests/harness-trust-kernel-boundary.test.js tests/harness-auto-approval-policy.test.js tests/harness-meta-promotion-loop.test.js
npm run release:smoke
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src\harness-sidecar\meta src\harness-sidecar\core tests\harness-meta-experiment-runs.test.js tests\harness-trust-kernel-boundary.test.js tests\harness-meta-candidate-archive.test.js tests\harness-meta-promotion-loop.test.js tests\harness-auto-approval-policy.test.js
git commit -m "feat: add global harness experiments and trust gates"
```

---

## Chunk 6: Integration Wiring And Operator Visibility

**Subagent:** `integration-ui-worker`

**Goal:** Wire the new local/global loop into existing swarm orchestration, server events, trace output, and UI status without enabling risky auto-apply.

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Create: `tests/harness-hierarchical-swarm-integration.test.js`
- Modify: `tests/harness-ui-discoverability.test.js`
- Modify: `tests/harness-sidecar.test.js`

### Task 1: Wire SwarmCell runtime behind feature flags

- [ ] **Step 1: Write failing integration test**

Create `tests/harness-hierarchical-swarm-integration.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateSwarm } from '../src/harness-sidecar/swarm/swarmOrchestrator.js';

test('swarm orchestration emits local meta and memory evidence when enabled', async () => {
  const events = [];
  const result = await orchestrateSwarm({
    task: { taskId: 'task_hierarchical', task: 'test hierarchical loop' },
    context: { assignedFiles: ['src/harness-sidecar/swarm/swarmOrchestrator.js'] },
    featureFlags: { localMetaHarness: true, localMemoryGraph: true },
    commandAdapter: async () => ({
      summary: 'done',
      verifierEvidence: ['node --test'],
      evolutionOutput: { hardCaseTags: ['missing_context'] },
    }),
    emitEvent: (event) => events.push(event),
  });

  assert.equal(result.attempts.length > 0, true);
  assert.equal(events.some((event) => event.type === 'local_meta.completed'), true);
  assert.equal(events.some((event) => event.type === 'local_memory.proposed'), true);
});
```

- [ ] **Step 2: Implement wiring**

In `swarmOrchestrator.js`:

- after each attempt, run local meta harness when feature flag is enabled;
- emit `local_meta.completed`;
- collect memory proposals from `evolutionOutput.memoryProposals`;
- emit `local_memory.proposed`;
- do not auto-apply proposals.

- [ ] **Step 3: Run integration test**

Run: `node --test tests/harness-hierarchical-swarm-integration.test.js`

Expected: PASS.

### Task 2: Add server and UI visibility

- [ ] **Step 1: Extend UI tests**

Update `tests/harness-ui-discoverability.test.js` to assert:

- UI contains `id="harness-local-meta"`;
- UI contains `id="harness-memory-hierarchy"`;
- app recognizes `local_meta.completed`;
- app recognizes `local_memory.proposed`;
- app recognizes `harness_experiment.completed`.

- [ ] **Step 2: Modify UI**

In `public/index.html` add compact panels under existing harness tabs:

- Local Meta
- Memory Hierarchy
- Harness Experiments

In `public/app.js`:

- add event renderers for new event types;
- keep display concise;
- do not add instructional marketing text.

- [ ] **Step 3: Run tests**

Run:

```powershell
node --test tests/harness-hierarchical-swarm-integration.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
npm run release:smoke
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src\harness-sidecar\swarm src\harness-sidecar\server.js public tests\harness-hierarchical-swarm-integration.test.js tests\harness-ui-discoverability.test.js tests\harness-sidecar.test.js
git commit -m "feat: wire hierarchical swarm loop visibility"
```

---

## Final Verification

Run all focused suites:

```powershell
node --test tests/harness-swarmcell-contracts.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-rho-replay-batch.test.js tests/harness-bes-lane-contracts.test.js tests/harness-meta-experiment-runs.test.js tests/harness-trust-kernel-boundary.test.js tests/harness-hierarchical-swarm-integration.test.js
```

Expected: PASS.

Run broad harness regression:

```powershell
node --test tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js tests/harness-memgraphrag-construction.test.js tests/harness-memory-aware-graph-retriever.test.js tests/harness-rho-coreset.test.js tests/harness-rho-preference.test.js tests/harness-bidirectional-bes.test.js tests/harness-shinka-evolution.test.js tests/harness-meta-promotion-loop.test.js tests/harness-auto-approval-policy.test.js tests/harness-ui-discoverability.test.js
```

Expected: PASS.

Run release smoke:

```powershell
npm run release:smoke
```

Expected: PASS.

Check working tree:

```powershell
git status --short
```

Expected: only intentional files remain, or clean after final commit.

## Non-Goals

- Do not add autonomous self-merge.
- Do not let local meta-harnesses approve durable apply.
- Do not mutate global Codex, Claude, Pi, or home skill folders.
- Do not make A2A network transport a prerequisite for local SwarmCell runtime.
- Do not replace existing deterministic tests with model-only judgments.

## Definition Of Done

- Every SwarmCell attempt has normalized `taskOutput`, `evolutionOutput`, and evidence.
- Each SwarmCell can run a local meta-harness loop with local BES mutation and local candidate archive.
- Local memory graphs can merge into SwarmCell graphs and propose global memory updates.
- Global MemGraphRAG persists layers, constructs graphs, and serves hierarchical retrieval context.
- RHO can run grouped baseline/candidate replay with self-validation, self-consistency, and self-preference.
- BES lane contracts exist for code, verifier, memory, research, skill, and swarm lanes.
- Global harness experiment runs store candidate source/config patches, traces, evals, memory proposals, promotion evidence, and rollback metadata.
- Trust-kernel tests prove local/global optimizers cannot self-authorize unsafe durable changes.
- UI/operator surface can see local meta, local/global memory, and global experiment events.
- Focused tests and `npm run release:smoke` pass.
