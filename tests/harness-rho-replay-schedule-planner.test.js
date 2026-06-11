import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planRhoReplaySchedule } from '../src/harness-sidecar/rho/replaySchedulePlanner.js';

const domains = ['code', 'research', 'memory', 'visual', 'tool', 'swarm', 'safety'];

function caseFor(domain, suffix = 'primary', extra = {}) {
  return {
    id: `${domain}-${suffix}`,
    domain,
    difficulty: suffix === 'primary' ? 0.9 : 0.55,
    diversityKey: `${domain}-${suffix}`,
    ...extra,
  };
}

test('plans replay coverage across every major RHO domain', () => {
  const now = new Date('2026-06-11T20:00:00.000Z');
  const cases = domains.flatMap((domain) => [
    caseFor(domain, 'primary'),
    caseFor(domain, 'secondary'),
  ]);

  const schedule = planRhoReplaySchedule({
    cases,
    cadence: { interval: 'daily', groupSize: 2 },
    budget: { maxCases: 14, maxCasesPerDomain: 2 },
    now,
  });

  assert.equal(schedule.scheduleId, 'rho_replay_2026-06-11T20-00-00-000Z_daily');
  assert.equal(schedule.generatedAt, now.toISOString());
  assert.equal(schedule.evidenceOnly, true);
  assert.equal(schedule.promotionAllowed, false);
  assert.deepEqual(schedule.coverage.missingDomains, []);
  assert.deepEqual(schedule.coverage.domains, domains);
  assert.equal(schedule.replayInputs.groupSize, 2);
  assert.deepEqual(
    schedule.replayInputs.coreset.items.map((entry) => entry.domain),
    domains.flatMap((domain) => [domain, domain]),
  );
});

test('folds suite cases into the schedule without changing replay semantics', () => {
  const schedule = planRhoReplaySchedule({
    cases: [caseFor('code')],
    suites: [
      {
        id: 'heldout-production',
        cadence: 'weekly',
        domains: ['research', 'memory'],
        cases: [
          caseFor('research', 'suite', { id: 'research-suite-case' }),
          caseFor('memory', 'suite', { id: 'memory-suite-case' }),
        ],
      },
    ],
    cadence: 'weekly',
    budget: { maxCases: 3, maxCasesPerDomain: 1 },
    now: '2026-06-11T20:30:00.000Z',
  });

  assert.deepEqual(
    schedule.replayInputs.coreset.items.map((entry) => entry.id),
    ['code-primary', 'research-suite-case', 'memory-suite-case'],
  );
  assert.deepEqual(
    schedule.replayInputs.coreset.items.map((entry) => entry.suiteId),
    [null, 'heldout-production', 'heldout-production'],
  );
  assert.equal(schedule.replayInputs.coreset.selectedCount, 3);
  assert.equal(schedule.replayInputs.coreset.totalCandidates, 3);
  assert.equal(schedule.replayInputs.candidateRunner, undefined);
  assert.equal(schedule.replayInputs.baselineRunner, undefined);
});

test('keeps quarantined cases out of promotion replay evidence', () => {
  const schedule = planRhoReplaySchedule({
    cases: [
      caseFor('code'),
      caseFor('safety', 'external-a2a', {
        quarantined: true,
        quarantineReason: 'external_unverified',
        verified: false,
      }),
      caseFor('visual', 'quarantined-vlm', {
        quarantine: { reason: 'missing_artifact_hash' },
      }),
    ],
    cadence: { interval: 'hourly', groupSize: 1 },
    budget: { maxCases: 5, maxQuarantineCases: 5 },
    now: '2026-06-11T21:00:00.000Z',
  });

  assert.deepEqual(
    schedule.replayInputs.coreset.items.map((entry) => entry.id),
    ['code-primary'],
  );
  assert.deepEqual(
    schedule.quarantineReplayInputs.coreset.items.map((entry) => entry.id),
    ['visual-quarantined-vlm', 'safety-external-a2a'],
  );
  assert.deepEqual(
    schedule.quarantineBlocks.map((block) => block.caseId),
    ['visual-quarantined-vlm', 'safety-external-a2a'],
  );
  assert.equal(
    schedule.quarantineReplayInputs.coreset.items.every((entry) => entry.promotionEvidenceEligible === false),
    true,
  );
  assert.equal(
    schedule.replayInputs.coreset.items.some((entry) => entry.quarantined === true),
    false,
  );
});
