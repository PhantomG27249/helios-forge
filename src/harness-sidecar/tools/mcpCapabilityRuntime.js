import path from 'node:path';

import { McpRuntimeRegistry } from './mcpRuntime.js';

const URL_TRANSPORTS = new Set(['sse', 'http']);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeTransport(record) {
  const transport = normalizeString(record.transport).toLowerCase();
  if (transport) return transport;
  if (normalizeString(record.command)) return 'stdio';
  if (normalizeString(record.url)) return 'http';
  return null;
}

function normalizeArgs(args) {
  if (Array.isArray(args)) return args.filter((arg) => arg !== undefined && arg !== null);
  if (args === undefined || args === null || args === '') return [];
  return [args];
}

function resolveCwd({ cwd, workspaceRoot }) {
  if (!cwd) return undefined;
  if (path.isAbsolute(cwd)) return path.resolve(cwd);
  return path.resolve(workspaceRoot, cwd);
}

async function emitSafe(emitEvent, payload) {
  if (typeof emitEvent === 'function') {
    await emitEvent(payload);
  }
}

function buildServerConfig({ record, workspaceRoot }) {
  const id = normalizeString(record.id || record.capabilityId);
  const transport = normalizeTransport(record);
  if (!id) {
    return {
      status: {
        id: null,
        transport,
        status: 'skipped',
        reason: 'missing_id',
      },
    };
  }

  const base = {
    id,
    name: normalizeString(record.name) || id,
    transport,
  };

  if (transport === 'stdio') {
    const command = normalizeString(record.command);
    if (!command) {
      return {
        status: {
          id,
          transport,
          status: 'skipped',
          reason: 'missing_command',
        },
      };
    }

    const config = {
      ...base,
      command,
      args: normalizeArgs(record.args),
      env: record.env && typeof record.env === 'object' ? { ...record.env } : {},
    };
    const cwd = resolveCwd({ cwd: record.cwd, workspaceRoot });
    if (cwd) config.cwd = cwd;
    return { config };
  }

  if (URL_TRANSPORTS.has(transport)) {
    const url = normalizeString(record.url);
    if (!url) {
      return {
        status: {
          id,
          transport,
          status: 'skipped',
          reason: 'missing_url',
        },
      };
    }
    return {
      config: {
        ...base,
        url,
      },
    };
  }

  return {
    status: {
      id,
      transport,
      status: 'skipped',
      reason: 'missing_startup_config',
    },
  };
}

async function startRuntimeServer({ runtime, id, config }) {
  if (typeof runtime.startServer === 'function') {
    return runtime.startServer(id, config);
  }
  if (runtime.servers instanceof Map) {
    runtime.servers.set(id, { ...config });
  }
  if (typeof runtime.start === 'function') {
    return runtime.start(id);
  }
  throw new Error('MCP runtime does not support starting servers');
}

export async function startMcpRuntimesFromCapabilities({
  records = [],
  workspaceRoot,
  runtime,
  transportFactory,
  emitEvent = () => {},
} = {}) {
  const mcpRecords = records.filter((record) => record?.enabled === true && record?.type === 'mcp');
  const prepared = mcpRecords.map((record) => buildServerConfig({ record, workspaceRoot }));
  const serverConfigs = prepared.map((entry) => entry.config).filter(Boolean);
  const activeRuntime = runtime || (
    typeof transportFactory === 'function'
      ? new McpRuntimeRegistry({ servers: serverConfigs, transportFactory })
      : undefined
  );
  const started = [];
  const skipped = [];

  for (const entry of prepared) {
    if (!entry.config) {
      skipped.push(entry.status);
      await emitSafe(emitEvent, {
        type: 'mcp.capability_runtime.unavailable',
        ...entry.status,
      });
      continue;
    }

    const { id, transport } = entry.config;
    if (!activeRuntime) {
      const status = {
        id,
        transport,
        status: 'skipped',
        reason: 'missing_runtime',
      };
      skipped.push(status);
      await emitSafe(emitEvent, {
        type: 'mcp.capability_runtime.unavailable',
        ...status,
      });
      continue;
    }

    try {
      await startRuntimeServer({ runtime: activeRuntime, id, config: entry.config });
      const status = {
        id,
        transport,
        status: 'started',
      };
      started.push(status);
      await emitSafe(emitEvent, {
        type: 'mcp.capability_runtime.started',
        ...status,
      });
    } catch (error) {
      const status = {
        id,
        transport,
        status: 'skipped',
        reason: error.message || 'startup_failed',
      };
      skipped.push(status);
      await emitSafe(emitEvent, {
        type: 'mcp.capability_runtime.unavailable',
        ...status,
      });
    }
  }

  return {
    started,
    skipped,
    runtime: activeRuntime,
  };
}
