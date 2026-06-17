# Evolutionary Swarm / Meta-Harness Codebase Audit

Date: 2026-06-12

**Addendum (2026-06-17):** Hot-path wiring for M0–M4 landed since this audit. See `docs/architecture/2026-06-17-implementation-reconciliation.md`. The substrate-vs-proof framing in this document remains valid.

This audit compares three things:

1. the papers that inspired Helios Forge;
2. the actual Helios Forge target: an evolutionary swarm of swarms with evolving meta-harnesses of meta-harnesses;
3. the current codebase state in this worktree.

The key answer is:

```text
Helios now has the Level 4-capable engine substrate.
It does not yet have the Level 4 evaluation record.
```

That means the organism architecture is mostly present as code, contracts, evidence envelopes, stores, dashboards, tests, and trust gates. What is still missing is repeated production-scale proof that the whole system improves itself over time across stable held-out workloads.

## Audit Method

This document is code-audited first and document-informed second. Older architecture documents were used only to recover the intended target shape and terminology. Current status claims are grounded in the current codebase, especially:

- module/file inventory under `src/harness-sidecar/*`;
- focused test inventory under `tests/*.js`;
- current capability gates in `src/harness-sidecar/meta/capabilityGoalStatus.js`;
- runtime wiring in `src/harness-sidecar/server.js`;
- BES runtime anchors in `src/harness-sidecar/bes/laneRuntime.js` and `src/harness-sidecar/bes/liveBesFusion.js`;
- concrete stores and surfaces such as `operatorDashboardStore.js`, `longitudinalFrontier.js`, `harnessRunStore.js`, `harnessVariantWorkspace.js`, and `public/app.js`.

The percentages and high/medium/low labels in this family of docs are engineering-read estimates, not computed code coverage. Treat them as an audit summary of present modules, tests, runtime wiring, and production gates. The stronger code-defensible statement is the one used throughout this document:

```text
Engine substrate: broadly implemented.
Production evaluation record: not yet populated.
```

Source weighting for this audit:

| Claim type | Primary basis | Notes |
| --- | --- | --- |
| "Implemented substrate" | Current source files, exports, tests, and runtime wiring | Docs are not accepted as proof of implementation |
| "Production-gated" | `capabilityGoalStatus.js` and production evidence requirements | A feature can exist and still be production-gated |
| "Paper-grade missing" | Paper requirements compared with current code and evidence gates | Missing proof is not the same as missing architecture |
| "Target architecture" | User goal plus current recursive swarm docs | Used to compare Helios against the larger organism goal, not as code proof |

## Paper Targets

The direct research references are:

- MemGraphRAG: Memory-based Multi-Agent System for Graph Retrieval-Augmented Generation, arXiv `2606.00610`, https://arxiv.org/abs/2606.00610
- Meta-Harness: End-to-End Optimization of Model Harnesses, arXiv `2603.28052`, https://arxiv.org/abs/2603.28052
- Retrospective Harness Optimization: Improving LLM Agents via Self-Preference over Trajectory Rollouts, arXiv `2606.05922`, https://arxiv.org/abs/2606.05922
- Self-Improving Language Models with Bidirectional Evolutionary Search, arXiv `2605.28814`, https://arxiv.org/abs/2605.28814

Each paper contributes one major capability:

| Paper | What the paper demands | Helios adaptation |
| --- | --- | --- |
| MemGraphRAG | Shared-memory multi-agent graph construction, global conflict resolution, structural connectivity, memory-aware hierarchical retrieval | Local, SwarmCell, and global memory graph runtime with guarded extraction/adjudication, provenance, evals, lane packets, and hierarchical retrieval |
| Meta-Harness | Outer-loop search over harness code using prior candidate source, traces, scores, and filesystem artifacts | Local/global meta-harness stores, isolated variant workspaces, candidate archives, frontier records, source/config/trace/metric artifacts, approval-gated promotion |
| RHO | Self-supervised harness improvement from past trajectories using hard/diverse coreset, grouped rerolls, self-validation, self-consistency, self-preference | Coreset selection, replay batches, grouped rerolls, candidate-family deltas, validation/consistency/preference evidence, longitudinal improvement tracking |
| BES | Forward evolutionary search plus backward goal decomposition with dense feedback and trajectory operators | BES lane runtime, backward goal trees, subgoal scoring, mutation/recombination, trajectory operators, live fusion, dense verifier contracts, lineage, champion/frontier bridge |

The papers are not the full Helios target. They are ingredients. The Helios target combines them into a recursive governed organism.

## Actual Helios Target

The target architecture is:

```text
evolving agent
-> evolving soul
-> evolving local harness
-> evolving SwarmCell
-> evolving swarm
-> evolving oversoul
-> evolving global harness
-> evolving harness-of-harnesses
-> continuously evolving substrate
```

The intended loop is:

```text
observe locally
-> remember locally
-> evolve locally
-> report upward
-> compare globally
-> replay globally
-> recombine globally
-> verify
-> promote safely
-> update durable memory/substrate
-> produce the next harder evaluation frontier
```

The safety invariant is:

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

This target is bigger than any one paper because it requires a swarm-of-swarms, local/global memory, local/global meta-harnesses, RHO/BES curriculum and evolution, multimodal perception, external A2A peers, dashboards, and a non-self-modifying trust kernel.

## Current Codebase Inventory

Current implementation neighborhoods:

| Area | Files counted | Main anchors |
| --- | ---: | --- |
| BES | 26 | `src/harness-sidecar/bes/*` |
| Meta-harness / governance / frontier | 43 | `src/harness-sidecar/meta/*` |
| Memory | 24 | `src/harness-sidecar/memory/*` |
| Swarm | 23 | `src/harness-sidecar/swarm/*` |
| VLM / visual | 22 | `src/harness-sidecar/vlm/*` |
| A2A / interop | 12 | `src/harness-sidecar/interop/*` |
| RHO | 11 | `src/harness-sidecar/rho/*` |
| RAG | 9 | `src/harness-sidecar/rag/*` |
| Core trust/runtime | 8 | `src/harness-sidecar/core/*` |
| Souls / oversoul | 7 | `src/harness-sidecar/souls/*` |
| Security | 5 | `src/harness-sidecar/security/*` |
| Benchmarks | 3 | `src/harness-sidecar/benchmarks/*` |

Focused test clusters:

| Test cluster | Test files counted |
| --- | ---: |
| Meta/evidence/frontier/dashboard/capability | 17 |
| BES | 15 |
| Swarm | 14 |
| RHO/replay | 13 |
| Memory/RAG | 12 |
| Soul/oversoul | 8 |
| VLM/visual | 7 |
| A2A | 5 |
| Model council/router | 5 |
| Governance/trust | 4 |

This is not just docs. The codebase has broad runtime/test substrate.

## Current Maturity Snapshot

| Goal | Current read | Why |
| --- | --- | --- |
| Swarm of swarms engine | Mostly implemented substrate | SwarmCell contracts/runtime, swarm orchestration, evolution output, role profiles, local meta, memory graph, BES lane wrappers, A2A-compatible references |
| Evolving local harnesses | Implemented substrate | `localMetaHarness`, `localEvolutionLoop`, local candidate archive, local promotion blocker |
| Evolving global harness | Strong substrate | harness run store, experiment runner, frontier, promotion loop, isolated variant workspace, proposer context |
| Meta-harness of meta-harnesses | Partial substrate | `harnessOfHarnessesOptimizer`, harness lane contract, source-tree variant runner, campaign runner; not many autonomous full harness variants yet |
| RHO curriculum | Strong deterministic substrate | coreset, replay, grouped rerolls, validation/consistency/preference, longitudinal tracking; production-scale model-backed rerolls missing |
| BES mesh | Strong deterministic substrate | shared lane runtime, live fusion, trajectory operators, dense verifier contracts, champion/frontier, lineage; learned dense judgment and full live-lane fusion missing |
| Memory Graph RAG | Strong deterministic substrate | local/global/SwarmCell graphs, extraction society, conflict resolver/adjudicator, runtime, evals, hierarchical retrieval; production model-assisted society missing |
| VLM/multimodal sense | Implemented substrate | capture, PDF/OCR/plot/diagram/diff workers, visual verifier, visual frontier, visual replay, budget-aware routing; repeated visual production frontier missing |
| A2A network-of-networks | Strong local contract, partial external network | durable local inbox/outbox, endpoint registry, transport client/server, queue provider, issuer secrets, lineage; deployed long-lived external peer practice missing |
| Trust kernel | Strong substrate | trust boundary, quarantine, approval resume, promotion policy, production autonomy policy, rollback drills; long-running autonomy evidence missing |
| Dashboards/evidence surfaces | Implemented surfaces | operator dashboard store, frontier stores, production evidence UI refresh, capability rows, status snapshots; repeated populated production history missing |

Current label:

```text
Level 4-capable engine substrate, production-gated evaluation record.
```

## Paper-By-Paper Audit

### MemGraphRAG

Paper target:

- multi-agent graph construction with shared memory;
- global context during extraction;
- conflict resolution and graph connectivity;
- hierarchical memory-aware retrieval over the constructed graph.

What Helios has:

- `src/harness-sidecar/memory/memoryExtractionSociety.js`
- `src/harness-sidecar/memory/memoryGraphRuntime.js`
- `src/harness-sidecar/memory/localMemoryGraph.js`
- `src/harness-sidecar/memory/swarmCellMemoryGraph.js`
- `src/harness-sidecar/memory/globalMemoryLayers.js`
- `src/harness-sidecar/memory/globalMemoryPromotion.js`
- `src/harness-sidecar/memory/memoryConflictResolver.js`
- `src/harness-sidecar/memory/memoryConflictAdjudicator.js`
- `src/harness-sidecar/memory/provenanceResolutionAgents.js`
- `src/harness-sidecar/memory/memoryEvals.js`
- `src/harness-sidecar/rag/memoryAwareGraphRetriever.js`
- `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`

What that means:

Helios has implemented the memory graph architecture in a real, testable, safety-gated form. It has local, SwarmCell, and global memory layers; role outputs; provenance; conflicts; eval signals; graph construction; memory-aware retrieval; and hierarchical retrieval.

Remaining gap:

It is not yet a production model-assisted extraction society continuously operating over large corpora. The current system is still mostly deterministic, injected, guarded, and fixture/test-scale. The paper-grade gap is scale plus model-assisted adjudication, not the absence of memory graph structure.

Audit read:

```text
Implementation: high substrate coverage.
Paper-grade proof: medium-low until production model-assisted extraction and larger graph evals run repeatedly.
```

### Meta-Harness

Paper target:

- optimize the harness itself;
- proposer reads previous candidate source code, traces, scores, and artifacts through the filesystem;
- evaluator writes comparable results back;
- outer loop searches over many candidate harnesses and returns a frontier.

What Helios has:

- `src/harness-sidecar/meta/localMetaHarness.js`
- `src/harness-sidecar/meta/localEvolutionLoop.js`
- `src/harness-sidecar/meta/localCandidateArchive.js`
- `src/harness-sidecar/meta/localPromotionBlocker.js`
- `src/harness-sidecar/meta/harnessRunStore.js`
- `src/harness-sidecar/meta/harnessExperimentRunner.js`
- `src/harness-sidecar/meta/harnessVariantWorkspace.js`
- `src/harness-sidecar/meta/sourceTreeVariantRunner.js`
- `src/harness-sidecar/meta/harnessFrontier.js`
- `src/harness-sidecar/meta/longitudinalFrontier.js`
- `src/harness-sidecar/meta/metaHarnessCampaignRunner.js`
- `src/harness-sidecar/meta/harnessOfHarnessesOptimizer.js`
- `src/harness-sidecar/meta/promotionLoop.js`
- `src/harness-sidecar/meta/promotionPolicy.js`

What that means:

Helios has a real meta-harness substrate: local candidate production, global run stores, source/config/trace/metric artifacts, isolated variant workspaces, proposer context, campaign runner, frontier records, and promotion policy.

Remaining gap:

The Meta-Harness paper is more aggressive: many full harness code variants, proposer access to prior source/traces/scores as the main learning interface, and repeated evaluate-log-propose loops over full executable variants. Helios has the filesystem/artifact substrate but has not yet proven broad autonomous code-space search.

Audit read:

```text
Implementation: strong infrastructure.
Paper-grade proof: partial until many full source-tree candidate campaigns run.
```

### RHO

Paper target:

- optimize from past trajectories without labels;
- select hard/diverse coreset;
- re-solve in parallel;
- use self-validation and self-consistency;
- generate candidate harness updates;
- choose by pairwise self-preference.

What Helios has:

- `src/harness-sidecar/rho/coresetBuilder.js`
- `src/harness-sidecar/rho/embeddingProvider.js`
- `src/harness-sidecar/rho/replayBatchRunner.js`
- `src/harness-sidecar/rho/groupedRerollRunner.js`
- `src/harness-sidecar/rho/selfValidation.js`
- `src/harness-sidecar/rho/selfConsistency.js`
- `src/harness-sidecar/rho/selfPreferenceJudge.js`
- `src/harness-sidecar/rho/modelRouterHardCases.js`
- `src/harness-sidecar/rho/longitudinalImprovementTracker.js`
- `src/harness-sidecar/rho/replaySchedulePlanner.js`

What that means:

Helios has the RHO mechanism in deterministic/evidence form: coreset, embedding-aware diversity support, replay, grouped rerolls, candidate-family deltas, validation/consistency/preference evidence, router hard cases, and longitudinal tracking.

Remaining gap:

The paper-grade version requires large trajectory stores, production embeddings or learned similarity, grouped re-solving at meaningful scale, and future-task uplift evidence. Helios has the engine, not the production replay record.

Audit read:

```text
Implementation: strong deterministic substrate.
Paper-grade proof: partial until production grouped rerolls show held-out improvement.
```

### BES

Paper target:

- forward candidate evolution;
- backward goal decomposition;
- dense intermediate verification;
- trajectory operators such as combination, deletion, translocation, and crossover;
- proof that the combined search beats simpler baselines.

What Helios has:

- `src/harness-sidecar/bes/laneRuntime.js`
- `src/harness-sidecar/bes/liveBesFusion.js`
- `src/harness-sidecar/bes/laneContracts.js`
- `src/harness-sidecar/bes/laneEvidence.js`
- `src/harness-sidecar/bes/backwardGoalTree.js`
- `src/harness-sidecar/bes/bidirectionalSearchLoop.js`
- `src/harness-sidecar/bes/subgoalPlanner.js`
- `src/harness-sidecar/bes/subgoalScorer.js`
- `src/harness-sidecar/bes/denseSubgoalVerifier.js`
- `src/harness-sidecar/bes/modelAssistedDenseJudgment.js`
- `src/harness-sidecar/bes/trajectoryOperators.js`
- `src/harness-sidecar/bes/mutationPolicy.js`
- `src/harness-sidecar/bes/recombinationEngine.js`
- `src/harness-sidecar/bes/evolutionPopulationRunner.js`
- `src/harness-sidecar/bes/championArchive.js`
- `src/harness-sidecar/bes/globalLineageTracker.js`
- `src/harness-sidecar/bes/modelChoiceMcts.js`

What that means:

Yes: the BES mesh still exists, and it is one of the strongest parts of the codebase. It has shared lane envelopes, live fusion, events, dense verifier metadata, trajectory provenance, mutation/recombination, model-choice search, champion/frontier evidence, and nested mesh tests.

Remaining gap:

The paper is about full trajectory-level search semantics and measured gains over baselines. Helios adapts BES to harness candidates, policies, skills, memory graph policies, verifier genomes, swarm attempts, and source variants. That is the right adaptation, but it still needs learned/model-assisted dense judgment across more lanes and repeated experiments proving lift over plain replay / best-of-N / forward-only / backward-only baselines.

Audit read:

```text
Implementation: high. BES mesh is real.
Paper-grade proof: medium until live-lane cycles and dense judgment reports accumulate.
```

## Goal-Versus-Code Audit

### 1. Evolving Agents

Current code:

- `src/harness-sidecar/swarm/modelDrivenWorker.js`
- `src/harness-sidecar/swarm/piNativeWorker.js`
- `src/harness-sidecar/swarm/subagentRunner.js`
- `src/harness-sidecar/swarm/agentProfiles.js`
- `src/harness-sidecar/souls/*`

Current state:

Agent identity, role specialization, model profiles, soul records, prompt adapters, and evidence-only soul lineage are implemented. Agents can emit task and evolution evidence through SwarmCell contracts.

Gap:

Agents do not yet run fully independent nested local harness execution loops over long horizons. Soul/oversoul evolution levels are metadata/evidence, not autonomous nested execution.

### 2. Evolving Local Harnesses

Current code:

- `localMetaHarness.js`
- `localEvolutionLoop.js`
- `localCandidateArchive.js`
- `localPromotionBlocker.js`

Current state:

Local meta-harness substrate is implemented. It can produce local candidates, archive evidence, and keep durable apply blocked.

Gap:

Local loops need richer repeated local RHO/BES cycles and local dashboards over time. They are not yet self-running long-horizon local optimizers.

### 3. Evolving SwarmCells

Current code:

- `swarmCellContracts.js`
- `swarmCellRuntime.js`
- `swarmCellRegistry.js`
- `swarmOrchestrator.js`
- `evolutionSwarmPlanner.js`
- `evolutionBudgetAllocator.js`

Current state:

SwarmCell contracts and runtime are implemented. The system can preserve `taskOutput`, `evolutionOutput`, local meta feedback, memory proposals, and BES evidence.

Gap:

SwarmCell societies are not yet independent production agents with their own external transports and persistent local optimization histories.

### 4. Evolving Swarm

Current code:

- `swarmOrchestrator.js`
- `swarmOutcomeRecorder.js`
- `modelCouncil.js`
- `modelDebateEvidence.js`
- `modelRouterState.js`
- `modelRouterPolicy.js`
- `modelRouterRewards.js`
- `modelChoiceMcts.js`

Current state:

The swarm can route, compare, aggregate, preserve model diversity telemetry, record outcome evidence, and feed hard cases into RHO/BES/meta loops. Model council/router evidence is advisory and evidence-only.

Gap:

Needs production pass@k uplift records, real model debate at scale, and persistent router posterior/frontier dashboards populated by repeated workloads.

### 5. Evolving Oversoul

Current code:

- `src/harness-sidecar/souls/oversoulRuntime.js`
- `src/harness-sidecar/souls/evolutionLevels.js`
- `src/harness-sidecar/souls/soulEvidence.js`
- `src/harness-sidecar/meta/capabilityGoalStatus.js`

Current state:

Oversoul and evolution levels exist as advisory identity/governance/lineage metadata. The system can represent the stack from subagent souls through meta-harness as evidence-only lineage.

Gap:

There is no true nested oversoul execution brain that autonomously coordinates long-running sub-swarms. The current oversoul is a status, governance, and prompt-context layer.

### 6. Evolving Global Harness

Current code:

- `harnessRunStore.js`
- `harnessExperimentRunner.js`
- `harnessFrontier.js`
- `longitudinalFrontier.js`
- `promotionLoop.js`
- `promotionPolicy.js`
- `operatorDashboardStore.js`

Current state:

Global harness experiment infrastructure is implemented, including evidence, frontier, operator/dashboard stores, and promotion policy.

Gap:

Needs repeated campaigns over stable held-out suites and dashboard records populated by recurring production cycles.

### 7. Evolving Harness-Of-Harnesses

Current code:

- `harnessOfHarnessesOptimizer.js`
- `metaHarnessCampaignRunner.js`
- `sourceTreeVariantRunner.js`
- `harnessVariantWorkspace.js`
- `bes/laneContracts.js` with harness lane concepts

Current state:

First concrete harness-of-harnesses substrate exists. It can represent optimizer/campaign/source-tree variant evidence.

Gap:

This is not yet a meta-meta optimizer that repeatedly mutates the optimizer itself across many independent full harness source trees. The schema and stores exist; the long-running recursive campaigns do not.

### 8. Continuously Evolving Substrate

Current code:

- `trustKernelBoundary.js`
- `promotionPolicy.js`
- `approvalResume.js`
- `rollbackDrillRunner.js`
- `productionAutonomyPolicy.js`
- `modelVisibleQuarantine.js`
- `verifierConfigApply.js`
- `gitApplyAdapter.js`

Current state:

The substrate can receive candidate mutations behind strict evidence and approval gates. It has rollback, quarantine, verifier, trust, and apply boundaries.

Gap:

The substrate is not self-authorizing, by design. To earn Level 4 evaluation, it needs repeated evidence that safe promotions improve future tasks without regressions.

## Capability Gate Audit

The codebase tracks ten capability goals in `capabilityGoalStatus.js`.

Current production-gated goals:

- `benchmark_spine`
- `meta_harness_loop`
- `rho_at_scale`
- `memgraphrag_depth`
- `bes_full_lanes`
- `multimodal_system_sense`
- `a2a_external_durability`
- `governance_autonomy`

Implemented-substrate goals:

- `soul_coverage`
- `oversoul_coverage`

The most important detail: `level4ReadyCandidate` only becomes true when a goal is implemented, has complete production evidence, and has no future paper gaps. That is why the system can have the engine and still not have the evaluation label.

Required production evidence includes:

- persisted replay reports;
- operator dashboard snapshots;
- frontier dashboard snapshots;
- production grouped reroll reports;
- longitudinal improvement trends;
- memory eval dashboards;
- provenance resolution reports;
- live lane reports;
- dense judgment reports;
- visual replay reports;
- visual frontier snapshots;
- external peer status;
- durable queue snapshots;
- autonomy dashboard snapshots;
- rollback drill reports.

Those are evaluation records, not architecture modules. Some stores and UI surfaces exist now; the missing part is repeated populated history.

## What We Actually Have

Helios Forge currently has:

- a swarm and SwarmCell execution substrate;
- local meta-harness loops;
- global meta-harness experiment stores;
- first harness-of-harnesses optimizer substrate;
- local, SwarmCell, and global memory graph runtime;
- RHO replay and hard-case curriculum substrate;
- BES mesh and live lane runtime;
- model council and adaptive model router substrate;
- VLM/visual system-sense substrate;
- durable local A2A and transport contracts;
- soul/oversoul/evolution-level lineage records;
- dashboard stores, UI panels, status rows, and production-evidence refresh paths;
- trust kernel, approval, rollback, quarantine, verifier, and safe-apply gates.

That is the Level 4-capable engine.

## What We Do Not Yet Have

Helios Forge does not yet have:

- weeks of repeated held-out benchmark cycles;
- dashboard snapshots populated by those cycles;
- large production RHO grouped rerolls;
- broad learned/model-assisted dense BES judgment;
- autonomous Meta-Harness search over many full source-tree harness variants;
- recursive meta-meta campaigns that improve the optimizer itself over time;
- production model-assisted MemGraphRAG extraction/adjudication societies;
- long-lived external A2A peer services running as real peers;
- production queue backends replacing local JSON-style adapters for external networks;
- demonstrated lift over baselines across the whole organism loop.

That is the missing Level 4 evaluation record.

## Precision Matrix

| Layer | Engine implemented | Evaluation proven | Audit result |
| --- | ---: | ---: | --- |
| SwarmCell/local agent evolution | High | Low-medium | Real local substrate; needs long-horizon nested operation |
| Soul/oversoul lineage | Medium-high | Low | Evidence/prompt/governance layer exists; nested execution absent |
| Local meta-harness | High | Medium-low | Candidate loop exists; needs repeated local optimization histories |
| Global meta-harness | High | Medium-low | Stores/workspaces/frontier exist; needs many source-tree campaigns |
| Harness-of-harnesses | Medium | Low | Optimizer/campaign substrate exists; recursive meta-meta proof missing |
| MemGraphRAG | High | Medium-low | Strong graph/memory substrate; production model society missing |
| RHO | High | Medium-low | Strong replay substrate; production grouped reroll proof missing |
| BES mesh | High | Medium | Mesh is real; learned dense judgment and full live-lane proof missing |
| Model council/router | Medium-high | Medium-low | Routing/council evidence exists; pass@k production uplift needed |
| VLM/multimodal | Medium-high | Medium-low | Visual substrate exists; production visual frontier needed |
| A2A network | Medium-high local, medium external | Low-medium | Local durable contract and transport pieces exist; external peer practice missing |
| Trust/governance | High | Medium | Strong boundaries; long-running autonomy evidence needed |
| Dashboards/evidence surfaces | High surfaces | Low-medium populated history | UI/stores exist; repeated production records missing |

## Bottom Line

The work already done was not wasted and it was not "just docs." The codebase has a real recursive evolutionary harness engine:

```text
swarm contracts
-> local meta-harness
-> memory graph
-> RHO replay
-> BES mesh
-> global meta-harness
-> harness-of-harnesses substrate
-> dashboards/evidence stores
-> trust-gated promotion
```

The correct claim is:

```text
Helios Forge has implemented the Level 4-capable engine substrate for an
evolutionary swarm-of-swarms and evolving meta-harness-of-meta-harnesses.
It has not yet produced the Level 4 evaluation record: repeated production
evidence proving the whole organism improves itself safely over time.
```

The next work should therefore stop adding broad new architecture surfaces and instead run the evidence loop:

1. lock held-out suites;
2. run repeated replay/campaign cycles;
3. populate operator/frontier/production dashboards;
4. compare baseline vs candidate families;
5. prove BES/RHO/meta-harness uplift over simpler baselines;
6. keep every durable mutation trust-gated.
