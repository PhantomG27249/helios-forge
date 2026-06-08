import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createDefaultToolRegistry } from '../src/harness-sidecar/tools/defaultToolRegistry.js';
import { evaluateFinalValidation } from '../src/harness-sidecar/tools/finalValidator.js';
import { createPatchProposal, validatePatchProposal } from '../src/harness-sidecar/tools/patchManager.js';
import { runShellCommand } from '../src/harness-sidecar/tools/shellBroker.js';
import { runVerifiers } from '../src/harness-sidecar/tools/verifierRunner.js';

const nodeCommand = `"${process.execPath}"`;

test('shell broker captures stdout, stderr, exit code, and duration', async () => {
  const result = await runShellCommand({
    command: `${nodeCommand} -e "console.log('ok'); console.error('warn')"`,
    cwd: process.cwd(),
    timeoutMs: 2000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.match(result.stdout, /ok/);
  assert.match(result.stderr, /warn/);
  assert.equal(typeof result.durationMs, 'number');
});

test('shell broker marks commands that exceed timeout', async () => {
  const result = await runShellCommand({
    command: `${nodeCommand} -e "setTimeout(() => {}, 2000)"`,
    cwd: process.cwd(),
    timeoutMs: 100,
  });

  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test('shell broker enforces workspace cwd and caps output', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-shell-policy-'));
  try {
    const outside = await runShellCommand({
      command: `${nodeCommand} -e "console.log('outside')"`,
      cwd: tmpdir(),
      workspaceRoot,
      timeoutMs: 2000,
    });
    assert.equal(outside.exitCode, 1);
    assert.match(outside.stderr, /outside workspace/i);

    const capped = await runShellCommand({
      command: `${nodeCommand} -e "console.log('abcdefghijklmnopqrstuvwxyz')"`,
      cwd: workspaceRoot,
      workspaceRoot,
      timeoutMs: 2000,
      maxOutputBytes: 12,
    });
    assert.equal(capped.exitCode, 0);
    assert.equal(capped.stdout.length <= 12, true);
    assert.equal(capped.outputTruncated, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('default tool registry executes shell, verifier, and MCP tools through scoped adapters', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-default-tools-'));
  const mcpCalls = [];
  try {
    const registry = createDefaultToolRegistry({
      workspaceRoot,
      mcpRuntime: {
        async callTool(serverId, tool, args) {
          mcpCalls.push({ serverId, tool, args });
          return { status: 'completed', content: [{ type: 'text', text: 'mcp-ok' }] };
        },
      },
    });
    const tools = registry.list().map((tool) => tool.name).sort();

    assert.deepEqual(tools, ['mcp.call', 'shell.run', 'verifier.run']);

    const shell = await registry.execute('shell.run', {
      command: `${nodeCommand} -e "console.log('shell-ok')"`,
      cwd: workspaceRoot,
      timeoutMs: 2000,
    });
    assert.equal(shell.exitCode, 0);
    assert.match(shell.stdout, /shell-ok/);

    const verifier = await registry.execute('verifier.run', {
      taskId: 'task_default_tools',
      verifiers: [{ name: 'node-ok', command: `${nodeCommand} -e "console.log('verified')"`, timeoutMs: 2000 }],
    });
    assert.equal(verifier.results[0].passed, true);

    const mcp = await registry.execute('mcp.call', {
      serverId: 'demo',
      tool: 'demo.echo',
      args: { text: 'hello' },
    });
    assert.equal(mcp.status, 'completed');
    assert.deepEqual(mcpCalls, [{ serverId: 'demo', tool: 'demo.echo', args: { text: 'hello' } }]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('verifier runner emits start, output, and finish events', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-verifier-test-'));
  const events = [];

  try {
    const results = await runVerifiers({
      workspaceRoot,
      taskId: 'task_test',
      verifiers: [
        {
          name: 'node-ok',
          command: `${nodeCommand} -e "console.log('verified')"`,
          timeoutMs: 2000,
        },
      ],
      emitEvent: (event) => events.push(event),
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'node-ok');
    assert.equal(results[0].passed, true);
    assert.equal(events.some((event) => event.type === 'verifier.started'), true);
    assert.equal(events.some((event) => event.type === 'verifier.output' && /verified/.test(event.stdout)), true);
    assert.equal(events.some((event) => event.type === 'verifier.finished' && event.result === 'passed'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('patch manager creates approval-ready patch proposals and rejects unsafe paths', () => {
  const proposal = createPatchProposal({
    taskId: 'task_patch',
    intent: 'Fix failing test',
    files: [{ path: 'src/app.js', status: 'modified', diff: 'diff --git a/src/app.js b/src/app.js\n' }],
    validationPlan: ['npm test'],
    createdBy: 'agent_a',
  });

  assert.match(proposal.patchId, /^patch_/);
  assert.equal(validatePatchProposal(proposal).valid, true);

  const unsafe = createPatchProposal({
    taskId: 'task_patch',
    intent: 'Unsafe edit',
    files: [{ path: 'C:/Users/jackj/secret.txt', status: 'modified', diff: '' }],
    validationPlan: [],
  });
  assert.equal(validatePatchProposal(unsafe).valid, false);
});

test('final validator requires passing verifiers artifacts and approval', () => {
  const passed = evaluateFinalValidation({
    verifierResults: [{ name: 'unit', passed: true }],
    requiredArtifacts: [{ type: 'patch_manifest' }],
    approvals: [{ choice: 'approve' }],
  });
  const failed = evaluateFinalValidation({
    verifierResults: [{ name: 'unit', passed: false }],
    requiredArtifacts: [],
    approvals: [],
  });

  assert.equal(passed.passed, true);
  assert.equal(failed.passed, false);
  assert.equal(failed.reasons.includes('verifier_failed'), true);
  assert.equal(failed.reasons.includes('missing_approval'), true);
});
