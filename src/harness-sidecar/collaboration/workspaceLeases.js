function makeLeaseId() {
  return `lease_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class WorkspaceLeaseService {
  constructor() {
    this.leases = new Map();
  }

  acquire({ workspaceRoot, ownerId, purpose, ttlMs = 30 * 60 * 1000 }) {
    const existing = this.leases.get(workspaceRoot);
    if (existing && existing.expiresAt > Date.now()) {
      return { acquired: false, reason: 'leased', lease: existing };
    }

    const lease = {
      leaseId: makeLeaseId(),
      workspaceRoot,
      ownerId,
      purpose,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    this.leases.set(workspaceRoot, lease);
    return { acquired: true, ...lease };
  }

  release(leaseId, ownerId) {
    for (const [workspaceRoot, lease] of this.leases.entries()) {
      if (lease.leaseId === leaseId && lease.ownerId === ownerId) {
        this.leases.delete(workspaceRoot);
        return { released: true };
      }
    }
    return { released: false, reason: 'lease_not_found' };
  }
}
