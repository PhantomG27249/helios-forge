import { decideAutoApproval } from './autoApprovalPolicy.js';
import { updateHarnessFrontier } from './harnessFrontier.js';

const AUTONOMY_LEVELS = Object.freeze({
  0: {
    level: 0,
    levelName: 'manual',
    allowedActions: ['observe', 'summarize', 'recommend'],
  },
  1: {
    level: 1,
    levelName: 'shadow',
    allowedActions: ['observe', 'summarize', 'recommend', 'queue_replay'],
  },
  2: {
    level: 2,
    levelName: 'supervised',
    allowedActions: ['observe', 'summarize', 'recommend', 'queue_replay', 'auto_approve_low_risk_reversible'],
  },
  3: {
    level: 3,
    levelName: 'guarded',
    allowedActions: ['observe', 'summarize', 'recommend', 'queue_replay', 'auto_approve_low_risk_reversible', 'apply_local_reversible'],
  },
});

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseTime(value, fallback = null) {
  const source = value ?? fallback ?? Date.now();
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid governance timestamp: ${value}`);
  return date;
}

function timestampPart(value) {
  return parseTime(value).toISOString().replace(/[-:.]/g, '').toLowerCase();
}

function normalizeAutonomyLevel(level) {
  const numeric = Math.max(0, Math.min(3, Math.floor(Number(level) || 0)));
  return AUTONOMY_LEVELS[numeric];
}

function safeId(value, fallback = 'item') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function isDue(definition = {}, nowDate) {
  if (!definition.nextRunAt) return true;
  return parseTime(definition.nextRunAt).getTime() <= nowDate.getTime();
}

function sortedDefinitions(definitions = []) {
  return [...definitions].sort((left, right) => (
    parseTime(left.nextRunAt, 0).getTime() - parseTime(right.nextRunAt, 0).getTime()
      || String(left.replayId || left.id || '').localeCompare(String(right.replayId || right.id || ''))
  ));
}

function blockedJob(definition, jobId, reasons) {
  return {
    jobId,
    replayId: definition.replayId || definition.id || null,
    kind: definition.kind || 'rho_replay_batch',
    cadence: definition.cadence || null,
    coresetId: definition.coresetId || null,
    estimatedCostUsd: roundMoney(definition.estimatedCostUsd),
    status: 'blocked',
    blockedReasons: reasons,
  };
}

export function planScheduledReplayJobs({
  definitions = [],
  now = new Date(),
  budget = {},
} = {}) {
  const nowDate = parseTime(now);
  const due = [];
  const pending = [];
  for (const definition of sortedDefinitions(definitions)) {
    if (isDue(definition, nowDate)) due.push(definition);
    else pending.push(definition);
  }

  let remainingUsd = Number(budget.remainingUsd ?? budget.maxUsd ?? Number.POSITIVE_INFINITY);
  const finiteBudget = Number.isFinite(remainingUsd);
  const jobs = due.map((definition) => {
    const replayId = safeId(definition.replayId || definition.id, 'replay');
    const jobId = `replay_${replayId}_${timestampPart(nowDate)}`;
    const estimatedCostUsd = roundMoney(definition.estimatedCostUsd);
    if (estimatedCostUsd > remainingUsd) {
      return blockedJob(definition, jobId, ['improvement_budget_exceeded']);
    }
    remainingUsd -= estimatedCostUsd;
    return {
      jobId,
      replayId,
      kind: definition.kind || 'rho_replay_batch',
      cadence: definition.cadence || null,
      coresetId: definition.coresetId || null,
      estimatedCostUsd,
      status: 'queued',
      scheduledFor: definition.nextRunAt || nowDate.toISOString(),
    };
  });

  const spentUsd = roundMoney(jobs
    .filter((job) => job.status === 'queued')
    .reduce((sum, job) => sum + Number(job.estimatedCostUsd || 0), 0));

  return {
    generatedAt: nowDate.toISOString(),
    jobs,
    accounting: {
      spentUsd,
      remainingUsd: finiteBudget ? roundMoney(remainingUsd) : null,
      blockedJobCount: jobs.filter((job) => job.status === 'blocked').length,
    },
    nextPendingAt: pending[0]?.nextRunAt || null,
  };
}

export function recordRollbackDrill({
  drillId,
  candidateId,
  startedAt,
  completedAt,
  restoreVerified = false,
  artifacts = [],
  notes = '',
} = {}) {
  const reversible = restoreVerified === true && asArray(artifacts).length > 0;
  return {
    drillId: drillId || `rollback_${safeId(candidateId, 'candidate')}_${timestampPart(completedAt || startedAt || new Date())}`,
    candidateId: candidateId || null,
    startedAt: startedAt || null,
    completedAt: completedAt || null,
    restoreVerified: restoreVerified === true,
    artifacts: asArray(artifacts).filter(Boolean),
    notes,
    reversible,
    status: reversible ? 'passed' : 'failed',
  };
}

function summarizeReplayJobs(replayJobs = []) {
  const jobs = asArray(replayJobs);
  return {
    totalCount: jobs.length,
    queuedCount: jobs.filter((job) => job?.status === 'queued').length,
    runningCount: jobs.filter((job) => job?.status === 'running').length,
    completedCount: jobs.filter((job) => job?.status === 'completed').length,
    blockedCount: jobs.filter((job) => job?.status === 'blocked').length,
    blockedReasons: [...new Set(jobs.flatMap((job) => job?.blockedReasons || []))].sort(),
  };
}

function summarizeFrontier(frontier = []) {
  const candidates = asArray(frontier);
  let items = [];
  for (const candidate of candidates) {
    items = updateHarnessFrontier({ current: items, candidate });
  }
  return {
    candidateCount: candidates.length,
    frontierCount: items.length,
    bestCandidateId: items[0]?.candidateId || null,
    candidates: items,
  };
}

function summarizeRollbackDrills(rollbackDrills = []) {
  const drills = asArray(rollbackDrills);
  return {
    drillCount: drills.length,
    passedCount: drills.filter((drill) => drill?.status === 'passed' || drill?.reversible === true).length,
    failedCount: drills.filter((drill) => drill?.status === 'failed' || drill?.reversible === false).length,
    lastStatus: drills.at(-1)?.status || null,
    lastDrillId: drills.at(-1)?.drillId || null,
  };
}

function summarizeAudit(auditEvents = []) {
  const events = asArray(auditEvents);
  return {
    eventCount: events.length,
    escalationCount: events.filter((event) => event?.type === 'governance.escalation').length,
    overrideCount: events.filter((event) => event?.type === 'governance.override').length,
  };
}

export function summarizeGovernanceStatus({
  replayJobs = [],
  frontier = [],
  rollbackDrills = [],
  improvementAccounting = {},
  autonomyLevel = 0,
  auditEvents = [],
} = {}) {
  return {
    replayJobs: summarizeReplayJobs(replayJobs),
    frontier: summarizeFrontier(frontier),
    rollbackDrills: summarizeRollbackDrills(rollbackDrills),
    improvementAccounting: {
      spentUsd: roundMoney(improvementAccounting.spentUsd),
      remainingUsd: improvementAccounting.remainingUsd === null || improvementAccounting.remainingUsd === undefined
        ? null
        : roundMoney(improvementAccounting.remainingUsd),
      blockedJobCount: Number(improvementAccounting.blockedJobCount || 0),
    },
    autonomy: normalizeAutonomyLevel(autonomyLevel),
    audit: summarizeAudit(auditEvents),
  };
}

function auditEvent({ type, actor, candidate, reasons, decision, override }) {
  return {
    type,
    actor: actor || 'system',
    candidateId: candidate?.candidateId || candidate?.id || null,
    decision,
    reasons,
    override: override || null,
  };
}

export function decideGovernanceAction({
  autonomyLevel = 0,
  candidate = {},
  evidence = {},
  rollback = {},
  trust = {},
  approvals = [],
  policy = {},
  override = null,
  actor = 'system',
} = {}) {
  const autonomy = normalizeAutonomyLevel(autonomyLevel);
  if (override?.approvedBy) {
    const reasons = [override.reason || 'operator_override'];
    return {
      decision: 'override_approved',
      autonomy,
      reasons,
      auditEvent: auditEvent({
        type: 'governance.override',
        actor,
        candidate,
        reasons,
        decision: 'override_approved',
        override,
      }),
    };
  }

  const approval = decideAutoApproval({ candidate, evidence, rollback, trust, approvals, policy });
  const lowRisk = !candidate.risk || candidate.risk === 'low';
  if (approval.status === 'auto_approved' && lowRisk && autonomy.level >= 2) {
    return {
      decision: 'auto_approved',
      autonomy,
      reasons: approval.reasons,
      auditEvent: auditEvent({
        type: 'governance.auto_approval',
        actor,
        candidate,
        reasons: approval.reasons,
        decision: 'auto_approved',
      }),
    };
  }

  const reasons = approval.reasons?.length ? approval.reasons : ['autonomy_level_requires_human'];
  return {
    decision: 'escalated',
    autonomy,
    reasons,
    auditEvent: auditEvent({
      type: 'governance.escalation',
      actor,
      candidate,
      reasons,
      decision: 'escalated',
    }),
  };
}
