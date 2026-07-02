/**
 * App-level contract: every error reply carries a STABLE machine `error` code
 * (INTERNATIONALIZATION-STANDARD §3). Clients translate off the code, never off
 * the English `message`, so the codes must be present and stable. This also
 * covers the fine-grained `outside_davis` code and the alert-locale field.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';

const clock = 1_700_000_000_000;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  sessionSecret: 'test-session-secret',
  routingUrl: '',
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
  ttlDays: { low: 14, moderate: 21, high: 30 },
  push: { ...serverConfig.push, enabled: true, vapidPublicKey: 'pub', vapidPrivateKey: 'priv', subject: 'mailto:a@b.c' },
} as typeof serverConfig;

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ repo: new MemoryRepository(), config: testConfig, now: () => clock, logger: false });
  await app.ready();
});

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload: body as object, headers: { 'content-type': 'application/json', ...headers } });
}

describe('error envelopes carry a stable machine code', () => {
  it('unauthorized moderation access → unauthorized', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/moderation/queue' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
    expect(typeof res.json().message).toBe('string'); // English fallback kept
  });

  it('bad login → invalid_credentials', async () => {
    const res = await post('/api/auth/login', { username: 'nobody', password: 'wrong' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_credentials');
  });

  it('missing hazard confirm → not_found', async () => {
    const res = await post('/api/hazards/does-not-exist/confirm', {});
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
  });

  it('malformed report body → validation_error', async () => {
    const res = await post('/api/reports', { category: 'not-a-category' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('out-of-Davis location → fine-grained outside_davis code', async () => {
    const res = await post('/api/reports', {
      category: 'pothole',
      severity: 'high',
      location: { lat: 40.0, lng: -120.0 }, // valid lat/lng, but outside Davis
      photo: null,
      clientId: '11111111-1111-4111-8111-111111111111',
      capturedAt: 1_699_000_000_000,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('outside_davis');
  });

  it('alert subscribe accepts a locale and rejects an unsupported one', async () => {
    const base = {
      subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
      watch: { kind: 'area', minLat: 38.53, minLng: -121.8, maxLat: 38.58, maxLng: -121.7 },
    };
    const ok = await post('/api/alerts/subscribe', { ...base, locale: 'es' });
    expect(ok.statusCode).toBe(201);
    expect(typeof ok.json().id).toBe('string');

    const bad = await post('/api/alerts/subscribe', { ...base, locale: 'de' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('validation_error');
  });
});
