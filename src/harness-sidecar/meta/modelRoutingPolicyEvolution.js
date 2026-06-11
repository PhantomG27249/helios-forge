function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stableString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function collectCoresetItems(coreset) {
  if (!coreset) return [];
  if (Array.isArray(coreset)) return coreset;
  if (Array.isArray(coreset.items)) return coreset.items;
  if (Array.isArray(coreset.cases)) return coreset.cases;
  if (Array.isArray(coreset.traces)) return coreset.traces;
  return [];
}

function itemFailureModes(item = {}) {
  return [
    ...asArray(item.failureModes),
    ...asArray(item.reasons).filter((reason) => stableString(reason).startsWith('model_router_')),
    ...asArray(item.metadata?.modelRouter?.failureModes),
  ].map(stableString).filter(Boolean);
}

function taskIdFor(item = {}, index = 0) {
  return stableString(item.taskId ?? item.caseId ?? item.id ?? `router_policy_case_${index}`);
}

function selectedModelFor(item = {}) {
  return stableString(item.selectedModel ?? item.modelRouter?.selectedModel ?? item.metadata?.modelRouter?.selectedModel);
}

function bestModelFor(item = {}) {
  return stableString(item.bestModel ?? item.modelRouter?.bestModel ?? item.metadata?.modelRouter?.bestModel);
}

function roleFor(item = {}) {
  return stableString(item.role ?? item.modelRouter?.role ?? item.trace?.role ?? 'unknown');
}

function taskTypeFor(item = {}) {
  return stableString(item.taskType ?? item.modelRouter?.taskType ?? item.trace?.taskType ?? 'unknown');
}

function routerItems(coreset) {
  return collectCoresetItems(coreset)
    .map((item, index) => ({
      ...item,
      taskId: taskIdFor(item, index),
      role: roleFor(item),
      taskType: taskTypeFor(item),
      selectedModel: selectedModelFor(item),
      bestModel: bestModelFor(item),
      failureModes: itemFailureModes(item),
    }))
    .filter((item) => item.failureModes.length > 0);
}

function policyEvidence(sourceCaseIds) {
  return {
    authority: 'evidence_only',
    canPromote: false,
    sourceCaseIds,
  };
}

function emptyPatch(baselinePolicy = {}) {
  return {
    explorationFloor: numberOrNull(baselinePolicy.explorationFloor) ?? 0.05,
    roleArmWeights: {},
    quarantinedArms: [],
    taskTypeOverrides: {},
  };
}

function addRoleWeight(patch, role, arm, weight) {
  if (!role || !arm) return;
  patch.roleArmWeights[role] = {
    ...(patch.roleArmWeights[role] || {}),
    [arm]: weight,
  };
}

function addTaskOverride(patch, taskType, role, arm) {
  if (!taskType || !role || !arm) return;
  patch.taskTypeOverrides[taskType] = {
    ...(patch.taskTypeOverrides[taskType] || {}),
    [role]: arm,
  };
}

function candidateFromCase(item, index, baselinePolicy = {}) {
  const patch = emptyPatch(baselinePolicy);
  const modes = item.failureModes;
  const sourceCaseIds = [item.taskId];
  const candidateId = `model_route_policy_${String(index + 1).padStart(3, '0')}`;
  const selected = item.selectedModel;
  const best = item.bestModel;
  const role = item.role;
  const taskType = item.taskType;

  if (modes.includes('model_router_wrong_model') || modes.includes('model_router_best_single_regression')) {
    patch.explorationFloor = Math.min(0.5, patch.explorationFloor + 0.1);
    addRoleWeight(patch, role, best || selected, 1.4);
    addTaskOverride(patch, taskType, role, best || selected);
  }

  if (modes.includes('model_router_under_explored_arm')) {
    patch.explorationFloor = Math.min(0.5, patch.explorationFloor + 0.15);
  }

  if (modes.includes('model_router_latency_regression')) {
    const qualityDelta = Math.abs(numberOrNull(item.qualityDelta) ?? 0);
    if (qualityDelta <= 0.05) {
      addRoleWeight(patch, role, best || selected, 1.25);
      addTaskOverride(patch, taskType, role, best || selected);
    }
  }

  if (modes.includes('model_router_safety_regression') && selected) {
    patch.quarantinedArms = [...new Set([...patch.quarantinedArms, selected])].sort();
    addRoleWeight(patch, role, selected, 0);
  }

  if (modes.includes('model_router_council_disagreement_missed')) {
    patch.explorationFloor = Math.min(0.5, patch.explorationFloor + 0.08);
  }

  return {
    candidateId,
    target: 'model_routing_policy',
    policyPatch: patch,
    sourceCaseIds,
    evidence: policyEvidence(sourceCaseIds),
    rationale: `Adjust model routing for ${modes.join(', ')}`,
    status: 'approval_required',
    applied: false,
    requiresApproval: true,
  };
}

export function proposeModelRoutingPolicies({
  coreset,
  baselinePolicy = {},
  routerState,
  maxCandidates = 4,
} = {}) {
  void routerState;
  const limit = Math.max(0, Math.floor(Number(maxCandidates) || 0));
  return routerItems(coreset)
    .slice(0, limit)
    .map((item, index) => candidateFromCase(item, index, baselinePolicy));
}

export function evaluateModelRoutingPolicyCandidate({ candidate, replayCase, baselinePolicy } = {}) {
  void baselinePolicy;
  const bestModel = stableString(replayCase?.bestModel);
  const candidateSelectedModel = stableString(replayCase?.candidateSelectedModel);
  const selectedModel = stableString(replayCase?.selectedModel);
  const improvedModel = bestModel && candidateSelectedModel === bestModel && selectedModel !== bestModel;
  const quarantinedUnsafe = asArray(candidate?.policyPatch?.quarantinedArms).includes(selectedModel) &&
    asArray(replayCase?.failureModes).includes('model_router_safety_regression');
  const rewardDelta = improvedModel ? 0.25 : quarantinedUnsafe ? 0.2 : 0;

  return {
    candidateId: candidate?.candidateId,
    replayCaseId: replayCase?.taskId ?? replayCase?.caseId ?? replayCase?.id,
    target: 'model_routing_policy',
    rewardDelta,
    passKDelta: rewardDelta,
    safetyDelta: quarantinedUnsafe ? 0.2 : 0,
    latencyDelta: clamp01(replayCase?.latencyImprovement ?? 0),
    authority: 'evidence_only',
    canPromote: false,
  };
}

function defaultEvaluate({ candidate, replayCase, baselinePolicy }) {
  const preferredByRole = candidate.policyPatch?.roleArmWeights?.[roleFor(replayCase)] || {};
  const preferredArm = Object.entries(preferredByRole)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([arm]) => arm)[0];
  return evaluateModelRoutingPolicyCandidate({
    candidate,
    replayCase: {
      ...replayCase,
      candidateSelectedModel: preferredArm,
    },
    baselinePolicy,
  });
}

export function runModelRoutingPolicyLane({
  coreset,
  baselinePolicy = {},
  routerState,
  evaluate = defaultEvaluate,
} = {}) {
  const cases = routerItems(coreset);
  const candidates = proposeModelRoutingPolicies({
    coreset: { items: cases },
    baselinePolicy,
    routerState,
    maxCandidates: cases.length || 1,
  });
  const evaluations = candidates.flatMap((candidate) => cases.map((replayCase) => ({
    ...evaluate({ candidate, replayCase, baselinePolicy }),
    candidateId: candidate.candidateId,
  })));
  const totals = new Map();
  for (const evaluation of evaluations) {
    totals.set(evaluation.candidateId, (totals.get(evaluation.candidateId) || 0) + (Number(evaluation.rewardDelta) || 0));
  }
  const frontier = candidates
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      target: 'model_routing_policy',
      rewardDelta: totals.get(candidate.candidateId) || 0,
      authority: 'evidence_only',
      canPromote: false,
    }))
    .sort((a, b) => b.rewardDelta - a.rewardDelta || a.candidateId.localeCompare(b.candidateId));

  return {
    target: 'model_routing_policy',
    candidates,
    evaluations,
    frontier,
    evidence: {
      authority: 'evidence_only',
      canPromote: false,
    },
  };
}
