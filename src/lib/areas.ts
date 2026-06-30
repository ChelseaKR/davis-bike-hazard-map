/**
 * Coverage-by-area bucketing for the equity view.
 *
 * The map can mislead: an empty area reads as "safe" when it often just means
 * "under-reported". Bucketing reports into named Davis areas surfaces that gap
 * explicitly — see docs/audits/coverage-equity.md.
 *
 * Areas are approximate, ordered boxes; the first box that contains a (fuzzed,
 * public) point wins, with an "Elsewhere in Davis" fallback.
 */
import type { Hazard } from '../../shared/types.ts';

export interface Area {
  name: string;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  /**
   * Relative estimated cycling *exposure* for the area (unitless weight, only
   * meaningful relative to the other areas' weights). This is a deliberately
   * COARSE heuristic — a rough stand-in for "how much riding happens here" so
   * the coverage view can flag where reports are scarce *relative to ridership*
   * rather than in absolute terms. It is NOT a measured ridership/population
   * figure; the literature (research roadmap EV-SKEW) warns that exposure
   * denominators are themselves uncertain and can introduce bias, so this is
   * surfaced qualitatively, always paired with the limits note in CoverageView,
   * and never presented as ground truth. See docs/audits/coverage-equity.md.
   */
  exposureWeight: number;
}

export const DAVIS_AREAS: Area[] = [
  { name: 'UC Davis campus', minLat: 38.53, maxLat: 38.545, minLng: -121.77, maxLng: -121.745, exposureWeight: 5 },
  { name: 'North Davis', minLat: 38.56, maxLat: 38.6, minLng: -121.8, maxLng: -121.7, exposureWeight: 3 },
  { name: 'South Davis', minLat: 38.5, maxLat: 38.535, minLng: -121.8, maxLng: -121.7, exposureWeight: 2 },
  { name: 'West Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.8, maxLng: -121.755, exposureWeight: 3 },
  { name: 'East Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.73, maxLng: -121.7, exposureWeight: 3 },
  { name: 'Central Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.755, maxLng: -121.73, exposureWeight: 4 },
];

const ELSEWHERE = 'Elsewhere in Davis';

export interface AreaCount {
  name: string;
  count: number;
}

function areaFor(h: Hazard): string {
  const a = DAVIS_AREAS.find(
    (area) =>
      h.location.lat >= area.minLat &&
      h.location.lat <= area.maxLat &&
      h.location.lng >= area.minLng &&
      h.location.lng <= area.maxLng,
  );
  return a?.name ?? ELSEWHERE;
}

/**
 * Count hazards per area. Every named area is always present (so zero-report
 * areas are visible — that's the point), with "Elsewhere in Davis" appended
 * only when something lands outside the named boxes.
 */
export function bucketByArea(hazards: Hazard[]): AreaCount[] {
  const counts = new Map<string, number>(DAVIS_AREAS.map((a) => [a.name, 0]));
  for (const h of hazards) {
    const key = areaFor(h);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const named = DAVIS_AREAS.map((a) => ({ name: a.name, count: counts.get(a.name) ?? 0 }));
  const elsewhere = counts.get(ELSEWHERE) ?? 0;
  return elsewhere > 0 ? [...named, { name: ELSEWHERE, count: elsewhere }] : named;
}

/** How an area's report share compares to its estimated cycling exposure. */
export type Representation = 'none' | 'under' | 'typical' | 'over';

export interface AreaCoverage {
  name: string;
  count: number;
  /** Relative estimated exposure weight (0 for the "Elsewhere" bucket). */
  exposureWeight: number;
  /** Share of all reports this area would hold if reports tracked exposure
   *  (0..1), or null when there is no exposure baseline (the Elsewhere bucket). */
  expectedShare: number | null;
  /** Observed share of all reports (0..1). */
  observedShare: number;
  /** Qualitative read of observed vs. expected (see thresholds below). */
  representation: Representation;
  /**
   * A named area with real estimated ridership but ZERO reports — a likely
   * "data desert" where absence almost certainly means under-reporting, not
   * safety. This is the call-out the equity audit asks the view to make loud.
   */
  isDataDesert: boolean;
}

// Bands for the observed/expected ratio. Wide on purpose: this is a coarse
// signpost, not a statistic, so we only flag clear over/under-representation.
const UNDER_RATIO = 0.5;
const OVER_RATIO = 1.5;

/**
 * Normalize per-area report counts by estimated cycling exposure so the
 * coverage view can say "under-reported *for how much riding happens here*"
 * rather than just "few reports" (research roadmap R4, evidence EV-SKEW). The
 * exposure weights are a rough heuristic (see `Area.exposureWeight`), so the
 * output is intentionally qualitative and MUST be shown with the limits note.
 *
 * Pure and total: with zero reports every exposed area is flagged as a data
 * desert; the "Elsewhere in Davis" bucket has no exposure baseline and is only
 * included when something lands there.
 */
export function normalizeCoverage(hazards: Hazard[]): AreaCoverage[] {
  const counts = new Map<string, number>(DAVIS_AREAS.map((a) => [a.name, 0]));
  for (const h of hazards) {
    const key = areaFor(h);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = hazards.length;
  const totalWeight = DAVIS_AREAS.reduce((sum, a) => sum + a.exposureWeight, 0);

  const named: AreaCoverage[] = DAVIS_AREAS.map((a) => {
    const count = counts.get(a.name) ?? 0;
    const expectedShare = totalWeight > 0 ? a.exposureWeight / totalWeight : null;
    const observedShare = total > 0 ? count / total : 0;
    const isDataDesert = count === 0 && a.exposureWeight > 0;

    let representation: Representation;
    if (count === 0 && a.exposureWeight > 0) {
      representation = 'none';
    } else if (expectedShare === null || expectedShare === 0 || total === 0) {
      representation = 'typical';
    } else {
      const ratio = observedShare / expectedShare;
      representation = ratio < UNDER_RATIO ? 'under' : ratio > OVER_RATIO ? 'over' : 'typical';
    }

    return { name: a.name, count, exposureWeight: a.exposureWeight, expectedShare, observedShare, representation, isDataDesert };
  });

  const elsewhere = counts.get(ELSEWHERE) ?? 0;
  if (elsewhere > 0) {
    named.push({
      name: ELSEWHERE,
      count: elsewhere,
      exposureWeight: 0,
      expectedShare: null,
      observedShare: total > 0 ? elsewhere / total : 0,
      representation: 'typical',
      isDataDesert: false,
    });
  }
  return named;
}
