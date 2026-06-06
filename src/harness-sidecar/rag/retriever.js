function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .filter(Boolean),
  );
}

export function retrieveWorkspaceContext({ index, query, maxItems = 8 }) {
  const queryTokens = tokenize(query);

  return index.items
    .map((item) => {
      const haystack = `${item.path} ${item.snippet}`;
      const itemTokens = tokenize(haystack);
      const matched = [...queryTokens].filter((token) => itemTokens.has(token));
      return {
        ...item,
        matched,
        score: matched.length,
        reason: matched.length
          ? `Matched query terms: ${matched.join(', ')}`
          : 'No direct query term match',
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, maxItems);
}
