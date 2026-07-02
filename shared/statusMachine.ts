/**
 * Explicit hazard status-transition state machine (FIX-09).
 *
 * One table says which `HazardStatus` transitions are legal and which cause
 * may drive each edge. Every mutation path (moderation, 311 hand-off
 * sync-back, the expiry sweep, confirmations) routes through it, so the
 * lifecycle invariants live in code — not in the authors' heads:
 *
 *   pending  ──moderate_approve──▶ approved
 *   pending  ──moderate_reject───▶ rejected   (terminal)
 *   pending  ──moderate_resolve──▶ resolved   (terminal)
 *   approved ──moderate_resolve──▶ resolved   (terminal)
 *   approved ──handoff_resolve───▶ resolved   (terminal)
 *   approved ──expire─────────────▶ expired   (terminal)
 *   approved ──confirm────────────▶ approved  (self-edge; status unchanged)
 *
 * Terminal states (rejected, resolved, expired) admit NO outgoing transitions:
 * a webhook can never resolve a rejected hazard, a confirm can never revive an
 * expired one, and a moderator can never re-moderate a settled report.
 */
import type { HazardStatus } from './types.ts';

/** What drove a transition — each edge names the causes allowed to take it. */
export const TRANSITION_CAUSES = [
  'moderate_approve',
  'moderate_reject',
  'moderate_resolve',
  'handoff_resolve',
  'expire',
  'confirm',
] as const;
export type TransitionCause = (typeof TRANSITION_CAUSES)[number];

/**
 * The legal-transition table: `from → to → causes permitted on that edge`.
 * Absent entries are illegal. This is the single source of truth — tests
 * assert the mutation paths against it, and new lifecycle features (e.g. a
 * reopen flow) must add their edge here first.
 */
export const LEGAL_TRANSITIONS: Record<
  HazardStatus,
  Partial<Record<HazardStatus, readonly TransitionCause[]>>
> = {
  pending: {
    approved: ['moderate_approve'],
    rejected: ['moderate_reject'],
    resolved: ['moderate_resolve'],
  },
  approved: {
    // A confirmation touches the hazard but never changes its status.
    approved: ['confirm'],
    resolved: ['moderate_resolve', 'handoff_resolve'],
    expired: ['expire'],
  },
  rejected: {},
  resolved: {},
  expired: {},
};

/** A status is terminal when the table gives it no edge to a DIFFERENT status. */
export function isTerminal(status: HazardStatus): boolean {
  return Object.keys(LEGAL_TRANSITIONS[status]).every((to) => to === status);
}

/** Whether the table permits `from → to` under the given cause. */
export function canTransition(
  from: HazardStatus,
  to: HazardStatus,
  cause: TransitionCause,
): boolean {
  return LEGAL_TRANSITIONS[from][to]?.includes(cause) ?? false;
}

/**
 * The status fields a legal transition patches onto a hazard. Structurally a
 * subset of `Partial<StoredHazard>` (and of the public `Hazard`), kept
 * dependency-free so this module stays importable from client, server, and
 * tests alike.
 */
export interface StatusPatch {
  status: HazardStatus;
  updatedAt: number;
  resolvedAt?: number;
}

/**
 * Compute the status patch for a transition, or `undefined` when the table
 * forbids it. Callers spread the patch into their repository update alongside
 * their own fields (moderation log, coarsened location, hand-off record, …) —
 * so the status itself can only ever change along a legal edge.
 */
export function transition(
  hazard: { status: HazardStatus },
  to: HazardStatus,
  cause: TransitionCause,
  now: number,
): StatusPatch | undefined {
  if (!canTransition(hazard.status, to, cause)) return undefined;
  const patch: StatusPatch = { status: to, updatedAt: now };
  if (to === 'resolved') patch.resolvedAt = now;
  return patch;
}
