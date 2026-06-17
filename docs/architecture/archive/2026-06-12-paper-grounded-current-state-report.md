# Paper-Grounded Current State Report

Date: 2026-06-12

This document is a fresh read of Helios Forge against the papers and research threads that shaped the current architecture. It is intentionally separate from the older alignment and gap-map documents. It uses the papers as the standard, then checks the current codebase state as of commit `25b1e81` on `codex/remaining-paper-gaps-parallel`.

## Source Papers

The core comparison set is:

- MemGraphRAG: Memory-based Multi-Agent System for Graph Retrieval-Augmented Generation, arXiv `2606.00610`, https://arxiv.org/abs/2606.00610
- Meta-Harness: End-to-End Optimization of Model Harnesses, arXiv `2603.28052`, https://arxiv.org/abs/2603.28052
- Retrospective Harness Optimization: Improving LLM Agents via Self-Preference over Trajectory Rollouts, arXiv `2606.05922`, https://arxiv.org/abs/2606.05922
- Self-Improving Language Models with Bidirectional Evolutionary Search, arXiv `2605.28814`, https://arxiv.org/abs/2605.28814

Helios also has an A2A / durable multi-agent bridge and first-class multimodal/VLM layer. Those are not a direct single-paper target in the list above, but they are required if the paper ideas are going to become a network-of-networks harness instead of isolated local algorithms.

## Executive Read

Helios Forge now has a broad, tested, safety-gated substrate that mirrors the major paper structures:

- shared memory graph and hierarchical retrieval primitives;
- harness run stores, candidate archives, isolated variant artifacts, and frontier records;
- RHO-style coreset, replay, self-validation, self-consistency, and self-preference evidence;
- BES-style subgoals, dense verifier contracts, lane runtime, trajectory provenance, recombination primitives, and future-hard-case capture;
- model council, adaptive router, AB-MCTS model choice, endpoint capacity, and pass@k/calibration evidence;
- visual/VLM evidence, visual replay, visual frontier, visual memory/RHO/BES references, and multimodal request budgeting;
- durable local A2A contracts, endpoint registry, negotiation envelopes, delegated trust, and root/symlink-safe persistence;
- model-visible quarantine, trust-kernel checks, promotion policy, approval resume, rollback drills, and feature-gated production evidence endpoints.

The remaining gap is not "invent another architecture layer." The remaining gap is proof, scale, and continuity:

```text
paper-shaped substrate -> repeated production evidence -> Level 4-ready candidate -> proven Level 4
```

The current repo is best described as a paper-shaped Level 4-candidate direction, not as Level 4-ready, proven Level 4, or Level 5. The strongest loops are still feature-gated, evidence-only, deterministic, offline/advisory by default, or human-approval governed, and the repo's own capability status keeps `level4ReadyCandidate` false until production evidence lands.

## Code-Audit Basis

This report is code-audited first and doc-informed second. Older architecture docs were used only for target framing. Current-state claims are based on the current source tree, focused tests, runtime wiring, and capability gates.

Primary code evidence:

- module inventory under `src/harness-sidecar/memory`, `rag`, `meta`, `rho`, `bes`, `swarm`, `model`, `vlm`, `interop`, `core`, and `security`;
- focused tests under `tests/`, especially `harness-bes-*`, `harness-rho-*`, `harness-memory-*`, `harness-meta-*`, `harness-a2a-*`, `harness-vlm-*`, `harness-visual-*`, `harness-capability-goal-status.test.js`, and governance/trust tests;
- production-gate definitions in `src/harness-sidecar/meta/capabilityGoalStatus.js`;
- runtime BES lane wiring in `src/harness-sidecar/server.js`;
- dashboard/store/UI evidence in `operatorDashboardStore.js`, `longitudinalFrontier.js`, `visualFrontier.js`, `public/app.js`, and `public/index.html`.

The implementation percentages below are engineering estimates from current code and test presence, not computed coverage:

| Area | Implemented engine substrate | Production / paper-grade proof | Basis |
| --- | ---: | ---: | --- |
| MemGraphRAG | ~70% | ~35-45% | Current memory/RAG modules and tests exist; production model-assisted extraction/adjudication and large graph evals remain gated |
| Meta-Harness | ~60-65% | ~25-35% | Run stores, variant workspaces, source/config/trace/metric artifacts, and campaign pieces exist; many autonomous full source-tree campaigns remain missing |
| RHO | ~65-70% | ~35-40% | Coreset/replay/grouped-reroll/validation/consistency/preference modules exist; production embedding scale and held-out reroll trends remain missing |
| BES | ~75-80% | ~45-55% | Shared lane runtime, live fusion, dense verifier contracts, trajectory operators, recombination, MCTS, champion/frontier, and nested mesh tests exist; learned dense judgment and full live-lane proof remain missing |
| Model council/router | ~65-70% | ~35-45% | Council/router/pass@k/calibration/reward modules exist; production pass@k uplift and persistent router health history remain missing |
| VLM/multimodal | ~60-65% | ~30-40% | Visual workers, replay, frontier, VLM budget routing, and promotion gates exist; production visual replay/frontier evidence remains missing |
| A2A/network-of-networks | ~60-65% local | ~30-40% external/prod | Durable local A2A, transport client/server, queue provider, issuer secrets, and lineage exist; deployed external peers and production queues remain missing |
| Governance/trust kernel | ~75% | ~45-55% | Trust boundary, quarantine, promotion, autonomy policy, approval resume, rollback drills exist; repeated autonomy/rollback dashboard evidence remains missing |

## What The Papers Actually Demand

The papers are not just data-structure papers. They are improvement-loop papers.

MemGraphRAG asks for shared memory to give multi-agent graph construction a global perspective, reduce local inconsistencies, preserve structural connectivity, and enable memory-aware hierarchical retrieval.

Meta-Harness asks for an outer-loop system that searches over harness code using access to prior candidate source, traces, scores, and execution histories, while a separate evaluator writes scores back to the filesystem.

RHO asks for self-supervised harness improvement from unlabeled past trajectories: hard/diverse coreset selection, parallel re-solving, self-validation, self-consistency, candidate harness proposal, and pairwise self-preference.

BES asks for forward evolutionary search plus backward goal decomposition: operators such as combination, deletion, translocation, and crossover should enlarge the candidate space, while backward subgoals provide dense intermediate verification.

Helios has implemented much of the shape, including dashboard stores, UI surfaces, capability-status rows, production-evidence refresh paths, and frontier/operator evidence plumbing. It has not yet demonstrated the same kind of sustained measured improvement loop over large, stable, production-sized workloads.

## Current Codebase Anchors

The current implementation is spread across these main neighborhoods:

| Capability | Current anchors |
| --- | --- |
| Memory Graph RAG | `src/harness-sidecar/memory/*`, `src/harness-sidecar/rag/memoryAwareGraphRetriever.js`, `src/harness-sidecar/rag/hierarchicalMemoryRetriever.js`, `src/harness-sidecar/memory/memoryGraphRuntime.js` |
| Meta-Harness / harness variants | `src/harness-sidecar/meta/harnessRunStore.js`, `harnessExperimentRunner.js`, `harnessVariantWorkspace.js`, `harnessFrontier.js`, `metaHarnessCampaignRunner.js`, `harnessOfHarnessesOptimizer.js`, `sourceTreeVariantRunner.js` |
| RHO | `src/harness-sidecar/rho/coresetBuilder.js`, `replayBatchRunner.js`, `groupedRerollRunner.js`, `longitudinalImprovementTracker.js`, `selfValidation.js`, `selfConsistency.js`, `selfPreferenceJudge.js`, `modelRouterHardCases.js` |
| BES | `src/harness-sidecar/bes/*`, especially `laneRuntime.js`, `liveBesFusion.js`, `laneContracts.js`, `trajectoryOperators.js`, `denseSubgoalVerifier.js`, `modelAssistedDenseJudgment.js`, `globalLineageTracker.js` |
| Model council/router | `src/harness-sidecar/swarm/modelCouncil.js`, `modelDebateEvidence.js`, `src/harness-sidecar/model/*`, `src/harness-sidecar/evals/modelCouncilPassK.js` |
| Visual/VLM | `src/harness-sidecar/vlm/*`, `src/harness-sidecar/meta/visualFrontier.js`, `visualPolicyEvolution.js`, `src/harness-sidecar/model/multimodalRequestBuilder.js` |
| A2A / external agents | `src/harness-sidecar/interop/*` |
| Governance and trust | `src/harness-sidecar/core/trustKernelBoundary.js`, `core/approvalResume.js`, `meta/promotionPolicy.js`, `meta/productionAutonomyPolicy.js`, `meta/rollbackDrillRunner.js`, `security/modelVisibleQuarantine.js` |
| Operator evidence | `src/harness-sidecar/server.js`, `src/server.js`, `src/harness/harnessClient.js`, `public/app.js`, `public/index.html`, `src/harness-sidecar/meta/capabilityGoalStatus.js` |

## MemGraphRAG

### Paper Standard

MemGraphRAG is about graph construction quality under global memory. The paper's target is not merely "store facts in a graph." It is a collaborative extraction society with shared memory so local extraction agents preserve global thematic consistency, resolve logical conflicts, maintain connectivity, and support hierarchical retrieval over the resulting graph.

### What Helios Has

Helios has a strong deterministic memory substrate:

- local and global memory graph layers;
- memory graph runtime and graph constructor;
- extraction society role outputs;
- guarded extraction/adjudication hooks;
- conflict resolver and provenance resolution agents;
- memory evals for active fact precision, conflict quality, evidence coverage, connectivity, retrieval hit rate, and budget efficiency;
- memory-aware and hierarchical retrievers;
- graph snapshots, migration history, decay, and consolidation records;
- memory graph evidence packets that can move through RHO/BES/adaptive-search lanes.

### What Is Still Missing

The missing piece is production model-assisted graph construction:

- model-backed extraction roles that run continuously under policy gates;
- production guarded resolution agents over retrieved passages;
- learned or model-assisted conflict adjudication at scale;
- large eval suites over real corpora, not only deterministic fixtures;
- broader graph schema migration/versioning under load;
- deeper tuning of hierarchical retrieval budgets and bridge thresholds.

### Proof Needed

Helios needs repeated graph construction runs on stable corpora that show:

- fewer unsupported facts;
- fewer unresolved conflicts;
- better graph connectivity;
- improved retrieval hit rate;
- bounded cost;
- no secret/path/authority leakage through model-visible memory fields.

## Meta-Harness

### Paper Standard

Meta-Harness treats the harness itself as the optimization target. The proposer reads prior candidates' source code, scores, execution traces, and other artifacts through the filesystem. Evaluation is externalized: a separate harness scores candidates and writes results back so the proposer can reason over prior experience.

### What Helios Has

Helios has many of the right filesystem and lineage primitives:

- trace and artifact stores;
- candidate archives;
- harness run store;
- source/config/trace/metric materialization;
- isolated source-tree variant workspaces;
- proposer context;
- replay evidence and sweep metadata;
- longitudinal frontier records;
- campaign runner and harness-of-harnesses optimizer evidence;
- promotion policy and approval-gated apply.

### What Is Still Missing

The missing piece is full autonomous code-space search at scale:

- repeated evaluate-log-propose cycles over many complete harness candidates;
- proposer access to broad prior candidate source, traces, and scores as its primary optimization interface;
- large benchmark sweeps over independent source/config variants;
- many full executable harness variants, not just deterministic or partial artifact directories;
- operator dashboards over full harness implementations and frontier deltas.

Helios deliberately blocks self-authorized active workspace mutation. That is good. The goal is not to remove that boundary; the goal is to make the candidate/evaluation loop richer while keeping apply approval-gated.

### Proof Needed

Helios needs a run history showing that isolated harness variants improve over baseline across stable held-out tasks while:

- preserving source-tree isolation;
- writing complete source/config/trace/metric/replay artifacts;
- recording comparable scores;
- keeping active workspace mutation behind approval;
- maintaining rollback and trust-kernel evidence.

## RHO

### Paper Standard

RHO improves a harness from unlabeled past trajectories. The pipeline is:

1. select a hard and diverse coreset;
2. re-solve selected tasks in parallel;
3. extract self-validation and self-consistency signals;
4. generate candidate harness updates;
5. select by pairwise self-preference.

The important property is that the system improves from its own trajectory history without relying on a labeled validation set.

### What Helios Has

Helios has a strong RHO substrate:

- coreset builder;
- difficulty/diversity metadata;
- embedding-aware deterministic DPP-like selection;
- replay batch runner;
- grouped reroll runner;
- held-out variants;
- self-validation;
- self-consistency;
- self-preference evidence;
- candidate-family deltas;
- future hard-case emission;
- longitudinal improvement tracker;
- model-router hard cases.

### What Is Still Missing

The missing piece is production replay practice:

- production embedding providers over large trajectory histories;
- larger DPP selection beyond precomputed vectors and deterministic fallbacks;
- larger grouped rerolls over stable held-out tasks;
- broader candidate-family comparison across code, research, memory, visual, tool, swarm, and safety tasks;
- pairwise self-preference as stronger selection evidence while still not becoming automatic authority;
- longitudinal replay budgets and frontier dashboards.

### Proof Needed

Helios needs repeated RHO cycles showing that RHO-selected hard and diverse trajectories produce candidate harness changes that improve held-out future-task performance, while tracking whether prior failure modes are reduced:

- baseline vs candidate-family replay scores;
- self-validation improvements;
- self-consistency improvements;
- self-preference rationale quality;
- regression tracking;
- cost and latency accounting;
- rollback and approval evidence for any promoted change.

## BES

### Paper Standard

BES couples forward candidate evolution with backward goal decomposition. The forward side uses evolution operators to escape ordinary rollout neighborhoods. The backward side decomposes tasks into checkable subgoals so forward search receives dense intermediate feedback.

### What Helios Has

Helios has a strong BES substrate:

- subgoal planner and scorer;
- backward goal trees;
- bidirectional loop;
- lane contracts;
- lane evidence normalization;
- shared lane runtime;
- live BES fusion;
- trajectory operators;
- model-choice MCTS;
- dense subgoal verifier contracts;
- model-assisted dense judgment behind gates;
- mutation and recombination engines;
- evolution population runner;
- compatible-family metadata;
- champion archive and frontier bridges;
- future hard-case capture.

### What Is Still Missing

The missing piece is full trajectory semantics everywhere:

- forward/backward BES fused into every live lane, not only representative lanes;
- learned/model-assisted dense subgoal verifiers across more subsystems;
- trajectory operator provenance through every live candidate path;
- mutation/recombination across compatible candidate families at runtime scale;
- champion archives connected to populated longitudinal dashboard records;
- deeper use of adaptive-search decisions after selecting explore/refine/replay/stop/evidence actions.

### Proof Needed

Helios needs experiments showing that BES lanes outperform simpler baselines:

- best-of-N or plain replay baselines;
- forward-only search;
- backward-only decomposition;
- combined forward/backward/evolution search;
- runtime candidate-family recombination with regression tracking.

## Model Council And Adaptive Router

### Research Role

The paper set does not make multi-model routing the central claim, but Meta-Harness and RHO both depend on reliable evaluation and improvement signals. In Helios, the model council/router layer is the mechanism for routing, comparing, and calibrating model-backed evidence.

### What Helios Has

Helios has:

- model council runtime;
- bounded debate evidence;
- role-specialized model profiles;
- adaptive router state and rewards;
- AB-MCTS model-choice actions;
- router hard cases;
- model-routing policy evolution;
- A2A model negotiation evidence;
- pass@k reports for best-single, repeated sampling, static council, adaptive council, and calibrated ensemble;
- ensemble calibration and endpoint capacity recommendations.

### What Is Still Missing

The missing piece is production-sized statistical proof:

- pass@k uplift on large stable held-out tasks;
- calibrated ensemble weights over stable benchmark suites;
- persistent router posterior/reward/frontier dashboards;
- endpoint capacity recommendations tied to actual load and latency history;
- bounded model debate as evidence across real workflows.

## Multimodal / VLM

### Research Role

The papers do not center VLM, but Helios cannot become a real organism-level harness without visual/system-state perception. VLM should remain first-class because many real tasks involve UI, PDFs, plots, diagrams, screenshots, OCR, and visual regressions.

### What Helios Has

Helios has:

- visual artifact capture;
- screenshot, PDF, OCR, plot, diagram, and diff workers;
- visual evidence nodes;
- visual benchmark cases;
- visual replay suites;
- visual frontier records;
- visual SwarmCell and visual policy evolution;
- visual RHO/BES/memory references;
- multimodal request budgeting;
- VLM-required promotion policy for visual-impacting changes.

### What Is Still Missing

The missing piece is production visual continuity:

- larger visual replay suites;
- visual frontier dashboards over time;
- VLM-backed judgment calibrated against artifacts;
- visual evidence integrated across memory, RHO, BES, A2A, and governance at runtime scale;
- repeated UI/PDF/chart/diagram regression cycles.

## A2A And Network-Of-Networks

### Research Role

A2A is the bridge from local harness substrate to network-of-networks behavior. The papers can be implemented in a single process for experiments, but Helios' target architecture needs nested swarms, external helpers, local/global harnesses, and peer agents.

### What Helios Has

Helios has:

- agent cards;
- agent router;
- external agent gateway;
- durable local inbox/outbox;
- endpoint registry;
- negotiation envelopes;
- streaming envelopes;
- delegated capability tokens;
- issuer secret providers;
- production queue provider abstraction;
- multi-hop lineage;
- root/symlink-safe durable store checks;
- external claim downgrading and model-visible quarantine.

### What Is Still Missing

The missing piece is no longer the absence of local transport primitives. It is deployed external peer practice:

- deployed long-running external A2A server/client services per agent;
- production queue backends beyond local JSON adapters;
- stable issuer-secret operations across real external processes;
- independent subagent-to-subagent negotiation with real external peers;
- lineage surviving real multi-hop agent -> SwarmCell -> swarm -> local harness -> global harness flows.

## Governance And Trust Kernel

### Current Position

The trust kernel should stay non-self-modifying. This is a deliberate divergence from more permissive paper systems. Helios should let evidence influence candidate generation, routing, replay, review, and operator recommendations. It should not let evidence directly apply code, promote candidates, mark external claims verified, weaken verifier floors, or bypass approval.

Current anchors:

- `src/harness-sidecar/core/trustKernelBoundary.js`
- `src/harness-sidecar/meta/promotionPolicy.js`
- `src/harness-sidecar/meta/productionAutonomyPolicy.js`
- `src/harness-sidecar/meta/rollbackDrillRunner.js`
- `src/harness-sidecar/security/modelVisibleQuarantine.js`
- `src/harness-sidecar/core/approvalResume.js`

### Remaining Governance Work

The remaining work is operational proof:

- production autonomy levels by candidate type;
- production approval narrowing rules for low-risk reversible changes;
- production escalation rules for high-risk changes;
- policy for when external A2A evidence can influence candidates;
- recurring rollback drills;
- human-reviewed escalation history;
- dashboards for memory health, visual health, trust health, swarm health, RHO health, and frontier drift.

## Capability Status Read

The current capability status definitions correctly separate coverage from proof:

- `benchmark_spine` can become `production_evidence_available` only after persisted replay reports plus operator/frontier dashboard snapshots.
- `meta_harness_loop`, `rho_at_scale`, `memgraphrag_depth`, `bes_full_lanes`, `multimodal_system_sense`, `a2a_external_durability`, and `governance_autonomy` remain production-gated until their specific evidence requirements are satisfied.
- `soul_coverage` and `oversoul_coverage` are implemented substrate/advisory evidence, not nested execution.
- `level4Proven` remains false by design.

This is the right posture. The status surface should not become a marketing label. It should stay a contract for what evidence exists.

## What Would Close The Gap

The next phase should be called "production evidence loop" rather than "architecture expansion."

Required proof:

1. Stable held-out benchmark suites
   - code, research, memory, visual, tool, swarm, safety, and governance tasks;
   - versioned manifests;
   - repeatable baselines.

2. Recurring replay cycles
   - scheduled runs;
   - baseline/candidate-family comparison;
   - regression tracking;
   - cost/latency/budget accounting.

3. Persisted longitudinal dashboard records
   - frontier trend;
   - operator snapshots;
   - memory health;
   - visual health;
   - trust health;
   - router/council health;
   - RHO/BES improvement health.

4. Full harness-variant sweeps
   - many isolated source-tree variants;
   - complete source/config/trace/metric/replay artifacts;
   - proposer access to prior candidate directories;
   - evaluator writes scores outside the proposer.

5. Guarded model-assisted roles
   - memory extraction/adjudication roles;
   - BES dense subgoal judges;
   - VLM artifact judges;
   - model debate/council critics;
   - all evidence-only and quarantined.

6. Real A2A peer transport
   - long-lived server/client endpoints;
   - restart-persistent queues;
   - stable issuer secrets;
   - scoped delegated trust;
   - multi-hop lineage across real processes.

7. Production governance history
   - repeated rollback drills;
   - approval/escalation logs;
   - external evidence policy decisions;
   - verifier-floor preservation;
   - human-reviewed promotion records.

## Recommended Execution Order

1. Build the benchmark spine first.
   - Without stable suites, RHO, BES, Meta-Harness, router, and dashboards cannot prove anything.

2. Turn the implemented dashboard surfaces into populated longitudinal records.
   - The endpoints, stores, and UI shells exist. Fill them with recurring replay, frontier, rollback, and health records.

3. Scale RHO and Meta-Harness together.
   - RHO selects hard cases and diagnoses failures.
   - Meta-Harness generates/evaluates harness variants.
   - Both should write evidence into the same longitudinal frontier.

4. Add guarded model/VLM judges behind existing gates.
   - Use them to enrich evidence, not to grant authority.

5. Push BES deeper into live lanes.
   - Every lane should carry subgoals, trajectory provenance, compatible-family metadata, and dense evidence.

6. Promote A2A from local contract to real peer transport.
   - Do this after the local evidence loops are measurable, so external agents have clear contracts and metrics.

7. Tighten autonomy only after evidence accumulates.
   - Approval narrowing should be based on weeks of rollback, regression, verifier, and trust-risk history.

## Bottom Line

After re-reading the papers against the current codebase, the honest answer is:

Helios Forge is close in architecture, not yet close in empirical proof.

It has implemented the substrate needed for a governed network-of-networks harness:

- memory graph;
- meta-harness artifacts;
- RHO hard-case/replay signals;
- BES lane runtime;
- model council/router evidence;
- visual/VLM evidence;
- local durable A2A;
- trust-kernel and approval boundaries;
- production evidence endpoints and UI surfaces.

The remaining work is to make those pieces run continuously over production-sized workloads and prove improvement over time.

Do not describe Helios as paper-complete or proven Level 4 yet. The accurate description is:

```text
Helios Forge is a safety-gated, evidence-first, paper-shaped Level 4 candidate
direction. It has the paper-shaped loops and composition layer, but still needs
production scale, long-running evidence, learned/model-assisted judgment,
deployed external peer practice, and dashboard records populated by repeated
production evidence before it can be called Level 4-ready or a proven
network-of-networks harness.
```
