/**
 * The city-grade prioritisation export (issue #179).
 *
 * Public Works asks "what should we fix first?" and, until now, got a map. This
 * builds the moderator-only work list behind
 * `GET /api/moderation/priority.csv` and `GET /api/moderation/priority.geojson`.
 *
 * Three properties this module exists to hold, all of them the same discipline
 * the rest of this repo already applies to hand-offs and coverage:
 *
 * 1. **Precise coordinates never leave the authenticated export.** Every public
 *    surface renders `publicLocation` (grid-snapped). A work order cannot be
 *    dispatched to a fuzzed point, so this export carries `preciseLocation` —
 *    and it is the ONLY projection in the codebase that does. It is gated on
 *    `requireModerator` in `server/app.ts`, and `tests/unit/priority.test.ts`
 *    asserts the public export is unchanged.
 *
 * 2. **A 311 reference is printed only where something was actually
 *    delivered.** `handoff.stage` reads `'submitted'` from the instant a
 *    forward is ATTEMPTED, dry-run or not (issue #162), so printing the
 *    reference off `stage` would hand the city a ticket number for a ticket
 *    that never left this process. The reference is blank unless the delivery
 *    receipt says `delivered`; `handoff_delivery` always states which of the
 *    four kinds it was, so a blank is legible rather than merely empty.
 *
 * 3. **An area with no exposure weight gets no normalised score — not a
 *    zero.** `PLACE_AREAS` is the served place pack's named areas, and the
 *    pack schema requires a positive `exposureWeight` on every one of them
 *    (`shared/place.ts`), so a named area can never reach here weightless.
 *    `ELSEWHERE_AREA` — "Elsewhere in Davis" under `place/davis.json` — is the
 *    fallback bucket for points inside the pack's bounding box but outside
 *    every named box. It is not an entry in `PLACE_AREAS` at all, so it has no
 *    weight, because nobody has estimated the riding that happens there.
 *    Dividing by a default of 1 would publish an estimate nobody made, and
 *    ranking such an area as if it scored 0 would sort it below every real
 *    measurement while looking like a measurement. Those rows carry blank
 *    weight, blank per-exposure figure and blank area rank, and sort after
 *    every ranked row — never interleaved with them.
 *
 *    Both names are read from the pack rather than hard-coded, so a second
 *    town deployed from its own pack gets its own areas and its own
 *    "elsewhere" label instead of Davis's.
 *
 * The normalisation is deliberately COARSE and says so in the export preamble,
 * reproducing the limits note from `docs/audits/coverage-equity.md` and the
 * caveat from `shared/areas.ts` verbatim. `tests/unit/priority.test.ts` reads
 * both source documents and fails if either sentence drifts, so the caveat
 * printed to the city cannot quietly stop matching the caveat this project
 * committed to.
 */

import {
  PLACE_AREAS,
  ELSEWHERE_AREA,
  areaNameFor,
  type Area,
} from '../../shared/areas.ts';
import { SEVERITY_RANK, lifecycleStage } from '../../shared/types.ts';
import type { HandoffDeliveryKind } from '../../shared/types.ts';
import { handoffDeliveryKind } from './handoffRetry.ts';
import type { StoredHazard } from './types.ts';

/**
 * The limits note from `docs/audits/coverage-equity.md`, reproduced verbatim
 * (issue #179 requires it). Asserted against the document itself in
 * `tests/unit/priority.test.ts`, so editing one without the other is a red
 * build rather than a silent divergence between what the audit promises and
 * what the city is told.
 */
export const EQUITY_LIMITS_NOTE =
  'A crowdsourced map measures **reports received**, not ground-truth danger.';

/**
 * The exposure caveat from `shared/areas.ts`, reproduced verbatim. Same drift
 * gate as `EQUITY_LIMITS_NOTE`.
 */
export const EXPOSURE_CAVEAT =
  'It is NOT a measured ridership or population figure';

/** Column order of the CSV, and the property order of the GeoJSON. */
export const PRIORITY_COLUMNS = [
  'rank',
  'hazard_id',
  'area',
  'area_rank',
  'area_confirmed_count',
  'area_exposure_weight',
  'area_confirmed_per_exposure',
  'category',
  'severity',
  'confirmations',
  'days_open',
  'created_at',
  'updated_at',
  'lat',
  'lng',
  'handoff_provider',
  'handoff_reference',
  'handoff_delivery',
  'handoff_stage',
  'source',
] as const;

export type PriorityColumn = (typeof PRIORITY_COLUMNS)[number];

/**
 * One row of the work list.
 *
 * Every field that can be genuinely absent is typed `| null` rather than
 * defaulted, so "we do not know" survives all the way to the CSV cell and the
 * GeoJSON property instead of being flattened into 0 or ''. Rendering turns a
 * `null` into an empty cell; nothing turns it into a number.
 */
export interface PriorityRow {
  /** 1-based position in this export, after the stated ordering is applied. */
  rank: number;
  hazardId: string;
  area: string;
  /**
   * The area's rank by confirmed hazards per unit of exposure (1 = worst).
   * `null` for an area with no exposure weight — see the module note.
   */
  areaRank: number | null;
  /** Confirmed hazards in this area. A raw count, beside the normalised one. */
  areaConfirmedCount: number;
  /** The area's coarse exposure weight, or `null` where none is defined. */
  areaExposureWeight: number | null;
  /** `areaConfirmedCount / areaExposureWeight`, or `null` where undefined. */
  areaConfirmedPerExposure: number | null;
  category: string;
  severity: string;
  confirmations: number;
  /** Whole days between creation and the export's `now`. */
  daysOpen: number;
  createdAt: string;
  updatedAt: string;
  /** PRECISE location. Authenticated export only. */
  lat: number;
  lng: number;
  handoffProvider: string | null;
  /**
   * The 311 reference, printed ONLY where the delivery receipt says the
   * hand-off was delivered. `null` for dry-run, undelivered and unknown.
   */
  handoffReference: string | null;
  /** `'none'` where no hand-off exists at all; otherwise the receipt's kind. */
  handoffDelivery: HandoffDeliveryKind | 'none';
  handoffStage: string | null;
  source: string;
}

/** Per-area aggregates, computed once over the confirmed set. */
interface AreaStats {
  count: number;
  weight: number | null;
  perExposure: number | null;
  rank: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function weightFor(areaName: string): number | null {
  if (areaName === ELSEWHERE_AREA) return null;
  const area: Area | undefined = PLACE_AREAS.find((a) => a.name === areaName);
  return area ? area.exposureWeight : null;
}

/**
 * The hazards this export covers: approved hazards whose public lifecycle
 * stage is `confirmed`.
 *
 * `lifecycleStage` alone is NOT sufficient, and assuming it was is the bug the
 * first run of `tests/unit/priority.test.ts` caught. It is a projection defined
 * over hazards that have already passed the moderation gate: it answers
 * `'confirmed'` for anything with `confirmations > 0` that is not resolved or
 * expired — including a `pending` report nobody has reviewed and a `rejected`
 * one somebody has. Reading it unguarded here would have put unmoderated
 * reports, with their PRECISE coordinates, into a file sent to the city.
 *
 * So the moderation status is checked explicitly. The set is: approved, live,
 * and corroborated by at least one other rider — which excludes `reported`
 * (not yet corroborated), `resolved` and `expired` as well. Exported so the
 * tests and the route agree on the set rather than each deciding it.
 */
export function isExportable(hazard: StoredHazard): boolean {
  return hazard.status === 'approved' && lifecycleStage(hazard) === 'confirmed';
}

/**
 * Rank areas by confirmed hazards per unit of exposure.
 *
 * Areas with no exposure weight are ranked `null`. They are NOT given rank
 * `areas.length + 1`, because that would be a position on a scale they were
 * never measured against.
 *
 * Ties in `perExposure` share nothing: the tie is broken by area name ascending
 * so the ranking is a total order and two runs cannot disagree.
 */
function areaStats(confirmed: StoredHazard[]): Map<string, AreaStats> {
  const counts = new Map<string, number>();
  for (const h of confirmed) {
    const name = areaNameFor(h.preciseLocation);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const stats = new Map<string, AreaStats>();
  for (const [name, count] of counts) {
    const weight = weightFor(name);
    stats.set(name, {
      count,
      weight,
      perExposure: weight === null ? null : count / weight,
      rank: null,
    });
  }

  const ranked = [...stats.entries()]
    .filter((entry): entry is [string, AreaStats & { perExposure: number }] =>
      entry[1].perExposure !== null,
    )
    .sort((a, b) => b[1].perExposure - a[1].perExposure || a[0].localeCompare(b[0]));

  ranked.forEach(([, stat], index) => {
    stat.rank = index + 1;
  });

  return stats;
}

/** Round to 4 decimals so two runs on the same data are byte-identical. */
function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Build the work list.
 *
 * Ordering, stated once here and reproduced in the export preamble so a reader
 * of the CSV can reproduce it:
 *
 *   1. rows whose area HAS an exposure-normalised score, by that score
 *      descending;
 *   2. then rows whose area has none, never interleaved with (1);
 *   3. within an area group: severity descending, then confirmations
 *      descending, then days open descending;
 *   4. finally hazard id ascending, which is unique and therefore makes the
 *      order total — two runs over the same store cannot differ.
 */
export function buildPriorityRows(hazards: StoredHazard[], now: number): PriorityRow[] {
  const confirmed = hazards.filter(isExportable);
  const stats = areaStats(confirmed);

  const rows = confirmed.map((h) => {
    const area = areaNameFor(h.preciseLocation);
    const stat = stats.get(area);
    const delivery: HandoffDeliveryKind | 'none' = h.handoff
      ? handoffDeliveryKind(h.handoffDelivery)
      : 'none';
    return {
      row: {
        rank: 0,
        hazardId: h.id,
        area,
        areaRank: stat?.rank ?? null,
        areaConfirmedCount: stat?.count ?? 0,
        areaExposureWeight: stat?.weight ?? null,
        areaConfirmedPerExposure:
          stat?.perExposure === null || stat?.perExposure === undefined
            ? null
            : round4(stat.perExposure),
        category: h.category,
        severity: h.severity,
        confirmations: h.confirmations,
        daysOpen: Math.max(0, Math.floor((now - h.createdAt) / MS_PER_DAY)),
        createdAt: new Date(h.createdAt).toISOString(),
        updatedAt: new Date(h.updatedAt).toISOString(),
        lat: h.preciseLocation.lat,
        lng: h.preciseLocation.lng,
        handoffProvider: h.handoff?.provider ?? null,
        // The whole point of the column: a reference is a promise that the city
        // holds this. Only a delivered receipt supports that promise.
        handoffReference: delivery === 'delivered' ? (h.handoff?.reference ?? null) : null,
        handoffDelivery: delivery,
        handoffStage: h.handoff?.stage ?? null,
        source: h.source ?? 'report',
      } satisfies PriorityRow,
      // Sort keys kept beside the row rather than recomputed inside comparators.
      sortPerExposure: stat?.perExposure ?? null,
      sortSeverity: SEVERITY_RANK[h.severity],
    };
  });

  rows.sort((a, b) => {
    const aRanked = a.sortPerExposure !== null;
    const bRanked = b.sortPerExposure !== null;
    // (2) unranked rows always after ranked ones, whatever their counts.
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked && bRanked && a.sortPerExposure !== b.sortPerExposure) {
      return (b.sortPerExposure as number) - (a.sortPerExposure as number);
    }
    // Same area group from here (equal per-exposure means equal area, except
    // for the deliberate name tie-break, which the area comparison restores).
    if (a.row.area !== b.row.area) return a.row.area.localeCompare(b.row.area);
    if (a.sortSeverity !== b.sortSeverity) return b.sortSeverity - a.sortSeverity;
    if (a.row.confirmations !== b.row.confirmations) {
      return b.row.confirmations - a.row.confirmations;
    }
    if (a.row.daysOpen !== b.row.daysOpen) return b.row.daysOpen - a.row.daysOpen;
    return a.row.hazardId.localeCompare(b.row.hazardId);
  });

  return rows.map((entry, index) => ({ ...entry.row, rank: index + 1 }));
}

/**
 * The preamble printed above the CSV header, and carried as `notes` on the
 * GeoJSON.
 *
 * It states the normalisation basis, reproduces both caveats verbatim, and
 * says what a blank cell means — because a blank that a reader guesses at is
 * the same failure as a zero that was never measured.
 */
export function priorityPreamble(generatedAt: number): string[] {
  return [
    'Davis Bike Hazard Map — city prioritisation export (moderator-only).',
    `Generated: ${new Date(generatedAt).toISOString()}`,
    'Set: hazards whose public lifecycle stage is "confirmed" (approved, live,',
    '  and corroborated by at least one other rider). Not reported-only, not',
    '  resolved, not expired.',
    'Coordinates: PRECISE reporter locations. The public export is fuzzed; this',
    '  one is not, which is why it requires a moderator session. Handle it as',
    '  personal data.',
    'Normalisation basis: area_confirmed_per_exposure = area_confirmed_count /',
    '  area_exposure_weight, where the weight is the coarse per-area exposure',
    '  weight in shared/areas.ts. area_rank orders areas by that figure,',
    '  highest first, ties broken by area name.',
    `Exposure caveat (shared/areas.ts, verbatim): ${EXPOSURE_CAVEAT}`,
    `Limits (docs/audits/coverage-equity.md, verbatim): ${EQUITY_LIMITS_NOTE}`,
    'Blank cells are not zeros. area_exposure_weight, area_confirmed_per_exposure',
    `  and area_rank are blank for "${ELSEWHERE_AREA}", which has no exposure`,
    '  estimate; those rows sort after every ranked row rather than being scored',
    '  as if they had been measured.',
    'handoff_reference is blank unless handoff_delivery is "delivered". A',
    '  dry-run or failed hand-off records intent only — no ticket reached the',
    '  city, so no reference is printed.',
    'Dispute counts are not included: rider disputes are not implemented yet',
    '  (tracked at issue #174). A dispute column of all zeros would report an',
    '  absent feature as a measurement.',
    'Row order: exposure-normalised areas first by score descending, then',
    '  unranked areas; within an area by severity, confirmations, days open,',
    '  then hazard id — a total order, so two runs agree.',
  ];
}

/** RFC 4180 quoting: quote when the value could otherwise break the row. */
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function cellsFor(row: PriorityRow): (string | number | null)[] {
  return [
    row.rank,
    row.hazardId,
    row.area,
    row.areaRank,
    row.areaConfirmedCount,
    row.areaExposureWeight,
    row.areaConfirmedPerExposure,
    row.category,
    row.severity,
    row.confirmations,
    row.daysOpen,
    row.createdAt,
    row.updatedAt,
    row.lat,
    row.lng,
    row.handoffProvider,
    row.handoffReference,
    row.handoffDelivery,
    row.handoffStage,
    row.source,
  ];
}

/** The CSV: `#`-commented preamble, then the header row, then the rows. */
export function toPriorityCsv(rows: PriorityRow[], generatedAt: number): string {
  const lines = priorityPreamble(generatedAt).map((line) => `# ${line}`);
  lines.push(PRIORITY_COLUMNS.join(','));
  for (const row of rows) {
    lines.push(cellsFor(row).map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export interface PriorityFeatureCollection {
  type: 'FeatureCollection';
  generated: string;
  notes: string[];
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: Record<string, string | number | null>;
  }[];
}

/** The same rows as GeoJSON, with the preamble carried as `notes`. */
export function toPriorityGeoJson(
  rows: PriorityRow[],
  generatedAt: number,
): PriorityFeatureCollection {
  return {
    type: 'FeatureCollection',
    generated: new Date(generatedAt).toISOString(),
    notes: priorityPreamble(generatedAt),
    features: rows.map((row) => {
      const cells = cellsFor(row);
      const properties: Record<string, string | number | null> = {};
      PRIORITY_COLUMNS.forEach((column, index) => {
        properties[column] = cells[index] ?? null;
      });
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [row.lng, row.lat] as [number, number] },
        properties,
      };
    }),
  };
}
