/**
 * Reporter feedback loop (research roadmap R2): turn a hazard's moderation
 * status + 311 hand-off into a small, ordered "what happened to my report"
 * trail — reported → in review → on the map → handed to the city → fixed — so a
 * reporter can see their report land and get acted on, instead of it vanishing
 * silently (the failure mode that kills civic tools, EV-ABANDON).
 *
 * Pure and total so it is trivially unit-testable and runs on the client with
 * no network. It reads only the PUBLIC hazard projection (no moderation notes).
 */
import { HANDOFF_STAGE_LABELS, lifecycleStage, type Hazard } from '../../shared/types.ts';

/** Visual/semantic state of a single step in the trail. */
export type TrailStepState = 'done' | 'current' | 'upcoming' | 'rejected';

export interface TrailStep {
  key: string;
  label: string;
  state: TrailStepState;
  /** Optional one-line explanation shown under the step. */
  detail?: string;
}

/**
 * Build the ordered trail for one of the reporter's own reports.
 *
 * `hazard` is the server's current view of the report (from
 * `GET /api/reports/:clientId`). A rejected report short-circuits to a terminal
 * "not approved" step; otherwise the pipeline is review → on the map →
 * (city, only if handed off) → fixed, with an "expired" tail when it has aged
 * off the map.
 */
export function reportTrail(hazard: Pick<Hazard, 'status' | 'confirmations' | 'handoff' | 'resolvedAt'>): TrailStep[] {
  const steps: TrailStep[] = [
    { key: 'reported', label: 'Reported', state: 'done', detail: 'Saved on your device and sent to the server.' },
  ];

  // Rejected is terminal: a moderator looked at it and didn't approve it.
  if (hazard.status === 'rejected') {
    steps.push({ key: 'review', label: 'Reviewed', state: 'done' });
    steps.push({
      key: 'rejected',
      label: 'Not approved',
      state: 'rejected',
      detail: "A moderator didn't approve this report, so it isn't on the public map.",
    });
    return steps;
  }

  const pending = hazard.status === 'pending';
  const resolved = hazard.status === 'resolved';
  const expired = hazard.status === 'expired';
  const handoff = hazard.handoff ?? null;

  steps.push({
    key: 'review',
    label: pending ? 'In review' : 'Reviewed',
    state: pending ? 'current' : 'done',
    detail: pending ? 'Waiting for a moderator to approve it before it appears publicly.' : undefined,
  });

  // "On the map" is the live, approved state. It's the *current* step only when
  // the report is approved and nothing later has happened yet.
  const onMapCurrent = hazard.status === 'approved' && !handoff && !resolved;
  steps.push({
    key: 'onmap',
    label: 'On the map',
    state: pending ? 'upcoming' : onMapCurrent ? 'current' : 'done',
    detail: onMapCurrent
      ? `Live for other cyclists${hazard.confirmations > 0 ? ` — confirmed ${hazard.confirmations}×` : ''}.`
      : undefined,
  });

  // 311 hand-off only appears once a moderator forwarded it to the city.
  //
  // `handoff.stage` is the CITY's view of the ticket and reads `submitted` from
  // the instant a forward is ATTEMPTED, dry-run or not, so labelling this step
  // from the stage alone told the reporter their report had reached the city
  // when nothing had left the server (issue #162). `handoff.delivery` is the
  // record of what the transport actually did, so it decides the wording — and,
  // for a dry run, the step is `upcoming`, because nothing has happened yet.
  if (handoff) {
    const cityDone = resolved || handoff.stage === 'resolved' || handoff.stage === 'closed';
    if (handoff.delivery === 'dry_run') {
      steps.push({
        key: 'city',
        label: 'Not sent to city 311',
        state: 'upcoming',
        detail: 'This server has no 311 connection set up, so nothing was sent to the city.',
      });
    } else if (handoff.delivery === 'undelivered') {
      steps.push({
        key: 'city',
        label: 'Sending to city 311',
        state: 'current',
        detail: "Sending it to the city hasn't succeeded yet — it will keep trying.",
      });
    } else if (handoff.delivery === 'unknown') {
      steps.push({
        key: 'city',
        label: 'Sent to city 311',
        state: cityDone ? 'done' : 'current',
        detail: 'Delivery to the city was not recorded for this report.',
      });
    } else {
      steps.push({
        key: 'city',
        label: 'Sent to city 311',
        state: cityDone ? 'done' : 'current',
        detail: HANDOFF_STAGE_LABELS[handoff.stage],
      });
    }
  }

  if (resolved) {
    steps.push({
      key: 'fixed',
      label: 'Fixed',
      state: 'done',
      detail: 'Reported fixed — thanks for flagging it.',
    });
  } else if (expired) {
    steps.push({
      key: 'expired',
      label: 'Aged off the map',
      state: 'done',
      detail: 'No new confirmations, so it expired to keep the map current. Re-report if it’s still there.',
    });
  }

  return steps;
}

/** Convenience: the derived lifecycle stage, for a compact status label. */
export function reportStageLabel(hazard: Pick<Hazard, 'status' | 'confirmations'>): string {
  if (hazard.status === 'pending') return 'In review';
  if (hazard.status === 'rejected') return 'Not approved';
  return lifecycleStage(hazard) === 'confirmed' ? 'Confirmed on the map' : 'On the map';
}
