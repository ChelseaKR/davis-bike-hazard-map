import { describe, it, expect } from 'vitest';
import { timeAgo, formatLatLng, formatDistance, formatDuration } from '../../src/lib/format.ts';

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

describe('formatDistance', () => {
  it('uses metres under 1 km and km above', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12_340)).toBe('12.3 km');
  });
  it('guards non-finite / negative', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-5)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(30)).toBe('<1 min');
    expect(formatDuration(5 * 60)).toBe('5 min');
    expect(formatDuration(90 * 60)).toBe('1 hr 30 min');
    expect(formatDuration(120 * 60)).toBe('2 hr');
  });
  it('guards non-finite / negative', () => {
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});
