const DANGEROUS_DENY = Object.freeze([
  'shell.rm_rf',
  'git.apply',
  'mcp.write_scope_expand',
  'network.external',
  'secrets.read',
]);

function profile({
  id,
  role,
  mission,
  modelProfile = 'critic_low_temp',
  allowedTools = ['workspace.read', 'verifier.run'],
  denied = DANGEROUS_DENY,
  memoryScope = 'task',
  mutationAllowed = false,
  worktreeRequired = false,
  vlmAllowed = false,
  visualArtifactsAllowed = false,
  requiredFields = ['summary', 'verifierEvidence'],
} = {}) {
  return Object.freeze({
    id,
    role,
    mission,
    modelProfile,
    toolCaps: Object.freeze({
      allowed: Object.freeze([...allowedTools]),
      denied: Object.freeze([...new Set(denied)]),
      dangerousToolsAllowed: false,
    }),
    memory: Object.freeze({ scope: memoryScope }),
    workspace: Object.freeze({ mutationAllowed }),
    worktree: Object.freeze({ required: worktreeRequired }),
    vlm: Object.freeze({ allowed: vlmAllowed }),
    visualArtifacts: Object.freeze({ allowed: visualArtifactsAllowed }),
    outputContract: Object.freeze({
      requiredFields: Object.freeze([...requiredFields]),
    }),
  });
}

export function loadDefaultAgentProfiles() {
  return Object.freeze({
    implementer: profile({
      id: 'implementer',
      role: 'implementer',
      mission: 'Make the smallest scoped code change that satisfies the task.',
      allowedTools: ['workspace.read', 'workspace.write_patch', 'verifier.run'],
      mutationAllowed: true,
      worktreeRequired: true,
      requiredFields: ['summary', 'patch', 'verifierEvidence'],
    }),
    reviewer: profile({
      id: 'reviewer',
      role: 'reviewer',
      mission: 'Evaluate attempt output for verifier evidence, patch risk, and task fit.',
      requiredFields: ['summary', 'reviewFindings', 'riskFindings', 'verifierEvidence'],
    }),
    recombiner: profile({
      id: 'recombiner',
      role: 'recombiner',
      mission: 'Combine approved partial outputs into one coherent proposal.',
      requiredFields: ['summary', 'patch', 'sourceAttemptIds', 'verifierEvidence'],
    }),
    'visual-specialist': profile({
      id: 'visual-specialist',
      role: 'implementer',
      mission: 'Inspect visual artifacts and produce evidence-backed UI or VLM findings.',
      allowedTools: ['workspace.read', 'visual.verifier.run', 'verifier.run'],
      vlmAllowed: true,
      visualArtifactsAllowed: true,
      requiredFields: ['summary', 'visualEvidence', 'verifierEvidence'],
    }),
    'test-specialist': profile({
      id: 'test-specialist',
      role: 'implementer',
      mission: 'Add or run focused deterministic tests for the attempted change.',
      allowedTools: ['workspace.read', 'workspace.write_patch', 'verifier.run'],
      mutationAllowed: true,
      worktreeRequired: true,
      requiredFields: ['summary', 'patch', 'testEvidence'],
    }),
    'risk-auditor': profile({
      id: 'risk-auditor',
      role: 'reviewer',
      mission: 'Audit safety, scope, approval, and rollback risk without mutating the workspace.',
      denied: DANGEROUS_DENY,
      mutationAllowed: false,
      worktreeRequired: false,
      requiredFields: ['summary', 'riskFindings', 'approvalNotes'],
    }),
    researcher: profile({
      id: 'researcher',
      role: 'implementer',
      mission: 'Gather local research evidence and cite provenance without unsafe mutation.',
      allowedTools: ['workspace.read', 'rag.retrieve', 'memory.read'],
      requiredFields: ['summary', 'researchFindings', 'sources'],
    }),
  });
}

export function getAgentProfile({ profiles = loadDefaultAgentProfiles(), profileId } = {}) {
  const profileRecord = profiles?.[profileId] || loadDefaultAgentProfiles()[profileId];
  if (!profileRecord) {
    throw new Error(`Unknown agent profile: ${profileId}`);
  }
  return profileRecord;
}

export function selectAgentProfileForAttempt({
  profiles = loadDefaultAgentProfiles(),
  attempt = {},
  task = {},
  goalTree,
} = {}) {
  const text = [
    attempt.profileId,
    attempt.specialization,
    attempt.strategy,
    task.taskType,
    task.goal,
    task.description,
    goalTree,
  ].map((value) => {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }).join(' ').toLowerCase();

  if (attempt.profileId && profiles[attempt.profileId]) return profiles[attempt.profileId];
  if (text.includes('visual') || text.includes('vlm') || text.includes('screenshot')) {
    return getAgentProfile({ profiles, profileId: 'visual-specialist' });
  }
  if (text.includes('test') || text.includes('verifier')) {
    return getAgentProfile({ profiles, profileId: 'test-specialist' });
  }
  if (text.includes('risk') || text.includes('approval')) {
    return getAgentProfile({ profiles, profileId: 'risk-auditor' });
  }
  if (text.includes('research') || text.includes('source')) {
    return getAgentProfile({ profiles, profileId: 'researcher' });
  }
  return getAgentProfile({ profiles, profileId: 'implementer' });
}
