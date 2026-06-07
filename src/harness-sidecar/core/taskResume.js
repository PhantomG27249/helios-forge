import { readFile } from 'fs/promises';
import path from 'path';

import { compactTraceEvents } from './traceCompactor.js';

function parseJsonl(raw) {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function pendingApprovalsFrom(events) {
  const approvals = new Map();

  for (const event of events) {
    if (event.type === 'approval.required') {
      approvals.set(event.actionId, {
        actionId: event.actionId,
        taskId: event.taskId,
        status: event.status || 'pending',
        reason: event.reason,
        risk: event.risk,
        choices: event.choices,
      });
    }

    if (event.type === 'approval.resolved') {
      approvals.delete(event.actionId);
    }
  }

  return [...approvals.values()].filter((approval) => approval.status !== 'resolved');
}

export async function resumeTaskFromTrace({ traceDir, eventsPath = path.join(traceDir, 'events.jsonl') }) {
  const raw = await readFile(eventsPath, 'utf8');
  const events = parseJsonl(raw);
  const compacted = compactTraceEvents(events);
  const pendingApprovals = pendingApprovalsFrom(events);
  const status = pendingApprovals.length
    ? 'approval_required'
    : compacted.latestState.status || 'resumable';

  return {
    taskId: compacted.taskId,
    traceDir,
    status,
    task: compacted.task,
    state: compacted.latestState,
    pendingApprovals,
    artifacts: compacted.artifacts,
    failures: compacted.failures,
    decisions: compacted.decisions,
    eventCount: compacted.eventCount,
    countsByType: compacted.countsByType,
  };
}
