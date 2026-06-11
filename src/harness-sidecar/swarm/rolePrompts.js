export const ROLE_REGISTRY = Object.freeze({
  implementer: Object.freeze({
    id: 'implementer',
    title: 'Implementer',
    mission: 'Make the smallest scoped code change that satisfies the task.',
  }),
  reviewer: Object.freeze({
    id: 'reviewer',
    title: 'Reviewer',
    mission: 'Evaluate attempt output for verifier evidence, patch risk, and task fit.',
  }),
  recombiner: Object.freeze({
    id: 'recombiner',
    title: 'Recombiner',
    mission: 'Combine approved partial outputs into one coherent proposal.',
  }),
  verifier: Object.freeze({
    id: 'verifier',
    title: 'Verifier',
    mission: 'Run or inspect deterministic checks and report concrete evidence.',
  }),
});

function listLines(items = []) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- none';
}

function normalizeScope(context = {}) {
  return {
    allowedFiles: [...(context.assignedFiles || context.allowedFiles || [])],
    notes: [...(context.notes || [])],
  };
}

function profileLines(profile) {
  if (!profile) return [];
  return [
    `Profile: ${profile.id}`,
    `Profile mission: ${profile.mission}`,
    `Tool caps: allowed ${listLines(profile.toolCaps?.allowed || [])}`,
    `Denied tools:\n${listLines(profile.toolCaps?.denied || [])}`,
    `Dangerous tools: ${profile.toolCaps?.dangerousToolsAllowed ? 'allowed' : 'denied'}`,
    `VLM access: ${profile.vlm?.allowed ? 'allowed' : 'denied'}`,
    `Visual artifacts: ${profile.visualArtifacts?.allowed ? 'allowed' : 'denied'}`,
    `Workspace mutation: ${profile.workspace?.mutationAllowed ? 'allowed' : 'denied'}`,
    `Worktree required: ${profile.worktree?.required ? 'yes' : 'no'}`,
  ];
}

function soulContextBlock(context = {}) {
  if (typeof context.soulContext === 'string' && context.soulContext.trim()) {
    return context.soulContext.trim();
  }
  if (context.soulContext?.text) return context.soulContext.text;
  return null;
}

export function buildRolePrompt({
  role,
  task = {},
  attempt = {},
  context = {},
  budget = {},
  outputContract = {},
  profile,
}) {
  const registryEntry = ROLE_REGISTRY[role];
  if (!registryEntry) {
    throw new Error(`Unknown swarm role: ${role}`);
  }

  const activeProfile = profile || attempt.profile || null;
  const scope = normalizeScope(context);
  const requiredFields = outputContract.requiredFields || activeProfile?.outputContract?.requiredFields || [];
  const text = [
    `Role: ${registryEntry.title}`,
    `Mission: ${registryEntry.mission}`,
    ...profileLines(activeProfile),
    `Task: ${task.goal || task.description || task.taskId || 'unspecified'}`,
    `Attempt: ${attempt.attemptId || 'attempt'} (${attempt.strategy || 'default'})`,
    `Allowed files:\n${listLines(scope.allowedFiles)}`,
    `Scope notes:\n${listLines(scope.notes)}`,
    `Budget: ${budget.tokens || 0} tokens, ${budget.maxOutputChars || 'unbounded'} output chars`,
    `Required output fields: ${requiredFields.length ? requiredFields.join(', ') : 'none'}`,
    soulContextBlock(context),
  ].filter(Boolean).join('\n\n');

  return {
    role: registryEntry,
    text,
    scope,
    outputContract: {
      requiredFields,
    },
  };
}
