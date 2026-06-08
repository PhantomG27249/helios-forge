const DEFAULT_OBJECTIVES = {
  quality: 0.4,
  safety: 0.3,
  cost: 0.15,
  latency: 0.15,
};
const CLOSE_DELTA = 0.05;

function candidateId(candidate, index) {
  return String(candidate?.candidateId ?? candidate?.id ?? `candidate_${index}`);
}

function metric(candidate, name) {
  const value = candidate?.metrics?.[name] ?? candidate?.[name];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeObjectives(objectives = {}) {
  return { ...DEFAULT_OBJECTIVES, ...objectives };
}

function basePreferenceScore(candidate, objectives) {
  const weights = normalizeObjectives(objectives);
  return (
    metric(candidate, 'quality') * weights.quality +
    metric(candidate, 'safety') * weights.safety -
    metric(candidate, 'cost') * weights.cost -
    metric(candidate, 'latency') * weights.latency
  );
}

function validationScore(candidate) {
  const validations = candidate?.validations ?? candidate?.selfConsistency ?? candidate?.checks;
  if (!Array.isArray(validations) || validations.length === 0) {
    return 0;
  }
  return validations.reduce((score, validation) => {
    if (validation === true || validation?.passed === true || validation?.consistent === true) {
      return score + 1;
    }
    if (validation === false || validation?.passed === false || validation?.consistent === false) {
      return score - 1;
    }
    return score;
  }, 0);
}

function metricReasons(candidate) {
  const reasons = [];
  if (metric(candidate, 'quality') > 0) {
    reasons.push(`quality=${metric(candidate, 'quality').toFixed(3)}`);
  }
  if (metric(candidate, 'safety') > 0) {
    reasons.push(`safety=${metric(candidate, 'safety').toFixed(3)}`);
  }
  if (metric(candidate, 'cost') > 0) {
    reasons.push(`cost=${metric(candidate, 'cost').toFixed(3)}`);
  }
  if (metric(candidate, 'latency') > 0) {
    reasons.push(`latency=${metric(candidate, 'latency').toFixed(3)}`);
  }
  return reasons;
}

function compareRanking(a, b) {
  if (b.votes !== a.votes) {
    return b.votes - a.votes;
  }
  if (b.preferenceScore !== a.preferenceScore) {
    return b.preferenceScore - a.preferenceScore;
  }
  return a.candidateId.localeCompare(b.candidateId);
}

function comparePair(a, b) {
  if (a.preferenceScore !== b.preferenceScore) {
    return a.preferenceScore > b.preferenceScore ? a : b;
  }
  return a.candidateId.localeCompare(b.candidateId) <= 0 ? a : b;
}

function coresetRationale(coreset) {
  const items = Array.isArray(coreset?.items) ? coreset.items : [];
  if (items.length === 0) {
    return 'no coreset items';
  }
  return items
    .slice()
    .sort((a, b) => String(a.taskId).localeCompare(String(b.taskId)))
    .map((item) => `${item.taskId}:${(item.reasons ?? []).join('+') || 'selected'}`)
    .join(', ');
}

export function judgeCandidatePreference({ candidates = [], coreset, objectives } = {}) {
  const rankingsById = new Map(candidates.map((candidate, index) => {
    const id = candidateId(candidate, index);
    const preferenceScore = basePreferenceScore(candidate, objectives);
    return [id, {
      candidateId: id,
      candidate,
      preferenceScore,
      votes: 0,
      reasons: metricReasons(candidate),
      validationScore: validationScore(candidate),
    }];
  }));

  const rankings = [...rankingsById.values()].sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const pairwise = [];

  for (let i = 0; i < rankings.length; i += 1) {
    for (let j = i + 1; j < rankings.length; j += 1) {
      const left = rankings[i];
      const right = rankings[j];
      const delta = Number((left.preferenceScore - right.preferenceScore).toFixed(12));
      let winner = comparePair(left, right);
      let reason = 'weighted objectives';

      if (Math.abs(delta) <= CLOSE_DELTA) {
        if (left.validationScore !== right.validationScore) {
          winner = left.validationScore > right.validationScore ? left : right;
          reason = 'self-consistency votes';
          winner.votes += 1;
        } else if (delta === 0) {
          reason = 'candidate id tie-break';
        }
      }

      winner.votes += 1;
      pairwise.push({
        left: left.candidateId,
        right: right.candidateId,
        winner: winner.candidateId,
        delta: Math.abs(delta),
        reason,
      });
    }
  }

  for (const ranking of rankings) {
    if (ranking.validationScore !== 0) {
      ranking.reasons.push(`selfConsistency=${ranking.validationScore}`);
    }
  }

  const sortedRankings = rankings
    .map(({ validationScore: _validationScore, candidate: _candidate, ...ranking }) => ranking)
    .sort(compareRanking);
  const winner = sortedRankings[0] ?? null;

  return {
    winner,
    rankings: sortedRankings,
    pairwise,
    rationale: winner
      ? `${winner.candidateId} preferred from ${candidates.length} candidates against ${coresetRationale(coreset)}`
      : 'no candidates available',
  };
}
