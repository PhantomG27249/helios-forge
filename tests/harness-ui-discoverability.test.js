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

test('frontend asset version changes when harness UI changes', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /app\.css\?v=20250613/);
  assert.match(html, /app\.js\?v=20250613/);
});
