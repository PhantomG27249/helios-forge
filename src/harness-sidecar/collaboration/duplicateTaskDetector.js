const STOP_WORDS = new Set([
  'a',
  'add',
  'and',
  'for',
  'in',
  'of',
  'or',
  'the',
  'to',
  'with',
]);

function taskText(task = {}) {
  return [task.title, task.summary, task.description].filter(Boolean).join(' ');
}

function normalizeToken(token) {
  return token
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/(?:ing|ed|s)$/u, '');
}

function tokenize(text = '') {
  return new Set(
    text
      .split(/\s+/u)
      .map(normalizeToken)
      .filter((token) => token && token.length > 2 && !STOP_WORDS.has(token)),
  );
}

function lexicalSimilarity(leftText, rightText) {
  const left = tokenize(leftText);
  const right = tokenize(rightText);
  if (!left.size || !right.size) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }

  return overlap / (left.size + right.size - overlap);
}

export function detectDuplicateTask({
  task,
  activeTasks = [],
  threshold = 0.35,
} = {}) {
  const currentText = taskText(task);
  const matches = activeTasks
    .map((activeTask) => ({
      taskId: activeTask.taskId,
      ownerId: activeTask.ownerId,
      summary: activeTask.summary,
      title: activeTask.title,
      similarity: lexicalSimilarity(currentText, taskText(activeTask)),
    }))
    .filter((match) => match.similarity >= threshold)
    .sort((left, right) => right.similarity - left.similarity);

  return {
    duplicateLikely: matches.length > 0,
    matches,
    recommendedAction: matches.length > 0 ? 'join_or_fork' : 'create_new',
  };
}

export { lexicalSimilarity };

