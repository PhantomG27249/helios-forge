# Production Capability Spine Next Stage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Helios Forge from deterministic local paper-shaped loops into a production-grade self-improvement spine with stable benchmarks, autonomous Meta-Harness variants, production RHO, model-assisted MemGraphRAG/BES judgment, multimodal scale, external durable A2A, and hardened governance.

**Architecture:** Build the scoreboard first, then allow more autonomous candidate generation against that scoreboard. Every workstream must preserve the trust-kernel rule: candidates can propose, score, mutate, and route, but durable authority still requires replay, verifier evidence, rollback metadata, policy gates, and approval.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules, JSONL traces, Markdown contracts, benchmark suite manifests, isolated source-tree workspaces, A2A envelopes, VLM/visual artifacts, and policy-gated model providers.

---

## Relationship To Soul, Oversoul, And Pi Extension Plan

This plan is the production trunk. The companion plan,
`docs/superpowers/plans/2026-06-10-soul-oversoul-pi-extension-next-stage.md`,
adds identity and communication organs:

- `soul.md` gives each agent durable identity, behavior priors, mutation lineage, and evaluation history.
- `oversoul.md` gives the swarm a collective mission, role ecology, mutation policy, and governance posture.
- The Helios Forge Pi extension improves skill sync, Pi-native handoffs, sidecar status visibility, and agent communication.

Those features should flow through this production trunk:

- benchmark suites evaluate soul and oversoul variants;
- Meta-Harness source-tree candidates include soul/oversoul files;
- RHO mines soul/oversoul failures and wins as hard cases;
- BES proposes governed soul mutations and oversoul role-ecology changes;
- visual and A2A lanes carry soul/oversoul references;
- governance blocks soul/oversoul changes from granting authority.

## Current Baseline

Implemented substrate:

- deterministic benchmark/frontier records and capability-goal rows;
- isolated Meta-Harness variant workspaces with source/config/trace/metric artifacts;
- RHO coreset selection, held-out variants, grouped candidate-family replay, and advisory self-validation/self-consistency/self-preference evidence;
- guarded eight-role MemGraphRAG extraction society outputs and provenance/conflict/eval metadata;
- BES lane contracts, forward/backward fusion metadata, dense verifier contracts, trajectory provenance, compatible-family descriptors, and champion/frontier hooks;
- visual evidence as first-class memory/RHO/BES/trust metadata;
- local durable A2A inbox/outbox, endpoint registry, negotiation/streaming envelopes, delegated-token scope, and root/symlink-safe store checks;
- governance summaries, rollback drill records, autonomy metadata, and approval gates.

Remaining production gaps:

- stable held-out suites and scheduled replay cycles over real tasks;
- autonomous full source-tree Meta-Harness variants;
- production embeddings and larger RHO rerolls;
- gated model workers for memory extraction, adjudication, merge planning, and BES dense judgment;
- dedicated visual SwarmCell and real OCR/PDF/chart/diagram/UI regression suites;
- external long-lived A2A network transport and production queues;
- production autonomy policy, audit trails, rollback/quarantine drills, and explicit external/VLM evidence rules.

## Chunk 1: Production Benchmark Spine

### Task 1: Stable Held-Out Suite Manifests

**Files:**
- Create: `src/harness-sidecar/benchmarks/heldOutSuiteStore.js`
- Create: `src/harness-sidecar/benchmarks/heldOutSuiteSchema.js`
- Test: `tests/held-out-suite-store.test.js`

- [ ] Write failing tests for suite manifest validation across quality, safety, reliability, cost, latency, maintainability, visual confidence, memory health, and trust risk.
- [ ] Implement a stable suite manifest format with task ids, fixture refs, expected evidence types, metric weights, and quarantine flags.
- [ ] Add workspace-root constrained persistence under `.harness/benchmarks/suites/<suite-id>.json`.
- [ ] Reject absolute paths, traversal paths, and unapproved external URLs.
- [ ] Run `node --test tests/held-out-suite-store.test.js`.
- [ ] Commit with `feat: add held-out benchmark suite store`.

### Task 2: Scheduled Replay Cycle Runner

**Files:**
- Create: `src/harness-sidecar/benchmarks/scheduledReplayRunner.js`
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Test: `tests/scheduled-replay-runner.test.js`

- [ ] Write failing tests for daily/weekly/manual replay cycle plans.
- [ ] Implement cycle records with suite id, candidate family, budget, started/completed timestamps, metric summary, and blockers.
- [ ] Connect governance scheduled replay jobs to real held-out suite cycle records.
- [ ] Preserve deterministic no-model mode for CI.
- [ ] Run `node --test tests/scheduled-replay-runner.test.js`.
- [ ] Commit with `feat: schedule held-out replay cycles`.

### Task 3: Frontier Dashboard Persistence

**Files:**
- Create: `src/harness-sidecar/benchmarks/frontierDashboardStore.js`
- Modify: `src/harness-sidecar/meta/longitudinalFrontier.js`
- Modify: `public/app.js`
- Test: `tests/frontier-dashboard-store.test.js`

- [ ] Write failing tests for persisted dashboard rows and trend summaries.
- [ ] Store frontier dashboard snapshots under `.harness/benchmarks/frontier-dashboard.jsonl`.
- [ ] Include quality, safety, reliability, cost, latency, maintainability, visual confidence, memory health, and trust risk deltas.
- [ ] Surface compact dashboard rows in existing harness status UI.
- [ ] Run `node --test tests/frontier-dashboard-store.test.js`.
- [ ] Commit with `feat: persist frontier dashboard trends`.

## Chunk 2: Autonomous Meta-Harness Source-Tree Variants

### Task 4: Full Source-Tree Candidate Workspace

**Files:**
- Modify: `src/harness-sidecar/meta/harnessVariantWorkspace.js`
- Create: `src/harness-sidecar/meta/sourceTreeCandidate.js`
- Test: `tests/source-tree-candidate.test.js`

- [ ] Write failing tests for creating isolated full source-tree candidate directories.
- [ ] Copy or materialize approved source snapshots into `.harness/meta/source-variants/<cycle-id>/<candidate-id>/workspace`.
- [ ] Add executable harness entrypoint metadata and candidate-local config.
- [ ] Reject symlink/junction escapes and unapproved generated file paths.
- [ ] Run `node --test tests/source-tree-candidate.test.js`.
- [ ] Commit with `feat: materialize source-tree harness candidates`.

### Task 5: Propose/Evaluate/Log/Propose Loop

**Files:**
- Create: `src/harness-sidecar/meta/autonomousHarnessLoop.js`
- Modify: `src/harness-sidecar/meta/harnessExperimentRunner.js`
- Test: `tests/autonomous-harness-loop.test.js`

- [ ] Write failing tests for repeated propose/evaluate/log/propose cycles over isolated candidate source trees.
- [ ] Give proposer context access to prior trace summaries, candidate source summaries, metrics, blockers, and rollback notes.
- [ ] Log candidate source diffs, config, trace refs, metric artifacts, and proposer rationale.
- [ ] Keep active workspace apply disabled unless promotion policy and approval pass.
- [ ] Run `node --test tests/autonomous-harness-loop.test.js`.
- [ ] Commit with `feat: run autonomous harness candidate cycles`.

### Task 6: Pareto Frontier For Candidate Families

**Files:**
- Modify: `src/harness-sidecar/meta/harnessFrontier.js`
- Create: `src/harness-sidecar/meta/paretoFrontier.js`
- Test: `tests/pareto-frontier.test.js`

- [ ] Write failing tests for Pareto frontier selection across quality, safety, cost, latency, maintainability, visual confidence, memory health, and trust risk.
- [ ] Implement deterministic Pareto ranking with explicit tie-breakers.
- [ ] Add candidate-family lineage and blocker summaries.
- [ ] Run `node --test tests/pareto-frontier.test.js`.
- [ ] Commit with `feat: add pareto frontier tracking`.

## Chunk 3: RHO At Production Scale

### Task 7: Embedding Provider Interface

**Files:**
- Create: `src/harness-sidecar/rho/embeddingProvider.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/rho-embedding-provider.test.js`

- [ ] Write failing tests for fixture, precomputed, and model-backed embedding providers.
- [ ] Add policy-gated model-backed provider hooks without requiring network/model access in CI.
- [ ] Preserve deterministic fallback embeddings.
- [ ] Record embedding provider provenance in RHO cases.
- [ ] Run `node --test tests/rho-embedding-provider.test.js`.
- [ ] Commit with `feat: add policy gated rho embeddings`.

### Task 8: Large Grouped Reroll Runner

**Files:**
- Modify: `src/harness-sidecar/rho/replayBatchRunner.js`
- Create: `src/harness-sidecar/rho/groupedRerollPlanner.js`
- Test: `tests/rho-grouped-reroll.test.js`

- [ ] Write failing tests for grouped rerolls across candidate families and task domains.
- [ ] Add production-sized suite chunking with budget caps.
- [ ] Aggregate self-validation, self-consistency, self-preference, verifier, visual, memory, and trust evidence.
- [ ] Emit blocking evidence when a candidate family regresses any protected dimension.
- [ ] Run `node --test tests/rho-grouped-reroll.test.js`.
- [ ] Commit with `feat: scale rho grouped rerolls`.

### Task 9: Stronger Self-Preference Signal

**Files:**
- Modify: `src/harness-sidecar/rho/selfPreferenceJudge.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Test: `tests/rho-self-preference-promotion.test.js`

- [ ] Write failing tests proving self-preference can strengthen evidence but cannot self-promote.
- [ ] Add pairwise preference artifacts with rationale, evaluator provenance, confidence, and disagreement flags.
- [ ] Require verifier/replay corroboration before promotion policy treats preference as positive evidence.
- [ ] Run `node --test tests/rho-self-preference-promotion.test.js`.
- [ ] Commit with `feat: strengthen rho self preference evidence`.

## Chunk 4: Model-Assisted MemGraphRAG And BES Judgment

### Task 10: Gated Memory Society Workers

**Files:**
- Modify: `src/harness-sidecar/memory/memoryExtractionSociety.js`
- Create: `src/harness-sidecar/memory/modelAssistedMemoryRoles.js`
- Test: `tests/model-assisted-memory-roles.test.js`

- [ ] Write failing tests for passage collector, schema proposer, fact extractor, contradiction critic, merge planner, graph constructor, retriever, and evaluator workers.
- [ ] Add model-worker hooks behind explicit policy gates.
- [ ] Keep deterministic fallback role outputs for CI and audit.
- [ ] Attach prompt, model, source, confidence, contradiction, and provenance metadata without exposing secrets.
- [ ] Run `node --test tests/model-assisted-memory-roles.test.js`.
- [ ] Commit with `feat: gate model assisted memory society roles`.

### Task 11: Contradiction Resolution And Merge Planning

**Files:**
- Modify: `src/harness-sidecar/memory/memoryConflictAdjudicator.js`
- Create: `src/harness-sidecar/memory/memoryMergePlanner.js`
- Test: `tests/memory-merge-planner.test.js`

- [ ] Write failing tests for retrieved provenance passages, contradiction decisions, merge plans, and unresolved conflicts.
- [ ] Add guarded model-assisted adjudication as advisory evidence only.
- [ ] Require provenance-backed retrieval for any active fact merge.
- [ ] Run `node --test tests/memory-merge-planner.test.js`.
- [ ] Commit with `feat: plan provenance backed memory merges`.

### Task 12: Learned Dense BES Verifier Hooks

**Files:**
- Modify: `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- Create: `src/harness-sidecar/bes/modelDenseVerifier.js`
- Test: `tests/model-dense-verifier.test.js`

- [ ] Write failing tests for deterministic, model-assisted, and blocked dense subgoal verification.
- [ ] Add gated model-assisted subgoal judgment with confidence, rationale, counter-evidence, and replay refs.
- [ ] Prevent learned/model judgment from weakening command/verifier floors.
- [ ] Run `node --test tests/model-dense-verifier.test.js`.
- [ ] Commit with `feat: add gated model dense bes verifier`.

### Task 13: Live Forward/Backward BES Fusion

**Files:**
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Modify: `src/harness-sidecar/bes/bidirectionalLoop.js`
- Test: `tests/live-bes-fusion.test.js`

- [ ] Write failing tests for forward candidate evidence fused with backward goal decomposition in live lane execution.
- [ ] Promote fusion metadata into actual lane scoring where safe.
- [ ] Preserve existing lane events: `bes_lane.started`, `bes_lane.completed`, and `bes_lane.blocked`.
- [ ] Run `node --test tests/live-bes-fusion.test.js`.
- [ ] Commit with `feat: fuse live bes lane evidence`.

## Chunk 5: Multimodal Scale

### Task 14: Dedicated Visual SwarmCell

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmCellRegistry.js`
- Create: `src/harness-sidecar/swarm/visualSwarmCell.js`
- Test: `tests/visual-swarm-cell.test.js`

- [ ] Write failing tests for visual SwarmCell task/output contracts.
- [ ] Support screenshots, UI states, diagrams, plots, PDFs, OCR, charts, and generated artifacts.
- [ ] Require visual artifact hashes and VLM confidence policy for visual-impacting claims.
- [ ] Run `node --test tests/visual-swarm-cell.test.js`.
- [ ] Commit with `feat: add visual swarmcell`.

### Task 15: Real Visual Benchmark Suites

**Files:**
- Modify: `src/harness-sidecar/vlm/visualBenchmarkCases.js`
- Create: `src/harness-sidecar/vlm/visualSuiteBuilder.js`
- Test: `tests/visual-suite-builder.test.js`

- [ ] Write failing tests for OCR, PDF, chart, diagram, and UI regression suite manifests.
- [ ] Convert visual artifacts into stable held-out benchmark cases with hashes and sanitized metadata.
- [ ] Feed visual cases into RHO replay and Meta-Harness visual policy evaluation.
- [ ] Run `node --test tests/visual-suite-builder.test.js`.
- [ ] Commit with `feat: build visual benchmark suites`.

### Task 16: Budget-Aware VLM Routing

**Files:**
- Modify: `src/harness-sidecar/meta/visualPolicyEvolution.js`
- Modify: `src/harness-sidecar/budget/*`
- Test: `tests/vlm-budget-routing.test.js`

- [ ] Write failing tests for when to spend VLM budget versus text-only reasoning.
- [ ] Add routing policy candidates with budget, confidence, risk, and task-type features.
- [ ] Require trust-gate evidence for UI/PDF/image/diagram/chart-impacting changes.
- [ ] Run `node --test tests/vlm-budget-routing.test.js`.
- [ ] Commit with `feat: route vlm budget by policy`.

## Chunk 6: External Durable A2A

### Task 17: Long-Lived A2A Server And Client

**Files:**
- Create: `src/harness-sidecar/interop/a2aServer.js`
- Create: `src/harness-sidecar/interop/a2aClient.js`
- Test: `tests/a2a-server-client.test.js`

- [ ] Write failing tests for server endpoint registration, message receive, dispatch, stream, cancel, and progress.
- [ ] Implement local HTTP or transport-adapter boundaries without exposing secrets.
- [ ] Keep external claims quarantined until accepted by memory, replay, or verifier evidence.
- [ ] Run `node --test tests/a2a-server-client.test.js`.
- [ ] Commit with `feat: add durable a2a server client transport`.

### Task 18: Production Queue And Issuer Secret Providers

**Files:**
- Modify: `src/harness-sidecar/interop/a2aDurableStore.js`
- Modify: `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
- Test: `tests/a2a-production-providers.test.js`

- [ ] Write failing tests for injected queue providers and stable issuer-secret providers.
- [ ] Add provider interfaces while preserving local JSON store behavior.
- [ ] Enforce scoped delegated trust and token expiry.
- [ ] Run `node --test tests/a2a-production-providers.test.js`.
- [ ] Commit with `feat: add a2a production provider interfaces`.

### Task 19: Subagent Negotiation And Multi-Hop Lineage

**Files:**
- Modify: `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- Modify: `src/harness-sidecar/interop/externalAgentGateway.js`
- Test: `tests/a2a-multihop-lineage.test.js`

- [ ] Write failing tests for subagent-to-subagent negotiation and lineage across agent -> SwarmCell -> swarm -> local harness -> global harness.
- [ ] Preserve soul refs, oversoul refs, BES lane refs, RHO case refs, memory graph refs, visual refs, and required-verification metadata.
- [ ] Mark all external A2A claims unverified at the gateway boundary.
- [ ] Run `node --test tests/a2a-multihop-lineage.test.js`.
- [ ] Commit with `feat: preserve a2a multihop lineage`.

## Chunk 7: Governance Hardening

### Task 20: Production Autonomy Levels

**Files:**
- Create: `src/harness-sidecar/meta/autonomyPolicyTable.js`
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Test: `tests/autonomy-policy-table.test.js`

- [ ] Write failing tests for candidate-type autonomy levels and allowed actions.
- [ ] Add production autonomy levels for policy, verifier, skill, soul, oversoul, memory, visual, A2A, and source-tree candidates.
- [ ] Make low-risk reversible actions eligible for lower-friction approval metadata only where explicitly configured.
- [ ] Run `node --test tests/autonomy-policy-table.test.js`.
- [ ] Commit with `feat: add production autonomy policy table`.

### Task 21: Escalation, Override, Audit, And Quarantine

**Files:**
- Modify: `src/harness-sidecar/meta/governanceLoop.js`
- Create: `src/harness-sidecar/meta/auditTrail.js`
- Test: `tests/governance-audit-quarantine.test.js`

- [ ] Write failing tests for escalation reasons, operator override records, rollback drills, and quarantine behavior.
- [ ] Persist audit trail records for all durable promotion decisions.
- [ ] Add explicit external/VLM evidence policy checks.
- [ ] Run `node --test tests/governance-audit-quarantine.test.js`.
- [ ] Commit with `feat: harden governance audit and quarantine`.

### Task 22: Final Production Spine Verification

**Files:**
- No new files.

- [ ] Run focused benchmark tests: `node --test tests/held-out-suite-store.test.js tests/scheduled-replay-runner.test.js tests/frontier-dashboard-store.test.js`.
- [ ] Run focused Meta-Harness/RHO tests: `node --test tests/source-tree-candidate.test.js tests/autonomous-harness-loop.test.js tests/rho-grouped-reroll.test.js`.
- [ ] Run focused memory/BES/visual/A2A/governance tests.
- [ ] Run `npm test`.
- [ ] Run `npm run release:smoke`.
- [ ] Run `git diff --check`.
- [ ] Commit final fixes.

## Acceptance Criteria

- Stable held-out benchmark suites can be persisted, replayed on a schedule, and summarized in dashboard history.
- Meta-Harness can evaluate full isolated candidate source trees with executable harness entrypoints.
- RHO can use policy-gated production embeddings, larger grouped rerolls, and stronger self-preference/self-consistency evidence without self-promotion.
- MemGraphRAG can call gated model-assisted role workers while preserving deterministic fallback, provenance, conflict evidence, and auditability.
- BES can use model-assisted dense subgoal judgment and live forward/backward fusion where policy allows.
- Multimodal evidence has a dedicated visual SwarmCell, real visual suite manifests, visual RHO replay, and budget-aware VLM routing.
- A2A has long-lived server/client transport, production queue/secret provider interfaces, subagent negotiation, and real multi-hop lineage.
- Governance has production autonomy tables, escalation/override/audit policy, rollback/quarantine drills, and explicit external/VLM evidence policy.
- Soul and oversoul files can be included as evaluated candidate artifacts, but cannot grant authority or lower gates.

