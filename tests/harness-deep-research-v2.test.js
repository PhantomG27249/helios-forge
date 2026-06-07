import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { extractClaims } from '../src/harness-sidecar/research/claimExtractor.js';
import { verifyEvidence } from '../src/harness-sidecar/research/evidenceVerifier.js';
import { createResearchRunStore } from '../src/harness-sidecar/research/researchRunStore.js';
import { fetchSources } from '../src/harness-sidecar/research/sourceFetchers.js';

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'helios-research-v2-'));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('source fetchers deterministically read inline text and local workspace files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, 'docs', 'source.md'),
      'Local files provide durable evidence.',
      'utf8',
    );

    const fetched = await fetchSources({
      workspaceRoot,
      sources: [
        {
          sourceId: 'inline',
          title: 'Inline note',
          text: 'Research briefs define scope.',
        },
        {
          sourceId: 'file',
          title: 'Local source',
          path: 'docs/source.md',
        },
      ],
    });

    assert.equal(fetched.length, 2);
    assert.deepEqual(
      fetched.map((source) => source.status),
      ['fetched', 'fetched'],
    );
    assert.equal(fetched[0].content, 'Research briefs define scope.');
    assert.equal(fetched[0].type, 'text');
    assert.equal(fetched[1].content, 'Local files provide durable evidence.');
    assert.equal(fetched[1].type, 'local_file');
    assert.equal(fetched[1].locator, 'docs/source.md');
  });
});

test('source fetchers reject local paths outside the workspace root', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'helios-research-v2-'));
  try {
    const workspaceRoot = path.join(root, 'workspace');
    const outsideRoot = path.join(root, 'outside');
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret local text', 'utf8');

    await assert.rejects(
      fetchSources({
        workspaceRoot,
        sources: [{ sourceId: 'escape', path: '../outside/secret.txt' }],
      }),
      /outside workspace root/i,
    );

    await assert.rejects(
      fetchSources({
        workspaceRoot,
        sources: [{ sourceId: 'absolute_escape', path: path.join(outsideRoot, 'secret.txt') }],
      }),
      /outside workspace root/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('external source fetches require approval unless approved with an injected adapter', async () => {
  const blocked = await fetchSources({
    sources: [{ sourceId: 'web', title: 'Remote', url: 'https://example.com/research' }],
  });

  assert.equal(blocked[0].status, 'approval_required');
  assert.equal(blocked[0].requiresApproval, true);
  assert.equal(blocked[0].approval.reason, 'external_source_fetch_requested');
  assert.equal(blocked[0].content, undefined);

  const fetched = await fetchSources({
    approvedExternal: true,
    fetchAdapter: async (source) => ({
      content: `Fetched from ${source.url}.`,
      contentType: 'text/plain',
    }),
    sources: [{ sourceId: 'web', title: 'Remote', url: 'https://example.com/research' }],
  });

  assert.equal(fetched[0].status, 'fetched');
  assert.equal(fetched[0].type, 'external');
  assert.equal(fetched[0].content, 'Fetched from https://example.com/research.');
  assert.equal(fetched[0].contentType, 'text/plain');
});

test('claim extractor returns source-grounded claim candidates with quotes and spans', () => {
  const claims = extractClaims({
    sources: [
      {
        sourceId: 'plan',
        title: 'Plan',
        content: 'Research briefs define scope. External discovery requires approval.',
      },
    ],
  });

  assert.equal(claims.length, 2);
  assert.equal(claims[0].claimId, 'plan_claim_1');
  assert.equal(claims[0].sourceId, 'plan');
  assert.equal(claims[0].claim, 'Research briefs define scope.');
  assert.equal(claims[0].normalizedClaim, 'research briefs define scope');
  assert.equal(claims[0].quote, 'Research briefs define scope.');
  assert.deepEqual(claims[0].span, { start: 0, end: 29 });
  assert.equal(claims[0].confidence, 0.72);
  assert.equal(claims[1].normalizedClaim, 'external discovery requires approval');
  assert.deepEqual(claims[1].span, { start: 30, end: 67 });
});

test('evidence verifier supports exact span evidence and flags missing or unsupported claims', () => {
  const sources = [
    {
      sourceId: 'plan',
      title: 'Lifecycle plan',
      type: 'local_file',
      locator: 'docs/plan.md',
      content: 'Research briefs define scope. External discovery requires approval.',
    },
  ];
  const claims = [
    {
      claimId: 'c1',
      sourceId: 'plan',
      claim: 'Research briefs define scope.',
      quote: 'Research briefs define scope.',
      span: { start: 0, end: 29 },
    },
    {
      claimId: 'c2',
      sourceId: 'plan',
      claim: 'Unsupported claim.',
      quote: 'Unsupported claim.',
      span: { start: 0, end: 18 },
    },
    {
      claimId: 'c3',
      sourceId: 'missing',
      claim: 'Missing source claim.',
      quote: 'Missing source claim.',
    },
  ];

  const verification = verifyEvidence({ claims, sources });

  assert.equal(verification.verifiedClaims.length, 1);
  assert.equal(verification.verifiedClaims[0].claimId, 'c1');
  assert.equal(verification.verifiedClaims[0].status, 'supported');
  assert.deepEqual(verification.verifiedClaims[0].evidence[0].span, { start: 0, end: 29 });
  assert.deepEqual(
    verification.unsupportedClaims.map((claim) => [claim.claimId, claim.reason]),
    [
      ['c2', 'span_quote_mismatch'],
      ['c3', 'missing_source'],
    ],
  );
  assert.deepEqual(verification.bibliography, [
    {
      sourceId: 'plan',
      title: 'Lifecycle plan',
      type: 'local_file',
      locator: 'docs/plan.md',
    },
  ]);
});

test('research run store persists run state and stage events under workspace harness state', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const store = createResearchRunStore({ workspaceRoot });
    const created = await store.createRun({
      runId: 'run_v2_001',
      question: 'What evidence supports the plan?',
      status: 'collecting_sources',
      metadata: { owner: 'deep-research-v2' },
    });
    const updated = await store.updateRun('run_v2_001', {
      status: 'verifying_evidence',
      sourceIds: ['plan'],
    });
    const event = await store.appendStageEvent('run_v2_001', {
      stage: 'source_fetch',
      status: 'completed',
      detail: 'Fetched 1 local file.',
    });

    const durableStore = createResearchRunStore({ workspaceRoot });
    const readBack = await durableStore.readRun('run_v2_001');
    const listed = await durableStore.listRuns();
    const raw = JSON.parse(await readFile(
      path.join(workspaceRoot, '.harness', 'research-runs', 'run_v2_001.json'),
      'utf8',
    ));

    assert.equal(created.runId, 'run_v2_001');
    assert.equal(updated.status, 'verifying_evidence');
    assert.equal(event.stage, 'source_fetch');
    assert.equal(readBack.question, 'What evidence supports the plan?');
    assert.deepEqual(readBack.sourceIds, ['plan']);
    assert.equal(readBack.stageEvents.length, 1);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].runId, 'run_v2_001');
    assert.equal(raw.metadata.owner, 'deep-research-v2');
  });
});

test('research run store rejects run ids that escape the run directory', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const store = createResearchRunStore({ workspaceRoot });

    await assert.rejects(
      store.createRun({ runId: '../../escaped', question: 'escape?' }),
      /unsafe research run id/i,
    );
    await assert.rejects(
      store.readRun('..\\escaped'),
      /unsafe research run id/i,
    );

    const escapedPathExists = await access(path.join(workspaceRoot, 'escaped.json'))
      .then(() => true)
      .catch(() => false);
    assert.equal(escapedPathExists, false);
  });
});
