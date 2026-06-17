# Subagent Swarm UI And Tracing Plan

This document describes how to make Helios Forge's subagent swarm visible, inspectable, and replayable in the browser UI. The goal is to turn the current compact subagent activity cards into a full operator surface for seeing what each subagent is doing, why it was spawned, what evidence it produced, and how its work feeds the BES/RHO/meta evolution loop.

The design is scoped to Helios Forge's local sidecar, current browser UI, workspace trace files, and the configured model gateway. It does not require any external telemetry service.

## Current State

Helios already has the core pieces:

- `src/harness-sidecar/swarm/swarmOrchestrator.js` emits `swarm.subagent_started` and `swarm.subagent_completed`.
- `src/harness-sidecar/swarm/swarmExecutor.js` supports bounded attempt execution.
- `src/harness-sidecar/swarm/modelDrivenWorker.js` runs model-driven workers through an injected gateway/provider.
- `src/harness-sidecar/swarm/subagentRunner.js` normalizes compact handoffs and scores handoff quality.
- `src/harness-sidecar/swarm/swarmOutcomeRecorder.js` records champion wins, unsafe attempts, missing verifier evidence, visual failures, and low-quality handoffs as RHO/BES hard cases.
- `src/harness-sidecar/core/traceWriter.js` persists task events to `.harness/traces/<task-id>/events.jsonl`.
- `src/harness-sidecar/core/traceReader.js` exposes trace list, detail, and replay APIs.
- `src/server.js` relays sidecar events to the browser as `harness_task_event`.
- `public/index.html` and `public/app.js` already expose a harness panel, trace replay tab, and compact live subagent cards.

The missing UI layer is a richer subagent workspace:

- no dedicated swarm tab;
- no per-subagent timeline drawer;
- no attempt-level filter inside trace replay;
- no structured display for prompts, output contracts, tool intents, verifier evidence, artifacts, and handoff quality;
- no UI grouping for "thinking summaries" versus raw private reasoning;
- no visual connection from swarm outcomes back into RHO/BES/meta evolution.

There is also one deeper runtime gap that should be treated as a separate upgrade goal: Helios has sidecar-managed model-driven swarm attempts, but it does not yet spawn multiple independent Pi Agent sessions as long-lived native subagents. True Pi-native swarms should be added as a future execution mode, not confused with the current model-gateway attempt loop.

## Pi-Native Swarm Goal

Add an optional Pi-native swarm mode where Helios can launch and supervise multiple independent Pi Agent worker sessions for the same task.

Target behavior:

- each worker has its own Pi process/session, workspace scope, context pack, budget, role/profile, and capability manifest;
- each worker can use Pi's normal model configuration and kwargs handling;
- the harness assigns each worker a bounded objective and output contract;
- the sidecar receives each worker's visible thinking summaries, tool intents, verifier evidence, artifacts, and final compact handoff;
- workers stream lifecycle and trace events into the same `.harness/traces/<task-id>/events.jsonl` record;
- failures in one Pi worker do not collapse the swarm;
- champion selection, review, recombination, RHO/BES feedback, and approval-gated apply remain owned by the sidecar;
- safe defaults keep concurrency low until the operator opts in.

This should sit alongside the existing worker modes:

- `deterministic_subagent`: dry-run deterministic fallback;
- `model_driven`: structured model call through Helios `ModelGateway`;
- `command_subagent`: command adapter attempt;
- `worktree_command`: isolated worktree attempt;
- `pi_native_subagent`: independent Pi Agent process/session supervised by Helios.

The first version can run Pi-native workers sequentially with isolated trace streams. Later versions can enable bounded parallel Pi workers after process supervision, cancellation, and budget accounting are reliable.

## Product Shape

Add a first-class `Swarm` tab inside the harness panel.

The tab should have three coordinated regions:

1. **Swarm Overview**
   - Active task id.
   - Attempt counts by status: scheduled, running, completed, failed, reviewed, champion.
   - Current planning strategy: seeded, ToolTree, BES/evolution, or fallback.
   - Concurrency and budget summary.
   - Champion summary and approval status.

2. **Subagent List**
   - One stable row/card per attempt.
   - Role/profile, attempt id, strategy, status, score, verifier state, changed-line count, worker kind, model profile, and budget.
   - Visual affordances for running, failed, verified, champion, and low-quality handoff states.
   - Clicking a subagent opens the detail drawer and filters the trace timeline to that attempt.

3. **Subagent Detail Drawer**
   - Planning rationale: why this attempt exists, BES/RHO goal links, island/lineage metadata, budget rationale.
   - Prompt/contract: role prompt summary, assigned files, allowed tools, output contract, context pack summary.
   - Thinking and work timeline: model-emitted reasoning summary, tool intent, command/tool execution events, verifier events, visual artifacts, failures, recovery, handoff.
   - Output: compact handoff, summary, files inspected, files changed, tests run, verifier evidence, patch stats, next action.
   - Review/champion: reviewer decision, risk flags, recombination contribution, champion score, apply proposal link.

The UI should preserve the existing compact cards for quick scanning, but the drawer should hold the richer trace view.

## Thinking Trace Policy

The UI should show "what the subagent is thinking" as inspectable operational reasoning, not uncontrolled hidden chain-of-thought.

Allowed display surfaces:

- model-emitted `thinking_summary`;
- role prompt and output contract;
- task decomposition;
- current intent;
- tool-call intent and tool result summary;
- verifier rationale;
- handoff summary;
- reviewer comments;
- failure/recovery notes;
- source pointers and trace event ids.

Avoid displaying by default:

- raw private chain-of-thought when the model/provider marks it private or internal;
- secret-bearing prompt/context fields;
- raw tool output that exceeds existing output caps;
- binary image/PDF/OCR payloads;
- credentials, tokens, private URL query strings, or auth headers.

If a model endpoint returns explicit visible thinking blocks that Pi already surfaces to the main chat, Helios can show those as collapsible `Visible Thinking` blocks. Otherwise the sidecar should ask workers for a concise `thinkingSummary`/`decisionRationale` field and render that.

## Event Contract

Keep the existing `swarm.subagent_started` and `swarm.subagent_completed` events, but enrich them through additive fields so old UI/tests keep working.

### `swarm.subagent_started`

Required fields:

```json
{
  "type": "swarm.subagent_started",
  "taskId": "task_id",
  "attemptId": "attempt_a",
  "role": "implementer",
  "status": "running",
  "strategy": "fix target module with focused tests"
}
```

Recommended additive fields:

```json
{
  "profile": {
    "id": "implementer",
    "modelProfile": "critic_low_temp",
    "toolCaps": ["shell.run", "verifier.run"],
    "vision": false
  },
  "worker": {
    "kind": "model_driven",
    "requestId": "task_id:attempt_a:model_worker"
  },
  "planning": {
    "source": "bes_evolution",
    "goalId": "goal_3",
    "islandId": "island_visual",
    "lineage": ["parent_a", "parent_b"],
    "rationale": "Covers missing verifier evidence hard case"
  },
  "budget": {
    "maxOutputChars": 1200,
    "toolCalls": 4,
    "visionArtifacts": 0
  },
  "trace": {
    "eventId": "evt_123",
    "tracePath": ".harness/traces/task_id/events.jsonl"
  }
}
```

### `swarm.subagent_trace`

Add a new incremental event for richer live timelines.

```json
{
  "type": "swarm.subagent_trace",
  "taskId": "task_id",
  "attemptId": "attempt_a",
  "phase": "tool_intent",
  "summary": "Running focused swarm runtime tests",
  "severity": "info",
  "timestamp": "2026-06-08T00:00:00.000Z",
  "details": {
    "command": "node --test tests/harness-swarm-runtime.test.js"
  }
}
```

Suggested `phase` values:

- `planned`
- `context_loaded`
- `prompt_built`
- `thinking_summary`
- `tool_intent`
- `tool_result`
- `verifier_started`
- `verifier_completed`
- `visual_artifact`
- `handoff_created`
- `reviewed`
- `recombined`
- `champion_selected`
- `approval_proposed`
- `failed`

### `swarm.subagent_completed`

Continue to include existing fields, plus:

```json
{
  "thinkingSummary": "Identified the missing event field and added focused tests.",
  "compactHandoff": {
    "summary": "Added trace row metadata for subagents.",
    "filesInspected": ["public/app.js"],
    "filesChanged": ["public/app.js", "tests/harness-ui-discoverability.test.js"],
    "testsRun": ["node --test tests/harness-ui-discoverability.test.js"],
    "verifierEvidence": ["tests passed"],
    "nextAction": "Run full UI smoke suite",
    "sourcePointers": ["public/app.js:updateHarnessSubagent"]
  },
  "handoffQuality": {
    "score": 92,
    "findings": []
  },
  "review": {
    "approved": true,
    "risk": "low",
    "comments": ["Verifier evidence present"]
  }
}
```

## Trace Storage

All swarm UI state should be reconstructible from `.harness/traces/<task-id>/events.jsonl`.

Add helper functions instead of making the browser infer everything:

- `src/harness-sidecar/core/subagentTraceProjector.js`
  - Reads task events and returns subagent-centric views.
  - Groups by `attemptId`.
  - Produces overview, attempt summaries, timeline events, and champion references.
  - Redacts secrets and large payloads before returning UI data.

- `src/harness-sidecar/core/traceReader.js`
  - Add optional attempt filtering to trace replay:
    - `attemptId`
    - `eventTypes`
    - `phases`

Suggested browser command additions in `src/server.js`:

- `harness_swarm_trace_get`
- `harness_swarm_attempt_get`
- `harness_trace_replay_prepare` with optional `attemptId`

Suggested sidecar HTTP additions:

- `GET /v1/traces/:taskId/swarm`
- `GET /v1/traces/:taskId/swarm/:attemptId`
- Keep existing `/v1/traces/:taskId/replay` and add body filters.

## UI Implementation Plan

### Wave 1: Swarm Tab And Attempt Drawer

Files:

- Modify `public/index.html`
- Modify `public/app.js`
- Modify `public/app.css`
- Modify `tests/harness-ui-discoverability.test.js`

Work:

- Add `Swarm` tab next to `Run`, `Deep Research`, `Capabilities`, and `Traces`.
- Move or mirror the existing compact subagent cards into the tab.
- Add a selected-attempt state in `harnessState`.
- Add drawer markup with sections for plan, context, thinking summary, tools, verifier evidence, handoff, review, and artifacts.
- Keep the top-level compact "active subagents" count for dashboard glanceability.

Acceptance:

- UI test sees `data-harness-tab="swarm"`.
- UI test sees `id="harness-swarm-attempts"`.
- UI test sees `id="harness-swarm-attempt-detail"`.
- Existing subagent card tests still pass.

### Wave 2: Subagent Trace Events

Files:

- Modify `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify `src/harness-sidecar/swarm/modelDrivenWorker.js`
- Modify `src/harness-sidecar/swarm/subagentRunner.js`
- Modify `tests/harness-swarm-runtime.test.js`
- Modify `tests/harness-swarm-model-worker.test.js`

Work:

- Emit `swarm.subagent_trace` for prompt built, thinking summary, tool intent, verifier result, handoff, and failure phases.
- Make model-driven workers return `thinkingSummary` when present in provider output.
- Normalize deterministic fallback attempts to include a synthetic thinking summary.
- Ensure trace events are compact and redacted.

Acceptance:

- Runtime tests assert `swarm.subagent_trace` events are emitted in order for deterministic attempts.
- Model-worker tests assert `thinkingSummary` is captured without requiring raw hidden reasoning.
- Failure tests assert trace events still emit on worker failure.

### Wave 3: Pi-Native Worker Adapter

Files:

- Create `src/harness-sidecar/swarm/piNativeWorker.js`
- Modify `src/harness-sidecar/swarm/swarmOrchestrator.js`
- Modify `src/pi/piRpcManager.js` or add a sidecar-safe Pi process wrapper if the app-level manager is too UI-coupled.
- Modify `src/harness-sidecar/config/configLoader.js`
- Add `tests/harness-swarm-pi-native-worker.test.js`

Work:

- Add a `features.piNativeSwarm` gate and optional `swarmExecution.piNativeConcurrency`.
- Start worker Pi processes with scoped workspace, task prompt, context manifest, and role contract.
- Subscribe to visible worker events and normalize them into `swarm.subagent_trace`.
- Capture visible thinking summaries only when Pi exposes them as user-visible content.
- Convert each worker's final answer into the existing compact handoff contract.
- Support abort/cancel and process cleanup.
- Keep current model-driven and deterministic workers as fallback.

Acceptance:

- Unit tests can inject a fake Pi worker process and verify start, event relay, handoff normalization, failure isolation, and cleanup.
- The default config keeps `piNativeSwarm` disabled.
- Enabling Pi-native mode produces worker kind `pi_native_subagent`.
- No worker can bypass sidecar approval gates.

### Wave 4: Trace Projector And Replay Filters

Files:

- Create `src/harness-sidecar/core/subagentTraceProjector.js`
- Modify `src/harness-sidecar/core/traceReader.js`
- Modify `src/harness-sidecar/server.js`
- Modify `src/harness/harnessClient.js`
- Create or extend `tests/harness-subagent-trace-projector.test.js`
- Extend `tests/harness-trace-replay-api.test.js`

Work:

- Build subagent-centric projections from trace events.
- Add attempt-level filters to replay.
- Add sidecar/client methods for swarm trace detail.
- Keep unsafe task ids and attempt ids rejected.

Acceptance:

- Projector groups scheduled, started, trace, completed, review, champion, and outcome events under the right attempt.
- Replay can return only `attempt_a` events.
- Unsafe ids cannot escape the trace root.

### Wave 5: Live UI Timeline

Files:

- Modify `public/app.js`
- Modify `public/app.css`
- Extend `tests/harness-ui-discoverability.test.js`

Work:

- Update `handleHarnessEvent` to record `swarm.subagent_trace` events under `harnessState.subagentTimelines`.
- Render timeline rows in the selected-attempt drawer.
- Add local filters for phase, severity, and "show only verifier/tool/artifact events".
- Link trace rows to the global trace tab by task id.
- Preserve event coalescing so approval modals remain responsive during event bursts.

Acceptance:

- UI tests confirm `swarm.subagent_trace` is handled.
- Render state remains bounded by max attempts and max timeline rows per attempt.
- Approval responsiveness coalescing remains in place.

### Wave 6: Evolution Feedback Visibility

Files:

- Modify `public/app.js`
- Modify `public/index.html`
- Modify `public/app.css`
- Extend `tests/harness-ui-discoverability.test.js`

Work:

- Show how each attempt affected RHO/BES/meta:
  - hard case selected;
  - positive signal recorded;
  - recombination win;
  - champion regression;
  - low-quality handoff;
  - visual failure.
- Render `rho.swarm_cases_selected`, `swarm.outcome_recorded`, and `policy_evolution.summary` as linked badges on attempts.
- Show whether the champion produced an approval proposal.

Acceptance:

- A completed swarm run can be inspected from task -> attempt -> outcome -> RHO/BES/meta feedback.
- Hard-case badges link to trace events, not just summary text.

## Suggested UI Model

Browser state shape:

```js
harnessState.swarm = {
  selectedTaskId: null,
  selectedAttemptId: null,
  attempts: new Map(),
  timelines: new Map(),
  outcomes: new Map(),
  champions: new Map(),
  filters: {
    phase: 'all',
    severity: 'all',
    eventGroup: 'all',
  },
};
```

Attempt record shape:

```js
{
  taskId,
  attemptId,
  role,
  profile,
  strategy,
  status,
  worker,
  model,
  planning,
  budget,
  budgetRationale,
  score,
  verifierPassed,
  patchStats,
  thinkingSummary,
  compactHandoff,
  handoffQuality,
  review,
  artifacts,
  startedAt,
  completedAt
}
```

Timeline row shape:

```js
{
  taskId,
  attemptId,
  phase,
  severity,
  summary,
  details,
  timestamp,
  eventId
}
```

## Redaction And Safety Rules

- Run every UI-facing detail through existing redaction helpers or a new shared `redactTraceForUi` helper.
- Never render raw env values, auth headers, model API keys, private URL query params, or full OCR text by default.
- Keep binary artifacts behind artifact links.
- Cap per-attempt timeline rows in memory.
- Cap detail JSON rendered in the browser.
- Treat model-emitted `passed`/`safe` claims as advisory; verifier evidence and policy gates decide status.
- Do not add auto-apply behavior from the UI. Champion apply remains approval-gated.

## Test Plan

Focused tests:

```powershell
npm test -- tests/harness-ui-discoverability.test.js
npm test -- tests/harness-swarm-runtime.test.js tests/harness-swarm-model-worker.test.js
npm test -- tests/harness-trace-replay-api.test.js tests/harness-trace-replay.test.js
```

Full verification:

```powershell
npm test
```

Manual local check:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
npm run dev
```

Open `http://127.0.0.1:3777/`, start a harness task that triggers swarm execution, then verify:

- Swarm tab shows scheduled/running/completed attempts.
- Selecting an attempt opens a detail drawer.
- Timeline rows update while the task runs.
- Trace tab can filter or replay the selected attempt.
- Champion and approval status are visible.
- RHO/BES/meta outcome badges appear after completion.

## Implementation Order

Recommended order:

1. Add the static UI tab and tests.
2. Add browser state for selected attempt and bounded timelines.
3. Enrich existing swarm events with additive fields.
4. Add `swarm.subagent_trace` events.
5. Add the Pi-native worker adapter behind a disabled-by-default feature gate.
6. Add trace projector and replay filters.
7. Wire detail drawer to projected trace data.
8. Add evolution feedback badges.
9. Run full test suite and do a browser smoke check.

This order gives useful UI value early while keeping deeper trace projection and replay filtering as separately testable backend work.
