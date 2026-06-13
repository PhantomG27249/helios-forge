import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ICR_AGENT_ROLES,
  ICR_ARTIFACT_TYPES,
  ICR_DEFAULT_CONFIG,
  assertIcrEvidenceOnly,
  getIcrRoleContextPolicy,
  normalizeIcrConfig,
} from '../src/harness-sidecar/icr/icrContracts.js';

test('exports deterministic ICR defaults and stable contract constants', () => {
  assert.deepEqual(ICR_DEFAULT_CONFIG, {
    lane: 'icr',
    branchBreadth: 5,
    correctionDepth: 10,
    hypothesisCount: 6,
    hypothesisRefreshInterval: 2,
    pqfInterval: 4,
    distillationInterval: 5,
    solutionPoolSize: 8,
    maxComputeMultiplier: 40,
    maxContextTokens: 140000,
    evidenceOnly: true,
    promotionAllowed: false,
  });
  assert.equal(Object.isFrozen(ICR_DEFAULT_CONFIG), true);

  assert.deepEqual(ICR_AGENT_ROLES, {
    strategy: 'strategy',
    hypothesis: 'hypothesis',
    executor: 'executor',
    critique: 'critique',
    correction: 'correction',
    pqf: 'pqf',
    distiller: 'distiller',
    finalJudge: 'final_judge',
  });

  assert.equal(ICR_ARTIFACT_TYPES.branchTrace, 'branch_trace');
  assert.equal(ICR_ARTIFACT_TYPES.hypothesisPacket, 'hypothesis_packet');
  assert.equal(ICR_ARTIFACT_TYPES.solutionPool, 'solution_pool');
  assert.equal(ICR_ARTIFACT_TYPES.pqfRecord, 'pqf_record');
  assert.equal(ICR_ARTIFACT_TYPES.blindJudgment, 'blind_judgment');
});

test('normalizes ICR config while preserving evidence-only authority', () => {
  const config = normalizeIcrConfig({
    branchBreadth: 3,
    correctionDepth: 7,
    maxContextTokens: 32000,
  });

  assert.deepEqual(config, {
    ...ICR_DEFAULT_CONFIG,
    branchBreadth: 3,
    correctionDepth: 7,
    maxContextTokens: 32000,
  });
  assert.equal(Object.isFrozen(config), true);
  assert.notEqual(config, ICR_DEFAULT_CONFIG);
});

test('rejects invalid ICR bounds with deterministic errors', () => {
  assert.throws(
    () => normalizeIcrConfig({ correctionDepth: 0 }),
    /ICR correctionDepth must be >= 1/,
  );
  assert.throws(
    () => normalizeIcrConfig({ correctionDepth: -1 }),
    /ICR correctionDepth must be >= 1/,
  );
  assert.throws(
    () => normalizeIcrConfig({ branchBreadth: 0 }),
    /ICR branchBreadth must be >= 1/,
  );
  assert.throws(
    () => normalizeIcrConfig({ maxContextTokens: Infinity }),
    /ICR maxContextTokens must be finite and bounded/,
  );
  assert.throws(
    () => normalizeIcrConfig({ promotionAllowed: true }),
    /ICR promotion authority is not allowed/,
  );
  assert.throws(
    () => normalizeIcrConfig({ canPromote: true }),
    /ICR promotion authority is not allowed/,
  );
  assert.throws(
    () => normalizeIcrConfig({ promotion: { allowed: true } }),
    /ICR promotion authority is not allowed/,
  );
  assert.throws(
    () => normalizeIcrConfig({ evidenceOnly: false }),
    /ICR evidenceOnly must remain true/,
  );
});

test('final judge context policy stays blind to branch internals', () => {
  const policy = getIcrRoleContextPolicy(ICR_AGENT_ROLES.finalJudge);

  assert.equal(policy.role, 'final_judge');
  assert.deepEqual(policy.allowedContext, [
    'candidate_solutions',
    'candidate_ids',
    'visible_metrics',
    'task_rubric',
  ]);
  assert.deepEqual(policy.excludedContext, [
    'branch_memory',
    'critique_records',
    'pqf_records',
    'replaced_branches',
    'hypothesis_history',
  ]);
  assert.equal(policy.blindJudge, true);

  for (const hiddenKind of policy.excludedContext) {
    assert.equal(policy.allowedContext.includes(hiddenKind), false);
  }
});

test('asserts ICR records remain evidence-only and non-promoting', () => {
  const record = {
    lane: 'icr',
    evidenceOnly: true,
    promotionAllowed: false,
    authority: 'evidence_only',
    canPromote: false,
  };

  assert.equal(assertIcrEvidenceOnly(record), record);
  assert.throws(
    () => assertIcrEvidenceOnly({ ...record, evidenceOnly: false }),
    /ICR record must be evidence-only/,
  );
  assert.throws(
    () => assertIcrEvidenceOnly({ ...record, promotionAllowed: true }),
    /ICR record cannot allow promotion/,
  );
  assert.throws(
    () => assertIcrEvidenceOnly({ ...record, authority: 'approval' }),
    /ICR record authority must be evidence_only/,
  );
});
