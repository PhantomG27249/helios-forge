import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  deriveChatTitle,
  enrichSessionRecord,
  formatSessionDisplayName,
  inferParentLinksByTimeline,
  inferSubagentMeta,
  parseSessionFileContent,
  registerPendingParentSession,
  registerSubagentSessionLink,
  repairAllWorkspaceSessionLinks,
  readSessionLinks,
} from '../src/sessionMetadata.js';

test('deriveChatTitle uses the first user sentence for normal prompts', () => {
  assert.equal(deriveChatTitle('Fix the sidebar lag when scrolling long chats.'), 'Fix the sidebar lag when scrolling long chats.');
});

test('inferSubagentMeta extracts role and task from pi-native worker prompts', () => {
  const text = [
    'You are Helios Forge Pi-native swarm worker attempt_1.',
    'Role: implementer',
    'Task: Refactor session sidebar grouping',
  ].join('\n');
  assert.deepEqual(inferSubagentMeta(text), {
    role: 'implementer',
    task: 'Refactor session sidebar grouping',
    attemptId: 'attempt_1',
  });
});

test('formatSessionDisplayName prefers subagent task labels over timestamps', () => {
  const name = formatSessionDisplayName({
    sessionId: 'abc123',
    timestamp: '2026-06-19T17:06:00.000Z',
    rawName: 'You are Helios Forge Pi-native swarm worker attempt_1.\nRole: implementer\nTask: Refactor session sidebar grouping',
    subagent: inferSubagentMeta('You are Helios Forge Pi-native swarm worker attempt_1.\nRole: implementer\nTask: Refactor session sidebar grouping'),
  });
  assert.equal(name, 'Implementer · Refactor session sidebar grouping');
});

test('session link store connects subagent sessions to parent chats', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-session-links-'));
  try {
    registerPendingParentSession(workspaceRoot, 'task_123', '/sessions/parent.jsonl');
    registerSubagentSessionLink({
      workspaceRoot,
      sessionPath: '/sessions/child.jsonl',
      taskId: 'task_123',
      attemptId: 'attempt_1',
      role: 'implementer',
    });

    const store = readSessionLinks(workspaceRoot);
    assert.equal(store.links.length, 1);
    assert.equal(store.links[0].parentSessionPath, '/sessions/parent.jsonl');
    assert.equal(store.links[0].sessionPath, '/sessions/child.jsonl');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('inferParentLinksByTimeline groups subagents under the preceding parent chat', () => {
  const sessions = [
    { path: '/parent.jsonl', cwd: '/repo', timestamp: '2026-06-19T10:00:00.000Z', isSubagent: false },
    { path: '/child-a.jsonl', cwd: '/repo', timestamp: '2026-06-19T10:01:00.000Z', isSubagent: true, subagent: { role: 'implementer', attemptId: 'a' } },
    { path: '/child-b.jsonl', cwd: '/repo', timestamp: '2026-06-19T10:02:00.000Z', isSubagent: true, subagent: { role: 'reviewer', attemptId: 'b' } },
    { path: '/parent-2.jsonl', cwd: '/repo', timestamp: '2026-06-19T11:00:00.000Z', isSubagent: false },
    { path: '/child-c.jsonl', cwd: '/repo', timestamp: '2026-06-19T11:01:00.000Z', isSubagent: true, subagent: { role: 'implementer', attemptId: 'c' } },
  ];

  const links = inferParentLinksByTimeline(sessions);
  assert.equal(links.length, 3);
  assert.equal(links.find((link) => link.sessionPath.endsWith('child-a.jsonl'))?.parentSessionPath, '/parent.jsonl');
  assert.equal(links.find((link) => link.sessionPath.endsWith('child-b.jsonl'))?.parentSessionPath, '/parent.jsonl');
  assert.equal(links.find((link) => link.sessionPath.endsWith('child-c.jsonl'))?.parentSessionPath, '/parent-2.jsonl');
});

test('repairAllWorkspaceSessionLinks persists inferred links for existing workspaces', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helios-session-repair-'));
  try {
    const sessions = [
      { path: '/parent.jsonl', cwd: workspaceRoot, timestamp: '2026-06-19T10:00:00.000Z', isSubagent: false },
      { path: '/child.jsonl', cwd: workspaceRoot, timestamp: '2026-06-19T10:01:00.000Z', isSubagent: true, subagent: { role: 'implementer', attemptId: 'attempt_1' } },
    ];
    const summary = repairAllWorkspaceSessionLinks(sessions);
    assert.equal(summary.added, 1);

    const store = readSessionLinks(workspaceRoot);
    assert.equal(store.links.length, 1);
    assert.equal(store.links[0].parentSessionPath, '/parent.jsonl');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('enrichSessionRecord nests subagents under linked parent sessions', () => {
  const candidates = [
    { path: '/parent.jsonl', cwd: '/repo', timestamp: '2026-06-19T10:00:00.000Z', isSubagent: false },
    { path: '/child.jsonl', cwd: '/repo', timestamp: '2026-06-19T10:05:00.000Z', isSubagent: true },
  ];
  const linkIndex = new Map([
    ['/child.jsonl', { parentSessionPath: '/parent.jsonl' }],
  ]);
  const enriched = enrichSessionRecord(candidates[1], linkIndex, candidates);
  assert.equal(enriched.parentSessionPath, '/parent.jsonl');
});

test('parseSessionFileContent reads first user message from jsonl', () => {
  const parsed = parseSessionFileContent([
    '{"type":"session","id":"sess1","timestamp":"2026-06-19T10:00:00.000Z","cwd":"/repo"}',
    '{"type":"message","message":{"role":"user","content":[{"type":"text","text":"Ship nested session sidebar"}]}}',
  ].join('\n'));
  assert.equal(parsed.firstUserText, 'Ship nested session sidebar');
  assert.equal(parsed.isSubagent, false);
});
