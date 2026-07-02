/**
 * LoginThrottle — bounded per-account failed-login throttling (FIX-07).
 *
 * The lockout semantics themselves are also exercised end-to-end through the
 * login route in server.test.ts ("locks an account after repeated failed
 * logins"); here we pin down the memory bounds: the map must stay capped
 * under a spray of distinct usernames and must shed expired entries.
 */
import { describe, it, expect } from 'vitest';
import {
  LoginThrottle,
  MAX_LOGIN_FAILS,
  LOCKOUT_MS,
  MAX_TRACKED_ACCOUNTS,
} from '../../server/lib/loginThrottle.ts';

const T0 = 1_750_000_000_000; // arbitrary epoch-ms base

describe('lockout behavior', () => {
  it('locks after MAX_LOGIN_FAILS misses, until LOCKOUT_MS elapses', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_LOGIN_FAILS - 1; i++) {
      throttle.recordFailure('mod', T0 + i);
      expect(throttle.isLocked('mod', T0 + i)).toBe(false);
    }
    throttle.recordFailure('mod', T0 + 10);
    expect(throttle.isLocked('mod', T0 + 10)).toBe(true);
    expect(throttle.isLocked('mod', T0 + 10 + LOCKOUT_MS - 1)).toBe(true);
    expect(throttle.isLocked('mod', T0 + 10 + LOCKOUT_MS)).toBe(false);
  });

  it('a successful login clears the counter — the next lock needs a fresh run of misses', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_LOGIN_FAILS - 1; i++) throttle.recordFailure('mod', T0);
    throttle.clear('mod');
    expect(throttle.size).toBe(0);
    // One more miss is nowhere near a lock — the old count is gone.
    throttle.recordFailure('mod', T0 + 1);
    expect(throttle.isLocked('mod', T0 + 1)).toBe(false);
  });

  it('after a lockout expires the count restarts from zero', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_LOGIN_FAILS; i++) throttle.recordFailure('mod', T0);
    expect(throttle.isLocked('mod', T0)).toBe(true);
    const later = T0 + LOCKOUT_MS;
    expect(throttle.isLocked('mod', later)).toBe(false);
    throttle.recordFailure('mod', later);
    expect(throttle.isLocked('mod', later)).toBe(false); // 1 of MAX_LOGIN_FAILS
  });
});

describe('memory bounds', () => {
  it('never grows beyond MAX_TRACKED_ACCOUNTS under a spray of distinct usernames', () => {
    const throttle = new LoginThrottle();
    const total = MAX_TRACKED_ACCOUNTS + 5_000; // 10k+ distinct usernames
    for (let i = 0; i < total; i++) {
      throttle.recordFailure(`sprayed-user-${i}`, T0 + i);
    }
    expect(throttle.size).toBeLessThanOrEqual(MAX_TRACKED_ACCOUNTS);
    // The most recent account is still tracked; the oldest was evicted.
    throttle.recordFailure(`sprayed-user-${total - 1}`, T0 + total);
    expect(throttle.isLocked('sprayed-user-0', T0 + total)).toBe(false);
  });

  it('evicts the least-recently-failed account when the cap is exceeded', () => {
    const throttle = new LoginThrottle({ maxFails: 2, maxEntries: 3 });
    throttle.recordFailure('a', T0);
    throttle.recordFailure('b', T0 + 1);
    throttle.recordFailure('c', T0 + 2);
    throttle.recordFailure('a', T0 + 3); // 'a' re-fails: now locked, and most recent
    throttle.recordFailure('d', T0 + 4); // cap exceeded -> 'b' (oldest) evicted
    expect(throttle.size).toBe(3);
    expect(throttle.isLocked('a', T0 + 4)).toBe(true); // recent lock survives
    // 'b' starts from scratch: one more miss does not lock it.
    throttle.recordFailure('b', T0 + 5);
    expect(throttle.isLocked('b', T0 + 5)).toBe(false);
  });

  it('sweeps expired entries opportunistically on writes', () => {
    const throttle = new LoginThrottle();
    throttle.recordFailure('old-1', T0);
    throttle.recordFailure('old-2', T0 + 1);
    expect(throttle.size).toBe(2);
    // A write after the retention window prunes the stale entries.
    throttle.recordFailure('fresh', T0 + 1 + LOCKOUT_MS);
    expect(throttle.size).toBe(1);
  });

  it('drops a stale entry lazily on read', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_LOGIN_FAILS; i++) throttle.recordFailure('mod', T0);
    expect(throttle.size).toBe(1);
    expect(throttle.isLocked('mod', T0 + LOCKOUT_MS)).toBe(false);
    expect(throttle.size).toBe(0);
  });
});
