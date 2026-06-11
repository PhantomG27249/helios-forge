# Recursive Soul Evolution Levels Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class recursive evolution-level contract so souls, subagent societies, SwarmCells, swarms, oversouls, harnesses, and meta-harnesses can all propose evidence-only evolution with lineage preserved.

**Architecture:** Keep this pass as a metadata/evidence spine, not a nested execution engine. Define normalized evolution-level refs and envelopes under `src/harness-sidecar/souls`, attach them to soul mutation candidates, SwarmCell outputs, and BES lane evidence, and keep every level non-authorizing. Later work can use these contracts to let middle agents spawn bounded child societies.

**Tech Stack:** Node.js ESM, `node:test`, existing BES/SwarmCell/soul runtime modules.

---

## File Structure

- Create `src/harness-sidecar/souls/evolutionLevels.js`
  - Owns allowed recursive levels, normalized refs, lineage paths, and evidence-only envelopes.
- Modify `src/harness-sidecar/souls/soulEvolution.js`
  - Adds `evolutionLevel`, `parentLevelRef`, `childLevelRefs`, and `societyRefs` to shadow soul candidates.
- Keep `src/harness-sidecar/souls/soulEvidence.js`
  - Owns soul refs only; recursive level refs live in `evolutionLevels.js`.
- Modify `src/harness-sidecar/swarm/swarmCellContracts.js`
  - Preserves recursive level metadata in task and evolution output.
- Modify `src/harness-sidecar/bes/laneEvidence.js`
  - Adds `evolution_level_refs` as non-substantive evidence metadata.
- Modify `src/harness-sidecar/bes/laneRuntime.js`
  - Carries level refs from candidates into normalized BES candidates.
- Add tests:
  - `tests/soul-evolution-levels.test.js`
  - Extend `tests/soul-evidence.test.js`
  - Extend `tests/soul-evolution.test.js`

## Task 1: Evolution-Level Contract

**Files:**
- Create: `src/harness-sidecar/souls/evolutionLevels.js`
- Test: `tests/soul-evolution-levels.test.js`

- [x] Write failing tests for allowed levels: `subagent_soul`, `subagent_society`, `swarm_cell`, `swarm`, `oversoul`, `local_harness`, `global_harness`, `meta_harness`.
- [x] Test that invalid levels are rejected or normalized to `subagent_soul` only when a fallback is explicit.
- [x] Test that level refs include `level`, `levelId`, `version`, `parentRef`, `childRefs`, `lineagePath`, `evidenceOnly: true`, `promotionAuthority: false`.
- [x] Implement `normalizeEvolutionLevelRef(value)`.
- [x] Implement `buildEvolutionLevelEnvelope({ level, levelId, version, parentRef, childRefs, soulRefs, societyRefs })`.
- [x] Run `node --test tests/soul-evolution-levels.test.js`.

## Task 2: Soul Candidate Level Metadata

**Files:**
- Modify: `src/harness-sidecar/souls/soulEvolution.js`
- Test: `tests/soul-evolution.test.js`

- [x] Add failing tests that soul mutation candidates preserve `evolutionLevel`, `parentLevelRef`, `childLevelRefs`, and `societyRefs`.
- [x] Ensure candidate metadata remains `shadow_only`, `evidenceOnly`, `promotionAuthority: false`, and `durableApplyApproved: false`.
- [x] Include evolution-level lineage in harness variant `lineage`.
- [x] Run `node --test tests/soul-evolution.test.js`.

## Task 3: SwarmCell And BES Evidence Flow

**Files:**
- Use: `src/harness-sidecar/souls/evolutionLevels.js`
- Modify: `src/harness-sidecar/swarm/swarmCellContracts.js`
- Modify: `src/harness-sidecar/bes/laneEvidence.js`
- Modify: `src/harness-sidecar/bes/laneRuntime.js`
- Test: `tests/soul-evidence.test.js`

- [x] Add failing tests showing level refs are preserved in SwarmCell task/evolution output.
- [x] Add failing tests showing BES candidates carry `evolutionLevelRefs`.
- [x] Add failing tests proving `evolution_level_refs` do not satisfy required substantive evidence by themselves.
- [x] Implement normalization and wiring.
- [x] Run `node --test tests/soul-evidence.test.js`.

## Task 4: Docs And Verification

**Files:**
- Modify: `docs/architecture/feature-architecture-map.md`
- Modify: `docs/architecture/evolutionary-agentic-organism-gap-map.md`
- Modify: `docs/architecture/paper-implementation-alignment.md`

- [x] Add concise docs rows for recursive evolution levels.
- [x] Run focused tests:
  - `node --test tests/soul-evolution-levels.test.js tests/soul-evidence.test.js tests/soul-evolution.test.js`
- [x] Run adjacent regression:
  - `node --test tests/harness-swarmcell-contracts.test.js tests/harness-bes-lane-runtime.test.js tests/harness-swarm-runtime.test.js`
- [x] Run full verification:
  - `npm test`
  - `npm run release:smoke`
  - `git diff --check`
