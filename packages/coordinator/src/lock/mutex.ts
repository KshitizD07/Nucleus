export interface LeaseLock {
  filePath: string;
  holderId: string;
  expiresAt: number;
}

export class LeaseMutex {
  private locks: Map<string, LeaseLock> = new Map();

  public acquire(filePath: string, holderId: string, ttlSeconds: number = 15): boolean {
    const now = Date.now();
    const existing = this.locks.get(filePath);

    if (existing && existing.expiresAt > now && existing.holderId !== holderId) {
      return false;
    }

    this.locks.set(filePath, {
      filePath,
      holderId,
      expiresAt: now + ttlSeconds * 1000
    });
    return true;
  }

  public release(filePath: string, holderId: string): boolean {
    const existing = this.locks.get(filePath);
    if (!existing || existing.holderId !== holderId) {
      return false;
    }
    this.locks.delete(filePath);
    return true;
  }

  public getLock(filePath: string): LeaseLock | null {
    const existing = this.locks.get(filePath);
    if (!existing) return null;
    if (existing.expiresAt <= Date.now()) {
      this.locks.delete(filePath);
      return null;
    }
    return existing;
  }

  public isExpiringSoon(filePath: string, thresholdSeconds: number = 5): boolean {
    const lock = this.getLock(filePath);
    if (!lock) return false;
    const remainingMs = lock.expiresAt - Date.now();
    return remainingMs > 0 && remainingMs <= thresholdSeconds * 1000;
  }

  public getExpiringLocks(thresholdSeconds: number = 5): LeaseLock[] {
    const expiring: LeaseLock[] = [];
    const now = Date.now();
    for (const [path, lock] of this.locks) {
      if (lock.expiresAt > now && lock.expiresAt - now <= thresholdSeconds * 1000) {
        expiring.push(lock);
      }
    }
    return expiring;
  }
}
