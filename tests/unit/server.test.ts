import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { PushSubscriptionGoneError } from '../../server/lib/pushNotify.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { signWebhookBody } from '../../server/lib/webhookAuth.ts';
import { bytesToDataUrl, hasExif } from '../../shared/exif.ts';
import sharp from 'sharp';

const MOD_USER = 'mod';
const MOD_PASS = 'correct horse battery staple';
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
  // Empty routing backend ⇒ the planner serves a deterministic straight-line
  // fallback (no network) in tests.
  routingUrl: '',
  resolvedVisibleDays: 7,
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
  ttlDays: { low: 14, moderate: 21, high: 30 },
} as typeof serverConfig;

let clock = 1_700_000_000_000;
let app: FastifyInstance;
let repo: MemoryRepository;
// A session bearer token for the seeded moderator, refreshed each test.
let token: string;

// A real, decodable image as a data URL (the server now re-encodes via sharp,
// so fixtures must be genuine images, not hand-crafted byte sequences).
async function realPhoto(format: 'jpeg' | 'png' = 'jpeg'): Promise<string> {
  // Larger than the thumbnail edge so the full vs. thumb variants differ.
  const img = sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 40, b: 40 } },
  });
  const buf = await (format === 'png' ? img.png() : img.jpeg()).toBuffer();
  return `data:image/${format};base64,${buf.toString('base64')}`;
}

const baseReport = {
  category: 'pothole',
  severity: 'high',
  description: 'Deep pothole in the bike lane',
  location: { lat: 38.5449, lng: -121.7405 },
  photo: null as string | null,
  clientId: '11111111-1111-4111-8111-111111111111',
  capturedAt: 1_699_000_000_000,
};

beforeEach(async () => {
  clock = 1_700_000_000_000;
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

/** Build a second app (custom config / fetch / deps) with a logged-in moderator. */
async function buildAppWithModerator(
  config: typeof serverConfig,
  fetchImpl?: typeof fetch,
  extraDeps: Partial<AppDeps> = {},
): Promise<{ app: FastifyInstance; token: string; repo: MemoryRepository }> {
  const r = new MemoryRepository();
  const moderators = new MemoryModeratorStore();
  await moderators.upsert({
    username: MOD_USER,
    passwordHash: await hashPassword(MOD_PASS),
    createdAt: clock,
    tokenVersion: 0,
  });
  const a = await buildApp({
    repo: r,
    moderators,
    config,
    now: () => clock,
    fetchImpl,
    logger: false,
    ...extraDeps,
  });
  await a.ready();
  const login = await a.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: MOD_USER, password: MOD_PASS },
    headers: { 'content-type': 'application/json' },
  });
  return { app: a, token: login.json().token, repo: r };
}

describe('health', () => {
  it('reports ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('readiness reports ready when the store pings', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ready');
  });

  it('readiness returns 503 when the store is down', async () => {
    // Minimal stub — the readiness route only calls repo.ping().
    const down = await buildApp({
      repo: { ping: async () => false } as unknown as typeof repo,
      config: testConfig,
      now: () => clock,
      logger: false,
    });
    const res = await down.inject({ method: 'GET', url: '/api/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('not_ready');
  });

  it('echoes a correlation request id + api version on responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'corr-123' },
    });
    expect(res.headers['x-request-id']).toBe('corr-123');
    expect(res.headers['x-api-version']).toBe('1');
  });

  it('serves an OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths['/hazards']).toBeDefined();
    expect(spec.paths['/auth/login']).toBeDefined();
  });

  it('serves the /api/v1 alias for the same handlers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

describe('metrics', () => {
  it('exposes moderation backlog gauges in Prometheus format', async () => {
    await post('/api/reports', baseReport);
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('dbhm_moderation_queue_depth 1');
    expect(res.body).toMatch(/dbhm_oldest_pending_age_seconds \d+/);
  });

  it('reports a zero backlog when the queue is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.body).toContain('dbhm_moderation_queue_depth 0');
    expect(res.body).toContain('dbhm_oldest_pending_age_seconds 0');
  });

  it('includes RED request-duration + Node default metrics', async () => {
    await app.inject({ method: 'GET', url: '/api/health' }); // generate one observation
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.body).toContain('http_request_duration_seconds');
    expect(res.body).toMatch(/process_cpu_seconds_total|nodejs_/);
  });
});

describe('client error sink', () => {
  it('accepts a valid client error report with 204 and no body', async () => {
    const res = await post('/api/client-errors', {
      message: 'boom',
      stack: 'Error: boom\n  at x',
      source: 'window.onerror',
      path: '/',
      at: 1_700_000_000_000,
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
  });

  it('rejects an empty message', async () => {
    const res = await post('/api/client-errors', { message: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('requires no auth (it is best-effort public telemetry)', async () => {
    const res = await post('/api/client-errors', { message: 'anon error' });
    expect(res.statusCode).toBe(204);
  });
});

describe('public feed: bbox + conditional requests', () => {
  async function approveOne() {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    return id;
  }

  it('culls hazards outside the bbox', async () => {
    await approveOne();
    // A box around Davis includes it...
    const inBox = await app.inject({
      method: 'GET',
      url: '/api/hazards?bbox=38.52,-121.82,38.59,-121.68',
    });
    expect(inBox.json().hazards).toHaveLength(1);
    // ...a box over the Sierra does not.
    const outBox = await app.inject({
      method: 'GET',
      url: '/api/hazards?bbox=40.0,-120.0,40.1,-119.9',
    });
    expect(outBox.json().hazards).toHaveLength(0);
  });

  it('serves an ETag and answers a matching If-None-Match with 304', async () => {
    await approveOne();
    const first = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: 'GET',
      url: '/api/hazards',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
  });
});

describe('report intake and moderation gate', () => {
  it('accepts a report but keeps it out of the public feed until approved', async () => {
    const res = await post('/api/reports', baseReport);
    expect(res.statusCode).toBe(201);
    expect(res.json().hazard.status).toBe('pending');

    const pub = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(pub.json().hazards).toHaveLength(0);
  });

  it('fuzzes the public location (never exposes the precise point)', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });

    const pub = await app.inject({ method: 'GET', url: '/api/hazards' });
    const hazard = pub.json().hazards[0];
    expect(hazard.location).not.toEqual(baseReport.location);
    expect(hazard.status).toBe('approved');
  });

  it('rejects an invalid submission with 400', async () => {
    const res = await post('/api/reports', {
      ...baseReport,
      location: { lat: 38.58, lng: -121.49 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('is idempotent on clientId', async () => {
    const a = await post('/api/reports', baseReport);
    const b = await post('/api/reports', baseReport);
    expect(a.json().hazard.id).toBe(b.json().hazard.id);
    expect(await repo.all()).toHaveLength(1);
  });
});

describe('moderation auth', () => {
  it('refuses the queue without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/moderation/queue' });
    expect(res.statusCode).toBe(401);
  });

  it('refuses the queue with a wrong token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: 'Bearer nope' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lists pending reports for a valid moderator', async () => {
    await post('/api/reports', baseReport);
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hazards).toHaveLength(1);
  });
});

describe('moderation queue pagination (FIX-04)', () => {
  /** File `n` pending reports, one minute apart. */
  async function seedPending(n: number) {
    for (let i = 0; i < n; i++) {
      await post('/api/reports', {
        ...baseReport,
        clientId: `22222222-2222-4222-8222-2222222222${String(i).padStart(2, '0')}`,
      });
      clock += 60_000;
    }
  }

  it('serves bounded keyset pages, oldest first, with a stable total', async () => {
    await seedPending(5);
    const q = (qs: string) =>
      app.inject({
        method: 'GET',
        url: `/api/moderation/queue${qs}`,
        headers: { authorization: `Bearer ${token}` },
      });

    const page1 = (await q('?limit=2')).json();
    expect(page1.hazards).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.nextCursor).toEqual(expect.any(String));
    expect(page1.hazards[0].createdAt).toBeLessThan(page1.hazards[1].createdAt);

    const page2 = (await q(`?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`)).json();
    const page3 = (await q(`?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`)).json();
    expect(page3.hazards).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    // The pages tile the queue exactly — no overlap, nothing skipped.
    const ids = [...page1.hazards, ...page2.hazards, ...page3.hazards].map(
      (h: { id: string }) => h.id,
    );
    expect(new Set(ids).size).toBe(5);
  });

  it('keeps the response size independent of queue depth (the default limit)', async () => {
    await seedPending(25);
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().hazards).toHaveLength(20); // default limit
    expect(res.json().total).toBe(25);
  });

  it('rejects a malformed cursor and an out-of-range limit (400)', async () => {
    const bad = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue?cursor=garbage',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(bad.statusCode).toBe(400);
    const big = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue?limit=101',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(big.statusCode).toBe(400);
  });
});

describe('moderator accounts', () => {
  it('issues a session on correct credentials', async () => {
    const res = await post('/api/auth/login', { username: MOD_USER, password: MOD_PASS });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe(MOD_USER);
    expect(typeof body.token).toBe('string');
    expect(body.expiresAt).toBeGreaterThan(clock);
  });

  it('rejects a wrong password and an unknown user the same way (401)', async () => {
    const wrong = await post('/api/auth/login', { username: MOD_USER, password: 'nope' });
    const unknown = await post('/api/auth/login', { username: 'ghost', password: 'whatever' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error).toBe('invalid_credentials');
  });

  it('records the acting moderator in the audit trail', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve', reason: 'clear' }, { authorization: `Bearer ${token}` });
    const stored = (await repo.findById(id))!;
    expect(stored.moderation.at(-1)).toMatchObject({ decision: 'approve', by: MOD_USER });
  });

  it('rejects an expired session token', async () => {
    const { issueToken } = await import('../../server/lib/token.ts');
    const expired = issueToken(MOD_USER, testConfig.sessionSecret, 1000, clock - 1_000_000);
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refreshes a valid session into a new token', async () => {
    const res = await post('/api/auth/refresh', {}, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(MOD_USER);
    expect(typeof res.json().token).toBe('string');
  });

  it('revoke invalidates every previously issued session', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const revoke = await post('/api/auth/revoke', {}, { authorization: `Bearer ${token}` });
    expect(revoke.json().revoked).toBe(true);

    const after = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it('locks an account after repeated failed logins (429)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post('/api/auth/login', { username: MOD_USER, password: 'wrong' });
      expect(r.statusCode).toBe(401);
    }
    const locked = await post('/api/auth/login', { username: MOD_USER, password: 'wrong' });
    expect(locked.statusCode).toBe(429);
    // The correct password is also refused while locked.
    const stillLocked = await post('/api/auth/login', { username: MOD_USER, password: MOD_PASS });
    expect(stillLocked.statusCode).toBe(429);
  });
});

describe('photo privacy', () => {
  it('re-encodes the photo (EXIF-clean) and gates it behind approval', async () => {
    const res = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = res.json().hazard.id;

    // Photo is not publicly servable while pending.
    const pending = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(pending.statusCode).toBe(404);

    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });

    const ok = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('image/jpeg');
    // The served photo is a valid, metadata-free JPEG (server re-encode).
    const meta = await sharp(ok.rawPayload).metadata();
    expect(meta.format).toBe('jpeg');
    expect(hasExif(new Uint8Array(ok.rawPayload))).toBe(false);
  });

  it('serves a smaller thumbnail variant via ?size=thumb', async () => {
    const res = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });

    const full = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    const thumb = await app.inject({ method: 'GET', url: `/api/photos/${id}?size=thumb` });
    expect(thumb.statusCode).toBe(200);
    const thumbMeta = await sharp(thumb.rawPayload).metadata();
    expect(thumbMeta.width).toBeLessThanOrEqual(320);
    // A different (smaller) byte stream than the full image.
    expect(thumb.rawPayload.length).not.toBe(full.rawPayload.length);
  });

  it('normalizes other formats (PNG) to JPEG on intake', async () => {
    const res = await post('/api/reports', { ...baseReport, photo: await realPhoto('png') });
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    const ok = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect((await sharp(ok.rawPayload).metadata()).format).toBe('jpeg');
  });

  it('drops an undecodable "image" rather than storing junk', async () => {
    const junk = bytesToDataUrl(Uint8Array.from([0xff, 0xd8, 0x00, 0x01, 0x02]), 'image/jpeg');
    const res = await post('/api/reports', { ...baseReport, photo: junk });
    const stored = (await repo.findById(res.json().hazard.id))!;
    expect(stored.photo).toBeNull();
  });

  it('references (never inlines) the photo in the moderation queue (FIX-04)', async () => {
    const created = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = created.json().hazard.id;
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().hazards[0].photoUrl).toBe(`/api/photos/${id}`);
    // The queue payload carries no photo bytes at all.
    expect(res.body).not.toContain('base64');
  });

  it('streams a PENDING photo to an authenticated moderator only (FIX-04)', async () => {
    const created = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = created.json().hazard.id;

    // Public request: 404 — a pending photo's existence is not confirmed.
    const anon = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(anon.statusCode).toBe(404);
    const badToken = await app.inject({
      method: 'GET',
      url: `/api/photos/${id}`,
      headers: { authorization: 'Bearer nope' },
    });
    expect(badToken.statusCode).toBe(404);

    // Moderator request: the bytes stream, privately (no shared caching).
    const mod = await app.inject({
      method: 'GET',
      url: `/api/photos/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(mod.statusCode).toBe(200);
    expect(mod.headers['content-type']).toContain('image/jpeg');
    expect(mod.headers['cache-control']).toBe('private, no-store');
    expect(hasExif(new Uint8Array(mod.rawPayload))).toBe(false);

    // A rejected hazard's photo is served to no one, moderator included.
    await post(`/api/moderation/${id}`, { decision: 'reject' }, { authorization: `Bearer ${token}` });
    const afterReject = await app.inject({
      method: 'GET',
      url: `/api/photos/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterReject.statusCode).toBe(404);
  });

  it('keeps approved photos public and shared-cacheable (unchanged)', async () => {
    const created = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = created.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    const anon = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('keeps photo bytes OUT of the persisted record (only a { mime } ref)', async () => {
    const res = await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const id = res.json().hazard.id;
    const stored = (await repo.findById(id))!;
    expect(stored.photo).toEqual({ mime: 'image/jpeg' });
    expect(JSON.stringify(stored)).not.toContain('base64');
    expect(stored.publicLocation).not.toEqual(stored.preciseLocation);
  });
});

describe('lifecycle', () => {
  it('confirms an approved hazard and increments the count', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });

    const conf = await post(`/api/hazards/${id}/confirm`, {});
    expect(conf.statusCode).toBe(200);
    expect(conf.json().hazard.confirmations).toBe(1);
  });

  it('404s confirming an unknown or unapproved hazard', async () => {
    const res = await post('/api/reports', baseReport); // still pending
    const id = res.json().hazard.id;
    expect((await post(`/api/hazards/${id}/confirm`, {})).statusCode).toBe(404);
    expect((await post(`/api/hazards/does-not-exist/confirm`, {})).statusCode).toBe(404);
  });

  it('rejected reports never become public', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'reject' }, { authorization: `Bearer ${token}` });
    const pub = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(pub.json().hazards).toHaveLength(0);
  });

  it('expires approved hazards past their TTL', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });

    expect((await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards).toHaveLength(1);
    clock += 31 * DAY; // past the high-severity TTL
    expect((await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards).toHaveLength(0);
    expect((await repo.findById(id))?.status).toBe('expired');
  });
});

describe('filters', () => {
  it('filters the public feed by category and severity', async () => {
    const approve = async (clientId: string, over: Record<string, unknown>) => {
      const r = await post('/api/reports', { ...baseReport, clientId, ...over });
      const id = r.json().hazard.id;
      await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    };
    await approve('11111111-1111-4111-8111-111111111111', { category: 'pothole', severity: 'high' });
    await approve('22222222-2222-4222-8222-222222222222', {
      category: 'glass_debris',
      severity: 'low',
      location: { lat: 38.5431, lng: -121.7649 },
    });

    const byCat = await app.inject({ method: 'GET', url: '/api/hazards?categories=glass_debris' });
    expect(byCat.json().hazards).toHaveLength(1);
    expect(byCat.json().hazards[0].category).toBe('glass_debris');

    const bySev = await app.inject({ method: 'GET', url: '/api/hazards?minSeverity=high' });
    expect(bySev.json().hazards).toHaveLength(1);
    expect(bySev.json().hazards[0].severity).toBe('high');
  });
});

describe('311 hand-off', () => {
  it('runs in dry-run when no webhook is configured', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    const handoff = await post(
      `/api/moderation/${id}/handoff`,
      {},
      { authorization: `Bearer ${token}` },
    );
    expect(handoff.statusCode).toBe(200);
    const result = handoff.json().result;
    expect(result.dryRun).toBe(true);
    expect(result.payload.reference).toBe(id);
    // Hand-off carries the precise location (opt-in), not the fuzzed one.
    expect(result.payload.location).toEqual(baseReport.location);
  });

  it('requires moderator auth for hand-off', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    const handoff = await post(`/api/moderation/${id}/handoff`, {});
    expect(handoff.statusCode).toBe(401);
  });

  it('records a dry-run delivery receipt (submitted intent, nothing to retry)', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}/handoff`, {}, auth());
    const stored = (await repo.findById(id))!;
    expect(stored.handoffDelivery).toMatchObject({
      state: 'submitted',
      dryRun: true,
      attempts: 1,
      nextRetryAt: null,
      lastError: null,
    });
  });
});

describe('311 hand-off delivery receipts + retry (R3)', () => {
  const liveGogovConfig = {
    ...testConfig,
    gogovWebhookUrl: 'https://gogov.example/webhook',
  } as typeof serverConfig;

  const failFetch = (async () => ({ ok: false, status: 502 })) as unknown as typeof fetch;
  const okFetch = (async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;

  it('schedules a retry and counts the failure metric when the transport fails', async () => {
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(liveGogovConfig, failFetch);
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });

    const stored = (await r.findById(id))!;
    expect(stored.handoffDelivery).toMatchObject({
      state: 'retrying',
      dryRun: false,
      attempts: 1,
      lastError: '311 responded 502',
    });
    expect(stored.handoffDelivery!.nextRetryAt).toBeGreaterThan(clock);

    const metrics = await a.inject({ method: 'GET', url: '/api/metrics' });
    expect(metrics.body).toContain('dbhm_handoff_failures_total 1');
    await a.close();
  });

  it('runHandoffRetrySweep re-forwards a due retry and marks it submitted', async () => {
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(liveGogovConfig, failFetch);
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });

    // Not due yet: the sweep must leave it alone.
    expect((await a.runHandoffRetrySweep()).attempted).toBe(0);

    // Advance past the scheduled retry; the transport now succeeds.
    clock = (await r.findById(id))!.handoffDelivery!.nextRetryAt! + 1;
    // Swap the app's transport by rebuilding? No — the fetchImpl is fixed, so
    // instead prove the failing path first, then the recovering path below.
    const failedAgain = await a.runHandoffRetrySweep();
    expect(failedAgain).toMatchObject({ attempted: 1, rescheduled: 1 });
    expect((await r.findById(id))!.handoffDelivery).toMatchObject({ state: 'retrying', attempts: 2 });
    await a.close();

    // Same store, fresh app whose transport succeeds: the due retry recovers.
    const { app: b } = await buildAppWithModerator(liveGogovConfig, okFetch, { repo: r });
    clock = (await r.findById(id))!.handoffDelivery!.nextRetryAt! + 1;
    const recovered = await b.runHandoffRetrySweep();
    expect(recovered).toMatchObject({ attempted: 1, recovered: 1 });
    expect((await r.findById(id))!.handoffDelivery).toMatchObject({ state: 'submitted', attempts: 3 });
    await b.close();
  });

  it('never overlaps two sweeps — a concurrent call joins the sweep in flight (no double-submit)', async () => {
    // Seed a due retry with a transport that fails fast.
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(liveGogovConfig, failFetch);
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    await a.close();

    // Fresh app over the same store, with a transport that BLOCKS until
    // released — the window in which an interval tick could start a second
    // sweep and forward the same hazard to 311 twice.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let forwards = 0;
    const slowFetch = (async () => {
      forwards++;
      await gate;
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    const { app: b } = await buildAppWithModerator(liveGogovConfig, slowFetch, { repo: r });
    clock = (await r.findById(id))!.handoffDelivery!.nextRetryAt! + 1;

    const first = b.runHandoffRetrySweep();
    const second = b.runHandoffRetrySweep(); // fires while the first is mid-transport
    expect(second).toBe(first); // joined, not a new sweep
    release();
    await expect(first).resolves.toMatchObject({ attempted: 1, recovered: 1 });

    // Exactly ONE forward went out; the receipt reflects the single attempt.
    expect(forwards).toBe(1);
    expect((await r.findById(id))!.handoffDelivery).toMatchObject({ state: 'submitted', attempts: 2 });

    // Once settled, the next call starts a fresh sweep (nothing due now).
    expect((await b.runHandoffRetrySweep()).attempted).toBe(0);
    await b.close();
  });

  it('lists dead-lettered hand-offs on the auth-gated failures route', async () => {
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(liveGogovConfig, failFetch);
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });

    // Exhaust the retry budget through the sweep.
    for (;;) {
      const receipt = (await r.findById(id))!.handoffDelivery!;
      if (receipt.state !== 'retrying') break;
      clock = receipt.nextRetryAt! + 1;
      await a.runHandoffRetrySweep();
    }
    expect((await r.findById(id))!.handoffDelivery!.state).toBe('failed');

    const anon = await a.inject({ method: 'GET', url: '/api/moderation/handoff-failures' });
    expect(anon.statusCode).toBe(401);

    const res = await a.inject({
      method: 'GET',
      url: '/api/moderation/handoff-failures',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    const { failures } = res.json();
    expect(failures).toHaveLength(1);
    expect(failures[0].hazard.id).toBe(id);
    expect(failures[0].delivery).toMatchObject({ state: 'failed', lastError: '311 responded 502' });
    await a.close();
  });

  it('flips the receipt to acked when the city status syncs back', async () => {
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(
      {
        ...liveGogovConfig,
        gogovStatusUrl: 'https://gogov.example/status',
      } as typeof serverConfig,
      (async (url: string) =>
        String(url).includes('/status')
          ? { ok: true, status: 200, json: async () => ({ status: 'Received', note: 'ok' }) }
          : { ok: true, status: 200 }) as unknown as typeof fetch,
    );
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    expect((await r.findById(id))!.handoffDelivery!.state).toBe('submitted');

    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff/sync`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    expect((await r.findById(id))!.handoffDelivery).toMatchObject({ state: 'acked', lastError: null });
    await a.close();
  });

  it('never exposes the delivery receipt in any public projection', async () => {
    const { app: a, token: tok } = await buildAppWithModerator(liveGogovConfig, failFetch);
    const created = await a.inject({
      method: 'POST',
      url: '/api/reports',
      payload: baseReport,
      headers: { 'content-type': 'application/json' },
    });
    const id = created.json().hazard.id;
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}`,
      payload: { decision: 'approve' },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    await a.inject({
      method: 'POST',
      url: `/api/moderation/${id}/handoff`,
      payload: {},
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });

    const feed = await a.inject({ method: 'GET', url: '/api/hazards' });
    expect(feed.body).not.toContain('handoffDelivery');
    expect(feed.body).not.toContain('lastError');
    const trail = await a.inject({ method: 'GET', url: `/api/reports/${baseReport.clientId}` });
    expect(trail.body).not.toContain('handoffDelivery');
    await a.close();
  });
});

describe('legacy inline-photo migration', () => {
  it('moves a base64 data-URL photo into the blob store and leaves a { mime } ref', async () => {
    const { migrateInlinePhotos } = await import('../../server/lib/hazards.ts');
    const { MemoryPhotoStore } = await import('../../server/lib/photoStore.ts');
    const photos = new MemoryPhotoStore();
    const r = new MemoryRepository();

    // A record in the OLD shape: photo is an inline data URL string.
    const dataUrl = bytesToDataUrl(new Uint8Array([1, 2, 3]), 'image/jpeg');
    await r.insert({
      id: 'leg-1',
      clientId: 'cid-1',
      category: 'pothole',
      severity: 'high',
      description: null,
      preciseLocation: { lat: 38.54, lng: -121.74 },
      publicLocation: { lat: 38.54, lng: -121.74 },
      photo: dataUrl as unknown as { mime: string },
      status: 'approved',
      confirmations: 0,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: 9_999_999_999_999,
      moderation: [],
    });

    const migrated = await migrateInlinePhotos(r, photos);
    expect(migrated).toBe(1);
    expect((await r.findById('leg-1'))!.photo).toEqual({ mime: 'image/jpeg' });
    expect(Array.from((await photos.get('leg-1'))!)).toEqual([1, 2, 3]);
    // Idempotent: a second run migrates nothing.
    expect(await migrateInlinePhotos(r, photos)).toBe(0);
  });
});

describe('data lifecycle & privacy', () => {
  it('deletes my report by clientId (record gone)', async () => {
    await post('/api/reports', baseReport);
    expect(await repo.findByClientId(baseReport.clientId)).toBeDefined();
    const del = await app.inject({ method: 'DELETE', url: `/api/reports/${baseReport.clientId}` });
    expect(del.statusCode).toBe(204);
    expect(await repo.findByClientId(baseReport.clientId)).toBeUndefined();
  });

  it('404s deleting an unknown report', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/reports/no-such-id' });
    expect(del.statusCode).toBe(404);
  });

  it('exports approved hazards as GeoJSON open data', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    const exp = await app.inject({ method: 'GET', url: '/api/hazards/export' });
    expect(exp.headers['content-type']).toContain('geo+json');
    const gj = exp.json();
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.license).toBe('ODbL-1.0');
    expect(gj.features).toHaveLength(1);
    expect(gj.features[0].geometry.type).toBe('Point');
  });

  it('never leaks the reporter clientId in any unauthenticated response (FIX-01)', async () => {
    // clientId is the reporter's deletion capability (DELETE /api/reports/:clientId).
    // Publishing it would let anyone scrape the feed and delete every report, so
    // it must be absent from the feed, the export, and the create/confirm bodies.
    const create = await post('/api/reports', baseReport);
    const id = create.json().hazard.id;
    expect(create.json().hazard).not.toHaveProperty('clientId');
    expect(create.payload).not.toContain(baseReport.clientId);

    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());

    const feed = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(feed.payload).not.toContain(baseReport.clientId);
    for (const h of feed.json().hazards) {
      expect(h).not.toHaveProperty('clientId');
    }

    const confirm = await post(`/api/hazards/${id}/confirm`, {});
    expect(confirm.json().hazard).not.toHaveProperty('clientId');
    expect(confirm.payload).not.toContain(baseReport.clientId);

    const exp = await app.inject({ method: 'GET', url: '/api/hazards/export' });
    expect(exp.payload).not.toContain(baseReport.clientId);
    for (const f of exp.json().features) {
      expect(f.properties).not.toHaveProperty('clientId');
    }

    // The reporter still holds their clientId locally, so their own deletion
    // capability is intact.
    const del = await app.inject({ method: 'DELETE', url: `/api/reports/${baseReport.clientId}` });
    expect(del.statusCode).toBe(204);
  });

  it('coarsens the precise location once a hazard is resolved', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    // Precise is kept while the report is active...
    expect((await repo.findById(id))!.preciseLocation).toEqual(baseReport.location);
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    await post(`/api/moderation/${id}`, { decision: 'resolve' }, { authorization: `Bearer ${token}` });
    const after = (await repo.findById(id))!;
    expect(after.preciseLocation).toEqual(after.publicLocation);
    expect(after.preciseLocation).not.toEqual(baseReport.location);
  });

  it('coarsens the precise location when a hazard expires', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${token}` });
    clock += 40 * DAY; // past any severity TTL
    await app.inject({ method: 'GET', url: '/api/hazards' }); // triggers the expiry sweep
    const after = (await repo.findById(id))!;
    expect(after.status).toBe('expired');
    expect(after.preciseLocation).toEqual(after.publicLocation);
  });
});

describe('reporter feedback loop (status by clientId)', () => {
  it('returns my report status while it is still pending (not in the public feed)', async () => {
    await post('/api/reports', baseReport);
    const res = await app.inject({ method: 'GET', url: `/api/reports/${baseReport.clientId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().hazard.status).toBe('pending');
    // The fuzzed (public) location is returned, never the precise one.
    expect(res.json().hazard.location).not.toEqual(baseReport.location);
  });

  it('reflects approval and a 311 hand-off back to the reporter', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
    await post(`/api/moderation/${id}/handoff`, {}, auth());
    const res = await app.inject({ method: 'GET', url: `/api/reports/${baseReport.clientId}` });
    expect(res.json().hazard.status).toBe('approved');
    expect(res.json().hazard.handoff?.stage).toBe('submitted');
  });

  it('lets the reporter see a rejected report (the public feed never would)', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'reject' }, auth());
    const res = await app.inject({ method: 'GET', url: `/api/reports/${baseReport.clientId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().hazard.status).toBe('rejected');
  });

  it('404s for an unknown clientId', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/no-such-id' });
    expect(res.statusCode).toBe(404);
  });
});

describe('hazard-aware route planner', () => {
  it('plans a route and detects a hazard sitting on it (fallback, no network)', async () => {
    const rep = await post('/api/reports', baseReport);
    const id = rep.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
    // Read the hazard's PUBLISHED (fuzzed) location and route straight through it.
    const pub = (await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards[0];
    const { lat, lng } = pub.location;
    const res = await app.inject({
      method: 'GET',
      url: `/api/route?from=${lat},${lng - 0.002}&to=${lat},${lng + 0.002}`,
    });
    expect(res.statusCode).toBe(200);
    const plan = res.json().plan;
    expect(plan.source).toBe('fallback');
    expect(plan.route.geometry).toHaveLength(2);
    expect(plan.route.steps.length).toBeGreaterThan(0);
    expect(plan.alternativesConsidered).toBe(1);
    expect(plan.nearby.map((n: { hazard: { id: string } }) => n.hazard.id)).toContain(id);
  });

  it('rejects a route outside Davis (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/route?from=40.0,-120.0&to=40.1,-119.9' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a malformed point (400)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/route?from=garbage&to=38.5449,-121.74' });
    expect(res.statusCode).toBe(400);
  });

  it('uses an OSRM backend when one is configured (mocked fetch)', async () => {
    const fetchMock: typeof fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          routes: [
            {
              distance: 1200,
              duration: 300,
              geometry: { coordinates: [[-121.745, 38.5449], [-121.736, 38.5449]] },
              legs: [{ steps: [{ distance: 1200, name: '5th St', maneuver: { type: 'depart', location: [-121.745, 38.5449] } }] }],
            },
          ],
        }),
      }) as Response) as unknown as typeof fetch;
    const { app: a } = await buildAppWithModerator(
      { ...testConfig, routingUrl: 'https://osrm.test/route/v1/cycling' },
      fetchMock,
    );
    const res = await a.inject({ method: 'GET', url: '/api/route?from=38.5449,-121.745&to=38.5449,-121.736' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.source).toBe('osrm');
    await a.close();
  });
});

describe('311 status sync-back', () => {
  async function handOff(): Promise<string> {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
    await post(`/api/moderation/${id}/handoff`, {}, auth());
    return id;
  }

  it('records a hand-off record on the hazard', async () => {
    const id = await handOff();
    const stored = (await repo.findById(id))!;
    expect(stored.handoff?.stage).toBe('submitted');
    expect(stored.handoff?.reference).toBe(id);
  });

  it('sync dry-runs (and changes nothing) without a status URL', async () => {
    const id = await handOff();
    const res = await post(`/api/moderation/${id}/handoff/sync`, {}, auth());
    expect(res.statusCode).toBe(200);
    expect(res.json().result.dryRun).toBe(true);
    expect((await repo.findById(id))!.status).toBe('approved');
  });

  it('409s syncing a hazard that was never handed off', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
    const res = await post(`/api/moderation/${id}/handoff/sync`, {}, auth());
    expect(res.statusCode).toBe(409);
  });

  it('the moderator poll applies a fetched status (mocked 311)', async () => {
    const fetchMock: typeof fetch = (async () =>
      ({ ok: true, json: async () => ({ status: 'In Progress' }) }) as Response) as unknown as typeof fetch;
    const { app: a, token: tok, repo: r } = await buildAppWithModerator(
      { ...testConfig, gogovStatusUrl: 'https://311.test/status' },
      fetchMock,
    );
    const rep = await a.inject({ method: 'POST', url: '/api/reports', payload: baseReport, headers: { 'content-type': 'application/json' } });
    const id = rep.json().hazard.id;
    const h = { 'content-type': 'application/json', authorization: `Bearer ${tok}` };
    await a.inject({ method: 'POST', url: `/api/moderation/${id}`, payload: { decision: 'approve' }, headers: h });
    await a.inject({ method: 'POST', url: `/api/moderation/${id}/handoff`, payload: {}, headers: h });
    const sync = await a.inject({ method: 'POST', url: `/api/moderation/${id}/handoff/sync`, payload: {}, headers: h });
    expect(sync.json().result.status).toBe('In Progress');
    expect((await r.findById(id))!.handoff?.stage).toBe('in_progress');
    await a.close();
  });

  it('the inbound webhook is disabled (503) without a configured secret', async () => {
    const res = await post('/api/handoff/webhook', { reference: 'x', status: 'Resolved' });
    expect(res.statusCode).toBe(503);
  });

  it('the inbound webhook rejects a call with no signature (401)', async () => {
    const { app: a } = await buildAppWithModerator({ ...testConfig, gogovWebhookSecret: 'shh' });
    const res = await a.inject({
      method: 'POST',
      url: '/api/handoff/webhook',
      payload: JSON.stringify({ reference: 'x', status: 'Resolved' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it('the inbound webhook enforces HMAC, freshness, replay and hand-off (FIX-02)', async () => {
    const secret = 'shared-311-secret';
    // Sign the EXACT body bytes we will send, so the HMAC matches byte-for-byte.
    const signedWebhook = (body: unknown, ts: number) => {
      const raw = JSON.stringify(body);
      return {
        payload: raw,
        headers: {
          'content-type': 'application/json',
          'x-gogov-timestamp': String(ts),
          'x-gogov-signature': signWebhookBody(secret, ts, raw),
        },
      };
    };

    const { app: a, token: tok, repo: r } = await buildAppWithModerator({
      ...testConfig,
      gogovWebhookSecret: secret,
    });
    const rep = await a.inject({ method: 'POST', url: '/api/reports', payload: baseReport, headers: { 'content-type': 'application/json' } });
    const id = rep.json().hazard.id;
    const h = { 'content-type': 'application/json', authorization: `Bearer ${tok}` };
    await a.inject({ method: 'POST', url: `/api/moderation/${id}`, payload: { decision: 'approve' }, headers: h });

    const body = { reference: id, status: 'Closed - Resolved' };

    // A perfectly-signed call BEFORE the hazard is handed off → 409 (a secret
    // holder must not be able to resolve a hazard that was never handed off).
    const preHandoff = await a.inject({ method: 'POST', url: '/api/handoff/webhook', ...signedWebhook(body, clock) });
    expect(preHandoff.statusCode).toBe(409);
    expect(preHandoff.json().error).toBe('not_handed_off');

    await a.inject({ method: 'POST', url: `/api/moderation/${id}/handoff`, payload: {}, headers: h });

    // The OLD scheme (raw static secret in the signature header) → 401.
    const staticSecret = await a.inject({
      method: 'POST',
      url: '/api/handoff/webhook',
      payload: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-gogov-timestamp': String(clock), 'x-gogov-signature': secret },
    });
    expect(staticSecret.statusCode).toBe(401);

    // A valid signature lifted onto a DIFFERENT body → 401 (body-bound HMAC).
    const forged = signedWebhook({ reference: id, status: 'In Progress' }, clock);
    const forgedReq = await a.inject({
      method: 'POST',
      url: '/api/handoff/webhook',
      payload: JSON.stringify(body), // not the body that was signed
      headers: forged.headers,
    });
    expect(forgedReq.statusCode).toBe(401);

    // A correctly-signed but STALE request (timestamp outside the window) → 401.
    const stale = await a.inject({ method: 'POST', url: '/api/handoff/webhook', ...signedWebhook(body, clock - 10 * 60 * 1000) });
    expect(stale.statusCode).toBe(401);

    // Correct HMAC + fresh timestamp → 200, resolves the hazard.
    const signed = signedWebhook(body, clock);
    const ok = await a.inject({ method: 'POST', url: '/api/handoff/webhook', ...signed });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().resolved).toBe(true);
    expect((await r.findById(id))!.status).toBe('resolved');

    // Replaying the identical signed request → 409 (already processed).
    const replay = await a.inject({ method: 'POST', url: '/api/handoff/webhook', ...signed });
    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toBe('replayed');

    await a.close();
  });
});

describe('saved-route push alerts (feature-flagged)', () => {
  const subEndpoint = 'https://push.example/sub/abc';
  const subBody = {
    subscription: { endpoint: subEndpoint, keys: { p256dh: 'p256', auth: 'authkey' } },
    watch: { kind: 'area', minLat: 38.52, minLng: -121.82, maxLat: 38.59, maxLng: -121.68 },
    label: 'All of Davis',
  };

  it('refuses subscriptions when push is disabled (503)', async () => {
    const res = await post('/api/alerts/subscribe', subBody);
    expect(res.statusCode).toBe(503);
  });

  it('accepts a subscription and dry-run-notifies on a matching approval', async () => {
    const { app: a, token: tok, repo: r } = await buildAppWithModerator({
      ...testConfig,
      push: { enabled: true, vapidPublicKey: '', vapidPrivateKey: '', subject: 'mailto:a@b.c' },
    });
    const sub = await a.inject({
      method: 'POST',
      url: '/api/alerts/subscribe',
      payload: subBody,
      headers: { 'content-type': 'application/json' },
    });
    expect(sub.statusCode).toBe(201);
    const id = sub.json().id;
    expect(typeof id).toBe('string');

    // Approving a hazard inside the watch area runs the matcher (dry-run send).
    const rep = await a.inject({ method: 'POST', url: '/api/reports', payload: baseReport, headers: { 'content-type': 'application/json' } });
    const hid = rep.json().hazard.id;
    const decided = await a.inject({
      method: 'POST',
      url: `/api/moderation/${hid}`,
      payload: { decision: 'approve' },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    expect(decided.statusCode).toBe(200);
    expect((await r.findById(hid))!.status).toBe('approved');

    // Unsubscribe.
    const del = await a.inject({ method: 'DELETE', url: `/api/alerts/subscribe/${id}` });
    expect(del.statusCode).toBe(204);
    await a.close();
  });

  it('delivers via the injected sender when VAPID is configured, pruning gone endpoints', async () => {
    // The push service says the subscription is gone (410) — the server should
    // prune it so we never keep pushing at a dead endpoint.
    const sender = vi.fn().mockRejectedValue(new PushSubscriptionGoneError(410));
    const { app: a, token: tok } = await buildAppWithModerator(
      {
        ...testConfig,
        push: { enabled: true, vapidPublicKey: 'pub', vapidPrivateKey: 'priv', subject: 'mailto:a@b.c' },
      },
      undefined,
      { pushSender: sender },
    );
    const sub = await a.inject({
      method: 'POST',
      url: '/api/alerts/subscribe',
      payload: subBody,
      headers: { 'content-type': 'application/json' },
    });
    expect(sub.statusCode).toBe(201);
    const id = sub.json().id;

    const rep = await a.inject({ method: 'POST', url: '/api/reports', payload: baseReport, headers: { 'content-type': 'application/json' } });
    const hid = rep.json().hazard.id;
    const decided = await a.inject({
      method: 'POST',
      url: `/api/moderation/${hid}`,
      payload: { decision: 'approve' },
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    });
    expect(decided.statusCode).toBe(200); // a dead endpoint never fails moderation
    expect(sender).toHaveBeenCalledTimes(1);

    // The 410 pruned the subscription: deleting it now reports "already gone".
    const del = await a.inject({ method: 'DELETE', url: `/api/alerts/subscribe/${id}` });
    expect(del.statusCode).toBe(404);
    await a.close();
  });

  it('validates the subscription body (400 on a bad watch)', async () => {
    const { app: a } = await buildAppWithModerator({
      ...testConfig,
      push: { enabled: true, vapidPublicKey: '', vapidPrivateKey: '', subject: '' },
    });
    const res = await a.inject({
      method: 'POST',
      url: '/api/alerts/subscribe',
      payload: { subscription: { endpoint: 'not-a-url', keys: { p256dh: 'p', auth: 'a' } }, watch: { kind: 'area' } },
      headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe('resolved hazards stay briefly visible on the feed', () => {
  it('keeps a resolved hazard (greyed) then drops it after the window', async () => {
    const r = await post('/api/reports', baseReport);
    const id = r.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, auth());
    await post(`/api/moderation/${id}`, { decision: 'resolve' }, auth());

    const feed1 = (await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards;
    expect(feed1).toHaveLength(1);
    expect(feed1[0].status).toBe('resolved');
    expect(feed1[0].resolvedAt).toBeGreaterThan(0);

    clock += 8 * DAY; // past resolvedVisibleDays (7)
    const feed2 = (await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards;
    expect(feed2).toHaveLength(0);
  });
});
