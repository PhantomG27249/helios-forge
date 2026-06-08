import { REQUIRED_COMPACTION_FIELDS } from './compactionSchema.js';
import { COMPACTION_PROFILES, resolveCompactionProfile } from './compactionProfiles.js';

function percentFrom(state = {}) {
  return Number(state.pressurePercent ?? state.percent ?? 0);
}

function actionsFor(percent) {
  if (percent >= 95) return ['summarize_older_tool_outputs', 'compress_raw_logs', 'freeze_decision_ledger', 'rebuild_context_pack', 'request_budget_or_profile_change'];
  if (percent >= 90) return ['summarize_older_tool_outputs', 'compress_raw_logs', 'freeze_decision_ledger', 'rebuild_context_pack'];
  if (percent >= 80) return ['summarize_older_tool_outputs', 'compress_raw_logs'];
  if (percent >= 70) return ['summarize_older_tool_outputs'];
  return [];
}

function triggerFor(percent, trigger) {
  if (trigger) return trigger;
  return percent >= 70 ? 'auto' : 'none';
}

function tokenBudgetFor({ pressurePercent, maxTokens }) {
  const safeMax = Math.max(1, Number(maxTokens || 6000));
  if (pressurePercent >= 95) return Math.floor(safeMax * 0.45);
  if (pressurePercent >= 90) return Math.floor(safeMax * 0.55);
  if (pressurePercent >= 80) return Math.floor(safeMax * 0.65);
  if (pressurePercent >= 70) return Math.floor(safeMax * 0.75);
  return safeMax;
}

export function planCompaction({
  task = {},
  pressureState = {},
  items = [],
  profile,
  trigger,
} = {}) {
  const pressurePercent = percentFrom(pressureState);
  const selectedProfile = resolveCompactionProfile(task, profile);
  const profileConfig = COMPACTION_PROFILES[selectedProfile] || COMPACTION_PROFILES.coding;
  const preserveTypes = new Set(profileConfig.preserveTypes || []);
  const mustKeepItemIds = items
    .filter((item = {}) => item.priority === 0 || preserveTypes.has(item.type))
    .map((item) => item.id || item.path || item.type)
    .filter(Boolean);
  const actions = actionsFor(pressurePercent);

  return {
    taskId: task.taskId || task.id || null,
    profile: selectedProfile,
    trigger: triggerFor(pressurePercent, trigger),
    pressurePercent,
    targetTokens: tokenBudgetFor({
      pressurePercent,
      maxTokens: pressureState.maxTokens,
    }),
    actions,
    compressionStrategy: actions.includes('rebuild_context_pack')
      ? 'schema_rebuild'
      : actions.includes('compress_raw_logs')
        ? 'lossy_log_compression'
        : actions.includes('summarize_older_tool_outputs')
          ? 'tool_output_summary'
          : 'none',
    mustKeepItemIds,
    expectedArtifactFields: [...new Set([...REQUIRED_COMPACTION_FIELDS, ...(profileConfig.requiredSections || [])])],
    warningFlags: pressurePercent >= 95 ? ['operator_action_required'] : [],
  };
}
