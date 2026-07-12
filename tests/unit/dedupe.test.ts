import { describe, it, expect } from 'vitest';
import { findNearbyDuplicates } from '../../src/lib/dedupe.ts';
import type { Hazard } from '../../shared/types.ts';

function hazard(over: Partial<Hazard> & { id: string }): Hazard {
  return {
    category: 'pothole',
    severity: 'moderate',
    description: null,
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
    ...over,
  };
}

const here = { lat: 38.5449, lng: -121.7405 };

describe('findNearbyDuplicates', () => {
  it('matches a same-category, active hazard at the same spot', () => {
    const dupes = findNearbyDuplicates([hazard({ id: 'a' })], here, 'pothole');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].hazard.id).toBe('a');
    expect(dupes[0].distanceMeters).toBeLessThan(1);
  });

  it('ignores a different category', () => {
    const dupes = findNearbyDuplicates(
      [hazard({ id: 'a', category: 'glass_debris' })],
      here,
      'pothole',
    );
    expect(dupes).toHaveLength(0);
  });

  it('ignores hazards beyond the radius', () => {
    // ~0.01 deg lng ≈ 870 m at this latitude — well past the 120 m default.
    const far = hazard({ id: 'far', location: { lat: 38.5449, lng: -121.73 } });
    expect(findNearbyDuplicates([far], here, 'pothole')).toHaveLength(0);
  });

  it('ignores non-active (resolved / pending) hazards', () => {
    const resolved = hazard({ id: 'r', status: 'resolved' });
    const pending = hazard({ id: 'p', status: 'pending' });
    expect(findNearbyDuplicates([resolved, pending], here, 'pothole')).toHaveLength(0);
  });

  it('returns nearest first and caps the list', () => {
    const near = hazard({ id: 'near', location: { lat: 38.5449, lng: -121.7405 } });
    const mid = hazard({ id: 'mid', location: { lat: 38.5451, lng: -121.7405 } });
    const dupes = findNearbyDuplicates([mid, near], here, 'pothole', { max: 1 });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].hazard.id).toBe('near');
  });
});
