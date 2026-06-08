# Evolution-Aware Swarm And RHO BES Expansion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Helios Forge's swarm and adjacent harness subsystems into the RHO + BES + evolution + meta-promotion loop so the harness can learn from hard cases while preserving verifier, rollback, and approval safety.

**Architecture:** Keep the existing sidecar runtime, BES/RHO/meta optimizer, verifier evolution, and swarm modules. Add focused adapters that turn evolutionary outputs into swarm plans, budget decisions, trace feedback, and subsystem-specific candidate policies. Every candidate policy starts in shadow/replay mode and cannot promote without evidence and the existing approval gates.

**Tech Stack:** Node.js ESM, built-in `node:test`, local `.harness` traces/state, existing sidecar modules, PowerShell on Windows.

---

## Source Documents

Read these first:

- `docs/architecture/swarm-evolution-integration-plan.md`
- `docs/architecture/rho-bes-evolution-expansion-roadmap.md`
- `docs/architecture/feature-architecture-map.md`
- `src/harness-sidecar/bes/bidirectionalSearchLoop.js`
- `src/harness-sidecar/bes/evolutionPopulationRunner.js`
- `src/harness-sidecar/rho/coresetBuilder.js`
- `src/harness-sidecar/meta/besMetaOptimizer.js`
- `src/harness-sidecar/swarm/swarmOrchestrator.js`

## Coordination Rules For Subagents

- Each worker owns one chunk and should avoid broad refactors.
- Prefer new small modules over inflating `server.js` or `swarmOrchestrator.js`.
- Every behavior starts with a failing `node:test` test.
- Keep mutation and promotion approval-gated.
- Do not add network calls or package dependencies unless explicitly approved.
- Commit after each task or tightly related task pair.
- Run the focused test for the owned slice before handoff.
- Before merging chunks together, run:

```powershell
npm test -- tests/harness-swarm.test.js tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js tests/harness-swarm-apply.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-rho-coreset.test.js tests/harness-sidecar.test.js
```

Expected: all tests pass, with only pre-existing skips allowed.

## File Map

Expected new files:

- `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
- `src/harness-sidecar/swarm/evolutionBudgetAllocator.js`
- `src/harness-sidecar/swarm/swarmExecutor.js`
- `src/harness-sidecar/swarm/agentProfiles.js`
- `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`
- `src/harness-sidecar/meta/contextPolicyEvolution.js`
- `src/harness-sidecar/meta/toolLoopPolicyEvolution.js`
- `src/harness-sidecar/meta/budgetPolicyEvolution.js`
- `src/harness-sidecar/meta/visualPolicyEvolution.js`
- `src/harness-sidecar/meta/memoryPolicyEvolution.js`
- `src/harness-sidecar/meta/mcpTrustEvolution.js`
- `src/harness-sidecar/meta/researchPolicyEvolution.js`
- `src/harness-sidecar/meta/autoApprovalPolicy.js`

Expected modified files:

- `src/harness-sidecar/swarm/attemptScheduler.js`
- `src/harness-sidecar/swarm/swarmOrchestrator.js`
- `src/harness-sidecar/swarm/rolePrompts.js`
- `src/harness-sidecar/server.js`
- `src/harness-sidecar/rho/coresetBuilder.js`
- `src/harness-sidecar/meta/besMetaOptimizer.js`
- `src/harness-sidecar/meta/promotionPolicy.js`
- `src/harness-sidecar/tools/toolLoopController.js`
- `src/harness-sidecar/tools/verifierSelector.js`
- `src/harness-sidecar/budget/costAwareAllocator.js`
- `docs/architecture/feature-architecture-map.md`

Expected new tests:

- `tests/harness-swarm-evolution-planner.test.js`
- `tests/harness-swarm-evolution-budget.test.js`
- `tests/harness-swarm-parallel-executor.test.js`
- `tests/harness-swarm-agent-profiles.test.js`
- `tests/harness-swarm-meta-feedback.test.js`
- `tests/harness-context-policy-evolution.test.js`
- `tests/harness-tool-loop-policy-evolution.test.js`
- `tests/harness-budget-policy-evolution.test.js`
- `tests/harness-visual-policy-evolution.test.js`
- `tests/harness-memory-policy-evolution.test.js`
- `tests/harness-mcp-trust-evolution.test.js`
- `tests/harness-research-policy-evolution.test.js`
- `tests/harness-auto-approval-policy.test.js`

---

## Chunk 1: Evolution-Aware Swarm Planner

**Agent:** Swarm Planner Agent

**Goal:** Convert BES/evolution archive outputs into swarm attempt records while preserving seeded and ToolTree fallback behavior.

**Files:**

- Create: `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
- Modify: `src/harness-sidecar/swarm/attemptScheduler.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-swarm-evolution-planner.test.js`

### Task 1: Planner Module

- [ ] **Step 1: Write failing tests**

Create `tests/harness-swarm-evolution-planner.test.js`.

Required cases:

- evolution archive entries become attempt records
- attempts include `lineage`, `goalScore`, `islandId`, and `specialization`
- planner preserves diversity across islands
- planner falls back to seeded strategies when no archive exists
- visual goals produce `visual-specialist` specialization

Run:

```powershell
npm test -- tests/harness-swarm-evolution-planner.test.js
```

Expected: fail because `evolutionSwarmPlanner.js` does not exist.

- [ ] **Step 2: Implement minimal planner**

Create `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`.

Interface:

```js
export function planEvolutionSwarmAttempts({
  taskId,
  taskType = 'general',
  maxAttempts = 4,
  evolutionArchive = [],
  bidirectionalBes = null,
  rhoCoreset = null,
  fallbackAttempts = [],
} = {}) {
  // returns attempt records compatible with orchestrateSwarm
}
```

Rules:

- Prefer correct/high-score archive entries.
- Keep at least two islands when available.
- Include missing-goal attempts from `bidirectionalBes.frontier`.
- Assign `specialization: 'visual-specialist'` when goal or evidence mentions visual/VLM.
- Normalize `budgetWeight` to `0.1..1`.

- [ ] **Step 3: Wire scheduler**

Modify `scheduleAttempts` to accept:

```js
evolutionPlanner: {
  enabled: true,
  bidirectionalBes,
  evolutionArchive,
  rhoCoreset,
}
```

Order:

1. evolution planner when enabled and archive/frontier exists
2. ToolTree planner
3. seeded fallback

- [ ] **Step 4: Wire runtime**

In `src/harness-sidecar/server.js`, pass runtime BES/evolution outputs into the swarm scheduler through `orchestrateSwarm`.

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-evolution-planner.test.js tests/harness-swarm-runtime.test.js tests/harness-sidecar.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add src/harness-sidecar/swarm/evolutionSwarmPlanner.js src/harness-sidecar/swarm/attemptScheduler.js src/harness-sidecar/server.js tests/harness-swarm-evolution-planner.test.js
git commit -m "feat(swarm): plan attempts from evolution archive"
```

---

## Chunk 2: Fitness-Based Swarm Budget Allocation

**Agent:** Budget Evolution Agent

**Goal:** Allocate per-attempt budget from BES goal score, verifier evidence, visual cases, novelty, and global budget pressure.

**Files:**

- Create: `src/harness-sidecar/swarm/evolutionBudgetAllocator.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/budget/costAwareAllocator.js`
- Test: `tests/harness-swarm-evolution-budget.test.js`

### Task 1: Budget Allocator

- [ ] **Step 1: Write failing tests**

Required cases:

- high goal score gets higher budget
- low score with novelty still gets a small exploration budget
- visual-specialist attempts get VLM/artifact budget
- budget pressure downshifts expensive attempts
- allocation rationale is included in attempt metadata

Run:

```powershell
npm test -- tests/harness-swarm-evolution-budget.test.js
```

Expected: fail because allocator does not exist.

- [ ] **Step 2: Implement allocator**

Create:

```js
export function allocateEvolutionSwarmBudgets({
  attempts = [],
  budgetState = {},
  maxOutputChars = 1200,
  visualBudget = {},
} = {}) {
  // returns attempts with budget and budgetRationale
}
```

Budget metadata should include:

- `maxOutputChars`
- `maxToolCalls`
- `visualArtifactsAllowed`
- `priority`
- `rationale`

- [ ] **Step 3: Wire orchestrator**

In `swarmOrchestrator.js`, apply allocation after scheduling and before running attempts.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-evolution-budget.test.js tests/harness-swarm-runtime.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/swarm/evolutionBudgetAllocator.js src/harness-sidecar/swarm/swarmOrchestrator.js src/harness-sidecar/budget/costAwareAllocator.js tests/harness-swarm-evolution-budget.test.js
git commit -m "feat(swarm): allocate budgets from evolution fitness"
```

---

## Chunk 3: Parallel Ask/Tell Swarm Executor

**Agent:** Parallel Swarm Agent

**Goal:** Replace sequential swarm attempt execution with bounded concurrency while preserving deterministic audit output.

**Files:**

- Create: `src/harness-sidecar/swarm/swarmExecutor.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Test: `tests/harness-swarm-parallel-executor.test.js`

### Task 1: Bounded Executor

- [ ] **Step 1: Write failing tests**

Required cases:

- starts multiple attempts up to concurrency limit
- attempts may complete out of order
- final result order is deterministic by original rank
- one failed attempt does not stop others
- event stream includes started/completed for every attempt

Run:

```powershell
npm test -- tests/harness-swarm-parallel-executor.test.js
```

Expected: fail because executor does not exist.

- [ ] **Step 2: Implement executor**

Create:

```js
export async function runSwarmAttemptsBounded({
  attempts = [],
  concurrency = 2,
  runAttempt,
  onAttemptEvent,
} = {}) {
  // returns deterministic result array
}
```

Rules:

- Throw if `runAttempt` is not a function.
- Clamp concurrency to `1..attempts.length`.
- Preserve result order by attempt index.
- Capture failure records instead of rejecting the whole swarm.

- [ ] **Step 3: Wire orchestrator**

Use executor inside `orchestrateSwarm`. Default concurrency should be `1` until config enables more, to avoid changing runtime behavior unexpectedly.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-parallel-executor.test.js tests/harness-swarm-runtime.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/swarm/swarmExecutor.js src/harness-sidecar/swarm/swarmOrchestrator.js tests/harness-swarm-parallel-executor.test.js
git commit -m "feat(swarm): add bounded parallel executor"
```

---

## Chunk 4: Named Agent Profiles

**Agent:** Agent Profile Agent

**Goal:** Turn swarm roles into explicit profiles with model, tool, memory, VLM, worktree, and output-contract settings.

**Files:**

- Create: `src/harness-sidecar/swarm/agentProfiles.js`
- Modify: `src/harness-sidecar/swarm/rolePrompts.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Test: `tests/harness-swarm-agent-profiles.test.js`

### Task 1: Profile Registry

- [ ] **Step 1: Write failing tests**

Required profiles:

- `implementer`
- `reviewer`
- `recombiner`
- `visual-specialist`
- `test-specialist`
- `risk-auditor`
- `researcher`

Required behavior:

- default profiles are safe and deny dangerous tools
- visual specialist has VLM access metadata
- risk auditor cannot mutate workspace
- profile output contract feeds prompt builder

- [ ] **Step 2: Implement profile registry**

Create:

```js
export function loadDefaultAgentProfiles() {}
export function getAgentProfile({ profiles, profileId }) {}
export function selectAgentProfileForAttempt({ attempt, task, goalTree }) {}
```

- [ ] **Step 3: Wire role prompts**

Make `buildRolePrompt` accept a profile and include:

- role mission
- allowed files
- tool caps
- output contract
- VLM allowance
- worktree requirement

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-agent-profiles.test.js tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/swarm/agentProfiles.js src/harness-sidecar/swarm/rolePrompts.js src/harness-sidecar/swarm/swarmOrchestrator.js tests/harness-swarm-agent-profiles.test.js
git commit -m "feat(swarm): add named agent profiles"
```

---

## Chunk 5: Swarm Outcome Feedback Into RHO And Meta Evolution

**Agent:** Swarm Feedback Agent

**Goal:** Record swarm outcomes as structured trace evidence and feed them into RHO/meta optimization.

**Files:**

- Create: `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-swarm-meta-feedback.test.js`
- Test: `tests/harness-rho-coreset.test.js`

### Task 1: Outcome Recorder

- [ ] **Step 1: Write failing tests**

Required cases:

- champion success creates positive training signal
- rejected attempts create hard cases
- missing verifier evidence is selected by RHO
- visual failure is preserved as a visual/VLM case
- unsafe patches are archived but cannot promote

- [ ] **Step 2: Implement recorder**

Create:

```js
export function summarizeSwarmOutcome({
  taskId,
  attempts = [],
  reviews = [],
  champion = null,
  recombination = null,
} = {}) {}
```

Output should include:

- `positiveSignals`
- `hardCases`
- `failureModes`
- `visualCases`
- `metaCandidates`

- [ ] **Step 3: Extend RHO**

Update `buildRhoCoreset` to score swarm hard cases:

- `swarm_missing_verifier_evidence`
- `swarm_unsafe_patch`
- `swarm_visual_failure`
- `swarm_recombination_win`
- `swarm_champion_regression`

- [ ] **Step 4: Wire server**

After swarm completion, emit:

- `swarm.outcome_recorded`
- `rho.swarm_cases_selected` when applicable

- [ ] **Step 5: Verify**

Run:

```powershell
npm test -- tests/harness-swarm-meta-feedback.test.js tests/harness-rho-coreset.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-sidecar.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```powershell
git add src/harness-sidecar/swarm/swarmOutcomeRecorder.js src/harness-sidecar/rho/coresetBuilder.js src/harness-sidecar/meta/besMetaOptimizer.js src/harness-sidecar/server.js tests/harness-swarm-meta-feedback.test.js tests/harness-rho-coreset.test.js
git commit -m "feat(meta): feed swarm outcomes into rho bes evolution"
```

---

## Chunk 6: Context And RAG Policy Evolution

**Agent:** Context Evolution Agent

**Goal:** Add a shadow-mode policy evolver for context/RAG selection using RHO hard cases and BES dense goals.

**Files:**

- Create: `src/harness-sidecar/meta/contextPolicyEvolution.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-context-policy-evolution.test.js`

### Task 1: Context Policy Candidate Generator

- [ ] **Step 1: Write failing tests**

Required cases:

- missing-context traces become RHO hard cases
- candidate policies include retrieval weights and budget limits
- candidate evaluation rewards relevant context and penalizes noise
- candidates remain shadow-only by default

- [ ] **Step 2: Implement candidate generator**

Create:

```js
export function proposeContextPolicies({
  coreset,
  baselinePolicy = {},
  maxCandidates = 4,
} = {}) {}
```

Candidate fields:

- `lexicalWeight`
- `graphWeight`
- `memoryWeight`
- `recentTraceWeight`
- `maxContextItems`
- `maxTokens`
- `status: 'shadow_only'`

- [ ] **Step 3: Add replay evaluator**

Add:

```js
export function evaluateContextPolicyCandidate({ candidate, traceCase }) {}
```

Return normalized score, reasons, and safety status.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-context-policy-evolution.test.js tests/harness-rho-coreset.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/meta/contextPolicyEvolution.js src/harness-sidecar/rho/coresetBuilder.js src/harness-sidecar/server.js tests/harness-context-policy-evolution.test.js
git commit -m "feat(meta): add context policy evolution shadow mode"
```

---

## Chunk 7: Tool Loop Policy Evolution

**Agent:** Tool Loop Evolution Agent

**Goal:** Evolve tool-loop retry, repair, and approval-escalation policy in shadow mode.

**Files:**

- Create: `src/harness-sidecar/meta/toolLoopPolicyEvolution.js`
- Modify: `src/harness-sidecar/tools/toolLoopController.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-tool-loop-policy-evolution.test.js`

### Task 1: Tool Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- unknown-tool failures become hard cases
- malformed JSON repair failures become hard cases
- candidate policy includes retry limits and approval thresholds
- unsafe tool expansion cannot promote

- [ ] **Step 2: Implement evolver**

Create:

```js
export function proposeToolLoopPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateToolLoopPolicyCandidate({ candidate, traceCase } = {}) {}
```

Candidate fields:

- `maxRepairAttempts`
- `maxSameToolRetries`
- `approvalEscalation`
- `safeFallbackTools`
- `status: 'shadow_only'`

- [ ] **Step 3: Expose policy input without changing defaults**

Let `runToolLoop` accept optional `policy`, but preserve current behavior when omitted.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-tool-loop-policy-evolution.test.js tests/harness-tools.test.js tests/harness-sidecar.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/meta/toolLoopPolicyEvolution.js src/harness-sidecar/tools/toolLoopController.js src/harness-sidecar/rho/coresetBuilder.js tests/harness-tool-loop-policy-evolution.test.js
git commit -m "feat(meta): add tool loop policy evolution"
```

---

## Chunk 8: Budget Policy Evolution

**Agent:** Budget Policy Agent

**Goal:** Evolve budget profiles for model calls, VLM, verifiers, retrieval, and swarm attempts.

**Files:**

- Create: `src/harness-sidecar/meta/budgetPolicyEvolution.js`
- Modify: `src/harness-sidecar/budget/costAwareAllocator.js`
- Modify: `src/harness-sidecar/budget/gates.js`
- Test: `tests/harness-budget-policy-evolution.test.js`

### Task 1: Budget Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- budget exhaustion traces become RHO hard cases
- candidate policies adjust verifier/VLM/swarm spend
- candidates cannot increase cost without explicit approval flag
- low confidence escalates verification budget

- [ ] **Step 2: Implement budget policy evolver**

Create:

```js
export function proposeBudgetPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateBudgetPolicyCandidate({ candidate, traceCase, approvals = [] } = {}) {}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-budget-policy-evolution.test.js tests/harness-budget-dashboard.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/budgetPolicyEvolution.js src/harness-sidecar/budget/costAwareAllocator.js src/harness-sidecar/budget/gates.js tests/harness-budget-policy-evolution.test.js
git commit -m "feat(meta): add budget policy evolution"
```

---

## Chunk 9: Visual/VLM Policy Evolution

**Agent:** Visual Evolution Agent

**Goal:** Evolve visual capture routing, VLM rubric strictness, and threshold policy from visual hard cases.

**Files:**

- Create: `src/harness-sidecar/meta/visualPolicyEvolution.js`
- Modify: `src/harness-sidecar/vlm/visualVerifierRubric.js`
- Modify: `src/harness-sidecar/tools/verifierSelector.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-visual-policy-evolution.test.js`

### Task 1: Visual Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- visual false positives/negatives become RHO hard cases
- candidate policy tunes score and confidence thresholds
- candidate routes PDF/OCR/screenshot/diff workers by task
- VLM-only pass without artifact support is penalized

- [ ] **Step 2: Implement visual policy evolver**

Create:

```js
export function proposeVisualPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateVisualPolicyCandidate({ candidate, visualCase } = {}) {}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-visual-policy-evolution.test.js tests/harness-visual-verifier.test.js tests/harness-vlm-production.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/visualPolicyEvolution.js src/harness-sidecar/vlm/visualVerifierRubric.js src/harness-sidecar/tools/verifierSelector.js src/harness-sidecar/rho/coresetBuilder.js tests/harness-visual-policy-evolution.test.js
git commit -m "feat(meta): add visual policy evolution"
```

---

## Chunk 10: Memory Policy Evolution

**Agent:** Memory Evolution Agent

**Goal:** Evolve memory promotion, decay, contradiction, and retrieval priority policy from outcome evidence.

**Files:**

- Create: `src/harness-sidecar/meta/memoryPolicyEvolution.js`
- Modify: `src/harness-sidecar/memory/promotionPolicy.js`
- Modify: `src/harness-sidecar/memory/reflectionGate.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Test: `tests/harness-memory-policy-evolution.test.js`

### Task 1: Memory Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- helpful memories become positive signal
- contradicted memories are penalized
- stale memory gets decay pressure
- candidate cannot promote memory without provenance

- [ ] **Step 2: Implement memory policy evolver**

Create:

```js
export function proposeMemoryPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateMemoryPolicyCandidate({ candidate, memoryCase } = {}) {}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-memory-policy-evolution.test.js tests/harness-memory.test.js tests/harness-memory-graph.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/memoryPolicyEvolution.js src/harness-sidecar/memory/promotionPolicy.js src/harness-sidecar/memory/reflectionGate.js src/harness-sidecar/rho/coresetBuilder.js tests/harness-memory-policy-evolution.test.js
git commit -m "feat(meta): add memory policy evolution"
```

---

## Chunk 11: MCP And Capability Trust Evolution

**Agent:** MCP Trust Agent

**Goal:** Evolve MCP/capability trust tiers, quarantine triggers, and allow/deny policy in shadow mode.

**Files:**

- Create: `src/harness-sidecar/meta/mcpTrustEvolution.js`
- Modify: `src/harness-sidecar/tools/mcpPolicy.js`
- Modify: `src/harness-sidecar/capabilities/capabilityStore.js`
- Test: `tests/harness-mcp-trust-evolution.test.js`

### Task 1: Trust Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- suspicious MCP output becomes hard case
- failed capability startup lowers trust
- candidate policy can quarantine untrusted tools
- candidate cannot expand write scope without approval

- [ ] **Step 2: Implement trust evolver**

Create:

```js
export function proposeMcpTrustPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateMcpTrustPolicyCandidate({ candidate, mcpCase, approvals = [] } = {}) {}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-mcp-trust-evolution.test.js tests/harness-mcp-security.test.js tests/harness-capabilities.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/mcpTrustEvolution.js src/harness-sidecar/tools/mcpPolicy.js src/harness-sidecar/capabilities/capabilityStore.js tests/harness-mcp-trust-evolution.test.js
git commit -m "feat(meta): add mcp trust policy evolution"
```

---

## Chunk 12: Deep Research Policy Evolution

**Agent:** Research Evolution Agent

**Goal:** Evolve source ranking, claim extraction, contradiction checks, and report template choices for deep research tasks.

**Files:**

- Create: `src/harness-sidecar/meta/researchPolicyEvolution.js`
- Modify: `src/harness-sidecar/research/deepResearchManager.js`
- Modify: `src/harness-sidecar/research/noveltyControls.js`
- Test: `tests/harness-research-policy-evolution.test.js`

### Task 1: Research Policy Candidates

- [ ] **Step 1: Write failing tests**

Required cases:

- unsupported claim traces become hard cases
- contradiction misses become hard cases
- candidate policy rewards source-grounded evidence
- figure-only evidence risk is penalized

- [ ] **Step 2: Implement research evolver**

Create:

```js
export function proposeResearchPolicies({ coreset, baselinePolicy = {}, maxCandidates = 4 } = {}) {}
export function evaluateResearchPolicyCandidate({ candidate, researchCase } = {}) {}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-research-policy-evolution.test.js tests/harness-deep-research-v2.test.js
```

Expected: all pass.

- [ ] **Step 4: Commit**

```powershell
git add src/harness-sidecar/meta/researchPolicyEvolution.js src/harness-sidecar/research/deepResearchManager.js src/harness-sidecar/research/noveltyControls.js tests/harness-research-policy-evolution.test.js
git commit -m "feat(meta): add research policy evolution"
```

---

## Chunk 13: Evidence-Gated Auto-Approval Policy

**Agent:** Approval Safety Agent

**Goal:** Define and test narrow autonomous approval tiers without creating self-approval loopholes.

**Files:**

- Create: `src/harness-sidecar/meta/autoApprovalPolicy.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Modify: `src/harness-sidecar/core/approvalResume.js`
- Test: `tests/harness-auto-approval-policy.test.js`

### Task 1: Auto-Approval Decision Function

- [ ] **Step 1: Write failing tests**

Required cases:

- `shadow_only` never mutates
- local reversible config can auto-approve with held-out pass and rollback metadata
- branch mutation always requires human approval
- secret-bearing config always requires human approval
- MCP write-scope expansion always requires human approval
- verifier safety weakening always requires human approval
- cost increase requires explicit approval flag

- [ ] **Step 2: Implement policy**

Create:

```js
export function decideAutoApproval({
  candidate,
  evidence = {},
  rollback = null,
  trust = {},
  approvals = [],
  policy = {},
} = {}) {}
```

Return:

```js
{
  status: 'auto_approved' | 'human_required' | 'denied' | 'shadow_only',
  reasons: [],
  tier: 'never' | 'shadow_only' | 'local_config_only' | 'reversible_workspace_change' | 'human_required'
}
```

- [ ] **Step 3: Wire promotion policy only as optional input**

Do not auto-apply anything yet. Make promotion code able to report auto-approval eligibility as metadata.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-auto-approval-policy.test.js tests/harness-meta-promotion.test.js tests/harness-approval-resume.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/meta/autoApprovalPolicy.js src/harness-sidecar/meta/promotionPolicy.js src/harness-sidecar/core/approvalResume.js tests/harness-auto-approval-policy.test.js
git commit -m "feat(meta): add evidence gated auto approval policy"
```

---

## Chunk 14: Runtime Dashboard And Documentation Integration

**Agent:** Operator Surface Agent

**Goal:** Make the new evolution-aware paths visible and documented without overwhelming the UI.

**Files:**

- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/swarm-evolution-integration-plan.md`
- Modify: `docs/architecture/rho-bes-evolution-expansion-roadmap.md`
- Test: `tests/harness-ui-discoverability.test.js`

### Task 1: UI Event Visibility

- [ ] **Step 1: Write failing tests**

Required cases:

- UI recognizes `swarm.evolution_planning_created`
- UI recognizes `swarm.outcome_recorded`
- UI recognizes policy evolution summary events
- UI shows pending auto-approval eligibility as metadata, not an automatic action

- [ ] **Step 2: Add UI handling**

Add compact event summaries only. Do not create a huge dashboard in this chunk.

- [ ] **Step 3: Update docs**

Update architecture docs with implemented event names and feature gates.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-ui-discoverability.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add public/app.js public/index.html docs/architecture/feature-architecture-map.md docs/architecture/swarm-evolution-integration-plan.md docs/architecture/rho-bes-evolution-expansion-roadmap.md tests/harness-ui-discoverability.test.js
git commit -m "docs(ui): surface evolution aware swarm status"
```

---

## Final Integration Pass

**Agent:** Integration Lead

Run after all chunks land.

- [ ] **Step 1: Run focused evolution/swarm suite**

```powershell
npm test -- tests/harness-swarm-evolution-planner.test.js tests/harness-swarm-evolution-budget.test.js tests/harness-swarm-parallel-executor.test.js tests/harness-swarm-agent-profiles.test.js tests/harness-swarm-meta-feedback.test.js tests/harness-context-policy-evolution.test.js tests/harness-tool-loop-policy-evolution.test.js tests/harness-budget-policy-evolution.test.js tests/harness-visual-policy-evolution.test.js tests/harness-memory-policy-evolution.test.js tests/harness-mcp-trust-evolution.test.js tests/harness-research-policy-evolution.test.js tests/harness-auto-approval-policy.test.js
```

Expected: all pass.

- [ ] **Step 2: Run existing safety suite**

```powershell
npm test -- tests/harness-sidecar.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-rho-coreset.test.js tests/harness-verifier-evolution-loop.test.js tests/harness-visual-verifier.test.js tests/harness-mcp-security.test.js tests/harness-approval-resume.test.js
```

Expected: all pass.

- [ ] **Step 3: Run full suite**

```powershell
npm test
```

Expected: all pass, with only pre-existing skips.

- [ ] **Step 4: Secret/private endpoint scan**

```powershell
rg -n "95\.133|http://95\.133|selimaktas|Bearer [A-Za-z0-9]|ghp_[A-Za-z0-9]|sk-[A-Za-z0-9]{12,}" src tests docs
```

Expected: no new private endpoint or secret-bearing matches. Existing intentional test fixtures must be reviewed before ignoring.

- [ ] **Step 5: Diff hygiene**

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Final commit**

```powershell
git status --short
git commit -m "feat(meta): integrate rho bes evolution across swarm policies"
```

Only commit if all required chunks are already staged and verified.
