import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('harness controls expose deep research and capabilities as first-class toolbar actions', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /id="btn-deep-research" class="topbar-icon-btn" title="Deep Research" aria-label="Open Deep Research"/);
  assert.match(html, /id="btn-capabilities" class="topbar-icon-btn" title="Capabilities" aria-label="Add Skills and MCPs"/);
  assert.doesNotMatch(html, /topbar-text-btn/);
});

test('harness controls expose trace replay as a compact toolbar and tab surface', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');
  const serverJs = await readFile('src/server.js', 'utf8');

  assert.match(html, /id="btn-traces" class="topbar-icon-btn" title="Traces" aria-label="Open Traces and Replay"/);
  assert.match(html, /data-harness-tab="traces"/);
  assert.match(html, /id="harness-trace-list"/);
  assert.match(html, /id="harness-trace-events"/);
  assert.match(html, /id="btn-harness-replay-next"/);
  assert.match(appJs, /harness_traces_get/);
  assert.match(appJs, /harness_trace_get/);
  assert.match(appJs, /harness_trace_replay_prepare/);
  assert.match(serverJs, /case 'harness_traces_get'/);
  assert.match(serverJs, /case 'harness_trace_get'/);
  assert.match(serverJs, /case 'harness_trace_replay_prepare'/);
});

test('browser harness prompt routing recognizes installed slash commands safely', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.equal(appJs.includes('/^\\/(?:harness|research|deep-research|forge)\\b/i'), true);
  assert.equal(appJs.includes("replace(/^\\/(?:harness|research|deep-research|forge)\\b[\\s:;-]*/i"), true);
  assert.equal(appJs.includes("harnessOnlyCommand = harnessRoute?.mode === 'direct' && /^\\/(?:harness|research|deep-research|forge)\\b/i.test(text)"), true);
  assert.equal(appJs.includes('function escAttr'), true);
  assert.equal(appJs.includes('data-task-id="${escAttr(trace.taskId)}"'), true);
});

test('capabilities UI exposes package templates and slash commands', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="capability-list-template"/);
  assert.match(html, /id="capability-list-slash_command"/);
  assert.match(html, /<option value="template">Template<\/option>/);
  assert.match(html, /<option value="slash_command">Slash Command<\/option>/);
  assert.match(appJs, /id: 'template'/);
  assert.match(appJs, /id: 'slash_command'/);
});

test('harness panel exposes live subagent activity', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(html, /id="harness-subagents"/);
  assert.match(appJs, /swarm\.subagent_started/);
  assert.match(appJs, /swarm\.subagent_completed/);
  assert.match(appJs, /renderHarnessSubagents/);
});

test('frontend asset version changes when harness UI changes', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /app\.css\?v=20250618/);
  assert.match(html, /app\.js\?v=20250618/);
});
