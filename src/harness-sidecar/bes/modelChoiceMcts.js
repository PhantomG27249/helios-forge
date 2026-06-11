import { backpropagate, selectChild } from './mctsPolicy.js';

const DEFAULT_ACTION_ARMS = ['go_wider', 'go_deeper', 'refine'];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function clamp01(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function posteriorMean(posterior = {}) {
  if (!posterior || typeof posterior !== 'object') return 0.5;
  const alpha = Number(posterior.alpha ?? 1);
  const beta = Number(posterior.beta ?? 1);
  const total = alpha + beta;
  return total > 0 ? alpha / total : 0.5;
}

function normalizeActionArm(arm, index) {
  if (typeof arm === 'string') {
    return {
      arm,
      label: arm,
      prior: arm === 'go_wider' ? 0.56 : (arm === 'go_deeper' ? 0.5 : 0.45),
      index,
    };
  }
  return {
    arm: String(arm?.arm ?? arm?.action ?? arm?.actionType ?? `action_${index + 1}`),
    label: arm?.label ?? arm?.arm ?? `action_${index + 1}`,
    prior: clamp01(arm?.prior ?? 0.45),
    index,
  };
}

function normalizeModelArm(arm, index) {
  const armId = String(arm?.armId ?? arm?.id ?? arm?.modelProfile ?? `model_arm_${index + 1}`);
  return {
    armId,
    role: arm?.role ?? 'implementer',
    modelProfile: arm?.modelProfile ?? armId,
    endpointProfile: arm?.endpointProfile ?? null,
    prior: clamp01(arm?.prior ?? posteriorMean(arm?.posterior)),
    posterior: {
      alpha: Number.isFinite(Number(arm?.posterior?.alpha)) ? Number(arm.posterior.alpha) : 1,
      beta: Number.isFinite(Number(arm?.posterior?.beta)) ? Number(arm.posterior.beta) : 1,
      observations: Number.isFinite(Number(arm?.posterior?.observations))
        ? Number(arm.posterior.observations)
        : 0,
    },
    index,
  };
}

function createNode({ kind, id, parent = null, metadata = {} }) {
  return {
    kind,
    id,
    parent,
    visits: 0,
    value: 0,
    children: [],
    ...metadata,
  };
}

function modelChoiceValue({ actionNode, modelNode, rng }) {
  const actionPrior = clamp01(actionNode.prior ?? 0.45);
  const modelPrior = clamp01(modelNode.prior ?? posteriorMean(modelNode.routerPosterior));
  const jitter = clamp01(rng()) * 0.06;
  return round(clamp01((actionPrior * 0.35) + (modelPrior * 0.6) + jitter));
}

export function planModelChoiceMcts({
  task = {},
  actionArms = DEFAULT_ACTION_ARMS,
  modelArms = [],
  routerPolicy,
  priorEvidence,
  iterations = 8,
  maxDepth = 2,
  rng = Math.random,
} = {}) {
  const safeRng = typeof rng === 'function' ? rng : Math.random;
  const normalizedActionArms = asArray(actionArms).length
    ? asArray(actionArms).map(normalizeActionArm)
    : DEFAULT_ACTION_ARMS.map(normalizeActionArm);
  const normalizedModelArms = asArray(modelArms).map(normalizeModelArm);
  const root = createNode({
    kind: 'root',
    id: String(task.taskId ?? task.id ?? 'model_choice_root'),
    metadata: {
      taskId: task.taskId ?? task.id ?? null,
      taskType: task.type ?? task.taskType ?? null,
      priorEvidence: priorEvidence ?? null,
      maxDepth,
    },
  });

  root.children = normalizedActionArms.map((arm) => {
    const actionNode = createNode({
      kind: 'search_action',
      id: `${root.id}:${arm.arm}`,
      parent: root,
      metadata: {
        arm: arm.arm,
        label: arm.label,
        prior: arm.prior,
      },
    });

    actionNode.children = normalizedModelArms.map((modelArm, index) => createNode({
      kind: 'model_choice',
      id: `${actionNode.id}:${modelArm.armId}`,
      parent: actionNode,
      metadata: {
        actionId: `model_choice_${(arm.index * Math.max(1, normalizedModelArms.length)) + index + 1}`,
        armId: modelArm.armId,
        role: modelArm.role,
        modelProfile: modelArm.modelProfile,
        endpointProfile: modelArm.endpointProfile,
        prior: modelArm.prior,
        routerPosterior: modelArm.posterior,
        authority: 'evidence_only',
        canPromote: false,
      },
    }));

    return actionNode;
  });

  let selectedNode = null;
  const iterationCount = Math.max(0, Math.trunc(Number(iterations) || 0));
  for (let index = 0; index < iterationCount; index += 1) {
    const actionNode = selectChild({
      children: root.children,
      parentVisits: root.visits,
    }) || root.children[0];
    if (!actionNode) break;

    const routerDecision = typeof routerPolicy?.selectArm === 'function'
      ? routerPolicy.selectArm({
        key: `${root.taskType || 'task'}:${actionNode.arm}`,
        role: normalizedModelArms[0]?.role,
        arms: normalizedModelArms,
        taskContext: task,
      })
      : null;
    const policyNode = routerDecision?.armId
      ? actionNode.children.find((child) => child.armId === routerDecision.armId)
      : null;
    const modelNode = policyNode || selectChild({
      children: actionNode.children,
      parentVisits: actionNode.visits,
    }) || actionNode.children[0] || actionNode;

    selectedNode = modelNode;
    backpropagate(modelNode, modelChoiceValue({ actionNode, modelNode, rng: safeRng }));
  }

  const allModelNodes = root.children.flatMap((child) => child.children);
  selectedNode = selectedNode || allModelNodes[0] || root.children[0] || root;
  const bestNode = [...allModelNodes]
    .sort((left, right) => {
      const leftMean = left.visits > 0 ? left.value / left.visits : left.prior;
      const rightMean = right.visits > 0 ? right.value / right.visits : right.prior;
      if (rightMean !== leftMean) return rightMean - leftMean;
      return right.visits - left.visits;
    })[0] || selectedNode;

  return {
    taskId: root.taskId,
    root,
    selectedNode: bestNode,
    iterations: iterationCount,
  };
}
