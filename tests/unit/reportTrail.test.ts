import { describe, it, expect } from 'vitest';
import { reportTrail, reportStageLabel } from '../../src/lib/reportTrail.ts';
import type { Hazard, HandoffInfo } from '../../shared/types.ts';

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: { lat: 38.545, lng: -121.74 },
    photoUrl: null,
    status: 'pending',
    confirmations: 0,
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
    handoff: null,
    ...over,
  };
}

const handoff = (stage: HandoffInfo['stage']): HandoffInfo => ({
  provider: 'gogov',
  reference: 'h1',
  externalStatus: stage,
  stage,
  submittedAt: 0,
  updatedAt: 0,
  note: null,
});

const keys = (h: Hazard) => reportTrail(h).map((s) => s.key);
const stateOf = (h: Hazard, key: string) => reportTrail(h).find((s) => s.key === key)?.state;

describe('reportTrail', () => {
  it('a pending report is reported → in review → (on the map upcoming)', () => {
    const h = hazard({ status: 'pending' });
    expect(keys(h)).toEqual(['reported', 'review', 'onmap']);
    expect(stateOf(h, 'reported')).toBe('done');
    expect(stateOf(h, 'review')).toBe('current');
    expect(stateOf(h, 'onmap')).toBe('upcoming');
  });

  it('an approved report (no hand-off) is current on the map', () => {
    const h = hazard({ status: 'approved' });
    expect(stateOf(h, 'review')).toBe('done');
    expect(stateOf(h, 'onmap')).toBe('current');
  });

  it('a rejected report short-circuits to a terminal "not approved" step', () => {
    const h = hazard({ status: 'rejected' });
    expect(keys(h)).toEqual(['reported', 'review', 'rejected']);
    expect(stateOf(h, 'rejected')).toBe('rejected');
  });

  it('adds a city step once handed off, current until the city resolves it', () => {
    const h = hazard({ status: 'approved', handoff: handoff('in_progress') });
    expect(keys(h)).toContain('city');
    expect(stateOf(h, 'onmap')).toBe('done');
    expect(stateOf(h, 'city')).toBe('current');
  });

  it('marks the whole trail done when resolved (with the city step done)', () => {
    const h = hazard({ status: 'resolved', handoff: handoff('resolved'), resolvedAt: 5 });
    expect(keys(h)).toEqual(['reported', 'review', 'onmap', 'city', 'fixed']);
    expect(stateOf(h, 'city')).toBe('done');
    expect(stateOf(h, 'fixed')).toBe('done');
  });

  it('shows an expired tail when the report ages off the map', () => {
    const h = hazard({ status: 'expired' });
    expect(keys(h)).toContain('expired');
    expect(stateOf(h, 'expired')).toBe('done');
  });
});

describe('reportStageLabel', () => {
  it('summarises the moderation/lifecycle state in a phrase', () => {
    expect(reportStageLabel(hazard({ status: 'pending' }))).toMatch(/in review/i);
    expect(reportStageLabel(hazard({ status: 'rejected' }))).toMatch(/not approved/i);
    expect(reportStageLabel(hazard({ status: 'approved', confirmations: 0 }))).toMatch(/on the map/i);
    expect(reportStageLabel(hazard({ status: 'approved', confirmations: 2 }))).toMatch(/confirmed/i);
  });
});
