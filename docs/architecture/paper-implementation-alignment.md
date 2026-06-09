# Paper Implementation Alignment

This note compares the current Helios Forge implementation against four papers that shaped the architecture:

- MemGraphRAG: Memory-based Multi-Agent System for Graph Retrieval-Augmented Generation, `https://arxiv.org/pdf/2606.00610`
- Meta-Harness: End-to-End Optimization of Model Harnesses, `https://arxiv.org/pdf/2603.28052`
- Retrospective Harness Optimization: Improving LLM Agents via Self-Preference over Trajectory Rollouts, `https://arxiv.org/pdf/2606.05922`
- Self-Improving Language Models with Bidirectional Evolutionary Search, `https://arxiv.org/pdf/2605.28814`

The purpose is to separate what Helios actually implements from what it borrows conceptually. The short version:

- Helios implements a workspace-local agent harness with sidecar orchestration, traces, RAG, graph/memory primitives, verifiers, swarms, policy evolution, approval gates, and safe apply.
- Helios implements deterministic, testable first-pass versions of the local/global memory loop, local meta-harness loop, RHO grouped replay signals, BES lane contracts, global harness experiment records, and trust-kernel boundaries.
- Helios does not yet reproduce the full paper systems end to end. The largest remaining gaps are paper-grade model-assisted graph construction, large-scale RHO diversity selection, full autonomous Meta-Harness code-space search over many runnable harness variants, complete trajectory-level BES semantics in every lane, and durable A2A peer transport.

## Status Legend

| Status | Meaning |
| --- | --- |
| Implemented | There is working code and focused test coverage for the core behavior. |
| Partial | There is a real module or runtime path, but it is simplified, scaffolded, gated, or not wired end to end. |
| Planned | The repo contains a concrete plan, but the main runtime code does not exist yet. |
| Not implemented | No meaningful implementation beyond docs or adjacent primitives. |

## Overall Architecture

Helios Forge is not a direct clone of any one paper. It combines ideas from all four into a safer local harness pattern:

1. The app wrapper stays thin and Pi-facing.
2. The sidecar owns orchestration, traces, tools, verifiers, context, memory, graph, research, swarms, and meta-evolution.
3. Runtime evidence is persisted into traces and artifacts.
4. RHO-style hard-case mining selects what to learn from.
5. BES-style goal decomposition and evolution generate candidate improvements.
6. Meta-Harness-style proposal and evaluation logic can archive candidates and promotion decisions.
7. Durable mutation stays behind approval, rollback, verifier, and workspace-scope gates.

Current implementation update:

The hierarchical swarm meta-harness pass adds the missing sidecar-local skeleton for several loops that this document previously marked as only planned:

- `memoryGraphRuntime.js`, `memoryExtractionSociety.js`, local memory graphs, SwarmCell graph merge, global memory promotion, and `hierarchicalMemoryRetriever.js`;
- `localMetaHarness.js`, local candidate archive, local evolution loop, and local promotion blocker;
- RHO replay batch runner, self-validation, self-consistency, and self-preference judge;
- BES lane contracts, trajectory operators, dense subgoal verifier, and global lineage tracker;
- harness run store, experiment runner, frontier update, and trust-kernel boundary evaluator;
- sidecar/runtime/UI event wiring for `local_meta.completed`, `local_memory.proposed`, and experiment visibility.

These modules intentionally remain deterministic and policy-gated. They close the repo-level "missing module" gaps, but they do not by themselves make Helios a full autonomous reproduction of the research systems.

The current design is more conservative than the papers. Most learned behavior is advisory, shadow-only, or approval-gated.

Primary orientation files:

- `docs/architecture/feature-architecture-map.md`
- `docs/architecture/rho-bes-evolution-expansion-roadmap.md`
- `docs/architecture/swarm-evolution-integration-plan.md`
- `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md`

## MemGraphRAG Alignment

Paper target:

MemGraphRAG addresses graph construction failures caused by isolated chunk extraction: thematic irrelevance, logical inconsistency, and structural fragmentation. It proposes a memory-based multi-agent graph construction pipeline with three memory layers: ontology/schema, facts, and passages. Candidate schemas and facts enter memory as hypotheses, stable schemas activate governed facts, conflicts are detected globally, provenance passages are retrieved for adjudication, and a global hierarchical graph is constructed with type and similarity bridges. Online retrieval then combines memory-layer retrieval with graph propagation.

Current Helios status: **Partial to strong deterministic skeleton.**

Implemented:

- Three-layer global memory primitives:
  - `src/harness-sidecar/memory/globalMemoryLayers.js`
  - `tests/harness-memgraphrag-construction.test.js`
- Schema/fact/passage separation and stable-schema activation:
  - `createGlobalMemoryLayers`
  - `upsertSchema`
  - `upsertFact`
  - `upsertPassage`
  - `activateStableSchemas`
- Conflict classification and deterministic adjudication:
  - `src/harness-sidecar/memory/memoryConflictAdjudicator.js`
  - conflict types include mutually exclusive, temporal, granularity, stale/superseded, and source-confidence conflicts
- Memory-guided graph projection and bridging:
  - `src/harness-sidecar/memory/memoryGraphConstructor.js`
  - active fact projection
  - schema, fact, entity, and passage nodes
  - type-compatible and similarity-threshold bridges
- Memory-aware graph retrieval:
  - `src/harness-sidecar/rag/memoryAwareGraphRetriever.js`
  - PPR-like propagation over the constructed memory graph
  - query-seeded scoring
  - bridge-only noise caps
- Graph snapshot persistence support:
  - `src/harness-sidecar/memory/graphMemoryMaintenance.js`
- Local/global memory hierarchy:
  - `src/harness-sidecar/memory/localMemoryGraph.js`
  - `src/harness-sidecar/memory/swarmCellMemoryGraph.js`
  - `src/harness-sidecar/memory/globalMemoryPromotion.js`
- Runtime extraction and persistence skeleton:
  - `src/harness-sidecar/memory/memoryExtractionSociety.js`
  - `src/harness-sidecar/memory/memoryGraphRuntime.js`
- Hierarchical retrieval:
  - `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`
- Focused tests:
  - `tests/harness-memgraphrag-construction.test.js`
  - `tests/harness-memory-aware-graph-retriever.test.js`
  - `tests/harness-local-global-memory-graph.test.js`
  - `tests/harness-memory-policy-evolution.test.js`

Not yet paper-complete:

- `memoryGraphRuntime.js` and `memoryExtractionSociety.js` exist, but they are deterministic first-pass runtime modules rather than a full multi-agent extraction society.
- Conflict adjudication is deterministic and policy-based. It does not yet retrieve raw provenance passages and ask a guarded resolution agent to reason over them.
- Layer persistence and graph snapshot loading exist, but production memory maintenance still needs broader migration/versioning and larger eval coverage.
- Hierarchical retrieval exists, including active facts, passages, graph summary, and bridge context, but it still needs deeper task-startup policy tuning.
- Memory graph evals are not yet implemented for conflict quality, active fact precision, evidence coverage, connectivity, retrieval hit rate, and budget efficiency.
- RHO/BES/adaptive search do not yet tune schema thresholds, conflict policies, bridge thresholds, or hierarchical retrieval budgets from memory graph evals.

Best next step:

Harden the runtime completion work in `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md`. The repo has the runtime skeleton; it now needs broader task-startup integration, eval feedback, migration/versioning coverage, and guarded model-assisted conflict adjudication.

## Meta-Harness Alignment

Paper target:

Meta-Harness searches over harness code. A coding-agent proposer reads a filesystem containing prior candidate harness source, scores, and traces, proposes new harnesses, evaluates them, logs all experience back to the filesystem, and returns a Pareto frontier. The key idea is that harness optimization needs rich access to raw prior traces and code, not just scalar scores or compressed summaries.

Current Helios status: **Partial, with strong infrastructure but no full autonomous code-space search loop.**

Implemented:

- Trace and artifact storage:
  - `src/harness-sidecar/core/traceWriter.js`
  - `src/harness-sidecar/core/traceReader.js`
  - `src/harness-sidecar/artifacts/artifactStore.js`
- Candidate archives and frontier store:
  - `src/harness-sidecar/meta/candidateArchive.js`
  - `src/harness-sidecar/meta/frontierStore.js`
- Candidate generation and candidate-run recording:
  - `src/harness-sidecar/meta/candidateGenerator.js`
  - `src/harness-sidecar/meta/candidateRunner.js`
- Promotion loop:
  - `src/harness-sidecar/meta/promotionLoop.js`
  - `tests/harness-meta-promotion-loop.test.js`
- Promotion policy with Pareto-style quality, safety, cost, and latency gates:
  - `src/harness-sidecar/meta/promotionPolicy.js`
- Change proposal and approval-gated apply:
  - `src/harness-sidecar/meta/changeProposal.js`
  - `src/harness-sidecar/core/approvalResume.js`
- Policy evolution lanes for context, compaction, tool loop, budget, visual, memory, MCP trust, and research behavior:
  - `src/harness-sidecar/meta/*PolicyEvolution.js`
- Self-authored skill candidate lifecycle:
  - `src/harness-sidecar/skills/*`
  - `tests/harness-skill-*.test.js`

Not yet paper-complete:

- No single outer-loop agent currently searches freely over full harness code variants the way Meta-Harness does.
- Candidate proposals are constrained by local modules and generated artifacts rather than full candidate harness directories with independent runnable source trees.
- The repo does not yet run a repeated evaluate-log-propose loop over dozens of complete harness candidates.
- There is no broad Pareto frontier over full harness implementations evaluated against a stable benchmark suite.
- The proposer is not yet allowed to inspect arbitrary prior candidate source and trace directories as its primary optimization interface.
- Current safe-apply policy deliberately prevents self-authorized mutation of active source code.

Best next step:

Extend the workspace-local harness experiment abstraction under `.harness/meta/harness-runs/<run-id>/` into larger benchmark sweeps. The run store exists; the next step is to run more candidates against held-out tasks, include richer source/config variants, and keep apply gated.

## RHO Alignment

Paper target:

RHO improves an agent harness from past trajectories without ground-truth labels. It selects a difficulty-diverse coreset, runs grouped rollouts on those tasks, extracts self-validation and self-consistency signals, generates candidate harness updates, and uses self-preference to keep the candidate whose rollouts are preferred over the baseline.

Current Helios status: **Partial, with deterministic grouped replay and self-preference signals.**

Implemented:

- RHO-style coreset builder:
  - `src/harness-sidecar/rho/coresetBuilder.js`
  - `tests/harness-rho-coreset.test.js`
- Hard-case categories include verifier failures, visual failures, memory/RAG failures, MemGraphRAG construction failures, swarm hard cases, compaction failures, tool-loop failures, MCP trust failures, and research-policy failures.
- Swarm outcome feedback:
  - `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`
  - `tests/harness-swarm-meta-feedback.test.js`
- Skill need mining from repeated RHO failures:
  - `src/harness-sidecar/skills/skillNeedMiner.js`
  - `tests/harness-skill-need-miner.test.js`
- Meta optimizer consumes coreset items:
  - `src/harness-sidecar/meta/besMetaOptimizer.js`
  - `tests/harness-meta-bes-optimizer.test.js`
- Trace replay and adaptive-search replay surfaces:
  - `src/harness-sidecar/core/traceReader.js`
  - `src/harness-sidecar/bes/adaptiveSearchApi.js`
- Grouped replay and self-preference evidence:
  - `src/harness-sidecar/rho/replayBatchRunner.js`
  - `src/harness-sidecar/rho/selfValidation.js`
  - `src/harness-sidecar/rho/selfConsistency.js`
  - `src/harness-sidecar/rho/selfPreferenceJudge.js`
  - `tests/harness-rho-replay-batch.test.js`

Not yet paper-complete:

- Coreset selection is not a full DPP over embedding similarity and difficulty scores.
- The grouped replay stage exists, but it is still a deterministic harness runner rather than a large-scale model-judged rollout system.
- Self-validation and self-consistency exist as structured deterministic signals, not as a general learned trajectory-ranking judge.
- Candidate harness updates are not generated as N full alternatives and re-solved across the coreset.
- Pairwise self-preference exists as evidence, but it is not the sole promotion mechanism.
- Human approval and deterministic promotion gates replace the paper's freer self-preference acceptance loop.

Best next step:

Scale the RHO replay batch runner:

- add richer difficulty and diversity metadata;
- run larger grouped attempts over held-out trace cases;
- compare baseline/candidate families, not only single candidates;
- feed self-validation, self-consistency, and self-preference into BES/meta candidate generation;
- preserve human/validator promotion gates for durable changes.

## BES Alignment

Paper target:

BES couples forward candidate evolution with backward goal decomposition. The forward side generates and edits candidate trajectories using expansion plus evolution operators such as combination, deletion, translocation, and crossover. The backward side recursively decomposes the root goal into verifiable subgoals, giving dense intermediate feedback when final verification is sparse.

Current Helios status: **Partial to strong, depending on subsystem.**

Implemented:

- Backward goal decomposition and scoring:
  - `src/harness-sidecar/bes/subgoalPlanner.js`
  - `src/harness-sidecar/bes/subgoalScorer.js`
  - `src/harness-sidecar/bes/backwardGoalTree.js`
  - `src/harness-sidecar/bes/goalSatisfactionScorer.js`
  - `tests/harness-bidirectional-bes.test.js`
- Bidirectional search loop:
  - `src/harness-sidecar/bes/bidirectionalSearchLoop.js`
- Candidate mutation and recombination:
  - `src/harness-sidecar/bes/mutationPolicy.js`
  - `src/harness-sidecar/bes/recombinationEngine.js`
- Population/island/archive-style evolution:
  - `src/harness-sidecar/bes/evolutionPopulationRunner.js`
  - `src/harness-sidecar/bes/championArchive.js`
  - `src/harness-sidecar/bes/diversityTracker.js`
  - `tests/harness-shinka-evolution.test.js`
- Evolution-aware swarm planning and budget allocation:
  - `src/harness-sidecar/swarm/evolutionSwarmPlanner.js`
  - `src/harness-sidecar/swarm/evolutionBudgetAllocator.js`
  - `tests/harness-swarm-evolution-planner.test.js`
  - `tests/harness-swarm-evolution-budget.test.js`
- AB-MCTS-style online allocation sits adjacent to BES:
  - `src/harness-sidecar/bes/adaptiveSearchScheduler.js`
  - `src/harness-sidecar/bes/adaptiveSearchAdapters.js`
  - `tests/harness-bes-adaptive-search-scheduler.test.js`
  - `tests/harness-ab-mcts-adapters.test.js`
- Lane contracts, trajectory operators, dense verification, and lineage:
  - `src/harness-sidecar/bes/laneContracts.js`
  - `src/harness-sidecar/bes/trajectoryOperators.js`
  - `src/harness-sidecar/bes/denseSubgoalVerifier.js`
  - `src/harness-sidecar/bes/globalLineageTracker.js`
  - `tests/harness-bes-lane-contracts.test.js`

Not yet paper-complete:

- Helios now has deterministic trajectory operators, but they are adapted to harness candidates, policies, skills, verifier configs, and swarm attempts rather than reproducing the full paper formalism over model trajectory sequences.
- Dense subgoal verification is mostly heuristic/deterministic by subsystem, not a general learned verifier per subgoal.
- The forward and backward searches are not yet fused into every runtime lane. Some lanes use BES metadata, some only record evidence for later.
- Post-training and model self-improvement are out of scope for this repo. Helios uses BES ideas for inference-time harness behavior and candidate generation.

Best next step:

Keep BES as a harness-level search abstraction, but make each lane declare its candidate unit and verifier unit explicitly:

- swarm attempt;
- verifier genome;
- skill candidate;
- context policy;
- memory graph policy;
- research policy;
- tool-loop policy.

That will make the adaptation honest without pretending each subsystem is a mathematical trajectory from the paper.

## A2A and Swarm Interop

A2A is not one of the four cited papers, but it matters because the MemGraphRAG paper frames graph construction as a multi-agent society.

Current Helios status: **Partial local contract, not full agent network.**

Implemented:

- A2A-shaped local envelope:
  - `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
  - `tests/harness-swarm-pi-native-worker.test.js`
- Pi-native swarm worker assignment:
  - `src/harness-sidecar/swarm/piNativeWorker.js`
- Agent cards, routing, redaction, external gateway, and delegated capability tokens:
  - `src/harness-sidecar/interop/agentCards.js`
  - `src/harness-sidecar/interop/agentRouter.js`
  - `src/harness-sidecar/interop/externalAgentGateway.js`
  - `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
  - `tests/harness-agent-interop.test.js`

Not implemented:

- persistent A2A server endpoints per agent;
- peer discovery;
- bidirectional streaming;
- durable inbox/outbox;
- message correlation, retries, cancellation, and progress protocol;
- independent subagent-to-subagent negotiation.

Implication for MemGraphRAG:

The extraction society should initially run as sidecar-local roles, not independent networked agents. Promote those roles into separate A2A agents only after the transport and durable message layer exists.

## Safety Differences From The Papers

The papers generally emphasize optimization power. Helios emphasizes local safety boundaries as much as optimization.

Implemented safety boundaries:

- workspace-local capability mounting;
- no global Pi install mutation unless explicitly requested;
- scoped shell broker;
- MCP policy and poisoning checks;
- verifier registry and runner;
- visual verifier thresholds;
- approval resume store;
- safe apply through git patches;
- human approval required for branch mutation, verifier config apply, champion apply, and risky proposals;
- auto-approval eligibility is metadata-only for most paths;
- generated skills install only into workspace-local `.harness/packages/generated-skills`.

This is why Helios should be described as "paper-inspired, safety-gated local harness evolution," not as a full autonomous reproduction of the research systems.

## Implementation Summary Matrix

| Paper | Core idea | Helios implementation | Status | Main gap |
| --- | --- | --- | --- | --- |
| MemGraphRAG | Shared three-layer memory for graph construction and memory-aware retrieval | Global memory layers, conflict adjudicator, memory graph constructor, memory-aware and hierarchical retrievers, memory graph runtime | Partial to strong skeleton | Missing paper-grade extraction society, model-assisted adjudication, large eval loop |
| Meta-Harness | Agentic code-space search over harnesses using filesystem traces and scores | Trace/artifact store, candidate archive, harness run store, experiment runner, frontier store, promotion loop, policy candidates | Partial | Missing full outer loop over many evaluated runnable harness variants |
| RHO | Retrospective hard-case coreset, group rollout, self-validation, self-consistency, self-preference | Coreset builder, hard-case mining, replay batch runner, self-validation, self-consistency, self-preference, swarm outcome feedback | Partial | Missing DPP embeddings, large grouped rerolls, promotion driven primarily by pairwise preference |
| BES | Forward evolutionary candidate search plus backward goal decomposition | Subgoal planning/scoring, bidirectional loop, mutation/recombination, population archive, lane contracts, trajectory operators, dense verifier, lineage | Partial to strong | Missing full paper trajectory formalism and fully fused forward/backward search in all lanes |

## Recommended Execution Order

1. Harden MemGraphRAG runtime completion.
   - Expand `memoryExtractionSociety.js` beyond deterministic extraction.
   - Add guarded model conflict adjudication.
   - Broaden hierarchical memory retriever task-startup integration and evals.
   - Add migration/versioning coverage for persisted global layers.

2. Scale the RHO replay batch runner.
   - Select hard cases with richer difficulty and diversity metadata.
   - Run larger grouped attempts across held-out traces.
   - Feed self-validation, self-consistency, and self-preference records into candidate generation.

3. Scale Meta-Harness-style experiment directories.
   - Use the existing run folders for repeated benchmark sweeps.
   - Store richer candidate source patches, configs, traces, metrics, and promotion decisions.
   - Keep active workspace apply gated.

4. Deepen BES lane contracts.
   - Exercise candidate unit, mutation operators, verifier, archive, and promotion rule in every runtime lane.

5. Promote A2A from local envelope to durable transport only after the sidecar-local extraction society works.

## Bottom Line

Helios Forge already has more than surface-level inspiration from the papers. The repo contains real modules for traces, candidate archives, coreset mining, subgoal scoring, population evolution, memory graph construction, skill evolution, verifier evolution, adaptive search, and approval-gated apply.

The honest distinction is this:

- Helios has implemented many **paper-shaped primitives**.
- Helios has partially implemented several **paper-shaped loops**.
- Helios has not yet implemented the full **paper-grade experimental systems** end to end.

That is a healthy place to be. The architecture is broad but testable, and the remaining work is mostly about wiring the existing primitives into runtime loops with eval feedback and clear feature status instead of adding yet another isolated clever subsystem.
