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
 *
 * The note also names the deployment, and that name is the one string in this
 * system that becomes somebody else's permanent public data. It therefore comes
 * from the place pack (`deploymentName`) and has no default here: a second town
 * running its own pack must state its own name, and a pack that does not state one
 * fails to load rather than posting hazards to OpenStreetMap under Davis's name.
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
  /**
   * What this deployment calls itself, from the place pack's `deploymentName`.
   *
   * Required, and required even for a dry run, because a dry run is the draft a
   * moderator reads before deciding to post it. Optional-with-a-default is the
   * shape that put "Davis Bike Hazard Map" into every deployment's notes.
   */
  deploymentName: string;
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
 *
 * There is no default `config`. The name in the body is the deployment's own, and
 * a signature that let a caller omit it would have to invent one; inventing it is
 * how the previous version published Davis's name from any town's pack.
 */
export function buildOsmNotePayload(
  hazard: StoredHazard,
  config: OsmNotesConfig,
): OsmNotePayload {
  // FUZZED public location only (never hazard.preciseLocation). OSM notes are
  // public and permanent, so we deliberately post the grid-snapped point.
  const point = hazard.publicLocation;
  const category = CATEGORY_LABELS[hazard.category];
  const severity = SEVERITY_LABELS[hazard.severity];

  // A blank name cannot be papered over with a fallback: the note would then be
  // posted to a public, permanent map by an unnamed sender. `deploymentName` is
  // `z.string().min(1)` in the pack schema, so this is unreachable from a loaded
  // pack — it refuses a caller that assembles the config by hand.
  const deploymentName = config.deploymentName.trim();
  if (deploymentName === '') {
    throw new Error(
      'osmNotes: deploymentName is blank; an OSM note must name the deployment that sent it',
    );
  }

  // Back-link to the public record so an OSM mapper can cross-reference. Prefer a
  // full URL when a base URL is configured; otherwise reference the id alone.
  const base = config.publicBaseUrl?.replace(/\/$/, '');
  const backLink = base
    ? `${base}/#hazard=${hazard.id}`
    : `${deploymentName} reference ${hazard.id}`;

  const text =
    `${category} (severity: ${severity}) reported by cyclists via the ` +
    `${deploymentName} as a possible permanent infrastructure issue. Please verify ` +
    `on the ground before editing OpenStreetMap. Details: ${backLink}`;

  return { lat: point.lat, lon: point.lng, text };
}

/**
 * Draft (and, when enabled, post) an anonymous OSM Note for a hazard. With the
 * feature disabled or no API URL configured, returns a dry-run result describing
 * the note. Never throws on a *delivery* failure — a dead endpoint, a non-2xx, a
 * network error and a rejected request all come back as a result, because a
 * failed suggestion must not break moderation (graceful degradation, same
 * contract as forwardToGogov).
 *
 * One thing is refused rather than degraded: a config that cannot name the sender.
 * `buildOsmNotePayload` throws on a blank `deploymentName`, and that propagates
 * here on purpose. A dry-run draft with no sender in it is not a safer output than
 * an error — it is an unattributable note offered to a moderator for posting to a
 * public, permanent map. Unreachable from a loaded place pack, where the field is
 * `z.string().min(1)`; reachable from a hand-assembled config, which is why it is
 * a runtime check and not only a type.
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
