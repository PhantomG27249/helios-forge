# Paper Alignment Gap Subagent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use focused subagents to close the remaining paper-alignment gaps that keep Helios Forge at Level 3.9 instead of a Level 4-ready network-of-networks harness candidate and eventual Level 5 governed research organism.

**Architecture:** Keep Helios evidence-first and non-self-authorizing. Parallel workers implement independent capability lanes, while one integration worker serializes shared server/UI/config wiring after the lanes have tests. Every new model-assisted, A2A, VLM, RHO, BES, or meta-harness feature must produce replayable evidence and must preserve approval, rollback, quarantine, and trust-kernel gates.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules, JSON/JSONL harness artifacts, workspace-root-constrained stores, local durable A2A queues, OpenAI-compatible model providers, VLM artifact helpers, existing trace/status events, and the browser UI.

---

## Current Baseline

Helios Forge is currently a **Level 3.9 self-improving swarm harness**:

- BES lane envelopes exist across major local lanes.
- RHO hard cases, grouped replay, self-validation, self-consistency, and self-preference evidence exist.
- Meta-harness variant directories, run artifacts, frontier records, and promotion blockers exist.
- Memory Graph RAG has guarded extraction/adjudication, migrations, decay, consolidation, and eval hooks.
- Visual/VLM evidence can enter memory, RHO, BES, A2A-compatible envelopes, and trust gates.
- A2A has local durable inbox/outbox, endpoint registry, negotiation envelopes, streaming metadata, and scoped delegated trust.
- Multi-model council plus adaptive model router can record Thompson posterior state, rewards, AB-MCTS model-choice evidence, router RHO/meta hard cases, A2A model negotiation, and pass@k reports.

The remaining gaps are production scale, continuity, durable network behavior, model-assisted judgment, and operator-visible governance.

## Non-Negotiable Boundaries

All subagents must preserve these rules:

- Evidence can influence candidate generation, routing, replay, review, and dashboards.
- Evidence cannot directly apply code, promote candidates, weaken verifier gates, or bypass approval.
- External A2A evidence starts as unverified and quarantined until explicitly validated.
- Model/VLM judges produce bounded evidence, not authority.
- Candidate source trees stay isolated from the active workspace until an approved apply path is used.
- New stores must reject absolute paths, traversal paths, symlink escapes, and secret-shaped free text where model-visible.
- Every new model-visible dashboard, report, A2A envelope, model-assisted output, and MCP-adjacent field must pass shared quarantine/redaction checks before it can be emitted.

## Subagent Operating Model

### Controller Responsibilities

The controller agent owns:

- branch/worktree setup;
- assigning disjoint write scopes;
- keeping one checklist in the plan file updated;
- integrating shared `src/harness-sidecar/server.js`, `src/server.js`, `public/app.js`, and docs changes after domain workers finish;
- running full verification;
- dispatching reviewer agents after each wave.

### Worker Rules

Every worker prompt must include:

```text
You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow the existing Helios Forge patterns. Preserve evidence-only authority.
Return: status, changed files, tests run, remaining concerns.
```

### Review Rules

After each implementation worker returns:

1. Dispatch a **spec reviewer** with the task text and changed-file list.
2. If the spec reviewer finds issues, send the same worker back to fix only those issues.
3. Dispatch a **code quality reviewer** after spec compliance passes.
4. If quality issues remain, send the worker back with focused fix instructions.
5. Mark the task complete only after tests and both reviews pass.

### Parallelization Rule

Run workers in parallel only when their write sets are disjoint. The following files are shared integration chokepoints and must be handled serially by Worker 20, Worker 21, or Worker 22:

- `src/harness-sidecar/server.js`
- `src/server.js`
- `public/app.js`
- `src/harness-sidecar/config/configLoader.js`
- `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- `docs/architecture/feature-architecture-map.md`

---

## Dispatch Wave 0: Recon And Test Map

### Agent 0A: Benchmark And Frontier Recon

**Agent type:** explorer

**Question:** Identify the current benchmark, replay, frontier, governance, and dashboard modules that should be reused for production held-out suites and longitudinal dashboards.

**Read-only scope:**
- `src/harness-sidecar/meta/*`
- `src/harness-sidecar/evals/*`
- `tests/harness-longitudinal-frontier.test.js`
- `tests/harness-governance-loop.test.js`
- `tests/harness-budget-dashboard.test.js`

**Return:**
- exact reusable functions/classes;
- missing extension points;
- test files that should be extended.

### Agent 0B: Memory/RHO/BES Recon

**Agent type:** explorer

**Question:** Identify the smallest extension points for model-assisted memory extraction/resolution, RHO embedding/replay scale, and live BES dense judgment without breaking deterministic fallback tests.

**Read-only scope:**
- `src/harness-sidecar/memory/*`
- `src/harness-sidecar/rho/*`
- `src/harness-sidecar/bes/*`
- `tests/harness-memory-*.test.js`
- `tests/harness-rho-*.test.js`
- `tests/harness-bes-*.test.js`

**Return:**
- exact extension points;
- fallback behavior to preserve;
- files likely to conflict.

### Agent 0C: A2A/VLM/Governance Recon

**Agent type:** explorer

**Question:** Identify the safest path from local durable A2A and VLM evidence to production transport, visual swarm cell, and policy-gated governance.

**Read-only scope:**
- `src/harness-sidecar/interop/*`
- `src/harness-sidecar/vlm/*`
- `src/harness-sidecar/meta/governanceLoop.js`
- `src/harness-sidecar/meta/promotionPolicy.js`
- `tests/harness-a2a-*.test.js`
- `tests/harness-vlm-*.test.js`
- `tests/harness-meta-promotion*.test.js`

**Return:**
- exact extension points;
- trust risks;
- test coverage gaps.

---

## Chunk 1: Production Benchmark Spine And Longitudinal Dashboards

### Worker 1: Stable Held-Out Suite Store

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/benchmarks/heldOutSuiteSchema.js`
- Create: `src/harness-sidecar/benchmarks/heldOutSuiteStore.js`
- Create: `tests/held-out-suite-store.test.js`

**Goal:** Add root-constrained, schema-validated held-out benchmark suite manifests.

- [ ] **Step 1: Write failing tests**

Test cases:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeldOutSuite } from '../src/harness-sidecar/benchmarks/heldOutSuiteSchema.js';

test('held-out suite rejects traversal fixture refs', () => {
  assert.throws(() => normalizeHeldOutSuite({
    id: 'bad',
    domains: ['code'],
    cases: [{ id: 'case-1', fixtureRef: '../secret.txt', expectedEvidence: ['replay'] }],
  }), /fixtureRef/);
});
```

Add tests for:
- required `id`, `domains`, `cases`;
- domains: `code`, `research`, `memory`, `visual`, `tool`, `swarm`, `safety`;
- metric weights: quality, safety, reliability, cost, latency, maintainability, visualConfidence, memoryHealth, trustRisk;
- quarantine flags;
- persistence under `.harness/benchmarks/suites/<suite-id>.json`.

- [ ] **Step 2: Run the failing test**

Run:

```powershell
node --test tests\held-out-suite-store.test.js
```

Expected: FAIL because the benchmark modules do not exist.

- [ ] **Step 3: Implement schema and store**

Required API:

```js
export function normalizeHeldOutSuite(input, options = {}) {}
export function createHeldOutSuiteStore({ workspaceRoot, fsImpl } = {}) {
  return {
    suitePath(id) {},
    saveSuite(suite) {},
    loadSuite(id) {},
    listSuites() {},
  };
}
```

Implementation requirements:
- deterministic normalized JSON output;
- reject absolute paths and traversal paths;
- reject model-visible secret-shaped strings in descriptions and fixture refs;
- keep filesystem writes under `.harness/benchmarks/suites`;
- no network calls.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests\held-out-suite-store.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src\harness-sidecar\benchmarks tests\held-out-suite-store.test.js
git commit -m "feat: add held-out benchmark suite store"
```

### Worker 2: Recurring Replay Cycle Runner

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/benchmarks/replayCycleRunner.js`
- Create: `tests/replay-cycle-runner.test.js`
- Modify only if needed: `src/harness-sidecar/meta/governanceLoop.js`

**Goal:** Run candidate/baseline replay cycles over held-out suite manifests and emit evidence-only cycle reports.

- [ ] Write failing tests for baseline/candidate replay aggregation, quarantine handling, budget accounting, rollback-drill requirement, and deterministic report IDs.
- [ ] Implement `runReplayCycle({ suite, candidates, baselineRunner, candidateRunner, budget, now })`.
- [ ] Output report fields:

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
  promotionEvidenceOnly: true
}
```

- [ ] Ensure reports cannot mark a candidate promoted.
- [ ] Run `node --test tests\replay-cycle-runner.test.js`.
- [ ] Commit with `feat: add benchmark replay cycle runner`.

### Worker 3: Frontier Dashboard Store

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/meta/operatorDashboardStore.js`
- Create: `tests/operator-dashboard-store.test.js`
- Modify only if needed: `src/harness-sidecar/meta/longitudinalFrontier.js`

**Goal:** Persist compact dashboard snapshots for frontier, budget, rollback, memory, visual, trust, swarm, RHO, and router health.

- [ ] Write failing tests for snapshot normalization and persistence.
- [ ] Implement:

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
}) {}
```

- [ ] Store snapshots under `.harness/dashboards/operator/<timestamp>.json`.
- [ ] Redact secret-shaped values recursively.
- [ ] Run `node --test tests\operator-dashboard-store.test.js`.
- [ ] Commit with `feat: persist operator dashboard snapshots`.

---

## Chunk 2: Paper-Grade Memory Graph RAG And RHO Scale

### Worker 4: Model-Assisted Memory Extraction Policy

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/memory/modelAssistedExtractionPolicy.js`
- Modify: `src/harness-sidecar/memory/memoryExtractionSociety.js`
- Create: `tests/harness-memory-model-assisted-extraction.test.js`

**Goal:** Allow gated model-assisted extraction society roles while preserving deterministic fallback and guarded role-output contracts.

- [ ] Write failing tests proving model assistance is disabled by default.
- [ ] Add tests proving enabled model outputs are schema-validated, provenance-bound, and evidence-only.
- [ ] Implement:

```js
export function chooseMemoryExtractionMode({ config, caseContext, budget, risk }) {
  return { mode: 'deterministic' | 'model_assisted', reasons: [], requiredGuards: [] };
}
```

- [ ] Reject ungrounded claims that lack retrieved provenance references.
- [ ] Ensure model-assisted output cannot write promoted memory directly.
- [ ] Run `node --test tests\harness-memory-model-assisted-extraction.test.js`.
- [ ] Commit with `feat: gate model-assisted memory extraction`.

### Worker 5: Guarded Provenance Resolution Agents

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/memory/provenanceResolutionAgents.js`
- Modify: `src/harness-sidecar/memory/memoryConflictResolver.js`
- Create: `tests/harness-memory-provenance-resolution-agents.test.js`

**Goal:** Add bounded resolver/adjudicator evidence over retrieved provenance passages.

- [ ] Write tests for conflict, support, contradiction, stale-source, and insufficient-evidence outcomes.
- [ ] Implement resolver outputs:

```js
{
  verdict: 'supported' | 'contradicted' | 'conflicted' | 'insufficient_evidence',
  confidence,
  provenanceRefs,
  modelEvidenceOnly: true,
  promotionAllowed: false
}
```

- [ ] Preserve deterministic conflict resolver behavior when no model evidence is supplied.
- [ ] Run `node --test tests\harness-memory-provenance-resolution-agents.test.js`.
- [ ] Commit with `feat: add guarded memory provenance resolution agents`.

### Worker 6: RHO Embedding Provider And Replay Scheduler

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/rho/embeddingProvider.js`
- Create: `src/harness-sidecar/rho/replaySchedulePlanner.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Create: `tests/harness-rho-embedding-provider.test.js`
- Create: `tests/harness-rho-replay-schedule-planner.test.js`

**Goal:** Add production-scale RHO selection hooks with deterministic fallback embeddings and replay schedules across code, research, memory, visual, tool, swarm, and safety domains.

- [ ] Write failing tests for deterministic fallback embeddings and model-backed provider adapters.
- [ ] Write tests for larger DPP-like selection preserving difficulty/diversity metadata.
- [ ] Write tests for replay schedules that cover every major domain without mixing quarantined cases into promotion evidence.
- [ ] Implement provider API:

```js
export function createEmbeddingProvider({ modelProvider, fallback } = {}) {
  return { embedTextBatch, embedCaseBatch };
}
```

- [ ] Implement planner API:

```js
export function planRhoReplaySchedule({ cases, suites, cadence, budget, now }) {}
```

- [ ] Run both focused tests and `node --test tests\harness-rho-coreset.test.js`.
- [ ] Commit with `feat: scale RHO embeddings and replay scheduling`.

---

## Chunk 3: Paper-Grade Meta-Harness And BES Runtime Semantics

### Worker 7: Full Source-Tree Harness Variant Runner

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/meta/sourceTreeVariantRunner.js`
- Modify: `src/harness-sidecar/meta/harnessVariantWorkspace.js`
- Create: `tests/harness-source-tree-variant-runner.test.js`

**Goal:** Run isolated full source-tree harness variants with executable entrypoints and no active-workspace mutation.

- [ ] Write failing tests for source-tree materialization, command allowlist, artifact capture, and active workspace isolation.
- [ ] Implement:

```js
export function createSourceTreeVariantRunner({ workspaceRoot, variantRoot, commandRunner }) {
  return { prepareVariant, runVariant, collectArtifacts };
}
```

- [ ] Use the existing `.harness/meta/harness-variants/<cycle-id>/<candidate-id>/` root from `harnessVariantWorkspace.js`; do not create a second variant tree.
- [ ] Add compatibility tests proving existing `harnessVariantWorkspace.js` manifests and symlink-safe boundaries still work.
- [ ] Capture source/config/trace/metric/replay artifacts.
- [ ] Run `node --test tests\harness-source-tree-variant-runner.test.js`.
- [ ] Commit with `feat: run isolated source-tree harness variants`.

### Worker 8: Harness-Of-Harnesses Optimizer

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/meta/harnessOfHarnessesOptimizer.js`
- Modify only if needed: `src/harness-sidecar/meta/harnessOptimizer.js`
- Create: `tests/harness-of-harnesses-optimizer.test.js`

**Goal:** Propose and score optimizer variants without letting optimizer candidates modify active promotion gates.

- [ ] Write tests for candidate generation over optimizer policies.
- [ ] Write tests that promotion policies remain external and immutable from candidate output.
- [ ] Implement candidate result shape:

```js
{
  optimizerCandidateId,
  parentOptimizerId,
  targetOptimizer: 'rho' | 'bes' | 'meta' | 'router' | 'visual' | 'memory',
  evidence,
  paretoMetrics,
  evidenceOnly: true
}
```

- [ ] Run `node --test tests\harness-of-harnesses-optimizer.test.js`.
- [ ] Commit with `feat: add harness-of-harnesses optimizer evidence`.

### Worker 9: Live BES Fusion And Dense Judgment

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/bes/liveBesFusion.js`
- Create: `src/harness-sidecar/bes/modelAssistedDenseJudgment.js`
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Modify: `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- Create: `tests/harness-bes-live-fusion.test.js`
- Create: `tests/harness-bes-model-assisted-judgment.test.js`

**Goal:** Move BES from metadata/contracts toward runtime forward/backward fusion and optional bounded model-assisted dense subgoal judgment.

- [ ] Write tests showing forward/backward BES decisions affect live lane candidate ordering.
- [ ] Write tests showing model-assisted dense judgment is disabled by default and evidence-only when enabled.
- [ ] Implement:

```js
export function fuseLiveBesLane({ forwardCandidates, backwardGoals, denseScores, adaptiveAction }) {}
export function judgeDenseSubgoalWithModel({ subgoal, evidence, modelProvider, policy }) {}
```

- [ ] Preserve deterministic scorer fallback.
- [ ] Emit trajectory operator provenance for every fused candidate.
- [ ] Run both focused tests plus `node --test tests\harness-bes-lane-runtime.test.js`.
- [ ] Commit with `feat: fuse BES runtime decisions into live lanes`.

---

## Chunk 4: Multimodal/VLM As First-Class System Senses

### Worker 10: Visual SwarmCell Runtime

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/vlm/visualSwarmCell.js`
- Modify: `src/harness-sidecar/swarm/swarmCellRegistry.js`
- Create: `tests/harness-visual-swarmcell.test.js`

**Goal:** Add a dedicated visual SwarmCell for screenshots, UI states, diagrams, plots, PDFs, OCR, charts, and generated artifacts.

- [ ] Write failing contract tests for accepted visual task kinds and required evidence refs.
- [ ] Implement visual SwarmCell registration as disabled-by-default unless visual features are enabled.
- [ ] Require artifact hashes for visual-impacting evidence.
- [ ] Run `node --test tests\harness-visual-swarmcell.test.js`.
- [ ] Commit with `feat: add visual SwarmCell runtime`.

### Worker 11: Visual Replay Suites And Policy Frontier

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/vlm/visualReplaySuite.js`
- Create: `src/harness-sidecar/meta/visualFrontier.js`
- Modify: `src/harness-sidecar/meta/visualPolicyEvolution.js`
- Create: `tests/harness-visual-replay-suite.test.js`
- Create: `tests/harness-visual-frontier.test.js`

**Goal:** Compare visual policy candidates over held-out UI/artifact/PDF/diagram/chart/OCR tasks.

- [ ] Write tests for visual suite normalization, visual metric aggregation, and failed-evidence blocking.
- [ ] Implement visual replay reports with `visualEvidenceRequired: true`.
- [ ] Feed visual hard cases back into RHO/BES as evidence only.
- [ ] Run focused visual tests and `node --test tests\harness-vlm-production.test.js`.
- [ ] Commit with `feat: add visual replay suites and frontier`.

### Worker 12: Multimodal Request Budget Policy

**Agent type:** worker

**Owned files:**
- Modify: `src/harness-sidecar/model/multimodalRequestBuilder.js`
- Modify: `src/harness-sidecar/vlm/visualContextPolicy.js`
- Create: `tests/harness-multimodal-budget-policy.test.js`

**Goal:** Decide when to spend VLM budget versus text-only reasoning, and feed the decision into adaptive search evidence.

- [ ] Write tests for text-only fallback, VLM-required tasks, budget exhaustion, and adaptive-search feedback.
- [ ] Add policy result:

```js
{
  mode: 'text_only' | 'vlm_required' | 'vlm_optional',
  budgetCost,
  reasons,
  adaptiveSearchEvidence
}
```

- [ ] Run `node --test tests\harness-multimodal-budget-policy.test.js`.
- [ ] Commit with `feat: add multimodal request budget policy`.

---

## Chunk 5: Durable External A2A Network Behavior

### Worker 13: External A2A Transport Server And Client

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/interop/a2aTransportServer.js`
- Create: `src/harness-sidecar/interop/a2aTransportClient.js`
- Create: `tests/harness-a2a-transport.test.js`

**Goal:** Promote local A2A envelopes into long-lived server/client transport services while preserving gateway quarantine.

- [ ] Write tests for handshake, message submit, progress, cancel, retry, and streaming envelope transport.
- [ ] Write hostile-network tests for token scope failures, replayed messages, oversized payloads, credential-shaped free text, mutation requests from external peers, and attempts to escalate `verified: true`.
- [ ] Implement transport without requiring live network access in tests; use injectable fetch/listener adapters.
- [ ] Mark inbound external claims as `external: true`, `verified: false`.
- [ ] Run `node --test tests\harness-a2a-transport.test.js`.
- [ ] Commit with `feat: add external A2A transport adapters`.

### Worker 14: Restart-Persistent Production Queue And Issuer Secret Providers

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/interop/a2aQueueProvider.js`
- Create: `src/harness-sidecar/interop/a2aIssuerSecretProvider.js`
- Modify: `src/harness-sidecar/interop/a2aDurableStore.js`
- Modify: `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
- Create: `tests/harness-a2a-production-queue.test.js`

**Goal:** Add provider interfaces for production restart-persistent queues and stable issuer secrets, with local JSON adapters as fallback.

- [ ] Write tests for provider contracts, local fallback, root constraints, and secret redaction.
- [ ] Implement queue provider API:

```js
export function createA2aQueueProvider({ adapter, durableStore }) {}
```

- [ ] Implement issuer secret provider API:

```js
export function createIssuerSecretProvider({ env, secretStore, fallback }) {}
```

- [ ] Run `node --test tests\harness-a2a-production-queue.test.js`.
- [ ] Commit with `feat: add A2A production queue providers`.

### Worker 15: Multi-Hop A2A Lineage

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/interop/a2aMultiHopLineage.js`
- Modify: `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- Create: `tests/harness-a2a-multihop-lineage.test.js`

**Goal:** Preserve lineage through agent -> SwarmCell -> swarm -> local harness -> global harness flows.

- [ ] Write tests for parent/root/message lineage across multiple hops.
- [ ] Reject cyclic lineage and missing trust metadata.
- [ ] Add lineage compaction for dashboard summaries.
- [ ] Run `node --test tests\harness-a2a-multihop-lineage.test.js`.
- [ ] Commit with `feat: preserve multi-hop A2A lineage`.

---

## Chunk 6: Multi-Model Council Intelligence

### Worker 16: Bounded Model Debate Evidence

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/swarm/modelDebateEvidence.js`
- Modify: `src/harness-sidecar/swarm/modelCouncil.js`
- Create: `tests/harness-model-debate-evidence.test.js`

**Goal:** Add model-judged debate/critique evidence for council disagreements without granting debate winners apply or promotion authority.

- [ ] Write tests for debate prompts, critique outputs, disagreement summaries, and bounded confidence.
- [ ] Write negative tests proving debate winners cannot set `canPromote`, `approved`, `apply`, or verifier-bypass fields.
- [ ] Implement debate evidence shape:

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
  canPromote: false
}
```

- [ ] Sanitize all model-visible debate text through shared redaction/quarantine helpers.
- [ ] Run `node --test tests\harness-model-debate-evidence.test.js`.
- [ ] Commit with `feat: add bounded model debate evidence`.

### Worker 17: Production Pass@K And Ensemble Calibration

**Agent type:** worker

**Owned files:**
- Modify: `src/harness-sidecar/evals/modelCouncilPassK.js`
- Create: `src/harness-sidecar/model/ensembleCalibration.js`
- Create: `tests/harness-model-council-production-passk.test.js`
- Create: `tests/harness-model-ensemble-calibration.test.js`

**Goal:** Move council/router evals beyond deterministic local fixtures into stable suite-backed pass@k reports and calibrated ensemble weights.

- [ ] Write tests for suite-backed pass@k over held-out suite manifests from Worker 1.
- [ ] Compare best-single, repeated-single, static-council, adaptive-router, and calibrated-ensemble variants.
- [ ] Implement calibration output:

```js
{
  calibrationId,
  suiteId,
  modelWeights,
  confidenceIntervals,
  regressions,
  evidenceOnly: true,
  recommendedForPromotion: false
}
```

- [ ] Require minimum case counts before weights are considered usable.
- [ ] Ensure calibration cannot rewrite router defaults directly.
- [ ] Run both focused tests and `node --test tests\harness-model-council-passk.test.js`.
- [ ] Commit with `feat: calibrate model council ensemble evidence`.

### Worker 18: Endpoint Capacity And Router Health Policy

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/model/endpointCapacityPolicy.js`
- Modify: `src/harness-sidecar/model/modelEndpointProfiles.js`
- Modify: `src/harness-sidecar/model/vllmHealthController.js`
- Create: `tests/harness-endpoint-capacity-policy.test.js`

**Goal:** Add operator-policy-bounded model procurement/scaling recommendations for endpoint health, capacity, cost, latency, and specialist availability.

- [ ] Write tests for degraded endpoints, missing specialist models, cost ceilings, latency ceilings, and disabled auto-procurement.
- [ ] Implement:

```js
export function recommendEndpointCapacityActions({ endpoints, routerHealth, policy, budget }) {}
```

- [ ] Return recommendations only; no worker may start services, spend budget, or mutate endpoint config.
- [ ] Feed capacity health into dashboard snapshots through Worker 3 and integration through Worker 21.
- [ ] Run `node --test tests\harness-endpoint-capacity-policy.test.js`.
- [ ] Commit with `feat: recommend model endpoint capacity actions`.

---

## Chunk 7: Governance, Autonomy, And Integration

### Worker 19: Production Autonomy Policy

**Agent type:** worker

**Owned files:**
- Create: `src/harness-sidecar/meta/productionAutonomyPolicy.js`
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Create: `tests/harness-production-autonomy-policy.test.js`
- Create: `tests/harness-authority-boundary-integration.test.js`

**Goal:** Encode production autonomy levels, approval narrowing, escalation, external evidence policy, VLM-required policy, override audit, rollback, and quarantine behavior.

- [ ] Write tests for candidate types: docs, config, prompt, skill, verifier, code, model routing, A2A transport, visual policy, memory policy.
- [ ] Implement:

```js
export function evaluateProductionAutonomy({
  candidate,
  evidence,
  risk,
  operatorPolicy,
}) {}
```

- [ ] Ensure high-risk changes always require human approval.
- [ ] Ensure external A2A and VLM evidence policies can block promotion.
- [ ] Add integration tests proving low-risk approval narrowing remains eligibility-only and cannot apply directly.
- [ ] Add integration tests against `src/harness-sidecar/core/trustKernelBoundary.js`, `src/harness-sidecar/core/approvalResume.js`, `src/harness-sidecar/tools/verifierConfigApply.js`, and `src/harness-sidecar/meta/autoApprovalPolicy.js`.
- [ ] Prove autonomy policy cannot weaken verifier floors, bypass safe apply, or mark external evidence verified.
- [ ] Run `node --test tests\harness-production-autonomy-policy.test.js`.
- [ ] Run `node --test tests\harness-authority-boundary-integration.test.js`.
- [ ] Commit with `feat: add production autonomy policy`.

### Worker 20: Feature Gates And Shared Quarantine

**Agent type:** worker

**Owned files:**
- Modify: `src/harness-sidecar/config/configLoader.js`
- Create: `src/harness-sidecar/security/modelVisibleQuarantine.js`
- Create: `tests/harness-production-feature-gates.test.js`
- Create: `tests/harness-model-visible-quarantine.test.js`

**Goal:** Add disabled-by-default feature gates for all production paper-gap lanes and a shared quarantine/redaction helper for new model-visible outputs.

- [x] Add config defaults for model-assisted memory, model-backed RHO embeddings, production A2A transport, production A2A queues, visual SwarmCell, visual replay suites, model-assisted BES judgment, council debate, ensemble calibration, endpoint capacity recommendations, operator dashboards, and production autonomy policy.
- [x] Write tests proving every new feature defaults to disabled/offline/advisory.
- [x] Implement shared quarantine/redaction helper for dashboard/report/A2A/model-assisted fields.
- [x] Include negative tests for secret-shaped strings, absolute paths, traversal paths, oversize payload summaries, and external verification escalation attempts.
- [x] Run:

```powershell
node --test tests\harness-config.test.js
node --test tests\harness-production-feature-gates.test.js
node --test tests\harness-model-visible-quarantine.test.js
node --test tests\harness-mcp-security.test.js
```

- [x] Commit with `feat: gate production organism capabilities`.

### Worker 21: Server/UI Integration

**Agent type:** worker

**Owned files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `src/server.js`
- Modify: `public/app.js`
- Modify: `tests/harness-ui-discoverability.test.js`
- Create or modify focused bridge tests as needed.

**Goal:** Wire completed lane modules into feature-gated sidecar endpoints, app-shell WebSocket bridges, trace/status events, and operator-visible dashboard sections.

**Precondition:** Run only after Workers 1-20 finish and review passes.

- [ ] Add sidecar endpoints for held-out suites, replay cycles, dashboard snapshots, visual suite reports, A2A transport status, and autonomy policy summaries.
- [ ] Add app-shell bridge messages matching existing `harness_*` naming patterns.
- [ ] Add UI sections without granting apply/promote actions.
- [ ] Keep all new controls disabled/hidden unless the corresponding feature gates are enabled.
- [ ] Run:

```powershell
node --test tests\harness-ui-discoverability.test.js
npm run release:smoke
```

- [ ] Commit with `feat: surface production organism evidence dashboards`.

### Worker 22: Docs And Capability Status Integration

**Agent type:** worker

**Owned files:**
- Modify: `src/harness-sidecar/meta/capabilityGoalStatus.js`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: this plan file to mark completed chunks.
- Test: `tests/harness-capability-goal-status.test.js`

**Goal:** Update current-state docs and capability rows after implementation without overstating authority.

- [ ] Update docs to distinguish:
  - implemented substrate;
  - production-gated capability;
  - still-future paper-grade autonomy.
- [ ] Mark completed checklist items only where tests and integration prove the behavior.
- [ ] Add remaining gaps for anything intentionally deferred.
- [ ] Run `node --test tests\harness-capability-goal-status.test.js`.
- [ ] Commit with `docs: update paper alignment capability status`.

---

## Chunk 8: Final Integration And Verification

### Controller Task: Merge Worker Branches

- [ ] Inspect each worker summary and changed-file list.
- [ ] Merge non-conflicting worker commits.
- [ ] Resolve conflicts only in shared integration files.
- [ ] Re-run focused tests for each merged lane.
- [ ] Confirm no worker bypassed trust gates or wrote active workspace mutation paths.

### Controller Task: Full Verification

Run:

```powershell
git diff --check
npm test
npm run release:smoke
```

Expected:

- `git diff --check`: no whitespace errors except acceptable CRLF warnings if present.
- `npm test`: all tests pass, with only intentional skips.
- `npm run release:smoke`: passes.

### Controller Task: Browser Smoke

Run the local app, then use Browser/in-app browser verification:

- load `http://127.0.0.1:<port>/`;
- confirm `#app` renders;
- confirm operator dashboard sections render without console errors;
- confirm disabled feature gates do not expose apply/promote buttons;
- confirm evidence reports render for fixture data.

### Controller Task: Security And Authority Audit

Run:

```powershell
node --test tests\harness-authority-boundary-integration.test.js
node --test tests\harness-model-visible-quarantine.test.js
node --test tests\harness-a2a-transport.test.js
node --test tests\harness-production-autonomy-policy.test.js
```

Then inspect:

```powershell
rg -n "promote|apply|approval|verified|external|secret|token|issuer|quarantine|rollback" src tests docs
```

Confirm:

- new model-assisted evidence cannot promote memory or code;
- new A2A external evidence is unverified by default;
- VLM-required policy blocks visual-impacting promotion when visual evidence is missing;
- autonomy policy blocks high-risk changes;
- dashboard/UI controls are evidence-only.
- new model-visible fields use the shared quarantine/redaction helper.

### Controller Task: Final Code Review

Dispatch one final code-review subagent:

```text
Review the full implementation against docs/superpowers/plans/2026-06-11-paper-alignment-gap-subagent-implementation.md.
Focus on trust-kernel violations, evidence-only boundaries, unsafe filesystem paths, model-visible secret leaks, missing tests, and overstated docs.
Return findings ordered by severity with exact file/line references.
```

Fix all actionable findings or document why they are intentionally deferred.

---

## Recommended Parallel Schedule

### Round 1: Shared Safety Foundation

Run first, before any model-visible, A2A, dashboard, memory, council, or VLM worker:

- Worker 20: feature gates and shared quarantine

### Round 2: Independent Foundations

After Worker 20 passes, dispatch in parallel:

- Worker 1: held-out suite store
- Worker 4: memory extraction policy
- Worker 6: RHO embedding and replay schedule
- Worker 7: source-tree variant runner
- Worker 10: visual SwarmCell
- Worker 13: A2A transport
- Worker 19: autonomy policy

### Round 3: Evidence Expansion

Dispatch after Round 2 tests pass:

- Worker 2: replay cycle runner
- Worker 5: provenance resolution agents
- Worker 8: harness-of-harnesses optimizer
- Worker 9: live BES fusion
- Worker 11: visual replay/frontier
- Worker 14: A2A queue/issuer providers
- Worker 15: multi-hop A2A lineage
- Worker 16: bounded model debate evidence

### Round 4: Policy And Budget Coupling

Dispatch:

- Worker 3: operator dashboard store
- Worker 12: multimodal budget policy
- Worker 17: production pass@k and ensemble calibration
- Worker 18: endpoint capacity and router health policy

### Round 5: Serial Integration

Run only one worker at a time:

- Worker 21: server/UI integration
- Worker 22: docs/capability status integration

### Round 6: Review And Finish

- final code review subagent;
- full verification;
- finishing-a-development-branch.

---

## Acceptance Criteria

This plan is complete when:

- stable held-out suites exist and reject unsafe fixtures;
- replay cycles produce evidence-only production reports;
- dashboards persist longitudinal health snapshots;
- memory extraction/resolution can use gated model assistance with deterministic fallback;
- RHO can use model-backed embeddings and schedule production-domain replays;
- meta-harness can run isolated full source-tree variants;
- harness-of-harnesses candidates can optimize optimizer policies as evidence only;
- live BES runtime uses forward/backward fusion and dense judgment in candidate ordering;
- visual SwarmCell, visual replay suites, and VLM budget policy exist;
- external A2A transport, production queues, issuer secrets, and multi-hop lineage exist;
- bounded model debate, suite-backed pass@k, calibrated ensemble evidence, and endpoint capacity recommendations exist;
- feature gates default all production-grade lanes off unless explicitly enabled;
- model-visible quarantine/redaction covers new dashboard/report/A2A/model-assisted fields;
- autonomy policy encodes production approval, escalation, VLM, external evidence, rollback, and quarantine rules;
- server/UI surfaces all new evidence without apply/promote authority;
- docs state the new level accurately without claiming proven Level 4 operation or Level 5 autonomy.

## Expected Maturity After Completion

After this plan lands, Helios should be fairly described as:

```text
Level 4-ready candidate: production-gated network-of-networks harness substrate
with durable evidence loops, persistent operator dashboards, external A2A transport
adapters, richer model/VLM judgment, isolated harness-of-harnesses variants, and
strict non-self-authorizing governance.
```

It should not be called proven Level 4 until repeated held-out replay cycles produce persisted dashboard evidence over production-sized suites. It will still not be Level 5 until repeated real-world cycles show sustained autonomous research improvement under stable benchmarks and operator-reviewed governance.
