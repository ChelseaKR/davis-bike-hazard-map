import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../server/app.ts';
import { MemoryRepository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  sessionSecret: 'test-session-secret',
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
} as typeof serverConfig;

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ repo: new MemoryRepository(), config: testConfig, logger: false });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const post = (body: unknown) =>
  app.inject({
    method: 'POST',
    url: '/api/metrics/web-vitals',
    payload: body as object,
    headers: { 'content-type': 'application/json' },
  });

describe('POST /api/metrics/web-vitals', () => {
  it('accepts a valid cookieless sample with 204 and no body', async () => {
    const res = await post({
      type: 'vital',
      name: 'LCP',
      value: 1234.568,
      rating: 'good',
      path: '/map',
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    // Cookieless: the sink must never set a cookie.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts each Core Web Vital name and rating', async () => {
    for (const name of ['CLS', 'INP', 'LCP']) {
      for (const rating of ['good', 'needs-improvement', 'poor']) {
        const res = await post({ name, value: 0.1, rating, path: '/' });
        expect(res.statusCode).toBe(204);
      }
    }
  });

  it('rejects unknown metric names', async () => {
    const res = await post({ name: 'FID', value: 10, rating: 'good', path: '/' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('rejects a non-numeric or negative value', async () => {
    expect((await post({ name: 'CLS', value: 'high', rating: 'poor', path: '/' })).statusCode).toBe(400);
    expect((await post({ name: 'CLS', value: -1, rating: 'poor', path: '/' })).statusCode).toBe(400);
  });

  it('rejects an invalid rating', async () => {
    const res = await post({ name: 'INP', value: 300, rating: 'terrible', path: '/' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing path', async () => {
    const res = await post({ name: 'LCP', value: 900, rating: 'good' });
    expect(res.statusCode).toBe(400);
  });

  it('is documented in the OpenAPI spec', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json().paths['/metrics/web-vitals']?.post).toBeTruthy();
  });
});
