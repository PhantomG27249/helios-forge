# Self-Authored Skill Evolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Helios Forge propose, test, evolve, and approval-promote its own workspace-local `SKILL.md` capabilities using Retrospective Harness Optimization, BES, AB-MCTS scheduling, verifiers, source-skill snapshots, and safe capability mounting.

**Architecture:** The agent never writes directly to global Pi, Codex, Claude, or user skill folders. It writes shadow-only skill candidates under `.harness/meta/skill-candidates/<candidateId>/`, evaluates them against RHO-selected hard cases and held-out traces, and only installs the winner into `.harness/packages` through an approval-gated promotion path. When an existing loaded skill is relevant, Helios stores an immutable workspace-local source snapshot and evolves a separate adapted candidate so the original and the moment-specific adaptation can be inspected side by side.

**Tech Stack:** Node.js ESM, `node:test`, Helios capability store and package installer, `.harness` workspace state, RHO coreset builder, BES meta optimizer, verifier registry, trace replay, approval resume, safe apply.

---

## Current Context

Helios already supports:

- workspace-local capabilities in `src/harness-sidecar/capabilities/capabilityStore.js`;
- package installation with declared `skills/*/SKILL.md` files in `src/harness-sidecar/capabilities/piPackageInstaller.js`;
- install records for external skill sources such as Smithery, Codex marketplace, Claude Code marketplace, and Pi packages;
- memory candidates in `src/harness-sidecar/memory/memoryWriter.js`;
- verifier and policy candidate promotion in `src/harness-sidecar/meta/promotionPolicy.js`;
- RHO hard-case mining in `src/harness-sidecar/rho/coresetBuilder.js`;
- BES candidate generation in `src/harness-sidecar/meta/besMetaOptimizer.js`;
- approval resume in `src/harness-sidecar/core/approvalResume.js`.

Missing piece: a first-class skill-candidate lifecycle. This plan adds one.

Original RHO alignment: this plan should mirror the paper's core pattern more closely than a generic skill generator. RHO selects hard cases from prior trajectories, replays or re-solves them, extracts self-validation and self-consistency diagnostics, proposes harness updates, and chooses a winner by pairwise preference against the baseline. For skills, the baseline can be either no skill, the currently loaded skill, or an immutable source snapshot of a loaded skill.

Recommended external seed: `https://smithery.ai/skills/anthropics/skill-creator`. Treat this as a candidate skill-creation scaffold and rubric source when available through the normal capability installer. It can help shape generated `SKILL.md` structure, trigger clarity, workflow boundaries, safety sections, and verification checklists, but it should be snapshotted and evaluated like any other source skill before Helios adapts from it.

## Lifecycle

1. RHO mines traces for repeated failure patterns that would benefit from a reusable skill.
2. If a loaded skill is relevant, Helios snapshots the original `SKILL.md` plus provenance into `.harness/meta/skill-snapshots/<snapshotId>/`.
3. BES decomposes the desired skill adaptation into goals, constraints, and evaluation cases.
4. Skill-creation scaffolds, such as Smithery `anthropics/skill-creator`, may provide seed structure or evaluation rubrics.
5. AB-MCTS schedules whether to copy/snapshot a source skill, generate a new skill, refine a current candidate, gather more evidence, or stop.
6. Candidate writer creates an adapted `SKILL.md` plus metadata in `.harness/meta/skill-candidates/<candidateId>/`.
7. Verifiers and trace replay score the original baseline and adapted candidate.
8. Promotion policy queues an approval.
9. Approved candidate is packaged into `.harness/packages/<packageId>/` and mounted as a normal workspace-local skill.

## Chunk 1: Skill Candidate Store

### Task 1: Add Candidate Schema And Storage

**Files:**
- Create: `src/harness-sidecar/skills/skillCandidateStore.js`
- Test: `tests/harness-skill-candidate-store.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- writes candidate under `.harness/meta/skill-candidates/<safe-id>/`;
- rejects unsafe ids and paths;
- writes `SKILL.md`, `candidate.json`, optional `evaluation.json`, and optional source-snapshot references;
- never writes outside workspace;
- never writes to global Pi/Codex/Claude folders.

Run:

```powershell
npm test -- tests/harness-skill-candidate-store.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement schema**

Candidate record:

```js
{
  candidateId: 'skill_candidate_visual_debug_001',
  status: 'shadow_only',
  skill: {
    id: 'visual-debugging-repair',
    name: 'Visual Debugging Repair',
    trigger: 'Use when UI visual verification fails...',
    path: '.harness/meta/skill-candidates/.../SKILL.md'
  },
  source: {
    rhoCaseIds: [],
    traceIds: [],
    failureModes: [],
    sourceSkillSnapshotId: 'skill_snapshot_superpowers_debugging_001',
    sourceSkillPath: 'C:/Users/<user>/.codex/superpowers/skills/systematic-debugging/SKILL.md',
    sourceLicense: 'unknown',
    sourcePermission: 'snapshot_for_local_evaluation_only'
  },
  scaffold: {
    source: 'smithery',
    qualifiedName: 'anthropics/skill-creator',
    url: 'https://smithery.ai/skills/anthropics/skill-creator',
    usage: 'structure_and_rubric_seed'
  },
  lineage: {
    origin: 'adapted_from_loaded_skill',
    sourceSnapshotId: 'skill_snapshot_superpowers_debugging_001',
    adaptationReason: 'RHO hard cases showed repeated debugging drift in Helios tasks'
  },
  safety: {
    secretsScan: 'pending',
    pathScan: 'pending',
    licenseScan: 'pending',
    globalWrite: false
  },
  rollback: {
    installRecordId: null,
    packageId: null
  }
}
```

- [ ] **Step 3: Implement store functions**

```js
export async function writeSkillCandidate({ workspaceRoot, candidate, skillMarkdown } = {}) {}
export async function readSkillCandidate({ workspaceRoot, candidateId } = {}) {}
export async function listSkillCandidates({ workspaceRoot } = {}) {}
export async function writeSkillCandidateEvaluation({ workspaceRoot, candidateId, evaluation } = {}) {}
export async function writeSourceSkillSnapshot({ workspaceRoot, sourceSkill, skillMarkdown } = {}) {}
export async function readSourceSkillSnapshot({ workspaceRoot, snapshotId } = {}) {}
```

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-skill-candidate-store.test.js
git add src/harness-sidecar/skills/skillCandidateStore.js tests/harness-skill-candidate-store.test.js
git commit -m "feat(skills): add skill candidate store"
```

## Chunk 2: RHO Skill Need Mining

### Task 2: Select Hard Cases That Deserve Skills

**Files:**
- Modify: `src/harness-sidecar/rho/coresetBuilder.js`
- Create: `src/harness-sidecar/skills/skillNeedMiner.js`
- Test: `tests/harness-skill-need-miner.test.js`

- [ ] **Step 1: Write failing tests**

Cover hard-case categories:

- repeated visual debugging failures;
- repeated research synthesis/citation failures;
- repeated malformed tool/MCP use;
- repeated approval confusion;
- repeated memory/RAG retrieval misses;
- repeated missing verifier evidence.

- [ ] **Step 2: Implement skill need miner**

Export:

```js
export function mineSkillNeedsFromRho({ coreset, traces, existingCapabilities } = {}) {}
```

Return ranked needs:

```js
{
  needId: 'skill_need_visual_debugging_repair',
  title: 'Visual Debugging Repair',
  failureModes: ['visual_false_negative', 'missing_artifact_context'],
  evidence: [{ traceId, eventId, reason }],
  targetCapabilities: ['visual.verifier.run', 'browser.preview'],
  priority: 0.82
}
```

- [ ] **Step 3: Avoid duplicate skills**

Compare against installed skill names, ids, triggers, and package metadata so the harness refines existing skills when a close match already exists.

- [ ] **Step 4: Surface source-skill adaptation opportunities**

When an installed or loaded skill already covers part of the need, return an adaptation opportunity instead of only a blank-slate skill request:

```js
{
  needId: 'skill_need_visual_debugging_repair',
  sourceSkill: {
    name: 'systematic-debugging',
    path: 'C:/Users/<user>/.codex/superpowers/skills/systematic-debugging/SKILL.md',
    permission: 'snapshot_for_local_evaluation_only'
  },
  requestedAdaptation: 'Tailor the workflow to Helios visual verifier traces and VLM artifact evidence.'
}
```

- [ ] **Step 5: Prefer skill-creator scaffolds when available**

If `anthropics/skill-creator` or a similar skill-creation skill is installed, expose it as a scaffold source for the generator and evaluator. The scaffold should supply structure and rubric hints only; it must not bypass Helios safety, replay, approval, or promotion policy.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test -- tests/harness-skill-need-miner.test.js tests/harness-rho-coreset.test.js
git add src/harness-sidecar/rho/coresetBuilder.js src/harness-sidecar/skills/skillNeedMiner.js tests/harness-skill-need-miner.test.js
git commit -m "feat(skills): mine skill needs from RHO"
```

## Chunk 3: BES Skill Candidate Generation

### Task 3: Generate And Refine Candidate Skills

**Files:**
- Create: `src/harness-sidecar/skills/skillEvolution.js`
- Modify: `src/harness-sidecar/meta/besMetaOptimizer.js`
- Test: `tests/harness-skill-evolution.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- creates multiple skill candidate genomes from one skill need;
- decomposes skill quality into subgoals;
- uses installed skill-creation scaffolds as optional structure/rubric seeds;
- recombines useful sections from parent skills;
- adapts from immutable source-skill snapshots without mutating the original;
- preserves strict safety boundaries;
- candidate stays `shadow_only`.

- [ ] **Step 2: Define skill genome**

Skill genome fields:

```js
{
  genomeId,
  skillId,
  sourceSnapshotId,
  triggerPolicy,
  workflowSteps,
  requiredEvidence,
  forbiddenActions,
  verifierRequirements,
  lineage,
  mutations
}
```

- [ ] **Step 3: Generate `SKILL.md`**

Render markdown from the genome. Required sections:

- purpose;
- when to use;
- when not to use;
- source skill lineage, when adapted from a snapshot;
- scaffold lineage, when generated with `anthropics/skill-creator` or another creation skill;
- required evidence;
- workflow;
- safety constraints;
- verification checklist;
- escalation behavior.

- [ ] **Step 4: Hook into BES meta optimizer**

Add `skill_policy` or `skill_candidate` as a meta target, but keep direct application disabled.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- tests/harness-skill-evolution.test.js tests/harness-meta-bes-optimizer.test.js
git add src/harness-sidecar/skills/skillEvolution.js src/harness-sidecar/meta/besMetaOptimizer.js tests/harness-skill-evolution.test.js
git commit -m "feat(skills): generate BES skill candidates"
```

## Chunk 4: AB-MCTS Scheduling For Skill Evolution

### Task 4: Allocate Skill Evolution Budget

**Files:**
- Modify: `src/harness-sidecar/bes/adaptiveSearchScheduler.js` if it exists from the wide AB-MCTS plan.
- Create: `src/harness-sidecar/skills/skillEvolutionScheduler.js`
- Test: `tests/harness-skill-evolution-scheduler.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- `go_wider` creates more skill variants when no candidate is strong;
- `go_deeper` refines the current best skill after partial success;
- `gather_evidence` asks for more trace replay/verifier cases when reward is ambiguous;
- `stop_or_promote` only recommends promotion, never installs directly.

- [ ] **Step 2: Implement adapter**

Create:

```js
export function buildSkillEvolutionSearchContext({ skillNeed, candidates, evaluations, budget } = {}) {}
export function normalizeSkillEvolutionReward({ candidate, evaluation } = {}) {}
```

- [ ] **Step 3: Add trace events**

Emit:

- `skill_evolution.ab_mcts_action_selected`
- `skill_evolution.source_snapshot_selected`
- `skill_evolution.candidate_refined`
- `skill_evolution.evidence_requested`

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-skill-evolution-scheduler.test.js
git add src/harness-sidecar/skills/skillEvolutionScheduler.js tests/harness-skill-evolution-scheduler.test.js
git commit -m "feat(skills): schedule skill evolution with adaptive search"
```

## Chunk 5: Skill Evaluation And Replay

### Task 5: Score Candidate Skills Against Held-Out Cases

**Files:**
- Create: `src/harness-sidecar/skills/skillCandidateEvaluator.js`
- Modify: `src/harness-sidecar/core/traceReader.js` if needed.
- Test: `tests/harness-skill-candidate-evaluator.test.js`

- [ ] **Step 1: Write failing tests**

Candidate skill should be scored on:

- baseline comparison against no skill, current loaded skill, or source snapshot;
- adherence to the selected skill-creation scaffold without blindly copying unsafe or irrelevant instructions;
- trigger precision;
- task success improvement;
- verifier evidence completeness;
- safety compliance;
- no secrets;
- no broad unsafe instructions;
- no global writes;
- license/provenance compatibility for copied or adapted source text;
- no prompt-injection susceptibility in skill text;
- cost and latency impact.

- [ ] **Step 2: Implement deterministic evaluator**

Start with static and replay-based scoring. Do not require live model calls for unit tests.

- [ ] **Step 3: Add optional model/VLM evaluation**

When enabled, the evaluator may ask the configured model to critique the candidate skill, but model judgment is advisory and must be backed by replay/static evidence.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-skill-candidate-evaluator.test.js
git add src/harness-sidecar/skills/skillCandidateEvaluator.js tests/harness-skill-candidate-evaluator.test.js
git commit -m "feat(skills): evaluate skill candidates"
```

## Chunk 6: Approval-Gated Promotion Into Workspace Capabilities

### Task 6: Install Approved Skill Candidates

**Files:**
- Create: `src/harness-sidecar/skills/skillCandidateApply.js`
- Modify: `src/harness-sidecar/meta/promotionPolicy.js`
- Modify: `src/harness-sidecar/core/approvalResume.js`
- Test: `tests/harness-skill-candidate-apply.test.js`
- Test: `tests/harness-meta-promotion.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- promotion rejected without human approval;
- promotion rejected without held-out improvement;
- promotion rejected when copied/adapted source provenance is missing or incompatible;
- promotion rejected with unsafe text/path/global write;
- approved candidate installs into `.harness/packages/generated-skills/<skill-id>/SKILL.md`;
- capability record is saved with `type: "skill"`;
- rollback removes or disables the generated skill capability.

- [ ] **Step 2: Extend promotion policy**

Add skill-candidate detection:

```js
target === 'skill_candidate'
```

Required reasons:

- `human_approved`;
- `skill_holdout_improved`;
- `skill_safety_clean`;
- `skill_trigger_precision_ok`;
- `skill_cost_ok`;
- `rollback_available`.

- [ ] **Step 3: Implement apply path**

Use existing workspace-local package/capability rules. Do not write to global Pi, Codex, Claude, or home skill directories.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-skill-candidate-apply.test.js tests/harness-meta-promotion.test.js tests/harness-capabilities.test.js
git add src/harness-sidecar/skills/skillCandidateApply.js src/harness-sidecar/meta/promotionPolicy.js src/harness-sidecar/core/approvalResume.js tests/harness-skill-candidate-apply.test.js tests/harness-meta-promotion.test.js
git commit -m "feat(skills): promote approved skill candidates"
```

## Chunk 7: UI And Operator Review

### Task 7: Add Skill Evolution Review Surface

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Modify: `src/server.js`
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-ui-discoverability.test.js`
- Test: `tests/harness-sidecar.test.js`

- [ ] **Step 1: Write failing UI/API tests**

Operator should see:

- candidate skill name;
- source skill snapshot and diff, when adapted from a loaded skill;
- source hard cases;
- generated `SKILL.md`;
- evaluation score;
- safety checks;
- approval buttons;
- rollback metadata.

- [ ] **Step 2: Add sidecar endpoints**

Add:

- `GET /v1/skill-candidates`
- `GET /v1/skill-candidates/:id`
- `POST /v1/skill-candidates/:id/approve`
- `POST /v1/skill-candidates/:id/reject`

- [ ] **Step 3: Add browser panel**

In Capabilities or a new Skill Evolution tab, show candidate list and detailed inspection. Keep generated skill text readable without requiring file-system browsing.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
git add public/index.html public/app.js public/app.css src/server.js src/harness-sidecar/server.js tests/harness-ui-discoverability.test.js tests/harness-sidecar.test.js
git commit -m "feat(ui): add skill evolution review"
```

## Safety Rules

- Agent-authored skills are always `shadow_only` until approved.
- Source skill snapshots are immutable and workspace-local.
- Adapted skills never overwrite the original loaded skill.
- Skill-creation scaffolds, including `https://smithery.ai/skills/anthropics/skill-creator`, are advisory structure/rubric sources only.
- Candidate skills cannot write outside `.harness/meta/skill-candidates`.
- Promotion cannot write outside workspace-local `.harness/packages`.
- Copied or adapted text must retain provenance, source path, license/permission metadata, and a diff from the original.
- Skill text must pass secret scan and prompt-injection hygiene checks.
- Generated skills must include "when not to use" and explicit escalation rules.
- Generated skills cannot weaken approval, verifier, sandbox, or secret-handling policy.
- RHO/BES/AB-MCTS can recommend promotion, but only promotion policy plus approval can install.

## Final Verification

Run:

```powershell
npm test
npm run release:smoke
git diff --check
rg --no-ignore --hidden -n -S -e "95\\.133\\.252\\.102" -e "sk-[A-Za-z0-9]{12,}" . --glob "!.git/**" --glob "!node_modules/**"
```

Expected:

- all tests pass with existing skipped symlink cases only;
- release smoke passes;
- no whitespace errors;
- private endpoint/model remains only in ignored local runtime files if present, never in tracked source or generated promoted skill files.
