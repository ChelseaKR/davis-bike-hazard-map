import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  haversineMeters,
  fuzzCoordinate,
  isWithinDavis,
  DEFAULT_FUZZ_METERS,
} from '../../shared/geo.ts';
import { DAVIS_CENTER, DAVIS_BOUNDS } from '../../shared/validation.ts';

const METERS_PER_DEG_LAT = 111_320;
const davisPoint = fc.record({
  lat: fc.double({ min: DAVIS_BOUNDS.minLat, max: DAVIS_BOUNDS.maxLat, noNaN: true }),
  lng: fc.double({ min: DAVIS_BOUNDS.minLng, max: DAVIS_BOUNDS.maxLng, noNaN: true }),
});

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

// Property tests for the privacy control: the measured guarantees quoted in
// docs/audits/privacy-notes.md are enforced here rather than asserted by example.
describe('fuzzCoordinate (privacy properties over the Davis bbox)', () => {
  it('is a pure, deterministic function of the point', () => {
    fc.assert(
      fc.property(davisPoint, (p) => {
        expect(fuzzCoordinate(p)).toEqual(fuzzCoordinate(p));
      }),
    );
  });

  it('publishes a point within one grid step per axis (< 100 m overall) of the true point', () => {
    // snap() moves each axis by at most one full DEFAULT_FUZZ_METERS step, so
    // the worst case is the cell diagonal, √2 · 70 m ≈ 99 m. This bounds how far
    // a public point can sit from the reporter's true location.
    fc.assert(
      fc.property(davisPoint, (p) => {
        const moved = haversineMeters(p, fuzzCoordinate(p, DEFAULT_FUZZ_METERS));
        expect(moved).toBeLessThan(100);
      }),
    );
  });

  it('collapses every true point in a grid cell to one public point (not averageable)', () => {
    // Two true reports that share a cell publish identically, so repeated
    // reports from around one spot cannot be averaged back to the true point.
    fc.assert(
      fc.property(
        davisPoint,
        fc.double({ min: -0.49, max: 0.49, noNaN: true }),
        (p, fraction) => {
          const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
          const lngStep = DEFAULT_FUZZ_METERS / Math.max(1, metersPerDegLng);
          const cellIndex = Math.round(p.lng / lngStep);
          // A sibling at the same latitude whose longitude stays inside p's cell
          // (offset < half a step from the cell index) must fuzz identically.
          const sibling = { lat: p.lat, lng: (cellIndex + fraction) * lngStep };
          expect(fuzzCoordinate(sibling)).toEqual(fuzzCoordinate(p));
        },
      ),
    );
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
