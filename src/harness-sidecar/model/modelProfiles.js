const MODEL_PROFILES = {
  qwen36_vlm_fast: {
    name: 'qwen36_vlm_fast',
    maxContextTokens: 64000,
    supportsVision: true,
    supportsTools: true,
    defaultTemperature: 0.3,
  },
  qwen36_vlm_deep: {
    name: 'qwen36_vlm_deep',
    maxContextTokens: 262000,
    supportsVision: true,
    supportsTools: true,
    defaultTemperature: 0.7,
  },
  critic_low_temp: {
    name: 'critic_low_temp',
    maxContextTokens: 64000,
    supportsVision: true,
    supportsTools: true,
    defaultTemperature: 0.1,
  },
  alphahelion_ebft5: {
    name: 'alphahelion_ebft5',
    provider: 'Zeus',
    model: 'selimaktas/ebft-5',
    baseUrl: null,
    maxContextTokens: 262144,
    supportsVision: false,
    supportsTools: true,
    defaultTemperature: 0.6,
    chatTemplateKwargs: {
      enable_thinking: false,
    },
  },
};

export function getModelProfile(name) {
  const profile = MODEL_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown model profile: ${name}`);
  }
  return { ...profile };
}
