/**
 * Reports received per area per month (issue #180, research roadmap E8).
 *
 * The trend is the coverage view's set with a month on it, so it has to count
 * what `/api/coverage` counts -- and the last test here holds the two to each
 * other. The rest pin the three places a time series of crowd reports quietly
 * lies: the calendar it buckets in, a month the service may not have been
 * running, and a "confirmed" count whose timing was never stored.
 */
import { describe, it, expect } from 'vitest';
import { monthKey, reportTrends, type LifecycleRecord } from '../../shared/recurrence.ts';
import { PLACE } from '../../shared/place.ts';
import { areaNameFor, ELSEWHERE_AREA, PLACE_AREAS, tallyByArea } from '../../shared/areas.ts';

// Two points in different named areas (the pair tests/unit/coverage.test.ts uses).
const CENTRAL = { lat: 38.5449, lng: -121.7405 };
const NORTH = { lat: 38.57, lng: -121.74 };

/** A point inside the pack's bounds but outside every named box, found rather than guessed. */
function elsewherePoint(): { lat: number; lng: number } {
  const { minLat, maxLat, minLng, maxLng } = PLACE.bounds;
  for (let lat = minLat; lat <= maxLat; lat += 0.002) {
    for (let lng = minLng; lng <= maxLng; lng += 0.002) {
      if (areaNameFor({ lat, lng }) === ELSEWHERE_AREA) return { lat, lng };
    }
  }
  throw new Error('the pack has no point outside its named areas');
}

const at = (iso: string) => Date.parse(iso);

let n = 0;
function rec(over: Partial<LifecycleRecord> = {}): LifecycleRecord {
  n += 1;
  const created = at('2026-05-10T12:00:00-07:00');
  return {
    id: `t${String(n).padStart(4, '0')}`,
    category: 'pothole',
    cell: CENTRAL,
    status: 'approved',
    createdAt: created,
    updatedAt: created,
    expiresAt: created + 30 * 86_400_000,
    resolvedAt: null,
    confirmations: 0,
    source: 'report',
    ...over,
  };
}

function row(trends: ReturnType<typeof reportTrends>, month: string, area: string) {
  return trends.months.find((m) => m.month === month)?.areas.find((a) => a.name === area);
}

describe('reportTrends', () => {
  it('buckets a report in the month it was filed in the town, not in UTC', () => {
    const evening = at('2026-03-31T18:00:00-07:00'); // 01:00 UTC on 1 April
    expect(monthKey(evening, 'UTC')).toBe('2026-04');
    const trends = reportTrends([rec({ createdAt: evening })]);
    expect(trends.timeZone).toBe('America/Los_Angeles');
    expect(trends.months.map((m) => m.month)).toEqual(['2026-03']);
    expect(row(trends, '2026-03', areaNameFor(CENTRAL))?.received).toBe(1);
  });

  it('counts every report received except rejected ones, and counts seeded demo data apart', () => {
    const trends = reportTrends([
      rec({ status: 'pending' }),
      rec({ status: 'approved' }),
      rec({ status: 'resolved', resolvedAt: at('2026-05-20T12:00:00-07:00') }),
      rec({ status: 'expired' }),
      rec({ status: 'rejected' }),
      rec({ source: 'seed' }),
    ]);
    expect(row(trends, '2026-05', areaNameFor(CENTRAL))?.received).toBe(4);
    expect(trends.seedExcluded).toBe(1);
  });

  it("confirmed and resolved are what has happened to that month's reports so far", () => {
    const march = at('2026-03-12T09:00:00-07:00');
    const trends = reportTrends([
      rec({ createdAt: march, status: 'resolved', resolvedAt: at('2026-05-02T09:00:00-07:00') }),
      rec({ createdAt: march, confirmations: 2 }),
      rec({ createdAt: march }),
    ]);
    // The fix happened in May; it is counted against the March reports it fixed,
    // and May, in which nothing was received, is not a row at all.
    expect(row(trends, '2026-03', areaNameFor(CENTRAL))).toEqual({
      name: areaNameFor(CENTRAL),
      received: 3,
      confirmed: 1,
      resolved: 1,
    });
    expect(trends.months.map((m) => m.month)).toEqual(['2026-03']);
  });

  it('lists every named area in every listed month, with a real zero where nothing was received', () => {
    expect(areaNameFor(NORTH)).not.toBe(areaNameFor(CENTRAL));
    const trends = reportTrends([rec({ cell: CENTRAL })]);
    expect(trends.months[0].areas.map((a) => a.name)).toEqual(PLACE_AREAS.map((a) => a.name));
    expect(row(trends, '2026-05', areaNameFor(NORTH))).toEqual({
      name: areaNameFor(NORTH),
      received: 0,
      confirmed: 0,
      resolved: 0,
    });
  });

  it('leaves out a month in which nothing was received anywhere, and says how many it left out', () => {
    const trends = reportTrends([
      rec({ createdAt: at('2026-01-15T12:00:00-08:00') }),
      rec({ createdAt: at('2026-04-15T12:00:00-07:00') }),
    ]);
    expect(trends.months.map((m) => m.month)).toEqual(['2026-01', '2026-04']);
    expect(trends.omittedMonths).toBe(2);
  });

  it('adds the elsewhere bucket last, and only when something landed there', () => {
    expect(reportTrends([rec()]).months[0].areas.map((a) => a.name)).not.toContain(ELSEWHERE_AREA);
    const trends = reportTrends([rec(), rec({ cell: elsewherePoint() })]);
    expect(trends.months[0].areas.map((a) => a.name)).toEqual([
      ...PLACE_AREAS.map((a) => a.name),
      ELSEWHERE_AREA,
    ]);
  });

  it('an empty store is no months at all, not a month of zeros', () => {
    expect(reportTrends([])).toEqual({
      timeZone: 'America/Los_Angeles',
      months: [],
      omittedMonths: 0,
      seedExcluded: 0,
    });
  });

  it('per area, the months sum to the coverage tally of the same records, less the seeded demo data', () => {
    const records = [
      rec({ cell: CENTRAL, createdAt: at('2026-02-03T08:00:00-08:00') }),
      rec({ cell: CENTRAL, status: 'expired', createdAt: at('2026-04-03T08:00:00-07:00') }),
      rec({ cell: NORTH, status: 'pending', createdAt: at('2026-04-09T08:00:00-07:00') }),
      rec({ cell: NORTH, status: 'rejected', createdAt: at('2026-04-10T08:00:00-07:00') }),
      rec({ cell: NORTH, source: 'seed', createdAt: at('2026-04-11T08:00:00-07:00') }),
      rec({ cell: elsewherePoint(), createdAt: at('2026-06-01T08:00:00-07:00') }),
    ];
    const trends = reportTrends(records);
    const coverage = tallyByArea(records.filter((r) => r.status !== 'rejected').map((r) => r.cell));
    for (const { name, count } of coverage) {
      const summed = trends.months.reduce(
        (total, m) => total + (m.areas.find((a) => a.name === name)?.received ?? 0),
        0,
      );
      const seeds = records.filter(
        (r) => r.source === 'seed' && r.status !== 'rejected' && areaNameFor(r.cell) === name,
      ).length;
      expect(summed + seeds, name).toBe(count);
    }
  });
});
