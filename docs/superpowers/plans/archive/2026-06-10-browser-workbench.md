# Browser Workbench Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Helios agents a Codex-like sandboxed browser workbench for web debugging, visual verification, console/network inspection, and verifier-grade browser evidence.

**Architecture:** Add a sidecar-owned browser layer under `src/harness-sidecar/browser/` with explicit policy, session, artifact, and event boundaries. Integrate it into the existing visual worker and tool registry so agents request bounded browser actions and receive sanitized screenshots, console/network summaries, DOM snapshots, and verifier evidence instead of raw browser authority.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing visual verifier/VLM artifact workers, optional Playwright-compatible runtime injection, sidecar tool registry, PowerShell on Windows.

---

## Design Constraints

- Default browser access is localhost/dev-server only: `localhost`, `127.0.0.1`, `[::1]`, and the active sidecar host.
- External web browsing must be opt-in through an allowlist; private network and `file:` URLs stay blocked unless a future policy explicitly allows them.
- Browser artifacts must stay inside `.harness/browser/<taskId>/` or `.harness/visual/<taskId>/`.
- Agents never receive raw cookies, auth headers, full response bodies, downloaded files, or unredacted URLs.
- Pi-native workers and swarm agents do not get direct Playwright/CDP handles. They call sidecar tools and receive sanitized evidence.
- Browser actions are verification/debugging operations, not local mutation authority.

---

## File Structure

- Create `src/harness-sidecar/browser/browserPolicy.js`
  - Owns URL validation, localhost/default allow rules, external allowlist checks, and network redaction.
- Create `src/harness-sidecar/browser/browserArtifacts.js`
  - Owns browser task directories, safe artifact path resolution, and sanitized artifact summaries.
- Create `src/harness-sidecar/browser/browserSessionRuntime.js`
  - Owns the runtime-agnostic browser session API and default unavailable behavior.
- Create `src/harness-sidecar/browser/browserToolHandlers.js`
  - Implements `browser.*` tool handlers in terms of the session runtime and artifact helpers.
- Modify `src/harness-sidecar/vlm/browserPreviewCapture.js`
  - Reuse browser artifacts/policy and accept richer capture results.
- Modify `src/harness-sidecar/vlm/productionArtifactCapture.js`
  - Pass browser policy and emit browser evidence events.
- Modify `src/harness-sidecar/tools/defaultToolRegistry.js`
  - Register `browser.*` tools and wire browser runtimes/policy into `visual.verifier.run`.
- Modify `src/harness-sidecar/swarm/agentProfiles.js`
  - Allow the visual specialist to request browser tools; keep implementers browser-denied unless policy grants them.
- Create `tests/harness-browser-policy.test.js`
- Create `tests/harness-browser-runtime.test.js`
- Create `tests/harness-browser-tools.test.js`
- Modify `tests/harness-vlm-production-workers.test.js`
- Modify `tests/harness-tools.test.js` if tool registry coverage needs expansion.

---

## Chunk 1: Browser Policy and Artifact Boundaries

### Task 1: URL policy and network redaction

**Files:**
- Create: `src/harness-sidecar/browser/browserPolicy.js`
- Test: `tests/harness-browser-policy.test.js`

- [ ] **Step 1: Write failing URL policy tests**

Cover:

- `http://127.0.0.1:3000`, `http://localhost:5173`, and `http://[::1]:8080` are allowed by default.
- `https://example.com` is denied unless `allowedOrigins` includes `https://example.com`.
- `file:///C:/secret/index.html`, `http://192.168.1.5`, `http://10.0.0.2`, and malformed URLs are denied.
- Query strings, hashes, username, and password are removed from trace-visible URLs.
- Cookie, authorization, API key, token, and set-cookie headers are redacted.
- Request/response body fields are omitted from network summaries.

Run:

```powershell
node --test tests/harness-browser-policy.test.js
```

Expected: fail because `browserPolicy.js` does not exist.

- [ ] **Step 2: Implement `browserPolicy.js`**

Export:

```js
export function createBrowserPolicy(options = {}) {}
export function assertBrowserUrlAllowed({ url, policy, reason }) {}
export function sanitizeUrlForBrowserTrace(url) {}
export function sanitizeNetworkRecord(record = {}) {}
```

Behavior:

- Treat localhost and loopback as default allowed origins.
- Treat external origins as allowed only when listed in `allowedOrigins`.
- Block `file:`, `data:`, `javascript:`, private LAN IPv4 ranges, and malformed URLs.
- Redact credential-shaped headers and omit bodies.

- [ ] **Step 3: Run the policy tests**

Run:

```powershell
node --test tests/harness-browser-policy.test.js
```

Expected: pass.

### Task 2: Browser artifact directory helpers

**Files:**
- Create: `src/harness-sidecar/browser/browserArtifacts.js`
- Test: `tests/harness-browser-policy.test.js`

- [ ] **Step 1: Add failing artifact path tests**

Cover:

- `browserTaskDir({ workspaceRoot, taskId })` returns `.harness/browser/<taskId>`.
- `resolveBrowserArtifactPath` rejects `../escape.png` and absolute paths outside the task directory.
- Artifact summaries contain relative workspace paths, not raw binary data.

- [ ] **Step 2: Implement artifact helpers**

Export:

```js
export function browserTaskDir({ workspaceRoot, taskId }) {}
export function resolveBrowserArtifactPath({ workspaceRoot, taskId, targetPath, defaultName, label }) {}
export function summarizeBrowserArtifact({ workspaceRoot, taskId, type, path, metadata }) {}
```

- [ ] **Step 3: Run the policy/artifact tests**

Run:

```powershell
node --test tests/harness-browser-policy.test.js
```

Expected: pass.

---

## Chunk 2: Browser Session Runtime

### Task 3: Runtime-agnostic session API

**Files:**
- Create: `src/harness-sidecar/browser/browserSessionRuntime.js`
- Test: `tests/harness-browser-runtime.test.js`

- [ ] **Step 1: Write failing runtime tests**

Cover:

- No injected adapter returns `{ status: 'unavailable', reason: 'browser_runtime_required' }`.
- A fake adapter can create a session, navigate, capture screenshots, return console entries, return network records, and close the session.
- The runtime enforces URL policy before calling the adapter.
- Returned console/network records are sanitized.
- Closing a missing session returns a structured not-found result.

- [ ] **Step 2: Implement `createBrowserSessionRuntime`**

Export:

```js
export function createBrowserSessionRuntime({
  workspaceRoot,
  adapter,
  policy,
  emitEvent,
} = {}) {}
```

Methods:

```js
await runtime.createSession({ taskId, viewport, allowedOrigins })
await runtime.navigate({ sessionId, url })
await runtime.screenshot({ sessionId, outputPath })
await runtime.consoleRead({ sessionId })
await runtime.networkSummary({ sessionId })
await runtime.domSnapshot({ sessionId })
await runtime.closeSession({ sessionId })
```

Implementation notes:

- Generate stable session ids like `browser_<taskId>_<counter>`.
- Store session state in memory only.
- Do not expose adapter internals in return payloads.
- Emit sidecar events: `browser.session_started`, `browser.navigation`, `browser.screenshot_captured`, `browser.console_read`, `browser.network_summary`, and `browser.session_closed`.

- [ ] **Step 3: Run runtime tests**

Run:

```powershell
node --test tests/harness-browser-runtime.test.js
```

Expected: pass.

### Task 4: Playwright-compatible adapter seam

**Files:**
- Create: `src/harness-sidecar/browser/playwrightAdapter.js`
- Test: `tests/harness-browser-runtime.test.js`

- [ ] **Step 1: Add tests for optional adapter availability**

Cover:

- If no Playwright module is supplied, adapter creation returns an unavailable descriptor instead of throwing.
- If a fake Playwright module is supplied, adapter launch options include sandbox-safe defaults, blocked service workers, viewport, and ephemeral context behavior.

- [ ] **Step 2: Implement adapter factory**

Export:

```js
export async function createPlaywrightBrowserAdapter(options = {}) {}
```

Implementation notes:

- Prefer dependency injection for tests: accept `playwright`, `browserType`, or `launchBrowser`.
- If Playwright is not installed or cannot launch, return `{ status: 'unavailable', reason: 'playwright_runtime_required' }`.
- Keep browser/context/page handles private inside the adapter.
- Default to headless, no persistent user data, service workers blocked, downloads denied, and context-level request routing hooks.

- [ ] **Step 3: Run runtime tests**

Run:

```powershell
node --test tests/harness-browser-runtime.test.js
```

Expected: pass.

---

## Chunk 3: Browser Tool Registry

### Task 5: Register `browser.*` tools

**Files:**
- Create: `src/harness-sidecar/browser/browserToolHandlers.js`
- Modify: `src/harness-sidecar/tools/defaultToolRegistry.js`
- Test: `tests/harness-browser-tools.test.js`
- Optional modify: `tests/harness-tools.test.js`

- [ ] **Step 1: Write failing tool registry tests**

Cover:

- `createDefaultToolRegistry` registers:
  - `browser.session.create`
  - `browser.navigate`
  - `browser.screenshot`
  - `browser.console.read`
  - `browser.network.summary`
  - `browser.dom.snapshot`
  - `browser.session.close`
- The tools call an injected browser runtime.
- Denied URLs return structured policy failures.
- Screenshots are saved under `.harness/browser/<taskId>/`.
- Network summaries are redacted.

- [ ] **Step 2: Implement browser tool handlers**

Export:

```js
export function registerBrowserTools({ registry, workspaceRoot, browserRuntime, browserPolicy, emitEvent }) {}
```

Tool behavior:

- `browser.session.create`: creates a policy-scoped session for a task.
- `browser.navigate`: navigates an existing session.
- `browser.screenshot`: captures an artifact path and summary.
- `browser.console.read`: returns bounded console entries.
- `browser.network.summary`: returns bounded sanitized records and failures.
- `browser.dom.snapshot`: returns bounded text/role summaries, not full HTML by default.
- `browser.session.close`: closes resources.

- [ ] **Step 3: Wire into default tool registry**

Modify `createDefaultToolRegistry` to accept:

```js
browserRuntime,
browserPolicy,
browserToolOptions,
```

Then call `registerBrowserTools(...)`.

- [ ] **Step 4: Run tool tests**

Run:

```powershell
node --test tests/harness-browser-tools.test.js tests/harness-tools.test.js
```

Expected: pass.

### Task 6: Agent profile visibility

**Files:**
- Modify: `src/harness-sidecar/swarm/agentProfiles.js`
- Test: existing or new coverage in `tests/harness-swarm-runtime.test.js`

- [ ] **Step 1: Write failing profile test**

Cover:

- `visual-specialist` includes `browser.session.create`, `browser.navigate`, `browser.screenshot`, `browser.console.read`, and `browser.network.summary`.
- Default implementer profiles do not gain browser tools automatically.

- [ ] **Step 2: Update profile tool lists**

Keep browser tools scoped to visual/debugging specialists for the first implementation.

- [ ] **Step 3: Run profile tests**

Run:

```powershell
node --test tests/harness-swarm-runtime.test.js
```

Expected: pass.

---

## Chunk 4: Visual Verification and Browser Evidence Integration

### Task 7: Browser preview capture uses browser runtime evidence

**Files:**
- Modify: `src/harness-sidecar/vlm/browserPreviewCapture.js`
- Modify: `src/harness-sidecar/vlm/productionArtifactCapture.js`
- Test: `tests/harness-vlm-production-workers.test.js`

- [ ] **Step 1: Write failing visual worker tests**

Cover:

- `captureBrowserPreview` accepts a browser runtime result that includes `console`, `network`, `domSnapshot`, and `artifacts`.
- Returned capture result includes sanitized browser evidence metadata but no raw response bodies or auth headers.
- Production visual capture emits browser evidence event metadata when provided.

- [ ] **Step 2: Update browser preview capture**

Implementation notes:

- Reuse `resolveBrowserArtifactPath` where possible.
- Preserve existing `browserRuntime.capture` compatibility.
- Add optional evidence fields:

```js
browserEvidence: {
  consoleErrors: [],
  failedRequests: [],
  networkSummary: [],
  domSnapshotPath: null
}
```

- [ ] **Step 3: Update production artifact metadata**

Attach bounded browser evidence to screenshot artifact metadata.

- [ ] **Step 4: Run visual worker tests**

Run:

```powershell
node --test tests/harness-vlm-production-workers.test.js tests/harness-visual-verifier.test.js
```

Expected: pass.

### Task 8: Browser evidence feeds verifier-grade outputs

**Files:**
- Modify: `src/harness-sidecar/vlm/visualVerifier.js`
- Test: `tests/harness-visual-verifier.test.js`

- [ ] **Step 1: Add failing visual verifier test**

Cover:

- Visual verifier model input includes browser evidence summaries when screenshot artifacts include them.
- Model input excludes cookies, auth headers, raw bodies, and full DOM HTML.

- [ ] **Step 2: Update visual verifier metadata plumbing**

Add concise browser evidence summaries to `artifactMetadata`.

- [ ] **Step 3: Run verifier tests**

Run:

```powershell
node --test tests/harness-visual-verifier.test.js
```

Expected: pass.

---

## Final Verification

- [ ] Run targeted browser/visual suite:

```powershell
node --test tests/harness-browser-policy.test.js tests/harness-browser-runtime.test.js tests/harness-browser-tools.test.js tests/harness-vlm-production-workers.test.js tests/harness-visual-verifier.test.js tests/harness-swarm-runtime.test.js
```

- [ ] Run full suite:

```powershell
npm test
```

- [ ] Run smoke:

```powershell
npm run release:smoke
```

- [ ] Run diff check:

```powershell
git diff --check
```

Expected final state:

- Browser workbench is available through policy-gated sidecar tools.
- Visual verifier can consume browser screenshot, console, network, and DOM evidence.
- External web remains opt-in allowlist only.
- No raw secrets, response bodies, cookies, or full DOM bodies are model-visible by default.
