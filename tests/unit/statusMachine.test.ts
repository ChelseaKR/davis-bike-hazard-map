/**
 * FIX-09: the explicit status-transition state machine.
 *
 * Two layers of assurance:
 *   1. Table-driven unit tests over EVERY (from, to, cause) triple, checked
 *      against an independently-written list of the legal edges — so a table
 *      edit that widens or narrows the machine fails loudly here.
 *   2. fast-check property tests driving arbitrary operation sequences
 *      (moderate / handoff sync-back / expiry sweep / confirm) against the
 *      real in-memory Repository, asserting no hazard ever leaves a terminal
 *      state or changes status via an edge the table forbids.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  HAZARD_STATUSES,
  type HazardStatus,
} from '../../shared/types.ts';
import {
  LEGAL_TRANSITIONS,
  TRANSITION_CAUSES,
  canTransition,
  isTerminal,
  transition,
  type TransitionCause,
} from '../../shared/statusMachine.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryPhotoStore } from '../../server/lib/photoStore.ts';
import {
  createHazard,
  moderateHazard,
  confirmHazard,
  sweepExpired,
} from '../../server/lib/hazards.ts';
import { applyHandoffStatus } from '../../server/lib/lifecycle.ts';
import type { ValidatedReport } from '../../shared/validation.ts';
import type { ModerationAction } from '../../server/lib/types.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ttl = { ttlDays: { low: 1, moderate: 1, high: 1 } };

/**
 * The legal triples, written out independently of the table so the two
 * specifications check each other. Everything not listed here is illegal.
 */
const LEGAL_TRIPLES: ReadonlyArray<[HazardStatus, HazardStatus, TransitionCause]> = [
  ['pending', 'approved', 'moderate_approve'],
  ['pending', 'rejected', 'moderate_reject'],
  ['pending', 'resolved', 'moderate_resolve'],
  ['approved', 'approved', 'confirm'],
  ['approved', 'resolved', 'moderate_resolve'],
  ['approved', 'resolved', 'handoff_resolve'],
  ['approved', 'expired', 'expire'],
];

function isLegalTriple(from: HazardStatus, to: HazardStatus, cause: TransitionCause): boolean {
  return LEGAL_TRIPLES.some(([f, t, c]) => f === from && t === to && c === cause);
}

/** Whether ANY cause permits `from → to` (edge legality regardless of cause). */
function isLegalEdge(from: HazardStatus, to: HazardStatus): boolean {
  return LEGAL_TRIPLES.some(([f, t]) => f === from && t === to);
}

describe('canTransition covers every (from, to, cause) triple', () => {
  for (const from of HAZARD_STATUSES) {
    for (const to of HAZARD_STATUSES) {
      for (const cause of TRANSITION_CAUSES) {
        const legal = isLegalTriple(from, to, cause);
        it(`${from} → ${to} via ${cause} is ${legal ? 'legal' : 'illegal'}`, () => {
          expect(canTransition(from, to, cause)).toBe(legal);
        });
      }
    }
  }
});

describe('the transition table', () => {
  it('gives terminal states no outgoing edges at all', () => {
    for (const from of ['rejected', 'resolved', 'expired'] as const) {
      expect(isTerminal(from)).toBe(true);
      expect(Object.keys(LEGAL_TRANSITIONS[from])).toHaveLength(0);
    }
  });

  it('treats pending and approved as non-terminal', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('approved')).toBe(false);
  });
});

describe('transition()', () => {
  it('returns a status + updatedAt patch for a legal edge', () => {
    expect(transition({ status: 'pending' }, 'approved', 'moderate_approve', NOW)).toEqual({
      status: 'approved',
      updatedAt: NOW,
    });
  });

  it('stamps resolvedAt when the target is resolved', () => {
    expect(transition({ status: 'approved' }, 'resolved', 'handoff_resolve', NOW)).toEqual({
      status: 'resolved',
      updatedAt: NOW,
      resolvedAt: NOW,
    });
    expect(transition({ status: 'pending' }, 'resolved', 'moderate_resolve', NOW)).toEqual({
      status: 'resolved',
      updatedAt: NOW,
      resolvedAt: NOW,
    });
  });

  it('returns undefined for every illegal triple', () => {
    for (const from of HAZARD_STATUSES) {
      for (const to of HAZARD_STATUSES) {
        for (const cause of TRANSITION_CAUSES) {
          if (isLegalTriple(from, to, cause)) continue;
          expect(transition({ status: from }, to, cause, NOW)).toBeUndefined();
        }
      }
    }
  });
});

describe('mutation paths respect the machine', () => {
  function report(clientId = '11111111-1111-4111-8111-111111111111'): ValidatedReport {
    return {
      category: 'pothole',
      severity: 'high',
      description: 'x',
      location: { lat: 38.5449, lng: -121.7405 },
      photo: null,
      clientId,
      capturedAt: NOW,
    };
  }

  it('refuses to re-moderate a terminal hazard', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    await moderateHazard(repo, h.id, 'reject', NOW);

    expect(await moderateHazard(repo, h.id, 'approve', NOW + 1)).toBeUndefined();
    expect(await moderateHazard(repo, h.id, 'resolve', NOW + 1)).toBeUndefined();
    const stored = (await repo.findById(h.id))!;
    expect(stored.status).toBe('rejected');
    expect(stored.moderation).toHaveLength(1); // illegal attempts are not logged
  });

  it('a handoff sync-back cannot resolve a rejected hazard (webhook hole)', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    await moderateHazard(repo, h.id, 'reject', NOW);

    const hazard = (await repo.findById(h.id))!;
    const { patch, resolved } = applyHandoffStatus(hazard, 'Closed - Resolved', NOW + 1);
    expect(resolved).toBe(false);
    expect(patch.status).toBeUndefined();
    await repo.update(h.id, patch);
    expect((await repo.findById(h.id))!.status).toBe('rejected');
  });

  it('a handoff sync-back cannot resolve a pending hazard', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    const { patch, resolved } = applyHandoffStatus(h, 'Fixed', NOW + 1);
    expect(resolved).toBe(false);
    expect(patch.status).toBeUndefined();
  });

  it('a handoff sync-back still resolves an approved hazard', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    await moderateHazard(repo, h.id, 'approve', NOW);
    const hazard = (await repo.findById(h.id))!;
    const { patch, resolved } = applyHandoffStatus(hazard, 'Closed - Resolved', NOW + 1);
    expect(resolved).toBe(true);
    expect(patch.status).toBe('resolved');
    expect(patch.resolvedAt).toBe(NOW + 1);
  });

  it('confirm only touches approved hazards', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    expect(await confirmHazard(repo, h.id, NOW, ttl)).toBeUndefined(); // pending
    await moderateHazard(repo, h.id, 'approve', NOW);
    expect((await confirmHazard(repo, h.id, NOW, ttl))?.confirmations).toBe(1);
    await moderateHazard(repo, h.id, 'resolve', NOW);
    expect(await confirmHazard(repo, h.id, NOW, ttl)).toBeUndefined(); // terminal
  });

  it('the expiry sweep never expires pending or terminal hazards', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const pending = await createHazard(repo, photos, report(), NOW, ttl);
    const rejected = await createHazard(
      repo,
      photos,
      report('22222222-2222-4222-8222-222222222222'),
      NOW,
      ttl,
    );
    await moderateHazard(repo, rejected.id, 'reject', NOW);

    expect(await sweepExpired(repo, NOW + 40 * DAY)).toBe(0);
    expect((await repo.findById(pending.id))!.status).toBe('pending');
    expect((await repo.findById(rejected.id))!.status).toBe('rejected');
  });
});

describe('property: no operation sequence violates the machine', () => {
  type Op =
    | { kind: 'moderate'; decision: ModerationAction['decision'] }
    | { kind: 'handoff'; status: string }
    | { kind: 'sweep'; advanceDays: number }
    | { kind: 'confirm' };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      kind: fc.constant<'moderate'>('moderate'),
      decision: fc.constantFrom<ModerationAction['decision']>('approve', 'reject', 'resolve'),
    }),
    fc.record({
      kind: fc.constant<'handoff'>('handoff'),
      // Spans every HandoffStage bucket in mapExternalStatus.
      status: fc.constantFrom(
        'Submitted',
        'Received',
        'In Progress',
        'Closed - Resolved',
        'Fixed',
        'Closed',
        'Rejected (duplicate)',
      ),
    }),
    fc.record({
      kind: fc.constant<'sweep'>('sweep'),
      advanceDays: fc.integer({ min: 0, max: 3 }),
    }),
    fc.record({ kind: fc.constant<'confirm'>('confirm') }),
  );

  it('hazards never leave a terminal state and only move along legal edges', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 30 }), async (ops) => {
        const repo = new MemoryRepository();
        const photos = new MemoryPhotoStore();
        let clock = NOW;
        const report: ValidatedReport = {
          category: 'pothole',
          severity: 'high',
          description: 'x',
          location: { lat: 38.5449, lng: -121.7405 },
          photo: null,
          clientId: '11111111-1111-4111-8111-111111111111',
          capturedAt: clock,
        };
        const created = await createHazard(repo, photos, report, clock, ttl);
        let prev = created.status;

        for (const op of ops) {
          clock += 1000;
          switch (op.kind) {
            case 'moderate':
              await moderateHazard(repo, created.id, op.decision, clock);
              break;
            case 'handoff': {
              // Mirrors the webhook/poll routes: compute the patch, apply it raw.
              const current = (await repo.findById(created.id))!;
              const { patch } = applyHandoffStatus(current, op.status, clock);
              await repo.update(created.id, patch);
              break;
            }
            case 'sweep':
              clock += op.advanceDays * DAY;
              await sweepExpired(repo, clock);
              break;
            case 'confirm':
              await confirmHazard(repo, created.id, clock, ttl);
              break;
          }

          const next = (await repo.findById(created.id))!.status;
          if (isTerminal(prev) && next !== prev) {
            throw new Error(`terminal state escaped: ${prev} → ${next} via ${op.kind}`);
          }
          if (next !== prev && !isLegalEdge(prev, next)) {
            throw new Error(`illegal edge taken: ${prev} → ${next} via ${op.kind}`);
          }
          prev = next;
        }
      }),
    );
  });
});
