/**
 * GET /api/trends, /api/hazards/recurrence and /api/chronic (issue #180), driven
 * through the real routes with an injected clock.
 *
 * The issue's three "done when" lines, and where each is held here:
 *  1. a hazard fixed and re-reported three times is one recurring site with three
 *     episodes; two reports in one open episode are none -- the label tests;
 *  2. "trend counts sum to the export's totals" -- the export (`/api/hazards/export`)
 *     carries only live approved hazards, so a count of reports RECEIVED cannot sum
 *     to it by construction. The surface that counts the same set is `/api/coverage`,
 *     and the trend is held to that;
 *  3. with the ranking off, no ranking endpoint answers and labels still render --
 *     the flag tests. Labels are themselves unpublished by default here, for a
 *     reason the issue did not weigh; see config.recurrence.badgesPublish.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { createHazard, REPORTS_NOT_GROUND_TRUTH } from '../../server/lib/hazards.ts';
import { MemoryPhotoStore } from '../../server/lib/photoStore.ts';
import {
  chronicResponseSchema,
  recurrenceResponseSchema,
  trendsResponseSchema,
} from '../../server/lib/openapi-registry.ts';
import { areaNameFor } from '../../shared/areas.ts';
import { monthKey } from '../../shared/recurrence.ts';
import { PLACE } from '../../shared/place.ts';
import { reportSubmissionSchema } from '../../shared/validation.ts';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';
const DAY = 86_400_000;
const START = Date.UTC(2026, 0, 5, 20); // noon on 5 January 2026 in Davis
const CENTRAL = { lat: 38.5449, lng: -121.7405 };
const NORTH = { lat: 38.57, lng: -121.74 };
const DESCRIPTION = 'Deep pothole in the bike lane by the bridge';

type Recurrence = (typeof serverConfig)['recurrence'];

async function setup(recurrence: Partial<Recurrence> = {}) {
  let clock = START;
  const repo = new MemoryRepository();
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: START,
    tokenVersion: 0,
  });
  const config = {
    ...serverConfig,
    isProd: false,
    isTest: true,
    sessionSecret: 'test-session-secret',
    sessionTtlMs: 365 * DAY,
    routingUrl: '',
    resolvedVisibleDays: 7,
    corsOrigins: [],
    serveClient: false,
    rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000, confirmationsPerHour: 10_000 },
    ttlDays: { low: 14, moderate: 21, high: 30 },
    recurrence: { ...serverConfig.recurrence, ...recurrence },
  } as typeof serverConfig;
  const app = await buildApp({ repo, moderators, config, logger: false, now: () => clock });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MOD_USER, password: MOD_PASS },
  });
  const token = login.json().token as string;

  const env = {
    app,
    repo,
    advance(days: number) {
      clock += days * DAY;
    },
    now: () => clock,
    async submit(location = CENTRAL, category = 'pothole'): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/reports',
        payload: {
          category,
          severity: 'high',
          description: DESCRIPTION,
          location,
          photo: null,
          clientId: randomUUID(),
          capturedAt: clock,
        },
      });
      expect(res.statusCode).toBe(201);
      return res.json().hazard.id as string;
    },
    async decide(id: string, decision: 'approve' | 'reject' | 'resolve') {
      const res = await app.inject({
        method: 'POST',
        url: `/api/moderation/${id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { decision },
      });
      expect(res.statusCode, `${decision} ${id}`).toBe(200);
    },
    /** A report that is approved, stays open `days`, and is marked fixed; then time moves on. */
    async episodeFixed(location = CENTRAL) {
      const id = await env.submit(location);
      await env.decide(id, 'approve');
      env.advance(2);
      await env.decide(id, 'resolve');
      env.advance(28);
      return id;
    },
    /** A report approved and still on the map. */
    async episodeOpen(location = CENTRAL) {
      const id = await env.submit(location);
      await env.decide(id, 'approve');
      return id;
    },
  };
  return env;
}

describe('GET /api/trends', () => {
  it('counts the set /api/coverage counts, month by month, with seeded demo data counted apart', async () => {
    const env = await setup();
    await env.decide(await env.submit(CENTRAL), 'approve');
    await env.submit(CENTRAL); // pending: received, not yet moderated
    await env.decide(await env.submit(NORTH), 'reject'); // not a hazard, counted nowhere
    const seed = await createHazard(
      env.repo,
      new MemoryPhotoStore(),
      reportSubmissionSchema.parse({
        category: 'pothole',
        severity: 'low',
        description: 'Demo',
        location: NORTH,
        photo: null,
        clientId: randomUUID(),
        capturedAt: env.now(),
      }),
      env.now(),
      { ttlDays: { low: 14, moderate: 21, high: 30 } },
      'seed',
    );
    expect(seed.source).toBe('seed');

    const trends = trendsResponseSchema.parse((await env.app.inject('/api/trends')).json());
    const month = monthKey(START, PLACE.timeZone);
    expect(trends.months.map((m) => m.month)).toEqual([month]);
    expect(trends.months[0].areas.find((a) => a.name === areaNameFor(CENTRAL))?.received).toBe(2);
    expect(trends.months[0].areas.find((a) => a.name === areaNameFor(NORTH))?.received).toBe(0);
    expect(trends.seedExcluded).toBe(1);

    // Held to the coverage view, area by area: the trend's months plus the seeded
    // hazards equal what /api/coverage counts.
    const coverage = (await env.app.inject('/api/coverage')).json().areas as { name: string; count: number }[];
    const seedsIn = (name: string) => (areaNameFor(NORTH) === name ? 1 : 0);
    for (const { name, count } of coverage) {
      const summed = trends.months.reduce(
        (total, m) => total + (m.areas.find((a) => a.name === name)?.received ?? 0),
        0,
      );
      expect(summed + seedsIn(name), name).toBe(count);
    }
  });

  it('carries the coverage-equity limits sentence verbatim, and what it counted', async () => {
    const env = await setup();
    const body = (await env.app.inject('/api/trends')).json();
    const audit = readFileSync('docs/audits/coverage-equity.md', 'utf8').replace(/\*\*/g, '');
    expect(audit).toContain(REPORTS_NOT_GROUND_TRUTH);
    expect(body.limits).toBe(REPORTS_NOT_GROUND_TRUTH);
    expect(body.basis).toMatch(/left out rather than shown as zero/);
  });

  it('publishes aggregate counts only: no ids, cells, descriptions or times', async () => {
    const env = await setup();
    const id = await env.submit(CENTRAL);
    const text = (await env.app.inject('/api/trends')).body;
    expect(text).not.toContain(id);
    expect(text).not.toContain(DESCRIPTION);
    expect(text).not.toContain(String(CENTRAL.lat));
  });
});

describe('GET /api/hazards/recurrence', () => {
  it('is not published by default, says so as not_published, and does not read the store', async () => {
    const env = await setup();
    const read = vi.spyOn(env.repo, 'listLifecycle');
    const res = await env.app.inject('/api/hazards/recurrence');
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_published');
    expect(read).not.toHaveBeenCalled();
  });

  it('when published, labels a hazard fixed and re-reported three times over with three episodes', async () => {
    const env = await setup({ badgesPublish: true });
    await env.episodeFixed();
    await env.episodeFixed();
    const current = await env.episodeOpen();

    const res = await env.app.inject('/api/hazards/recurrence');
    expect(res.statusCode).toBe(200);
    const body = recurrenceResponseSchema.parse(res.json());
    expect(body.badges).toEqual([
      { hazardId: current, episodes: 3, since: monthKey(START, PLACE.timeZone) },
    ]);
    // A label says a count and a month. Never the description, never the precise point.
    expect(res.body).not.toContain(DESCRIPTION);
    expect(res.body).not.toContain(String(CENTRAL.lng));
  });

  it('when published, does not label two reports inside one open episode', async () => {
    const env = await setup({ badgesPublish: true });
    await env.episodeOpen();
    env.advance(3);
    await env.episodeOpen();
    expect(recurrenceResponseSchema.parse((await env.app.inject('/api/hazards/recurrence')).json()).badges).toEqual([]);
  });

  it('when published, a rejected report never makes a site recurring', async () => {
    const env = await setup({ badgesPublish: true });
    await env.episodeFixed();
    const rejected = await env.submit();
    await env.decide(rejected, 'reject');
    env.advance(30);
    await env.episodeOpen();
    expect(recurrenceResponseSchema.parse((await env.app.inject('/api/hazards/recurrence')).json()).badges).toEqual([]);
  });
});

describe('GET /api/chronic', () => {
  it('with the ranking off, answers not_published without reading the store -- and labels still render', async () => {
    const env = await setup({ badgesPublish: true, rankingPublish: false });
    await env.episodeFixed();
    await env.episodeFixed();
    const current = await env.episodeOpen();

    const read = vi.spyOn(env.repo, 'listLifecycle');
    const ranking = await env.app.inject('/api/chronic');
    expect(ranking.statusCode).toBe(404);
    expect(ranking.json().error).toBe('not_published');
    expect(read).not.toHaveBeenCalled();

    const labels = recurrenceResponseSchema.parse((await env.app.inject('/api/hazards/recurrence')).json());
    expect(labels.badges.map((b) => b.hazardId)).toEqual([current]);
  });

  it('when published, ranks the recurring sites with no record ids in the response', async () => {
    const env = await setup({ rankingPublish: true });
    const ids = [await env.episodeFixed(), await env.episodeFixed(), await env.episodeOpen()];
    const res = await env.app.inject('/api/chronic');
    expect(res.statusCode).toBe(200);
    const body = chronicResponseSchema.parse(res.json());
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({ category: 'pothole', episodes: 3, area: areaNameFor(CENTRAL) });
    expect(body.limits).toBe(REPORTS_NOT_GROUND_TRUTH);
    for (const id of ids) expect(res.body).not.toContain(id);
    expect(res.body).not.toContain(DESCRIPTION);
  });
});

describe('recurrence settings', () => {
  it.each([
    [{ minEpisodes: 1 }, /at least 2/],
    [{ windowDays: 0 }, /positive/],
  ])('refuses to boot with %o, under which "recurring" would be false', async (over, message) => {
    await expect(setup(over)).rejects.toThrow(message);
  });
});

describe('Repository.listLifecycle (memory store)', () => {
  it('returns every hazard but rejected ones, oldest first, and never the precise point or the description', async () => {
    const env = await setup();
    const first = await env.submit(CENTRAL);
    env.advance(1);
    const rejected = await env.submit(NORTH);
    await env.decide(rejected, 'reject');
    env.advance(1);
    const third = await env.submit(NORTH);

    const records = await env.repo.listLifecycle();
    expect(records.map((r) => r.id)).toEqual([first, third]);
    for (const r of records) {
      expect(Object.keys(r).sort()).toEqual([
        'category',
        'cell',
        'confirmations',
        'createdAt',
        'expiresAt',
        'id',
        'resolvedAt',
        'source',
        'status',
        'updatedAt',
      ]);
      const stored = await env.repo.findById(r.id);
      expect(r.cell).toEqual(stored?.publicLocation);
      expect(r.cell).not.toEqual(stored?.preciseLocation);
    }
  });
});
