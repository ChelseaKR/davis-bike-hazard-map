import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  fuzzCoordinate,
  isWithinDavis,
  DEFAULT_FUZZ_METERS,
} from '../../shared/geo.ts';
import { DAVIS_CENTER } from '../../shared/validation.ts';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters(DAVIS_CENTER, DAVIS_CENTER)).toBe(0);
  });

  it('approximates a known short distance', () => {
    // ~0.001 deg latitude ≈ 111 m.
    const d = haversineMeters(
      { lat: 38.5449, lng: -121.7405 },
      { lat: 38.5459, lng: -121.7405 },
    );
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe('fuzzCoordinate', () => {
  it('is deterministic (same input -> same output)', () => {
    const p = { lat: 38.54493, lng: -121.74051 };
    expect(fuzzCoordinate(p)).toEqual(fuzzCoordinate(p));
  });

  it('moves the point no further than ~one grid cell', () => {
    const p = { lat: 38.54493, lng: -121.74051 };
    const fuzzed = fuzzCoordinate(p, DEFAULT_FUZZ_METERS);
    const moved = haversineMeters(p, fuzzed);
    // Snapping can shift by up to ~one cell diagonal.
    expect(moved).toBeLessThan(DEFAULT_FUZZ_METERS * 1.6);
  });

  it('snaps nearby points (same latitude band) into the same published cell', () => {
    // The longitude grid step depends on latitude, so use the same latitude;
    // two points a few metres apart in longitude collapse to one cell.
    const a = fuzzCoordinate({ lat: 38.5449, lng: -121.74048 }, 100);
    const b = fuzzCoordinate({ lat: 38.5449, lng: -121.74052 }, 100);
    expect(a).toEqual(b);
  });

  it('reduces precision below the original coordinate', () => {
    const p = { lat: 38.544937, lng: -121.740518 };
    const fuzzed = fuzzCoordinate(p, 70);
    // The fuzzed point should differ from the precise input (privacy).
    expect(fuzzed).not.toEqual(p);
  });
});

describe('isWithinDavis', () => {
  it('accepts the city centre', () => {
    expect(isWithinDavis(DAVIS_CENTER)).toBe(true);
  });

  it('rejects a point far outside (e.g. Sacramento)', () => {
    expect(isWithinDavis({ lat: 38.5816, lng: -121.4944 })).toBe(false);
  });
});
