function makeClaimId() {
  return `claim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class TaskClaimStore {
  constructor() {
    this.claims = new Map();
  }

  claim({ taskId, actorId, role }) {
    const key = `${taskId}:${role}`;
    const existing = this.claims.get(key);
    if (existing && existing.active) {
      return { claimed: false, reason: 'claimed', claim: existing };
    }

    const claim = {
      claimId: makeClaimId(),
      taskId,
      actorId,
      role,
      active: true,
      claimedAt: new Date().toISOString(),
    };
    this.claims.set(key, claim);
    return { claimed: true, ...claim };
  }

  release(claimId, actorId) {
    for (const claim of this.claims.values()) {
      if (claim.claimId === claimId && claim.actorId === actorId && claim.active) {
        claim.active = false;
        claim.releasedAt = new Date().toISOString();
        return { released: true };
      }
    }
    return { released: false, reason: 'claim_not_found' };
  }
}
