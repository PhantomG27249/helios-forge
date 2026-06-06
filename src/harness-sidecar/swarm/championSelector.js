export function chooseChampion(attempts = []) {
  if (!attempts.length) return null;

  return [...attempts].sort((left, right) => {
    if (left.verifierPassed !== right.verifierPassed) {
      return left.verifierPassed ? -1 : 1;
    }
    if ((right.score || 0) !== (left.score || 0)) {
      return (right.score || 0) - (left.score || 0);
    }
    return (left.patchStats?.changedLines || Number.MAX_SAFE_INTEGER)
      - (right.patchStats?.changedLines || Number.MAX_SAFE_INTEGER);
  })[0];
}
