/**
 * Recurring hazard sites (issue #180): what an episode is, what never counts as
 * one, and what a label may say. The issue's two "done when" cases come first.
 *
 * Every exclusion test also runs its fixture with the excluded record made real,
 * so a fixture that failed to recur for some other reason could not pass it.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  closedAt,
  episodesBySite,
  monthKey,
  recurrenceBadges,
  recurringSites,
  type LifecycleRecord,
} from '../../shared/recurrence.ts';
import { PLACE, parsePlacePack } from '../../shared/place.ts';

const DAY = 86_400_000;
/** Noon on 11 September 2026 in Davis. */
const NOW = Date.UTC(2026, 8, 11, 19);
const CELL = { lat: 38.545461, lng: -121.740313 };
const NEXT_CELL = { lat: 38.546091, lng: -121.740313 };
const OPTS = { minEpisodes: 3, windowDays: 1095, now: NOW };

let n = 0;
function rec(over: Partial<LifecycleRecord> = {}): LifecycleRecord {
  n += 1;
  return {
    id: `r${String(n).padStart(4, '0')}`,
    category: 'pothole',
    cell: CELL,
    status: 'approved',
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    expiresAt: NOW + 30 * DAY,
    resolvedAt: null,
    confirmations: 0,
    source: 'report',
    ...over,
  };
}

/** Reported `daysAgo` days before NOW and marked fixed `lasted` days later. */
function fixed(daysAgo: number, lasted = 10, over: Partial<LifecycleRecord> = {}): LifecycleRecord {
  const at = NOW - daysAgo * DAY;
  return rec({
    createdAt: at,
    updatedAt: at + lasted * DAY,
    resolvedAt: at + lasted * DAY,
    status: 'resolved',
    ...over,
  });
}

/** Reported `daysAgo` days before NOW and still on the map. */
function open(daysAgo: number, over: Partial<LifecycleRecord> = {}): LifecycleRecord {
  const at = NOW - daysAgo * DAY;
  return rec({ createdAt: at, updatedAt: at, ...over });
}

const threeEpisodes = () => [fixed(300), fixed(200), open(5)];

/** Deterministic shuffle (mulberry32), so a failure reproduces. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  let s = seed;
  const random = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('recurring sites', () => {
  it('a hazard resolved and re-reported, three times over, is one recurring site with three episodes', () => {
    const sites = recurringSites(threeEpisodes(), OPTS);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({
      category: 'pothole',
      cell: CELL,
      episodes: 3,
      since: monthKey(NOW - 300 * DAY, PLACE.timeZone),
    });
    expect(sites[0].episodeMonths).toHaveLength(3);
  });

  it('two reports inside one open episode are one episode, and no recurring site', () => {
    const records = [open(10), open(5)];
    const [site] = [...episodesBySite(records, NOW).values()];
    expect(site.episodes).toEqual([{ openedAt: NOW - 10 * DAY, closedAt: null, reports: 2 }]);
    expect(recurringSites(records, OPTS)).toEqual([]);
    expect(recurringSites(records, { ...OPTS, minEpisodes: 2 })).toEqual([]);
  });

  it('a report made before the previous one was fixed joins its episode', () => {
    const first = fixed(100, 10); // open from day -100 to day -90
    const during = fixed(95, 20); // reported at -95, while the first was open; fixed at -75
    const [site] = [...episodesBySite([first, during, open(5)], NOW).values()];
    expect(site.episodes.map((e) => e.reports)).toEqual([2, 1]);
    // The episode closes when its last open report closes, not its first.
    expect(site.episodes[0].closedAt).toBe(NOW - 75 * DAY);
  });

  it.each([
    ['pending, which no moderator has seen', { status: 'pending' as const, resolvedAt: null }],
    ['rejected, which a moderator found was not a hazard', { status: 'rejected' as const, resolvedAt: null }],
    ['seeded demo data, which is fiction', { source: 'seed' as const }],
  ])('never counts a report that is %s', (_why, over) => {
    expect(recurringSites([fixed(300), fixed(200, 10, over), open(5)], OPTS)).toEqual([]);
    // The same three with the middle report real do recur, so the refusal above
    // is this exclusion's and not the fixture's.
    expect(recurringSites([fixed(300), fixed(200), open(5)], OPTS)).toHaveLength(1);
  });

  it('a report in the next cell, or of another kind, belongs to a different site', () => {
    expect(recurringSites([fixed(300), fixed(200, 10, { cell: NEXT_CELL }), open(5)], OPTS)).toEqual([]);
    expect(
      recurringSites([fixed(300), fixed(200, 10, { category: 'glass_debris' }), open(5)], OPTS),
    ).toEqual([]);
  });

  it('an expired report closed when it left the map, not when the sweep noticed', () => {
    const leftMap = NOW - 50 * DAY;
    const lapsed = rec({
      createdAt: NOW - 80 * DAY,
      status: 'expired',
      expiresAt: leftMap,
      updatedAt: leftMap + 5 * DAY, // the lazy sweep ran five days late
    });
    expect(closedAt(lapsed, NOW)).toBe(leftMap);
    // Reported two days after it left the map, three days before the sweep ran:
    // a new episode, which closing at `updatedAt` would have merged away.
    const [site] = [...episodesBySite([lapsed, open(48)], NOW).values()];
    expect(site.episodes).toHaveLength(2);
  });

  it('an approved report past its TTL is closed even before the sweep has run', () => {
    expect(closedAt(rec({ createdAt: NOW - 60 * DAY, expiresAt: NOW - 30 * DAY }), NOW)).toBe(
      NOW - 30 * DAY,
    );
    expect(closedAt(open(1), NOW)).toBeNull();
  });

  it('counts only episodes that opened inside the window, and dates the site from the oldest of those', () => {
    const [site] = recurringSites([fixed(400), fixed(300), fixed(200), open(5)], {
      ...OPTS,
      windowDays: 365,
    });
    expect(site.episodes).toBe(3);
    expect(site.since).toBe(monthKey(NOW - 300 * DAY, PLACE.timeZone));
    expect(recurringSites([fixed(400), fixed(200), open(5)], { ...OPTS, windowDays: 365 })).toEqual([]);
  });

  it("dates a site in the town's calendar, not UTC's", () => {
    // 06:00 UTC on 1 March 2026 is 22:00 on 28 February in Davis, and 07:00 on
    // 1 March in N'Djamena (the synthetic test pack's zone).
    const at = Date.UTC(2026, 2, 1, 6);
    expect(monthKey(at, 'America/Los_Angeles')).toBe('2026-02');
    expect(monthKey(at, 'UTC')).toBe('2026-03');
    const records = [
      rec({ createdAt: at, updatedAt: at + DAY, resolvedAt: at + DAY, status: 'resolved' }),
      fixed(100),
      open(5),
    ];
    expect(recurringSites(records, OPTS)[0].since).toBe('2026-02');
    const synthetic = parsePlacePack(
      JSON.parse(readFileSync('tests/fixtures/place/synthetic-town.json', 'utf8')),
      'synthetic-town.json',
    );
    expect(recurringSites(records, OPTS, synthetic)[0].since).toBe('2026-03');
  });

  it('ranks by episodes, then the longest-standing, then a stated tiebreak, whatever order the store returned', () => {
    const records = [
      ...[fixed(300), fixed(200), open(5)], // pothole at CELL: 3 episodes since day -300
      ...[fixed(310), fixed(210), fixed(110), open(4)].map((r) => ({ ...r, cell: NEXT_CELL })), // 4
      ...[fixed(350), fixed(250), open(3)].map((r) => ({ ...r, category: 'glass_debris' as const })), // 3, older
    ];
    const ranked = recurringSites(records, OPTS);
    expect(ranked.map((s) => `${s.category}@${s.cell.lat}:${s.episodes}`)).toEqual([
      `pothole@${NEXT_CELL.lat}:4`,
      `glass_debris@${CELL.lat}:3`,
      `pothole@${CELL.lat}:3`,
    ]);
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(recurringSites(shuffle(records, seed), OPTS)).toEqual(ranked);
    }
  });

  it('publishes a count, months and the public cell -- no record ids, no times finer than a month', () => {
    const [site] = recurringSites(threeEpisodes(), OPTS);
    expect(Object.keys(site).sort()).toEqual([
      'area',
      'category',
      'cell',
      'episodeMonths',
      'episodes',
      'since',
    ]);
    for (const month of site.episodeMonths) expect(month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('refuses a threshold that would call one episode a recurrence, and a window with no length', () => {
    expect(() => recurringSites(threeEpisodes(), { ...OPTS, minEpisodes: 1 })).toThrow(/at least 2/);
    expect(() => recurringSites(threeEpisodes(), { ...OPTS, minEpisodes: 2.5 })).toThrow(RangeError);
    expect(() => recurringSites(threeEpisodes(), { ...OPTS, windowDays: 0 })).toThrow(/positive/);
  });
});

describe('recurrenceBadges', () => {
  const onMap = (r: LifecycleRecord, over: { source?: 'report' | 'seed' } = {}) => ({
    id: r.id,
    category: r.category,
    location: r.cell,
    source: 'report' as const,
    ...over,
  });

  it("labels a hazard on the map with its own site's episodes and first month", () => {
    const records = threeEpisodes();
    const current = records[2];
    expect(recurrenceBadges([onMap(current)], records, OPTS)).toEqual([
      { hazardId: current.id, episodes: 3, since: monthKey(NOW - 300 * DAY, PLACE.timeZone) },
    ]);
  });

  it('never labels a seeded demo hazard, even one standing at a recurring site', () => {
    const records = threeEpisodes();
    const seed = open(2, { source: 'seed' });
    expect(recurrenceBadges([onMap(seed, { source: 'seed' })], [...records, seed], OPTS)).toEqual([]);
  });

  it('does not label a hazard whose own site is not recurring', () => {
    const records = threeEpisodes();
    const elsewhere = open(2, { cell: NEXT_CELL });
    expect(recurrenceBadges([onMap(elsewhere)], [...records, elsewhere], OPTS)).toEqual([]);
  });

  it('says nothing but the hazard, the episode count and a month', () => {
    const records = threeEpisodes();
    const [badge] = recurrenceBadges([onMap(records[2])], records, OPTS);
    expect(Object.keys(badge).sort()).toEqual(['episodes', 'hazardId', 'since']);
  });
});
