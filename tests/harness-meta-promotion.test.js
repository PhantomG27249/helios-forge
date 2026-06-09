import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { applyChangeProposal, createChangeProposal } from '../src/harness-sidecar/meta/changeProposal.js';
import { evaluatePromotion } from '../src/harness-sidecar/meta/promotionPolicy.js';
import { resumeTaskFromTrace } from '../src/harness-sidecar/core/taskResume.js';
import { compactTraceEvents } from '../src/harness-sidecar/core/traceCompactor.js';

function candidateRun(overrides = {}) {
  return {
    candidateId: 'cand_meta_001',
    smokePassed: true,
    metrics: {
      quality: 0.86,
      safety: 0.96,
      cost: 0.4,
      latency: 0.3,
    },
    ...overrides,
  };
}

test('promotion policy rejects candidates without approval smoke safety or pareto improvement', () => {
  const baselineFrontier = [
    { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
  ];

  const missingApproval = evaluatePromotion({
    candidateRun: candidateRun(),
    baselineFrontier,
    approvals: [],
    safetyThreshold: 0.9,
  });
  assert.equal(missingApproval.status, 'rejected');
  assert.equal(missingApproval.reasons.includes('missing_human_approval'), true);

  const failedSmoke = evaluatePromotion({
    candidateRun: candidateRun({ smokePassed: false }),
    baselineFrontier,
    approvals: [{ candidateId: 'cand_meta_001', choice: 'approve' }],
    safetyThreshold: 0.9,
  });
  assert.equal(failedSmoke.reasons.includes('smoke_failed'), true);

  const unsafe = evaluatePromotion({
    candidateRun: candidateRun({ metrics: { quality: 0.9, safety: 0.72, cost: 0.3, latency: 0.2 } }),
    baselineFrontier,
    approvals: [{ candidateId: 'cand_meta_001', choice: 'approve' }],
    safetyThreshold: 0.9,
  });
  assert.equal(unsafe.reasons.includes('safety_below_threshold'), true);

  const dominated = evaluatePromotion({
    candidateRun: candidateRun({ metrics: { quality: 0.79, safety: 0.91, cost: 0.6, latency: 0.5 } }),
    baselineFrontier,
    approvals: [{ candidateId: 'cand_meta_001', choice: 'approve' }],
    safetyThreshold: 0.9,
  });
  assert.equal(dominated.reasons.includes('not_pareto_improvement'), true);
});

test('promotion policy accepts approved smoke-passing non-dominated improvement', () => {
  const decision = evaluatePromotion({
    candidateRun: candidateRun(),
    baselineFrontier: [
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ],
    approvals: [{ candidateId: 'cand_meta_001', choice: 'approve', approver: 'human' }],
    safetyThreshold: 0.9,
  });

  assert.equal(decision.status, 'promoted');
  assert.deepEqual(decision.reasons, [
    'human_approved',
    'smoke_passed',
    'safety_threshold_met',
    'pareto_improvement',
  ]);
  assert.equal(decision.candidateId, 'cand_meta_001');
});

test('promotion policy gates verifier candidates on approval holdout baseline flakiness and cost', () => {
  const baselineVerifierMetrics = {
    falsePositive: 2,
    falseNegative: 3,
    recall: 0.4,
    averageCost: 0.4,
  };
  const approved = [{ candidateId: 'vg_candidate_001', choice: 'approve', approver: 'human' }];
  const candidate = {
    candidateId: 'vg_candidate_001',
    target: 'verifier_policy',
    verifierGenome: { genomeId: 'vg_candidate_001' },
    metrics: {
      falsePositive: 1,
      falseNegative: 1,
      recall: 0.8,
      safetyPassed: true,
      flakiness: 0.1,
      averageCost: 0.44,
    },
    safety: { passed: true, failures: [] },
  };

  const accepted = evaluatePromotion({
    candidateRun: candidate,
    baselineVerifierMetrics,
    approvals: approved,
    verifierPolicy: {
      flakinessThreshold: 0.2,
      costIncreaseThreshold: 0.2,
    },
  });
  assert.equal(accepted.status, 'promoted');
  assert.deepEqual(accepted.reasons, [
    'human_approved',
    'verifier_holdout_improved',
    'verifier_baseline_clean',
    'verifier_flakiness_ok',
    'verifier_cost_ok',
  ]);

  const missingApproval = evaluatePromotion({
    candidateRun: candidate,
    baselineVerifierMetrics,
    approvals: [],
  });
  assert.equal(missingApproval.reasons.includes('missing_human_approval'), true);

  const noHoldout = evaluatePromotion({
    candidateRun: { ...candidate, metrics: { ...candidate.metrics, falsePositive: 2, falseNegative: 4, recall: 0.2 } },
    baselineVerifierMetrics,
    approvals: approved,
  });
  assert.equal(noHoldout.reasons.includes('missing_verifier_holdout'), true);

  const regressed = evaluatePromotion({
    candidateRun: { ...candidate, safety: { passed: false, failures: ['baseline-smoke'] } },
    baselineVerifierMetrics,
    approvals: approved,
  });
  assert.equal(regressed.reasons.includes('verifier_regression'), true);

  const flaky = evaluatePromotion({
    candidateRun: { ...candidate, metrics: { ...candidate.metrics, flakiness: 0.5 } },
    baselineVerifierMetrics,
    approvals: approved,
    verifierPolicy: { flakinessThreshold: 0.2 },
  });
  assert.equal(flaky.reasons.includes('verifier_flaky'), true);

  const costly = evaluatePromotion({
    candidateRun: { ...candidate, metrics: { ...candidate.metrics, averageCost: 0.8 } },
    baselineVerifierMetrics,
    approvals: approved,
    verifierPolicy: { costIncreaseThreshold: 0.2 },
  });
  assert.equal(costly.reasons.includes('verifier_cost_regression'), true);
});

test('promotion policy never self-applies shadow compaction candidates', () => {
  const approvedShadow = evaluatePromotion({
    candidateRun: candidateRun({
      candidateId: 'compaction_shadow_1',
      target: 'compaction_policy',
      status: 'shadow_only',
      directApplyAllowed: false,
      metrics: {
        quality: 0.95,
        safety: 0.98,
        cost: 0.2,
        latency: 0.2,
      },
    }),
    baselineFrontier: [
      { candidateId: 'baseline', quality: 0.8, safety: 0.9, cost: 0.5, latency: 0.4 },
    ],
    approvals: [{ candidateId: 'compaction_shadow_1', choice: 'approve', approver: 'human' }],
  });

  assert.equal(approvedShadow.status, 'rejected');
  assert.equal(approvedShadow.reasons.includes('shadow_policy_no_self_apply'), true);
  assert.equal(approvedShadow.reasons.includes('human_approved'), true);
});

test('promotion policy gates skill candidates on approval evidence safety and rollback', () => {
  const baselineFrontier = [
    { candidateId: 'baseline_skill', quality: 0.6, safety: 0.9, cost: 0.4, latency: 0.4 },
  ];
  const candidate = candidateRun({
    candidateId: 'skill_candidate_visual_debug',
    target: 'skill_candidate',
    status: 'candidate',
    smokePassed: true,
    metrics: {
      quality: 0.84,
      safety: 0.98,
      cost: 0.2,
      latency: 0.2,
      holdoutImproved: true,
      triggerPrecision: 0.86,
      averageCost: 0.2,
    },
    safety: {
      passed: true,
      secrets: false,
      promptInjection: false,
      globalWrite: false,
      provenanceCompatible: true,
    },
    rollback: {
      available: true,
      packageId: 'generated-skills',
    },
  });

  const accepted = evaluatePromotion({
    candidateRun: candidate,
    baselineFrontier,
    approvals: [{ candidateId: 'skill_candidate_visual_debug', choice: 'approve', approver: 'human' }],
  });
  assert.equal(accepted.status, 'promoted');
  assert.deepEqual(accepted.reasons, [
    'human_approved',
    'skill_holdout_improved',
    'skill_safety_clean',
    'skill_trigger_precision_ok',
    'skill_cost_ok',
    'rollback_available',
  ]);

  const missingEvidence = evaluatePromotion({
    candidateRun: {
      ...candidate,
      metrics: { ...candidate.metrics, holdoutImproved: false },
    },
    baselineFrontier,
    approvals: [{ candidateId: 'skill_candidate_visual_debug', choice: 'approve' }],
  });
  assert.equal(missingEvidence.status, 'rejected');
  assert.equal(missingEvidence.reasons.includes('missing_skill_holdout_improvement'), true);

  const unsafe = evaluatePromotion({
    candidateRun: {
      ...candidate,
      safety: { ...candidate.safety, provenanceCompatible: false },
    },
    baselineFrontier,
    approvals: [{ candidateId: 'skill_candidate_visual_debug', choice: 'approve' }],
  });
  assert.equal(unsafe.status, 'rejected');
  assert.equal(unsafe.reasons.includes('skill_provenance_incompatible'), true);
});

test('change proposal is approval-ready and blocks direct apply without approval', async () => {
  const proposal = createChangeProposal({
    candidate: {
      candidateId: 'cand_meta_001',
      target: 'tool_policy',
      rationale: 'Reduce retries after trace timeout loops.',
      patch: { files: [{ path: 'src/harness-sidecar/meta/toolPolicy.js', action: 'update' }] },
    },
    promotionDecision: { status: 'promoted', reasons: ['human_approved'] },
  });

  assert.equal(proposal.status, 'approval_required');
  assert.equal(proposal.approvalRequired, true);
  assert.equal(proposal.directApplyAllowed, false);
  assert.match(proposal.proposalId, /^proposal_/);

  await assert.rejects(
    () => applyChangeProposal({ proposal, approved: false, applyAdapter: async () => ({ applied: true }) }),
    /approval required/i,
  );
});

test('task resume reconstructs resumable state from trace events jsonl', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'helios-resume-'));
  const traceDir = path.join(workspaceRoot, '.harness', 'traces', 'task_resume');
  await mkdir(traceDir, { recursive: true });
  await writeFile(path.join(traceDir, 'events.jsonl'), [
    JSON.stringify({ type: 'task.started', taskId: 'task_resume', summary: 'Implement recovery primitives', mode: 'full' }),
    JSON.stringify({ type: 'state.updated', taskId: 'task_resume', patch: { status: 'running', step: 'meta' } }),
    JSON.stringify({ type: 'artifact.created', taskId: 'task_resume', artifacts: [{ artifactId: 'art_patch', type: 'patch_manifest' }] }),
    JSON.stringify({ type: 'approval.required', taskId: 'task_resume', actionId: 'act_1', status: 'pending' }),
    JSON.stringify({ type: 'failure.recorded', taskId: 'task_resume', category: 'tool_timeout', message: 'tool exceeded limit' }),
    JSON.stringify({ type: 'decision.recorded', taskId: 'task_resume', decision: { conclusion: 'retry' } }),
  ].join('\n'));

  try {
    const resumed = await resumeTaskFromTrace({ traceDir });
    assert.equal(resumed.taskId, 'task_resume');
    assert.equal(resumed.status, 'approval_required');
    assert.equal(resumed.task.summary, 'Implement recovery primitives');
    assert.equal(resumed.state.step, 'meta');
    assert.deepEqual(resumed.pendingApprovals.map((approval) => approval.actionId), ['act_1']);
    assert.deepEqual(resumed.artifacts.map((artifact) => artifact.artifactId), ['art_patch']);
    assert.deepEqual(resumed.failures.map((failure) => failure.category), ['tool_timeout']);
    assert.equal(resumed.decisions[0].conclusion, 'retry');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('trace compactor summarizes counts artifacts failures decisions and latest state', () => {
  const summary = compactTraceEvents([
    { type: 'task.started', taskId: 'task_compact', summary: 'Compact trace' },
    { type: 'state.updated', taskId: 'task_compact', patch: { status: 'running', phase: 'setup' } },
    { type: 'artifact.created', taskId: 'task_compact', artifacts: [{ artifactId: 'art_1', type: 'report' }] },
    { type: 'failure.recorded', taskId: 'task_compact', category: 'verifier_failed', message: 'assertion failed' },
    { type: 'decision.recorded', taskId: 'task_compact', decision: { conclusion: 'retry', reasons: ['failure'] } },
    { type: 'state.updated', taskId: 'task_compact', patch: { phase: 'retry', status: 'approval_required' } },
  ]);

  assert.deepEqual(summary.countsByType, {
    'task.started': 1,
    'state.updated': 2,
    'artifact.created': 1,
    'failure.recorded': 1,
    'decision.recorded': 1,
  });
  assert.deepEqual(summary.artifacts, [{ artifactId: 'art_1', type: 'report' }]);
  assert.deepEqual(summary.failures, [{ category: 'verifier_failed', message: 'assertion failed' }]);
  assert.deepEqual(summary.decisions, [{ conclusion: 'retry', reasons: ['failure'] }]);
  assert.deepEqual(summary.latestState, { status: 'approval_required', phase: 'retry' });
});
