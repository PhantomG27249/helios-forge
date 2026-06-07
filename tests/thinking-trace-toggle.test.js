import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('thinking traces expose a dedicated dropdown toggle beside the icon', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(appJs, /function toggleThinkingTrace\(button\)/);
  assert.match(appJs, /class="thinking-toggle"/);
  assert.match(appJs, /onclick="toggleThinkingTrace\(this\)"/);
  assert.match(css, /\.thinking-toggle/);
  assert.match(css, /\.thinking-block\.expanded \.thinking-toggle/);
});
