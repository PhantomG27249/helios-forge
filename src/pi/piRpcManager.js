import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { resolvePiCommand } from './resolvePiCommand.js';
import { normalizePromptImages } from './normalizePromptImages.js';

export class PiRpcManager {
  constructor({
    initialCwd = process.cwd(),
    spawnImpl = spawn,
    resolvePiCommandImpl = resolvePiCommand,
    readyDelayMs = 2000,
    commandTimeoutMs = 60000,
    logger = console,
  } = {}) {
    this.process = null;
    this.cwd = initialCwd;
    this.buffer = '';
    this.pending = new Map();
    this.idCounter = 0;
    this.clients = new Set();
    this.readyData = null;
    this._restarting = false;
    this.spawnImpl = spawnImpl;
    this.resolvePiCommandImpl = resolvePiCommandImpl;
    this.readyDelayMs = readyDelayMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.logger = logger;
    this.scopedEnv = {};
  }

  log(level, message, data = {}) {
    const sink = typeof this.logger?.[level] === 'function' ? this.logger[level] : this.logger?.log;
    if (!sink) return;
    sink.call(this.logger, message, JSON.stringify(data));
  }

  commandSummary(cmd = {}, id) {
    return {
      id,
      type: cmd.type || 'unknown',
      cwd: this.cwd,
      messageLength: typeof cmd.message === 'string' ? cmd.message.length : 0,
      imageCount: Array.isArray(cmd.images) ? cmd.images.length : 0,
      streamingBehavior: cmd.streamingBehavior || null,
      sessionPath: cmd.sessionPath || null,
      modelId: cmd.modelId || null,
    };
  }

  pendingSummary() {
    return {
      pendingCount: this.pending.size,
      pending: [...this.pending.values()].map((entry) => ({
        id: entry.id,
        type: entry.type,
        ageMs: Date.now() - entry.startedAt,
      })),
    };
  }

  async start() {
    return new Promise((resolve) => {
      this.log('info', '[PiRPC] Starting...', { cwd: this.cwd });
      this.buffer = '';
      const piCommand = this.resolvePiCommandImpl();
      const child = this.spawnImpl(piCommand.command, [...piCommand.args, '--mode', 'rpc'], {
        cwd: this.cwd,
        env: { ...process.env, ...this.scopedEnv, FORCE_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = child;

      child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        this.processOutput();
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (text) this.log(text.includes('Error') ? 'error' : 'warn', '[PiRPC] stderr', { text });
      });

      child.on('close', (code) => {
        if (this.process === child) this.process = null;
        this.clearPending(new Error('Pi process stopped'));
        if (this._restarting) {
          this._restarting = false;
          return;
        }
        this.readyData = null;
        this.broadcast({ type: 'system', event: 'pi_disconnected', code });
        setTimeout(() => this.start(), 3000);
      });

      child.on('error', (err) => {
        this.log('error', '[PiRPC] process.error', { error: err.message });
        this.broadcast({ type: 'system', event: 'pi_error', error: err.message });
      });

      setTimeout(() => this.checkReady(resolve), this.readyDelayMs);
    });
  }

  async changeWorkspace(newCwd) {
    const nextCwd = newCwd || process.cwd();
    if (nextCwd === this.cwd) return false;

    this.cwd = nextCwd;
    this.readyData = null;
    this.broadcast({ type: 'system', event: 'pi_restarting', cwd: this.cwd });

    if (this.process && this.process.exitCode === null) {
      await this.stopForRestart();
    }
    await this.start();
    return true;
  }

  setCapabilitiesManifest(manifestPath) {
    if (manifestPath) {
      this.scopedEnv.HELIOS_CAPABILITIES_MANIFEST = manifestPath;
    } else {
      delete this.scopedEnv.HELIOS_CAPABILITIES_MANIFEST;
    }
  }

  setBridgeContextPath(contextPath) {
    if (contextPath) {
      this.scopedEnv.HELIOS_BRIDGE_CONTEXT_JSON = contextPath;
    } else {
      delete this.scopedEnv.HELIOS_BRIDGE_CONTEXT_JSON;
    }
  }

  async stopForRestart() {
    const child = this.process;
    if (!child || child.exitCode !== null) return;
    this._restarting = true;
    this.clearPending(new Error('Pi process restarting'));
    child.kill('SIGTERM');
    await once(child, 'close');
  }

  clearPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  checkReady(resolve) {
    if (!this.process || this.process.exitCode !== null) return;
    this.sendCommand({ type: 'get_state' })
      .then((resp) => {
        if (resp.success) {
          this.readyData = resp.data;
          this.log('info', '[PiRPC] Ready', { model: resp.data?.model?.name || resp.data?.model?.id || 'unknown' });
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
          if (pending) {
            clearTimeout(pending.timeout);
            this.pending.delete(parsed.id);
            this.log('info', '[PiRPC] command.response', {
              id: parsed.id,
              type: pending.type,
              success: parsed.success !== false,
              durationMs: Date.now() - pending.startedAt,
              pendingCount: this.pending.size,
            });
            pending.resolve(parsed);
          } else {
            this.log('warn', '[PiRPC] command.unmatched_response', { id: parsed.id });
          }
        } else {
          this.log('info', '[PiRPC] event', { type: parsed.type || 'unknown' });
          this.broadcast(parsed);
        }
      } catch {
        this.log('warn', '[PiRPC] non_json_output', { line: line.slice(0, 500) });
      }
    }
  }

  sendCommand(cmd) {
    if (!this.process || this.process.exitCode !== null) return Promise.reject(new Error('Pi not running'));
    const payload = { ...cmd };
    if (Array.isArray(payload.images)) {
      payload.images = normalizePromptImages(payload.images);
    }
    const id = `cmd-${++this.idCounter}`;
    const summary = this.commandSummary(payload, id);
    this.log('info', '[PiRPC] command.start', summary);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.log('warn', '[PiRPC] command.timeout', {
          ...summary,
          durationMs: Date.now() - startedAt,
          ...this.pendingSummary(),
        });
        reject(new Error('Timeout'));
      }, this.commandTimeoutMs);
      const startedAt = Date.now();
      this.pending.set(id, { id, type: summary.type, resolve, reject, timeout, startedAt });
      this.process.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });
  }

  addClient(ws) { this.clients.add(ws); }
  removeClient(ws) { this.clients.delete(ws); }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        try { client.send(data); } catch { this.clients.delete(client); }
      }
    }
  }

  sendReadyToClient(ws) {
    if (this.readyData && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'system', event: 'pi_ready', data: this.readyData }));
    }
  }
}
