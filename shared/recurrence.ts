/**
 * Report trends and recurring hazard sites (issue #180; research roadmap E8,
 * ideation EXP-13), derived from lifecycle timestamps the store already keeps.
 *
 * ## Descriptive, never predictive
 *
 * Everything here counts what riders REPORTED and what then happened to those
 * reports. Nothing estimates risk, extrapolates to a street nobody reported, or
 * ranks by anything except how often something was reported.
 * `docs/audits/coverage-equity.md` is the reason: an under-reported area reads as
 * safe, and a table of "recurring" sites ranks the streets whose riders report
 * most. So a recurring site is always "reported in N separate episodes", never
 * "N incidents happened here".
 *
 * ## Derived on read, never stored
 *
 * There is no episode table and no migration. A stored episode index would be a
 * second copy of what the timestamps already say, able to drift from them, and
 * it would keep a trace of a report whose reporter deleted it:
 * `DELETE /api/reports/:clientId` removes the record, and the privacy page
 * promises that it does. A value computed on every read cannot outlive the
 * report it counts.
 *
 * ## What is read
 *
 * Only a {@link LifecycleRecord}: category, the FUZZED public cell, status,
 * timestamps, the confirmation count and provenance. Never the precise point,
 * the description, the photo or the moderation log. `Repository.listLifecycle`
 * selects exactly these fields, so the aggregates below never have the rest in
 * hand.
 */
import type { GeoPoint, HazardCategory, HazardSource, HazardStatus } from './types.ts';
import { areaNameFor } from './areas.ts';
import { PLACE, type PlacePack } from './place.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only fields trends and recurrence read. See the module docstring. */
export interface LifecycleRecord {
  id: string;
  category: HazardCategory;
  /** The fuzzed public cell (`publicLocation`), never the precise point. */
  cell: GeoPoint;
  status: HazardStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  confirmations: number;
  source: HazardSource;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Months -------------------------------------------------------------------

const monthFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * The calendar month (`YYYY-MM`) an instant falls in, in `timeZone`. A report
 * filed at 6 p.m. on 31 March in Davis is a March report, although it is
 * already 1 April in UTC.
 */
export function monthKey(epochMs: number, timeZone: string): string {
  let format = monthFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' });
    monthFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(epochMs));
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!year || !month) {
    throw new RangeError(`could not place ${epochMs} in a calendar month in ${timeZone}`);
  }
  return `${year}-${month}`;
}

function monthOrdinal(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + (month - 1);
}

// --- Trends -------------------------------------------------------------------

export interface AreaMonthCounts {
  name: string;
  /** Reports received that month: every report except rejected ones and seeded demo data. */
  received: number;
  /** Of those reports, how many another rider has confirmed so far. */
  confirmed: number;
  /** Of those reports, how many have been marked fixed so far. */
  resolved: number;
}

export interface MonthTrend {
  /** `YYYY-MM`, in {@link ReportTrends.timeZone}. */
  month: string;
  /** Every named area in bucketing order, then the elsewhere bucket if anything ever landed there. */
  areas: AreaMonthCounts[];
}

export interface ReportTrends {
  /** The town's IANA zone the months are calendar months of. */
  timeZone: string;
  /** Oldest first. Only months in which at least one report was received anywhere. */
  months: MonthTrend[];
  /** Months between the first and last listed in which nothing was received anywhere: left out, not shown as zero. */
  omittedMonths: number;
  /** Seeded demo hazards in the counted set, left out of every month. */
  seedExcluded: number;
}

/**
 * Reports received per area per month, with what has happened to them since.
 *
 * THE SET is the one `GET /api/coverage` counts -- every report received except
 * rejected ones (`areaReportCounts` in server/lib/hazards.ts) -- minus seeded
 * demo data, whose timestamps are invented and would make a fabricated time
 * series. So, per area, `received` summed over the months plus the seeded hazards
 * in that area equals the coverage count: two public surfaces over one set.
 * Asserted in tests/unit/trends.test.ts and tests/unit/recurrenceApi.test.ts.
 *
 * COHORT, NOT FLOW. A month's row is the reports RECEIVED that month, and
 * `confirmed` / `resolved` are what has happened to THOSE reports so far. For
 * `confirmed` there is no other honest reading: when a confirmation happened is
 * deliberately not stored, because the per-device cap is kept in memory rather
 * than in a durable log that would be a movement trace of a cyclist (#187). A
 * cohort row can still change after its month ends, and the view says so.
 *
 * A MONTH WITH NOTHING IS NOT SHOWN AS ZERO. The service cannot tell a quiet
 * month from one it was not running in -- the hosted beta is paused as this is
 * written (#161) -- so a month in which no report was received anywhere is left
 * out and counted in `omittedMonths`. Inside a listed month the service was
 * demonstrably collecting, so an area's zero there is a real zero, and every
 * named area is listed, as the coverage view lists them.
 */
export function reportTrends(
  records: readonly LifecycleRecord[],
  pack: PlacePack = PLACE,
): ReportTrends {
  const received = records.filter((r) => r.status !== 'rejected');
  const real = received.filter((r) => r.source !== 'seed');

  const tally = new Map<string, Map<string, AreaMonthCounts>>();
  let elsewhereUsed = false;
  for (const r of real) {
    const month = monthKey(r.createdAt, pack.timeZone);
    const area = areaNameFor(r.cell, pack);
    if (area === pack.elsewhereAreaName) elsewhereUsed = true;
    let byArea = tally.get(month);
    if (!byArea) {
      byArea = new Map();
      tally.set(month, byArea);
    }
    let row = byArea.get(area);
    if (!row) {
      row = { name: area, received: 0, confirmed: 0, resolved: 0 };
      byArea.set(area, row);
    }
    row.received += 1;
    if (r.confirmations > 0) row.confirmed += 1;
    if (r.status === 'resolved') row.resolved += 1;
  }

  const names = [
    ...pack.areas.map((a) => a.name),
    ...(elsewhereUsed ? [pack.elsewhereAreaName] : []),
  ];
  const monthKeys = [...tally.keys()].sort(compareText);
  const months = monthKeys.map((month) => ({
    month,
    areas: names.map((name) => ({
      ...(tally.get(month)?.get(name) ?? { name, received: 0, confirmed: 0, resolved: 0 }),
    })),
  }));
  const first = monthKeys[0];
  const last = monthKeys[monthKeys.length - 1];
  const span = first === undefined || last === undefined ? 0 : monthOrdinal(last) - monthOrdinal(first) + 1;

  return {
    timeZone: pack.timeZone,
    months,
    omittedMonths: span - monthKeys.length,
    seedExcluded: received.length - real.length,
  };
}

// --- Episodes and recurring sites ----------------------------------------------

export interface RecurrenceOptions {
  /** Episodes inside the window a site needs before it is called recurring. At least 2. */
  minEpisodes: number;
  /** How long ago an episode may have opened and still count, in days. */
  windowDays: number;
  now: number;
}

/**
 * The defaults the server config falls back to. Three episodes is the issue's own
 * example; three years is the ideation's ("this underpass has flooded every winter
 * for three years"). Both are configurable and neither has been reviewed against
 * real Davis data, because there is none yet (#161).
 */
export const DEFAULT_RECURRENCE: Readonly<Pick<RecurrenceOptions, 'minEpisodes' | 'windowDays'>> = {
  minEpisodes: 3,
  windowDays: 1095,
};

/** Refuse settings under which the word "recurring" would be false. */
export function assertRecurrenceOptions(
  opts: Pick<RecurrenceOptions, 'minEpisodes' | 'windowDays'>,
): void {
  if (!Number.isInteger(opts.minEpisodes) || opts.minEpisodes < 2) {
    throw new RangeError(
      `recurrence minEpisodes must be an integer of at least 2 (got ${opts.minEpisodes}): ` +
        'one episode is not a recurrence',
    );
  }
  if (!Number.isFinite(opts.windowDays) || opts.windowDays <= 0) {
    throw new RangeError(`recurrence windowDays must be positive (got ${opts.windowDays})`);
  }
}

/**
 * Whether a record is evidence that a hazard was reported here: moderated, public
 * at some point, and real. Pending reports have not been seen by a moderator,
 * rejected ones were found not to be hazards, and seeded demo data is fiction.
 */
export function isEpisodeEvidence(r: LifecycleRecord): boolean {
  if (r.source === 'seed') return false;
  return r.status === 'approved' || r.status === 'resolved' || r.status === 'expired';
}

/**
 * When a report stopped being an open report, or null while it still is.
 *
 * An expired report closed at `expiresAt`, when it left the public map; its
 * `updatedAt` is when the lazy expiry sweep got round to it, which can be days
 * later. An approved report past its TTL is closed even if the sweep has not run.
 */
export function closedAt(r: LifecycleRecord, now: number): number | null {
  switch (r.status) {
    case 'resolved':
      return r.resolvedAt ?? r.updatedAt;
    case 'expired':
      return r.expiresAt;
    case 'approved':
      return r.expiresAt <= now ? r.expiresAt : null;
    default:
      return r.updatedAt;
  }
}

/** One stretch of time during which a site had at least one open report. */
export interface Episode {
  openedAt: number;
  /** When its last report closed, or null while one is still open. */
  closedAt: number | null;
  reports: number;
}

export interface SiteHistory {
  category: HazardCategory;
  cell: GeoPoint;
  episodes: Episode[];
}

/**
 * A site is a public cell and a category. Two reports are "the same place" only
 * if the fuzzing grid put them in the same cell: nothing finer is ever used.
 */
export function siteKey(category: HazardCategory, cell: GeoPoint): string {
  return `${category}|${cell.lat}|${cell.lng}`;
}

/**
 * Every site's episodes, oldest first. A report joins the current episode if it
 * was made while that episode was still open; otherwise it opens a new one. So a
 * pothole reported, fixed, and reported again is two episodes, and two riders
 * reporting it the same week is one.
 */
export function episodesBySite(
  records: readonly LifecycleRecord[],
  now: number,
): Map<string, SiteHistory> {
  const groups = new Map<string, LifecycleRecord[]>();
  for (const r of records) {
    if (!isEpisodeEvidence(r)) continue;
    const key = siteKey(r.category, r.cell);
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }

  const sites = new Map<string, SiteHistory>();
  for (const [key, group] of groups) {
    group.sort((a, b) => a.createdAt - b.createdAt || compareText(a.id, b.id));
    const episodes: Episode[] = [];
    for (const r of group) {
      const end = closedAt(r, now);
      const current = episodes[episodes.length - 1];
      if (current && (current.closedAt === null || r.createdAt <= current.closedAt)) {
        current.reports += 1;
        current.closedAt =
          current.closedAt === null || end === null ? null : Math.max(current.closedAt, end);
      } else {
        episodes.push({ openedAt: r.createdAt, closedAt: end, reports: 1 });
      }
    }
    sites.set(key, { category: group[0].category, cell: group[0].cell, episodes });
  }
  return sites;
}

export interface RecurringSite {
  category: HazardCategory;
  /** The fuzzed public cell every report counted here shares. */
  cell: GeoPoint;
  area: string;
  /** Separate episodes that opened inside the window. */
  episodes: number;
  /** The month the first of those episodes opened, in the town's time zone. */
  since: string;
  /** The month each counted episode opened, oldest first. */
  episodeMonths: string[];
}

/** Most episodes first, then the longest-standing, then a stated tiebreak. A total order. */
function compareSites(a: RecurringSite, b: RecurringSite): number {
  return (
    b.episodes - a.episodes ||
    compareText(a.since, b.since) ||
    compareText(a.category, b.category) ||
    a.cell.lat - b.cell.lat ||
    a.cell.lng - b.cell.lng
  );
}

/**
 * Sites reported in at least `minEpisodes` separate episodes that opened within
 * the window. No record ids, no timestamps finer than a month, and no
 * description: a count, a month and the public cell.
 */
export function recurringSites(
  records: readonly LifecycleRecord[],
  opts: RecurrenceOptions,
  pack: PlacePack = PLACE,
): RecurringSite[] {
  assertRecurrenceOptions(opts);
  const cutoff = opts.now - opts.windowDays * DAY_MS;
  const sites: RecurringSite[] = [];
  for (const site of episodesBySite(records, opts.now).values()) {
    const counted = site.episodes.filter((e) => e.openedAt >= cutoff);
    if (counted.length < opts.minEpisodes) continue;
    const episodeMonths = counted.map((e) => monthKey(e.openedAt, pack.timeZone));
    sites.push({
      category: site.category,
      cell: site.cell,
      area: areaNameFor(site.cell, pack),
      episodes: counted.length,
      since: episodeMonths[0],
      episodeMonths,
    });
  }
  return sites.sort(compareSites);
}

/** What a hazard on the map is told about its site's history. */
export interface RecurrenceBadge {
  hazardId: string;
  episodes: number;
  /** `YYYY-MM`, in the town's time zone. */
  since: string;
}

/**
 * The recurrence label for each hazard currently on the public map whose site is
 * recurring. Matched on the hazard's own fuzzed cell and category -- the key its
 * record has -- so a hazard is only ever labelled with the history of its own
 * site. A seeded demo hazard is never labelled: it is fiction, and fiction is
 * neither evidence of recurrence nor something that can recur.
 */
export function recurrenceBadges(
  onMap: readonly { id: string; category: HazardCategory; location: GeoPoint; source?: HazardSource }[],
  records: readonly LifecycleRecord[],
  opts: RecurrenceOptions,
  pack: PlacePack = PLACE,
): RecurrenceBadge[] {
  const sites = new Map(
    recurringSites(records, opts, pack).map((s) => [siteKey(s.category, s.cell), s]),
  );
  const badges: RecurrenceBadge[] = [];
  for (const hazard of onMap) {
    if (hazard.source === 'seed') continue;
    const site = sites.get(siteKey(hazard.category, hazard.location));
    if (site) badges.push({ hazardId: hazard.id, episodes: site.episodes, since: site.since });
  }
  return badges.sort((a, b) => compareText(a.hazardId, b.hazardId));
}
