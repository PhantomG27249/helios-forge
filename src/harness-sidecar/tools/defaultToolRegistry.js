import { ToolRegistry } from './toolRegistry.js';
import { runShellCommand } from './shellBroker.js';
import { loadVerifierRegistry } from './verifierRegistry.js';
import { runVerifiers } from './verifierRunner.js';
import { selectVerifiersForTask } from './verifierSelector.js';

function mcpRuntimeRequired() {
  throw new Error('mcpRuntime is required for mcp.call');
}

export function createDefaultToolRegistry({
  workspaceRoot,
  emitEvent = () => {},
  mcpRuntime,
  maxOutputBytes = 64 * 1024,
} = {}) {
  if (!workspaceRoot) {
    throw new Error('workspaceRoot is required');
  }

  const registry = new ToolRegistry();
  registry.register({
    name: 'shell.run',
    description: 'Run a scoped shell command inside the workspace.',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
        timeoutMs: { type: 'number' },
      },
      required: ['command'],
    },
    execute: async ({ command, cwd, timeoutMs } = {}) => runShellCommand({
      command,
      cwd: cwd || workspaceRoot,
      workspaceRoot,
      timeoutMs,
      maxOutputBytes,
    }),
  });

  registry.register({
    name: 'verifier.run',
    description: 'Run one or more scoped verifier commands inside the workspace.',
    risk: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        verifiers: { type: 'array' },
        changedFiles: { type: 'array' },
        recentFailures: { type: 'array' },
        maxVerifiers: { type: 'number' },
      },
    },
    execute: async ({
      taskId,
      task,
      verifiers,
      changedFiles = [],
      recentFailures = [],
      maxVerifiers,
    } = {}) => {
      let selectedVerifiers = Array.isArray(verifiers) ? verifiers : null;
      if (!selectedVerifiers) {
        const verifierRegistry = await loadVerifierRegistry({ workspaceRoot });
        await emitEvent({
          type: 'verifier.registry_loaded',
          taskId,
          verifierCount: verifierRegistry.verifiers.length,
          verifierNames: verifierRegistry.verifiers.map((verifier) => verifier.name),
        });
        selectedVerifiers = selectVerifiersForTask({
          task,
          changedFiles,
          registry: verifierRegistry,
          recentFailures,
          maxVerifiers,
        });
        await emitEvent({
          type: 'verifier.selection_created',
          taskId,
          selection: selectedVerifiers.map((verifier) => ({
            name: verifier.name,
            kind: verifier.kind,
            reason: verifier.reason,
          })),
        });
      }

      return {
        selection: selectedVerifiers.map((verifier) => ({
          name: verifier.name,
          command: verifier.command,
          kind: verifier.kind,
          reason: verifier.reason,
        })),
        results: await runVerifiers({
        workspaceRoot,
        taskId,
        verifiers: selectedVerifiers,
        emitEvent,
        maxOutputBytes,
        }),
      };
    },
  });

  registry.register({
    name: 'mcp.call',
    description: 'Call a tool on a running MCP server through policy-gated runtime.',
    risk: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string' },
        tool: { type: 'string' },
        args: { type: 'object' },
      },
      required: ['serverId', 'tool'],
    },
    execute: async ({ serverId, tool, args = {}, options = {} } = {}) => {
      const runtime = mcpRuntime || { callTool: mcpRuntimeRequired };
      return runtime.callTool(serverId, tool, args, options);
    },
  });

  return registry;
}
