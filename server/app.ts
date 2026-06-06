/**
 * Fastify application factory.
 *
 * `buildApp` takes its dependencies (repository, clock, config, fetch) as
 * arguments so the whole HTTP surface can be integration-tested with
 * `app.inject()` — no real network, no real time, no real disk.
 */
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import {
  reportSubmissionSchema,
  hazardFiltersSchema,
  moderationDecisionSchema,
  clientErrorSchema,
  loginSchema,
} from '../shared/validation.ts';
import { SEVERITY_RANK, type Severity } from '../shared/types.ts';
import { serverConfig } from './config.ts';
import type { Repository } from './lib/repository.ts';
import { MemoryPhotoStore, type PhotoStore } from './lib/photoStore.ts';
import {
  MemoryModeratorStore,
  DUMMY_PASSWORD_HASH,
  type ModeratorStore,
} from './lib/moderators.ts';
import { verifyPassword } from './lib/password.ts';
import { issueToken, verifyToken } from './lib/token.ts';
import { createMetrics } from './lib/metrics.ts';
import { captureError, captureClientError } from './lib/sentry.ts';
import { openapiSpec } from './openapi.ts';

/** Current API version (also the prefix `/api/v1` resolves to). */
const API_VERSION = '1';
import {
  confirmHazard,
  createHazard,
  listModerationQueue,
  listPublic,
  moderateHazard,
  toPublic,
  thumbKey,
} from './lib/hazards.ts';
import { forwardToGogov } from './lib/gogov.ts';

export interface AppDeps {
  repo: Repository;
  photos?: PhotoStore;
  moderators?: ModeratorStore;
  now?: () => number;
  config?: typeof serverConfig;
  fetchImpl?: typeof fetch;
  logger?: boolean;
}

/** A request that has passed the moderator session check. */
interface AuthedRequest extends FastifyRequest {
  moderatorUsername?: string;
}

const ttlOpts = (config: typeof serverConfig) => ({
  ttlDays: {
    low: config.ttlDays.low,
    moderate: config.ttlDays.moderate,
    high: config.ttlDays.high,
  } as Record<Severity, number>,
});

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const config = deps.config ?? serverConfig;
  const now = deps.now ?? (() => Date.now());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { repo } = deps;
  const photos = deps.photos ?? new MemoryPhotoStore();
  const moderators = deps.moderators ?? new MemoryModeratorStore();

  const app = Fastify({
    logger: deps.logger ?? (!config.isTest && { redact: ['req.headers.authorization'] }),
    bodyLimit: 6 * 1024 * 1024, // photos arrive as base64; keep a sane ceiling
    // Honour an upstream X-Request-Id (proxy/CDN) for log correlation; otherwise
    // Fastify generates one. Echoed back on responses below.
    requestIdHeader: 'x-request-id',
    // Versioning: /api/v1/* is an alias for /api/* (rewritten before routing),
    // so a single set of handlers serves both and clients can pin to v1.
    rewriteUrl(req) {
      const url = req.url ?? '/';
      return url.startsWith('/api/v1/') ? url.replace('/api/v1/', '/api/') : url;
    },
  });

  // Surface the request id + API version on every response.
  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-api-version', API_VERSION);
  });

  // RED metrics: observe every request's duration, labelled by the route
  // *pattern* (bounded cardinality) and status.
  const metrics = createMetrics();
  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe(
      {
        method: req.method,
        route: req.routeOptions?.url ?? 'unknown',
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet injects inline styles
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  if (config.corsOrigins.length) {
    await app.register(cors, { origin: config.corsOrigins });
  }

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // Only rate-limit the API. Static assets (index, JS/CSS, icons, the SW)
    // must never be throttled — a single page load fetches many of them.
    allowList: (req) => !(req.url ?? '').startsWith('/api/'),
  });

  // Validation errors -> 400 with a stable envelope.
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: 'validation_error',
        message: err.issues[0]?.message ?? 'Invalid request.',
        details: err.issues,
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        error: err.code ?? 'request_error',
        message: err.message,
      });
    }
    app.log.error(err);
    captureError(err, { reqId: _req.id });
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong.' });
  });

  const requireModerator = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = token ? verifyToken(token, config.sessionSecret, now()) : null;
    if (!payload) {
      await reply.status(401).send({ error: 'unauthorized', message: 'Moderator sign-in required.' });
      return;
    }
    // Revocation: the token's version must still match the account's current
    // one (a bump signs everyone out / kills a leaked token).
    const moderator = await moderators.findByUsername(payload.sub);
    if (!moderator || (payload.ver ?? 0) !== moderator.tokenVersion) {
      await reply.status(401).send({ error: 'unauthorized', message: 'Session no longer valid.' });
      return;
    }
    (req as AuthedRequest).moderatorUsername = payload.sub;
  };

  // Per-account failed-login throttle (per-process; complements the per-IP rate
  // limit). After MAX_LOGIN_FAILS misses an account is locked for LOCKOUT_MS.
  const loginFailures = new Map<string, { count: number; until: number }>();
  const MAX_LOGIN_FAILS = 5;
  const LOCKOUT_MS = 15 * 60 * 1000;

  // --- OpenAPI spec ---
  app.get('/api/openapi.json', async () => openapiSpec);

  // --- Health (liveness) + readiness ---
  // Liveness: the process is up. Readiness: dependencies (the DB) are reachable,
  // so a load balancer can stop routing to an instance with a dead database.
  app.get('/api/health', async () => ({ status: 'ok', time: now() }));

  app.get('/api/ready', async (_req, reply) => {
    try {
      const ok = await repo.ping();
      if (!ok) throw new Error('store not ready');
      return { status: 'ready', time: now() };
    } catch (err) {
      app.log.error(err, 'readiness check failed');
      return reply.status(503).send({ status: 'not_ready' });
    }
  });

  // --- Metrics (Prometheus) ---
  // RED + Node defaults (prom-client) plus the moderation-backlog gauges that
  // drive the 48 h SLA alerts (see docs/ops). Scrape with Prometheus.
  app.get('/api/metrics', async (_req, reply) => {
    const { count, oldestCreatedAt } = await repo.pendingStats();
    metrics.queueDepth.set(count);
    metrics.oldestPending.set(
      oldestCreatedAt === null ? 0 : Math.max(0, Math.round((now() - oldestCreatedAt) / 1000)),
    );
    return reply.header('content-type', metrics.registry.contentType).send(await metrics.registry.metrics());
  });

  // --- Client error sink (privacy-safe, best-effort telemetry) ---
  // The PWA beacons render/runtime errors here so failures in the field are
  // visible in the same logs as the server's. The payload is validated and
  // length-capped; we log a warning and acknowledge with 204 (no body).
  app.post('/api/client-errors', async (req, reply) => {
    const report = clientErrorSchema.parse(req.body);
    app.log.warn({ clientError: report }, 'client error reported');
    captureClientError(report); // forward to Sentry (no-op without a DSN)
    return reply.status(204).send();
  });

  // --- Moderator auth ---
  // Login is rate-limited harder than the global API to blunt credential
  // stuffing. A miss still runs a hash compare (against a dummy) so the
  // response time doesn't reveal whether the username exists.
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } } },
    async (req, reply) => {
      const { username, password } = loginSchema.parse(req.body);

      // Per-account lockout after repeated misses.
      const fail = loginFailures.get(username);
      if (fail && fail.until > now()) {
        return reply
          .status(429)
          .send({ error: 'too_many_attempts', message: 'Too many attempts. Try again later.' });
      }

      const moderator = await moderators.findByUsername(username);
      const ok = await verifyPassword(password, moderator?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!moderator || !ok) {
        const f = loginFailures.get(username) ?? { count: 0, until: 0 };
        f.count += 1;
        if (f.count >= MAX_LOGIN_FAILS) {
          f.until = now() + LOCKOUT_MS;
          f.count = 0;
        }
        loginFailures.set(username, f);
        return reply
          .status(401)
          .send({ error: 'invalid_credentials', message: 'Wrong username or password.' });
      }

      loginFailures.delete(username); // success clears the counter
      const token = issueToken(
        username,
        config.sessionSecret,
        config.sessionTtlMs,
        now(),
        moderator.tokenVersion,
      );
      return { token, username, expiresAt: now() + config.sessionTtlMs };
    },
  );

  // Exchange a still-valid session for a fresh one (sliding expiry).
  app.post('/api/auth/refresh', { preHandler: requireModerator }, async (req) => {
    const username = (req as AuthedRequest).moderatorUsername!;
    const moderator = await moderators.findByUsername(username);
    const ver = moderator?.tokenVersion ?? 0;
    const token = issueToken(username, config.sessionSecret, config.sessionTtlMs, now(), ver);
    return { token, username, expiresAt: now() + config.sessionTtlMs };
  });

  // Sign out everywhere / revoke a leaked token: bump the account's token
  // version so every previously issued session stops verifying.
  app.post('/api/auth/revoke', { preHandler: requireModerator }, async (req) => {
    const username = (req as AuthedRequest).moderatorUsername!;
    await moderators.bumpTokenVersion(username);
    return { revoked: true, username };
  });

  // --- Public feed ---
  app.get('/api/hazards', async (req, reply) => {
    const filters = hazardFiltersSchema.parse(parseHazardQuery(req.query));
    // bbox is pushed down to the store (SQL) for spatial culling at scale.
    let hazards = await listPublic(repo, now(), filters.bbox);

    if (filters.categories?.length) {
      const set = new Set(filters.categories);
      hazards = hazards.filter((h) => set.has(h.category));
    }
    if (filters.minSeverity) {
      const min = SEVERITY_RANK[filters.minSeverity];
      hazards = hazards.filter((h) => SEVERITY_RANK[h.severity] >= min);
    }
    if (filters.withinDays) {
      const cutoff = now() - filters.withinDays * 24 * 60 * 60 * 1000;
      hazards = hazards.filter((h) => h.updatedAt >= cutoff);
    }

    // Conditional request: hash the payload so repeat polls (every 30s) get a
    // cheap 304 instead of re-downloading the whole feed.
    const body = JSON.stringify({ hazards });
    const etag = `"${createHash('sha1').update(body).digest('base64')}"`;
    if (req.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }
    return reply
      .header('etag', etag)
      .header('cache-control', 'no-cache')
      .header('content-type', 'application/json')
      .send(body);
  });

  // --- Submit a report (idempotent on clientId) ---
  app.post(
    '/api/reports',
    {
      config: {
        rateLimit: {
          max: config.rateLimit.reportsPerHour,
          timeWindow: 60 * 60 * 1000,
        },
      },
    },
    async (req, reply) => {
      const report = reportSubmissionSchema.parse(req.body);
      const stored = await createHazard(repo, photos, report, now(), ttlOpts(config));
      return reply.status(201).send({ hazard: toPublic(stored) });
    },
  );

  // --- Delete my own report (reporter data deletion) ---
  // No account: the clientId (a UUID known only to the reporter's device and
  // the server) is the capability. Removes the record and its photo blobs.
  app.delete('/api/reports/:clientId', async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const hazard = await repo.findByClientId(clientId);
    if (!hazard) {
      return reply.status(404).send({ error: 'not_found', message: 'No report with that id.' });
    }
    await repo.deleteById(hazard.id);
    await photos.delete(hazard.id);
    await photos.delete(thumbKey(hazard.id));
    return reply.status(204).send();
  });

  // --- Open-data export (approved, public locations only) as GeoJSON ---
  app.get('/api/hazards/export', async (_req, reply) => {
    const hazards = await listPublic(repo, now());
    const features = hazards.map((h) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.location.lng, h.location.lat] },
      properties: {
        id: h.id,
        category: h.category,
        severity: h.severity,
        description: h.description,
        confirmations: h.confirmations,
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      },
    }));
    return reply
      .header('content-type', 'application/geo+json')
      .header('access-control-allow-origin', '*') // open data — readable anywhere
      .send(JSON.stringify({ type: 'FeatureCollection', license: 'ODbL-1.0', features }));
  });

  // --- Confirm a hazard ("I saw this too") ---
  app.post('/api/hazards/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = await confirmHazard(repo, id, now(), ttlOpts(config));
    if (!updated) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found or not active.' });
    }
    return { hazard: toPublic(updated) };
  });

  // --- Serve a moderated photo (approved + live only) ---
  app.get('/api/photos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { size } = req.query as { size?: string };
    const hazard = await repo.findById(id);
    if (!hazard || !hazard.photo || hazard.status !== 'approved' || hazard.expiresAt <= now()) {
      return reply.status(404).send({ error: 'not_found', message: 'Photo not available.' });
    }
    // ?size=thumb serves the small variant, falling back to the full image.
    const bytes =
      (size === 'thumb' ? await photos.get(thumbKey(id)) : null) ?? (await photos.get(id));
    if (!bytes) {
      return reply.status(404).send({ error: 'not_found', message: 'Photo not available.' });
    }
    return reply
      .header('content-type', hazard.photo.mime)
      .header('cache-control', 'public, max-age=3600')
      .send(Buffer.from(bytes));
  });

  // --- Moderation (auth) ---
  app.get('/api/moderation/queue', { preHandler: requireModerator }, async () => ({
    hazards: await listModerationQueue(repo, photos),
  }));

  app.post('/api/moderation/:id', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { decision, reason } = moderationDecisionSchema.parse(req.body);
    const by = (req as AuthedRequest).moderatorUsername;
    const updated = await moderateHazard(repo, id, decision, now(), reason, by);
    if (!updated) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found.' });
    }
    return { hazard: toPublic(updated) };
  });

  // --- Optional 311/GOGov hand-off (moderator-triggered, least privilege) ---
  app.post('/api/moderation/:id/handoff', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hazard = await repo.findById(id);
    if (!hazard) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found.' });
    }
    const result = await forwardToGogov(
      hazard,
      { webhookUrl: config.gogovWebhookUrl, apiKey: config.gogovApiKey },
      fetchImpl,
    );
    return { result };
  });

  return app;
}

/** Normalize comma-separated query params into the shapes the schema expects. */
function parseHazardQuery(query: unknown): Record<string, unknown> {
  const q = (query ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof q.categories === 'string' && q.categories) {
    out.categories = q.categories.split(',').filter(Boolean);
  }
  if (typeof q.minSeverity === 'string' && q.minSeverity) out.minSeverity = q.minSeverity;
  if (typeof q.withinDays === 'string' && q.withinDays) out.withinDays = q.withinDays;
  // bbox=minLat,minLng,maxLat,maxLng (Leaflet getBounds order: S,W,N,E).
  if (typeof q.bbox === 'string' && q.bbox) {
    const parts = q.bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      out.bbox = { minLat: parts[0], minLng: parts[1], maxLat: parts[2], maxLng: parts[3] };
    }
  }
  return out;
}
