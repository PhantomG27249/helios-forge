import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('chat UI avoids full-history re-render during streaming', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(appJs, /function ensureStreamShell\(/);
  assert.match(appJs, /textEl\.textContent = activeStream\.text/);
  assert.doesNotMatch(appJs, /savedThinkingBlocks/);
  assert.match(appJs, /function highlightCode\(root = document\)/);
  assert.match(appJs, /scope\.querySelectorAll\('pre code'\)/);
  assert.match(appJs, /WS_DEBUG_SKIP/);
  assert.match(appJs, /function scheduleScroll\(/);

  assert.match(css, /content-visibility:\s*auto/);
  assert.match(css, /contain-intrinsic-size/);
});
