import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';
import { bytesToDataUrl, hasExif, dataUrlToBytes } from '../../shared/exif.ts';

const TOKEN = 'test-moderator-token';
const DAY = 24 * 60 * 60 * 1000;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  moderationToken: TOKEN,
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

function jpegWithExif(): string {
  const bytes = Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xe1, 0x00, 0x0c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, // APP1 Exif
    0xff, 0xe0, 0x00, 0x04, 0x10, 0x20, // APP0
    0xff, 0xda, 0x00, 0x03, 0x55, 0x12, 0x34, 0xff, 0xd9, // SOS + data + EOI
  ]);
  return bytesToDataUrl(bytes, 'image/jpeg');
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
  app = await buildApp({ repo, config: testConfig, now: () => clock, logger: false });
  await app.ready();
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
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${TOKEN}` });

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
    expect(repo.all()).toHaveLength(1);
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
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hazards).toHaveLength(1);
  });
});

describe('photo privacy', () => {
  it('strips EXIF server-side and gates the photo behind approval', async () => {
    const res = await post('/api/reports', { ...baseReport, photo: jpegWithExif() });
    const id = res.json().hazard.id;

    // Photo is not publicly servable while pending.
    const pending = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(pending.statusCode).toBe(404);

    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${TOKEN}` });

    const ok = await app.inject({ method: 'GET', url: `/api/photos/${id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('image/jpeg');
    // The stored/served photo must be EXIF-clean (server backstop).
    expect(hasExif(new Uint8Array(ok.rawPayload))).toBe(false);
  });

  it('inlines the photo (auth-gated) in the moderation queue so it can be reviewed', async () => {
    await post('/api/reports', { ...baseReport, photo: jpegWithExif() });
    const res = await app.inject({
      method: 'GET',
      url: '/api/moderation/queue',
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const photoUrl = res.json().hazards[0].photoUrl as string;
    expect(photoUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(hasExif(dataUrlToBytes(photoUrl).bytes)).toBe(false);
  });
});

describe('lifecycle', () => {
  it('confirms an approved hazard and increments the count', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${TOKEN}` });

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
    await post(`/api/moderation/${id}`, { decision: 'reject' }, { authorization: `Bearer ${TOKEN}` });
    const pub = await app.inject({ method: 'GET', url: '/api/hazards' });
    expect(pub.json().hazards).toHaveLength(0);
  });

  it('expires approved hazards past their TTL', async () => {
    const res = await post('/api/reports', baseReport);
    const id = res.json().hazard.id;
    await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${TOKEN}` });

    expect((await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards).toHaveLength(1);
    clock += 31 * DAY; // past the high-severity TTL
    expect((await app.inject({ method: 'GET', url: '/api/hazards' })).json().hazards).toHaveLength(0);
    expect(repo.findById(id)?.status).toBe('expired');
  });
});

describe('filters', () => {
  it('filters the public feed by category and severity', async () => {
    const approve = async (clientId: string, over: Record<string, unknown>) => {
      const r = await post('/api/reports', { ...baseReport, clientId, ...over });
      const id = r.json().hazard.id;
      await post(`/api/moderation/${id}`, { decision: 'approve' }, { authorization: `Bearer ${TOKEN}` });
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
      { authorization: `Bearer ${TOKEN}` },
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
