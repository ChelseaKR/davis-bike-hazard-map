import { describe, it, expect } from 'vitest';
import { timeAgo, formatLatLng } from '../../src/lib/format.ts';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe('timeAgo', () => {
  it('says "just now" for very recent times', () => {
    expect(timeAgo(NOW - 5_000, NOW)).toBe('just now');
  });
  it('formats minutes', () => {
    expect(timeAgo(NOW - 5 * MIN, NOW)).toBe('5 min ago');
  });
  it('formats hours with pluralization', () => {
    expect(timeAgo(NOW - 60 * MIN, NOW)).toBe('1 hr ago');
    expect(timeAgo(NOW - 3 * 60 * MIN, NOW)).toBe('3 hrs ago');
  });
  it('formats days and weeks', () => {
    expect(timeAgo(NOW - 2 * 24 * 60 * MIN, NOW)).toBe('2 days ago');
    expect(timeAgo(NOW - 14 * 24 * 60 * MIN, NOW)).toBe('2 wks ago');
  });
  it('never returns a negative/future value', () => {
    expect(timeAgo(NOW + 100_000, NOW)).toBe('just now');
  });
});

describe('formatLatLng', () => {
  it('formats to 4 decimal places (~11 m precision)', () => {
    expect(formatLatLng(38.544912, -121.740512)).toBe('38.5449, -121.7405');
  });
});
