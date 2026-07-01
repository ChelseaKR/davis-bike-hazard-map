import { describe, it, expect, afterEach } from 'vitest';
import { newId } from '../../src/lib/id.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('newId', () => {
  it('produces a v4 UUID', () => {
    expect(newId()).toMatch(UUID_RE);
  });

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
  });
});

describe('newId fallback (no crypto.randomUUID)', () => {
  const realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  afterEach(() => {
    if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  });

  function setCrypto(value: unknown) {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
  }

  it('uses getRandomValues and still sets the v4 version/variant bits', () => {
    setCrypto({
      getRandomValues: (a: Uint8Array) => {
        // Fill with 0xff so the masking of the version/variant nibbles is visible.
        a.fill(0xff);
        return a;
      },
    });
    const id = newId();
    expect(id).toMatch(UUID_RE);
    // version nibble forced to 4, variant nibble forced to 8..b even from all-1s.
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('falls back to Math.random when no Web Crypto is present', () => {
    setCrypto(undefined);
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    for (const id of ids) expect(id).toMatch(UUID_RE);
    expect(ids.size).toBe(50);
  });
});
