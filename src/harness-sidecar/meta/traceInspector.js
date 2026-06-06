import { readFile } from 'fs/promises';
import path from 'path';

export async function inspectTrace({ traceDir }) {
  const eventsPath = path.join(traceDir, 'events.jsonl');
  const raw = await readFile(eventsPath, 'utf8');
  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const recoveryEvents = events.filter((event) => event.type === 'recovery.event');
  const budgetGates = events.filter((event) => event.type === 'budget.gate');

  return {
    traceDir,
    eventCount: events.length,
    recoveryEvents,
    budgetGates,
    failureModes: [...new Set(recoveryEvents.map((event) => event.category))],
  };
}
