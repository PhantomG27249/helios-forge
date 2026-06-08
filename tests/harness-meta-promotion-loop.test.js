import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createFrontierStore,
  getFrontierPath,
  sanitizeCandidateId,
} from '../src/harness-sidecar/meta/frontierStore.js';
import { listArchivedCandidates } from '../src/harness-sidecar/meta/candidateArchive.js';
import { runPromotionLoop } from '../src/harness-sidecar/meta/promotionLoop.js';

async function withWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-meta-loop-'));
  try {
    await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function writeTrace(workspaceRoot, taskId = 'task_meta_loop') {
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', taskId);
  await mkdir(traceDir, { recursive: true });
  await writeFile(path.join(traceDir, 'events.jsonl'), [
    JSON.stringify({ type: 'recovery.event', category: 'tool_timeout' }),
    JSON.stringify({ type: 'budget.gate', percent: 91 }),
  ].join('\n'));
  return traceDir;
}

function candidate(overrides = {}) {
  return {
    candidateId: 'cand unsafe/../meta 001',
    target: 'tool_policy',
    rationale: 'Reduce retries after trace timeout loops.',
    patch: { files: [{ path: 'src/harness-sidecar/meta/toolPolicy.js', action: 'update' }] },
    ...overrides,
  };
}

function runner(metrics = { quality: 0.9, safety: 0.96, cost: 0.3, latency: 0.2 }) {
  return {
    async runSmoke({ candidate: runCandidate }) {
      return { passed: true, smokeId: `smoke_${runCandidate.candidateId}` };
    },
    async runEval() {
      return { metrics };
    },
  };
}

test('frontier store persists baseline candidates and append-only decisions with safe ids', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const store = createFrontierStore({ workspaceRoot });
    assert.equal(getFrontierPath(workspaceRoot), path.join(workspaceRoot, '.harness', 'meta', 'frontier.json'));

    const empty = await store.load();
    assert.deepEqual(empty.baselineFrontier, []);
    assert.deepEqual(empty.candidates.accepted, []);
    assert.deepEqual(empty.candidates.rejected, []);
    assert.deepEqual(empty.promotionDecisions, []);

    await store.setBaselineFrontier([
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ]);

    const unsafeId = '../candidate one';
    const safeId = sanitizeCandidateId(unsafeId);
    assert.match(safeId, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(safeId, unsafeId);

    await store.recordDecision({
      candidate: { candidateId: unsafeId, target: 'tool_policy' },
      candidateRun: { candidateId: unsafeId, smokePassed: true, metrics: { quality: 0.7, safety: 0.95, cost: 0.6, latency: 0.5 } },
      decision: { candidateId: unsafeId, status: 'rejected', reasons: ['not_pareto_improvement'] },
      proposal: { proposalId: 'proposal_0001', status: 'approval_required' },
    });
    await store.recordDecision({
      candidate: { candidateId: 'cand_accept', target: 'tool_policy' },
      candidateRun: { candidateId: 'cand_accept', smokePassed: true, metrics: { quality: 0.91, safety: 0.97, cost: 0.3, latency: 0.2 } },
      decision: { candidateId: 'cand_accept', status: 'promoted', reasons: ['pareto_improvement'] },
      proposal: { proposalId: 'proposal_0002', status: 'approval_required' },
    });

    const frontier = JSON.parse(await readFile(getFrontierPath(workspaceRoot), 'utf8'));
    assert.deepEqual(frontier.baselineFrontier.map((entry) => entry.candidateId), ['baseline']);
    assert.deepEqual(frontier.candidates.rejected.map((entry) => entry.candidateId), [safeId]);
    assert.deepEqual(frontier.candidates.accepted.map((entry) => entry.candidateId), ['cand_accept']);
    assert.deepEqual(frontier.promotionDecisions.map((entry) => entry.candidateId), [safeId, 'cand_accept']);
    assert.equal(frontier.promotionDecisions.length, 2);
  });
});

test('promotion loop proposes approval-required change and rejects without explicit approval', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const traceDir = await writeTrace(workspaceRoot);
    const store = createFrontierStore({ workspaceRoot });
    await store.setBaselineFrontier([
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ]);

    let applyCalls = 0;
    const result = await runPromotionLoop({
      workspaceRoot,
      traceDir,
      target: 'tool_policy',
      candidateGenerator: async ({ traceSummary, target }) => candidate({
        target,
        rationale: `Address ${traceSummary.failureModes.join(', ')}`,
      }),
      runner: runner(),
      applyAdapter: async () => {
        applyCalls += 1;
        return { applied: true };
      },
    });

    assert.equal(applyCalls, 0);
    assert.equal(result.proposal.status, 'approval_required');
    assert.equal(result.proposal.approvalRequired, true);
    assert.equal(result.proposal.directApplyAllowed, false);
    assert.equal(result.decision.status, 'rejected');
    assert.equal(result.decision.reasons.includes('missing_human_approval'), true);
    assert.equal(result.applied, null);
    assert.deepEqual(result.auditEvents.map((event) => event.type), [
      'meta.candidate_proposed',
      'meta.smoke_run',
      'meta.promotion_decision',
      'meta.approval_required',
      'meta.rejected',
    ]);

    const frontier = await store.load();
    assert.equal(frontier.candidates.rejected.length, 1);
    assert.match(frontier.candidates.rejected[0].candidateId, /^[A-Za-z0-9_-]+$/);
    assert.equal(frontier.promotionDecisions.length, 1);
  });
});

test('promotion loop applies only approved smoke-passing pareto improvements', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const traceDir = await writeTrace(workspaceRoot);
    const store = createFrontierStore({ workspaceRoot });
    await store.setBaselineFrontier([
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ]);

    const applyCalls = [];
    const result = await runPromotionLoop({
      workspaceRoot,
      traceDir,
      target: 'tool_policy',
      candidateGenerator: async () => candidate({ candidateId: 'cand_approved' }),
      runner: runner(),
      approval: { choice: 'approve', approver: 'human' },
      applyAdapter: async ({ proposal }) => {
        applyCalls.push(proposal.proposalId);
        return { applied: true, files: ['src/harness-sidecar/meta/toolPolicy.js'] };
      },
    });

    assert.deepEqual(applyCalls, [result.proposal.proposalId]);
    assert.equal(result.decision.status, 'promoted');
    assert.equal(result.applied.status, 'applied');
    assert.equal(result.applied.result.applied, true);
    assert.deepEqual(result.auditEvents.map((event) => event.type), [
      'meta.candidate_proposed',
      'meta.smoke_run',
      'meta.promotion_decision',
      'meta.approval_required',
      'meta.applied',
    ]);

    const frontier = await store.load();
    assert.deepEqual(frontier.candidates.accepted.map((entry) => entry.candidateId), ['cand_approved']);
    assert.equal(frontier.candidates.rejected.length, 0);
    assert.equal(frontier.promotionDecisions[0].status, 'promoted');
  });
});

test('promotion loop rejects approvals that do not match the generated candidate id', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const traceDir = await writeTrace(workspaceRoot);
    const store = createFrontierStore({ workspaceRoot });
    await store.setBaselineFrontier([
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ]);

    let applyCalls = 0;
    const result = await runPromotionLoop({
      workspaceRoot,
      traceDir,
      target: 'tool_policy',
      candidateGenerator: async () => candidate({ candidateId: 'cand_current' }),
      runner: runner(),
      approval: { candidateId: 'cand_other', choice: 'approve', approver: 'human' },
      applyAdapter: async () => {
        applyCalls += 1;
        return { applied: true };
      },
    });

    assert.equal(applyCalls, 0);
    assert.equal(result.decision.status, 'rejected');
    assert.equal(result.decision.reasons.includes('missing_human_approval'), true);
    assert.equal(result.applied, null);
  });
});

test('promotion loop selects preference winner and archives all optimizer candidates', async () => {
  await withWorkspace(async (workspaceRoot) => {
    const traceDir = await writeTrace(workspaceRoot);
    const store = createFrontierStore({ workspaceRoot });
    await store.setBaselineFrontier([
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ]);

    const evaluated = [];
    const result = await runPromotionLoop({
      workspaceRoot,
      traceDir,
      target: 'runtime_policy',
      candidateGenerator: async () => candidate({ candidateId: 'legacy_seed' }),
      optimizer: async () => ({
        candidates: [
          candidate({ candidateId: 'cand_low', rationale: 'Lower-scored candidate.' }),
          candidate({ candidateId: 'cand_high', rationale: 'Preferred candidate.' }),
        ],
        preference: {
          winner: { candidateId: 'cand_high' },
          rankings: [
            { candidateId: 'cand_high', preferenceScore: 0.9 },
            { candidateId: 'cand_low', preferenceScore: 0.2 },
          ],
        },
        bes: { subgoals: [{ id: 'S1' }] },
        coreset: { selectedCount: 1 },
      }),
      runner: {
        async runSmoke({ candidate: runCandidate }) {
          return { passed: true, smokeId: `smoke_${runCandidate.candidateId}` };
        },
        async runEval({ candidate: runCandidate }) {
          evaluated.push(runCandidate.candidateId);
          return { metrics: { quality: 0.91, safety: 0.97, cost: 0.3, latency: 0.2 } };
        },
      },
      approval: { candidateId: 'cand_high', choice: 'approve', approver: 'human' },
      applyAdapter: async () => ({ applied: true }),
      archiveCandidates: true,
    });

    assert.deepEqual(evaluated, ['cand_high']);
    assert.equal(result.candidate.candidateId, 'cand_high');
    assert.equal(result.candidates.length, 2);
    assert.equal(result.preference.winner.candidateId, 'cand_high');
    assert.equal(result.decision.status, 'promoted');
    assert.equal(result.auditEvents.some((event) => event.type === 'meta.candidates_archived'), true);

    const archived = await listArchivedCandidates({ workspaceRoot });
    assert.deepEqual(
      archived.map((record) => record.candidateId).sort(),
      ['cand_high', 'cand_low'],
    );
    assert.equal(
      archived.find((record) => record.candidateId === 'cand_high').candidateRun.smokePassed,
      true,
    );
    assert.equal(
      archived.find((record) => record.candidateId === 'cand_low').candidateRun.smokePassed,
      false,
    );
  });
});
