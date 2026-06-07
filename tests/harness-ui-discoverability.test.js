import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('harness controls expose deep research and capabilities as first-class toolbar actions', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /id="btn-deep-research" class="topbar-icon-btn" title="Deep Research" aria-label="Open Deep Research"/);
  assert.match(html, /id="btn-capabilities" class="topbar-icon-btn" title="Capabilities" aria-label="Add Skills and MCPs"/);
  assert.doesNotMatch(html, /topbar-text-btn/);
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

  assert.match(html, /app\.css\?v=20250617/);
  assert.match(html, /app\.js\?v=20250617/);
});
