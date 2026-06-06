/**
 * Pi Chat App - WebSocket Server
 * 
 * Spawns a pi --mode rpc subprocess and bridges it to WebSocket clients.
 * Handles the full pi RPC protocol including extension UI dialogs.
 */

import { WebSocketServer } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync, createReadStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Pi RPC Manager ──────────────────────────────────────────────────

class PiRpcManager {
  constructor() {
    this.process = null;
    this.buffer = '';
    this.pendingCommands = new Map();
    this.cmdIdCounter = 0;
    this.clients = new Set();
    this.isReady = false;
    this.state = null;
  }

  start() {
    console.log('[PiRPC] Starting pi agent in RPC mode...');
    
    this.process = spawn('pi', ['--mode', 'rpc'], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      this.processOutput();
    });

    this.process.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      // Don't spam stderr during normal operation
      if (text.includes('Error') || text.includes('error')) {
        console.error('[PiRPC] stderr:', text.trim());
      }
    });

    this.process.on('close', (code) => {
      console.log(`[PiRPC] Process exited with code ${code}`);
      this.isReady = false;
      this.broadcast({ type: 'system', event: 'pi_disconnected', code });
      this.reconnect();
    });

    this.process.on('error', (err) => {
      console.error('[PiRPC] Process error:', err.message);
      this.broadcast({ type: 'system', event: 'pi_error', error: err.message });
    });

    // Wait a moment then check if ready
    setTimeout(() => this.waitForReady(), 1500);
  }

  waitForReady() {
    if (this.process && this.process.exitCode === null) {
      this.sendCommand({ type: 'get_state' })
        .then((resp) => {
          if (resp.success) {
            this.state = resp.data;
            this.isReady = true;
            console.log('[PiRPC] Pi agent is ready');
            console.log('[PiRPC] Model:', resp.data?.model?.name || resp.data?.model?.id || 'unknown');
            this.broadcast({ 
              type: 'system', 
              event: 'pi_ready', 
              data: { model: resp.data?.model, thinkingLevel: resp.data?.thinkingLevel }
            });
          }
        })
        .catch(() => {
          // Not ready yet, retry
          setTimeout(() => this.waitForReady(), 1000);
        });
    }
  }

  processOutput() {
    const lines = [];
    
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      
      lines.push(line);
    }

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        this.handleMessage(parsed);
      } catch (e) {
        // Ignore non-JSON lines
      }
    }
  }

  handleMessage(msg) {
    // Handle command responses
    if (msg.type === 'response') {
      const pending = this.pendingCommands.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingCommands.delete(msg.id);
        pending.resolve(msg);
      }
      return;
    }

    // Broadcast all other events to connected clients
    this.broadcast(msg);
  }

  async sendCommand(cmd) {
    if (!this.process || this.process.exitCode !== null) {
      throw new Error('Pi process is not running');
    }

    const id = `cmd-${++this.cmdIdCounter}`;
    const cmdWithId = { ...cmd, id };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(new Error(`Command ${cmd.type} timed out`));
      }, 60000); // 60s timeout

      this.pendingCommands.set(id, { resolve, reject, timeout });
      this.process.stdin.write(JSON.stringify(cmdWithId) + '\n');
    });
  }

  async prompt(message, options = {}) {
    return this.sendCommand({ type: 'prompt', message, ...options });
  }

  async steer(message) {
    return this.sendCommand({ type: 'steer', message });
  }

  async followUp(message) {
    return this.sendCommand({ type: 'follow_up', message });
  }

  async abort() {
    return this.sendCommand({ type: 'abort' });
  }

  addClient(ws) {
    this.clients.add(ws);
  }

  removeClient(ws) {
    this.clients.delete(ws);
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        try {
          client.send(data);
        } catch (e) {
          // Client may have disconnected
        }
      }
    }
  }

  restart() {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    setTimeout(() => this.start(), 1000);
  }

  reconnect() {
    console.log('[PiRPC] Reconnecting in 3 seconds...');
    setTimeout(() => this.start(), 3000);
  }
}

// ─── Static File Serving ───────────────────────────────────────────────

const MIMES = {
  'html': 'text/html',
  'js': 'application/javascript',
  'css': 'text/css',
  'json': 'application/json',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'svg': 'image/svg+xml',
  'ico': 'image/x-icon',
  'woff2': 'font/woff2',
  'woff': 'font/woff',
  'ttf': 'font/ttf',
};

function serveStatic(req, res, url) {
  let filePath = url === '/' ? '/index.html' : url;
  filePath = join(ROOT, 'public', filePath);
  
  if (existsSync(filePath)) {
    const ext = filePath.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIMES[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const port = parseInt(process.env.PORT || '3777', 10);
  const pi = new PiRpcManager();

  const server = createServer((req, res) => {
    serveStatic(req, res, req.url);
  });

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[Server] Client connected');
    pi.addClient(ws);
    
    // Send connected signal
    ws.send(JSON.stringify({ type: 'system', event: 'connected' }));

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        await handleCommand(ws, msg, pi);
      } catch (e) {
        console.error('[Server] Error handling message:', e.message);
        ws.send(JSON.stringify({ type: 'error', error: e.message }));
      }
    });

    ws.on('close', () => {
      console.log('[Server] Client disconnected');
      pi.removeClient(ws);
    });

    ws.on('error', (err) => {
      console.error('[Server] WebSocket error:', err.message);
      pi.removeClient(ws);
    });
  });

  server.listen(port, () => {
    console.log(`[Server] HTTP + WebSocket server on http://localhost:${port}`);
    console.log('[Server] Opening browser...');
    pi.start();
  });
}

async function handleCommand(ws, msg, pi) {
  switch (msg.type) {
    case 'prompt': {
      const options = {};
      if (msg.streamingBehavior) options.streamingBehavior = msg.streamingBehavior;
      if (msg.images) options.images = msg.images;
      await pi.prompt(msg.message, options);
      break;
    }
    case 'steer': {
      await pi.steer(msg.message);
      break;
    }
    case 'follow_up': {
      await pi.followUp(msg.message);
      break;
    }
    case 'abort': {
      await pi.abort();
      break;
    }
    case 'get_state': {
      const state = await pi.sendCommand({ type: 'get_state' });
      ws.send(JSON.stringify({ type: 'state', data: state.data }));
      break;
    }
    case 'get_messages': {
      const messages = await pi.sendCommand({ type: 'get_messages' });
      ws.send(JSON.stringify({ type: 'messages', data: messages.data }));
      break;
    }
    case 'get_models': {
      const models = await pi.sendCommand({ type: 'get_available_models' });
      ws.send(JSON.stringify({ type: 'models', data: models.data }));
      break;
    }
    case 'get_session_stats': {
      const stats = await pi.sendCommand({ type: 'get_session_stats' });
      ws.send(JSON.stringify({ type: 'session_stats', data: stats.data }));
      break;
    }
    case 'set_model': {
      const result = await pi.sendCommand({ type: 'set_model', provider: msg.provider, modelId: msg.modelId });
      ws.send(JSON.stringify({ type: 'model_changed', success: result.success, data: result.data }));
      break;
    }
    case 'set_thinking': {
      const result = await pi.sendCommand({ type: 'set_thinking_level', level: msg.level });
      ws.send(JSON.stringify({ type: 'thinking_changed', success: result.success }));
      break;
    }
    case 'extension_ui_response': {
      // Forward extension UI response to pi
      const { id, value, confirmed, cancelled } = msg;
      const response = { type: 'extension_ui_response', id };
      if (value !== undefined) response.value = value;
      if (confirmed !== undefined) response.confirmed = confirmed;
      if (cancelled) response.cancelled = true;
      
      if (pi.process && pi.process.exitCode === null) {
        pi.process.stdin.write(JSON.stringify(response) + '\n');
      }
      break;
    }
    case 'restart_pi': {
      pi.restart();
      break;
    }
    case 'new_session': {
      const result = await pi.sendCommand({ type: 'new_session' });
      ws.send(JSON.stringify({ type: 'session_changed', success: result.success, data: result.data }));
      break;
    }
    case 'get_commands': {
      const cmds = await pi.sendCommand({ type: 'get_commands' });
      ws.send(JSON.stringify({ type: 'commands', data: cmds.data }));
      break;
    }
    default:
      ws.send(JSON.stringify({ type: 'error', error: `Unknown command: ${msg.type}` }));
  }
}

main().catch(console.error);
