# Adaptive Model Router AB-MCTS Uplift Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the evidence-only multi-model council into a learned adaptive model router, wire model choice into BES/AB-MCTS, feed RHO/meta-harness hard cases back into routing, support A2A model negotiation, and prove combined-intelligence uplift with controlled pass@k evals.

**Architecture:** Keep the existing model council advisory boundary: model selection can influence which attempt runs, but it cannot approve or promote durable changes. Add a learned router state store, Thompson-sampling policy, reward attribution from council outcomes, AB-MCTS node expansion over model choice, RHO hard-case selection for routing failures, meta-harness optimization over role/task routing policies, and benchmark reports that compare best single model, repeated sampling, static council, and adaptive council.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar BES/RHO/meta/swarm/interop modules, JSONL/JSON harness artifacts, OpenAI-compatible model profiles, existing trace/event transport, existing browser UI.

---

## Current State

The current substrate already provides:

- Role-specialized model routing: `src/harness-sidecar/swarm/modelCouncil.js`.
- Endpoint/profile normalization: `src/harness-sidecar/model/modelEndpointProfiles.js`.
- Multi-endpoint provider routing: `src/harness-sidecar/model/routingModelProvider.js`.
- Per-attempt route metadata in swarm runtime: `src/harness-sidecar/swarm/swarmOrchestrator.js`.
- BES adaptive-search primitives: `src/harness-sidecar/bes/adaptiveSearchScheduler.js`, `mctsPolicy.js`, `toolTreePlanner.js`, `laneRuntime.js`.
- RHO hard-case and coreset primitives: `src/harness-sidecar/rho/coresetBuilder.js`, `replayBatchRunner.js`.
- Meta-harness candidate/replay/frontier loops: `src/harness-sidecar/meta/harnessExperimentRunner.js`, `harnessRunStore.js`, `harnessOptimizer.js`, `besMetaOptimizer.js`.
- Durable A2A negotiation substrate: `src/harness-sidecar/interop/a2aEndpointRegistry.js`, `a2aSwarmEnvelope.js`, `externalAgentGateway.js`.

The missing layer is learned, measured model-choice intelligence:

- BES does not learn model-routing weights from council outcomes.
- Meta-harness does not optimize which model works best for each role/task.
- RHO does not select hard cases specifically to improve the model router.
- Agent mesh/A2A peers do not negotiate model choice dynamically.
- No pass@k eval proves uplift over the best single model.

## Target Behavior

The final runtime loop should be:

```text
task/context
-> RHO selects router-relevant hard cases
-> BES expands breadth/depth/model-choice nodes
-> model router samples role/task model arms with Thompson sampling
-> swarm attempts run through selected routes
-> verifier/reviewer/council outcomes become reward evidence
-> router updates posterior weights evidence-only
-> meta-harness evaluates routing-policy variants over held-out suites
-> A2A peers negotiate model capabilities when delegation is useful
-> pass@k report proves or rejects combined-intelligence uplift
```

Non-negotiable safety rule:

```text
learned model routing can choose attempts; it cannot promote results.
```

---

## File Map

- Create `src/harness-sidecar/model/modelRouterState.js`: in-memory and JSON-serializable posterior state for model arms by role/task/node signature.
- Create `src/harness-sidecar/model/modelRouterPolicy.js`: Thompson-sampling selection, priors, reward updates, bounded exploration, and deterministic seeded RNG for tests.
- Create `src/harness-sidecar/model/modelRouterRewards.js`: convert council, verifier, reviewer, cost, latency, safety, and pass/fail outcomes into bounded reward records.
- Create `src/harness-sidecar/bes/modelChoiceMcts.js`: AB-MCTS expansion over action type plus model arm, reusing existing MCTS policy helpers.
- Create `src/harness-sidecar/evals/modelCouncilPassK.js`: deterministic pass@k experiment runner comparing single-model, repeated sampling, static council, and adaptive council.
- Create `src/harness-sidecar/rho/modelRouterHardCases.js`: select cases that are useful for improving model routing.
- Create `src/harness-sidecar/meta/modelRoutingPolicyEvolution.js`: propose/evaluate routing policy variants through meta-harness evidence.
- Modify `src/harness-sidecar/swarm/modelCouncil.js`: attach router state summaries and outcome attribution hooks without changing authority.
- Modify `src/harness-sidecar/swarm/swarmOrchestrator.js`: ask router policy for per-attempt route candidates, record model-choice action IDs, and emit reward update events.
- Modify `src/harness-sidecar/bes/adaptiveSearchScheduler.js`: allow adaptive-search arms to include model-choice subarms.
- Modify `src/harness-sidecar/bes/laneRuntime.js`: carry model-router evidence in BES lane envelopes.
- Modify `src/harness-sidecar/meta/harnessOptimizer.js`: include model-routing policy target.
- Modify `src/harness-sidecar/meta/harnessExperimentRunner.js`: persist routing-policy eval artifacts.
- Modify `src/harness-sidecar/rho/coresetBuilder.js`: tag router-specific failures and expose them to router hard-case selection.
- Modify `src/harness-sidecar/interop/a2aEndpointRegistry.js`: include model capabilities/preferences in negotiation request/response envelopes.
- Modify `src/harness-sidecar/interop/a2aSwarmEnvelope.js`: preserve selected/negotiated model-route evidence.
- Modify `src/harness-sidecar/server.js`: add feature gates, runtime wiring, trace events, and pass@k API endpoints.
- Modify `public/app.js`: display router policy state, reward updates, pass@k results, and negotiated A2A model routes in existing trace/status surfaces.
- Modify `docs/architecture/evolutionary-agentic-organism-gap-map.md`: move the newly implemented gaps after execution.
- Add tests:
  - `tests/harness-model-router-policy.test.js`
  - `tests/harness-model-router-rewards.test.js`
  - `tests/harness-bes-model-choice-mcts.test.js`
  - `tests/harness-rho-model-router-hard-cases.test.js`
  - `tests/harness-meta-model-routing-policy.test.js`
  - `tests/harness-a2a-model-negotiation.test.js`
  - `tests/harness-model-council-passk.test.js`

---

## Chunk 1: Router State And Thompson Sampling

### Task 1: Add Router Feature Defaults

**Files:**
- Modify: `src/harness-sidecar/config/configLoader.js`
- Test: `tests/harness-config.test.js`

- [ ] **Step 1: Write the failing config test**

Add assertions:

```js
assert.equal(config.features.adaptiveModelRouter, false);
assert.equal(config.modelRouter.enabled, false);
assert.equal(config.modelRouter.mode, 'advisory');
assert.equal(config.modelRouter.strategy, 'thompson_sampling');
assert.equal(config.modelRouter.minEvidencePerArm, 5);
assert.equal(config.modelRouter.explorationFloor, 0.05);
assert.deepEqual(config.modelRouter.rewardWeights.verifier, 0.4);
```

- [ ] **Step 2: Run the failing test**

Run: `node --test tests\harness-config.test.js`

Expected: FAIL because `features.adaptiveModelRouter` and `modelRouter` do not exist.

- [ ] **Step 3: Add disabled defaults**

Add:

```js
features: {
  adaptiveModelRouter: false,
},
modelRouter: {
  enabled: false,
  mode: 'advisory',
  strategy: 'thompson_sampling',
  minEvidencePerArm: 5,
  explorationFloor: 0.05,
  maxArmsPerDecision: 8,
  rewardWeights: {
    verifier: 0.4,
    reviewer: 0.2,
    councilAgreement: 0.15,
    safety: 0.15,
    latency: 0.05,
    cost: 0.05,
  },
  persistence: {
    enabled: false,
    path: '.harness/model-router-state.json',
  },
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-config.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/config/configLoader.js tests/harness-config.test.js
git commit -m "feat: add adaptive model router config defaults"
```

### Task 2: Implement Posterior State Store

**Files:**
- Create: `src/harness-sidecar/model/modelRouterState.js`
- Test: `tests/harness-model-router-policy.test.js`

- [ ] **Step 1: Write failing state tests**

Test these behaviors:

- Empty state creates Beta priors for unseen arms.
- State key is role plus task signature plus optional AB-MCTS node kind.
- Reward updates increment alpha on success and beta on failure.
- State serialization never includes raw prompts or secrets.

Example:

```js
const state = createModelRouterState();
const key = modelRouterKey({ role: 'reviewer', taskType: 'code', nodeKind: 'critique' });
state.recordReward({ key, armId: 'critic_low_temp', reward: 0.8, evidence: { taskId: 't1' } });
const arm = state.snapshot().keys[key].arms.critic_low_temp;
assert.equal(arm.successes, 0.8);
assert.equal(arm.failures, 0.2);
assert.equal(JSON.stringify(arm).includes('raw-secret-value'), false);
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-router-policy.test.js`

Expected: FAIL because module is missing.

- [ ] **Step 3: Implement state store**

Export:

```js
export function modelRouterKey({ role, taskType, nodeKind, capabilityTags } = {}) {}
export function createModelRouterState({ priorAlpha = 1, priorBeta = 1, initialState } = {}) {}
export function sanitizeRouterEvidence(evidence = {}) {}
```

State API:

```js
{
  getArm({ key, armId }),
  listArms({ key }),
  recordReward({ key, armId, reward, evidence }),
  snapshot(),
  restore(snapshot),
}
```

Implementation rules:

- Clamp reward to `[0, 1]`.
- Treat partial reward as fractional success/failure.
- Keep only bounded evidence fields: `taskId`, `attemptId`, `role`, `modelProfile`, `endpointProfile`, `verifierPassed`, `score`, `latencyMs`, `costEstimate`, `safetyBlocked`, `failureModes`.
- Do not persist full prompts, full outputs, headers, tokens, credentials, or raw endpoint configs.

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-model-router-policy.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/model/modelRouterState.js tests/harness-model-router-policy.test.js
git commit -m "feat: add model router posterior state"
```

### Task 3: Implement Thompson-Sampling Policy

**Files:**
- Create: `src/harness-sidecar/model/modelRouterPolicy.js`
- Test: `tests/harness-model-router-policy.test.js`

- [ ] **Step 1: Write failing policy tests**

Assert:

- With no evidence, all configured arms are eligible.
- With strong success evidence, the stronger arm is selected by deterministic seeded RNG.
- Exploration floor keeps weak arms eligible.
- Safety-blocked or unhealthy arms can be excluded.
- Selection returns evidence-only metadata.

Example:

```js
const policy = createModelRouterPolicy({
  state,
  rng: seededRng('router-test'),
  explorationFloor: 0.05,
});
const decision = policy.selectArm({
  key,
  role: 'implementer',
  arms: [
    { armId: 'fast_model', modelProfile: 'fast_model' },
    { armId: 'deep_model', modelProfile: 'deep_model' },
  ],
});
assert.equal(decision.authority, 'evidence_only');
assert.equal(decision.canPromote, false);
assert.ok(['fast_model', 'deep_model'].includes(decision.armId));
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-router-policy.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement policy**

Export:

```js
export function createModelRouterPolicy({ state, rng, explorationFloor, maxArmsPerDecision } = {}) {}
export function sampleBeta({ alpha, beta, rng }) {}
export function normalizeRouterArms({ council, role, taskContext } = {}) {}
```

Selection output:

```js
{
  type: 'model_router.arm_selected',
  authority: 'evidence_only',
  canPromote: false,
  key,
  actionId,
  role,
  armId,
  modelProfile,
  endpointProfile,
  sampledValue,
  posterior: { alpha, beta, observations },
  alternatives: [{ armId, sampledValue, observations }],
}
```

Use a lightweight deterministic Gamma/Beta sampler suitable for tests. Do not add a heavy dependency.

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-model-router-policy.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/model/modelRouterPolicy.js tests/harness-model-router-policy.test.js
git commit -m "feat: select model routes with Thompson sampling"
```

---

## Chunk 2: Reward Attribution From Council Outcomes

### Task 4: Convert Attempt Outcomes Into Router Rewards

**Files:**
- Create: `src/harness-sidecar/model/modelRouterRewards.js`
- Test: `tests/harness-model-router-rewards.test.js`

- [ ] **Step 1: Write failing reward tests**

Cover:

- Verifier pass plus high score yields high reward.
- Verifier fail or safety block yields low reward.
- Council disagreement reduces confidence but does not erase verifier evidence.
- Lower latency/cost can provide small bonus only after quality gates.
- Empty or malformed outcomes produce no update.

Example:

```js
const reward = modelRouterRewardFromAttempt({
  attempt: {
    attemptId: 'a1',
    score: 0.82,
    verifierPassed: true,
    model: { route: { modelProfile: 'fast', endpointProfile: 'local' } },
    metrics: { latencyMs: 1200 },
  },
  councilReport: { disagreement: { status: 'none' } },
  weights: DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS,
});
assert.equal(reward.armId, 'fast');
assert.ok(reward.reward > 0.7);
assert.equal(reward.evidence.verifierPassed, true);
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-router-rewards.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement reward conversion**

Export:

```js
export const DEFAULT_MODEL_ROUTER_REWARD_WEIGHTS = Object.freeze({ ... });
export function modelRouterRewardFromAttempt({ attempt, review, councilReport, weights } = {}) {}
export function modelRouterRewardsFromSwarmResult({ result, weights } = {}) {}
```

Reward fields:

```js
{
  key,
  armId,
  reward,
  evidence,
  reasons,
}
```

Rules:

- Clamp reward to `[0, 1]`.
- Treat `contract_failed`, safety block, missing verifier, and failed review as strong negative evidence.
- Prefer objective verifier/pass/fail over council agreement.
- Use council agreement/disagreement as secondary confidence evidence only.
- Never include raw output text in reward evidence.

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-model-router-rewards.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/model/modelRouterRewards.js tests/harness-model-router-rewards.test.js
git commit -m "feat: score model routing outcomes"
```

### Task 5: Wire Reward Updates Into Swarm Runtime

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/swarm/modelCouncil.js`
- Test: `tests/harness-swarm-runtime.test.js`
- Test: `tests/harness-model-router-rewards.test.js`

- [ ] **Step 1: Write failing runtime test**

Create a model-council swarm test with `modelRouter.enabled: true` and fake router state. Assert:

- `model_router.arm_selected` event is emitted before each routed model attempt.
- `model_router.reward_recorded` event is emitted after council summary.
- Router state receives at least one reward update keyed by role/task.
- Result includes `modelRouter` summary under evidence-only authority.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests\harness-swarm-runtime.test.js tests\harness-model-router-rewards.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add orchestrator parameters**

Extend `orchestrateSwarm`:

```js
modelRouter,
taskContext,
```

Before each attempt:

```js
const routerDecision = modelRouter?.enabled
  ? modelRouter.policy.selectArm({ key, role, arms, taskContext })
  : null;
const modelRoute = routerDecision
  ? routeFromRouterDecision(routerDecision, modelCouncil)
  : resolveAttemptModelRoute({ council: modelCouncil, attempt: scheduledAttempt, role });
```

After result:

```js
const rewards = modelRouterRewardsFromSwarmResult({ result, weights: modelRouter.rewardWeights });
for (const reward of rewards) {
  modelRouter.state.recordReward(reward);
}
```

- [ ] **Step 4: Preserve council authority boundary**

Add a `modelRouter` summary to council/report output:

```js
{
  authority: 'evidence_only',
  canPromote: false,
  decisions: [...],
  rewards: [...],
}
```

- [ ] **Step 5: Verify**

Run:

```bash
node --test tests\harness-swarm-runtime.test.js tests\harness-model-council.test.js tests\harness-model-router-rewards.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/swarm/swarmOrchestrator.js src/harness-sidecar/swarm/modelCouncil.js tests/harness-swarm-runtime.test.js tests/harness-model-router-rewards.test.js
git commit -m "feat: update model router from swarm outcomes"
```

---

## Chunk 3: True AB-MCTS Over Model Choice

### Task 6: Add Model-Choice MCTS Node Expansion

**Files:**
- Create: `src/harness-sidecar/bes/modelChoiceMcts.js`
- Test: `tests/harness-bes-model-choice-mcts.test.js`

- [ ] **Step 1: Write failing MCTS tests**

Assert:

- A root task expands into breadth/depth/refine action children.
- Each action child expands model-choice children when router arms are available.
- Backpropagation updates both the action node and model-choice node.
- Node metadata includes `modelProfile`, `endpointProfile`, and router posterior summary.

Example shape:

```js
const plan = planModelChoiceMcts({
  task: { taskId: 't1', type: 'code' },
  actionArms: ['go_wider', 'go_deeper'],
  modelArms: [
    { armId: 'fast', modelProfile: 'fast' },
    { armId: 'critic', modelProfile: 'critic' },
  ],
  iterations: 8,
  rng: seededRng('mcts-test'),
});
assert.equal(plan.selectedNode.kind, 'model_choice');
assert.ok(plan.selectedNode.modelProfile);
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-bes-model-choice-mcts.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement model-choice planner**

Export:

```js
export function planModelChoiceMcts({
  task,
  actionArms,
  modelArms,
  routerPolicy,
  priorEvidence,
  iterations,
  maxDepth,
  rng,
} = {}) {}
```

Use existing `selectChild` and `backpropagate` from `src/harness-sidecar/bes/mctsPolicy.js` where practical.

Node kinds:

- `root`
- `search_action`
- `model_choice`
- `refinement`

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-bes-model-choice-mcts.test.js tests\harness-bes-tooltree.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/bes/modelChoiceMcts.js tests/harness-bes-model-choice-mcts.test.js
git commit -m "feat: expand AB-MCTS over model choice"
```

### Task 7: Connect Model-Choice MCTS To Adaptive Search Scheduler

**Files:**
- Modify: `src/harness-sidecar/bes/adaptiveSearchScheduler.js`
- Modify: `src/harness-sidecar/swarm/attemptScheduler.js`
- Modify: `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
- Test: `tests/harness-bes-adaptive-search-scheduler.test.js`
- Test: `tests/harness-swarm-ab-mcts-planner.test.js`

- [ ] **Step 1: Write failing scheduler tests**

Assert:

- `adaptiveSearch.allowModelChoice === true` produces actions with `modelChoice`.
- Scheduled attempts preserve `modelChoice.actionId`, `modelChoice.armId`, and `modelChoice.modelProfile`.
- Disabled model choice preserves current scheduling behavior.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests\harness-bes-adaptive-search-scheduler.test.js tests\harness-swarm-ab-mcts-planner.test.js
```

Expected: FAIL.

- [ ] **Step 3: Extend scheduler output**

Add optional config:

```js
adaptiveSearch: {
  allowModelChoice: true,
  modelChoiceMode: 'thompson_mcts',
}
```

Action output:

```js
{
  actionId,
  arm: 'go_wider',
  modelChoice: {
    actionId: 'model_choice_1',
    armId: 'critic',
    role: 'reviewer',
    modelProfile: 'critic_low_temp',
    endpointProfile: 'critic',
    authority: 'evidence_only',
  }
}
```

- [ ] **Step 4: Preserve attempt plan metadata**

Carry `adaptiveSearch.modelChoice` through attempt scheduling and evolution planning without overwriting existing profile/specialization hints.

- [ ] **Step 5: Verify**

Run:

```bash
node --test tests\harness-bes-adaptive-search-scheduler.test.js tests\harness-swarm-ab-mcts-planner.test.js tests\harness-swarm-runtime.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/bes/adaptiveSearchScheduler.js src/harness-sidecar/swarm/attemptScheduler.js src/harness-sidecar/swarm/evolutionSwarmPlanner.js tests/harness-bes-adaptive-search-scheduler.test.js tests/harness-swarm-ab-mcts-planner.test.js
git commit -m "feat: schedule AB-MCTS model-choice attempts"
```

### Task 8: Carry Router Evidence Through BES Lane Envelopes

**Files:**
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Modify: `src/harness-sidecar/bes/laneEvidence.js`
- Test: `tests/harness-bes-lane-runtime.test.js`

- [ ] **Step 1: Write failing lane test**

Assert a candidate with `modelRouter` evidence yields:

```js
assert.equal(result.evidence.sources.includes('model_router'), true);
assert.equal(result.modelRouter.authority, 'evidence_only');
assert.equal(result.modelRouter.canPromote, false);
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-bes-lane-runtime.test.js`

Expected: FAIL.

- [ ] **Step 3: Add model-router evidence source**

Preserve:

- router decision IDs
- reward update IDs
- posterior snapshot summary
- pass@k eval references

Strip:

- prompts
- raw outputs
- credentials
- full endpoint headers

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-bes-lane-runtime.test.js tests\harness-graph-bes.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/bes/laneRuntime.js src/harness-sidecar/bes/laneEvidence.js tests/harness-bes-lane-runtime.test.js
git commit -m "feat: carry model router evidence through BES lanes"
```

---

## Chunk 4: Meta-Harness Optimizes Role/Task Model Routing

### Task 9: Add Routing Policy Candidate Evolution

**Files:**
- Create: `src/harness-sidecar/meta/modelRoutingPolicyEvolution.js`
- Modify: `src/harness-sidecar/meta/harnessOptimizer.js`
- Test: `tests/harness-meta-model-routing-policy.test.js`

- [ ] **Step 1: Write failing meta tests**

Assert:

- Hard cases with `model_router_wrong_model` propose more exploration for that role/task.
- Latency-heavy failures propose cheaper model candidates only when quality stays above threshold.
- Safety failures reduce or quarantine the implicated arm.
- Candidate output is evidence-only and cannot promote itself.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-meta-model-routing-policy.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement policy proposer/evaluator**

Export:

```js
export function proposeModelRoutingPolicies({ coreset, baselinePolicy, routerState, maxCandidates } = {}) {}
export function evaluateModelRoutingPolicyCandidate({ candidate, replayCase, baselinePolicy } = {}) {}
export function runModelRoutingPolicyLane({ coreset, baselinePolicy, routerState, evaluate } = {}) {}
```

Candidate shape:

```js
{
  candidateId,
  target: 'model_routing_policy',
  policyPatch: {
    explorationFloor,
    roleArmWeights,
    quarantinedArms,
    taskTypeOverrides,
  },
  sourceCaseIds,
  evidence: { authority: 'evidence_only', canPromote: false },
}
```

- [ ] **Step 4: Wire target into harness optimizer**

Allow:

```js
optimizer.propose({ target: 'model_routing_policy', coreset, routerState, baselinePolicy })
```

- [ ] **Step 5: Verify**

Run: `node --test tests\harness-meta-model-routing-policy.test.js tests\harness-meta.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/meta/modelRoutingPolicyEvolution.js src/harness-sidecar/meta/harnessOptimizer.js tests/harness-meta-model-routing-policy.test.js
git commit -m "feat: evolve model routing policies in meta-harness"
```

### Task 10: Persist Routing Policy Eval Artifacts

**Files:**
- Modify: `src/harness-sidecar/meta/harnessExperimentRunner.js`
- Modify: `src/harness-sidecar/meta/harnessRunStore.js`
- Test: `tests/harness-meta-experiment-runs.test.js`

- [ ] **Step 1: Write failing artifact test**

Assert a run with `modelRoutingPolicy` writes:

- `model-routing-policy.json`
- `model-router-replay-evidence.json`
- `model-router-frontier-summary.json`

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-meta-experiment-runs.test.js`

Expected: FAIL.

- [ ] **Step 3: Add artifacts**

Persist bounded policy/eval summaries only:

```js
{
  candidateId,
  baselinePolicyId,
  rewardDelta,
  passKDelta,
  safetyDelta,
  latencyDelta,
  evidenceRefs,
  authority: 'evidence_only',
  canPromote: false,
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-meta-experiment-runs.test.js tests\harness-meta-promotion-loop.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/meta/harnessExperimentRunner.js src/harness-sidecar/meta/harnessRunStore.js tests/harness-meta-experiment-runs.test.js
git commit -m "feat: persist model router meta-harness artifacts"
```

---

## Chunk 5: RHO Selects Router-Improvement Hard Cases

### Task 11: Tag Router-Specific Failure Modes

**Files:**
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Create: `src/harness-sidecar/rho/modelRouterHardCases.js`
- Test: `tests/harness-rho-model-router-hard-cases.test.js`

- [ ] **Step 1: Write failing hard-case tests**

Cases should be selected for:

- Static council beats adaptive router.
- Best single model beats selected routed model.
- Reviewer caught a failure from implementer model.
- High disagreement with wrong champion.
- High latency/cost for equal quality.
- Safety block caused by a specific model arm.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-rho-model-router-hard-cases.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement selector**

Export:

```js
export function classifyModelRouterFailure(trace = {}) {}
export function selectModelRouterHardCases({ traces, maxCases, diversityKey } = {}) {}
export function buildModelRouterCoreset({ traces, embeddings, maxCases } = {}) {}
```

Failure reasons:

- `model_router_wrong_model`
- `model_router_under_explored_arm`
- `model_router_council_disagreement_missed`
- `model_router_best_single_regression`
- `model_router_latency_regression`
- `model_router_safety_regression`

- [ ] **Step 4: Connect coreset metadata**

Add router failure tags to existing coreset item metadata without changing non-router behavior.

- [ ] **Step 5: Verify**

Run:

```bash
node --test tests\harness-rho-model-router-hard-cases.test.js tests\harness-rho-coreset.test.js tests\harness-rho-replay-batch.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/rho/coresetBuilder.js src/harness-sidecar/rho/modelRouterHardCases.js tests/harness-rho-model-router-hard-cases.test.js
git commit -m "feat: select RHO hard cases for model routing"
```

### Task 12: Feed Router Hard Cases Back Into BES/Meta

**Files:**
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/bes/adaptiveSearchAdapters.js`
- Test: `tests/harness-meta-bes-optimizer.test.js`
- Test: `tests/harness-ab-mcts-adapters.test.js`

- [ ] **Step 1: Write failing feedback tests**

Assert:

- Router hard cases appear in BES subgoals.
- Adaptive search replay can derive a model-choice arm from router hard-case evidence.
- Meta optimizer proposes model-routing policy candidates when router failure modes dominate.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests\harness-meta-bes-optimizer.test.js tests\harness-ab-mcts-adapters.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add feedback hooks**

In BES subgoal building, add:

```js
{
  id: 'improve_model_router',
  description: 'Improve model selection for router hard cases',
  failureModes: routerFailureModes,
  target: 'model_routing_policy',
}
```

In adaptive-search adapters, map router failures to model-choice exploration arms.

- [ ] **Step 4: Verify**

Run:

```bash
node --test tests\harness-meta-bes-optimizer.test.js tests\harness-ab-mcts-adapters.test.js tests\harness-rho-model-router-hard-cases.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/meta/besMetaOptimizer.js src/harness-sidecar/bes/adaptiveSearchAdapters.js tests/harness-meta-bes-optimizer.test.js tests/harness-ab-mcts-adapters.test.js
git commit -m "feat: feed router hard cases into BES meta optimization"
```

---

## Chunk 6: Agent Mesh And A2A Model Negotiation

### Task 13: Add Model Capabilities To A2A Endpoint Registry

**Files:**
- Modify: `src/harness-sidecar/interop/a2aEndpointRegistry.js`
- Test: `tests/harness-a2a-model-negotiation.test.js`

- [ ] **Step 1: Write failing registry tests**

Register two peers:

```js
{
  id: 'peer-reviewer',
  capabilities: ['review.code'],
  modelCapabilities: {
    profiles: ['critic_low_temp'],
    supportsVision: false,
    maxContextTokens: 65536,
    costTier: 'low',
    preferredRoles: ['reviewer', 'risk-auditor'],
  },
}
```

Assert:

- Discovery can filter by role and model capability.
- Secrets are redacted.
- Negotiation envelope includes model preferences.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-a2a-model-negotiation.test.js`

Expected: FAIL.

- [ ] **Step 3: Extend endpoint normalization**

Add sanitized `modelCapabilities`:

```js
{
  profiles,
  supportsVision,
  maxContextTokens,
  costTier,
  latencyTier,
  preferredRoles,
  unavailableProfiles,
}
```

- [ ] **Step 4: Add negotiation fields**

Negotiation request:

```js
modelPreference: {
  role,
  taskType,
  preferredProfiles,
  excludedProfiles,
  requiredCapabilities,
  authority: 'evidence_only',
}
```

Negotiation response:

```js
modelNegotiation: {
  acceptedProfile,
  fallbackProfiles,
  reasons,
  authority: 'evidence_only',
  canPromote: false,
}
```

- [ ] **Step 5: Verify**

Run: `node --test tests\harness-a2a-model-negotiation.test.js tests\harness-a2a-durability.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/interop/a2aEndpointRegistry.js tests/harness-a2a-model-negotiation.test.js
git commit -m "feat: negotiate model capabilities over A2A"
```

### Task 14: Preserve Negotiated Model Routes In A2A Swarm Envelopes

**Files:**
- Modify: `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- Modify: `src/harness-sidecar/interop/externalAgentGateway.js`
- Test: `tests/harness-a2a-model-negotiation.test.js`

- [ ] **Step 1: Write failing envelope tests**

Assert:

- Delegated swarm envelope includes negotiated `modelRoute`.
- External model route is marked `external: true`, `verified: false`.
- Delegated route can inform router rewards but cannot gain local apply authority.

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\harness-a2a-model-negotiation.test.js`

Expected: FAIL.

- [ ] **Step 3: Extend envelopes**

Add bounded:

```js
a2a: {
  modelRoute: {
    source: 'a2a_negotiation',
    peerId,
    role,
    modelProfile,
    endpointProfile,
    external: true,
    verified: false,
    authority: 'evidence_only',
    canPromote: false,
  }
}
```

- [ ] **Step 4: Verify**

Run:

```bash
node --test tests\harness-a2a-model-negotiation.test.js tests\harness-a2a-durability.test.js tests\harness-sidecar.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/interop/a2aSwarmEnvelope.js src/harness-sidecar/interop/externalAgentGateway.js tests/harness-a2a-model-negotiation.test.js
git commit -m "feat: preserve negotiated A2A model routes"
```

---

## Chunk 7: Controlled Pass@k Evaluation Proof

### Task 15: Add Pass@k Eval Runner

**Files:**
- Create: `src/harness-sidecar/evals/modelCouncilPassK.js`
- Test: `tests/harness-model-council-passk.test.js`

- [ ] **Step 1: Write failing eval tests**

Use deterministic fake model executors:

- `single_best` solves 6/10.
- `single_repeated` solves 6/10 with no diversity gain.
- `static_council` solves 7/10.
- `adaptive_council` solves 8/10 after reward updates.

Assert report includes:

```js
assert.equal(report.baselines.bestSingle.passAtK, 0.6);
assert.equal(report.variants.staticCouncil.passAtK, 0.7);
assert.equal(report.variants.adaptiveCouncil.passAtK, 0.8);
assert.equal(report.uplift.adaptiveVsBestSingle.delta, 0.2);
assert.equal(report.proven, true);
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-council-passk.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement runner**

Export:

```js
export function estimatePassAtK({ solvedCount, totalCount, k } = {}) {}
export async function runModelCouncilPassKEval({
  cases,
  variants,
  k,
  modelRouter,
  orchestrate,
  verifier,
  rng,
} = {}) {}
export function summarizePassKUplift(report = {}) {}
```

Report shape:

```js
{
  evalId,
  caseCount,
  k,
  baselines: {
    bestSingle,
    repeatedSampling,
  },
  variants: {
    staticCouncil,
    adaptiveCouncil,
  },
  uplift: {
    staticVsBestSingle,
    adaptiveVsBestSingle,
    adaptiveVsStatic,
  },
  confidence: {
    minCasesMet,
    upliftThresholdMet,
  },
  proven,
  authority: 'evidence_only',
  canPromote: false,
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests\harness-model-council-passk.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/evals/modelCouncilPassK.js tests/harness-model-council-passk.test.js
git commit -m "feat: evaluate multi-model council pass@k uplift"
```

### Task 16: Add Sidecar API And Trace Events For Pass@k

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/app.js`
- Test: `tests/harness-sidecar.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing API/UI tests**

Assert:

- WebSocket command or HTTP endpoint can prepare a dry-run pass@k eval.
- Event `model_council.passk_eval_completed` is emitted.
- UI can display best-single, repeated, static-council, adaptive-council, and uplift deltas.

- [ ] **Step 2: Run failing tests**

Run:

```bash
node --test tests\harness-sidecar.test.js tests\harness-ui-discoverability.test.js
```

Expected: FAIL.

- [ ] **Step 3: Add sidecar endpoint**

Prefer existing harness command style:

```js
case 'harness_model_council_passk_eval_prepare':
```

Response:

```js
{
  type: 'harness_model_council_passk_eval',
  data: report,
}
```

Trace event:

```js
{
  type: 'model_council.passk_eval_completed',
  evalId,
  taskId,
  bestSinglePassAtK,
  staticCouncilPassAtK,
  adaptiveCouncilPassAtK,
  uplift,
  proven,
  authority: 'evidence_only',
}
```

- [ ] **Step 4: Add UI status fields**

Show the eval in the existing harness/adaptive-search/status area. Avoid a large new dashboard.

- [ ] **Step 5: Verify**

Run:

```bash
node --test tests\harness-sidecar.test.js tests\harness-ui-discoverability.test.js tests\harness-model-council-passk.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/server.js public/app.js tests/harness-sidecar.test.js tests/harness-ui-discoverability.test.js
git commit -m "feat: expose model council pass@k evals"
```

---

## Chunk 8: Documentation, Guardrails, And Verification

### Task 17: Update Architecture Gap Map

**Files:**
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Modify: `docs/architecture/feature-architecture-map.md`

- [ ] **Step 1: Update implemented substrate after code lands**

Move these into implemented substrate only after tests pass:

- learned model-router posterior state
- Thompson-sampling model selection per role/task/node
- BES/AB-MCTS model-choice node expansion
- RHO router hard-case selection
- meta-harness model-routing policy candidates
- A2A model-capability negotiation
- pass@k eval harness

- [ ] **Step 2: Keep remaining gaps honest**

Leave these as remaining until demonstrated at scale:

- production-sized pass@k uplift on real held-out tasks
- benchmark-calibrated ensemble weights from large suites
- persistent production dashboards
- long-lived external A2A network services
- automatic model procurement/scaling under operator policy

- [ ] **Step 3: Verify docs**

Run:

```bash
rg -n "adaptive model router|Thompson|pass@k|model-choice|evidence-only|cannot self-promote" docs\architecture
```

Expected: matches in updated docs.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/evolutionary-agentic-organism-gap-map.md docs/architecture/feature-architecture-map.md
git commit -m "docs: map adaptive model router uplift layer"
```

### Task 18: Full Verification And Live Smoke

**Files:**
- No expected source edits unless verification catches defects.

- [ ] **Step 1: Run focused router/council/BES/RHO/meta/A2A suite**

```bash
node --test tests\harness-model-router-policy.test.js tests\harness-model-router-rewards.test.js tests\harness-bes-model-choice-mcts.test.js tests\harness-rho-model-router-hard-cases.test.js tests\harness-meta-model-routing-policy.test.js tests\harness-a2a-model-negotiation.test.js tests\harness-model-council-passk.test.js
```

Expected: all pass.

- [ ] **Step 2: Run integration suite**

```bash
node --test tests\harness-model-council.test.js tests\harness-swarm-runtime.test.js tests\harness-bes-adaptive-search-scheduler.test.js tests\harness-swarm-ab-mcts-planner.test.js tests\harness-sidecar.test.js tests\harness-ui-discoverability.test.js
```

Expected: all pass.

- [ ] **Step 3: Run full suite**

```bash
npm test
```

Expected: 0 failed.

- [ ] **Step 4: Run release smoke**

```bash
npm run release:smoke
```

Expected: pass.

- [ ] **Step 5: Start local app and restart harness**

If no server is running:

```powershell
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','cd C:\Users\jackj\Github\helios-forge; npm start *> .harness-server-smoke.log'
```

Then restart the sidecar:

```powershell
@'
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:3777');
ws.on('open', () => ws.send(JSON.stringify({ type: 'harness_restart' })));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'harness_status') {
    console.log(JSON.stringify(msg.data, null, 2));
    ws.close();
  }
});
'@ | node -
```

Expected: `state: "running"`.

- [ ] **Step 6: Run live trace smoke**

Run one small task with:

```yaml
features:
  modelDrivenSwarm: true
  multiModelSwarm: true
  adaptiveModelRouter: true
  adaptiveSearch: true
modelCouncil:
  enabled: true
modelRouter:
  enabled: true
adaptiveSearch:
  allowModelChoice: true
```

Expected trace events:

- `model_council.enabled`
- `model_router.arm_selected`
- `ab_mcts.action_selected`
- `model_router.reward_recorded`
- `model_council.report_created`
- `model_council.passk_eval_completed` when eval command is run

- [ ] **Step 7: Final secret scan**

```powershell
rg -n "raw-secret-value|must-not-cross|never-return-this|apiKey|Authorization" src tests docs public --glob '!node_modules'
```

Expected: only fake sentinels and expected redaction tests.

- [ ] **Step 8: Final commit**

```bash
git status --short
git add <changed-files>
git commit -m "feat: learn and evaluate adaptive multi-model routing"
```

---

## Subagent Ownership Plan

Use parallel workers with disjoint write scopes:

1. **Router worker:** `src/harness-sidecar/model/modelRouterState.js`, `modelRouterPolicy.js`, `modelRouterRewards.js`, router unit tests.
2. **BES worker:** `src/harness-sidecar/bes/modelChoiceMcts.js`, `adaptiveSearchScheduler.js`, `laneRuntime.js`, BES tests.
3. **RHO/meta worker:** `src/harness-sidecar/rho/modelRouterHardCases.js`, `meta/modelRoutingPolicyEvolution.js`, RHO/meta tests.
4. **A2A worker:** `src/harness-sidecar/interop/*`, A2A negotiation tests.
5. **Eval/UI worker:** `src/harness-sidecar/evals/modelCouncilPassK.js`, `server.js`, `public/app.js`, sidecar/UI/eval tests.

Integration owner reviews all event names, authority fields, and test expectations before merging worker patches.

## Non-Goals

- Do not let model-router rewards approve or promote changes.
- Do not replace verifier/reviewer/trust-kernel decisions with model consensus.
- Do not claim combined-intelligence scaling until pass@k evals demonstrate it.
- Do not require multiple physical endpoints; multiple profiles on one endpoint must still work.
- Do not persist raw prompts, raw completions, credentials, headers, or secret-bearing endpoint config in router state.
- Do not implement automatic model procurement in this pass; only record the policy hooks.

## Acceptance Criteria

- Defaults preserve existing behavior when `features.adaptiveModelRouter` is false.
- Router state learns per role/task/node model-arm rewards from real swarm outcomes.
- Thompson sampling can select different model arms as evidence changes.
- BES/AB-MCTS can expand model-choice nodes in addition to breadth/depth/refinement nodes.
- RHO can select hard cases specifically targeting model-router mistakes.
- Meta-harness can propose and evaluate model-routing policy variants.
- A2A negotiation can exchange model capabilities/preferences without granting external authority.
- Pass@k eval compares best single model, repeated sampling, static council, and adaptive council.
- Reports explicitly state whether uplift is proven, not assumed.
- Council/router/BES/meta/RHO/A2A outputs remain `authority: 'evidence_only'` and `canPromote: false`.
- Focused tests, full `npm test`, and `npm run release:smoke` pass.
