export function resolveVersionConflict({
  currentVersion,
  attemptedVersion,
  currentValue,
  attemptedPatch,
}) {
  if (attemptedVersion !== currentVersion) {
    return {
      resolution: 'manual_review',
      reason: 'stale_version',
      currentVersion,
      attemptedVersion,
      currentValue: { ...currentValue },
      attemptedPatch: { ...attemptedPatch },
    };
  }

  return {
    resolution: 'merge',
    version: currentVersion + 1,
    value: {
      ...currentValue,
      ...attemptedPatch,
    },
  };
}
