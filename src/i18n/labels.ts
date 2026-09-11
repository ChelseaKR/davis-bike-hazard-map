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
import {
  DEFAULT_ROUTE_PROFILE_ID,
  HAZARD_CATEGORIES,
  type HazardCategory,
  type Severity,
  type LifecycleStage,
  type HandoffStage,
  type PublicHandoffInfo,
  type RouteProfileId,
} from '../../shared/types.ts';
import { DEFAULT_SCORING, ROUTE_PROFILES } from '../../shared/routing.ts';
import { formatDistance } from '../lib/format.ts';
import type { QueueState } from '../lib/db.ts';
import type { GeolocationFailure } from '../lib/geolocation.ts';
import type { PushRegistrationFailure } from '../lib/push.ts';
import type { PhotoReadFailure } from '../lib/photo.ts';
import type { ApiFailure } from '../lib/api.ts';

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

/**
 * Rider routing preferences (issue #178). The ids are the API's; these are what a
 * rider reads. `family-safest` is deliberately not called "safest" here: no
 * profile makes a route safe (see `ROUTE_PROFILES` in shared/routing.ts), and a
 * picker label is exactly where a rider would take that word as a promise.
 */
const routeProfileMessages = defineMessages({
  default: { id: 'route.profile.name.default', defaultMessage: 'Standard' },
  'family-safest': {
    id: 'route.profile.name.familySafest',
    defaultMessage: 'Family / cargo bike',
  },
  'e-bike': { id: 'route.profile.name.eBike', defaultMessage: 'E-bike' },
});

/**
 * One sentence per rule a routing profile applies. Composed from
 * `ROUTE_PROFILES` and `DEFAULT_SCORING` by {@link routeProfileWeightLines}
 * rather than written per profile, so a weight change in shared/routing.ts
 * changes what a rider is told in the same commit. A hand-written description of
 * each profile would be a second copy of the table with nothing holding the two
 * together.
 */
const routeProfileWeightMessages = defineMessages({
  basePenalty: {
    id: 'route.profile.weight.basePenalty',
    defaultMessage:
      'A high-severity report right beside a route counts as {distance} of extra riding, and less as it ages or sits further from the line.',
  },
  basePenaltyChanged: {
    id: 'route.profile.weight.basePenaltyChanged',
    defaultMessage:
      'A high-severity report right beside a route counts as {distance} of extra riding ({standard}: {standardDistance}), and less as it ages or sits further from the line.',
  },
  multiplier: {
    id: 'route.profile.weight.multiplier',
    defaultMessage:
      '{count, plural, one {{categories} counts {factor}× as much as usual.} other {{categories} count {factor}× as much as usual.}}',
  },
  noMultipliers: {
    id: 'route.profile.weight.noMultipliers',
    defaultMessage: 'Every hazard type counts the same.',
  },
  refuseHighSeverity: {
    id: 'route.profile.weight.refuseHighSeverity',
    defaultMessage:
      'Never picks a route past a high-severity report while the road network offered one without, however much longer that one is.',
  },
});

const queueStateMessages = defineMessages({
  queued: { id: 'queue.state.queued', defaultMessage: 'Waiting to sync' },
  syncing: { id: 'queue.state.syncing', defaultMessage: 'Syncing…' },
  synced: { id: 'queue.state.synced', defaultMessage: 'On the map (pending moderation)' },
  error: { id: 'queue.state.error', defaultMessage: "Couldn't sync" },
});

/**
 * Failure codes thrown out of `src/lib`, as catalogued messages (issue #173).
 *
 * `geolocation.ts`, `push.ts` and `photo.ts` are framework-free and have no
 * `intl`, so a thrown `Error` can only carry a machine code. These are where
 * that code becomes a sentence, in the catalog, once — which is what lets the
 * G2 no-hardcoded gate scan all three files instead of deferring them.
 */
const geolocationErrorMessages = defineMessages({
  unsupported: {
    id: 'error.geolocation.unsupported',
    defaultMessage: "this browser can't share your location",
  },
  denied: {
    id: 'error.geolocation.denied',
    defaultMessage: 'location permission was denied',
  },
  unavailable: {
    id: 'error.geolocation.unavailable',
    defaultMessage: 'your location is unavailable right now',
  },
  timeout: {
    id: 'error.geolocation.timeout',
    defaultMessage: 'getting your location took too long',
  },
});

const pushErrorMessages = defineMessages({
  unsupported: {
    id: 'error.push.unsupported',
    defaultMessage: "This browser can't receive hazard alerts.",
  },
  permissionNotGranted: {
    id: 'error.push.permissionNotGranted',
    defaultMessage: 'Notification permission was not granted.',
  },
});

const photoErrorMessages = defineMessages({
  unreadable: {
    id: 'error.photo.unreadable',
    defaultMessage: 'That file could not be read.',
  },
});

/**
 * Why the hazard feed did not load (issue #200).
 *
 * The same shape as the three blocks above, for the same reason. `useHazards`
 * used to hand `ListView`'s `role="alert"` the thrown `Error`'s message — which
 * is the SERVER's sentence in the common branch (`body.message`, composed in
 * English by a server with no catalog) and the literal `Could not load
 * hazards.` in the fallback. Neither was in any catalog, and the alert around
 * them was: a Spanish rider got a translated heading over an English sentence.
 *
 * These are whole sentences, not fragments, because they stand alone in the
 * alert. `MapView` puts its own catalogued paragraph above the same string.
 */
const feedErrorMessages = defineMessages({
  offline: {
    id: 'error.feed.offline',
    defaultMessage: "The hazard feed couldn't be reached. Check your connection and try again.",
  },
  request: {
    id: 'error.feed.request',
    defaultMessage: "The hazard feed couldn't be loaded — the server rejected the request.",
  },
  server: {
    id: 'error.feed.server',
    defaultMessage: 'The hazard feed is unavailable right now. This is a problem on our side.',
  },
  parse: {
    id: 'error.feed.parse',
    defaultMessage: "The hazard feed came back in a form this app couldn't read.",
  },
});

/**
 * Why a report on this device has not reached the server (issue #203).
 *
 * A second surface for the same defect #200 removed from the feed. `MyReports`
 * rendered the device queue's `lastError` verbatim, and that value is the
 * server's own sentence (`body.message`, composed in English by a server with
 * no catalog) in the common branch and `String(err)` in the fallback. Neither
 * is in any catalog; the card around them is.
 *
 * These say what happened to THIS REPORT, not to the feed, so they are their
 * own block rather than a reuse of `feedErrorMessages`: "the hazard feed
 * couldn't be reached" is the wrong sentence to print under a report a rider
 * filed and is waiting on.
 *
 * `unrecorded` is the honest reading of an ABSENT code, and it is deliberately
 * not one of the four. A row written before `lastErrorCode` existed is still on
 * real devices — this store is IndexedDB — and picking any of the four for it
 * would publish a reason nothing measured. It also covers a code this build
 * does not recognise, which is the same fact from the other direction: the two
 * remain distinguishable in the stored record (`lastErrorCode` absent, versus
 * present and unknown) and in `lastError`, which is kept as a diagnostic.
 */
const queueErrorMessages = defineMessages({
  offline: {
    id: 'error.queue.offline',
    defaultMessage: "This report hasn't reached the server — your device couldn't connect.",
  },
  request: {
    id: 'error.queue.request',
    defaultMessage: 'The server would not accept this report.',
  },
  server: {
    id: 'error.queue.server',
    defaultMessage: 'Sending this report failed. This is a problem on our side.',
  },
  parse: {
    id: 'error.queue.parse',
    defaultMessage: "The server answered in a form this app couldn't read.",
  },
  unrecorded: {
    id: 'error.queue.unrecorded',
    defaultMessage: "This report couldn't be sent, and this device didn't record a reason it can show you.",
  },
});

/** The four codes this build renders a specific sentence for. */
const QUEUE_ERROR_CODES: readonly ApiFailure[] = ['offline', 'request', 'server', 'parse'];

/**
 * The reason half of `route.error.location` ("Couldn't use your location:
 * {reason}"), which is why all four read as sentence fragments rather than
 * standalone sentences.
 */
export function geolocationErrorLabel(intl: IntlShape, code: GeolocationFailure): string {
  return intl.formatMessage(geolocationErrorMessages[code]);
}
export function pushErrorLabel(intl: IntlShape, code: PushRegistrationFailure): string {
  return intl.formatMessage(pushErrorMessages[code]);
}
export function photoErrorLabel(intl: IntlShape, code: PhotoReadFailure): string {
  return intl.formatMessage(photoErrorMessages[code]);
}

/**
 * The rider-facing sentence for a feed failure code. The thrown error's own
 * message is a diagnostic and is never displayed — see `ApiFailure`.
 */
export function feedErrorLabel(intl: IntlShape, code: ApiFailure): string {
  return intl.formatMessage(feedErrorMessages[code]);
}

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

export function routeProfileLabel(intl: IntlShape, id: RouteProfileId): string {
  return intl.formatMessage(routeProfileMessages[id]);
}

/**
 * The rules a routing profile applies, as sentences, in a fixed order: the base
 * high-severity cost, then each per-type multiplier (largest first, ties in
 * `HAZARD_CATEGORIES` order), then the high-severity refusal. Deterministic, so
 * the picker and the result print the same lines for the same profile.
 *
 * A multiplier of exactly 1 is not described: it changes nothing, and a line
 * saying so would read as a rule. `scoring` overrides other than
 * `highPenaltyMeters` are not described either, because none exist;
 * `tests/unit/routeProfileCopy.test.ts` fails the day one is added to the table
 * without a sentence here.
 */
export function routeProfileWeightLines(intl: IntlShape, id: RouteProfileId): string[] {
  const profile = ROUTE_PROFILES[id];
  const standardMeters = DEFAULT_SCORING.highPenaltyMeters;
  const meters = profile.scoring.highPenaltyMeters ?? standardMeters;
  const lines = [
    meters === standardMeters
      ? intl.formatMessage(routeProfileWeightMessages.basePenalty, {
          distance: formatDistance(meters),
        })
      : intl.formatMessage(routeProfileWeightMessages.basePenaltyChanged, {
          distance: formatDistance(meters),
          standard: routeProfileLabel(intl, DEFAULT_ROUTE_PROFILE_ID),
          standardDistance: formatDistance(standardMeters),
        }),
  ];

  const byFactor = new Map<number, HazardCategory[]>();
  for (const category of HAZARD_CATEGORIES) {
    const factor = profile.categoryMultipliers[category];
    if (factor === undefined || factor === 1) continue;
    byFactor.set(factor, [...(byFactor.get(factor) ?? []), category]);
  }
  if (byFactor.size === 0) {
    lines.push(intl.formatMessage(routeProfileWeightMessages.noMultipliers));
  }
  for (const [factor, categories] of [...byFactor].sort(([a], [b]) => b - a)) {
    lines.push(
      intl.formatMessage(routeProfileWeightMessages.multiplier, {
        count: categories.length,
        categories: intl.formatList(
          categories.map((c) => categoryLabel(intl, c)),
          { type: 'conjunction' },
        ),
        factor: intl.formatNumber(factor, { maximumFractionDigits: 2 }),
      }),
    );
  }

  if (profile.refuseHighSeverityWhenAlternativeExists) {
    lines.push(intl.formatMessage(routeProfileWeightMessages.refuseHighSeverity));
  }
  return lines;
}

export function queueStateLabel(intl: IntlShape, state: QueueState): string {
  return intl.formatMessage(queueStateMessages[state]);
}

/**
 * The rider-facing sentence for a queued report's failure (issue #203).
 *
 * Takes `string | undefined` rather than `ApiFailure | undefined` on purpose:
 * the argument comes off an IndexedDB row, so its type is a claim about what
 * this build wrote, not about what is on the device. An absent or unrecognised
 * value resolves to `unrecorded` instead of throwing or rendering blank.
 */
export function queueErrorLabel(intl: IntlShape, code?: string): string {
  const known = QUEUE_ERROR_CODES.find((c) => c === code);
  return intl.formatMessage(known ? queueErrorMessages[known] : queueErrorMessages.unrecorded);
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
    queueError: (code?: string) => queueErrorLabel(intl, code),
    routeProfile: (id: RouteProfileId) => routeProfileLabel(intl, id),
    routeProfileWeights: (id: RouteProfileId) => routeProfileWeightLines(intl, id),
  };
}
