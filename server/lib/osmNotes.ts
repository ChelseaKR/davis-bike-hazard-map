/**
 * Optional OpenStreetMap Notes feedback-loop adapter (EXP-08).
 *
 * When a moderator judges a hazard to describe a *permanent map feature* (a
 * dangerous intersection, a persistently poor-visibility spot) the map can draft
 * an anonymous OSM Note so local mappers can verify and improve the base map.
 * Like the 311 hand-off (see gogov.ts) this DEGRADES GRACEFULLY: it runs in
 * "dry-run" by default and returns the note it *would* have posted, so the rest
 * of the system (and tests) work without a live integration.
 *
 * Privacy boundary (see docs/ideation/03-expansions.md, EXP-08): the note carries
 * only the FUZZED public coordinate and the category/severity labels plus a
 * back-link to the public record — NEVER the free-text description, the photo,
 * or any reporter data. OSM data is ODbL-licensed and the note text becomes part
 * of the public record, so nothing user-authored is forwarded; a human moderator
 * must trigger each note and enabling live posting needs a license/consent review.
 */
import type { StoredHazard } from './types.ts';
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  OSM_ELIGIBLE_CATEGORIES,
  type HazardCategory,
} from '../../shared/types.ts';

// Re-exported for adapter callers/tests; the canonical list lives in shared/types.
export { OSM_ELIGIBLE_CATEGORIES };

/** True when a hazard's category is eligible for an OSM Note suggestion. */
export function isOsmEligible(category: HazardCategory): boolean {
  return (OSM_ELIGIBLE_CATEGORIES as readonly HazardCategory[]).includes(category);
}

export interface OsmNotesConfig {
  /**
   * OSM Notes API endpoint. Defaults elsewhere to the public OSM instance, but
   * the adapter still DRY-RUNS unless `enabled` is explicitly true.
   */
  apiUrl?: string;
  /** Master switch. Off => the adapter only ever returns a dry-run draft. */
  enabled: boolean;
  /** Public base URL of this deployment, used to build the back-link. Optional. */
  publicBaseUrl?: string;
}

/** The exact, minimal contract we would post to OSM Notes. */
export interface OsmNotePayload {
  lat: number;
  lon: number;
  text: string;
}

export interface OsmNoteResult {
  delivered: boolean;
  dryRun: boolean;
  payload: OsmNotePayload;
  status?: number;
  error?: string;
}

/**
 * Build the note body. Restricted to category/severity labels, the fuzzed
 * public coordinate, and a back-link — no description, photo, or reporter data.
 */
export function buildOsmNotePayload(
  hazard: StoredHazard,
  config: OsmNotesConfig = { enabled: false },
): OsmNotePayload {
  // FUZZED public location only (never hazard.preciseLocation). OSM notes are
  // public and permanent, so we deliberately post the grid-snapped point.
  const point = hazard.publicLocation;
  const category = CATEGORY_LABELS[hazard.category];
  const severity = SEVERITY_LABELS[hazard.severity];

  // Back-link to the public record so an OSM mapper can cross-reference. Prefer a
  // full URL when a base URL is configured; otherwise reference the id alone.
  const base = config.publicBaseUrl?.replace(/\/$/, '');
  const backLink = base
    ? `${base}/#hazard=${hazard.id}`
    : `Davis Bike Hazard Map reference ${hazard.id}`;

  const text =
    `${category} (severity: ${severity}) reported by cyclists via the Davis Bike ` +
    `Hazard Map as a possible permanent infrastructure issue. Please verify on ` +
    `the ground before editing OpenStreetMap. Details: ${backLink}`;

  return { lat: point.lat, lon: point.lng, text };
}

/**
 * Draft (and, when enabled, post) an anonymous OSM Note for a hazard. With the
 * feature disabled or no API URL configured, returns a dry-run result describing
 * the note. Never throws — a failed suggestion must not break moderation
 * (graceful degradation, same contract as forwardToGogov).
 */
export async function postOsmNote(
  hazard: StoredHazard,
  config: OsmNotesConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<OsmNoteResult> {
  const payload = buildOsmNotePayload(hazard, config);

  if (!config.enabled || !config.apiUrl) {
    return { delivered: false, dryRun: true, payload };
  }

  try {
    // Anonymous note creation: POST with form-encoded lat/lon/text.
    const body = new URLSearchParams({
      lat: String(payload.lat),
      lon: String(payload.lon),
      text: payload.text,
    });
    const res = await fetchImpl(config.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    return {
      delivered: res.ok,
      dryRun: false,
      payload,
      status: res.status,
      error: res.ok ? undefined : `OSM Notes responded ${res.status}`,
    };
  } catch (err) {
    return {
      delivered: false,
      dryRun: false,
      payload,
      error: err instanceof Error ? err.message : 'OSM note post failed',
    };
  }
}
