import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('harness controls expose deep research and capabilities as first-class toolbar actions', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /id="btn-deep-research"/);
  assert.match(html, /id="btn-capabilities"/);
  assert.match(html, />Deep Research</);
  assert.match(html, />Capabilities</);
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

  assert.match(html, /app\.css\?v=20250615/);
  assert.match(html, /app\.js\?v=20250615/);
});
