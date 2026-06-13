import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  estimateIcrCompute,
  extractIcrBottlenecks,
  sanitizeIcrEvidenceForDashboard,
  summarizeIcrEvidence,
} from '../src/harness-sidecar/icr/icrEvidence.js';

function sampleIcrRecord(overrides = {}) {
  return {
    kind: 'icr_candidate_family',
    lane: 'icr',
    taskId: 'task-icr-evidence',
    candidateFamilyId: 'family-1',
    branches: [
      {
        kind: 'icr_branch_trace',
        branchId: 'branch-a',
        iterations: [
          {
            iterationIndex: 1,
            candidateId: 'cand-a-1',
            candidateText: 'candidate with token=sk-should-redact from C:\\Users\\jackj\\secret-plan.md',
            critiqueSummary: 'private critique that must not reach dashboard',
            artifactIds: { executor: 'artifact-a-1' },
          },
          {
            iterationIndex: 2,
            candidateId: 'cand-a-2',
            candidateText: 'candidate with password=hunter2',
            correctionSummary: 'private correction that must not reach dashboard',
            artifactIds: { executor: 'artifact-a-2' },
          },
        ],
        activeHypotheses: ['secret hypothesis must stay audit-only'],
        hypothesisHistory: [{ text: 'hidden hypothesis history' }],
        branchMemory: [{ text: 'hidden branch memory' }],
        critiqueRecords: [{ text: 'hidden critique record' }],
        pqfRecords: [
          { pqfId: 'pqf-1', kept: true, note: 'keep C:/Users/jackj/private.txt' },
          { pqfId: 'pqf-2', replaced: true, note: 'replace with api_key=plain-secret' },
        ],
        distillationRecords: [
          { distillationId: 'distill-1', summary: 'compact branch memory' },
        ],
        finalCandidate: { candidateId: 'cand-a-2', text: 'final branch candidate' },
        evidenceOnly: true,
        promotionAllowed: false,
      },
      {
        kind: 'icr_branch_trace',
        branchId: 'branch-b',
        iterations: [
          {
            iterationIndex: 1,
            candidateId: 'cand-b-1',
            candidateText: 'safe candidate',
            artifactIds: { executor: 'artifact-b-1' },
          },
        ],
        pqfRecords: [{ pqfId: 'pqf-3', action: 'keep' }],
        distillationRecords: [],
        finalCandidate: 'cand-b-1',
        evidenceOnly: true,
        promotionAllowed: false,
      },
    ],
    solutionPool: {
      candidates: [
        { candidateId: 'cand-a-2', branchId: 'branch-a', text: 'visible solution A' },
        { candidateId: 'cand-b-1', branchId: 'branch-b', text: 'visible solution B' },
      ],
      replacedBranches: [{ branchId: 'branch-secret', reason: 'hidden replaced branch' }],
    },
    finalJudgePacket: {
      candidates: [
        { candidateId: 'cand-a-2', branchId: 'branch-a', text: 'visible solution A' },
        { candidateId: 'cand-b-1', branchId: 'branch-b', text: 'visible solution B' },
      ],
      hiddenFromJudge: [
        'branch_memory',
        'critique_records',
        'pqf_records',
        'replaced_branches',
        'hypothesis_history',
      ],
    },
    finalCandidateId: 'cand-a-2',
    auditRefs: [{ artifactId: 'artifact-family-1', path: 'runs/icr/family-1.jsonl' }],
    config: {
      maxContextTokens: 100,
      maxComputeMultiplier: 4,
    },
    contextTokenEstimate: 160,
    evidenceOnly: true,
    promotionAllowed: false,
    ...overrides,
  };
}

test('summarizes ICR evidence with required metrics and evidence-only authority', () => {
  const summary = summarizeIcrEvidence(sampleIcrRecord());

  assert.equal(summary.branchCount, 2);
  assert.equal(summary.iterationCount, 3);
  assert.equal(summary.solutionPoolCount, 2);
  assert.equal(summary.pqfKeptCount, 2);
  assert.equal(summary.pqfReplacedCount, 1);
  assert.equal(summary.distillationCount, 1);
  assert.equal(summary.finalCandidateId, 'cand-a-2');
  assert.equal(summary.computeMultiplierEstimate, 5);
  assert.equal(summary.contextTokenEstimate, 160);
  assert.equal(summary.contextOverflowRisk, true);
  assert.equal(summary.costGateStatus, 'exceeded');
  assert.equal(summary.evidenceOnly, true);
  assert.equal(summary.promotionAllowed, false);
  assert.equal(summary.quarantine.required, true);
  assert.equal(summary.quarantine.reasons.includes('context_overflow_risk'), true);
  assert.equal(summary.quarantine.reasons.includes('compute_multiplier_exceeded'), true);
});

test('sanitizes dashboard evidence without leaking secrets paths or hidden judge-forbidden context', () => {
  const dashboard = sanitizeIcrEvidenceForDashboard(sampleIcrRecord(), {
    maxContextTokens: 500,
    maxComputeMultiplier: 10,
  });
  const serialized = JSON.stringify(dashboard);

  assert.equal(dashboard.kind, 'icr_dashboard_evidence_summary');
  assert.equal(dashboard.evidenceOnly, true);
  assert.equal(dashboard.promotionAllowed, false);
  assert.deepEqual(dashboard.branchIds, ['branch-a', 'branch-b']);
  assert.deepEqual(dashboard.auditRefs, [{ artifactId: 'artifact-family-1', path: 'runs/icr/family-1.jsonl' }]);
  assert.equal(serialized.includes('sk-should-redact'), false);
  assert.equal(serialized.includes('hunter2'), false);
  assert.equal(serialized.includes('plain-secret'), false);
  assert.equal(serialized.includes('C:\\Users\\jackj'), false);
  assert.equal(serialized.includes('C:/Users/jackj'), false);
  assert.equal(serialized.includes('hidden branch memory'), false);
  assert.equal(serialized.includes('hidden critique record'), false);
  assert.equal(serialized.includes('hidden hypothesis history'), false);
  assert.equal(serialized.includes('hidden replaced branch'), false);
  assert.equal(serialized.includes('private critique'), false);
  assert.equal(serialized.includes('private correction'), false);
});

test('estimates compute and token risks from records and config gates', () => {
  const safe = estimateIcrCompute(sampleIcrRecord({ contextTokenEstimate: 120 }), {
    maxContextTokens: 200,
    maxComputeMultiplier: 8,
  });
  const risky = estimateIcrCompute(sampleIcrRecord({ contextTokenEstimate: 220 }), {
    maxContextTokens: 200,
    maxComputeMultiplier: 4,
  });

  assert.deepEqual(safe, {
    branchCount: 2,
    iterationCount: 3,
    solutionPoolCount: 2,
    distillationCount: 1,
    computeMultiplierEstimate: 5,
    contextTokenEstimate: 120,
    contextOverflowRisk: false,
    costGateStatus: 'within_limit',
  });
  assert.equal(risky.contextOverflowRisk, true);
  assert.equal(risky.costGateStatus, 'exceeded');
});

test('extracts bottlenecks for quarantine promotion claims and token or cost risk', () => {
  const bottlenecks = extractIcrBottlenecks(sampleIcrRecord({
    evidenceOnly: false,
    promotionAllowed: true,
    quarantine: { required: true, reasons: ['tool_execution_quarantined'] },
  }), {
    maxContextTokens: 100,
    maxComputeMultiplier: 4,
  });

  assert.deepEqual(bottlenecks, [
    'evidence_only_violation',
    'promotion_claim_present',
    'context_overflow_risk',
    'compute_multiplier_exceeded',
    'tool_execution_quarantined',
  ]);
});
