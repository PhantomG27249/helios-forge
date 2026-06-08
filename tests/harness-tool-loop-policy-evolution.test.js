import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateToolLoopPolicyCandidate,
  proposeToolLoopPolicies,
} from '../src/harness-sidecar/meta/toolLoopPolicyEvolution.js';
import { runToolLoop } from '../src/harness-sidecar/tools/toolLoopController.js';

test('tool loop policy evolution promotes unknown-tool and malformed-json failures into hard cases', () => {
  const candidates = proposeToolLoopPolicies({
    coreset: [
      { caseId: 'unknown_tool_case', reason: 'unknown_tool', tool: 'ghost.run' },
      { caseId: 'repair_case', reason: 'malformed_json_repair_failed' },
    ],
  });

  assert.equal(candidates[0].status, 'shadow_only');
  assert.deepEqual(candidates[0].sourceCaseIds, ['unknown_tool_case', 'repair_case']);
  assert.equal(candidates[0].hardCaseReasons.includes('unknown_tool'), true);
  assert.equal(candidates[0].hardCaseReasons.includes('malformed_json_repair_failed'), true);
});

test('tool loop policy candidates include retry limits approval thresholds and safe fallback tools', () => {
  const [candidate] = proposeToolLoopPolicies({
    coreset: [{ caseId: 'tool_retry', reason: 'tool_error', tool: 'shell.run' }],
    baselinePolicy: {
      maxRepairAttempts: 1,
      maxSameToolRetries: 1,
      approvalEscalation: 'risky_tools',
      safeFallbackTools: ['verifier.run'],
    },
  });

  assert.equal(Number.isInteger(candidate.maxRepairAttempts), true);
  assert.equal(Number.isInteger(candidate.maxSameToolRetries), true);
  assert.equal(candidate.approvalEscalation, 'risky_tools');
  assert.deepEqual(candidate.safeFallbackTools, ['verifier.run']);
  assert.equal(candidate.status, 'shadow_only');
});

test('tool loop evaluator refuses unsafe fallback expansion from promotion', () => {
  const decision = evaluateToolLoopPolicyCandidate({
    candidate: {
      maxRepairAttempts: 2,
      maxSameToolRetries: 2,
      approvalEscalation: 'risky_tools',
      safeFallbackTools: ['verifier.run', 'shell.write'],
      status: 'shadow_only',
    },
    traceCase: { reason: 'unknown_tool', recoveredByFallback: true },
  });

  assert.equal(decision.promotable, false);
  assert.equal(decision.safety.status, 'denied');
  assert.equal(decision.reasons.includes('unsafe_tool_expansion_denied'), true);
});

test('tool loop accepts optional policy input while preserving omitted defaults', async () => {
  const calls = [];
  const modelGateway = {
    async call() {
      calls.push('call');
      return { text: 'done' };
    },
  };

  const defaultRun = await runToolLoop({ taskId: 'task_policy_default', modelGateway });
  const policyRun = await runToolLoop({
    taskId: 'task_policy_shadow',
    modelGateway,
    policy: { policyId: 'tool_policy_shadow', maxIterations: 3, status: 'shadow_only' },
  });

  assert.equal(defaultRun.status, 'completed');
  assert.equal(defaultRun.policy, undefined);
  assert.deepEqual(policyRun.policy, {
    policyId: 'tool_policy_shadow',
    status: 'shadow_only',
    mode: 'metadata_only',
  });
});
