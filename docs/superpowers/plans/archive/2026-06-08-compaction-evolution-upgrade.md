# Compaction Evolution Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Helios Forge compaction from a fixed priority packer into a schema-aware, verifiable, trace-replayable, and BES/RHO-evolvable context-management system.

**Architecture:** Keep the existing context pressure ladder and working-memory modules as the runtime baseline. Add structured compaction profiles, source-pointer preservation, compaction verification, replay datasets, and shadow evolution policies before allowing any runtime behavior change. Use Codex and Claude Code as reference designs for lifecycle hooks, automatic compaction, subagent context isolation, memory scope clarity, and operator-visible context diagnostics.

**Tech Stack:** Node.js ESM, `node:test`, Helios sidecar modules under `src/harness-sidecar`, trace JSONL, `.harness` workspace state, BES/RHO/meta policy evolution.

---

## Current Baseline

Helios already has useful compaction foundations:

- `src/harness-sidecar/context/contextWindowManager.js` has pressure thresholds at 70, 80, 90, and 95 percent.
- `src/harness-sidecar/context/workingMemory.js` preserves priority-zero items and compresses tool outputs/raw logs.
- `src/harness-sidecar/context/compaction.js` has a simple priority token packer.
- `src/harness-sidecar/core/traceCompactor.js` summarizes trace events into counts, artifacts, failures, decisions, and latest state.
- `src/harness-sidecar/meta/contextPolicyEvolution.js` proposes shadow-only context retrieval policies from context hard cases.
- `tests/harness-context-window-manager.test.js`, `tests/harness-context-policy-evolution.test.js`, and `tests/harness-trace-replay.test.js` cover the current behavior.

The missing pieces are:

- no structured compaction artifact/schema with required fields;
- no source-pointer and "do not lose" verifier;
- no compaction failure dataset or replay harness;
- no PreCompact/PostCompact style hook events;
- no `/context`-like operator breakdown;
- no BES/RHO loop over compaction prompts, schemas, trigger thresholds, or state merge rules;
- no subagent handoff summary scoring to stop swarm output from polluting the main task context.

## Reference Lessons

Codex comparison points:

- Codex exposes `PreCompact` and `PostCompact` hook events, with manual/auto matchers, so compaction can be observed and augmented by lifecycle policy.
- Codex memories are optional local recall, generated in the background, redacted, and explicitly not a replacement for checked-in rules.
- Codex subagents are positioned as a way to reduce context pollution by keeping noisy exploration/logs out of the main thread and returning summaries.

Claude Code comparison points:

- Claude Code documents what survives compaction: system prompt, root instructions, and auto memory are re-injected; path-scoped rules and nested instructions reload only when matching files are read.
- Claude Code supports `/compact` with focus instructions, `/clear`, `/context`, and subagents as context-management tools.
- Claude Code subagents run in separate context windows and can be foreground/background, with tool and permission controls.
- Claude Code settings have explicit managed/user/project/local scopes, which is a useful model for separating durable rules, generated memory, and local compaction policy experiments.

Reference inputs came from the earlier local comparison notes against Codex and Claude Code. The implementation plan below is intentionally scoped to Helios Forge modules and the existing model endpoint surface; it does not introduce external runtime calls.

---

## File Structure

Create:

- `src/harness-sidecar/context/compactionSchema.js`: canonical compaction schema, required fields, source-pointer normalization, schema validation.
- `src/harness-sidecar/context/compactionProfiles.js`: profile definitions for `coding`, `research`, `visual`, `swarm`, `meta`, and `recovery` tasks.
- `src/harness-sidecar/context/compactionPlanner.js`: converts pressure state, task type, trace events, memory, graph, and budget state into a compaction plan.
- `src/harness-sidecar/context/compactionVerifier.js`: audits a compacted artifact for lost constraints, hallucinated decisions, missing source pointers, missing tests, and dropped high-priority items.
- `src/harness-sidecar/context/compactionReplay.js`: replays historical traces against candidate compaction policies and reports continuation quality.
- `src/harness-sidecar/meta/compactionPolicyEvolution.js`: RHO/BES/Shinka-style shadow policy candidates for prompt/schema/threshold/state-merge compaction behavior.
- `tests/harness-compaction-schema.test.js`
- `tests/harness-compaction-verifier.test.js`
- `tests/harness-compaction-replay.test.js`
- `tests/harness-compaction-policy-evolution.test.js`

Modify:

- `src/harness-sidecar/context/compaction.js`: replace simple packer internals with schema-aware packing while preserving public behavior.
- `src/harness-sidecar/context/contextWindowManager.js`: emit structured compaction plan/artifact and PreCompact/PostCompact-like events.
- `src/harness-sidecar/context/workingMemory.js`: preserve source pointers and compressed-from metadata.
- `src/harness-sidecar/core/traceCompactor.js`: include compaction events, lost-context warnings, and continuation checkpoints.
- `src/harness-sidecar/rho/coresetBuilder.js`: include compaction failures and continuation failures as hard cases.
- `src/harness-sidecar/meta/contextPolicyEvolution.js`: route context hard cases that are actually compaction failures to the new compaction policy evolver.
- `src/harness-sidecar/server.js`: record compaction events in traces and expose summary state to the UI.
- `public/app.js`, `public/index.html`, `public/app.css`: add a compact context-pressure/compaction status panel.
- `docs/architecture/feature-architecture-map.md`: document the upgraded compaction flow.

---

## Task 1: Canonical Compaction Artifact Schema

**Files:**
- Create: `src/harness-sidecar/context/compactionSchema.js`
- Modify: `src/harness-sidecar/context/compaction.js`
- Test: `tests/harness-compaction-schema.test.js`

- [ ] **Step 1: Write failing schema tests**

Test that a compacted artifact must include:

- `objective`
- `successCriteria`
- `userConstraints`
- `nonGoals`
- `activeFiles`
- `touchedFiles`
- `commandsRun`
- `failingTests`
- `passingTests`
- `decisions`
- `failedAttempts`
- `nextSteps`
- `sourcePointers`
- `unresolvedQuestions`
- `environmentState`
- `riskFlags`

Run:

```powershell
npm test -- tests/harness-compaction-schema.test.js
```

Expected: fail because `compactionSchema.js` does not exist.

- [ ] **Step 2: Implement schema normalization**

Add:

```js
export const REQUIRED_COMPACTION_FIELDS = [
  'objective',
  'successCriteria',
  'userConstraints',
  'nonGoals',
  'activeFiles',
  'touchedFiles',
  'commandsRun',
  'failingTests',
  'passingTests',
  'decisions',
  'failedAttempts',
  'nextSteps',
  'sourcePointers',
  'unresolvedQuestions',
  'environmentState',
  'riskFlags',
];

export function createEmptyCompactionArtifact(overrides = {}) {
  return {
    objective: null,
    successCriteria: [],
    userConstraints: [],
    nonGoals: [],
    activeFiles: [],
    touchedFiles: [],
    commandsRun: [],
    failingTests: [],
    passingTests: [],
    decisions: [],
    failedAttempts: [],
    nextSteps: [],
    sourcePointers: [],
    unresolvedQuestions: [],
    environmentState: {},
    riskFlags: [],
    ...overrides,
  };
}
```

Also add `normalizeSourcePointer(pointer)` and `validateCompactionArtifact(artifact)`.

- [ ] **Step 3: Wire existing packer output**

Update `compactContextItems()` so it returns:

```js
{
  artifact,
  items,
  excluded,
  tokensEstimated,
}
```

Keep the existing `items`, `excluded`, and `tokensEstimated` fields for compatibility.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-compaction-schema.test.js tests/harness-context-window-manager.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/context/compactionSchema.js src/harness-sidecar/context/compaction.js tests/harness-compaction-schema.test.js
git commit -m "feat(context): add structured compaction schema"
```

---

## Task 2: Source-Preserving Compaction Planner

**Files:**
- Create: `src/harness-sidecar/context/compactionProfiles.js`
- Create: `src/harness-sidecar/context/compactionPlanner.js`
- Modify: `src/harness-sidecar/context/contextWindowManager.js`
- Modify: `src/harness-sidecar/context/workingMemory.js`
- Test: `tests/harness-compaction-schema.test.js`
- Test: `tests/harness-context-window-manager.test.js`

- [ ] **Step 1: Write failing planner tests**

Cover:

- coding profile preserves active files, tests, commands, and decisions;
- research profile preserves claims, citations, sources, and contradiction notes;
- visual profile preserves screenshots, OCR/PDF/diff artifacts, VLM findings, and target URLs with private components redacted;
- swarm profile preserves subagent summaries, champion rationale, rejected attempts, and conflict notes;
- meta profile preserves candidate id, policy family, held-out score, approval state, and rollback metadata.

- [ ] **Step 2: Add profiles**

`compactionProfiles.js` should export:

```js
export const COMPACTION_PROFILES = {
  coding: { requiredSections: [...], preserveTypes: [...] },
  research: { requiredSections: [...], preserveTypes: [...] },
  visual: { requiredSections: [...], preserveTypes: [...] },
  swarm: { requiredSections: [...], preserveTypes: [...] },
  meta: { requiredSections: [...], preserveTypes: [...] },
  recovery: { requiredSections: [...], preserveTypes: [...] },
};
```

- [ ] **Step 3: Add planner**

`planCompaction({ task, pressureState, items, traceSummary, memory, graph, budgetState, profile })` should return:

- selected profile;
- trigger reason;
- target token budget;
- must-keep item ids;
- compression strategy;
- expected artifact fields;
- warning flags.

- [ ] **Step 4: Wire `evaluateContextWindow`**

Add optional args:

```js
task = {},
traceSummary = null,
budgetState = null,
profile = 'coding',
```

Return `compactionPlan` inside the context window state.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/harness-compaction-schema.test.js tests/harness-context-window-manager.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/harness-sidecar/context/compactionProfiles.js src/harness-sidecar/context/compactionPlanner.js src/harness-sidecar/context/contextWindowManager.js src/harness-sidecar/context/workingMemory.js tests/harness-compaction-schema.test.js tests/harness-context-window-manager.test.js
git commit -m "feat(context): plan source-preserving compaction"
```

---

## Task 3: Compaction Verifier And Lost-Constraint Audit

**Files:**
- Create: `src/harness-sidecar/context/compactionVerifier.js`
- Modify: `src/harness-sidecar/core/traceCompactor.js`
- Test: `tests/harness-compaction-verifier.test.js`
- Test: `tests/harness-trace-replay.test.js`

- [ ] **Step 1: Write failing verifier tests**

Verifier must flag:

- missing user constraints;
- missing active/touched files;
- missing failing tests;
- missing source pointers;
- hallucinated decisions with no source;
- stale assumptions contradicted by later trace events;
- dropped priority-zero items;
- missing "do not repeat" failed attempts.

- [ ] **Step 2: Implement verifier**

Export:

```js
export function verifyCompactionArtifact({
  originalItems = [],
  artifact,
  traceEvents = [],
  requiredFields = REQUIRED_COMPACTION_FIELDS,
} = {}) {
  // returns { passed, score, findings, missingFields, lostItems, hallucinations }
}
```

Score should start at `1.0` and apply deterministic penalties. Do not use model judging in V1.

- [ ] **Step 3: Emit trace summary fields**

Update `compactTraceEvents()` to collect:

- `compactionEvents`
- `compactionFindings`
- `lostContextWarnings`
- `continuationCheckpoints`

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-compaction-verifier.test.js tests/harness-trace-replay.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/context/compactionVerifier.js src/harness-sidecar/core/traceCompactor.js tests/harness-compaction-verifier.test.js tests/harness-trace-replay.test.js
git commit -m "feat(context): verify compaction artifacts"
```

---

## Task 4: PreCompact/PostCompact Events And Operator UI

**Files:**
- Modify: `src/harness-sidecar/context/contextWindowManager.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `tests/harness-context-window-manager.test.js`
- Test: `tests/harness-sidecar.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing event tests**

Assert the sidecar emits:

- `context.pre_compact`
- `context.compacted`
- `context.post_compact`
- `context.compaction_verification`

Each event should include `trigger`, `profile`, `pressurePercent`, `artifactId` or inline artifact summary, `tokensBefore`, `tokensAfter`, `verificationScore`, and `findings`.

- [ ] **Step 2: Add event emission**

Map Codex/Claude lessons into Helios names without pretending to be either product:

- `manual` trigger for operator-requested compaction;
- `auto` trigger for pressure threshold;
- `subagent_handoff` trigger for large subagent results;
- `task_boundary` trigger for switching goals.

- [ ] **Step 3: Add context panel**

Add a compact UI panel that shows:

- context pressure percent;
- active compaction profile;
- latest compaction score;
- dropped item count;
- lost constraint count;
- next suggested action.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-context-window-manager.test.js tests/harness-sidecar.test.js tests/harness-ui-discoverability.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/context/contextWindowManager.js src/harness-sidecar/server.js public/index.html public/app.js public/app.css tests/harness-context-window-manager.test.js tests/harness-sidecar.test.js tests/harness-ui-discoverability.test.js
git commit -m "feat(context): surface compaction lifecycle events"
```

---

## Task 5: Compaction Replay Dataset

**Files:**
- Create: `src/harness-sidecar/context/compactionReplay.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-compaction-replay.test.js`
- Test: `tests/harness-rho-coreset.test.js`

- [ ] **Step 1: Write failing replay tests**

Build fixtures where:

- full context succeeds but compacted context fails;
- compacted context loses an active file;
- compacted context loses a user constraint;
- compacted context preserves all required data and passes.

- [ ] **Step 2: Implement replay evaluator**

`evaluateCompactionReplay({ trace, artifact, continuationProbe })` should return:

- `caseId`
- `taskId`
- `score`
- `failureModes`
- `lostFields`
- `tokenReduction`
- `continuationRisk`
- `rhoReason`

Start with deterministic probes, not model calls.

- [ ] **Step 3: Feed RHO**

Update `buildRhoCoreset()` so compaction replay failures can produce reasons:

- `compaction_lost_constraint`
- `compaction_lost_file`
- `compaction_hallucinated_decision`
- `compaction_overcompressed`
- `compaction_bad_trigger`

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-compaction-replay.test.js tests/harness-rho-coreset.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/context/compactionReplay.js src/harness-sidecar/rho/coresetBuilder.js tests/harness-compaction-replay.test.js tests/harness-rho-coreset.test.js
git commit -m "feat(context): add compaction replay hard cases"
```

---

## Task 6: BES/RHO Compaction Policy Evolution

**Files:**
- Create: `src/harness-sidecar/meta/compactionPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/contextPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/harnessOptimizer.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Test: `tests/harness-compaction-policy-evolution.test.js`
- Test: `tests/harness-meta-promotion.test.js`

- [ ] **Step 1: Write failing evolution tests**

Candidate policy genes:

- schema fields;
- profile selection;
- trigger thresholds;
- summarization ratio;
- raw-log compression ratio;
- source-pointer strictness;
- subagent handoff required fields;
- verifier score threshold.

Fitness should include:

- continuation success;
- lost-constraint penalty;
- token reduction;
- hallucination penalty;
- verifier pass rate;
- subagent handoff usefulness.

- [ ] **Step 2: Implement shadow candidates**

Export:

```js
export function proposeCompactionPolicies({ coreset, baselinePolicy, maxCandidates = 4 } = {}) {}
export function evaluateCompactionPolicyCandidate({ candidate, replayCase } = {}) {}
```

All candidates must be `status: 'shadow_only'` in V1.

- [ ] **Step 3: Integrate with optimizer**

When RHO hard cases include `compaction_*`, the meta optimizer should include compaction policy candidates alongside context/tool/budget/memory candidates.

- [ ] **Step 4: Promotion safety**

Update promotion policy so compaction policy candidates require:

- replay pass over held-out compaction cases;
- no verifier score regression;
- no lower source-pointer strictness unless explicitly approved;
- rollback metadata;
- no runtime mutation without human approval.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/harness-compaction-policy-evolution.test.js tests/harness-meta-promotion.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/harness-sidecar/meta/compactionPolicyEvolution.js src/harness-sidecar/meta/contextPolicyEvolution.js src/harness-sidecar/meta/harnessOptimizer.js src/harness-sidecar/meta/promotionPolicy.js tests/harness-compaction-policy-evolution.test.js tests/harness-meta-promotion.test.js
git commit -m "feat(meta): evolve compaction policy in shadow mode"
```

---

## Task 7: Subagent Handoff Compaction Quality

**Files:**
- Modify: `src/harness-sidecar/swarm/subagentRunner.js`
- Modify: `src/harness-sidecar/swarm/modelDrivenWorker.js`
- Modify: `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`
- Modify: `src/harness-sidecar/context/compactionVerifier.js`
- Test: `tests/harness-swarm-runtime.test.js`
- Test: `tests/harness-swarm-model-worker.test.js`
- Test: `tests/harness-swarm-meta-feedback.test.js`

- [ ] **Step 1: Write failing handoff tests**

Subagent outputs must include a compact handoff with:

- summary;
- files inspected;
- files changed;
- commands run;
- tests run;
- current blocker;
- recommended next action;
- source pointers;
- uncertainty/risk flags.

Verifier should score handoff quality before it enters the main task context.

- [ ] **Step 2: Enforce output contract**

Add `handoff` normalization and truncation in `subagentRunner.js`.

- [ ] **Step 3: Feed hard cases**

If handoff quality is low, record a swarm hard case:

- `subagent_handoff_missing_source`
- `subagent_handoff_missing_tests`
- `subagent_handoff_too_verbose`
- `subagent_handoff_low_continuation_value`

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-meta-feedback.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/swarm/subagentRunner.js src/harness-sidecar/swarm/modelDrivenWorker.js src/harness-sidecar/swarm/swarmOutcomeRecorder.js src/harness-sidecar/context/compactionVerifier.js tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-meta-feedback.test.js
git commit -m "feat(swarm): score compact subagent handoffs"
```

---

## Task 8: Documentation And Final Verification

**Files:**
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/harness-strengthening-and-codex-comparison.md`
- Modify: this plan if implementation discovers better paths.

- [ ] **Step 1: Update architecture docs**

Add:

- compaction lifecycle diagram;
- context pressure dashboard notes;
- compaction replay dataset flow;
- BES/RHO compaction policy evolution flow;
- comparison note against Codex and Claude Code.

- [ ] **Step 2: Run focused tests**

```powershell
npm test -- tests/harness-compaction-schema.test.js tests/harness-compaction-verifier.test.js tests/harness-compaction-replay.test.js tests/harness-compaction-policy-evolution.test.js
```

Expected: all pass.

- [ ] **Step 3: Run integration tests**

```powershell
npm test -- tests/harness-context-window-manager.test.js tests/harness-sidecar.test.js tests/harness-swarm-runtime.test.js tests/harness-rho-coreset.test.js tests/harness-meta-promotion.test.js tests/harness-ui-discoverability.test.js
```

Expected: all pass.

- [ ] **Step 4: Run full suite**

```powershell
npm test
```

Expected: all tests pass except known platform skips.

- [ ] **Step 5: Commit docs**

```powershell
git add docs/architecture/feature-architecture-map.md docs/architecture/harness-strengthening-and-codex-comparison.md docs/superpowers/plans/2026-06-08-compaction-evolution-upgrade.md
git commit -m "docs(context): plan compaction evolution upgrade"
```

---

## Suggested Subagent Split

When implementing, split work into non-overlapping write scopes:

1. **Schema worker:** `compactionSchema.js`, `compaction.js`, schema tests.
2. **Runtime worker:** `compactionProfiles.js`, `compactionPlanner.js`, `contextWindowManager.js`, working-memory tests.
3. **Verifier worker:** `compactionVerifier.js`, `traceCompactor.js`, verifier/trace tests.
4. **Evolution worker:** `compactionReplay.js`, `compactionPolicyEvolution.js`, RHO/meta tests.
5. **Swarm worker:** subagent handoff output contracts and swarm feedback tests.
6. **UI/docs worker:** context pressure panel and architecture docs.

Keep each worker in its own branch or worktree. Merge only after focused tests pass.

## Acceptance Criteria

- Every compaction event produces a structured artifact with source pointers.
- Priority-zero instructions and operator constraints cannot be silently dropped.
- The UI can show why compaction happened and whether it passed verification.
- Replay can distinguish successful compaction from continuation-breaking compaction.
- RHO mines compaction failures as hard cases.
- BES/Shinka-style evolution can propose compaction policy variants in shadow mode.
- No compaction policy self-applies without held-out evidence and approval gates.
- Subagent handoffs are scored before entering main context.
- Full `npm test` passes before merge.
