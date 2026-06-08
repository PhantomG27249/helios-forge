import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildContextPack } from '../src/harness-sidecar/rag/contextPackBuilder.js';
import { composeUnifiedContext } from '../src/harness-sidecar/rag/unifiedContextComposer.js';
import { indexWorkspace } from '../src/harness-sidecar/rag/workspaceIndexer.js';
import { retrieveWorkspaceContext } from '../src/harness-sidecar/rag/retriever.js';
import { writeMemoryCandidate } from '../src/harness-sidecar/memory/memoryWriter.js';

async function makeWorkspace() {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'pi-rag-memory-'));
  await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await mkdir(path.join(workspaceRoot, 'node_modules', 'ignored'), { recursive: true });
  await mkdir(path.join(workspaceRoot, '.harness', 'traces'), { recursive: true });
  await writeFile(path.join(workspaceRoot, 'src', 'server.js'), 'export function startSidecarWebSocket() { return "sidecar websocket"; }\n');
  await writeFile(path.join(workspaceRoot, 'README.md'), 'Research harness wrapper around Pi agent.\n');
  await writeFile(path.join(workspaceRoot, 'node_modules', 'ignored', 'package.js'), 'ignored\n');
  await writeFile(path.join(workspaceRoot, '.harness', 'traces', 'events.jsonl'), 'ignored\n');
  return workspaceRoot;
}

test('workspace indexer excludes generated and runtime paths', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const index = await indexWorkspace({ workspaceRoot });
    const paths = index.items.map((item) => item.path);

    assert.equal(paths.includes('src/server.js'), true);
    assert.equal(paths.includes('README.md'), true);
    assert.equal(paths.some((filePath) => filePath.includes('node_modules')), false);
    assert.equal(paths.some((filePath) => filePath.includes('.harness/traces')), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('retriever returns source-tracked context and builds token-bounded packs', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const index = await indexWorkspace({ workspaceRoot });
    const results = retrieveWorkspaceContext({
      index,
      query: 'sidecar websocket task',
      maxItems: 3,
    });
    const contextPack = buildContextPack({
      taskId: 'task_context',
      profile: 'coding_small',
      items: results,
      maxTokens: 200,
    });

    assert.equal(results[0].path, 'src/server.js');
    assert.match(results[0].reason, /matched/i);
    assert.equal(contextPack.taskId, 'task_context');
    assert.equal(contextPack.items.length > 0, true);
    assert.equal(contextPack.excludedDueToBudget.length, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('memory writer stores candidate records with evidence and review status', async () => {
  const workspaceRoot = await makeWorkspace();
  try {
    const candidate = await writeMemoryCandidate({
      workspaceRoot,
      record: {
        type: 'dead_end',
        summary: 'Global verifier retry loop repeated the same failing command.',
        evidence: ['task_001/events.jsonl'],
        confidence: 'medium',
        createdByTask: 'task_001',
      },
    });

    assert.equal(candidate.reviewStatus, 'candidate');
    assert.match(candidate.memoryId, /^mem_/);

    const memoryPath = path.join(workspaceRoot, '.harness', 'memory', 'candidates.jsonl');
    const raw = await readFile(memoryPath, 'utf8');
    assert.match(raw, /Global verifier retry loop/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('unified context composer combines workspace, memory, and graph sources deterministically', () => {
  const contextPack = composeUnifiedContext({
    taskId: 'task_unified',
    profile: 'coding_small',
    maxTokens: 26,
    workspaceItems: [
      {
        chunkId: 'chunk_server_1',
        path: 'src/server.js',
        lineStart: 1,
        lineEnd: 4,
        snippet: 'startSidecarWebSocket opens the harness websocket',
        score: 12,
        reason: 'Matched websocket terms',
        tokensEstimated: 10,
      },
      {
        chunkId: 'chunk_server_2',
        path: 'src/server.js',
        lineStart: 20,
        lineEnd: 24,
        snippet: 'secondary server detail',
        score: 11,
        reason: 'Matched server terms',
        tokensEstimated: 10,
      },
    ],
    memoryItems: [
      {
        memoryId: 'mem_fix_0001',
        type: 'reusable_fix',
        summary: 'Run focused node --test before the full suite.',
        reason: ['tag:harness', 'task:graph memory'],
        provenance: [{ taskId: 'task_memory', evidence: ['tests/harness-rag-memory.test.js'] }],
        tokenEstimate: 8,
      },
    ],
    graphItems: [
      {
        id: 'run:run_001',
        type: 'run',
        label: 'focused harness run',
        reason: 'supports claim routing-stable',
        provenance: [{ taskId: 'task_graph', reason: 'claim evidence link' }],
        tokensEstimated: 8,
      },
    ],
  });

  assert.equal(contextPack.taskId, 'task_unified');
  assert.equal(contextPack.items.length, 3);
  assert.deepEqual(
    contextPack.items.map((item) => item.source),
    ['workspace_rag', 'promoted_memory', 'knowledge_graph'],
  );
  assert.deepEqual(
    contextPack.items.map((item) => item.sourceLabel),
    ['workspace:src/server.js', 'memory:mem_fix_0001', 'graph:run:run_001'],
  );
  assert.deepEqual(contextPack.items[1].reasons, ['tag:harness', 'task:graph memory']);
  assert.equal(contextPack.items[1].provenance[0].taskId, 'task_memory');
  assert.equal(contextPack.excludedDueToBudget.length, 1);
  assert.equal(contextPack.excludedDueToBudget[0].chunkId, 'chunk_server_2');
});
