import { readdir, readFile } from 'fs/promises';
import path from 'path';

import { compactTraceEvents } from './traceCompactor.js';

function traceRootFor(workspaceRoot) {
  return path.join(workspaceRoot, '.harness', 'traces');
}

function normalizeTaskId(taskId) {
  const normalized = String(taskId || '').trim();
  if (
    !normalized
    || normalized.includes('\0')
    || normalized.includes('/')
    || normalized.includes('\\')
    || normalized.includes('..')
  ) {
    throw new Error(`Unsafe trace task id: ${taskId}`);
  }
  return normalized;
}

function eventsPathFor({ workspaceRoot, taskId }) {
  const traceRoot = path.resolve(traceRootFor(workspaceRoot));
  const safeTaskId = normalizeTaskId(taskId);
  const eventsPath = path.resolve(traceRoot, safeTaskId, 'events.jsonl');
  const relative = path.relative(traceRoot, eventsPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe trace task id: ${taskId}`);
  }
  return eventsPath;
}

function parseJsonl(raw) {
  const events = [];
  const parseErrors = [];
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (!line.trim()) {
      return;
    }

    try {
      events.push(JSON.parse(line));
    } catch (error) {
      parseErrors.push({
        lineNumber: index + 1,
        line,
        message: error.message,
      });
    }
  });

  return { events, parseErrors };
}

async function readTraceFile(eventsPath) {
  try {
    return parseJsonl(await readFile(eventsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        events: [],
        parseErrors: [],
      };
    }
    throw error;
  }
}

function timestampOf(event) {
  return typeof event?.timestamp === 'string' ? event.timestamp : null;
}

function latestTaskEventFrom(events) {
  const latest = [...events]
    .reverse()
    .find((event) => typeof event?.type === 'string' && (event.type.startsWith('task.') || event.status));

  if (!latest) {
    return null;
  }

  return {
    type: latest.type,
    status: latest.status,
    timestamp: latest.timestamp,
  };
}

function traceSortValue(trace) {
  return trace.lastTimestamp || trace.firstTimestamp || '';
}

export async function readTrace({ workspaceRoot, taskId }) {
  const safeTaskId = normalizeTaskId(taskId);
  const traceDir = path.join(traceRootFor(workspaceRoot), safeTaskId);
  const eventsPath = eventsPathFor({ workspaceRoot, taskId });
  const { events, parseErrors } = await readTraceFile(eventsPath);
  const summary = compactTraceEvents(events);

  return {
    taskId: safeTaskId,
    traceDir,
    eventsPath,
    events,
    summary,
    parseErrors,
  };
}

export async function listTraces({ workspaceRoot }) {
  let entries;
  try {
    entries = await readdir(traceRootFor(workspaceRoot), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const traces = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const trace = await readTrace({ workspaceRoot, taskId: entry.name });
    const timestamps = trace.events.map(timestampOf).filter(Boolean);
    traces.push({
      taskId: entry.name,
      eventCount: trace.events.length,
      firstTimestamp: timestamps[0] || null,
      lastTimestamp: timestamps.at(-1) || null,
      latestTaskEvent: latestTaskEventFrom(trace.events),
      summary: trace.summary,
      parseErrors: trace.parseErrors,
    });
  }

  return traces.sort((left, right) => traceSortValue(right).localeCompare(traceSortValue(left)));
}

export async function replayTrace({ workspaceRoot, taskId, cursor = 0, limit = 100 }) {
  const trace = await readTrace({ workspaceRoot, taskId });
  const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.floor(cursor)) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 100;
  const events = trace.events.slice(safeCursor, safeCursor + safeLimit);
  const nextCursor = safeCursor + events.length;

  return {
    events,
    nextCursor,
    done: nextCursor >= trace.events.length,
  };
}
