# Standalone Electron App Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Helios Forge as an installable desktop app that boots without a terminal, runs the existing Node server + browser UI inside Electron, performs first-run workspace setup, and validates Pi prerequisites.

**Architecture:** Keep the current split: Electron main process supervises `src/server.js`, renderer loads the existing `public/` UI over loopback HTTP/WebSocket. Add a small `src/electron/` runtime layer for packaged path resolution, dynamic port allocation, onboarding IPC, and Pi detection. Package with `electron-builder`, expand release smoke to cover packaged layout assumptions, and add CI artifact builds. Pi Agent remains an external prerequisite in this plan (not bundled).

**Tech Stack:** Node.js ESM, Electron 33, `electron-builder`, `node:test`, existing `src/server.js`, `src/electron/main.js`, `src/electron/preload.js`, `scripts/setup-helios-forge.js`, `src/pi/resolvePiCommand.js`.

---

## Current Baseline

Helios Forge already has:

- Electron main/preload entrypoints (`src/electron/main.js`, `src/electron/preload.js`)
- `npm run electron` dev launcher
- Main process that spawns `src/server.js` with `ELECTRON_RUN_AS_NODE`
- Minimal preload API: `getVersion`, `selectWorkspace`, `isElectron`
- Workspace picker in `public/app.js` with Electron IPC **or** `POST /api/workspace/select` browser fallback (`src/server.js`)
- Release smoke that checks Electron entrypoints exist (`scripts/release-smoke.js`)
- Harness setup API in `scripts/setup-helios-forge.js` (also exported as `initializeWorkplace` from `src/harness/harnessConfigService.js`)
- Pi command resolution in `src/pi/resolvePiCommand.js`
- **New since plan draft (commits through `cdd93c1`):**
  - Settings modal with Connection / Workplace / Endpoints / Pi model tabs (`public/app.js`, `public/index.html`)
  - WebSocket workplace APIs: `harness_workplace_status`, `harness_workplace_initialize`, `harness_workplace_repair` (`src/server.js`)
  - `src/harness/piWorkspaceBridge.js` — `ensurePiWorkplaceBridge()` wraps repair + manifest rebuild
  - `src/harness/piModelsService.js` — Pi models summary for settings UI
  - `src/harness/workplaceStatus.js` — structured workplace health for settings
  - localStorage persistence for server URL + workspace path
  - UX audit phases 1–3 complete (`docs/ux/2026-06-16-helios-forge-ui-ux-audit-report.md`)

**Onboarding strategy (updated):** Electron first-run should pick a workspace via native dialog, optionally call `setupHeliosForge({ bundledPackageRoot })` from main before showing the window, then auto-connect the renderer. After connect, the existing Settings → Workplace **Initialize/Repair** flow (`harness_workplace_initialize`) remains the in-app repair path — do not duplicate that UI in Electron-only code.

Missing for a standalone app:

- Packager (`electron-builder` / Forge) and installable artifacts
- `app.isPackaged` path resolution (today everything assumes repo checkout layout)
- Dynamic loopback port (today hardcoded `3777` in `main.js`)
- First-run onboarding that calls setup without `install.ps1`
- Pi prerequisite UX (detect missing `pi`, surface actionable errors)
- App icons referenced by `main.js` but not present in repo
- CI build/signing pipeline
- Production desktop polish (menus, single-instance lock, file logging)

## Product Decisions (Locked For This Plan)

- **Pi is external.** Detect and guide installation; do not bundle Pi binaries.
- **Workspace-scoped harness.** First-run setup writes `.harness/` into the user-selected workspace, same as `npm run setup`.
- **Keep localhost bridge.** Renderer continues to load `http://127.0.0.1:<port>/`; no `file://` rewrite in v1.
- **Windows-first packaging.** macOS/Linux CI artifacts are stretch goals after Windows NSIS works.
- **No auto-update in v1.** Leave hooks in builder config only.

## Non-Negotiable Boundaries

- Preserve `contextIsolation: true` and `nodeIntegration: false`.
- Do not weaken harness security boundaries or expose new unauthenticated localhost APIs.
- Packaged app must not require global `npm install` or `install.ps1` to function.
- Setup must not overwrite existing `.harness/config.yaml` unless user explicitly chooses force setup.
- IPC handlers must validate filesystem paths (no traversal outside chosen workspace roots).
- Dev browser flow (`npm run dev`) must keep working unchanged.

## Controller Responsibilities

- Create a dedicated branch/worktree before implementation (`superpowers:using-git-worktrees`).
- Run Chunk 0 recon agents in parallel (read-only).
- Run Chunk 1 foundation worker before parallel Chunk 2 workers.
- Dispatch only read/write-disjoint workers in parallel during Chunk 2.
- Run Chunk 3 serial integration only after Chunk 2 workers are green.
- After each worker: spec reviewer, then code-quality reviewer.
- Keep this plan checklist updated.
- Run `npm test` and `npm run release:smoke` before final merge.

## Worker Prompt Prefix

Every worker prompt must start with:

```text
You are not alone in this codebase. Other workers may edit other files in parallel.
Do not revert or rewrite unrelated changes. Work only in your assigned files/modules.
Follow existing Helios Forge patterns. Preserve dev-browser compatibility.
Use TDD: write failing tests first, then implementation, then focused verification.
Return: status, changed files, tests run, commit SHA, remaining concerns.
```

## Shared Integration Chokepoints

Only the serial integration worker(s) in Chunk 3 may edit these files:

- `src/electron/main.js`
- `src/electron/preload.js`
- `package.json`
- `public/app.js`
- `public/index.html`
- `.github/workflows/ci.yml`
- `README.md`
- this plan file

All other workers must add standalone modules + tests and export APIs for integration.

---

## File Structure

New modules to introduce:

| File | Responsibility |
|------|----------------|
| `src/electron/appPaths.js` | Resolve app root, resources root, bundled harness package path for dev vs packaged |
| `src/electron/portAllocator.js` | Pick free loopback TCP port |
| `src/electron/piPrerequisites.js` | Detect Pi binary + `~/.pi/agent` config presence |
| `src/electron/onboarding.js` | Orchestrate first-run workspace selection + `setupHeliosForge()` |
| `src/electron/menu.js` | Application menu (File/Edit/View/Help) |
| `src/electron/singleInstance.js` | Prevent duplicate app instances |
| `src/electron/logger.js` | File logging under `app.getPath('userData')` |
| `electron-builder.yml` | Packaging config (or `build` block in `package.json`) |
| `build/icon.ico` | Windows app icon |
| `build/icon.icns` | macOS app icon (stretch) |
| `build/icon.png` | Source icon copied to `public/icon.png` at build time |

Tests:

| File | Covers |
|------|--------|
| `tests/electron-app-paths.test.js` | Dev vs packaged roots |
| `tests/electron-port-allocator.test.js` | Port selection |
| `tests/electron-pi-prerequisites.test.js` | Pi detection states |
| `tests/electron-onboarding.test.js` | Setup orchestration |
| `tests/electron-packaged-layout.test.js` | Required files for builder `files` glob |
| `tests/electron-main-startup.test.js` | Extend existing startup tests |

---

## Chunk 0: Recon And Conflict Map

Run these read-only agents first. They may run in parallel.

### Agent 0A: Electron Runtime Recon

**Read-only scope:**

- `src/electron/main.js`
- `src/electron/preload.js`
- `tests/electron-main-startup.test.js`
- `src/server.js` (static file root resolution)
- `scripts/release-smoke.js`

**Return:**

- Every hardcoded path/port assumption
- Whether server should stay child-process spawned or move in-process
- Recommended `appPaths` API shape
- Test files to extend

### Agent 0B: Setup And Harness Recon

**Read-only scope:**

- `scripts/setup-helios-forge.js`
- `tests/setup-helios-forge.test.js`
- `src/harness-sidecar/capabilities/piPackageInstaller.js`
- `packages/helios-research-harness/`
- `public/app.js` (workspace + electron API usage)

**Return:**

- Minimal onboarding API surface
- Bundled package path requirements in packaged mode
- Whether `setupHeliosForge` needs a `bundledPackageRoot` override

### Agent 0C: Packaging And CI Recon

**Read-only scope:**

- `package.json`
- `package-lock.json`
- `.github/workflows/ci.yml`
- `scripts/publish-preflight.js`
- `install.ps1`

**Return:**

- Recommended `electron-builder` config
- `files` / `extraResources` list
- CI matrix proposal (win-first)
- Gaps in `release:smoke`

---

## Chunk 1: Packaged Path Foundation (Serial)

Must complete before Chunk 2 parallel workers.

### Worker 1: App Paths Module

**Agent:** Electron Paths Agent

**Files:**

- Create: `src/electron/appPaths.js`
- Create: `tests/electron-app-paths.test.js`
- Modify: `scripts/setup-helios-forge.js` (accept optional `bundledPackageRoot`)

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveAppPaths } from '../src/electron/appPaths.js';

test('resolveAppPaths uses repo layout in development', () => {
  const repoRoot = path.resolve('fixtures/repo');
  const paths = resolveAppPaths({
    isPackaged: false,
    appPath: path.join(repoRoot, 'src', 'electron'),
    resourcesPath: path.join(repoRoot, 'resources'),
    dirname: path.join(repoRoot, 'src', 'electron'),
  });
  assert.equal(paths.appRoot, repoRoot);
  assert.equal(paths.serverEntry, path.join(repoRoot, 'src', 'server.js'));
  assert.equal(paths.publicDir, path.join(repoRoot, 'public'));
  assert.equal(paths.bundledHarnessPackage, path.join(repoRoot, 'packages', 'helios-research-harness'));
});

test('resolveAppPaths uses resources layout when packaged', () => {
  const resourcesPath = path.resolve('fixtures/resources');
  const paths = resolveAppPaths({
    isPackaged: true,
    appPath: path.join(resourcesPath, 'app.asar'),
    resourcesPath,
    dirname: path.join(resourcesPath, 'app.asar', 'src', 'electron'),
  });
  assert.equal(paths.appRoot, path.join(resourcesPath, 'app.asar'));
  assert.equal(paths.bundledHarnessPackage, path.join(resourcesPath, 'helios-research-harness'));
});
```

- [ ] **Step 2: Run failing test**

Run: `node --test tests/electron-app-paths.test.js`

Expected: FAIL because `src/electron/appPaths.js` does not exist.

- [ ] **Step 3: Implement `resolveAppPaths`**

```js
export function resolveAppPaths({
  isPackaged = false,
  appPath,
  resourcesPath,
  dirname,
} = {}) {
  const devRoot = path.resolve(dirname, '..', '..');
  const appRoot = isPackaged ? appPath : devRoot;
  const bundledHarnessPackage = isPackaged
    ? path.join(resourcesPath, 'helios-research-harness')
    : path.join(devRoot, 'packages', 'helios-research-harness');

  return {
    appRoot,
    serverEntry: path.join(appRoot, 'src', 'server.js'),
    publicDir: path.join(appRoot, 'public'),
    preloadPath: path.join(dirname, 'preload.js'),
    bundledHarnessPackage,
    userDataHint: null,
  };
}
```

- [ ] **Step 4: Thread `bundledPackageRoot` through setup**

Modify `setupHeliosForge` signature:

```js
export async function setupHeliosForge({
  workspaceRoot = repoRoot,
  bundledPackageRoot = path.join(repoRoot, 'packages', 'helios-research-harness'),
  forceConfig = false,
  now = () => new Date().toISOString(),
} = {}) {}
```

Pass `bundledPackageRoot` into `installPiPackage({ packageRoot: bundledPackageRoot })`.

- [ ] **Step 5: Verify**

Run: `node --test tests/electron-app-paths.test.js tests/setup-helios-forge.test.js`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/electron/appPaths.js tests/electron-app-paths.test.js scripts/setup-helios-forge.js tests/setup-helios-forge.test.js
git commit -m "feat: add electron app path resolver for packaged layout"
```

---

## Chunk 2: Parallel Domain Workers

Dispatch Workers 2A–2E in parallel after Worker 1 lands. File ownership is disjoint.

### Worker 2A: Dynamic Port Allocator

**Agent:** Electron Port Agent

**Files:**

- Create: `src/electron/portAllocator.js`
- Create: `tests/electron-port-allocator.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- returns numeric port in `[1024, 65535]`
- respects `preferredPort` when free
- falls back when preferred port busy (mock `net.createServer`)

- [ ] **Step 2: Run failing test**

Run: `node --test tests/electron-port-allocator.test.js`

Expected: FAIL

- [ ] **Step 3: Implement minimal allocator**

```js
import net from 'node:net';

export async function allocateLoopbackPort(preferredPort = 3777) {
  const tryPort = async (port) => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen({ port, host: '127.0.0.1' }, () => {
      const address = server.address();
      const chosen = typeof address === 'object' && address ? address.port : port;
      server.close(() => resolve(chosen));
    });
  });

  try {
    return await tryPort(preferredPort);
  } catch {
    return await tryPort(0);
  }
}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/electron-port-allocator.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add loopback port allocator for electron runtime"
```

---

### Worker 2B: Pi Prerequisites Detector

**Agent:** Pi Prerequisites Agent

**Files:**

- Create: `src/electron/piPrerequisites.js`
- Create: `tests/electron-pi-prerequisites.test.js`

- [ ] **Step 1: Write failing tests**

States to cover:

```js
{
  ok: false,
  piInstalled: false,
  piConfigDir: 'C:\\Users\\me\\.pi\\agent',
  modelsJsonPresent: false,
  authJsonPresent: false,
  issues: ['pi_missing'],
  guidance: ['Install Pi Agent and ensure `pi` is on PATH.'],
}
```

Also cover happy path when `resolvePiCommand` finds a binary and config files exist (use injectable `existsSync`, `resolvePiCommand`).

- [ ] **Step 2: Run failing test**

Run: `node --test tests/electron-pi-prerequisites.test.js`

Expected: FAIL

- [ ] **Step 3: Implement `checkPiPrerequisites`**

```js
export function checkPiPrerequisites({
  env = process.env,
  platform = process.platform,
  homedir = os.homedir(),
  exists = existsSync,
  resolvePiCommandImpl = resolvePiCommand,
} = {}) {}
```

Return structured status only; no UI.

- [ ] **Step 4: Verify**

Run: `node --test tests/electron-pi-prerequisites.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add pi prerequisite checks for desktop onboarding"
```

---

### Worker 2C: First-Run Onboarding Orchestrator

**Agent:** Electron Onboarding Agent

**Files:**

- Create: `src/electron/onboarding.js`
- Create: `tests/electron-onboarding.test.js`

- [ ] **Step 1: Write failing tests**

Cover:

- `loadOnboardingState(userDataDir)` reads/writes `onboarding.json`
- `runFirstRunSetup({ workspaceRoot, bundledPackageRoot })` calls `setupHeliosForge`
- skips setup when workspace already has `.harness/config.yaml` and `capabilities.json`
- records completion timestamp

- [ ] **Step 2: Run failing test**

Run: `node --test tests/electron-onboarding.test.js`

Expected: FAIL

- [ ] **Step 3: Implement onboarding module**

Required exports:

```js
export async function loadOnboardingState(userDataDir, fs = defaultFs) {}
export async function saveOnboardingState(userDataDir, state, fs = defaultFs) {}
export async function ensureWorkspaceReady({
  workspaceRoot,
  bundledPackageRoot,
  setupHeliosForgeImpl = setupHeliosForge,
  exists = existsSync,
} = {}) {}
```

- [ ] **Step 4: Verify**

Run: `node --test tests/electron-onboarding.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add electron first-run onboarding orchestrator"
```

---

### Worker 2D: Electron Builder Scaffolding

**Agent:** Packaging Scaffold Agent

**Files:**

- Create: `electron-builder.yml`
- Create: `tests/electron-packaged-layout.test.js`
- Create: `scripts/copy-icon.js` (optional tiny helper)
- Modify: `scripts/release-smoke.js` (packaging config checks only)

**Do not modify `package.json` scripts yet** (Chunk 3 integrator owns that).

- [ ] **Step 1: Write failing layout test**

Assert required packaged paths exist in repo and would be included:

```js
const required = [
  'src/server.js',
  'src/electron/main.js',
  'src/electron/preload.js',
  'public/index.html',
  'packages/helios-research-harness/helios-package.json',
];
```

Also assert `electron-builder.yml` contains:

- `appId: com.alphahelion.helios-forge`
- `asarUnpack` for `src/server.js` and `src/**` if spawning child process
- `extraResources` copying `packages/helios-research-harness`

- [ ] **Step 2: Run failing test**

Run: `node --test tests/electron-packaged-layout.test.js`

Expected: FAIL

- [ ] **Step 3: Add `electron-builder.yml`**

```yaml
appId: com.alphahelion.helios-forge
productName: Helios Forge
directories:
  output: dist
  buildResources: build
files:
  - package.json
  - src/**/*
  - public/**/*
  - scripts/setup-helios-forge.js
  - scripts/release-smoke.js
asarUnpack:
  - src/server.js
  - src/**/*
extraResources:
  - from: packages/helios-research-harness
    to: helios-research-harness
win:
  target:
    - nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 4: Extend release smoke**

Add checks that `electron-builder.yml` exists and `build/icon.ico` is non-empty once icons land (Worker 2E).

- [ ] **Step 5: Verify**

Run: `node --test tests/electron-packaged-layout.test.js`

Expected: PASS (icon check may be pending until Worker 2E; use conditional skip with clear TODO)

- [ ] **Step 6: Commit**

```bash
git commit -m "build: add electron-builder scaffold and packaged layout tests"
```

---

### Worker 2E: App Icons And Desktop Assets

**Agent:** Desktop Assets Agent

**Files:**

- Create: `build/icon.png`
- Create: `build/icon.ico`
- Create: `public/icon.png` (copy or generate from source)
- Modify: `scripts/release-smoke.js` (icon file checks)

- [ ] **Step 1: Add source icon**

Create a simple branded `build/icon.png` (512x512). Convert to `.ico` for Windows.

- [ ] **Step 2: Wire release smoke icon checks**

Fail when `public/icon.png` or `build/icon.ico` missing/empty.

- [ ] **Step 3: Verify**

Run: `npm run release:smoke`

Expected: PASS including icon checks

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: add desktop app icons for electron packaging"
```

---

## Chunk 3: Serial Electron Integration

Run only after Chunk 2 workers are merged and green.

### Worker 3: Main Process Integration

**Agent:** Electron Integration Agent

**Files:**

- Modify: `src/electron/main.js`
- Modify: `src/electron/preload.js`
- Modify: `package.json`
- Modify: `public/app.js`
- Modify: `tests/electron-main-startup.test.js`

- [ ] **Step 1: Write failing integration tests**

Extend `tests/electron-main-startup.test.js`:

- `createRuntimePlan` picks dynamic port from `allocateLoopbackPort`
- `loadURL` uses `http://127.0.0.1:${port}/`
- packaged mode uses `resolveAppPaths({ isPackaged: true, ... })`
- `registerElectronApp` exposes new IPC channels:
  - `get-runtime-info` → `{ port, workspaceRoot, piStatus }`
  - `run-onboarding` → onboarding result
  - `check-pi-prerequisites`

- [ ] **Step 2: Run failing tests**

Run: `node --test tests/electron-main-startup.test.js`

Expected: FAIL

- [ ] **Step 3: Refactor `main.js` into testable helpers**

Extract:

```js
export async function createRuntimePlan(deps) {}
export async function startDesktopRuntime(electron, deps) {}
```

Wire:

1. `allocateLoopbackPort()`
2. `resolveAppPaths({ isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, dirname: __dirname })`
3. `startServer({ port, cwd: paths.appRoot, serverPath: paths.serverEntry })`
4. On first launch: `select-workspace` dialog → `ensureWorkspaceReady`
5. `checkPiPrerequisites()` before or after window creation; send status to renderer via IPC event `pi-prerequisites`

- [ ] **Step 4: Expand preload API**

```js
contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getRuntimeInfo: () => ipcRenderer.invoke('get-runtime-info'),
  selectWorkspace: (initialDirectory) => ipcRenderer.invoke('select-workspace', initialDirectory),
  runOnboarding: (workspaceRoot) => ipcRenderer.invoke('run-onboarding', workspaceRoot),
  checkPiPrerequisites: () => ipcRenderer.invoke('check-pi-prerequisites'),
  onPiPrerequisites: (handler) => { /* subscribe */ },
  isElectron: true,
});
```

- [ ] **Step 5: Renderer onboarding UX (minimal)**

In `public/app.js`:

- If `window.electronAPI?.getRuntimeInfo`, hide manual server URL entry and auto-connect using `location.host`
- If Pi prerequisites fail, show blocking banner with `guidance` strings
- On first workspace selection, call `runOnboarding`

- [ ] **Step 6: Add package scripts and dependency**

In `package.json`:

```json
{
  "dependencies": {
    "electron": "^33.0.0"
  },
  "devDependencies": {
    "electron-builder": "^25.0.0"
  },
  "scripts": {
    "electron:dist": "electron-builder --config electron-builder.yml",
    "electron:pack": "electron-builder --dir --config electron-builder.yml"
  }
}
```

Move `electron` from `devDependencies` to `dependencies`.

- [ ] **Step 7: Verify dev + tests**

Run:

```bash
npm test
npm run release:smoke
npm run electron
```

Expected:

- All tests pass
- Electron window opens on dynamic port
- Browser `npm run dev` still works on default 3777

- [ ] **Step 8: Commit**

```bash
git commit -m "feat: integrate packaged electron runtime, onboarding, and pi checks"
```

---

## Chunk 4: Desktop Polish (Parallel After Chunk 3)

### Worker 4A: Menu, Single Instance, Logging

**Agent:** Desktop Polish Agent

**Files:**

- Create: `src/electron/menu.js`
- Create: `src/electron/singleInstance.js`
- Create: `src/electron/logger.js`
- Create: `tests/electron-desktop-polish.test.js`
- Modify: `src/electron/main.js` (integrator may delegate via imports only)

Prefer adding modules + tests first; touch `main.js` only if Chunk 3 integrator already merged.

- [ ] **Step 1: Tests for menu template + single-instance lock + logger path**

- [ ] **Step 2: Implement modules**

Menu minimum:

- File → Open Workspace…
- File → Quit
- Help → About Helios Forge (shows version)

Single instance:

- `app.requestSingleInstanceLock()`; second instance focuses existing window

Logger:

- write info/error lines to `path.join(userData, 'logs', 'helios-forge.log')`

- [ ] **Step 3: Verify tests**

Run: `node --test tests/electron-desktop-polish.test.js`

- [ ] **Step 4: Commit**

---

### Worker 4B: CI Packaging Job

**Agent:** CI Packaging Agent

**Files:**

- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/release-desktop.yml` (optional separate workflow)
- Modify: `scripts/release-smoke.js`

- [ ] **Step 1: Add Windows packaging job**

```yaml
desktop-build:
  runs-on: windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: npm
    - run: npm ci
    - run: npm test
    - run: npm run release:smoke
    - run: npm run electron:pack
    - uses: actions/upload-artifact@v4
      with:
        name: helios-forge-win-unpacked
        path: dist/win-unpacked
```

- [ ] **Step 2: Document signing as manual follow-up**

Do not add secrets in v1.

- [ ] **Step 3: Verify workflow syntax locally**

Run: `npm run electron:pack` on Windows dev machine

- [ ] **Step 4: Commit**

```bash
git commit -m "ci: add windows electron packaging job"
```

---

## Chunk 5: Documentation And End-User Install Path

### Worker 5: User-Facing Docs

**Agent:** Docs Agent

**Files:**

- Modify: `README.md`
- Create: `docs/desktop-install.md`

- [ ] **Step 1: Add Desktop section to README**

Cover:

- Pi prerequisite
- Download/installer vs dev `npm run electron`
- First-run workspace selection
- Where logs live
- Troubleshooting Pi detection

- [ ] **Step 2: Add `docs/desktop-install.md`**

Include build maintainer commands:

```bash
npm run electron:pack
npm run electron:dist
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add standalone electron install and build guide"
```

---

## Chunk 6: Final Integration Audit

### Worker 6: Final Desktop Audit

**Agent:** Final Audit Agent

**Read-only plus tiny fixes only.**

- [ ] Run full verification:

```bash
npm test
npm run release:smoke
npm run electron:pack
```

- [ ] Manual smoke checklist:

  - [ ] Fresh machine path: no prior `.harness` in workspace → onboarding creates it
  - [ ] Missing Pi → blocker UI with guidance
  - [ ] Existing workspace → preserves `config.yaml`
  - [ ] Second app instance focuses first window
  - [ ] Quit kills server child process

- [ ] Update this plan checkboxes and note known follow-ups:

  - Code signing / notarization
  - Auto-update
  - macOS/Linux installers
  - Optional bundled Pi
  - In-process server instead of child spawn

- [ ] Dispatch final code reviewer subagent across full branch diff

---

## Subagent Dispatch Schedule

```text
Phase 0 (parallel, read-only)
  0A Electron Runtime Recon
  0B Setup/Harness Recon
  0C Packaging/CI Recon

Phase 1 (serial)
  Worker 1 App Paths

Phase 2 (parallel)
  Worker 2A Port Allocator
  Worker 2B Pi Prerequisites
  Worker 2C Onboarding
  Worker 2D electron-builder scaffold
  Worker 2E Icons

Phase 3 (serial)
  Worker 3 Main Process Integration

Phase 4 (parallel)
  Worker 4A Desktop polish modules
  Worker 4B CI packaging

Phase 5 (serial)
  Worker 5 Docs

Phase 6 (serial)
  Worker 6 Final audit
```

## Implementer Subagent Prompt Template

```text
Task: <Worker N title>
Plan: docs/superpowers/plans/2026-06-16-standalone-electron-app.md
Worker: <id>
Allowed files: <explicit list>
Forbidden files: <integration chokepoints unless this is Worker 3>

Context:
- Helios Forge wraps src/server.js and public/ UI in Electron.
- Pi remains external; detect via resolvePiCommand.
- Use node:test TDD.
- Return DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED.

Steps:
<paste worker steps verbatim>
```

## Spec Reviewer Checklist

- [ ] Only assigned files changed
- [ ] Tests added before implementation
- [ ] Dev browser path still works
- [ ] No secrets or provider endpoints added
- [ ] IPC paths validated
- [ ] Packaged path logic covered for dev + packaged fixtures

## Code Quality Reviewer Checklist

- [ ] No unnecessary abstraction
- [ ] Matches existing ESM style in `src/electron/`
- [ ] Child process / port lifecycle handled on quit
- [ ] Errors surfaced to user, not only `console.error`
- [ ] `release:smoke` and CI remain fast

- [ ] **Chunk 1 complete** — `appPaths`, `bundledPackageRoot` setup override
- [ ] **Chunk 2 complete** — port allocator, pi prerequisites, onboarding, builder scaffold, icons
- [ ] **Chunk 3 complete** — main/preload integration, electron auto-connect in renderer
- [ ] **Chunk 4 pending** — CI packaging job, desktop polish modules (menu/logger)
- [ ] **Chunk 5 pending** — `docs/desktop-install.md`, README desktop section

## Implementation Status (2026-06-16)

Completed in working tree:

- `src/electron/appPaths.js`, `portAllocator.js`, `piPrerequisites.js`, `onboarding.js`
- `electron-builder.yml`, `scripts/generate-app-icons.js`, `build/icon.*`, `public/icon.png`
- Integrated `src/electron/main.js` (dynamic port, packaged paths, onboarding, single-instance, IPC)
- Expanded `preload.js` and `public/app.js` Electron auto-connect bootstrap
- `scripts/setup-helios-forge.js` accepts `bundledPackageRoot`
- Tests: `electron-*` suite + updated `release-smoke.test.js`

Remaining follow-ups:

- `.github/workflows` Windows `electron:pack` CI job
- Code signing / notarization
- Auto-update
- `docs/desktop-install.md`

---

## Known Follow-Ups (Out Of Scope)

- Pi bundling and updater
- macOS notarization + Apple code signing
- Auto-update channel
- Replacing child-process server with in-process import
- `helios` CLI for headless setup
- Deep link `helios://` workspace open

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-16-standalone-electron-app.md`.

**Recommended execution:** use `superpowers:using-git-worktrees` to create an isolated branch, then `superpowers:subagent-driven-development` with the dispatch schedule above.

Ready to execute?
