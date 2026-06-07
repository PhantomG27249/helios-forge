export const DEFAULT_VISION_MODELS = [
  { provider: 'Zeus', modelId: 'example/ebft-model' },
];

function normalizeInput(input) {
  const values = Array.isArray(input) ? input.filter((value) => typeof value === 'string') : [];
  if (!values.includes('text')) values.unshift('text');
  if (!values.includes('image')) values.push('image');
  return values;
}

export function ensureModelImageInput(rawJson, targets = DEFAULT_VISION_MODELS) {
  const config = JSON.parse(String(rawJson || '').replace(/^\uFEFF/, ''));
  const targetKeys = new Set(targets.map((target) => `${target.provider}/${target.modelId}`));
  let changed = false;

  for (const [providerName, provider] of Object.entries(config.providers || {})) {
    for (const model of provider?.models || []) {
      if (!targetKeys.has(`${providerName}/${model?.id}`)) continue;

      const nextInput = normalizeInput(model.input);
      if (JSON.stringify(model.input || []) !== JSON.stringify(nextInput)) {
        model.input = nextInput;
        changed = true;
      }
    }
  }

  return {
    changed,
    rawJson: JSON.stringify(config, null, 2),
  };
}
