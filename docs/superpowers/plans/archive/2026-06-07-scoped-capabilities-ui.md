# Scoped Capabilities UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-local capability manager so Helios Forge can expose workspace-scoped skills, MCP servers, Pi extensions, and profiles to Pi/harness runtime without mutating the global Pi install.

**Architecture:** Store capability records in the selected workspace under `.harness/capabilities.json`, materialize session-only mount metadata under `.harness/runtime/`, and relay capability CRUD through the harness sidecar plus the app WebSocket. The UI adds Deep Research and Capabilities tabs inside the existing harness panel while keeping global Pi config read-only.

**Tech Stack:** Node.js ESM, built-in `node:test`, WebSocket app server, sidecar HTTP API, vanilla HTML/CSS/JS frontend.

---

## Chunk 1: Project-Local Capability Registry

### Task 1: Capability Store

**Files:**
- Create: `src/harness-sidecar/capabilities/capabilityStore.js`
- Test: `tests/harness-capabilities.test.js`

- [ ] **Step 1: Write failing tests**

Test that the store:
- returns a default registry when `.harness/capabilities.json` is absent
- normalizes supported types: `skill`, `mcp`, `pi_extension`, `profile`
- rejects path traversal outside the workspace for local file/folder capabilities
- writes only under `.harness/capabilities.json`
- redacts secret-like env values while preserving env var names

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness-capabilities.test.js`
Expected: FAIL because `capabilityStore.js` does not exist.

- [ ] **Step 3: Implement minimal store**

Create small ESM helpers:
- `loadCapabilityRegistry({ workspaceRoot })`
- `saveCapabilityRecord({ workspaceRoot, record })`
- `deleteCapabilityRecord({ workspaceRoot, capabilityId })`
- `buildRuntimeMountManifest({ workspaceRoot, profileId })`

Use JSON, `fs/promises`, and path normalization. Never write to `C:\Users\jackj\.pi`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/harness-capabilities.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/harness-sidecar/capabilities/capabilityStore.js tests/harness-capabilities.test.js
git commit -m "feat(capabilities): add project-local capability store"
```

## Chunk 2: Sidecar and App Relay

### Task 2: Capability API

**Files:**
- Modify: `src/harness-sidecar/server.js`
- Modify: `src/harness/harnessClient.js`
- Modify: `src/server.js`
- Test: `tests/harness-capabilities.test.js` or a focused sidecar test

- [ ] **Step 1: Write failing API tests**

Test that sidecar/client can:
- list capabilities for the selected workspace
- save and delete records
- create a runtime mount manifest
- emit a `capabilities.runtime_mounted` event when a task starts

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness-capabilities.test.js`
Expected: FAIL because endpoints/client methods do not exist.

- [ ] **Step 3: Implement API relay**

Add sidecar routes:
- `GET /v1/capabilities?workspaceRoot=...`
- `POST /v1/capabilities`
- `DELETE /v1/capabilities/:id`
- `POST /v1/capabilities/mount`

Add harness client methods and app WebSocket messages:
- `harness_capabilities_get`
- `harness_capability_save`
- `harness_capability_delete`
- `harness_capabilities_mount`

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/harness-capabilities.test.js tests/harness-client.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/harness-sidecar/server.js src/harness/harnessClient.js src/server.js tests/harness-capabilities.test.js
git commit -m "feat(capabilities): expose scoped capability api"
```

## Chunk 3: Harness UI

### Task 3: Deep Research and Capabilities Panel

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/app.css`

- [ ] **Step 1: Add UI behavior checks**

At minimum run syntax checks after edits:
- `node --check public/app.js`

- [ ] **Step 2: Add harness tabs**

Inside the existing harness panel add tabs:
- Run
- Deep Research
- Capabilities

Deep Research sends `harness_task_start` with `mode: "deep_research"` and `source: "deep_research_ui"`.

Capabilities shows sections for:
- Skills
- MCPs
- Pi Extensions
- Profiles

- [ ] **Step 3: Add capability forms**

Each record supports:
- type
- name
- enabled
- path/command/url
- args
- env var names
- approval mode
- notes

Save via `harness_capability_save`; refresh via `harness_capabilities_get`; delete via `harness_capability_delete`.

- [ ] **Step 4: Browser verify**

Open `http://127.0.0.1:3777/`, connect, open harness panel, verify the tabs render and text fits.

- [ ] **Step 5: Commit**

Run:
```bash
git add public/index.html public/app.js public/app.css
git commit -m "feat(ui): add scoped capability manager"
```

## Chunk 4: Runtime Mount Integration

### Task 4: Session-Scoped Pi Mount

**Files:**
- Modify: `src/server.js`
- Modify: `src/pi/piRpcManager.js` if needed
- Modify: `src/harness-sidecar/server.js`
- Test: `tests/harness-capabilities.test.js`

- [ ] **Step 1: Write failing runtime test**

Verify that starting a harness task materializes `.harness/runtime/capabilities.mount.json` and emits enabled capability counts without writing into the global Pi directory.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness-capabilities.test.js`
Expected: FAIL because task startup does not mount capabilities yet.

- [ ] **Step 3: Implement runtime mount**

On task start, build a manifest from enabled records and add it to task metadata/events. If Pi process launch supports env injection, pass a `HELIOS_CAPABILITIES_MANIFEST` environment variable scoped to that process only.

- [ ] **Step 4: Run full verification**

Run:
- `npm test`
- `node --check src/server.js`
- `node --check public/app.js`

- [ ] **Step 5: Commit**

Run:
```bash
git add src/server.js src/pi/piRpcManager.js src/harness-sidecar/server.js tests/harness-capabilities.test.js
git commit -m "feat(runtime): mount scoped capabilities for helios sessions"
```
