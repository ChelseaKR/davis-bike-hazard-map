import { describe, it, expect } from 'vitest';
import {
  mapExternalStatus,
  isResolvingStage,
  applyHandoffStatus,
  initialHandoff,
} from '../../server/lib/lifecycle.ts';
import { lifecycleStage } from '../../shared/types.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

const NOW = 1_700_000_000_000;

function stored(over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id: 'haz-1',
    clientId: 'c1',
    category: 'pothole',
    severity: 'high',
    description: null,
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.545, lng: -121.74 },
    photo: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    moderation: [],
    ...over,
  };
}

describe('mapExternalStatus', () => {
  it.each([
    ['Submitted', 'submitted'],
    ['Received', 'acknowledged'],
    ['Open - New', 'acknowledged'],
    ['Assigned to crew', 'in_progress'],
    ['In Progress', 'in_progress'],
    ['Closed - Resolved', 'resolved'],
    ['Fixed', 'resolved'],
    ['Closed', 'closed'],
    ['Rejected (duplicate)', 'rejected'],
    ["Won't fix", 'rejected'],
    ['some unknown thing', 'acknowledged'],
  ])('maps %s → %s', (raw, stage) => {
    expect(mapExternalStatus(raw)).toBe(stage);
  });
});

describe('isResolvingStage', () => {
  it('treats resolved and closed as resolving', () => {
    expect(isResolvingStage('resolved')).toBe(true);
    expect(isResolvingStage('closed')).toBe(true);
    expect(isResolvingStage('in_progress')).toBe(false);
    expect(isResolvingStage('rejected')).toBe(false);
  });
});

describe('applyHandoffStatus', () => {
  it('updates the hand-off record without resolving for an in-progress status', () => {
    const { patch, stage, resolved } = applyHandoffStatus(stored(), 'In Progress', NOW);
    expect(stage).toBe('in_progress');
    expect(resolved).toBe(false);
    expect(patch.status).toBeUndefined();
    expect(patch.handoff?.stage).toBe('in_progress');
    expect(patch.handoff?.externalStatus).toBe('In Progress');
    expect(patch.handoff?.reference).toBe('haz-1');
  });

  it('resolves the hazard and coarsens location on a fixed status', () => {
    const h = stored({ handoff: initialHandoff(stored(), NOW) });
    const { patch, resolved } = applyHandoffStatus(h, 'Closed - Resolved', NOW + 1000);
    expect(resolved).toBe(true);
    expect(patch.status).toBe('resolved');
    expect(patch.resolvedAt).toBe(NOW + 1000);
    expect(patch.preciseLocation).toEqual(h.publicLocation);
    // Preserves the original submission time.
    expect(patch.handoff?.submittedAt).toBe(NOW);
  });

  it('does not re-resolve an already-resolved hazard', () => {
    const { resolved, patch } = applyHandoffStatus(stored({ status: 'resolved' }), 'Closed', NOW);
    expect(resolved).toBe(false);
    expect(patch.status).toBeUndefined();
  });

  it('acks the delivery receipt and cancels pending retries on any sync-back (R3)', () => {
    const h = stored({
      handoff: initialHandoff(stored(), NOW),
      handoffDelivery: {
        state: 'retrying',
        dryRun: false,
        attempts: 2,
        lastAttemptAt: NOW,
        nextRetryAt: NOW + 60_000,
        lastError: '311 responded 502',
      },
    });
    const { patch } = applyHandoffStatus(h, 'Received', NOW + 1000);
    expect(patch.handoffDelivery).toEqual({
      state: 'acked',
      dryRun: false,
      attempts: 2,
      lastAttemptAt: NOW,
      nextRetryAt: null,
      lastError: null,
    });
  });

  it('leaves the receipt absent when the hazard never had one', () => {
    const { patch } = applyHandoffStatus(stored(), 'Received', NOW);
    expect(patch.handoffDelivery).toBeUndefined();
  });
});

describe('lifecycleStage projection', () => {
  it('derives the public stage from status + confirmations', () => {
    expect(lifecycleStage({ status: 'approved', confirmations: 0 })).toBe('reported');
    expect(lifecycleStage({ status: 'approved', confirmations: 2 })).toBe('confirmed');
    expect(lifecycleStage({ status: 'resolved', confirmations: 5 })).toBe('resolved');
    expect(lifecycleStage({ status: 'expired', confirmations: 0 })).toBe('expired');
  });
});
