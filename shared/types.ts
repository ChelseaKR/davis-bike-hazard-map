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
  'poor_visibility',
  'surface_damage',
  'other',
] as const;
export type HazardCategory = (typeof HAZARD_CATEGORIES)[number];

/** How dangerous the reporter judges the hazard to be. */
export const SEVERITIES = ['low', 'moderate', 'high'] as const;
export type Severity = (typeof SEVERITIES)[number];

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
  poor_visibility: 'Poor visibility',
  surface_damage: 'Surface damage',
  other: 'Other',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
};

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
 */
export interface Hazard {
  id: string;
  clientId: string;
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
