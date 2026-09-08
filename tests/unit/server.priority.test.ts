/**
 * The prioritisation export's ROUTES (issue #179).
 *
 * `tests/unit/priority.test.ts` covers the row-building. This covers the three
 * things only the wired route can be wrong about: that precise coordinates are
 * behind the moderator gate, that the public export is untouched by any of
 * this, and that a download is recorded as an audit event.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import type { StoredHazard } from '../../server/lib/types.ts';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

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
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000, confirmationsPerHour: 10_000 },
  ttlDays: { low: 14, moderate: 21, high: 30 },
} as typeof serverConfig;

const PRECISE = { lat: 38.5449, lng: -121.7405 };
const FUZZED = { lat: 38.545, lng: -121.74 };

let app: FastifyInstance;
let repo: MemoryRepository;
let token: string;
/** Structured log records this app instance emitted. */
let logged: Record<string, unknown>[];

function stored(id: string, confirmations: number): StoredHazard {
  return {
    id,
    clientId: `client-${id}`,
    category: 'pothole',
    severity: 'high',
    description: 'Deep pothole in the bike lane',
    preciseLocation: PRECISE,
    publicLocation: FUZZED,
    photo: null,
    status: 'approved',
    confirmations,
    createdAt: NOW - 5 * DAY,
    updatedAt: NOW - DAY,
    expiresAt: NOW + 20 * DAY,
    resolvedAt: null,
    handoff: null,
    handoffDelivery: null,
    osmNote: null,
    moderation: [],
    source: 'report',
  };
}

beforeEach(async () => {
  repo = new MemoryRepository();
  logged = [];
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: NOW,
    tokenVersion: 0,
  });
  app = await buildApp({
    repo,
    moderators,
    config: testConfig,
    now: () => NOW,
    // A stream logger, so the audit record can be read back as data rather
    // than asserted through a spy on a method the route might not use.
    logger: {
      level: 'info',
      stream: {
        write: (line: string) => {
          logged.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MOD_USER, password: MOD_PASS },
  });
  token = login.json().token;
  await repo.insert(stored('confirmed-1', 2));
  await repo.insert(stored('reported-only', 0));
});

const auth = () => ({ authorization: `Bearer ${token}` });

describe('GET /api/moderation/priority.csv', () => {
  it('refuses an unauthenticated request', async () => {
    for (const url of ['/api/moderation/priority.csv', '/api/moderation/priority.geojson']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      // The refusal body must not leak a coordinate.
      expect(res.body).not.toContain('38.5449');
    }
  });

  it('serves the confirmed set with precise coordinates to a moderator', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/priority.csv',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['cache-control']).toBe('no-store');
    const rows = res.body.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('rank,'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('confirmed-1');
    expect(rows[0]).toContain('38.5449');
    // The preamble mentions the words "reported-only"; assert on the DATA rows.
    expect(rows.join('\n')).not.toContain('reported-only');
  });

  it('serves the same rows as GeoJSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/priority.geojson',
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1);
    expect(body.features[0].properties.hazard_id).toBe('confirmed-1');
    expect(body.features[0].geometry.coordinates).toEqual([PRECISE.lng, PRECISE.lat]);
  });

  it('leaves the public export fuzzed and free of the precise coordinate', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hazards/export' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('38.5449');
    expect(res.body).not.toContain('-121.7405');
    const body = JSON.parse(res.body);
    expect(body.features[0].geometry.coordinates).toEqual([FUZZED.lng, FUZZED.lat]);
  });

  it('records the download as an audit event naming the moderator', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/moderation/priority.csv',
      headers: auth(),
    });
    const audit = logged.filter((entry) => entry.event === 'priority_export');
    expect(audit).toHaveLength(1);
    expect(audit[0].by).toBe(MOD_USER);
    expect(audit[0].format).toBe('csv');
    expect(audit[0].rows).toBe(1);
    // The audit line itself must not become a second copy of the data.
    expect(JSON.stringify(audit[0])).not.toContain('38.5449');
  });

  it('is documented in the generated OpenAPI spec', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/api/openapi.json' })).json();
    expect(spec.paths['/moderation/priority.csv']).toBeDefined();
    expect(spec.paths['/moderation/priority.geojson']).toBeDefined();
    expect(spec.paths['/moderation/priority.csv'].get.responses['401']).toBeDefined();
  });
});
