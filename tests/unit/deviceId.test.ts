/**
 * The device id behind the per-device confirmation cap (#177).
 *
 * The interesting cases are all the ones where storage does not work. A rider in
 * a private window must still be able to confirm — the server requires a UUID and
 * answers 400 without one — so every failure path has to yield a *stable* id for
 * the session rather than nothing, and rather than a fresh id per call (which
 * would look like it worked while suppressing nothing).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDeviceId, clearDeviceId } from '../../src/lib/deviceId.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = 'dbhm.deviceId';

const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function setStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreStorage(): void {
  if (realStorage) Object.defineProperty(globalThis, 'localStorage', realStorage);
  else Reflect.deleteProperty(globalThis as object, 'localStorage');
}

beforeEach(() => {
  clearDeviceId();
  globalThis.localStorage?.removeItem(KEY);
});

afterEach(() => {
  restoreStorage();
  clearDeviceId();
});

describe('with working storage', () => {
  it('mints a UUID once and returns the same one afterwards', () => {
    const first = getDeviceId();
    expect(first).toMatch(UUID_RE);
    expect(getDeviceId()).toBe(first);
    expect(globalThis.localStorage.getItem(KEY)).toBe(first);
  });

  it('survives a fresh module state — the id comes from storage, not memory', () => {
    const first = getDeviceId();
    clearDeviceId(); // wipes the ephemeral fallback AND storage
    globalThis.localStorage.setItem(KEY, first);
    expect(getDeviceId()).toBe(first);
  });

  it('replaces a stored value that is not a UUID rather than sending it', () => {
    // The server 400s a malformed id, so passing one through would turn some
    // other page's leftover key into a permanently broken confirm button.
    globalThis.localStorage.setItem(KEY, 'not-a-uuid');
    const id = getDeviceId();
    expect(id).toMatch(UUID_RE);
    expect(globalThis.localStorage.getItem(KEY)).toBe(id);
  });
});

describe('when storage is unavailable', () => {
  it('is STABLE across calls when there is no storage object at all', () => {
    // The bug this pins: optional-chaining the write would mint a new id every
    // call. The cap would then see every tap as a new device and suppress
    // nothing, while the code read as if it worked.
    setStorage(undefined);
    const first = getDeviceId();
    expect(first).toMatch(UUID_RE);
    expect(getDeviceId()).toBe(first);
    expect(getDeviceId()).toBe(first);
  });

  it('is STABLE across calls when reads throw (a private window)', () => {
    setStorage({
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    const first = getDeviceId();
    expect(first).toMatch(UUID_RE);
    expect(getDeviceId()).toBe(first);
  });

  it('is STABLE across calls when writes throw (quota exceeded)', () => {
    const setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    setStorage({ getItem: () => null, setItem, removeItem: () => undefined });
    const first = getDeviceId();
    expect(first).toMatch(UUID_RE);
    expect(getDeviceId()).toBe(first);
    // It really did attempt the write; the stability comes from the fallback,
    // not from the write having been skipped.
    expect(setItem).toHaveBeenCalled();
  });

  it('never returns an empty string — the server would 400 on one', () => {
    setStorage(undefined);
    expect(getDeviceId()).not.toBe('');
  });
});
