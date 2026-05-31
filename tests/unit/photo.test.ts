import { describe, it, expect } from 'vitest';
import { computeScaledDimensions, dataUrlByteLength } from '../../src/lib/photo.ts';

describe('computeScaledDimensions', () => {
  it('scales the longest edge down to the cap, preserving aspect', () => {
    expect(computeScaledDimensions({ width: 4000, height: 3000 }, 1280)).toEqual({
      width: 1280,
      height: 960,
    });
  });

  it('does not upscale smaller images', () => {
    expect(computeScaledDimensions({ width: 800, height: 600 }, 1280)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('handles portrait orientation', () => {
    expect(computeScaledDimensions({ width: 3000, height: 4000 }, 1000)).toEqual({
      width: 750,
      height: 1000,
    });
  });

  it('is safe for a zero-size source', () => {
    expect(computeScaledDimensions({ width: 0, height: 0 }, 1280)).toEqual({
      width: 0,
      height: 0,
    });
  });
});

describe('dataUrlByteLength', () => {
  it('approximates the decoded byte length', () => {
    // "AAAA" base64 -> 3 bytes.
    expect(dataUrlByteLength('data:image/png;base64,AAAA')).toBe(3);
  });
  it('accounts for padding', () => {
    expect(dataUrlByteLength('data:image/png;base64,AAA=')).toBe(2);
  });
  it('returns 0 for a malformed string', () => {
    expect(dataUrlByteLength('nope')).toBe(0);
  });
});
