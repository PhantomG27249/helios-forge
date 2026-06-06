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
      excludedDueToBudget.push(item.path || item.id || item.type);
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
