import { describe, it, expect } from 'vitest';
import { bucketByArea } from '../../src/lib/areas.ts';
import type { Hazard } from '../../shared/types.ts';

function at(lat: number, lng: number, id = 'h'): Hazard {
  return {
    id,
    clientId: id,
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
