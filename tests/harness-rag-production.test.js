import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { chunkTextFile } from '../src/harness-sidecar/rag/chunker.js';
import { buildContextPack } from '../src/harness-sidecar/rag/contextPackBuilder.js';
import { indexWorkspace } from '../src/harness-sidecar/rag/workspaceIndexer.js';
import { retrieveWorkspaceContext } from '../src/harness-sidecar/rag/retriever.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-rag-production-'));
  await mkdir(path.join(workspaceRoot, 'src', 'features'), { recursive: true });
  await mkdir(path.join(workspaceRoot, 'node_modules', 'ignored'), { recursive: true });
  await mkdir(path.join(workspaceRoot, '.harness', 'traces'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'src', 'features', 'billingRoutes.js'),
    [
      'export function invoices() {',
      '  return "invoice ledger";',
      '}',
      'export function refunds() {',
      '  return "refund queue";',
      '}',
    ].join('\n'),
  );
  await writeFile(path.join(workspaceRoot, 'node_modules', 'ignored', 'hidden.js'), 'billingRoutes secret\n');
  await writeFile(path.join(workspaceRoot, '.harness', 'traces', 'events.jsonl'), 'billingRoutes trace\n');
  return workspaceRoot;
}

test('chunkTextFile emits deterministic chunk provenance with line ranges and hashes', () => {
  const content = [
    'alpha controller opens',
    'beta route continues',
    'gamma handler finishes',
    'delta service starts',
    'epsilon worker closes',
  ].join('\n');

  const chunks = chunkTextFile({
    path: 'src/routes.js',
    content,
    maxLinesPerChunk: 2,
  });
  const repeated = chunkTextFile({
    path: 'src/routes.js',
    content,
    maxLinesPerChunk: 2,
  });

  assert.equal(chunks.length, 3);
  assert.deepEqual(
    chunks.map(({ path: chunkPath, lineStart, lineEnd }) => ({ path: chunkPath, lineStart, lineEnd })),
    [
      { path: 'src/routes.js', lineStart: 1, lineEnd: 2 },
      { path: 'src/routes.js', lineStart: 3, lineEnd: 4 },
      { path: 'src/routes.js', lineStart: 5, lineEnd: 5 },
    ],
  );
  assert.equal(chunks[0].snippet, 'alpha controller opens\nbeta route continues');
  assert.equal(chunks[0].content, chunks[0].snippet);
  assert.match(chunks[0].contentHash, /^[a-f0-9]{64}$/);
  assert.match(chunks[0].chunkId, /^src\/routes\.js:1-2:[a-f0-9]{12}$/);
  assert.equal(chunks[0].tokensEstimated > 0, true);
  assert.deepEqual(chunks, repeated);
});

test('workspace indexer emits chunk-level text items while preserving path exclusions', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const index = await indexWorkspace({
      workspaceRoot,
      maxLinesPerChunk: 2,
    });

    const chunks = index.items.filter((item) => item.path === 'src/features/billingRoutes.js');
    assert.equal(chunks.length, 3);
    assert.deepEqual(
      chunks.map(({ type, lineStart, lineEnd }) => ({ type, lineStart, lineEnd })),
      [
        { type: 'file_chunk', lineStart: 1, lineEnd: 2 },
        { type: 'file_chunk', lineStart: 3, lineEnd: 4 },
        { type: 'file_chunk', lineStart: 5, lineEnd: 6 },
      ],
    );
    assert.equal(new Set(chunks.map((item) => item.chunkId)).size, 3);
    assert.equal(chunks.every((item) => item.contentHash && item.snippet && item.tokensEstimated > 0), true);
    assert.equal(index.items.some((item) => item.path.includes('node_modules')), false);
    assert.equal(index.items.some((item) => item.path.includes('.harness/traces')), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('retriever scores chunk content with path and file-name boosts', () => {
  const index = {
    items: [
      {
        type: 'file_chunk',
        chunkId: 'src/features/billingRoutes.js:1-2:aaa',
        path: 'src/features/billingRoutes.js',
        lineStart: 1,
        lineEnd: 2,
        contentHash: 'aaa',
        snippet: 'export function invoices() { return "ledger"; }',
        tokensEstimated: 12,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/features/search.js:10-11:bbb',
        path: 'src/features/search.js',
        lineStart: 10,
        lineEnd: 11,
        contentHash: 'bbb',
        snippet: 'billingRoutes billingRoutes billingRoutes billingRoutes',
        tokensEstimated: 12,
      },
    ],
  };

  const results = retrieveWorkspaceContext({
    index,
    query: 'billingRoutes invoices',
    maxItems: 2,
  });

  assert.equal(results[0].chunkId, 'src/features/billingRoutes.js:1-2:aaa');
  assert.equal(results[0].matched.includes('invoices'), true);
  assert.equal(results[0].score > results[1].score, true);
  assert.match(results[0].reason, /path/i);
});

test('context pack preserves chunk provenance and budget exclusions by chunk id and path', () => {
  const contextPack = buildContextPack({
    taskId: 'task_chunk_budget',
    items: [
      {
        type: 'file_chunk',
        chunkId: 'src/a.js:1-2:aaa',
        path: 'src/a.js',
        lineStart: 1,
        lineEnd: 2,
        contentHash: 'aaa',
        snippet: 'alpha beta',
        tokensEstimated: 5,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/b.js:3-4:bbb',
        path: 'src/b.js',
        lineStart: 3,
        lineEnd: 4,
        contentHash: 'bbb',
        snippet: 'gamma delta',
        tokensEstimated: 5,
      },
    ],
    maxTokens: 6,
  });

  assert.deepEqual(contextPack.items[0], {
    type: 'file_chunk',
    chunkId: 'src/a.js:1-2:aaa',
    path: 'src/a.js',
    lineStart: 1,
    lineEnd: 2,
    contentHash: 'aaa',
    snippet: 'alpha beta',
    tokensEstimated: 5,
  });
  assert.deepEqual(contextPack.excludedDueToBudget, [
    {
      chunkId: 'src/b.js:3-4:bbb',
      path: 'src/b.js',
      lineStart: 3,
      lineEnd: 4,
      tokensEstimated: 5,
    },
  ]);
});
