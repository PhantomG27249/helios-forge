import { createEmptyCompactionArtifact, mergeItemIntoArtifact } from './compactionSchema.js';

export function compactContextItems({
  items = [],
  maxTokens = Number.POSITIVE_INFINITY,
  artifact: artifactOverrides = {},
} = {}) {
  const sorted = [...items].sort((left, right) => (
    (left.priority ?? 5) - (right.priority ?? 5)
  ));
  const included = [];
  const excluded = [];
  const artifact = createEmptyCompactionArtifact(artifactOverrides);
  let usedTokens = 0;

  for (const item of sorted) {
    const tokens = item.tokensEstimated || 1;
    if (usedTokens + tokens <= maxTokens || item.priority === 0) {
      included.push(item);
      mergeItemIntoArtifact(artifact, item);
      usedTokens += tokens;
    } else {
      excluded.push(item.id || item.path || item.type);
    }
  }

  return {
    artifact,
    items: included,
    excluded,
    tokensEstimated: usedTokens,
  };
}
