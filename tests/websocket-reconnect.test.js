import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('websocket reconnect loop clears stale sockets and avoids overlapping reconnect timers', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /let reconnectTimer = null;/);
  assert.match(appJs, /if \(ws && \[WebSocket\.OPEN, WebSocket\.CONNECTING\]\.includes\(ws\.readyState\)\) return;/);
  assert.match(appJs, /clearTimeout\(reconnectTimer\)/);
  assert.match(appJs, /reconnectTimer = setTimeout\(connect, 2000\)/);
  assert.match(appJs, /if \(ws === closingSocket\) ws = null;/);
});

test('websocket default URL follows the loaded page host instead of forcing localhost', async () => {
  const appJs = await readFile('public/app.js', 'utf8');

  assert.match(appJs, /serverUrlInput\.value = `ws:\/\/\$\{location\.host\}`;/);
  assert.doesNotMatch(appJs, /serverUrlInput\.value = `ws:\/\/localhost:3777`;/);
});
