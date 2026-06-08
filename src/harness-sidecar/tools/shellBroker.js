import { spawn } from 'child_process';
import path from 'path';

function isInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function capText(text, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return { text, truncated: false };
  }
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return { text, truncated: false };
  }
  return {
    text: bytes.subarray(0, maxBytes).toString('utf8'),
    truncated: true,
  };
}

export function runShellCommand({
  command,
  cwd = process.cwd(),
  timeoutMs = 60000,
  workspaceRoot,
  maxOutputBytes,
}) {
  const startedAt = Date.now();
  const resolvedCwd = path.resolve(cwd);

  if (workspaceRoot && !isInsideRoot(workspaceRoot, resolvedCwd)) {
    return Promise.resolve({
      command,
      cwd: resolvedCwd,
      exitCode: 1,
      signal: null,
      timedOut: false,
      stdout: '',
      stderr: `Command cwd is outside workspace: ${resolvedCwd}`,
      outputTruncated: false,
      durationMs: Date.now() - startedAt,
    });
  }

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: resolvedCwd,
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
      const cappedStdout = capText(stdout, maxOutputBytes);
      const cappedStderr = capText(stderr || error.message, maxOutputBytes);
      resolve({
        command,
        cwd: resolvedCwd,
        exitCode: 1,
        signal: null,
        timedOut,
        stdout: cappedStdout.text,
        stderr: cappedStderr.text,
        outputTruncated: cappedStdout.truncated || cappedStderr.truncated,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      const cappedStdout = capText(stdout, maxOutputBytes);
      const cappedStderr = capText(stderr, maxOutputBytes);
      resolve({
        command,
        cwd: resolvedCwd,
        exitCode: timedOut && exitCode === null ? 1 : exitCode,
        signal,
        timedOut,
        stdout: cappedStdout.text,
        stderr: cappedStderr.text,
        outputTruncated: cappedStdout.truncated || cappedStderr.truncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
