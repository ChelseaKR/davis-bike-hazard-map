import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  haversineMeters,
  fuzzCoordinate,
  isWithinDavis,
  DEFAULT_FUZZ_METERS,
} from '../../shared/geo.ts';
import { DAVIS_BOUNDS, DAVIS_CENTER } from '../../shared/validation.ts';

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

/**
 * Property tests for the fuzzing guarantee (FIX-12).
 *
 * `snap()` places published points on grid lines offset half a step from the
 * rounding grid (cell *edges*, not centres), so each axis can move up to one
 * full step: worst case ~= sqrt(2) x gridMeters on the diagonal (~99 m at the
 * default 70 m grid). These properties enforce the documented bound —
 * `docs/audits/privacy-notes.md` cites the constants asserted here.
 */
describe('fuzzCoordinate (property-tested guarantee)', () => {
  /** Documented, test-enforced ceiling: 1.5 x grid = 105 m at the default grid. */
  const MAX_DISPLACEMENT_M = DEFAULT_FUZZ_METERS * 1.5;
  /** Mirrors the constant in shared/geo.ts (the spec under test). */
  const METERS_PER_DEG_LAT = 111_320;

  const davisLat = fc.double({
    min: DAVIS_BOUNDS.minLat,
    max: DAVIS_BOUNDS.maxLat,
    noNaN: true,
  });
  const davisLng = fc.double({
    min: DAVIS_BOUNDS.minLng,
    max: DAVIS_BOUNDS.maxLng,
    noNaN: true,
  });
  const davisPoint = fc.record({ lat: davisLat, lng: davisLng });

  const lngStepAt = (lat: number): number =>
    DEFAULT_FUZZ_METERS / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

  it('never displaces a Davis point by more than 1.5 x the grid size (105 m)', () => {
    fc.assert(
      fc.property(davisPoint, (p) => {
        expect(haversineMeters(p, fuzzCoordinate(p))).toBeLessThan(MAX_DISPLACEMENT_M);
      }),
      { numRuns: 1000 },
    );
  });

  it('measures the real worst case: ~sqrt(2) x grid — cell-edge, not cell-centre', () => {
    let worst = 0;
    // Deterministic sweep of the Davis bbox; coprime-ish counts sample many
    // different phases relative to the snapping grid.
    const LAT_STEPS = 71;
    const LNG_STEPS = 73;
    for (let i = 0; i <= LAT_STEPS; i++) {
      for (let j = 0; j <= LNG_STEPS; j++) {
        const p = {
          lat: DAVIS_BOUNDS.minLat + ((DAVIS_BOUNDS.maxLat - DAVIS_BOUNDS.minLat) * i) / LAT_STEPS,
          lng: DAVIS_BOUNDS.minLng + ((DAVIS_BOUNDS.maxLng - DAVIS_BOUNDS.minLng) * j) / LNG_STEPS,
        };
        worst = Math.max(worst, haversineMeters(p, fuzzCoordinate(p)));
      }
    }
    // Adversarial point: both axes sit just below a rounding boundary, so each
    // axis moves ~one full step (the analytic worst case for edge snapping).
    const latStep = DEFAULT_FUZZ_METERS / METERS_PER_DEG_LAT;
    const advLat = (Math.round(38.55 / latStep) - 0.499) * latStep;
    const lngStep = lngStepAt(advLat);
    const adv = { lat: advLat, lng: (Math.round(-121.74 / lngStep) - 0.499) * lngStep };
    worst = Math.max(worst, haversineMeters(adv, fuzzCoordinate(adv)));

    // Below the documented ceiling…
    expect(worst).toBeLessThan(MAX_DISPLACEMENT_M);
    // …but clearly beyond the half-step a "cell centre" reading would allow
    // (sqrt(2)/2 x 70 ~= 49.5 m): this pins the edge behaviour on purpose.
    expect(worst).toBeGreaterThan(DEFAULT_FUZZ_METERS * 1.3);
  });

  it('is deterministic: the same location always publishes the same point', () => {
    fc.assert(
      fc.property(davisPoint, (p) => {
        expect(fuzzCoordinate(p)).toEqual(fuzzCoordinate({ ...p }));
      }),
    );
  });

  it('collapses same-latitude points in one longitude cell to identical output', () => {
    // The longitude step depends on latitude, so cell-level indistinguishability
    // is exact for points sharing a latitude: any two of them that round to the
    // same longitude cell publish byte-identical coordinates.
    const unit = fc.double({ min: 0.01, max: 0.99, noNaN: true });
    fc.assert(
      fc.property(davisLat, davisLng, unit, unit, (lat, lng, u1, u2) => {
        const step = lngStepAt(lat);
        const cell = Math.round(lng / step);
        // Two arbitrary longitudes strictly inside the same rounding cell.
        const a = { lat, lng: (cell - 0.49 + 0.98 * u1) * step };
        const b = { lat, lng: (cell - 0.49 + 0.98 * u2) * step };
        expect(fuzzCoordinate(a)).toEqual(fuzzCoordinate(b));
      }),
    );
  });

  it('re-fuzzing a published point stays within the same bound', () => {
    fc.assert(
      fc.property(davisPoint, (p) => {
        const once = fuzzCoordinate(p);
        expect(haversineMeters(once, fuzzCoordinate(once))).toBeLessThan(MAX_DISPLACEMENT_M);
      }),
    );
  });

  it('publishes at most 6 decimal places per axis', () => {
    fc.assert(
      fc.property(davisPoint, (p) => {
        const f = fuzzCoordinate(p);
        expect(Math.round(f.lat * 1e6) / 1e6).toBe(f.lat);
        expect(Math.round(f.lng * 1e6) / 1e6).toBe(f.lng);
      }),
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
