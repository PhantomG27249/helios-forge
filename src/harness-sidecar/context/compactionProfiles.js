export const COMPACTION_PROFILES = {
  coding: {
    preserveTypes: ['instruction', 'user_constraint', 'active_file', 'touched_file', 'command', 'failing_test', 'decision', 'failed_attempt', 'next_step'],
    requiredSections: ['objective', 'userConstraints', 'activeFiles', 'commandsRun', 'failingTests', 'decisions', 'nextSteps', 'sourcePointers'],
  },
  research: {
    preserveTypes: ['instruction', 'user_constraint', 'source', 'claim', 'citation', 'contradiction', 'decision', 'next_step'],
    requiredSections: ['objective', 'userConstraints', 'decisions', 'nextSteps', 'sourcePointers', 'riskFlags'],
  },
  visual: {
    preserveTypes: ['instruction', 'user_constraint', 'visual_artifact', 'screenshot', 'ocr', 'pdf_page', 'visual_diff', 'vlm_finding', 'active_file'],
    requiredSections: ['objective', 'userConstraints', 'activeFiles', 'decisions', 'nextSteps', 'sourcePointers', 'riskFlags'],
  },
  swarm: {
    preserveTypes: ['instruction', 'user_constraint', 'subagent_handoff', 'champion', 'rejected_attempt', 'conflict', 'decision', 'next_step'],
    requiredSections: ['objective', 'userConstraints', 'decisions', 'failedAttempts', 'nextSteps', 'sourcePointers', 'riskFlags'],
  },
  meta: {
    preserveTypes: ['instruction', 'user_constraint', 'candidate', 'policy', 'approval', 'rollback', 'decision', 'verifier_result'],
    requiredSections: ['objective', 'userConstraints', 'decisions', 'sourcePointers', 'riskFlags', 'environmentState'],
  },
  recovery: {
    preserveTypes: ['instruction', 'user_constraint', 'failure', 'recovery', 'raw_log', 'tool_output', 'failed_attempt', 'next_step'],
    requiredSections: ['objective', 'userConstraints', 'failedAttempts', 'nextSteps', 'sourcePointers', 'riskFlags'],
  },
};

export function resolveCompactionProfile(task = {}, explicitProfile) {
  if (explicitProfile && COMPACTION_PROFILES[explicitProfile]) return explicitProfile;
  const text = `${task.kind || ''} ${task.type || ''} ${task.mode || ''} ${task.task || ''}`.toLowerCase();
  if (/visual|vlm|screenshot|pdf|ocr|diff/.test(text)) return 'visual';
  if (/research|citation|claim|source/.test(text)) return 'research';
  if (/swarm|subagent|champion/.test(text)) return 'swarm';
  if (/meta|evolution|policy|verifier/.test(text)) return 'meta';
  if (/recover|failure|debug|timeout/.test(text)) return 'recovery';
  return 'coding';
}
