# Helios Forge

Helios Forge is AlphaHelion's workspace-scoped research-agent harness for Pi Agent. It keeps Pi's main install intact while adding local research skills, slash commands, runtime capability mounting, memory/RAG/graph sidecar features, visual debugging support, swarm/BES primitives, trace replay, and meta-harness workflows.

## Quick Install

From this repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
npm run dev
```

Then open [http://127.0.0.1:3777/](http://127.0.0.1:3777/).

To install and launch in one command:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Start
```

## What The Installer Does

`install.ps1` performs the local setup needed for a working Helios Forge run:

- verifies Node.js and npm are available
- installs npm dependencies unless `-SkipNpmInstall` is used
- creates a workspace-local `.harness/config.yaml` if one does not exist
- installs the bundled `packages/helios-research-harness` package into `.harness/packages`
- registers bundled skills, templates, slash commands, and the kwargs Pi extension in `.harness/capabilities.json`
- writes `.harness/runtime/capabilities.mount.json` so the harness can mount enabled capabilities for real tasks
- runs the release smoke check

The installer does not write to your global Pi install by default. To also install the kwargs extension into `C:\Users\<you>\.pi\agent\extensions`, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -InstallPiKwargs
```

That optional extension preserves model-specific request args such as `temperature`, `top_p`, `top_k`, `min_p`, penalties, and thinking-template kwargs from Pi's `models.json`.

## Manual Setup

```powershell
npm install
npm run setup
npm run release:smoke
npm run dev
```

Useful variants:

```powershell
npm run setup -- --workspace C:\path\to\another\workspace
npm run setup -- --force-config
npm run install:pi-kwargs
```

## Runtime Surface

The bundled Helios package adds:

- slash commands: `/research`, `/deep-research`, `/forge`
- skills: deep research, visual debugging, meta harness
- templates: research brief, eval promotion, visual fix report
- Pi extension: model args and thinking preservation

The app also exposes toolbar access for deep research, capability management, traces, memory/RAG/graph work, visual artifacts, and subagent/swarm visibility.

## Pi Model Setup

Helios Forge reads Pi Agent's normal model configuration:

- `C:\Users\<you>\.pi\agent\settings.json`
- `C:\Users\<you>\.pi\agent\models.json`
- `C:\Users\<you>\.pi\agent\auth.json`

Configure Pi with the private OpenAI-compatible base URL and model id you want to run. Keep endpoint details out of this repository.

Keep credentials and provider details in Pi's normal config. Helios Forge only mounts workspace-local harness capabilities unless you explicitly install the optional global Pi kwargs extension.

## Development

```powershell
npm test
npm run release:smoke
```

Generated harness runtime files live under `.harness/` and are ignored by git.

## Troubleshooting

- If the browser shows a WebSocket reconnect loop, restart the dev server with `npm run dev`.
- If bundled skills or slash commands do not appear, run `npm run setup` again.
- If Pi does not receive model kwargs, confirm `C:\Users\<you>\.pi\agent\models.json` has matching `args`, then run `npm run install:pi-kwargs` if you want the global extension installed.
- If a workspace already has a `.harness/config.yaml`, setup preserves it unless `--force-config` is passed.
