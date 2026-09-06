import { describe, it, expect } from 'vitest';
import { reportTrail, reportStageLabel } from '../../src/lib/reportTrail.ts';
import type { Hazard, HandoffDeliveryKind, PublicHandoffInfo } from '../../shared/types.ts';

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
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

const handoff = (
  stage: PublicHandoffInfo['stage'],
  delivery: HandoffDeliveryKind = 'delivered',
): PublicHandoffInfo => ({
  provider: 'gogov',
  reference: 'h1',
  externalStatus: stage,
  stage,
  delivery,
  submittedAt: 0,
  updatedAt: 0,
  note: null,
});

const labelOf = (h: Hazard, key: string) => reportTrail(h).find((s) => s.key === key)?.label;
const detailOf = (h: Hazard, key: string) => reportTrail(h).find((s) => s.key === key)?.detail;

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

  // Issue #162: `handoff.stage` reads 'submitted' from the moment a forward is
  // ATTEMPTED, dry-run or not, so the trail used to tell a reporter their report
  // had reached the city when nothing had left the server.
  it('does not claim a dry-run hand-off reached the city', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'dry_run') });
    expect(labelOf(h, 'city')).not.toMatch(/^sent to city/i);
    expect(labelOf(h, 'city')).toMatch(/not sent/i);
    // Nothing has happened, so the step is not "in progress" either.
    expect(stateOf(h, 'city')).toBe('upcoming');
    expect(detailOf(h, 'city')).toMatch(/no 311 connection/i);
  });

  it('does not claim a failed hand-off reached the city', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'undelivered') });
    expect(labelOf(h, 'city')).not.toMatch(/^sent to city/i);
    expect(stateOf(h, 'city')).toBe('current');
    expect(detailOf(h, 'city')).toMatch(/hasn't succeeded/i);
  });

  it('does not present an unrecorded delivery as a completed one', () => {
    const h = hazard({ status: 'approved', handoff: handoff('submitted', 'unknown') });
    expect(detailOf(h, 'city')).toMatch(/not recorded/i);
  });

  it('a delivered hand-off still reads as sent, with the city stage as the detail', () => {
    const h = hazard({ status: 'approved', handoff: handoff('in_progress', 'delivered') });
    expect(labelOf(h, 'city')).toMatch(/^sent to city/i);
    expect(detailOf(h, 'city')).toBe('City crew assigned');
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
