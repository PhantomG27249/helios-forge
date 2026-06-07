import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('welcome empty state is rendered idempotently during startup handshakes', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /function showWelcome\(\) \{\s*messagesEl\.querySelector\('\.welcome'\)\?\.remove\(\);/);
  assert.match(appJs, /if \(!messagesEl\.children\.length\) showWelcome\(\);/);
});
