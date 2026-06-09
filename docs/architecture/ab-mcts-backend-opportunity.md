# AB-MCTS Backend Opportunity

## Decision

AB-MCTS is not redundant with Helios Forge, but it should be adopted as a scheduler policy rather than imported as a second meta harness.

Helios already has several adjacent pieces:

- UCT-style tree selection in `src/harness-sidecar/bes/mctsPolicy.js`
- Tool-tree planning in `src/harness-sidecar/bes/toolTreePlanner.js`
- BES and RHO evolution loops in `src/harness-sidecar/meta/*`
- Evolution-aware swarm scheduling in `src/harness-sidecar/swarm/attemptScheduler.js`
- Verifier scores, visual evidence, and task outcomes that can act as external rewards

The Sakana AB-MCTS idea adds a missing online choice: should the harness spend the next attempt going wider with a fresh candidate, or deeper by refining a promising existing candidate? Multi-LLM AB-MCTS adds a second policy choice: which model, profile, or worker type should produce the next candidate?

## Why It Could Help

AB-MCTS uses feedback to balance broad repeated sampling with deeper refinement. That maps naturally to Helios:

- wide: spawn diverse swarm attempts, new tool plans, new retrieval packs, or new verifier candidates;
- deep: refine a current champion, repair a failing patch, expand a promising trace, or ask a specialist worker to improve an existing attempt;
- model/profile arm: choose between local VLM, code worker, research worker, verifier worker, or future remote model endpoints based on observed reward.

This is especially useful when the current RHO/BES loop has many possible next actions but only a limited tool/model budget.

## Suggested Integration

Add a small policy module:

`src/harness-sidecar/bes/adaptiveSearchScheduler.js`

Responsibilities:

- maintain per-task reward statistics for `go_wider`, `go_deeper`, and optional `model_or_profile` arms;
- use Thompson sampling or a compatible deterministic test double for action choice;
- accept verifier, cost, visual, and swarm outcome feedback;
- emit trace events explaining why the next action was selected;
- stay advisory until enough evidence proves it improves outcomes.

Hook it into:

- `src/harness-sidecar/swarm/attemptScheduler.js` before `planEvolutionSwarmAttempts`;
- `src/harness-sidecar/swarm/swarmOrchestrator.js` when attempt scores and verifier results arrive;
- `src/harness-sidecar/meta/besMetaOptimizer.js` when population diversity collapses or champion refinement stalls.

## Implementation Status

Implemented:

- Core scheduler: `src/harness-sidecar/bes/adaptiveSearchScheduler.js`
- Subsystem adapters: `src/harness-sidecar/bes/adaptiveSearchAdapters.js`
- Swarm scheduling integration: `src/harness-sidecar/swarm/attemptScheduler.js`
- Swarm outcome feedback and trace events: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Disabled-by-default config: `features.adaptiveSearch` and `adaptiveSearch.*`

Still pending:

- Meta optimizer context routing for live BES/RHO policy candidates.
- UI observability for current arm, reward, and wider/deeper balance.
- Trace replay UI that can replay AB-MCTS choices without mutating runtime state.

## Guardrails

- Do not replace RHO/BES scoring. AB-MCTS should decide allocation of the next attempt, not redefine all reward semantics.
- Keep it behind a config flag at first.
- Cap branching by the existing budget hierarchy.
- Treat multi-model selection as profile selection until Helios has stable multi-endpoint routing.
- Require held-out verifier checks before any evolved AB-MCTS policy can promote itself.

## Initial Tests

Add:

- `tests/harness-bes-adaptive-search-scheduler.test.js`
- `tests/harness-swarm-ab-mcts-planner.test.js`

Key cases:

- chooses wider when no branch has enough evidence;
- shifts deeper when a branch has strong verifier reward;
- downshifts to cheaper profiles under budget pressure;
- records trace metadata for selected action and sampled arm;
- keeps policy advisory unless explicitly enabled.

## Follow-On Plans

- `docs/superpowers/plans/2026-06-09-wide-ab-mcts-deployment.md`: deploy AB-MCTS broadly as the online budget/search scheduler across swarm, tool loops, meta evolution, verifiers, visual/VLM, research, memory, and skill evolution.
- `docs/superpowers/plans/2026-06-09-self-authored-skill-evolution.md`: let Helios propose, evaluate, evolve, and approval-promote workspace-local `SKILL.md` capabilities using Retrospective Harness Optimization, BES, AB-MCTS, and verifier gates.

## Sources

- Sakana AI, "Inference-Time Scaling and Collective Intelligence for Frontier AI", July 1, 2025.
- Sakana AI, "Wider or Deeper? Scaling LLM Inference-Time Compute with Adaptive Branching Tree Search", arXiv 2503.04412.
- SakanaAI/treequest, Apache-2.0 tree-search framework for inference-time scaling.
