/**
 * Reporter feedback loop (research roadmap R2): turn a hazard's moderation
 * status + 311 hand-off into a small, ordered "what happened to my report"
 * trail — reported → in review → on the map → handed to the city → fixed — so a
 * reporter can see their report land and get acted on, instead of it vanishing
 * silently (the failure mode that kills civic tools, EV-ABANDON).
 *
 * Pure and total so it is trivially unit-testable and runs on the client with
 * no network. It reads only the PUBLIC hazard projection (no moderation notes).
 *
 * Every user-visible string here is a `defineMessages` entry formatted through
 * the caller's `intl`. That is not decoration: this module produces display
 * text OUTSIDE JSX, which is invisible to `formatjs/no-literal-string-in-jsx`,
 * so the 14 bare literals it used to build sailed past the G2 ratchet and
 * shipped untranslated (issue #164). `scripts/i18n/check-no-hardcoded.mjs` now
 * scans `src/lib/**` for exactly this shape.
 */
import { defineMessages, type IntlShape } from 'react-intl';
import { lifecycleStage, type Hazard } from '../../shared/types.ts';
import { handoffLabel } from '../i18n/labels.ts';

/** Visual/semantic state of a single step in the trail. */
export type TrailStepState = 'done' | 'current' | 'upcoming' | 'rejected';

export interface TrailStep {
  key: string;
  label: string;
  state: TrailStepState;
  /** Optional one-line explanation shown under the step. */
  detail?: string;
}

const messages = defineMessages({
  reportedLabel: { id: 'report.trail.reported.label', defaultMessage: 'Reported' },
  reportedDetail: {
    id: 'report.trail.reported.detail',
    defaultMessage: 'Saved on your device and sent to the server.',
  },
  reviewedLabel: { id: 'report.trail.reviewed.label', defaultMessage: 'Reviewed' },
  inReviewLabel: { id: 'report.trail.inReview.label', defaultMessage: 'In review' },
  inReviewDetail: {
    id: 'report.trail.inReview.detail',
    defaultMessage: 'Waiting for a moderator to approve it before it appears publicly.',
  },
  rejectedLabel: { id: 'report.trail.rejected.label', defaultMessage: 'Not approved' },
  rejectedDetail: {
    id: 'report.trail.rejected.detail',
    defaultMessage: "A moderator didn't approve this report, so it isn't on the public map.",
  },
  onMapLabel: { id: 'report.trail.onMap.label', defaultMessage: 'On the map' },
  onMapDetail: {
    id: 'report.trail.onMap.detail',
    defaultMessage:
      '{count, plural, =0 {Live for other cyclists.} other {Live for other cyclists — confirmed #×.}}',
  },
  citySentLabel: { id: 'report.trail.city.sent.label', defaultMessage: 'Sent to city 311' },
  cityNotSentLabel: {
    id: 'report.trail.city.notSent.label',
    defaultMessage: 'Not sent to city 311',
  },
  cityNotSentDetail: {
    id: 'report.trail.city.notSent.detail',
    defaultMessage: 'This server has no 311 connection set up, so nothing was sent to the city.',
  },
  citySendingLabel: { id: 'report.trail.city.sending.label', defaultMessage: 'Sending to city 311' },
  citySendingDetail: {
    id: 'report.trail.city.sending.detail',
    defaultMessage: "Sending it to the city hasn't succeeded yet — it will keep trying.",
  },
  cityUnknownDetail: {
    id: 'report.trail.city.unknown.detail',
    defaultMessage: 'Delivery to the city was not recorded for this report.',
  },
  fixedLabel: { id: 'report.trail.fixed.label', defaultMessage: 'Fixed' },
  fixedDetail: {
    id: 'report.trail.fixed.detail',
    defaultMessage: 'Reported fixed — thanks for flagging it.',
  },
  expiredLabel: { id: 'report.trail.expired.label', defaultMessage: 'Aged off the map' },
  expiredDetail: {
    id: 'report.trail.expired.detail',
    defaultMessage:
      "No new confirmations, so it expired to keep the map current. Re-report if it's still there.",
  },
  stageConfirmed: { id: 'report.stage.confirmed', defaultMessage: 'Confirmed on the map' },
});

/**
 * Build the ordered trail for one of the reporter's own reports.
 *
 * `hazard` is the server's current view of the report (from
 * `GET /api/reports/:clientId`). A rejected report short-circuits to a terminal
 * "not approved" step; otherwise the pipeline is review → on the map →
 * (city, only if handed off) → fixed, with an "expired" tail when it has aged
 * off the map.
 */
export function reportTrail(
  hazard: Pick<Hazard, 'status' | 'confirmations' | 'handoff' | 'resolvedAt'>,
  intl: IntlShape,
): TrailStep[] {
  const t = (m: (typeof messages)[keyof typeof messages], values?: Record<string, number>) =>
    intl.formatMessage(m, values);

  const steps: TrailStep[] = [
    {
      key: 'reported',
      label: t(messages.reportedLabel),
      state: 'done',
      detail: t(messages.reportedDetail),
    },
  ];

  // Rejected is terminal: a moderator looked at it and didn't approve it.
  if (hazard.status === 'rejected') {
    steps.push({ key: 'review', label: t(messages.reviewedLabel), state: 'done' });
    steps.push({
      key: 'rejected',
      label: t(messages.rejectedLabel),
      state: 'rejected',
      detail: t(messages.rejectedDetail),
    });
    return steps;
  }

  const pending = hazard.status === 'pending';
  const resolved = hazard.status === 'resolved';
  const expired = hazard.status === 'expired';
  const handoff = hazard.handoff ?? null;

  steps.push({
    key: 'review',
    label: pending ? t(messages.inReviewLabel) : t(messages.reviewedLabel),
    state: pending ? 'current' : 'done',
    detail: pending ? t(messages.inReviewDetail) : undefined,
  });

  // "On the map" is the live, approved state. It's the *current* step only when
  // the report is approved and nothing later has happened yet.
  const onMapCurrent = hazard.status === 'approved' && !handoff && !resolved;
  steps.push({
    key: 'onmap',
    label: t(messages.onMapLabel),
    state: pending ? 'upcoming' : onMapCurrent ? 'current' : 'done',
    detail: onMapCurrent ? t(messages.onMapDetail, { count: hazard.confirmations }) : undefined,
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
        label: t(messages.cityNotSentLabel),
        state: 'upcoming',
        detail: t(messages.cityNotSentDetail),
      });
    } else if (handoff.delivery === 'undelivered') {
      steps.push({
        key: 'city',
        label: t(messages.citySendingLabel),
        state: 'current',
        detail: t(messages.citySendingDetail),
      });
    } else if (handoff.delivery === 'unknown') {
      steps.push({
        key: 'city',
        label: t(messages.citySentLabel),
        state: cityDone ? 'done' : 'current',
        detail: t(messages.cityUnknownDetail),
      });
    } else {
      steps.push({
        key: 'city',
        label: t(messages.citySentLabel),
        state: cityDone ? 'done' : 'current',
        // The catalogued hand-off stage labels (i18n/labels.ts), not the raw
        // English `HANDOFF_STAGE_LABELS` from shared/types.ts — the same six
        // phrases were already translatable and this file was routing round
        // them (issue #164).
        detail: handoffLabel(intl, handoff.stage),
      });
    }
  }

  if (resolved) {
    steps.push({
      key: 'fixed',
      label: t(messages.fixedLabel),
      state: 'done',
      detail: t(messages.fixedDetail),
    });
  } else if (expired) {
    steps.push({
      key: 'expired',
      label: t(messages.expiredLabel),
      state: 'done',
      detail: t(messages.expiredDetail),
    });
  }

  return steps;
}

/** Convenience: the derived lifecycle stage, for a compact status label. */
export function reportStageLabel(
  hazard: Pick<Hazard, 'status' | 'confirmations'>,
  intl: IntlShape,
): string {
  if (hazard.status === 'pending') return intl.formatMessage(messages.inReviewLabel);
  if (hazard.status === 'rejected') return intl.formatMessage(messages.rejectedLabel);
  return lifecycleStage(hazard) === 'confirmed'
    ? intl.formatMessage(messages.stageConfirmed)
    : intl.formatMessage(messages.onMapLabel);
}
