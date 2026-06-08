import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  archiveCandidate,
  getCandidateArchiveRoot,
  listArchivedCandidates,
  readArchivedCandidate,
} from '../src/harness-sidecar/meta/candidateArchive.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-candidate-archive-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sampleCandidate(candidateId, overrides = {}) {
  return {
    candidateId,
    target: 'retrieval_policy',
    rationale: ['favor traces with tool_timeout evidence'],
    proposal: {
      status: 'approval_required',
      applied: false,
      changes: [{ file: 'policy.json', op: 'replace', path: '/timeout', value: 30 }],
    },
    ...overrides,
  };
}

test('getCandidateArchiveRoot points under workspace .harness meta candidates', () => {
  const root = getCandidateArchiveRoot('C:\\workspace\\helios');
  assert.equal(root, path.join('C:\\workspace\\helios', '.harness', 'meta', 'candidates'));
});

test('archives and reads deterministic candidate records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const record = await archiveCandidate({
      workspaceRoot,
      candidate: sampleCandidate('cand_alpha'),
      candidateRun: {
        candidateId: 'cand_alpha',
        smokePassed: true,
        metrics: { quality: 0.8, cost: 0.2, latency: 0.3, safety: 0.95 },
      },
      traceSummary: {
        taskId: 'task-17',
        failureModes: ['tool_timeout'],
        budgetGates: [{ percent: 90 }],
      },
      preference: {
        winner: 'cand_alpha',
        rankings: [{ candidateId: 'cand_alpha', preferenceScore: 3 }],
      },
    });

    assert.equal(record.schemaVersion, 1);
    assert.equal(record.candidateId, 'cand_alpha');
    assert.equal(record.candidate.target, 'retrieval_policy');
    assert.equal(record.candidateRun.smokePassed, true);
    assert.equal(record.traceSummary.failureModes[0], 'tool_timeout');
    assert.equal(record.preference.winner, 'cand_alpha');

    const archivedPath = path.join(
      workspaceRoot,
      '.harness',
      'meta',
      'candidates',
      'cand_alpha',
      'candidate.json',
    );
    assert.equal((await stat(archivedPath)).isFile(), true);

    const raw = await readFile(archivedPath, 'utf8');
    assert.equal(raw, `${JSON.stringify(record, null, 2)}\n`);
    const archiveDir = path.dirname(archivedPath);
    assert.equal(
      await readFile(path.join(archiveDir, 'proposal.json'), 'utf8'),
      `${JSON.stringify(record.candidate, null, 2)}\n`,
    );
    assert.equal(
      await readFile(path.join(archiveDir, 'metrics.json'), 'utf8'),
      `${JSON.stringify(record.candidateRun, null, 2)}\n`,
    );
    assert.equal(
      await readFile(path.join(archiveDir, 'trace-summary.json'), 'utf8'),
      `${JSON.stringify(record.traceSummary, null, 2)}\n`,
    );
    assert.equal(
      await readFile(path.join(archiveDir, 'preference.json'), 'utf8'),
      `${JSON.stringify(record.preference, null, 2)}\n`,
    );

    const readBack = await readArchivedCandidate({ workspaceRoot, candidateId: 'cand_alpha' });
    assert.deepEqual(readBack, record);
  });
});

test('does not synthesize timestamps for otherwise deterministic records', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const record = await archiveCandidate({
      workspaceRoot,
      candidate: sampleCandidate('cand_no_clock'),
      candidateRun: { candidateId: 'cand_no_clock' },
      traceSummary: {},
      preference: {},
    });

    assert.equal(record.archivedAt, null);
  });
});

test('rejects unsafe candidate ids and path traversal', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const unsafeIds = [
      '../outside',
      '..\\outside',
      'cand/slash',
      'cand\\slash',
      '.',
      '..',
      '',
      ' cand_space ',
    ];

    for (const candidateId of unsafeIds) {
      await assert.rejects(
        archiveCandidate({
          workspaceRoot,
          candidate: sampleCandidate(candidateId),
          candidateRun: { candidateId },
          traceSummary: {},
          preference: {},
        }),
        /unsafe candidate id/i,
      );

      await assert.rejects(
        readArchivedCandidate({ workspaceRoot, candidateId }),
        /unsafe candidate id/i,
      );
    }
  });
});

test('lists archived candidates newest first with deterministic tie-breaks', async () => {
  await withWorkspace(async (workspaceRoot) => {
    await archiveCandidate({
      workspaceRoot,
      candidate: sampleCandidate('cand_b', { archivedAt: '2026-06-08T10:00:00.000Z' }),
      candidateRun: { candidateId: 'cand_b', metrics: { quality: 0.7 } },
      traceSummary: { taskId: 'task-b' },
      preference: { winner: 'cand_b' },
    });
    await archiveCandidate({
      workspaceRoot,
      candidate: sampleCandidate('cand_a', { archivedAt: '2026-06-08T10:00:00.000Z' }),
      candidateRun: { candidateId: 'cand_a', metrics: { quality: 0.9 } },
      traceSummary: { taskId: 'task-a' },
      preference: { winner: 'cand_a' },
    });
    await archiveCandidate({
      workspaceRoot,
      candidate: sampleCandidate('cand_c', { archivedAt: '2026-06-08T11:00:00.000Z' }),
      candidateRun: { candidateId: 'cand_c', metrics: { quality: 0.8 } },
      traceSummary: { taskId: 'task-c' },
      preference: { winner: 'cand_c' },
    });

    const all = await listArchivedCandidates({ workspaceRoot });
    assert.deepEqual(all.map((record) => record.candidateId), ['cand_c', 'cand_a', 'cand_b']);

    const limited = await listArchivedCandidates({ workspaceRoot, limit: 2 });
    assert.deepEqual(limited.map((record) => record.candidateId), ['cand_c', 'cand_a']);
  });
});
