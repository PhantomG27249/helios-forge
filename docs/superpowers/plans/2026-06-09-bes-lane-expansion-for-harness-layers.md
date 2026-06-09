# BES Lane Expansion For Harness Layers Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand BES optimization from the current meta/verifier spine into every existing harness evolution layer while keeping all durable application behind RHO replay, global experiment evidence, trust-kernel checks, and operator approval.

**Architecture:** Add one shared BES lane runtime adapter that wraps lane contracts, bidirectional BES, population evolution, dense subgoal verification, lineage, and optional RHO replay evidence. Existing shadow policy evolvers stay responsible for domain-specific candidate generation, while the new adapter gives each layer a common optimization/evidence envelope. Promotion authority remains centralized: local and lane-level BES can propose, score, and archive candidates, but only global experiments plus trust gates can promote or apply them.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Helios Forge sidecar modules under `src/harness-sidecar/{bes,meta,memory,rho,skills,swarm,research,tools,budget,vlm,core}`, workspace-local `.harness` artifacts, PowerShell on Windows.

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
- Do not add package dependencies or network calls.
- Do not stage unrelated dirty files. At plan creation time, `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md` may already be dirty from prior work; leave it alone unless the operator explicitly scopes it in.
- Commit after each chunk with the commit messages listed below.

Recommended commit messages:

- `feat: add bes lane runtime adapter`
- `feat: route policy evolvers through bes lanes`
- `feat: expand bes lanes to memory research skill and swarm`
- `feat: surface bes lane evolution evidence`
- `fix: harden bes lane promotion boundaries`

## Safety Invariants

Every chunk must preserve these invariants:

- Local SwarmCell BES outputs are proposals only.
- Lane BES outputs are candidates only.
- Memory, research, skill, swarm, tool, context, budget, visual, and MCP trust lanes remain `shadow_only` unless a separate promotion path approves them.
- Source patch candidates must include file path metadata before trust-kernel evaluation.
- Candidate evidence must include at least one of: dense subgoal result, RHO replay result, domain evaluator result, or harness experiment comparison.
- Failed RHO validation, missing provenance, or trust-kernel boundary violations block promotion evidence.
- The adapter must never weaken approval gates, sandbox policy, MCP trust policy, verifier thresholds, secret handling, or rollback requirements.

## File Map

### New Files

- `src/harness-sidecar/bes/laneRuntime.js`
  - Shared BES lane adapter. Normalizes lane inputs, runs BES/evolution, scores dense subgoals, records lineage, attaches optional RHO replay evidence, and returns promotion-safe candidate envelopes.
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
} = {}) {
  // returns { sources, hasPassingEvidence, blockedReasons, denseSubgoals, rhoReplay, domainEvaluation, harnessExperiment }
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
- For each candidate:
  - preserve `candidateId`, `status`, `target`, and existing domain fields;
  - evaluate with the provided `evaluator` if present;
  - run optional `replayRunner` if present;
  - call `verifyDenseSubgoals` or `scoreSubgoals` with evidence derived from domain/RHO results;
  - record lineage with `recordLineage`;
  - attach `bes`, `evidence`, `lineage`, and `promotion` fields.
- Run `runBidirectionalBes` and `runEvolutionPopulationSync` only as lightweight optimization summaries; do not require these to generate domain candidates.
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
- Modify: `src/harness-sidecar/server.js`
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

### Task 3: Update Architecture Docs

- [ ] **Step 1: Update `hierarchical-self-modifying-swarm-synthesis.md`**

Add a subsection under evolutionary loops:

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

- [ ] **Step 3: Update `paper-implementation-alignment.md`**

Clarify that this is still a deterministic first-pass implementation:

- BES lane runtime exists.
- Domain lanes are candidates/evidence, not autonomous self-modification.
- Paper-grade multi-agent societies and learned optimizers remain future work unless separately implemented.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/server.js tests/harness-bes-lane-visibility.test.js docs/architecture/hierarchical-self-modifying-swarm-synthesis.md docs/architecture/feature-architecture-map.md docs/architecture/paper-implementation-alignment.md
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

### Task 2: Run Focused Regression

- [ ] **Step 1: Run BES lane tests**

```powershell
node --test tests/harness-bes-lane-runtime.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js tests/harness-bes-lane-contracts.test.js
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
node --test tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-pi-native-worker.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-hierarchical-swarm-integration.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
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
git add tests/harness-bes-lane-runtime.test.js tests/harness-trust-kernel-boundary.test.js tests/harness-meta-experiment-runs.test.js tests/harness-rho-replay-batch.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js
git commit -m "fix: harden bes lane promotion boundaries"
```

---

## Final Acceptance Criteria

- `runBesLaneRuntime` exists and is covered by tests.
- Existing shadow policy evolvers can emit BES lane envelopes.
- Memory, research, skill, and swarm layers can emit BES lane envelopes.
- BES lane candidates include dense subgoal, domain, RHO, lineage, and promotion summary fields where available.
- BES lane candidates cannot self-apply or self-promote.
- Failed RHO validation blocks promotion evidence.
- MCP trust, source patch, memory provenance, and approval boundaries remain intact.
- Operator-visible status shows lane evolution evidence without leaking raw prompts, patches, secrets, or untrusted external content.
- Architecture docs clearly answer: every layer can use BES optimization capabilities, but durable application remains gated.

## Final Verification Commands

Run:

```powershell
node --test tests/harness-bes-lane-runtime.test.js tests/harness-bes-policy-lanes.test.js tests/harness-bes-domain-lanes.test.js tests/harness-bes-lane-visibility.test.js tests/harness-bes-lane-contracts.test.js
```

Expected: PASS.

Run:

```powershell
node --test tests/harness-context-policy-evolution.test.js tests/harness-compaction-policy-evolution.test.js tests/harness-tool-loop-policy-evolution.test.js tests/harness-budget-policy-evolution.test.js tests/harness-visual-policy-evolution.test.js tests/harness-memory-policy-evolution.test.js tests/harness-mcp-trust-evolution.test.js tests/harness-research-policy-evolution.test.js tests/harness-skill-evolution.test.js tests/harness-skill-evolution-scheduler.test.js tests/harness-swarm-evolution-planner.test.js
```

Expected: PASS.

Run:

```powershell
node --test tests/harness-trust-kernel-boundary.test.js tests/harness-rho-replay-batch.test.js tests/harness-meta-experiment-runs.test.js tests/harness-local-meta-harness.test.js tests/harness-local-global-memory-graph.test.js tests/harness-hierarchical-swarm-integration.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
```

Expected: PASS.

Run:

```powershell
npm run release:smoke
```

Expected: PASS.

## Execution Handoff

After saving this plan, execute it with `superpowers:subagent-driven-development` because subagents are available in this workspace. Use a fresh subagent for each chunk, then run a final reviewer pass before merging the chunk commits.
