# RHO BES Evolution Expansion Roadmap

This document records additional places where Helios Forge can apply the RHO + BES + evolution + meta-promotion pattern. It is a roadmap for later work, not a claim that every subsystem should become self-mutating immediately.

Relevant external references:

- MemGraphRAG: Memory-based Multi-Agent System for Graph Retrieval-Augmented Generation, `https://arxiv.org/pdf/2606.00610`
- Retrospective Harness Optimization: self-supervised harness improvement from past trajectories using coreset selection, group rollout, self-validation, self-consistency, candidate harness proposals, and pairwise self-preference, `https://arxiv.org/pdf/2606.05922`
- SakanaAI TreeQuest / AB-MCTS: adaptive branching tree search for deciding whether inference-time search should go wider, go deeper, switch model/profile/worker, gather evidence, or stop.

## Core Pattern

The reusable pattern is:

1. **RHO selects hard cases.** Mine traces, verifier outcomes, visual evidence, budget gates, rejected approvals, and failed runs for high-signal cases.
2. **BES decomposes the target.** Build backward goals and dense partial-credit criteria for what a better policy should satisfy.
3. **Evolution searches candidates.** Generate policy/genome/rubric/profile candidates, preserve diversity, and archive winners and informative failures.
4. **AB-MCTS allocates online search budget.** Use a TreeQuest-style ask/tell scheduler to decide whether the next unit of work should go wider, go deeper, switch worker/model/profile, gather more evidence, or stop.
5. **Meta-promotion gates changes.** Promote only after replay, held-out tests, verifier evidence, rollback metadata, and approval policy allow it.

The goal is not cleverness for its own sake. The goal is to make each subsystem more measurable, adaptive, and safer over time.

## AB-MCTS As The Cross-Cutting Scheduler

AB-MCTS should be treated as part of the expanded RHO + BES opportunity stack, not as a separate research toy. RHO decides what past failures matter, BES turns those failures into candidate goals and lineages, and AB-MCTS decides how to spend the next live budget unit across those candidates.

In Helios terms, the TreeQuest-style scheduler should choose among actions such as:

- `go_wider`: sample another candidate, swarm attempt, retrieval pack, verifier variant, visual artifact, research path, or skill candidate;
- `go_deeper`: refine the current champion, expand a promising trace, improve a verifier/skill candidate, or repair a failing patch;
- `switch_worker`: move the next attempt to a different subagent role, model profile, VLM path, verifier worker, or research worker;
- `gather_evidence`: spend budget on replay, verifier evidence, screenshots, OCR, graph neighbors, citations, or contradiction checks;
- `stop_or_promote`: stop search, report, or queue a promotion candidate for the existing approval gates.

This gives Helios the algorithm-stacking benefit:

`RHO -> hard cases -> BES -> candidates/goals -> AB-MCTS -> next budget allocation -> verifiers/replay -> promotion gates`

The implementation plan lives in `docs/superpowers/plans/2026-06-09-wide-ab-mcts-deployment.md`. The self-authored skill lane that uses the same stack lives in `docs/superpowers/plans/2026-06-09-self-authored-skill-evolution.md`.

## Priority Targets

| Priority | Subsystem | Why it matters | Candidate evolved objects |
| --- | --- | --- | --- |
| 1 | AB-MCTS adaptive search scheduler | Every subsystem below needs a budget allocator that can choose wider, deeper, worker/profile switching, evidence gathering, or stopping. | scheduler arms, reward normalizers, branch statistics, advisory/enabled policy |
| 2 | Context and RAG selection | Better context improves every downstream agent/tool/verifier decision. | retrieval weights, graph/RAG blend, chunk budgets, memory inclusion policy |
| 3 | Memory-guided graph construction | MemGraphRAG-style global memory can prevent noisy, contradictory, fragmented GraphRAG indexes. | schema/fact/passage layers, pending/active promotion, conflict adjudication, graph bridging |
| 4 | Tool loop policy | Tool stalls, malformed calls, retries, and approval dead ends directly block task completion. | tool selection rules, retry policy, recovery prompts, approval escalation thresholds |
| 5 | Budget allocation | The harness needs to know when to spend on model calls, verifiers, VLM, retrieval, or subagents. | budget profiles, downshift rules, confidence thresholds, verifier/VLM spend policy |
| 6 | Verifier selection and routing | Verifier choice is the safety backbone, especially for visual/UI and risky code changes. | selector rules, verifier bundles, rerun policy, flake handling |
| 7 | Swarm scheduling | Swarm currently runs near evolution but is not yet driven by it. | subagent strategies, island assignments, budget weights, specialist profiles |
| 8 | Visual/VLM pipeline | Visual evidence is high value but easy to overtrust or underspecify. | capture strategy, VLM rubric, diff thresholds, OCR/PDF/image routing |
| 9 | Memory promotion and decay | Bad durable memory can poison future runs; good memory compounds. | promotion policy, decay rules, contradiction penalties, retrieval priority |
| 10 | MCP and capability trust | External tools and capability packages are trust boundaries. | trust tiers, quarantine rules, allow/deny policy, poisoning checks |
| 11 | Deep Research quality loop | Research tasks need citation, contradiction, novelty, and figure-evidence discipline. | source ranking, claim extraction prompts, contradiction checks, report templates |
| 12 | Evidence-gated approvals | Low-risk unattended evolution is useful, but unsafe self-approval would be dangerous. | auto-approval tiers, rollback requirements, human-required boundaries |
| 13 | Self-authored skill evolution | Repeated hard cases should become reusable, testable, workspace-local skills when evidence supports them. | skill candidates, trigger rules, workflow steps, safety constraints, package/capability records |

## Target Details

### 1. AB-MCTS Adaptive Search Scheduler

Use TreeQuest-style AB-MCTS as the online scheduler for the whole RHO + BES system. It should not replace RHO, BES, verifier scoring, or promotion policy. It should decide how the next unit of budget is allocated.

Potential changes:

- Add `src/harness-sidecar/bes/adaptiveSearchScheduler.js` with ask/tell-style state.
- Normalize rewards from verifier results, BES goal satisfaction, swarm outcomes, VLM evidence, cost, latency, and approval results.
- Add subsystem adapters for swarm, tool loops, meta evolution, visual/VLM, research, memory/RAG, and skill evolution.
- Keep the scheduler advisory by default, behind a feature flag, and replayable against historical traces.
- Emit trace events that explain selected arms, arm scores, and budget impact.

Likely anchors:

- `src/harness-sidecar/bes/adaptiveSearchScheduler.js`
- `src/harness-sidecar/bes/mctsPolicy.js`
- `src/harness-sidecar/swarm/attemptScheduler.js`
- `src/harness-sidecar/meta/besMetaOptimizer.js`
- `src/harness-sidecar/budget/*`
- `docs/superpowers/plans/2026-06-09-wide-ab-mcts-deployment.md`

### 2. Context And RAG Selection

Use RHO to collect tasks where missing, noisy, stale, or overlarge context hurt the run. BES should decompose "good context" into goals such as enough relevant files, low noise, graph-neighbor coverage, memory usefulness, and token efficiency.

Potential changes:

- Evolve retrieval weights for lexical, graph, memory, and recent-trace signals.
- Tune context-pack budgets by task type.
- Penalize context packs that include contradicted memory or irrelevant large files.
- Promote policies only after trace replay shows better verifier/task outcomes.

Likely anchors:

- `src/harness-sidecar/rag/*`
- `src/harness-sidecar/context/*`
- `src/harness-sidecar/graph/*`
- `src/harness-sidecar/memory/*`

### 3. Memory-Guided Graph Construction

Fold in the strongest lesson from MemGraphRAG: graph construction should be governed by shared global memory, not isolated chunk extraction. Helios should add explicit schema, fact, and passage/provenance memory layers, then use RHO+BES+evolution to tune when extracted knowledge becomes active and how conflicts are adjudicated.

Potential changes:

- Add a three-layer memory model: schema/ontology, fact/triple, and passage/provenance.
- Store extracted facts as pending hypotheses until schema/frequency/evidence thresholds make them active.
- Detect mutually exclusive, temporal, granularity, stale/superseded, and source-confidence conflicts.
- Resolve conflicts through evidence-backed adjudication that retrieves the original traces, passages, artifacts, or source spans.
- Add memory-guided graph bridging through type-based and similarity-based edges so graph islands do not fragment.
- Add query-seeded propagation, such as lightweight Personalized PageRank, over active memory/code/claim/evidence graph nodes.
- Let RHO select graph-construction failures and let BES/evolution tune thresholds for activation, conflict detection, bridging, and retrieval.

Likely anchors:

- `src/harness-sidecar/memory/graphMemoryStore.js`
- `src/harness-sidecar/memory/graphMemoryMaintenance.js`
- `src/harness-sidecar/memory/memoryConflictResolver.js`
- `src/harness-sidecar/rag/graphRagComposer.js`
- `src/harness-sidecar/rag/unifiedContextComposer.js`
- `src/harness-sidecar/graph/*`

### 4. Tool Loop Policy

Use RHO to mine unknown-tool failures, malformed arguments, stalled loops, repeated no-progress events, and approval-required dead ends. BES can define a better tool loop as one that advances goals, repairs calls, avoids repeated failures, and asks for approval only when needed.

Potential changes:

- Evolve tool selection/ranking rules.
- Evolve repair prompts for malformed tool calls.
- Tune retry limits and no-progress detection.
- Learn when to ask for approval versus use a safe read-only alternative.

Likely anchors:

- `src/harness-sidecar/tools/toolLoopController.js`
- `src/harness-sidecar/tools/defaultToolRegistry.js`
- `src/harness-sidecar/reliability/toolCallRecovery.js`
- `src/harness-sidecar/reliability/noProgressDetector.js`

### 5. Budget Allocation

Use RHO to find runs where the harness spent too much on low-value work or stopped too early. BES should define budget goals across quality, safety, cost, latency, and confidence.

Potential changes:

- Evolve budget profiles by task type.
- Learn when to spend extra on VLM, verifiers, research, or swarm attempts.
- Downshift expensive branches when confidence is already high.
- Escalate verification when confidence is low or evidence conflicts.

Likely anchors:

- `src/harness-sidecar/budget/*`
- `src/harness-sidecar/context/contextPressure.js`
- `src/harness-sidecar/tools/finalValidator.js`

### 6. Verifier Selection And Routing

Verifier evolution already exists, but selector evolution can decide which verifiers to run, when to add visual checks, and when to rerun or quarantine flaky checks.

Potential changes:

- Evolve changed-file-to-verifier routing.
- Learn visual verifier companions for UI/frontend/VLM-adjacent changes.
- Track false positives, false negatives, flakes, runtime, and confidence drift.
- Use held-out verifier cases before promotion.

Likely anchors:

- `src/harness-sidecar/tools/verifierSelector.js`
- `src/harness-sidecar/tools/verifierRunner.js`
- `src/harness-sidecar/meta/verifierEvolutionLoop.js`
- `src/harness-sidecar/tools/verifierConfigApply.js`

### 7. Swarm Scheduling

Swarm scheduling deserves its own plan in `docs/architecture/swarm-evolution-integration-plan.md`. The high-level goal is to let BES/RHO/evolution drive subagent strategy, budget, diversity, and specialist assignment.

Potential changes:

- Spawn attempts from evolved strategy genomes.
- Preserve island diversity across subagents.
- Use evolved fitness to allocate attempt budgets.
- Feed champion/rejected attempt outcomes back into RHO and meta evolution.

Likely anchors:

- `src/harness-sidecar/swarm/*`
- `src/harness-sidecar/bes/*`
- `src/harness-sidecar/meta/besMetaOptimizer.js`

### 8. Visual And VLM Pipeline

Use RHO to collect visual false positives, false negatives, poor screenshots, OCR misses, PDF extraction misses, and VLM rubric weaknesses. BES should define visual verification goals as artifact quality, relevant view coverage, rubric fit, and threshold reliability.

Potential changes:

- Evolve visual capture strategies.
- Tune VLM rubric strictness and confidence thresholds.
- Route tasks between screenshot, diff, OCR, PDF, figure, plot, and diagram workers.
- Penalize VLM-only passes that lack artifact support.

Likely anchors:

- `src/harness-sidecar/vlm/*`
- `src/harness-sidecar/tools/verifierSelector.js`
- `src/harness-sidecar/rho/coresetBuilder.js`

### 9. Memory Promotion And Decay

Use RHO to identify memories that helped, hurt, contradicted current evidence, or became stale. BES can define durable-memory goals around relevance, correctness, specificity, actionability, and non-conflict.

Potential changes:

- Evolve promotion thresholds.
- Add decay and contradiction penalties.
- Track memory contribution to successful and failed runs.
- Quarantine memory that repeatedly correlates with bad outcomes.
- Reuse active schema/fact/passage memory as stronger provenance for promoted memories.

Likely anchors:

- `src/harness-sidecar/memory/*`
- `src/harness-sidecar/graph/claimEvidenceGraph.js`
- `src/harness-sidecar/core/traceReader.js`

### 10. MCP And Capability Trust

Use RHO to mine suspicious MCP outputs, tool poisoning, excessive permissions, failed capability startups, and unsafe model-visible fields. BES can decompose trust into provenance, permissions, behavior, and output hygiene.

Potential changes:

- Evolve trust tiers and quarantine triggers.
- Tune MCP allow/deny lists by tool and server.
- Add rate-limit and approval policies by trust tier.
- Promote capability records only with provenance and safe defaults.

Likely anchors:

- `src/harness-sidecar/tools/mcpPolicy.js`
- `src/harness-sidecar/tools/mcpRuntime.js`
- `src/harness-sidecar/tools/mcpPoisoningEval.js`
- `src/harness-sidecar/capabilities/*`

### 11. Deep Research Quality Loop

Use RHO to collect weak citations, unsupported novelty, contradictions, source fetch failures, figure-only evidence risk, and report quality issues. BES can define research quality as source support, contradiction handling, claim coverage, and handoff usefulness.

Potential changes:

- Evolve source ranking and source diversity.
- Tune claim extraction and citation verification.
- Improve contradiction and novelty controls.
- Evolve report templates against held-out research tasks.

Likely anchors:

- `src/harness-sidecar/research/*`
- `src/harness-sidecar/graph/claimEvidenceGraph.js`
- `src/harness-sidecar/experiments/*`

### 12. Evidence-Gated Approvals

Use RHO to find approval bottlenecks and rejected proposal patterns. BES can define safe autonomous approval as narrow scope, reversibility, evidence sufficiency, trust, and no hard-boundary crossing.

Potential changes:

- Define approval tiers: `never`, `shadow_only`, `local_config_only`, `reversible_workspace_change`, `human_required`.
- Auto-approve only low-risk, reversible, local config changes after replay and held-out checks.
- Keep branch mutation, secrets, external network expansion, MCP write expansion, verifier safety weakening, and cost/security regression human-required.

Likely anchors:

- `src/harness-sidecar/core/approvalResume.js`
- `src/harness-sidecar/meta/promotionPolicy.js`
- `src/harness-sidecar/tools/verifierConfigApply.js`

### 13. Self-Authored Skill Evolution

Use RHO to identify repeated hard cases that deserve a reusable skill, BES to generate and refine candidate `SKILL.md` files, and AB-MCTS to decide whether to sample wider, refine deeper, gather more held-out evidence, or queue promotion.

This should include source-skill adaptation, not only blank-slate skill writing. If a loaded skill such as a Superpowers skill, Codex skill, Claude skill, Pi skill, or Smithery-installed skill is relevant, Helios should snapshot the original skill into workspace-local metadata, preserve provenance and permission data, then evolve a separate adapted candidate for the current hard cases. The original skill remains inspectable and untouched; the adapted candidate carries lineage, diff evidence, replay evidence, and safety checks.

Skill-creation skills should also be usable as scaffolds. For example, `https://smithery.ai/skills/anthropics/skill-creator` can be installed through the normal skill installer, snapshotted like any other source skill, and used as a structure/rubric seed for generated `SKILL.md` candidates. It should guide skill format, trigger clarity, safety sections, and verification checklists without bypassing RHO/BES evaluation or approval gates.

Potential changes:

- Store skill candidates under `.harness/meta/skill-candidates/<candidateId>/` in shadow mode.
- Store immutable source skill snapshots under `.harness/meta/skill-snapshots/<snapshotId>/` when adapting from an existing loaded skill.
- Treat installed skill-creation skills as advisory scaffolds and rubrics for blank-slate skill candidates.
- Evaluate candidate skills with trace replay, trigger precision checks, verifier evidence, safety scans, and held-out cases.
- Compare adapted candidates against the source snapshot or current loaded skill, not just against no-skill baseline.
- Install approved candidates only into workspace-local `.harness/packages`, then register them through the existing capability store.
- Keep global Pi, Codex, Claude, and home skill folders read-only unless a separate explicit installer path is approved.

Likely anchors:

- `src/harness-sidecar/skills/skillCandidateStore.js`
- `src/harness-sidecar/skills/sourceSkillSnapshotStore.js`
- `src/harness-sidecar/skills/skillEvolution.js`
- `src/harness-sidecar/skills/skillCandidateEvaluator.js`
- `src/harness-sidecar/skills/skillCandidateApply.js`
- `src/harness-sidecar/capabilities/capabilityStore.js`
- `src/harness-sidecar/capabilities/piPackageInstaller.js`
- `docs/superpowers/plans/2026-06-09-self-authored-skill-evolution.md`

## Shared Safety Requirements

Every expansion should preserve these constraints:

- Candidate policies run in shadow mode before promotion.
- Promotion requires replay or held-out cases.
- Risky mutation remains approval-gated.
- Every promoted change has rollback metadata.
- Evolution cannot disable its own verifier, audit, approval, or rollback gates.
- Visual/VLM evidence cannot self-certify without thresholds and artifacts.
- MCP/capability policy remains deny-by-default for untrusted mutations.
- Cost increases require explicit policy allowance or human approval.

## Shared Acceptance Tests

Each subsystem integration should include tests for:

- RHO selects high-signal hard cases from that subsystem.
- BES creates dense goals from those cases.
- AB-MCTS allocates budget between wider search, deeper refinement, worker/profile switching, evidence gathering, and stopping.
- Evolution creates diverse candidates rather than one greedy candidate.
- Memory-guided graph construction keeps extracted knowledge pending until evidence and schema stability allow activation.
- Conflict adjudication retrieves provenance before discarding, refining, or temporally qualifying facts.
- Shadow replay compares baseline and candidate policy.
- Failed or unsafe candidates remain archived but cannot promote.
- Promotion emits audit-ready evidence and rollback metadata.
- Human approval is still required for durable or risky mutations.

## Recommended Next Steps

1. Implement the AB-MCTS adaptive search scheduler behind an advisory feature flag because it becomes the shared allocator for the rest of the expansion.
2. Finish swarm evolution integration because it already has a dedicated plan and clear runtime gap.
3. Add context/RAG policy evolution because it improves every agent path.
4. Add MemGraphRAG-inspired memory-guided graph construction because it makes graph/RAG context globally consistent instead of chunk-local.
5. Add tool-loop policy evolution because tool stalls are direct task blockers.
6. Add budget allocation evolution because it controls spend across BES, VLM, verifiers, and swarm.
7. Expand verifier selector and visual/VLM evolution together because they share evidence and safety thresholds.
8. Add self-authored skill evolution once AB-MCTS and replay-backed promotion are stable enough to evaluate candidate skills safely.

This roadmap should be revisited after each implementation wave. The question after each wave is simple: did the evolved policy improve held-out tasks without weakening safety?
