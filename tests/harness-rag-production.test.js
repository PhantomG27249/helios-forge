import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

test('workspace indexer persists metadata and reuses unchanged file chunks incrementally', async () => {
  const workspaceRoot = await makeWorkspace();
  const indexStorePath = path.join(workspaceRoot, '.harness', 'storage', 'rag', 'workspace-index.json');
  try {
    await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'docs', 'runbook.md'), 'billing escalation runbook\nrefund escalation runbook\n');

    const firstIndex = await indexWorkspace({
      workspaceRoot,
      indexStorePath,
      maxLinesPerChunk: 2,
    });
    const firstBillingChunks = firstIndex.items.filter((item) => item.path === 'src/features/billingRoutes.js');

    await writeFile(path.join(workspaceRoot, 'docs', 'runbook.md'), 'billing escalation runbook\nupdated refund escalation runbook\n');

    const secondIndex = await indexWorkspace({
      workspaceRoot,
      indexStorePath,
      maxLinesPerChunk: 2,
    });
    const secondBillingChunks = secondIndex.items.filter((item) => item.path === 'src/features/billingRoutes.js');
    const persisted = JSON.parse(await readFile(indexStorePath, 'utf8'));

    assert.equal(firstIndex.metadata.version, 1);
    assert.equal(firstIndex.metadata.fileCount >= 2, true);
    assert.equal(secondIndex.metadata.reusedFileCount >= 1, true);
    assert.equal(secondIndex.metadata.changedFileCount >= 1, true);
    assert.deepEqual(secondBillingChunks, firstBillingChunks);
    assert.equal(persisted.version, 1);
    assert.equal(persisted.workspaceRoot, workspaceRoot);
    assert.equal(persisted.files['src/features/billingRoutes.js'].chunks.length, firstBillingChunks.length);
    assert.match(persisted.files['src/features/billingRoutes.js'].contentHash, /^[a-f0-9]{64}$/);
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

test('retriever applies lexical frequency scoring while preserving source diversity', () => {
  const index = {
    items: [
      {
        type: 'file_chunk',
        chunkId: 'src/search/alpha.js:1-2:aaa',
        path: 'src/search/alpha.js',
        lineStart: 1,
        lineEnd: 2,
        snippet: 'needle needle needle needle indexing cache query',
        tokensEstimated: 10,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/search/alpha.js:3-4:bbb',
        path: 'src/search/alpha.js',
        lineStart: 3,
        lineEnd: 4,
        snippet: 'needle needle needle ranking cache',
        tokensEstimated: 10,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/search/alpha.js:5-6:ccc',
        path: 'src/search/alpha.js',
        lineStart: 5,
        lineEnd: 6,
        snippet: 'needle needle scoring',
        tokensEstimated: 10,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/docs/beta.md:1-2:ddd',
        path: 'src/docs/beta.md',
        lineStart: 1,
        lineEnd: 2,
        snippet: 'needle retrieval docs',
        tokensEstimated: 10,
      },
    ],
  };

  const results = retrieveWorkspaceContext({
    index,
    query: 'needle retrieval cache',
    maxItems: 3,
  });

  assert.equal(results.length, 3);
  assert.equal(results[0].chunkId, 'src/search/alpha.js:1-2:aaa');
  assert.equal(results[1].path, 'src/docs/beta.md');
  assert.equal(results[0].score > results[2].score, true);
  assert.match(results[0].reason, /bm25/i);
  assert.equal(new Set(results.map((item) => item.path)).size >= 2, true);
});

test('context pack interleaves sources before filling additional chunks from the same path', () => {
  const contextPack = buildContextPack({
    taskId: 'task_source_diversity',
    items: [
      {
        type: 'file_chunk',
        chunkId: 'src/a.js:1-2:aaa',
        path: 'src/a.js',
        lineStart: 1,
        lineEnd: 2,
        snippet: 'alpha first',
        tokensEstimated: 5,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/a.js:3-4:bbb',
        path: 'src/a.js',
        lineStart: 3,
        lineEnd: 4,
        snippet: 'alpha second',
        tokensEstimated: 5,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/a.js:5-6:ccc',
        path: 'src/a.js',
        lineStart: 5,
        lineEnd: 6,
        snippet: 'alpha third',
        tokensEstimated: 5,
      },
      {
        type: 'file_chunk',
        chunkId: 'src/b.js:1-2:ddd',
        path: 'src/b.js',
        lineStart: 1,
        lineEnd: 2,
        snippet: 'beta first',
        tokensEstimated: 5,
      },
    ],
    maxTokens: 20,
  });

  assert.deepEqual(
    contextPack.items.map((item) => item.chunkId),
    [
      'src/a.js:1-2:aaa',
      'src/b.js:1-2:ddd',
      'src/a.js:3-4:bbb',
      'src/a.js:5-6:ccc',
    ],
  );
  assert.deepEqual(contextPack.sourcePaths, ['src/a.js', 'src/b.js']);
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
