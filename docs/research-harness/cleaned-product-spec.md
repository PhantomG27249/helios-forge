# Helios Forge Product Spec

## Purpose

Helios Forge is currently a browser and Electron-ready wrapper around `pi --mode rpc`. The next product step is to make it the local control surface for a research-agent harness without turning the wrapper into the whole agent platform.

The product should feel like a research-native AlphaHelion workbench:

- Chat with Pi in the current workspace.
- Launch research harness tasks from the same UI.
- Stream sidecar task events, verifier results, approvals, patches, budgets, and artifacts.
- Keep Pi responsible for the interactive shell and human approval surface.
- Keep long-running orchestration, retrieval, swarms, budgets, and state in a sidecar service.

## Architecture Principle

Keep the wrapper thin and user-facing. Put expensive, stateful, multi-agent, and long-running systems in a sidecar.

Helios Forge wrapper responsibilities:

- Start and supervise Pi RPC.
- Start or connect to the research sidecar.
- Relay chat, task, status, approval, and artifact events over WebSocket.
- Display task status, budgets, traces, diffs, and visual artifacts.
- Send user approvals and commands back to the sidecar.

Research sidecar responsibilities:

- Task routing and lifecycle.
- Model gateway and structured output repair.
- Tool, shell, patch, verifier, MCP, browser, PDF, and visual workers.
- RAG, memory, knowledge graph, context packing, and trace storage.
- Subagents, swarms, isolated worktrees, recombination, and champion selection.
- Error recovery, budget gates, collaboration locks, and audit trails.

## Target Layers

### Layer 1: Helios Forge App

Existing files:

- `src/server.js` bridges browser WebSocket clients to `pi --mode rpc`.
- `public/app.js` renders messages, thinking blocks, tool calls, sessions, and extension UI dialogs.
- `public/index.html` defines the chat layout, connection dialog, modals, and controls.
- `public/app.css` styles the app.

New wrapper capabilities:

- `HarnessManager` process supervisor.
- `HarnessClient` API and event-stream client.
- WebSocket commands for starting tasks, approvals, status, traces, and artifacts.
- UI panels for harness status, active tasks, budgets, approvals, and artifact previews.

### Layer 2: Research Sidecar

Create a local sidecar under `src/harness-sidecar/` during MVP work. This can later split into its own package.

Core sidecar modules:

- API server and server-sent or WebSocket event stream.
- Task router and state machine.
- Model gateway abstraction.
- Scope contract and final audit report.
- Patch manager and verifier runner.
- Trace/event writer.
- Error recovery manager.
- Budget manager.
- Context pack builder.

### Layer 3: State and Intelligence Services

Add after the MVP sidecar loop is stable:

- Workspace and paper indexes.
- Memory graph and reflection gate.
- Knowledge graph and provenance store.
- VLM workers for screenshots, PDFs, figures, plots, and visual diffs.
- Swarm/worktree orchestration.
- Deep research and experiment managers.
- Collaboration locks, leases, roles, annotations, and shared-state versioning.
- Meta-harness optimizer.

## MVP Scope

The smallest useful version is not the full frontier harness. It is a working bridge from this Pi chat wrapper to a local research sidecar.

Build:

- Sidecar process supervisor in `src/server.js`.
- Sidecar health/status endpoint.
- Sidecar task start endpoint.
- Sidecar event stream.
- Browser UI for harness status and active task events.
- Approval relay for sidecar actions.
- Patch proposal artifact display.
- Trace directory output.
- Basic verifier command execution.
- Minimal `.harness/config.yaml` loader.

MVP success scenario:

1. User opens Helios Forge.
2. User selects a workspace.
3. App starts Pi RPC and the research sidecar.
4. User starts a research task from the UI or slash command.
5. Sidecar streams task events to the UI.
6. Sidecar proposes a patch with validation output.
7. UI asks the user to approve or reject.
8. Trace folder contains task metadata, events, proposed patch, verifier logs, and final audit.

## V1 Scope

Add enough infrastructure to make the harness reliable across real projects:

- AGENTS.md and `.harness` config loaders.
- Skill registry and task routing.
- Scope contract.
- Patch manager guardrails.
- Error recovery and malformed tool-call repair.
- Context profiles and context packs.
- Budget modes and budget gates.
- Basic workspace RAG over repo files.
- Reviewed memory writes.
- Visual artifact preview support in the UI.
- Worktree isolation for coding attempts.

## V2 Scope

Add research-native and multi-agent capability:

- RAG over papers, logs, experiment outputs, and prior traces.
- Knowledge graph and claim-evidence graph.
- Deep research manager with citation auditor and contradiction finder.
- Experiment manager with hypothesis, run tracking, metric comparison, and decisions.
- Swarm orchestrator with attempt scheduler, critic, recombiner, and champion selector.
- Collaboration locks, shared-state versioning, annotations, and audit trail.

## V3 Scope

Add frontier and optimization capabilities:

- Meta-harness optimizer over prompts, skills, retrieval policies, and tool policies.
- ToolTree or MCTS-style tool planning.
- Agent interoperability gateway.
- Delegated capability tokens and provenance chains.
- Research novelty guard and anti-convergence system.
- Self-evolving graph memory.

## Subagent Workstreams

### Wrapper Integration Agent

Owns the current Helios Forge integration surface.

Responsibilities:

- Add sidecar startup and health supervision.
- Add WebSocket commands for harness status, task start, task abort, approval, and artifact fetch.
- Keep Pi RPC behavior intact.
- Keep all wrapper-side sidecar code small and typed by documented message contracts.

Primary files:

- `src/server.js`
- `src/harness/harnessManager.js`
- `src/harness/harnessClient.js`
- `src/harness/harnessMessages.js`

### UI Observability Agent

Owns the browser experience for harness state.

Responsibilities:

- Add a harness status panel.
- Render active tasks, subagents, budgets, verifier state, and approvals.
- Render patch, trace, and visual artifact previews.
- Keep controls compact and consistent with the existing chat UI.

Primary files:

- `public/index.html`
- `public/app.js`
- `public/app.css`

### Sidecar Core Agent

Owns the local sidecar API and task lifecycle.

Responsibilities:

- Implement API server.
- Implement task router and state machine.
- Emit structured task events.
- Write trace files.
- Provide health, task, event, approval, artifact, and budget endpoints.

Primary files:

- `src/harness-sidecar/server.js`
- `src/harness-sidecar/api/routes.js`
- `src/harness-sidecar/core/taskRouter.js`
- `src/harness-sidecar/core/taskStateMachine.js`
- `src/harness-sidecar/core/traceWriter.js`

### Tooling and Verifier Agent

Owns safe local actions.

Responsibilities:

- Add shell broker.
- Add patch proposal and patch validation flow.
- Add verifier runner.
- Add final audit report.
- Do not let the model or sidecar apply hidden edits directly to the active workspace.

Primary files:

- `src/harness-sidecar/tools/shellBroker.js`
- `src/harness-sidecar/tools/patchManager.js`
- `src/harness-sidecar/tools/verifierRunner.js`
- `src/harness-sidecar/tools/finalValidator.js`

### Reliability Agent

Owns recovery, context pressure, and budget safety.

Responsibilities:

- Define error taxonomy.
- Repair or reject malformed tool calls.
- Detect no-progress loops.
- Track context usage and compaction events.
- Track budgets and enforce gates.

Primary files:

- `src/harness-sidecar/reliability/errorRecovery.js`
- `src/harness-sidecar/reliability/toolCallRepair.js`
- `src/harness-sidecar/reliability/loopDetector.js`
- `src/harness-sidecar/context/contextPack.js`
- `src/harness-sidecar/budget/budgetManager.js`

### Retrieval and Memory Agent

Owns repo context, project memory, and graph-ready provenance.

Responsibilities:

- Build repo file index MVP.
- Build retrieval result schema.
- Add source provenance.
- Add reviewed memory candidate records.
- Prepare interfaces for later vector and graph stores.

Primary files:

- `src/harness-sidecar/rag/workspaceIndexer.js`
- `src/harness-sidecar/rag/retriever.js`
- `src/harness-sidecar/rag/contextPackBuilder.js`
- `src/harness-sidecar/memory/memoryWriter.js`
- `src/harness-sidecar/graph/provenance.js`

### Swarm and Worktree Agent

Owns isolated multi-attempt execution.

Responsibilities:

- Create per-attempt worktrees.
- Assign scoped subagent context packs and budgets.
- Track attempt progress.
- Select champion patch.
- Merge only through explicit approval.

Primary files:

- `src/harness-sidecar/swarm/worktreeManager.js`
- `src/harness-sidecar/swarm/subagentRunner.js`
- `src/harness-sidecar/swarm/attemptScheduler.js`
- `src/harness-sidecar/swarm/championSelector.js`

### VLM Artifact Agent

Owns multimodal artifacts.

Responsibilities:

- Add screenshot, PDF render, figure crop, plot analysis, and visual diff interfaces.
- Add artifact manifests.
- Make artifact previews available to the wrapper UI.

Primary files:

- `src/harness-sidecar/vlm/screenshotTool.js`
- `src/harness-sidecar/vlm/pdfRenderer.js`
- `src/harness-sidecar/vlm/visualDiff.js`
- `src/harness-sidecar/artifacts/artifactStore.js`

### Deep Research and Experiment Agent

Owns research reports and experiment lifecycle.

Responsibilities:

- Add deep research task lifecycle.
- Add source map and claim-evidence output contracts.
- Add citation audit and contradiction records.
- Add experiment proposal, run tracking, metric comparison, and decision records.

Primary files:

- `src/harness-sidecar/research/deepResearchManager.js`
- `src/harness-sidecar/research/citationAuditor.js`
- `src/harness-sidecar/research/reportCompiler.js`
- `src/harness-sidecar/experiments/experimentManager.js`
- `src/harness-sidecar/experiments/metricComparer.js`

### Collaboration Agent

Owns multi-user safety.

Responsibilities:

- Add locks and leases.
- Add shared-state versioning.
- Add human roles and approval authority.
- Add annotations and audit log.
- Detect duplicate active tasks.

Primary files:

- `src/harness-sidecar/collaboration/locks.js`
- `src/harness-sidecar/collaboration/versionedState.js`
- `src/harness-sidecar/collaboration/roles.js`
- `src/harness-sidecar/collaboration/annotations.js`
- `src/harness-sidecar/collaboration/auditLog.js`

## Risks

### Wrapper becomes a monolith

Mitigation: wrapper only supervises sidecar, relays events, and renders UI. Sidecar owns orchestration and state.

### Sidecar becomes untestable

Mitigation: create small modules around contracts: API messages, task state, events, budgets, patch proposals, and trace records.

### Swarms corrupt the active workspace

Mitigation: all attempts run in worktrees. The active workspace changes only after champion approval.

### Budget or context runaway

Mitigation: budget manager and context manager are V1 infrastructure, not polish.

### Memory poisoning

Mitigation: memory writes are candidates until reviewed or validator-backed.

## Source Documents

This spec consolidates:

- `C:/Users/jackj/Downloads/pi_agent_research_harness_plan.md`
- `C:/Users/jackj/Downloads/research_agent_harness_plan_v6.md`
