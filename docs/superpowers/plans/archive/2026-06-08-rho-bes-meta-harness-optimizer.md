# RHO BES Meta-Harness Optimizer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic first version of the combined RHO+BES optimizer for Helios Forge Meta-Harness.

**Architecture:** Meta-Harness remains the audit, evaluation, and promotion shell. RHO mines prior trace experience into a hard-case coreset and self-preference ranking signal. BES searches candidate harness changes against that coreset using subgoals, mutation, recombination, and champion selection.

**Tech Stack:** Node.js ESM, `node:test`, workspace-local `.harness` JSON/JSONL artifacts, existing `src/harness-sidecar/meta` and `src/harness-sidecar/bes` modules.

---

## File Structure

- Create `src/harness-sidecar/rho/coresetBuilder.js`: select challenging/diverse trace summaries for retrospective optimization.
- Create `src/harness-sidecar/rho/preferenceJudge.js`: deterministic self-validation, self-consistency, and pairwise candidate preference logic.
- Create `src/harness-sidecar/meta/besMetaOptimizer.js`: generate multiple BES-backed candidate harness updates from RHO coreset plus trace summary.
- Create `src/harness-sidecar/meta/candidateArchive.js`: write/read candidate directories under `.harness/meta/candidates/<candidateId>/`.
- Modify `src/harness-sidecar/meta/promotionLoop.js`: support candidate archive output and multi-candidate optimizer results without breaking single-candidate callers.
- Modify `src/harness-sidecar/meta/harnessOptimizer.js`: delegate to `BesMetaOptimizer` where requested while preserving current API.
- Modify `src/harness-sidecar/server.js`: add runtime RHO+BES meta optimizer path and emit traceable events/artifacts.
- Add tests:
  - `tests/harness-rho-coreset.test.js`
  - `tests/harness-rho-preference.test.js`
  - `tests/harness-meta-bes-optimizer.test.js`
  - `tests/harness-meta-candidate-archive.test.js`
  - extend `tests/harness-meta-promotion-loop.test.js`

## Chunk 1: RHO Coreset And Preference

### Task 1: Retrospective Coreset Builder

**Files:**
- Create: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-rho-coreset.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- ranks traces with recovery events, budget gates, failures, and low completion above easy traces
- enforces `limit`
- preserves diversity across failure categories/task ids
- returns deterministic ordering

- [ ] **Step 2: Implement `buildRhoCoreset({ traces, limit, diversityKey })`**

Expected output shape:

```js
{
  items: [
    {
      taskId,
      score,
      reasons,
      trace,
      diversityKey
    }
  ],
  totalCandidates,
  selectedCount
}
```

Scoring should be simple and deterministic:
- `+3` for explicit failures/recovery events
- `+2` for budget gates
- `+2` for low subgoal completion or unsuccessful status
- `+1` for rejected/promoted meta decision evidence

- [ ] **Step 3: Run focused test**

Run: `npm test -- tests/harness-rho-coreset.test.js`

Expected: pass.

### Task 2: RHO Preference Judge

**Files:**
- Create: `src/harness-sidecar/rho/preferenceJudge.js`
- Test: `tests/harness-rho-preference.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- prefers higher quality/safety and lower cost/latency
- uses self-consistency votes when pairwise comparisons are close
- returns rationale and comparable score deltas
- deterministic tie-breaking by candidate id

- [ ] **Step 2: Implement `judgeCandidatePreference({ candidates, coreset, objectives })`**

Output:

```js
{
  winner,
  rankings,
  pairwise,
  rationale
}
```

Each ranking should include `candidateId`, `preferenceScore`, `votes`, and `reasons`.

- [ ] **Step 3: Run focused test**

Run: `npm test -- tests/harness-rho-preference.test.js`

Expected: pass.

## Chunk 2: BES As Meta-Harness Optimizer

### Task 3: BES Candidate Optimizer

**Files:**
- Create: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/meta/harnessOptimizer.js`
- Test: `tests/harness-meta-bes-optimizer.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- generates multiple candidates for prompt/retrieval/tool/runtime policy targets
- candidate ids are safe and deterministic when `now`/`idPrefix` are injected
- candidate rationale references RHO coreset failure modes and BES subgoals
- uses recombination when parent candidates are supplied
- preserves approval-required behavior

- [ ] **Step 2: Implement `BesMetaOptimizer`**

Use existing BES helpers:
- `seedAttemptStrategies`
- `createAttemptGenome`
- `proposeMutations`
- `recombineAttempts`
- `scoreSubgoals`
- `createDiversityTracker`
- `createChampionArchive`

Return:

```js
{
  candidates,
  coreset,
  bes: {
    subgoals,
    genomes,
    diversity,
    champion
  }
}
```

- [ ] **Step 3: Keep `HarnessOptimizer.propose()` backward compatible**

Existing tests must still pass. Add an opt-in path such as:

```js
new HarnessOptimizer({ mode: 'bes-rho' }).propose(...)
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/harness-meta.test.js tests/harness-meta-bes-optimizer.test.js`

Expected: pass.

## Chunk 3: Candidate Archive And Promotion Integration

### Task 4: Candidate Archive

**Files:**
- Create: `src/harness-sidecar/meta/candidateArchive.js`
- Test: `tests/harness-meta-candidate-archive.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- writes candidate source/proposal/metrics/trace summaries to `.harness/meta/candidates/<safeId>/`
- rejects unsafe candidate ids and path traversal
- reads candidate records back deterministically
- can list archived candidates newest first

- [ ] **Step 2: Implement archive helpers**

Exports:

```js
getCandidateArchiveRoot(workspaceRoot)
archiveCandidate({ workspaceRoot, candidate, candidateRun, traceSummary, preference })
readArchivedCandidate({ workspaceRoot, candidateId })
listArchivedCandidates({ workspaceRoot, limit })
```

- [ ] **Step 3: Run focused tests**

Run: `npm test -- tests/harness-meta-candidate-archive.test.js`

Expected: pass.

### Task 5: Promotion Loop Multi-Candidate Support

**Files:**
- Modify: `src/harness-sidecar/meta/promotionLoop.js`
- Test: extend `tests/harness-meta-promotion-loop.test.js`

- [ ] **Step 1: Write failing tests**

Cover:
- optimizer may return `{ candidates, preference }`
- loop selects the preference winner for smoke/eval/promotion
- archives all candidates when `archiveCandidates: true`
- single-candidate existing behavior is unchanged

- [ ] **Step 2: Implement minimal integration**

Do not make promotion loop apply multiple candidates. It should select one candidate, evaluate it, and record the decision.

- [ ] **Step 3: Run focused tests**

Run: `npm test -- tests/harness-meta-promotion-loop.test.js tests/harness-meta-candidate-archive.test.js`

Expected: pass.

## Chunk 4: Runtime Wiring And End-To-End Verification

### Task 6: Sidecar Runtime Events

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Test: extend `tests/harness-sidecar.test.js` or add a focused runtime test if cleaner

- [ ] **Step 1: Write failing tests**

Cover:
- runtime task emits `rho.coreset_selected`
- runtime task emits `bes.meta_candidates_generated`
- runtime task emits `rho.preference_judged`
- meta optimizer artifact contains candidates, coreset summary, preference, and BES metadata

- [ ] **Step 2: Wire runtime path**

After `meta.trace_inspected`, build a RHO coreset from available traces, run `BesMetaOptimizer`, judge candidates, write artifact, and feed the selected candidate into existing promotion logic.

- [ ] **Step 3: Run focused test**

Run: `npm test -- tests/harness-sidecar.test.js tests/harness-meta-bes-optimizer.test.js`

Expected: pass.

### Task 7: Full Verification

**Files:**
- No new files unless test updates require them.

- [ ] **Step 1: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run release smoke**

Run: `npm run release:smoke`

Expected: pass.

- [ ] **Step 3: Commit**

Commit message:

```bash
git commit -m "feat(meta): add RHO BES optimizer"
```

## Non-Goals

- Do not mutate global Pi configuration.
- Do not call private model endpoints in tests.
- Do not implement weight training or model fine-tuning.
- Do not allow auto-apply without existing promotion/approval gates.
- Do not remove the existing deterministic harness optimizer API.
