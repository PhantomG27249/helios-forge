# Wide AB-MCTS Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy AB-MCTS as a broad, budget-aware online search scheduler across Helios Forge without replacing the existing RHO, BES, verifier, swarm, memory, research, and safe-apply spine.

**Architecture:** Add a sidecar scheduler that answers one question at runtime: should the harness spend the next unit of budget going wider, going deeper, switching worker/profile, gathering more evidence, or stopping? RHO remains the retrospective hard-case miner, BES remains the candidate and goal-refinement engine, verifiers remain the reward/safety signal, and AB-MCTS becomes the adaptive allocation layer across those subsystems.

**Tech Stack:** Node.js ESM, `node:test`, Helios sidecar modules under `src/harness-sidecar`, trace JSONL, `.harness` workspace state, existing BES/RHO/meta/verifier/swarm modules.

---

## Current Context

Helios already has the pieces AB-MCTS should coordinate:

- `src/harness-sidecar/bes/mctsPolicy.js`: existing UCT-style node policy.
- `src/harness-sidecar/bes/toolTreePlanner.js`: tool-tree expansion and evaluation.
- `src/harness-sidecar/bes/bidirectionalSearchLoop.js`: backward goals plus forward candidate refinement.
- `src/harness-sidecar/meta/besMetaOptimizer.js`: RHO/BES candidate generation.
- `src/harness-sidecar/swarm/attemptScheduler.js`: seeded, ToolTree, and evolution-aware swarm attempt planning.
- `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`: hard-case feedback into RHO/meta.
- `src/harness-sidecar/tools/verifierSelector.js`: verifier selection.
- `src/harness-sidecar/budget/*`: budget hierarchy, downshift gates, and cost-aware allocation.
- `docs/architecture/ab-mcts-backend-opportunity.md`: architecture note for the scheduler opportunity.

Do not introduce AB-MCTS as a second meta harness. It should be a small ask/tell policy that sits between planning options and budget spend.

## Search Arms

Initial arms should be explicit and testable:

| Arm | Meaning | Example target |
| --- | --- | --- |
| `go_wider` | Spawn or sample new candidate paths. | More swarm attempts, more skill candidates, broader retrieval, alternate tool plan. |
| `go_deeper` | Improve the current best path. | Refine champion patch, expand promising tool tree, deepen visual analysis. |
| `switch_worker` | Change role/profile/model/tool lane. | Code worker to verifier worker, text model to VLM, cheap profile to strong profile. |
| `gather_evidence` | Spend budget on verification or retrieval. | Extra verifier, screenshot/OCR/PDF artifact, graph-neighbor context. |
| `stop_or_promote` | Stop search, report, or queue promotion. | Champion selected, no budget left, promotion candidate ready. |

## Chunk 1: Core AB-MCTS Scheduler

### Task 1: Add Scheduler State And Selection

**Files:**
- Create: `src/harness-sidecar/bes/adaptiveSearchScheduler.js`
- Test: `tests/harness-bes-adaptive-search-scheduler.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- first selection prefers `go_wider` when no arm has evidence;
- strong reward shifts toward `go_deeper`;
- budget pressure removes expensive arms;
- deterministic test RNG produces stable choices;
- scheduler returns trace metadata explaining arm scores.

Run:

```powershell
npm test -- tests/harness-bes-adaptive-search-scheduler.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement core API**

Create exports:

```js
export function createAdaptiveSearchScheduler({ arms, rng, policy } = {}) {}
export function selectAdaptiveSearchAction({ scheduler, context } = {}) {}
export function recordAdaptiveSearchOutcome({ scheduler, actionId, reward, evidence } = {}) {}
```

Use a deterministic Thompson-sampling-compatible implementation for production, with injected RNG for tests. Keep state serializable.

- [ ] **Step 3: Add reward normalization**

Normalize reward from:

- verifier pass/fail and confidence;
- BES goal satisfaction;
- swarm champion score;
- cost/latency;
- visual/VLM evidence quality;
- safety or approval rejection.

Do not let a single raw score dominate without normalization.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/harness-bes-adaptive-search-scheduler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/bes/adaptiveSearchScheduler.js tests/harness-bes-adaptive-search-scheduler.test.js
git commit -m "feat(bes): add adaptive search scheduler"
```

## Chunk 2: Swarm And Tool Planning Integration

### Task 2: Use AB-MCTS In Attempt Scheduling

**Files:**
- Modify: `src/harness-sidecar/swarm/attemptScheduler.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Test: `tests/harness-swarm-ab-mcts-planner.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- scheduler can choose more seeded diversity when evidence is weak;
- scheduler can choose champion refinement when a lineage is strong;
- scheduler can choose verifier/evidence gather when confidence is low;
- disabled feature flag preserves current scheduling behavior.

Run:

```powershell
npm test -- tests/harness-swarm-ab-mcts-planner.test.js
```

Expected: FAIL.

- [ ] **Step 2: Add advisory scheduler input**

Pass the scheduler into `planEvolutionSwarmAttempts` as optional metadata. If no scheduler or feature flag is off, return existing attempt plans unchanged.

- [ ] **Step 3: Record outcomes**

When attempts complete, call `recordAdaptiveSearchOutcome` with:

- attempt id and lineage;
- worker role/profile;
- score;
- verifier evidence;
- cost and elapsed time;
- safety and approval state.

- [ ] **Step 4: Emit events**

Emit trace events:

- `ab_mcts.action_selected`
- `ab_mcts.outcome_recorded`
- `ab_mcts.scheduler_summary`

Events must include no secrets and should include only stable ids, arm names, scores, and rationale.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/harness-swarm-ab-mcts-planner.test.js tests/harness-swarm-runtime.test.js
git add src/harness-sidecar/swarm/attemptScheduler.js src/harness-sidecar/swarm/swarmOrchestrator.js tests/harness-swarm-ab-mcts-planner.test.js
git commit -m "feat(swarm): route attempts through adaptive search"
```

## Chunk 3: Meta, RHO, And BES Integration

### Task 3: Route Meta Candidates Through AB-MCTS

**Files:**
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-meta-ab-mcts.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- RHO hard cases become scheduler context;
- BES candidate families become arms or branch metadata;
- repeated failures increase `go_wider`;
- promising candidate lineage increases `go_deeper`;
- promotion remains approval-gated.

- [ ] **Step 2: Add scheduler context builder**

Create helper in `besMetaOptimizer.js` that converts:

- RHO coreset reasons;
- BES subgoals;
- diversity collapse;
- baseline frontier;
- candidate archive;
- held-out verifier status;

into scheduler input.

- [ ] **Step 3: Keep promotion separate**

AB-MCTS may recommend `stop_or_promote`, but `promotionPolicy.js` remains the only promotion decision point.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-meta-ab-mcts.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-meta-promotion.test.js
git add src/harness-sidecar/meta/besMetaOptimizer.js src/harness-sidecar/rho/coresetBuilder.js tests/harness-meta-ab-mcts.test.js
git commit -m "feat(meta): add adaptive search context"
```

## Chunk 4: Verifier, Visual, Research, Memory, And Skill Lanes

### Task 4: Add Scheduler Adapters For Additional Subsystems

**Files:**
- Create: `src/harness-sidecar/bes/adaptiveSearchAdapters.js`
- Modify: `src/harness-sidecar/tools/verifierSelector.js`
- Modify: `src/harness-sidecar/research/deepResearchManager.js`
- Modify: `src/harness-sidecar/rag/unifiedContextComposer.js`
- Modify: `src/harness-sidecar/memory/*` only where a narrow adapter is needed.
- Test: `tests/harness-ab-mcts-adapters.test.js`

- [ ] **Step 1: Write adapter tests**

Each adapter should expose an ask/tell shape:

```js
const context = buildAdaptiveSearchContextForVerifier(input);
const reward = normalizeAdaptiveSearchRewardForVerifier(output);
```

- [ ] **Step 2: Implement verifier adapter**

Use AB-MCTS to choose:

- normal verifier vs visual verifier;
- extra held-out replay vs current evidence;
- strict vs cheap verifier profile under budget pressure.

- [ ] **Step 3: Implement visual adapter**

Use AB-MCTS to choose:

- more screenshots/PDF/OCR/diff artifacts;
- deeper VLM analysis of one artifact;
- stop when artifact evidence is sufficient.

- [ ] **Step 4: Implement research adapter**

Use AB-MCTS to choose:

- more sources;
- contradiction pass;
- synthesis/refinement;
- figure or visual evidence pass.

- [ ] **Step 5: Implement context/memory adapter**

Use AB-MCTS to choose:

- broader retrieval;
- graph-neighborhood deepening;
- memory candidate review;
- compaction or summarization.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test -- tests/harness-ab-mcts-adapters.test.js tests/harness-verifier-selector.test.js tests/harness-deep-research-v2.test.js tests/harness-rag-production.test.js
git add src/harness-sidecar/bes/adaptiveSearchAdapters.js src/harness-sidecar/tools/verifierSelector.js src/harness-sidecar/research/deepResearchManager.js src/harness-sidecar/rag/unifiedContextComposer.js tests/harness-ab-mcts-adapters.test.js
git commit -m "feat(bes): add adaptive search adapters"
```

## Chunk 5: Runtime Flag, UI, And Trace Replay

### Task 5: Make AB-MCTS Visible And Replayable

**Files:**
- Modify: `src/harness-sidecar/config/configLoader.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/app.css`
- Test: `tests/harness-config.test.js`
- Test: `tests/harness-trace-replay.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Add config flag**

Add disabled-by-default config:

```yaml
features:
  adaptiveSearch: false
adaptiveSearch:
  mode: advisory
  maxActionsPerTask: 8
  allowProfileSwitching: true
```

- [ ] **Step 2: Add trace replay support**

Trace replay should show what AB-MCTS would have selected under the same evidence, without mutating task state.

- [ ] **Step 3: Add UI observability**

In the harness panel, show:

- current selected arm;
- recent reward;
- wider vs deeper balance;
- budget impact;
- disabled/advisory/enabled status.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-config.test.js tests/harness-trace-replay.test.js tests/harness-ui-discoverability.test.js
git add src/harness-sidecar/config/configLoader.js src/harness-sidecar/server.js public/app.js public/index.html public/app.css tests/harness-config.test.js tests/harness-trace-replay.test.js tests/harness-ui-discoverability.test.js
git commit -m "feat(ui): expose adaptive search status"
```

## Promotion And Safety Rules

- AB-MCTS must be advisory by default.
- It cannot directly apply changes or promote candidates.
- It can only allocate budget and recommend next actions.
- Any evolved scheduler policy must pass trace replay, held-out verifier cases, budget checks, and approval gates.
- All trace events must redact private URLs, model endpoints, tokens, and provider secrets.

## Final Verification

Run:

```powershell
npm test
npm run release:smoke
git diff --check
```

Expected:

- all tests pass with existing skipped symlink cases only;
- release smoke passes;
- no whitespace errors.
