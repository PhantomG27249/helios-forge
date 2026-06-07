const CONTEXT_PROFILES = {
  coding_small: {
    name: 'coding_small',
    maxTokens: 32000,
    ragTokens: 6000,
    memoryTokens: 2000,
    toolHistoryTokens: 5000,
  },
  coding_deep: {
    name: 'coding_deep',
    maxTokens: 128000,
    ragTokens: 24000,
    memoryTokens: 6000,
    toolHistoryTokens: 16000,
  },
  deep_research: {
    name: 'deep_research',
    maxTokens: 200000,
    paperTokens: 50000,
    claimGraphTokens: 16000,
    visualTokens: 20000,
  },
};

export function getContextProfile(name) {
  const profile = CONTEXT_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown context profile: ${name}`);
  }
  return { ...profile };
}
