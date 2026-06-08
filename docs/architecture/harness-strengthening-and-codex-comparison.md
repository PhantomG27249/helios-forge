# Harness Strengthening And Codex Comparison

This document lists deeper machinery that could make Helios Forge stronger, then compares those ideas with Codex as a reference design. It is not a claim that Helios should clone Codex. Codex is a mature coding-agent product surface; Helios Forge is a local Pi-centered research and meta-harness. The useful question is what Helios should borrow, what it already has that is distinctive, and what it can add to become more trustworthy as it gets more autonomous.

Source baseline for the Codex comparison:

- OpenAI Codex manual, refreshed locally on 2026-06-08.
- Official Codex docs referenced by the manual:
  - `https://developers.openai.com/codex/overview`
  - `https://developers.openai.com/codex/agent-approvals-security`
  - `https://developers.openai.com/codex/app/features`
  - `https://developers.openai.com/codex/skills`
  - `https://developers.openai.com/codex/mcp`
  - `https://developers.openai.com/codex/hooks`
  - `https://developers.openai.com/codex/memories`
  - `https://developers.openai.com/codex/concepts/subagents`

## Core Strengthening Ideas

| Idea | What it adds | Why it matters | Natural Helios anchor |
| --- | --- | --- | --- |
| Verifier reliability scoring | Track false positives, false negatives, flakes, runtime, confidence drift, and regression history per verifier. | A verifier should earn trust over time instead of being trusted because it exists. | `src/harness-sidecar/tools/verifierRunner.js`, `src/harness-sidecar/meta/verifierEvolutionLoop.js` |
| Shadow mode for harness changes | Run proposed BES/RHO/meta/verifier policies beside the active policy without letting them affect decisions. | Lets the harness learn from real tasks without risking live behavior. | `src/harness-sidecar/meta/*`, `src/harness-sidecar/core/traceReader.js` |
| Adversarial regression corpus | Maintain nasty local tasks for prompt injection, bad MCP output, flaky tests, visual mismatch, bad citations, memory poisoning, oversized patches, and approval dead ends. | Gives every harness upgrade a concrete proving ground. | `tests/`, `.harness/evals/`, `src/harness-sidecar/tools/mcpPoisoningEval.js` |
| Causal trace profiler | Cluster trace failures by likely cause: bad context, wrong verifier, tool-loop stall, budget exhaustion, model hallucination, visual failure, approval dead end. | Turns raw traces into diagnosis and prioritization. | `src/harness-sidecar/core/traceReader.js`, `src/harness-sidecar/meta/traceInspector.js` |
| Policy simulator | Replay candidate policies over historical traces before promotion. | Makes meta-evolution measurable instead of vibes-driven. | `src/harness-sidecar/meta/candidateRunner.js`, `src/harness-sidecar/rho/coresetBuilder.js` |
| Rollback and time-travel state | For every approved mutation, persist before/after config, evidence, actor, timestamp, and rollback plan. | Makes self-improvement safer because every change has an escape hatch. | `src/harness-sidecar/core/approvalResume.js`, `src/harness-sidecar/tools/verifierConfigApply.js`, `src/harness-sidecar/tools/gitApplyAdapter.js` |
| Capability provenance and trust tiers | Fingerprint installed capabilities, MCP servers, slash commands, verifier configs, package bundles, and external-agent records. | Lets the harness reason about trusted, local, experimental, and untrusted inputs differently. | `src/harness-sidecar/capabilities/*`, `src/harness-sidecar/tools/mcpPolicy.js` |
| Memory decay and contradiction pressure | Downgrade stale memories, quarantine contradicted lessons, and record when memory hurt a run. | Durable memory is only valuable if it can be corrected. | `src/harness-sidecar/memory/*`, `src/harness-sidecar/graph/claimEvidenceGraph.js` |
| Tool schema fuzzing | Fuzz registered tool schemas, MCP envelopes, path inputs, and malformed model tool calls. | Hardens the machinery the model depends on most. | `src/harness-sidecar/tools/*`, `src/harness-sidecar/reliability/toolCallRecovery.js` |
| Confidence budgeting | Treat confidence as a budget across context, memory, verifier, visual, and final-audit signals. | When confidence is low, the harness should spend more verification before acting. | `src/harness-sidecar/budget/*`, `src/harness-sidecar/tools/finalValidator.js` |

## Recommended Spine

The highest-leverage package is a **Harness Evaluation Spine**:

1. Adversarial regression corpus.
2. Verifier reliability scoring.
3. Shadow-mode policy replay.
4. Policy simulator.
5. Rollback records for approved changes.

This gives every future meta-harness improvement a way to prove itself before it changes live behavior. It also gives the operator a clean answer to: "Did this new machinery actually make Helios better?"

## Codex Comparison

| Axis | Codex pattern | Current Helios pattern | Gap or opportunity for Helios |
| --- | --- | --- | --- |
| Product scope | Codex is a general software-development agent across app, CLI, IDE, cloud, GitHub review, browser, computer-use, and integrations. | Helios is a local Pi-centered harness with research, graph, memory, VLM, verifiers, swarm, and meta-optimization. | Keep Helios focused on research-agent runtime and self-improving harness machinery rather than becoming a full Codex replacement. |
| Work isolation | Codex supports local, worktree, and cloud modes; worktrees isolate parallel changes. | Helios has worktree swarm and safe-apply foundations. | Add more operator-visible mode labels and conflict recovery around worktree-to-branch promotion. |
| Sandboxing and approvals | Codex separates sandbox mode from approval policy and uses narrow approval prompts for risky actions. | Helios has approval resume, safe apply, scoped shell, MCP policy, and feature gates. | Add Codex-like clarity to UI: why an action is blocked, what boundary it crosses, and whether approval is one-shot or persistent. |
| Network policy | Codex can keep command network off by default and optionally constrain network destinations when enabled. | Helios currently relies more on workspace/process policy, MCP policy, and local config. | Add explicit network destination policy for MCP, visual workers, research fetchers, and shell-brokered commands. |
| Skills and plugins | Codex uses skills for reusable workflows and plugins for installable bundles that can include skills, MCP config, hooks, apps, and assets. | Helios bundles skills, templates, slash commands, Pi extensions, and capability records in workspace-local config. | Add stronger provenance, maturity labels, compatibility checks, and capability trust tiers. |
| MCP | Codex supports stdio and streamable HTTP MCP, OAuth/bearer auth, tool allow/deny lists, approval modes, and plugin-provided MCP servers. | Helios supports capability-record MCP startup plus MCP client/runtime/policy/quarantine foundations. | Expand health UI, trust tiers, rate limits, tool-level approval policy, and poisoning scans for all model-visible fields. |
| Hooks/lifecycle | Codex exposes lifecycle hooks such as pre/post tool use, permission request, compact, session start, subagent start/stop, and stop. | Helios has event traces and subsystem hooks internally, but not a user-configurable lifecycle-hook surface. | Add a harness hook bus for verifier, trace, approval, memory, and final-audit events with trust review. |
| Memories | Codex memories are optional local recall, redacted, generated in the background, and not a substitute for checked-in rules. | Helios has memory candidates, promotion policy, review queues, graph memory, and retrieval into context. | Helios can exceed Codex here by adding memory decay, contradiction pressure, and outcome-based memory scoring. |
| Subagents | Codex subagents are explicitly triggered parallel workflows used to reduce context pollution and return summaries. | Helios has swarm/subagent orchestration, model/worktree attempts, recombination, review, champion selection. | Add clearer subagent budget controls and summary quality scoring so subagents help without flooding traces. |
| Browser and visual work | Codex app has an in-app browser, browser-use for local pages, browser comments, image generation, and non-code artifact previews. | Helios has visual artifact capture, VLM analysis, visual verifier, screenshots/PDF/OCR/diff workers, and visual graph. | Helios can be stronger on verifier-grade visual evidence; add richer UI for before/after visual artifacts and VLM findings. |
| Code review | Codex GitHub review focuses on serious issues and follows `AGENTS.md` review guidance. | Helios has final validator, verifiers, safe apply, and research/evidence flows, but not a dedicated PR-review product surface. | Add review-mode profiles: bug risk, security, test gaps, visual/UI, research citations, and harness-regression risk. |
| Traceability | Codex exposes task activity, terminal output, artifacts, and summaries; cloud/enterprise add more governance surfaces. | Helios has explicit trace writer/reader/replay, trace compaction, final audit, graph evidence, and meta trace inspection. | Helios should lean into this advantage with causal trace profiling and policy replay. |
| Self-improvement | Codex supports repeatable skills, hooks, automations, subagents, and review workflows. It does not publicly present itself as a local BES/RHO self-evolving harness. | Helios already has BES, RHO, meta optimizer, verifier evolution, candidate archives, and approval-gated promotion. | This is Helios's sharpest differentiator. The missing piece is robust evaluation and rollback around that power. |

## What Helios Should Borrow From Codex

| Codex design lesson | Helios adaptation |
| --- | --- |
| Separate capability from permission. | Make every risky harness action show both technical capability and approval boundary. |
| Use clear maturity labels. | Mark capabilities as experimental, beta, stable, deprecated, or quarantined in `.harness/capabilities.json`. |
| Keep reusable workflows focused. | Keep Helios capabilities small and composable rather than one giant omniskill. |
| Treat external tools as untrusted by default. | Extend MCP quarantine, rate limits, and trust tiers across all tool result fields. |
| Prefer worktrees for isolated changes. | Make worktree swarm the default path for risky champion patches. |
| Use local memory as recall, not law. | Keep required behavior in docs/config; use memory as scored context that can decay or be contradicted. |
| Give operators clear surfaces. | Add dashboard panels for context pressure, recovery, verifier evolution, visual findings, and budget alerts. |
| Review automation should be high-signal. | Report only important harness risks by default, with drill-down available for noisy traces. |

## Where Helios Can Exceed Codex

| Area | Why Helios can go further |
| --- | --- |
| Verifier evolution | Helios can evolve verifiers using trace evidence, held-out cases, RHO coresets, and human-gated promotion. |
| Visual verification | Helios can turn browser/PDF/OCR/image evidence into formal verifier signals, not just visual inspection. |
| Research harnessing | Helios can combine deep research, citation audits, contradiction finding, graph evidence, and implementation handoff. |
| BES/RHO optimization | Helios can use evolutionary search and high-signal trace selection to improve harness policy over time. |
| Graph memory | Helios can link code, claims, visual artifacts, experiments, traces, and memories into one evidence graph. |
| Local model specialization | Helios can optimize around the configured local Pi/VLM stack and preserve model-specific kwargs. |

## Design Risks

| Risk | Mitigation |
| --- | --- |
| Self-improvement makes the harness clever but unstable. | Require shadow mode, replay, held-out cases, and rollback records before promotion. |
| Verifier evolution overfits to easy traces. | Use adversarial corpus, held-out tasks, diversity constraints, and flake detection. |
| Memory poisons future runs. | Add contradiction checks, decay, provenance, and negative outcome feedback. |
| More dashboards create noise. | Show operator-grade summaries first; keep raw traces behind drill-down views. |
| Parallel agents create merge conflicts. | Prefer read-heavy subagents; isolate write-heavy attempts in worktrees; require controlled champion apply. |
| MCP and external tools leak trust. | Fingerprint capabilities, require trust tiers, scan model-visible fields, and log tool provenance. |

## Proposed Implementation Waves

### Wave A: Evaluation Spine

Build the substrate that measures whether harness changes actually improve outcomes.

- Add `.harness/evals/` adversarial cases and fixtures.
- Add replayable harness-eval runner.
- Track verifier reliability metrics.
- Add shadow-mode policy execution.
- Add policy replay reports.

### Wave B: Trust And Rollback

Make mutation safer and easier to reverse.

- Add capability fingerprints and trust tiers.
- Add before/after config snapshots for verifier/meta/capability changes.
- Add rollback records and rollback command hints.
- Add approval UI fields for boundary, persistence, and rollback availability.

### Wave C: Causal Trace Intelligence

Turn traces into diagnosis.

- Add failure clustering across traces.
- Add causal labels for context, tool, verifier, visual, memory, budget, and approval failures.
- Feed high-signal failures into RHO coresets.
- Surface top recurring failure causes in the operator dashboard.

### Wave D: Memory And Confidence

Make long-term context safer.

- Add memory decay and contradiction scoring.
- Record when a memory contributed to a bad outcome.
- Add confidence budget state across context, memory, verifier, visual, and final audit.
- Escalate low-confidence runs to extra verification.

## Priority Ranking

| Rank | Work | Effort | Impact | Why now |
| --- | --- | --- | --- | --- |
| 1 | Verifier reliability scoring | Medium | High | Verifiers are the safety backbone for every future change. |
| 2 | Shadow-mode policy replay | Medium | High | Enables safe meta-evolution without live risk. |
| 3 | Rollback records | Small/medium | High | Gives the operator confidence to approve harness changes. |
| 4 | Adversarial regression corpus | Medium | High | Makes harness quality measurable. |
| 5 | Capability trust tiers | Medium | High | Strengthens MCP/capability security. |
| 6 | Causal trace profiler | Medium/large | High | Converts traces into prioritization and learning. |
| 7 | Memory decay and contradiction pressure | Medium | Medium/high | Prevents durable context from becoming stale authority. |
| 8 | Confidence budgeting | Medium | Medium/high | Gives the harness a principled reason to verify more. |

## Bottom Line

Codex is strongest as a polished, multi-surface coding-agent environment with mature workflow controls: sandboxing, approvals, worktrees, skills, plugins, MCP, hooks, memories, browser tools, automations, and Git workflows.

Helios Forge should not try to become a second Codex UI. Its stronger path is to become a **self-measuring, self-improving local harness** around Pi: trace-rich, verifier-driven, VLM-aware, graph-grounded, and meta-optimized, with Codex-like operator controls wrapped around the risky parts.

The next serious unlock is not "more features." It is an evaluation spine that lets Helios prove whether each new feature makes the harness safer, smarter, and more reliable.
