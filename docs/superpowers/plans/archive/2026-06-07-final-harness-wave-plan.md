# Helios Forge Final Harness Wave Plan

Date: 2026-06-07

Goal: close the remaining "thin" harness areas without destabilizing the Pi wrapper. Keep the reliable current runtime intact, add production-grade foundations behind explicit APIs, and wire UI/runtime entry points after the cores are tested.

## Wave 1: Production Foundations

These tasks have disjoint ownership and can be implemented in parallel.

1. Installable Pi package core
   - Owner files: `src/harness-sidecar/capabilities/piPackageInstaller.js`, `tests/pi-package-installer.test.js`
   - Add a local `helios-package.json` installer that copies package assets into `.harness/packages/<id>/` and emits package, skill, template, slash-command, and extension capability records.
   - Must not write to `C:\Users\jackj\.pi` or the global Pi install.

2. RAG chunk provenance
   - Owner files: `src/harness-sidecar/rag/chunker.js`, `src/harness-sidecar/rag/workspaceIndexer.js`, `src/harness-sidecar/rag/retriever.js`, `src/harness-sidecar/rag/contextPackBuilder.js`, `tests/harness-rag-production.test.js`
   - Split indexed files into stable chunks with line spans, content hashes, chunk ids, and token estimates.
   - Preserve the existing lexical retrieval baseline while making retrieved context provenance-grade.

3. Model-driven swarm worker
   - Owner files: `src/harness-sidecar/swarm/modelDrivenWorker.js`, `tests/harness-swarm-model-worker.test.js`
   - Add a safe adapter from `ModelGateway` structured output to the existing swarm attempt contract.
   - Do not replace full-runtime synthetic swarm orchestration yet.

4. Trace reader and replay core
   - Owner files: `src/harness-sidecar/core/traceReader.js`, `tests/harness-trace-replay.test.js`
   - Add trace catalog, trace detail, compact summary, and cursor replay over existing `.harness/traces/<taskId>/events.jsonl`.
   - Do not wire browser UI or interrupt/resume in this slice.

## Wave 2: Runtime Wiring

1. Package APIs and UI
   - Add package list/install endpoints through sidecar, harness client, main server relay, and capabilities panel.
   - Add slash-command/template resolution for installed package commands such as `/research`.

2. Swarm runtime integration
   - Let the orchestrator opt into model-driven workers, isolated worktrees, verifier command execution, and cleanup.
   - Keep synthetic fallback for smoke tests and low-risk demos.

3. Trace API and UI
   - Expose trace list/detail/replay endpoints.
   - Add a Trace tab with event timeline, filters, compacted state, failures, decisions, artifacts, and replay controls.

4. Deep Research v2 first live loop
   - Add source fetch/read abstraction, durable run state, credibility metadata, span-level citation checks, and bibliography normalization.

## Wave 3: Production Depth

1. Production RAG
   - Add persistent incremental index, embeddings or pluggable vector provider, hybrid reranking, corpus ingestion for papers/logs, and retrieval evals.

2. VLM production path
   - Add real screenshot/PDF/crop/diff generation, OCR hooks, visual model calls, and artifact audit trail.

3. MCP runtime depth
   - Add stdio/SSE MCP lifecycle, initialize/list-tools/call-tool handling, schema validation, secret isolation, health UI, and poisoning fixtures.

4. ToolTree/MCTS
   - Add tree node schema, UCT selection, model-guided expansion, verifier-backed rollout scoring, and trace events.

## Wave 4: Harness Autonomy and Release

1. External agent interoperability
   - Add A2A/ACP-style gateway, external agent cards, routing policy, and latency/cost tracking.

2. Human interrupt/resume
   - Add task interrupt, checkpoint, steering, resume workflow, and explicit human approval boundaries.

3. Self-evolving graph memory
   - Add persisted graph snapshots, scheduled maintenance, feedback-based ranking, stale/conflict review, and eval-driven promotion.

4. Meta-harness promotion loop
   - Add persistent frontier store, candidate smoke/eval runner, approval queue, and safe apply path.

5. Collaboration and release hardening
   - Add shared operator UI for participants, locks, ownership, annotations, and conflicts.
   - Add CI, release packaging, installer docs, config migration, and Electron smoke coverage.

