function tokenize(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean),
  );
}

function unique(tokens) {
  return [...new Set(tokens)];
}

function pathSearchText(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts.at(-1) || '';
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, '');
  return `${normalized.replace(/[./-]+/g, ' ')} ${fileName} ${nameWithoutExtension}`;
}

export function retrieveWorkspaceContext({ index, query, maxItems = 8 }) {
  const queryTokens = tokenize(query);

  return index.items
    .map((item) => {
      const contentTokens = tokenize(item.snippet || item.content || '');
      const pathTokens = tokenize(pathSearchText(item.path));
      const fileName = String(item.path || '').split(/[\\/]/).at(-1) || '';
      const nameTokens = tokenize(fileName.replace(/\.[^.]+$/, ''));
      const contentMatched = [...queryTokens].filter((token) => contentTokens.has(token));
      const pathMatched = [...queryTokens].filter((token) => pathTokens.has(token));
      const nameMatched = [...queryTokens].filter((token) => nameTokens.has(token));
      const matched = unique([...contentMatched, ...pathMatched]);
      const score = contentMatched.length + pathMatched.length * 2 + nameMatched.length * 3;
      const reasons = [];
      if (contentMatched.length) reasons.push(`content terms: ${contentMatched.join(', ')}`);
      if (pathMatched.length) reasons.push(`path terms: ${pathMatched.join(', ')}`);
      return {
        ...item,
        matched,
        score,
        reason: score
          ? `Matched query ${reasons.join('; ')}`
          : 'No direct query term match',
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || a.path.localeCompare(b.path)
      || (a.lineStart || 0) - (b.lineStart || 0)
    ))
    .slice(0, maxItems);
}
