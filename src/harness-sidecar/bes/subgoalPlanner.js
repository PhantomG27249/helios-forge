const CODING_BUGFIX_SUBGOALS = [
  ['S1', 'Reproduce the failing behavior', 'command_output_contains_failure'],
  ['S2', 'Identify the failing assertion or stack trace', 'diagnosis_mentions_file_line_or_test'],
  ['S3', 'Locate relevant implementation files', 'context_pack_contains_relevant_source'],
  ['S4', 'Produce a minimal patch proposal', 'patch_touches_relevant_source_file'],
  ['S5', 'Run targeted verifier', 'targeted_verifier_passes'],
  ['S6', 'Check for regressions or explicit residual risk', 'final_audit_mentions_risk'],
];

export function planSubgoals({ taskType = 'general', task }) {
  const template = taskType === 'coding_bugfix'
    ? CODING_BUGFIX_SUBGOALS
    : [
      ['S1', 'Clarify task objective', 'objective_is_written'],
      ['S2', 'Collect relevant context', 'context_pack_created'],
      ['S3', 'Produce candidate result', 'candidate_artifact_created'],
      ['S4', 'Validate candidate result', 'validator_finished'],
    ];

  return template.map(([id, description, verifier]) => ({
    id,
    description,
    verifier,
    task,
    status: 'pending',
  }));
}
