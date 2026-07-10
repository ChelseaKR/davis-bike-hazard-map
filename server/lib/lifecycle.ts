/**
 * 311 status sync-back: map a city/GOGov status string onto our hand-off
 * lifecycle, and compute the hazard patch a synced status implies.
 *
 * Kept provider-neutral and pure so it is trivially unit-testable and so the
 * inbound webhook and the moderator-triggered poll share one mapping.
 */
import type { HandoffInfo, HandoffStage } from '../../shared/types.ts';
import type { StoredHazard } from './types.ts';

/**
 * Normalize a provider's free-form status into one of our stages. Keyword-based
 * and case-insensitive so it tolerates the many spellings 311 systems use
 * ("Closed - Resolved", "In Progress", "Assigned to crew", …). Unknown strings
 * fall back to `acknowledged` (we know they received it, nothing more).
 */
export function mapExternalStatus(raw: string): HandoffStage {
  const s = raw.toLowerCase();
  if (/(reject|declin|denied|duplicate|invalid|won'?t fix)/.test(s)) return 'rejected';
  if (/(resolv|fixed|complete|done|repaired)/.test(s)) return 'resolved';
  if (/clos/.test(s)) return 'closed';
  if (/(progress|assigned|dispatch|in process|working|scheduled)/.test(s)) return 'in_progress';
  if (/(acknowledg|received|accepted|open|new|triag)/.test(s)) return 'acknowledged';
  if (/submit/.test(s)) return 'submitted';
  return 'acknowledged';
}

/** A terminal "the city fixed it" stage resolves the hazard on our map too. */
export function isResolvingStage(stage: HandoffStage): boolean {
  return stage === 'resolved' || stage === 'closed';
}

export interface HandoffStatusUpdate {
  /** Patch to apply to the stored hazard. */
  patch: Partial<StoredHazard>;
  /** The normalized stage the status mapped to. */
  stage: HandoffStage;
  /** Whether this transition resolved the hazard (so callers can log/notify). */
  resolved: boolean;
}

/**
 * Compute the patch implied by a synced-back 311 status. Updates the hand-off
 * record and, when the city reports the issue fixed, resolves the hazard (and
 * coarsens its precise location, consistent with every other terminal state).
 */
export function applyHandoffStatus(
  hazard: StoredHazard,
  externalStatus: string,
  now: number,
  note?: string,
): HandoffStatusUpdate {
  const stage = mapExternalStatus(externalStatus);
  const handoff: HandoffInfo = {
    provider: hazard.handoff?.provider ?? 'gogov',
    reference: hazard.handoff?.reference ?? hazard.id,
    externalStatus,
    stage,
    submittedAt: hazard.handoff?.submittedAt ?? now,
    updatedAt: now,
    note: note ?? hazard.handoff?.note ?? null,
  };

  const patch: Partial<StoredHazard> = { handoff, updatedAt: now };
  const resolved = isResolvingStage(stage) && hazard.status !== 'resolved';
  if (resolved) {
    patch.status = 'resolved';
    patch.resolvedAt = now;
    // Terminal state: drop the precise location (only needed while actionable).
    patch.preciseLocation = hazard.publicLocation;
  }
  return { patch, stage, resolved };
}

/**
 * Build the initial hand-off record for a freshly forwarded hazard.
 * `provider`/`reference` default to the original GOGov-only behavior
 * (`'gogov'` / the hazard id) so existing call sites are unaffected; EXP-06's
 * provider selector (`handoff.ts`) passes the actual provider used and, for
 * Open311, the server-assigned `service_request_id`.
 */
export function initialHandoff(
  hazard: StoredHazard,
  now: number,
  provider = 'gogov',
  reference: string = hazard.id,
): HandoffInfo {
  return {
    provider,
    reference,
    externalStatus: 'submitted',
    stage: 'submitted',
    submittedAt: now,
    updatedAt: now,
    note: null,
  };
}
