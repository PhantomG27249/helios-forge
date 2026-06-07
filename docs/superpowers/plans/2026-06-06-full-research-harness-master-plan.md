# Helios Forge Full Harness Subagent Master Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking. This is the master plan for the full product; use smaller slice plans for daily execution.

**Goal:** Build Helios Forge as a production-grade AlphaHelion research harness with sidecar orchestration, verifier-driven coding, RAG, graph memory, BES-style swarms, deep research, experiments, VLM tools, collaboration, and meta-harness optimization.

**Architecture:** Helios Forge remains the human-facing Pi RPC and harness control surface. The sidecar owns all long-running, stateful, multi-agent, budgeted, and auditable workflows. Full capability is delivered through staged vertical slices, with each slice preserving traceability, approvals, and verifier evidence.

**Tech Stack:** Node.js ESM, WebSocket, local HTTP/event sidecar, file-backed traces for MVP, later pluggable vector/graph stores, git worktrees, typed JSON message contracts, shell/verifier brokers, artifact manifests, and Pi RPC integration.

---

## Product-Level Invariants

- Helios Forge wrapper stays thin: process supervision, event relay, UI, approvals, previews.
- Sidecar owns orchestration, state, tools, memory, retrieval, budgets, and agents.
- No hidden edits. Patches are artifacts until approved.
- No success claim without verifier evidence.
- Every long-running task has a task id, event stream, trace directory, budget, and final audit.
- Every subagent has scoped context, scoped tools, scoped budget, and explicit output contract.
- Every memory write is evidence-backed and reviewed or quarantined.
- Every external or risky action has a permission and approval gate.
- Swarms use isolated worktrees whenever the workspace is a git repo.
- Full product can degrade gracefully when a capability is unavailable.

## Global Repository Layout

```text
src/
  harness/
    harnessManager.js
    harnessClient.js
    harnessMessages.js
  harness-sidecar/
    server.js
    api/
    core/
    model/
    tools/
    reliability/
    budget/
    context/
    rag/
    graph/
    memory/
    swarm/
    bes/
    vlm/
    research/
    experiments/
    collaboration/
    security/
    evals/
    meta/
    artifacts/
    config/
public/
  index.html
  app.js
  app.css
docs/
  research-harness/
  superpowers/plans/
```

## Agent Roster

### 1. Wrapper Integration Agent

Owns app-to-sidecar integration.

Files:

- `src/server.js`
- `src/harness/harnessManager.js`
- `src/harness/harnessClient.js`
- `src/harness/harnessMessages.js`

Contracts:

- Starts/stops/restarts sidecar.
- Relays sidecar events to browser clients.
- Relays approvals and task commands to sidecar.
- Does not implement orchestrator logic.

### 2. UI Observability Agent

Owns harness UX in the browser.

Files:

- `public/index.html`
- `public/app.js`
- `public/app.css`

Contracts:

- Shows sidecar health, active tasks, budgets, subagents, approvals, artifacts, and traces.
- Renders patch, text, JSON, image, PDF page, screenshot, and visual diff artifacts.
- Keeps chat usable during long tasks.

### 3. Sidecar Core Agent

Owns API, task lifecycle, events, and trace foundations.

Files:

- `src/harness-sidecar/server.js`
- `src/harness-sidecar/api/routes.js`
- `src/harness-sidecar/core/taskRouter.js`
- `src/harness-sidecar/core/taskStateMachine.js`
- `src/harness-sidecar/core/scopeContract.js`
- `src/harness-sidecar/core/traceWriter.js`
- `src/harness-sidecar/core/finalAudit.js`

Contracts:

- Every task emits structured events.
- Every task writes a trace.
- Every task can stop, pause, resume, or fail with audit output.

### 4. Model Gateway Agent

Owns model calls and structured model outputs.

Files:

- `src/harness-sidecar/model/modelGateway.js`
- `src/harness-sidecar/model/modelProfiles.js`
- `src/harness-sidecar/model/structuredOutputRepair.js`
- `src/harness-sidecar/model/multimodalRequestBuilder.js`
- `src/harness-sidecar/model/toolCallParser.js`

Contracts:

- All model calls pass through model gateway.
- Tool calls are schema-validated and repairable.
- Token accounting emits budget events.
- Vision inputs are routed through multimodal request builder.

### 5. Tooling and Verifier Agent

Owns local tools and validation loops.

Files:

- `src/harness-sidecar/tools/shellBroker.js`
- `src/harness-sidecar/tools/patchManager.js`
- `src/harness-sidecar/tools/verifierRunner.js`
- `src/harness-sidecar/tools/browserRunner.js`
- `src/harness-sidecar/tools/notebookRunner.js`
- `src/harness-sidecar/tools/finalValidator.js`
- `src/harness-sidecar/tools/toolRegistry.js`

Contracts:

- Shell calls are logged, timed, scoped, and budgeted.
- Patch proposals are diff artifacts, not silent writes.
- Verifiers emit evidence events.
- Browser/notebook runners write artifacts and logs.

### 6. MCP and Security Agent

Owns external tool brokering and security policy.

Files:

- `src/harness-sidecar/security/permissionPolicy.js`
- `src/harness-sidecar/security/approvalGates.js`
- `src/harness-sidecar/security/promptInjectionFilter.js`
- `src/harness-sidecar/security/capabilityTokens.js`
- `src/harness-sidecar/tools/mcpBroker.js`
- `src/harness-sidecar/tools/mcpRegistry.js`

Contracts:

- Models never call raw MCP servers directly.
- Tool permissions are allowlisted by project config and permission mode.
- Risky actions require human approval.
- MCP output is marked with trust/provenance.

### 7. Reliability Agent

Owns failure taxonomy, recovery, and degraded modes.

Files:

- `src/harness-sidecar/reliability/errorTypes.js`
- `src/harness-sidecar/reliability/errorRecovery.js`
- `src/harness-sidecar/reliability/toolCallRepair.js`
- `src/harness-sidecar/reliability/retryPolicy.js`
- `src/harness-sidecar/reliability/loopDetector.js`
- `src/harness-sidecar/reliability/sandboxRecovery.js`
- `src/harness-sidecar/reliability/degradedModes.js`

Contracts:

- Malformed tool calls are repaired or rejected safely.
- Unknown tools trigger replan.
- Repeated failures trigger recovery events.
- Sandbox crashes preserve logs and resume from safe checkpoint.

### 8. Budget and Context Agent

Owns budget hierarchy, cost gates, and context packs.

Files:

- `src/harness-sidecar/budget/budgetManager.js`
- `src/harness-sidecar/budget/accounting.js`
- `src/harness-sidecar/budget/gates.js`
- `src/harness-sidecar/context/contextProfiles.js`
- `src/harness-sidecar/context/contextPack.js`
- `src/harness-sidecar/context/contextComposer.js`
- `src/harness-sidecar/context/compaction.js`
- `src/harness-sidecar/context/decisionLedger.js`
- `src/harness-sidecar/context/workingMemory.js`

Contracts:

- Every model/tool call updates budget state.
- Budget gates stop, downshift, or ask for approval.
- Context packs preserve P0 instructions and active verifier errors.
- Long logs are summarized with links to raw artifacts.

### 9. RAG Agent

Owns ingestion, indexing, retrieval, and source tracking.

Files:

- `src/harness-sidecar/rag/workspaceIndexer.js`
- `src/harness-sidecar/rag/documentIngestion.js`
- `src/harness-sidecar/rag/chunker.js`
- `src/harness-sidecar/rag/retriever.js`
- `src/harness-sidecar/rag/reranker.js`
- `src/harness-sidecar/rag/contextPackBuilder.js`
- `src/harness-sidecar/rag/sourceTracker.js`
- `src/harness-sidecar/rag/retrievalEval.js`

Contracts:

- Retrieval returns structured, source-tracked context items.
- Indexers exclude generated/vendor/runtime paths by default.
- Context is selected by evidence value per token.
- Retrieval quality has regression tests.

### 10. Knowledge Graph Agent

Owns project graph, code graph, experiment graph, and claim-evidence graph.

Files:

- `src/harness-sidecar/graph/graphStore.js`
- `src/harness-sidecar/graph/entityExtractor.js`
- `src/harness-sidecar/graph/codeGraph.js`
- `src/harness-sidecar/graph/experimentGraph.js`
- `src/harness-sidecar/graph/claimEvidenceGraph.js`
- `src/harness-sidecar/graph/visualGraph.js`
- `src/harness-sidecar/graph/graphQuery.js`
- `src/harness-sidecar/graph/provenance.js`

Contracts:

- Every graph edge has source provenance.
- Claim nodes link to evidence nodes.
- Code graph links files, symbols, tests, and failures.
- Experiment graph links hypotheses, configs, runs, metrics, decisions.

### 11. Memory Agent

Owns episodic, semantic, procedural, and failure memory.

Files:

- `src/harness-sidecar/memory/memoryWriter.js`
- `src/harness-sidecar/memory/reflectionGate.js`
- `src/harness-sidecar/memory/memoryGraph.js`
- `src/harness-sidecar/memory/deadEnds.js`
- `src/harness-sidecar/memory/solvedSubgoals.js`
- `src/harness-sidecar/memory/reusableFixes.js`
- `src/harness-sidecar/memory/memoryConflictResolver.js`
- `src/harness-sidecar/memory/memoryEvals.js`

Contracts:

- Memory writes are candidates unless validator-backed and approved by policy.
- Dead ends are first-class.
- Contradictory memory creates conflict records.
- Stale memory is superseded, not deleted.

### 12. Swarm Runtime Agent

Owns subagent execution, isolated worktrees, and role teams.

Files:

- `src/harness-sidecar/swarm/worktreeManager.js`
- `src/harness-sidecar/swarm/subagentRunner.js`
- `src/harness-sidecar/swarm/rolePrompts.js`
- `src/harness-sidecar/swarm/attemptScheduler.js`
- `src/harness-sidecar/swarm/swarmOrchestrator.js`
- `src/harness-sidecar/swarm/championSelector.js`
- `src/harness-sidecar/swarm/reviewer.js`
- `src/harness-sidecar/swarm/recombiner.js`

Contracts:

- Subagents get scoped context packs and budgets.
- Editing attempts use isolated worktrees.
- Champion patch is selected by verifier evidence and patch risk.
- Main workspace changes only after approval.

### 13. BES and Search Agent

Owns Backward Evolutionary Search style decomposition, recombination, and scoring.

Files:

- `src/harness-sidecar/bes/subgoalPlanner.js`
- `src/harness-sidecar/bes/subgoalScorer.js`
- `src/harness-sidecar/bes/attemptGenome.js`
- `src/harness-sidecar/bes/strategySeeder.js`
- `src/harness-sidecar/bes/recombinationEngine.js`
- `src/harness-sidecar/bes/mutationPolicy.js`
- `src/harness-sidecar/bes/diversityTracker.js`
- `src/harness-sidecar/bes/championArchive.js`

Contracts:

- Nontrivial tasks produce checkable subgoals.
- Attempt strategies are diverse and budget-aware.
- Recombination uses evidence from partial successes.
- Search terminates on budget, no-progress, or final validator pass.

### 14. VLM Artifact Agent

Owns multimodal perception and visual artifacts.

Files:

- `src/harness-sidecar/vlm/screenshotTool.js`
- `src/harness-sidecar/vlm/pdfRenderer.js`
- `src/harness-sidecar/vlm/figureCropper.js`
- `src/harness-sidecar/vlm/plotAnalyzer.js`
- `src/harness-sidecar/vlm/visualDiff.js`
- `src/harness-sidecar/vlm/visualContextPolicy.js`
- `src/harness-sidecar/vlm/diagramInterpreter.js`
- `src/harness-sidecar/artifacts/artifactStore.js`

Contracts:

- Visual tools produce artifact manifests.
- Visual context is included only when needed.
- UI can preview visual artifacts.
- Visual checks emit verifier-like evidence.

### 15. Deep Research Agent

Owns literature, source, citation, and report workflows.

Files:

- `src/harness-sidecar/research/deepResearchManager.js`
- `src/harness-sidecar/research/researchBrief.js`
- `src/harness-sidecar/research/sourceDiscovery.js`
- `src/harness-sidecar/research/sourceIngestion.js`
- `src/harness-sidecar/research/citationAuditor.js`
- `src/harness-sidecar/research/contradictionFinder.js`
- `src/harness-sidecar/research/reportCompiler.js`
- `src/harness-sidecar/research/implementationHandoff.js`

Contracts:

- Reports include source map, claim-evidence table, contradictions, and implementation handoff.
- Citations align to claims.
- Uncertainty and contradictions are explicit.
- External search is permissioned and budgeted.

### 16. Experiment Agent

Owns experiment lifecycle and metric analysis.

Files:

- `src/harness-sidecar/experiments/experimentManager.js`
- `src/harness-sidecar/experiments/experimentQueue.js`
- `src/harness-sidecar/experiments/runTracker.js`
- `src/harness-sidecar/experiments/metricComparer.js`
- `src/harness-sidecar/experiments/noiseGate.js`
- `src/harness-sidecar/experiments/decisionWriter.js`
- `src/harness-sidecar/experiments/experimentReports.js`

Contracts:

- Experiments start with hypotheses.
- Expensive runs require budget and human approval.
- Decisions link to runs, metrics, baselines, and noise analysis.

### 17. Collaboration Agent

Owns multi-user concurrency and shared state.

Files:

- `src/harness-sidecar/collaboration/locks.js`
- `src/harness-sidecar/collaboration/workspaceLeases.js`
- `src/harness-sidecar/collaboration/versionedState.js`
- `src/harness-sidecar/collaboration/conflictResolver.js`
- `src/harness-sidecar/collaboration/roles.js`
- `src/harness-sidecar/collaboration/taskClaims.js`
- `src/harness-sidecar/collaboration/annotations.js`
- `src/harness-sidecar/collaboration/auditLog.js`

Contracts:

- Shared changes are versioned.
- Locks protect risky resources.
- Duplicate tasks are detected.
- Audit records identify actor, target, operation, reason, and task.

### 18. Eval and Benchmark Agent

Owns harness regression tests and reliability evals.

Files:

- `src/harness-sidecar/evals/reliabilityEval.js`
- `src/harness-sidecar/evals/toolPoisoningEval.js`
- `src/harness-sidecar/evals/retrievalEval.js`
- `src/harness-sidecar/evals/swarmEval.js`
- `src/harness-sidecar/evals/memoryEval.js`
- `src/harness-sidecar/evals/metaHarnessEval.js`

Contracts:

- Every major capability has deterministic smoke evals.
- Tool poisoning and prompt injection fixtures exist.
- Meta-harness candidates run smoke eval before broader eval.

### 19. Meta-Harness Agent

Owns self-improvement loops for prompts, skills, retrieval, tools, and policies.

Files:

- `src/harness-sidecar/meta/harnessOptimizer.js`
- `src/harness-sidecar/meta/traceInspector.js`
- `src/harness-sidecar/meta/candidateGenerator.js`
- `src/harness-sidecar/meta/candidateRunner.js`
- `src/harness-sidecar/meta/paretoTracker.js`
- `src/harness-sidecar/meta/promotionPolicy.js`
- `src/harness-sidecar/meta/changeProposal.js`

Contracts:

- Optimizer proposes changes; it does not silently apply them.
- Candidates run static validation and smoke eval first.
- Promotion is Pareto-aware across quality, cost, latency, and safety.
- Full eval requires approval.

## Phase Roadmap

## Chunk 1: Foundation MVP

Goal: a running sidecar that the wrapper can start, observe, and command.

- [ ] Harness process supervisor.
- [ ] Sidecar health endpoint.
- [ ] Event stream.
- [ ] Task start endpoint.
- [ ] Deterministic toy task.
- [ ] Trace writer.
- [ ] Wrapper WebSocket relay.
- [ ] Browser status panel.
- [ ] Approval modal.
- [ ] Patch artifact preview.

Acceptance:

- `npm run dev` starts the chat app.
- Sidecar can start independently.
- A task streams events into the UI.
- Trace files are written.
- Patch and approval events render.

## Chunk 2: Tooling and Verifier Loop

Goal: the sidecar can run safe local verifier workflows and produce evidence.

- [ ] Shell broker.
- [ ] Verifier runner.
- [ ] Patch manager.
- [ ] Scope contract.
- [ ] Final validator.
- [ ] Final audit report.
- [ ] Config loader for `.harness/config.yaml`.

Acceptance:

- A toy failing task runs verifier, proposes patch, asks approval, and writes audit.
- Hidden edits are impossible in MVP path.

## Chunk 3: Reliability, Budget, and Context Foundation

Goal: basic platform safety before adding swarms.

- [ ] Error taxonomy.
- [ ] Malformed tool-call repair.
- [ ] Unknown tool handling.
- [ ] Retry/timeout policies.
- [ ] No-progress loop detector.
- [ ] Budget hierarchy and gates.
- [ ] Context profiles.
- [ ] Context pack schema.
- [ ] Decision ledger and working memory.

Acceptance:

- Repeated failures emit recovery events.
- Budget gates produce warnings, approvals, and hard stops.
- Context packs keep P0 items and active verifier errors.

## Chunk 4: Security and MCP Broker

Goal: external tools are safe, auditable, and permissioned.

- [ ] Tool registry.
- [ ] Permission modes.
- [ ] Human approval gates.
- [ ] MCP registry.
- [ ] MCP broker.
- [ ] Prompt-injection filter.
- [ ] Capability token skeleton.
- [ ] Tool poisoning eval fixtures.

Acceptance:

- Raw MCP is never exposed directly to model planner.
- Risky tools request approval.
- Poisoned tool output is marked and filtered.

## Chunk 5: Workspace RAG

Goal: project-aware retrieval for code, docs, traces, and logs.

- [ ] Workspace indexer.
- [ ] Chunker.
- [ ] Keyword retriever.
- [ ] Hybrid retriever interface.
- [ ] Reranker interface.
- [ ] Source tracker.
- [ ] Context pack builder.
- [ ] Retrieval evals.

Acceptance:

- Task context includes relevant files with source reasons.
- Runtime excludes generated/vendor/runtime paths.
- Retrieval quality is regression-tested.

## Chunk 6: Memory Graph MVP

Goal: durable project memory with quality gates.

- [ ] Memory candidate schema.
- [ ] Reflection gate.
- [ ] Dead-end registry.
- [ ] Solved subgoals.
- [ ] Reusable fixes.
- [ ] Memory graph store interface.
- [ ] Memory conflict records.
- [ ] Memory evals.

Acceptance:

- Repeated dead ends become candidate memory.
- Contradictions are quarantined as conflicts.
- Memory writes are trace-linked.

## Chunk 7: Knowledge Graph and GraphRAG

Goal: graph-backed reasoning over code, experiments, claims, and artifacts.

- [ ] Graph store.
- [ ] Entity extractor.
- [ ] Code graph.
- [ ] Claim-evidence graph.
- [ ] Experiment graph.
- [ ] Visual graph.
- [ ] Graph query API.
- [ ] GraphRAG context composer.

Acceptance:

- Graph query can answer "which test validates this file?" and "which runs support this claim?"
- Every answer includes provenance.

## Chunk 8: Swarm Runtime

Goal: safe multi-agent attempts.

- [ ] Worktree manager.
- [ ] Subagent runner.
- [ ] Role prompt registry.
- [ ] Attempt scheduler.
- [ ] Reviewer agent.
- [ ] Recombiner shell.
- [ ] Champion selector.
- [ ] Swarm UI events.

Acceptance:

- Four isolated attempts can run against a toy task.
- Champion patch selected by verifier evidence.
- Main workspace changes only after approval.

## Chunk 9: BES Search Layer

Goal: BES-style planning, scoring, recombination, and diversity.

- [ ] Backward subgoal planner.
- [ ] Subgoal verifier contracts.
- [ ] Attempt genome.
- [ ] Strategy seeder.
- [ ] Subgoal scorer.
- [ ] Recombination engine.
- [ ] Mutation policy.
- [ ] Diversity tracker.
- [ ] Champion archive.

Acceptance:

- Nontrivial task decomposes into checkable subgoals.
- Attempts score partial progress.
- Recombination produces child attempts from partial successes.
- Search stops when budget/no-progress/final validator triggers.

## Chunk 10: VLM Native Artifacts

Goal: screenshots, PDFs, plots, figures, and visual diffs are native artifacts.

- [ ] Screenshot tool.
- [ ] PDF renderer.
- [ ] Figure cropper.
- [ ] Plot analyzer interface.
- [ ] Visual diff engine.
- [ ] Visual context policy.
- [ ] Diagram interpreter interface.
- [ ] UI visual artifact preview.

Acceptance:

- Sidecar can produce and preview visual artifacts.
- Visual artifacts can enter context packs with token budget accounting.

## Chunk 11: Deep Research Mode

Goal: source-grounded research reports and implementation handoff.

- [ ] Research brief generator.
- [ ] Source discovery.
- [ ] Source ingestion.
- [ ] Claim-evidence extraction.
- [ ] Citation auditor.
- [ ] Contradiction finder.
- [ ] Report compiler.
- [ ] Implementation handoff.

Acceptance:

- Research task produces source map, evidence table, contradictions, and implementation plan.
- Citation claims are auditable.

## Chunk 12: Experiment Manager

Goal: hypothesis-to-decision experiment lifecycle.

- [ ] Experiment proposal.
- [ ] Experiment queue.
- [ ] Run tracker.
- [ ] Metric comparer.
- [ ] Noise gate.
- [ ] Decision writer.
- [ ] Experiment graph integration.
- [ ] Experiment UI events.

Acceptance:

- Experiment proposal requires approval before expensive command.
- Experiment decision links hypothesis, runs, metrics, artifacts, and conclusion.

## Chunk 13: Collaboration and Concurrency

Goal: multiple humans and agents can share project state safely.

- [ ] Roles and permissions.
- [ ] Locks and leases.
- [ ] Shared state versioning.
- [ ] Task claiming.
- [ ] Duplicate task detection.
- [ ] Conflict resolver.
- [ ] Collaborative annotations.
- [ ] Audit log.

Acceptance:

- Conflicting updates are rejected or merged explicitly.
- Every shared mutation has audit provenance.

## Chunk 14: Meta-Harness Optimizer

Goal: the harness can propose and evaluate improvements to itself.

- [ ] Trace inspector.
- [ ] Failure-mode classifier.
- [ ] Candidate generator.
- [ ] Candidate runner.
- [ ] Smoke eval policy.
- [ ] Pareto tracker.
- [ ] Promotion policy.
- [ ] Approval flow for accepted changes.

Acceptance:

- Optimizer proposes a prompt/retrieval/tool-policy change from traces.
- Candidate runs smoke eval.
- Promotion requires Pareto improvement and approval.

## Chunk 15: Production Hardening

Goal: full product can survive realistic usage.

- [ ] Persistence migration strategy.
- [ ] Recovery from sidecar crash.
- [ ] Resume interrupted tasks.
- [ ] Trace compaction.
- [ ] Dashboard alerts.
- [ ] Reliability eval suite.
- [ ] Security eval suite.
- [ ] Documentation and operator guide.

Acceptance:

- Restarting sidecar preserves task traces.
- Interrupted tasks resume or fail with audit.
- Evals cover recovery, budget, context, MCP poisoning, collaboration conflicts, memory quality, retrieval quality, and swarm behavior.

## Commit Policy

- Commit after each verified vertical slice.
- Commit message format:

```text
feat(harness): add sidecar health and task events
test(harness): cover verifier runner
docs(harness): add BES and meta-harness plan
```

- Never commit failing tests unless the commit is explicitly a red-state checkpoint and immediately followed by the green implementation commit.
- Before every commit, run the narrowest relevant verification command.
- Before reporting completion of a chunk, run the chunk-level verification command and `git status --short`.

## Execution Order

1. Commit this master plan.
2. Implement Chunk 1 from `docs/superpowers/plans/2026-06-06-pi-research-harness-subagent-plans.md`.
3. Split each later chunk into a fresh daily execution plan when starting it.
4. Use subagents for disjoint file sets only.
5. Keep mainline always runnable after each commit.

