# Multi-Model Swarm Council Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class multi-model swarm council so Helios can run role-specialized agents against different model profiles/endpoints, compare disagreement, and feed fused evidence into the existing champion/meta-harness flow.

**Architecture:** Keep the existing swarm orchestrator as the execution spine. Add a small model-routing layer that maps swarm roles/profiles to model profiles, a council aggregator that summarizes agreement/disagreement without granting authority, and runtime/server wiring that emits trace evidence and remains gated by verifier and approval policy.

**Tech Stack:** Node.js ESM, `node:test`, existing Helios sidecar modules, OpenAI-compatible providers, vLLM health controller, Pi-native bridge context, JSON/YAML harness config.

---

## Current State

Helios already has the substrate for multi-model combined intelligence:

- `src/harness-sidecar/model/modelProfiles.js` defines named model profiles.
- `src/harness-sidecar/model/modelGateway.js` calls a profile through an injected provider and emits model-call telemetry.
- `src/harness-sidecar/swarm/agentProfiles.js` gives each role an optional `modelProfile`.
- `src/harness-sidecar/swarm/swarmOrchestrator.js` schedules concurrent attempts, attaches profiles, reviews attempts, recombines approved outputs, and chooses a champion.
- `src/harness-sidecar/server.js` creates one runtime swarm gateway from `.harness/config.yaml` and now passes vLLM health-selected concurrency to both model-driven and Pi-native swarms.

The missing layer is not raw concurrency. The missing layer is explicit heterogeneous model routing plus council aggregation:

- Different roles should be able to use different model profiles and endpoints.
- Attempts should record which model profile/backend they used.
- A council should detect agreement, contradiction, uncertainty, and specialist coverage.
- Champion selection and meta-harness traces should receive the council result as evidence, not as self-approval authority.

## Proposed Config Shape

Use this as the target operator-facing configuration. Keep defaults disabled so existing workspaces behave the same.

```yaml
features:
  multiModelSwarm: true
  modelDrivenSwarm: true

modelCouncil:
  enabled: true
  mode: advisory
  diversityRequired: 2
  disagreementThreshold: 0.35
  roles:
    implementer:
      modelProfile: alphahelion_ebft5
      endpointProfile: local_fast
    reviewer:
      modelProfile: critic_low_temp
      endpointProfile: local_critic
    risk-auditor:
      modelProfile: critic_low_temp
      endpointProfile: local_critic
    visual-specialist:
      modelProfile: qwen36_vlm_fast
      endpointProfile: local_vlm
    researcher:
      modelProfile: qwen36_vlm_deep
      endpointProfile: local_deep
  endpointProfiles:
    local_fast:
      baseUrl: http://95.133.252.102:8000/v1
      modelId: selimaktas/ebft-5
      supportsVision: true
      healthEnabled: true
    local_critic:
      baseUrl: http://95.133.252.102:8000/v1
      modelId: selimaktas/ebft-5
      supportsVision: true
      healthEnabled: true
    local_vlm:
      baseUrl: http://95.133.252.102:8000/v1
      modelId: selimaktas/ebft-5
      supportsVision: true
      healthEnabled: true
```

## File Map

- Create `src/harness-sidecar/model/modelEndpointProfiles.js`: normalize endpoint-profile config, derive profile overrides, and protect against missing/unsafe config.
- Create `src/harness-sidecar/swarm/modelCouncil.js`: build council routing, summarize attempt diversity, score agreement/disagreement, and produce evidence-only council reports.
- Modify `src/harness-sidecar/config/configLoader.js`: add disabled defaults for `features.multiModelSwarm` and `modelCouncil`.
- Modify `src/harness-sidecar/swarm/agentProfiles.js`: allow config overrides for `modelProfile` per role without weakening tool/mutation caps.
- Modify `src/harness-sidecar/swarm/swarmOrchestrator.js`: resolve each attempt's effective council route and pass the attempt-specific `modelProfileName` into model-driven workers.
- Modify `src/harness-sidecar/swarm/modelDrivenWorker.js`: preserve route metadata in the model worker result.
- Modify `src/harness-sidecar/server.js`: build model council runtime from harness config, create profile overrides for endpoint profiles, emit council events, and pass council config into `orchestrateSwarm`.
- Modify `docs/architecture/feature-architecture-map.md`: document the feature gate and authority boundary.
- Add `tests/harness-model-council.test.js`: unit tests for routing, endpoint normalization, and council aggregation.
- Extend `tests/harness-swarm-agent-profiles.test.js`: role config overrides keep safety caps intact.
- Extend `tests/harness-swarm-runtime.test.js`: orchestrator sends different model profiles for different roles and emits council report.
- Extend `tests/harness-sidecar.test.js`: runtime emits `model_council.enabled` and passes configured profile overrides.

---

## Chunk 1: Config And Endpoint Profile Normalization

### Task 1: Add Disabled Defaults

**Files:**
- Modify: `src/harness-sidecar/config/configLoader.js`
- Test: `tests/harness-config.test.js`

- [ ] **Step 1: Write the failing config test**

Add a test that asserts defaults are disabled and shape is present:

```js
assert.equal(config.features.multiModelSwarm, false);
assert.equal(config.modelCouncil.enabled, false);
assert.equal(config.modelCouncil.mode, 'advisory');
assert.deepEqual(config.modelCouncil.roles, {});
assert.deepEqual(config.modelCouncil.endpointProfiles, {});
```

- [ ] **Step 2: Run the failing test**

Run: `node --test tests\harness-config.test.js`

Expected: FAIL because `multiModelSwarm` or `modelCouncil` is missing.

- [ ] **Step 3: Add config defaults**

Add to `DEFAULT_HARNESS_CONFIG`:

```js
features: {
  swarm: false,
  modelDrivenSwarm: false,
  piNativeSwarm: false,
  multiModelSwarm: false,
  deepResearch: false,
  experiments: false,
  visualArtifacts: false,
  adaptiveSearch: false,
},
modelCouncil: {
  enabled: false,
  mode: 'advisory',
  diversityRequired: 2,
  disagreementThreshold: 0.35,
  roles: {},
  endpointProfiles: {},
},
```

- [ ] **Step 4: Verify the test passes**

Run: `node --test tests\harness-config.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/config/configLoader.js tests/harness-config.test.js
git commit -m "feat: add multi-model council config defaults"
```

### Task 2: Normalize Endpoint Profiles

**Files:**
- Create: `src/harness-sidecar/model/modelEndpointProfiles.js`
- Test: `tests/harness-model-council.test.js`

- [ ] **Step 1: Write failing endpoint-profile tests**

Create tests for:

- Unknown endpoint profile returns `null`.
- `baseUrl`, `modelId`, `supportsVision`, `apiKeyEnv`, and `healthEnabled` are normalized.
- Dangerous/unbounded text values are clamped.
- A role route can fall back to existing `models.swarmBaseUrl` and `models.swarmModelId`.

Example test skeleton:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeEndpointProfiles,
  resolveEndpointProfile,
} from '../src/harness-sidecar/model/modelEndpointProfiles.js';

test('normalizes council endpoint profiles safely', () => {
  const profiles = normalizeEndpointProfiles({
    fast: {
      baseUrl: 'http://model.test/v1',
      modelId: 'fast-model',
      supportsVision: true,
      healthEnabled: true,
    },
  });

  assert.equal(profiles.fast.baseUrl, 'http://model.test/v1');
  assert.equal(profiles.fast.modelId, 'fast-model');
  assert.equal(profiles.fast.supportsVision, true);
  assert.equal(profiles.fast.healthEnabled, true);
});
```

- [ ] **Step 2: Run the failing test**

Run: `node --test tests\harness-model-council.test.js`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the module**

Implement these exports:

```js
export function normalizeEndpointProfiles(endpointProfiles = {}) {}
export function resolveEndpointProfile({ endpointProfiles, endpointProfileId, fallback = {} } = {}) {}
export function endpointProfileToOverride(endpoint = {}) {}
```

Implementation rules:

- Return plain objects only.
- Clamp string fields to bounded lengths.
- Require `baseUrl` and `modelId` for a usable endpoint.
- Never expose API key values in returned trace metadata; preserve only `apiKeyEnv` or `apiKeyConfigured: true`.

- [ ] **Step 4: Verify endpoint tests pass**

Run: `node --test tests\harness-model-council.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/model/modelEndpointProfiles.js tests/harness-model-council.test.js
git commit -m "feat: normalize model council endpoints"
```

---

## Chunk 2: Role-To-Model Routing

### Task 3: Build Model Council Routes

**Files:**
- Create: `src/harness-sidecar/swarm/modelCouncil.js`
- Test: `tests/harness-model-council.test.js`

- [ ] **Step 1: Write failing route tests**

Add tests that prove:

- Council is disabled unless `features.multiModelSwarm === true` and `modelCouncil.enabled === true`.
- Role routes map `implementer`, `reviewer`, `visual-specialist`, and `researcher` to configured model profiles.
- Missing role route falls back to the attempt's existing `profile.modelProfile`.
- Route metadata is evidence-only and has `canPromote: false`.

Expected route shape:

```js
{
  enabled: true,
  authority: 'evidence_only',
  canPromote: false,
  roleRoutes: {
    implementer: {
      role: 'implementer',
      modelProfile: 'alphahelion_ebft5',
      endpointProfile: 'local_fast',
      endpoint: { baseUrl: 'http://model.test/v1', modelId: 'fast-model' },
    },
  },
}
```

- [ ] **Step 2: Run the failing tests**

Run: `node --test tests\harness-model-council.test.js`

Expected: FAIL because route builder is missing.

- [ ] **Step 3: Implement route builder**

Add exports:

```js
export function buildModelCouncilRuntime({ harnessConfig = {}, fallbackModel = {} } = {}) {}
export function resolveAttemptModelRoute({ council, attempt = {}, role } = {}) {}
```

Important behavior:

- Disabled council returns `{ enabled: false, roleRoutes: {}, authority: 'disabled' }`.
- Enabled council returns only sanitized endpoint metadata.
- Role lookup order: `attempt.profile.id`, `attempt.profile.role`, explicit `role`, then `implementer`.
- Fallback route uses `attempt.profile.modelProfile` before the global swarm profile.

- [ ] **Step 4: Verify route tests pass**

Run: `node --test tests\harness-model-council.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/swarm/modelCouncil.js tests/harness-model-council.test.js
git commit -m "feat: route swarm roles through model council"
```

### Task 4: Preserve Agent Safety While Overriding Model Profiles

**Files:**
- Modify: `src/harness-sidecar/swarm/agentProfiles.js`
- Test: `tests/harness-swarm-agent-profiles.test.js`

- [ ] **Step 1: Write the failing safety test**

Add a test that passes custom profiles or role overrides and asserts:

- `implementer.modelProfile` can change.
- `risk-auditor.workspace.mutationAllowed` remains false.
- `risk-auditor.toolCaps.denied` still includes `git.apply`.
- `visual-specialist.vlm.allowed` remains true.

- [ ] **Step 2: Run the failing test**

Run: `node --test tests\harness-swarm-agent-profiles.test.js`

Expected: FAIL because config override helper does not exist.

- [ ] **Step 3: Add helper**

Add:

```js
export function applyAgentProfileModelOverrides({ profiles = loadDefaultAgentProfiles(), roleRoutes = {} } = {}) {}
```

Only allow these fields to change:

- `modelProfile`

Do not allow config to mutate:

- `toolCaps`
- `workspace`
- `worktree`
- `memory`
- `outputContract`

- [ ] **Step 4: Verify tests pass**

Run: `node --test tests\harness-swarm-agent-profiles.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/swarm/agentProfiles.js tests/harness-swarm-agent-profiles.test.js
git commit -m "feat: allow safe model profile overrides for swarm roles"
```

---

## Chunk 3: Orchestrator Wiring

### Task 5: Use Attempt-Specific Model Routes

**Files:**
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/swarm/modelDrivenWorker.js`
- Test: `tests/harness-swarm-runtime.test.js`

- [ ] **Step 1: Write failing orchestrator test**

Add a test where:

- `maxAttempts: 2`
- Attempt 1 routes to `implementer-model`
- Attempt 2 routes to `reviewer-model` or `visual-model`
- The fake `modelExecutor` records received `profileName`

Expected assertion:

```js
assert.deepEqual(modelCalls.map((call) => call.profileName), [
  'implementer_model',
  'reviewer_model',
]);
assert.deepEqual(result.attempts.map((attempt) => attempt.model.route.modelProfile), [
  'implementer_model',
  'reviewer_model',
]);
```

- [ ] **Step 2: Run the failing test**

Run: `node --test tests\harness-swarm-runtime.test.js`

Expected: FAIL because all attempts currently use `modelProfileName || scheduledAttempt.profile?.modelProfile`.

- [ ] **Step 3: Pass council into orchestrator**

Add optional parameters to `orchestrateSwarm`:

```js
modelCouncil,
```

Inside `runAttempt`, resolve:

```js
const modelRoute = resolveAttemptModelRoute({
  council: modelCouncil,
  attempt: scheduledAttempt,
  role: scheduledAttempt.profile?.role || 'implementer',
});
const effectiveModelProfileName = modelRoute?.modelProfile
  || modelProfileName
  || scheduledAttempt.profile?.modelProfile;
```

Pass `effectiveModelProfileName` into `runScheduledAttempt`.

- [ ] **Step 4: Preserve route metadata**

Make `runModelDrivenAttempt` return:

```js
modelRoute: {
  role,
  modelProfile,
  endpointProfile,
  endpoint: { baseUrl, modelId, supportsVision },
  authority: 'evidence_only',
}
```

Attach the route under `attemptRecord.model.route`.

- [ ] **Step 5: Verify focused tests pass**

Run:

```bash
node --test tests\harness-swarm-runtime.test.js tests\harness-swarm-model-worker.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/swarm/swarmOrchestrator.js src/harness-sidecar/swarm/modelDrivenWorker.js tests/harness-swarm-runtime.test.js
git commit -m "feat: route swarm attempts to role-specific models"
```

### Task 6: Council Aggregation

**Files:**
- Modify: `src/harness-sidecar/swarm/modelCouncil.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Test: `tests/harness-model-council.test.js`
- Test: `tests/harness-swarm-runtime.test.js`

- [ ] **Step 1: Write failing aggregation tests**

Test inputs:

```js
const attempts = [
  { attemptId: 'a1', role: 'implementer', model: { route: { modelProfile: 'fast' } }, output: { summary: 'Fix A' }, score: 80, verifierPassed: true },
  { attemptId: 'a2', role: 'reviewer', model: { route: { modelProfile: 'critic' } }, output: { summary: 'Risk in A' }, score: 65, verifierPassed: true },
  { attemptId: 'a3', role: 'risk-auditor', model: { route: { modelProfile: 'critic' } }, output: { summary: 'No secret risk' }, score: 70, verifierPassed: false },
];
```

Expected:

```js
assert.equal(report.authority, 'evidence_only');
assert.equal(report.canPromote, false);
assert.equal(report.modelDiversity.uniqueModelProfiles, 2);
assert.equal(report.coverage.roles.includes('implementer'), true);
assert.equal(report.coverage.roles.includes('reviewer'), true);
assert.equal(report.disagreement.status, 'present');
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\harness-model-council.test.js tests\harness-swarm-runtime.test.js`

Expected: FAIL because aggregation is missing.

- [ ] **Step 3: Implement aggregation**

Add:

```js
export function summarizeModelCouncil({ council, attempts = [], champion = null, reviews = [] } = {}) {}
```

Summary fields:

- `authority: 'evidence_only'`
- `canPromote: false`
- `modelDiversity.uniqueModelProfiles`
- `modelDiversity.uniqueEndpointProfiles`
- `coverage.roles`
- `agreement.supportingAttemptIds`
- `disagreement.status`
- `disagreement.reasons`
- `championSupport`

Keep scoring deterministic in V1. Do not add model-judged debate yet.

- [ ] **Step 4: Return council report from orchestrator**

After reviews and champion selection:

```js
const modelCouncilReport = summarizeModelCouncil({ council: modelCouncil, attempts, champion, reviews });
```

Return it as:

```js
modelCouncil: modelCouncilReport,
```

- [ ] **Step 5: Emit attempt-independent event**

If `emitEvent` exists and council is enabled, emit:

```js
{
  type: 'model_council.report_created',
  taskId,
  authority: 'evidence_only',
  canPromote: false,
  modelDiversity,
  coverage,
  disagreement,
  championSupport,
}
```

- [ ] **Step 6: Verify tests pass**

Run: `node --test tests\harness-model-council.test.js tests\harness-swarm-runtime.test.js`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/harness-sidecar/swarm/modelCouncil.js src/harness-sidecar/swarm/swarmOrchestrator.js tests/harness-model-council.test.js tests/harness-swarm-runtime.test.js
git commit -m "feat: summarize multi-model swarm council evidence"
```

---

## Chunk 4: Runtime Server Integration

### Task 7: Build Runtime Council From Harness Config

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-sidecar.test.js`

- [ ] **Step 1: Write failing sidecar test**

Configure a test workspace:

```yaml
features:
  modelDrivenSwarm: true
  multiModelSwarm: true
modelCouncil:
  enabled: true
  roles:
    implementer:
      modelProfile: alphahelion_ebft5
      endpointProfile: fast
    reviewer:
      modelProfile: critic_low_temp
      endpointProfile: critic
  endpointProfiles:
    fast:
      baseUrl: http://fast.test/v1
      modelId: fast-model
    critic:
      baseUrl: http://critic.test/v1
      modelId: critic-model
```

Assertions:

- `model_council.enabled` event is emitted.
- `model_council.report_created` event is emitted.
- `harness_runtime.enabled` includes `multiModelSwarm: true`.
- Model calls show at least two profile names when test scheduling creates different roles.

- [ ] **Step 2: Run failing sidecar test**

Run: `node --test tests\harness-sidecar.test.js`

Expected: FAIL because server does not build/pass council runtime yet.

- [ ] **Step 3: Add server wiring**

In `runFullRuntimeSubsystems`, after `runtimeSwarmModel` is created:

```js
const modelCouncil = buildModelCouncilRuntime({
  harnessConfig,
  fallbackModel: {
    profileName: runtimeSwarmModel?.profileName,
    baseUrl: runtimeSwarmModel?.baseUrl,
    modelId: runtimeSwarmModel?.modelId,
    supportsVision: runtimeSwarmModel?.supportsVision,
  },
});
```

Emit:

```js
{
  type: 'model_council.enabled',
  taskId: task.taskId,
  enabled: modelCouncil.enabled,
  authority: modelCouncil.authority,
  roleCount: Object.keys(modelCouncil.roleRoutes || {}).length,
  endpointProfileCount: Object.keys(modelCouncil.endpointProfiles || {}).length,
}
```

Pass `modelCouncil` into `orchestrateSwarm`.

- [ ] **Step 4: Support profile overrides for endpoint profiles**

Extend the runtime `ModelGateway` profile overrides to include every council role route:

```js
profileOverrides: {
  [profileName]: configuredModelOverride,
  [vlmProfileName]: configuredModelOverride,
  ...modelCouncil.profileOverrides,
}
```

V1 can use one OpenAI-compatible provider factory if all endpoint profiles share the same base URL. If endpoint profiles use different base URLs, build a routing provider in Task 8.

- [ ] **Step 5: Verify focused sidecar tests pass**

Run: `node --test tests\harness-sidecar.test.js tests\harness-model-council.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/server.js tests/harness-sidecar.test.js
git commit -m "feat: wire model council into sidecar runtime"
```

### Task 8: Add Routing Provider For Multiple Endpoints

**Files:**
- Create: `src/harness-sidecar/model/routingModelProvider.js`
- Test: `tests/harness-model-council.test.js`

- [ ] **Step 1: Write failing provider test**

Set two endpoint profiles with different base URLs. Assert the provider calls the correct URL based on `profile.name` or `profile.modelCouncilEndpointProfile`.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-model-council.test.js`

Expected: FAIL because provider does not exist.

- [ ] **Step 3: Implement routing provider**

Export:

```js
export function createRoutingModelProvider({ routes = {}, defaultProvider, providerFactory } = {}) {}
```

Behavior:

- If route exists for `profile.name`, use route provider.
- Otherwise use `defaultProvider`.
- Never log or return raw API keys.
- Preserve OpenAI-compatible request behavior by using `createOpenAICompatibleProvider`.

- [ ] **Step 4: Wire into server**

When council endpoint profiles contain more than one unique `baseUrl`, use `createRoutingModelProvider`.

- [ ] **Step 5: Verify tests pass**

Run:

```bash
node --test tests\harness-model-council.test.js tests\harness-sidecar.test.js tests\harness-tool-loop.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/model/routingModelProvider.js src/harness-sidecar/server.js tests/harness-model-council.test.js
git commit -m "feat: route model profiles across council endpoints"
```

---

## Chunk 5: Pi-Native Bridge And vLLM Health

### Task 9: Pass Council Hints To Pi-Native Workers

**Files:**
- Modify: `src/harness-sidecar/swarm/piNativeWorker.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-swarm-pi-native-worker.test.js`

- [ ] **Step 1: Write failing Pi-native test**

Extend the bridge-context test to include:

```js
piBridgeContext: {
  modelConcurrency: { concurrency: 5, source: 'vllm_health' },
  modelCouncil: {
    enabled: true,
    authority: 'evidence_only',
    roleRoutes: {
      implementer: { modelProfile: 'alphahelion_ebft5', endpointProfile: 'fast' },
      reviewer: { modelProfile: 'critic_low_temp', endpointProfile: 'critic' },
    },
  },
}
```

Assert the received context preserves bounded `modelCouncil` hints.

- [ ] **Step 2: Run failing test**

Run: `node --test tests\harness-swarm-pi-native-worker.test.js`

Expected: FAIL because model council hints are not compacted into bridge context.

- [ ] **Step 3: Add compact council bridge hints**

In `piNativeWorker.js`, add `compactModelCouncilHints`.

Rules:

- Include `enabled`, `authority`, `roleRoutes`, `diversityRequired`, `mode`.
- Clamp strings.
- Strip API keys and full secrets.
- Keep `canPromote: false`.

- [ ] **Step 4: Add server context**

When building `piBridgeContext`, pass:

```js
{
  modelConcurrency: piModelConcurrency,
  modelCouncil: modelCouncil?.enabled ? modelCouncil.bridgeHints : undefined,
}
```

- [ ] **Step 5: Verify tests pass**

Run: `node --test tests\harness-swarm-pi-native-worker.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/harness-sidecar/swarm/piNativeWorker.js src/harness-sidecar/server.js tests/harness-swarm-pi-native-worker.test.js
git commit -m "feat: pass model council hints to pi-native swarms"
```

### Task 10: Health-Aware Council Capacity

**Files:**
- Modify: `src/harness-sidecar/model/vllmHealthController.js` only if needed
- Modify: `src/harness-sidecar/swarm/modelCouncil.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/vllm-health-controller.test.js`
- Test: `tests/harness-model-council.test.js`

- [ ] **Step 1: Write failing capacity test**

Assert council runtime records:

- `maxConcurrency`
- per-endpoint `healthUrl`
- per-endpoint `healthy`
- per-endpoint `recommendedConcurrency`

- [ ] **Step 2: Implement minimal health summary**

Do not run separate expensive health probes for every role if profiles share a base URL. Group by base URL and reuse one vLLM health controller per base URL.

- [ ] **Step 3: Emit event**

Emit:

```js
{
  type: 'model_council.health_updated',
  taskId,
  endpointCount,
  healthyEndpointCount,
  recommendedConcurrency,
}
```

- [ ] **Step 4: Verify tests pass**

Run:

```bash
node --test tests\vllm-health-controller.test.js tests\harness-model-council.test.js tests\harness-sidecar.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/harness-sidecar/swarm/modelCouncil.js src/harness-sidecar/server.js tests/harness-model-council.test.js tests/harness-sidecar.test.js
git commit -m "feat: summarize health-aware model council capacity"
```

---

## Chunk 6: Operator Visibility And Docs

### Task 11: Trace And Status Visibility

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/app.js` only if existing trace UI needs labels
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing discoverability test**

Assert the UI or trace status can display:

- `model_council.enabled`
- `model_council.report_created`
- `swarm.subagent_started.model.profileName`
- `model.route.endpointProfile`

- [ ] **Step 2: Implement minimal UI/status support**

Prefer trace/event rendering over a new dashboard. Do not create a new card-heavy UI unless necessary.

- [ ] **Step 3: Verify tests pass**

Run: `node --test tests\harness-ui-discoverability.test.js`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/app.js src/harness-sidecar/server.js tests/harness-ui-discoverability.test.js
git commit -m "feat: expose model council trace visibility"
```

### Task 12: Documentation

**Files:**
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Optional Modify: `docs/architecture/paper-implementation-alignment.md`

- [ ] **Step 1: Update feature gate table**

Add a row:

```md
| Multi-model swarm council | `features.multiModelSwarm: true` plus `modelCouncil.enabled: true`; routes swarm roles to configured model profiles/endpoints, emits evidence-only agreement/disagreement reports, and cannot self-promote changes |
```

- [ ] **Step 2: Update organism gap map**

Move this from missing substrate toward implemented substrate:

- role-specialized model routing
- model diversity telemetry
- evidence-only council aggregation

Keep these as remaining gaps:

- learned model-router policy
- model-judged debate
- benchmark-calibrated ensemble weights
- automatic model procurement/scaling

- [ ] **Step 3: Verify docs mention authority boundary**

Run:

```bash
rg -n "Multi-model swarm council|evidence-only|cannot self-promote|model diversity" docs\architecture
```

Expected: matches in updated docs.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/feature-architecture-map.md docs/architecture/evolutionary-agentic-organism-gap-map.md docs/architecture/paper-implementation-alignment.md
git commit -m "docs: document multi-model swarm council"
```

---

## Chunk 7: End-To-End Verification

### Task 13: Full Test And Live Smoke

**Files:**
- No expected source edits unless failures reveal bugs.

- [ ] **Step 1: Run focused suite**

```bash
node --test tests\harness-model-council.test.js tests\harness-swarm-runtime.test.js tests\harness-swarm-agent-profiles.test.js tests\harness-swarm-pi-native-worker.test.js tests\harness-sidecar.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: 0 failed. Existing platform skips are acceptable.

- [ ] **Step 3: Run release smoke**

```bash
npm run release:smoke
```

Expected: checked package entrypoints and lockfile.

- [ ] **Step 4: Restart local deployment**

Use the existing WebSocket command:

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

Expected: sidecar status returns `state: "running"`.

- [ ] **Step 5: Run live task**

Start a tiny full-mode task against the selected workspace. Expected trace events:

- `model_council.enabled`
- `swarm.vllm_health_updated`
- `harness_runtime.enabled`
- `swarm.subagent_started` with per-attempt model route metadata
- `model_council.report_created`

- [ ] **Step 6: Inspect trace**

Use:

```powershell
curl.exe -sS "http://127.0.0.1:<sidecar-port>/v1/traces/<task-id>"
```

Expected:

- `modelCouncil.authority` is `evidence_only`.
- `modelCouncil.canPromote` is `false`.
- At least two model profiles are represented when config requests role diversity.
- Champion selection still depends on verifier/reviewer evidence, not council self-approval.

- [ ] **Step 7: Final commit if live-smoke fixes were needed**

```bash
git status --short
git add <changed-files>
git commit -m "test: verify multi-model swarm council runtime"
```

---

## Non-Goals For V1

- Do not add autonomous self-approval from model council consensus.
- Do not add model-judged debate as the first version.
- Do not require multiple physical endpoints; multiple profiles on one vLLM endpoint must work.
- Do not replace champion selection. Feed council evidence into the existing reviewer/champion path.
- Do not let role config widen tools, mutation rights, memory scope, or approval authority.

## Acceptance Criteria

- Existing default behavior is unchanged when `features.multiModelSwarm` is false.
- A workspace can configure at least two role-specific model profiles.
- The swarm can run concurrent attempts where different roles use different `profileName` values.
- Attempt trace metadata shows the selected model profile and endpoint profile.
- The council report summarizes model diversity, role coverage, agreement, and disagreement.
- The council report is evidence-only and cannot promote/apply changes.
- Pi-native workers receive bounded advisory model-council hints.
- Full `npm test` and `npm run release:smoke` pass.

