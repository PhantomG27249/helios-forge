# ICR Test-Time Compute Lane Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an evidence-only Iterative Contextual Refinement (ICR) / Deepthink lane that scales test-time compute through branch exploration, selective hypotheses, solution pools, critique/correction loops, PQF-style branch pruning, and blind final judging, then proves whether it beats simpler baselines through existing BES, RHO, meta-harness, and dashboard evidence.

**Architecture:** Build ICR as a new sidecar subsystem under `src/harness-sidecar/icr/`. ICR produces candidate families and branch evidence. BES treats those outputs as a new `icr` lane contract. RHO compares best-single, repeated-sampling, static-council, and ICR candidate-family runs. Capability dashboards expose progress and blockers. ICR evidence never directly applies code, promotes candidates, weakens verifier gates, or bypasses approval.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules, BES lane contracts/runtime/fusion, RHO replay batches, JSON/JSONL harness artifacts, model-router/provider hooks, workspace-root-constrained stores, operator dashboard snapshots, and optional browser UI wiring behind a feature flag.

**Implementation Status (2026-06-12):** Implemented in the current working tree as an evidence-only sidecar ICR lane with deterministic fake-runner tests, BES lane evidence, RHO replay comparison, capability dashboard status rows, config defaults, PerfCodeBench-style adapter support, and an architecture snapshot at `docs/architecture/archive/2026-06-12-icr-test-time-compute-lane.md`. The existing dashboard data path was extended; no browser route or visible UI file was changed, so browser launch verification was not applicable. Verified with `npm test`, `npm run release:smoke`, and `git diff --check` after final review fixes.

---

## Sources And Local Baseline

This plan is grounded in:

- Reddit thread: `https://www.reddit.com/r/LocalLLaMA/comments/1u47cvc/i_scaled_testtime_compute_for_qwen3627b_and/`
- Iterative Contextual Refinements repo: `https://github.com/ryoiki-tokuiten/Iterative-Contextual-Refinements`
- PerfCodeBench paper: `https://arxiv.org/abs/2605.15222`
- Current Helios BES/RHO/meta code:
  - `src/harness-sidecar/bes/laneContracts.js`
  - `src/harness-sidecar/bes/laneRuntime.js`
  - `src/harness-sidecar/bes/liveBesFusion.js`
  - `src/harness-sidecar/rho/replayBatchRunner.js`
  - `src/harness-sidecar/rho/groupedRerollRunner.js`
  - `src/harness-sidecar/rho/longitudinalImprovementTracker.js`
  - `src/harness-sidecar/meta/operatorDashboardStore.js`

The ICR source pattern to adapt:

- Branch breadth around 5 independent strategies.
- Correction depth around 10 iterations.
- Branch-aware selective hypotheses, revised periodically.
- Structured solution-pool noise to avoid premature convergence.
- Critique and correction agents with different context visibility.
- PQF-style branch quality updates every few iterations.
- Distillation/checkpointing for long context.
- Blind final judge that sees candidate solutions, not full branch memory.
- Large context pressure, with explicit token/cost controls.

The Helios-specific framing:

- ICR is not a replacement for BES, RHO, model council, or governance.
- ICR is a candidate-generation and test-time compute layer.
- BES fuses ICR evidence.
- RHO proves uplift or regression.
- Meta-harness records frontier status.
- Dashboards show cost, evidence, and blockers.
- Governance keeps the lane evidence-only until production proof exists.

## Non-Negotiable Boundaries

- ICR evidence can create candidate families, branch traces, critique records, replay inputs, and dashboard rows.
- ICR evidence cannot directly modify the active workspace.
- ICR evidence cannot promote itself to production readiness.
- ICR model outputs must be sanitized before persistence or dashboard display.
- Final judge inputs must be intentionally narrower than branch-worker inputs.
- Branch memory, critiques, PQF records, and replaced branches must not leak into the blind final judge.
- All cost/token estimates must be explicit, bounded, and visible.
- Any real tool execution used by ICR must run through existing approval, quarantine, and workspace-boundary patterns.
- Production gates remain false until RHO replay evidence proves uplift across held-out suites.

## Target Behavior

For a task, ICR should be able to:

1. Generate multiple strategic branches.
2. Attach selective hypotheses to each branch.
3. Execute or simulate branch attempts through injected model/tool runners.
4. Critique each branch with bounded context.
5. Correct each branch for several iterations.
6. Maintain a solution pool with structured variants.
7. Run periodic PQF-style branch quality updates.
8. Distill long branch context into compact state.
9. Select a final candidate through a blind final judge.
10. Emit a Helios candidate family that BES and RHO can evaluate.

The first implementation should be deterministic and testable with fake runners. Real model/provider integration comes after the data contract is stable.

## Subagent Operating Model

### Controller Responsibilities

- Keep this checklist updated.
- Assign disjoint write scopes to workers.
- Do not let parallel workers edit `src/harness-sidecar/server.js`, `src/server.js`, `public/app.js`, or `src/harness-sidecar/config/configLoader.js`.
- Integrate shared files serially after domain workers finish.
- Dispatch reviewer agents after each worker returns.
- Run the final verification suite.

### Worker Prompt Prefix

Use this prefix for every implementation worker:

```text
You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve evidence-only authority.
Return: status, changed files, tests run, remaining concerns.
```

### Review Rule

After each implementation worker returns:

1. Dispatch a spec reviewer with this plan section and changed files.
2. Fix spec issues before quality review.
3. Dispatch a code quality reviewer.
4. Mark the task complete only after tests and both reviews pass.

## Implementation Tasks

### Task 1: ICR Contracts And Defaults

Owner: Worker 1  
Write scope:

- `src/harness-sidecar/icr/icrContracts.js`
- `tests/harness-icr-contracts.test.js`

Checklist:

- [ ] Write failing tests for default config, strict bounds, role visibility, and invalid values.
- [ ] Create `ICR_DEFAULT_CONFIG`.
- [ ] Create `ICR_AGENT_ROLES`.
- [ ] Create `ICR_ARTIFACT_TYPES`.
- [ ] Implement `normalizeIcrConfig(input)`.
- [ ] Implement `getIcrRoleContextPolicy(role)`.
- [ ] Implement `assertIcrEvidenceOnly(record)`.
- [ ] Reject negative depth, zero breadth, unbounded token limits, and promotion authority.
- [ ] Export stable constants used by later tasks.

Required defaults:

```js
export const ICR_DEFAULT_CONFIG = Object.freeze({
  lane: 'icr',
  branchBreadth: 5,
  correctionDepth: 10,
  hypothesisCount: 6,
  hypothesisRefreshInterval: 2,
  pqfInterval: 4,
  distillationInterval: 5,
  solutionPoolSize: 8,
  maxComputeMultiplier: 40,
  maxContextTokens: 140000,
  evidenceOnly: true,
  promotionAllowed: false,
});
```

Required context policy:

```js
export const ICR_AGENT_ROLES = Object.freeze({
  strategy: 'strategy',
  hypothesis: 'hypothesis',
  executor: 'executor',
  critique: 'critique',
  correction: 'correction',
  pqf: 'pqf',
  distiller: 'distiller',
  finalJudge: 'final_judge',
});
```

Acceptance:

- [ ] `node --test tests/harness-icr-contracts.test.js` passes.
- [ ] Invalid configs throw deterministic errors.
- [ ] Final judge context policy excludes critique, PQF, branch memory, and replaced branches.

### Task 2: Branch Runtime

Owner: Worker 2  
Write scope:

- `src/harness-sidecar/icr/icrBranchRuntime.js`
- `tests/harness-icr-branch-runtime.test.js`

Checklist:

- [ ] Write failing tests with fake strategy, hypothesis, executor, critique, correction, PQF, and distiller runners.
- [ ] Implement `runIcrBranch({ task, branch, config, runners, now })`.
- [ ] Record every iteration with input digest, hypothesis version, candidate text, critique summary, correction summary, score, and artifact IDs.
- [ ] Refresh hypotheses on `hypothesisRefreshInterval`.
- [ ] Run PQF updates on `pqfInterval`.
- [ ] Distill branch memory on `distillationInterval`.
- [ ] Stop at `correctionDepth` or a deterministic stop decision.
- [ ] Emit no promotion authority.

Expected return shape:

```js
{
  kind: 'icr_branch_trace',
  lane: 'icr',
  branchId,
  strategy,
  iterations,
  activeHypotheses,
  pqfRecords,
  distillationRecords,
  finalCandidate,
  evidenceOnly: true,
  promotionAllowed: false,
}
```

Acceptance:

- [ ] `node --test tests/harness-icr-branch-runtime.test.js` passes.
- [ ] The runtime is deterministic under injected fake runners.
- [ ] PQF and distillation cadence are tested.
- [ ] No branch trace exposes secrets or approval authority.

### Task 3: Candidate Family, Solution Pool, And Blind Judge

Owner: Worker 3  
Write scope:

- `src/harness-sidecar/icr/icrCandidateFamily.js`
- `src/harness-sidecar/icr/icrSolutionPool.js`
- `tests/harness-icr-candidate-family.test.js`

Checklist:

- [ ] Write failing tests for branch breadth, solution-pool variants, branch replacement, and blind judging.
- [ ] Implement `runIcrCandidateFamily({ task, config, runners, now })`.
- [ ] Generate `branchBreadth` independent branch seeds.
- [ ] Run branches through `runIcrBranch`.
- [ ] Build structured solution-pool variants without mutating original branch traces.
- [ ] Create a final judge packet containing only active candidate solution text, candidate IDs, compact metrics, and task rubric.
- [ ] Ensure final judge cannot access critiques, branch memory, PQF internals, replaced branches, or hidden state.
- [ ] Return a BES/RHO-ready candidate family.

Expected final judge packet:

```js
{
  kind: 'icr_blind_final_judge_packet',
  candidates: [
    { candidateId, branchId, text, visibleMetrics }
  ],
  hiddenFromJudge: [
    'branch_memory',
    'critique_records',
    'pqf_records',
    'replaced_branches',
    'hypothesis_history'
  ],
}
```

Acceptance:

- [ ] `node --test tests/harness-icr-candidate-family.test.js` passes.
- [ ] Tests prove blind final judge context isolation.
- [ ] Candidate family output can be converted to existing BES candidate objects.

### Task 4: Evidence Sanitizer And Metrics

Owner: Worker 4  
Write scope:

- `src/harness-sidecar/icr/icrEvidence.js`
- `tests/harness-icr-evidence.test.js`

Checklist:

- [ ] Write failing tests for safe summaries, redaction, quarantine flags, compute estimates, and token-risk flags.
- [ ] Implement `summarizeIcrEvidence(record)`.
- [ ] Implement `sanitizeIcrEvidenceForDashboard(record)`.
- [ ] Implement `estimateIcrCompute(record, config)`.
- [ ] Implement `extractIcrBottlenecks(record)`.
- [ ] Redact secret-shaped values and absolute local paths.
- [ ] Flag context overflow risk above `maxContextTokens`.
- [ ] Flag cost risk above `maxComputeMultiplier`.

Required metrics:

- `branchCount`
- `iterationCount`
- `solutionPoolCount`
- `pqfKeptCount`
- `pqfReplacedCount`
- `distillationCount`
- `finalCandidateId`
- `computeMultiplierEstimate`
- `contextTokenEstimate`
- `contextOverflowRisk`
- `costGateStatus`
- `evidenceOnly`
- `promotionAllowed`

Acceptance:

- [ ] `node --test tests/harness-icr-evidence.test.js` passes.
- [ ] Sanitized dashboard summaries contain no hidden judge-forbidden context.
- [ ] Evidence records remain replayable enough for RHO and audit.

### Task 5: BES Lane Contract Integration

Owner: Worker 5  
Write scope:

- `src/harness-sidecar/bes/laneContracts.js`
- `src/harness-sidecar/bes/laneEvidence.js`
- `tests/harness-icr-bes-lane.test.js`
- Existing BES lane tests only if needed.

Checklist:

- [ ] Write failing tests proving `getBesLaneContract('icr')` returns the expected lane contract.
- [ ] Add `icr` to `LANE_CONTRACTS`.
- [ ] Add `icr` to lane fusion metadata as `icr_branch_fusion`.
- [ ] Add/sanitize ICR lane evidence if `laneEvidence.js` requires explicit field handling.
- [ ] Prove existing BES lanes are unchanged.
- [ ] Prove ICR lane contract is evidence-only and non-promoting.

Required contract:

```js
icr: Object.freeze({
  lane: 'icr',
  candidateUnit: 'test_time_compute_policy',
  verifierUnit: 'icr_eval',
  artifacts: Object.freeze([
    'branch_trace',
    'hypothesis_packet',
    'solution_pool',
    'pqf_record',
    'blind_judgment'
  ]),
})
```

Acceptance:

- [ ] `node --test tests/harness-icr-bes-lane.test.js` passes.
- [ ] `node --test tests/harness-bes-lane-contracts.test.js` passes if that test exists.
- [ ] ICR candidates can enter `runBesLaneRuntime` without bespoke promotion logic.

### Task 6: RHO Replay Adapter And Uplift Proof

Owner: Worker 6  
Write scope:

- `src/harness-sidecar/icr/icrReplayAdapter.js`
- `tests/harness-icr-rho-replay.test.js`

Checklist:

- [ ] Write failing tests comparing baseline, repeated sampling, static council, and ICR candidate-family runners.
- [ ] Implement `createIcrRhoCandidateFamily(record)`.
- [ ] Implement `runIcrRhoReplayComparison({ task, suite, config, runners, rhoRunner })`.
- [ ] Use existing `runRhoReplayBatch` patterns rather than inventing a second replay framework.
- [ ] Preserve RHO evidence-only authority.
- [ ] Return uplift metrics and regressions.

Required comparisons:

- best single baseline
- repeated sampling baseline
- static council baseline
- ICR branch family
- ICR plus BES lane fusion

Acceptance:

- [ ] `node --test tests/harness-icr-rho-replay.test.js` passes.
- [ ] Replay reports identify cases where ICR loses to cheaper baselines.
- [ ] Production readiness remains gated when uplift evidence is missing.

### Task 7: Capability Goal And Dashboard Evidence

Owner: Worker 7  
Write scope:

- `src/harness-sidecar/meta/capabilityGoalStatus.js`
- `src/harness-sidecar/meta/operatorDashboardStore.js`
- `tests/harness-icr-dashboard.test.js`
- Existing meta/dashboard tests only if needed.

Checklist:

- [ ] Write failing tests for ICR status rows and capability-goal blockers.
- [ ] Add an `icr_test_time_compute` capability section if the local status module uses named capability records.
- [ ] Require branch traces, blind judge packets, BES lane evidence, RHO replay comparison, cost gate, and dashboard snapshot before maturity advances.
- [ ] Keep `level4ReadyCandidate` false unless persisted production evidence exists.
- [ ] Add dashboard-safe ICR rows using `sanitizeIcrEvidenceForDashboard`.
- [ ] Show cost/context risks as blockers, not as silent metadata.

Required blocker strings:

- `missing_icr_branch_trace_evidence`
- `missing_icr_blind_judge_evidence`
- `missing_icr_rho_uplift_report`
- `icr_cost_gate_unproven`
- `icr_context_overflow_risk`
- `icr_production_replay_missing`

Acceptance:

- [ ] `node --test tests/harness-icr-dashboard.test.js` passes.
- [ ] Existing capability goal tests still pass.
- [ ] Operator dashboard rows are safe to display.

### Task 8: Serial Sidecar And UI Integration

> **Wiring plan (2026-06-17):** Parallel subagent execution spec at `docs/superpowers/plans/2026-06-17-icr-wiring-parallel-subagents.md`. Substrate (Tasks 1–7, 9–10) is complete; Task 8 remains open.

Owner: Integration Worker  
Write scope:

- `src/harness-sidecar/server.js`
- `src/server.js`
- `public/app.js`
- `public/index.html`
- `src/harness-sidecar/config/configLoader.js`
- Any tests directly tied to these shared files.

Do this only after Tasks 1 through 7 pass.

Checklist:

- [ ] Add an opt-in config flag such as `icr.enabled`.
- [ ] Add a sidecar route/event for ICR evidence status only if existing route patterns support it cleanly.
- [ ] Surface ICR dashboard rows without making a new marketing-style page.
- [ ] Keep controls compact and operational.
- [ ] Avoid default real model calls in tests and local startup.
- [ ] Preserve current dev server startup.

Acceptance:

- [ ] `npm test` passes or all affected test files pass if full test runtime is too large.
- [ ] `npm run release:smoke` passes.
- [ ] If UI changed, launch `npm run dev` and verify the dashboard in browser.

### Task 9: PerfCodeBench-Style Harness Track

Owner: Worker 8  
Write scope:

- `src/harness-sidecar/icr/icrPerfBenchAdapter.js`
- `tests/harness-icr-perfbench-adapter.test.js`
- Optional fixture files under an existing test fixture directory.

Checklist:

- [ ] Write failing tests for tasks that include baseline implementation, correctness check, runtime score, and reference optimized metadata.
- [ ] Implement a lightweight adapter that can describe high-performance code tasks without depending on external benchmark downloads.
- [ ] Report correctness and runtime-efficiency fields separately.
- [ ] Allow ICR to target performance bottleneck hypotheses as branch hypotheses.
- [ ] Keep this as an evaluation adapter, not a new benchmark dependency.

Acceptance:

- [ ] `node --test tests/harness-icr-perfbench-adapter.test.js` passes.
- [ ] The adapter can feed ICR candidate family generation and RHO replay comparison.

### Task 10: Documentation And Runbook

Owner: Worker 9  
Write scope:

- `docs/architecture/archive/2026-06-12-icr-test-time-compute-lane.md`
- This plan file for checkbox updates only.

Checklist:

- [ ] Document what was implemented.
- [ ] Document what is intentionally not production-proven.
- [ ] Document how ICR relates to BES, RHO, model council, and dashboards.
- [ ] Document how to run the focused tests.
- [ ] Document the production gate criteria.

Acceptance:

- [ ] The doc distinguishes engine capability from evaluation maturity.
- [ ] The doc cites source inspiration and current-code integration points.
- [ ] The doc avoids stale claims about Level 4 production proof.

## Test-Driven Development Order

Use this order:

1. Contracts tests fail.
2. Contracts pass.
3. Branch runtime tests fail.
4. Branch runtime passes.
5. Candidate family tests fail.
6. Candidate family passes.
7. Evidence tests fail.
8. Evidence tests pass.
9. BES integration tests fail.
10. BES integration passes.
11. RHO replay tests fail.
12. RHO replay passes.
13. Dashboard tests fail.
14. Dashboard tests pass.
15. Serial sidecar/UI tests fail.
16. Serial sidecar/UI tests pass.
17. Release smoke passes.

## Verification Commands

Run focused tests as work lands:

```powershell
node --test tests/harness-icr-contracts.test.js
node --test tests/harness-icr-branch-runtime.test.js
node --test tests/harness-icr-candidate-family.test.js
node --test tests/harness-icr-evidence.test.js
node --test tests/harness-icr-bes-lane.test.js
node --test tests/harness-icr-rho-replay.test.js
node --test tests/harness-icr-dashboard.test.js
node --test tests/harness-icr-perfbench-adapter.test.js
```

Run regression tests after integration:

```powershell
node --test tests/harness-bes-lane-contracts.test.js
node --test tests/harness-bes-nested-swarm-mesh.test.js
node --test tests/harness-rho-replay-batch.test.js
node --test tests/harness-capability-goal-status.test.js
npm test
npm run release:smoke
git diff --check
```

If any listed test file does not exist yet, create the ICR-specific tests first and run the closest existing regression tests in the same subsystem.

## Production Evidence Required Before Calling This Level 4 Evaluation

ICR can count as a Level 4 engine feature when:

- `icr` lane exists and feeds BES runtime.
- ICR branch/correction/final-judge artifacts are persisted and replayable.
- RHO can compare ICR against cheaper baselines.
- Dashboard/capability status exposes cost, context, and uplift blockers.
- Promotion remains blocked without production evidence.

ICR can count as Level 4 evaluation only when:

- Held-out replay reports show repeated uplift over best-single, repeated-sampling, and static-council baselines.
- Cost/token gates stay within configured bounds.
- Blind final judge isolation is proven in tests.
- Production replay artifacts persist across multiple cycles.
- Operator dashboard snapshots show the same evidence without hidden state leakage.
- Rollback/quarantine behavior is tested for bad ICR evidence.

## Risks And Mitigations

- Risk: ICR burns compute without beating simpler baselines.  
  Mitigation: RHO replay comparison must report losses and cost-adjusted results.

- Risk: final judge leaks branch memory and becomes non-blind.  
  Mitigation: enforce final judge packet construction in code and tests.

- Risk: branch traces persist secrets or local paths.  
  Mitigation: use `sanitizeIcrEvidenceForDashboard` and shared redaction patterns.

- Risk: ICR becomes a hidden promotion authority.  
  Mitigation: contracts, evidence records, BES lane fusion, and capability goals all assert `promotionAllowed: false`.

- Risk: UI work collides with other agents.  
  Mitigation: keep UI/server/config edits serial and late.

## Commit Strategy

Use small commits after reviewed checkpoints:

```powershell
git status --short
git add src/harness-sidecar/icr tests/harness-icr-contracts.test.js tests/harness-icr-branch-runtime.test.js tests/harness-icr-candidate-family.test.js tests/harness-icr-evidence.test.js
git commit -m "feat: add icr test-time compute substrate"

git add src/harness-sidecar/bes src/harness-sidecar/meta tests/harness-icr-bes-lane.test.js tests/harness-icr-rho-replay.test.js tests/harness-icr-dashboard.test.js
git commit -m "feat: wire icr evidence into bes rho and dashboards"

git add docs/architecture/archive/2026-06-12-icr-test-time-compute-lane.md docs/superpowers/plans/2026-06-12-icr-test-time-compute-lane.md
git commit -m "docs: document icr test-time compute lane"
```

Do not include unrelated pre-existing local changes unless the user explicitly asks to bundle them.
