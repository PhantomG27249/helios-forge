export const FAILURE_CATEGORIES = [
  'malformed_tool_call',
  'unknown_tool',
  'tool_timeout',
  'repeated_tool_failure',
  'patch_apply_failed',
  'sandbox_crash',
  'no_progress',
  'budget_exhausted',
];

const TAXONOMY = {
  malformed_tool_call: {
    severity: 'medium',
    recoverable: true,
    recommendedAction: 'repair_tool_call_json',
  },
  unknown_tool: {
    severity: 'low',
    recoverable: true,
    recommendedAction: 'retry_with_available_tool_name',
  },
  tool_timeout: {
    severity: 'medium',
    recoverable: true,
    recommendedAction: 'retry_with_smaller_scope_or_timeout',
  },
  repeated_tool_failure: {
    severity: 'high',
    recoverable: false,
    recommendedAction: 'stop_repeating_tool_and_change_strategy',
  },
  patch_apply_failed: {
    severity: 'high',
    recoverable: true,
    recommendedAction: 'request_rebase_or_manual_patch_review',
  },
  sandbox_crash: {
    severity: 'critical',
    recoverable: true,
    recommendedAction: 'record_crash_and_restart_sandbox',
  },
  no_progress: {
    severity: 'high',
    recoverable: false,
    recommendedAction: 'stop_loop_and_emit_partial_report',
  },
  budget_exhausted: {
    severity: 'high',
    recoverable: false,
    recommendedAction: 'request_budget_or_downshift_scope',
  },
};

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Error) return value.message;
  return String(value);
}

function inferCategory(input = {}) {
  if (FAILURE_CATEGORIES.includes(input.category)) return input.category;
  if (input.budget?.exhausted || input.reason === 'budget_exhausted') return 'budget_exhausted';

  const joined = [
    input.reason,
    input.status,
    input.kind,
    input.type,
    normalizeText(input.error),
    normalizeText(input.message),
  ].join(' ').toLowerCase();

  if (joined.includes('unknown_tool') || joined.includes('unknown tool')) return 'unknown_tool';
  if (joined.includes('malformed_tool_call') || joined.includes('malformed tool')) return 'malformed_tool_call';
  if (joined.includes('timeout') || joined.includes('timed out')) return 'tool_timeout';
  if (joined.includes('repeated_tool_failure') || joined.includes('repeated tool')) return 'repeated_tool_failure';
  if (joined.includes('patch_apply_failed') || joined.includes('patch apply') || joined.includes('apply patch')) {
    return 'patch_apply_failed';
  }
  if (joined.includes('sandbox_crash') || (joined.includes('sandbox') && joined.includes('crash'))) {
    return 'sandbox_crash';
  }
  if (joined.includes('no_progress') || joined.includes('no progress')) return 'no_progress';

  return 'no_progress';
}

export function classifyHarnessFailure(input = {}) {
  const category = inferCategory(input);
  const base = TAXONOMY[category] || TAXONOMY.no_progress;

  return {
    category,
    severity: base.severity,
    recoverable: base.recoverable,
    recommendedAction: base.recommendedAction,
  };
}
