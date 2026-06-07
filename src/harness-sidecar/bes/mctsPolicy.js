export function uctScore(child, { parentVisits = 0, exploration = Math.SQRT2 } = {}) {
  if (!child || !Number.isFinite(child.visits) || child.visits <= 0) {
    return Infinity;
  }

  const meanValue = (Number(child.value) || 0) / child.visits;
  const visitBase = Math.max(1, parentVisits);
  const explorationValue = exploration * Math.sqrt(Math.log(visitBase) / child.visits);

  return meanValue + explorationValue;
}

export function selectChild({ children = [], parentVisits = 0, exploration = Math.SQRT2 } = {}) {
  if (!children.length) return null;

  return children
    .map((child, index) => ({
      child,
      index,
      score: uctScore(child, { parentVisits, exploration }),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    })[0].child;
}

export function backpropagate(node, value) {
  let current = node;
  const numericValue = Number(value) || 0;

  while (current) {
    current.visits = (Number(current.visits) || 0) + 1;
    current.value = (Number(current.value) || 0) + numericValue;
    current = current.parent || null;
  }
}
