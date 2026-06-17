# Helios Forge UI/UX Audit Report

**Date:** 2026-06-16  
**Scope:** Browser UI (`public/index.html`, `public/app.js`, `public/app.css`) and its relationship to Pi RPC + harness sidecar flows relayed by `src/server.js`  
**Auditor basis:** Static review of frontend markup, styles, event wiring, and product/architecture docs  
**Out of scope:** Backend correctness, harness algorithm quality, Electron shell (except where UI behavior diverges)

---

## Executive Summary

Helios Forge presents a polished dark-theme chat interface wrapped around Pi Agent, with a large research-harness operator surface embedded in the same layout. The visual layer (typography, spacing, markdown rendering, thinking blocks, tool-call cards) is strong. The primary UX debt is **structural**, not cosmetic.

The product currently behaves like two applications sharing one shell:

1. **Chat with Pi** — sessions, model/thinking selection, workspace path, attachments, streaming.
2. **Research harness console** — sidecar lifecycle, capabilities, swarm inspection, traces/replay, approvals, verifier evolution.

Users are not given a clear frame for when they are in which mode. Configuration is fragmented across a connection dialog, composer chrome, harness panel forms, Pi’s global install (`~/.pi/agent/models.json`), and workspace filesystem artifacts (`.harness/config.yaml`, `capabilities.json`) with no unified settings experience. **Helios endpoint settings, harness model/endpoint profiles, and Pi session settings are not edited or displayed in one place**, so they can drift out of sync. Several visible controls are non-functional or misleading.

### Key findings (severity summary)

| Severity | Count | Examples |
|----------|-------|----------|
| **P0 — Broken / misleading** | 5 | Export button unwired; Retry broken; mobile sidebar inaccessible; decorative feedback button; session delete without confirm |
| **P1 — High confusion / churn** | 9 | Duplicate harness navigation; god-panel layout; no sidecar status in chrome; silent background harness; weak onboarding; **Helios/Pi/endpoint config not synced** |
| **P2 — Operator friction** | 7 | Capabilities expert form; refresh-heavy panels; approval badge buried; jargon-heavy harness labels |
| **P3 — Polish / a11y** | 6 | Keyboard dropdowns; hover-only message actions; CDN offline risk; `prompt()` rename |

### Recommended north star

Evolve from **“Pi chat + hidden harness debug panel”** toward **“research-native workbench”** as described in `docs/research-harness/cleaned-product-spec.md`: chat remains the default lane; research, capabilities, traces, and settings become first-class destinations with progressive disclosure. **Swarm routing and model endpoints must be configurable entirely inside Helios**, with `.harness/config.yaml` updated by the sidecar — not hand-edited — for routine operator workflows. **Default harness scaffolding must be loadable from the app** so a new workplace never depends on `npm run setup` or the installer.

---

## Audit Method

This report is based on:

- Full read of `public/index.html` (layout, modals, harness panel structure, connection dialog).
- Targeted analysis of `public/app.js` (state, WebSocket handlers, session management, harness rendering, event listeners).
- CSS review for responsive behavior, component patterns, and mobile breakpoints.
- Cross-reference with `docs/research-harness/cleaned-product-spec.md` and `docs/architecture/archive/subagent-swarm-ui-and-tracing-plan.md`.

No user testing or analytics were available. Findings are code-grounded affordance and flow analysis.

### Known pre-existing awareness

The product owner already identified:

- Harness YAML and app settings should live in a **proper settings menu**.
- **Workplace / workspace configuration** should be easier than typing paths into input fields.
- The UI should expose **Helios endpoint settings** (connection URL, sidecar/model gateway endpoints, `endpointProfiles` in harness config) and **Pi settings** (providers/models, thinking level, extensions) in that menu, with a **single source of truth** so chat, sidecar, and on-disk config stay aligned.
- **All swarm and runtime endpoint configuration must be editable inside Helios** — users should not need to hand-edit `.harness/config.yaml` to point swarms, councils, routers, or adaptive search at the right model gateways.
- **Default harness workplace scaffolding must be loadable from inside the app** — initializing `.harness/config.yaml`, bundled capabilities, packages, and runtime mount manifests should not require `npm run setup`, `install.ps1`, or a terminal.

This report expands on those themes and documents additional issues.

---

## Product Context

### Intended product shape

From the product spec, Helios Forge should feel like a **local control surface for a research-agent harness**:

- Chat with Pi in the current workspace.
- Launch and monitor harness tasks from the same UI.
- Stream sidecar events, approvals, artifacts, and traces.
- Keep Pi as the interactive shell; keep long-running orchestration in the sidecar.

### Implemented UI shape

| Surface | Primary files | Role today |
|---------|---------------|------------|
| Connection gate | `#connection-dialog` | Server URL + workspace before app loads |
| Chat shell | `#sidebar`, `#messages`, `#input-area` | Pi sessions and messaging |
| Harness operator panel | `#harness-panel` | Sidecar control, capabilities, swarm, traces |
| Bottom tool dock | `.bottom-left-tool-dock` | Shortcuts into harness tabs |
| Modals | stats, harness approval, artifacts, extension UI | Focused overlays |
| Debug panel | `#debug-panel` | Raw pipeline log (dev-oriented) |

---

## Configuration Fragmentation & Sync

Helios Forge currently spreads configuration across **five layers** that users cannot see as one system. Without a unified settings surface and sync rules, changing one layer does not reliably update the others.

### Where settings live today

| Layer | Typical location / surface | What it controls | Editable in UI today |
|-------|---------------------------|------------------|----------------------|
| **Helios connection** | `#connection-dialog` (`server-url`) | WebSocket URL to `src/server.js` | Connect-time only; not persisted |
| **Workplace** | Connection dialog + `#workspace-input` | Pi CWD; sidecar `workspaceRoot` for harness RPCs | Yes (duplicated inputs) |
| **Pi session (runtime)** | Composer model/thinking dropdowns | Active model via `set_model`; thinking via `set_thinking` | Yes (session-only over RPC) |
| **Pi global** | `~/.pi/agent/models.json`, `~/.pi/agent/extensions/` | Providers, model IDs, kwargs, extensions | No (filesystem / CLI) |
| **Helios harness (workspace)** | `.harness/config.yaml` | `defaults.modelProfile`, `modelCouncil.endpointProfiles`, budgets, `features.*`, permissions | No (YAML on disk) |
| **Scoped capabilities** | `.harness/capabilities.json` + harness Capabilities tab | Skills, MCPs, Pi extensions, profiles | Partial (CRUD in panel; not full config) |
| **Secrets** | Env vars, Smithery field in Capabilities tab | API keys, registry tokens | Scattered |

### Sync gaps (why users get surprised)

1. **Chat model ≠ harness model profile** — The composer shows Pi’s current model (`get_models` / `model_changed`). The sidecar reads `defaults.modelProfile` and `modelCouncil.endpointProfiles` from `.harness/config.yaml` (`src/harness-sidecar/config/configLoader.js`, `model/modelEndpointProfiles.js`). Changing the dropdown does not update harness YAML; editing YAML does not update the Pi session UI.

2. **Endpoint profiles are invisible in the shell** — Swarm, council, and adaptive router logic resolve `endpointProfiles` (base URL, model ID, health, concurrency) from harness config. Users have no UI to define or validate these endpoints; misconfiguration surfaces only as failed tasks or empty swarm rows.

3. **Connection URL is ephemeral** — `server-url` is set once at connect (`startConnection()` hides the dialog). Remote or multi-environment workflows cannot switch Helios server without a full reload, and the value is not stored alongside workplace preferences.

4. **Workplace path triple-entry** — Same path can be set at connect, in the composer, and implied by session `cwd` on `session_loaded`. `syncWorkspaceInputs()` keeps inputs aligned, but harness calls use `getSelectedWorkspacePath()` while Pi may still reflect a prior `set_workspace` if the user edits without committing.

5. **Pi global vs workspace-local policy** — Installer and docs stress not mutating global Pi by default; capabilities mount from `.harness/runtime/`. Users lack a clear view of **what is global Pi config vs workplace-scoped Helios config**, so they may edit the wrong file or expect the UI to mirror `models.json`.

6. **Feature flags only on disk** — Gates such as `features.deepResearch`, `features.piNativeSwarm`, and `modelRouter.enabled` live in `.harness/config.yaml` (see `docs/architecture/current-architecture.md`). UI tabs (e.g. Deep Research) appear even when features are disabled in config, with no “disabled by config” explanation.

7. **Swarm routing is YAML-only** — Multi-model swarm, role→endpoint assignment, concurrency, and worker mode (`swarmExecution`) are consumed by `swarmOrchestrator.js` and `modelCouncil.js` from harness config. The Swarm tab is **read-only telemetry** today; there is no in-app way to add an endpoint profile, assign `researcher` → `local_deep`, or enable `features.multiModelSwarm` without leaving Helios.

8. **Workplace bootstrap is CLI-only** — Creating a usable `.harness/` tree (config, capabilities, bundled package, runtime mount) is implemented in `scripts/setup-helios-forge.js` and invoked via `npm run setup` / `install.ps1`. The UI can open a folder with no `.harness/` and offers no **“Initialize workplace”** or **“Load default config”** action. Operators who skip the installer hit dead ends in capabilities, swarm, and traces until they run a terminal command.

### In-app harness bootstrap & default config loading (requirement)

**Principle:** Picking a workplace folder and making it harness-ready should be a first-class in-app flow. The same logic that `setupHeliosForge()` runs today must be callable from Helios UI (and surfaced when config is missing or incomplete).

#### What “default harness config” includes today (installer path)

`scripts/setup-helios-forge.js` (`setupHeliosForge`) currently materializes:

| Artifact | Path | Purpose |
|----------|------|---------|
| Harness config | `.harness/config.yaml` | Defaults, budgets, permissions, `features.*`, `adaptiveSearch`, etc. |
| Bundled package | `.harness/packages/` (from `packages/helios-research-harness`) | Research harness skills, templates, slash commands |
| Capability registry | `.harness/capabilities.json` | Skills, MCPs, Pi extensions, profiles |
| Runtime mount | `.harness/runtime/capabilities.mount.json` | Enabled capabilities for task runtime |

The installer’s default `config.yaml` template enables a broad research feature set (swarm, deep research, adaptive search, verifier evolution, etc.). At runtime, `DEFAULT_HARNESS_CONFIG` in `src/harness-sidecar/config/configLoader.js` supplies **fallback defaults when the file is absent** — but that is not equivalent to a full workplace bootstrap (no capabilities package install, no mount manifest).

**UX gap:** Users can connect and chat with Pi against a bare repo, but harness features silently lack scaffolding until CLI setup runs.

#### In-app flows to support

| Flow | When | Behavior |
|------|------|----------|
| **Initialize workplace** | No `.harness/` or empty folder selected | Create `.harness/`, write chosen preset `config.yaml`, install bundled package + capabilities + mount manifest (same as `setupHeliosForge`) |
| **Load default config** | `.harness/` exists but `config.yaml` missing | Write preset config only; offer to also refresh capabilities if registry missing |
| **Repair / load missing pieces** | Partial `.harness/` (e.g. config without capabilities) | Checklist UI: show missing artifacts; one-click “Install missing defaults” per item or all |
| **Apply config preset** | User wants a known profile | Preset picker → merge or replace with confirmation |
| **Reset to defaults** | Broken or experimental config | Equivalent to `--force-config`; require explicit confirm + optional backup |

#### Config presets (recommended)

Expose named presets in UI (backed by versioned templates in repo or sidecar), for example:

| Preset | Intent | Typical contents |
|--------|--------|------------------|
| **Minimal** | Pi chat + light harness | Small budgets, core features off, empty `endpointProfiles` |
| **Standard research** | Matches current installer default | Swarm, deep research, adaptive search enabled; default model profiles |
| **Multi-model swarm** | Council + endpoints | `modelCouncil` scaffold, example `endpointProfiles` placeholders to fill in Settings |
| **Custom import** | Power users | Upload/paste YAML; validate before apply |

After any preset load, route user to **Models & endpoints** if preset includes placeholder URLs or incomplete `endpointProfiles`.

#### Workplace health checklist (tie-in)

When a workplace is selected, Helios should always evaluate and show:

- [ ] `.harness/config.yaml` present and valid
- [ ] `.harness/capabilities.json` present
- [ ] `.harness/runtime/capabilities.mount.json` present
- [ ] Bundled package installed under `.harness/packages/`
- [ ] Sidecar can `loadHarnessConfig(workspaceRoot)` successfully
- [ ] Optional: endpoint profiles configured and health-checked

Missing items → primary CTA: **“Load defaults”** or **“Initialize workplace”** (not a link to README).

#### Backend / API expectations

Expose installer logic through the app server (not browser filesystem writes):

1. `harness_workplace_status` → checklist of artifacts + parse errors
2. `harness_workplace_initialize` → wrap `setupHeliosForge({ workspaceRoot })` (create if missing)
3. `harness_config_apply_preset` → `{ presetId, mode: 'merge' | 'replace' }` with validation
4. `harness_workplace_repair` → install only missing artifacts (capabilities, mount, package)
5. Post-action: `harness_config_reload`, `config_updated`, refresh Settings + Capabilities + Swarm tabs

`piBridgeState.js` already references `setup-helios-forge.js` for repair planning — the UI should surface that repair path explicitly instead of hiding it behind bridge internals.

### In-app swarm & runtime endpoint configuration (requirement)

**Principle:** Every runtime knob that currently requires editing `.harness/config.yaml` should have a first-class Helios UI path. YAML remains the persistence format on disk, but Helios is the editor — not VS Code, not vim.

#### Config surfaces that must be manageable in-app

| Config path | Consumed by | What operators need to set in Helios |
|-------------|---------------|--------------------------------------|
| `modelCouncil.endpointProfiles` | `modelEndpointProfiles.js`, council, router, swarm workers | Named gateways: `baseUrl`, `modelId`, vision/health flags, concurrency hints, `apiKeyEnv` (name only — secret in Secrets) |
| `modelCouncil.roles` | `modelCouncil.js`, `agentProfiles.js` | Per swarm role (e.g. `researcher`, `critic`, `visual-specialist`): `modelProfile` + `endpointProfile` |
| `modelCouncil.enabled` / `mode` | Sidecar swarm runtime | Enable multi-model council; advisory vs future modes |
| `defaults.modelProfile` / `contextProfile` | Task router, workers | Workplace default model/context for harness tasks |
| `swarmExecution.*` | `swarmOrchestrator.js`, `server.js` | `concurrency`, `maxConcurrency`, `workerMode`, `piNative`, Pi-bridge fanout |
| `features.*` (swarm-related) | Feature gates | `swarm`, `modelDrivenSwarm`, `piNativeSwarm`, `multiModelSwarm`, `deepResearch`, etc. |
| `modelRouter.*` | Adaptive model router | Enable/strategy, reward weights, arm limits (advanced panel) |
| `adaptiveSearch.*` | AB-MCTS / profile switching | Mode, `maxActionsPerTask`, `allowProfileSwitching` |
| `budgets.*` | Task start, deep research panel | Align UI deep-research inputs with persisted defaults |

Reference shape (today’s on-disk contract):

```yaml
defaults:
  modelProfile: qwen36_vlm_fast
modelCouncil:
  enabled: true
  roles:
    researcher:
      modelProfile: qwen36_vlm_deep
      endpointProfile: local_deep
  endpointProfiles:
    local_deep:
      baseUrl: http://host:8000/v1
      modelId: provider/model-id
      supportsVision: true
      healthEnabled: true
swarmExecution:
  concurrency: 2
  workerMode: model_driven   # or pi_native, etc.
features:
  multiModelSwarm: true
```

#### Proposed Settings UI: **Models & Endpoints** + **Swarm**

**Models & Endpoints** (catalog + health)

- List endpoint profiles with status chips (healthy / unknown / failing).
- Add / edit / delete profile form (no raw secrets — env var name only).
- **Test endpoint** button: sidecar probes `baseUrl` + `modelId` (mirror `healthEnabled` checks already used at runtime).
- Import from Pi `models.json` provider entry (optional convenience).
- Set `defaults.modelProfile` and show which profile each catalog entry backs.

**Swarm & council** (routing)

- Toggle swarm feature flags with short explanations and dependency hints (e.g. multi-model requires ≥2 endpoint profiles).
- Role matrix: rows = swarm roles, columns = model profile + endpoint profile dropdowns (populated from catalog).
- Concurrency and worker mode controls bound to `swarmExecution`.
- Read-only preview: “Next swarm will use …” before save.

**Adaptive router & search** (advanced collapsible)

- `modelRouter` and `adaptiveSearch` sections for operators tuning routing experiments — still in-app, not YAML.

#### Swarm tab integration (not only Settings)

Operators should also see **contextual edit entry points** from the Swarm harness tab:

- Empty or failed attempt → “Configure endpoints” deep-link to Settings.
- Per-attempt row shows resolved `endpointProfile` / `modelProfile`; mismatch with saved config → “Update routing” CTA.
- After in-app save, sidecar reloads config so the **next** task uses new routes without restarting Helios.

#### Backend / API expectations (for implementation)

The UI should not write YAML from the browser directly. Recommended flow:

1. `harness_config_get` → normalized config + resolved endpoint health summary.
2. `harness_config_patch` / `harness_endpoint_profiles_save` → validate via `normalizeEndpointProfiles`, merge into `config.yaml`, redact secrets in responses.
3. `harness_endpoint_test` → probe single profile.
4. `harness_config_reload` → sidecar picks up changes; broadcast `config_updated` to refresh Swarm tab and drift banners.
5. Role route validation endpoint → reject unknown `endpointProfile` ids before save.

This keeps **one write path** from Helios UI → sidecar → `.harness/config.yaml` → runtime (swarm, council, router, adaptive search).

### Product requirement: unified settings with explicit sync rules

Settings should be organized into at least these sections, with **read-back and write-through** to the correct backing store:

| Settings section | Backs | Sync behavior (recommended) |
|------------------|-------|----------------------------|
| **Helios connection** | App prefs + optional `.helios/settings.json` in workplace | Persist URL; test connection; reconnect without losing session |
| **Workplace** | `workspaceRoot` for Pi + sidecar | Single picker; validate `.harness/`; show health checklist |
| **Harness config** | `.harness/config.yaml` | Form or YAML editor; reload sidecar after save; surface invalid YAML |
| **Endpoints & models** | `modelCouncil.endpointProfiles`, `defaults.modelProfile`, Pi `models.json` where appropriate | One “model catalog” view: which profile is default for harness vs active in chat; warn on mismatch |
| **Pi session** | Pi RPC state | Thinking level, current model — reflect live state; optional “apply as workplace default” |
| **Pi install (advanced)** | `~/.pi/agent/*` | Read-only summary by default; explicit opt-in to open/edit global paths |
| **Capabilities & secrets** | `capabilities.json`, env | Move secrets out of Capabilities tab into Secrets; link to capability records |

**Sync principles to enforce in implementation:**

- **Single write path** — UI saves go through server/sidecar APIs that update the canonical file or RPC, then broadcast `config_updated` / `state` to refresh all surfaces.
- **Visible drift** — If chat model and `defaults.modelProfile` disagree, show a non-blocking banner: “Harness default is X; chat is using Y” with actions to align.
- **No silent partial apply** — Failed writes to YAML or Pi must not leave composer and disk inconsistent; roll back or show error with diff.
- **Scope labels** — Every field tagged: *Session*, *Workplace*, or *Global Pi* so users know blast radius.

This item is **P1** alongside the settings menu itself: a settings page that only edits harness YAML but leaves connection and Pi models elsewhere would not resolve the fragmentation above.

---

## Information Architecture

### Current layout model

```
┌─────────────┬──────────────────────────────────────────┐
│  Sidebar    │  Topbar (session title only)              │
│  - New chat │  ┌─────────────────┬────────────────────┐ │
│  - Pinned   │  │ Harness panel   │ Chat feed          │ │
│  - Recents  │  │ (optional)      │                    │ │
│  - Status   │  │ 5 tabs + global │ Messages           │ │
│  - Debug    │  │ footer metrics  │                    │ │
│             │  └─────────────────┴────────────────────┘ │
│             │  Tool dock | Composer (workspace/model)  │
└─────────────┴──────────────────────────────────────────┘
```

### IA issues

#### 1. Dual product, single chrome

Chat and harness are peer concerns but only chat has obvious permanence. Harness tools are behind icon buttons and a toggleable panel. There is no top-level **mode** or **zone** (e.g. Chat | Research | Capabilities | Settings).

**Impact:** Users treat Helios as a chat app and never discover harness value, or power users fight the layout to keep the panel open.

#### 2. Duplicate navigation

The bottom tool dock mirrors harness tabs:

| Dock button | Harness tab |
|-------------|-------------|
| Deep Research | `deep-research` |
| Capabilities | `capabilities` |
| Traces | `traces` |
| Harness (chart icon) | Toggles entire panel (defaults to Run) |

Users cannot tell which control is canonical. Opening a dock icon opens the full panel, not a lightweight drawer.

#### 3. Sparse global header

`#topbar` contains only the session title (click → `prompt()` rename). Missing from chrome:

- Active workspace (truncated path is only in composer)
- Sidecar status (stopped / running / error)
- Pending approval count
- Connection health (sidebar footer is easy to overlook)

#### 4. “God panel” — tab content mixed with global footer

Harness tabs: Run, Deep Research, Capabilities, Swarm, Traces.

**Below all tabs**, regardless of selection, the panel always renders:

- State pill, task count, approval count
- Verifier evolution metrics
- Subagent cards
- Event stream

Swarm-specific and run-specific telemetry pollutes every tab. This matches an engineering debug layout more than an operator workflow.

---

## Onboarding & First-Run Experience

### Connection dialog (`#connection-dialog`)

| Element | Current behavior | UX issue |
|---------|------------------|----------|
| Server URL | Pre-filled `ws://${location.host}` | Assumes user understands WebSocket URLs |
| Workspace | Text input + Browse | Path typing is error-prone; browse may fail in plain browser |
| Presets | Single `localhost:3777` button | Minimal guidance for remote or Electron |
| Persistence | None (`localStorage` unused) | Every refresh repeats setup |
| Post-connect edit | Dialog hidden permanently | Cannot change server URL without refresh/hack |

**Workspace duplication:** Workspace is collected at connect **and** editable in the composer (`#workspace-input`). Changes sync via `syncWorkspaceInputs`, but mental model is unclear — which is authoritative?

### Welcome state

`showWelcome()` displays:

> Ask anything — read files, run commands, edit code, and more.

It does **not** mention:

- Research harness or sidecar
- Slash commands (`/harness`, `/deep-research`, `/forge`, etc.)
- Workspace-scoped `.harness/` setup
- Capabilities (skills, MCPs, extensions)

**Impact:** Positioning as generic chat undersells the product and hides the setup path.

### Terminology

Users see overlapping terms without glossary or progressive disclosure:

| Term | Where it appears |
|------|------------------|
| Helios Forge | Branding |
| Helios Harness | Panel title |
| Research harness | Tool button `title` |
| Sidecar | Harness subtitle |
| Pi | Connection hints, README |
| Capabilities | Tab, dock, `.harness/capabilities.json` |
| Skills / MCPs / Pi Extensions / Profiles | Capabilities sections |

---

## Chat & Composer Experience

### Composer layout

The input area uses a three-column grid: tool dock | input box | (balance). Inside the input box:

- Message textarea
- Image attach
- Workspace path + browse
- Model dropdown
- Thinking level dropdown
- Send / Steer / Abort

**Issue:** High-density controls compete for attention. Workspace path is as prominent as model selection but is a **project-level** setting, not a per-message concern.

### Streaming behavior

When `isStreaming` is true:

- Send hides; Steer and Abort show
- **Enter** sends **steer**, not a new message (`inputEl` keydown handler)

Steer is a power-user Pi feature with only a `title` tooltip. Casual users can accidentally interrupt generation.

### Attachments

- Images only: paste, drag-drop, file picker (`accept="image/*"`)
- No generic file attachment for code/docs

For a code/research workbench, this is a noticeable gap versus user expectations.

### Model & thinking pickers

Implemented as custom dropdowns positioned via `getBoundingClientRect()`. Wrapper `div`s use `onclick` to open — not native `<select>` or ARIA-compliant listbox.

**Accessibility gaps:**

- No `aria-expanded` on triggers
- No focus trap in dropdown
- No keyboard arrow navigation in lists

### Message actions

Assistant messages expose Copy, Good (thumbs up), Retry.

| Action | Status |
|--------|--------|
| Copy | Works (`navigator.clipboard`) |
| Good | **No handler** — decorative |
| Retry | **Broken** — reads last user text but calls `sendMessage('prompt')` without setting `inputEl.value` |

Actions appear on **hover only** (`.message:hover .msg-actions`) — poor on touch devices.

### Progress feedback

Two parallel patterns:

1. `.loading-spinner` — “Thinking…” in message feed
2. `#assistant-activity` — phase, detail, metrics bar (`aria-live="polite"`)

Redundant and potentially inconsistent during long tool-heavy turns.

### Connection banner

`#connection-banner` starts with class `hidden`. `setStatus()` replaces `className`, which can show a “Connected to Helios Forge” banner inside the chat feed while sidebar already shows “Connected”.

---

## Harness & Operator Surface

### Sidecar lifecycle

Harness panel header: **Start** / **Stop** buttons; subtitle shows `Sidecar running` or `Sidecar {status}`.

**Issues:**

- No prominent pre-flight indicator when sidecar is stopped (capabilities, traces, swarm appear empty)
- Start/Stop buried inside optional panel
- No guided “first research task” flow after start

### Background harness from chat

`autoHarnessEnabled = true` (hardcoded). `classifyPromptHarnessRoute()` may launch harness tasks in the background from normal prompts based on regex heuristics.

**Issues:**

- No UI toggle
- No user-visible explanation when background launch occurs
- Cooldown (`HARNESS_BACKGROUND_COOLDOWN_MS = 1500`) is invisible

Users may unknowingly trigger sidecar work.

### Capabilities tab

Strengths: install/search field, Smithery integration, typed sections (Skills, MCPs, Pi Extensions, Profiles, Templates, Slash Commands).

**Issues:**

1. **Install placeholder** is a single overwhelming CLI examples string.
2. **Advanced Record** form (type, approval mode, path, args, env, notes) sits adjacent to quick install — expert vs beginner mixed without mode switch.
3. **Smithery API key** in password field in-panel — should live in settings/secrets.
4. **Refresh-dependent** data; stale state not visually distinguished.

### Swarm tab

Aligns with `docs/architecture/archive/subagent-swarm-ui-and-tracing-plan.md` direction but still dense:

- Overview metrics (Local Meta, Memory Hierarchy, Experiments, Capability Goals) use internal jargon
- Inspector grid (Thinking, Actions, Handoff, Selected Event) has many empty states until tasks run
- Subagent cards in global footer duplicate Swarm tab list (truncated to 6)

### Traces & replay

Toolbar: Prepare | Next | Reset — operator vocabulary without inline tutorial.

AB-MCTS replay section adds further specialist terminology.

### Approvals

`approval.required` opens `#modal-harness-approval` — good interrupt pattern.

**Gap:** When modal is dismissed, pending approvals are only reflected in `harnessApprovalCount` inside the **open** harness panel. No global badge or notification queue.

---

## Session Management (Sidebar)

### Data model friction

Two session sources coexist:

1. **Ephemeral sessions** — `addSession()` uses `Date.now().toString()` ids
2. **Pi session files** — `renderPiSessions()` from `get_session_files`

Switching uses `switch_session` for Pi paths; ephemeral entries may not map cleanly.

### Specific issues

| Issue | Detail |
|-------|--------|
| Pins not persisted | `s.pinned` toggled in memory only |
| Unbounded recents | All Pi sessions loaded — no pagination/search |
| Rename | `prompt('Rename chat:')` — breaks visual polish |
| Delete | No confirmation; immediate `delete_session` RPC |
| Current session omitted | Active session excluded from recents list |
| Row metadata | No message count, workspace, or model in list items |

### Mobile sidebar

CSS at `max-width: 768px`:

```css
#sidebar { transform: translateX(-100%); }
#sidebar.open { transform: translateX(0); }
```

**No JavaScript toggles `open`.** On viewports ≤768px, sidebar is off-screen with no hamburger control. Users lose New chat, session list, and status.

---

## Responsive & Layout

| Breakpoint | Behavior | Concern |
|------------|----------|---------|
| ≤1180px | Harness + chat stack; harness `max-height: 46vh` | Cramped operator UI; vertical scroll fight |
| ≤980px | Capability/trace layouts single column | Acceptable |
| ≤768px | Sidebar hidden (broken) | **Critical** |
| ≤640px | Input grid single column; harness toolbars stack | Icon-only dock without labels |

When harness panel is open, `#input-area` grid changes via `:has(.harness-panel:not(.hidden))` — layout shift can disorient users mid-task.

---

## Accessibility

| Area | Finding |
|------|---------|
| Harness tabs | `role="tablist"` present; tabs lack `aria-selected`, `aria-controls`, roving tabindex |
| Meta-selects | `onclick` on non-button wrappers |
| Session title rename | Click on `div`, not button; no keyboard path |
| Toasts | `pointer-events: none` — cannot dismiss or interact |
| Focus management | Modals open without documented focus trap |
| Color | Dark theme only; no high-contrast or theme preference |

---

## Feedback, Errors & Trust

| Channel | Used for | Limitation |
|---------|----------|------------|
| Toasts | Model change, workspace set, errors, compaction | 2.5s auto-dismiss; easy to miss |
| Sidebar status | Connection state | Low salience |
| Debug panel | WebSocket pipeline | Auto-opens on connection failure — alarming for non-dev users |
| Harness events | Sidecar activity | Invisible when panel closed |

Workspace path: toast on browse success; **silent** on Enter in composer (`applyWorkspaceSelection(..., { notify: false })`).

---

## Broken or Misleading Controls (Evidence)

| Control | Location | Expected | Actual |
|---------|----------|----------|--------|
| Export | `#btn-export` | Export session/conversation | **No event listener in `app.js`** |
| Retry | Message action | Resend last user prompt | Reads text but sends empty prompt |
| Good | Message action | Feedback | No `onclick` |
| Mobile nav | `#sidebar` | Open session list | `.open` class never applied |

---

## Alignment with Product Spec

| Spec intent | UI today | Gap |
|-------------|----------|-----|
| Research-native workbench | Chat-first layout | Harness is secondary/hidden |
| Workspace-scoped harness config | Path inputs + `.harness` on disk | No settings UI; **no in-app bootstrap**; **no sync with Pi model/endpoint state** |
| Task status, budgets, traces visible | Present in harness panel | Buried; jargon-heavy |
| Approval relay | Modal works | No persistent attention queue |
| Thin wrapper, rich sidecar | UI exposes much sidecar internals | Operator console leaks into chat |

---

## Recommendations

### Theme A — Unified settings, endpoints, Pi sync & workplace (owner-identified)

**Goal:** One settings destination where **Helios connection**, **workplace**, **harness YAML**, **endpoint/model profiles**, **swarm & council routing**, **Pi session + global settings**, and **secrets** are configurable, persisted, and kept in sync across the UI, Pi RPC, and sidecar.

| Item | Recommendation |
|------|----------------|
| Settings entry | Gear in sidebar footer or topbar; sections below |
| **Helios connection** | Server URL (ws/wss), optional port preset, “Test connection”, reconnect; persist in app/Electron store |
| **Workplace** | “Open workplace” flow: pick folder → **health checklist** → **Initialize / Load defaults** if `.harness/` missing or incomplete (no CLI required) |
| **Harness config** | Preset loader (Minimal / Standard / Multi-model swarm), merge vs replace, repair missing artifacts; YAML editor for advanced edits |
| **Models & endpoints** | Full CRUD on `modelCouncil.endpointProfiles`; health test; `defaults.modelProfile`; link to Pi `models.json` where shared |
| **Swarm & council** | In-app role→profile matrix, `swarmExecution` (concurrency, worker mode, pi-native), council enable/mode — **no manual YAML required for routine setup** |
| **Router & adaptive search** | Collapsible editors for `modelRouter` and `adaptiveSearch` |
| **Pi settings** | Session: model + thinking (mirror composer); optional “Set as harness default”. Advanced: read-only summary of `~/.pi/agent/models.json` and extensions |
| **Sync & drift** | On load and after saves, compare chat model vs harness default vs role routes; show drift banner and one-click align actions |
| **Secrets** | API keys referenced by `apiKeyEnv` on endpoint profiles — never inline in YAML UI |
| **Persistence** | Remember last workplace + server; workplace hosts canonical `.harness/config.yaml` |
| **Apply pipeline** | Save → validate → sidecar write → `harness_config_reload` → `config_updated` event → refresh Swarm tab + settings |

See **Configuration Fragmentation & Sync**, **In-app harness bootstrap & default config loading**, and **In-app swarm & runtime endpoint configuration** for the full layer map, bootstrap artifacts, config paths, and API expectations.

### Theme B — Mode-based layout

**Goal:** Separate casual chat from research operations without losing quick access.

```
┌──────────────────────────────────────────────────────┐
│ [Chat] [Research] [Capabilities] [Traces]   ⚙ Status │
├──────────────────────────────────────────────────────┤
│  Primary content for selected mode                    │
├──────────────────────────────────────────────────────┤
│  Composer (chat mode) OR mode-specific actions        │
└──────────────────────────────────────────────────────┘
```

- Remove duplicate dock ↔ tab mirroring; one navigation system.
- Tab-scoped footers: subagent cards only on Research/Swarm, not on Capabilities.
- Global status chip: `Sidecar · 1 approval · ws connected`.

### Theme C — Trust fixes (P0)

1. Wire **Export** (session JSON/markdown) or remove button until implemented.
2. Fix **Retry** to populate input or resend last user message directly.
3. Remove or implement **Good** feedback (harness reward signal).
4. Add **hamburger + overlay** for mobile sidebar.
5. **Confirm** before session delete.

### Theme D — Onboarding

- Replace generic welcome with workplace-aware empty state:
  - Current workspace name
  - Sidecar status + “Start research” CTA
  - Slash command cheat sheet (collapsible)
- First-run checklist: Node/Pi connected → workplace selected → **Initialize workplace / load defaults** → sidecar started → configure endpoints → optional capability install.

### Theme E — Composer & chat polish

- Move workspace to settings/workplace bar; show read-only breadcrumb in composer.
- Steer: label or split Send behavior (Enter = new line when shift; show mode indicator while streaming).
- File attachments beyond images (or hide attach until supported).
- Inline session rename; search in sidebar.

### Theme F — Harness operator UX

- Capabilities: **Simple** (install wizard) vs **Advanced** (record form).
- Approval inbox: persistent badge + list, not only modal.
- Replace refresh buttons with auto-poll when tab active + stale indicator.
- User-facing copy pass on AB-MCTS, RHO/BES, Local Meta (tooltips or “learn more” links).
- **Swarm tab:** show resolved endpoint/model per attempt; link to Settings when routing is missing or unhealthy.

### Theme G — In-app runtime configuration (swarm & endpoints)

**Goal:** Operators never need to leave Helios to point swarms at model gateways or tune council routing.

| Deliverable | Acceptance criteria |
|-------------|---------------------|
| Endpoint catalog UI | Add/edit/delete/test `endpointProfiles` from Settings |
| Role routing UI | Assign each swarm role to `modelProfile` + `endpointProfile` via dropdowns |
| Swarm execution UI | Set concurrency, worker mode, pi-native flags from Settings |
| Feature gates UI | Toggle swarm-related `features.*` with dependency validation |
| Sidecar APIs | Config get/patch/reload + endpoint health test; secrets redacted |
| Swarm tab feedback | Display active routes; CTA to fix config when attempts fail due to endpoints |
| No YAML for routine ops | Fresh workplace can configure a working multi-endpoint swarm entirely in Helios |

**Non-goal for v1:** Replacing every nested key in `productionCapabilities` or meta-harness experiment config — those can remain Advanced YAML until needed.

### Theme H — In-app harness bootstrap & presets

**Goal:** Any workplace folder can be made harness-ready from Helios without running installer scripts.

| Deliverable | Acceptance criteria |
|-------------|---------------------|
| Workplace status API | Checklist for config, capabilities, mount, package install |
| Initialize workplace | One action runs equivalent of `setupHeliosForge` for selected folder |
| Load default config | Presets apply `config.yaml` (+ optional full scaffold) in-app |
| Repair missing pieces | Partial `.harness/` can be completed without full reset |
| Preset picker | Minimal / Standard research / Multi-model swarm (+ confirm on replace) |
| Post-init routing | After load, guide user to endpoints settings if placeholders remain |
| No terminal required | Fresh clone + folder pick → working harness defaults entirely from UI |

**Implementation note:** Reuse `setupHeliosForge` from `scripts/setup-helios-forge.js` via `src/server.js` relay; do not duplicate install logic in `public/app.js`.

---

## Prioritized Roadmap

### Phase 0 — Trust (1–3 days)

- [x] Export: implement or remove
- [x] Fix Retry
- [x] Mobile sidebar toggle
- [x] Delete confirmation
- [x] Remove or wire Good button

### Phase 1 — Clarity (1–2 weeks)

- [x] Settings shell with sections: Connection, Workplace, Harness, Models & endpoints, Swarm & council, Pi, Secrets
- [x] Helios endpoint settings (server URL persist, test, reconnect)
- [x] Endpoint profile CRUD + **Test endpoint** (sidecar health probe)
- [x] Pi settings panel (session model/thinking + read-only global `models.json` summary)
- [x] Config sync: drift detection (chat vs harness default) and unified save pipeline
- [x] Workplace wizard: health checklist + **Initialize workplace / Load defaults** (wrap `setupHeliosForge`)
- [x] Config preset picker (Minimal, Standard research, Multi-model swarm)
- [x] Global status bar (connection, sidecar, approvals)

### Phase 2 — Structure (2–4 weeks)

- [x] **Swarm role routing matrix** (`modelCouncil.roles` ↔ `endpointProfiles`)
- [x] **Swarm execution controls** (`swarmExecution`, swarm-related `features.*`)
- [x] `harness_workplace_status` / `harness_workplace_initialize` / `harness_config_apply_preset` APIs
- [x] Swarm tab: show resolved routes + “Configure endpoints” when misconfigured
- [x] Mode-based layout
- [x] Tab-scoped harness panel footers
- [x] Capabilities simple/advanced split
- [x] Session list search + metadata + persisted pins
- [x] Approval inbox
- [x] `modelRouter` / `adaptiveSearch` advanced settings panels (in-app)
- [x] Deduplicate harness navigation (dock vs tabs)

### Phase 2b — Onboarding & harness polish (can overlap Phase 2)

- [x] Welcome / empty state rewrite
- [x] Background harness toggle + notice

### Phase 3 — Polish (ongoing)

- [x] Accessible dropdowns and tabs
- [x] Keyboard shortcuts help
- [ ] File attachments (non-image) — deferred; image attach remains
- [x] Offline/CDN fallback messaging
- [ ] Theming / contrast options — deferred

---

## Appendix A — File Reference

| Concern | Primary location |
|---------|------------------|
| Harness config loader | `src/harness-sidecar/config/configLoader.js` |
| Endpoint profiles | `src/harness-sidecar/model/modelEndpointProfiles.js`, `model/modelProfiles.js` |
| Swarm council routing | `src/harness-sidecar/swarm/modelCouncil.js`, `swarm/swarmOrchestrator.js` |
| Workplace bootstrap | `scripts/setup-helios-forge.js` (`setupHeliosForge`), `install.ps1` |
| Runtime config fallback | `src/harness-sidecar/config/configLoader.js` (`DEFAULT_HARNESS_CONFIG`) |
| Pi models path | `~/.pi/agent/models.json` (see `src/pi/modelArgs.js`) |
| Layout & harness DOM | `public/index.html` |
| Connection & workspace | `public/app.js` ~247–461 |
| Harness panel render | `public/app.js` ~1380–1410, 2635–2790 |
| Session management | `public/app.js` ~3676–3815 |
| Message actions | `public/app.js` ~3225–3250, 3821–3834 |
| Responsive sidebar | `public/app.css` ~1530–1542 |
| Product intent | `docs/research-harness/cleaned-product-spec.md` |
| Swarm UI target | `docs/architecture/archive/subagent-swarm-ui-and-tracing-plan.md` |

## Appendix B — Glossary (proposed for in-app help)

| Term | User-facing definition |
|------|------------------------|
| **Workplace** | The project folder Pi and the harness use (contains `.harness/`) |
| **Sidecar** | Background research service for long tasks, swarms, and verifiers |
| **Harness** | Orchestrated research run managed by the sidecar |
| **Capabilities** | Skills, MCP servers, and extensions enabled for this workplace |
| **Endpoint profile** | Named model gateway target (base URL, model ID, health) used by harness/swarm/council |
| **Model profile** | Harness shorthand (e.g. `defaults.modelProfile`) that resolves to a provider/model or endpoint |
| **Config preset** | Named in-app template (e.g. Standard research) that writes or merges into `.harness/config.yaml` and related artifacts |
| **Workplace bootstrap** | First-time setup of `.harness/` (config, capabilities, package, mount) for a folder |
| **Steer** | Send a new instruction while the model is still generating |

---

## Document History

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-06-16 | Initial UI/UX audit report |
| 1.1 | 2026-06-16 | Added configuration fragmentation section; Helios endpoint + Pi settings sync requirements |
| 1.2 | 2026-06-16 | In-app swarm & endpoint configuration requirement; Theme G; sidecar config API expectations |
| 1.3 | 2026-06-16 | In-app harness bootstrap & default config loading; Theme H; preset/workplace initialize flows |
| 1.4 | 2026-06-16 | Mark roadmap phases 0–3 implemented (file attach + theming deferred) |
