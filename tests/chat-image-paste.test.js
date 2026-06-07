import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('chat input supports pasted clipboard images through the existing preview flow', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /function handlePasteImages/);
  assert.match(appJs, /clipboardData/);
  assert.match(appJs, /addEventListener\('paste', handlePasteImages\)/);
  assert.match(appJs, /handleFileSelect\(imageFiles/);
});

test('frontend asset version changes when paste support changes', async () => {
  const html = await readFile('public/index.html', 'utf8');

  assert.match(html, /app\.css\?v=20250618/);
  assert.match(html, /app\.js\?v=20250618/);
});
