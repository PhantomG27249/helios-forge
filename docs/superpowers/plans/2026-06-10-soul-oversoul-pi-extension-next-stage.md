# Soul, Oversoul, And Pi Extension Next Stage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class `soul.md` and `oversoul.md` contracts for agent/swarm evolution, and build a Helios Forge Pi extension that improves Pi-agent communication, skill sync, subagent handoff, and harness coordination.

**Architecture:** Keep soul and oversoul state as human-readable Markdown plus parsed runtime records under `.harness/souls`. Treat all soul/oversoul mutations as evidence-only candidates that flow through RHO, BES, Meta-Harness, promotion policy, and approval. Add a Pi extension that stays thin inside Pi and delegates richer state, skill sync, and coordination to the Helios sidecar.

**Tech Stack:** Node.js ESM, TypeScript Pi extension API, existing Helios sidecar modules, Markdown contracts, JSONL history, `node:test`, existing release smoke.

---

## Current Baseline

The repo already has deterministic paper-shaped substrate: RHO/BES lanes, swarm profiles, SwarmCell contracts, A2A envelopes, capability-goal status, Meta-Harness variant workspaces, and a Pi kwargs extension. The next stage should not replace that substrate. It should add durable agent identity and a better Pi bridge on top.

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

### Task 7: Fix Existing Pi Extension Packaging

**Files:**
- Modify: `scripts/install-pi-kwargs-extension.js`
- Test: `tests/install-pi-kwargs-extension.test.js`

- [ ] Write a failing test that proves the installer copies from `packages/helios-research-harness/extensions/kwargs.ts`.
- [ ] Update the installer source path or add a shared extension copy helper.
- [ ] Preserve the existing models.json normalization behavior.
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
- [ ] Include current workspace id, active skill/capability summary, selected soul/oversoul refs, and sidecar endpoint hints.
- [ ] Do not send secrets, raw traces, raw patches, or full memory contents through Pi extension metadata.
- [ ] Add `npm` script for installing the Helios extension.
- [ ] Run `node --test tests/pi-helios-extension.test.js`.
- [ ] Commit with `feat: add helios forge pi bridge extension`.

### Task 9: Sidecar Bridge Endpoint

**Files:**
- Create: `src/harness-sidecar/pi/piBridgeState.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/pi-bridge-state.test.js`

- [ ] Write failing tests for a sidecar status payload consumed by the Pi extension.
- [ ] Expose safe bridge state: enabled skills, capability ids, active task id, subagent status, soul refs, oversoul version, and communication warnings.
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
- Pi-native subagents receive better skill, soul, oversoul, output-contract, and sidecar coordination context.
- UI/status surfaces show soul/oversoul and Pi bridge health without adding direct self-approval controls.
- Full tests and release smoke pass.

