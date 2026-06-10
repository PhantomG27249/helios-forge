# MemGraphRAG Runtime Completion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Helios Forge's existing memory graph modules into an always-on, task-aware MemGraphRAG-style runtime with shared-memory extraction, conflict adjudication, hierarchical retrieval, eval feedback, and clear feature-status reporting.

**Architecture:** Keep the current deterministic memory/RAG baseline, then add a runtime graph construction pipeline behind explicit feature flags. The pipeline should extract passages/schemas/facts from task traces and workspace/RAG evidence, update shared global memory layers, adjudicate conflicts, construct a memory-guided graph, feed memory-aware retrieval into unified context, and let RHO/BES/adaptive search tune the policies over time.

**Tech Stack:** Node.js ESM, `node:test`, Helios sidecar modules under `src/harness-sidecar`, `.harness` workspace state, existing RHO/BES/adaptive-search modules, trace JSONL, workspace-local config.

---

## Current Deployment Findings

- The UI at `http://127.0.0.1:3777/` is running, but the active harness sidecar health endpoint is `http://127.0.0.1:49321/v1/health`.
- The active sidecar currently reports `workspaceRoot: C:\Users\jackj\Downloads\Qwen Testing 2`, not `C:\Users\jackj\Github\helios-forge`.
- `C:\Users\jackj\Downloads\Qwen Testing 2` has no `.harness/config.yaml`, so it is using default flags: `swarm=false`, `modelDrivenSwarm=false`, `piNativeSwarm=false`, `deepResearch=false`, `experiments=false`, `visualArtifacts=false`, `adaptiveSearch=false`.
- `C:\Users\jackj\Github\helios-forge\.harness\config.yaml` enables `swarm`, `modelDrivenSwarm`, `piNativeSwarm`, `deepResearch`, `experiments`, and `visualArtifacts`, but still leaves `features.adaptiveSearch` unset, which merges to `false`.
- The sidecar has `/v1/adaptive-search/status`, `/v1/adaptive-search/replay`, and `/v1/skill-candidates` implemented. The main UI WebSocket server has client-side handlers for these messages, but needs server-side forwarding methods in `src/server.js` and `src/harness/harnessClient.js`.

## A2A and Agent Interop Status

Helios Forge has an A2A-shaped local interop layer, but it is not yet a complete peer-to-peer A2A swarm network.

Implemented today:

- `src/harness-sidecar/interop/a2aSwarmEnvelope.js` builds scoped A2A-style envelopes for swarm attempts. The envelope carries task id, attempt id, role, strategy, planning metadata, allowed context, budget, output contract, and a compact reply contract. It redacts secrets before dispatch.
- `src/harness-sidecar/swarm/piNativeWorker.js` uses that envelope when assigning Pi-native swarm attempts through Pi RPC. It asks the worker for compact JSON, recovers delayed final messages, adapts natural-language handoffs into the required contract, emits subagent trace events, and returns normalized verifier evidence, compact handoff quality, patch stats, and worker metadata.
- `src/harness-sidecar/interop/agentCards.js`, `agentRouter.js`, `externalAgentGateway.js`, and `delegatedCapabilityTokens.js` provide the broader interop contract: normalized agent cards, protocol/capability/trust/cost/latency routing, credential redaction, scoped gateway envelopes, mutation blocking without approval, and delegated capability-token checks.
- Focused tests cover these contracts in `tests/harness-agent-interop.test.js` and `tests/harness-swarm-pi-native-worker.test.js`.

Not implemented yet:

- Persistent A2A server endpoints for each running agent.
- Peer discovery or a network-visible agent registry.
- Bidirectional streaming between independent swarm agents.
- Durable inbox/outbox storage, message correlation ids, retry/resume, cancellation, and progress-event protocol.
- Shared task-state sync between independently running agent processes.
- Cross-agent negotiation where one subagent can directly ask another subagent for help without routing through the Helios sidecar.

For the MemGraphRAG runtime, this means A2A should be treated as a local assignment envelope for now. The memory extraction society can still expose agent roles such as `passage_collector`, `schema_proposer`, `fact_extractor`, `contradiction_critic`, and `merge_planner`, but those roles should initially run inside the sidecar orchestration boundary. If later work promotes those roles into independent agents, the missing transport pieces above should be implemented first so multi-agent graph construction has durable messages, scoped context, provenance, and cancellation semantics rather than best-effort prompt dispatch.

## File Structure

- Modify `src/harness-sidecar/config/configLoader.js`: add explicit runtime flags for memory graph runtime, hierarchical retrieval, graph evals, and feature status reporting.
- Modify `scripts/setup-helios-forge.js`: update default generated config so Helios workspaces can opt into adaptive search and memory graph runtime clearly.
- Create `src/harness-sidecar/memory/memoryExtractionSociety.js`: deterministic multi-pass extraction coordinator for passages, schema candidates, facts, critique, and merge decisions.
- Create `src/harness-sidecar/memory/memoryGraphRuntime.js`: orchestrates extraction, layer updates, conflict adjudication, graph construction, snapshot persistence, and emitted events.
- Modify `src/harness-sidecar/memory/globalMemoryLayers.js`: add persistence-safe layer metadata and merge counters needed by runtime extraction.
- Modify `src/harness-sidecar/memory/memoryConflictAdjudicator.js`: add injected model adjudication hooks while preserving deterministic fallback decisions.
- Modify `src/harness-sidecar/memory/graphMemoryMaintenance.js`: store global-memory layer summaries, memory-guided graph stats, and hierarchical retrieval metadata in snapshots.
- Create `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`: retrieve from graph nodes, fact clusters, passage evidence, and graph snapshot summaries.
- Modify `src/harness-sidecar/rag/unifiedContextComposer.js`: accept hierarchical memory graph context as a first-class source and report adaptive-search policy decisions.
- Modify `src/harness-sidecar/server.js`: call the memory graph runtime during task execution and expose feature-status endpoints.
- Modify `src/harness/harnessClient.js`: add `getAdaptiveSearchStatus`, `prepareAdaptiveSearchReplay`, `listSkillCandidates`, `reviewSkillCandidate`, and `getFeatureStatus` methods.
- Modify `src/server.js`: forward WebSocket messages for adaptive search, skill candidates, and feature status from the UI to the sidecar.
- Modify `public/app.js`, `public/index.html`, `public/app.css`: show the actual active workspace, feature flags, sidecar URL, and disabled reasons in the harness panel.
- Tests:
  - Create `tests/harness-memory-extraction-society.test.js`
  - Create `tests/harness-memory-graph-runtime.test.js`
  - Create `tests/harness-hierarchical-memory-retriever.test.js`
  - Create `tests/harness-feature-status-api.test.js`
  - Update `tests/harness-rag-memory.test.js`
  - Update `tests/harness-sidecar.test.js`
  - Update `tests/harness-ui-discoverability.test.js`

---

## Chunk 1: Runtime Feature Status and Activation

### Task 1: Add Explicit Feature Status API

**Files:**
- Modify: `src/harness-sidecar/config/configLoader.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-feature-status-api.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that start a sidecar with a temporary workspace and assert `/v1/features/status` returns:

```js
{
  workspaceRoot,
  features: {
    swarm: { enabled: false, source: 'default' },
    adaptiveSearch: { enabled: false, source: 'default' },
    memoryGraphRuntime: { enabled: false, source: 'default' }
  },
  disabledReasons: {
    adaptiveSearch: 'features.adaptiveSearch is false'
  }
}
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
npm test -- tests/harness-feature-status-api.test.js
```

Expected: FAIL because `/v1/features/status` does not exist.

- [ ] **Step 3: Implement status builder**

Add `buildHarnessFeatureStatus({ config, workspaceRoot })` near the config loader or as a small sidecar helper. It should report each known flag, whether it came from config/default/env, and the reason it is disabled.

- [ ] **Step 4: Add sidecar route**

Add `GET /v1/features/status` in `src/harness-sidecar/server.js` and return the current workspace root plus resolved feature status.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm test -- tests/harness-feature-status-api.test.js
git add src/harness-sidecar/config/configLoader.js src/harness-sidecar/server.js tests/harness-feature-status-api.test.js
git commit -m "feat(harness): expose resolved feature status"
```

### Task 2: Bridge Adaptive Search and Skill Candidate UI Requests

**Files:**
- Modify: `src/harness/harnessClient.js`
- Modify: `src/server.js`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing bridge tests**

Assert the main WebSocket server has command branches for:

- `harness_adaptive_search_status_get`
- `harness_adaptive_search_replay_prepare`
- `harness_skill_candidates_get`
- `harness_skill_candidate_review`
- `harness_feature_status_get`

- [ ] **Step 2: Implement client methods**

Add wrapper methods in `src/harness/harnessClient.js` for the existing sidecar routes:

- `GET /v1/adaptive-search/status`
- `POST /v1/adaptive-search/replay`
- `GET /v1/skill-candidates`
- `POST /v1/skill-candidates/:id/approve`
- `POST /v1/skill-candidates/:id/reject`
- `GET /v1/features/status`

- [ ] **Step 3: Implement WebSocket forwarding**

Add matching `case` branches in `src/server.js`, each calling `ensureHarnessRunning()` first and returning:

- `harness_adaptive_search_status`
- `harness_adaptive_search_replay`
- `harness_skill_candidates`
- `harness_skill_candidate_reviewed`
- `harness_feature_status`

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-ui-discoverability.test.js tests/harness-adaptive-search-skill-api.test.js
git add src/harness/harnessClient.js src/server.js tests/harness-ui-discoverability.test.js
git commit -m "feat(ui): bridge adaptive search and skill review status"
```

### Task 3: Make Helios Default Config Honest

**Files:**
- Modify: `scripts/setup-helios-forge.js`
- Modify: `tests/setup-helios-forge.test.js`
- Modify: `.harness/config.yaml` only for the local dev workspace, not for committed secrets.

- [ ] **Step 1: Update generated config defaults**

Add explicit keys:

```yaml
features:
  adaptiveSearch: true
  memoryGraphRuntime: false
  hierarchicalMemoryRetrieval: false
  memoryGraphEvals: false
adaptiveSearch:
  mode: advisory
  maxActionsPerTask: 8
  allowProfileSwitching: true
```

- [ ] **Step 2: Update tests**

Verify setup writes the explicit adaptive-search block.

- [ ] **Step 3: Update local `.harness/config.yaml`**

For `C:\Users\jackj\Github\helios-forge`, set:

```yaml
features:
  adaptiveSearch: true
```

Do not commit private model URLs or local-only credentials.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/setup-helios-forge.test.js
git add scripts/setup-helios-forge.js tests/setup-helios-forge.test.js
git commit -m "chore(setup): expose adaptive search config defaults"
```

---

## Chunk 2: Shared-Memory Graph Runtime

### Task 4: Build the Extraction Society

**Files:**
- Create: `src/harness-sidecar/memory/memoryExtractionSociety.js`
- Test: `tests/harness-memory-extraction-society.test.js`

- [ ] **Step 1: Write failing tests**

Test that the extraction society can run deterministic passes over trace events and context items:

- passage collector
- schema proposer
- fact extractor
- contradiction critic
- merge planner

- [ ] **Step 2: Implement deterministic passes**

The module should export `runMemoryExtractionSociety({ taskId, traceEvents, contextItems, existingLayers, modelGateway, config })`.

It should return:

```js
{
  passages: [],
  schemas: [],
  facts: [],
  conflicts: [],
  mergePlan: [],
  agents: [
    { id: 'passage_collector', status: 'completed' },
    { id: 'schema_proposer', status: 'completed' }
  ]
}
```

When no model gateway is available, use deterministic extraction from task summaries, artifacts, paths, and promoted memory records.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-memory-extraction-society.test.js
git add src/harness-sidecar/memory/memoryExtractionSociety.js tests/harness-memory-extraction-society.test.js
git commit -m "feat(memory): add shared extraction society"
```

### Task 5: Add Runtime Orchestrator

**Files:**
- Create: `src/harness-sidecar/memory/memoryGraphRuntime.js`
- Modify: `src/harness-sidecar/memory/globalMemoryLayers.js`
- Modify: `src/harness-sidecar/memory/graphMemoryMaintenance.js`
- Test: `tests/harness-memory-graph-runtime.test.js`

- [ ] **Step 1: Write failing runtime tests**

Assert that `runMemoryGraphRuntime()`:

- loads existing layer state
- applies extraction output
- activates stable schemas
- detects and applies conflict decisions
- constructs a memory-guided graph
- persists a graph snapshot with `globalMemory` and `memoryGuidedGraph`
- emits event summaries for each stage

- [ ] **Step 2: Implement runtime**

Export `runMemoryGraphRuntime({ workspaceRoot, taskId, traceEvents, contextItems, promotedMemories, modelGateway, emitEvent, config })`.

Use existing modules:

- `createGlobalMemoryLayers`
- `activateStableSchemas`
- `detectGlobalMemoryConflicts`
- `adjudicateMemoryConflict`
- `applyConflictDecision`
- `constructMemoryGuidedGraph`
- `maintainGraphMemorySnapshot`

- [ ] **Step 3: Add layer persistence**

Persist layer state to `.harness/memory/global-layers.json` with safe IDs and no secrets.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-memory-graph-runtime.test.js tests/harness-memgraphrag-construction.test.js
git add src/harness-sidecar/memory/memoryGraphRuntime.js src/harness-sidecar/memory/globalMemoryLayers.js src/harness-sidecar/memory/graphMemoryMaintenance.js tests/harness-memory-graph-runtime.test.js
git commit -m "feat(memory): run memory guided graph construction"
```

### Task 6: Add Model-Assisted Conflict Adjudication

**Files:**
- Modify: `src/harness-sidecar/memory/memoryConflictAdjudicator.js`
- Test: `tests/harness-memory-graph-runtime.test.js`

- [ ] **Step 1: Add failing tests**

Inject a fake model gateway that returns a structured decision for a mutually exclusive conflict and assert that:

- deterministic fallback remains available
- model output must be structured
- unsafe or unsupported actions fall back to `needs_review`

- [ ] **Step 2: Implement optional model adjudicator**

Add `adjudicateMemoryConflictWithModel({ conflict, evidence, modelGateway, profileName, fallbackPolicy })`.

Allowed actions:

- `discard`
- `keep_both`
- `temporally_qualify`
- `refine`
- `needs_review`

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-memory-graph-runtime.test.js
git add src/harness-sidecar/memory/memoryConflictAdjudicator.js tests/harness-memory-graph-runtime.test.js
git commit -m "feat(memory): add guarded model conflict adjudication"
```

---

## Chunk 3: Hierarchical Memory Retrieval

### Task 7: Build Hierarchical Retriever

**Files:**
- Create: `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
- Test: `tests/harness-hierarchical-memory-retriever.test.js`

- [ ] **Step 1: Write failing tests**

Given a snapshot containing `globalMemory`, `memoryGuidedGraph`, and ranked context items, assert retrieval returns a balanced hierarchy:

- graph summary item
- schema item
- active fact item
- passage evidence item
- bridge/entity item when useful

- [ ] **Step 2: Implement retriever**

Export `retrieveHierarchicalMemoryContext({ query, snapshot, maxItems, budgets })`.

Use `retrieveMemoryAwareGraphContext()` for graph-local propagation, then cluster results by schema/fact/passage/entity.

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-hierarchical-memory-retriever.test.js
git add src/harness-sidecar/rag/hierarchicalMemoryRetriever.js tests/harness-hierarchical-memory-retriever.test.js
git commit -m "feat(rag): add hierarchical memory graph retrieval"
```

### Task 8: Wire Retrieval into Unified Context

**Files:**
- Modify: `src/harness-sidecar/rag/unifiedContextComposer.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-rag-memory.test.js`

- [ ] **Step 1: Write failing integration tests**

Assert that when `features.hierarchicalMemoryRetrieval=true`, task context includes `memory_graph_hierarchy` items and still honors token budgets.

- [ ] **Step 2: Implement integration**

In task startup, load the latest graph snapshot and pass hierarchical memory items into `composeUnifiedContext()`.

- [ ] **Step 3: Record adaptive-search outcome**

Feed retrieval usefulness into adaptive search when `features.adaptiveSearch=true`.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-rag-memory.test.js tests/harness-adaptive-search-skill-api.test.js
git add src/harness-sidecar/rag/unifiedContextComposer.js src/harness-sidecar/server.js tests/harness-rag-memory.test.js
git commit -m "feat(rag): wire hierarchical memory into task context"
```

---

## Chunk 4: Eval and Evolution Feedback

### Task 9: Add Memory Graph Eval Set

**Files:**
- Modify: `src/harness-sidecar/memory/memoryEvals.js`
- Create: `tests/harness-memory-graph-evals.test.js`

- [ ] **Step 1: Write failing tests**

Score graph snapshots for:

- conflict resolution quality
- active fact precision
- passage evidence coverage
- graph connectivity
- retrieval hit rate
- context budget efficiency

- [ ] **Step 2: Implement scoring**

Return a stable object:

```js
{
  score,
  dimensions: {
    conflictResolution,
    evidenceCoverage,
    retrievalHitRate,
    connectivity,
    budgetEfficiency
  },
  reasons: []
}
```

- [ ] **Step 3: Verify and commit**

Run:

```powershell
npm test -- tests/harness-memory-graph-evals.test.js
git add src/harness-sidecar/memory/memoryEvals.js tests/harness-memory-graph-evals.test.js
git commit -m "feat(memory): evaluate memory graph quality"
```

### Task 10: Feed Memory Graph Evals into RHO/BES/Adaptive Search

**Files:**
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Modify: `src/harness-sidecar/bes/adaptiveSearchAdapters.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-meta-bes-optimizer.test.js`
- Test: `tests/harness-bes-adaptive-search-scheduler.test.js`

- [ ] **Step 1: Write failing tests**

Assert memory graph eval scores can influence:

- graph extraction policy
- schema threshold
- conflict adjudication policy
- hierarchical retrieval budget

- [ ] **Step 2: Add adapter reward fields**

Extend adaptive-search context and reward normalization with memory graph dimensions.

- [ ] **Step 3: Wire runtime feedback**

After each graph runtime pass, record outcome events that BES/RHO can learn from.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-meta-bes-optimizer.test.js tests/harness-bes-adaptive-search-scheduler.test.js
git add src/harness-sidecar/meta/besMetaOptimizer.js src/harness-sidecar/bes/adaptiveSearchAdapters.js src/harness-sidecar/server.js tests/harness-meta-bes-optimizer.test.js tests/harness-bes-adaptive-search-scheduler.test.js
git commit -m "feat(meta): evolve memory graph policies"
```

---

## Chunk 5: UI Clarity and Local Redeploy

### Task 11: Show Active Workspace and Feature Flags in UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing UI tests**

Assert the harness panel includes:

- active sidecar workspace
- sidecar URL
- feature-status section
- disabled reason text for adaptive search
- refresh action

- [ ] **Step 2: Implement UI rendering**

When `harness_feature_status` arrives, render flags as compact status rows. Show `adaptiveSearch` as `enabled`, `disabled`, or `not configured`.

- [ ] **Step 3: Trigger feature refresh**

Call `harness_feature_status_get` after harness start, workspace change, and feature panel refresh.

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm test -- tests/harness-ui-discoverability.test.js
git add public/index.html public/app.js public/app.css tests/harness-ui-discoverability.test.js
git commit -m "feat(ui): show harness feature activation status"
```

### Task 12: Add Portable Harness Workspace Bootstrap

**Problem:** Switching directories is safe, but the full harness power currently depends on the active directory already having a populated `.harness` folder, config, installed bundled package, mounted capabilities, and local model/profile settings. That makes workspace swapping feel clunky because the user has to copy or recreate setup state to get adaptive search, swarm, deep research, visual artifacts, and skill mounting in a new project.

**Goal:** Let Helios Forge carry a reusable local harness profile into any selected workspace without manual copying.

**Files:**
- Modify: `src/server.js`
- Modify: `src/harness/harnessClient.js`
- Modify: `src/harness-sidecar/server.js`
- Modify: `scripts/setup-helios-forge.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `tests/setup-helios-forge.test.js`
- Test: `tests/harness-capability-api.test.js`
- Test: `tests/harness-ui-discoverability.test.js`

- [ ] **Step 1: Write failing tests for workspace bootstrap**

Assert a blank temporary workspace can be given:

- `.harness/config.yaml` with the chosen Helios local feature profile
- bundled `helios-research-harness` package under `.harness/packages`
- mounted capabilities in `.harness/runtime/capabilities.mount.json`
- no private endpoint or token written unless the user explicitly chose to copy local model settings

Run:

```powershell
npm test -- tests/setup-helios-forge.test.js tests/harness-capability-api.test.js
```

Expected: FAIL until bootstrap API exists.

- [ ] **Step 2: Add sidecar workspace bootstrap API**

Add a route such as:

```http
POST /v1/workspace/bootstrap
```

Payload:

```json
{
  "workspaceRoot": "C:\\path\\to\\project",
  "profile": "full-local",
  "copyLocalModels": false,
  "mountCapabilities": true
}
```

The implementation should call the same setup path used by `scripts/setup-helios-forge.js`, but make it safe for arbitrary workspaces.

- [ ] **Step 3: Add reusable local harness profiles**

Support at least:

- `minimal`: config only, no bundled package install
- `standard`: bundled package, skills/templates/slash commands, visual artifacts, deep research
- `full-local`: standard plus adaptive search, swarm, verifier evolution, autonomous tool loop, safe apply in advisory/gated mode

Keep private model URL/model id out of copied config unless `copyLocalModels=true`.

- [ ] **Step 4: Add main server bridge**

Add `HarnessClient.bootstrapWorkspace()` and a WebSocket command:

```js
{ type: 'harness_workspace_bootstrap', workspaceRoot, profile, copyLocalModels, mountCapabilities }
```

Return:

```js
{ type: 'harness_workspace_bootstrapped', data: result }
```

- [ ] **Step 5: Add UI action on workspace switch**

When the active sidecar workspace lacks `.harness/config.yaml` or has zero mounted capabilities, show a compact action:

- `Enable Full Harness`
- `Enable Standard Harness`
- `Config Only`

Do not force setup automatically without user confirmation. The button should explain what will be written before executing.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
npm test -- tests/setup-helios-forge.test.js tests/harness-capability-api.test.js tests/harness-ui-discoverability.test.js
git add src/server.js src/harness/harnessClient.js src/harness-sidecar/server.js scripts/setup-helios-forge.js public/index.html public/app.js public/app.css tests/setup-helios-forge.test.js tests/harness-capability-api.test.js tests/harness-ui-discoverability.test.js
git commit -m "feat(harness): bootstrap full harness into selected workspaces"
```

### Task 13: Final Smoke, Restart, and Secret Check

**Files:**
- No code unless smoke exposes a bug.

- [ ] **Step 1: Run focused suite**

```powershell
npm test -- tests/harness-feature-status-api.test.js tests/harness-memory-extraction-society.test.js tests/harness-memory-graph-runtime.test.js tests/harness-hierarchical-memory-retriever.test.js tests/harness-rag-memory.test.js tests/harness-ui-discoverability.test.js
```

- [ ] **Step 2: Run release smoke**

```powershell
npm run release:smoke
```

- [ ] **Step 3: Scan for private URLs/secrets before commit or push**

```powershell
rg --no-ignore --hidden -n -S -e "95\.133\.252\.102" -e "sk-[A-Za-z0-9]{12,}" . --glob "!.git/**" --glob "!node_modules/**" --glob "!.harness/**"
```

Expected: no tracked source/docs hits.

- [ ] **Step 4: Restart local deployment**

```powershell
$port = 3777
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($listener in $listeners) { Stop-Process -Id $listener.OwningProcess -Force }
Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command','cd C:\Users\jackj\Github\helios-forge; npm run dev'
```

- [ ] **Step 5: Verify local UI and sidecar**

Open `http://127.0.0.1:3777/`, start the harness for `C:\Users\jackj\Github\helios-forge`, and confirm:

- adaptive search reports `enabled | advisory`
- feature status shows active workspace as `C:\Users\jackj\Github\helios-forge`
- memory graph runtime is either enabled or explicitly disabled with a clear reason
- skill candidates and AB-MCTS replay load through the UI bridge

---

## Expected End State

- Adaptive search is not silently unknown; the UI can explain whether it is enabled, disabled, or pointed at the wrong workspace.
- Helios Forge has an automatic memory graph runtime, not just standalone graph-memory modules.
- The memory system more closely matches the MemGraphRAG paper's core loop: shared memory construction, conflict-aware graph refinement, memory-aware hierarchical retrieval, and eval-driven improvement.
- RHO/BES/adaptive search can optimize graph construction and retrieval policies over time.
- All new behavior stays workspace-local and behind explicit flags where it can affect runtime behavior.
