# Implementation Reconciliation — June 17, 2026

**Purpose:** Single source of truth for what Helios Forge has actually built, what is wired into the production hot path, what remains open, and which documents to trust.

**Use this document when:** onboarding, planning the next milestone, or resolving conflicts between older plans and the codebase.

---

## Authority Stack

Read documents in this order. Higher rows win when they conflict.

| Priority | Document | Role |
| --- | --- | --- |
| 1 | **This file** | Code-grounded status as of 2026-06-17 |
| 2 | `docs/architecture/current-architecture.md` | Operator/developer architecture snapshot |
| 3 | `docs/architecture/evolutionary-agentic-organism-gap-map.md` | Target organism and remaining gaps |
| 4 | `docs/architecture/2026-06-12-evolutionary-swarm-meta-harness-codebase-audit.md` | June 12 code audit (still valid for substrate vs proof framing) |
| 5 | `docs/superpowers/plans/2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md` | **Active execution plan** for wiring + proof |
| 6 | `docs/superpowers/plans/archive/*` and `docs/architecture/archive/*` | Historical or superseded — see archive READMEs |

**Invariant (never weaken):**

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

---

## Executive Summary

| Dimension | Status |
| --- | --- |
| **Engine substrate** | Broadly implemented — modules, tests, evidence envelopes, trust gates |
| **Hot-path wiring (M0–M4)** | ~95% — trust kernel, replay, nested swarms, real campaigns, MemGraphRAG bridge |
| **Background evolution (extra)** | Implemented — `backgroundEvolutionWorker.js`, `partialAutonomyApply.js`, production report + A2A peer cycles on post-task path |
| **Paper-grade scale (M5)** | **Wired** — `productionReportOrchestrator.js` persists reports when gates enabled; production proof at scale still open |
| **External A2A network (M6)** | **Wired** — `a2aPeerCycleRunner.js`, two-instance test, `/v1/evidence/a2a-peer-cycles` |
| **Earned autonomy proof (M7)** | **Wired** — `autonomyProofRecorder.js`, policy gating, UI dashboard; multi-cycle L1/L2 proof still open |
| **Docs/audit closure (Chunk 9)** | In progress via this reconciliation |

**Honest claim:**

```text
Helios has a Level 4-capable engine substrate with real hot-path wiring for trust, measurement, and recursion.
The Level 4 evaluation record is still production-gated and not yet populated by repeated held-out proof at scale.
```

---

## Active Execution Plan

| Plan | Status |
| --- | --- |
| `2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md` | **Active** — primary wiring + proof spine |
| `2026-06-16-standalone-electron-app.md` | **Parallel product track** — does not block organism wiring |
| `docs/superpowers/plans/archive/2026-06-12-remaining-paper-gaps-parallel-subagents.md` | **Superseded** — reuse module ideas only |
| `docs/superpowers/plans/archive/2026-06-10-production-capability-spine-next-stage.md` | **Superseded** — parent trunk absorbed into June 17 master plan |
| `docs/superpowers/plans/archive/2026-06-11-paper-alignment-gap-subagent-implementation.md` | **Superseded** — capability goals now tracked in `capabilityGoalStatus.js` |

---

## Milestone Gates vs Code

| Milestone | Gate | Code status | Notes |
| --- | --- | --- | --- |
| **M0** | Trust kernel on every apply/promote path | **Done** | `trustKernelGateway.js`, `approvalResume.js`, `governanceLoop.js`, `buildGovernanceTrustInput` in `server.js` |
| **M1** | Recurring replay + dashboard snapshots | **Mostly done** | `replayScheduler.js`, post-task hooks, `/v1/evidence/replay-cycles`; missing `/v1/replay/schedules` API |
| **M2** | Nested SwarmCells + per-cell local meta | **Done** | `nestedSwarmOrchestrator.js`, `HELIOS_NESTED_SWARM_CELLS=1`, integration tests pass |
| **M3** | Autonomous meta-harness campaigns | **Done** | `runMetaHarnessCampaign` on post-task path; campaign reports persist |
| **M4** | MemGraphRAG in task/swarm path | **Mostly done** | `memoryGraphTaskBridge.js` in `runPostTaskRecursiveEvolutionHooks` |
| **M5** | Paper-grade RHO/BES/VLM at scale | **Wired** | `productionReportOrchestrator.js` + `/v1/evidence/production-reports`; repeated held-out proof open |
| **M6** | External A2A peer cycles | **Wired** | `a2aPeerCycleRunner.js` + two-instance test + evidence API |
| **M7** | Earned autonomy L1–L2 + rollback history | **Wired** | `autonomyProofRecorder.js` + policy thresholds + UI; multi-cycle proof open |

---

## Hot-Path Integration Hub

Implementation converged on one integration layer instead of many per-chunk `server.js` edits:

| Module | Responsibility |
| --- | --- |
| `recursiveEvolutionRuntimeHook.js` | Post-task replay, campaigns, MemGraphRAG ingest, coordination, autonomy accumulation |
| `backgroundEvolutionWorker.js` | Periodic ticks, partial autonomy apply, persisted autonomy evidence |
| `partialAutonomyApply.js` | Shadow-policy writes in `.harness/runtime/` and `.harness/meta/` only |
| `trustKernelGateway.js` | Governance-friendly trust kernel envelope |

**Wiring anchor in `server.js`:** `runPostTaskRecursiveEvolutionHooks` after full runtime task completion; `createBackgroundEvolutionWorker` on sidecar start.

---

## Module Inventory (Plan → Code)

| Planned module | Path | Tests | Hot path |
| --- | --- | --- | --- |
| Trust kernel gateway | `core/trustKernelGateway.js` | `trust-kernel-gateway.test.js` | Yes |
| Replay scheduler | `benchmarks/replayScheduler.js` | `replay-scheduler.test.js` | Yes (gated) |
| Baseline family registry | `benchmarks/baselineFamilyRegistry.js` | `baseline-family-registry.test.js` | Indirect |
| Nested swarm orchestrator | `swarm/nestedSwarmOrchestrator.js` | `nested-swarm-orchestrator.test.js` | Yes (flag) |
| Oversoul budget router | `swarm/oversoulBudgetRouter.js` | `oversoul-budget-router.test.js` | Advisory |
| Memory graph task bridge | `memory/memoryGraphTaskBridge.js` | `memory-graph-task-bridge.test.js` | Yes (gated) |
| Campaign scheduler | `meta/campaignScheduler.js` | `campaign-scheduler.test.js` | Yes (stub runner on post-task) |
| Recursive evolution coordinator | `meta/recursiveEvolutionCoordinator.js` | `recursive-evolution-coordinator.test.js` | Yes |
| Autonomy evidence accumulator | `meta/autonomyEvidenceAccumulator.js` | `autonomy-evidence-accumulator.test.js` | Yes |
| Production A2A queue provider | `interop/productionQueueProvider.js` | `a2a-production-queue-provider.test.js` | No |
| Background evolution worker | `meta/backgroundEvolutionWorker.js` | `background-evolution-worker.test.js` | Yes |
| Partial autonomy apply | `meta/partialAutonomyApply.js` | `partial-autonomy-apply.test.js` | Yes (background worker) |

**Pre-existing modules (substrate, not new in June 17 plan):** `replayCycleRunner.js`, `operatorDashboardStore.js`, `trustKernelBoundary.js`, `promotionLoop.js`, `metaHarnessCampaignRunner.js`, `memoryGraphRuntime.js`, `swarmCellRuntime.js`, `governanceLoop.js`.

---

## Capability Goals vs Reality

Tracked in `capabilityGoalStatus.js` and surfaced in UI via `/v1/evidence/*` endpoints.

| Goal | Substrate | Hot-path wiring | Production evidence |
| --- | --- | --- | --- |
| `benchmark_spine` | Yes | Replay scheduler + dashboards | Needs repeated cycles |
| `meta_harness_loop` | Yes | Campaign scheduler + real post-task bindings (2026-06-18 wiring) | Needs repeated campaign reports |
| `memgraphrag_depth` | Yes | Task bridge | Needs production eval dashboards |
| `soul_coverage` | Yes | Nested swarm behind flag | Nested execution **implemented**; production proof pending |
| `rho_at_scale` | Partial | Not production-wired | Open |
| `bes_full_lanes` | Partial | Not production-wired | Open |
| `multimodal_system_sense` | Partial | Visual substrate | Open |
| `a2a_external_durability` | Partial | Local only | Open |
| `governance_autonomy` | Partial | Policy + accumulator | Open |
| `background_evolution` | Yes | Background worker | Needs repeated tick history |

---

## Known Gaps (Prioritized)

1. **Production proof at scale** — capability goals need repeated held-out cycles with gates enabled in operator config (not code wiring).
2. **M1 API polish** — Optional `/v1/replay/schedules` CRUD (evidence read path exists).
3. **ICR wiring** — see `docs/superpowers/plans/2026-06-17-icr-wiring-parallel-subagents.md` (parallel track).
4. **Chunk 9 security audit** — authority audit subagent not yet run.
5. **Electron product track** — standalone app plan is separate.

### Addendum — 2026-06-18 meta-harness evolution wiring

Integration worker landed **G0–G6** from `2026-06-18-meta-harness-evolution-wiring-parallel-subagents.md`:

- **G0:** `setupHeliosForge` scaffolds `workplace-smoke` held-out suite + evolution config block.
- **G1–G4:** Post-task path delegates to `postTaskEvolutionOrchestrator` (real replay commands, source-tree campaigns, per-task campaign reports, frontier JSONL).
- **G5–G6:** Frontier persistence + `repairWorkplace` merge via `scaffoldWorkplaceEvolution` without wiping operator YAML.
- Stub `defaultBaselineRunner` / `smokeSuiteFallback` removed from hot path unless `evolution.syntheticReplay: true`.
- Background ticks persist full hook results under `.harness/meta/background-ticks/`.

Remaining: repeated production proof at scale, operator `models.swarmBaseUrl` configuration, promotion loop closure in `coordinateRecursiveEvolution`.

---

## Test Evidence

Focused plan-related tests (72+ cases) pass including:

- `trust-kernel-gateway.test.js`
- `harness-authority-boundary-integration.test.js`
- `replay-scheduler.test.js`
- `nested-swarm-orchestrator.test.js`
- `harness-recursive-evolution-integration.test.js`
- `harness-hierarchical-swarm-integration.test.js`
- `harness-background-evolution-integration.test.js`
- `campaign-scheduler.test.js`
- `autonomy-evidence-accumulator.test.js`

Run: `npm test` before claiming milestone gates.

---

## Document Maintenance Rules

1. After each milestone gate passes, update **this file** first, then `current-architecture.md`, then the master plan checkboxes.
2. Do not mark a capability goal `production_evidence_available` without persisted artifacts under `.harness/`.
3. Superseded plans get a banner only — do not delete historical plans.
4. Parallel tracks (Electron app, ICR lane) stay in their own plans; link from `docs/superpowers/plans/README.md`.

---

## Related Reading

- `docs/superpowers/plans/README.md` — active plan index
- `docs/superpowers/plans/archive/README.md` — archived plans index
- `docs/architecture/paper-implementation-alignment.md` — paper-by-paper background
- `docs/architecture/feature-architecture-map.md` — feature inventory and runtime flow
