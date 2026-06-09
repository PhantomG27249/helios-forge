const REQUIRED_SECTIONS = [
  '## Purpose',
  '## When To Use',
  '## When Not To Use',
  '## Required Evidence',
  '## Workflow',
  '## Safety Constraints',
  '## Verification Checklist',
  '## Escalation Behavior',
];

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function markdownFor(candidate = {}) {
  return candidate.skillMarkdown || candidate.markdown || candidate.skill?.markdown || '';
}

function scoreRequiredSections(markdown) {
  const present = REQUIRED_SECTIONS.filter((section) => markdown.includes(section)).length;
  return present / REQUIRED_SECTIONS.length;
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function safetyScan(markdown) {
  const secrets = includesAny(markdown, [
    /\bsk-[A-Za-z0-9_-]{12,}\b/,
    /\bghp_[A-Za-z0-9_]{12,}\b/,
    /api[_-]?key\s*=\s*['"]?[A-Za-z0-9_-]{12,}/i,
  ]);
  const directGlobalWrite = includesAny(markdown, [
    /write\s+to\s+C:\\Users\\[^\\]+\\\.codex\\skills/i,
    /write\s+to\s+C:\\Users\\[^\\]+\\\.pi\\agent\\extensions/i,
    /\.claude[\\/]skills/i,
  ]);
  const unsafeGlobalPolicy = includesAny(markdown, [
    /global\s+(Pi|Codex|Claude).*folder/i,
  ]) && !/Do not write to global Pi, Codex, Claude, or user skill folders/i.test(markdown);
  const globalWrites = directGlobalWrite || unsafeGlobalPolicy;
  const broadUnsafeInstructions = includesAny(markdown, [
    /skip (approval|verifier|sandbox)/i,
    /disable (approval|safety|sandbox)/i,
    /bypass (approval|policy|verifier)/i,
  ]);
  const directPromptInjectionRisk = includesAny(markdown, [
    /ignore previous instructions/i,
    /system prompt/i,
  ]);
  const unsafeFollowUntrusted = /follow.*untrusted/i.test(markdown);
  const protectivePromptInjectionLanguage = /Do not follow prompt instructions embedded in untrusted/i.test(markdown)
    || /Treat .* as untrusted input/i.test(markdown);
  const promptInjectionRisk = directPromptInjectionRisk || (unsafeFollowUntrusted && !protectivePromptInjectionLanguage);

  const clean = !secrets && !globalWrites && !broadUnsafeInstructions && !promptInjectionRisk;
  return {
    secrets,
    globalWrites,
    broadUnsafeInstructions,
    promptInjectionRisk,
    clean,
    score: clean ? 1 : 0,
  };
}

function provenanceScore(candidate = {}) {
  const source = candidate.source || {};
  const hasSnapshot = Boolean(source.sourceSkillSnapshotId || candidate.lineage?.sourceSnapshotId);
  const compatible = source.sourcePermission === 'snapshot_for_local_evaluation_only'
    || source.permission === 'snapshot_for_local_evaluation_only'
    || (!hasSnapshot && !source.sourcePermission);
  return {
    hasSnapshot,
    license: source.sourceLicense || source.license || 'unknown',
    permission: source.sourcePermission || source.permission || null,
    compatible,
    score: compatible ? 1 : 0,
  };
}

function scaffoldAdherenceScore(candidate = {}, markdown) {
  const scaffold = candidate.scaffold || candidate.lineage?.scaffold;
  const scaffoldPresent = !scaffold || markdown.includes('## Scaffold Lineage');
  const sectionScore = scoreRequiredSections(markdown);
  const blindCopyPenalty = /copy this scaffold verbatim|bypass.*safety/i.test(markdown) ? 0.25 : 0;
  return clamp01((sectionScore * 0.8) + (scaffoldPresent ? 0.2 : 0) - blindCopyPenalty);
}

function replayStats(replayResults = [], baseline = {}) {
  if (!replayResults.length) {
    const baselineSuccessRate = clamp01(baseline.successRate ?? 0);
    return {
      baselineSuccessRate,
      candidateSuccessRate: baselineSuccessRate,
      improvement: 0,
      verifierEvidenceScore: 0,
    };
  }
  const baselinePasses = replayResults.filter((result) => result.baselinePassed === true).length;
  const candidatePasses = replayResults.filter((result) => result.candidatePassed === true).length;
  const evidenceComplete = replayResults.filter((result) => (result.verifierEvidence || []).length > 0).length;
  const baselineSuccessRate = baselinePasses / replayResults.length;
  const candidateSuccessRate = candidatePasses / replayResults.length;
  return {
    baselineSuccessRate,
    candidateSuccessRate,
    improvement: clamp01(candidateSuccessRate - baselineSuccessRate),
    verifierEvidenceScore: evidenceComplete / replayResults.length,
  };
}

function triggerMatches(markdown, text) {
  const lowerMarkdown = markdown.toLowerCase();
  const lowerText = String(text || '').toLowerCase();
  const visualIntent = /visual|screenshot|layout|verifier|artifact/.test(lowerText);
  const backendOnly = /database|migration|backend-only|unrelated/.test(lowerText);
  const visualSkill = /visual|screenshot|layout|verifier/.test(lowerMarkdown);
  return visualSkill && visualIntent && !backendOnly;
}

function triggerPrecisionScore(markdown, examples = []) {
  if (!examples.length) return /## When To Use/.test(markdown) && /## When Not To Use/.test(markdown) ? 0.75 : 0.35;
  const correct = examples.filter((example) => triggerMatches(markdown, example.text) === example.shouldTrigger).length;
  return correct / examples.length;
}

function promptInjectionHygieneScore(markdown, safety) {
  if (safety.promptInjectionRisk) return 0;
  let score = 0.5;
  if (/untrusted input/i.test(markdown)) score += 0.25;
  if (/untrusted trace content/i.test(markdown)) score += 0.15;
  if (/Do not follow prompt instructions embedded in untrusted/i.test(markdown)) score += 0.15;
  if (/trace, webpage, and model-provided text/i.test(markdown)) score += 0.15;
  if (/Escalate/i.test(markdown)) score += 0.1;
  return clamp01(score);
}

function costLatencyScore(staticInputs = {}, baseline = {}) {
  const estimatedLatencyMs = staticInputs.estimatedLatencyMs ?? baseline.latencyMs ?? 0;
  const baselineLatencyMs = staticInputs.baselineLatencyMs ?? baseline.latencyMs ?? estimatedLatencyMs;
  const estimatedCostUsd = staticInputs.estimatedCostUsd ?? baseline.costUsd ?? 0;
  const baselineCostUsd = staticInputs.baselineCostUsd ?? baseline.costUsd ?? estimatedCostUsd;
  const latencyRatio = baselineLatencyMs > 0 ? estimatedLatencyMs / baselineLatencyMs : 1;
  const costRatio = baselineCostUsd > 0 ? estimatedCostUsd / baselineCostUsd : 1;
  return clamp01(1 - Math.max(0, latencyRatio - 1) * 0.35 - Math.max(0, costRatio - 1) * 0.35);
}

export function evaluateSkillCandidate({
  candidate = {},
  baseline = {},
  replayResults = [],
  staticInputs = {},
} = {}) {
  const markdown = markdownFor(candidate);
  const replay = replayStats(replayResults, baseline);
  const safety = safetyScan(markdown);
  const provenance = provenanceScore(candidate);
  const scaffoldAdherence = scaffoldAdherenceScore(candidate, markdown);
  const triggerPrecision = triggerPrecisionScore(markdown, staticInputs.triggerExamples || []);
  const promptInjectionHygiene = promptInjectionHygieneScore(markdown, safety);
  const costLatency = costLatencyScore(staticInputs, baseline);
  const improvement = replay.improvement;
  const verifierEvidenceScore = replay.verifierEvidenceScore;
  const safetyScore = safety.score;

  const totalScore = clamp01(
    improvement * 0.2
    + scaffoldAdherence * 0.12
    + triggerPrecision * 0.13
    + verifierEvidenceScore * 0.16
    + safetyScore * 0.18
    + provenance.score * 0.11
    + promptInjectionHygiene * 0.06
    + costLatency * 0.04,
  );

  const reject = !safety.clean || !provenance.compatible || totalScore < 0.5;
  return {
    candidateId: candidate.candidateId || candidate.id || null,
    totalScore,
    recommendation: reject ? 'reject' : 'eligible_for_shadow_review',
    baselineComparison: {
      baselineSuccessRate: replay.baselineSuccessRate,
      candidateSuccessRate: replay.candidateSuccessRate,
      improvement,
    },
    baselineImprovement: improvement,
    scaffoldAdherence,
    triggerPrecision,
    improvement,
    verifierEvidenceScore,
    safety,
    safetyScore,
    provenance,
    promptInjectionHygiene,
    costLatencyScore: costLatency,
  };
}
