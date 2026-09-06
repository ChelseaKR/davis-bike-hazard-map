/**
 * Translatable labels for the domain enums (hazard category / severity /
 * lifecycle stage / 311 hand-off stage / device-queue state).
 *
 * The enums themselves live in `shared/types.ts`, which is framework-free and
 * imported by the Fastify server too — so the react-intl message definitions
 * live here instead of being bolted onto the shared model. `formatjs extract`
 * picks these up via `defineMessages`. Helpers come in two shapes: an `intl`
 * -taking form for imperative Leaflet-popup glue, and a `useLabels()` hook for
 * React components.
 */
import { defineMessages, useIntl, type IntlShape } from 'react-intl';
import type {
  HazardCategory,
  Severity,
  LifecycleStage,
  HandoffStage,
  PublicHandoffInfo,
} from '../../shared/types.ts';
import type { QueueState } from '../lib/db.ts';

const categoryMessages = defineMessages({
  pothole: { id: 'hazard.category.pothole', defaultMessage: 'Pothole' },
  glass_debris: { id: 'hazard.category.glass_debris', defaultMessage: 'Glass / debris' },
  blocked_lane: { id: 'hazard.category.blocked_lane', defaultMessage: 'Blocked bike lane' },
  dangerous_intersection: {
    id: 'hazard.category.dangerous_intersection',
    defaultMessage: 'Dangerous intersection',
  },
  near_miss: { id: 'hazard.category.near_miss', defaultMessage: 'Near miss / close call' },
  poor_visibility: { id: 'hazard.category.poor_visibility', defaultMessage: 'Poor visibility' },
  surface_damage: { id: 'hazard.category.surface_damage', defaultMessage: 'Surface damage' },
  other: { id: 'hazard.category.other', defaultMessage: 'Other' },
});

const severityMessages = defineMessages({
  low: { id: 'hazard.severity.low', defaultMessage: 'Low' },
  moderate: { id: 'hazard.severity.moderate', defaultMessage: 'Moderate' },
  high: { id: 'hazard.severity.high', defaultMessage: 'High' },
});

const lifecycleMessages = defineMessages({
  reported: { id: 'hazard.lifecycle.reported', defaultMessage: 'Reported' },
  confirmed: { id: 'hazard.lifecycle.confirmed', defaultMessage: 'Confirmed' },
  resolved: { id: 'hazard.lifecycle.resolved', defaultMessage: 'Resolved' },
  expired: { id: 'hazard.lifecycle.expired', defaultMessage: 'Expired' },
});

const handoffMessages = defineMessages({
  submitted: { id: 'hazard.handoff.submitted', defaultMessage: 'Sent to city 311' },
  acknowledged: { id: 'hazard.handoff.acknowledged', defaultMessage: 'Acknowledged by city' },
  in_progress: { id: 'hazard.handoff.in_progress', defaultMessage: 'City crew assigned' },
  resolved: { id: 'hazard.handoff.resolved', defaultMessage: 'Fixed by city' },
  closed: { id: 'hazard.handoff.closed', defaultMessage: 'Closed by city' },
  rejected: { id: 'hazard.handoff.rejected', defaultMessage: 'Declined by city' },
});

/**
 * The 311 line as shown to the public (issue #162).
 *
 * `handoff.stage` is the CITY's view of the ticket and is recorded as
 * `submitted` the moment a forward is ATTEMPTED — dry-run or not — so rendering
 * it alone published an accomplished civic action that may never have happened.
 * Only `delivery === 'delivered'` earns the plain success wording; every other
 * kind gets its own string that says what actually happened, matching the OSM
 * adapter's existing "(dry-run — not posted)" disclosure.
 */
const handoffDeliveryMessages = defineMessages({
  dry_run: {
    id: 'hazard.handoff.delivery.dryRun',
    defaultMessage: 'City 311: not sent — no 311 provider is configured on this server.',
  },
  undelivered: {
    id: 'hazard.handoff.delivery.undelivered',
    defaultMessage: "City 311: not delivered — sending it to the city hasn't succeeded yet.",
  },
  unknown: {
    id: 'hazard.handoff.delivery.unknown',
    defaultMessage: 'City 311: forwarded, but delivery was not recorded.',
  },
});

const queueStateMessages = defineMessages({
  queued: { id: 'queue.state.queued', defaultMessage: 'Waiting to sync' },
  syncing: { id: 'queue.state.syncing', defaultMessage: 'Syncing…' },
  synced: { id: 'queue.state.synced', defaultMessage: 'On the map (pending moderation)' },
  error: { id: 'queue.state.error', defaultMessage: "Couldn't sync" },
});

export function categoryLabel(intl: IntlShape, category: HazardCategory): string {
  return intl.formatMessage(categoryMessages[category]);
}
export function severityLabel(intl: IntlShape, severity: Severity): string {
  return intl.formatMessage(severityMessages[severity]);
}
export function lifecycleLabel(intl: IntlShape, stage: LifecycleStage): string {
  return intl.formatMessage(lifecycleMessages[stage]);
}
export function handoffLabel(intl: IntlShape, stage: HandoffStage): string {
  return intl.formatMessage(handoffMessages[stage]);
}
/**
 * The complete, honest 311 line for a hazard's hand-off — the single string
 * both the list card and the map popup render, so the two cannot disagree.
 */
export function handoffNote(intl: IntlShape, handoff: PublicHandoffInfo): string {
  if (handoff.delivery !== 'delivered') {
    return intl.formatMessage(handoffDeliveryMessages[handoff.delivery]);
  }
  return intl.formatMessage(
    { id: 'hazard.card.handoff', defaultMessage: 'City 311: {status}' },
    { status: handoffLabel(intl, handoff.stage) },
  );
}

export function queueStateLabel(intl: IntlShape, state: QueueState): string {
  return intl.formatMessage(queueStateMessages[state]);
}

/** React-hook accessor for the enum labels, bound to the ambient locale. */
export function useLabels() {
  const intl = useIntl();
  return {
    category: (category: HazardCategory) => categoryLabel(intl, category),
    severity: (severity: Severity) => severityLabel(intl, severity),
    lifecycle: (stage: LifecycleStage) => lifecycleLabel(intl, stage),
    handoff: (stage: HandoffStage) => handoffLabel(intl, stage),
    handoffNote: (handoff: PublicHandoffInfo) => handoffNote(intl, handoff),
    queueState: (state: QueueState) => queueStateLabel(intl, state),
  };
}
