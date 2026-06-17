# Harness Strengthening And Agent Comparison

This document lists deeper machinery that could make Helios Forge stronger, then compares those ideas with Codex and Claude Code as reference designs. It is not a claim that Helios should clone either product. Codex and Claude Code are mature coding-agent environments; Helios Forge is a local Pi-centered research and meta-harness. The useful question is what Helios should borrow, what it already has that is distinctive, and what it can add to become more trustworthy as it gets more autonomous.

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

Source baseline for the Claude Code comparison:

- Official Claude Code docs checked on 2026-06-08.
- Anthropic docs referenced:
  - `https://code.claude.com/docs/en/overview`
  - `https://code.claude.com/docs/en/settings`
  - `https://code.claude.com/docs/en/permissions`
  - `https://code.claude.com/docs/en/sub-agents`
  - `https://code.claude.com/docs/en/mcp`
  - `https://code.claude.com/docs/en/hooks`
  - `https://code.claude.com/docs/en/memory`
  - `https://code.claude.com/docs/en/plugins`
  - `https://code.claude.com/docs/en/agent-sdk/overview`

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
| TreeQuest-style adaptive search scheduler | Explore an optional AB-MCTS backend inspired by SakanaAI TreeQuest for batched ask/tell search over model, tool, verifier, visual, and refinement actions. | Current ToolTree/BES already provides tree search and evolution, but adaptive branching could spend inference-time compute more intelligently on hard tasks. | `src/harness-sidecar/bes/toolTreePlanner.js`, `src/harness-sidecar/bes/bidirectionalSearchLoop.js`, `src/harness-sidecar/swarm/attemptScheduler.js` |
| Evidence-gated autonomous approvals | Explore policy-limited auto-approval for narrow, reversible, low-risk changes when verifier evidence, held-out replay, rollback, budget, and trust-tier constraints all pass. | Lets long-running harness evolution continue without a human watching every safe micro-promotion, while preserving hard stops for risky mutations. | `src/harness-sidecar/core/approvalResume.js`, `src/harness-sidecar/meta/promotionPolicy.js`, `src/harness-sidecar/tools/verifierConfigApply.js` |

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

## Claude Code Comparison

| Axis | Claude Code pattern | Current Helios pattern | Gap or opportunity for Helios |
| --- | --- | --- | --- |
| Product scope | Claude Code is an agentic coding tool across terminal, IDE, desktop app, browser, CI/CD, Slack, Chrome, and Agent SDK workflows. | Helios is local-first and Pi-centered, with sidecar orchestration, VLM, research, graph, memory, BES/RHO/meta, verifiers, swarm, and safe apply. | Helios should not compete on every surface. It should compete on harness evaluation, local-model specialization, and research/meta instrumentation. |
| Settings scopes | Claude Code has managed, user, project, and local scopes, with clear precedence and separate sharing expectations. | Helios has workspace `.harness` config plus feature flags and installer-managed capabilities. | Add explicit config scope semantics: bundled, workspace, local override, managed/admin, runtime/session. |
| Project instructions | Claude Code uses `CLAUDE.md` for project memory and instructions loaded at session start. | Helios has docs, capabilities, slash commands, templates, and memory, but no single first-class project instruction file equivalent. | Add or document a Helios project contract file for durable repo rules, verifier expectations, and harness operating limits. |
| Permissions | Claude Code has allow/ask/deny permission rules, modes such as plan/auto/dontAsk, and fine-grained tool specifiers. | Helios has scoped shell, approval resume, MCP policy, feature gates, and safe apply. | Add a human-readable permission matrix for shell, MCP, visual capture, research fetch, patch apply, verifier config, and external agents. |
| Sandbox | Claude Code documents how permissions interact with sandboxing and supports extra working directories with clear boundaries. | Helios enforces workspace-scoped paths in multiple subsystems but does not expose a unified sandbox model. | Add a single boundary model: workspace root, extra read roots, artifact roots, network roots, and mutation roots. |
| Subagents | Claude Code has built-in and custom subagents with their own context, tools, permissions, model, memory, background mode, and worktree isolation. | Helios has swarm attempts, model-driven workers, worktree attempts, reviewer/recombiner/champion selection, and subagent activity UI. | Add named agent profiles with per-agent tool caps, model/profile choices, memory scopes, worktree isolation, and summary quality checks. |
| Agent teams | Claude Code supports multiple agents working simultaneously, with a lead agent coordinating and merging results. | Helios has swarm orchestration and recombination, but the coordination model is more internal than operator-facing. | Surface team topology: roles, current task, artifact outputs, conflicts, champion rationale, and merge readiness. |
| MCP | Claude Code can connect to many MCP servers, supports `.mcp.json`, environment expansion, OAuth for remote MCP, and can serve Claude Code itself as an MCP server. | Helios can start MCP from installed capability records and has MCP client/runtime/policy/quarantine modules. | Add `.harness/mcp.json` style environment expansion, server health, auth status, scoped tools, and optional "Helios as MCP server" mode. |
| Hooks | Claude Code exposes hooks around lifecycle and tool events; hooks can block or force prompts. | Helios has internal event traces and approval gates but no user-extensible hook bus. | Add a trusted hook bus for pre-tool, post-tool, approval, verifier, memory, trace, visual, and final-audit events. |
| Memory | Claude Code uses project/user memory files and auto memory; subagents can also have persistent memory scopes. | Helios has scored memory candidates, promotion/review queues, graph memory, and retrieval. | Helios should add Claude-like inspectability plus stronger decay, contradiction, and outcome scoring. |
| Plugins and skills | Claude Code supports plugins and skills; plugins can package reusable agents, commands, hooks, MCP, and workflow assets. | Helios uses bundled Pi package capabilities, skills, templates, slash commands, Pi extensions, and capability records. | Add plugin-style packaging metadata for Helios capabilities: version, owner, trust tier, compatibility, hooks, MCP, and verifier requirements. |
| Automation | Claude Code supports scheduled routines, desktop scheduled tasks, `/loop`, remote control, channels, and CI/CD workflows. | Helios has task events, traces, experiments, and local sidecar runtime, but less scheduling/trigger infrastructure. | Add scheduled harness evaluations and trigger-based follow-up runs against traces, failures, and changed capability records. |
| CLI composability | Claude Code is strongly CLI-composable: pipe input, run noninteractive prompts, resume sessions, and automate from CI. | Helios has installer/dev scripts and sidecar HTTP APIs, but the primary operator surface is browser/local app. | Add a thin `helios` CLI for eval replay, trace summarize, verifier score, capability audit, and safe-apply dry run. |
| SDK / custom agents | Claude Code exposes an Agent SDK for custom agent workflows using Claude Code tools and permissions. | Helios has internal sidecar modules but no stable external harness SDK. | Define a small local SDK/API around traces, tools, verifiers, artifacts, memory, and approvals. |
| Model routing | Claude Code supports model choices for subagents and third-party/provider setups through settings. | Helios preserves Pi model kwargs and can target a local VLM/model gateway. | Add per-subsystem model profiles: planner, tool-loop, visual judge, verifier-evolver, researcher, reviewer. |

## What Helios Should Borrow From Claude Code

| Claude Code design lesson | Helios adaptation |
| --- | --- |
| Make scopes explicit. | Separate managed, workspace, local, and session settings so operators know what is shared and what is private. |
| Put permissions in user-readable rules. | Expose allow/ask/deny style rules for tools, MCP, shell, visual capture, research fetch, and safe apply. |
| Use named subagent profiles. | Convert swarm roles into configurable agents with tool caps, model profiles, memory scopes, and worktree isolation. |
| Let hooks enforce policy at runtime. | Add trusted pre/post hooks for tool calls, approval requests, verifier runs, memory promotion, and final audit. |
| Make MCP configuration portable but secret-safe. | Support environment expansion and auth-status reporting without writing secrets into capability records. |
| Keep project instructions simple. | Add a single Helios project instruction contract, while keeping generated memories separate from required rules. |
| Support CLI automation. | Add noninteractive commands for trace replay, verifier evolution dry runs, capability audit, and eval corpus runs. |
| Show running agent teams. | Promote swarm/subagent activity from raw events into a first-class operator view. |

## Codex vs Claude Code vs Helios

| System | Strongest pattern | What Helios should copy | What Helios should avoid |
| --- | --- | --- | --- |
| Codex | Polished multi-surface development workflow with strong sandbox/approval/worktree/Git/app integration. | Operator clarity, worktree-first isolation, maturity labels, high-signal review posture, product-grade artifact surfaces. | Chasing every Codex surface instead of strengthening the research/meta harness core. |
| Claude Code | Highly configurable terminal-first agent with explicit settings scopes, permissions, hooks, subagents, MCP, memory, and automation. | Scope model, permission rules, hook bus, named subagents, portable MCP config, CLI composability. | Letting hook/plugin/config flexibility bypass the harness's verifier and approval spine. |
| Helios Forge | Local Pi-centered meta-harness with research, VLM, graph memory, verifiers, BES/RHO/meta optimization, swarm, and approval-gated safe apply. | Keep the self-improving harness distinctive while borrowing operator controls from both systems. | Self-improvement without adversarial evals, shadow replay, rollback, and causal trace diagnosis. |

## Where Helios Can Exceed Codex

| Area | Why Helios can go further |
| --- | --- |
| Verifier evolution | Helios can evolve verifiers using trace evidence, held-out cases, RHO coresets, and human-gated promotion. |
| Visual verification | Helios can turn browser/PDF/OCR/image evidence into formal verifier signals, not just visual inspection. |
| Research harnessing | Helios can combine deep research, citation audits, contradiction finding, graph evidence, and implementation handoff. |
| BES/RHO optimization | Helios can use evolutionary search and high-signal trace selection to improve harness policy over time. |
| Graph memory | Helios can link code, claims, visual artifacts, experiments, traces, and memories into one evidence graph. |
| Local model specialization | Helios can optimize around the configured local Pi/VLM stack and preserve model-specific kwargs. |

## Where Helios Can Exceed Claude Code

| Area | Why Helios can go further |
| --- | --- |
| Meta-harness evolution | Claude Code exposes rich configurability; Helios can evaluate and evolve its own verifier/meta policies against traces. |
| Verifier-grade VLM evidence | Claude Code can use visual/browser workflows; Helios can turn visual artifacts into scored verifier signals. |
| RHO/BES optimization | Helios can use high-signal trace selection and evolutionary search as first-class runtime subsystems. |
| Evidence graph | Helios can unify code, claims, experiments, visual artifacts, memory, and trace outcomes into one graph. |
| Local model/Pi integration | Helios can optimize around local Pi model configuration and model-specific kwargs. |
| Research-to-implementation loop | Helios can couple deep research, contradiction checks, figure/PDF extraction, implementation handoff, and verifier gates. |

## Design Risks

| Risk | Mitigation |
| --- | --- |
| Self-improvement makes the harness clever but unstable. | Require shadow mode, replay, held-out cases, and rollback records before promotion. |
| Verifier evolution overfits to easy traces. | Use adversarial corpus, held-out tasks, diversity constraints, and flake detection. |
| Memory poisons future runs. | Add contradiction checks, decay, provenance, and negative outcome feedback. |
| More dashboards create noise. | Show operator-grade summaries first; keep raw traces behind drill-down views. |
| Parallel agents create merge conflicts. | Prefer read-heavy subagents; isolate write-heavy attempts in worktrees; require controlled champion apply. |
| MCP and external tools leak trust. | Fingerprint capabilities, require trust tiers, scan model-visible fields, and log tool provenance. |
| Fully autonomous approval becomes a self-approval loophole. | Only allow auto-approval through explicit policy tiers, shadow/replay evidence, rollback records, bounded blast radius, immutable audit logs, and deny-by-default gates for branch mutation, secrets, external network, MCP writes, cost increases, and verifier safety weakening. |

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
- Add explicit managed/workspace/local/session config scopes.
- Add allow/ask/deny-style permission rules for high-risk harness tools.

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

### Wave E: Agent And Hook Surface

Turn internal orchestration into configurable, inspectable machinery.

- Add named agent profiles for swarm roles.
- Add per-agent model/tool/memory/worktree settings.
- Add trusted lifecycle hooks for tool, verifier, approval, trace, memory, and final-audit events.
- Add a small CLI for trace replay, verifier score, capability audit, and eval corpus runs.

### Wave F: Adaptive Search And Autonomous Approval Research

Explore stronger inference-time search and safe unattended evolution without replacing the current BES/RHO/verifier spine.

- Prototype a TreeQuest-style AB-MCTS scheduler behind a feature flag, using Helios actions as search actions and normalized BES/RHO/verifier/VLM scores as node scores.
- Add batched ask/tell semantics so subagents, model calls, visual checks, and verifier runs can complete out of order while still updating the same search tree.
- Compare adaptive branching against the existing ToolTree planner on trace replay, adversarial tasks, visual verifier tasks, and meta-harness promotion candidates.
- Define auto-approval tiers: `never`, `shadow_only`, `local_config_only`, `reversible_workspace_change`, and `human_required`.
- Permit autonomous approval only for changes with passing held-out evaluation, no cost/security regression, rollback metadata, low blast radius, and trusted capability provenance.
- Keep branch mutation, external network expansion, secret-bearing config, verifier safety weakening, and MCP write-scope expansion human-required by default.

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
| 9 | Named agent profiles | Medium | Medium/high | Makes swarm behavior configurable and inspectable. |
| 10 | Hook bus | Medium | Medium/high | Lets local policy enforce itself without burying logic in the sidecar. |
| 11 | Helios CLI | Small/medium | Medium | Makes eval, trace, and verifier workflows scriptable. |
| 12 | TreeQuest-style adaptive search | Medium | Medium/high | Could make BES/ToolTree spend model and verifier budget more intelligently on difficult tasks. |
| 13 | Evidence-gated autonomous approvals | Medium/high | High | Enables unattended safe evolution for low-risk changes while preserving hard human gates. |

## Bottom Line

Codex is strongest as a polished, multi-surface coding-agent environment with mature workflow controls: sandboxing, approvals, worktrees, skills, plugins, MCP, hooks, memories, browser tools, automations, and Git workflows.

Claude Code is strongest as a highly configurable coding-agent environment: explicit settings scopes, permissions, project instructions, hooks, MCP, named subagents, memory, terminal composability, CI/CD, and custom-agent paths.

Helios Forge should not try to become a second Codex UI or a second Claude Code terminal. Its stronger path is to become a **self-measuring, self-improving local harness** around Pi: trace-rich, verifier-driven, VLM-aware, graph-grounded, and meta-optimized, with Codex-like operator clarity and Claude-Code-like configurability wrapped around the risky parts.

The next serious unlock is not "more features." It is an evaluation spine that lets Helios prove whether each new feature makes the harness safer, smarter, and more reliable.
