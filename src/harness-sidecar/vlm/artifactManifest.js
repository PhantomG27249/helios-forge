import { createHash } from 'node:crypto';

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

export function createStableArtifactId(prefix, payload) {
  const digest = createHash('sha256').update(stableStringify(payload)).digest('hex').slice(0, 12);
  return `${prefix}_${digest}`;
}

export function estimateImageTokens({ width = 0, height = 0 } = {}) {
  return Math.max(1, Math.round((width * height) / 1000));
}

export function createVisualEstimate({ width = 0, height = 0, imageCount = 1 } = {}) {
  return {
    imageCount,
    pixelCount: width * height,
    tokensEstimated: estimateImageTokens({ width, height }),
  };
}
