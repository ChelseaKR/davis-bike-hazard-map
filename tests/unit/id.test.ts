import { describe, it, expect } from 'vitest';
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
