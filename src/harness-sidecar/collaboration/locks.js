export class LockService {
  constructor() {
    this.locks = new Map();
  }

  acquire({ resource, ownerId, taskId, ttlMs = 15 * 60 * 1000 }) {
    const existing = this.locks.get(resource);
    if (existing && existing.expiresAt > Date.now()) {
      return {
        acquired: false,
        reason: 'locked',
        lock: existing,
      };
    }

    const lock = {
      lockId: `lock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      resource,
      ownerId,
      taskId,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    this.locks.set(resource, lock);
    return {
      acquired: true,
      ...lock,
    };
  }

  release(lockId, ownerId) {
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.lockId === lockId && lock.ownerId === ownerId) {
        this.locks.delete(resource);
        return { released: true };
      }
    }
    return { released: false, reason: 'lock_not_found' };
  }
}
