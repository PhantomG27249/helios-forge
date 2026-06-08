import { applyChangeProposal } from '../meta/changeProposal.js';
import { applyChampion } from '../swarm/championApply.js';
import { applyVerifierConfigCandidate } from '../tools/verifierConfigApply.js';

function clonePlain(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeChoice(choice = 'defer') {
  return String(choice || 'defer').trim().toLowerCase();
}

function statusForChoice(choice) {
  return choice === 'reject' ? 'rejected' : 'resolved';
}

async function emitMaybe(emitEvent, event) {
  if (typeof emitEvent === 'function') {
    await emitEvent(event);
  }
}

function summarizeAction(action, { includeResumeResult = true } = {}) {
  if (!action) {
    return null;
  }

  const summary = {
    actionId: action.actionId,
    taskId: action.taskId,
    kind: action.kind,
    payload: clonePlain(action.payload),
    status: action.status,
    choice: action.choice,
    resolvedAt: action.resolvedAt,
    resumeRan: action.resumeRan,
  };

  if (includeResumeResult && action.resumeResult !== undefined) {
    summary.resumeResult = clonePlain(action.resumeResult);
  }

  return summary;
}

function assertPendingAction(action = {}) {
  if (!action.actionId) {
    throw new Error('actionId is required');
  }
  if (!action.taskId) {
    throw new Error('taskId is required');
  }
  if (!action.kind) {
    throw new Error('kind is required');
  }
}

export class PendingActionResumeStore {
  constructor({ emitEvent } = {}) {
    this.actions = new Map();
    this.emitEvent = emitEvent;
  }

  register(action = {}) {
    assertPendingAction(action);
    const record = {
      actionId: action.actionId,
      taskId: action.taskId,
      kind: action.kind,
      payload: clonePlain(action.payload),
      resume: action.resume,
      status: action.status || 'pending',
      choice: action.choice,
      resolvedAt: action.resolvedAt || null,
      resumeRan: Boolean(action.resumeRan),
      resumeResult: clonePlain(action.resumeResult),
    };
    this.actions.set(record.actionId, record);
    return summarizeAction(record, { includeResumeResult: false });
  }

  get(actionId) {
    return summarizeAction(this.actions.get(actionId));
  }

  list() {
    return [...this.actions.values()].map((action) => summarizeAction(action));
  }

  async resolve(actionId, choice = 'defer', context = {}) {
    const action = this.actions.get(actionId);
    if (!action) {
      return {
        actionId,
        status: 'not_found',
      };
    }

    if (action.status !== 'pending') {
      return {
        ...summarizeAction(action),
        resumeRan: false,
      };
    }

    const normalizedChoice = normalizeChoice(choice);
    action.choice = normalizedChoice;
    action.status = statusForChoice(normalizedChoice);
    action.resolvedAt = new Date().toISOString();

    await emitMaybe(this.emitEvent, {
      type: 'approval.resolved',
      taskId: action.taskId,
      actionId: action.actionId,
      kind: action.kind,
      choice: normalizedChoice,
      status: action.status,
    });

    let resumeRan = false;
    if (normalizedChoice === 'approve' && typeof action.resume === 'function' && !action.resumeRan) {
      action.resumeRan = true;
      action.resumeResult = await action.resume(context);
      resumeRan = true;
      await emitMaybe(this.emitEvent, {
        type: 'approval.resume_completed',
        taskId: action.taskId,
        actionId: action.actionId,
        kind: action.kind,
        result: clonePlain(action.resumeResult),
      });
    }

    return {
      ...summarizeAction(action),
      resumeRan,
    };
  }
}

export function createApprovalResumeStore(options = {}) {
  return new PendingActionResumeStore(options);
}

function baseApplyResult(action, status, reason) {
  return {
    actionId: action?.actionId,
    taskId: action?.taskId,
    kind: action?.kind,
    status,
    reason,
  };
}

export async function executeApprovedApplyAction({
  action,
  approved = false,
  workspaceRoot,
  applyAdapter,
  emitEvent,
} = {}) {
  if (!approved) {
    const result = baseApplyResult(action, 'rejected', 'approval_required');
    await emitMaybe(emitEvent, { type: 'approval.apply_rejected', ...result });
    return result;
  }

  if (!action || !['champion_apply', 'change_proposal_apply', 'verifier_config_apply'].includes(action.kind)) {
    const result = baseApplyResult(action, 'rejected', 'unknown_apply_kind');
    await emitMaybe(emitEvent, { type: 'approval.apply_rejected', ...result });
    return result;
  }

  let applyResult;
  if (action.kind === 'champion_apply') {
    applyResult = await applyChampion({
      workspaceRoot,
      champion: action.payload?.champion,
      approved: true,
      approvedBy: action.approvedBy || action.payload?.approvedBy || null,
      applyAdapter,
    });
  } else if (action.kind === 'change_proposal_apply') {
    applyResult = await applyChangeProposal({
      proposal: action.payload?.proposal,
      approved: true,
      applyAdapter,
    });
  } else {
    applyResult = await applyVerifierConfigCandidate({
      workspaceRoot,
      candidate: action.payload?.candidate,
      approval: {
        approved: true,
        approvedBy: action.approvedBy || action.payload?.approvedBy || null,
      },
      currentRegistry: action.payload?.currentRegistry,
    });
  }

  const result = {
    actionId: action.actionId,
    taskId: action.taskId,
    kind: action.kind,
    status: 'applied',
    applyResult,
  };
  await emitMaybe(emitEvent, { type: 'approval.apply_completed', ...result });
  return result;
}
