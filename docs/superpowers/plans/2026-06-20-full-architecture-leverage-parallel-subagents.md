# Full Architecture Leverage — Parallel Subagents Master Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Helios’s built substrate (BES, RHO, meta-harness, MemGraphRAG, souls, skill evolution, ICR, governance) into Pi’s live model context and the operator hot path so base Pi chat and Pi-native swarms actually leverage the full architecture — not just sidecar-only evidence.

**Architecture:** Five phases with **disjoint parallel workers** per phase and one **serial Integration Worker** per phase for shared chokepoints. A unified `piBridgeContextPack` becomes the single source of prompt/extension context for main chat, Pi-native swarm workers, and bridge diagnostics. All autonomous paths remain evidence-only until operator approval.

**Tech Stack:** Node.js ESM, TypeScript Pi extensions (`@earendil-works/pi-coding-agent`), `node:test`, `src/pi/piRpcManager.js`, `src/server.js`, `src/harness-sidecar/*`, `packages/helios-research-harness/*`, `.harness/` artifacts.

**Parent plans:**
- [2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md](./2026-06-17-swarm-of-swarms-recursive-evolution-master-plan.md) — evolution spine (M0–M7 largely wired)
- [2026-06-20-continuous-evolution-closure-parallel-subagents.md](./2026-06-20-continuous-evolution-closure-parallel-subagents.md) — **Done** (promotion queue, skill persist, goals)
- [2026-06-17-icr-wiring-parallel-subagents.md](./2026-06-17-icr-wiring-parallel-subagents.md) — **Parallel track** Phase 3
- [archive/2026-06-10-soul-oversoul-pi-extension-next-stage.md](./archive/2026-06-10-soul-oversoul-pi-extension-next-stage.md) — soul/oversoul intent (subsumed here for Pi wiring)

---

## Problem Statement (Code-Grounded, June 20 2026)

Helios has a **Level 4-capable substrate** but Pi sees only a thin slice:

| Helios capability | Sidecar/runtime | Main Pi chat | Pi-native swarm |
| --- | --- | --- | --- |
| BES lanes | ✅ task runtime | ❌ | refs only |
| RHO replay / hard cases | ✅ post-task | brief replay feedback | ❌ |
| Meta-harness campaigns | ✅ post-task | ❌ | ❌ |
| MemGraphRAG | ✅ task bridge | ❌ | ❌ |
| Skill inventory | ✅ API | names only | hints only |
| Skill bodies (`SKILL.md`) | ✅ disk | ❌ | ❌ |
| Shadow skill candidates | ✅ post-task persist | ❌ | ❌ |
| Soul / oversoul | ✅ store | ❌ (`soulPromptAdapter` unused) | refs only |
| Evolution goals / frontier | ✅ JSONL | ❌ | ❌ |
| ICR lane | ✅ substrate | ❌ | ❌ |
| Promotion queue | ✅ post-task | ❌ | ❌ |

**Target:** Pi model context receives a **bounded, quarantined context pack** assembled from all of the above. Sidecar remains authority for apply/promote.

---

## Invariants (Never Weaken)

```text
Every layer may propose improvements.
No layer may silently approve its own durable mutation.
```

- All bridge-injected content: advisory, `evidenceOnly: true`, `canPromote: false`
- Shadow skills, souls, promotion proposals: **never** auto-install
- Quarantine: `redactSecrets`, `sanitizePromptAdapterNotes`, path redaction (match `piNativeWorker.js`)
- Trust kernel unchanged on apply paths

---

## Milestone Gates

| Gate | Requirement | Unlocks |
| --- | --- | --- |
| **L1** | Unified context pack + main chat uses it | Pi sees skills + soul + evolution summary |
| **L2** | Pi extension v2 + manifest telemetry | Provider metadata + consumed-by-Pi health |
| **L3** | BES on post-task skill + full promotion orchestration | Architecture loop closes into queue/approval |
| **L4** | MemGraphRAG + ICR in context pack | Full memory + test-time compute visible to Pi |
| **L5** | Operator UI + full-evolution config profile | Human can run and verify leverage end-to-end |

Do not start Phase N+1 until Phase N integration passes focused tests + `npm test` (note pre-existing unrelated failures).

---

## Controller Responsibilities

1. `superpowers:using-git-worktrees` — branch `feat/full-architecture-leverage`
2. Run **Phase 0 recon** subagents in parallel (read-only)
3. Dispatch **one implementer per worker** within a phase (parallel when file ownership disjoint)
4. After each worker: spec reviewer → code quality reviewer
5. Run **serial Integration Worker** after all phase workers green
6. Update this plan checkboxes + `docs/architecture/2026-06-17-implementation-reconciliation.md`
7. `npm test` + `npm run release:smoke` before merge

---

## Shared Integration Chokepoints (Serial Only)

**Only Integration Workers may edit:**

- `src/server.js`
- `src/harness/piWorkspaceBridge.js`
- `src/harness-sidecar/server.js`
- `src/harness/harnessManager.js`
- `src/harness-sidecar/config/configLoader.js`
- `src/harness-sidecar/meta/capabilityGoalStatus.js`
- `src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js`
- `src/harness-sidecar/swarm/swarmOrchestrator.js`
- `public/app.js`
- `public/index.html`
- `docs/architecture/2026-06-17-implementation-reconciliation.md`
- this plan file

---

## Phase 0: Recon (Read-Only, Parallel)

### Agent 0A: Pi hot path

**Read:** `src/server.js`, `src/pi/piRpcManager.js`, `src/harness/piWorkspaceBridge.js`, `src/harness/harnessFeedbackContext.js`, `src/harness-sidecar/meta/replayFeedbackBridge.js`

**Return:** exact insertion points for context pack; list duplicate/dead code (inline `PiRpcManager` in `server.js`).

### Agent 0B: Pi extension + package layout

**Read:** `packages/helios-research-harness/extensions/*`, `scripts/install-pi-kwargs-extension.js`, `scripts/setup-helios-forge.js`

**Return:** extension install paths; kwargs vs packaged extension drift; TS test strategy.

### Agent 0C: Soul + skill + evolution sources

**Read:** `src/harness-sidecar/souls/*`, `src/harness-sidecar/pi/heliosSkillBridge.js`, `src/harness-sidecar/skills/skillEvolutionPostTask.js`, `src/harness-sidecar/meta/workplaceEvolutionGoals.js`

**Return:** APIs to load soul/oversoul, shadow skills, goals, frontier summary for context pack.

### Agent 0D: Swarm Pi-native bridge

**Read:** `src/harness-sidecar/swarm/piNativeWorker.js`, `swarmOrchestrator.js` (`piBridgeContext` construction)

**Return:** refactor plan to share context pack with main chat.

---

## Phase 1: Pi Bridge Amplifier (Parallel Workers)

**Gate L1 target:** Main Pi prompt receives unified Helios context.

### Worker B1: Unified context pack core

**Create:**
- `src/harness-sidecar/pi/piBridgeContextPack.js`
- `tests/pi-bridge-context-pack.test.js`

**Exports:**
- `buildPiBridgeContextPack({ workspaceRoot, harnessConfig, task, options })`
- Returns `{ schemaVersion, skills, souls, evolution, memory, icr, promotion, authority, byteBudget }`
- `renderPiBridgeContextMarkdown(pack, { maxChars })` — bounded markdown block for chat prepend
- `compactPiBridgeContextForSwarm(pack)` — shape compatible with `piNativeWorker.normalizeBridgeContext`

**Tests:** empty workplace; full fixture with mocked loaders; byte budget truncation; quarantine redaction.

---

### Worker B2: Skill context loader

**Create:**
- `src/harness-sidecar/pi/skillContextLoader.js`
- `tests/pi-skill-context-loader.test.js`

**Behavior:**
- Load mounted + bundled `SKILL.md` with **bounded excerpts** (e.g. Purpose + When To Use + first workflow steps, max 2KB/skill, max 4 skills)
- Include **shadow skill candidates** as advisory hints (`status: shadow_only`, no install authority)
- Reuse `buildHeliosSkillInventory`; extend with `includeShadowCandidates: true` option in loader only (do not change store semantics globally without tests)

**Tests:** applied vs shadow candidates; path escape rejected; excerpt boundaries.

---

### Worker B3: Soul / oversoul chat loader

**Create:**
- `src/harness-sidecar/pi/soulBridgeContext.js`
- `tests/pi-soul-bridge-context.test.js`

**Behavior:**
- Load active oversoul via `soulStore.js` / `oversoulRuntime.js`
- Load default agent soul if present under `.harness/souls/`
- Feed through `buildSoulPromptContext` + `applySoulPromptContext` patterns
- Include `buildOversoulCoverageSignal` metadata as advisory lines only

**Tests:** missing souls no-op; oversoul sections appear in pack; notes sanitized.

---

### Worker B4: Evolution context bridge

**Create:**
- `src/harness-sidecar/pi/evolutionBridgeContext.js`
- `tests/pi-evolution-bridge-context.test.js`

**Behavior:**
- Read `.harness/meta/evolution-goals.json`
- Summarize latest replay from `.harness/benchmarks/replay-cycles/` (reuse `replayFeedbackBridge` helpers)
- Summarize frontier trend from `.harness/benchmarks/frontier-dashboard.jsonl` (last N entries)
- Summarize open promotion queue count under `.harness/meta/promotion-queue/` (ids only, no auto-apply)
- All sections: `evidenceOnly: true`, `canPromote: false`

**Tests:** goals present; regression warning propagates; empty dirs no-op.

---

### Worker B5: Pi extension v2 (`helios-forge.ts`)

**Modify:**
- `packages/helios-research-harness/extensions/helios-forge.ts`

**Create:**
- `tests/pi-helios-forge-extension.test.js` (Node test importing compiled logic or extracted `createBridgeMetadata` pure functions)

**Behavior:**
- Extend metadata with optional `contextPackSummary` when env `HELIOS_BRIDGE_CONTEXT_JSON` set (Integration sets this from pack JSON path or inline bounded blob)
- Emit `manifestConsumed: true` in extension hook for bridge telemetry
- Preserve existing compact manifest refs; do not exceed provider metadata size budget

**Tests:** missing env → warning metadata; valid JSON → ready + summary; oversize → truncate.

---

### Worker B6: Bridge telemetry

**Create:**
- `src/harness-sidecar/pi/piBridgeTelemetry.js`
- `tests/pi-bridge-telemetry.test.js`

**Behavior:**
- `recordManifestConsumed({ workspaceRoot, manifestId, source })` → append `.harness/meta/pi-bridge-telemetry.jsonl`
- `buildPiBridgeHealthFromTelemetry(...)` feeds `buildPiBridgeState` (`manifestConsumedByPi` from recent telemetry, not query param hack)

**Tests:** append-only; workspace root constrained.

---

### Integration Worker I1 (Phase 1)

**Modify:**
- `src/harness/piWorkspaceBridge.js` — replace `buildHeliosChatContext` internals with `buildPiBridgeContextPack` + `renderPiBridgeContextMarkdown`
- `src/server.js` — use pack on `prompt`; set `HELIOS_BRIDGE_CONTEXT_JSON` or temp file for Pi spawn via `piRpcManager.setBridgeContextPath` (add optional env setter)
- `src/pi/piRpcManager.js` — `setBridgeContextPath(path)` → `HELIOS_BRIDGE_CONTEXT_JSON`
- `src/harness-sidecar/pi/piBridgeState.js` — telemetry-backed `manifestConsumedByPi`
- `src/harness-sidecar/swarm/piNativeWorker.js` — import `compactPiBridgeContextForSwarm` instead of duplicating normalization
- `src/harness-sidecar/swarm/swarmOrchestrator.js` — build pack once per orchestration, pass to all pi-native attempts
- Delete duplicate inline `PiRpcManager` class from `src/server.js` (lines ~53–250 approx — verify in recon)

**Tests to extend:**
- `tests/pi-workspace-bridge.test.js`
- `tests/pi-native-worker-bridge.test.js`
- New `tests/pi-bridge-integration.test.js` — prompt path includes soul + shadow skill hint + evolution summary

**Verification:**
```powershell
node --test tests/pi-bridge-context-pack.test.js tests/pi-skill-context-loader.test.js tests/pi-soul-bridge-context.test.js tests/pi-evolution-bridge-context.test.js tests/pi-bridge-telemetry.test.js tests/pi-workspace-bridge.test.js tests/pi-native-worker-bridge.test.js tests/pi-bridge-integration.test.js
```

---

## Phase 2: Architecture Loop Depth (Parallel Workers)

**Gate L3 target:** Post-task paths use full BES/promotion semantics where substrate already exists.

### Worker W1: BES lane on post-task skill evolution

**Modify:**
- `src/harness-sidecar/skills/skillEvolutionPostTask.js`

**Create:**
- `tests/harness-skill-evolution-bes-lane.test.js`

**Behavior:**
- After `generateSkillCandidates`, run `runSkillCandidateBesLane` per top need (or once with best candidate set)
- Persist BES lane evidence alongside candidate in `candidate.json` metadata (`besLane` field)
- Still `canPromote: false`; shadow-only writes

---

### Worker W2: Full promotion loop orchestration

**Create:**
- `src/harness-sidecar/meta/postTaskPromotionOrchestrator.js`
- `tests/harness-post-task-promotion-orchestrator.test.js`

**Behavior:**
- When `postTaskPromotionBridge` queues proposal AND harness config enables `evolution.promotionOrchestration: true`:
  - Call `runPromotionLoop` with replay/campaign-derived `candidateGenerator` + deterministic smoke/eval runners (no network)
  - Persist full audit trail next to queue record
  - Still require operator approval for apply; `runPromotionLoop` gets `approval: null`
- Extend `postTaskPromotionBridge.js` only if needed for shared candidate extraction (prefer import, minimal edit)

---

### Worker W3: Meta-harness ↔ BES optimizer scoring

**Modify:**
- `src/harness-sidecar/meta/postTaskCampaignBindings.js`
- `src/harness-sidecar/meta/metaHarnessCampaignRunner.js` (minimal)

**Create:**
- `tests/harness-campaign-bes-scoring.test.js`

**Behavior:**
- Feed replay reports into campaign candidate scoring via existing `besMetaOptimizer` or `harnessOfHarnessesOptimizer` advisory score
- Attach `bes` + `rho` evidence refs to campaign report JSON (evidence-only)

---

### Worker W4: MemGraphRAG compact Pi context

**Create:**
- `src/harness-sidecar/pi/memoryBridgeContext.js`
- `tests/pi-memory-bridge-context.test.js`

**Behavior:**
- When `features.localMemoryGraph` enabled, call `composeGraphRagContext` or hierarchical retriever with **empty/minimal query** to produce bounded memory summary for pack
- Max 1KB text; provenance ids only; no raw secrets

---

### Integration Worker I2 (Phase 2)

**Modify:**
- `src/harness-sidecar/pi/piBridgeContextPack.js` — wire W4 memory section
- `src/harness-sidecar/meta/recursiveEvolutionRuntimeHook.js` — call W2 orchestrator after promotion bridge
- `src/harness-sidecar/meta/postTaskEvolutionOrchestrator.js` — pass BES-scored campaign bindings if W3 touches orchestrator deps only via injected deps (prefer hook in campaign bindings only)

**Verification:**
```powershell
node --test tests/harness-skill-evolution-bes-lane.test.js tests/harness-post-task-promotion-orchestrator.test.js tests/harness-campaign-bes-scoring.test.js tests/pi-memory-bridge-context.test.js tests/harness-recursive-evolution-integration.test.js
```

---

## Phase 3: ICR + Remaining Lanes (Parallel with Phase 2 if disjoint)

**Execute existing plan:** [2026-06-17-icr-wiring-parallel-subagents.md](./2026-06-17-icr-wiring-parallel-subagents.md)

**Additional Integration (after ICR Integration Worker):**

### Worker I3-ICR: ICR section in Pi pack

**Modify:**
- `src/harness-sidecar/pi/piBridgeContextPack.js` (Integration only, after ICR Workers 1–3 stable)

**Behavior:**
- When `icr.enabled`, include latest `.harness/icr/` summary via `sanitizeIcrEvidenceForDashboard`

**Gate L4 partial:** ICR visible in Pi context when enabled.

---

## Phase 4: Operator Leverage (Parallel Workers)

**Gate L5 target:** Operator can enable full stack and see bridge health.

### Worker O1: Full evolution config profile

**Create:**
- `docs/operator/full-evolution-config.example.yaml` (or embed in setup)
- `src/harness-sidecar/meta/fullEvolutionProfile.js`
- `tests/full-evolution-profile.test.js`

**Behavior:**
- `applyFullEvolutionProfile(harnessConfig)` merges all production gates on + safe defaults
- `setupHeliosForge` / repair offers `--profile full-evolution` (optional flag)
- Document required: `models.swarmBaseUrl`, held-out suite tuning

---

### Worker O2: UI — bridge + queue + shadow skills

**Modify:**
- `public/app.js`, `public/index.html` (minimal)

**Behavior:**
- Panel: Pi bridge health (`/v1/pi-bridge/state`) with `manifestConsumedByPi` from telemetry
- Panel: promotion queue list (read JSON dir via new evidence route or existing pattern)
- Panel: shadow skill candidates with link to approve/reject API
- No promote buttons without existing approval flow

**Create (sidecar route if needed):**
- `src/harness-sidecar/meta/promotionQueueReader.js` — read-only
- `tests/promotion-queue-reader.test.js`

---

### Worker O3: Capability goal hooks

**Modify:**
- `src/harness-sidecar/meta/capabilityGoalStatus.js`

**Add goals or evidence hooks:**
- `pi_bridge_leverage` — manifest consumed, context pack bytes, shadow skills surfaced
- Wire evidence from telemetry + pack render stats

---

### Integration Worker I4 (Phase 4)

- Wire new evidence routes in `server.js` / sidecar if needed
- Update `capabilityGoalStatus` snapshots in post-task hook (one line call — prefer Worker O3 exports function called from hook via Integration)

---

## Phase 5: Cleanup + Documentation

### Worker C1: Extension install path fix

**Modify:**
- `scripts/install-pi-kwargs-extension.js` — prefer `packages/helios-research-harness/extensions/`
- `install.ps1` — install both kwargs + helios-forge to global Pi extensions when `-InstallPiKwargs`

**Test:** `tests/install-pi-kwargs-extension.test.js` if exists, or add minimal test

---

### Worker C2: Reconciliation + gap map update

**Modify:**
- `docs/architecture/2026-06-17-implementation-reconciliation.md` — addendum for L1–L5
- `docs/architecture/evolutionary-agentic-organism-gap-map.md` — check Pi bridge items
- `docs/superpowers/plans/README.md` — link this plan

---

### Worker C3: End-to-end smoke test

**Create:**
- `tests/pi-full-leverage-smoke.test.js`

**Scenario (deterministic, no real Pi required if mocked):**
- Workplace with package + manifest + soul + shadow skill + replay report
- `buildPiBridgeContextPack` → markdown contains expected sections
- `buildPiBridgeState` shows healthy bridge

---

## Execution Order (Recommended)

```text
Phase 0 recon (parallel)
  ↓
Phase 1 B1–B6 (parallel) → I1 (serial)
  ↓
Phase 2 W1–W4 (parallel) ∥ Phase 3 ICR plan (parallel track)
  ↓
I2 (serial) + I3-ICR (after ICR integration)
  ↓
Phase 4 O1–O3 (parallel) → I4 (serial)
  ↓
Phase 5 C1–C3 (parallel)
```

**Minimum viable leverage (if time-boxed):** Phase 1 only (B1–B6 + I1) delivers ~80% of perceived Pi amplifier gain.

---

## Subagent Prompt Template

```text
You are implementing worker [WORKER_ID] from:
docs/superpowers/plans/2026-06-20-full-architecture-leverage-parallel-subagents.md

Phase: [1|2|3|4|5]
Assigned files (ONLY these):
[FILE_LIST]

Non-negotiable:
- evidenceOnly: true, canPromote: false on all bridge/persist surfaces
- Quarantine secrets and paths in anything model-visible
- TDD: failing tests first
- Do not edit shared chokepoints (Integration Worker owns those)

Return:
- status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- changed files
- tests run + results
- remaining concerns
```

---

## Success Criteria (Definition of Done)

- [ ] Main Pi `prompt` prepends unified pack: skills (excerpts), soul/oversoul, evolution summary, optional memory/ICR
- [ ] Pi-native swarm uses same pack via `compactPiBridgeContextForSwarm`
- [ ] `helios-forge.ts` extension receives bounded context; telemetry records manifest consumed
- [ ] Shadow skill candidates appear as advisory hints (not auto-installed)
- [ ] Post-task skill path emits BES lane evidence
- [ ] Optional full `runPromotionLoop` orchestration persists audit trail; apply still operator-gated
- [ ] Operator UI shows bridge health, promotion queue, shadow skills
- [ ] `full-evolution` profile documented and mergeable into workplace config
- [ ] All new tests pass; reconciliation doc updated

---

## Out of Scope (Explicit)

- Bundling Pi Agent inside Electron (see Electron plan)
- Paper-grade production proof at scale (operator runtime work after wiring)
- External A2A network transport (M6)
- Real model-backed RHO embeddings at scale (M5 gates)
- Weakening trust kernel or silent apply to `src/`

---

## Related Reading

- Pi bridge audit (conversation baseline, June 20 2026)
- `docs/architecture/feature-architecture-map.md` — runtime flow
- `docs/architecture/evolutionary-agentic-organism-gap-map.md` — remaining organism gaps
