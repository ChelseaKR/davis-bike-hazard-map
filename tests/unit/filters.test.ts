import { describe, it, expect } from 'vitest';
import { applyFilters, isLive, sortByPriority } from '../../src/lib/filters.ts';
import type { Hazard } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: over.id ?? 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'moderate',
    description: null,
    location: { lat: 38.54, lng: -121.74 },
    photoUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    expiresAt: NOW + 1_000_000,
    ...over,
  };
}

describe('isLive', () => {
  it('is true for approved, unexpired hazards', () => {
    expect(isLive(hazard(), NOW)).toBe(true);
  });
  it('is false once expired', () => {
    expect(isLive(hazard({ expiresAt: NOW - 1 }), NOW)).toBe(false);
  });
  it('is false for non-approved statuses', () => {
    expect(isLive(hazard({ status: 'pending' }), NOW)).toBe(false);
  });
});

describe('applyFilters', () => {
  const set = [
    hazard({ id: 'a', category: 'pothole', severity: 'low' }),
    hazard({ id: 'b', category: 'glass_debris', severity: 'high' }),
    hazard({ id: 'c', category: 'pothole', severity: 'moderate', updatedAt: NOW - 40 * 86400000 }),
  ];

  it('filters by category', () => {
    const out = applyFilters(set, { categories: ['glass_debris'] }, NOW);
    expect(out.map((h) => h.id)).toEqual(['b']);
  });

  it('filters by minimum severity', () => {
    const out = applyFilters(set, { minSeverity: 'high' }, NOW);
    expect(out.map((h) => h.id)).toEqual(['b']);
  });

  it('filters by recency', () => {
    const out = applyFilters(set, { withinDays: 7 }, NOW);
    expect(out.map((h) => h.id).sort()).toEqual(['a', 'b']);
  });

  it('returns all when no filters', () => {
    expect(applyFilters(set, {}, NOW)).toHaveLength(3);
  });
});

describe('sortByPriority', () => {
  it('orders by severity (worst first) then recency', () => {
    const out = sortByPriority([
      hazard({ id: 'low', severity: 'low', updatedAt: NOW }),
      hazard({ id: 'high', severity: 'high', updatedAt: NOW - 5000 }),
      hazard({ id: 'highNewer', severity: 'high', updatedAt: NOW }),
    ]);
    expect(out.map((h) => h.id)).toEqual(['highNewer', 'high', 'low']);
  });
});
