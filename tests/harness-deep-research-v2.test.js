import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createAdaptiveSearchScheduler } from '../src/harness-sidecar/bes/adaptiveSearchScheduler.js';
import { extractClaims } from '../src/harness-sidecar/research/claimExtractor.js';
import { verifyEvidence } from '../src/harness-sidecar/research/evidenceVerifier.js';
import { createDeepResearchV2Artifacts } from '../src/harness-sidecar/research/deepResearchManager.js';
import { extractFigureCandidates } from '../src/harness-sidecar/research/figureExtractor.js';
import { assessNoveltyAndRisk } from '../src/harness-sidecar/research/noveltyControls.js';
import { createResearchRunStore } from '../src/harness-sidecar/research/researchRunStore.js';
import {
  RESEARCH_SPECIALIST_ROLES,
  createResearchSubagentPlan,
  runResearchSubagents,
} from '../src/harness-sidecar/research/researchSubagents.js';
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

test('research subagents expose deterministic specialist roles and execution order', async () => {
  const plan = createResearchSubagentPlan({
    question: 'How should we deepen research?',
    sources: [{ sourceId: 'plan', title: 'Plan' }],
  });

  assert.deepEqual(RESEARCH_SPECIALIST_ROLES, [
    'source_finder',
    'paper_reader',
    'figure_analyst',
    'citation_auditor',
    'contradiction_reviewer',
    'implementation_planner',
  ]);
  assert.deepEqual(
    plan.workers.map((worker) => worker.role),
    RESEARCH_SPECIALIST_ROLES,
  );

  const run = await runResearchSubagents({
    plan,
    context: { question: 'How should we deepen research?' },
    workers: {
      source_finder: async ({ task }) => ({ found: task.inputs.sourceIds }),
      paper_reader: async () => ({ claimsRead: 2 }),
      figure_analyst: async () => ({ figuresReviewed: 1 }),
      citation_auditor: async () => ({ unsupportedClaims: 0 }),
      contradiction_reviewer: async () => ({ contradictions: 0 }),
      implementation_planner: async () => ({ recommendations: 3 }),
    },
  });

  assert.deepEqual(
    run.results.map((result) => [result.role, result.status]),
    RESEARCH_SPECIALIST_ROLES.map((role) => [role, 'completed']),
  );
  assert.deepEqual(run.results[0].output, { found: ['plan'] });
});

test('figure extractor returns PDF page metadata and deterministic figure candidates', () => {
  const extracted = extractFigureCandidates({
    sources: [
      {
        sourceId: 'paper',
        title: 'Harness Paper',
        type: 'pdf',
        pdfPages: [
          {
            pageNumber: 1,
            width: 612,
            height: 792,
            text: 'Figure 1: Sidecar architecture improves traceability.',
            figures: [{ label: 'Figure 1', caption: 'Sidecar architecture', bbox: [72, 120, 300, 260] }],
          },
          {
            pageNumber: 2,
            width: 612,
            height: 792,
            text: 'No figures on this page.',
          },
        ],
      },
    ],
  });

  assert.deepEqual(extracted.pageMetadata, [
    { sourceId: 'paper', pageNumber: 1, width: 612, height: 792, textLength: 53 },
    { sourceId: 'paper', pageNumber: 2, width: 612, height: 792, textLength: 24 },
  ]);
  assert.deepEqual(extracted.figureCandidates, [
    {
      figureId: 'paper_p1_fig1',
      sourceId: 'paper',
      pageNumber: 1,
      label: 'Figure 1',
      caption: 'Sidecar architecture',
      bbox: [72, 120, 300, 260],
      confidence: 0.9,
    },
  ]);
});

test('novelty controls flag unsupported novelty, contradictions, and figure-only evidence risk', () => {
  const controls = assessNoveltyAndRisk({
    claims: [
      { claimId: 'supported', claim: 'Known supported claim.', status: 'supported', evidence: [{ sourceId: 'paper' }] },
      { claimId: 'novel', claim: 'Novel unsupported claim.', novelty: 'high', evidence: [] },
      { claimId: 'figure_only', claim: 'Result only appears in a figure.', evidence: [{ figureId: 'paper_p1_fig1' }] },
    ],
    contradictions: [{ contradictionId: 'contra_1', claimIds: ['supported', 'novel'] }],
    figureCandidates: [{ figureId: 'paper_p1_fig1', caption: 'Result chart' }],
  });

  assert.deepEqual(
    controls.flags.map((flag) => [flag.kind, flag.claimId || flag.contradictionId]),
    [
      ['unsupported_high_novelty', 'novel'],
      ['contradiction_requires_review', 'contra_1'],
      ['figure_only_evidence', 'figure_only'],
    ],
  );
  assert.equal(controls.riskLevel, 'high');
});

test('deep research v2 manager writes production artifacts without external web', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await createDeepResearchV2Artifacts({
      workspaceRoot,
      runId: 'run_v2_artifacts',
      question: 'What should production research include?',
      sources: [
        {
          sourceId: 'paper',
          title: 'Local paper',
          type: 'pdf',
          locator: 'docs/paper.pdf',
          content: 'Deep research needs grounded citations. Novel claims require review.',
          claims: [
            {
              claimId: 'c1',
              sourceId: 'paper',
              claim: 'Deep research needs grounded citations.',
              evidence: [{ sourceId: 'paper', quote: 'Deep research needs grounded citations.' }],
              status: 'supported',
            },
            {
              claimId: 'c2',
              sourceId: 'paper',
              claim: 'Novel claims require review.',
              novelty: 'high',
              evidence: [],
            },
          ],
          pdfPages: [
            {
              pageNumber: 3,
              width: 612,
              height: 792,
              text: 'Figure 2: Evidence graph.',
              figures: [{ label: 'Figure 2', caption: 'Evidence graph', bbox: [10, 20, 200, 220] }],
            },
          ],
        },
      ],
      contradictions: [{ contradictionId: 'contra_1', claimIds: ['c1', 'c2'], values: ['yes', 'no'] }],
    });

    assert.deepEqual(result.artifacts.map((artifact) => artifact.name), [
      'source_map.json',
      'claim_evidence_graph.json',
      'figure_notes.md',
      'contradictions.md',
      'implementation_recommendations.md',
      'final_report.md',
    ]);

    const sourceMap = JSON.parse(await readFile(path.join(result.artifactDir, 'source_map.json'), 'utf8'));
    const graph = JSON.parse(await readFile(path.join(result.artifactDir, 'claim_evidence_graph.json'), 'utf8'));
    const figureNotes = await readFile(path.join(result.artifactDir, 'figure_notes.md'), 'utf8');
    const contradictions = await readFile(path.join(result.artifactDir, 'contradictions.md'), 'utf8');
    const recommendations = await readFile(path.join(result.artifactDir, 'implementation_recommendations.md'), 'utf8');
    const finalReport = await readFile(path.join(result.artifactDir, 'final_report.md'), 'utf8');

    assert.equal(sourceMap.sources[0].sourceId, 'paper');
    assert.equal(sourceMap.sources[0].pages[0].pageNumber, 3);
    assert.equal(graph.claims.length, 2);
    assert.equal(graph.riskFlags[0].kind, 'unsupported_high_novelty');
    assert.match(figureNotes, /Figure 2/);
    assert.match(contradictions, /contra_1/);
    assert.match(recommendations, /Resolve unsupported high novelty claim c2/);
    assert.match(finalReport, /## Specialist Workers/);
    assert.match(finalReport, /## Production Artifacts/);
  });
});

test('deep research v2 preserves disabled adaptive search behavior and reports enabled routing metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const disabled = await createDeepResearchV2Artifacts({
      workspaceRoot,
      runId: 'run_v2_adaptive_disabled',
      question: 'What should production research include?',
      sources: [{ sourceId: 'paper', title: 'Local paper', claims: [] }],
      adaptiveSearch: { enabled: false },
    });
    const scheduler = createAdaptiveSearchScheduler({ rng: () => 0.22 });
    const enabled = await createDeepResearchV2Artifacts({
      workspaceRoot,
      runId: 'run_v2_adaptive_enabled',
      question: 'What should production research include?',
      sources: [
        {
          sourceId: 'paper',
          title: 'Local paper',
          claims: [{
            claimId: 'c1',
            sourceId: 'paper',
            claim: 'Grounded claims require citations.',
            evidence: [{ sourceId: 'paper' }],
          }],
        },
      ],
      contradictions: [{ contradictionId: 'contra_1', claimIds: ['c1'] }],
      adaptiveSearch: {
        enabled: true,
        scheduler,
        context: { taskId: 'research_route', synthesisConfidence: 0.3 },
        budget: { pressure: 0.15 },
      },
    });

    assert.equal(disabled.adaptiveSearch, undefined);
    assert.equal(enabled.adaptiveSearch.action.trace.type, 'ab_mcts.action_selected');
    assert.equal(enabled.adaptiveSearch.action.contextId, 'research_route');
    assert.equal(enabled.adaptiveSearch.outcome.type, 'ab_mcts.outcome_recorded');
    assert.equal(enabled.adaptiveSearch.outcome.evidence.runId, 'run_v2_adaptive_enabled');
    assert.equal(enabled.artifacts.some((artifact) => artifact.name === 'final_report.md'), true);
  });
});
