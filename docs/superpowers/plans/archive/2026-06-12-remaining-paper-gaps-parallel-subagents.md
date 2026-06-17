# Remaining Paper Gaps Parallel Subagent Implementation Plan

> **Superseded (2026-06-17):** Execution priority moved to `2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md`. Canonical status: `docs/architecture/2026-06-17-implementation-reconciliation.md`. Keep for module ideas only.

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining paper-alignment gaps that keep Helios Forge at Level 3.9 instead of a Level 4-ready governed network-of-networks harness.

**Architecture:** Keep Helios evidence-first and non-self-authorizing. Parallel workers own independent capability lanes; integration workers serialize shared sidecar, app bridge, UI, docs, and capability-status changes after domain workers land tests. Every new replay, model-assisted, A2A, VLM, council, BES, RHO, Meta-Harness, dashboard, or governance feature must produce replayable evidence and preserve approval, rollback, quarantine, and trust-kernel gates.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules, JSON/JSONL harness artifacts, workspace-root-constrained stores, feature-gated production capabilities, local durable A2A stores, OpenAI-compatible model providers, VLM artifact helpers, trace/status events, and the browser UI.

---

## Current Baseline

Helios Forge currently has the foundation lanes:

- held-out suite manifests;
- model-assisted memory extraction policy;
- RHO embedding provider and replay schedule planner;
- source-tree variant runner;
- visual SwarmCell;
- external A2A transport adapters;
- production autonomy policy;
- feature gates and model-visible quarantine;
- adaptive model router and model council foundations;
- BES lane runtime and evidence envelopes;
- local/global memory graph substrate;
- trust-kernel and approval boundaries.

The remaining blockers are production scale, longitudinal continuity, model/VLM judgment, durable network behavior, operator dashboards, and serial integration.

## Non-Negotiable Boundaries

- Evidence can influence candidate generation, routing, replay, review, dashboards, and operator recommendations.
- Evidence cannot directly apply code, promote candidates, weaken verifier gates, mark external claims verified, or bypass approval.
- External A2A evidence starts `external: true` and `verified: false`.
- Model and VLM judges produce bounded evidence only.
- Candidate source trees stay isolated from the active workspace until safe apply plus approval.
- New stores reject absolute paths, traversal paths, symlink escapes, and model-visible secret-shaped free text.
- All model-visible dashboard/report/A2A/model-assisted fields pass through `src/harness-sidecar/security/modelVisibleQuarantine.js`.

## Controller Responsibilities

- Create a dedicated branch/worktree before implementation.
- Dispatch only read/write-disjoint workers in parallel.
- Keep this plan checklist updated.
- Require each worker to run focused tests and commit only its owned files.
- After each worker: dispatch a spec reviewer, then a code-quality reviewer.
- Run serial integration only after domain workers are green.
- Run final security/authority audit before merge.

## Worker Prompt Prefix

Every worker prompt must start with:

```text
You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve evidence-only authority.
Use TDD: write failing tests first, then implementation, then focused verification.
Return: status, changed files, tests run, commit SHA, remaining concerns.
```

## Shared Integration Chokepoints

Only the serial integration workers may edit these files:

- `src/harness-sidecar/server.js`
- `src/server.js`
- `public/app.js`
- `src/harness-sidecar/config/configLoader.js`
- `src/harness-sidecar/meta/capabilityGoalStatus.js`
- `docs/architecture/current-architecture.md`
- `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- `docs/architecture/paper-implementation-alignment.md`
- `docs/architecture/feature-architecture-map.md`
- this plan file

---

## Chunk 0: Recon And Conflict Map

Run these read-only agents first. They may run in parallel.

### Agent 0A: Replay Dashboard Recon

**Read-only scope:**
- `src/harness-sidecar/benchmarks/*`
- `src/harness-sidecar/rho/*`
- `src/harness-sidecar/meta/*frontier*`
- `src/harness-sidecar/meta/*governance*`
- `tests/*frontier*.test.js`
- `tests/*governance*.test.js`
- `tests/*rho*.test.js`

**Return:** reusable functions, expected report shapes, missing extension points, and test files to extend.

### Agent 0B: Memory BES Meta Recon

**Read-only scope:**
- `src/harness-sidecar/memory/*`
- `src/harness-sidecar/bes/*`
- `src/harness-sidecar/meta/*`
- `tests/harness-memory-*.test.js`
- `tests/harness-bes-*.test.js`
- `tests/harness-meta-*.test.js`

**Return:** smallest extension points for provenance agents, live BES fusion, dense judgment, and harness-of-harnesses optimizer.

### Agent 0C: VLM A2A Council Recon

**Read-only scope:**
- `src/harness-sidecar/vlm/*`
- `src/harness-sidecar/interop/*`
- `src/harness-sidecar/swarm/modelCouncil.js`
- `src/harness-sidecar/model/*`
- `tests/harness-vlm-*.test.js`
- `tests/harness-a2a-*.test.js`
- `tests/harness-model-*.test.js`

**Return:** safest production extensions for visual replay, multimodal budget policy, A2A queue/lineage, debate evidence, calibration, and endpoint capacity.

---

## Chunk 1: Production Replay And Operator Dashboards

### Worker 1: Replay Cycle Runner

**Files:**
- Create: `src/harness-sidecar/benchmarks/replayCycleRunner.js`
- Create: `tests/replay-cycle-runner.test.js`

- [ ] **Step 1: Write failing tests**

Cover baseline/candidate replay aggregation, quarantine blocks, deterministic report IDs, rollback-drill requirements, budget accounting, and evidence-only output.

Example:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReplayCycle } from '../src/harness-sidecar/benchmarks/replayCycleRunner.js';

test('replay cycle reports are evidence-only and cannot promote candidates', async () => {
  const suite = {
    id: 'code-smoke',
    domains: ['code'],
    cases: [{ id: 'case-1', domain: 'code', metricWeights: { quality: 1 } }],
  };
  const report = await runReplayCycle({
    suite,
    candidates: [{ id: 'candidate-a' }],
    baselineRunner: async () => ({ metrics: { quality: 0.5 }, passed: true }),
    candidateRunner: async () => ({ metrics: { quality: 0.8 }, passed: true }),
    budget: { maxCases: 10, maxCost: 100 },
    now: () => new Date('2026-06-12T00:00:00.000Z'),
  });

  assert.equal(report.promotionEvidenceOnly, true);
  assert.equal(report.canPromote, false);
  assert.equal(report.suiteId, 'code-smoke');
  assert.ok(report.aggregateScore > 0);
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\replay-cycle-runner.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal replay cycle runner**

Required API:

```js
export async function runReplayCycle({
  suite,
  candidates = [],
  baselineRunner,
  candidateRunner,
  budget = {},
  now = () => new Date(),
} = {}) {}
```

Output:

```js
{
  reportId,
  suiteId,
  candidateIds,
  domainScores,
  aggregateScore,
  regressions,
  quarantineBlocks,
  rollbackDrillRequired,
  budget,
  promotionEvidenceOnly: true,
  canPromote: false
}
```

- [ ] **Step 4: Verify focused tests**

Run: `node --test tests\replay-cycle-runner.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\benchmarks\replayCycleRunner.js tests\replay-cycle-runner.test.js
git commit -m "feat: add production replay cycle runner"
```

### Worker 2: Operator Dashboard Store

**Files:**
- Create: `src/harness-sidecar/meta/operatorDashboardStore.js`
- Create: `tests/operator-dashboard-store.test.js`

- [ ] **Step 1: Write failing tests**

Cover snapshot normalization, recursive redaction, persistence under `.harness/dashboards/operator`, deterministic listing, and no apply/promote authority.

Required API:

```js
export function buildOperatorDashboardSnapshot({
  frontier,
  governance,
  memory,
  visual,
  trust,
  swarm,
  rho,
  router,
  now,
} = {}) {}

export function createOperatorDashboardStore({ workspaceRoot, fsImpl } = {}) {}
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\operator-dashboard-store.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement store**

Implementation requirements:
- route model-visible fields through `quarantineModelVisibleValue`;
- write only under `.harness/dashboards/operator`;
- include `evidenceOnly: true` and `canPromote: false`;
- reject path traversal in snapshot IDs.

- [ ] **Step 4: Verify focused tests**

Run: `node --test tests\operator-dashboard-store.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\meta\operatorDashboardStore.js tests\operator-dashboard-store.test.js
git commit -m "feat: persist operator dashboard snapshots"
```

---

## Chunk 2: Memory Graph RAG At Paper Scale

### Worker 3: Guarded Provenance Resolution Agents

**Files:**
- Create: `src/harness-sidecar/memory/provenanceResolutionAgents.js`
- Modify: `src/harness-sidecar/memory/memoryConflictResolver.js`
- Create: `tests/harness-memory-provenance-resolution-agents.test.js`

- [ ] **Step 1: Write failing tests**

Cover `supported`, `contradicted`, `conflicted`, `insufficient_evidence`, stale source handling, missing provenance rejection, secret/path redaction, and deterministic fallback preservation.

Required output:

```js
{
  verdict: 'supported' | 'contradicted' | 'conflicted' | 'insufficient_evidence',
  confidence,
  provenanceRefs,
  modelEvidenceOnly: true,
  promotionAllowed: false,
  reasons,
}
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-memory-provenance-resolution-agents.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement resolver agents**

Required API:

```js
export function normalizeResolutionEvidence(input, { knownProvenanceRefs = [] } = {}) {}
export async function runProvenanceResolutionAgents({
  conflict,
  provenancePassages,
  modelResolver,
  policy,
} = {}) {}
```

- [ ] **Step 4: Wire conflict resolver**

Preserve current deterministic resolver behavior when no guarded evidence is supplied.

- [ ] **Step 5: Verify focused tests**

Run:

```powershell
node --test tests\harness-memory-provenance-resolution-agents.test.js
node --test tests\harness-memory-conflict-resolver.test.js
```

- [ ] **Step 6: Commit**

```powershell
git add src\harness-sidecar\memory\provenanceResolutionAgents.js src\harness-sidecar\memory\memoryConflictResolver.js tests\harness-memory-provenance-resolution-agents.test.js
git commit -m "feat: add guarded memory provenance resolution agents"
```

### Worker 4: Memory Eval Suite Expansion

**Files:**
- Modify: `src/harness-sidecar/memory/memoryEvals.js`
- Create: `tests/harness-memory-eval-suite-scale.test.js`

- [ ] **Step 1: Write failing tests**

Cover active fact precision, conflict quality, provenance coverage, connectivity, retrieval hit rate, budget efficiency, migration health, decay/consolidation health, and visual evidence coverage.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-memory-eval-suite-scale.test.js`

- [ ] **Step 3: Implement eval metrics**

All outputs must be evidence-only and suitable for dashboards.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-memory-eval-suite-scale.test.js
node --test tests\harness-memory-evals.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\memory\memoryEvals.js tests\harness-memory-eval-suite-scale.test.js
git commit -m "feat: expand memory graph eval metrics"
```

---

## Chunk 3: RHO At Paper Scale

### Worker 5: Production Grouped RHO Rerolls

**Files:**
- Modify: `src/harness-sidecar/rho/replayBatchRunner.js`
- Create: `src/harness-sidecar/rho/groupedRerollRunner.js`
- Create: `tests/harness-rho-grouped-reroll-runner.test.js`

- [ ] **Step 1: Write failing tests**

Cover grouped baseline/candidate rerolls, domain coverage, quarantine exclusion from promotion evidence, aggregate self-validation/self-consistency/self-preference, and future-hard-case emission for failures.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-rho-grouped-reroll-runner.test.js`

- [ ] **Step 3: Implement grouped reroll runner**

Required API:

```js
export async function runGroupedRhoRerolls({
  schedule,
  baseline,
  candidateFamilies,
  caseRunner,
  judges,
  now,
} = {}) {}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-rho-grouped-reroll-runner.test.js
node --test tests\harness-rho-replay-batch.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\rho\groupedRerollRunner.js src\harness-sidecar\rho\replayBatchRunner.js tests\harness-rho-grouped-reroll-runner.test.js
git commit -m "feat: add grouped RHO reroll evidence"
```

### Worker 6: Longitudinal RHO Improvement Tracker

**Files:**
- Create: `src/harness-sidecar/rho/longitudinalImprovementTracker.js`
- Create: `tests/harness-rho-longitudinal-improvement.test.js`

- [ ] **Step 1: Write failing tests**

Cover promoted candidate follow-up, old-suite regression tracking, domain-specific drift, budget accounting, and dashboard-ready trend rows.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-rho-longitudinal-improvement.test.js`

- [ ] **Step 3: Implement tracker**

Required API:

```js
export function updateRhoImprovementHistory({ history, replayReport, promotedCandidate, now } = {}) {}
export function summarizeRhoImprovementTrends(history = []) {}
```

- [ ] **Step 4: Verify focused tests**

Run: `node --test tests\harness-rho-longitudinal-improvement.test.js`

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\rho\longitudinalImprovementTracker.js tests\harness-rho-longitudinal-improvement.test.js
git commit -m "feat: track longitudinal RHO improvement"
```

---

## Chunk 4: Meta-Harness Autonomous Outer Loop

### Worker 7: Harness-Of-Harnesses Optimizer

**Files:**
- Create: `src/harness-sidecar/meta/harnessOfHarnessesOptimizer.js`
- Create: `tests/harness-of-harnesses-optimizer.test.js`

- [ ] **Step 1: Write failing tests**

Cover optimizer candidates for `rho`, `bes`, `meta`, `router`, `visual`, and `memory`; immutable promotion policy; evidence-only output; pareto metrics; and blocked self-approval.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-of-harnesses-optimizer.test.js`

- [ ] **Step 3: Implement optimizer evidence**

Required output:

```js
{
  optimizerCandidateId,
  parentOptimizerId,
  targetOptimizer,
  evidence,
  paretoMetrics,
  evidenceOnly: true,
  canPromote: false,
}
```

- [ ] **Step 4: Verify focused tests**

Run: `node --test tests\harness-of-harnesses-optimizer.test.js`

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\meta\harnessOfHarnessesOptimizer.js tests\harness-of-harnesses-optimizer.test.js
git commit -m "feat: add harness-of-harnesses optimizer evidence"
```

### Worker 8: Autonomous Meta-Harness Campaign Runner

**Files:**
- Create: `src/harness-sidecar/meta/metaHarnessCampaignRunner.js`
- Modify: `src/harness-sidecar/meta/harnessExperimentRunner.js`
- Create: `tests/harness-meta-campaign-runner.test.js`

- [ ] **Step 1: Write failing tests**

Cover repeated propose/evaluate/log/propose cycles, isolated source-tree variants, Pareto frontier updates, replay report capture, and no active workspace mutation.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-meta-campaign-runner.test.js`

- [ ] **Step 3: Implement campaign runner**

Required API:

```js
export async function runMetaHarnessCampaign({
  campaign,
  proposer,
  evaluator,
  variantRunner,
  frontier,
  maxCycles,
  now,
} = {}) {}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-meta-campaign-runner.test.js
node --test tests\harness-meta-experiment-runs.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\meta\metaHarnessCampaignRunner.js src\harness-sidecar\meta\harnessExperimentRunner.js tests\harness-meta-campaign-runner.test.js
git commit -m "feat: add autonomous meta-harness campaign runner"
```

---

## Chunk 5: Full BES Semantics Across Every Lane

### Worker 9: Live BES Fusion

**Files:**
- Create: `src/harness-sidecar/bes/liveBesFusion.js`
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Create: `tests/harness-bes-live-fusion.test.js`

- [ ] **Step 1: Write failing tests**

Cover forward/backward candidate ordering, adaptive action influence, dense score weighting, trajectory operator provenance, compatible-family metadata, and evidence-only lane output.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-bes-live-fusion.test.js`

- [ ] **Step 3: Implement live fusion**

Required API:

```js
export function fuseLiveBesLane({
  forwardCandidates,
  backwardGoals,
  denseScores,
  adaptiveAction,
  trajectoryOperators,
} = {}) {}
```

- [ ] **Step 4: Wire lane runtime**

Preserve existing public lane output shape and keep `promotionAllowed: false`.

- [ ] **Step 5: Verify focused tests**

Run:

```powershell
node --test tests\harness-bes-live-fusion.test.js
node --test tests\harness-bes-lane-runtime.test.js
```

- [ ] **Step 6: Commit**

```powershell
git add src\harness-sidecar\bes\liveBesFusion.js src\harness-sidecar\bes\laneRuntime.js tests\harness-bes-live-fusion.test.js
git commit -m "feat: fuse BES decisions into live lanes"
```

### Worker 10: Model-Assisted Dense Judgment

**Files:**
- Create: `src/harness-sidecar/bes/modelAssistedDenseJudgment.js`
- Modify: `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- Create: `tests/harness-bes-model-assisted-judgment.test.js`

- [ ] **Step 1: Write failing tests**

Cover disabled-by-default behavior, evidence-only enabled behavior, provenance requirements, bounded confidence, deterministic fallback, and quarantine of model-visible text.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-bes-model-assisted-judgment.test.js`

- [ ] **Step 3: Implement dense judgment**

Required API:

```js
export async function judgeDenseSubgoalWithModel({
  subgoal,
  evidence,
  modelProvider,
  policy,
} = {}) {}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-bes-model-assisted-judgment.test.js
node --test tests\harness-bidirectional-bes.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\bes\modelAssistedDenseJudgment.js src\harness-sidecar\bes\denseSubgoalVerifier.js tests\harness-bes-model-assisted-judgment.test.js
git commit -m "feat: add model-assisted BES dense judgment"
```

---

## Chunk 6: Multimodal And VLM Production Loop

### Worker 11: Visual Replay Suites And Frontier

**Files:**
- Create: `src/harness-sidecar/vlm/visualReplaySuite.js`
- Create: `src/harness-sidecar/meta/visualFrontier.js`
- Modify: `src/harness-sidecar/meta/visualPolicyEvolution.js`
- Create: `tests/harness-visual-replay-suite.test.js`
- Create: `tests/harness-visual-frontier.test.js`

- [ ] **Step 1: Write failing tests**

Cover UI/PDF/OCR/chart/diagram case normalization, artifact hashes, visual metric aggregation, failed-evidence blocking, frontier updates, and RHO/BES hard-case output.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests\harness-visual-replay-suite.test.js
node --test tests\harness-visual-frontier.test.js
```

- [ ] **Step 3: Implement visual replay and frontier**

Outputs must include `visualEvidenceRequired: true`, `evidenceOnly: true`, and `canPromote: false`.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-visual-replay-suite.test.js
node --test tests\harness-visual-frontier.test.js
node --test tests\harness-vlm-production.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\vlm\visualReplaySuite.js src\harness-sidecar\meta\visualFrontier.js src\harness-sidecar\meta\visualPolicyEvolution.js tests\harness-visual-replay-suite.test.js tests\harness-visual-frontier.test.js
git commit -m "feat: add visual replay suites and frontier"
```

### Worker 12: Multimodal Budget Policy

**Files:**
- Modify: `src/harness-sidecar/model/multimodalRequestBuilder.js`
- Modify: `src/harness-sidecar/vlm/visualContextPolicy.js`
- Create: `tests/harness-multimodal-budget-policy.test.js`

- [ ] **Step 1: Write failing tests**

Cover text-only fallback, VLM-required tasks, budget exhaustion, optional VLM use, adaptive-search feedback, and model endpoint image-capability checks.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-multimodal-budget-policy.test.js`

- [ ] **Step 3: Implement policy**

Required result:

```js
{
  mode: 'text_only' | 'vlm_required' | 'vlm_optional',
  budgetCost,
  reasons,
  adaptiveSearchEvidence,
  evidenceOnly: true,
}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-multimodal-budget-policy.test.js
node --test tests\harness-vlm-native.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\model\multimodalRequestBuilder.js src\harness-sidecar\vlm\visualContextPolicy.js tests\harness-multimodal-budget-policy.test.js
git commit -m "feat: add multimodal request budget policy"
```

---

## Chunk 7: Durable A2A Network Behavior

### Worker 13: A2A Production Queue And Issuer Secret Providers

**Files:**
- Create: `src/harness-sidecar/interop/a2aQueueProvider.js`
- Create: `src/harness-sidecar/interop/a2aIssuerSecretProvider.js`
- Modify: `src/harness-sidecar/interop/a2aDurableStore.js`
- Modify: `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
- Create: `tests/harness-a2a-production-queue.test.js`

- [ ] **Step 1: Write failing tests**

Cover provider contracts, JSON fallback, restart hydration, root constraints, secret redaction, stable issuer secret lookup, token verification, and no model-visible secret leakage.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-a2a-production-queue.test.js`

- [ ] **Step 3: Implement providers**

Required APIs:

```js
export function createA2aQueueProvider({ adapter, durableStore } = {}) {}
export function createIssuerSecretProvider({ env, secretStore, fallback } = {}) {}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-a2a-production-queue.test.js
node --test tests\harness-a2a-transport.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\interop\a2aQueueProvider.js src\harness-sidecar\interop\a2aIssuerSecretProvider.js src\harness-sidecar\interop\a2aDurableStore.js src\harness-sidecar\interop\delegatedCapabilityTokens.js tests\harness-a2a-production-queue.test.js
git commit -m "feat: add A2A production queue providers"
```

### Worker 14: Multi-Hop A2A Lineage

**Files:**
- Create: `src/harness-sidecar/interop/a2aMultiHopLineage.js`
- Modify: `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- Create: `tests/harness-a2a-multihop-lineage.test.js`

- [ ] **Step 1: Write failing tests**

Cover parent/root/message lineage, agent -> SwarmCell -> swarm -> local harness -> global harness hops, cycle rejection, trust metadata requirements, and dashboard compaction.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-a2a-multihop-lineage.test.js`

- [ ] **Step 3: Implement lineage helper**

Required API:

```js
export function appendA2aLineageHop({ lineage, hop } = {}) {}
export function compactA2aLineageForDashboard(lineage = []) {}
```

- [ ] **Step 4: Wire envelope metadata**

Preserve existing A2A envelope shape and reject verified escalation.

- [ ] **Step 5: Verify focused tests**

Run:

```powershell
node --test tests\harness-a2a-multihop-lineage.test.js
node --test tests\harness-agent-interop.test.js
```

- [ ] **Step 6: Commit**

```powershell
git add src\harness-sidecar\interop\a2aMultiHopLineage.js src\harness-sidecar\interop\a2aSwarmEnvelope.js tests\harness-a2a-multihop-lineage.test.js
git commit -m "feat: preserve multi-hop A2A lineage"
```

---

## Chunk 8: Multi-Model Council Intelligence

### Worker 15: Bounded Model Debate Evidence

**Files:**
- Create: `src/harness-sidecar/swarm/modelDebateEvidence.js`
- Modify: `src/harness-sidecar/swarm/modelCouncil.js`
- Create: `tests/harness-model-debate-evidence.test.js`

- [ ] **Step 1: Write failing tests**

Cover debate prompts, critique outputs, disagreement summaries, bounded confidence, quarantine, and negative fields: `canPromote`, `approved`, `apply`, `verified`, and verifier bypass.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-debate-evidence.test.js`

- [ ] **Step 3: Implement debate evidence**

Required shape:

```js
{
  debateId,
  taskId,
  participants,
  claims,
  critiques,
  agreement,
  disagreement,
  confidence,
  evidenceOnly: true,
  canPromote: false,
}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-model-debate-evidence.test.js
node --test tests\harness-model-council.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\swarm\modelDebateEvidence.js src\harness-sidecar\swarm\modelCouncil.js tests\harness-model-debate-evidence.test.js
git commit -m "feat: add bounded model debate evidence"
```

### Worker 16: Production Pass@K And Ensemble Calibration

**Files:**
- Modify: `src/harness-sidecar/evals/modelCouncilPassK.js`
- Create: `src/harness-sidecar/model/ensembleCalibration.js`
- Create: `tests/harness-model-council-production-passk.test.js`
- Create: `tests/harness-model-ensemble-calibration.test.js`

- [ ] **Step 1: Write failing tests**

Cover held-out suite-backed pass@k, best-single, repeated-single, static-council, adaptive-router, calibrated ensemble, minimum case counts, confidence intervals, regressions, and inability to rewrite router defaults.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests\harness-model-council-production-passk.test.js
node --test tests\harness-model-ensemble-calibration.test.js
```

- [ ] **Step 3: Implement calibration**

Required output:

```js
{
  calibrationId,
  suiteId,
  modelWeights,
  confidenceIntervals,
  regressions,
  evidenceOnly: true,
  recommendedForPromotion: false,
}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-model-council-production-passk.test.js
node --test tests\harness-model-ensemble-calibration.test.js
node --test tests\harness-model-council-passk.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\evals\modelCouncilPassK.js src\harness-sidecar\model\ensembleCalibration.js tests\harness-model-council-production-passk.test.js tests\harness-model-ensemble-calibration.test.js
git commit -m "feat: calibrate model council ensemble evidence"
```

### Worker 17: Endpoint Capacity And Router Health Policy

**Files:**
- Create: `src/harness-sidecar/model/endpointCapacityPolicy.js`
- Modify: `src/harness-sidecar/model/modelEndpointProfiles.js`
- Modify: `src/harness-sidecar/model/vllmHealthController.js`
- Create: `tests/harness-endpoint-capacity-policy.test.js`

- [ ] **Step 1: Write failing tests**

Cover degraded endpoints, missing specialist models, cost ceilings, latency ceilings, disabled auto-procurement, VLM image capability mismatch, and recommendation-only output.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-endpoint-capacity-policy.test.js`

- [ ] **Step 3: Implement policy**

Required API:

```js
export function recommendEndpointCapacityActions({
  endpoints,
  routerHealth,
  policy,
  budget,
} = {}) {}
```

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-endpoint-capacity-policy.test.js
node --test tests\harness-vllm-health.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\model\endpointCapacityPolicy.js src\harness-sidecar\model\modelEndpointProfiles.js src\harness-sidecar\model\vllmHealthController.js tests\harness-endpoint-capacity-policy.test.js
git commit -m "feat: recommend model endpoint capacity actions"
```

---

## Chunk 9: Governance And Autonomy Hardening

### Worker 18: Production Governance Tables And Rollback Drills

**Files:**
- Modify: `src/harness-sidecar/meta/productionAutonomyPolicy.js`
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Create: `src/harness-sidecar/meta/rollbackDrillRunner.js`
- Create: `tests/harness-governance-production-tables.test.js`
- Create: `tests/harness-rollback-drill-runner.test.js`

- [ ] **Step 1: Write failing tests**

Cover candidate-type autonomy tables, approval narrowing eligibility, high-risk escalation, override audit, rollback drills, external evidence policy, VLM-required policy, and inability to bypass trust kernel.

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests\harness-governance-production-tables.test.js
node --test tests\harness-rollback-drill-runner.test.js
```

- [ ] **Step 3: Implement governance hardening**

Rollback drill output must include `evidenceOnly: true`, `rollbackVerified`, `blockers`, and `canPromote: false`.

- [ ] **Step 4: Verify focused tests**

Run:

```powershell
node --test tests\harness-governance-production-tables.test.js
node --test tests\harness-rollback-drill-runner.test.js
node --test tests\harness-production-autonomy-policy.test.js
node --test tests\harness-authority-boundary-integration.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\meta\productionAutonomyPolicy.js src\harness-sidecar\meta\governanceLoop.js src\harness-sidecar\meta\rollbackDrillRunner.js tests\harness-governance-production-tables.test.js tests\harness-rollback-drill-runner.test.js
git commit -m "feat: harden production governance and rollback drills"
```

---

## Chunk 10: Serial Server, App, UI, And Status Integration

Run only after Workers 1-18 are complete and reviewed.

### Worker 19: Sidecar Endpoint Integration

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Create or modify focused sidecar tests as needed.

- [x] **Step 1: Write failing tests**

Add endpoints for:
- held-out suites;
- replay cycle reports;
- operator dashboard snapshots;
- visual suite reports;
- A2A transport/queue status;
- model council calibration reports;
- endpoint capacity recommendations;
- autonomy and rollback summaries.

- [x] **Step 2: Run failing tests**

Run focused sidecar tests identified by Agent 0A/0C.

- [x] **Step 3: Implement feature-gated endpoints**

All endpoints must be read/evidence/reporting oriented. No apply/promote actions.

- [x] **Step 4: Verify**

Run:

```powershell
node --test tests\harness-sidecar.test.js
node --test tests\harness-production-feature-gates.test.js
```

- [x] **Step 5: Commit**

```powershell
git add src\harness-sidecar\server.js tests
git commit -m "feat: expose production organism evidence endpoints"
```

### Worker 20: App Bridge And UI Integration

**Files:**
- Modify: `src/server.js`
- Modify: `public/app.js`
- Modify: `tests/harness-ui-discoverability.test.js`
- Create or modify bridge tests as needed.

- [x] **Step 1: Write failing tests**

Cover WebSocket commands with `harness_*` naming, UI sections for replay/dashboard/A2A/visual/council/autonomy evidence, and absence of apply/promote controls.

- [x] **Step 2: Run failing tests**

Run:

```powershell
node --test tests\harness-ui-discoverability.test.js
```

- [x] **Step 3: Implement bridge/UI**

Keep sections disabled/hidden unless feature gates are enabled. Keep text compact and operational.

- [x] **Step 4: Verify**

Run:

```powershell
node --test tests\harness-ui-discoverability.test.js
npm run release:smoke
```

- [x] **Step 5: Commit**

```powershell
git add src\server.js public\app.js tests\harness-ui-discoverability.test.js
git commit -m "feat: surface production evidence dashboards"
```

### Worker 21: Capability Status And Docs Integration

**Files:**
- Modify: `src/harness-sidecar/meta/capabilityGoalStatus.js`
- Modify: `docs/architecture/current-architecture.md`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Modify: `docs/architecture/paper-implementation-alignment.md`
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/superpowers/plans/2026-06-12-remaining-paper-gaps-parallel-subagents.md`
- Test: `tests/harness-capability-goal-status.test.js`

- [x] **Step 1: Write failing status tests**

Capability rows must distinguish:
- implemented substrate;
- production-gated capability;
- production-evidence available;
- still-future paper-grade autonomy.

- [x] **Step 2: Run failing test**

Run: `node --test tests\harness-capability-goal-status.test.js`

- [x] **Step 3: Update docs and status rows**

Do not claim proven Level 4 until repeated production-sized cycles have persisted dashboard evidence.

- [x] **Step 4: Verify**

Run:

```powershell
node --test tests\harness-capability-goal-status.test.js
```

- [x] **Step 5: Commit**

```powershell
git add src\harness-sidecar\meta\capabilityGoalStatus.js docs\architecture docs\superpowers\plans\2026-06-12-remaining-paper-gaps-parallel-subagents.md tests\harness-capability-goal-status.test.js
git commit -m "docs: update remaining paper gap capability status"
```

---

## Chunk 11: Final Verification And Audit

### Controller Task: Merge And Reconcile

- [ ] Inspect every worker summary and commit.
- [ ] Confirm workers only touched owned files.
- [ ] Resolve conflicts only in shared integration files.
- [ ] Run focused tests for every lane.
- [ ] Confirm no feature gate default was changed to unsafe/on-by-default.

### Controller Task: Full Verification

Run:

```powershell
git diff --check
npm test
npm run release:smoke
```

Expected:
- `git diff --check`: no whitespace errors.
- `npm test`: all tests pass, only intentional skips.
- `npm run release:smoke`: passes.

### Controller Task: Security And Authority Audit

Run:

```powershell
node --test tests\harness-authority-boundary-integration.test.js
node --test tests\harness-model-visible-quarantine.test.js
node --test tests\harness-a2a-transport.test.js
node --test tests\harness-production-autonomy-policy.test.js
node --test tests\harness-production-feature-gates.test.js
```

Inspect:

```powershell
rg -n "canPromote|promote|apply|approved|verified|external|secret|token|issuer|quarantine|rollback|safeApply|approval" src tests docs
```

Confirm:
- model-assisted evidence cannot promote memory or code;
- external A2A evidence remains unverified by default;
- VLM-required policy blocks visual-impacting promotion when visual evidence is missing;
- replay/dashboard/council outputs are evidence-only;
- endpoint capacity policy recommends only;
- no dashboard exposes apply/promote controls;
- model-visible fields use quarantine/redaction.

### Controller Task: Browser Smoke

- [ ] Start the local app.
- [ ] Open `http://127.0.0.1:<port>/`.
- [ ] Confirm `#app` renders.
- [ ] Confirm dashboard sections render without console errors.
- [ ] Confirm disabled feature gates do not expose apply/promote buttons.
- [ ] Confirm fixture evidence reports render.

### Controller Task: Final Code Review

Dispatch final reviewer:

```text
Review the full implementation against docs/superpowers/plans/2026-06-12-remaining-paper-gaps-parallel-subagents.md.
Focus on trust-kernel violations, evidence-only boundaries, unsafe filesystem paths, model-visible secret leaks, missing tests, unsafe feature-gate defaults, UI apply/promote controls, and overstated docs.
Return findings ordered by severity with exact file/line references.
```

- [ ] Fix all actionable findings.
- [ ] Re-run focused tests for fixes.
- [ ] Use superpowers:finishing-a-development-branch.

---

## Parallel Schedule

### Round 0: Recon

Parallel:
- Agent 0A: Replay Dashboard Recon
- Agent 0B: Memory BES Meta Recon
- Agent 0C: VLM A2A Council Recon

### Round 1: Independent Domain Workers

Parallel:
- Worker 1: Replay Cycle Runner
- Worker 2: Operator Dashboard Store
- Worker 3: Guarded Provenance Resolution Agents
- Worker 4: Memory Eval Suite Expansion
- Worker 5: Production Grouped RHO Rerolls
- Worker 6: Longitudinal RHO Improvement Tracker
- Worker 7: Harness-Of-Harnesses Optimizer
- Worker 11: Visual Replay Suites And Frontier
- Worker 13: A2A Queue And Issuer Providers
- Worker 15: Bounded Model Debate Evidence
- Worker 17: Endpoint Capacity Policy
- Worker 18: Governance Tables And Rollback Drills

### Round 2: Dependent Domain Workers

Parallel after Round 1 reviews pass:
- Worker 8: Meta-Harness Campaign Runner
- Worker 9: Live BES Fusion
- Worker 10: Model-Assisted Dense Judgment
- Worker 12: Multimodal Budget Policy
- Worker 14: Multi-Hop A2A Lineage
- Worker 16: Pass@K And Ensemble Calibration

### Round 3: Serial Integration

Sequential:
- Worker 19: Sidecar Endpoint Integration
- Worker 20: App Bridge And UI Integration
- Worker 21: Capability Status And Docs Integration

### Round 4: Final Verification

Sequential:
- full test suite;
- release smoke;
- browser smoke;
- security/authority audit;
- final code review;
- branch finishing.

## Acceptance Criteria

This plan is complete when:

- replay cycles produce evidence-only production reports;
- operator dashboards persist longitudinal health snapshots;
- memory provenance resolution agents exist and are gated/evidence-only;
- memory eval suites cover production-scale metrics;
- RHO runs grouped rerolls and tracks improvement longitudinally;
- Meta-Harness campaigns run repeated propose/evaluate/log cycles over isolated source variants;
- harness-of-harnesses optimizer candidates exist as evidence-only outputs;
- BES live fusion changes candidate ordering while preserving non-promotion authority;
- model-assisted dense judgment is disabled by default and evidence-only when enabled;
- visual replay suites and visual frontier exist;
- multimodal budget policy chooses text/VLM modes and emits adaptive-search evidence;
- A2A production queue and issuer secret providers exist;
- multi-hop A2A lineage survives nested flows;
- model debate evidence is bounded and evidence-only;
- production pass@k and ensemble calibration use held-out suite manifests;
- endpoint capacity policy recommends actions only;
- production governance tables, rollback drills, audit, and override behavior are tested;
- sidecar/app/UI surfaces all new evidence without apply/promote authority;
- docs and capability status distinguish implemented substrate from production-gated capability and still-future autonomy;
- repeated held-out replay cycles can produce persisted dashboard evidence.

## Expected Maturity After Completion

After this plan lands and passes verification, Helios can be described as:

```text
Level 4-ready candidate: a production-gated network-of-networks harness substrate
with durable evidence loops, persistent operator dashboards, external A2A durability,
model/VLM judgment, isolated harness-of-harnesses campaigns, and strict
non-self-authorizing governance.
```

Do not call Helios proven Level 4 until repeated production-sized held-out cycles show improvement over time. Do not call it Level 5 until sustained real-world autonomous research improvement is demonstrated under stable benchmarks and operator-reviewed governance.
