# Pi Research Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Pi chat wrapper plus local research sidecar that can launch, observe, approve, and audit research-agent tasks.

**Architecture:** Keep the existing chat app as the interactive Pi and harness UI. Add a local sidecar for task orchestration, verifier loops, trace storage, budgets, retrieval, memory, swarms, and research workflows. Start with a working MVP bridge before adding RAG, VLM, swarms, and collaboration.

**Tech Stack:** Node.js ESM, WebSocket server with `ws`, browser HTML/CSS/JS, Pi RPC subprocess, local sidecar HTTP/event API, file-based traces for MVP.

---

## File Structure

Create or modify these files during the MVP and V1 work:

- Modify `src/server.js`: keep Pi RPC bridge; add harness process supervision, harness commands, and event relay.
- Create `src/harness/harnessManager.js`: starts, stops, restarts, and health-checks the local sidecar.
- Create `src/harness/harnessClient.js`: calls sidecar endpoints and subscribes to events.
- Create `src/harness/harnessMessages.js`: shared wrapper-side message names and validation helpers.
- Modify `public/index.html`: add harness status, task, approval, and artifact UI containers.
- Modify `public/app.js`: add harness WebSocket commands and renderers.
- Modify `public/app.css`: style compact harness panels.
- Create `src/harness-sidecar/server.js`: local sidecar entrypoint.
- Create `src/harness-sidecar/api/routes.js`: health, task, events, approvals, artifacts, budgets.
- Create `src/harness-sidecar/core/taskRouter.js`: routes task types.
- Create `src/harness-sidecar/core/taskStateMachine.js`: task lifecycle and event emission.
- Create `src/harness-sidecar/core/traceWriter.js`: writes JSONL traces and final audit.
- Create `src/harness-sidecar/tools/shellBroker.js`: runs safe verifier commands.
- Create `src/harness-sidecar/tools/patchManager.js`: creates patch proposal artifacts.
- Create `src/harness-sidecar/tools/verifierRunner.js`: runs configured validation.
- Create `src/harness-sidecar/reliability/errorRecovery.js`: normalizes failures.
- Create `src/harness-sidecar/budget/budgetManager.js`: tracks MVP budget counters.
- Create `src/harness-sidecar/config/loadHarnessConfig.js`: loads `.harness/config.yaml` if present.
- Create `src/harness-sidecar/test-fixtures/toy-task.js`: deterministic toy task for smoke verification.
- Create `docs/research-harness/cleaned-product-spec.md`: source of truth for scope.

## Chunk 1: Wrapper and Sidecar MVP

### Task 1: Harness Process Supervisor

**Agent:** Wrapper Integration Agent

**Files:**

- Create: `src/harness/harnessManager.js`
- Modify: `src/server.js`

- [ ] **Step 1: Write the failing harness manager smoke test**

Create a small Node test or script that instantiates `HarnessManager` with a fake command and verifies status transitions: `stopped`, `starting`, `running`, `stopped`.

- [ ] **Step 2: Run the smoke test and confirm failure**

Run: `node src/harness/harnessManager.smoke.js`

Expected: FAIL because `src/harness/harnessManager.js` does not exist.

- [ ] **Step 3: Implement `HarnessManager`**

Implement:

```javascript
export class HarnessManager {
  constructor({ workspaceRoot, port, command, args } = {}) {}
  async start() {}
  async stop() {}
  async restart() {}
  getStatus() {}
}
```

Required behavior:

- Start `node src/harness-sidecar/server.js --port <port> --workspace <workspaceRoot>`.
- Preserve stdout and stderr into a small rolling log.
- Report process status to `src/server.js`.
- Do not kill Pi RPC when the sidecar restarts.

- [ ] **Step 4: Add server commands**

Add WebSocket command handlers in `src/server.js`:

- `harness_status`
- `harness_start`
- `harness_stop`
- `harness_restart`

Responses:

- `harness_status`
- `harness_error`

- [ ] **Step 5: Verify**

Run: `npm run dev`

Expected:

- Existing Pi chat server still starts on port 3777.
- Sending `{"type":"harness_status"}` over WebSocket returns status.
- Starting the harness does not interrupt Pi RPC.

### Task 2: Sidecar Health and Events

**Agent:** Sidecar Core Agent

**Files:**

- Create: `src/harness-sidecar/server.js`
- Create: `src/harness-sidecar/api/routes.js`
- Create: `src/harness-sidecar/core/traceWriter.js`

- [ ] **Step 1: Write sidecar health smoke script**

Create a smoke script that starts the sidecar, calls `/v1/health`, and expects JSON with `status: "ok"`.

- [ ] **Step 2: Run and confirm failure**

Run: `node src/harness-sidecar/health.smoke.js`

Expected: FAIL because the sidecar server does not exist.

- [ ] **Step 3: Implement sidecar server**

Implement:

- `GET /v1/health`
- `GET /v1/events`
- in-memory event subscribers
- graceful shutdown on SIGTERM

Health response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "workspaceRoot": "..."
}
```

- [ ] **Step 4: Verify**

Run: `node src/harness-sidecar/server.js --port 49321 --workspace .`

Expected:

- `GET http://localhost:49321/v1/health` returns the health JSON.
- Event endpoint stays connected and accepts future events.

### Task 3: Task Start and Event Relay

**Agent:** Wrapper Integration Agent and Sidecar Core Agent

**Files:**

- Create: `src/harness/harnessClient.js`
- Modify: `src/server.js`
- Modify: `src/harness-sidecar/api/routes.js`
- Create: `src/harness-sidecar/core/taskStateMachine.js`
- Create: `src/harness-sidecar/core/taskRouter.js`

- [ ] **Step 1: Define task messages**

Create wrapper WebSocket commands:

- `harness_task_start`
- `harness_task_abort`
- `harness_task_status`

Create wrapper WebSocket events:

- `harness_task_started`
- `harness_task_event`
- `harness_task_finished`
- `harness_task_error`

- [ ] **Step 2: Implement task endpoint**

Add `POST /v1/tasks` accepting:

```json
{
  "workspaceId": "local",
  "task": "fix the failing test",
  "mode": "mvp",
  "budget": {
    "maxToolCalls": 20,
    "maxWallMinutes": 15
  }
}
```

- [ ] **Step 3: Emit deterministic MVP events**

For the first implementation, emit a scripted task sequence:

- `task.started`
- `scope_contract.created`
- `verifier.started`
- `verifier.finished`
- `patch.proposed`
- `approval.required`

- [ ] **Step 4: Relay events to browser clients**

`src/server.js` subscribes to sidecar events and broadcasts them unchanged as `harness_task_event`.

- [ ] **Step 5: Verify**

Run: `npm run dev`

Expected:

- Browser can start a harness task.
- Task events arrive through the existing WebSocket.
- Pi chat events still render normally.

## Chunk 2: UI Observability and Approval Flow

### Task 4: Harness Status Panel

**Agent:** UI Observability Agent

**Files:**

- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`

- [ ] **Step 1: Add static panel markup**

Add a compact harness panel near the topbar or sidebar with:

- sidecar connection status
- active task count
- current budget summary
- pending approval count

- [ ] **Step 2: Add render state**

In `public/app.js`, add:

```javascript
let harnessState = {
  status: 'unknown',
  activeTasks: new Map(),
  pendingApprovals: new Map(),
  latestEvents: []
};
```

- [ ] **Step 3: Render harness events**

Handle:

- `harness_status`
- `harness_task_started`
- `harness_task_event`
- `harness_task_finished`
- `harness_task_error`

- [ ] **Step 4: Verify text fit and responsive layout**

Run: `npm run dev`

Expected:

- The panel fits at desktop and mobile widths.
- Long task names truncate cleanly.
- Existing chat input and session sidebar do not overlap.

### Task 5: Approval Modal

**Agent:** UI Observability Agent and Wrapper Integration Agent

**Files:**

- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Modify: `src/server.js`

- [ ] **Step 1: Add approval modal**

Modal fields:

- risk
- reason
- proposed action
- budget impact
- choices: approve, reject, edit, defer

- [ ] **Step 2: Add browser command**

Send:

```json
{
  "type": "harness_approval_response",
  "actionId": "act_123",
  "choice": "approve"
}
```

- [ ] **Step 3: Add server relay**

`src/server.js` sends approval response to sidecar:

`POST /v1/approvals/{actionId}`

- [ ] **Step 4: Verify**

Expected:

- Scripted `approval.required` event opens modal.
- Approve/reject sends response to sidecar.
- Sidecar emits `approval.resolved`.

### Task 6: Patch and Artifact Preview MVP

**Agent:** UI Observability Agent and Tooling Agent

**Files:**

- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`
- Create: `src/harness-sidecar/artifacts/artifactStore.js`

- [ ] **Step 1: Add artifact manifest schema**

MVP artifact:

```json
{
  "artifactId": "patch_001",
  "type": "patch",
  "title": "Proposed patch",
  "files": ["src/example.js"],
  "contentType": "text/x-diff",
  "path": ".harness/traces/TASK/artifacts/patch.diff"
}
```

- [ ] **Step 2: Add artifact endpoint**

Add:

- `GET /v1/artifacts/{artifactId}`

- [ ] **Step 3: Render patch artifact**

Show file list and diff text in a scrollable preview.

- [ ] **Step 4: Verify**

Expected:

- Scripted patch proposal event displays diff preview.
- Approval modal can be opened from patch preview.

## Chunk 3: Tooling, Verifiers, and Audit

### Task 7: Verifier Runner

**Agent:** Tooling and Verifier Agent

**Files:**

- Create: `src/harness-sidecar/tools/shellBroker.js`
- Create: `src/harness-sidecar/tools/verifierRunner.js`
- Create: `src/harness-sidecar/config/loadHarnessConfig.js`

- [ ] **Step 1: Add config loader**

Load `.harness/config.yaml` if present. For MVP, support JSON-compatible YAML shape manually or use a tiny parser only if added intentionally.

Minimum config:

```yaml
verifiers:
  - name: npm-test
    command: npm test
```

- [ ] **Step 2: Implement shell broker**

Required:

- command string
- cwd
- timeout
- stdout/stderr capture
- exit code
- no recursive delete helpers

- [ ] **Step 3: Implement verifier runner**

Run configured verifier commands and emit:

- `verifier.started`
- `verifier.output`
- `verifier.finished`

- [ ] **Step 4: Verify**

Run a toy verifier command:

`node -e "console.log('ok')"`

Expected:

- Exit code 0.
- Output captured in trace.
- Event stream shows start and finish.

### Task 8: Patch Proposal and Final Audit

**Agent:** Tooling and Verifier Agent

**Files:**

- Create: `src/harness-sidecar/tools/patchManager.js`
- Create: `src/harness-sidecar/tools/finalValidator.js`
- Modify: `src/harness-sidecar/core/traceWriter.js`

- [ ] **Step 1: Implement patch proposal artifact**

Patch proposals are artifacts until approved. Do not apply to workspace in MVP.

- [ ] **Step 2: Implement final audit report**

Write:

- `summary.md`
- `events.jsonl`
- `verifier-results.json`
- `artifacts/patch.diff`

- [ ] **Step 3: Verify**

Expected:

- Task completion writes trace under `.harness/traces/<task-id>/`.
- Final report links verifier results and patch artifact.

## Chunk 4: Reliability MVP

### Task 9: Error Recovery Foundation

**Agent:** Reliability Agent

**Files:**

- Create: `src/harness-sidecar/reliability/errorRecovery.js`
- Create: `src/harness-sidecar/reliability/toolCallRepair.js`
- Create: `src/harness-sidecar/reliability/loopDetector.js`

- [ ] **Step 1: Define error taxonomy**

Categories:

- malformed_tool_call
- unknown_tool
- tool_timeout
- patch_failure
- verifier_failure
- sandbox_crash
- no_progress_loop
- budget_exhausted

- [ ] **Step 2: Implement structured recovery event**

Emit:

```json
{
  "type": "recovery.event",
  "category": "tool_timeout",
  "recoverability": "retryable",
  "summary": "Verifier timed out after 60 seconds"
}
```

- [ ] **Step 3: Implement no-progress detector**

Detect repeated same command, same failure, or same patch proposal over a configurable threshold.

- [ ] **Step 4: Verify**

Simulate repeated verifier failure.

Expected:

- Sidecar emits recovery event.
- Task either changes strategy or stops with partial report.

### Task 10: Budget Manager MVP

**Agent:** Reliability Agent

**Files:**

- Create: `src/harness-sidecar/budget/budgetManager.js`
- Modify: `src/harness-sidecar/core/taskStateMachine.js`
- Modify: `public/app.js`

- [ ] **Step 1: Define budget state**

Track:

- tool calls
- verifier calls
- wall time
- artifact count
- estimated tokens as optional future field

- [ ] **Step 2: Add budget gates**

Gates:

- 50 percent: emit summary
- 75 percent: emit warning
- 90 percent: require approval
- 100 percent: stop except cleanup

- [ ] **Step 3: Render budget state**

Show budget used in the harness panel.

- [ ] **Step 4: Verify**

Simulate a small budget with repeated events.

Expected:

- UI shows gate warnings.
- 90 percent gate creates approval request.
- 100 percent gate stops task.

## Chunk 5: V1 Retrieval, Memory, and Context

### Task 11: Workspace Retrieval MVP

**Agent:** Retrieval and Memory Agent

**Files:**

- Create: `src/harness-sidecar/rag/workspaceIndexer.js`
- Create: `src/harness-sidecar/rag/retriever.js`
- Create: `src/harness-sidecar/rag/contextPackBuilder.js`

- [ ] **Step 1: Index workspace files**

Index paths, sizes, extensions, and short text snippets. Exclude `node_modules`, `.git`, `dist`, `.harness/traces`, and large binary files.

- [ ] **Step 2: Implement keyword retrieval**

Return source-tracked context items:

```json
{
  "type": "file_snippet",
  "path": "src/server.js",
  "reason": "matches task keywords",
  "tokensEstimated": 300
}
```

- [ ] **Step 3: Build context pack**

Respect a simple max item count and token estimate.

- [ ] **Step 4: Verify**

Ask for a task mentioning "WebSocket sidecar".

Expected:

- Context pack includes `src/server.js` and relevant docs.

### Task 12: Memory Candidate Records

**Agent:** Retrieval and Memory Agent

**Files:**

- Create: `src/harness-sidecar/memory/memoryWriter.js`
- Create: `src/harness-sidecar/memory/reflectionGate.js`

- [ ] **Step 1: Define memory candidate schema**

Fields:

- type
- summary
- evidence
- confidence
- createdByTask
- reviewStatus

- [ ] **Step 2: Write candidates only**

MVP must not promote memory automatically.

- [ ] **Step 3: Verify**

Expected:

- Failed repeated strategy writes candidate dead-end memory.
- UI or trace marks it as `reviewStatus: "candidate"`.

## Chunk 6: V1 Worktree Isolation and Swarms

### Task 13: Worktree Manager

**Agent:** Swarm and Worktree Agent

**Files:**

- Create: `src/harness-sidecar/swarm/worktreeManager.js`
- Create: `src/harness-sidecar/swarm/attemptScheduler.js`

- [ ] **Step 1: Detect git availability**

If the workspace is not a git repo, sidecar must report worktree mode unavailable and continue single-workspace MVP mode.

- [ ] **Step 2: Create attempt worktrees**

Use `.harness/worktrees/<task-id>/<attempt-id>/`.

- [ ] **Step 3: Verify**

Expected:

- In a git repo, worktree is created and cleaned up by explicit command.
- In this current non-git workspace, sidecar reports a clear unavailable state.

### Task 14: Attempt Scheduler and Champion Selector

**Agent:** Swarm and Worktree Agent`

**Files:**

- Create: `src/harness-sidecar/swarm/subagentRunner.js`
- Create: `src/harness-sidecar/swarm/championSelector.js`

- [ ] **Step 1: Define attempt records**

Fields:

- attemptId
- strategy
- worktreePath
- budget
- verifierResults
- patchArtifactId
- score

- [ ] **Step 2: Implement simple strategy list**

Strategies:

- reproduce_first
- minimal_patch
- test_first
- retrieval_first

- [ ] **Step 3: Select champion**

Pick passing verifier result first, then best score, then smallest patch.

- [ ] **Step 4: Verify**

Expected:

- Four scripted attempts produce one champion patch proposal.

## Chunk 7: V2 Research, Experiments, and VLM Artifacts

### Task 15: VLM Artifact Interfaces

**Agent:** VLM Artifact Agent

**Files:**

- Create: `src/harness-sidecar/vlm/screenshotTool.js`
- Create: `src/harness-sidecar/vlm/pdfRenderer.js`
- Create: `src/harness-sidecar/vlm/visualDiff.js`
- Modify: `src/harness-sidecar/artifacts/artifactStore.js`

- [ ] **Step 1: Define visual artifact manifest**

Types:

- screenshot
- pdf_page
- figure_crop
- plot
- visual_diff

- [ ] **Step 2: Implement stubs with artifact output**

Start with local file manifests before model/VLM integration.

- [ ] **Step 3: Verify**

Expected:

- UI can render image artifacts from sidecar manifest.

### Task 16: Deep Research Manager

**Agent:** Deep Research and Experiment Agent

**Files:**

- Create: `src/harness-sidecar/research/deepResearchManager.js`
- Create: `src/harness-sidecar/research/citationAuditor.js`
- Create: `src/harness-sidecar/research/reportCompiler.js`

- [ ] **Step 1: Define output contracts**

Outputs:

- research brief
- source map
- claim-evidence table
- contradictions
- implementation recommendations
- final report

- [ ] **Step 2: Implement local report skeleton**

Use retrieved local docs first. Add external source discovery only behind explicit approval later.

- [ ] **Step 3: Verify**

Expected:

- `/deep-research` style task produces source-tracked report artifacts.

### Task 17: Experiment Manager

**Agent:** Deep Research and Experiment Agent

**Files:**

- Create: `src/harness-sidecar/experiments/experimentManager.js`
- Create: `src/harness-sidecar/experiments/metricComparer.js`

- [ ] **Step 1: Define experiment record**

Create:

- hypothesis
- config diff
- commands
- budget
- run log
- metrics
- artifacts
- analysis
- decision

- [ ] **Step 2: Implement proposal and status only**

Do not launch expensive jobs without approval.

- [ ] **Step 3: Verify**

Expected:

- Experiment proposal writes trace artifact and requests approval for run command.

## Chunk 8: Collaboration and Meta-Harness

### Task 18: Collaboration Safety

**Agent:** Collaboration Agent

**Files:**

- Create: `src/harness-sidecar/collaboration/locks.js`
- Create: `src/harness-sidecar/collaboration/versionedState.js`
- Create: `src/harness-sidecar/collaboration/roles.js`
- Create: `src/harness-sidecar/collaboration/annotations.js`
- Create: `src/harness-sidecar/collaboration/auditLog.js`

- [ ] **Step 1: Implement lock records**

Support file, worktree, memory, experiment, budget, and approval locks.

- [ ] **Step 2: Implement versioned shared state**

Updates apply only against the expected version.

- [ ] **Step 3: Implement audit log**

Every shared-state change records actor, target, operation, reason, and timestamp.

- [ ] **Step 4: Verify**

Expected:

- Conflicting shared-state updates are rejected or merged explicitly.

### Task 19: Meta-Harness Optimizer Skeleton

**Agent:** Meta-Harness Agent

**Files:**

- Create: `src/harness-sidecar/meta/harnessOptimizer.js`
- Create: `src/harness-sidecar/meta/candidateRunner.js`
- Create: `src/harness-sidecar/meta/paretoTracker.js`

- [ ] **Step 1: Define candidate change record**

Candidate changes may target prompts, skills, retrieval policy, tool policy, or budget profile.

- [ ] **Step 2: Add approval-only flow**

Optimizer can propose changes but cannot apply them without approval.

- [ ] **Step 3: Verify**

Expected:

- Candidate proposal writes artifact and asks user for approval.

## Global Acceptance Criteria

- Existing Pi chat behavior remains intact.
- Sidecar can be started, stopped, and restarted independently from Pi RPC.
- MVP task produces trace, events, verifier output, patch artifact, and approval request.
- UI renders harness state without blocking chat.
- All sidecar actions are represented as structured events.
- Hidden edits are not allowed.
- Budget and recovery events are visible.
- Worktree swarms are disabled with a clear message when the workspace is not a git repo.

## Recommended First Sprint

Implement Chunk 1 and Chunk 2 only.

First sprint definition of done:

- `npm run dev` starts the current chat app.
- The wrapper starts a local sidecar.
- Browser can launch a scripted harness task.
- Sidecar streams events into the UI.
- UI displays status, patch proposal, and approval modal.
- Trace files are written under `.harness/traces/<task-id>/`.

