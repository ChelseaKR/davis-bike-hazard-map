import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { MemoryModeratorStore } from '../../server/lib/moderators.ts';
import { hashPassword } from '../../server/lib/password.ts';
import { serverConfig } from '../../server/config.ts';
import { bytesToDataUrl, hasExif, dataUrlToBytes } from '../../shared/exif.ts';
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

  it('echoes a correlation request id on responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-request-id': 'corr-123' },
    });
    expect(res.headers['x-request-id']).toBe('corr-123');
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

  it('inlines the full photo (auth-gated) in the moderation queue', async () => {
    await post('/api/reports', { ...baseReport, photo: await realPhoto() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${token}` },
    });
    const photoUrl = res.json().hazards[0].photoUrl as string;
    expect(photoUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(hasExif(dataUrlToBytes(photoUrl).bytes)).toBe(false);
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
    expect(Array.from(photos.get('leg-1')!)).toEqual([1, 2, 3]);
    // Idempotent: a second run migrates nothing.
    expect(await migrateInlinePhotos(r, photos)).toBe(0);
  });
});
