import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildContextPack } from '../src/harness-sidecar/rag/contextPackBuilder.js';
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
