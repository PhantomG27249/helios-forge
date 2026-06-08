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

function diversifyByPath(items) {
  const byPath = new Map();
  for (const item of items) {
    const sourcePath = item.path || item.id || item.type || '';
    if (!byPath.has(sourcePath)) byPath.set(sourcePath, []);
    byPath.get(sourcePath).push(item);
  }

  const paths = [...byPath.keys()];
  const diversified = [];
  let round = 0;
  while (diversified.length < items.length) {
    let added = false;
    for (const sourcePath of paths) {
      const candidate = byPath.get(sourcePath)[round];
      if (!candidate) continue;
      diversified.push(candidate);
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  return diversified;
}

export function buildContextPack({
  taskId,
  profile = 'coding_small',
  items = [],
  maxTokens = 6000,
  sourceDiversity = true,
}) {
  const included = [];
  const excludedDueToBudget = [];
  let usedTokens = 0;
  const orderedItems = sourceDiversity ? diversifyByPath(items) : items;

  for (const item of orderedItems) {
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
    sourcePaths: [...new Set(included.map((item) => item.path).filter(Boolean))],
    items: included,
    excludedDueToBudget,
  };
}
