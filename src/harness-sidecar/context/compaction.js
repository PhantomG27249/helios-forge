export function compactContextItems({ items = [], maxTokens }) {
  const sorted = [...items].sort((left, right) => (
    (left.priority ?? 5) - (right.priority ?? 5)
  ));
  const included = [];
  const excluded = [];
  let usedTokens = 0;

  for (const item of sorted) {
    const tokens = item.tokensEstimated || 1;
    if (usedTokens + tokens <= maxTokens || item.priority === 0) {
      included.push(item);
      usedTokens += tokens;
    } else {
      excluded.push(item.id || item.path || item.type);
    }
  }

  return {
    items: included,
    excluded,
    tokensEstimated: usedTokens,
  };
}
