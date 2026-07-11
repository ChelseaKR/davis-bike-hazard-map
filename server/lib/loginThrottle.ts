/**
 * Per-account failed-login throttling with a bounded, self-pruning store
 * (FIX-07).
 *
 * After `maxFails` misses an account is locked out for `lockoutMs`. The
 * counters live in an insertion-ordered Map used as an LRU: every write
 * re-inserts the entry, so iteration order is oldest-failure-first. That
 * makes both bounds cheap:
 *
 * - **Lazy expiry:** an entry is stale once `lockoutMs` has passed since its
 *   last failure (which also means any lockout it carried has expired).
 *   Stale entries are dropped on read.
 * - **Opportunistic sweep:** every write prunes stale entries from the front
 *   of the map, stopping at the first fresh one (the same self-pruning
 *   pattern as the webhook ReplayCache).
 * - **Hard cap:** if a spray of distinct usernames outruns expiry, the
 *   least-recently-failed entries are evicted so the map never exceeds
 *   `maxEntries` — an attacker cannot grow process memory unboundedly.
 *   Eviction prefers entries that are not currently locked out, so the
 *   spray cannot be used to lift an active lockout.
 *
 * NOTE: this state is per-process. Throttling is only effective while the
 * app runs as a single instance — see the README runbook before scaling out.
 */

/** Failed attempts before an account is locked out. */
export const MAX_LOGIN_FAILS = 5;
/** How long a locked account stays locked (and how long counters are retained). */
export const LOCKOUT_MS = 15 * 60 * 1000;
/** Hard cap on distinct accounts tracked at once. */
export const MAX_TRACKED_ACCOUNTS = 10_000;

interface FailureEntry {
  /** Misses since the last lockout/clear. */
  count: number;
  /** Locked until this epoch-ms instant (0 = not locked). */
  until: number;
  /** Epoch ms of the most recent failure — drives staleness/LRU order. */
  lastFailureAt: number;
}

export class LoginThrottle {
  /** username -> entry; insertion order == recency order (writes re-insert). */
  private readonly failures = new Map<string, FailureEntry>();
  private readonly maxFails: number;
  private readonly lockoutMs: number;
  private readonly maxEntries: number;

  constructor(opts: { maxFails?: number; lockoutMs?: number; maxEntries?: number } = {}) {
    this.maxFails = opts.maxFails ?? MAX_LOGIN_FAILS;
    this.lockoutMs = opts.lockoutMs ?? LOCKOUT_MS;
    this.maxEntries = opts.maxEntries ?? MAX_TRACKED_ACCOUNTS;
  }

  /** Is the account currently locked out? Drops the entry if it went stale. */
  isLocked(username: string, now: number): boolean {
    const entry = this.failures.get(username);
    if (!entry) return false;
    if (this.isStale(entry, now)) {
      this.failures.delete(username);
      return false;
    }
    return entry.until > now;
  }

  /**
   * Record a failed login. On the `maxFails`-th miss the account locks for
   * `lockoutMs` and the counter resets (so the next lock needs a fresh run
   * of misses once the lockout expires).
   */
  recordFailure(username: string, now: number): void {
    this.prune(now);
    const entry = this.failures.get(username) ?? { count: 0, until: 0, lastFailureAt: 0 };
    entry.count += 1;
    entry.lastFailureAt = now;
    if (entry.count >= this.maxFails) {
      entry.until = now + this.lockoutMs;
      entry.count = 0;
    }
    // Re-insert so the map's insertion order stays recency order.
    this.failures.delete(username);
    this.failures.set(username, entry);
    // Hard cap: evict the least-recently-failed account, PREFERRING entries
    // that are not currently locked out. Evicting a locked entry would lift
    // its lockout, so a spray of fresh usernames must never be able to
    // unlock an account under active brute-force. Locked entries fall to
    // eviction only when every tracked entry is locked (the attacker paid
    // maxFails misses per slot to get there, and the memory bound must
    // still hold).
    while (this.failures.size > this.maxEntries) {
      let evict: string | undefined;
      for (const [candidate, e] of this.failures) {
        if (e.until <= now) {
          evict = candidate;
          break;
        }
      }
      evict ??= this.failures.keys().next().value;
      if (evict === undefined) break;
      this.failures.delete(evict);
    }
  }

  /** A successful login clears the account's counter (and any lockout). */
  clear(username: string): void {
    this.failures.delete(username);
  }

  /** Current number of tracked accounts (for tests/observability). */
  get size(): number {
    return this.failures.size;
  }

  /**
   * Stale once `lockoutMs` has elapsed since the last failure. A lockout is
   * set to `lastFailureAt + lockoutMs`, so a stale entry's lockout (if any)
   * has necessarily expired too.
   */
  private isStale(entry: FailureEntry, now: number): boolean {
    return now - entry.lastFailureAt >= this.lockoutMs;
  }

  private prune(now: number): void {
    // Entries iterate oldest-failure-first, so stop at the first fresh one.
    for (const [username, entry] of this.failures) {
      if (!this.isStale(entry, now)) break;
      this.failures.delete(username);
    }
  }
}
