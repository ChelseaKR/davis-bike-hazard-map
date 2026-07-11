/**
 * OpenAPI contract test.
 *
 * The spec served at /api/openapi.json is GENERATED from the same zod schemas
 * the routes validate with (server/lib/openapi-registry.ts), so schema drift
 * is impossible by construction. This suite pins the two drift axes that
 * remain:
 *
 *  (a) route coverage — the set of /api routes buildApp actually mounts must
 *      equal the set of paths the spec documents (both directions: deleting a
 *      route or registering one without documenting it fails CI);
 *  (b) live responses — a golden set of endpoints is injected and each JSON
 *      body must parse against the exact response schema the spec was
 *      generated from.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { openapiSpec } from '../../server/openapi.ts';
import {
  healthResponseSchema,
  readyResponseSchema,
  hazardFeedResponseSchema,
  hazardResponseSchema,
  hazardExportSchema,
  sessionResponseSchema,
} from '../../server/lib/openapi-registry.ts';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';

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
let token: string;

const report = (clientId: string) => ({
  category: 'pothole',
  severity: 'high',
  description: 'Deep pothole in the bike lane',
  location: { lat: 38.5449, lng: -121.7405 },
  photo: null,
  clientId,
  capturedAt: 1_699_000_000_000,
});

beforeAll(async () => {
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: Date.now(),
    tokenVersion: 0,
  });
  app = await buildApp({
    repo: new MemoryRepository(),
    moderators,
    config: testConfig,
    logger: false,
  });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MOD_USER, password: MOD_PASS },
  });
  token = sessionResponseSchema.parse(login.json()).token;

  // Seed one approved hazard so the feed/export goldens exercise the Hazard
  // schema against real values, not just empty arrays.
  const created = await app.inject({
    method: 'POST',
    url: '/api/reports',
    payload: report('11111111-1111-4111-8111-111111111111'),
  });
  const { hazard } = hazardResponseSchema.parse(created.json());
  await app.inject({
    method: 'POST',
    url: `/api/moderation/${hazard.id}`,
    payload: { decision: 'approve' },
    headers: { authorization: `Bearer ${token}` },
  });
});

afterAll(async () => {
  await app.close();
});

/** Methods the contract covers (HEAD/OPTIONS are Fastify implementation detail). */
const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);

/** Spec paths, normalized to Fastify route patterns under the /api server URL. */
function specRoutes(): Set<string> {
  const out = new Set<string>();
  for (const [path, ops] of Object.entries(openapiSpec.paths ?? {})) {
    for (const method of Object.keys(ops ?? {})) {
      if (!METHODS.has(method)) continue;
      out.add(`${method.toUpperCase()} /api${path.replace(/\{([^}]+)\}/g, ':$1')}`);
    }
  }
  return out;
}

/**
 * The routes the app actually mounts, from `printRoutes` (find-my-way's
 * pretty tree). Child lines hold path *suffixes*, so full paths are
 * reassembled from the indentation depth. Filtered to /api/* — the ops-only
 * probes outside /api (/livez, /readyz) are deliberately not part of the
 * public contract.
 */
function liveRoutes(instance: FastifyInstance): Set<string> {
  const stack: string[] = [];
  const out = new Set<string>();
  for (const line of instance.printRoutes({ commonPrefix: false }).split('\n')) {
    const m = /^((?:[│ ] {3})*)[├└]── (\S+)(?: \(([A-Z, ]+)\))?/.exec(line);
    if (!m) continue;
    const depth = m[1].length / 4;
    const full = (depth === 0 ? '' : stack[depth - 1]) + m[2];
    stack[depth] = full;
    stack.length = depth + 1;
    for (const method of (m[3] ?? '').split(', ')) {
      if (!method || method === 'HEAD' || method === 'OPTIONS') continue;
      if (!full.startsWith('/api/')) continue;
      out.add(`${method} ${full}`);
    }
  }
  return out;
}

describe('OpenAPI contract: route coverage', () => {
  it('parses the live route table (sanity)', () => {
    const live = liveRoutes(app);
    expect(live.size).toBeGreaterThan(0);
    expect(live).toContain('GET /api/hazards');
    // Every parsed pattern must resolve in the real router — guards the
    // printRoutes parsing against find-my-way output-format changes.
    for (const entry of live) {
      const [method, url] = entry.split(' ');
      expect(
        app.hasRoute({ method: method as HTTPMethods, url }),
        `parsed route does not exist: ${entry}`,
      ).toBe(true);
    }
  });

  it('documents exactly the routes the server mounts (no drift either way)', () => {
    expect([...liveRoutes(app)].sort()).toEqual([...specRoutes()].sort());
  });
});

describe('OpenAPI contract: golden responses parse against the spec schemas', () => {
  it('GET /api/openapi.json serves the generated document', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec).toEqual(JSON.parse(JSON.stringify(openapiSpec)));
    // The /api/v1 alias must stay declared: app.ts rewrites /api/v1/* → /api/*.
    expect(spec.servers.map((s: { url: string }) => s.url)).toEqual(['/api', '/api/v1']);
  });

  it('GET /api/health matches its response schema (and via the /api/v1 alias)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    healthResponseSchema.parse(res.json());

    const aliased = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(aliased.statusCode).toBe(200);
    healthResponseSchema.parse(aliased.json());
  });

  it('GET /api/ready matches its response schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    readyResponseSchema.parse(res.json());
  });

  it('GET /api/hazards matches the Hazard feed schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(res.statusCode).toBe(200);
    const feed = hazardFeedResponseSchema.parse(res.json());
    expect(feed.hazards.length).toBeGreaterThan(0); // seeded — schema was exercised
  });

  it('GET /api/hazards/export matches the GeoJSON export schema', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/hazards/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/geo+json');
    const collection = hazardExportSchema.parse(res.json());
    expect(collection.features.length).toBeGreaterThan(0);
  });
});
