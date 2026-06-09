# BES Lane Expansion For Harness Layers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand BES optimization into a nested swarm-of-swarms and harness-of-harnesses architecture where every agent, SwarmCell, swarm, local harness, and global harness can evolve through shared optimization effects while remaining linked by A2A envelopes and Memory Graph RAG layers.

**Architecture:** Treat Helios Forge as a recursive evolving harness mesh. Agents form SwarmCells; SwarmCells form swarms; swarms run local harnesses; local harnesses report into global harnesses; harnesses can themselves be candidates optimized by higher-level harnesses. A2A-style envelopes carry task, evidence, lineage, and candidate messages between these layers, while local, SwarmCell, and global Memory Graph RAG layers preserve context and hard-case memory. A shared BES lane runtime becomes the optimization substrate inside each layer, wrapping RHO, bidirectional BES, population evolution, adaptive search, ToolTree planning, trajectory operators, dense subgoals, champion archives, Pareto/frontier scoring, and verifier-genome evolution into promotion-safe evidence envelopes. Promotion authority remains centralized: local and lane-level BES can propose, score, replay, and archive candidates, but only global experiments plus trust gates can promote or apply them.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Helios Forge sidecar modules under `src/harness-sidecar/{bes,meta,memory,rho,skills,swarm,research,tools,budget,vlm,core,interop,rag}`, workspace-local `.harness` artifacts, PowerShell on Windows.

---

## Source Documents

Read these first:

- `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`
- `docs/architecture/feature-architecture-map.md`
- `docs/architecture/paper-implementation-alignment.md`
- `docs/architecture/rho-bes-evolution-expansion-roadmap.md`
- `docs/superpowers/plans/2026-06-09-hierarchical-swarm-meta-harness-implementation.md`
- `docs/superpowers/plans/2026-06-08-evolution-aware-swarm-and-rho-bes-expansion-subagent-plans.md`
- `src/harness-sidecar/bes/laneContracts.js`
- `src/harness-sidecar/bes/bidirectionalSearchLoop.js`
- `src/harness-sidecar/bes/evolutionPopulationRunner.js`
- `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- `src/harness-sidecar/bes/globalLineageTracker.js`
- `src/harness-sidecar/rho/replayBatchRunner.js`
- `src/harness-sidecar/meta/harnessExperimentRunner.js`
- `src/harness-sidecar/core/trustKernelBoundary.js`
- `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- `src/harness-sidecar/interop/agentRouter.js`
- `src/harness-sidecar/interop/externalAgentGateway.js`
- `src/harness-sidecar/memory/localMemoryGraph.js`
- `src/harness-sidecar/memory/swarmCellMemoryGraph.js`
- `src/harness-sidecar/memory/memoryGraphRuntime.js`
- `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`

## Coordination Rules For Subagents

- Use one fresh subagent per chunk. Suggested assignments:
  - Maxwell: Chunk 1, BES lane runtime adapter.
  - Lovelace: Chunk 2, policy-evolver lane integration.
  - Hypatia: Chunk 3, memory/research/skill/swarm lane integration.
  - Sagan: Chunk 4, orchestration, visibility, docs, and cross-layer regression.
- Each subagent must read only the source documents and files listed in its chunk before editing.
- Every behavior starts with a failing `node:test` test.
- Prefer new small modules over inflating `src/harness-sidecar/server.js` or existing domain evolvers.
- Preserve the existing shadow-only behavior of domain policy candidates.
- BES lane output may request evaluation or promotion, but it must not mark itself applied, approved, or trusted.
- A2A envelopes are transport and provenance records only. They must not grant authority, bypass trust gates, or turn external agent claims into accepted facts.
- Memory Graph RAG layers are context and evidence routing layers only. Global memory promotion still requires provenance, conflict checks, and approval policy.
- Do not add package dependencies or network calls.
- Do not stage unrelated dirty files. At plan creation time, `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md` may already be dirty from prior work; leave it alone unless the operator explicitly scopes it in.
- Commit after each chunk with the commit messages listed below.

Recommended commit messages:

- `feat: add bes lane runtime adapter`
- `feat: route policy evolvers through bes lanes`
- `feat: expand bes lanes to memory research skill and swarm`
- `feat: surface bes lane evolution evidence`
- `fix: harden bes lane promotion boundaries`

## System Vision: Nested Evolving Swarm Mesh

The target shape is an evolving swarm of swarms with evolving harnesses attached at multiple levels:

1. **Agent level:** a single worker can record hard cases, local evidence, candidate improvements, and lineage.
2. **SwarmCell level:** a role-bound group of agents maintains local memory, local BES/RHO evidence, and local evolution proposals.
3. **Swarm level:** a coordinated set of SwarmCells optimizes role assignment, handoff contracts, retry strategy, budget, and verification coverage.
4. **Local harness level:** a local meta-harness evaluates SwarmCell and swarm candidates against local hard cases, then emits evidence-only candidates.
5. **Global harness level:** the global meta-harness compares candidates across swarms, runs RHO replay and harness experiments, updates frontiers, and prepares promotion evidence.
6. **Harness-of-harnesses level:** harness configurations, verifier genomes, memory policies, research policies, skill policies, tool policies, and coordination policies are themselves candidates that can be optimized by the same BES lane runtime.

The layers communicate through A2A-style envelopes and Memory Graph RAG:

- A2A envelopes carry task intent, candidate summaries, evidence references, lineage, trust metadata, and required verification contracts.
- Local memory graphs capture short-lived agent and SwarmCell context.
- SwarmCell memory graphs merge local evidence into role-specific hard-case memory.
- Global Memory Graph RAG promotes stable, provenance-backed facts and retrieves cross-swarm lessons for future tasks.
- RHO coresets are built from hard cases found at any layer.
- BES lane runtime consumes the hard cases, memory graph context, A2A lineage, and domain evaluator outputs to produce evidence-only candidates.

## Optimization Effects Covered

This plan must treat these as first-class optimization effects, not background implementation details:

- **RHO coreset and replay:** hard-case mining, grouped replay, self-validation, self-consistency, and self-preference.
- **Bidirectional BES:** forward candidate generation plus backward goal/subgoal pressure.
- **Population evolution:** mutation, recombination, diversity tracking, island/frontier behavior, and champion archive metadata.
- **AB-MCTS/adaptive search:** scheduler actions, search-policy outcomes, and budget-aware exploration/exploitation decisions.
- **ToolTree planning:** tool/path planning candidates where task execution or recovery depends on tool sequences.
- **Shinka-style trajectory operators:** expansion, deletion, translocation, crossover, and recombination provenance.
- **Dense subgoal verification:** per-lane subgoals used as structured evidence, not only aggregate scores.
- **Verifier-genome evolution:** rubric, threshold, selector, timeout, VLM, and evidence-case mutations.
- **Pareto/frontier scoring:** global comparison across quality, safety, reliability, cost, latency, maintainability, and trust risk.
- **Memory Graph RAG effects:** graph construction, conflict adjudication, bridge/retrieval tuning, promotion policy, and hierarchical retrieval context.
- **A2A interop effects:** external/internal agent routing, delegated evidence, lineage preservation, and trust metadata propagation.

## Comparison With Current Architecture And Paper-Derived Plans

This plan is a continuation of `docs/superpowers/plans/2026-06-09-hierarchical-swarm-meta-harness-implementation.md`, not a replacement. The completed hierarchical plan established the first deterministic local/global loop:

- SwarmCell contracts and local evolution outputs exist.
- Local meta-harnesses can create archived candidates without durable apply authority.
- Local memory graphs, SwarmCell graph merge, global memory promotion, memory graph runtime persistence, and hierarchical retrieval exist.
- RHO replay batches produce self-validation, self-consistency, and self-preference evidence.
- BES lane contracts, trajectory operators, dense subgoal verification, and lineage tracking exist.
- Global harness experiment storage, frontier comparison, and trust-kernel boundaries exist.
- UI/runtime visibility exists for local meta, memory hierarchy, and harness experiments.

The BES lane expansion plan adds the missing shared connective layer:

- one common BES lane runtime instead of separate one-off wrappers per subsystem;
- explicit lane envelopes for policy evolvers, memory, research, skill, swarm, verifier, context, compaction, tool, budget, visual, and MCP trust;
- optimization-effect metadata for RHO, AB-MCTS/adaptive search, ToolTree, Shinka trajectory operators, champion archives, Pareto/frontier scoring, and verifier-genome evolution;
- A2A envelope metadata so nested agents, SwarmCells, swarms, local harnesses, and global harnesses can exchange lineage and evidence references;
- Memory Graph RAG context packets that feed lane optimization without promoting memory by side effect;
- explicit harness-of-harnesses representation, where harness policies and configurations are themselves candidates optimized by higher-level harness loops.

Alignment with the paper-derived architecture:

| Paper-derived thread | Current architecture status | What this plan adds |
| --- | --- | --- |
| MemGraphRAG | Local, SwarmCell, and global memory graph scaffolding exists, with deterministic runtime persistence and hierarchical retrieval. | Makes memory graph context an explicit lane-runtime input, preserves provenance/conflict flags in candidate envelopes, and prevents retrieved memory from counting as promotion evidence unless adjudicated. |
| Meta-Harness | Global experiment run store, baseline/candidate comparison, frontier update, and trust-kernel checks exist. | Generalizes harness optimization so harness policies/configs become candidates and can be compared as part of a harness-of-harnesses loop. |
| RHO | Replay batches, self-validation, self-consistency, and self-preference exist for selected hard cases. | Treats RHO hard cases as cross-layer inputs from agents, SwarmCells, swarms, memory, research, skills, tools, and external A2A routes. |
| BES | Lane contracts, trajectory operators, dense subgoals, lineage, mutation, recombination, and evolution runner modules exist. | Adds a shared lane runtime that wraps all BES effects into consistent evidence envelopes across every harness layer. |
| AB-MCTS/adaptive search | Adaptive search scheduling exists as a BES-adjacent optimization primitive. | Requires lane envelopes to preserve adaptive action summaries and budget/exploration outcomes so higher-level harnesses can compare them. |
| ToolTree/tool planning | ToolTree and tool-loop evolution are adjacent modules/plans. | Makes tool-path planning and tool-loop repair a first-class lane effect instead of only a local planner detail. |
| Shinka/evolution operators | Trajectory operators exist and are tested as local BES primitives. | Requires operator provenance to survive lane wrapping, A2A transfer, and global comparison. |
| Trust kernel | Local/global durable apply is blocked unless trust checks and approval gates pass. | Extends the same non-self-authorizing rule to A2A claims, Memory Graph RAG context, lane candidates, and harness-of-harness candidates. |

Important gap statement:

```text
Current architecture has the pieces.
This plan standardizes how those pieces compose across layers.
It does not make the system fully autonomous, paper-grade, or self-authorizing.
```

Remaining gaps after the current implementation, which this plan should close:

- No shared `runBesLaneRuntime` adapter exists yet.
- Policy evolvers do not yet emit a consistent BES lane evidence envelope.
- Memory, research, skill, and swarm candidates are not yet uniformly wrapped as lane candidates.
- A2A envelopes do not yet preserve BES/RHO/memory graph lineage as a tested nested-harness contract.
- Hierarchical Memory Graph RAG retrieval is not yet a standardized lane-runtime context packet.
- Harness-of-harnesses candidates are an architecture goal, not yet a concrete candidate schema.
- Optimization metadata from adaptive search, ToolTree, trajectory operators, champion archives, verifier genomes, and frontier scoring is not yet consistently attached to candidates.

## Safety Invariants

Every chunk must preserve these invariants:

- Local SwarmCell BES outputs are proposals only.
- Lane BES outputs are candidates only.
- Memory, research, skill, swarm, tool, context, budget, visual, and MCP trust lanes remain `shadow_only` unless a separate promotion path approves them.
- A2A-provided claims are untrusted until independently validated or backed by accepted memory/provenance.
- Memory Graph RAG can retrieve and route evidence, but cannot promote memories without provenance and conflict adjudication.
- Source patch candidates must include file path metadata before trust-kernel evaluation.
- Candidate evidence must include at least one of: dense subgoal result, RHO replay result, domain evaluator result, or harness experiment comparison.
- Failed RHO validation, missing provenance, or trust-kernel boundary violations block promotion evidence.
- The adapter must never weaken approval gates, sandbox policy, MCP trust policy, verifier thresholds, secret handling, or rollback requirements.

## File Map

### New Files

- `src/harness-sidecar/bes/laneRuntime.js`
  - Shared BES lane adapter. Normalizes lane inputs, reads optional A2A lineage and Memory Graph RAG context, runs BES/evolution effects, scores dense subgoals, records lineage, attaches optional RHO replay evidence, and returns promotion-safe candidate envelopes.
- `src/harness-sidecar/bes/laneEvidence.js`
  - Small helpers for evidence normalization, required evidence checks, and blocked/passing evidence summaries.
- `tests/harness-bes-lane-runtime.test.js`
  - Unit coverage for lane runtime adapter behavior and authority boundaries.
- `tests/harness-bes-policy-lanes.test.js`
  - Cross-policy tests proving existing shadow evolvers can run through BES lane envelopes.
- `tests/harness-bes-domain-lanes.test.js`
  - Memory/research/skill/swarm lane tests.
- `tests/harness-bes-lane-visibility.test.js`
  - Server/UI/status payload tests for lane visibility.
- `tests/harness-bes-nested-swarm-mesh.test.js`
  - Cross-layer tests proving A2A envelopes, Memory Graph RAG context, RHO replay, and BES lane evidence can flow through agent, SwarmCell, swarm, local harness, and global harness layers without granting apply authority.

### Existing Files To Modify

- `src/harness-sidecar/bes/laneContracts.js`
  - Add contracts for policy sublanes if needed: `context`, `compaction`, `tool`, `budget`, `visual`, and `mcp_trust`.
- `src/harness-sidecar/meta/besMetaOptimizer.js`
  - Delegate lane-specific evidence envelope creation to `laneRuntime.js` where appropriate.
- `src/harness-sidecar/meta/contextPolicyEvolution.js`
- `src/harness-sidecar/meta/compactionPolicyEvolution.js`
- `src/harness-sidecar/meta/toolLoopPolicyEvolution.js`
- `src/harness-sidecar/meta/budgetPolicyEvolution.js`
- `src/harness-sidecar/meta/visualPolicyEvolution.js`
- `src/harness-sidecar/meta/memoryPolicyEvolution.js`
- `src/harness-sidecar/meta/mcpTrustEvolution.js`
- `src/harness-sidecar/meta/researchPolicyEvolution.js`
  - Export stable lane adapter functions while preserving existing `propose*` and `evaluate*` APIs.
- `src/harness-sidecar/skills/skillEvolution.js`
- `src/harness-sidecar/skills/skillEvolutionScheduler.js`
  - Wrap skill candidates in BES lane evidence without allowing direct global writes.
- `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
- `src/harness-sidecar/swarm/swarmCellRuntime.js`
- `src/harness-sidecar/meta/localEvolutionLoop.js`
- `src/harness-sidecar/meta/localMetaHarness.js`
  - Feed SwarmCell and swarm-planner outputs through the shared BES lane runtime.
- `src/harness-sidecar/memory/memoryGraphRuntime.js`
- `src/harness-sidecar/research/deepResearchManager.js`
  - Add optional BES lane evaluation hooks for memory and research candidates.
- `src/harness-sidecar/server.js`
  - Surface lane runtime output in status/events without taking promotion authority.
- `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
  - Preserve BES lane, RHO, memory graph, and trust metadata in A2A envelopes.
- `src/harness-sidecar/interop/agentRouter.js`
- `src/harness-sidecar/interop/externalAgentGateway.js`
  - Route nested harness/swarm messages without converting external claims into accepted evidence.
- `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
  - Provide lane runtime context from local, SwarmCell, and global memory graph layers.
- `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`
- `docs/architecture/feature-architecture-map.md`
- `docs/architecture/paper-implementation-alignment.md`
  - Document the expanded BES lane model and authority boundaries.

---

## Chunk 1: Shared BES Lane Runtime Adapter

**Subagent:** Maxwell

**Goal:** Create a common runtime that every harness layer can use to run BES optimization and evidence scoring without gaining promotion authority.

**Files:**

- Create: `src/harness-sidecar/bes/laneRuntime.js`
- Create: `src/harness-sidecar/bes/laneEvidence.js`
- Create: `tests/harness-bes-lane-runtime.test.js`
- Modify: `src/harness-sidecar/bes/laneContracts.js`

### Task 1: Add Lane Runtime Red Tests

- [ ] **Step 1: Write failing tests**

Create `tests/harness-bes-lane-runtime.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';
import { normalizeLaneEvidence } from '../src/harness-sidecar/bes/laneEvidence.js';

test('wraps a shadow candidate in a BES lane envelope', () => {
  const result = runBesLaneRuntime({
    lane: 'memory',
    taskId: 'task-memory-1',
    candidates: [
      {
        candidateId: 'memory_policy_1',
        status: 'shadow_only',
        rationale: ['pending_activation_stall'],
      },
    ],
    hardCases: [
      { caseId: 'case-1', reasons: ['memgraph_pending_activation_stall'] },
    ],
    evaluator: ({ candidate }) => ({
      score: 0.7,
      reasons: ['schema_threshold_addresses_activation_stall'],
      safetyStatus: candidate.status,
    }),
  });

  assert.equal(result.lane, 'memory');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].bes.goalTree);
  assert.ok(result.candidates[0].lineage.candidateId);
});

test('blocks candidates that claim durable approval', () => {
  const result = runBesLaneRuntime({
    lane: 'skill',
    taskId: 'task-skill-1',
    candidates: [
      {
        candidateId: 'skill_bad',
        status: 'approved',
        applied: true,
      },
    ],
    hardCases: [{ caseId: 'case-1', reasons: ['skill_gap'] }],
    evaluator: () => ({ score: 1, reasons: ['looks_good'] }),
  });

  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.equal(result.candidates[0].promotion.blockedReasons.includes('lane_candidate_cannot_self_apply'), true);
});

test('normalizes evidence sources for dense subgoals and RHO replay', () => {
  const evidence = normalizeLaneEvidence({
    denseSubgoals: [{ goalId: 'cover_rho_coreset', passed: true }],
    rhoReplay: { validation: { passed: true }, preference: { winner: 'candidate' } },
    domainEvaluation: { score: 0.8, reasons: ['domain_passed'] },
  });

  assert.equal(evidence.hasPassingEvidence, true);
  assert.equal(evidence.blockedReasons.length, 0);
  assert.deepEqual(evidence.sources.sort(), ['dense_subgoal', 'domain_eval', 'rho_replay']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/harness-bes-lane-runtime.test.js
```

Expected: FAIL because `laneRuntime.js` and `laneEvidence.js` do not exist.

### Task 2: Implement Evidence Helpers

- [ ] **Step 1: Create `laneEvidence.js`**

Required exports:

```js
export function normalizeLaneEvidence({
  denseSubgoals = [],
  rhoReplay = null,
  domainEvaluation = null,
  harnessExperiment = null,
  adaptiveSearch = null,
  toolTree = null,
  trajectoryOperators = [],
  championArchive = null,
  frontier = null,
  verifierGenome = null,
  memoryGraph = null,
  a2a = null,
} = {}) {
  // returns { sources, hasPassingEvidence, blockedReasons, denseSubgoals, rhoReplay, domainEvaluation, harnessExperiment, adaptiveSearch, toolTree, trajectoryOperators, championArchive, frontier, verifierGenome, memoryGraph, a2a }
}

export function blocksFromCandidateAuthority(candidate = {}) {
  // returns blocked reason strings for self-apply/self-approval/trust weakening
}

export function createPromotionSummary({ evidence, candidate, lane } = {}) {
  // returns { allowed: false, lane, evidenceSources, blockedReasons, reason }
}
```

Rules:

- `hasPassingEvidence` is true when at least one evidence source passes.
- A failed `rhoReplay.validation.passed === false` must add `rho_validation_failed`.
- A2A evidence is a reference source only; it must not count as passing evidence unless backed by domain, RHO, harness experiment, dense subgoal, or accepted memory graph evidence.
- Memory graph evidence counts only when it includes provenance or a promotion record.
- `candidate.applied === true`, `candidate.durableApplyApproved === true`, `candidate.promotion?.allowed === true`, or `candidate.status` of `approved`/`applied` must add `lane_candidate_cannot_self_apply`.
- MCP trust candidates that lower trust, widen permissions, or disable poisoning checks must add `trust_boundary_violation` unless the domain evaluator explicitly blocks them first.
- Promotion summary must always return `allowed: false`; this adapter is evidence-only.

- [ ] **Step 2: Run focused test**

Run:

```powershell
node --test tests/harness-bes-lane-runtime.test.js
```

Expected: still FAIL because runtime is not implemented.

### Task 3: Implement Lane Runtime

- [ ] **Step 1: Create `laneRuntime.js`**

Required interface:

```js
export function runBesLaneRuntime({
  lane,
  taskId,
  target = lane,
  candidates = [],
  hardCases = [],
  baselinePolicy = {},
  parentCandidates = [],
  a2aEnvelope = null,
  memoryGraphContext = null,
  optimizationEffects = {},
  evaluator,
  replayRunner,
  maxCandidates = 4,
  now = () => new Date(),
} = {}) {
  // returns { lane, taskId, contract, subgoals, candidates, frontier, evidenceSummary }
}
```

Implementation requirements:

- Call `getBesLaneContract(lane)` to validate the lane.
- Build subgoals from hard-case reasons and target.
- Accept optional A2A lineage, delegated evidence references, and memory graph context without treating them as trusted facts by default.
- Accept optional optimization effect summaries:
  - `adaptiveSearch`
  - `toolTree`
  - `trajectoryOperators`
  - `championArchive`
  - `frontier`
  - `verifierGenome`
- For each candidate:
  - preserve `candidateId`, `status`, `target`, and existing domain fields;
  - evaluate with the provided `evaluator` if present;
  - run optional `replayRunner` if present;
  - call `verifyDenseSubgoals` or `scoreSubgoals` with evidence derived from domain/RHO results;
  - record lineage with `recordLineage`;
  - attach `bes`, `evidence`, `lineage`, `a2a`, `memoryGraph`, `optimizationEffects`, and `promotion` fields.
- Run `runBidirectionalBes` and `runEvolutionPopulationSync` only as lightweight optimization summaries; do not require these to generate domain candidates.
- Preserve Shinka/trajectory operator provenance when candidate ancestry includes expansion, deletion, translocation, crossover, or recombination.
- Preserve champion archive, adaptive search, ToolTree, verifier genome, and Pareto/frontier metadata when provided by callers.
- Return no more than `maxCandidates` candidate envelopes.
- Empty candidate lists should return a valid lane result with `candidates: []`, not throw.

- [ ] **Step 2: Extend lane contracts for policy sublanes**

Modify `src/harness-sidecar/bes/laneContracts.js` to include these lanes:

```js
context: {
  lane: 'context',
  candidateUnit: 'context_policy',
  verifierUnit: 'context_eval',
  artifacts: ['retrieval_trace', 'context_budget', 'coverage_report'],
}
compaction: {
  lane: 'compaction',
  candidateUnit: 'compaction_policy',
  verifierUnit: 'compaction_eval',
  artifacts: ['schema_delta', 'replay_trace', 'state_merge_report'],
}
tool: {
  lane: 'tool',
  candidateUnit: 'tool_loop_policy',
  verifierUnit: 'tool_loop_eval',
  artifacts: ['tool_trace', 'recovery_plan', 'loop_detection_report'],
}
budget: {
  lane: 'budget',
  candidateUnit: 'budget_policy',
  verifierUnit: 'budget_eval',
  artifacts: ['cost_trace', 'allocation_delta', 'quality_cost_report'],
}
visual: {
  lane: 'visual',
  candidateUnit: 'visual_policy',
  verifierUnit: 'visual_eval',
  artifacts: ['screenshot_trace', 'rubric_delta', 'crop_policy'],
}
mcp_trust: {
  lane: 'mcp_trust',
  candidateUnit: 'mcp_trust_policy',
  verifierUnit: 'trust_eval',
  artifacts: ['capability_delta', 'poisoning_eval', 'permission_report'],
}
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
node --test tests/harness-bes-lane-runtime.test.js tests/harness-bes-lane-contracts.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/bes/laneRuntime.js src/harness-sidecar/bes/laneEvidence.js src/harness-sidecar/bes/laneContracts.js tests/harness-bes-lane-runtime.test.js tests/harness-bes-lane-contracts.test.js
git commit -m "feat: add bes lane runtime adapter"
```

---

## Chunk 2: Policy Evolver BES Lanes

**Subagent:** Lovelace

**Goal:** Route existing shadow-only policy evolvers through the shared BES lane runtime without changing their public proposal/evaluation APIs.

**Files:**

- Create: `tests/harness-bes-policy-lanes.test.js`
- Modify: `src/harness-sidecar/meta/contextPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/compactionPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/toolLoopPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/budgetPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/visualPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/mcpTrustEvolution.js`

### Task 1: Add Policy Lane Red Tests

- [ ] **Step 1: Write failing tests**

Create `tests/harness-bes-policy-lanes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runContextPolicyBesLane } from '../src/harness-sidecar/meta/contextPolicyEvolution.js';
import { runCompactionPolicyBesLane } from '../src/harness-sidecar/meta/compactionPolicyEvolution.js';
import { runToolLoopPolicyBesLane } from '../src/harness-sidecar/meta/toolLoopPolicyEvolution.js';
import { runBudgetPolicyBesLane } from '../src/harness-sidecar/meta/budgetPolicyEvolution.js';
import { runVisualPolicyBesLane } from '../src/harness-sidecar/meta/visualPolicyEvolution.js';
import { runMcpTrustPolicyBesLane } from '../src/harness-sidecar/meta/mcpTrustEvolution.js';

const coreset = {
  items: [
    { id: 'case-1', caseId: 'case-1', reason: 'missing_context', reasons: ['missing_context'] },
    { id: 'case-2', caseId: 'case-2', reason: 'tool_loop', reasons: ['tool_loop'] },
    { id: 'case-3', caseId: 'case-3', reason: 'visual_regression', reasons: ['visual_regression'], tags: ['visual'] },
  ],
};

test('context policy candidates run through a BES lane envelope', () => {
  const result = runContextPolicyBesLane({ coreset, taskId: 'task-context' });
  assert.equal(result.lane, 'context');
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0].status, 'shadow_only');
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.ok(result.candidates[0].evidence.sources.includes('domain_eval'));
});

test('compaction, tool, budget, visual, and mcp trust lanes are promotion-safe', () => {
  const results = [
    runCompactionPolicyBesLane({ coreset, taskId: 'task-compaction' }),
    runToolLoopPolicyBesLane({ coreset, taskId: 'task-tool' }),
    runBudgetPolicyBesLane({ coreset, taskId: 'task-budget' }),
    runVisualPolicyBesLane({ coreset, taskId: 'task-visual' }),
    runMcpTrustPolicyBesLane({ coreset, taskId: 'task-mcp' }),
  ];

  for (const result of results) {
    assert.ok(result.candidates.length > 0);
    for (const candidate of result.candidates) {
      assert.equal(candidate.promotion.allowed, false);
      assert.notEqual(candidate.status, 'approved');
      assert.notEqual(candidate.applied, true);
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/harness-bes-policy-lanes.test.js
```

Expected: FAIL because `run*BesLane` exports do not exist.

### Task 2: Add Lane Wrapper Exports

- [ ] **Step 1: Modify each policy evolver**

Add one wrapper per file:

```js
import { runBesLaneRuntime } from '../bes/laneRuntime.js';

export function runContextPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'context_policy_bes',
  now,
} = {}) {
  const candidates = proposeContextPolicies({ coreset, baselinePolicy, maxCandidates });
  return runBesLaneRuntime({
    lane: 'context',
    taskId,
    target: 'context_policy',
    candidates,
    hardCases: Array.isArray(coreset) ? coreset : coreset?.items || coreset?.cases || [],
    baselinePolicy,
    maxCandidates,
    now,
    evaluator: ({ candidate, hardCase }) => evaluateContextPolicyCandidate({
      candidate,
      traceCase: hardCase,
    }),
  });
}
```

Equivalent wrappers:

- `runCompactionPolicyBesLane`
- `runToolLoopPolicyBesLane`
- `runBudgetPolicyBesLane`
- `runVisualPolicyBesLane`
- `runMcpTrustPolicyBesLane`

Keep the existing `propose*` and `evaluate*` exports unchanged.

- [ ] **Step 2: Harden MCP trust lane**

In `runMcpTrustPolicyBesLane`, ensure candidates that widen permissions, disable poisoning checks, remove provenance requirements, or lower trust below baseline are returned with blocked evidence. The lane runtime should report this as a blocked candidate, not throw.

- [ ] **Step 3: Run focused tests**

Run:

```powershell
node --test tests/harness-bes-policy-lanes.test.js tests/harness-context-policy-evolution.test.js tests/harness-compaction-policy-evolution.test.js tests/harness-tool-loop-policy-evolution.test.js tests/harness-budget-policy-evolution.test.js tests/harness-visual-policy-evolution.test.js tests/harness-mcp-trust-evolution.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/contextPolicyEvolution.js src/harness-sidecar/meta/compactionPolicyEvolution.js src/harness-sidecar/meta/toolLoopPolicyEvolution.js src/harness-sidecar/meta/budgetPolicyEvolution.js src/harness-sidecar/meta/visualPolicyEvolution.js src/harness-sidecar/meta/mcpTrustEvolution.js tests/harness-bes-policy-lanes.test.js
git commit -m "feat: route policy evolvers through bes lanes"
```

---

## Chunk 3: Memory, Research, Skill, And Swarm BES Lanes

**Subagent:** Hypatia

**Goal:** Give the higher-level harness layers first-class BES optimization envelopes while preserving their local/global authority split.

**Files:**

- Create: `tests/harness-bes-domain-lanes.test.js`
- Modify: `src/harness-sidecar/meta/memoryPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/researchPolicyEvolution.js`
- Modify: `src/harness-sidecar/skills/skillEvolution.js`
- Modify: `src/harness-sidecar/skills/skillEvolutionScheduler.js`
- Modify: `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
- Modify: `src/harness-sidecar/meta/localEvolutionLoop.js`
- Modify: `src/harness-sidecar/meta/localMetaHarness.js`
- Modify: `src/harness-sidecar/memory/memoryGraphRuntime.js`
- Modify: `src/harness-sidecar/research/deepResearchManager.js`

### Task 1: Add Domain Lane Red Tests

- [ ] **Step 1: Write failing tests**

Create `tests/harness-bes-domain-lanes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runMemoryPolicyBesLane } from '../src/harness-sidecar/meta/memoryPolicyEvolution.js';
import { runResearchPolicyBesLane } from '../src/harness-sidecar/meta/researchPolicyEvolution.js';
import { runSkillCandidateBesLane } from '../src/harness-sidecar/skills/skillEvolution.js';
import { runSwarmPolicyBesLane } from '../src/harness-sidecar/swarm/evolutionSwarmPlanner.js';

test('memory lane preserves provenance requirements and blocks self-promotion', () => {
  const result = runMemoryPolicyBesLane({
    taskId: 'task-memory',
    coreset: {
      items: [
        {
          id: 'mem-1',
          reasons: ['memgraph_pending_activation_stall'],
          provenance: ['trace-1'],
        },
      ],
    },
  });

  assert.equal(result.lane, 'memory');
  assert.ok(result.candidates.length > 0);
  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.equal(result.candidates[0].provenanceRequired, true);
});

test('research, skill, and swarm lanes emit evidence envelopes', () => {
  const research = runResearchPolicyBesLane({
    taskId: 'task-research',
    coreset: { items: [{ id: 'r1', reasons: ['citation_gap'], evidence: ['source-a'] }] },
  });
  const skill = runSkillCandidateBesLane({
    taskId: 'task-skill',
    skillNeed: {
      needId: 'need-1',
      title: 'Citation Repair',
      failureModes: ['citation_gap'],
      evidence: [{ traceId: 'trace-1', eventId: 'event-1' }],
    },
  });
  const swarm = runSwarmPolicyBesLane({
    taskId: 'task-swarm',
    evolutionArchive: [
      { id: 'archive-1', candidateId: 'archive-1', goalScore: 0.8, lane: 'swarm' },
    ],
    hardCases: [{ caseId: 'swarm-1', reasons: ['handoff_gap'] }],
  });

  for (const result of [research, skill, swarm]) {
    assert.ok(result.candidates.length > 0);
    assert.equal(result.candidates[0].promotion.allowed, false);
    assert.ok(result.candidates[0].lineage.candidateId);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/harness-bes-domain-lanes.test.js
```

Expected: FAIL because the new lane wrapper exports do not exist.

### Task 2: Add Domain Lane Wrappers

- [ ] **Step 1: Memory lane**

In `src/harness-sidecar/meta/memoryPolicyEvolution.js`, add:

```js
export function runMemoryPolicyBesLane({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
  taskId = 'memory_policy_bes',
  now,
} = {}) {
  const candidates = proposeMemoryPolicies({ coreset, baselinePolicy, maxCandidates });
  return runBesLaneRuntime({
    lane: 'memory',
    taskId,
    target: 'memory_policy',
    candidates,
    hardCases: coreset?.items || coreset?.cases || [],
    baselinePolicy,
    maxCandidates,
    now,
    evaluator: ({ candidate, hardCase }) => evaluateMemoryPolicyCandidate({
      candidate,
      memoryCase: hardCase,
    }),
  });
}
```

Memory candidate outputs must retain:

- `provenanceRequired: true`
- conflict and bridge thresholds
- retrieval restart probability
- pending TTL/schema threshold changes
- `status: 'shadow_only'`

- [ ] **Step 2: Research lane**

In `src/harness-sidecar/meta/researchPolicyEvolution.js`, add `runResearchPolicyBesLane` using existing research proposal/evaluator functions. If names differ, keep the existing exports and wrap them without renaming public APIs.

The research lane should optimize:

- source ranking policy
- citation audit strictness
- contradiction pass behavior
- claim extraction/rewrite thresholds
- report synthesis policy

Candidate evidence must include source IDs, claim IDs, or contradiction IDs when present.

- [ ] **Step 3: Skill lane**

In `src/harness-sidecar/skills/skillEvolution.js`, add `runSkillCandidateBesLane`.

Inputs:

```js
{
  taskId,
  skillNeed,
  count,
  parentSections,
  now,
}
```

Behavior:

- call `generateSkillCandidates`;
- evaluate each candidate against quality subgoals: `trigger_precision`, `workflow_specificity`, `verifier_evidence`, `safety_boundaries`, and `cost_latency_awareness`;
- block global writes, global installs, approval weakening, and secret exposure;
- return a `skill` lane BES envelope.

Modify `skillEvolutionScheduler.js` so scheduled candidates include optional `besLane` evidence, while existing scheduler tests still pass.

- [ ] **Step 4: Swarm lane**

In `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`, add `runSwarmPolicyBesLane`.

Inputs:

```js
{
  taskId,
  evolutionArchive,
  bidirectionalBes,
  rhoCoreset,
  hardCases,
  maxCandidates,
  now,
}
```

Behavior:

- call or reuse `planEvolutionSwarmAttempts`;
- map attempts into `swarm` lane candidates with agent roles, handoff contracts, budget weight, island ID, and coordination trace;
- dense subgoals should include role coverage, handoff evidence, diversity, and hard-case coverage;
- return a `swarm` lane BES envelope.

- [ ] **Step 5: Runtime hooks**

Wire optional lane evidence into:

- `localEvolutionLoop.js`: local SwarmCell candidate outputs include `besLane` evidence.
- `localMetaHarness.js`: local meta results preserve `besLane` evidence.
- `memoryGraphRuntime.js`: memory runtime can call `runMemoryPolicyBesLane` when memory hard cases are present.
- `deepResearchManager.js`: research manager can call `runResearchPolicyBesLane` when research hard cases are present.

All hooks must be optional and default off or no-op when inputs are absent.

- [ ] **Step 6: Run focused tests**

Run:

```powershell
node --test tests/harness-bes-domain-lanes.test.js tests/harness-memory-policy-evolution.test.js tests/harness-research-policy-evolution.test.js tests/harness-skill-evolution.test.js tests/harness-skill-evolution-scheduler.test.js tests/harness-swarm-evolution-planner.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/harness-sidecar/meta/memoryPolicyEvolution.js src/harness-sidecar/meta/researchPolicyEvolution.js src/harness-sidecar/skills/skillEvolution.js src/harness-sidecar/skills/skillEvolutionScheduler.js src/harness-sidecar/swarm/evolutionSwarmPlanner.js src/harness-sidecar/meta/localEvolutionLoop.js src/harness-sidecar/meta/localMetaHarness.js src/harness-sidecar/memory/memoryGraphRuntime.js src/harness-sidecar/research/deepResearchManager.js tests/harness-bes-domain-lanes.test.js
git commit -m "feat: expand bes lanes to memory research skill and swarm"
```

---

## Chunk 4: Orchestration, Visibility, And Documentation

**Subagent:** Sagan

**Goal:** Make BES lane evidence visible to operators and document which harness layers can use BES optimization, without adding auto-apply authority.

**Files:**

- Create: `tests/harness-bes-lane-visibility.test.js`
- Create: `tests/harness-bes-nested-swarm-mesh.test.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- Modify: `src/harness-sidecar/interop/agentRouter.js`
- Modify: `src/harness-sidecar/interop/externalAgentGateway.js`
- Modify: `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
- Modify: `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/paper-implementation-alignment.md`

### Task 1: Add Visibility Red Tests

- [ ] **Step 1: Write failing tests**

Create `tests/harness-bes-lane-visibility.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarnessStatusSnapshot } from '../src/harness-sidecar/server.js';

test('status snapshot includes BES lane evidence without approval authority', () => {
  const snapshot = createHarnessStatusSnapshot({
    besLanes: [
      {
        lane: 'memory',
        taskId: 'task-memory',
        candidates: [
          {
            candidateId: 'memory_policy_1',
            promotion: { allowed: false, blockedReasons: ['evidence_only_lane'] },
            evidence: { sources: ['domain_eval'] },
          },
        ],
      },
    ],
  });

  assert.equal(snapshot.besLanes[0].lane, 'memory');
  assert.equal(snapshot.besLanes[0].candidates[0].promotion.allowed, false);
});
```

If `server.js` does not currently export a clean snapshot function, create a small pure helper near existing status construction and export it for tests.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/harness-bes-lane-visibility.test.js
```

Expected: FAIL because lane status is not surfaced.

### Task 2: Wire Status And Events

- [ ] **Step 1: Add status payload shape**

Add a `besLanes` or `laneEvolution` status section that includes:

```js
{
  lane,
  taskId,
  candidateCount,
  bestCandidateId,
  evidenceSources,
  blockedReasons,
  promotionAllowed: false,
  updatedAt,
}
```

Do not include full patch bodies, full skill markdown, secrets, raw prompts, or untrusted external content in status payloads.

- [ ] **Step 2: Add runtime event names**

Use existing event/log patterns to emit:

- `bes_lane.started`
- `bes_lane.completed`
- `bes_lane.blocked`

Events should include lane, task ID, candidate count, and blocked reasons only.

- [ ] **Step 3: Run focused visibility tests**

Run:

```powershell
node --test tests/harness-bes-lane-visibility.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
```

Expected: PASS.

### Task 3: Add Nested Swarm Mesh Regression

- [ ] **Step 1: Write failing mesh test**

Create `tests/harness-bes-nested-swarm-mesh.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createA2aSwarmEnvelope } from '../src/harness-sidecar/interop/a2aSwarmEnvelope.js';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';

test('A2A and Memory Graph RAG context flow through a BES lane without granting authority', () => {
  const envelope = createA2aSwarmEnvelope({
    taskId: 'task-nested-mesh',
    from: { type: 'swarmcell', id: 'cell-research' },
    to: { type: 'global_harness', id: 'global-meta' },
    payload: {
      candidateRef: 'candidate-1',
      evidenceRefs: ['rho-case-1', 'memory-fact-1'],
      lineage: { parents: ['agent-1', 'agent-2'] },
      trust: { external: false, verified: false },
    },
  });

  const result = runBesLaneRuntime({
    lane: 'research',
    taskId: 'task-nested-mesh',
    a2aEnvelope: envelope,
    memoryGraphContext: {
      local: { nodeIds: ['local-hard-case-1'] },
      swarmCell: { nodeIds: ['cell-lesson-1'] },
      global: { nodeIds: ['global-pattern-1'], provenance: ['trace-1'] },
    },
    candidates: [{ candidateId: 'candidate-1', status: 'shadow_only' }],
    hardCases: [{ caseId: 'rho-case-1', reasons: ['citation_gap'] }],
    evaluator: () => ({
      score: 0.75,
      reasons: ['citation_gap_addressed'],
      safetyStatus: 'shadow_only',
    }),
  });

  assert.equal(result.candidates[0].promotion.allowed, false);
  assert.equal(result.candidates[0].a2a.payload.candidateRef, 'candidate-1');
  assert.deepEqual(result.candidates[0].memoryGraph.global.nodeIds, ['global-pattern-1']);
  assert.ok(result.candidates[0].lineage.candidateId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/harness-bes-nested-swarm-mesh.test.js
```

Expected: FAIL until A2A envelope metadata and lane runtime context preservation are implemented.

- [ ] **Step 3: Preserve A2A lane metadata**

Modify `a2aSwarmEnvelope.js`, `agentRouter.js`, and `externalAgentGateway.js` so nested harness/swarm messages can carry:

```js
{
  besLane,
  rhoCaseIds,
  memoryGraphRefs,
  candidateRef,
  lineage,
  trust,
  requiredVerification,
}
```

Rules:

- The envelope can carry references, not full raw patches, secrets, raw prompts, or untrusted webpage/model text.
- External A2A claims must be tagged as untrusted until verified.
- Missing `requiredVerification` should keep candidates visible but not promotable.
- Routing must preserve lineage across agent, SwarmCell, swarm, local harness, and global harness hops.

- [ ] **Step 4: Preserve Memory Graph RAG context**

Modify `hierarchicalMemoryRetriever.js` so lane runtime callers can request a compact context packet:

```js
{
  local,
  swarmCell,
  global,
  provenance,
  conflicts,
  retrievalTrace,
}
```

Rules:

- Context packets should be bounded and summary-oriented.
- Conflict flags must be preserved.
- Provenance must travel with global facts.
- The lane runtime may use this as evidence context, but memory promotion remains separate.

- [ ] **Step 5: Run mesh tests**

Run:

```powershell
node --test tests/harness-bes-nested-swarm-mesh.test.js tests/harness-agent-interop.test.js tests/harness-local-global-memory-graph.test.js tests/harness-hierarchical-swarm-integration.test.js
```

Expected: PASS.

### Task 4: Update Architecture Docs

- [ ] **Step 1: Update `hierarchical-self-modifying-swarm-synthesis.md`**

Add a subsection under evolutionary loops:

- "Nested Evolving Swarm Mesh"
  - explain agent -> SwarmCell -> swarm -> local harness -> global harness -> harness-of-harnesses recursion
  - explain that harnesses are themselves evolvable candidates
  - explain that A2A envelopes and Memory Graph RAG are the connective tissue between levels
- "BES Lane Expansion"
- list all lanes and sublanes:
  - code
  - verifier
  - memory
  - research
  - skill
  - swarm
  - context
  - compaction
  - tool
  - budget
  - visual
  - MCP trust
- explain that every layer can use BES for optimization, but not every layer can apply changes.

- [ ] **Step 2: Update `feature-architecture-map.md`**

Add rows for:

- shared BES lane runtime
- policy-evolver BES lane wrappers
- domain BES lane wrappers
- lane visibility/events
- nested swarm/harness mesh
- A2A envelope metadata for BES/RHO/memory graph lineage
- Memory Graph RAG context packets for lane runtime

- [ ] **Step 3: Update `paper-implementation-alignment.md`**

Clarify that this is still a deterministic first-pass implementation:

- BES lane runtime exists.
- Domain lanes are candidates/evidence, not autonomous self-modification.
- A2A plus Memory Graph RAG links the evolving harness layers, but external claims remain untrusted until verified.
- Paper-grade multi-agent societies and learned optimizers remain future work unless separately implemented.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/server.js src/harness-sidecar/interop/a2aSwarmEnvelope.js src/harness-sidecar/interop/agentRouter.js src/harness-sidecar/interop/externalAgentGateway.js src/harness-sidecar/rag/hierarchicalMemoryRetriever.js tests/harness-bes-lane-visibility.test.js tests/harness-bes-nested-swarm-mesh.test.js docs/architecture/hierarchical-self-modifying-swarm-synthesis.md docs/architecture/feature-architecture-map.md docs/architecture/paper-implementation-alignment.md
git commit -m "feat: surface bes lane evolution evidence"
```

---

## Chunk 5: Boundary Hardening And Regression Sweep

**Subagent:** Sagan, or a fresh reviewer subagent if available

**Goal:** Prove the expanded BES lane system cannot bypass promotion, trust-kernel, verifier, memory-provenance, MCP-trust, or source-patch boundaries.

**Files:**

- Modify: `tests/harness-bes-lane-runtime.test.js`
- Modify: `tests/harness-trust-kernel-boundary.test.js`
- Modify: `tests/harness-meta-experiment-runs.test.js`
- Modify: `tests/harness-rho-replay-batch.test.js`
- Modify: `tests/harness-bes-policy-lanes.test.js`
- Modify: `tests/harness-bes-domain-lanes.test.js`
- Modify: `tests/harness-bes-nested-swarm-mesh.test.js`

### Task 1: Add Boundary Regression Cases

- [ ] **Step 1: Add self-approval cases**

In `tests/harness-bes-lane-runtime.test.js`, add cases proving these candidates are blocked:

- `status: 'approved'`
- `status: 'applied'`
- `applied: true`
- `durableApplyApproved: true`
- `promotion: { allowed: true }`

- [ ] **Step 2: Add failed RHO validation case**

Add a lane runtime test where `replayRunner` returns:

```js
{
  validation: { passed: false, reasons: ['regression_detected'] },
  preference: { winner: 'candidate' },
}
```

Expected:

- evidence includes `rho_replay`;
- promotion remains disallowed;
- blocked reasons include `rho_validation_failed`.

- [ ] **Step 3: Add MCP trust regression**

In `tests/harness-bes-policy-lanes.test.js`, add an MCP trust candidate that attempts to:

- widen filesystem permissions;
- disable poisoning checks;
- remove provenance;
- bypass approval.

Expected: candidate remains visible but blocked.

- [ ] **Step 4: Add source-patch path metadata regression**

In `tests/harness-trust-kernel-boundary.test.js`, ensure a code lane candidate without source patch path metadata cannot create promotion evidence.

- [ ] **Step 5: Add A2A and memory graph trust regression**

In `tests/harness-bes-nested-swarm-mesh.test.js`, add cases proving:

- an external A2A envelope cannot become passing evidence by itself;
- a memory graph fact without provenance cannot unlock promotion evidence;
- conflict flags from Memory Graph RAG stay visible in the lane envelope;
- lineage survives multiple hops without granting apply authority.

### Task 2: Run Focused Regression

- [ ] **Step 1: Run BES lane tests**

```powershell
node --test tests/harness-bes-lane-runtime.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js tests/harness-bes-nested-swarm-mesh.test.js tests/harness-bes-lane-contracts.test.js
```

Expected: PASS.

- [ ] **Step 2: Run trust/RHO/global experiment tests**

```powershell
node --test tests/harness-trust-kernel-boundary.test.js tests/harness-rho-replay-batch.test.js tests/harness-meta-experiment-runs.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-verifier-evolution-loop.test.js
```

Expected: PASS.

- [ ] **Step 3: Run policy/domain integration tests**

```powershell
node --test tests/harness-context-policy-evolution.test.js tests/harness-compaction-policy-evolution.test.js tests/harness-tool-loop-policy-evolution.test.js tests/harness-budget-policy-evolution.test.js tests/harness-visual-policy-evolution.test.js tests/harness-memory-policy-evolution.test.js tests/harness-mcp-trust-evolution.test.js tests/harness-research-policy-evolution.test.js tests/harness-skill-evolution.test.js tests/harness-swarm-evolution-planner.test.js
```

Expected: PASS.

- [ ] **Step 4: Run broad sidecar sweep**

```powershell
node --test tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-hierarchical-swarm-integration.test.js tests/harness-agent-interop.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
```

Expected: PASS.

- [ ] **Step 5: Run release smoke**

```powershell
npm run release:smoke
```

Expected: PASS.

- [ ] **Step 6: Optional full test suite**

```powershell
npm test
```

Expected: PASS, except any pre-existing unrelated failure must be documented with exact file, assertion, and observed expected/actual values.

- [ ] **Step 7: Commit**

```powershell
git add tests/harness-bes-lane-runtime.test.js tests/harness-trust-kernel-boundary.test.js tests/harness-meta-experiment-runs.test.js tests/harness-rho-replay-batch.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js tests/harness-bes-nested-swarm-mesh.test.js
git commit -m "fix: harden bes lane promotion boundaries"
```

---

## Final Acceptance Criteria

- `runBesLaneRuntime` exists and is covered by tests.
- Existing shadow policy evolvers can emit BES lane envelopes.
- Memory, research, skill, and swarm layers can emit BES lane envelopes.
- BES lane candidates include dense subgoal, domain, RHO, adaptive search, ToolTree, trajectory operator, champion archive, frontier, verifier genome, A2A, memory graph, lineage, and promotion summary fields where available.
- BES lane candidates cannot self-apply or self-promote.
- Failed RHO validation blocks promotion evidence.
- A2A envelopes link agents, SwarmCells, swarms, local harnesses, and global harnesses without granting authority.
- Memory Graph RAG context flows into BES lanes with provenance and conflict flags intact.
- Harnesses themselves can be represented as candidates optimized by higher-level harnesses.
- MCP trust, source patch, memory provenance, and approval boundaries remain intact.
- Operator-visible status shows lane evolution evidence without leaking raw prompts, patches, secrets, or untrusted external content.
- Architecture docs clearly answer: every layer can use BES optimization capabilities, but durable application remains gated.

## Final Verification Commands

Run:

```powershell
node --test tests/harness-bes-lane-runtime.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js tests/harness-bes-nested-swarm-mesh.test.js tests/harness-bes-lane-visibility.test.js tests/harness-bes-lane-contracts.test.js
```

Expected: PASS.

Run:

```powershell
node --test tests/harness-context-policy-evolution.test.js tests/harness-compaction-policy-evolution.test.js tests/harness-tool-loop-policy-evolution.test.js tests/harness-budget-policy-evolution.test.js tests/harness-visual-policy-evolution.test.js tests/harness-memory-policy-evolution.test.js tests/harness-mcp-trust-evolution.test.js tests/harness-research-policy-evolution.test.js tests/harness-skill-evolution.test.js tests/harness-skill-evolution-scheduler.test.js tests/harness-swarm-evolution-planner.test.js
```

Expected: PASS.

Run:

```powershell
node --test tests/harness-trust-kernel-boundary.test.js tests/harness-rho-replay-batch.test.js tests/harness-meta-experiment-runs.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-hierarchical-swarm-integration.test.js tests/harness-agent-interop.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
```

Expected: PASS.

Run:

```powershell
npm run release:smoke
```

Expected: PASS.

## Execution Handoff

After saving this plan, execute it with `superpowers:subagent-driven-development` because subagents are available in this workspace. Use a fresh subagent for each chunk, then run a final reviewer pass before merging the chunk commits.
