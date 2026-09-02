/**
 * Coverage-by-area presentation for the equity view.
 *
 * The map can mislead: an empty area reads as "safe" when it often just means
 * "under-reported". Bucketing reports into named Davis areas surfaces that gap
 * explicitly — see docs/audits/coverage-equity.md.
 *
 * The area boxes themselves live in `shared/areas.ts`, because the server
 * tallies reports against the same boxes for `GET /api/coverage`. This module
 * is the client-side read of those tallies: exposure normalization and the
 * data-desert call-out.
 */
import type { Hazard } from '../../shared/types.ts';
import { DAVIS_AREAS, ELSEWHERE_AREA, tallyByArea, type AreaCount } from '../../shared/areas.ts';

export { DAVIS_AREAS, ELSEWHERE_AREA, type AreaCount };
export type { Area } from '../../shared/areas.ts';

/**
 * Tally the hazards *currently in the public feed* by area.
 *
 * NOTE the set: the public feed carries approved-and-unexpired hazards plus
 * recently-resolved ones. It is NOT "reports received" — pending, rejected,
 * expired and older-resolved reports are all absent from it. Use this only
 * where the count is explicitly described as what is on the map right now;
 * `GET /api/coverage` is the authority on reports received.
 */
export function bucketByArea(hazards: Hazard[]): AreaCount[] {
  return tallyByArea(hazards.map((h) => h.location));
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
 * Takes tallies rather than hazards on purpose. The tally that belongs here is
 * *reports received* (`GET /api/coverage`), not the public feed: an area whose
 * reports are all still in the moderation queue, or have since expired, has in
 * fact been observed, and calling it a data desert would state the opposite of
 * the truth in the one surface built to stop absence reading as safety.
 *
 * Pure and total: with zero reports every exposed area is flagged as a data
 * desert; the "Elsewhere in Davis" bucket has no exposure baseline and is only
 * included when something lands there.
 */
export function normalizeCoverage(counts: AreaCount[]): AreaCoverage[] {
  const byName = new Map(counts.map((c) => [c.name, c.count]));
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const totalWeight = DAVIS_AREAS.reduce((sum, a) => sum + a.exposureWeight, 0);

  const named: AreaCoverage[] = DAVIS_AREAS.map((a) => {
    const count = byName.get(a.name) ?? 0;
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

  const elsewhere = byName.get(ELSEWHERE_AREA) ?? 0;
  if (elsewhere > 0) {
    named.push({
      name: ELSEWHERE_AREA,
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
