/**
 * Delta feed for the 30s mobile poll (FIX-05).
 *
 * Exercises GET /api/hazards?updatedSince=<cursor> end-to-end via app.inject()
 * against the in-memory store: a cursor returns only changed rows, deletions
 * surface as id-only tombstones (no content), and an over-old cursor falls back
 * to the full feed (no deletedIds ⇒ the client fully refreshes).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const NOW = 1_700_000_000_000;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
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

function storedHazard(id: string, over: Partial<StoredHazard> = {}): StoredHazard {
  return {
    id,
    clientId: `cid-${id}`,
    category: 'pothole',
    severity: 'high',
    description: null,
    preciseLocation: { lat: 38.5449, lng: -121.7405 },
    publicLocation: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW - DAY,
    updatedAt: NOW - 10 * MIN,
    expiresAt: NOW + DAY,
    resolvedAt: null,
    handoff: null,
    moderation: [],
    ...over,
  };
}

async function getFeed(query: string) {
  const res = await app.inject({ method: 'GET', url: `/api/hazards${query}` });
  return res.json() as { hazards: { id: string }[]; deletedIds?: string[]; serverTime?: number };
}

beforeEach(async () => {
  repo = new MemoryRepository();
  app = await buildApp({ repo, config: testConfig, now: () => NOW, logger: false });
  await app.ready();
});

describe('GET /api/hazards delta feed', () => {
  it('full fetch (no cursor) returns every active hazard plus a serverTime cursor', async () => {
    await repo.insert(storedHazard('a'));
    await repo.insert(storedHazard('b'));

    const feed = await getFeed('');
    expect(feed.hazards.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(feed.serverTime).toBe(NOW);
    // Full feed carries no tombstones — the client treats it as a full refresh.
    expect(feed.deletedIds).toBeUndefined();
  });

  it('returns only rows changed since the cursor', async () => {
    await repo.insert(storedHazard('old', { updatedAt: NOW - 20 * MIN }));
    await repo.insert(storedHazard('new', { updatedAt: NOW - 1 * MIN }));

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);
    expect(feed.hazards.map((h) => h.id)).toEqual(['new']);
    expect(feed.deletedIds).toEqual([]);
    expect(feed.serverTime).toBe(NOW);
  });

  it('surfaces a deletion as an id-only tombstone (no content)', async () => {
    await repo.insert(storedHazard('keep', { updatedAt: NOW - 1 * MIN }));
    await repo.insert(storedHazard('gone', { updatedAt: NOW - 20 * MIN }));

    const del = await app.inject({ method: 'DELETE', url: '/api/reports/cid-gone' });
    expect(del.statusCode).toBe(204);

    const feed = await getFeed(`?updatedSince=${NOW - 5 * MIN}`);
    // The removed id is reported as a bare string — never as a hazard object.
    expect(feed.deletedIds).toContain('gone');
    expect(feed.deletedIds!.every((id) => typeof id === 'string')).toBe(true);
    expect(feed.hazards.some((h) => h.id === 'gone')).toBe(false);
  });

  it('ignores an over-old cursor and returns the full feed (no deletedIds)', async () => {
    await repo.insert(storedHazard('a'));
    await repo.insert(storedHazard('b'));

    const feed = await getFeed(`?updatedSince=${NOW - 40 * DAY}`);
    expect(feed.hazards.map((h) => h.id).sort()).toEqual(['a', 'b']);
    expect(feed.deletedIds).toBeUndefined();
    expect(feed.serverTime).toBe(NOW);
  });
});
