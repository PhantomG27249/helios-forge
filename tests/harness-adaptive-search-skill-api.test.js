import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHarnessSidecar } from '../src/harness-sidecar/server.js';
import { writeSkillCandidate } from '../src/harness-sidecar/skills/skillCandidateStore.js';

async function withSidecar(testFn) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-abmcts-api-'));
  const sidecar = createHarnessSidecar({ workspaceRoot, port: 0 });
  await sidecar.start();

  try {
    await testFn({ baseUrl: sidecar.url, workspaceRoot });
  } finally {
    await sidecar.stop();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function requestJson(baseUrl, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${payload.error || JSON.stringify(payload)}`);
  }
  return payload;
}

async function writeTrace(workspaceRoot, taskId, events) {
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', taskId);
  await mkdir(traceDir, { recursive: true });
  await writeFile(
    path.join(traceDir, 'events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8',
  );
}

async function seedPromotableSkillCandidate(workspaceRoot, overrides = {}) {
  return writeSkillCandidate({
    workspaceRoot,
    candidate: {
      candidateId: 'skill_candidate_review_001',
      target: 'skill_candidate',
      skill: {
        id: 'review-safe-skill',
        name: 'Review Safe Skill',
      },
      metrics: {
        holdoutImproved: true,
        triggerPrecision: 0.91,
        averageCost: 0.1,
      },
      safety: {
        passed: true,
        provenanceCompatible: true,
      },
      metadata: {
        OPENAI_API_KEY: 'sk-should-redact',
        endpoint: 'https://internal.example/v1',
      },
      rollback: {
        available: true,
      },
      ...overrides,
    },
    skillMarkdown: '# Review Safe Skill\n\nUse this only for local review.\n',
    evaluation: {
      totalScore: 0.84,
      secret: 'token-should-redact',
    },
  });
}

test('adaptive search status summarizes stored trace events without leaking secrets', async () => {
  await withSidecar(async ({ baseUrl, workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_abmcts_status', [
      {
        type: 'ab_mcts.action_selected',
        taskId: 'task_abmcts_status',
        timestamp: '2026-06-09T10:00:00.000Z',
        actionId: 'adaptive_1',
        selectedArm: 'go_wider',
        context: { taskId: 'task_abmcts_status', evidenceCount: 0 },
        provider: { apiKey: 'secret-value', baseUrl: 'https://private.example/v1' },
      },
      {
        type: 'ab_mcts.outcome_recorded',
        taskId: 'task_abmcts_status',
        timestamp: '2026-06-09T10:01:00.000Z',
        actionId: 'adaptive_1',
        arm: 'go_wider',
        reward: 0.82,
      },
      {
        type: 'ab_mcts.scheduler_summary',
        taskId: 'task_abmcts_status',
        timestamp: '2026-06-09T10:02:00.000Z',
        actionId: 'adaptive_1',
        selectedArm: 'go_wider',
        arms: [{ arm: 'go_wider', visits: 1, meanReward: 0.82 }],
      },
    ]);

    const status = await requestJson(baseUrl, '/v1/adaptive-search/status?taskId=task_abmcts_status');

    assert.equal(status.taskId, 'task_abmcts_status');
    assert.equal(status.eventCount, 3);
    assert.equal(status.selectionCount, 1);
    assert.equal(status.outcomeCount, 1);
    assert.deepEqual(status.selectedArmCounts, { go_wider: 1 });
    assert.equal(status.latestSelection.selectedArm, 'go_wider');
    assert.equal(JSON.stringify(status).includes('secret-value'), false);
    assert.equal(JSON.stringify(status).includes('private.example'), false);
  });
});

test('adaptive search status reports enabled config even before adaptive traces exist', async () => {
  await withSidecar(async ({ baseUrl, workspaceRoot }) => {
    await mkdir(path.join(workspaceRoot, '.harness'), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, '.harness', 'config.yaml'),
      [
        'features:',
        '  adaptiveSearch: true',
        'adaptiveSearch:',
        '  mode: advisory',
        '  maxActionsPerTask: 8',
        '  allowProfileSwitching: true',
        '',
      ].join('\n'),
      'utf8',
    );

    const status = await requestJson(baseUrl, '/v1/adaptive-search/status');

    assert.equal(status.enabled, true);
    assert.equal(status.mode, 'advisory');
    assert.equal(status.advisory, true);
    assert.equal(status.traceCount, 0);
    assert.equal(status.selectedArm, null);
    assert.equal(status.reason, 'no_adaptive_search_events_yet');
  });
});

test('adaptive search replay derives trace evidence and returns a dry-run AB-MCTS choice', async () => {
  await withSidecar(async ({ baseUrl, workspaceRoot }) => {
    await writeTrace(workspaceRoot, 'task_abmcts_replay', [
      {
        type: 'verifier.result',
        taskId: 'task_abmcts_replay',
        timestamp: '2026-06-09T10:00:00.000Z',
        passed: true,
        confidence: 0.44,
      },
      {
        type: 'ab_mcts.action_selected',
        taskId: 'task_abmcts_replay',
        timestamp: '2026-06-09T10:01:00.000Z',
        actionId: 'adaptive_1',
        selectedArm: 'go_wider',
      },
      {
        type: 'ab_mcts.outcome_recorded',
        taskId: 'task_abmcts_replay',
        timestamp: '2026-06-09T10:02:00.000Z',
        actionId: 'adaptive_1',
        arm: 'go_wider',
        reward: 0.91,
      },
    ]);

    const replay = await requestJson(baseUrl, '/v1/adaptive-search/replay', {
      method: 'POST',
      body: {
        taskId: 'task_abmcts_replay',
        context: {
          bestCandidate: { score: 0.88 },
          budget: { pressure: 0.2 },
        },
      },
    });

    assert.equal(replay.taskId, 'task_abmcts_replay');
    assert.equal(replay.dryRun, true);
    assert.equal(replay.mutatedTaskState, false);
    assert.equal(replay.selection.arm, 'go_deeper');
    assert.equal(replay.selection.trace.type, 'ab_mcts.action_selected');
    assert.equal(replay.evidenceCount >= 1, true);
  });
});

test('skill candidate API lists details and redacts review payloads', async () => {
  await withSidecar(async ({ baseUrl, workspaceRoot }) => {
    await seedPromotableSkillCandidate(workspaceRoot);

    const listed = await requestJson(baseUrl, '/v1/skill-candidates');
    assert.equal(listed.candidates.length, 1);
    assert.equal(listed.candidates[0].candidateId, 'skill_candidate_review_001');
    assert.equal(listed.candidates[0].skillMarkdown, undefined);
    assert.equal(JSON.stringify(listed).includes('sk-should-redact'), false);

    const detail = await requestJson(baseUrl, '/v1/skill-candidates/skill_candidate_review_001');
    assert.equal(detail.candidateId, 'skill_candidate_review_001');
    assert.equal(detail.skillMarkdown.includes('Review Safe Skill'), true);
    assert.equal(detail.metadata.OPENAI_API_KEY, '[redacted]');
    assert.equal(detail.metadata.endpoint, '[redacted]');
    assert.equal(detail.evaluation.secret, '[redacted]');
  });
});

test('skill candidate approval applies only through the promotion gate and reject records review status', async () => {
  await withSidecar(async ({ baseUrl, workspaceRoot }) => {
    await seedPromotableSkillCandidate(workspaceRoot);

    const applied = await requestJson(baseUrl, '/v1/skill-candidates/skill_candidate_review_001/approve', {
      method: 'POST',
      body: { approver: 'human-reviewer' },
    });

    assert.equal(applied.status, 'applied');
    assert.equal(applied.candidate.status, 'applied');
    assert.equal(applied.capability.type, 'skill');
    assert.equal(applied.installPath.includes(`${path.sep}.harness${path.sep}packages${path.sep}generated-skills`), true);

    await seedPromotableSkillCandidate(workspaceRoot, {
      candidateId: 'skill_candidate_reject_001',
      skill: { id: 'reject-safe-skill', name: 'Reject Safe Skill' },
    });

    const rejected = await requestJson(baseUrl, '/v1/skill-candidates/skill_candidate_reject_001/reject', {
      method: 'POST',
      body: { reviewer: 'human-reviewer', reason: 'Needs more evidence.' },
    });

    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.candidate.status, 'rejected');
    assert.equal(rejected.candidate.review.reason, 'Needs more evidence.');
  });
});
