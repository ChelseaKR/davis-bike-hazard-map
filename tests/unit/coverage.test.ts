/**
 * GET /api/coverage — reports RECEIVED per Davis area.
 *
 * The coverage view's whole job is to stop "no reports here" being read as
 * "this area is safe" (docs/audits/coverage-equity.md). That only works if the
 * set it counts is *reports received*. Counted over the public feed instead —
 * approved-and-unexpired plus recently-resolved — an area whose reports are all
 * awaiting moderation, or have since expired, reads as zero and gets labelled a
 * data desert: the exact inversion of the truth, printed in the one surface
 * built to prevent it. These tests pin the set.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { areaNameFor, DAVIS_AREAS } from '../../shared/areas.ts';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';

// Two points that land in different named areas, so a report in one can never
// be mistaken for coverage of the other.
const CENTRAL = { lat: 38.5449, lng: -121.7405 };
const NORTH = { lat: 38.57, lng: -121.74 };

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  sessionSecret: 'test-session-secret',
  sessionTtlMs: 12 * 60 * 60 * 1000,
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

let app: FastifyInstance;
let repo: MemoryRepository;
let token: string;

const report = (clientId: string, location: { lat: number; lng: number }) => ({
  category: 'pothole',
  severity: 'high',
  description: 'Deep pothole in the bike lane',
  location,
  photo: null,
  clientId,
  capturedAt: 1_699_000_000_000,
});

async function submit(clientId: string, location: { lat: number; lng: number }): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/reports',
    payload: report(clientId, location),
    headers: { 'content-type': 'application/json' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().hazard.id;
}

async function moderate(id: string, decision: 'approve' | 'reject'): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/moderation/${id}`,
    payload: { decision },
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  });
  expect(res.statusCode).toBe(200);
}

/** The coverage count for a named area, from the live endpoint. */
async function coverageFor(area: string): Promise<number> {
  const res = await app.inject({ method: 'GET', url: '/api/coverage' });
  expect(res.statusCode).toBe(200);
  const areas = res.json().areas as { name: string; count: number }[];
  const row = areas.find((a) => a.name === area);
  expect(row, `no coverage row for ${area}`).toBeDefined();
  return row!.count;
}

/** How many feed hazards land in a named area — what the view used to count. */
async function feedCountFor(area: string): Promise<number> {
  const res = await app.inject({ method: 'GET', url: '/api/hazards' });
  expect(res.statusCode).toBe(200);
  const hazards = res.json().hazards as { location: { lat: number; lng: number } }[];
  return hazards.filter((h) => areaNameFor(h.location) === area).length;
}

beforeEach(async () => {
  repo = new MemoryRepository();
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: 0,
    tokenVersion: 0,
  });
  app = await buildApp({ config: testConfig, repo, moderators, logger: false });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MOD_USER, password: MOD_PASS },
    headers: { 'content-type': 'application/json' },
  });
  token = login.json().token;
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/coverage', () => {
  it('lists every named area, so a zero-report area is visible rather than absent', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/coverage' });
    expect(res.statusCode).toBe(200);
    const names = (res.json().areas as { name: string }[]).map((a) => a.name);
    for (const area of DAVIS_AREAS) expect(names).toContain(area.name);
  });

  it('counts a report that is still awaiting moderation — the feed does not', async () => {
    await submit('11111111-1111-4111-8111-111111111111', NORTH);

    // The public feed cannot see a pending report, by design (moderation gate).
    expect(await feedCountFor('North Davis')).toBe(0);
    // Coverage must, or North Davis is labelled a data desert while a rider is
    // waiting on the very report that proves it is not one.
    expect(await coverageFor('North Davis')).toBe(1);
  });

  it('keeps counting a report after it expires off the map', async () => {
    const id = await submit('22222222-2222-4222-8222-222222222222', NORTH);
    await moderate(id, 'approve');
    expect(await feedCountFor('North Davis')).toBe(1);

    // Age it past its TTL; the next feed read expires it.
    await repo.update(id, { expiresAt: 1 });
    expect(await feedCountFor('North Davis')).toBe(0);

    // Someone rode there and reported. That does not stop being true.
    expect(await coverageFor('North Davis')).toBe(1);
  });

  it('does not count a rejected report, so spam cannot manufacture coverage', async () => {
    const id = await submit('33333333-3333-4333-8333-333333333333', NORTH);
    await moderate(id, 'reject');
    expect(await coverageFor('North Davis')).toBe(0);
  });

  it('counts each area separately', async () => {
    await submit('44444444-4444-4444-8444-444444444444', CENTRAL);
    await submit('55555555-5555-4555-8555-555555555555', CENTRAL);
    await submit('66666666-6666-4666-8666-666666666666', NORTH);
    expect(await coverageFor('Central Davis')).toBe(2);
    expect(await coverageFor('North Davis')).toBe(1);
    expect(await coverageFor('South Davis')).toBe(0);
  });

  it('discloses counts only — no ids, statuses, timestamps or coordinates', async () => {
    await submit('77777777-7777-4777-8777-777777777777', CENTRAL);
    const areas = (await app.inject({ method: 'GET', url: '/api/coverage' })).json().areas as
      Record<string, unknown>[];
    for (const row of areas) expect(Object.keys(row).sort()).toEqual(['count', 'name']);
  });

  it('serves a 304 to a repeat poll with the matching ETag', async () => {
    const first = await app.inject({ method: 'GET', url: '/api/coverage' });
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const second = await app.inject({
      method: 'GET',
      url: '/api/coverage',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
  });
});
