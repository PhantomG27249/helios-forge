function normalizeChampion(champion) {
  return {
    attemptId: champion.attemptId,
    score: Number.isFinite(champion.score) ? champion.score : 0,
    safety: champion.safety || 'unknown',
    cost: Number.isFinite(champion.cost) ? champion.cost : Number.POSITIVE_INFINITY,
    metadata: champion.metadata ? { ...champion.metadata } : {},
  };
}

export function createChampionArchive() {
  return {
    champions: [],
  };
}

export function archiveChampion(archive, champion) {
  const normalized = normalizeChampion(champion);
  const existingIndex = archive.champions.findIndex((entry) => entry.attemptId === normalized.attemptId);

  if (existingIndex >= 0) {
    archive.champions[existingIndex] = normalized;
  } else {
    archive.champions.push(normalized);
  }

  return normalized;
}

export function selectBestChampion(archive, { requireSafe = true } = {}) {
  const candidates = archive.champions
    .filter((champion) => !requireSafe || champion.safety === 'safe')
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.cost !== right.cost) return left.cost - right.cost;
      return left.attemptId.localeCompare(right.attemptId);
    });

  return candidates[0] || null;
}
