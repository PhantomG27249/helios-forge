# Helios Forge

An AlphaHelion research-agent workbench built on top of the [pi](https://github.com/earendil-works/pi) coding agent.

## Features

- **Research harness sidecar** - task events, approvals, traces, verifiers, RAG, memory, graph, BES, swarm, research, and experiment scaffolds
- **Full pi integration** via RPC mode — all tools, settings, and capabilities are preserved
- **Real-time streaming** — see responses as they're generated
- **Tool call visualization** — expandable panels showing tool name, arguments, and results
- **Thinking blocks** — collapsible reasoning sections
- **Markdown rendering** with syntax highlighting for code blocks
- **Model & thinking controls** — switch models and adjust thinking level from the UI
- **Session management** — view stats, start new sessions
- **Steering & follow-up** — send mid-stream messages while pi is working
- **Extension UI support** — handles extension dialogs (select, confirm, input, editor)
- **Electron-ready** — clean architecture for easy desktop app conversion

## Quick Start

```bash
# Install dependencies
cd helios-forge
npm install

# Start the server
npm run dev
# or directly:
node src/server.js
```

Then open **http://localhost:3777** in your browser.

## Configuration

The app reads pi's existing configuration from:
- `~/.pi/agent/settings.json` — default model, provider, thinking level
- `~/.pi/agent/auth.json` — API credentials
- `~/.pi/agent/models.json` — custom models

You can override settings via environment variables:
```bash
PORT=8080 node src/server.js  # Change port
```

## Architecture

```
┌─────────────────────┐     WebSocket      ┌──────────────────┐
│   Browser UI         │◄──────────────────►│   Node.js Server   │
│  (HTML/CSS/JS)       │                     │   (src/server.js)  │
│                      │                     │                    │
│  • Chat display      │   JSON-RPC over     │  • WebSocket server  │
│  • Markdown render   │   stdin/stdout      │  • Static file serving │
│  • Tool call UI      │                     │  • Pi RPC bridge       │
│  • Thinking blocks   │                     │  • Extension UI relay  │
└─────────────────────┘                     └─────────┬──────────┘
                                                     │
                                              ┌──────▼───────┐
                                              │  pi --mode rpc │
                                              │  (pi agent)    │
                                              └────────────────┘
```

## Converting to Electron

The app is designed for easy Electron integration:

1. Create `electron/main.js`:
```javascript
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: { nodeIntegration: false },
  });
  win.loadURL('http://localhost:3777');
}

app.whenReady().then(createWindow);
```

2. Add Electron dependency:
```bash
npm install --save-dev electron
```

3. Start with `npm run electron`

Alternatively, use `electron-builder` for packaging:
```json
{
  "build": {
    "appId": "ai.alphahelion.heliosforge",
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
}
```

## Pi RPC Protocol

The server communicates with pi using the official RPC protocol:
- JSON-Lines over stdin/stdout
- Full command set: `prompt`, `steer`, `follow_up`, `abort`, `get_state`, etc.
- Event streaming for real-time updates
- Extension UI dialog support

See [pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) for details.

## Project Structure

```
helios-forge/
├── package.json          # Dependencies and scripts
├── public/
│   ├── index.html        # Main HTML template
│   ├── app.css           # Styles
│   └── app.js            # Frontend logic
├── src/
│   └── server.js         # WebSocket + Pi RPC server
└── README.md
```

## License

MIT
