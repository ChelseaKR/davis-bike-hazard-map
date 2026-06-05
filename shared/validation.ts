/**
 * Validation schemas shared by the client (pre-submit checks) and the server
 * (authoritative input validation — Responsible-Tech Framework §3).
 */
import { z } from 'zod';
import { HAZARD_CATEGORIES, SEVERITIES } from './types.ts';

/** Davis, CA bounding box (a generous rectangle around the city + campus). */
export const DAVIS_BOUNDS = {
  minLat: 38.52,
  maxLat: 38.59,
  minLng: -121.82,
  maxLng: -121.68,
} as const;

/** Centre of Davis — used as the default map view. */
export const DAVIS_CENTER = { lat: 38.5449, lng: -121.7405 } as const;

/** Max size of an uploaded (already-compressed) photo data URL, in bytes. */
export const MAX_PHOTO_BYTES = 3_000_000; // ~3 MB keeps mobile-data uploads sane.

export const MAX_DESCRIPTION_LEN = 500;

const geoPointSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

/**
 * A point must be inside the Davis bounding box. Reports elsewhere are almost
 * always GPS errors or spam, and accepting them would pollute a local map.
 */
export const davisPointSchema = geoPointSchema.refine(
  (p) =>
    p.lat >= DAVIS_BOUNDS.minLat &&
    p.lat <= DAVIS_BOUNDS.maxLat &&
    p.lng >= DAVIS_BOUNDS.minLng &&
    p.lng <= DAVIS_BOUNDS.maxLng,
  { message: 'Location must be within Davis, CA.' },
);

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
  location: davisPointSchema,
  photo: photoDataUrlSchema.nullable(),
  clientId: z.string().uuid(),
  capturedAt: z.number().int().positive(),
});

export type ValidatedReport = z.infer<typeof reportSubmissionSchema>;

export const hazardFiltersSchema = z.object({
  categories: z.array(z.enum(HAZARD_CATEGORIES)).optional(),
  minSeverity: z.enum(SEVERITIES).optional(),
  withinDays: z.coerce.number().int().positive().max(365).optional(),
});

/** Body for a moderation decision. */
export const moderationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'resolve']),
  reason: z.string().trim().max(300).optional(),
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
