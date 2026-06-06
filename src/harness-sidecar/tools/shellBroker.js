import { spawn } from 'child_process';

export function runShellCommand({ command, cwd = process.cwd(), timeoutMs = 60000 }) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 250);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        cwd,
        exitCode: 1,
        signal: null,
        timedOut,
        stdout,
        stderr: stderr || error.message,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({
        command,
        cwd,
        exitCode: timedOut && exitCode === null ? 1 : exitCode,
        signal,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
