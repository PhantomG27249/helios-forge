const DIRECT_HARNESS_PATTERNS = [
  /^\/harness\b/i,
  /^\/(?:research|deep-research|forge)\b/i,
  /\b(?:use|run|launch|start)\b.*\b(?:harness|bes|meta|sidecar)\b/i,
  /\b(?:harness|bes|meta)\b.*\b(?:this|project|task|prompt|repo|repository)\b/i,
];

const DEFAULT_HARNESS_BUDGET = Object.freeze({
  maxToolCalls: 20,
  maxWallMinutes: 15,
});

function normalizePrompt(text) {
  return String(text || '').trim();
}

function stripHarnessCommand(text) {
  return text.replace(/^\/(?:harness|research|deep-research|forge)\b[\s:;-]*/i, '').trim();
}

export function classifyHarnessPrompt(text, { hasImages = false, isStreaming = false } = {}) {
  const normalized = normalizePrompt(text);

  if (isStreaming) {
    return {
      shouldRun: false,
      mode: 'background',
      task: normalized,
      reason: 'streaming_prompt',
    };
  }

  if (!normalized && !hasImages) {
    return {
      shouldRun: false,
      mode: 'background',
      task: '',
      reason: 'empty_prompt',
    };
  }

  const isSlashHarness = /^\/(?:harness|research|deep-research|forge)\b/i.test(normalized);
  const direct = DIRECT_HARNESS_PATTERNS.some((pattern) => pattern.test(normalized));
  const task = isSlashHarness ? stripHarnessCommand(normalized) || normalized : normalized || '[Image prompt]';

  return {
    shouldRun: true,
    mode: direct ? 'direct' : 'background',
    task,
    reason: direct ? 'explicit_harness_intent' : 'automatic_background',
  };
}

export function buildHarnessTaskMessage(route, { budget = DEFAULT_HARNESS_BUDGET } = {}) {
  if (!route?.shouldRun) return null;

  return {
    type: 'harness_task_start',
    task: route.task,
    mode: 'full',
    budget: { ...budget },
    source: route.mode === 'direct' ? 'prompt_direct' : 'prompt_background',
  };
}
