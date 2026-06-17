# Visual Verifier and Verifier Evolution Loop Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class visual verifier that uses VLM capabilities, then make visual and non-visual verifier configurations evolvable through the BES/RHO/meta harness.

**Architecture:** Keep verifier execution inside `src/harness-sidecar/tools/` and visual artifact work inside `src/harness-sidecar/vlm/`. Add verifier evolution as a separate meta layer that proposes, evaluates, archives, and approval-gates verifier genome changes before they can update `.harness/verifiers.json`.

**Tech Stack:** Node.js ESM, built-in `node:test`, sidecar event traces, existing VLM artifact workers, verifier registry/selector, BES/RHO/meta optimizer modules, PowerShell on Windows.

---

## Carry-Over From Previous Waves

Include these as hardening tasks while building the new verifier loop:

- `feature/remaining-harness-waves` is pushed but not merged into `develop`/`main`. Merge/PR review should happen before or alongside implementation.
- Delegated capability tokens currently use a process-local default issuer secret. Add stable secret injection for multi-process or restart-persistent delegation.
- MCP poisoning quarantine currently sanitizes `content`; keep future model-visible fields inside the scan/quarantine contract.
- `graph.code_impact_analyzed` currently uses context-pack paths as impact seeds. Rename/event-label this as `seedFiles` or introduce real changed-file inputs before using it as diff evidence.
- Context/budget dashboard exists as sidecar data events, but the browser UI does not yet have a dedicated operator dashboard panel for context pressure, recovery, verifier evolution, and budget alerts.
- Production visual workers support injected runtimes and unavailable defaults. Real browser/PDF/OCR runtime adapters still need explicit configuration and health events.
- External agent gateway and controlled merge manager are standalone modules. They are not yet exposed as sidecar endpoints/tools.

These are not blockers for the visual verifier, but they should be accounted for in the implementation and tests below.

---

## Chunk 1: Visual Verifier Core

Build a first-class visual verifier runner that captures artifacts, calls a VLM judge, and returns verifier-grade pass/fail evidence.

**Files:**

- Create: `src/harness-sidecar/vlm/visualVerifier.js`
- Create: `src/harness-sidecar/vlm/visualVerifierRubric.js`
- Modify: `src/harness-sidecar/vlm/productionArtifactCapture.js`
- Modify: `src/harness-sidecar/tools/defaultToolRegistry.js`
- Test: `tests/harness-visual-verifier.test.js`
- Test: `tests/harness-tools.test.js`

### Task 1: Visual verifier contract

- [ ] **Step 1: Write failing tests for the contract**

Create `tests/harness-visual-verifier.test.js`.

Cover:

- A verifier run accepts `taskId`, `workspaceRoot`, `goal`, optional `targetUrl`, optional `beforePath`/`afterPath`, and optional `expected`.
- It captures visual artifacts through an injected `captureAdapter`.
- It calls an injected `modelGateway` or `vlmJudge`.
- It returns:

```js
{
  name: 'visual.verifier',
  passed: true,
  score: 0.87,
  confidence: 0.82,
  findings: [],
  artifacts: [],
  rubricVersion: 1,
  model: { model: 'local-test-vlm' }
}
```

Run:

```powershell
npm test -- tests/harness-visual-verifier.test.js
```

Expected: fail because `visualVerifier.js` does not exist.

- [ ] **Step 2: Implement `createVisualVerifierRubric`**

In `src/harness-sidecar/vlm/visualVerifierRubric.js`, export:

```js
export function createVisualVerifierRubric({
  goal,
  expected = [],
  artifactTypes = [],
  strictness = 'balanced',
} = {}) {
  return {
    rubricVersion: 1,
    strictness,
    prompt,
    expected,
    passThreshold,
    confidenceThreshold,
  };
}
```

Default thresholds:

- `strict`: pass `0.9`, confidence `0.75`
- `balanced`: pass `0.75`, confidence `0.6`
- `exploratory`: pass `0.6`, confidence `0.45`

- [ ] **Step 3: Implement `runVisualVerifier`**

In `src/harness-sidecar/vlm/visualVerifier.js`, export:

```js
export async function runVisualVerifier({
  taskId,
  workspaceRoot,
  goal,
  expected = [],
  targetUrl,
  beforePath,
  afterPath,
  captureAdapter,
  workerRuntimes,
  modelGateway,
  vlmJudge,
  emitEvent = () => {},
  strictness = 'balanced',
} = {}) {}
```

Rules:

- Use existing `captureProductionVisualArtifacts`.
- Do not embed binary image data in events.
- If no visual artifact is available, return `passed: false`, reason `visual_artifact_unavailable`.
- If `vlmJudge` is provided, use it for deterministic tests.
- If `modelGateway` is provided, send artifact metadata and available image data URLs only through existing safe image IO helpers if available.
- Parse structured VLM output:

```js
{
  score: 0.84,
  confidence: 0.8,
  findings: [{ severity: 'low', message: '...' }],
  passed: true
}
```

- Apply thresholds if `passed` is omitted.
- Emit:
  - `visual_verifier.started`
  - `visual_verifier.artifacts_captured`
  - `visual_verifier.completed`
  - `visual_verifier.failed`

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-visual-verifier.test.js
```

Expected: pass.

### Task 2: Tool registry integration

- [ ] **Step 1: Write failing tool registry test**

Extend `tests/harness-tools.test.js`.

Expected behavior:

- `createDefaultToolRegistry(...).list()` includes `visual.verifier.run`.
- Executing `visual.verifier.run` calls injected visual verifier dependencies and returns verifier result.

Run:

```powershell
npm test -- tests/harness-tools.test.js
```

Expected: fail because the tool is not registered.

- [ ] **Step 2: Register tool**

Modify `src/harness-sidecar/tools/defaultToolRegistry.js`.

Add `visual.verifier.run` with risk `medium` and input schema:

```js
{
  taskId: 'string',
  goal: 'string',
  targetUrl: 'string',
  beforePath: 'string',
  afterPath: 'string',
  expected: 'array',
  strictness: 'string'
}
```

Keep injection support by adding optional factory args to `createDefaultToolRegistry`:

```js
visualVerifier,
visualCaptureAdapter,
visualWorkerRuntimes,
modelGateway
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-tools.test.js tests/harness-visual-verifier.test.js
```

Expected: pass.

- [ ] **Step 4: Commit chunk**

```powershell
git add src/harness-sidecar/vlm/visualVerifier.js src/harness-sidecar/vlm/visualVerifierRubric.js src/harness-sidecar/tools/defaultToolRegistry.js tests/harness-visual-verifier.test.js tests/harness-tools.test.js
git commit -m "Add visual verifier runner"
```

---

## Chunk 2: Visual Verifier Registry and Selector

Make visual verifiers first-class registry records so normal verifier selection can choose them.

**Files:**

- Modify: `src/harness-sidecar/tools/verifierRegistry.js`
- Modify: `src/harness-sidecar/tools/verifierSelector.js`
- Modify: `src/harness-sidecar/tools/verifierRunner.js`
- Test: `tests/harness-verifier-registry.test.js`
- Test: `tests/harness-verifier-selector.test.js`
- Test: `tests/harness-visual-verifier.test.js`

### Task 1: Registry support for tool verifiers

- [ ] **Step 1: Write failing registry tests**

Add a `.harness/verifiers.json` fixture:

```json
{
  "version": 1,
  "verifiers": [
    {
      "name": "visual-ui",
      "kind": "visual",
      "tool": "visual.verifier.run",
      "risk": "medium",
      "appliesTo": ["public/**/*.js", "public/**/*.html", "src/harness-sidecar/vlm/**/*.js"],
      "tags": ["visual", "vlm", "ui"],
      "rubric": { "strictness": "balanced" }
    }
  ]
}
```

Expected:

- Tool verifier records are valid without `command`.
- Unsafe tool names are rejected.
- Command verifiers still work unchanged.

Run:

```powershell
npm test -- tests/harness-verifier-registry.test.js
```

Expected: fail.

- [ ] **Step 2: Implement registry support**

Update normalized verifier shape:

```js
{
  name,
  kind,
  command: null,
  tool: 'visual.verifier.run',
  toolInput: {},
  rubric: {},
  risk,
  timeoutMs,
  appliesTo,
  tags
}
```

Rules:

- A verifier must have exactly one of `command` or `tool`.
- Tool names must match `/^[A-Za-z0-9_.:-]+$/`.
- Preserve current command verifier behavior.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-registry.test.js
```

Expected: pass.

### Task 2: Selector support for visual changes

- [ ] **Step 1: Write failing selector tests**

Cover:

- `public/app.js` selects visual verifier when a visual verifier exists.
- `public/index.html` selects visual verifier.
- `src/harness-sidecar/vlm/visualVerifier.js` selects visual verifier.
- Unknown changes still select unit/smoke, not visual.

Run:

```powershell
npm test -- tests/harness-verifier-selector.test.js
```

Expected: fail.

- [ ] **Step 2: Update selector**

Rules:

- UI/static frontend changes are `visual_surface_change`.
- VLM module changes are `vlm_change`.
- Prefer visual verifiers by `kind: visual` or tags `visual`, `vlm`, `ui`.
- Keep unit/smoke as companion verifiers for code changes.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-selector.test.js tests/harness-verifier-registry.test.js
```

Expected: pass.

### Task 3: Runner support for tool verifiers

- [ ] **Step 1: Write failing runner tests**

Extend `tests/harness-visual-verifier.test.js` or add to `tests/harness-tools.test.js`.

Expected:

- `runVerifiers` can execute command verifiers and tool verifiers.
- Tool verifier results are normalized into `passed`, `score`, `artifacts`, and `durationMs`.
- Tool verifier events do not include binary payloads.

- [ ] **Step 2: Implement tool verifier execution**

Modify `src/harness-sidecar/tools/verifierRunner.js`.

Add optional args:

```js
toolRegistry,
task,
defaultToolInput
```

If verifier has `tool`, execute:

```js
await toolRegistry.execute(verifier.tool, {
  ...defaultToolInput,
  ...verifier.toolInput,
  taskId,
  goal: task?.task || task?.goal,
  strictness: verifier.rubric?.strictness,
})
```

Keep command verifier behavior unchanged.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-tools.test.js tests/harness-visual-verifier.test.js tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js
```

Expected: pass.

- [ ] **Step 4: Commit chunk**

```powershell
git add src/harness-sidecar/tools/verifierRegistry.js src/harness-sidecar/tools/verifierSelector.js src/harness-sidecar/tools/verifierRunner.js tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js tests/harness-visual-verifier.test.js tests/harness-tools.test.js
git commit -m "Register visual verifiers"
```

---

## Chunk 3: Verifier Evolution Core

Represent verifier configurations as evolvable genomes and run candidate verifier configs against held-out cases.

**Files:**

- Create: `src/harness-sidecar/meta/verifierGenome.js`
- Create: `src/harness-sidecar/meta/verifierCandidateRunner.js`
- Create: `src/harness-sidecar/meta/verifierEvolutionArchive.js`
- Test: `tests/harness-verifier-evolution.test.js`

### Task 1: Verifier genome schema

- [ ] **Step 1: Write failing genome tests**

Cover:

- Command verifier genome.
- Tool/visual verifier genome.
- Selector-rule genome.
- Unsafe commands/tools rejected.
- Genome mutation preserves required safety fields.

Run:

```powershell
npm test -- tests/harness-verifier-evolution.test.js
```

Expected: fail.

- [ ] **Step 2: Implement verifier genome module**

Export:

```js
export function createVerifierGenome({ verifier, parentId, mutation = {} } = {}) {}
export function mutateVerifierGenome({ genome, mutationPolicy, rng } = {}) {}
export function verifierFromGenome(genome) {}
export function validateVerifierGenome(genome) {}
```

Genome fields:

```js
{
  genomeId,
  parentId,
  verifier: {
    name,
    kind,
    command,
    tool,
    appliesTo,
    tags,
    rubric,
    thresholds,
    timeoutMs,
    budget
  },
  mutation,
  safety: {
    requiresApproval: true,
    heldOutRequired: true,
    baselineRequired: true
  }
}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-evolution.test.js
```

Expected: pass for genome tests.

### Task 2: Candidate runner

- [ ] **Step 1: Write failing candidate-runner tests**

Held-out case shape:

```js
{
  caseId: 'visual-layout-regression',
  task: { taskId, task },
  changedFiles: ['public/app.js'],
  expected: { shouldPass: false, tags: ['visual'] },
  artifacts: {}
}
```

Expected metrics:

- `truePositive`
- `trueNegative`
- `falsePositive`
- `falseNegative`
- `precision`
- `recall`
- `flakiness`
- `averageCost`
- `averageLatencyMs`
- `safetyPassed`

- [ ] **Step 2: Implement `runVerifierCandidate`**

Export:

```js
export async function runVerifierCandidate({
  genome,
  heldOutCases = [],
  baselineResults = [],
  verifierRunner,
  toolRegistry,
  emitEvent = () => {},
} = {}) {}
```

Rules:

- Never write promoted verifier config.
- Emit `verifier_evolution.candidate_started`.
- Emit `verifier_evolution.case_completed`.
- Emit `verifier_evolution.candidate_completed`.
- Mark candidate unsafe if it fails baseline smoke/unit/security cases.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-evolution.test.js
```

Expected: pass.

### Task 3: Archive

- [ ] **Step 1: Write failing archive tests**

Archive path:

```text
.harness/meta/verifier-candidates/<candidate-id>/
```

Files:

- `genome.json`
- `metrics.json`
- `cases.json`
- `decision.json`

Reject unsafe candidate ids.

- [ ] **Step 2: Implement archive module**

Export:

```js
export async function archiveVerifierCandidate({ workspaceRoot, genome, run, decision } = {}) {}
export async function listVerifierCandidates({ workspaceRoot } = {}) {}
```

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-verifier-evolution.test.js
git add src/harness-sidecar/meta/verifierGenome.js src/harness-sidecar/meta/verifierCandidateRunner.js src/harness-sidecar/meta/verifierEvolutionArchive.js tests/harness-verifier-evolution.test.js
git commit -m "Add verifier evolution core"
```

---

## Chunk 4: BES/RHO/Meta Integration

Wire verifier evolution into the existing meta harness without allowing self-promotion.

**Files:**

- Create: `src/harness-sidecar/meta/verifierEvolutionLoop.js`
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-verifier-evolution-loop.test.js`
- Test: `tests/harness-meta-bes-optimizer.test.js`
- Test: `tests/harness-rho-coreset.test.js`
- Test: `tests/harness-meta-promotion.test.js`

### Task 1: RHO verifier case selection

- [ ] **Step 1: Write failing RHO tests**

Cases selected should include:

- Recent verifier false positives.
- Recent verifier false negatives.
- Ambiguous VLM visual scores.
- High-cost verifier runs.
- Flaky verifier runs.

Run:

```powershell
npm test -- tests/harness-rho-coreset.test.js
```

Expected: fail.

- [ ] **Step 2: Extend coreset builder**

Add optional `verifierCases` input to `buildRhoCoreset`.

Do not disturb existing trace coreset behavior.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-rho-coreset.test.js
```

Expected: pass.

### Task 2: BES mutations for verifier genomes

- [ ] **Step 1: Write failing BES tests**

Expected mutation types:

- `threshold_adjustment`
- `rubric_prompt_refinement`
- `selector_rule_expansion`
- `timeout_budget_adjustment`
- `visual_crop_policy_adjustment`
- `ocr_weight_adjustment`

- [ ] **Step 2: Extend BES meta optimizer**

Allow `target: 'verifier_policy'` and verifier parent candidates.

Generated candidates should include:

```js
{
  target: 'verifier_policy',
  verifierGenome,
  rationale,
  expectedMetric: 'false_negative_reduction'
}
```

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-meta-bes-optimizer.test.js tests/harness-verifier-evolution.test.js
```

Expected: pass.

### Task 3: Meta promotion policy

- [ ] **Step 1: Write failing promotion tests**

Verifier candidates cannot promote unless:

- Human approval exists.
- Held-out metrics improve over baseline.
- No baseline unit/smoke/security regression.
- Flakiness is under threshold.
- Cost increase is under threshold or explicitly approved.

- [ ] **Step 2: Implement promotion gate**

Modify `src/harness-sidecar/meta/promotionPolicy.js`.

Add reasons:

- `missing_verifier_holdout`
- `verifier_regression`
- `verifier_flaky`
- `verifier_cost_regression`
- `missing_human_approval`

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-meta-promotion.test.js
```

Expected: pass.

### Task 4: Evolution loop orchestration

- [ ] **Step 1: Write failing loop tests**

Expected behavior:

- Consumes verifier cases and current registry.
- Builds RHO coreset.
- Generates BES verifier genomes.
- Runs candidate verifier cases.
- Archives candidates.
- Emits promotion proposal, never direct promotion.

- [ ] **Step 2: Implement `runVerifierEvolutionLoop`**

Export:

```js
export async function runVerifierEvolutionLoop({
  workspaceRoot,
  registry,
  verifierCases,
  baselineResults,
  approvals = [],
  optimizer,
  verifierRunner,
  toolRegistry,
  emitEvent = () => {},
} = {}) {}
```

Events:

- `verifier_evolution.started`
- `verifier_evolution.coreset_selected`
- `verifier_evolution.candidates_generated`
- `verifier_evolution.candidate_completed`
- `verifier_evolution.promotion_evaluated`
- `verifier_evolution.proposal_created`

- [ ] **Step 3: Wire sidecar**

In `src/harness-sidecar/server.js`, run verifier evolution only when:

```js
harnessConfig.features.verifierEvolution === true
```

or:

```powershell
HELIOS_VERIFIER_EVOLUTION=1
```

Default must be off.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-verifier-evolution-loop.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-rho-coreset.test.js tests/harness-meta-promotion.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/meta src/harness-sidecar/rho/coresetBuilder.js src/harness-sidecar/server.js tests/harness-verifier-evolution-loop.test.js tests/harness-meta-bes-optimizer.test.js tests/harness-rho-coreset.test.js tests/harness-meta-promotion.test.js tests/harness-sidecar.test.js
git commit -m "Wire verifiers into meta evolution"
```

---

## Chunk 5: Safe Apply and Operator Visibility

Add approval-gated verifier promotion into `.harness/verifiers.json` and expose enough trace/UI data for humans to supervise it.

**Files:**

- Create: `src/harness-sidecar/tools/verifierConfigApply.js`
- Modify: `src/harness-sidecar/core/approvalResume.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `tests/harness-verifier-config-apply.test.js`
- Test: `tests/harness-sidecar.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

### Task 1: Approval-gated verifier config apply

- [ ] **Step 1: Write failing apply tests**

Cover:

- Applies approved verifier candidate into `.harness/verifiers.json`.
- Preserves existing verifier records.
- Rejects unsafe tool/command/cwd.
- Writes backup file.
- Refuses apply without approval action.

- [ ] **Step 2: Implement safe apply**

Export:

```js
export async function applyVerifierConfigCandidate({
  workspaceRoot,
  candidate,
  approval,
  currentRegistry,
} = {}) {}
```

Rules:

- Write only under workspace `.harness`.
- Use registry validation before writing.
- Store backup:

```text
.harness/verifiers.backup.<timestamp>.json
```

- Emit/apply result suitable for approval resume store.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-config-apply.test.js
```

Expected: pass.

### Task 2: Sidecar approval action

- [ ] **Step 1: Write failing sidecar tests**

Expected:

- Verifier evolution proposal creates `approval.required`.
- Approving resumes `applyVerifierConfigCandidate`.
- Rejecting does not mutate verifier config.

- [ ] **Step 2: Wire approval resume**

Use existing approval resume patterns from champion/meta safe apply.

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-sidecar.test.js tests/harness-verifier-config-apply.test.js
```

Expected: pass.

### Task 3: UI visibility

- [ ] **Step 1: Write failing UI discoverability tests**

Expected UI surface:

- Verifier evolution status.
- Latest candidate score.
- Baseline vs candidate comparison.
- Pending verifier promotion approval count.
- Visual verifier artifact links.

- [ ] **Step 2: Implement compact panel**

Use existing harness panel conventions in `public/index.html` and `public/app.js`.

Do not create a marketing/landing page. Keep it dense and operational.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js tests/harness-verifier-config-apply.test.js
git add src/harness-sidecar/tools/verifierConfigApply.js src/harness-sidecar/core/approvalResume.js src/harness-sidecar/server.js public/index.html public/app.js tests/harness-verifier-config-apply.test.js tests/harness-sidecar.test.js tests/harness-ui-discoverability.test.js
git commit -m "Add approval-gated verifier evolution apply"
```

---

## Final Verification

- [ ] Run all focused suites:

```powershell
npm test -- tests/harness-visual-verifier.test.js tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js tests/harness-verifier-evolution.test.js tests/harness-verifier-evolution-loop.test.js tests/harness-verifier-config-apply.test.js tests/harness-tools.test.js tests/harness-sidecar.test.js tests/harness-ui-discoverability.test.js
```

- [ ] Run full test suite:

```powershell
npm test
```

Expected: all non-skipped tests pass.

- [ ] Run release smoke:

```powershell
npm run release:smoke
```

Expected:

```text
checked package.json
checked src/server.js
checked src/electron/main.js
checked src/electron/preload.js
checked public/index.html
checked package-lock.json
```

- [ ] Run whitespace check:

```powershell
git diff --check
```

Expected: no whitespace errors. CRLF warnings are acceptable on Windows.

- [ ] Run secret/private endpoint scan:

```powershell
rg -n "95\.133\.252\.102|http://95\.133|sk-|ghp_|Bearer " src tests README.md docs scripts .github
```

Expected: only deliberate redaction fixtures, security tests, and scan command text.

- [ ] Request final code review:

Focus review on:

- VLM output cannot self-certify unsafe visual verifier changes.
- Verifier evolution cannot promote without human approval.
- Held-out cases and baseline verifier checks gate promotion.
- No binary image data leaks into events/traces.
- Tool verifier execution remains workspace-scoped.

---

## Suggested Subagent Split

Use separate subagents with disjoint write scopes:

1. **Visual verifier worker:** Chunk 1.
2. **Registry/selector worker:** Chunk 2.
3. **Verifier evolution core worker:** Chunk 3.
4. **BES/RHO/meta integration worker:** Chunk 4.
5. **Approval/UI worker:** Chunk 5.
6. **Security reviewer:** Cross-check VLM prompt injection, verifier self-promotion, path safety, and token/credential leakage.
7. **Coordinator:** Owns `src/harness-sidecar/server.js` final integration and full verification.

Do not let multiple workers edit `src/harness-sidecar/server.js` at the same time. Workers should leave server wiring notes for the coordinator unless their chunk explicitly owns server changes.

