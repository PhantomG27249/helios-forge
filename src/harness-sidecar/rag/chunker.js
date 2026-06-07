import { createHash } from 'node:crypto';

function normalizeRelativePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function splitLines(content) {
  if (content === '') return [''];
  const lines = content.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function chunkTextFile({
  path: filePath,
  content,
  maxLinesPerChunk = 80,
  maxSnippetChars = 4000,
} = {}) {
  const normalizedPath = normalizeRelativePath(filePath || '');
  const chunkLineCount = Math.max(1, Math.floor(maxLinesPerChunk));
  const lines = splitLines(normalizeNewlines(content || ''));
  const chunks = [];

  for (let index = 0; index < lines.length; index += chunkLineCount) {
    const chunkLines = lines.slice(index, index + chunkLineCount);
    const chunkContent = chunkLines.join('\n');
    const contentHash = hashContent(chunkContent);
    const lineStart = index + 1;
    const lineEnd = index + chunkLines.length;
    const snippet = chunkContent.slice(0, maxSnippetChars);

    chunks.push({
      type: 'file_chunk',
      chunkId: `${normalizedPath}:${lineStart}-${lineEnd}:${contentHash.slice(0, 12)}`,
      path: normalizedPath,
      lineStart,
      lineEnd,
      contentHash,
      snippet,
      content: snippet,
      tokensEstimated: estimateTokens(snippet),
    });
  }

  return chunks;
}
