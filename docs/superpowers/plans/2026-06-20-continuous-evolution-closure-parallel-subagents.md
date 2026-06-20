# Continuous Evolution Closure — Parallel Subagents Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining continuous-evolution gaps: L4 promotion loop wiring on the post-task path, self-authored skill persistence from RHO-mined needs, and project-specific evolution goal scaffolding — all evidence-only until operator approval.

**Architecture:** Three disjoint implementer workers own new modules + tests. One serial integration worker wires chokepoints (`postTaskEvolutionOrchestrator.js`, `recursiveEvolutionRuntimeHook.js`, `server.js`, `harnessEvolutionDefaults.js`). Every durable mutation stays trust-gated; `canPromote: false` on autonomous paths.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios harness-sidecar modules.

**Parent:** [2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md](./2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md)

---

## Worker Ownership (Parallel)

| Worker | Files (ONLY these) | Deliverable |
| --- | --- | --- |
| **G1** | `meta/postTaskPromotionBridge.js`, `tests/harness-post-task-promotion-bridge.test.js` | L4 eligibility + promotion queue from replay/campaign evidence |
| **G2** | `skills/skillEvolutionPostTask.js`, `tests/harness-skill-evolution-post-task.test.js` | RHO mine → generate → evaluate → persist skill candidates |
| **G3** | `meta/workplaceEvolutionGoals.js`, `tests/harness-workplace-evolution-goals.test.js` | Project-specific evolution goals + benchmark hints |
| **Integration** | `postTaskEvolutionOrchestrator.js`, `recursiveEvolutionRuntimeHook.js`, `server.js`, `harnessEvolutionDefaults.js`, `tests/harness-recursive-evolution-integration.test.js` | Wire all three into hot path |

---

## G1: Post-Task Promotion Bridge

**Files:**
- Create: `src/harness-sidecar/meta/postTaskPromotionBridge.js`
- Test: `tests/harness-post-task-promotion-bridge.test.js`

**Behavior:**
- `derivePromotionLoopAutonomySignal` from `autonomyRollbackRunner.js` gates L4 eligibility
- `buildPromotionCandidateFromEvidence({ replayReports, campaignResults })` picks best campaign/replay winner
- `runPostTaskPromotionBridge({ workspaceRoot, harnessConfig, autonomyState, replayReports, campaignResults })`:
  - Skip when `productionAutonomyPolicy` gate off or L4 not eligible
  - Call `evaluatePromotion` + `createChangeProposal` (NOT auto-apply; `approval: null`)
  - Persist queue record under `.harness/meta/promotion-queue/<proposalId>.json`
  - Return `{ evidenceOnly: true, canPromote: false, l4Eligible, proposal, decision, queuePath }`

**Tests:** eligible path queues proposal; ineligible skips; regressions block; queue files have `canPromote: false`.

---

## G2: Skill Evolution Post-Task

**Files:**
- Create: `src/harness-sidecar/skills/skillEvolutionPostTask.js`
- Test: `tests/harness-skill-evolution-post-task.test.js`

**Behavior:**
- `skillEvolutionEnabled(harnessConfig)` — true when `features.skillEvolution !== false` (default true)
- `loadRecentTraceSummaries({ workspaceRoot, limit })` using `listTraces` + `readTrace`
- Build RHO coreset via `buildRhoCoreset`
- `mineSkillNeedsFromRho({ coreset, traces, existingCapabilities })`
- For top need (max 1 per tick, max 2 candidates): `generateSkillCandidates` → `evaluateSkillCandidate` from `skillCandidateEvaluator.js` → `writeSkillCandidate`
- `buildSkillEvolutionSearchContext` for scheduler trace events
- Return `{ evidenceOnly: true, canPromote: false, needs, persisted, schedulerAction }`

**Tests:** with synthetic traces matching verifier failure modes, persists under `.harness/meta/skill-candidates/`; empty coreset no-ops.

---

## G3: Workplace Evolution Goals

**Files:**
- Create: `src/harness-sidecar/meta/workplaceEvolutionGoals.js`
- Test: `tests/harness-workplace-evolution-goals.test.js`

**Behavior:**
- Detect stack from `package.json` / `pyproject.toml` (reuse `detectWorkplaceTestRunner` patterns)
- `buildWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig })` returns goals array:
  - `primary_test_pass`, `replay_no_regression`, `skill_gap_closure`, `frontier_uplift`
  - Each goal: `{ goalId, label, metric, targetCommand?, evidencePaths[] }`
- `persistWorkplaceEvolutionGoals({ workspaceRoot, goals })` writes `.harness/meta/evolution-goals.json`
- `scaffoldWorkplaceEvolutionGoals({ workspaceRoot, harnessConfig })` merge-safe scaffold

**Tests:** node repo gets npm-test goal; file created; merge preserves operator edits.

---

## Integration Worker

- [ ] `postTaskEvolutionOrchestrator`: after coordinate, call `runPostTaskPromotionBridge`; pass result to `coordinateRecursiveEvolution({ promotionLoopResult })`
- [ ] `recursiveEvolutionRuntimeHook`: after evolution orchestrator, call `runSkillEvolutionPostTask` + `scaffoldWorkplaceEvolutionGoals` (first tick only or when missing)
- [ ] `server.js`: replace hardcoded skillNeed with `mineSkillNeedsFromRho` output (fallback to generic need)
- [ ] `harnessEvolutionDefaults.js`: call `scaffoldWorkplaceEvolutionGoals` from `scaffoldWorkplaceEvolution`
- [ ] Integration test: post-task hooks persist promotion queue + skill candidate when gates enabled

**Verification:** `node --test tests/harness-post-task-promotion-bridge.test.js tests/harness-skill-evolution-post-task.test.js tests/harness-workplace-evolution-goals.test.js tests/harness-recursive-evolution-integration.test.js tests/harness-post-task-evolution-orchestrator.test.js`

---

## Invariants

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```
