import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  assertBrowserUrlAllowed,
  createBrowserPolicy,
  sanitizeNetworkRecord,
  sanitizeUrlForBrowserTrace,
} from '../src/harness-sidecar/browser/browserPolicy.js';
import {
  browserTaskDir,
  resolveBrowserArtifactPath,
  summarizeBrowserArtifact,
} from '../src/harness-sidecar/browser/browserArtifacts.js';

async function withWorkspace(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-browser-policy-'));
  try {
    await testFn({ workspaceRoot });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('browser policy allows localhost and loopback URLs by default', () => {
  const policy = createBrowserPolicy();

  assert.doesNotThrow(() => assertBrowserUrlAllowed({ url: 'http://127.0.0.1:3000', policy }));
  assert.doesNotThrow(() => assertBrowserUrlAllowed({ url: 'http://localhost:5173', policy }));
  assert.doesNotThrow(() => assertBrowserUrlAllowed({ url: 'http://[::1]:8080', policy }));
});

test('browser policy denies external, private LAN, unsafe, and malformed URLs', () => {
  const policy = createBrowserPolicy();

  for (const url of [
    'https://example.com',
    'file:///C:/secret/index.html',
    'data:text/html,hello',
    'javascript:alert(1)',
    'http://192.168.1.5',
    'http://10.0.0.2',
    'http://172.16.0.3',
    'http://172.31.255.255',
    'not a url',
  ]) {
    assert.throws(
      () => assertBrowserUrlAllowed({ url, policy, reason: 'test' }),
      /browser url denied/i,
      url,
    );
  }
});

test('browser policy allows configured external origins only', () => {
  const policy = createBrowserPolicy({ allowedOrigins: ['https://example.com'] });

  assert.doesNotThrow(() => assertBrowserUrlAllowed({ url: 'https://example.com/docs?q=secret', policy }));
  assert.throws(
    () => assertBrowserUrlAllowed({ url: 'https://api.example.com/docs', policy }),
    /browser url denied/i,
  );
});

test('browser trace URL sanitization removes credentials, query strings, and hashes', () => {
  assert.equal(
    sanitizeUrlForBrowserTrace('http://user:pass@127.0.0.1:3777/path/to/page?token=secret#section'),
    'http://127.0.0.1:3777/path/to/page',
  );
  assert.equal(sanitizeUrlForBrowserTrace('not a url'), '[invalid-url]');
});

test('network record sanitization redacts sensitive headers and omits bodies', () => {
  const sanitized = sanitizeNetworkRecord({
    url: 'https://example.com/api?token=secret#hash',
    method: 'POST',
    status: 200,
    requestHeaders: {
      Cookie: 'session=abc',
      Authorization: 'Bearer secret',
      'Api Key': 'space-separated-key',
      'X-Api-Key': 'key',
      'X-Trace-Id': 'trace-1',
    },
    responseHeaders: {
      'Set-Cookie': 'session=def',
      'X-Refresh-Token': 'token',
      'Content-Type': 'application/json',
    },
    requestBody: '{"secret":true}',
    responseBody: '{"ok":true}',
    body: 'raw-body',
  });

  assert.equal(sanitized.url, 'https://example.com/api');
  assert.equal(sanitized.requestHeaders.Cookie, '[redacted]');
  assert.equal(sanitized.requestHeaders.Authorization, '[redacted]');
  assert.equal(sanitized.requestHeaders['Api Key'], '[redacted]');
  assert.equal(sanitized.requestHeaders['X-Api-Key'], '[redacted]');
  assert.equal(sanitized.requestHeaders['X-Trace-Id'], 'trace-1');
  assert.equal(sanitized.responseHeaders['Set-Cookie'], '[redacted]');
  assert.equal(sanitized.responseHeaders['X-Refresh-Token'], '[redacted]');
  assert.equal(sanitized.responseHeaders['Content-Type'], 'application/json');
  assert.equal('requestBody' in sanitized, false);
  assert.equal('responseBody' in sanitized, false);
  assert.equal('body' in sanitized, false);
});

test('browser artifact helpers keep files inside the task directory', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const taskDir = browserTaskDir({ workspaceRoot, taskId: 'task_browser' });
    assert.equal(taskDir, path.join(workspaceRoot, '.harness', 'browser', 'task_browser'));

    assert.equal(
      resolveBrowserArtifactPath({ workspaceRoot, taskId: 'task_browser', defaultName: 'screenshot.png' }),
      path.join(taskDir, 'screenshot.png'),
    );
    assert.equal(
      resolveBrowserArtifactPath({ workspaceRoot, taskId: 'task_browser', targetPath: 'nested/dom.json' }),
      path.join(taskDir, 'nested', 'dom.json'),
    );

    assert.throws(
      () => resolveBrowserArtifactPath({ workspaceRoot, taskId: 'task_browser', targetPath: '../escape.png' }),
      /browser artifact path must stay inside task directory/i,
    );
    assert.throws(
      () => resolveBrowserArtifactPath({
        workspaceRoot,
        taskId: 'task_browser',
        targetPath: path.join(workspaceRoot, 'outside.png'),
      }),
      /browser artifact path must stay inside task directory/i,
    );
  });
});

test('browser artifact summaries expose relative metadata without raw bytes', async () => {
  await withWorkspace(async ({ workspaceRoot }) => {
    const artifactPath = path.join(workspaceRoot, '.harness', 'browser', 'task_browser', 'screenshot.png');
    const summary = summarizeBrowserArtifact({
      workspaceRoot,
      taskId: 'task_browser',
      type: 'screenshot',
      path: artifactPath,
      metadata: {
        width: 1280,
        height: 720,
        bytes: Buffer.from('png'),
        dataUrl: 'data:image/png;base64,abc',
        content: 'raw',
      },
    });

    assert.deepEqual(summary, {
      taskId: 'task_browser',
      type: 'screenshot',
      path: path.join('.harness', 'browser', 'task_browser', 'screenshot.png'),
      metadata: {
        width: 1280,
        height: 720,
      },
    });
  });
});
