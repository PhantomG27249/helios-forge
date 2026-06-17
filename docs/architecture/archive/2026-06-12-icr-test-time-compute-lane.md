# ICR Test-Time Compute Lane

## Current Implementation

The ICR lane is an evidence-only test-time compute substrate under `src/harness-sidecar/icr/`. It adds deterministic contracts, branch execution, candidate-family generation, solution-pool construction, blind final-judge packet shaping, evidence sanitization, RHO replay comparison, and a lightweight PerfCodeBench-style adapter.

The lane is disabled by default through `icr.enabled: false` in harness config. The first implementation uses injected fake/model runners and existing replay/evidence APIs; it does not make real model calls during tests or startup.

## Runtime Shape

ICR runs candidate generation as a bounded branch family:

- `runIcrBranch` records branch iterations with hypothesis refresh, critique/correction summaries, PQF cadence, distillation cadence, and deterministic input digests.
- `runIcrCandidateFamily` creates the configured branch breadth, builds a solution pool, strips hidden branch state from final-judge packets, and emits BES/RHO-ready candidates.
- `sanitizeIcrEvidenceForDashboard` redacts secret-shaped strings, local paths, branch memory, critique records, PQF internals, replaced branches, and hypothesis history before dashboard exposure.
- `runIcrRhoReplayComparison` compares best-single, repeated sampling, static council, ICR branch family, and ICR plus BES fusion through the existing RHO replay-batch shape.

## BES, RHO, And Dashboard Integration

BES exposes an `icr` lane contract with `test_time_compute_policy` candidates, `icr_eval` verifier units, and `icr_branch_fusion` metadata. `runBesLaneRuntime` remains generic; it forwards candidate `icrEvidence` into the normal lane evidence summary and never grants promotion authority.

RHO treats ICR as a candidate family to compare against cheaper baselines. Replay output explicitly reports regressions where ICR loses to repeated sampling or static council. Production readiness stays blocked even when local replay looks favorable, because ICR evidence is advisory until persisted held-out production replay exists.

Capability status includes `icr_test_time_compute`. It requires branch trace evidence, blind judge evidence, BES lane evidence, RHO uplift report, cost gate, production replay, and a dashboard snapshot. Cost overflow and context overflow appear as blockers.

## What Is Not Production-Proven

This is an engine capability, not Level 4 production evaluation proof. It does not prove repeated held-out uplift, safe cost envelopes, or production persistence by itself. The production gate remains closed until:

- held-out replay repeatedly beats best-single, repeated-sampling, and static-council baselines;
- cost and context estimates remain under configured gates;
- blind final-judge isolation remains covered by tests;
- production replay artifacts persist across cycles;
- dashboard rows show the same evidence without hidden-state leakage.

## Source Inspiration

The design adapts the local ICR pattern from the LocalLLaMA discussion and Iterative Contextual Refinements repository: branch breadth, correction depth, periodic hypothesis refresh, PQF-style branch quality updates, solution pools, context distillation, and blind judging. The PerfCodeBench-inspired adapter keeps correctness and runtime efficiency separate without adding an external benchmark dependency.

## Focused Tests

Run these from the repository root:

```powershell
node --test tests/harness-icr-contracts.test.js
node --test tests/harness-icr-branch-runtime.test.js
node --test tests/harness-icr-candidate-family.test.js
node --test tests/harness-icr-evidence.test.js
node --test tests/harness-icr-bes-lane.test.js
node --test tests/harness-icr-rho-replay.test.js
node --test tests/harness-icr-dashboard.test.js
node --test tests/harness-icr-perfbench-adapter.test.js
node --test tests/harness-config.test.js
```

Run these regression checks for the integration surface:

```powershell
node --test tests/harness-bes-lane-contracts.test.js
node --test tests/harness-bes-lane-runtime.test.js
node --test tests/harness-rho-replay-batch.test.js
node --test tests/harness-capability-goal-status.test.js
```
