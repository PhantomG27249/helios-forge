# Remaining Harness Feature Gap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining missing and partial features from the original Pi Agent and Research Agent Harness plans without destabilizing the current working Helios Forge runtime.

**Architecture:** Keep Pi/UI thin and keep long-running orchestration inside `src/harness-sidecar/`. Add missing production depth as focused modules with tests first, then wire them through `src/harness-sidecar/server.js`, `src/server.js`, and `public/app.js` only after the core modules are green.

**Tech Stack:** Node.js ESM, built-in `node:test`, PowerShell on Windows, Git worktrees, sidecar event traces, local `.harness` state, optional injected adapters for browser/OCR/PDF/vector/external services.

---

## Current Feature Inventory

This plan was derived by comparing:

- `C:\Users\jackj\Downloads\pi_agent_research_harness_plan.md`
- `C:\Users\jackj\Downloads\research_agent_harness_plan_v6.md`
- Current Helios Forge code and tests on `develop`

Current state:

- **Substantially implemented:** 29 feature areas
- **Partial / foundation present:** 10 feature areas
- **Mostly missing:** 4 feature areas
- **Total covered in some form:** 39 of 43 planned feature areas

### Substantially Implemented

- Sidecar task lifecycle and event streaming
- Trace writing, trace reading, replay, compaction, final audit
- Model gateway, model profiles, structured output repair, multimodal requests
- Tool loop controller and default tool registry
- Shell broker, verifier runner, final validator, patch proposal flow
- MCP client/runtime foundation and capability-record startup
- Approval resume store and approval-gated safe apply
- Git-backed safe apply adapter
- Workspace RAG indexing, chunking, retrieval, context packs
- Unified context composition from RAG, memory, graph memory, and graph context
- Memory write, promotion, review queue, stale/conflict handling, graph memory maintenance
- Knowledge graph store, entity extraction, code graph, claim/evidence graph, experiment graph, visual graph
- BES subgoals, genomes, mutation, recombination, diversity, champion archive
- RHO coreset and preference judge
- Meta optimizer, candidate runner/archive, promotion policy
- Swarm orchestration, model workers, worktree attempts, reviewers, champion selection
- Deep research baseline: brief, source discovery/ingestion, citations, contradictions, reports, handoff
- Experiment queue, tracker, metric comparer, noise gate, reports, decisions
- VLM artifacts: screenshot manifests, PDF page manifests, cropper, plots, diagrams, image IO, visual model runner
- Production visual capture adapter interface for screenshots, PDF pages, OCR, visual diffs
- Collaboration primitives: locks, leases, versioned state, roles, claims, annotations, audit log
- Capability/package installer, scoped capability registry, UI capability panels
- Trace/capability/deep-research UI panels and subagent activity display

### Partial Features To Finish

- Verifier registry and automatic verifier selection
- Production browser/PDF/OCR/default visual workers
- Rich semantic code graph with call/import/dependency impact edges
- Context-window manager with explicit thresholds, working memory, and decision ledger integration
- Budget hierarchy, budget gates, cost-aware retrieval/swarm allocation, and dashboard
- Error recovery manager for malformed tools, repeated failures, sandbox crashes, and degraded modes
- MCP security depth: poisoning evals, rate limits, trust tiers, scoped credential mounting, health UI
- Full collaboration workflow: human roles enforcement, duplicate task detection, controlled merge conflicts
- Deep Research v2 production depth: richer PDF/figure extraction, specialist subagents, novelty controls
- External agent interoperability: A2A/ACP-style gateway and delegated capability tokens

### Mostly Missing Features

- Full sandbox restart/recovery subsystem
- Real default browser/PDF/OCR worker implementations bundled into the sidecar runtime
- Operator dashboard for recovery, budget, context pressure, and collaboration alerts
- Complete controlled final merge workflow from champion worktree into real branches with conflict recovery

---

## Wave 1: Verifier Intelligence

Build a first-class verifier registry and automatic verifier selector. This should be the next highest leverage item because verifier evidence is the harness safety backbone.

**Files:**

- Create: `src/harness-sidecar/tools/verifierRegistry.js`
- Create: `src/harness-sidecar/tools/verifierSelector.js`
- Modify: `src/harness-sidecar/tools/verifierRunner.js`
- Modify: `src/harness-sidecar/tools/defaultToolRegistry.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-verifier-registry.test.js`
- Test: `tests/harness-verifier-selector.test.js`
- Test: `tests/harness-sidecar.test.js`

### Task 1: Registry schema and loader

- [ ] **Step 1: Write failing tests for registry defaults**

Test expected behavior:

- Empty workspace returns default verifiers from `package.json`: `npm test`, `npm run release:smoke` when present.
- `.harness/verifiers.json` or `.harness/verifiers.yaml` can define named verifiers.
- Unsafe cwd/path values are rejected.

Run:

```powershell
npm test -- tests/harness-verifier-registry.test.js
```

Expected: fail because `verifierRegistry.js` does not exist.

- [ ] **Step 2: Implement `loadVerifierRegistry`**

Implement:

```js
export async function loadVerifierRegistry({ workspaceRoot }) {
  // returns { version, verifiers, byName }
}
```

Verifier record shape:

```js
{
  name: 'unit',
  command: 'npm test',
  kind: 'unit',
  risk: 'medium',
  timeoutMs: 120000,
  cwd: null,
  appliesTo: ['**/*.js'],
  tags: ['default']
}
```

- [ ] **Step 3: Run focused tests**

Run:

```powershell
npm test -- tests/harness-verifier-registry.test.js
```

Expected: pass.

### Task 2: Changed-file verifier selector

- [ ] **Step 1: Write failing tests for selection**

Cover:

- JS source changes select `unit`.
- Sidecar/runtime changes select focused tests and release smoke.
- VLM changes select VLM tests.
- Unknown changes select smoke/default.

Run:

```powershell
npm test -- tests/harness-verifier-selector.test.js
```

Expected: fail because selector does not exist.

- [ ] **Step 2: Implement `selectVerifiersForTask`**

Inputs:

```js
selectVerifiersForTask({
  task,
  changedFiles,
  registry,
  recentFailures,
  maxVerifiers
})
```

Return ordered verifier records with reasons:

```js
[{ name: 'unit', command: 'npm test', reason: 'default_js_change' }]
```

- [ ] **Step 3: Wire into full runtime**

In `src/harness-sidecar/server.js`, emit:

- `verifier.registry_loaded`
- `verifier.selection_created`
- `verifier.run_completed`

Do not auto-run expensive verifiers without budget approval.

- [ ] **Step 4: Verify**

Run:

```powershell
npm test -- tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js tests/harness-sidecar.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add src/harness-sidecar/tools/verifierRegistry.js src/harness-sidecar/tools/verifierSelector.js src/harness-sidecar/tools/verifierRunner.js src/harness-sidecar/tools/defaultToolRegistry.js src/harness-sidecar/server.js tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js tests/harness-sidecar.test.js
git commit -m "Add verifier registry and selector"
```

---

## Wave 2: Production Visual Workers

Replace adapter-only production visual capture with default sidecar workers for browser screenshots, basic PDF rendering hooks, OCR hooks, and visual diffs. Keep injected adapters supported for tests.

**Files:**

- Create: `src/harness-sidecar/vlm/browserPreviewCapture.js`
- Create: `src/harness-sidecar/vlm/ocrWorker.js`
- Create: `src/harness-sidecar/vlm/pdfPageWorker.js`
- Create: `src/harness-sidecar/vlm/visualDiffWorker.js`
- Modify: `src/harness-sidecar/vlm/productionArtifactCapture.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-vlm-production-workers.test.js`
- Test: `tests/harness-vlm-artifact-capture.test.js`

### Task 1: Browser screenshot worker

- [ ] **Step 1: Write failing tests**

Use an injected minimal browser adapter in tests. Do not require Playwright as a package dependency unless the repo adds it intentionally.

Expected behavior:

- `captureBrowserPreview({ url, outputPath })` writes a PNG or returns a clear `adapter_required` error.
- It emits dimensions and no binary payload.

- [ ] **Step 2: Implement default worker wrapper**

The default worker should use an injected `browserRuntime` when supplied. If none exists, return:

```js
{ status: 'unavailable', reason: 'browser_runtime_required' }
```

This keeps production code honest while avoiding fake screenshots.

### Task 2: OCR/PDF/diff workers

- [ ] **Step 1: Write failing tests for each worker**

Cover unavailable defaults and injected adapters.

- [ ] **Step 2: Implement workers**

Rules:

- Never embed binary content in events.
- Store artifacts under `.harness/visual/<taskId>/`.
- Reject path traversal.
- Include OCR text in artifact metadata only after size limits.

### Task 3: Sidecar wiring

- [ ] **Step 1: Wire default workers into `createHarnessSidecar`**

If `visualCaptureAdapter` is not supplied, construct a default adapter from the workers.

- [ ] **Step 2: Emit production visual events**

Ensure these events exist:

- `vlm.production_screenshot_captured`
- `vlm.production_pdf_pages_captured`
- `vlm.production_ocr_completed`
- `vlm.production_visual_diff_captured`
- `vlm.production_artifacts_created`

- [ ] **Step 3: Verify**

Run:

```powershell
npm test -- tests/harness-vlm-production-workers.test.js tests/harness-vlm-artifact-capture.test.js tests/harness-sidecar.test.js
```

Expected: pass.

---

## Wave 3: Error Recovery and No-Progress Manager

Build the robustness layer from the v6 plan: malformed tool recovery, unknown tools, repeated failures, sandbox crash recording, degraded modes.

**Files:**

- Create: `src/harness-sidecar/reliability/errorTaxonomy.js`
- Create: `src/harness-sidecar/reliability/toolCallRecovery.js`
- Create: `src/harness-sidecar/reliability/noProgressDetector.js`
- Create: `src/harness-sidecar/reliability/degradedModeRegistry.js`
- Modify: `src/harness-sidecar/tools/toolLoopController.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-error-recovery.test.js`
- Test: `tests/harness-tool-loop.test.js`
- Test: `tests/harness-swarm-runtime.test.js`

### Task 1: Failure taxonomy

- [ ] **Step 1: Write failing taxonomy tests**

Categories:

- `malformed_tool_call`
- `unknown_tool`
- `tool_timeout`
- `repeated_tool_failure`
- `patch_apply_failed`
- `sandbox_crash`
- `no_progress`
- `budget_exhausted`

- [ ] **Step 2: Implement `classifyHarnessFailure`**

Return:

```js
{ category, severity, recoverable, recommendedAction }
```

### Task 2: Tool-loop recovery

- [ ] **Step 1: Write failing tests**

Cover:

- Malformed tool JSON attempts repair.
- Unknown tool returns available tool list.
- Repeated same failing tool emits `recovery.no_progress_detected`.

- [ ] **Step 2: Update `runToolLoop`**

Add optional recovery hooks without changing default deterministic behavior.

### Task 3: Degraded mode registry

- [ ] **Step 1: Write tests**

It records degraded modes and emits a final report summary.

- [ ] **Step 2: Wire into sidecar**

Emit:

- `recovery.failure_classified`
- `recovery.degraded_mode_entered`
- `recovery.no_progress_detected`
- `recovery.partial_report_ready`

### Task 4: Verify and commit

Run:

```powershell
npm test -- tests/harness-error-recovery.test.js tests/harness-tool-loop.test.js tests/harness-swarm-runtime.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/reliability src/harness-sidecar/tools/toolLoopController.js src/harness-sidecar/swarm/swarmOrchestrator.js src/harness-sidecar/server.js tests/harness-error-recovery.test.js tests/harness-tool-loop.test.js tests/harness-swarm-runtime.test.js tests/harness-sidecar.test.js
git commit -m "Add harness error recovery manager"
```

---

## Wave 4: Context and Budget Dashboard

Finish the v6 context-window and cost-control layer.

**Files:**

- Create: `src/harness-sidecar/context/contextWindowManager.js`
- Create: `src/harness-sidecar/context/workingMemory.js`
- Create: `src/harness-sidecar/budget/budgetHierarchy.js`
- Create: `src/harness-sidecar/budget/costAwareAllocator.js`
- Create: `src/harness-sidecar/budget/budgetDashboard.js`
- Modify: `src/harness-sidecar/rag/unifiedContextComposer.js`
- Modify: `src/harness-sidecar/budget/budgetManager.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Test: `tests/harness-context-window-manager.test.js`
- Test: `tests/harness-budget-dashboard.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

### Task 1: Context window thresholds

- [ ] **Step 1: Write tests**

Cover 70/80/90/95 percent thresholds:

- 70: summarize older tool outputs
- 80: compress raw logs
- 90: freeze decision ledger and rebuild pack
- 95: stop and request budget/profile change

- [ ] **Step 2: Implement manager**

Return:

```js
{ status, threshold, actions, contextPack, droppedItems, retainedP0Items }
```

### Task 2: Hierarchical budgets

- [ ] **Step 1: Write tests**

Budget scopes:

- workspace
- task
- swarm
- subagent
- model call
- tool call
- vision artifact

- [ ] **Step 2: Implement budget hierarchy and gates**

Emit:

- `budget.gate`
- `budget.downshift_recommended`
- `budget.exhausted`

### Task 3: UI dashboard

- [ ] **Step 1: Add tests for UI discoverability**

The browser harness should expose a compact dashboard with:

- context pressure
- budget used
- active subagents
- pending approvals
- latest recovery status

- [ ] **Step 2: Implement UI panel**

Use existing harness panel conventions in `public/index.html` and `public/app.js`.

### Task 4: Verify and commit

Run:

```powershell
npm test -- tests/harness-context-window-manager.test.js tests/harness-budget-dashboard.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/context src/harness-sidecar/budget src/harness-sidecar/rag/unifiedContextComposer.js src/harness-sidecar/server.js public/index.html public/app.js tests/harness-context-window-manager.test.js tests/harness-budget-dashboard.test.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
git commit -m "Add context and budget dashboard"
```

---

## Wave 5: Semantic Code Graph and Impact Analysis

Deepen codebase graphs from file/symbol graph into agent-useful impact analysis.

**Files:**

- Create: `src/harness-sidecar/graph/importGraph.js`
- Create: `src/harness-sidecar/graph/callGraphHeuristics.js`
- Create: `src/harness-sidecar/graph/impactAnalyzer.js`
- Modify: `src/harness-sidecar/graph/codeGraph.js`
- Modify: `src/harness-sidecar/rag/graphRagComposer.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-code-impact-graph.test.js`
- Test: `tests/harness-knowledge-graph.test.js`

### Task 1: Import/dependency graph

- [ ] **Step 1: Write failing tests**

Use small JS fixtures with imports/exports.

- [ ] **Step 2: Implement import graph extraction**

Capture:

- `imports`
- `exports`
- file-to-file dependency edges
- unresolved imports

### Task 2: Heuristic call graph

- [ ] **Step 1: Write failing tests**

Capture function declarations and simple call expressions from JS source.

- [ ] **Step 2: Implement heuristics**

No full parser dependency yet. Use conservative extraction and label edges as heuristic.

### Task 3: Impact analyzer

- [ ] **Step 1: Write failing tests**

Given changed files, return likely impacted files, symbols, and verifiers.

- [ ] **Step 2: Wire into unified context**

GraphRAG should include impact items with reason:

```text
import_graph_impacted_by_change
```

### Task 4: Verify and commit

Run:

```powershell
npm test -- tests/harness-code-impact-graph.test.js tests/harness-knowledge-graph.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/graph src/harness-sidecar/rag/graphRagComposer.js src/harness-sidecar/server.js tests/harness-code-impact-graph.test.js tests/harness-knowledge-graph.test.js tests/harness-sidecar.test.js
git commit -m "Add semantic code impact graph"
```

---

## Wave 6: Collaboration and Controlled Merge Workflow

Finish the shared-workspace layer: roles, duplicate task detection, merge conflict handling, final champion merge flow.

**Files:**

- Create: `src/harness-sidecar/collaboration/rolePolicy.js`
- Create: `src/harness-sidecar/collaboration/duplicateTaskDetector.js`
- Create: `src/harness-sidecar/collaboration/mergeManager.js`
- Modify: `src/harness-sidecar/collaboration/roles.js`
- Modify: `src/harness-sidecar/collaboration/conflictResolver.js`
- Modify: `src/harness-sidecar/tools/gitApplyAdapter.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-collaboration-roles.test.js`
- Test: `tests/harness-duplicate-task-detector.test.js`
- Test: `tests/harness-merge-manager.test.js`

### Task 1: Role enforcement

- [ ] **Step 1: Write failing role policy tests**

Verify:

- owner can approve high-risk actions
- researcher can approve medium-risk actions
- reviewer can approve memory writes/final reports
- observer cannot approve mutations

- [ ] **Step 2: Implement role policy**

Return structured decisions:

```js
{ allowed, reason, requiredRole }
```

### Task 2: Duplicate task detector

- [ ] **Step 1: Write failing tests**

Use active task summaries and lexical similarity.

- [ ] **Step 2: Implement detector**

Return:

```js
{ duplicateLikely, matches, recommendedAction: 'join_or_fork' }
```

### Task 3: Controlled merge manager

- [ ] **Step 1: Write failing tests**

Use a temp git repo. Cover:

- clean apply
- base changed
- textual conflict
- verifier rerun required

- [ ] **Step 2: Implement merge manager**

Keep current `gitApplyAdapter` as the low-level patch application mechanism. Add branch/worktree conflict orchestration above it.

### Task 4: Verify and commit

Run:

```powershell
npm test -- tests/harness-collaboration-roles.test.js tests/harness-duplicate-task-detector.test.js tests/harness-merge-manager.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/collaboration src/harness-sidecar/tools/gitApplyAdapter.js src/harness-sidecar/server.js tests/harness-collaboration-roles.test.js tests/harness-duplicate-task-detector.test.js tests/harness-merge-manager.test.js tests/harness-sidecar.test.js
git commit -m "Add controlled collaboration merge workflow"
```

---

## Wave 7: MCP Security Depth and External Agent Interop

Finish external tool safety and agent interoperability.

**Files:**

- Create: `src/harness-sidecar/tools/mcpPolicy.js`
- Create: `src/harness-sidecar/tools/mcpPoisoningEval.js`
- Create: `src/harness-sidecar/interop/externalAgentGateway.js`
- Create: `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
- Modify: `src/harness-sidecar/tools/mcpBroker.js`
- Modify: `src/harness-sidecar/tools/mcpRuntime.js`
- Modify: `src/harness-sidecar/interop/agentRouter.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-mcp-security.test.js`
- Test: `tests/harness-agent-interop.test.js`

### Task 1: MCP trust tiers and poisoning evals

- [ ] **Step 1: Write failing MCP policy tests**

Cover:

- allowlists
- risky tools
- trust tiers
- rate limits
- returned-content prompt injection flags
- scoped credential names only

- [ ] **Step 2: Implement policy and eval fixtures**

Emit:

- `mcp.policy_evaluated`
- `mcp.poisoning_detected`
- `mcp.rate_limited`

### Task 2: External agent gateway

- [ ] **Step 1: Write failing interop tests**

Cover:

- agent cards
- scoped task envelope
- no credential leakage
- delegated capability token validation

- [ ] **Step 2: Implement gateway**

Keep gateway read-only by default. Mutation requires approval and capability token.

### Task 3: Verify and commit

Run:

```powershell
npm test -- tests/harness-mcp-security.test.js tests/harness-agent-interop.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/tools src/harness-sidecar/interop src/harness-sidecar/server.js tests/harness-mcp-security.test.js tests/harness-agent-interop.test.js tests/harness-sidecar.test.js
git commit -m "Harden MCP policy and external agent interop"
```

---

## Wave 8: Deep Research v2 Production Depth

Finish the production research workflow from the original plans.

**Files:**

- Create: `src/harness-sidecar/research/researchSubagents.js`
- Create: `src/harness-sidecar/research/figureExtractor.js`
- Create: `src/harness-sidecar/research/noveltyControls.js`
- Modify: `src/harness-sidecar/research/deepResearchManager.js`
- Modify: `src/harness-sidecar/research/sourceIngestion.js`
- Modify: `src/harness-sidecar/research/citationAuditor.js`
- Modify: `src/harness-sidecar/research/contradictionFinder.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-deep-research-v2.test.js`
- Test: `tests/harness-research-experiments.test.js`

### Task 1: Research specialist subagents

- [ ] **Step 1: Write failing tests**

Roles:

- source finder
- paper reader
- figure analyst
- citation auditor
- contradiction reviewer
- implementation planner

- [ ] **Step 2: Implement subagent orchestration contract**

Use deterministic worker functions in tests. Do not require external web.

### Task 2: Figure extraction and novelty controls

- [ ] **Step 1: Write failing tests**

Cover PDF page metadata, figure candidates, and novelty/risk flags.

- [ ] **Step 2: Implement production-depth research artifacts**

Outputs:

- `source_map.json`
- `claim_evidence_graph.json`
- `figure_notes.md`
- `contradictions.md`
- `implementation_recommendations.md`
- `final_report.md`

### Task 3: Verify and commit

Run:

```powershell
npm test -- tests/harness-deep-research-v2.test.js tests/harness-research-experiments.test.js tests/harness-sidecar.test.js
git add src/harness-sidecar/research src/harness-sidecar/server.js tests/harness-deep-research-v2.test.js tests/harness-research-experiments.test.js tests/harness-sidecar.test.js
git commit -m "Deepen research v2 workflow"
```

---

## Final Verification

After all waves:

- [ ] Run focused suites for every new wave.

```powershell
npm test -- tests/harness-verifier-registry.test.js tests/harness-verifier-selector.test.js tests/harness-vlm-production-workers.test.js tests/harness-error-recovery.test.js tests/harness-context-window-manager.test.js tests/harness-budget-dashboard.test.js tests/harness-code-impact-graph.test.js tests/harness-collaboration-roles.test.js tests/harness-duplicate-task-detector.test.js tests/harness-merge-manager.test.js tests/harness-mcp-security.test.js tests/harness-agent-interop.test.js tests/harness-deep-research-v2.test.js
```

- [ ] Run the full suite.

```powershell
npm test
```

Expected: all non-skipped tests pass.

- [ ] Run release smoke.

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

- [ ] Restart local app.

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Start
```

- [ ] Open web preview.

URL:

```text
http://127.0.0.1:3777/
```

- [ ] Confirm no secrets or private endpoints are committed.

```powershell
rg -n "95\.133\.252\.102|http://95\.133|sk-|ghp_|Bearer " src tests README.md docs scripts .github
```

Expected: only deliberate test fixtures and redaction tests.

---

## Suggested Execution Order

1. **Wave 1: Verifier Intelligence** because verifier evidence gates safety.
2. **Wave 3: Error Recovery** because autonomous loops need robust failure handling.
3. **Wave 4: Context and Budget Dashboard** because swarms/meta optimization need guardrails.
4. **Wave 5: Semantic Code Graph** because it improves task quality without large UI risk.
5. **Wave 2: Production Visual Workers** because it unlocks real VLM artifact inspection.
6. **Wave 6: Collaboration and Merge Workflow** because real branch application needs conflict safety.
7. **Wave 7: MCP Security and Interop** because external tools need stronger policy before broad use.
8. **Wave 8: Deep Research v2** because it benefits from the stronger verifier/context/visual foundations.

This order preserves the current working harness while pushing it from "feature-rich prototype" toward "production-grade research agent operating system."
