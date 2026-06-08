import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import {
  createApprovalResumeStore,
  executeApprovedApplyAction,
} from '../src/harness-sidecar/core/approvalResume.js';

test('approval resume store runs approved resume exactly once and returns cached result', async () => {
  const events = [];
  const calls = [];
  const store = createApprovalResumeStore({
    emitEvent: async (event) => events.push(event),
  });

  store.register({
    actionId: 'act_resume',
    taskId: 'task_resume',
    kind: 'tool_call',
    payload: { tool: 'verifier' },
    resume: async (context) => {
      calls.push(context);
      return { continued: true, toolCallId: context.toolCallId };
    },
  });

  const first = await store.resolve('act_resume', 'approve', { toolCallId: 'call_1' });
  const second = await store.resolve('act_resume', 'approve', { toolCallId: 'call_2' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { toolCallId: 'call_1' });
  assert.equal(first.status, 'resolved');
  assert.equal(first.resumeRan, true);
  assert.deepEqual(first.resumeResult, { continued: true, toolCallId: 'call_1' });
  assert.equal(second.status, 'resolved');
  assert.equal(second.resumeRan, false);
  assert.deepEqual(second.resumeResult, first.resumeResult);
  assert.equal(events.some((event) => event.type === 'approval.resume_completed'), true);
});

test('approval resume store reject resolves without running resume', async () => {
  let resumeCalls = 0;
  const store = createApprovalResumeStore();

  store.register({
    actionId: 'act_reject',
    taskId: 'task_reject',
    kind: 'tool_call',
    resume: async () => {
      resumeCalls += 1;
      return { continued: true };
    },
  });

  const result = await store.resolve('act_reject', 'reject', { actor: 'human' });

  assert.equal(result.status, 'rejected');
  assert.equal(result.choice, 'reject');
  assert.equal(result.resumeRan, false);
  assert.equal(result.resumeResult, undefined);
  assert.equal(resumeCalls, 0);
  assert.equal(store.get('act_reject').status, 'rejected');
});

test('approval resume store returns not found for missing actions', async () => {
  const store = createApprovalResumeStore();

  const result = await store.resolve('act_missing', 'approve');

  assert.deepEqual(result, {
    actionId: 'act_missing',
    status: 'not_found',
  });
});

test('approved champion apply action requires approval before invoking adapter', async () => {
  const calls = [];
  const workspaceRoot = path.resolve('C:/workspace/helios-forge');
  const action = {
    actionId: 'act_champion',
    taskId: 'task_champion',
    kind: 'champion_apply',
    payload: {
      champion: {
        attemptId: 'attempt_apply',
        patch: 'diff --git a/src/harness-sidecar/core/approvalResume.js b/src/harness-sidecar/core/approvalResume.js\n+ok\n',
      },
    },
  };

  const result = await executeApprovedApplyAction({
    action,
    approved: false,
    workspaceRoot,
    applyAdapter: async (input) => {
      calls.push(input);
      return { applied: true };
    },
  });

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'approval_required');
  assert.equal(calls.length, 0);
});

test('approved champion apply action uses injected adapter when explicitly approved', async () => {
  const calls = [];
  const workspaceRoot = path.resolve('C:/workspace/helios-forge');
  const champion = {
    attemptId: 'attempt_apply',
    patch: 'diff --git a/src/harness-sidecar/core/approvalResume.js b/src/harness-sidecar/core/approvalResume.js\n+ok\n',
  };

  const result = await executeApprovedApplyAction({
    action: {
      actionId: 'act_champion',
      taskId: 'task_champion',
      kind: 'champion_apply',
      payload: { champion },
    },
    approved: true,
    workspaceRoot,
    applyAdapter: async (input) => {
      calls.push(input);
      return { applied: true, stdout: 'applied' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cwd, workspaceRoot);
  assert.equal(calls[0].patch, champion.patch);
  assert.equal(result.status, 'applied');
  assert.equal(result.kind, 'champion_apply');
  assert.equal(result.applyResult.attemptId, 'attempt_apply');
});

test('approved change proposal apply action uses injected adapter when explicitly approved', async () => {
  const calls = [];
  const proposal = {
    proposalId: 'proposal_0001',
    candidateId: 'cand_1',
    directApplyAllowed: false,
  };

  const result = await executeApprovedApplyAction({
    action: {
      actionId: 'act_proposal',
      taskId: 'task_proposal',
      kind: 'change_proposal_apply',
      payload: { proposal },
    },
    approved: true,
    workspaceRoot: path.resolve('C:/workspace/helios-forge'),
    applyAdapter: async (input) => {
      calls.push(input);
      return { applied: true, proposalSeen: input.proposal.proposalId };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { proposal });
  assert.equal(result.status, 'applied');
  assert.equal(result.kind, 'change_proposal_apply');
  assert.equal(result.applyResult.proposalId, 'proposal_0001');
  assert.equal(result.applyResult.result.proposalSeen, 'proposal_0001');
});

test('approved apply action rejects unknown apply kind', async () => {
  const result = await executeApprovedApplyAction({
    action: {
      actionId: 'act_unknown',
      taskId: 'task_unknown',
      kind: 'shell_apply',
      payload: {},
    },
    approved: true,
    workspaceRoot: path.resolve('C:/workspace/helios-forge'),
    applyAdapter: async () => {
      throw new Error('adapter should not run');
    },
  });

  assert.deepEqual(result, {
    actionId: 'act_unknown',
    taskId: 'task_unknown',
    kind: 'shell_apply',
    status: 'rejected',
    reason: 'unknown_apply_kind',
  });
});
