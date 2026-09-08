/**
 * Validation schemas shared by the client (pre-submit checks) and the server
 * (authoritative input validation — Responsible-Tech Framework §3).
 */
import { z } from 'zod';
import { PLACE, type PlacePack } from './place.ts';
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  ROUTE_PROFILE_IDS,
  DEFAULT_ROUTE_PROFILE_ID,
} from './types.ts';

/**
 * The served town's bounding box (a generous rectangle around the city + campus).
 *
 * Read off the place pack rather than written here, so a second town is a pack and
 * not a patch. See `shared/place.ts`.
 */
export const PLACE_BOUNDS = PLACE.bounds;

/** Centre of the served town — used as the default map view. */
export const PLACE_CENTER = PLACE.center;

/** Max size of an uploaded (already-compressed) photo data URL, in bytes. */
export const MAX_PHOTO_BYTES = 3_000_000; // ~3 MB keeps mobile-data uploads sane.

export const MAX_DESCRIPTION_LEN = 500;

export const geoPointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

/**
 * A point must be inside a pack's bounding box. Reports elsewhere are almost
 * always GPS errors or spam, and accepting them would pollute a local map.
 *
 * Parameterised over the pack so a second town's bounds can be exercised by the
 * same tests that exercise Davis's — proof that the rule is pack-driven, not a
 * claim that it is.
 */
export function placePointSchemaFor(pack: PlacePack) {
  return geoPointSchema.refine(
    (p) =>
      p.lat >= pack.bounds.minLat &&
      p.lat <= pack.bounds.maxLat &&
      p.lng >= pack.bounds.minLng &&
      p.lng <= pack.bounds.maxLng,
    { message: pack.outOfBoundsMessage },
  );
}

/** The served town's point schema. */
export const placePointSchema = placePointSchemaFor(PLACE);

/** A data URL for a supported raster image type. */
const photoDataUrlSchema = z
  .string()
  .regex(
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/,
    'Photo must be a base64-encoded JPEG, PNG, or WebP data URL.',
  )
  .refine((s) => s.length <= MAX_PHOTO_BYTES * 1.4, {
    // base64 inflates bytes by ~4/3; bound the encoded string accordingly.
    message: 'Photo is too large; please retake at a lower resolution.',
  });

export const reportSubmissionSchema = z.object({
  category: z.enum(HAZARD_CATEGORIES),
  severity: z.enum(SEVERITIES),
  description: z.string().trim().max(MAX_DESCRIPTION_LEN).optional(),
  location: placePointSchema,
  photo: photoDataUrlSchema.nullable(),
  clientId: z.string().uuid(),
  capturedAt: z.number().int().positive(),
});

export type ValidatedReport = z.infer<typeof reportSubmissionSchema>;

/**
 * Body of `POST /api/hazards/:id/confirm`.
 *
 * `deviceId` is REQUIRED, and that is the point of the schema. If it were
 * optional, omitting it would be the trivial way past the per-device cap — a
 * gate that anyone can turn off by sending less is not a gate. It is a
 * device-scoped UUID the client mints once and keeps (see `src/lib/deviceId.ts`),
 * NOT a report's `clientId`: report ids are minted per submission, so they would
 * identify nothing across two confirmations.
 *
 * The server never stores it. See `server/lib/confirmationCap.ts`.
 */
export const confirmSubmissionSchema = z.object({
  deviceId: z.string().uuid(),
});

export type ValidatedConfirm = z.infer<typeof confirmSubmissionSchema>;

/** A geographic bounding box (south, west, north, east). */
export const bboxSchema = z
  .object({
    minLat: z.number().gte(-90).lte(90),
    minLng: z.number().gte(-180).lte(180),
    maxLat: z.number().gte(-90).lte(90),
    maxLng: z.number().gte(-180).lte(180),
  })
  .refine((b) => b.minLat <= b.maxLat && b.minLng <= b.maxLng, {
    message: 'bbox min must not exceed max.',
  });

export const hazardFiltersSchema = z.object({
  categories: z.array(z.enum(HAZARD_CATEGORIES)).optional(),
  minSeverity: z.enum(SEVERITIES).optional(),
  withinDays: z.coerce.number().int().positive().max(365).optional(),
  bbox: bboxSchema.optional(),
  // Delta-feed cursor (epoch ms): the 30s mobile poll sends the last
  // serverTime it saw so the server can return only what changed since.
  updatedSince: z.coerce.number().int().nonnegative().optional(),
});

export type ValidatedHazardFilters = z.infer<typeof hazardFiltersSchema>;

/**
 * Query for one page of the moderation queue (FIX-04). The cursor is the
 * opaque keyset token a previous page returned (`<createdAt>:<id>`); anything
 * else is rejected up front so a corrupt cursor can never silently restart
 * the traversal from the top.
 */
export const moderationQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .regex(/^\d+:.+$/, 'cursor must be a token returned by a previous page')
    .optional(),
});

/**
 * A hazard-aware route request: a start and end point, both inside Davis. The
 * planner only routes within the mapped area (and refuses GPS-error inputs).
 */
export const routeRequestSchema = z.object({
  from: placePointSchema,
  to: placePointSchema,
  /**
   * The rider profile (E2). Omitted means `default`, and an unknown value is a
   * 400 rather than a silent fall back to `default`: a rider who asked for
   * `family-safest` and was quietly given the default route would be told the
   * map had avoided things it had not.
   *
   * The message names the value that was sent and the ones that exist, because
   * the API's error envelope is a stable `validation_error` and the message is
   * the only place a caller learns which profile they got wrong.
   */
  profile: z
    .enum(ROUTE_PROFILE_IDS, {
      message:
        'unknown routing profile; expected one of: ' +
        [...ROUTE_PROFILE_IDS].sort().join(', '),
    })
    .default(DEFAULT_ROUTE_PROFILE_ID),
});

export type ValidatedRouteRequest = z.infer<typeof routeRequestSchema>;

/**
 * 311 status sync-back webhook body. GOGov/311 (or an integration shim) POSTs
 * this when a handed-off report changes state; `reference` is the hazard id we
 * forwarded, `status` is the provider's free-form status string (mapped to our
 * lifecycle by server/lib/lifecycle.ts).
 */
export const handoffStatusSchema = z.object({
  reference: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(80),
  note: z.string().trim().max(300).optional(),
});

export type ValidatedHandoffStatus = z.infer<typeof handoffStatusSchema>;

/**
 * Saved-area / saved-route alert subscription (web push). A watch is either a
 * bounding-box area or a route corridor; the geometry is capped so a single
 * subscription can't carry an unbounded polyline.
 */
const areaWatchSchema = z.object({
  kind: z.literal('area'),
  minLat: z.number().gte(-90).lte(90),
  minLng: z.number().gte(-180).lte(180),
  maxLat: z.number().gte(-90).lte(90),
  maxLng: z.number().gte(-180).lte(180),
});

const routeWatchSchema = z.object({
  kind: z.literal('route'),
  corridorMeters: z.number().positive().max(500),
  geometry: z.array(geoPointSchema).min(2).max(2000),
});

export const watchSchema = z.discriminatedUnion('kind', [areaWatchSchema, routeWatchSchema]);

export const alertSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000),
    keys: z.object({
      p256dh: z.string().min(1).max(300),
      auth: z.string().min(1).max(300),
    }),
  }),
  watch: watchSchema,
  label: z.string().trim().max(80).optional(),
});

export type ValidatedAlertSubscription = z.infer<typeof alertSubscriptionSchema>;

/** Body for a moderation decision. */
export const moderationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'resolve']),
  reason: z.string().trim().max(300).optional(),
});

/** Moderator login credentials. */
export const loginSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

/**
 * A client-side error report. Deliberately small and PII-free: only a message,
 * an optional stack and source label, and the path (never a query string). All
 * fields are length-capped so a flood can't bloat the server logs.
 */
export const clientErrorSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  stack: z.string().trim().max(4000).nullish(),
  source: z.string().trim().max(120).optional().default('unknown'),
  detail: z.string().trim().max(500).nullish(),
  path: z.string().trim().max(200).nullish(),
  at: z.number().int().positive().optional(),
});

export type ClientError = z.infer<typeof clientErrorSchema>;

/**
 * A cookieless Core Web Vitals field sample (see src/lib/vitals.ts). No
 * cookies, no IPs, no identifiers: just the metric, its value/rating and the
 * path (never a query string), per OBSERVABILITY-STANDARD section 8.
 */
export const webVitalSchema = z.object({
  type: z.literal('vital').optional(),
  name: z.enum(['CLS', 'INP', 'LCP']),
  value: z.number().finite().nonnegative(),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  path: z.string().trim().max(200).regex(/^\/[^?#]*$/, 'path must not contain a query or fragment'),
});

export type WebVital = z.infer<typeof webVitalSchema>;
