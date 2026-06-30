import { describe, it, expect } from 'vitest';
import { bucketByArea, normalizeCoverage } from '../../src/lib/areas.ts';
import type { Hazard } from '../../shared/types.ts';

function at(lat: number, lng: number, id = 'h'): Hazard {
  return {
    id,
    category: 'pothole',
    severity: 'low',
    description: null,
    location: { lat, lng },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
  };
}

describe('bucketByArea', () => {
  it('lists every named area even when it has zero reports', () => {
    const counts = bucketByArea([]);
    expect(counts).toHaveLength(6);
    expect(counts.every((c) => c.count === 0)).toBe(true);
    expect(counts.map((c) => c.name)).toContain('Central Davis');
  });

  it('buckets points into the right areas', () => {
    const counts = bucketByArea([
      at(38.57, -121.74, 'n'), // North Davis
      at(38.52, -121.74, 's'), // South Davis
      at(38.5449, -121.7405, 'c'), // Central
    ]);
    const get = (name: string) => counts.find((c) => c.name === name)?.count;
    expect(get('North Davis')).toBe(1);
    expect(get('South Davis')).toBe(1);
    expect(get('Central Davis')).toBe(1);
  });

  it('adds an "Elsewhere in Davis" bucket only when needed', () => {
    const outside = bucketByArea([at(38.59, -121.69, 'x')]); // far NE corner
    expect(outside.some((c) => c.name === 'Elsewhere in Davis')).toBe(true);
    expect(bucketByArea([]).some((c) => c.name === 'Elsewhere in Davis')).toBe(false);
  });
});

describe('normalizeCoverage (equity-aware)', () => {
  it('flags every exposed area as a data desert when there are no reports', () => {
    const cov = normalizeCoverage([]);
    expect(cov).toHaveLength(6);
    expect(cov.every((a) => a.isDataDesert)).toBe(true);
    expect(cov.every((a) => a.representation === 'none')).toBe(true);
    expect(cov.every((a) => a.count === 0)).toBe(true);
  });

  it('marks an area with reports as not a data desert', () => {
    const cov = normalizeCoverage([at(38.5449, -121.7405, 'c')]); // Central Davis
    const central = cov.find((a) => a.name === 'Central Davis')!;
    expect(central.count).toBe(1);
    expect(central.isDataDesert).toBe(false);
    expect(central.representation).not.toBe('none');
    // The high-ridership campus, still empty, stays flagged as a desert.
    expect(cov.find((a) => a.name === 'UC Davis campus')!.isDataDesert).toBe(true);
  });

  it('reads a high-ridership area with all the reports as over-represented, and starves the rest', () => {
    // Pile several reports into Central Davis only.
    const many = Array.from({ length: 8 }, (_, i) => at(38.5449, -121.7405, `c${i}`));
    const cov = normalizeCoverage(many);
    const central = cov.find((a) => a.name === 'Central Davis')!;
    expect(central.observedShare).toBe(1);
    expect(central.representation).toBe('over');
    // Campus has the highest exposure but zero reports → desert / none.
    expect(cov.find((a) => a.name === 'UC Davis campus')!.representation).toBe('none');
  });

  it('gives the "Elsewhere" bucket no exposure baseline and never calls it a desert', () => {
    const cov = normalizeCoverage([at(38.59, -121.69, 'x')]); // far NE corner
    const elsewhere = cov.find((a) => a.name === 'Elsewhere in Davis')!;
    expect(elsewhere.exposureWeight).toBe(0);
    expect(elsewhere.expectedShare).toBeNull();
    expect(elsewhere.isDataDesert).toBe(false);
  });
});
