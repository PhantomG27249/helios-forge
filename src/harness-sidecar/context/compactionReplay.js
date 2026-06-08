import { verifyCompactionArtifact } from './compactionVerifier.js';

function tokenReduction(tokensBefore, tokensAfter) {
  const before = Number(tokensBefore);
  const after = Number(tokensAfter);
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after)) return 0;
  return Math.max(0, Math.min(1, (before - after) / before));
}

function failureModesFromFindings(findings = []) {
  const modes = new Set();
  for (const finding of findings) {
    if (finding.reason === 'lost_user_constraint' || finding.reason === 'lost_priority_zero_item') {
      modes.add('compaction_lost_constraint');
    }
    if (finding.reason === 'lost_active_file') modes.add('compaction_lost_file');
    if (finding.reason === 'lost_failing_test') modes.add('compaction_lost_test');
    if (finding.reason === 'hallucinated_decision') modes.add('compaction_hallucinated_decision');
    if (finding.reason === 'missing_source_pointers') modes.add('compaction_missing_source_pointer');
  }
  return [...modes];
}

function riskFrom(score) {
  if (score >= 0.8) return 'low';
  if (score >= 0.55) return 'medium';
  return 'high';
}

export function evaluateCompactionReplay({
  trace = {},
  artifact = {},
  originalItems = [],
  traceEvents = trace.events || [],
  tokensAfter,
  continuationProbe,
} = {}) {
  const verification = verifyCompactionArtifact({ originalItems, artifact, traceEvents });
  const reduction = tokenReduction(trace.tokensBefore ?? trace.tokensEstimatedBefore, tokensAfter ?? artifact.tokensEstimated);
  const failureModes = failureModesFromFindings(verification.findings);
  let probeResult = { passed: true, findings: [] };
  if (typeof continuationProbe === 'function') {
    probeResult = continuationProbe({ trace, artifact, verification }) || probeResult;
    if (probeResult.passed === false) failureModes.push('compaction_probe_failed');
  }

  if (reduction < 0.1 && Number(trace.tokensBefore ?? trace.tokensEstimatedBefore) > 0) {
    failureModes.push('compaction_overcompressed');
  }

  const probePenalty = probeResult.passed === false ? 0.25 : 0;
  const score = Math.max(0, Math.min(1, Math.round(((verification.score * 0.8) + (reduction * 0.2) - probePenalty) * 1000) / 1000));
  const uniqueFailureModes = [...new Set(failureModes)];

  return {
    caseId: trace.caseId || trace.taskId || 'compaction_case',
    taskId: trace.taskId || trace.caseId || null,
    score,
    failureModes: uniqueFailureModes,
    lostFields: verification.findings.map((finding) => finding.field).filter(Boolean),
    tokenReduction: Math.round(reduction * 1000) / 1000,
    continuationRisk: riskFrom(score),
    rhoReason: uniqueFailureModes[0] || null,
    verification,
    probe: probeResult,
  };
}
