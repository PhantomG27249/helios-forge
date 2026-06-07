function budgetExclusionFor(item) {
  if (item.chunkId) {
    return {
      chunkId: item.chunkId,
      path: item.path,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      tokensEstimated: item.tokensEstimated || 1,
    };
  }
  return item.path || item.id || item.type;
}

export function buildContextPack({
  taskId,
  profile = 'coding_small',
  items = [],
  maxTokens = 6000,
}) {
  const included = [];
  const excludedDueToBudget = [];
  let usedTokens = 0;

  for (const item of items) {
    const itemTokens = item.tokensEstimated || 1;
    if (usedTokens + itemTokens > maxTokens) {
      excludedDueToBudget.push(budgetExclusionFor(item));
      continue;
    }
    included.push(item);
    usedTokens += itemTokens;
  }

  return {
    contextPackId: `ctx_${Date.now().toString(36)}`,
    taskId,
    profile,
    tokenBudget: maxTokens,
    tokensEstimated: usedTokens,
    items: included,
    excludedDueToBudget,
  };
}
