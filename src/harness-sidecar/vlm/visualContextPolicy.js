export function createVisualContextItem(artifact) {
  return {
    type: 'visual_artifact',
    artifactId: artifact.artifactId,
    reason: artifact.summary || 'Visual artifact relevant to task',
    tokensEstimated: artifact.visualContext?.tokensEstimated || 1200,
    artifact,
  };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function visualCost(visualItems = []) {
  return asArray(visualItems).reduce((sum, item) => (
    sum + finiteNumber(item.tokensEstimated ?? item.artifact?.visualContext?.tokensEstimated, 1200)
  ), 0);
}

function endpointSupportsVision(endpoint = {}) {
  if (endpoint.supportsVision === false) return false;
  if (endpoint.supportsVision === true) return true;
  return asArray(endpoint.capabilities).map((capability) => String(capability).toLowerCase()).includes('image');
}

function taskRequiresVlm(task = {}) {
  return task.vlmRequired === true
    || task.requiresVlm === true
    || task.requiresVision === true
    || asArray(task.modalities).map((modality) => String(modality).toLowerCase()).includes('vision');
}

function adaptiveSearchEvidence(adaptiveAction = null) {
  if (!adaptiveAction || typeof adaptiveAction !== 'object') return null;
  const contextId = adaptiveAction.contextId || adaptiveAction.taskId || 'multimodal_budget';
  return {
    action: {
      actionId: adaptiveAction.actionId || adaptiveAction.selectedArmId || 'multimodal_budget_action',
      selectedArmId: adaptiveAction.selectedArmId || null,
      trace: {
        type: 'ab_mcts.action_selected',
        contextId,
      },
    },
    outcome: {
      type: 'ab_mcts.outcome_recorded',
      reward: finiteNumber(adaptiveAction.reward, 0),
    },
    evidenceOnly: true,
  };
}

export function decideMultimodalBudgetPolicy({
  task = {},
  endpoint = {},
  visualItems = [],
  budget = {},
  adaptiveAction = null,
} = {}) {
  const items = asArray(visualItems);
  const required = taskRequiresVlm(task);
  const supportsVision = endpointSupportsVision(endpoint);
  const cost = visualCost(items);
  const remainingTokens = finiteNumber(
    budget.remainingTokens ?? budget.remainingVisionTokens ?? budget.remainingVisualTokens ?? budget.vlmRemainingTokens,
    Number.POSITIVE_INFINITY,
  );
  const adaptiveEvidence = adaptiveSearchEvidence(adaptiveAction);

  if (items.length === 0) {
    return {
      mode: 'text_only',
      budgetCost: 0,
      reasons: ['no_visual_context'],
      adaptiveSearchEvidence: adaptiveEvidence,
      evidenceOnly: true,
    };
  }

  if (!supportsVision) {
    return {
      mode: 'text_only',
      budgetCost: 0,
      reasons: ['vision_capability_mismatch'],
      adaptiveSearchEvidence: adaptiveEvidence,
      evidenceOnly: true,
    };
  }

  if (cost > remainingTokens) {
    return {
      mode: 'text_only',
      budgetCost: 0,
      reasons: ['vision_budget_exhausted'],
      adaptiveSearchEvidence: adaptiveEvidence,
      evidenceOnly: true,
    };
  }

  return {
    mode: required ? 'vlm_required' : 'vlm_optional',
    budgetCost: cost,
    reasons: required
      ? ['vlm_required_task', 'vision_endpoint_available']
      : ['visual_context_available', 'vision_endpoint_available'],
    adaptiveSearchEvidence: adaptiveEvidence,
    evidenceOnly: true,
  };
}
