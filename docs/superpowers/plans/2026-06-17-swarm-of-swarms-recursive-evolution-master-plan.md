# Swarm-of-Swarms Recursive Evolution Master Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Helios Forge's existing Level 4-capable engine substrate into a continuously measuring, recursively improving swarm-of-swarms that earns autonomy only through held-out evidence — closing the gap between "engine built" and "organism proven."

**Architecture:** Phase 0 wires dormant modules (trust kernel, replay cycles, campaigns, MemGraphRAG, nested SwarmCells) into the production hot path. Phase 1+ runs the evidence loop (scoreboard → local recursion → global campaigns → paper-grade scale → network → earned autonomy). Parallel subagents own read/write-disjoint modules; a serial integration subagent owns shared chokepoints. Every durable mutation stays trust-gated and evidence-only until replay proof exists.

**Tech Stack:** Node.js ESM, `node:test`, `src/harness-sidecar/*`, `src/server.js`, `public/app.js`, JSON/JSONL harness artifacts under `.harness/`, feature-gated production capabilities, existing BES/RHO/meta/memory/swarm modules.

**Authority docs:**
- Audit: `docs/architecture/2026-06-12-evolutionary-swarm-meta-harness-codebase-audit.md`
- Vision: `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`
- Supersedes execution priority for: `docs/superpowers/plans/2026-06-12-remaining-paper-gaps-parallel-subagents.md` (reuse workers where modules already exist)

---

## Current Baseline (June 17, 2026)

**Already implemented (modules + tests, not production-wired):**

| Module | Path | Wired in `server.js`? |
| --- | --- | --- |
| Replay cycle runner | `src/harness-sidecar/benchmarks/replayCycleRunner.js` | No |
| Operator dashboard store | `src/harness-sidecar/meta/operatorDashboardStore.js` | No |
| Trust kernel boundary | `src/harness-sidecar/core/trustKernelBoundary.js` | No (tests only) |
| Promotion loop | `src/harness-sidecar/meta/promotionLoop.js` | No |
| Meta-harness campaign runner | `src/harness-sidecar/meta/metaHarnessCampaignRunner.js` | No |
| Harness-of-harnesses optimizer | `src/harness-sidecar/meta/harnessOfHarnessesOptimizer.js` | No |
| Full MemGraphRAG runtime | `src/harness-sidecar/memory/memoryGraphRuntime.js` | No (light graph path only) |
| SwarmCell runtime | `src/harness-sidecar/swarm/swarmCellRuntime.js` | No (orchestrator uses flat swarm) |
| Governance loop | `src/harness-sidecar/meta/governanceLoop.js` | Partial (accepts `trust.boundary` but never receives it) |

**Already wired in production task path:**

- BES lanes, RHO coreset/preference, `HarnessOptimizer`, memory promote, `orchestrateSwarm`, local meta per attempt, governance summaries, approval-gated champion apply.

**Critical invariant (never weaken):**

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

---

## Milestone Gates

Do not start the next milestone until the current gate passes `npm test` and focused integration tests.

| Milestone | Gate | Capability goals unlocked |
| --- | --- | --- |
| **M0** | Trust kernel on every apply/promote path | — | **Done** — `trustKernelGateway`, `approvalResume`, governance trust input |
| **M1** | Recurring replay cycles + dashboard snapshots | `benchmark_spine` production evidence | **Done** — `replayScheduler` + post-task hooks persist reports |
| **M2** | Nested SwarmCells with per-cell local meta history | `soul_coverage` nested path started | **Done** — `nestedSwarmOrchestrator` wired via `HELIOS_NESTED_SWARM_CELLS=1` |
| **M3** | Autonomous meta-harness campaigns over source-tree variants | `meta_harness_loop` | **Done** — `campaignScheduler` in post-task hooks (feature-gated) |
| **M4** | MemGraphRAG in task + swarm memory path | `memgraphrag_depth` | **Done** — `memoryGraphTaskBridge` in post-task hooks |
| **M5** | Paper-grade RHO/BES/VLM at scale (feature-gated) | `rho_at_scale`, `bes_full_lanes`, `multimodal_system_sense` |
| **M6** | External A2A peer cycles | `a2a_external_durability` |
| **M7** | Earned autonomy L1–L2 with rollback drill history | `governance_autonomy` |

---

## Controller Responsibilities

1. Create dedicated branch/worktree before implementation (`superpowers:using-git-worktrees`).
2. Run **Chunk 0** recon subagents in parallel (read-only).
3. Dispatch **one implementer subagent at a time** per `subagent-driven-development` (no parallel implementers).
4. Dispatch **parallel read-only recon** or **parallel workers only when file ownership is disjoint** and integration is deferred.
5. After each implementer: **spec reviewer**, then **code quality reviewer**; loop until approved.
6. Run **serial integration subagent** only after domain workers for that chunk are green.
7. Update this plan's checkboxes after each worker.
8. Run `npm test` and `npm run release:smoke` before merge.

---

## Subagent Dispatch Protocol

### Implementer subagent prompt template

```text
You are implementing one worker from the Helios Forge master plan:
docs/superpowers/plans/2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md

Worker ID: [WORKER_ID]
Milestone: [M0|M1|...]

You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve evidence-only authority.
Use TDD: write failing tests first, then implementation, then focused verification.
Preserve dev-browser compatibility and Electron path assumptions.

Assigned files (ONLY these):
[FILE_LIST]

Non-negotiable:
- canPromote: false and promotionEvidenceOnly: true on new evidence surfaces unless explicitly integrating promotion policy
- All model-visible fields pass through modelVisibleQuarantine
- No weakening of trust-kernel checks

Return exactly:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- changed files
- tests run (command + result)
- commit SHA (if committed)
- remaining concerns
```

### Spec reviewer subagent prompt template

```text
Review worker [WORKER_ID] against its plan section only.
Read the worker's changed files and tests. Confirm:
1. All required APIs/behaviors from the plan exist
2. Nothing extra that weakens security or authority
3. Tests cover the spec claims
Return: APPROVED or list of spec gaps with file:line references.
```

### Code quality reviewer subagent prompt template

```text
Review worker [WORKER_ID] for Helios Forge conventions.
Check: naming, error handling, quarantine usage, no magic strings, focused files.
Return: APPROVED or issues ranked important/minor with file:line references.
```

---

## Shared Integration Chokepoints

**Only the serial Integration Worker for each chunk may edit:**

- `src/harness-sidecar/server.js`
- `src/server.js`
- `public/app.js`
- `public/index.html`
- `src/harness-sidecar/config/configLoader.js`
- `src/harness-sidecar/meta/capabilityGoalStatus.js`
- `docs/architecture/current-architecture.md`
- `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- this plan file

All other workers add standalone modules + tests and export APIs for integration.

---

## File Structure (New Modules)

| File | Responsibility |
| --- | --- |
| `src/harness-sidecar/core/trustKernelGateway.js` | Thin adapter: `evaluateTrustKernelBoundary` → governance-friendly envelope |
| `src/harness-sidecar/benchmarks/replayScheduler.js` | Schedule recurring replay cycles, persist reports, feed dashboard store |
| `src/harness-sidecar/benchmarks/baselineFamilyRegistry.js` | Register baseline families (forward-only, BES+RHO, full-stack) |
| `src/harness-sidecar/swarm/nestedSwarmOrchestrator.js` | Multi-cell orchestration via `runSwarmCell` |
| `src/harness-sidecar/swarm/oversoulBudgetRouter.js` | Advisory budget allocation across cells |
| `src/harness-sidecar/memory/memoryGraphTaskBridge.js` | Bridge swarm local_memory proposals → `memoryGraphRuntime` |
| `src/harness-sidecar/meta/campaignScheduler.js` | Headless meta-harness campaign scheduling |
| `src/harness-sidecar/meta/recursiveEvolutionCoordinator.js` | Orchestrate promotion loop + campaign + replay evidence |

---

## Chunk 0: Recon And Conflict Map

Run these **read-only** subagents in parallel before any implementation.

### Agent 0A: Hot Path Wiring Recon

**Read-only scope:**
- `src/harness-sidecar/server.js` (`runFullRuntimeSubsystems`, `createTask`, approval handlers)
- `src/harness-sidecar/core/approvalResume.js`
- `src/harness-sidecar/meta/governanceLoop.js` (`decideGovernanceAction`)
- `tests/harness-authority-boundary-integration.test.js`

**Return:** exact insertion points for trust kernel, replay scheduler, campaign scheduler; list of existing event types to extend.

### Agent 0B: Scoreboard Recon

**Read-only scope:**
- `src/harness-sidecar/benchmarks/replayCycleRunner.js`
- `src/harness-sidecar/benchmarks/heldOutSuiteStore.js`
- `src/harness-sidecar/meta/operatorDashboardStore.js`
- `src/harness-sidecar/meta/longitudinalFrontier.js`
- `tests/replay-cycle-runner.test.js`

**Return:** report shapes, store paths under `.harness/`, smallest scheduler API, tests to extend.

### Agent 0C: Recursion Recon

**Read-only scope:**
- `src/harness-sidecar/swarm/swarmOrchestrator.js`
- `src/harness-sidecar/swarm/swarmCellRuntime.js`
- `src/harness-sidecar/swarm/swarmCellRegistry.js`
- `src/harness-sidecar/memory/memoryGraphRuntime.js`
- `src/harness-sidecar/meta/promotionLoop.js`
- `src/harness-sidecar/meta/metaHarnessCampaignRunner.js`
- `tests/harness-hierarchical-swarm-integration.test.js`

**Return:** minimal nested orchestrator design, MemGraphRAG bridge points, campaign wiring seam.

- [x] **Chunk 0 complete** — controller has conflict map and insertion points documented in a PR comment or plan appendix

---

## Chunk 1: Trust Kernel On Hot Path (Milestone M0)

**Goal:** Every governance decision and apply resume passes through `evaluateTrustKernelBoundary`.

### Worker 1A: Trust Kernel Gateway

**Files:**
- Create: `src/harness-sidecar/core/trustKernelGateway.js`
- Create: `tests/trust-kernel-gateway.test.js`

**Owns:** gateway module only. No `server.js` edits.

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProposalTrustBoundary } from '../src/harness-sidecar/core/trustKernelGateway.js';

test('gateway wraps trust kernel with governance-friendly envelope', () => {
  const result = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: { kind: 'source_patch', paths: ['../outside.js'] },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.boundary.authority, 'evidence_only');
  assert.ok(result.reasons.length > 0);
});

test('gateway passes valid workspace-local proposals', () => {
  const result = evaluateProposalTrustBoundary({
    workspaceRoot: process.cwd(),
    proposal: {
      kind: 'source_patch',
      paths: ['src/harness-sidecar/meta/promotionPolicy.js'],
      risk: 'low',
      approvalRequired: true,
    },
  });
  assert.equal(result.allowed, true);
  assert.equal(result.boundary.requiresApproval, true);
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests/trust-kernel-gateway.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement gateway**

Required API:

```js
export function evaluateProposalTrustBoundary({
  workspaceRoot,
  proposal = {},
  evidence = {},
  visual = {},
} = {}) {
  // calls evaluateTrustKernelBoundary, returns:
  // { allowed, requiresApproval, boundary, reasons, authority: 'evidence_only' }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `node --test tests/trust-kernel-gateway.test.js`

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/core/trustKernelGateway.js tests/trust-kernel-gateway.test.js
git commit -m "feat: add trust kernel gateway for governance integration"
```

### Worker 1B: Governance Trust Integration (module-level)

**Files:**
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Modify: `tests/harness-governance-loop.test.js`

**Owns:** governance loop + its tests only.

- [ ] **Step 1: Write failing test** — `decideGovernanceAction` rejects when `trust.boundary.allowed === false` even if auto-approval would pass.

- [ ] **Step 2: Run failing test**

Run: `node --test tests/harness-governance-loop.test.js`

- [ ] **Step 3: Add optional `evaluateTrust` hook** — when `trust.evaluate === true` and `workspaceRoot` + `proposal` provided, call `evaluateProposalTrustBoundary` before auto-approval.

- [ ] **Step 4: Verify tests pass**

- [ ] **Step 5: Commit**

### Integration Worker 1: Server + Approval Hot Path

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `src/harness-sidecar/core/approvalResume.js`
- Modify: `tests/harness-authority-boundary-integration.test.js`

- [ ] **Step 1: Write failing integration test** — simulated champion apply with path-escape proposal is blocked before approval resume.

- [ ] **Step 2: Wire gateway into:**
  - `decideGovernanceAction` calls (pass `trust: { evaluate: true, workspaceRoot, proposal }`)
  - `approvalResume` paths for `source_patch`, `verifier_config_apply`, champion apply

- [ ] **Step 3: Run integration tests**

Run: `node --test tests/harness-authority-boundary-integration.test.js tests/trust-kernel-gateway.test.js tests/harness-governance-loop.test.js`

- [ ] **Step 4: Run full suite**

Run: `npm test`

- [ ] **Step 5: Commit + mark M0 gate**

**M0 gate:** `evaluateTrustKernelBoundary` exercised in production code path (grep confirms import from `server.js` or `approvalResume.js`).

---

## Chunk 2: Scoreboard And Recurring Replay (Milestone M1)

**Goal:** Recurring held-out replay cycles populate operator dashboard snapshots.

### Worker 2A: Baseline Family Registry

**Files:**
- Create: `src/harness-sidecar/benchmarks/baselineFamilyRegistry.js`
- Create: `tests/baseline-family-registry.test.js`

- [ ] **Step 1: Write failing tests** for families: `forward_only`, `rho_only`, `bes_rho`, `full_stack`.

- [ ] **Step 2: Implement registry** exporting `listBaselineFamilies()`, `getBaselineFamily(id)`.

- [ ] **Step 3: Verify + commit**

### Worker 2B: Replay Scheduler

**Files:**
- Create: `src/harness-sidecar/benchmarks/replayScheduler.js`
- Create: `tests/replay-scheduler.test.js`

- [ ] **Step 1: Write failing tests**

Cover: schedule definition, due detection, calls `runReplayCycle`, persists report under `.harness/benchmarks/reports/`, calls `operatorDashboardStore` snapshot builder, evidence-only output.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDueReplaySchedules } from '../src/harness-sidecar/benchmarks/replayScheduler.js';

test('scheduler persists evidence-only replay reports', async () => {
  const writes = [];
  const result = await runDueReplaySchedules({
    workspaceRoot: process.cwd(),
    schedules: [{ id: 'weekly-code', suiteId: 'code-smoke', intervalMs: 0 }],
    suiteLoader: async () => ({
      id: 'code-smoke',
      domains: ['code'],
      cases: [{ id: 'c1', domain: 'code', metricWeights: { quality: 1 } }],
    }),
    baselineRunner: async () => ({ metrics: { quality: 0.5 }, passed: true }),
    candidateRunner: async () => ({ metrics: { quality: 0.6 }, passed: true }),
    store: {
      saveReport: async (report) => { writes.push(report); },
      saveSnapshot: async () => {},
    },
    now: () => new Date('2026-06-17T00:00:00.000Z'),
  });
  assert.equal(result.ran.length, 1);
  assert.equal(writes[0].canPromote, false);
  assert.equal(writes[0].promotionEvidenceOnly, true);
});
```

- [ ] **Step 2–5: Implement, verify, commit**

Required API:

```js
export async function runDueReplaySchedules({
  workspaceRoot,
  schedules = [],
  suiteLoader,
  baselineRunner,
  candidateRunner,
  store,
  budget = {},
  now = () => new Date(),
} = {}) {}
```

### Integration Worker 2: Scoreboard Hot Path + UI

**Files:**
- Modify: `src/harness-sidecar/server.js` (add `/v1/replay/schedules`, wire post-task replay hook)
- Modify: `src/server.js` (WebSocket: `harness_replay_status`, `harness_dashboard_snapshot`)
- Modify: `public/app.js` (read-only dashboard panel)
- Modify: `src/harness-sidecar/meta/capabilityGoalStatus.js` (accept replay report refs)

- [ ] **Step 1: Write failing test** in `tests/harness-replay-scheduler-integration.test.js`

- [ ] **Step 2: Wire scheduler** — after non-MVP task completion, queue one replay cycle when `productionCapabilities.operatorDashboards` enabled.

- [ ] **Step 3: Expose status** via harness manager + UI (no promote buttons).

- [ ] **Step 4: Run tests + `npm test`**

- [ ] **Step 5: Commit + mark M1 gate**

**M1 gate:** at least one integration test proves report persisted + dashboard snapshot built; `benchmark_spine` row can accept `persisted_replay_report` evidence ref.

---

## Chunk 3: Nested SwarmCells (Milestone M2)

**Goal:** Swarm-of-swarms at SwarmCell level — multiple cells per task with distinct local meta.

### Worker 3A: Nested Swarm Orchestrator

**Files:**
- Create: `src/harness-sidecar/swarm/nestedSwarmOrchestrator.js`
- Create: `tests/nested-swarm-orchestrator.test.js`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { orchestrateNestedSwarm } from '../src/harness-sidecar/swarm/nestedSwarmOrchestrator.js';

test('orchestrates multiple SwarmCells and merges evolution evidence', async () => {
  const result = await orchestrateNestedSwarm({
    workspaceRoot: process.cwd(),
    cells: [
      { cellId: 'code-1', role: 'implementer', outputContract: { cellType: 'code' } },
      { cellId: 'memory-1', role: 'researcher', outputContract: { cellType: 'memory_rag' } },
    ],
    task: { id: 'task-1', prompt: 'implement feature' },
    commandAdapter: async () => ({
      taskOutput: { summary: 'done' },
      evolutionOutput: { hardCases: [{ id: 'hc-1' }] },
    }),
    featureFlags: { localMetaHarness: true },
  });
  assert.equal(result.cells.length, 2);
  assert.equal(result.evidenceOnly, true);
  assert.equal(result.canPromote, false);
  assert.ok(result.mergedEvolutionOutput);
});
```

- [ ] **Step 2–5: Implement using `runSwarmCell` + `swarmCellRegistry`, verify, commit**

### Worker 3B: Oversoul Budget Router

**Files:**
- Create: `src/harness-sidecar/swarm/oversoulBudgetRouter.js`
- Create: `tests/oversoul-budget-router.test.js`

- [ ] **Step 1: Write failing tests** — advisory budget split across cells using role ecology from `oversoulRuntime.js` patterns.

- [ ] **Step 2–5: Implement evidence-only router, verify, commit**

### Integration Worker 3: Swarm Hot Path

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/server.js`
- Extend: `tests/harness-hierarchical-swarm-integration.test.js`

- [ ] **Step 1: Add feature flag** `features.nestedSwarmCells` / `HELIOS_NESTED_SWARM_CELLS=1`

- [ ] **Step 2: When enabled**, delegate to `orchestrateNestedSwarm` instead of flat attempt list.

- [ ] **Step 3: Enable `localMetaArchive` in runtime swarm flags when nested mode on.

- [ ] **Step 4: Verify integration tests + `npm test`**

- [ ] **Step 5: Commit + mark M2 gate**

**M2 gate:** hierarchical integration test passes with 2+ cells and per-cell `local_meta.completed` events.

---

## Chunk 4: MemGraphRAG Production Path (Milestone M4)

### Worker 4A: Memory Graph Task Bridge

**Files:**
- Create: `src/harness-sidecar/memory/memoryGraphTaskBridge.js`
- Create: `tests/memory-graph-task-bridge.test.js`

- [ ] **Step 1: Write failing tests** — `local_memory.proposed` proposals flow into `memoryGraphRuntime` guarded ingest.

- [ ] **Step 2–5: Implement bridge (feature-gated by `productionCapabilities.modelAssistedMemory`), verify, commit**

### Integration Worker 4: Memory + Swarm Wiring

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js` (local memory handler)
- Modify: `src/harness-sidecar/server.js` (memory promote path)
- Modify: `tests/harness-memgraphrag-construction.test.js`

- [ ] Wire bridge when memory graph feature enabled
- [ ] Verify MemGraphRAG integration tests
- [ ] Update `capabilityGoalStatus` evidence hooks
- [ ] Commit + mark M4 gate

---

## Chunk 5: Meta-Harness Campaign Automation (Milestone M3)

### Worker 5A: Campaign Scheduler

**Files:**
- Create: `src/harness-sidecar/meta/campaignScheduler.js`
- Create: `tests/campaign-scheduler.test.js`

- [ ] **Step 1: Write failing tests** — schedules call `runMetaHarnessCampaign` with isolated workspace, evidence-only output.

- [ ] **Step 2–5: Implement, verify, commit**

### Worker 5B: Recursive Evolution Coordinator

**Files:**
- Create: `src/harness-sidecar/meta/recursiveEvolutionCoordinator.js`
- Create: `tests/recursive-evolution-coordinator.test.js`

- [ ] **Step 1: Write failing tests** — coordinates `runPromotionLoop` + campaign results + replay reports into single evidence envelope (no apply).

- [ ] **Step 2–5: Implement, verify, commit**

### Integration Worker 5: Campaign Hot Path

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `src/harness-sidecar/meta/capabilityGoalStatus.js`
- Extend: `tests/harness-meta-campaign-runner.test.js`

- [ ] Wire campaign scheduler behind `productionCapabilities.sourceTreeVariants`
- [ ] Feed replay cycle reports into campaign candidate scoring
- [ ] Expose campaign status in UI (read-only)
- [ ] Commit + mark M3 gate

**M3 gate:** integration test runs one campaign cycle producing `persisted_campaign_report` evidence ref.

---

## Chunk 6: Paper-Grade Loop Scale (Milestone M5)

Dispatch **parallel Workers 6A–6E** (disjoint files), then **Integration Worker 6**.

### Worker 6A: RHO Production Grouped Rerolls

**Files:**
- Modify: `src/harness-sidecar/rho/groupedRerollRunner.js`
- Create: `tests/harness-rho-production-grouped-reroll.test.js`

- [ ] Production grouped reroll report shape + longitudinal tracker feed

### Worker 6B: BES Live Lane Fusion

**Files:**
- Modify: `src/harness-sidecar/bes/liveBesFusion.js`
- Create: `tests/harness-bes-live-fusion-production.test.js`

- [ ] Wire fusion metadata into lane ordering evidence (feature-gated)

### Worker 6C: MemGraphRAG Provenance Agents

**Files:**
- Modify: `src/harness-sidecar/memory/provenanceResolutionAgents.js`
- Create: `tests/harness-provenance-resolution-agents-production.test.js`

### Worker 6D: Visual Replay Suites

**Files:**
- Modify: `src/harness-sidecar/vlm/visualReplaySuite.js`
- Create: `tests/harness-visual-replay-suite-production.test.js`

### Worker 6E: Model Council Pass@k Production

**Files:**
- Modify: `src/harness-sidecar/evals/modelCouncilPassK.js`
- Create: `tests/harness-model-council-passk-production.test.js`

### Integration Worker 6

- [ ] Wire feature gates in `server.js` + `configLoader.js`
- [ ] Update capability goal status rows
- [ ] `npm test` + mark M5 gate

---

## Chunk 7: Network-of-Networks (Milestone M6)

### Worker 7A: Production A2A Queue Provider

**Files:**
- Create: `src/harness-sidecar/interop/productionQueueProvider.js`
- Create: `tests/a2a-production-queue-provider.test.js`

### Worker 7B: Multi-Hop Lineage Compaction

**Files:**
- Modify: `src/harness-sidecar/interop/a2aLineage.js` (or create if missing)
- Create: `tests/a2a-multi-hop-lineage.test.js`

### Integration Worker 7

- [ ] Wire external peer cycle behind `productionCapabilities.productionA2aTransport`
- [ ] Two-instance integration test (local loopback peers)
- [ ] Mark M6 gate

---

## Chunk 8: Earned Autonomy (Milestone M7)

**Serial only — no parallel workers.**

### Worker 8A: Autonomy Evidence Accumulator

**Files:**
- Create: `src/harness-sidecar/meta/autonomyEvidenceAccumulator.js`
- Create: `tests/autonomy-evidence-accumulator.test.js`

- [ ] Track rollback drill outcomes, replay regression counts, dashboard history depth

### Integration Worker 8

- [ ] Wire `productionAutonomyPolicy` to require accumulator thresholds before L1/L2
- [ ] Default remains L0; widening autonomy requires explicit config + evidence
- [ ] Update governance UI with read-only autonomy dashboard
- [ ] Mark M7 gate

---

## Chunk 9: Final Integration, Docs, And Audit

### Worker 9A: Architecture Doc Sync

**Files:**
- Modify: `docs/architecture/current-architecture.md`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`

- [ ] Update maturity table to reflect wired hot path
- [ ] Check off gap-map items: operator dashboards, held-out improvement

### Worker 9B: Security / Authority Audit Subagent

**Read-only scope:** all Chunk 1–8 changed files

- [ ] Confirm no path bypasses trust kernel on apply
- [ ] Confirm all new stores use workspace root constraints
- [ ] Confirm no `canPromote: true` on autonomous paths

### Final verification

- [ ] `npm test`
- [ ] `npm run release:smoke`
- [ ] Update all checkboxes in this plan
- [ ] `superpowers:finishing-a-development-branch`

---

## Execution Order Summary

```text
Chunk 0 (parallel recon)
  ↓
Chunk 1 (M0 trust) — serial implementers → Integration 1
  ↓
Chunk 2 (M1 scoreboard) — Workers 2A∥2B → Integration 2
  ↓
Chunk 3 (M2 nested swarms) — Workers 3A∥3B → Integration 3
  ↓
Chunk 5 (M3 campaigns) — Workers 5A∥5B → Integration 5   ← campaigns need scoreboard
  ↓
Chunk 4 (M4 MemGraphRAG) — Worker 4A → Integration 4
  ↓
Chunk 6 (M5 paper-grade) — Workers 6A–6E parallel → Integration 6
  ↓
Chunk 7 (M6 A2A network) — Workers 7A∥7B → Integration 7
  ↓
Chunk 8 (M7 autonomy) — serial
  ↓
Chunk 9 (docs + audit)
```

**Note:** Chunk 5 before Chunk 4 is intentional — campaigns consume replay evidence; MemGraphRAG can land in parallel with campaigns but M4 integration is independent.

---

## Controller Quick-Start (Next Session)

To begin execution in a fresh session:

1. `superpowers:using-git-worktrees` — branch `feat/swarm-recursive-evolution`
2. Dispatch **Chunk 0** agents 0A, 0B, 0C in parallel
3. Create TodoWrite entries for Workers 1A → Integration 1
4. Dispatch implementer for **Worker 1A** with full prompt template above
5. Spec review → quality review → Integration Worker 1
6. Continue chunk by chunk; never skip M0 gate

---

## Relationship To Other Plans

| Plan | Relationship |
| --- | --- |
| `2026-06-12-remaining-paper-gaps-parallel-subagents.md` | Chunk 2–6 workers overlap; prefer **this plan's integration wiring** when modules already exist |
| `2026-06-10-production-capability-spine-next-stage.md` | Parent trunk; this plan is the execution spine from audit findings |
| `2026-06-16-standalone-electron-app.md` | Parallel product track; does not block M0–M2 |

---

## Bottom Line

Helios does not need more architecture modules. It needs **wiring**, **measurement**, and **proof**. This plan uses subagents to do that in gated milestones: trust kernel first, scoreboard second, recursion third, then campaigns, memory depth, paper-grade scale, network, and earned autonomy.
