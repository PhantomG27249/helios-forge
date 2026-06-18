# Autonomous Self-Improvement Closed Loop — Parallel Subagent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop from **live chat → harness task → held-out replay → autonomous policy apply → measurably better next task** in **any configured Helios workplace**, with graduated autonomy (shadow → advisory → reversible apply → earned promotion) while preserving trust-kernel safety.

**Product context:** Helios is a **general-purpose Pi-based coding agent** for every repo you point it at. The evolutionary layer is not a separate product or a single-project feature — it is the harness sidecar that combines MemGraphRAG (memory), Meta-Harness (harness optimization), RHO (retrospective hard-case learning), BES (bidirectional search), swarms, and governance into one self-improving loop. SWI and other repos are **workplaces** used to dogfood and prove the loop; the implementation must stay universal.

**Scope:** This plan is **workplace-agnostic**. Every repo with `.harness/config.yaml` (setup, repair, or scaffold) gets the same hooks, artifacts, and autonomy ladder. No project-specific branches (SWI, Electron, etc.) — only per-workplace operator config and held-out suite content differ.

**Architecture:** Split the work into seven parallel domain workers with disjoint file ownership, plus one serial **Integration Worker**. Workers export small APIs (`loadRuntimePolicy`, `bridgeReplayFeedback`, `runPostTaskAutonomyApply`, etc.). Integration wires them into `recursiveEvolutionRuntimeHook.js`, `server.js`, `public/app.js`, and workplace scaffold (`scaffoldWorkplaceEvolution`). Chat already spawns `harness_task_start` (`prompt_background`); this plan makes post-task evolution **complete on every message in every workplace**, consumes replay evidence in the **live runtime** (not just shadow ledger), and surfaces uplift in UI + longitudinal frontier.

**Parent plans:**
- `docs/superpowers/plans/2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md` (M7 earned autonomy, M1 benchmark spine)
- `docs/superpowers/plans/2026-06-18-meta-harness-evolution-wiring-parallel-subagents.md` (real replay + campaign substrate — prerequisite)

**Tech Stack:** Node.js ESM, `node:test`, harness sidecar (`src/harness-sidecar/*`), Helios server (`src/server.js`), UI (`public/app.js`), `.harness/` artifacts, existing `partialAutonomyApply.js`, `promotionLoop.js`, `autonomyEvidenceAccumulator.js`, `longitudinalImprovementTracker.js`, `adaptiveSearchScheduler.js`.

**Production gap (observed across configured workplaces — SWI was first fixture, not special case):**
- Chat tasks: `source: prompt_background`, in-task BES/meta runs, but `task_*` traces often end **before** `recursive_evolution.coordinated`.
- Full evolution loop runs on `background-evolution` ticks only (~5 min) when chat path truncates.
- `partial_autonomy.applied` writes `shadow-policy.json` but **nothing reads it** at runtime.
- Replay scores stay flat when `workplace-smoke` uses placeholder commands (detector fallback or operator never edited suite); no longitudinal `improvement` classification.
- `productionCapabilities.operatorDashboards` and `sourceTreeVariants` default **off** — replay/campaigns skip until operator enables gates per workplace.

### Universal Workplace Contract

Every Helios workplace follows the same contract (see `harnessEvolutionDefaults.js`, `defaultHeldOutSuite.js`):

```text
<any-repo>/
  .harness/config.yaml                    ← gates, evolution, partialAutonomy, models
  .harness/benchmarks/suites/             ← held-out replay (default: workplace-smoke.json)
  .harness/meta/                          ← campaigns, frontier, policy artifacts
  .harness/runtime/                       ← shadow-policy.json, live-policy.json (L3+)
  .harness/traces/                        ← per-task evidence
```

| Operator action | When | Effect (all workplaces) |
| --- | --- | --- |
| `setup-helios-forge` or **Repair** | First install / drift | `scaffoldWorkplaceEvolution` — suite + evolution YAML merge |
| Enable `operatorDashboards` + `sourceTreeVariants` | Before meaningful replay | Post-task replay + campaigns run |
| Edit suite cases or `evolution.defaultSuiteId` | When auto-detect is weak | Real exit-code signal for longitudinal frontier |
| Set `models.swarmBaseUrl` | Model-driven swarm | Swarm/meta lanes can reach endpoint |
| Enable `partialAutonomy` + set `maxLevel` | Closed loop | L2+ prompt/config apply after thresholds |

**Optional manual smoke fixture:** `Qwen Swi Reasoning Training pipeline` — useful for dogfooding with real pytest/npm commands; not a merge gate requirement.

---

## Target Loop (What “Fully Autonomous” Means Here)

```text
User chats (Pi + background harness task)
  → in-task evolution (BES / meta / memory / ICR)          [exists today]
  → post-task replay on held-out suite                     [partial — background only]
  → accumulate autonomy evidence + longitudinal trend      [partial]
  → apply policy autonomously by earned level              [shadow ledger only today]
  → next chat uses updated routing / context / strategy    [missing]
  → replay proves uplift or triggers rollback              [missing on live path]
```

### Autonomy Ladder (Earned, Not Default)

| Level | Name | What may change autonomously | Rollback |
| --- | --- | --- | --- |
| **L0** | Observe | Evidence + dashboards only | N/A |
| **L1** | Shadow | Write `shadow-policy.json` hints | Overwrite on next tick |
| **L2** | Advisory | Inject replay/frontier into prompt + adaptive search weights | Disable injection |
| **L3** | Reversible runtime | Merge `.harness/runtime/live-policy.json` (routing, ICR depth, swarm profile hints) | `rollback-drills.json` + shadow revert |
| **L4** | Promotion-eligible | Trust-kernel-gated `promotionLoop` for harness config variants | Human approval + drill required |

Default for new workplaces: **L2 advisory** when `partialAutonomy.enabled: true` and replay thresholds pass. **L3+** requires explicit `partialAutonomy.maxLevel` and passing rollback drills.

---

## Non-Negotiable Invariants

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

- `src/` and `package.json` remain trust-kernel blocked unless existing approval + promotion policy explicitly allows.
- All new surfaces default `evidenceOnly: true`, `canPromote: false` until integrated with `promotionLoop.js` + governance.
- Post-task hooks **must emit** `recursive_evolution.coordinated` on every full task completion (including `prompt_background`), even when replay/campaign gates are off or skipped.
- No synthetic replay on hot path when `evolution.syntheticReplay !== true`.
- Autonomous apply **must** record provenance: `replayReportId`, `policyVersion`, `autonomyLevel`, `rollbackDrillId`.

---

## Milestone Gates

Do not merge until all gates pass and `npm test` + `npm run release:smoke` are green.

| Gate | Requirement | Verification |
| --- | --- | --- |
| **G0** | Chat-spawned task emits `recursive_evolution.coordinated` | Extend `tests/harness-recursive-evolution-integration.test.js` with `source: prompt_background` |
| **G1** | Post-task replay runs on chat path (not only background) | Integration test: `replay.cycle_completed` on `task_*` with `source: prompt_background` |
| **G2** | Runtime consumes policy (L2+): adaptive search or BES sees replay hints | `tests/harness-runtime-policy-consumer.test.js` |
| **G3** | Replay feedback reaches next Pi prompt (L2) | `tests/harness-replay-feedback-bridge.test.js` |
| **G4** | `partial_autonomy.applied` on post-task path when thresholds met | Test: hook triggers apply without waiting for background tick |
| **G5** | Longitudinal trend can classify `improvement` on non-placeholder suite | `tests/harness-longitudinal-frontier.test.js` + fixture workplace with real pass/fail commands (not `exit(0)`-only) |
| **G6** | Rollback drill auto-runs on regression | `tests/harness-autonomy-rollback.test.js` |
| **G7** | UI shows loop status (not `[object Object]`) | `tests/harness-ui-discoverability.test.js` |

---

## Controller Responsibilities

1. Create dedicated branch/worktree (`superpowers:using-git-worktrees`).
2. **Prerequisite:** `2026-06-18-meta-harness-evolution-wiring` gates G0–G6 green (or cherry-pick equivalent).
3. Run **Chunk 0** recon subagents in parallel (read-only).
4. Dispatch **Workers 1–7 in parallel** (disjoint write scopes).
5. After each worker: spec reviewer → code quality reviewer; loop until approved.
6. Dispatch **Worker 8 (integration tests)** after Workers 1–5 export stable APIs.
7. Dispatch **serial Integration Worker** only after Workers 1–8 approved.
8. Optional manual smoke on any configured workplace (see below); SWI is a suggested dogfood fixture, not required for merge.
9. Update checkboxes here + short addendum in `docs/architecture/2026-06-17-implementation-reconciliation.md`.
10. Add row to `docs/superpowers/plans/README.md`.

---

## Subagent Dispatch Protocol

### Implementer prompt prefix

```text
You are implementing one worker from:
docs/superpowers/plans/2026-06-19-autonomous-self-improvement-loop-parallel-subagents.md

Worker ID: [WORKER_ID]

You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve earned-autonomy + trust-kernel invariants.
Use TDD: write failing tests first, then implementation, then focused verification.

Assigned files (ONLY these):
[FILE_LIST]

Non-negotiable:
- Workplace-agnostic: same behavior for any repo with .harness/config.yaml — no project-specific code paths
- Post-task chat path must reach recursive_evolution.coordinated (or emit skip reason)
- Runtime policy consumer must not mutate src/ or package.json
- Replay feedback must pass through quarantine for model-visible fields
- Autonomous apply must be reversible and provenance-tagged

Return exactly:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- changed files
- tests run (command + result)
- remaining concerns
```

### Shared integration chokepoints (serial only)

**Only the Integration Worker may edit:**

- `src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js`
- `src/harness-sidecar/meta/backgroundEvolutionWorker.js`
- `src/harness-sidecar/server.js`
- `src/server.js`
- `src/harness/harnessConfigService.js`
- `src/harness-sidecar/config/configLoader.js`
- `public/app.js`
- `docs/superpowers/plans/README.md`
- `docs/architecture/2026-06-17-implementation-reconciliation.md` (addendum only)

---

## Chunk 0: Recon (Parallel, Read-Only)

### Agent 0A: Chat Post-Task Truncation

**Read:** `src/harness-sidecar/server.js` (`runFullRuntimeSubsystems`, `createTask`); any `task_*` trace missing `recursive_evolution.coordinated` (e.g. SWI `task_mqiu2qyt_6es127/events.jsonl` if available).

**Return:** Exact line/function where trace stops before hook; whether `orchestrateSwarm` blocks, throws, or early-returns; recommend minimal fix (try/finally already at ~2517 — why insufficient?). Fix must apply to **all** workplaces, not one repo.

### Agent 0B: Policy Consumption Surfaces

**Read:** `partialAutonomyApply.js`, `adaptiveSearchScheduler.js`, `bes/laneRuntime.js`, `governanceLoop.js`, `autoApprovalPolicy.js`.

**Return:** Best injection points for L2 (advisory) vs L3 (live-policy merge); list of fields safe to auto-apply (routing weights, ICR depth, context profile, swarm concurrency).

### Agent 0C: Feedback Bridge Surfaces

**Read:** `src/harness/harnessFeedbackContext.js`, `src/server.js` (`prompt` handler), `buildHeliosChatContext`.

**Return:** Event types to add for replay/longitudinal; shape for model-visible quarantine; max token budget for feedback block.

### Agent 0D: Promotion + Rollback Path

**Read:** `promotionLoop.js`, `autonomyEvidenceAccumulator.js`, `partialAutonomyApply.js`, `.harness/governance/rollback-drills.json` shape.

**Return:** Minimal API to promote L3 live-policy when thresholds + drills pass; regression trigger wiring.

---

## Chunk 1: Worker 1 — Chat Post-Task Completion

**Owns:** guarantee post-task evolution runs for `prompt_background` tasks.

**Files:**
- Create: `src/harness-sidecar/meta/postTaskHookGuard.js`
- Create: `tests/harness-post-task-hook-guard.test.js`
- Modify: `tests/harness-recursive-evolution-integration.test.js` (extend)

**Checklist:**

- [ ] **Step 1: Failing tests**
  - `ensurePostTaskEvolutionEmitted({ emitEvent, runHooks })` calls hooks even if inner subsystem throws
  - Simulated `runFullRuntimeSubsystems` throw still emits `recursive_evolution.coordinated` with `coordinated: null` + `reason`
  - Integration: `createTask` with `source: 'prompt_background'` trace contains `recursive_evolution.coordinated`

- [ ] **Step 2: Implement `postTaskHookGuard.js`**
  - `wrapPostTaskEvolution({ task, emitEvent, runHooks })` — try/catch/finally, timing spans, skip reasons (`held_out_suite_missing`, `subsystem_error`)

- [ ] **Step 3: Export stable API** (integration wires into `server.js` later)

- [ ] **Step 4: Run tests**

```bash
node --test tests/harness-post-task-hook-guard.test.js tests/harness-recursive-evolution-integration.test.js
```

- [ ] **Step 5: Commit** `fix(harness): guard post-task evolution completion on chat tasks`

---

## Chunk 2: Worker 2 — Runtime Policy Consumer

**Owns:** read shadow/live policy and affect runtime decisions (L2/L3).

**Files:**
- Create: `src/harness-sidecar/meta/runtimePolicyStore.js`
- Create: `src/harness-sidecar/meta/runtimePolicyConsumer.js`
- Create: `tests/harness-runtime-policy-consumer.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - `loadRuntimePolicy({ workspaceRoot })` merges `shadow-policy.json` + optional `live-policy.json` with precedence rules
  - `applyRuntimePolicyToHarnessConfig(harnessConfig, policy)` returns new config (immutable) adjusting:
    - `adaptiveSearch.maxActionsPerTask` bounded delta from replay `aggregateScore`
    - `icr.branchBreadth` / `correctionDepth` capped by `partialAutonomy.maxLevel`
  - Never writes `src/`; returns `advisoryOnly: true` when level < L3

- [ ] **Step 2: Implement store + consumer**

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-runtime-policy-consumer.test.js
```

- [ ] **Step 4: Commit** `feat(harness): add runtime policy consumer for earned autonomy`

---

## Chunk 3: Worker 3 — Replay Feedback Bridge

**Owns:** close the gap between replay artifacts and next-turn agent behavior.

**Files:**
- Create: `src/harness-sidecar/meta/replayFeedbackBridge.js`
- Modify: `src/harness/harnessFeedbackContext.js`
- Create: `tests/harness-replay-feedback-bridge.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - `buildReplayFeedbackItems({ latestReplayReport, longitudinalTrend })` produces summaries
  - `HIGH_SIGNAL_EVENT_TYPES` includes `replay.cycle_completed`, `recursive_evolution.coordinated`, `partial_autonomy.applied`
  - `applyHarnessFeedbackToPrompt` includes replay delta + regression warning when `regressionCount > 0`
  - Model-visible fields pass through existing quarantine helper (import from sidecar quarantine module)

- [ ] **Step 2: Implement bridge** — read latest report from `.harness/benchmarks/replay-cycles/` or in-memory event payload

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-replay-feedback-bridge.test.js tests/harness-feedback-context.test.js
```

- [ ] **Step 4: Commit** `feat(harness): bridge replay evidence into chat feedback`

---

## Chunk 4: Worker 4 — Post-Task Autonomy Apply

**Owns:** run partial autonomy on post-task path, not only background worker.

**Files:**
- Create: `src/harness-sidecar/meta/postTaskAutonomyApply.js`
- Modify: `tests/partial-autonomy-apply.test.js` (extend)
- Create: `tests/harness-post-task-autonomy-apply.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - `runPostTaskAutonomyApply({ workspaceRoot, harnessConfig, replayReports, autonomyState })`:
    - evaluates thresholds via `evaluateAutonomyEvidenceThresholds`
    - calls `applyPartialAutonomousImprovements` when eligible
    - at L3+, writes `live-policy.json` from consumer output (trust-kernel allowed paths only)
  - Background worker delegates to shared module (no duplication — export from postTaskAutonomyApply)

- [ ] **Step 2: Implement shared apply orchestrator**

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-post-task-autonomy-apply.test.js tests/partial-autonomy-apply.test.js
```

- [ ] **Step 4: Commit** `feat(harness): unify post-task and background autonomy apply`

---

## Chunk 5: Worker 5 — Graduated Promotion + Rollback

**Owns:** regression detection → rollback drill → revert live policy.

**Files:**
- Create: `src/harness-sidecar/meta/autonomyRollbackRunner.js`
- Modify: `src/harness-sidecar/meta/autonomyEvidenceAccumulator.js` (only if new fields required)
- Create: `tests/harness-autonomy-rollback.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - Replay report with regressions increments state and blocks L3 apply
  - `runAutonomyRollbackDrill({ workspaceRoot, policyVersion })` restores prior `live-policy.json` snapshot
  - Persists drill to `.harness/governance/rollback-drills.json`
  - Emits `governance.rollback_drill_completed`

- [ ] **Step 2: Implement rollback runner** — integrate with `promotionLoop.js` for L4 eligibility signal only (no bypass)

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-autonomy-rollback.test.js
```

- [ ] **Step 4: Commit** `feat(harness): add autonomy rollback drills for live policy`

---

## Chunk 6: Worker 6 — Workplace-Agnostic Benchmark Detection

**Owns:** held-out suites that measure actual workplace quality for **any** repo Helios is configured on (generic detector, not project-specific hardcoding).

**Files:**
- Modify: `src/harness-sidecar/benchmarks/defaultHeldOutSuite.js`
- Create: `src/harness-sidecar/benchmarks/workplaceSuiteDetector.js`
- Create: `tests/harness-workplace-suite-detector.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - Detector finds `npm test`, `node --test`, `python -m pytest`, and common `package.json` / `pyproject.toml` script patterns
  - Example project-specific script (e.g. `python scripts/test_v3_paper.py`) detected when declared in workplace metadata — **no SWI-only code paths**
  - Falls back to `node -e process.exit(0)` only when no tests found (with `advisory: placeholder_suite` flag in suite metadata)
  - `scaffoldWorkplaceEvolution` does not overwrite operator-edited suite cases on repair (merge-only)

- [ ] **Step 2: Implement detector** — used by repair + evolution scaffold

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-workplace-suite-detector.test.js tests/harness-default-held-out-suite.test.js
```

- [ ] **Step 4: Commit** `feat(harness): detect real workplace test commands for replay suites`

---

## Chunk 7: Worker 7 — UI Loop Observability

**Owns:** operator visibility into closed-loop health.

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html` (only if new panel anchor needed)
- Modify: `tests/harness-ui-discoverability.test.js`

**Checklist:**

- [ ] **Step 1: Failing tests**
  - `icr.lane_completed` renders human-readable summary (not `[object Object]`)
  - New row: **Autonomy loop** — last replay delta, autonomy level, regression count, live vs shadow policy version
  - `recursive_evolution.coordinated` shows `sources` list (replay/campaign/icr)

- [ ] **Step 2: Implement render helpers** — `formatIcrLaneEvent`, `renderAutonomyLoopStatus`

- [ ] **Step 3: Run tests**

```bash
node --test tests/harness-ui-discoverability.test.js
```

- [ ] **Step 4: Commit** `feat(ui): show autonomous self-improvement loop status`

---

## Chunk 8: Worker 8 — Integration Tests (Parallel-Safe)

**Owns:** end-to-end tests without touching production chokepoints.

**Files:**
- Create: `tests/harness-autonomous-loop-integration.test.js`
- Create: `tests/fixtures/autonomous-loop-workplace/` (minimal workplace with fake passing/failing commands)

**Checklist:**

- [ ] **Step 1: Failing integration test** simulating:
  1. Task created (`prompt_background`)
  2. Post-task replay produces report with positive delta
  3. Autonomy apply writes shadow + live policy
  4. Runtime consumer adjusts harness config
  5. Feedback bridge includes replay summary
  6. Second task shows different adaptive search budget (bounded)

- [ ] **Step 2: Implement fixture workplace + harness sidecar test harness**

- [ ] **Step 3: Run**

```bash
node --test tests/harness-autonomous-loop-integration.test.js
```

- [ ] **Step 4: Commit** `test(harness): add autonomous self-improvement loop integration`

---

## Chunk 9: Serial Integration Worker

**Runs only after Workers 1–8 are APPROVED.**

**Wires:**

1. `server.js` — call `wrapPostTaskEvolution` at end of `runFullRuntimeSubsystems`; load runtime policy at task start via `applyRuntimePolicyToHarnessConfig`
2. `recursiveEvolutionRuntimeHook.js` — call `runPostTaskAutonomyApply` after orchestrator; pass replay reports
3. `backgroundEvolutionWorker.js` — delegate autonomy apply to shared module
4. `src/server.js` — refresh replay feedback before `applyHarnessFeedbackToPrompt`
5. `configLoader.js` / `harnessConfigService.js` — add `partialAutonomy.maxLevel`, `evolution.feedbackToChat: true` defaults
6. `public/app.js` — merge Worker 7 UI if not already present

**Integration checklist:**

- [x] `npm test` green
- [x] `npm run release:smoke` green
- [ ] Optional manual smoke on a configured workplace (see below)

- [x] **Commit** `feat(harness): wire autonomous self-improvement closed loop`

---

## Manual Smoke: Any Configured Workplace

Run on **any** repo where Helios is installed (Node app, Python project, monorepo, etc.). Steps are identical; only suite commands and config values differ per workplace.

**Suggested dogfood fixture (optional):** `Qwen Swi Reasoning Training pipeline` — `C:\Users\jackj\Github\Qwen Swi Reasoning Training pipeline`

1. Open target workplace in Helios; Settings → Workplace → **Repair** (merge evolution scaffold + detect test commands).
2. Enable in `.harness/config.yaml` (if not already):
   - `productionCapabilities.operatorDashboards.enabled: true`
   - `productionCapabilities.sourceTreeVariants.enabled: true`
   - `partialAutonomy.enabled: true` (and desired `maxLevel`)
3. Restart Helios sidecar (ensure latest `helios-forge` build).
4. Send a chat message; confirm harness events include `recursive_evolution.coordinated` on the **task_*** trace (not only `background-evolution`).
5. Send a second message; confirm `[Helios Harness Context]` block mentions replay delta/regression if present.
6. Inspect `.harness/runtime/live-policy.json` (if L3 enabled) and `shadow-policy.json`.
7. Confirm `.harness/benchmarks/replay-cycles/` gains a new file per chat task.
8. UI → Harness → Swarm: **Autonomy loop** row shows level + last delta.

**Pass criteria:** Same artifacts and events under `<workplace>/.harness/` regardless of which repo was used.

---

## Dependency Graph (Parallel Dispatch)

```text
Chunk 0 (recon) ── parallel read-only
        │
        ├─ Worker 1 (post-task guard)      ─┐
        ├─ Worker 2 (policy consumer)      ─┤
        ├─ Worker 3 (replay feedback)      ─┼─► Worker 8 (integration tests)
        ├─ Worker 4 (post-task apply)      ─┤         │
        ├─ Worker 5 (rollback)             ─┤         ▼
        ├─ Worker 6 (real benchmarks)      ─┤   Integration Worker (serial)
        └─ Worker 7 (UI)                   ─┘
```

**Safe parallel groups:**
- **Group A:** Workers 1, 6, 7 (disjoint: server guard / benchmarks / UI)
- **Group B:** Workers 2, 3, 5 (disjoint meta modules)
- **Group C:** Worker 4 (depends on Worker 2 API contract — start after Worker 2 exports `loadRuntimePolicy` interface, or mock in tests first)

---

## Config Additions (Per-Workplace YAML)

Merge into **each** workplace's `.harness/config.yaml` (via repair scaffold or operator edit). Defaults in `configLoader.js` keep gates off until explicitly enabled.

```yaml
productionCapabilities:
  operatorDashboards:
    enabled: true               # required for post-task replay
  sourceTreeVariants:
    enabled: true               # required for meta-harness campaigns

evolution:
  syntheticReplay: false
  defaultSuiteId: workplace-smoke
  persistFrontier: true
  feedbackToChat: true          # NEW — L2 prompt injection

partialAutonomy:
  enabled: true
  maxLevel: 2                   # 2=advisory default; 3=reversible live-policy
  thresholds:
    minReplayCycles: 3
    minRollbackDrills: 1
    maxRegressionCount: 0

models:
  swarmBaseUrl: null            # set per workplace when model-driven swarm is needed
```

---

## Success Criteria (Definition of Done)

1. **Every chat message** in **any configured workplace** that spawns a harness task completes the post-task evolution hook (event or explicit skip reason).
2. **Replay evidence** changes next-turn behavior (prompt context and/or harness config) without manual steps — same code path for all workplaces.
3. **Regressions** block apply and trigger rollback drill automatically.
4. **Fixture + optional dogfood workplace** show non-flat replay when held-out suite uses real pass/fail commands (not placeholder-only).
5. **Longitudinal frontier** can record `improvement` classification across ≥3 cycles per workplace.
6. All gates **G0–G7** pass in CI (temp/fixture workplaces — no single-repo dependency).

---

## Out of Scope (Follow-On Plans)

- Autonomous `src/` mutation (requires promotionLoop + human approval — L4 only).
- Fine-tuning model weights from replay (training pipeline integration).
- Multi-workplace federation / A2A policy sync (master plan M6).

---

## Checklist (Plan Meta)

- [ ] Chunk 0 recon complete
- [x] Workers 1–7 complete
- [x] Worker 8 complete
- [x] Integration Worker complete
- [ ] Optional manual smoke passed on at least one configured workplace
- [x] README + reconciliation updated
