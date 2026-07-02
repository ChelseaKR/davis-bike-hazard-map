/**
 * Delta feed (?updatedSince=) — the 30-second poll ships only what changed.
 *
 * Exercised end-to-end with app.inject() against the MemoryRepository:
 * cursor polls return only changed rows, deletions surface as id-only
 * tombstones, stale cursors fall back to the full feed, and never-public rows
 * (pending / rejected-while-pending) leak nothing — not even ids.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { mergeDelta } from '../../src/hooks/useHazards.ts';
import type { Hazard } from '../../shared/types.ts';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  sessionSecret: 'test-session-secret',
  sessionTtlMs: 12 * HOUR,
  gogovWebhookUrl: '',
  gogovApiKey: '',
  gogovStatusUrl: '',
  gogovWebhookSecret: '',
  routingUrl: '',
  resolvedVisibleDays: 7,
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
  ttlDays: { low: 14, moderate: 21, high: 30 },
} as typeof serverConfig;

let clock = 1_700_000_000_000;
const T0 = 1_700_000_000_000;
let app: FastifyInstance;
let repo: MemoryRepository;
let token: string;

const report = (clientId: string, over: Record<string, unknown> = {}) => ({
  category: 'pothole',
  severity: 'high',
  description: 'Deep pothole in the bike lane',
  location: { lat: 38.5449, lng: -121.7405 },
  photo: null,
  clientId,
  capturedAt: 1_699_000_000_000,
  ...over,
});

beforeEach(async () => {
  clock = T0;
  repo = new MemoryRepository();
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: clock,
    tokenVersion: 0,
  });
  app = await buildApp({ repo, moderators, config: testConfig, now: () => clock, logger: false });
  await app.ready();
  const res = await post('/api/auth/login', { username: MOD_USER, password: MOD_PASS });
  token = res.json().token;
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload: body as object,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const auth = () => ({ authorization: `Bearer ${token}` });

const feed = async (updatedSince?: number) =>
  (
    await app.inject({
      method: 'GET',
      url: `/api/hazards${updatedSince !== undefined ? `?updatedSince=${updatedSince}` : ''}`,
    })
  ).json() as { hazards: Hazard[]; deletedIds?: string[]; serverTime?: number };

/** Submit + approve a report; returns the public hazard id. */
async function approvedReport(clientId: string): Promise<string> {
  const r = await post('/api/reports', report(clientId));
  const id = r.json().hazard.id as string;
  await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
  return id;
}

describe('delta feed: updatedSince cursor', () => {
  it('full fetches carry serverTime — the next poll cursor', async () => {
    await approvedReport('11111111-1111-4111-8111-111111111111');
    const full = await feed();
    expect(full.hazards).toHaveLength(1);
    expect(full.serverTime).toBe(clock);
    expect(full.deletedIds).toBeUndefined(); // full responses have no tombstones
  });

  it('a cursor poll returns only rows changed since the cursor', async () => {
    await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    const idB = await approvedReport('22222222-2222-4222-8222-222222222222');

    const delta = await feed(cursor);
    expect(delta.hazards.map((h) => h.id)).toEqual([idB]); // A is unchanged — not resent
    expect(delta.deletedIds).toEqual([]);
    expect(delta.serverTime).toBe(clock);
  });

  it('an unchanged feed polls down to an empty (tiny) delta', async () => {
    await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += 1000;
    const cursor = (await feed()).serverTime!;
    clock += HOUR;
    const delta = await feed(cursor);
    expect(delta.hazards).toEqual([]);
    expect(delta.deletedIds).toEqual([]);
  });

  it('a confirmation re-sends the changed row', async () => {
    const id = await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    await post(`/api/hazards/${id}/confirm`, {});

    const delta = await feed(cursor);
    expect(delta.hazards.map((h) => h.id)).toEqual([id]);
    expect(delta.hazards[0].confirmations).toBe(1);
  });

  it('a resolved hazard arrives as a changed row (greyed client-side)', async () => {
    const id = await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    await post(`/api/moderation/${id}`, { decision: 'resolve' }, auth());

    const delta = await feed(cursor);
    expect(delta.hazards.map((h) => h.id)).toEqual([id]);
    expect(delta.hazards[0].status).toBe('resolved');
    expect(delta.deletedIds).toEqual([]);
  });
});

describe('delta feed: tombstones', () => {
  it('a reporter deletion surfaces as an id-only tombstone, no content', async () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    const id = await approvedReport(clientId);
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    const del = await app.inject({ method: 'DELETE', url: `/api/reports/${clientId}` });
    expect(del.statusCode).toBe(204);

    const res = await app.inject({ method: 'GET', url: `/api/hazards?updatedSince=${cursor}` });
    const delta = res.json();
    expect(delta.hazards).toEqual([]);
    expect(delta.deletedIds).toEqual([id]);
    // Privacy: the tombstone is the id and nothing else — no report content
    // (description, category, coordinates, clientId) survives deletion.
    expect(res.body).not.toContain('Deep pothole');
    expect(res.body).not.toContain('pothole');
    expect(res.body).not.toContain(clientId);
  });

  it('a TTL expiry is dropped via deletedIds too', async () => {
    const id = await approvedReport('11111111-1111-4111-8111-111111111111');

    // A fresh cursor taken just before the hazard's 30-day TTL runs out…
    clock = T0 + 29 * DAY;
    const cursor = (await feed(clock - 1000)).serverTime!;

    // …then the poll after expiry hears about the transition.
    clock = T0 + 31 * DAY;
    const delta = await feed(cursor);
    expect(delta.hazards).toEqual([]);
    expect(delta.deletedIds).toEqual([id]);
  });

  it('never-public rows leak nothing — not even ids', async () => {
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    // One report left pending, one rejected while pending: neither was ever on
    // the public feed, so the delta must not acknowledge their existence.
    await post('/api/reports', report('33333333-3333-4333-8333-333333333333'));
    const r = await post('/api/reports', report('44444444-4444-4444-8444-444444444444'));
    await post(`/api/moderation/${r.json().hazard.id}`, { decision: 'reject' }, auth());

    const delta = await feed(cursor);
    expect(delta.hazards).toEqual([]);
    expect(delta.deletedIds).toEqual([]);
  });

  it('rejecting a previously approved hazard un-publishes it via deletedIds', async () => {
    const id = await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += 1000;
    const cursor = (await feed()).serverTime!;

    clock += HOUR;
    await post(`/api/moderation/${id}`, { decision: 'reject' }, auth());

    const delta = await feed(cursor);
    expect(delta.hazards).toEqual([]);
    expect(delta.deletedIds).toEqual([id]);
  });

  it('tombstones older than the retention window are pruned by expire()', async () => {
    const clientId = '11111111-1111-4111-8111-111111111111';
    await approvedReport(clientId);
    clock += 1000;
    await app.inject({ method: 'DELETE', url: `/api/reports/${clientId}` });
    expect(await repo.listTombstones(0)).toHaveLength(1);

    await repo.expire(clock + 31 * DAY); // past TOMBSTONE_TTL_MS (30 days)
    expect(await repo.listTombstones(0)).toHaveLength(0);
  });
});

describe('delta feed: stale cursors fall back to the full feed', () => {
  it('a cursor older than the retained history returns the full feed (no deletedIds)', async () => {
    await approvedReport('11111111-1111-4111-8111-111111111111');
    clock += HOUR;

    const res = await feed(clock - 8 * DAY); // beyond resolvedVisibleDays (7)
    expect(res.hazards).toHaveLength(1); // everything, not a delta
    expect(res.deletedIds).toBeUndefined(); // client treats this as a full refresh
    expect(res.serverTime).toBe(clock); // and can re-establish its cursor
  });
});

describe('client merge (useHazards.mergeDelta)', () => {
  const h = (id: string, over: Partial<Hazard> = {}): Hazard =>
    ({ id, updatedAt: 1, ...over }) as Hazard;

  it('upserts changed rows by id and drops tombstoned ids', () => {
    const prev = [h('a'), h('b'), h('c')];
    const merged = mergeDelta(prev, [h('b', { updatedAt: 2 }), h('d')], ['c', 'unknown']);
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b', 'd']);
    expect(merged.find((x) => x.id === 'b')?.updatedAt).toBe(2);
  });
});
