# Helios Forge Desktop Install

Helios Forge can run as a standalone Electron desktop app without opening a terminal or running `install.ps1`.

## Prerequisites

- **Pi Agent** installed and on `PATH` (or set `HELIOS_PI_COMMAND`)
- Pi config at `~/.pi/agent/` with `models.json` and `auth.json`

## Run from source (development)

```powershell
npm install
npm run electron
```

On first launch:

1. Pick a workplace folder in the native dialog
2. Helios scaffolds `.harness/` in that folder if needed
3. The app auto-connects to the embedded local server

Use **Settings → Workplace** for Initialize/Repair after changing workplaces.

## Workplace evolution scaffold

New workplaces receive an evolution-ready `.harness/` layout automatically:

- **Held-out suite:** `.harness/benchmarks/suites/workplace-smoke.json` runs real project test commands (not synthetic 0.5/0.55 stub scores).
- **Evolution config:** `.harness/config.yaml` includes an `evolution:` block (`syntheticReplay: false`, `defaultSuiteId: workplace-smoke`).
- **Swarm endpoint:** Set `models.swarmBaseUrl` in config (or `HELIOS_SWARM_MODEL_BASE_URL`) for model-driven swarm; the UI shows an advisory when unset.
- **Repair path:** Settings → Workplace → Repair merges missing evolution assets without overwriting operator edits.

Existing workplaces pick up the same scaffold via Repair without wiping custom config.

## Build an installable package (maintainers)

```powershell
npm install
npm run icons:generate
npm run electron:pack    # unpacked app in dist/win-unpacked
npm run electron:dist    # NSIS installer in dist/
```

## Logs

Desktop runtime logs are written to the Electron user data directory under `logs/helios-forge.log` (when file logging is enabled).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Pi not found | Install Pi; verify `pi --version` in a new terminal |
| Missing models/auth | Configure `~/.pi/agent/models.json` and `auth.json` |
| Workplace missing capabilities | Settings → Workplace → Initialize/Repair |
| Port conflict | Restart the app; it picks a free loopback port automatically |
| `Failed to start: spawn ... ENOENT` on Windows | Rebuild with `npm run electron:pack` so `resources/app.asar.unpacked/` exists; do not run from a partial `win-unpacked` folder missing the `.exe` |
