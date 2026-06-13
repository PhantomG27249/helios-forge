import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getBesLaneContract } from '../src/harness-sidecar/bes/laneContracts.js';
import { normalizeLaneEvidence } from '../src/harness-sidecar/bes/laneEvidence.js';
import { runBesLaneRuntime } from '../src/harness-sidecar/bes/laneRuntime.js';

test('returns the ICR BES lane contract with evidence-only fusion metadata', () => {
  const contract = getBesLaneContract('icr');

  assert.equal(contract.lane, 'icr');
  assert.equal(contract.candidateUnit, 'test_time_compute_policy');
  assert.equal(contract.verifierUnit, 'icr_eval');
  assert.deepEqual(contract.artifacts, [
    'branch_trace',
    'hypothesis_packet',
    'solution_pool',
    'pqf_record',
    'blind_judgment',
  ]);
  assert.equal(contract.fusion.kind, 'icr_branch_fusion');
  assert.equal(contract.fusion.evidenceOnly, true);
  assert.equal(contract.fusion.promotionAuthority, false);
  assert.equal(contract.fusion.forward.role, 'generate_candidate_evidence');
  assert.equal(contract.fusion.backward.role, 'decompose_and_verify_subgoals');
  assert.equal(contract.denseVerifierContract.verifierUnit, 'icr_eval');
  assert.equal(contract.denseVerifierContract.evidenceOnly, true);
  assert.equal(contract.denseVerifierContract.promotionAuthority, false);
});

test('keeps existing BES lane contracts unchanged while adding ICR', () => {
  const code = getBesLaneContract('code');
  const harness = getBesLaneContract('harness');

  assert.equal(code.candidateUnit, 'patch_policy');
  assert.equal(code.verifierUnit, 'test_eval');
  assert.deepEqual(code.artifacts, ['patch', 'tests', 'diff']);
  assert.equal(code.fusion.kind, 'patch_test_fusion');
  assert.equal(harness.candidateUnit, 'harness_configuration');
  assert.equal(harness.verifierUnit, 'harness_experiment_eval');
  assert.equal(harness.fusion.kind, 'experiment_frontier_fusion');
});

test('normalizes sanitized ICR lane evidence without granting promotion authority', () => {
  const evidence = normalizeLaneEvidence({
    icrEvidence: {
      lane: 'icr',
      candidateFamilyId: 'icr-family-1',
      branches: [
        {
          branchId: 'branch-a',
          iterations: [
            {
              candidateId: 'candidate-a',
              candidateText: 'hidden token=sk-should-redact',
              critiqueSummary: 'hidden critique',
            },
          ],
          pqfRecords: [{ pqfId: 'pqf-1', kept: true }],
        },
      ],
      solutionPool: {
        candidates: [{ candidateId: 'candidate-a', branchId: 'branch-a', text: 'visible solution' }],
      },
      finalCandidateId: 'candidate-a',
      contextTokenEstimate: 10,
      evidenceOnly: true,
      promotionAllowed: false,
    },
  });

  assert.equal(evidence.hasRequiredEvidence, true);
  assert.equal(evidence.sources.includes('icr_evidence'), true);
  assert.deepEqual(evidence.summary.icr, {
    branchCount: 1,
    iterationCount: 1,
    solutionPoolCount: 1,
    pqfKeptCount: 1,
    pqfReplacedCount: 0,
    finalCandidateId: 'candidate-a',
    evidenceOnly: true,
    promotionAllowed: false,
  });
  assert.equal(JSON.stringify(evidence).includes('sk-should-redact'), false);
  assert.equal(JSON.stringify(evidence).includes('hidden critique'), false);
});

test('runs ICR candidates through BES lane runtime without bespoke promotion logic', async () => {
  const result = await runBesLaneRuntime({
    lane: 'icr',
    taskId: 'task-icr-bes-runtime',
    candidates: [
      {
        candidateId: 'icr-policy-1',
        status: 'shadow_only',
        rationale: ['branch exploration and blind judging are attached as evidence'],
        externalPolicyEvidence: {
          policyDecisionId: 'policy-icr-review-1',
          verdict: 'eligible_for_review',
        },
      },
    ],
    denseSubgoals: [
      { id: 'branch-evidence', lane: 'icr', requiredEvidence: 'branch exploration' },
    ],
    evaluator: ({ contract }) => ({
      score: 0.82,
      reasons: [`${contract.verifierUnit} observed branch exploration evidence`],
    }),
  });

  const candidate = result.candidates[0];

  assert.equal(result.lane, 'icr');
  assert.equal(result.contract.candidateUnit, 'test_time_compute_policy');
  assert.equal(candidate.lane, 'icr');
  assert.equal(candidate.bes.fusion.kind, 'icr_branch_fusion');
  assert.equal(candidate.bes.denseSubgoals.verifierUnit, 'icr_eval');
  assert.equal(candidate.evidence.sources.includes('domain_eval'), true);
  assert.equal(candidate.evidence.sources.includes('dense_subgoals'), true);
  assert.equal(candidate.evidence.sources.includes('external_policy_evidence'), true);
  assert.equal(candidate.promotion.allowed, false);
  assert.deepEqual(candidate.promotion.blockedReasons, ['evidence_only_lane']);
  assert.equal(candidate.contract.fusion.promotionAuthority, false);
});

test('BES lane runtime carries sanitized ICR evidence summaries from candidates', async () => {
  const result = await runBesLaneRuntime({
    lane: 'icr',
    taskId: 'task-icr-evidence-runtime',
    candidates: [
      {
        candidateId: 'icr-policy-evidence',
        status: 'shadow_only',
        rationale: ['candidate family evidence attached'],
        icrEvidence: {
          lane: 'icr',
          branches: [
            {
              branchId: 'branch-a',
              iterations: [{ candidateText: 'secret token=sk-should-redact' }],
              pqfRecords: [{ pqfId: 'pqf-1', kept: true }],
            },
          ],
          solutionPool: {
            candidates: [{ candidateId: 'candidate-a', branchId: 'branch-a', text: 'visible solution' }],
          },
          finalCandidateId: 'candidate-a',
          evidenceOnly: true,
          promotionAllowed: false,
        },
        externalPolicyEvidence: {
          policyDecisionId: 'policy-icr-review-2',
        },
      },
    ],
    evaluator: () => ({ score: 0.7, reasons: ['candidate family evidence attached'] }),
  });

  const evidence = result.candidates[0].evidence;
  assert.equal(evidence.sources.includes('icr_evidence'), true);
  assert.equal(evidence.summary.icr.branchCount, 1);
  assert.equal(evidence.summary.icr.finalCandidateId, 'candidate-a');
  assert.equal(JSON.stringify(evidence).includes('sk-should-redact'), false);
});
