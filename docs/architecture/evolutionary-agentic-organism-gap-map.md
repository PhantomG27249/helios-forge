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
- **Primitive maturity:** high for a deterministic local harness. The repo has real code for SwarmCells, local/global memory, RHO replay, BES primitives, policy evolution, skill evolution, verifier evolution, adaptive search, visual/VLM workers, durable local A2A queues, governance loops, and trust gates.
- **Cohesive organism behavior:** emerging. The pieces now flow through shared BES lane envelopes and live lane events in representative runtime paths; production-scale continuity and paper-grade learned judgment remain future work.

Approximate level:

| Stage | Current Read |
| --- | --- |
| Current implementation | Level 3.5: self-improving swarm harness with unified evolution envelopes and first live lane wiring |
| After scale/continuity hardening | Level 4: network-of-networks harness |
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
| BES/evolution | `src/harness-sidecar/bes/*`, `src/harness-sidecar/meta/besMetaOptimizer.js`, `verifierEvolutionLoop.js`, `verifierGenome.js` | Strong primitives plus shared lane runtime |
| Policy evolution | `src/harness-sidecar/meta/*PolicyEvolution.js` | Implemented shadow-policy generators/evaluators with BES lane wrappers |
| Skill evolution | `src/harness-sidecar/skills/*` | Implemented workspace-local skill candidate lifecycle |
| Multimodal/VLM | `src/harness-sidecar/vlm/*`, `src/harness-sidecar/model/multimodalRequestBuilder.js`, `visualPolicyEvolution.js` | Implemented visual artifact/verifier substrate |
| A2A interop | `src/harness-sidecar/interop/a2aSwarmEnvelope.js`, `agentRouter.js`, `externalAgentGateway.js`, `delegatedCapabilityTokens.js` | Local durable inbox/outbox, retries, progress/cancel, streaming envelopes, scoped delegated trust |
| Trust kernel | `src/harness-sidecar/core/trustKernelBoundary.js`, `security/*`, approval modules | Implemented non-self-authorizing boundary |

## Gap Layer 1: BES Mesh Composition Now Landed

The first BES mesh composition pass is now implemented. It closes the missing-module and missing-envelope gaps that previously kept the system from behaving like a coordinated evolutionary harness substrate.

1. **Shared BES lane runtime**
   - Implemented: `src/harness-sidecar/bes/laneRuntime.js` and `laneEvidence.js`.
   - Provides one common envelope for candidate, evidence, lineage, optional RHO replay, dense subgoals, optimization metadata, and blocked promotion summary.
   - Lane output is evidence-only; promotion remains disallowed inside the lane runtime.

2. **Policy evolution lane wrappers**
   - Implemented for context, compaction, tool-loop, budget, visual, memory, MCP trust, and research policies.
   - Existing shadow-policy APIs remain intact; wrappers add non-promotable BES/RHO/evidence envelopes.

3. **Domain candidate wrappers**
   - Implemented for memory, research, generated skill candidates, and swarm attempt plans.
   - Local SwarmCell/meta candidates can preserve `besLane` evidence without gaining apply authority.

4. **A2A evolutionary lineage references**
   - Implemented reference fields for `besLane`, `rhoCaseIds`, `memoryGraphRefs`, `candidateRef`, `lineage`, `trust`, and `requiredVerification`.
   - External A2A context is forced to `external: true` and `verified: false` at the gateway boundary.

5. **Memory Graph RAG lane context packet**
   - Implemented compact, bounded context packets for local, SwarmCell, and global graph evidence with provenance, conflicts, and retrieval trace.

6. **Harness-of-harnesses first schema**
   - A shared `harness` lane contract now exists for harness configuration, routing policy, coordination policy, and frontier records.
   - Larger benchmark loops over full runnable harness variants remain future work.

7. **Optimization metadata transport**
   - Lane envelopes preserve domain evidence, dense subgoals, optional RHO replay, adaptive search, ToolTree, trajectory operator, champion archive, frontier, verifier genome, A2A lineage, and memory graph context where supplied.

## Gap Layer 2: Runtime Integration Pass Now Landed

The second pass wires the composition layer into live runtime paths and upgrades several “gap” surfaces into tested first-pass modules.

Implemented:

- `bes_lane.started`, `bes_lane.completed`, and `bes_lane.blocked` events around lane execution.
- Full sidecar runtime calls representative memory, skill, swarm, harness, and research BES lanes and emits `harness_status.updated` snapshots.
- Visual evidence is first-class in BES evidence, visual memory nodes, RHO hard cases, and trust-kernel visual gates.
- Memory graph runtime can ingest observations through extraction society -> local graph -> SwarmCell merge -> global promotion, with migration history, eval hooks, decay, and consolidation records.
- A2A now has local durable inbox/outbox records, retry scheduling, progress/cancel records, peer discovery filters, streaming envelopes, and scoped delegated capability signatures.
- Governance now has scheduled replay job planning, budget-aware improvement accounting, rollback drills, autonomy levels, escalation, override, and audit summaries.

Still needed:

- run larger RHO replays and harness experiments over held-out suites;
- connect lane results to persisted longitudinal frontier dashboards over time;
- evolve full runnable harness variants in isolated candidate directories;
- broaden verifier-genome and harness-of-harnesses coverage;
- promote local A2A durability into actual long-lived network endpoints and multi-hop peer transport.

## Gap Layer 3: Long-Running Maturity Gaps

### 1. Paper-Grade Memory Graph RAG

Current memory is a strong deterministic skeleton with runtime extraction composition, eval hooks, migrations, decay, and consolidation. Remaining work:

- model-assisted extraction society with guarded roles;
- provenance-retrieving conflict adjudication;
- larger eval suites for active fact precision, conflict quality, connectivity, retrieval hit rate, and budget efficiency;
- broader graph schema migration coverage;
- long-term lesson distillation beyond first-pass decay/consolidation records.

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

This is now a first-class signal in the local organism, with production-scale expansion still ahead.

Required upgrades:

- **Visual SwarmCell:** a dedicated SwarmCell for screenshots, UI states, diagrams, plots, PDFs, OCR, charts, and generated artifacts.
- **Visual RHO cases:** first-pass visual cases are emitted from verifier evidence; scale still needs broader OCR/PDF/diagram/chart/UI regression suites.
- **Visual BES lane:** first-pass visual evidence enters BES envelopes; deeper crop/artifact/OCR/VLM routing evolution remains.
- **Multimodal Memory Graph RAG:** visual evidence references are graph nodes; richer links to claims, source files, UI states, and replay cases should expand.
- **A2A visual references:** reference passing is supported by the durable envelope shape; artifact hash policy still needs hardening.
- **Meta-Harness visual benchmarks:** compare visual policy candidates over held-out UI/artifact/PDF/diagram tasks.
- **Trust-kernel visual gates:** block promotion for UI, PDF, image, diagram, chart, or VLM-impacting changes when visual evidence is absent or failed.
- **Multimodal request policy:** decide when to spend VLM budget versus text-only reasoning, and feed that decision back into budget/adaptive search.

Success criterion:

```text
Visual evidence is retrieved, replayed, evolved, and trusted through the same lane envelope as text/code/tool evidence.
```

### 6. Durable A2A Network Behavior

Current A2A is now a durable local interop substrate, not only scaffolding. Implemented locally:

- durable inbox/outbox;
- message retries, cancellation, progress protocol, and correlation IDs;
- peer discovery and long-lived agent identity;
- streaming support where useful;
- signed or otherwise trust-scoped delegated capability tokens;
- external-agent quarantine and evidence validation;

Remaining work:

- persistent external A2A server endpoints per agent;
- restart-persistent queue storage and stable issuer-secret injection;
- independent subagent-to-subagent negotiation;
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

- [x] Every lane emits a common BES evidence envelope.
- [x] Every candidate has lineage, evidence references, evaluator output, and promotion status.
- [x] RHO hard cases can originate from every major local layer.
- [x] Memory Graph RAG context is available to every lane.
- [x] Multimodal evidence is represented in memory, replay, A2A-compatible envelopes, and trust gates.
- [x] A2A envelopes preserve lineage and trust metadata across nested swarms.
- [x] Harness policies/configs are candidates in a harness-of-harnesses loop.
- [ ] Adaptive search can allocate budget across text, tool, swarm, visual, replay, and verifier actions.
- [ ] Global frontier records persist longitudinal quality, safety, reliability, cost, latency, maintainability, visual confidence, memory health, and trust risk.
- [ ] Promotions require replay, verifier, provenance, rollback, and approval evidence.
- [ ] Rejected candidates and failed replays become future hard cases.
- [ ] The system demonstrates improvement over a held-out benchmark suite across multiple cycles.

## Recommended Fill-In Order

1. Implement the BES mesh composition plan.
2. Promote VLM/multimodal evidence to first-class lane, memory, RHO, and trust inputs. **First pass landed.**
3. Harden Memory Graph RAG runtime and evals. **First pass landed; scale remains.**
4. Scale RHO replay across held-out multimodal and text/code/tool tasks.
5. Add concrete harness-of-harnesses candidate schemas.
6. Add durable A2A lineage/reference metadata before full peer transport. **Local durability landed; network transport remains.**
7. Build long-running benchmark/frontier loops. **Governance/job primitives landed; longitudinal dashboards remain.**
8. Tune autonomy levels and governance. **First pass landed.**

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
