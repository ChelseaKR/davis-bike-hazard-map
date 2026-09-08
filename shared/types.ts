/**
 * Shared domain model for the Davis Bike Hazard Map.
 *
 * These types are the contract between the offline-first client and the
 * lightweight server. They are intentionally framework-free so they can be
 * imported from React components, the Fastify server, and tests alike.
 */

/** What kind of hazard a report describes. */
export const HAZARD_CATEGORIES = [
  'pothole',
  'glass_debris',
  'blocked_lane',
  'dangerous_intersection',
  'near_miss',
  'poor_visibility',
  'surface_damage',
  'other',
] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

/**
 * Named rider routing profiles (E2). The *weights* live in `shared/routing.ts`;
 * only the vocabulary lives here, beside the other domain vocabularies, because
 * `shared/validation.ts` needs the id list and `routing.ts` transitively imports
 * `validation.ts` through `geo.ts`. Declaring it there made a runtime import
 * cycle that `tsc` accepted -- the type side is erased -- and that only the test
 * run exposed, as `ROUTE_PROFILE_IDS is not iterable`.
 */
export const ROUTE_PROFILE_IDS = ['default', 'family-safest', 'e-bike'] as const;
export type RouteProfileId = (typeof ROUTE_PROFILE_IDS)[number];

/** The profile a request gets when it asks for none. */
export const DEFAULT_ROUTE_PROFILE_ID: RouteProfileId = 'default';

/**
 * Categories that can plausibly describe a PERMANENT, OSM-mappable feature and
 * are therefore eligible for the moderator-triggered OSM Notes feedback loop
 * (EXP-08). Shared so the client shows the action only for these and the server
 * can reject others.
 */
export const OSM_ELIGIBLE_CATEGORIES = [
  'dangerous_intersection',
  'poor_visibility',
] as const satisfies readonly HazardCategory[];

/** How dangerous the reporter judges the hazard to be. */
export const SEVERITIES = ['low', 'moderate', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * Provenance of a hazard record (issue #111): `'report'` is a real submission
 * from a cyclist; `'seed'` is illustrative demo data inserted by
 * `scripts/seed.ts` so a fresh/public deployment isn't an empty map. Every
 * surface that renders a hazard (card, list, map popup) and the open-data
 * export must be able to tell the two apart — a hazard map's whole claim is
 * that it reflects real conditions, so seeded fiction must never be
 * indistinguishable from a real report.
 */
export const HAZARD_SOURCES = ['report', 'seed'] as const;
export type HazardSource = (typeof HAZARD_SOURCES)[number];

/**
 * Moderation/lifecycle state.
 *
 * Nothing is shown publicly until it is `approved` (moderation gate). A hazard
 * can later be `confirmed` by other cyclists, `resolved` once fixed, or it can
 * `expire` so the map stays trustworthy.
 */
export const HAZARD_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'resolved',
  'expired',
] as const;
export type HazardStatus = (typeof HAZARD_STATUSES)[number];

/** Human-friendly labels, kept next to the model so client and docs agree. */
export const CATEGORY_LABELS: Record<HazardCategory, string> = {
  pothole: 'Pothole',
  glass_debris: 'Glass / debris',
  blocked_lane: 'Blocked bike lane',
  dangerous_intersection: 'Dangerous intersection',
  // A "near miss" / close call (dooring, swerve, scary right-hook) is the
  // leading-indicator class official crash data misses entirely; capturing it
  // is cheap and high-signal (research roadmap E1). Not a physical defect, so a
  // photo is rarely available — the photo step stays optional, as it already is.
  near_miss: 'Near miss / close call',
  poor_visibility: 'Poor visibility',
  surface_damage: 'Surface damage',
  other: 'Other',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

/**
 * Public-facing lifecycle stage, surfaced on the map and list.
 *
 * This is a *derived projection* of the moderation `status` (+ confirmations),
 * NOT a separate stored field — so the moderation gate's invariants are
 * untouched. A live hazard starts `reported`, becomes `confirmed` once another
 * cyclist confirms it, and ends `resolved` (fixed) or `expired` (timed out).
 */
export const LIFECYCLE_STAGES = ['reported', 'confirmed', 'resolved', 'expired'] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  reported: 'Reported',
  confirmed: 'Confirmed',
  resolved: 'Resolved',
  expired: 'Expired',
};

/**
 * State of a 311/GOGov hand-off, synced back from the city.
 *
 * `submitted` → we forwarded it; `acknowledged`/`in_progress` → the city is
 * working it; `resolved`/`closed` → fixed (which also resolves our hazard);
 * `rejected` → the city declined it (the hazard stays on our map).
 */
export const HANDOFF_STAGES = [
  'submitted',
  'acknowledged',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
] as const;
export type HandoffStage = (typeof HANDOFF_STAGES)[number];

export const HANDOFF_STAGE_LABELS: Record<HandoffStage, string> = {
  submitted: 'Sent to city 311',
  acknowledged: 'Acknowledged by city',
  in_progress: 'City crew assigned',
  resolved: 'Fixed by city',
  closed: 'Closed by city',
  rejected: 'Declined by city',
};

/**
 * How far a hand-off actually got — orthogonal to `HandoffStage`, which is the
 * CITY's view of the ticket and says nothing about whether anything ever
 * reached the city.
 *
 * `stage: 'submitted'` is recorded the moment a hand-off is attempted, dry-run
 * or not (see `initialHandoff`), so on its own it cannot distinguish "the city
 * has this" from "no provider is configured and nothing left the process"
 * (issue #162). This does.
 *
 * - `delivered`   — a provider accepted it, or the city has synced a status back.
 * - `dry_run`     — no provider is configured. Intent recorded; nothing was sent.
 * - `undelivered` — a real transport attempt failed. A retry is scheduled, or
 *                   the attempt budget is spent and it is in the dead-letter queue.
 * - `unknown`     — no delivery receipt exists at all (a record written before
 *                   receipts existed). Never render this as success.
 */
export const HANDOFF_DELIVERY_KINDS = ['delivered', 'dry_run', 'undelivered', 'unknown'] as const;
export type HandoffDeliveryKind = (typeof HANDOFF_DELIVERY_KINDS)[number];

/** 311 hand-off record attached to a hazard once it is forwarded to the city. */
export interface HandoffInfo {
  /** Integration provider, e.g. "gogov". */
  provider: string;
  /** The reference we forwarded (equals the hazard id). */
  reference: string;
  /** The provider's raw status string (pre-mapping), for transparency. */
  externalStatus: string;
  /** Our normalized stage (see HANDOFF_STAGES). */
  stage: HandoffStage;
  submittedAt: number;
  updatedAt: number;
  note?: string | null;
}

/**
 * The hand-off as the PUBLIC API exposes it: the stored record plus how far it
 * actually got.
 *
 * `delivery` is derived at projection time from the internal delivery receipt
 * (`toPublic` in server/lib/hazards.ts), never stored alongside the hand-off,
 * so it cannot drift from the receipt that is the source of truth — a retry
 * that later succeeds flips it with no rewrite. It is REQUIRED here on purpose:
 * every consumer of the public feed has to decide what to say about delivery,
 * rather than defaulting silently to the success wording (issue #162).
 *
 * The receipt itself (`handoffDelivery`: attempt counts, `lastError`,
 * `nextRetryAt`) stays internal and is still never projected.
 */
export interface PublicHandoffInfo extends HandoffInfo {
  delivery: HandoffDeliveryKind;
}

/** A geographic point. Longitude/latitude in WGS84 decimal degrees. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * The payload a client submits to create a report.
 *
 * `photo` is a base64 data URL of an image that has ALREADY been EXIF-stripped
 * and (optionally) blurred on the device. The server never receives raw camera
 * files or EXIF metadata — privacy is enforced before upload.
 */
export interface ReportSubmission {
  category: HazardCategory;
  severity: Severity;
  description?: string;
  location: GeoPoint;
  /** Base64 data URL (image/jpeg|png|webp) or null when no photo was attached. */
  photo: string | null;
  /** Client-generated UUID for idempotent, offline-tolerant submission. */
  clientId: string;
  /** Epoch ms the report was captured on the device. */
  capturedAt: number;
}

/**
 * A hazard as the public API exposes it.
 *
 * Note: `location` here is the FUZZED coordinate (see server/lib/geo). The
 * precise device coordinate is never exposed in the public feed.
 *
 * `clientId` is deliberately ABSENT: it is the reporter's deletion capability
 * (see `DELETE /api/reports/:clientId`), so publishing it in the feed would let
 * anyone erase any report. It lives only on the server-side `StoredHazard` and
 * on the reporter's own device (their local report queue).
 */
export interface Hazard {
  id: string;
  category: HazardCategory;
  severity: Severity;
  description: string | null;
  location: GeoPoint;
  /** Relative URL of the moderated photo, or null. */
  photoUrl: string | null;
  /** Relative URL of a small thumbnail (list/map), or null. */
  thumbnailUrl?: string | null;
  status: HazardStatus;
  /** Count of independent confirmations from other cyclists. */
  confirmations: number;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms after which the hazard auto-expires off the public map. */
  expiresAt: number;
  /** Epoch ms the hazard was marked resolved, or null. */
  resolvedAt?: number | null;
  /**
   * 311 hand-off + its synced-back status, or null if never forwarded. Carries
   * `delivery` (see `PublicHandoffInfo`): `stage` alone cannot tell a real
   * submission from a dry-run or a failed one.
   */
  handoff?: PublicHandoffInfo | null;
  /**
   * `'seed'` marks illustrative demo data from `scripts/seed.ts`; absent (or
   * `'report'`) means a real submitted report. Optional here only so existing
   * test fixtures/callers that predate this field keep compiling — the server
   * always populates it on every live response.
   */
  source?: HazardSource;
}

/**
 * Derive the public lifecycle stage from a hazard's moderation status and
 * confirmation count. Pure and total so it can run on the client and server.
 */
export function lifecycleStage(
  hazard: Pick<Hazard, 'status' | 'confirmations'>,
): LifecycleStage {
  if (hazard.status === 'resolved') return 'resolved';
  if (hazard.status === 'expired') return 'expired';
  if (hazard.confirmations > 0) return 'confirmed';
  return 'reported';
}

/** Filters the map/list views apply client-side and the API accepts. */
export interface HazardFilters {
  categories?: HazardCategory[];
  minSeverity?: Severity;
  /** Only hazards updated within this many days. */
  withinDays?: number;
}

/** Standard error envelope returned by the API. */
export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

/** Ordering used for severity comparisons (higher = worse). */
export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
};
