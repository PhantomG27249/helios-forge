import { spawn } from 'child_process';
import path from 'path';

const DEFAULT_PORT = 49321;
const MAX_LOG_LINES = 200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HarnessManager {
  constructor({
    workspaceRoot = process.cwd(),
    port = DEFAULT_PORT,
    sidecarEntry = path.resolve('src/harness-sidecar/server.js'),
    command = process.execPath,
    args,
  } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.port = port;
    this.sidecarEntry = path.resolve(sidecarEntry);
    this.command = command;
    this.args = args || [
      this.sidecarEntry,
      '--port',
      String(this.port),
      '--workspace',
      this.workspaceRoot,
    ];
    this.process = null;
    this.state = 'stopped';
    this.logs = [];
    this.restartCount = 0;
  }

  get url() {
    return `http://127.0.0.1:${this.port}`;
  }

  getStatus() {
    return {
      state: this.state,
      pid: this.process?.pid || null,
      port: this.port,
      url: this.url,
      workspaceRoot: this.workspaceRoot,
      restartCount: this.restartCount,
      logs: [...this.logs],
    };
  }

  async start() {
    if (this.process && this.state === 'running') {
      return this.getStatus();
    }

    this.state = 'starting';
    this.process = spawn(this.command, this.args, {
      cwd: this.workspaceRoot,
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout.on('data', (chunk) => this.recordLog(chunk.toString('utf8')));
    this.process.stderr.on('data', (chunk) => this.recordLog(chunk.toString('utf8')));
    this.process.on('close', (code) => {
      this.recordLog(`[HarnessManager] sidecar exited with code ${code}`);
      if (this.state !== 'stopping') {
        this.state = 'stopped';
        this.process = null;
      }
    });
    this.process.on('error', (error) => {
      this.recordLog(`[HarnessManager] sidecar error: ${error.message}`);
      this.state = 'error';
    });

    await this.waitForHealth();
    this.state = 'running';
    return this.getStatus();
  }

  async stop() {
    if (!this.process) {
      this.state = 'stopped';
      return this.getStatus();
    }

    const processToStop = this.process;
    this.state = 'stopping';
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (processToStop.exitCode === null) {
          processToStop.kill('SIGKILL');
        }
        resolve();
      }, 1500);

      processToStop.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      processToStop.kill('SIGTERM');
    });

    if (this.process === processToStop) {
      this.process = null;
    }
    this.state = 'stopped';
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    this.restartCount += 1;
    return this.start();
  }

  recordLog(text) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.logs.push(line);
    }
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    }
  }

  async waitForHealth() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      if (!this.process || this.process.exitCode !== null) {
        throw new Error('Harness sidecar exited before becoming healthy');
      }

      try {
        const response = await fetch(`${this.url}/v1/health`);
        if (response.ok) {
          const body = await response.json();
          if (body.status === 'ok') return;
        }
      } catch {
        // Retry until startup deadline.
      }

      await delay(100);
    }
    throw new Error('Timed out waiting for harness sidecar health');
  }
}
