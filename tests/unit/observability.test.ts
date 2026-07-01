/**
 * Observability contract (OBSERVABILITY-STANDARD §3 + §6):
 *   - /livez is a pure liveness probe (200, no dependency call).
 *   - /readyz reflects store health and FAILS CLOSED (503) when the store is
 *     unreachable — whether repo.ping() returns false or throws.
 *   - The structured JSON log stream is valid JSON and REDACTS the fields this
 *     privacy-first app must never leak: precise coordinates, session tokens,
 *     passwords, and auth headers.
 *
 * The health apps run with `logger: false` (quiet); the redaction test injects a
 * capture stream so it can assert on the actual emitted records.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../server/app.ts';
import { MemoryRepository, type Repository } from '../../server/lib/repository.ts';
import { serverConfig } from '../../server/config.ts';
import { LOG_REDACT } from '../../server/lib/logger.ts';

const clock = 1_700_000_000_000;

const testConfig = {
  ...serverConfig,
  isProd: false,
  isTest: true,
  corsOrigins: [],
  serveClient: false,
  rateLimit: { max: 10_000, windowMs: 60_000, reportsPerHour: 10_000 },
} as typeof serverConfig;

describe('liveness + readiness probes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      repo: new MemoryRepository(),
      config: testConfig,
      now: () => clock,
      logger: false,
    });
    await app.ready();
  });

  it('GET /livez returns 200 {status:"ok"} (no dependency call)', async () => {
    const res = await app.inject({ method: 'GET', url: '/livez' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /readyz returns 200 with store ok when the store pings', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { store: 'ok' } });
  });

  it('GET /readyz fails closed (503) when the store ping returns false', async () => {
    const down = await buildApp({
      repo: { ping: async () => false } as unknown as Repository,
      config: testConfig,
      now: () => clock,
      logger: false,
    });
    const res = await down.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { store: 'error' } });
    await down.close();
  });

  it('GET /readyz fails closed (503) when the store ping throws', async () => {
    const down = await buildApp({
      repo: {
        ping: async () => {
          throw new Error('store unreachable');
        },
      } as unknown as Repository,
      config: testConfig,
      now: () => clock,
      logger: false,
    });
    const res = await down.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe('error');
    await down.close();
  });
});

describe('structured JSON logging redacts sensitive fields', () => {
  it('emits valid JSON records and never leaks precise location, tokens, or auth', async () => {
    const lines: string[] = [];
    // Inject a Pino logger whose destination is our capture buffer. Fastify
    // passes `stream` straight to pino as the destination (see logger-pino.js).
    const logger = {
      level: 'info',
      redact: LOG_REDACT,
      stream: {
        write: (s: string) => {
          lines.push(s);
        },
      },
    } as unknown as AppDeps['logger'];

    const app = await buildApp({
      repo: new MemoryRepository(),
      config: testConfig,
      now: () => clock,
      logger,
    });
    await app.ready();

    // A routine request emits request/response logs at info level.
    await app.inject({ method: 'GET', url: '/api/health' });

    // A log line carrying every sensitive field this app touches.
    app.log.info(
      {
        preciseLocation: { lat: 38.5449, lng: -121.7405 },
        report: { location: { lat: 38.5449, lng: -121.7405 } },
        token: 'super-secret-session-token',
        password: 'hunter2',
        headers: { authorization: 'Bearer super-secret-session-token' },
      },
      'sensitive-marker',
    );

    // AUTO-GATE: every stdout line must parse as JSON.
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const record = lines
      .map((l) => JSON.parse(l))
      .find((r) => r.msg === 'sensitive-marker');
    expect(record).toBeDefined();
    // Sensitive fields are censored, not present in the clear.
    expect(record.preciseLocation).toBe('[redacted]');
    expect(record.report.location).toBe('[redacted]');
    expect(record.token).toBe('[redacted]');
    expect(record.password).toBe('[redacted]');
    expect(record.headers.authorization).toBe('[redacted]');

    // Belt and braces: the raw values never appear anywhere in the stream.
    const blob = lines.join('');
    expect(blob).not.toContain('super-secret-session-token');
    expect(blob).not.toContain('hunter2');
    expect(blob).not.toContain('-121.7405');

    await app.close();
  });
});
