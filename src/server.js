/**
 * Helios Forge - WebSocket Server
 */

import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import fs, { existsSync, createReadStream } from 'fs';
import path, { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { HarnessClient } from './harness/harnessClient.js';
import { HarnessManager } from './harness/harnessManager.js';
import { resolvePiCommand } from './pi/resolvePiCommand.js';
import { selectWorkspaceFolder } from './workspace/workspacePicker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

class PiRpcManager {
  constructor() {
    this.process = null;
    this.cwd = process.cwd();
    this.buffer = '';
    this.pending = new Map();
    this.idCounter = 0;
    this.clients = new Set();
    this.readyData = null;
    this._restarting = false;
  }

  async start() {
    return new Promise((resolve) => {
      console.log('[PiRPC] Starting...');
      const piCommand = resolvePiCommand();
      this.process = spawn(piCommand.command, [...piCommand.args, '--mode', 'rpc'], {
        cwd: this.cwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        this.processOutput();
      });

      this.process.stderr.on('data', (chunk) => {
        if (chunk.toString().includes('Error')) console.error(chunk.toString().trim());
      });

      this.process.on('close', (code) => {
        if (this._restarting) {
          // We're intentionally restarting, don't auto-restart
          this._restarting = false;
          return;
        }
        this.readyData = null;
        this.broadcast({ type: 'system', event: 'pi_disconnected', code });
        setTimeout(() => this.start(), 3000);
      });

      this.process.on('error', (err) => {
        this.broadcast({ type: 'system', event: 'pi_error', error: err.message });
      });

      // Wait for pi to be ready, then resolve
      setTimeout(() => this.checkReady(resolve), 2000);
    });
  }

  checkReady(resolve) {
    if (!this.process || this.process.exitCode !== null) return;
    this.sendCommand({ type: 'get_state' })
      .then((resp) => {
        if (resp.success) {
          this.readyData = resp.data;
          console.log('[PiRPC] Ready — Model:', resp.data?.model?.name || 'unknown');
          this.broadcast({ type: 'system', event: 'pi_ready', data: resp.data });
          if (resolve) resolve();
        } else {
          setTimeout(() => this.checkReady(resolve), 1500);
        }
      })
      .catch(() => setTimeout(() => this.checkReady(resolve), 1500));
  }

  processOutput() {
    while (true) {
      const idx = this.buffer.indexOf('\n');
      if (idx === -1) break;
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'response') {
          const pending = this.pending.get(parsed.id);
          if (pending) { clearTimeout(pending.timeout); this.pending.delete(parsed.id); pending.resolve(parsed); }
        } else {
          this.broadcast(parsed);
        }
      } catch (e) { /* skip */ }
    }
  }

  sendCommand(cmd) {
    if (!this.process || this.process.exitCode !== null) return Promise.reject(new Error('Pi not running'));
    const id = `cmd-${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('Timeout')); }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(JSON.stringify({ ...cmd, id }) + '\n');
    });
  }

  addClient(ws) { this.clients.add(ws); }
  removeClient(ws) { this.clients.delete(ws); }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        try { client.send(data); } catch (e) { this.clients.delete(client); }
      }
    }
  }

  sendReadyToClient(ws) {
    if (this.readyData && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'system', event: 'pi_ready', data: this.readyData }));
    }
  }
}

const MIMES = {
  html: 'text/html', js: 'application/javascript', css: 'text/css',
  json: 'application/json', png: 'image/png', svg: 'image/svg+xml',
};

function serveStatic(req, res, url) {
  let filePath = url === '/' ? '/index.html' : url.split('?')[0];
  filePath = join(ROOT, 'public', filePath);
  if (existsSync(filePath)) {
    const ext = filePath.split('.').pop();
    res.writeHead(200, { 'Content-Type': MIMES[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not Found');
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function isLocalRequest(req) {
  const remoteAddress = req.socket?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (body.length > 64 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handleWorkspaceSelect(req, res) {
  if (!isLocalRequest(req)) {
    sendJson(res, 403, { selected: false, error: 'Workspace picker is only available from localhost' });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const result = await selectWorkspaceFolder({ initialDirectory: body.initialDirectory || '' });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { selected: false, error: error.message });
  }
}

async function handleHttpRequest(req, res) {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'POST' && pathname === '/api/workspace/select') {
    await handleWorkspaceSelect(req, res);
    return;
  }
  serveStatic(req, res, req.url);
}

function createHarnessRuntime(workspaceRoot) {
  return {
    manager: new HarnessManager({ workspaceRoot }),
    client: null,
    unsubscribeEvents: null,
  };
}

function closeHarnessClient(harness) {
  if (harness.unsubscribeEvents) {
    harness.unsubscribeEvents();
    harness.unsubscribeEvents = null;
  }
  if (harness.client) {
    harness.client.close();
    harness.client = null;
  }
}

async function ensureHarnessRunning(harness, pi) {
  const status = harness.manager.getStatus();
  if (status.state === 'stopped' && harness.manager.workspaceRoot !== pi.cwd) {
    closeHarnessClient(harness);
    harness.manager = new HarnessManager({ workspaceRoot: pi.cwd });
  }
  if (status.state !== 'running') {
    await harness.manager.start();
  }
  if (!harness.client) {
    harness.client = new HarnessClient({ baseUrl: harness.manager.getStatus().url });
    harness.unsubscribeEvents = harness.client.onEvent((event) => {
      pi.broadcast({ type: 'harness_task_event', event });
    });
  }
  return harness.manager.getStatus();
}

async function handleCommand(ws, msg, pi, harness) {
  try {
    switch (msg.type) {
      case 'prompt': {
        const opts = {};
        if (msg.streamingBehavior) opts.streamingBehavior = msg.streamingBehavior;
        if (msg.images && msg.images.length) opts.images = msg.images;
        await pi.sendCommand({ type: 'prompt', message: msg.message, ...opts });
        break;
      }
      case 'steer': {
        const opts = { message: msg.message };
        if (msg.images && msg.images.length) opts.images = msg.images;
        await pi.sendCommand({ type: 'steer', ...opts });
        break;
      }
      case 'follow_up': {
        await pi.sendCommand({ type: 'follow_up', message: msg.message });
        break;
      }
      case 'abort': await pi.sendCommand({ type: 'abort' }); break;
      case 'get_state': {
        const r = await pi.sendCommand({ type: 'get_state' });
        ws.send(JSON.stringify({ type: 'state', data: r.data || {} }));
        break;
      }
      case 'get_messages': {
        const r = await pi.sendCommand({ type: 'get_messages' });
        ws.send(JSON.stringify({ type: 'messages', data: r.data || {} }));
        break;
      }
      case 'get_models': {
        const r = await pi.sendCommand({ type: 'get_available_models' });
        ws.send(JSON.stringify({ type: 'models', data: r.data || {} }));
        break;
      }
      case 'get_session_stats': {
        const r = await pi.sendCommand({ type: 'get_session_stats' });
        ws.send(JSON.stringify({ type: 'session_stats', data: r.data || {} }));
        break;
      }
      case 'set_model': {
        const r = await pi.sendCommand({ type: 'set_model', provider: msg.provider, modelId: msg.modelId });
        ws.send(JSON.stringify({ type: 'model_changed', success: r.success, data: r.data }));
        break;
      }
      case 'set_thinking': {
        const r = await pi.sendCommand({ type: 'set_thinking_level', level: msg.level });
        ws.send(JSON.stringify({ type: 'thinking_changed', success: r.success }));
        break;
      }
      case 'extension_ui_response': {
        const resp = { type: 'extension_ui_response', id: msg.id };
        if (msg.value !== undefined) resp.value = msg.value;
        if (msg.confirmed !== undefined) resp.confirmed = msg.confirmed;
        if (msg.cancelled) resp.cancelled = true;
        if (pi.process && pi.process.exitCode === null) {
          pi.process.stdin.write(JSON.stringify(resp) + '\n');
        }
        break;
      }
      case 'set_workspace': {
        const newCwd = msg.path || process.cwd();
        if (newCwd === pi.cwd) {
          ws.send(JSON.stringify({ type: 'workspace_changed', success: true, path: newCwd }));
          break;
        }
        console.log('[Server] Changing workspace to:', newCwd);
        // Just update the cwd - pi will use it for file operations
        pi.cwd = newCwd;
        ws.send(JSON.stringify({ type: 'workspace_changed', success: true, path: newCwd }));
        break;
      }
      case 'harness_status': {
        ws.send(JSON.stringify({ type: 'harness_status', data: harness.manager.getStatus() }));
        break;
      }
      case 'harness_start': {
        if (msg.workspaceRoot || harness.manager.workspaceRoot !== pi.cwd) {
          closeHarnessClient(harness);
          if (harness.manager.getStatus().state !== 'stopped') {
            await harness.manager.stop();
          }
          harness.manager = new HarnessManager({
            workspaceRoot: msg.workspaceRoot || pi.cwd,
            port: msg.port || 49321,
          });
        }
        await ensureHarnessRunning(harness, pi);
        ws.send(JSON.stringify({ type: 'harness_status', data: harness.manager.getStatus() }));
        break;
      }
      case 'harness_stop': {
        closeHarnessClient(harness);
        await harness.manager.stop();
        ws.send(JSON.stringify({ type: 'harness_status', data: harness.manager.getStatus() }));
        break;
      }
      case 'harness_restart': {
        closeHarnessClient(harness);
        await harness.manager.restart();
        harness.client = new HarnessClient({ baseUrl: harness.manager.getStatus().url });
        harness.unsubscribeEvents = harness.client.onEvent((event) => {
          pi.broadcast({ type: 'harness_task_event', event });
        });
        ws.send(JSON.stringify({ type: 'harness_status', data: harness.manager.getStatus() }));
        break;
      }
      case 'harness_task_start': {
        await ensureHarnessRunning(harness, pi);
        const task = await harness.client.startTask({
          workspaceId: msg.workspaceId || 'local',
          task: msg.task || msg.message || '',
          mode: msg.mode || 'mvp',
          budget: msg.budget || { maxToolCalls: 20, maxWallMinutes: 15 },
        });
        ws.send(JSON.stringify({ type: 'harness_task_started', data: task }));
        break;
      }
      case 'harness_approval_response': {
        await ensureHarnessRunning(harness, pi);
        const approval = await harness.client.resolveApproval(msg.actionId, msg.choice);
        ws.send(JSON.stringify({ type: 'harness_approval_resolved', data: approval }));
        break;
      }
      case 'harness_artifact_get': {
        await ensureHarnessRunning(harness, pi);
        const artifact = await harness.client.getArtifact(msg.artifactId);
        ws.send(JSON.stringify({ type: 'harness_artifact', data: artifact }));
        break;
      }
      case 'delete_session': {
        const sessionPath = msg.path;
        try {
          
          if (sessionPath && fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            ws.send(JSON.stringify({ type: 'session_deleted', success: true, path: sessionPath }));
            // Refresh session list
            pi.broadcast({ type: 'system', event: 'session_deleted', path: sessionPath });
          } else {
            ws.send(JSON.stringify({ type: 'session_deleted', success: false, error: 'File not found' }));
          }
        } catch (err) {
          ws.send(JSON.stringify({ type: 'session_deleted', success: false, error: err.message }));
        }
        break;
      }
      case 'new_session': {
        const r = await pi.sendCommand({ type: 'new_session' });
        // After new session, fetch state to get new session info
        const state = await pi.sendCommand({ type: 'get_state' });
        ws.send(JSON.stringify({ type: 'session_changed', success: r.success, data: state.data || {} }));
        break;
      }
      case 'switch_session': {
        try {
          console.log('[Server] Switching to session:', msg.sessionPath);
          const r = await pi.sendCommand({ type: 'switch_session', sessionPath: msg.sessionPath });
          console.log('[Server] switch_session result:', r.success, r.data?.cancelled);
          if (r.success && !r.data?.cancelled) {
            // Extract cwd from session file
            let sessionCwd = '';
            try {
              const sessionContent = fs.readFileSync(msg.sessionPath, 'utf-8');
              for (const line of sessionContent.split('\n')) {
                if (line.trim()) {
                  try {
                    const d = JSON.parse(line);
                    if (d.type === 'session' && d.cwd) {
                      sessionCwd = d.cwd;
                      break;
                    }
                  } catch {}
                }
              }
            } catch {}
            
            // After switching, load the messages
            const msgs = await pi.sendCommand({ type: 'get_messages' });
            const state = await pi.sendCommand({ type: 'get_state' });
            console.log('[Server] Loaded', msgs.data?.messages?.length || 0, 'messages, cwd:', sessionCwd);
            // Merge cwd into state
            const mergedState = { ...(state.data || {}), cwd: sessionCwd };
            ws.send(JSON.stringify({ type: 'session_loaded', messages: msgs.data?.messages || [], state: mergedState }));
          } else {
            console.log('[Server] Switch cancelled or failed');
            ws.send(JSON.stringify({ type: 'session_loaded', cancelled: r.data?.cancelled, messages: [], state: {} }));
          }
        } catch (err) {
          console.error('[Server] Error switching session:', err.message);
          ws.send(JSON.stringify({ type: 'session_loaded', cancelled: true, messages: [], state: {} }));
        }
        break;
      }
      case 'get_sessions': {
        // Scan session directory for available sessions
        const state = await pi.sendCommand({ type: 'get_state' });
        const sessionDir = state.data?.sessionFile 
          ? state.data.sessionFile.replace(/\/[^/]+$/, '')
          : null;
        // For now, we get the current session info
        ws.send(JSON.stringify({ type: 'sessions', data: { current: state.data || {} } }));
        break;
      }
      case 'get_session_files': {
        const sessionsDir = process.env.HOME + '/.pi/agent/sessions';
        try {
          
          
          
          let dirs = [];
          try {
            dirs = fs.readdirSync(sessionsDir).filter(d => {
              try { return fs.statSync(path.join(sessionsDir, d)).isDirectory(); } catch { return false; }
            });
          } catch { /* ignore */ }
          
          const allSessions = [];
          for (const dir of dirs) {
            const dirPath = path.join(sessionsDir, dir);
            try {
              const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
              for (const file of files) {
                const filePath = path.join(dirPath, file);
                let sessionName = 'Untitled';
                let sessionId = file.replace('.jsonl', '');
                let timestamp = '';
                let cwd = '';
                
                try {
                  const fileContent = fs.readFileSync(filePath, 'utf-8');
                  const lines = fileContent.split('\n').filter(l => l.trim());
                  
                  for (const line of lines) {
                    try {
                      const d = JSON.parse(line);
                      if (d.type === 'session') {
                        sessionId = d.id || sessionId;
                        timestamp = d.timestamp || '';
                        cwd = d.cwd || '';
                      }
                      if (d.type === 'message') {
                        const msg = d.message || {};
                        if (msg.role === 'user') {
                          const c = msg.content;
                          if (Array.isArray(c)) {
                            for (const block of c) {
                              if (block.type === 'text') {
                                sessionName = block.text?.slice(0, 100) || 'Untitled';
                                break;
                              }
                            }
                          } else if (typeof c === 'string') {
                            sessionName = c.slice(0, 100) || 'Untitled';
                          }
                          break; // Got the first user message
                        }
                      }
                    } catch { /* skip unparseable lines */ }
                  }
                } catch { /* skip unreadable files */ }
                
                allSessions.push({
                  path: filePath,
                  id: sessionId,
                  timestamp,
                  name: sessionName,
                  cwd
                });
              }
            } catch { /* skip dir */ }
          }
          
          allSessions.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
          
          console.log('[Server] Sending session_files:', allSessions.length, 'sessions');
          ws.send(JSON.stringify({ type: 'session_files', data: { sessions: allSessions.slice(0, 50) } }));
          console.log('[Server] session_files sent');
        } catch (err) {
          console.error('[Server] Error in get_session_files:', err.message);
          ws.send(JSON.stringify({ type: 'session_files', data: { sessions: [], error: err.message } }));
        }
        console.log('[Server] get_session_files completed');
        break;
      }
      default:
        ws.send(JSON.stringify({ type: 'error', error: `Unknown: ${msg.type}` }));
    }
  } catch (e) {
    ws.send(JSON.stringify({ type: 'error', error: e.message }));
  }
}

async function main() {
  const port = parseInt(process.env.PORT || '3777', 10);
  const pi = new PiRpcManager();
  const harness = createHarnessRuntime(pi.cwd);

  const server = createServer((req, res) => {
    handleHttpRequest(req, res).catch((error) => {
      sendJson(res, 500, { error: error.message });
    });
  });
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    console.log('[Server] Client connected');
    pi.addClient(ws);
    ws.send(JSON.stringify({ type: 'system', event: 'connected' }));
    // Send ready state immediately if available
    pi.sendReadyToClient(ws);

    ws.on('message', async (data) => {
      let msg = null;
      try {
        msg = JSON.parse(data.toString());
        console.log('[Server] Received command:', msg.type);
        await handleCommand(ws, msg, pi, harness);
        console.log('[Server] Command completed:', msg.type);
      }
      catch (e) {
        console.error('[Server] Error handling command:', msg?.type, e.message);
        ws.send(JSON.stringify({ type: 'error', error: e.message }));
      }
    });
    ws.on('close', () => { pi.removeClient(ws); });
    ws.on('error', () => { pi.removeClient(ws); });
  });

  server.listen(port, '0.0.0.0', () => {
    const interfaces = ['localhost', '0.0.0.0'];
    console.log(`[Server] Listening on http://0.0.0.0:${port}`);
    console.log(`[Server] Open http://localhost:${port} locally`);
    console.log(`[Server] Or http://<your-ip>:${port} from another machine`);
    pi.broadcast({ type: 'system', event: 'pi_connecting' });
    pi.start().catch((error) => {
      console.error('[PiRPC] Failed to start:', error.message);
      pi.broadcast({ type: 'system', event: 'pi_error', error: error.message });
    });
  });
}

main().catch(console.error);


// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('[Server] UNCAUGHT EXCEPTION:', err.message, err.stack);
});
