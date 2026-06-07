import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { resolvePiCommand } from './resolvePiCommand.js';

export class PiRpcManager {
  constructor({
    initialCwd = process.cwd(),
    spawnImpl = spawn,
    resolvePiCommandImpl = resolvePiCommand,
    readyDelayMs = 2000,
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
  }

  async start() {
    return new Promise((resolve) => {
      console.log('[PiRPC] Starting...');
      this.buffer = '';
      const piCommand = this.resolvePiCommandImpl();
      const child = this.spawnImpl(piCommand.command, [...piCommand.args, '--mode', 'rpc'], {
        cwd: this.cwd,
        env: { ...process.env, FORCE_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.process = child;

      child.stdout.on('data', (chunk) => {
        this.buffer += chunk.toString('utf8');
        this.processOutput();
      });

      child.stderr.on('data', (chunk) => {
        if (chunk.toString().includes('Error')) console.error(chunk.toString().trim());
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
          console.log('[PiRPC] Ready - Model:', resp.data?.model?.name || 'unknown');
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
            pending.resolve(parsed);
          }
        } else {
          this.broadcast(parsed);
        }
      } catch {
        // Ignore non-JSON Pi output.
      }
    }
  }

  sendCommand(cmd) {
    if (!this.process || this.process.exitCode !== null) return Promise.reject(new Error('Pi not running'));
    const id = `cmd-${++this.idCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Timeout'));
      }, 60000);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({ ...cmd, id })}\n`);
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

