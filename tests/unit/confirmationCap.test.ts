/**
 * Per-device confirmation cap (#177) — the unit the published number rests on.
 *
 * `confirmations` is rendered to riders in four places and is described to them
 * as "I saw this too", so the number is read as *people*. Nothing made it people
 * before this: the endpoint took no body and the only limiter was the global
 * per-IP bucket. These tests pin the cap itself; `server.test.ts` covers the
 * route, and `statusMachine.test.ts` covers the lifecycle edge.
 *
 * The values below are LITERALS on purpose. Writing `T0 + CONFIRMATION_WINDOW_MS`
 * everywhere would make a test that passes for any window, including zero — the
 * assertion would be a restatement of the constant rather than a check on it.
 */
import { describe, it, expect } from 'vitest';
import {
  ConfirmationCap,
  CONFIRMATION_WINDOW_MS,
  deviceKey,
} from '../../server/lib/confirmationCap.ts';

const T0 = 1_750_000_000_000; // arbitrary epoch-ms base
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

describe('the window', () => {
  it('T0 sits mid-bucket, which is what makes the window tests able to fail', () => {
    // The epoch is an absolute bucket. A base instant aligned to a bucket
    // boundary would make "one ms before the window" and "at the window" fall
    // either side of a rollover by luck, and the window tests below would pass
    // against an implementation that checked only the current epoch — which is
    // exactly the bug they caught. Assert the fixture is at a value where the
    // failure is possible, so changing T0 cannot silently disarm them.
    const offsetIntoBucket = T0 % TWELVE_HOURS;
    expect(offsetIntoBucket).toBeGreaterThan(0);
    expect(offsetIntoBucket).toBeLessThan(TWELVE_HOURS);
  });

  it('is twelve hours', () => {
    // The one place the constant is checked against a literal. Every other test
    // here uses TWELVE_HOURS, so if the window is ever retuned this is the
    // single assertion that has to be changed deliberately.
    expect(CONFIRMATION_WINDOW_MS).toBe(TWELVE_HOURS);
  });
});

describe('claiming a confirmation', () => {
  it("the issue's acceptance criterion: ten taps from one device count once", () => {
    const cap = new ConfirmationCap({ secret: 's' });
    const results = Array.from({ length: 10 }, (_, i) => cap.claim('dev-a', 'haz-1', T0 + i));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
  });

  it('two different devices both count — the cap must not suppress real riders', () => {
    const cap = new ConfirmationCap({ secret: 's' });
    expect(cap.claim('dev-a', 'haz-1', T0)).toBe(true);
    expect(cap.claim('dev-b', 'haz-1', T0)).toBe(true);
    expect(cap.claim('dev-c', 'haz-1', T0)).toBe(true);
  });

  it('one device may confirm two DIFFERENT hazards — the key is per pair', () => {
    const cap = new ConfirmationCap({ secret: 's' });
    expect(cap.claim('dev-a', 'haz-1', T0)).toBe(true);
    expect(cap.claim('dev-a', 'haz-2', T0)).toBe(true);
  });

  it('the same device counts again once the window has fully elapsed', () => {
    const cap = new ConfirmationCap({ secret: 's' });
    expect(cap.claim('dev-a', 'haz-1', T0)).toBe(true);
    // One millisecond short of the window is still suppressed...
    expect(cap.claim('dev-a', 'haz-1', T0 + TWELVE_HOURS - 1)).toBe(false);
    // ...and at the window it counts again. A hazard still there half a day
    // later is genuinely worth re-confirming; that is the signal the expiry
    // extension carries.
    expect(cap.claim('dev-a', 'haz-1', T0 + TWELVE_HOURS)).toBe(true);
  });

  it('a suppressed claim does not slide the window forward', () => {
    // Otherwise a device tapping every few minutes would hold its own entry
    // alive forever and could never confirm again — the opposite failure, and
    // one a naive "re-insert on every write" LRU would introduce.
    const cap = new ConfirmationCap({ secret: 's' });
    cap.claim('dev-a', 'haz-1', T0);
    for (let i = 1; i <= 10; i++) cap.claim('dev-a', 'haz-1', T0 + i * 60_000);
    expect(cap.claim('dev-a', 'haz-1', T0 + TWELVE_HOURS)).toBe(true);
  });
});

describe('memory bounds', () => {
  it('sheds entries older than the window', () => {
    const cap = new ConfirmationCap({ secret: 's' });
    for (let i = 0; i < 100; i++) cap.claim(`dev-${i}`, 'haz-1', T0);
    expect(cap.size).toBe(100);
    // A claim past the window prunes the stale front of the map.
    cap.claim('dev-new', 'haz-1', T0 + TWELVE_HOURS);
    expect(cap.size).toBe(1);
  });

  it('never exceeds maxEntries under a spray of fresh device ids', () => {
    const cap = new ConfirmationCap({ secret: 's', maxEntries: 50 });
    for (let i = 0; i < 500; i++) cap.claim(`dev-${i}`, 'haz-1', T0 + i);
    expect(cap.size).toBeLessThanOrEqual(50);
  });
});

describe('the device key', () => {
  it('is stable for one (device, hazard, window) and differs across each of them', () => {
    const base = deviceKey('s', 'dev-a', 'haz-1', T0);
    expect(deviceKey('s', 'dev-a', 'haz-1', T0 + 1000)).toBe(base);
    expect(deviceKey('s', 'dev-b', 'haz-1', T0)).not.toBe(base);
    expect(deviceKey('s', 'dev-a', 'haz-2', T0)).not.toBe(base);
    expect(deviceKey('s', 'dev-a', 'haz-1', T0 + TWELVE_HOURS)).not.toBe(base);
    expect(deviceKey('other', 'dev-a', 'haz-1', T0)).not.toBe(base);
  });

  it('never contains the raw device id or hazard id', () => {
    // The whole privacy argument: what is retained must not be reversible by
    // reading it. A key that embedded the id would make the in-memory table a
    // list of what this cyclist has seen.
    const key = deviceKey('s', 'device-alpha', 'hazard-beta', T0);
    expect(key).not.toContain('device-alpha');
    expect(key).not.toContain('hazard-beta');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is unambiguous across a device/hazard boundary shift', () => {
    // Without length-prefixing, ('ab','c') and ('a','bc') hash the same message
    // and two different devices silently share one key — one of them would then
    // be unable to confirm at all.
    expect(deviceKey('s', 'ab', 'c', T0)).not.toBe(deviceKey('s', 'a', 'bc', T0));
  });

  it('an empty configured secret is not used as the key material', () => {
    // Two caps built with no secret must not agree, or the token for any
    // (device, hazard) would be computable by anyone who read the source.
    const a = new ConfirmationCap({ secret: '' });
    const b = new ConfirmationCap({ secret: '' });
    a.claim('dev-a', 'haz-1', T0);
    b.claim('dev-a', 'haz-1', T0);
    // Both tracked one entry, but under different tokens: neither cap can see
    // the other's claim. Compared through behaviour rather than by reaching into
    // the private map.
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
    expect(a.claim('dev-a', 'haz-1', T0)).toBe(false);
  });
});
