import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  quarantineModelVisiblePayload,
  redactModelVisibleValue,
} from '../src/harness-sidecar/security/modelVisibleQuarantine.js';

test('model-visible quarantine redacts secret-shaped strings recursively', () => {
  const result = quarantineModelVisiblePayload({
    summary: 'ok',
    nested: {
      prompt: 'Use token=ghp_should_not_leak and Authorization: Bearer abc123',
      headers: { Authorization: 'Bearer raw-secret' },
    },
  });

  const serialized = JSON.stringify(result.value);
  assert.equal(result.quarantined, true);
  assert.equal(serialized.includes('ghp_should_not_leak'), false);
  assert.equal(serialized.includes('abc123'), false);
  assert.equal(serialized.includes('raw-secret'), false);
  assert.equal(result.reasons.includes('secret_like_value'), true);
});

test('model-visible quarantine blocks absolute paths and traversal paths', () => {
  const result = quarantineModelVisiblePayload({
    artifactPath: 'C:\\Users\\jackj\\secret\\trace.json',
    fixtureRef: '../outside/secret.txt',
    safeRef: 'fixtures/case-1.json',
  });

  assert.equal(result.value.artifactPath, '[redacted:path]');
  assert.equal(result.value.fixtureRef, '[redacted:path]');
  assert.equal(result.value.safeRef, 'fixtures/case-1.json');
  assert.equal(result.reasons.includes('unsafe_path_value'), true);
});

test('model-visible quarantine summarizes oversized payload text', () => {
  const longText = `prefix-${'x'.repeat(600)}`;
  const result = quarantineModelVisiblePayload({ report: longText }, { maxStringLength: 80 });

  assert.equal(result.value.report.length <= 100, true);
  assert.match(result.value.report, /\[truncated/);
  assert.equal(result.reasons.includes('oversize_text_value'), true);
});

test('model-visible quarantine prevents external verification escalation and authority claims', () => {
  const result = quarantineModelVisiblePayload({
    external: true,
    verified: true,
    approved: true,
    canPromote: true,
    apply: true,
    promotionAllowed: true,
  });

  assert.equal(result.value.verified, false);
  assert.equal(result.value.approved, false);
  assert.equal(result.value.canPromote, false);
  assert.equal(result.value.apply, false);
  assert.equal(result.value.promotionAllowed, false);
  assert.equal(result.reasons.includes('external_verification_escalation'), true);
  assert.equal(result.reasons.includes('authority_claim_removed'), true);
});

test('model-visible quarantine removes repo authority vocabulary variants', () => {
  const result = quarantineModelVisiblePayload({
    directApplyAllowed: true,
    promotionAuthority: true,
    approval_authority: true,
    durableApplyApproved: true,
    canMutateWorkspace: true,
    authority: 'admin',
    authorityLevel: 'self_authorizing',
    workspaceWriteScope: 'global',
  });

  assert.equal(result.value.directApplyAllowed, false);
  assert.equal(result.value.promotionAuthority, false);
  assert.equal(result.value.approval_authority, false);
  assert.equal(result.value.durableApplyApproved, false);
  assert.equal(result.value.canMutateWorkspace, false);
  assert.equal(result.value.authority, 'evidence_only');
  assert.equal(result.value.authorityLevel, 'evidence_only');
  assert.equal(result.value.workspaceWriteScope, 'none');
  assert.equal(result.reasons.includes('authority_claim_removed'), true);
});

test('model-visible quarantine blocks embedded unix absolute paths in prose', () => {
  const result = quarantineModelVisiblePayload({
    note: 'see /etc/passwd for host users',
  });

  assert.equal(result.value.note, '[redacted:path]');
  assert.equal(result.reasons.includes('unsafe_path_value'), true);
});

test('model-visible quarantine preserves route-like slash text', () => {
  const result = quarantineModelVisiblePayload({
    diagnostic: 'GET /v1/models returned 200',
    route: '/api/harness/status',
  });

  assert.equal(result.quarantined, false);
  assert.equal(result.value.diagnostic, 'GET /v1/models returned 200');
  assert.equal(result.value.route, '/api/harness/status');
});

test('redactModelVisibleValue returns sanitized values without metadata', () => {
  assert.equal(redactModelVisibleValue('api_key=sk-test-secret'), 'api_key=[redacted]');
});
