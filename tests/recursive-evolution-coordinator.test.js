import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coordinateRecursiveEvolution } from '../src/harness-sidecar/meta/recursiveEvolutionCoordinator.js';

test('coordinator merges replay, campaign, and promotion evidence into one envelope', () => {
  const envelope = coordinateRecursiveEvolution({
    replayReports: [{
      replayId: 'replay_1',
      suiteId: 'code-smoke',
      passed: true,
      regressions: [],
    }],
    campaignResults: [{
      campaignId: 'paper_gap_campaign',
      cycles: [{ candidate: { candidateId: 'meta_candidate_0' } }],
      frontier: [{ candidateId: 'meta_candidate_0' }],
    }],
    promotionLoopResult: {
      candidate: { candidateId: 'tool_policy_1', canPromote: true },
      decision: { status: 'rejected', reasons: ['approval_required'] },
      candidateRun: { metrics: { quality: 0.8, safety: 0.95 } },
    },
  });

  assert.equal(envelope.evidenceOnly, true);
  assert.equal(envelope.canPromote, false);
  assert.equal(envelope.promotionAuthority, false);
  assert.equal(envelope.activeWorkspaceMutation, false);
  assert.equal(envelope.replayReports.length, 1);
  assert.equal(envelope.campaignResults.length, 1);
  assert.equal(envelope.promotionLoopResult.candidate.canPromote, false);
  assert.equal(envelope.promotionLoopResult.candidate.promotionAuthority, false);
  assert.equal(envelope.sources.includes('replay'), true);
  assert.equal(envelope.sources.includes('campaign'), true);
  assert.equal(envelope.sources.includes('promotion_loop'), true);
});

test('coordinator tolerates missing evidence sources', () => {
  const envelope = coordinateRecursiveEvolution({
    replayReports: [],
    campaignResults: [],
    promotionLoopResult: null,
  });

  assert.equal(envelope.evidenceOnly, true);
  assert.equal(envelope.canPromote, false);
  assert.deepEqual(envelope.replayReports, []);
  assert.deepEqual(envelope.campaignResults, []);
  assert.equal(envelope.promotionLoopResult, null);
  assert.deepEqual(envelope.sources, []);
});

test('coordinator strips nested promotion claims from campaign cycles', () => {
  const envelope = coordinateRecursiveEvolution({
    campaignResults: [{
      campaignId: 'claim_campaign',
      cycles: [{
        candidate: {
          candidateId: 'claim_candidate',
          canPromote: true,
          promotionAuthority: true,
          applied: true,
        },
        promotion: {
          canPromote: true,
          activeWorkspaceMutation: true,
        },
      }],
    }],
  });

  assert.equal(envelope.campaignResults[0].cycles[0].candidate.canPromote, false);
  assert.equal(envelope.campaignResults[0].cycles[0].candidate.promotionAuthority, false);
  assert.equal(envelope.campaignResults[0].cycles[0].candidate.applied, false);
  assert.equal(envelope.campaignResults[0].cycles[0].promotion.canPromote, false);
  assert.equal(envelope.campaignResults[0].cycles[0].promotion.activeWorkspaceMutation, false);
});
