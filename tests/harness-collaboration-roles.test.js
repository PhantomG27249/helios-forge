import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideRoleApproval } from '../src/harness-sidecar/collaboration/rolePolicy.js';

test('owner can approve high-risk actions', () => {
  const decision = decideRoleApproval({
    role: 'owner',
    action: 'merge_champion',
    risk: 'high',
  });

  assert.deepEqual(decision, {
    allowed: true,
    reason: 'role_permits_action',
    requiredRole: 'owner',
  });
});

test('researcher can approve medium-risk actions but not high-risk actions', () => {
  const medium = decideRoleApproval({
    role: 'researcher',
    action: 'run_experiment',
    risk: 'medium',
  });
  const high = decideRoleApproval({
    role: 'researcher',
    action: 'merge_champion',
    risk: 'high',
  });

  assert.equal(medium.allowed, true);
  assert.equal(medium.requiredRole, 'researcher');
  assert.deepEqual(high, {
    allowed: false,
    reason: 'requires_owner',
    requiredRole: 'owner',
  });
});

test('reviewer can approve memory writes and final reports', () => {
  const memoryWrite = decideRoleApproval({
    role: 'reviewer',
    action: 'memory_write',
  });
  const finalReport = decideRoleApproval({
    role: 'reviewer',
    action: 'final_report',
  });

  assert.equal(memoryWrite.allowed, true);
  assert.equal(memoryWrite.requiredRole, 'reviewer');
  assert.equal(finalReport.allowed, true);
  assert.equal(finalReport.requiredRole, 'reviewer');
});

test('observer cannot approve mutations', () => {
  const decision = decideRoleApproval({
    role: 'observer',
    action: 'edit_workspace',
    risk: 'low',
  });

  assert.deepEqual(decision, {
    allowed: false,
    reason: 'observer_read_only',
    requiredRole: 'researcher',
  });
});
