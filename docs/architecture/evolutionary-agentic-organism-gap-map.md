# Evolutionary Agentic Organism Gap Map

This document is the single later-reference map for turning Helios Forge from a broad paper-inspired agent harness into a cohesive evolutionary agentic organism: a swarm of swarms, harnesses of harnesses, shared Memory Graph RAG, A2A-linked evidence flow, multimodal perception, and guarded self-improvement over time.

The target is not an unrestricted autonomous system. The target is a self-evolving, non-self-authorizing system:

```text
observe -> remember -> replay -> evolve -> compare -> verify -> promote safely -> remember better
```

Every layer should be able to propose improvements. No layer should be able to silently approve its own durable mutation.

## Current Level

Current state after the latest implementation pass:

- **Architecture maturity:** high. The docs now describe the right shape: swarm of swarms, harnesses of harnesses, Memory Graph RAG, A2A lineage, RHO/BES/adaptive search, trust kernel.
- **Primitive maturity:** medium-high. The repo has real code for SwarmCells, local/global memory, RHO replay, BES primitives, policy evolution, skill evolution, verifier evolution, adaptive search, visual/VLM workers, local A2A scaffolding, and trust gates.
- **Cohesive organism behavior:** early. The pieces exist, but they do not yet all flow through one shared evolutionary envelope.

Approximate level:

| Stage | Current Read |
| --- | --- |
| Current implementation | Level 2.5: swarm harness with self-improvement primitives |
| After BES mesh plan | Level 3.5: self-improving swarm harness with unified evolution envelopes |
| Target architecture | Level 4: network-of-networks harness |
| Paper-grade autonomous research system | Level 5: long-running governed research organism |

## Implemented Substrate

These pieces already exist in the current codebase and should be reused rather than reinvented.

| Area | Current anchors | Status |
| --- | --- | --- |
| Swarm and SwarmCell loop | `src/harness-sidecar/swarm/swarmCellContracts.js`, `swarmCellRuntime.js`, `swarmOrchestrator.js`, `evolutionSwarmPlanner.js`, `evolutionBudgetAllocator.js` | Implemented deterministic proposal loop |
| Local meta-harness | `src/harness-sidecar/meta/localMetaHarness.js`, `localEvolutionLoop.js`, `localCandidateArchive.js`, `localPromotionBlocker.js` | Implemented local evidence/proposal loop |
| Global harness experiments | `src/harness-sidecar/meta/harnessRunStore.js`, `harnessExperimentRunner.js`, `harnessFrontier.js`, `promotionLoop.js`, `promotionPolicy.js` | Implemented run records and frontier comparison |
| Memory Graph RAG | `src/harness-sidecar/memory/*`, `src/harness-sidecar/rag/memoryAwareGraphRetriever.js`, `hierarchicalMemoryRetriever.js` | Strong deterministic skeleton |
| RHO replay | `src/harness-sidecar/rho/coresetBuilder.js`, `replayBatchRunner.js`, `selfValidation.js`, `selfConsistency.js`, `selfPreferenceJudge.js` | Implemented structured replay evidence |
| BES/evolution | `src/harness-sidecar/bes/*`, `src/harness-sidecar/meta/besMetaOptimizer.js`, `verifierEvolutionLoop.js`, `verifierGenome.js` | Strong primitives; shared all-lane runtime still planned |
| Policy evolution | `src/harness-sidecar/meta/*PolicyEvolution.js` | Implemented shadow-policy generators/evaluators |
| Skill evolution | `src/harness-sidecar/skills/*` | Implemented workspace-local skill candidate lifecycle |
| Multimodal/VLM | `src/harness-sidecar/vlm/*`, `src/harness-sidecar/model/multimodalRequestBuilder.js`, `visualPolicyEvolution.js` | Implemented visual artifact/verifier substrate |
| A2A interop | `src/harness-sidecar/interop/a2aSwarmEnvelope.js`, `agentRouter.js`, `externalAgentGateway.js` | Local contract and routing scaffolding |
| Trust kernel | `src/harness-sidecar/core/trustKernelBoundary.js`, `security/*`, approval modules | Implemented non-self-authorizing boundary |

## Gap Layer 1: Before The BES Mesh Plan Lands

These are the main gaps in the current codebase.

1. **No shared BES lane runtime**
   - Missing: `src/harness-sidecar/bes/laneRuntime.js`.
   - Impact: every subsystem has its own partial evolution shape.
   - Needed: one common envelope for candidate, evidence, lineage, RHO replay, dense subgoals, optimization metadata, and blocked promotion summary.

2. **Policy evolution is not uniformly lane-wrapped**
   - Existing policy evolvers produce shadow candidates.
   - Missing: consistent BES/RHO/evidence envelopes for context, compaction, tool, budget, visual, memory, MCP trust, and research policies.

3. **Domain candidates are not uniformly represented**
   - Memory, research, skill, swarm, verifier, and harness candidates do not yet share one candidate schema.
   - Missing: consistent lane candidate records with domain evaluator output, lineage, replay evidence, and promotion constraints.

4. **A2A does not yet carry evolutionary lineage as a tested contract**
   - Existing A2A-shaped modules route local interop.
   - Missing: tested fields for `besLane`, `rhoCaseIds`, `memoryGraphRefs`, `candidateRef`, `lineage`, `trust`, and `requiredVerification`.

5. **Memory Graph RAG is not a standard lane context packet**
   - Existing memory graph and hierarchical retriever work.
   - Missing: compact, bounded context packets for local, SwarmCell, and global graph evidence with provenance, conflicts, and retrieval trace.

6. **Harness-of-harnesses is not yet concrete**
   - Current architecture says harness policies/configs should be evolvable.
   - Missing: a candidate schema for harness configuration, routing policy, verifier policy, memory policy, and coordination policy as optimizable units.

7. **Optimization metadata does not consistently survive across layers**
   - Missing consistent attachment for RHO, adaptive search, ToolTree, trajectory operators, champion archives, frontiers, verifier genomes, A2A lineage, and memory graph context.

## Gap Layer 2: What The BES Mesh Plan Should Close

The plan in `docs/superpowers/plans/2026-06-09-bes-lane-expansion-for-harness-layers.md` should close the composition gaps.

Expected outcomes:

- all evolution layers can call `runBesLaneRuntime`;
- policy, memory, research, skill, swarm, verifier, visual, tool, budget, compaction, and MCP trust candidates share a common evidence envelope;
- RHO replay and dense subgoal evidence are attached where available;
- A2A envelopes preserve candidate lineage and evidence references;
- Memory Graph RAG context packets feed optimization without becoming unreviewed durable memory;
- harness policies and configs can be represented as candidates;
- operator status exposes lane evidence without exposing raw prompts, secrets, full patches, or untrusted content;
- trust-kernel rules block self-approval, failed RHO validation, missing provenance, unsafe MCP trust changes, missing source patch metadata, and memory conflict ambiguity.

After this plan, the system should behave much more like a cohesive network of networks. The remaining work shifts from composition to scale, continuity, learned judgment, and production durability.

## Gap Layer 3: Remaining After The BES Mesh Plan

These are the last major gaps before Helios feels like a mature evolutionary agentic organism.

### 1. Paper-Grade Memory Graph RAG

Current memory is a strong deterministic skeleton. Remaining work:

- model-assisted extraction society with guarded roles;
- provenance-retrieving conflict adjudication;
- evals for active fact precision, conflict quality, connectivity, retrieval hit rate, and budget efficiency;
- graph schema migrations and snapshot versioning;
- memory decay, consolidation, and long-term lesson distillation;
- multimodal evidence nodes for screenshots, PDFs, diagrams, charts, UI states, and visual verifier artifacts.

### 2. Paper-Grade RHO

Current RHO has coreset and replay primitives. Remaining work:

- difficulty-diverse and embedding-diverse case selection;
- larger grouped rerolls across held-out tasks;
- candidate-family comparison rather than single-candidate checks;
- stronger self-preference and self-consistency scoring;
- replay schedules across coding, research, memory, visual, tool, swarm, and safety tasks;
- longitudinal tracking of whether promoted candidates keep improving future tasks.

### 3. Paper-Grade Meta-Harness

Current global harness experiments compare candidates. Remaining work:

- many complete runnable harness variants;
- richer benchmark directories with source/config/trace/metric artifacts;
- Pareto frontier over stable benchmark suites;
- harness-of-harnesses candidates that optimize the optimizer itself;
- repeated propose/evaluate/log/propose cycles over time;
- strict separation between candidate source trees and active workspace apply.

### 4. Full BES Semantics Across Every Lane

Current BES primitives are strong but not uniformly fused. Remaining work:

- forward/backward BES in every lane;
- lane-specific dense subgoal verifiers;
- trajectory operator provenance through every candidate;
- mutation/recombination across compatible candidate families;
- champion archives connected to global frontier records;
- adaptive search deciding when to explore, refine, replay, stop, or request evidence;
- learned or model-assisted subgoal/verifier judgment where deterministic tests are too weak.

### 5. Multimodal And VLM As First-Class System Senses

This must not remain a visual-verifier side branch. Multimodal evidence should be a first-class signal in the organism.

Required upgrades:

- **Visual SwarmCell:** a dedicated SwarmCell for screenshots, UI states, diagrams, plots, PDFs, OCR, charts, and generated artifacts.
- **Visual RHO cases:** collect false positives, false negatives, missing screenshots, bad crops, OCR misses, PDF extraction errors, diagram misreads, chart misreads, and UI regressions.
- **Visual BES lane:** evolve crop policy, artifact capture policy, OCR/VLM routing, visual rubric weights, confidence thresholds, retry policy, and artifact retention.
- **Multimodal Memory Graph RAG:** store visual evidence references as graph nodes linked to claims, tasks, source files, UI states, verifier outcomes, and replay cases.
- **A2A visual references:** pass artifact references and hashes, not giant raw blobs, between agents/swarms/harnesses.
- **Meta-Harness visual benchmarks:** compare visual policy candidates over held-out UI/artifact/PDF/diagram tasks.
- **Trust-kernel visual gates:** block promotion for UI, PDF, image, diagram, chart, or VLM-impacting changes when visual evidence is absent or failed.
- **Multimodal request policy:** decide when to spend VLM budget versus text-only reasoning, and feed that decision back into budget/adaptive search.

Success criterion:

```text
Visual evidence is retrieved, replayed, evolved, and trusted through the same lane envelope as text/code/tool evidence.
```

### 6. Durable A2A Network Behavior

Current A2A is local contract/routing scaffolding. Remaining work:

- durable inbox/outbox;
- message retries, cancellation, progress protocol, and correlation IDs;
- peer discovery and long-lived agent identity;
- streaming support where useful;
- signed or otherwise trust-scoped delegated capability tokens;
- external-agent quarantine and evidence validation;
- A2A lineage surviving multi-hop agent -> SwarmCell -> swarm -> local harness -> global harness flows.

### 7. Benchmarked Long-Running Improvement

An organism-like system needs continuity. Remaining work:

- stable held-out benchmark suites;
- recurring replay jobs;
- longitudinal frontier records;
- promotion rollback drills;
- regression tracking after every promoted candidate;
- budget-aware improvement accounting;
- dashboards for memory health, visual health, trust health, swarm health, RHO health, and frontier drift.

### 8. Governance And Autonomy Tuning

The trust kernel should stay non-self-modifying. Remaining work:

- formal autonomy levels by candidate type;
- approval narrowing rules for low-risk reversible changes;
- escalation rules for high-risk changes;
- policy for when external A2A evidence is allowed to influence candidates;
- policy for when VLM evidence is required;
- operator override and audit trail;
- clear rollback and quarantine behavior for every promoted artifact.

## Unified Capability Checklist

Use this checklist to know when the "evolutionary agentic organism" target is close.

- [ ] Every lane emits a common BES evidence envelope.
- [ ] Every candidate has lineage, evidence references, evaluator output, and promotion status.
- [ ] RHO hard cases can originate from every layer.
- [ ] Memory Graph RAG context is available to every lane.
- [ ] Multimodal evidence is represented in memory, replay, A2A, and trust gates.
- [ ] A2A envelopes preserve lineage and trust metadata across nested swarms.
- [ ] Harness policies/configs are candidates in a harness-of-harnesses loop.
- [ ] Adaptive search can allocate budget across text, tool, swarm, visual, replay, and verifier actions.
- [ ] Global frontier records compare quality, safety, reliability, cost, latency, maintainability, visual confidence, memory health, and trust risk.
- [ ] Promotions require replay, verifier, provenance, rollback, and approval evidence.
- [ ] Rejected candidates and failed replays become future hard cases.
- [ ] The system demonstrates improvement over a held-out benchmark suite across multiple cycles.

## Recommended Fill-In Order

1. Implement the BES mesh composition plan.
2. Promote VLM/multimodal evidence to first-class lane, memory, RHO, and trust inputs.
3. Harden Memory Graph RAG runtime and evals.
4. Scale RHO replay across held-out multimodal and text/code/tool tasks.
5. Add concrete harness-of-harnesses candidate schemas.
6. Add durable A2A lineage/reference metadata before full peer transport.
7. Build long-running benchmark/frontier loops.
8. Tune autonomy levels and governance.

## North Star

The final behavior should feel like one coordinated system with many specialized parts:

```text
agents sense locally
SwarmCells consolidate locally
swarms coordinate tactically
local harnesses optimize locally
global harnesses compare strategically
Memory Graph RAG remembers across time
A2A moves evidence across boundaries
RHO finds hard cases
BES evolves candidates
VLM sees what text cannot
the trust kernel decides what becomes durable
```

That is the line: self-evolving, memory-grounded, multimodal, networked, and governed.
