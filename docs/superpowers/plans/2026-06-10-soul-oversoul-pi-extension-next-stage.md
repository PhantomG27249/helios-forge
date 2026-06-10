# Soul, Oversoul, And Pi Extension Next Stage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class `soul.md` and `oversoul.md` contracts for agent/swarm evolution, and build a Helios Forge Pi extension that improves Pi-agent communication, skill sync, subagent handoff, and harness coordination.

**Architecture:** Keep soul and oversoul state as human-readable Markdown plus parsed runtime records under `.harness/souls`. Treat all soul/oversoul mutations as evidence-only candidates that flow through RHO, BES, Meta-Harness, promotion policy, and approval. Add a Pi extension that stays thin inside Pi and delegates richer state, skill sync, and coordination to the Helios sidecar.

**Tech Stack:** Node.js ESM, TypeScript Pi extension API, existing Helios sidecar modules, Markdown contracts, JSONL history, `node:test`, existing release smoke.

---

## Relationship To The Production Capability Spine

This plan is the identity and Pi-communication layer. It does not replace the
main production capability plan:

```text
docs/superpowers/plans/2026-06-10-production-capability-spine-next-stage.md
```

The production spine covers:

- production benchmark suites and scheduled replay cycles;
- autonomous Meta-Harness source-tree variants;
- production-scale RHO embeddings, rerolls, and self-preference evidence;
- model-assisted MemGraphRAG roles and BES dense judgment;
- multimodal scale with a dedicated visual SwarmCell and visual suites;
- external durable A2A server/client transport and multi-hop lineage;
- governance hardening with autonomy levels, escalation, audit, rollback, and quarantine.

Soul, oversoul, and the Pi bridge should be evaluated by that spine. They are
identity and communication candidates, not separate authority systems.
In the full recursion, each agent gets its own identity specialization and
evolution loop through `soul.md`. Souls evolve inside local harnesses, local
harnesses evolve inside SwarmCells and swarms, and swarms fuse their specialized
agents through `oversoul.md` into a shared hive-mind-like strategy layer. The
global harness-of-harnesses evaluates whether any of those changes should become
part of the continuously evolving substrate.

## Current Baseline

The repo already has deterministic paper-shaped substrate: RHO/BES lanes, swarm profiles, SwarmCell contracts, A2A envelopes, capability-goal status, Meta-Harness variant workspaces, and a Pi kwargs extension. The next stage should not replace that substrate. It should add durable agent identity and a better Pi bridge on top.

Confirmed Pi/Helios bridge gaps from the current local configuration:

- Pi defaults to `Zeus / selimaktas/ebft-5` through `C:\Users\jackj\.pi\agent\settings.json`; that model declares text and image input and a 262k context window, but its configured chat-template kwargs disable thinking.
- `C:\Users\jackj\.pi\agent\extensions\kwargs.ts` is installed and patches provider payloads from `C:\Users\jackj\.pi\agent\models.json`, but it currently forwards only sampling values, penalties, seed, and `chat_template_kwargs`. It does not forward `--reasoning-parser qwen3`.
- `src/pi/piRpcManager.js` can scope `HELIOS_CAPABILITIES_MANIFEST` into spawned Pi processes, but the installed Pi extension does not read that manifest, load Helios `SKILL.md` bodies, or advertise Helios skill inventory to Pi.
- Helios-side skill parsing and mutation machinery are not blocked by Pi: package install, capability registry writes, BES skill candidates, promotion gates, and rollback/apply are sidecar-owned.
- Pi-native skill use and model-driven mutation quality are limited until the bridge extension consumes the manifest and injects compact skill, soul, oversoul, and mutation context into Pi.
- Selected workspaces can still run the sidecar with built-in routes while lacking `.harness/capabilities.json`, `.harness/runtime/capabilities.mount.json`, and `.harness/packages`; the bridge must diagnose and repair this rather than treating sidecar health as proof that defaults are installed.
- The `Capability Goals` panel is roadmap/status evidence only, not proof that skills, MCPs, templates, slash commands, or Pi extensions are installed in the active workspace.

Important existing files:

- `src/harness-sidecar/swarm/agentProfiles.js`
- `src/harness-sidecar/swarm/rolePrompts.js`
- `src/harness-sidecar/swarm/swarmCellContracts.js`
- `src/harness-sidecar/swarm/swarmOutcomeRecorder.js`
- `src/harness-sidecar/bes/laneRuntime.js`
- `src/harness-sidecar/rho/coresetBuilder.js`
- `src/harness-sidecar/meta/harnessVariantWorkspace.js`
- `src/harness-sidecar/interop/a2aSwarmEnvelope.js`
- `src/harness-sidecar/meta/capabilityGoalStatus.js`
- `src/pi/piRpcManager.js`
- `src/pi/extensions/kwargs.ts`
- `packages/helios-research-harness/extensions/kwargs.ts`
- `packages/helios-research-harness/helios-package.json`
- `scripts/install-pi-kwargs-extension.js`

Packaging note: `scripts/install-pi-kwargs-extension.js` currently points at `src/pi/extensions/kwargs.ts`, while the packaged extension exists at `packages/helios-research-harness/extensions/kwargs.ts`. Fix the extension layout before adding the new Pi bridge.

## Target Runtime Artifacts

Agent souls:

```text
.harness/souls/agents/<agent-id>/soul.md
.harness/souls/agents/<agent-id>/history.jsonl
.harness/souls/agents/<agent-id>/evaluations.jsonl
```

Oversoul:

```text
.harness/souls/oversoul.md
.harness/souls/oversoul-history.jsonl
.harness/souls/oversoul-evaluations.jsonl
```

Candidates:

```text
.harness/souls/candidates/<candidate-id>/soul.md
.harness/souls/oversoul-candidates/<candidate-id>/oversoul.md
```

## Chunk 1: Soul And Oversoul Runtime Contracts

### Task 1: Markdown Contract Parser

**Files:**
- Create: `src/harness-sidecar/souls/soulMarkdown.js`
- Test: `tests/soul-markdown.test.js`

- [ ] Write failing parser tests for valid `soul.md`, valid `oversoul.md`, missing required sections, and prompt-adapter sanitization.
- [ ] Implement a small Markdown section parser that returns `{ kind, id, version, sections, promptAdapterNotes }`.
- [ ] Reject missing `Identity`, mission, values/invariants, risk/governance posture, and evolution/evaluation sections.
- [ ] Sanitize prompt adapter notes by stripping secrets, absolute paths, and raw HTML.
- [ ] Run `node --test tests/soul-markdown.test.js`.
- [ ] Commit with `feat: add soul markdown parser`.

### Task 2: Soul Store

**Files:**
- Create: `src/harness-sidecar/souls/soulStore.js`
- Test: `tests/soul-store.test.js`

- [ ] Write failing tests for creating default soul files, reading existing soul files, appending JSONL history, and rejecting path traversal.
- [ ] Implement workspace-root constrained reads and writes under `.harness/souls`.
- [ ] Add `loadSoul(agentId)`, `saveSoulCandidate(candidate)`, `appendSoulHistory(agentId, event)`, and `loadOversoul()`.
- [ ] Reuse the repo's existing path-safety style from durable A2A and harness variant workspaces.
- [ ] Run `node --test tests/soul-store.test.js`.
- [ ] Commit with `feat: persist agent soul records`.

### Task 3: Soul Prompt Adapter

**Files:**
- Create: `src/harness-sidecar/souls/soulPromptAdapter.js`
- Modify: `src/harness-sidecar/swarm/rolePrompts.js`
- Test: `tests/soul-prompt-adapter.test.js`

- [ ] Write failing tests proving sanitized soul notes can be added to role prompts without exposing forbidden fields.
- [ ] Add optional soul context to role prompt construction.
- [ ] Keep behavior unchanged when no soul is present.
- [ ] Run `node --test tests/soul-prompt-adapter.test.js`.
- [ ] Commit with `feat: inject safe soul context into swarm prompts`.

## Chunk 2: Soul Evolution Through RHO, BES, And Meta-Harness

### Task 4: Soul Evidence Envelopes

**Files:**
- Create: `src/harness-sidecar/souls/soulEvidence.js`
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Modify: `src/harness-sidecar/swarm/swarmCellContracts.js`
- Test: `tests/soul-evidence.test.js`

- [ ] Write failing tests for soul refs in SwarmCell output and BES lane evidence.
- [ ] Add reference-only soul metadata: `soulId`, `soulVersion`, `oversoulVersion`, `mutationLineage`.
- [ ] Ensure soul metadata cannot include raw prompts, secrets, patches, or untrusted external content.
- [ ] Run `node --test tests/soul-evidence.test.js`.
- [ ] Commit with `feat: attach soul refs to swarm evidence`.

### Task 5: Soul Mutation Candidates

**Files:**
- Create: `src/harness-sidecar/souls/soulEvolution.js`
- Modify: `src/harness-sidecar/meta/harnessVariantWorkspace.js`
- Test: `tests/soul-evolution.test.js`

- [ ] Write failing tests for `mutate_trait`, `recombine`, `distill`, `specialize`, `deprecate`, and `rollback` candidate records.
- [ ] Implement shadow-only soul mutation candidate generation.
- [ ] Include `soul.md` and `oversoul.md` candidate files in Meta-Harness variant workspaces.
- [ ] Mark all soul candidates as non-promotable without promotion policy and approval evidence.
- [ ] Run `node --test tests/soul-evolution.test.js`.
- [ ] Commit with `feat: create shadow soul evolution candidates`.

### Task 6: Oversoul Runtime

**Files:**
- Create: `src/harness-sidecar/souls/oversoulRuntime.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify: `src/harness-sidecar/meta/capabilityGoalStatus.js`
- Test: `tests/oversoul-runtime.test.js`

- [ ] Write failing tests for role ecology summaries, mutation pressure, status rows, and no-authority enforcement.
- [ ] Load oversoul state during swarm planning.
- [ ] Use oversoul role ecology as advisory scheduling input only.
- [ ] Add capability-goal status rows for soul coverage, oversoul coverage, mutation evidence, and approval blockers.
- [ ] Run `node --test tests/oversoul-runtime.test.js`.
- [ ] Commit with `feat: add oversoul advisory runtime`.

## Chunk 3: Helios Forge Pi Extension

### Local/Private Reasoning Capture Policy

For local or privately hosted models that expose raw reasoning or thinking
traces, the Pi extension may support opt-in capture. Raw reasoning is useful
training ore for soul, memory, RHO, BES, and harness evolution, but it should
not be treated as trusted truth or direct promotion evidence.

Default behavior should remain structured reasoning telemetry only:

```json
{
  "type": "cognition_trace",
  "taskId": "...",
  "agentId": "...",
  "soulId": "...",
  "phase": "plan|act|observe|critique|handoff",
  "summary": "...",
  "decision": "...",
  "alternatives": ["..."],
  "evidenceRefs": ["trace:event:...", "artifact:..."],
  "uncertainty": 0.42,
  "nextAction": "...",
  "mutationHints": ["tool_selection", "memory_retrieval", "verification_gap"]
}
```

When raw CoT capture is enabled for a local/private model, the path should be:

```text
raw local reasoning
-> private quarantine store
-> redaction
-> compression/summarization
-> evidence-linked cognition_trace packets
-> RHO/BES/soul/oversoul mining
-> benchmark and replay validation
-> governed mutation proposal
```

Suggested config:

```yaml
reasoningTelemetry:
  structuredTelemetry: true
  rawCotCapture: false
  rawCotVisibility: local_private_only
  rawCotStore: quarantine
  mineRawCot: derived_summaries_only
  requireRedaction: true
  requireBenchmarkValidation: true
```

Raw reasoning must never be sent through normal Pi extension metadata, shown in
the UI by default, or used to self-promote. It may influence mutations only
after derived summaries survive redaction, replay, verifier checks, and
promotion policy.

### Task 7: Fix Existing Pi Extension Packaging

**Files:**
- Modify: `scripts/install-pi-kwargs-extension.js`
- Test: `tests/install-pi-kwargs-extension.test.js`

- [ ] Write a failing test that proves the installer copies from `packages/helios-research-harness/extensions/kwargs.ts`.
- [ ] Update the installer source path or add a shared extension copy helper.
- [ ] Preserve the existing models.json normalization behavior.
- [ ] Add coverage for `--reasoning-parser qwen3` so the kwargs extension either forwards the parser safely or records a deliberate unsupported-flag diagnostic.
- [ ] Add coverage proving `selimaktas/ebft-5` with `enable_thinking:false` remains explicit, while thinking-enabled model profiles can be selected intentionally.
- [ ] Run `node --test tests/install-pi-kwargs-extension.test.js`.
- [ ] Commit with `fix: align pi extension installer path`.

### Task 8: Add Helios Bridge Pi Extension

**Files:**
- Create: `packages/helios-research-harness/extensions/helios-forge.ts`
- Modify: `packages/helios-research-harness/helios-package.json`
- Create: `scripts/install-pi-helios-extension.js`
- Test: `tests/pi-helios-extension.test.js`

- [ ] Write failing tests for extension manifest registration and installer copy behavior.
- [ ] Add a Pi extension that can read workspace-local Helios bridge config and expose safe before-request metadata.
- [ ] Read the `HELIOS_CAPABILITIES_MANIFEST` environment variable set by `src/pi/piRpcManager.js`; if it is missing, emit a compact bridge warning rather than silently pretending skills are synced.
- [ ] Include current workspace id, active skill/capability summary, selected soul/oversoul refs, and sidecar endpoint hints.
- [ ] Read Helios Forge workspace skill manifests directly when Pi's own global skill registry has not loaded them.
- [ ] Include packaged Helios skills from `packages/helios-research-harness/helios-package.json`, workspace capability records from `.harness/capabilities.json`, and approved generated skills from `.harness/packages/generated-skills`.
- [ ] Do not inject full skill bodies by default. Send compact skill inventory plus explicit skill refs; allow full body injection only through a size-limited, redacted, sidecar-owned context packet.
- [ ] Do not send secrets, raw traces, raw patches, or full memory contents through Pi extension metadata.
- [ ] Add `npm` script for installing the Helios extension.
- [ ] Run `node --test tests/pi-helios-extension.test.js`.
- [ ] Commit with `feat: add helios forge pi bridge extension`.

### Task 8B: Helios Skill Discovery And Pi Skill Sync

**Files:**
- Create: `src/harness-sidecar/pi/heliosSkillBridge.js`
- Modify: `src/harness-sidecar/capabilities/piPackageInstaller.js`
- Modify: `packages/helios-research-harness/extensions/helios-forge.ts`
- Test: `tests/pi-helios-skill-bridge.test.js`

- [ ] Write failing tests for Helios skills that exist in the workspace package but are absent from Pi's global skill registry.
- [ ] Build a safe skill inventory from `packages/helios-research-harness/helios-package.json`, `.harness/capabilities.json`, `.harness/runtime/capabilities.mount.json`, and `.harness/packages/generated-skills`.
- [ ] Add a missing-default-package diagnostic for selected workspaces where the sidecar is healthy but `.harness/capabilities.json`, `.harness/runtime/capabilities.mount.json`, or `.harness/packages/helios-research-harness` is absent.
- [ ] Add a repair action that can invoke the existing setup/bootstrap path for the active workspace, then remount capabilities and refresh the Pi bridge packet.
- [ ] Normalize each skill into id, name, source, version/hash, relative path, enabled state, and short description.
- [ ] Reject path escapes, absolute external paths, disabled capabilities, and unapproved generated skill candidates.
- [ ] Expose a compact `helios_skill_inventory` packet through the Pi extension and sidecar bridge state.
- [ ] Add a sync action or diagnostic that tells the operator when Pi has not loaded a Helios Forge skill that Helios sees.
- [ ] Preserve a Pi-thin design: the extension should discover and advertise skill metadata, while the sidecar owns installs, approvals, and generated-skill promotion.
- [ ] Run `node --test tests/pi-helios-skill-bridge.test.js`.
- [ ] Commit with `feat: sync helios skills into pi bridge`.

### Task 8A: Reasoning Telemetry And Raw CoT Quarantine

**Files:**
- Create: `src/harness-sidecar/pi/reasoningTelemetry.js`
- Modify: `packages/helios-research-harness/extensions/helios-forge.ts`
- Modify: `src/harness-sidecar/core/traceWriter.js`
- Test: `tests/pi-reasoning-telemetry.test.js`

- [ ] Write failing tests for structured `cognition_trace` packets.
- [ ] Write failing tests proving raw local CoT capture is disabled by default.
- [ ] Add opt-in raw CoT quarantine storage for local/private model traces only.
- [ ] Redact secrets, absolute paths, raw patches, raw memory contents, auth headers, and private URLs before derived summaries leave quarantine.
- [ ] Emit compact derived telemetry for RHO/BES/soul/oversoul mining.
- [ ] Ensure raw CoT cannot be used as direct promotion evidence or rendered in the UI by default.
- [ ] Run `node --test tests/pi-reasoning-telemetry.test.js`.
- [ ] Commit with `feat: add pi reasoning telemetry quarantine`.

### Task 9: Sidecar Bridge Endpoint

**Files:**
- Create: `src/harness-sidecar/pi/piBridgeState.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/pi-bridge-state.test.js`

- [ ] Write failing tests for a sidecar status payload consumed by the Pi extension.
- [ ] Expose safe bridge state: enabled skills, capability ids, active task id, subagent status, soul refs, oversoul version, and communication warnings.
- [ ] Include `bridgeHealth` fields for `manifestPresent`, `manifestConsumedByPi`, `defaultPackageInstalled`, `piKwargsExtensionInstalled`, `reasoningParserForwarded`, and `activeModelThinkingEnabled`.
- [ ] Add redaction and maximum payload-size controls.
- [ ] Run `node --test tests/pi-bridge-state.test.js`.
- [ ] Commit with `feat: expose safe pi bridge state`.

### Task 10: Pi-Native Worker Communication Upgrade

**Files:**
- Modify: `src/harness-sidecar/swarm/piNativeWorker.js`
- Modify: `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Test: `tests/pi-native-worker-bridge.test.js`

- [ ] Write failing tests for richer Pi-native handoff envelopes.
- [ ] Include skill hints, soul refs, oversoul refs, expected output contract, task correlation id, and sidecar callback hints.
- [ ] Include mutation-optimization context that distinguishes Helios-side deterministic BES/RHO candidates from Pi-native model suggestions, and keep local durable apply approval forbidden.
- [ ] Include warnings when the active Pi model profile disables thinking or when expected model kwargs were not applied.
- [ ] Preserve current fallback behavior when the extension is unavailable.
- [ ] Run `node --test tests/pi-native-worker-bridge.test.js`.
- [ ] Commit with `feat: improve pi native worker handoff envelopes`.

## Chunk 4: UI, Docs, And Governance

### Task 11: Operator Visibility

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Test: `tests/harness-ui-status.test.js`

- [ ] Write failing tests or DOM assertions for soul/oversoul status rows.
- [ ] Add compact rows for active souls, oversoul version, mutation candidates, Pi extension health, and communication warnings.
- [ ] Keep the UI advisory: no button should approve soul or oversoul mutation directly.
- [ ] Run the focused UI/status tests.
- [ ] Commit with `feat: show soul and pi bridge status`.

### Task 12: Governance And Trust Kernel

**Files:**
- Modify: `src/harness-sidecar/core/trustKernelBoundary.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Test: `tests/soul-governance.test.js`

- [ ] Write failing tests that block soul/oversoul candidates trying to expand tool authority, lower verifier floors, hide lineage, or self-approve.
- [ ] Add explicit soul/oversoul candidate checks to trust and promotion policy.
- [ ] Require rollback metadata and evaluation evidence for durable soul/oversoul updates.
- [ ] Run `node --test tests/soul-governance.test.js`.
- [ ] Commit with `feat: gate soul evolution through trust policy`.

### Task 13: Documentation Refresh

**Files:**
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/paper-implementation-alignment.md`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Modify: `docs/architecture/hierarchical-self-modifying-swarm-synthesis.md`

- [ ] Add soul/oversoul rows to the feature map.
- [ ] Add Pi extension bridge status to the operator reading map.
- [ ] Clarify that soul/oversoul evolution is an identity and behavior-prior layer, not authority.
- [ ] Update paper-gap docs to list soul/oversoul as the agent-continuity layer over BES/RHO/Meta-Harness.
- [ ] Run `rg -n "soul|oversoul|Pi extension|pi bridge" docs/architecture`.
- [ ] Commit with `docs: add soul and pi bridge architecture`.

## Chunk 5: Verification And Release

### Task 14: Focused Test Matrix

**Files:**
- No new files.

- [ ] Run `node --test tests/soul-markdown.test.js tests/soul-store.test.js tests/soul-evidence.test.js tests/oversoul-runtime.test.js`.
- [ ] Run `node --test tests/pi-helios-extension.test.js tests/pi-bridge-state.test.js tests/pi-native-worker-bridge.test.js`.
- [ ] Run `npm test`.
- [ ] Run `npm run release:smoke`.
- [ ] Run `git diff --check`.
- [ ] Commit any final fixes.

## Acceptance Criteria

- `docs/architecture/soul.md` and `docs/architecture/oversoul.md` define the canonical contracts.
- Runtime can create, parse, store, and version `.harness/souls/.../soul.md` and `.harness/souls/oversoul.md`.
- Soul and oversoul refs flow through SwarmCell, BES lane evidence, RHO hard cases, Meta-Harness variants, and A2A envelopes.
- Soul and oversoul mutation candidates are shadow-only until promotion policy and approval accept them.
- The Helios Forge Pi extension is packaged separately from the kwargs extension and has a working installer.
- The Pi extension can surface Helios Forge workspace skills even when Pi has not reliably loaded them from its own global registry.
- Packaged, workspace-enabled, and approved generated skills are visible as compact bridge metadata without granting Pi authority to install or promote them.
- The Pi bridge consumes `HELIOS_CAPABILITIES_MANIFEST`, reports when it cannot consume it, and differentiates "sidecar healthy" from "workspace default package installed."
- The kwargs extension either forwards `--reasoning-parser qwen3` safely or exposes a tested diagnostic explaining why it is not forwarded.
- Pi-native mutation prompts receive compact skill and mutation context, while sidecar-owned BES/RHO/promotion logic remains the authority boundary.
- The Pi extension emits structured reasoning telemetry and, when explicitly enabled for local/private models, stores raw CoT only in a redacted quarantine path that feeds derived summaries rather than direct promotion.
- Pi-native subagents receive better skill, soul, oversoul, output-contract, and sidecar coordination context.
- UI/status surfaces show soul/oversoul and Pi bridge health without adding direct self-approval controls.
- Full tests and release smoke pass.
