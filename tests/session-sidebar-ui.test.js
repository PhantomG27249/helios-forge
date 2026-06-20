import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('session sidebar nests subagent chats and derives titles from prompts', async () => {
  const appJs = await readFile('public/app.js', 'utf8');
  const css = await readFile('public/app.css', 'utf8');

  assert.match(appJs, /function buildSessionTree\(/);
  assert.match(appJs, /function deriveChatTitle\(/);
  assert.match(appJs, /function applyChatTitleFromPrompt\(/);
  assert.match(appJs, /session-children-toggle/);
  assert.match(appJs, /parentSessionPath/);
  assert.match(appJs, /STORAGE_SESSION_TITLES/);

  assert.match(css, /\.session-children/);
  assert.match(css, /\.session-item-subagent/);
});
