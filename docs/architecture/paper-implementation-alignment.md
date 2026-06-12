# Paper Implementation Alignment

This note compares the current Helios Forge implementation against four papers that shaped the architecture:

- MemGraphRAG: Memory-based Multi-Agent System for Graph Retrieval-Augmented Generation, `https://arxiv.org/pdf/2606.00610`
- Meta-Harness: End-to-End Optimization of Model Harnesses, `https://arxiv.org/pdf/2603.28052`
- Retrospective Harness Optimization: Improving LLM Agents via Self-Preference over Trajectory Rollouts, `https://arxiv.org/pdf/2606.05922`
- Self-Improving Language Models with Bidirectional Evolutionary Search, `https://arxiv.org/pdf/2605.28814`

The purpose is to separate what Helios actually implements from what it borrows conceptually. The short version:

- Helios implements a workspace-local agent harness with sidecar orchestration, traces, RAG, graph/memory primitives, verifiers, swarms, policy evolution, approval gates, and safe apply.
- Helios implements deterministic, testable versions of the local/global memory loop, local meta-harness loop, RHO grouped replay signals, BES lane contracts, global harness experiment records, trust-kernel boundaries, policy evolvers, skill evolution, adaptive search, capability-goal status, and durable local A2A interop.
- Helios does not yet reproduce the full paper systems end to end. The largest remaining gaps are production model-assisted graph construction, production-scale replay over large held-out suites, autonomous Meta-Harness code-space search over many executable harness variants, learned trajectory-level BES judgment in every live lane, production dashboards over longitudinal frontier history, and external long-lived A2A peer transport.

## Status Legend

| Status | Meaning |
| --- | --- |
| Implemented | There is working code and focused test coverage for the core behavior. |
| Partial | There is a real module or runtime path, but it is simplified, scaffolded, gated, or not wired end to end. |
| Planned | The repo contains a concrete plan, but the main runtime code does not exist yet. |
| Not implemented | No meaningful implementation beyond docs or adjacent primitives. |

Capability-goal maturity is tracked separately from this coverage status:

| Maturity | Meaning |
| --- | --- |
| Implemented substrate | Deterministic local capability is present and test-covered. |
| Production-gated capability | A real lane exists, but feature gates, model-backed providers, external transport, dashboards, or repeated production cycles remain required. |
| Production evidence available | Persisted replay/report evidence and operator/frontier dashboard snapshots are available for the lane. |
| Still-future paper-grade autonomy | The paper-grade autonomous loop remains unproven and must not be described as production autonomous or proven Level 4. |

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

As of June 10, 2026, the recursive meta-harness capability spine adds deterministic, policy-gated implementations for several loops that this document previously marked as only planned or early-stage:

- `memoryGraphRuntime.js`, `memoryExtractionSociety.js`, local memory graphs, SwarmCell graph merge, global memory promotion, and `hierarchicalMemoryRetriever.js`;
- `localMetaHarness.js`, local candidate archive, local evolution loop, and local promotion blocker;
- RHO replay batch runner, embedding-aware coreset selection, self-validation, self-consistency, self-preference judge, grouped candidate-family summaries, and promotion/blocking evidence;
- BES lane contracts, trajectory operators, dense verifier contracts, forward/backward fusion metadata, champion/frontier evidence hooks, and global lineage tracking;
- harness run store, experiment runner, frontier update, isolated variant workspaces, proposer context, trace/metric/source/config artifact materialization, and trust-kernel boundary evaluator;
- longitudinal benchmark frontier history, repeated cycle classification, budget/accounting rows, and governance summaries;
- sidecar/runtime/UI event wiring for `local_meta.completed`, `local_memory.proposed`, BES lane status, experiment visibility, and capability-goal status rows;
- recursive soul evolution levels that preserve evidence-only lineage across subagent souls, subagent societies, SwarmCells, swarms, oversoul, local/global harness, and meta-harness without claiming nested execution;
- A2A interop modules, agent routing, external gateway scaffolding, endpoint registry, JSON durable store, restart-persistent stream state, negotiation envelopes, scoped delegated capability tokens, and symlink-safe/root-constrained persistence.

These modules intentionally remain deterministic and policy-gated. They close the repo-level "missing module" gaps, but they do not by themselves make Helios a full autonomous reproduction of the research systems.

The current design is more conservative than the papers. Most learned behavior is advisory, shadow-only, or approval-gated.

Primary orientation files:

- `docs/architecture/feature-architecture-map.md`
- `docs/architecture/rho-bes-evolution-expansion-roadmap.md`
- `docs/architecture/swarm-evolution-integration-plan.md`
- `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md`
- `docs/superpowers/plans/2026-06-09-hierarchical-swarm-meta-harness-implementation.md`
- `docs/superpowers/plans/2026-06-09-bes-lane-expansion-for-harness-layers.md`

## Current Codebase Snapshot

The current codebase has moved from "paper-shaped notes" into a broad deterministic harness substrate. The main implemented clusters are:

| Cluster | Current code anchors | Status |
| --- | --- | --- |
| Swarm and SwarmCell loop | `src/harness-sidecar/swarm/swarmCellContracts.js`, `swarmCellRuntime.js`, `swarmOrchestrator.js`, `evolutionSwarmPlanner.js`, `evolutionBudgetAllocator.js` | Implemented deterministic loop with local proposal contracts. |
| Local meta-harness | `src/harness-sidecar/meta/localMetaHarness.js`, `localEvolutionLoop.js`, `localCandidateArchive.js`, `localPromotionBlocker.js` | Implemented local evidence/proposal loop; no durable apply authority. |
| Global meta-harness experiments | `src/harness-sidecar/meta/harnessRunStore.js`, `harnessExperimentRunner.js`, `harnessFrontier.js`, `harnessVariantWorkspace.js`, `longitudinalFrontier.js`, `promotionLoop.js`, `promotionPolicy.js` | Implemented run records, isolated executable variant workspaces, source/config/trace/metric artifacts, proposer context, repeated variant cycles, and longitudinal frontier evidence; not full autonomous code-space search. |
| Memory Graph RAG | `src/harness-sidecar/memory/*`, `src/harness-sidecar/rag/memoryAwareGraphRetriever.js`, `hierarchicalMemoryRetriever.js` | Strong deterministic skeleton with full advisory extraction society role outputs, guarded extraction/adjudication hooks, provenance support, eval hooks, migrations, decay, consolidation, and conflict evidence coverage; not yet production model-assisted graph society. |
| RHO replay | `src/harness-sidecar/rho/coresetBuilder.js`, `replayBatchRunner.js`, `selfValidation.js`, `selfConsistency.js`, `selfPreferenceJudge.js` | Implemented structured replay evidence with deterministic embedding-aware DPP-like selection, held-out variant grouping, aggregate candidate-family promotion/blocking evidence, and stronger advisory validation/consistency/preference signals; not large-scale learned self-preference optimization. |
| BES/evolution | `src/harness-sidecar/bes/*`, `src/harness-sidecar/meta/besMetaOptimizer.js`, `verifierEvolutionLoop.js`, `verifierGenome.js` | Strong primitives plus shared lane runtime, forward/backward fusion metadata, lane-specific verifier contracts, trajectory provenance, compatible-family descriptors, and champion-to-frontier evidence bridge; paper-grade learned trajectory semantics remain partial. |
| Policy evolution | `src/harness-sidecar/meta/contextPolicyEvolution.js`, `compactionPolicyEvolution.js`, `toolLoopPolicyEvolution.js`, `budgetPolicyEvolution.js`, `visualPolicyEvolution.js`, `memoryPolicyEvolution.js`, `mcpTrustEvolution.js`, `researchPolicyEvolution.js` | Implemented shadow-policy generators/evaluators with BES lane wrappers. |
| Skill evolution | `src/harness-sidecar/skills/skillNeedMiner.js`, `skillEvolution.js`, `skillEvolutionScheduler.js`, `skillCandidateStore.js`, `skillCandidateEvaluator.js`, `skillCandidateApply.js` | Implemented workspace-local skill candidate lifecycle. |
| Soul and oversoul identity layer | `src/harness-sidecar/souls/*`, `src/harness-sidecar/swarm/rolePrompts.js`, `swarmCellContracts.js`, `swarmOrchestrator.js`, `src/harness-sidecar/bes/laneRuntime.js`, `src/harness-sidecar/meta/promotionPolicy.js` | Implemented first runtime layer for durable agent/swarm identity as advisory behavior priors: parsed/stored Markdown, sanitized prompt context, reference-only evidence metadata, shadow variants, and explicit non-authority governance. |
| Recursive soul evolution levels | `src/harness-sidecar/souls/*`, `src/harness-sidecar/swarm/swarmCellContracts.js`, `src/harness-sidecar/bes/laneEvidence.js`, `src/harness-sidecar/meta/capabilityGoalStatus.js` | Implemented as evidence-only lineage metadata across subagent souls, subagent societies, SwarmCells, swarms, oversoul, local/global harness, and meta-harness; nested execution is not implemented. |
| A2A interop | `src/harness-sidecar/interop/a2aSwarmEnvelope.js`, `agentCards.js`, `agentRouter.js`, `externalAgentGateway.js`, `a2aEndpointRegistry.js`, `a2aDurableStore.js`, `delegatedCapabilityTokens.js` | Durable local inbox/outbox, retry/progress/cancel, streaming envelope, peer discovery, restart-hydratable descriptors, endpoint registry, negotiation envelopes, root-constrained durable store, stable secret/store adapters, multi-hop lineage, and scoped delegated trust; not external long-lived peer transport. |
| Capability-goal status | `src/harness-sidecar/meta/capabilityGoalStatus.js`, `src/harness-sidecar/server.js`, `src/harness/harnessManager.js`, `public/app.js` | Implemented advisory rows for paper-alignment capability goals in sidecar status and UI. Status is evidence-only and cannot promote. |
| Trust kernel and safety | `src/harness-sidecar/core/trustKernelBoundary.js`, `approvalResume.js`, `src/harness-sidecar/security/*`, MCP policy modules | Implemented approval/safety boundaries; optimizers cannot self-authorize durable mutation. |

The newest BES mesh passes add the first shared composition layer over this substrate. `runBesLaneRuntime` and lane evidence normalization now wrap shadow candidates in non-promotable BES envelopes; context, compaction, tool-loop, budget, visual, memory, MCP-trust, research, skill, swarm, and harness lanes can emit lane evidence while preserving existing public APIs. The live sidecar runtime now emits `bes_lane.started`, `bes_lane.completed`, `bes_lane.blocked`, and `harness_status.updated` events for representative runtime lanes. A2A envelopes preserve reference metadata for BES lane, RHO cases, memory graph refs, candidate refs, lineage, trust, and required verification; Memory Graph RAG can produce compact lane context packets; and operator status helpers summarize lane evidence without exposing raw prompts, patches, secrets, or untrusted external content.

This closes the "missing shared lane runtime" gap and starts live runtime integration. The newest scale pass also makes the deterministic promotion path stricter: durable promotion now needs approval plus replay, verifier, provenance, and rollback evidence. It does not make the system paper-grade or self-authorizing; the lane output remains evidence-only and promotion-blocked by design.

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
- Memory eval and policy evolution surfaces:
  - `src/harness-sidecar/memory/memoryEvals.js`
  - `src/harness-sidecar/meta/memoryPolicyEvolution.js`
- Focused tests:
  - `tests/harness-memgraphrag-construction.test.js`
  - `tests/harness-memory-aware-graph-retriever.test.js`
  - `tests/harness-local-global-memory-graph.test.js`
  - `tests/harness-memory-policy-evolution.test.js`

Not yet paper-complete:

- `memoryGraphRuntime.js` and `memoryExtractionSociety.js` now compose observations through extraction society, guarded injected extraction hooks, local graph, SwarmCell merge, global promotion, graph snapshots, and migration history, but they remain deterministic runtime modules rather than a full production model-assisted multi-agent extraction society.
- Conflict adjudication can require retrieved provenance support and can use guarded injected adjudication hooks, but it is not yet a production resolution-agent society.
- Layer persistence, graph snapshot loading, migration history, eval hooks, decay, and consolidation records exist, but production memory maintenance still needs broader migration/versioning and larger eval coverage.
- Hierarchical retrieval exists, including active facts, passages, graph summary, bridge context, and task-startup policy signals, but it still needs deeper production policy tuning.
- Memory graph eval hooks now cover conflict quality, active fact precision, evidence coverage, connectivity, retrieval hit rate, and budget efficiency in deterministic form; paper-grade coverage still needs larger suites.
- RHO/BES/adaptive search can carry memory graph lane packets, but they do not yet tune schema thresholds, conflict policies, bridge thresholds, or hierarchical retrieval budgets at scale.
- Memory Graph RAG context packets are implemented and evidence-only, but deeper task-startup integration remains.

Best next step:

Scale the runtime completion work in `docs/superpowers/plans/2026-06-09-memgraphrag-runtime-completion.md`: replace the deterministic/injected hooks with production guarded model roles, run larger eval suites, broaden task-startup integration, and add more migration/versioning fixtures. The repo now has the runtime skeleton plus lane packets; it needs production-scale feedback and learned adjudication.

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
- Local and global harness experiment records:
  - `src/harness-sidecar/meta/localMetaHarness.js`
  - `src/harness-sidecar/meta/localCandidateArchive.js`
  - `src/harness-sidecar/meta/harnessRunStore.js`
  - `src/harness-sidecar/meta/harnessExperimentRunner.js`
  - `src/harness-sidecar/meta/harnessFrontier.js`
- Trust-kernel boundary evaluator:
  - `src/harness-sidecar/core/trustKernelBoundary.js`
  - `tests/harness-trust-kernel-boundary.test.js`

Not yet paper-complete:

- No single outer-loop agent currently searches freely over full harness code variants the way Meta-Harness does.
- Candidate proposals are constrained by local modules and generated artifacts rather than full candidate harness directories with independent runnable source trees.
- The repo does not yet run a repeated evaluate-log-propose loop over dozens of complete harness candidates.
- There is now an advisory longitudinal frontier record over locked held-out suites and the full paper-grade dimensions, but it is not yet a broad operator dashboard over full harness implementations.
- The proposer is not yet allowed to inspect arbitrary prior candidate source and trace directories as its primary optimization interface.
- Current safe-apply policy deliberately prevents self-authorized mutation of active source code.
- Harness-of-harnesses candidates have lineage/artifact storage support and isolated variant manifests, but they are not yet implemented as full independent executable source-tree variants.

Best next step:

Extend the workspace-local harness experiment abstraction under `.harness/meta/harness-runs/<run-id>/` into larger benchmark sweeps, then represent harness policies/configurations as candidates in the BES lane expansion plan. The run store now preserves lineage and replay artifacts; the next step is to run more candidates against held-out tasks, include independent source/config variants, and keep apply gated.

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
- Failed validation evidence is explicitly blocking in the hierarchical implementation:
  - `tests/harness-rho-replay-batch.test.js`
  - `tests/harness-meta-experiment-runs.test.js`

Not yet paper-complete:

- Coreset selection now supports precomputed embedding-aware DPP-like diversity with deterministic fallback; it is not yet a full learned embedding service over production trajectories.
- The grouped replay stage now compares candidate families over held-out variants and emits aggregate evidence-only promotion/blocking summaries, but it is still a deterministic harness runner rather than a large-scale model-judged rollout system.
- Self-validation and self-consistency exist as structured deterministic signals, including aggregate family evidence, not as a general learned trajectory-ranking judge.
- Candidate harness updates are not yet generated as N full source-tree alternatives and re-solved across the coreset.
- Pairwise self-preference exists as evidence, but it is not the sole promotion mechanism.
- Human approval and deterministic promotion gates replace the paper's freer self-preference acceptance loop.
- RHO hard cases now flow through representative unified lane envelopes and A2A-compatible references, and failed replays/rejected material candidates become future hard cases; this is not yet every subsystem and external route at production scale.

Best next step:

Scale the RHO replay batch runner beyond the deterministic candidate-family pass:

- replace deterministic diversity keys with embedding/DPP selection where available;
- run larger grouped attempts over stable held-out trace cases;
- compare more baseline/candidate families across subsystem types;
- feed self-validation, self-consistency, and self-preference into broader BES/meta candidate generation;
- feed RHO evidence into more shared BES lane runtime paths;
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
- ToolTree, verifier genome, and verifier evolution surfaces:
  - `src/harness-sidecar/bes/toolTreePlanner.js`
  - `src/harness-sidecar/meta/verifierGenome.js`
  - `src/harness-sidecar/meta/verifierEvolutionLoop.js`
  - `tests/harness-verifier-evolution-loop.test.js`

Not yet paper-complete:

- Helios now has deterministic trajectory operators with per-candidate provenance in lane runtime output, but they are adapted to harness candidates, policies, skills, verifier configs, and swarm attempts rather than reproducing the full paper formalism over model trajectory sequences.
- Dense subgoal verification is mostly heuristic/deterministic by subsystem, now with lane-specific verifier-unit metadata, not a general learned verifier per subgoal.
- The forward and backward searches are not yet fused into every runtime lane. Some lanes use BES metadata, some now emit live lane envelopes and future-hard-case records, and some only record evidence for later.
- A shared `src/harness-sidecar/bes/laneRuntime.js` now exists and wraps candidates/evidence across lanes; the sidecar emits live lane events for representative runtime lanes, but full forward/backward trajectory semantics are still not uniformly fused into every live runtime path.
- Optimization metadata from adaptive search, ToolTree, trajectory operators, champion archives, verifier genomes, and frontier scoring is not yet consistently attached to every candidate, though adaptive search now traces text/tool/swarm/visual/replay/verifier allocation.
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
- MCP trust policy;
- compaction policy;
- visual policy;
- harness configuration.

That will make the adaptation honest without pretending each subsystem is a mathematical trajectory from the paper.

## A2A and Swarm Interop

A2A is not one of the four cited papers, but it matters because the MemGraphRAG paper frames graph construction as a multi-agent society and the current Helios architecture now treats nested agents, SwarmCells, swarms, local harnesses, and global harnesses as linked layers.

Current Helios status: **Partial durable local interop, not full agent network.**

Implemented:

- A2A-shaped local envelope:
  - `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
  - `tests/harness-swarm-pi-native-worker.test.js`
- Pi-native swarm worker assignment:
  - `src/harness-sidecar/swarm/piNativeWorker.js`
- Agent cards, routing, redaction, external gateway, durable local queues, streaming envelopes, and delegated capability tokens:
  - `src/harness-sidecar/interop/agentCards.js`
  - `src/harness-sidecar/interop/agentRouter.js`
  - `src/harness-sidecar/interop/externalAgentGateway.js`
  - `src/harness-sidecar/interop/delegatedCapabilityTokens.js`
  - `tests/harness-agent-interop.test.js`
- SwarmCell and local meta-harness records that can carry evolution output upward:
  - `src/harness-sidecar/swarm/swarmCellRuntime.js`
  - `src/harness-sidecar/swarm/swarmCellContracts.js`
  - `src/harness-sidecar/meta/localMetaHarness.js`

Implemented in deterministic local form:

- durable inbox/outbox records;
- message correlation, retries, cancellation, and progress protocol;
- peer discovery filters;
- bidirectional streaming envelope shape;
- tested A2A metadata for BES lane, RHO case IDs, memory graph references, candidate lineage, and required verification;
- nested harness mesh regression tests proving A2A claims cannot grant promotion authority.

Not yet implemented:

- persistent A2A server endpoints per agent;
- production-wired restart-persistent queues and stable delegated-token issuer secrets;
- independent subagent-to-subagent negotiation over real transports. A local endpoint registry and negotiation envelope now exist for testable contracts.

Implication for MemGraphRAG:

The extraction society should initially run as sidecar-local roles, not independent networked agents. Promote those roles into separate A2A agents only after external endpoints, restart-persistent queues, and stable delegated-token secrets exist. The narrower intermediate step is now implemented: preserve A2A lineage and memory graph references in candidate envelopes while treating external claims as untrusted until separately verified.

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
| MemGraphRAG | Shared three-layer memory for graph construction and memory-aware retrieval | Global memory layers, guarded eight-role extraction society outputs, conflict adjudicator, evidence coverage, memory graph constructor, memory-aware and hierarchical retrievers, memory graph runtime, eval metrics | Strong deterministic skeleton | Missing production model-assisted roles, learned adjudication, large eval loop |
| Meta-Harness | Agentic code-space search over harnesses using filesystem traces and scores | Trace/artifact store, candidate archive, harness run store with lineage/replay artifacts, isolated executable variant workspaces, source/config/trace/metric materialization, proposer context, repeated variant cycles, longitudinal frontier, promotion loop, policy candidates | Strong deterministic substrate | Missing autonomous outer loop over many evaluated full harness source variants |
| RHO | Retrospective hard-case coreset, group rollout, self-validation, self-consistency, self-preference | Coreset builder with difficulty/diversity metadata, embedding-aware DPP-like selection, hard-case mining, held-out variant grouping, candidate-family replay batch runner, aggregate evidence, self-validation, self-consistency, self-preference, swarm outcome feedback | Strong deterministic substrate | Missing production embedding service, large grouped rerolls, promotion driven primarily by pairwise preference |
| BES | Forward evolutionary candidate search plus backward goal decomposition | Subgoal planning/scoring, bidirectional loop, mutation/recombination, population archive, lane contracts, trajectory operators, dense verifier contracts, forward/backward fusion metadata, trajectory provenance, compatible-family descriptors, lineage, adaptive search across action types, ToolTree, verifier genomes, live lane events, future hard cases | Strong deterministic substrate | Missing learned/model-assisted dense judgment and full paper trajectory formalism across all live lanes |
| A2A / multi-agent society bridge | Not a cited paper target, but needed to link nested swarms and harnesses | A2A envelope, agent cards, router, durable local gateway, endpoint registry, negotiation envelope, JSON durable store, scoped delegated tokens, stable secret/store adapters, streaming envelope, SwarmCell evolution output, root/symlink-safe persistence checks | Strong durable local contract | Missing external long-lived peer transport |

## Recommended Execution Order

1. Run production-scale held-out benchmark cycles.
   - Keep the existing longitudinal frontier and capability-goal rows.
   - Add larger stable suites and repeated scheduled runs.
   - Compare weeks of quality, safety, reliability, cost, latency, maintainability, visual confidence, memory health, and trust risk.

2. Move Meta-Harness from deterministic substrate to autonomous proposer/evaluator loops.
   - Reuse isolated variant workspaces and proposer context.
   - Evaluate many full source variants in isolated directories.
   - Keep active workspace apply gated by promotion policy and approval.

3. Promote deterministic RHO evidence into production replay practice.
   - Replace fixture/precomputed embeddings with production embedding providers where allowed.
   - Run larger grouped rerolls across coding, research, memory, visual, tool, swarm, and safety suites.
   - Use self-preference as stronger evidence, not automatic authority.

4. Promote MemGraphRAG roles and BES dense judgment behind policy gates.
   - Add guarded model-assisted role workers and adjudicators.
   - Keep provenance, rollback, and conflict evidence mandatory.
   - Preserve deterministic fallbacks for tests and audit.

5. Promote A2A from durable local contract to real peer transport.
   - Add server/client endpoints, production queue stores, and multi-hop network flows.
   - Keep external claims untrusted until independently verified.
   - Keep delegated trust scoped, signed, and auditable.

## Bottom Line

Helios Forge already has more than surface-level inspiration from the papers. The repo contains real modules for traces, candidate archives, coreset mining, replay evidence, subgoal scoring, population evolution, memory graph construction, local/global meta-harness records, skill evolution, verifier evolution, adaptive search, A2A-shaped interop, and approval-gated apply.

The honest distinction is this:

- Helios has implemented many **paper-shaped primitives**.
- Helios has implemented several deterministic **paper-shaped loops**.
- Helios now has a tested **composition layer** that lets those loops behave like an evolving swarm of swarms and harnesses of harnesses.
- Helios has not yet implemented the full **paper-grade autonomous experimental systems** end to end.

That is a healthy place to be. The architecture is broad but testable, and the remaining work is mostly about scale, learned/model-assisted judgment, production transport, and long-running evidence rather than adding another isolated clever subsystem.
