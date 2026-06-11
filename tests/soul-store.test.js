import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  appendSoulHistory,
  loadOversoul,
  loadSoul,
  saveSoulCandidate,
} from '../src/harness-sidecar/souls/soulStore.js';

test('soul store creates default soul and oversoul records under .harness/souls', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-soul-store-'));
  try {
    const soul = await loadSoul({ workspaceRoot, agentId: 'implementer' });
    const oversoul = await loadOversoul({ workspaceRoot });

    assert.equal(soul.agentId, 'implementer');
    assert.equal(soul.parsed.kind, 'soul');
    assert.match(soul.markdown, /# Soul: implementer/);
    assert.equal(oversoul.parsed.kind, 'oversoul');
    assert.match(oversoul.markdown, /# Oversoul:/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('soul store appends JSONL history and saves shadow-only candidates safely', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-soul-history-'));
  try {
    const event = await appendSoulHistory({ workspaceRoot, agentId: 'reviewer', event: { type: 'win', score: 0.8 } });
    const candidate = await saveSoulCandidate({
      workspaceRoot,
      candidateId: 'candidate_1',
      markdown: '# Soul: reviewer\n\n## Identity\n- Version: 2\n\n## Mission\nReview.\n\n## Temperament\n- Reasoning style: skeptical\n\n## Values And Invariants\n- Must preserve: evidence\n\n## Capability Affinities\n- Strong tools: review\n\n## Risk Posture\n- Workspace write risk: none\n\n## Memory Anchors\n- Prior wins: none\n\n## Evolution Genome\n- Mutation family: review\n\n## Evaluation History\n- Current score summary: pending\n\n## Prompt Adapter Notes\nBe concise.\n',
      mutation: { operation: 'distill' },
      evidence: { refs: ['trace:1'] },
    });

    const historyText = await readFile(event.historyPath, 'utf8');
    assert.match(historyText, /"type":"win"/);
    assert.equal(candidate.shadowOnly, true);
    assert.match(candidate.files.soul, /candidate_1/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('soul store rejects path traversal ids', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-soul-unsafe-'));
  try {
    await assert.rejects(() => loadSoul({ workspaceRoot, agentId: '..\\escape' }), /Unsafe agent id/);
    await assert.rejects(() => saveSoulCandidate({ workspaceRoot, candidateId: '../bad', markdown: '' }), /Unsafe candidate id/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
