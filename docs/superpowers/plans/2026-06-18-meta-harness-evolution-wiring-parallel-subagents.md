# Meta-Harness Evolution Wiring — Parallel Subagent Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the stub post-task recursive evolution loop with a **workplace-ready** meta-harness cycle that runs on every completed full task, uses real held-out replay + source-tree campaigns fed by task artifacts, and scaffolds correctly on **new workplace setup / repair**.

**Architecture:** Extract evolution wiring from `recursiveEvolutionRuntimeHook.js` into focused modules (`harnessEvolutionDefaults.js`, `taskReplayRunners.js`, `postTaskCampaignBindings.js`, `frontierPersistence.js`). Parallel workers own disjoint files + tests. A **serial Integration Worker** wires `recursiveEvolutionRuntimeHook.js`, `server.js`, `setup-helios-forge.js`, and `harnessConfigService.js` after domain workers are green. New workplaces get a default held-out suite, evolution config block, swarm endpoint placeholders, and `syntheticReplay: false` guard. Existing workplaces pick up the same via **Settings → Workplace → Repair**.

**Parent plan:** `docs/superpowers/plans/2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md` (M1/M3 proof spine)

**Tech Stack:** Node.js ESM, `node:test`, `heldOutSuiteStore.js`, `replayCycleRunner.js`, `metaHarnessCampaignRunner.js`, `sourceTreeVariantRunner.js`, `longitudinalFrontier.js`, `.harness/benchmarks/`, `.harness/meta/`, `scripts/setup-helios-forge.js`.

**Evidence from production workplaces (SWI pipeline):** Chat tasks never emitted `recursive_evolution.*`; only `background-evolution` ran stub replay (0.50→0.55) and overwrote a single `campaign-background-evolution.json`. This plan closes that gap.

---

## Non-Negotiable Invariants

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

- All new persisted records: `evidenceOnly: true`, `canPromote: false` unless integrating existing promotion policy explicitly.
- Default hot path: **no synthetic replay scores** when `evolution.syntheticReplay !== true`.
- `src/` mutation only through existing approval + trust kernel paths.
- Post-task hooks **must emit** `recursive_evolution.coordinated` on every full task completion (success or partial), even when gates are off.

---

## Milestone Gates

| Gate | Requirement | Verification |
| --- | --- | --- |
| **G0** | New workplace scaffold includes held-out suite + evolution config | `tests/setup-helios-forge.test.js` |
| **G1** | Full task emits `replay.cycle_completed` + `meta.campaign_cycle_completed` | `tests/harness-recursive-evolution-integration.test.js` (extend) |
| **G2** | Replay uses workplace suite, not stub 0.5/0.55 | `tests/harness-task-replay-runners.test.js` |
| **G3** | Campaign variant runs `sourceTreeVariantRunner` smoke command | `tests/harness-post-task-campaign-bindings.test.js` |
| **G4** | Per-task campaign report persisted (`campaign-<taskId>-<ts>.json`) | integration test + filesystem assert |
| **G5** | Frontier dashboard JSONL appended on replay | `tests/harness-frontier-persistence.test.js` |
| **G6** | Repair upgrades existing workplace without wiping config | `tests/harness-workplace-repair-evolution.test.js` |

Do not merge until **G0–G6** pass and `npm test` is green.

---

## Controller Responsibilities

1. Create dedicated branch/worktree (`superpowers:using-git-worktrees`).
2. Run **Chunk 0** recon subagents in parallel (read-only).
3. Dispatch **Workers 1–6 in parallel** (disjoint write scopes).
4. After each worker: spec reviewer → code quality reviewer; loop until approved.
5. Dispatch **Worker 7 (integration tests)** after Workers 1–4 export stable APIs.
6. Dispatch **serial Integration Worker** only after Workers 1–7 approved.
7. Run `npm test` and `npm run release:smoke`.
8. Update checkboxes in this plan + one paragraph in `2026-06-17-implementation-reconciliation.md`.

---

## Subagent Dispatch Protocol

### Implementer prompt prefix

```text
You are implementing one worker from:
docs/superpowers/plans/2026-06-18-meta-harness-evolution-wiring-parallel-subagents.md

Worker ID: [WORKER_ID]

You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve evidence-only authority.
Use TDD: write failing tests first, then implementation, then focused verification.

Assigned files (ONLY these):
[FILE_LIST]

Non-negotiable:
- No defaultBaselineRunner 0.5 / defaultCandidateRunner 0.55 on hot path when evolution.syntheticReplay is false
- Post-task campaign bindings must not passthrough-only variantRunner in production mode
- canPromote: false on all new evidence surfaces
- Workplace scaffold must not require manual .harness/ editing

Return exactly:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- changed files
- tests run (command + result)
- remaining concerns
```

### Shared integration chokepoints (serial only)

**Only the Integration Worker may edit:**

- `src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js`
- `src/harness-sidecar/server.js`
- `src/harness-sidecar/meta/backgroundEvolutionWorker.js`
- `scripts/setup-helios-forge.js`
- `src/harness/harnessConfigService.js`
- `src/harness-sidecar/config/configLoader.js`
- `public/app.js` (only if repair/status UI needs evolution readiness row)
- `docs/superpowers/plans/README.md`
- `docs/architecture/2026-06-17-implementation-reconciliation.md` (short addendum only)

---

## Chunk 0: Recon (Parallel, Read-Only)

### Agent 0A: Post-Task Hook Completion

**Read:** `src/harness-sidecar/server.js` (`runFullRuntimeSubsystems`, lines ~633–2528), `recursiveEvolutionRuntimeHook.js`.

**Return:** Why SWI `task_*` traces end before `recursive_evolution.coordinated`; whether `runPostTaskRecursiveEvolutionHooks` is skipped, throws, or events not traced; recommended `try/finally` placement.

### Agent 0B: Workplace Setup Surfaces

**Read:** `scripts/setup-helios-forge.js`, `src/harness/harnessConfigService.js` (`repairWorkplace`, `STANDARD_CONFIG_YAML`), `tests/setup-helios-forge.test.js`.

**Return:** Minimal API to add `scaffoldWorkplaceEvolution({ workspaceRoot })`; whether repair should merge evolution block into existing YAML.

### Agent 0C: Campaign + Variant Substrate

**Read:** `metaHarnessCampaignRunner.js`, `sourceTreeVariantRunner.js`, `harnessVariantWorkspace.js`, `tests/harness-meta-campaign-runner.test.js`.

**Return:** Exact `sourceTree.commandRunner` shape to pass from post-task bindings; how to feed swarm champion / meta candidate into proposer.

### Agent 0D: Replay Substrate

**Read:** `replayCycleRunner.js`, `heldOutSuiteStore.js`, `replayScheduler.js`, `tests/replay-cycle-runner.test.js`.

**Return:** How to build `baselineRunner` / `candidateRunner` from suite case `command` fields; fail-closed when suite missing.

---

## Chunk 1: Workplace Evolution Scaffold (Worker 1)

**Owns:** new workplace defaults — no hot-path edits.

**Files:**
- Create: `src/harness-sidecar/meta/harnessEvolutionDefaults.js`
- Create: `src/harness-sidecar/benchmarks/defaultHeldOutSuite.js`
- Create: `tests/harness-evolution-defaults.test.js`
- Create: `tests/harness-default-held-out-suite.test.js`

**Checklist:**

- [x] **Step 1: Write failing tests** for:
  - `buildDefaultEvolutionConfig()` → `{ syntheticReplay: false, defaultSuiteId: 'workplace-smoke', campaignMaxCycles: 3, persistFrontier: true, requireSwarmEndpoint: true }`
  - `formatEvolutionYamlSection()` emits `evolution:` block for config YAML
  - `buildDefaultHeldOutSuite({ workspaceRoot })` → suite with 2–3 cases running `node --test` or project-specific detect (`package.json` scripts.test)
  - `scaffoldWorkplaceEvolution({ workspaceRoot })` writes:
    - `.harness/benchmarks/suites/workplace-smoke.json`
    - `.harness/benchmarks/README.md` (operator doc, 10 lines)
    - merges evolution defaults into config if missing (does not overwrite operator edits)

- [x] **Step 2: Implement `harnessEvolutionDefaults.js`**

```js
export function buildDefaultEvolutionConfig() { /* ... */ }
export function formatEvolutionYamlSection(overrides = {}) { /* ... */ }
export async function scaffoldWorkplaceEvolution({ workspaceRoot, harnessConfig, force = false }) { /* ... */ }
export function resolveSwarmModelEndpoint(harnessConfig, modelProfiles) {
  // Prefer harnessConfig.models.swarmBaseUrl → profile.baseUrl → null + advisory reason
}
```

- [x] **Step 3: Implement `defaultHeldOutSuite.js`** — detect `npm test` / `python -m pytest` / fallback `node -e "process.exit(0)"` with **real exit codes**, not fixed quality scores.

- [x] **Step 4: Run tests**

```bash
node --test tests/harness-evolution-defaults.test.js tests/harness-default-held-out-suite.test.js
```

- [x] **Step 5: Commit** `feat(harness): add workplace evolution defaults and held-out suite scaffold`

---

## Chunk 2: Task Replay Runners (Worker 2)

**Owns:** real replay execution — replaces stub runners.

**Files:**
- Create: `src/harness-sidecar/benchmarks/taskReplayRunners.js`
- Create: `tests/harness-task-replay-runners.test.js`

**Checklist:**

- [x] **Step 1: Failing tests**
  - `createTaskReplayRunners({ workspaceRoot, suite, syntheticReplay: false })` runs case commands via `child_process.spawn`, maps exit code → `metrics.quality`
  - When suite has 0 cases → throw `HeldOutSuiteRequiredError` (hook catches → skip replay with reason, not stub)
  - When `syntheticReplay: true` → explicit opt-in stub for CI only

- [x] **Step 2: Implement runners**

```js
export class HeldOutSuiteRequiredError extends Error {}
export function createTaskReplayRunners({ workspaceRoot, suite, syntheticReplay = false, spawnImpl = spawn }) { /* ... */ }
```

- [x] **Step 3: Run tests** — `node --test tests/harness-task-replay-runners.test.js`

- [x] **Step 4: Commit** `feat(harness): add task replay runners backed by held-out suite commands`

---

## Chunk 3: Post-Task Campaign Bindings (Worker 3)

**Owns:** proposer/evaluator/variantRunner fed by task artifacts.

**Files:**
- Create: `src/harness-sidecar/meta/postTaskCampaignBindings.js`
- Create: `src/harness-sidecar/meta/taskEvolutionInputs.js`
- Create: `tests/harness-post-task-campaign-bindings.test.js`
- Create: `tests/harness-task-evolution-inputs.test.js`

**Checklist:**

- [x] **Step 1: Failing tests** for `loadTaskEvolutionInputs({ workspaceRoot, taskId })`:
  - Reads latest meta candidate under `.harness/meta/candidates/runtime_<taskId>_*/`
  - Reads swarm champion from trace summary if present
  - Reads harness optimizer proposal artifact path from trace artifacts
  - Returns empty object gracefully when missing (not throw)

- [x] **Step 2: Failing tests** for `createPostTaskCampaignBindings({ task, replayReports, evolutionInputs, harnessConfig })`:
  - `maxCycles` from `harnessConfig.evolution.campaignMaxCycles` (default 3)
  - `proposer` includes `sourceFiles` / `config` from evolution inputs when present
  - `variantRunner` is **not** passthrough-only — returns object with `sourceTreeManifest` when `createSourceTreeVariantRunner` used
  - `evaluator` uses replay report aggregateScore when present, not hard-coded 0.9 safety

- [x] **Step 3: Implement modules** (move logic out of `recursiveEvolutionRuntimeHook.js` without editing that file yet — export parallel API)

- [x] **Step 4: Run tests**

- [x] **Step 5: Commit** `feat(harness): add task-fed post-task campaign bindings`

---

## Chunk 4: Frontier + Background Tick Persistence (Worker 4)

**Owns:** longitudinal frontier + capability goal dead paths.

**Files:**
- Create: `src/harness-sidecar/meta/frontierPersistence.js`
- Modify: `src/harness-sidecar/meta/productionEvidenceIndex.js` (only if Worker 4 owns indexer — **prefer Integration Worker**; Worker 4 exports functions Integration calls)
- Create: `tests/harness-frontier-persistence.test.js`
- Create: `tests/harness-background-tick-writer.test.js`

**Checklist:**

- [x] **Step 1: Failing tests**
  - `appendFrontierDashboardEntry({ workspaceRoot, replayReport, campaignReport })` appends JSONL to `.harness/benchmarks/frontier-dashboard.jsonl`
  - `writeBackgroundTickRecord({ workspaceRoot, tickId, hookResults })` writes `.harness/meta/background-ticks/<tickId>.json`
  - `summarizeFrontierFromHistory` uses `longitudinalFrontier.appendLongitudinalFrontierCycle`

- [x] **Step 2: Implement `frontierPersistence.js`**

- [x] **Step 3: Run tests**

- [x] **Step 4: Commit** `feat(harness): persist frontier history and background tick records`

---

## Chunk 5: Swarm Endpoint Resolution (Worker 5)

**Owns:** fix `swarm.model_gateway_unavailable` on new workplaces when profile has no baseUrl.

**Files:**
- Create: `src/harness-sidecar/swarm/resolveSwarmRuntime.js`
- Create: `tests/harness-resolve-swarm-runtime.test.js`

**Checklist:**

- [x] **Step 1: Failing tests**
  - Resolves `baseUrl` from `harnessConfig.models.swarmBaseUrl` first
  - Falls back to model profile `baseUrl` when set
  - When missing: returns `{ gateway: null, advisory: { reason: 'swarm_endpoint_unconfigured', setupHint: 'Set models.swarmBaseUrl in .harness/config.yaml or HELIOS_SWARM_MODEL_BASE_URL' } }` — does not silently disable without event reason

- [x] **Step 2: Implement** (extract from `server.js` `createRuntimeSwarmModelGateway` logic into testable module)

- [x] **Step 3: Run tests**

- [x] **Step 4: Commit** `feat(harness): centralize swarm endpoint resolution with setup hints`

---

## Chunk 6: Hook Reliability + Synthetic Guard (Worker 6)

**Owns:** post-task hook orchestration module (pre-integration).

**Files:**
- Create: `src/harness-sidecar/meta/postTaskEvolutionOrchestrator.js`
- Create: `tests/harness-post-task-evolution-orchestrator.test.js`

**Checklist:**

- [x] **Step 1: Failing tests** for `runPostTaskEvolutionOrchestrator({ workspaceRoot, harnessConfig, task, emitEvent, deps })`:
  - Always emits `recursive_evolution.coordinated` in `finally`
  - When `operatorDashboards` gate on + no suite → `replay.skipped` with `held_out_suite_missing`, **no stub scores**
  - When `sourceTreeVariants` gate on → campaign save uses unique report id `campaign-<taskId>-<iso>.json`
  - Calls injected `appendFrontierDashboardEntry` after replay+campaign
  - Calls `writeBackgroundTickRecord` when `task.source === 'background'`

- [x] **Step 2: Implement orchestrator** composing Workers 2–4 APIs (dependency injection for tests)

- [x] **Step 3: Run tests**

- [x] **Step 4: Commit** `feat(harness): add post-task evolution orchestrator with fail-closed replay`

---

## Chunk 7: Integration Tests (Worker 7)

**Owns:** end-to-end tests only.

**Files:**
- Create: `tests/harness-meta-evolution-workplace-integration.test.js`
- Modify: `tests/harness-recursive-evolution-integration.test.js` (extend, do not gut)

**Checklist:**

- [x] **Step 1: Failing integration test** — temp workplace:
  1. `setupHeliosForge({ workspaceRoot })` → assert `.harness/benchmarks/suites/workplace-smoke.json` exists
  2. `runPostTaskEvolutionOrchestrator` with full gates → replay + campaign files created
  3. Assert replay `aggregateScore` is **not** exactly 0.05 with baseline 0.5 / candidate 0.55 unless `syntheticReplay: true`
  4. Assert `meta.campaign_cycle_completed` payload has `cycles.length >= 1` and variant dir under `.harness/meta/harness-variants/`

- [x] **Step 2: Run test** (expect fail until Integration Worker)

- [x] **Step 3: Commit** `test(harness): add workplace meta-evolution integration coverage`

---

## Chunk 8: Serial Integration Worker

**Runs only after Workers 1–7 are approved.**

**Files:**
- Modify: `src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js` — thin wrapper delegating to `postTaskEvolutionOrchestrator`
- Modify: `src/harness-sidecar/server.js`:
  - Wrap tail of `runFullRuntimeSubsystems` in `try/finally` so hooks always run
  - Use `resolveSwarmRuntime` from Worker 5
  - Ensure `runPostTaskRecursiveEvolutionHooks` errors are caught, emitted as `recursive_evolution.failed`, then rethrown or logged without skipping `finally` coordination event
- Modify: `scripts/setup-helios-forge.js` — call `scaffoldWorkplaceEvolution` after config + package install
- Modify: `src/harness/harnessConfigService.js` — `repairWorkplace` calls `scaffoldWorkplaceEvolution({ merge: true })`; extend `STANDARD_CONFIG_YAML` with `formatEvolutionYamlSection()` + `models.swarmBaseUrl` placeholder comment
- Modify: `src/harness-sidecar/config/configLoader.js` — add `evolution` defaults to `DEFAULT_HARNESS_CONFIG`
- Modify: `src/harness-sidecar/meta/backgroundEvolutionWorker.js` — pass hook results to `writeBackgroundTickRecord`
- Modify: `src/harness-sidecar/meta/productionEvidenceIndex.js` — map `background_tick_record` substrate tokens when tick files exist
- Modify: `public/app.js` — optional: Workplace status shows `evolutionReady: true/false` from `getWorkplaceStatus`

**Checklist:**

- [x] **Step 1: Wire orchestrator into hook** — remove inline `createPostTaskCampaignBindings`, stub runners, and `smokeSuiteFallback` from hot path when `evolution.syntheticReplay !== true`

- [x] **Step 2: Wire setup + repair**

```js
// setup-helios-forge.js (after ensureLocalConfig)
await scaffoldWorkplaceEvolution({ workspaceRoot: resolvedWorkspaceRoot, force: forceConfig });
```

- [x] **Step 3: Extend `getWorkplaceStatus`** — report `heldOutSuite`, `evolutionConfig`, `swarmEndpointConfigured`

- [x] **Step 4: Run full verification**

```bash
node --test tests/harness-meta-evolution-workplace-integration.test.js
node --test tests/harness-recursive-evolution-integration.test.js
node --test tests/setup-helios-forge.test.js
npm test
```

- [x] **Step 5: Commit** `feat(harness): wire workplace-ready meta-harness evolution loop`

---

## Chunk 9: Documentation + Reconciliation

**Files:**
- Modify: `docs/superpowers/plans/README.md` — add this plan to Active Plans table
- Modify: `docs/architecture/2026-06-17-implementation-reconciliation.md` — § Known Gaps: note stub post-task bindings **scheduled for removal** by this plan; add G0–G6 status after merge
- Modify: `docs/desktop-install.md` or `docs/architecture/current-architecture.md` — short § "Workplace evolution scaffold" (10 lines): held-out suite, `models.swarmBaseUrl`, repair path

- [x] **Step 1: Doc updates**
- [x] **Step 2: Commit** `docs: meta-harness evolution wiring plan reconciliation`

---

## Parallel Dispatch Schedule

```text
Phase A (parallel):  Chunk 0 agents 0A–0D
Phase B (parallel):  Workers 1, 2, 3, 4, 5, 6
Phase C (parallel):  Worker 7 after Worker 1–4 APIs stable (can start tests with mocks)
Phase D (serial):    Integration Worker (Chunk 8)
Phase E (serial):    Docs + npm test + release:smoke (Chunk 9)
```

| Worker | Can start after | Blocks |
| --- | --- | --- |
| 1 Workplace scaffold | Chunk 0 | Integration (setup) |
| 2 Replay runners | Chunk 0D | 6, 7, Integration |
| 3 Campaign bindings | Chunk 0C | 6, 7, Integration |
| 4 Frontier persistence | — | 6, Integration |
| 5 Swarm resolve | Chunk 0B | Integration |
| 6 Orchestrator | 2, 3, 4 APIs | Integration |
| 7 Integration tests | 1–4 stubs | Integration |
| Integration | 1–7 green | Merge |

---

## Default Workplace Config Snippet (after Integration)

New `.harness/config.yaml` includes:

```yaml
evolution:
  syntheticReplay: false
  defaultSuiteId: workplace-smoke
  campaignMaxCycles: 3
  persistFrontier: true
models:
  swarmBaseUrl: null  # REQUIRED for model-driven swarm — set to your OpenAI-compatible endpoint
  swarmModelId: null
```

Setup scaffolds `.harness/benchmarks/suites/workplace-smoke.json`. Repair merges missing keys without overwriting operator values.

---

## Out of Scope (Follow-Up Plans)

- Real `promotionLoop` closure in `coordinateRecursiveEvolution` (separate PR)
- `useModelRunners` ICR implementation (`2026-06-17-icr-wiring-parallel-subagents.md` Worker 4)
- Per-repo custom benchmark authoring UI (manual JSON edit is enough for v1)
- Auto-populate `models.swarmBaseUrl` from environment without operator consent

---

## Test Commands (Controller Final)

```bash
npm test
npm run release:smoke
node --test tests/harness-meta-evolution-workplace-integration.test.js
```

**Manual smoke (SWI pipeline workplace):**

1. Settings → Workplace → Repair
2. Set `models.swarmBaseUrl` in `.harness/config.yaml`
3. Send one chat message → confirm `.harness/meta/campaign-reports/campaign-task_*` created
4. Confirm replay files are **not** all `aggregateScore: 0.05` unless `evolution.syntheticReplay: true`

---

## Success Criteria

A new Helios Forge workplace is **evolution-ready** when:

1. Setup/repair created held-out suite + evolution config block
2. Every completed full harness task emits recursive evolution events
3. Replay runs real commands from the suite (fail-closed without suite)
4. Campaigns produce isolated variant dirs and per-task reports
5. Frontier JSONL grows over time
6. Background ticks write `background-ticks/*.json`
7. Operator sees clear advisory when swarm endpoint is unset — not silent `model_gateway_unavailable`
