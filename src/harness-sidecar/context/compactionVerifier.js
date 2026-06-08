import { REQUIRED_COMPACTION_FIELDS, validateCompactionArtifact } from './compactionSchema.js';

function keyOf(item = {}) {
  return item.id || item.path || item.command || item.content || item.summary || '';
}

function hasRecord(records = [], item = {}) {
  const key = keyOf(item);
  return records.some((record = {}) => (
    record.id === item.id
      || record.path === item.path
      || record.command === item.command
      || record.content === item.content
      || (key && JSON.stringify(record).includes(key))
  ));
}

function traceDecisions(traceEvents = []) {
  return new Set(traceEvents
    .map((event = {}) => event.decision?.id || event.decisionId || event.id)
    .filter(Boolean));
}

function latestEnvironmentState(traceEvents = []) {
  return traceEvents.reduce((state, event = {}) => {
    if (event.type === 'environment.state' && event.state && typeof event.state === 'object') {
      return { ...state, ...event.state };
    }
    return state;
  }, {});
}

function addFinding(findings, reason, detail = {}) {
  findings.push({ reason, ...detail });
}

export function verifyCompactionArtifact({
  originalItems = [],
  artifact = {},
  traceEvents = [],
  requiredFields = REQUIRED_COMPACTION_FIELDS,
} = {}) {
  const findings = [];
  const validation = validateCompactionArtifact(artifact);
  for (const field of requiredFields) {
    if (validation.missingFields.includes(field)) {
      addFinding(findings, 'missing_required_field', { field });
    }
  }
  for (const field of validation.invalidFields) {
    addFinding(findings, 'invalid_field_shape', { field });
  }

  for (const item of originalItems) {
    if (item.priority === 0 && !hasRecord([
      ...(artifact.userConstraints || []),
      ...(artifact.activeFiles || []),
      ...(artifact.decisions || []),
      ...(artifact.nextSteps || []),
    ], item)) {
      addFinding(findings, 'lost_priority_zero_item', { itemId: keyOf(item) });
    }
    if (item.type === 'user_constraint' && !hasRecord(artifact.userConstraints, item)) {
      addFinding(findings, 'lost_user_constraint', { itemId: keyOf(item) });
    }
    if (item.type === 'active_file' && !hasRecord(artifact.activeFiles, item)) {
      addFinding(findings, 'lost_active_file', { path: item.path });
    }
    if (item.type === 'failing_test' && !hasRecord(artifact.failingTests, item)) {
      addFinding(findings, 'lost_failing_test', { command: item.command });
    }
  }

  if (originalItems.some((item) => item.sourcePointer) && !(artifact.sourcePointers || []).length) {
    addFinding(findings, 'missing_source_pointers');
  }

  const knownDecisions = traceDecisions(traceEvents);
  for (const decision of artifact.decisions || []) {
    if ((decision.id || decision.decisionId) && knownDecisions.size && !knownDecisions.has(decision.id || decision.decisionId)) {
      addFinding(findings, 'hallucinated_decision', { decisionId: decision.id || decision.decisionId });
    } else if (!decision.sourcePointer && !decision.eventId && !decision.source) {
      addFinding(findings, 'hallucinated_decision', { decisionId: decision.id || decision.summary });
    }
  }

  const latestEnv = latestEnvironmentState(traceEvents);
  for (const [key, value] of Object.entries(artifact.environmentState || {})) {
    if (Object.hasOwn(latestEnv, key) && latestEnv[key] !== value) {
      addFinding(findings, 'stale_environment_state', { key, expected: latestEnv[key], actual: value });
    }
  }

  const penalty = findings.reduce((total, finding) => {
    if (finding.reason === 'lost_priority_zero_item') return total + 0.25;
    if (finding.reason.startsWith('lost_')) return total + 0.18;
    if (finding.reason === 'hallucinated_decision') return total + 0.2;
    if (finding.reason === 'stale_environment_state') return total + 0.15;
    return total + 0.1;
  }, 0);
  const score = Math.max(0, Math.round((1 - penalty) * 1000) / 1000);

  return {
    passed: findings.length === 0,
    score,
    findings,
    missingFields: validation.missingFields,
    lostItems: findings.filter((finding) => finding.reason.startsWith('lost_')),
    hallucinations: findings.filter((finding) => finding.reason === 'hallucinated_decision'),
  };
}
