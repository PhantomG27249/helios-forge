function tokenize(text) {
  const expanded = String(text)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return expanded
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function unique(tokens) {
  return [...new Set(tokens)];
}

function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}

function pathSearchText(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const fileName = parts.at(-1) || '';
  const nameWithoutExtension = fileName.replace(/\.[^.]+$/, '');
  return `${normalized.replace(/[./_-]+/g, ' ')} ${fileName} ${nameWithoutExtension}`;
}

function scoreBm25({ queryTokens, documentTokens, documentFrequency, documentCount, averageLength }) {
  const frequencies = termFrequency(documentTokens);
  const length = Math.max(1, documentTokens.length);
  const k1 = 1.2;
  const b = 0.75;
  let score = 0;

  for (const token of queryTokens) {
    const frequency = frequencies.get(token) || 0;
    if (!frequency) continue;
    const idf = Math.log(1 + (documentCount - (documentFrequency.get(token) || 0) + 0.5) / ((documentFrequency.get(token) || 0) + 0.5));
    const denominator = frequency + k1 * (1 - b + b * (length / averageLength));
    score += idf * ((frequency * (k1 + 1)) / denominator);
  }

  return score;
}

function scoreTermFrequency(queryTokens, documentTokens) {
  const frequencies = termFrequency(documentTokens);
  return queryTokens.reduce((score, token) => score + (frequencies.get(token) || 0), 0);
}

function diversifyByPath(items, maxItems) {
  const byPath = new Map();
  for (const item of items) {
    const sourcePath = item.path || '';
    if (!byPath.has(sourcePath)) byPath.set(sourcePath, []);
    byPath.get(sourcePath).push(item);
  }

  const paths = [...byPath.keys()].sort((left, right) => {
    const leftBest = byPath.get(left)[0];
    const rightBest = byPath.get(right)[0];
    return (
      rightBest.score - leftBest.score
      || left.localeCompare(right)
    );
  });
  const diversified = [];
  let round = 0;
  while (diversified.length < maxItems) {
    let added = false;
    for (const sourcePath of paths) {
      const candidate = byPath.get(sourcePath)[round];
      if (!candidate) continue;
      diversified.push(candidate);
      added = true;
      if (diversified.length >= maxItems) break;
    }
    if (!added) break;
    round += 1;
  }
  return diversified;
}

export function retrieveWorkspaceContext({
  index,
  query,
  maxItems = 8,
  sourceDiversity = true,
} = {}) {
  const queryTokens = unique(tokenize(query));
  const corpus = (index?.items || []).map((item) => ({
    item,
    contentTokens: tokenize(item.snippet || item.content || ''),
  }));
  const documentCount = Math.max(1, corpus.length);
  const averageLength = Math.max(
    1,
    corpus.reduce((sum, entry) => sum + entry.contentTokens.length, 0) / documentCount,
  );
  const documentFrequency = new Map();
  for (const token of queryTokens) {
    documentFrequency.set(
      token,
      corpus.filter((entry) => new Set(entry.contentTokens).has(token)).length,
    );
  }

  const scored = corpus
    .map(({ item, contentTokens }) => {
      const pathTokens = tokenize(pathSearchText(item.path));
      const fileName = String(item.path || '').split(/[\\/]/).at(-1) || '';
      const nameTokens = tokenize(fileName.replace(/\.[^.]+$/, ''));
      const contentMatched = queryTokens.filter((token) => contentTokens.includes(token));
      const pathMatched = queryTokens.filter((token) => pathTokens.includes(token));
      const nameMatched = queryTokens.filter((token) => nameTokens.includes(token));
      const contentScore = scoreBm25({
        queryTokens,
        documentTokens: contentTokens,
        documentFrequency,
        documentCount,
        averageLength,
      }) + scoreTermFrequency(queryTokens, contentTokens) * 0.4;
      const score = contentScore + pathMatched.length * 1.5 + nameMatched.length * 2.5;
      const reasons = [];
      if (contentMatched.length) reasons.push(`BM25 content terms: ${contentMatched.join(', ')}`);
      if (pathMatched.length) reasons.push(`path terms: ${pathMatched.join(', ')}`);
      return {
        ...item,
        matched: unique([...contentMatched, ...pathMatched]),
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
    ));

  if (!sourceDiversity) return scored.slice(0, maxItems);
  return diversifyByPath(scored, maxItems);
}
