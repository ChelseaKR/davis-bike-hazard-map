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
  type FastifyServerOptions,
} from 'fastify';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ZodError } from 'zod';
import {
  reportSubmissionSchema,
  hazardFiltersSchema,
  moderationDecisionSchema,
  clientErrorSchema,
  loginSchema,
  routeRequestSchema,
  handoffStatusSchema,
  alertSubscriptionSchema,
} from '../shared/validation.ts';
import { SEVERITY_RANK, type Severity } from '../shared/types.ts';
import { rankRoutes, type RoutePlan } from '../shared/routing.ts';
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
import { buildLoggerOptions } from './lib/logger.ts';
import { captureError, captureClientError } from './lib/sentry.ts';
import { openapiSpec } from './openapi.ts';

/** Current API version (also the prefix `/api/v1` resolves to). */
const API_VERSION = '1';
const DAY_MS = 24 * 60 * 60 * 1000;
import {
  confirmHazard,
  createHazard,
  listModerationQueue,
  listPublic,
  listPublicFeed,
  moderateHazard,
  toPublic,
  thumbKey,
} from './lib/hazards.ts';
import { forwardToGogov, fetchGogovStatus } from './lib/gogov.ts';
import { postOsmNote, isOsmEligible } from './lib/osmNotes.ts';
import { fetchRoutes } from './lib/routing.ts';
import { applyHandoffStatus, initialHandoff } from './lib/lifecycle.ts';
import {
  MemorySubscriptionStore,
  buildSubscription,
  type SubscriptionStore,
} from './lib/subscriptions.ts';
import { notifyForHazard } from './lib/pushNotify.ts';

export interface AppDeps {
  repo: Repository;
  photos?: PhotoStore;
  moderators?: ModeratorStore;
  subscriptions?: SubscriptionStore;
  now?: () => number;
  config?: typeof serverConfig;
  fetchImpl?: typeof fetch;
  /**
   * Override the logger. `false`/`true` toggle it (tests pass `false`); a Pino
   * options object lets a test inject a capture stream to assert redaction.
   * When omitted, the logger is derived from `config` (structured JSON in
   * prod/dev, off in tests).
   */
  logger?: FastifyServerOptions['logger'];
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
  const subscriptions = deps.subscriptions ?? new MemorySubscriptionStore();

  const app = Fastify({
    // Structured JSON logs with a redaction allow-list (never emit precise
    // coords, auth headers, tokens, secrets). See server/lib/logger.ts.
    logger: deps.logger ?? buildLoggerOptions(config),
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

  // --- Kubernetes-style probes (OBSERVABILITY-STANDARD §6) ---
  // Distinct paths, distinct semantics. Both are unauthenticated and outside
  // `/api/` (so the rate-limit allow-list already exempts them). `logLevel`
  // keeps routine probes out of the access log — the 503 branch still logs.
  //
  // /livez — the process is alive and not deadlocked. NO dependency calls.
  app.get('/livez', { logLevel: 'silent' }, async () => ({ status: 'ok' }));

  // /readyz — ready for traffic, INCLUDING the backing store. Fail-closed: a
  // ping that returns false OR throws yields 503, so a load balancer stops
  // sending traffic to an instance whose store is unreachable.
  app.get('/readyz', { logLevel: 'warn' }, async (req, reply) => {
    try {
      const ok = await repo.ping();
      if (!ok) throw new Error('store not ready');
      return { status: 'ok', checks: { store: 'ok' } };
    } catch (err) {
      req.log.error({ err }, 'readiness check failed');
      return reply.status(503).send({ status: 'error', checks: { store: 'error' } });
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
    // bbox is pushed down to the store (SQL) for spatial culling at scale. The
    // feed also carries recently-resolved hazards (greyed client-side) so a fix
    // is visible, not just an absence — see listPublicFeed.
    let hazards = await listPublicFeed(
      repo,
      now(),
      config.resolvedVisibleDays * DAY_MS,
      filters.bbox,
    );

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

  // --- Hazard-aware bike route planner ---
  // Proxies an OSRM cycling backend (server-side, so the browser stays
  // same-origin / offline-cacheable), then re-ranks the candidate routes to
  // prefer ones that avoid reported hazards (weighted by severity + recency).
  app.get('/api/route', async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const { from, to } = routeRequestSchema.parse({
      from: parsePoint(q.from),
      to: parsePoint(q.to),
    });

    const hazards = await listPublic(repo, now());
    const { routes, source } = await fetchRoutes(from, to, { routingUrl: config.routingUrl }, fetchImpl);
    // Corridor slightly wider than the privacy fuzz grid (~70 m cells) so a
    // hazard published a cell away from the true spot still influences scoring.
    const ranked = rankRoutes(routes, hazards, { now: now(), corridorMeters: 45 });
    const best = ranked[0];

    const plan: RoutePlan = {
      source,
      from,
      to,
      route: best.route,
      nearby: best.nearby,
      alternativesConsidered: routes.length,
    };
    return { plan };
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
    // A newly-approved hazard can fire saved-route/area push alerts (dry-run
    // unless push is configured). Best-effort: never let it fail moderation.
    if (decision === 'approve') {
      try {
        const result = await notifyForHazard(
          toPublic(updated),
          await subscriptions.all(),
          config.push,
        );
        if (result.matched > 0) {
          app.log.info({ hazard: id, ...result }, 'saved-route alert matched');
        }
      } catch (err) {
        app.log.warn(err, 'alert notify failed');
      }
    }
    return { hazard: toPublic(updated) };
  });

  // --- Saved-route / saved-area push alerts (feature-flagged) ---
  app.post(
    '/api/alerts/subscribe',
    { config: { rateLimit: { max: 20, timeWindow: 60 * 60 * 1000 } } },
    async (req, reply) => {
      if (!config.push.enabled) {
        return reply
          .status(503)
          .send({ error: 'disabled', message: 'Push alerts are not enabled on this server.' });
      }
      const { subscription, watch, label } = alertSubscriptionSchema.parse(req.body);
      const sub = buildSubscription(subscription.endpoint, subscription.keys, watch, now(), label);
      await subscriptions.upsert(sub);
      return reply.status(201).send({ id: sub.id });
    },
  );

  app.delete('/api/alerts/subscribe/:id', async (req, reply) => {
    if (!config.push.enabled) {
      return reply.status(503).send({ error: 'disabled', message: 'Push alerts are not enabled.' });
    }
    const { id } = req.params as { id: string };
    const removed = await subscriptions.remove(id);
    if (!removed) {
      return reply.status(404).send({ error: 'not_found', message: 'No such subscription.' });
    }
    return reply.status(204).send();
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
    // Record the hand-off on the hazard so its 311 status can be synced back and
    // surfaced on the map/list. Even a dry-run records the intent.
    const updated = await repo.update(id, { handoff: initialHandoff(hazard, now()), updatedAt: now() });
    return { result, hazard: updated ? toPublic(updated) : toPublic(hazard) };
  });

  // --- 311 status sync-back: moderator-triggered poll ---
  // Pulls the current status from 311 (dry-run without GOGOV_STATUS_URL) and
  // reflects it onto the hazard; a "fixed" status resolves the hazard.
  app.post('/api/moderation/:id/handoff/sync', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hazard = await repo.findById(id);
    if (!hazard) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found.' });
    }
    if (!hazard.handoff) {
      return reply.status(409).send({ error: 'not_handed_off', message: 'Hazard was never handed off to 311.' });
    }
    const status = await fetchGogovStatus(
      hazard.handoff.reference,
      { webhookUrl: config.gogovWebhookUrl, apiKey: config.gogovApiKey, statusUrl: config.gogovStatusUrl },
      fetchImpl,
    );
    if (!status.status) {
      // Nothing to apply (dry-run or error) — report it without changing state.
      return { result: status, hazard: toPublic(hazard) };
    }
    const { patch } = applyHandoffStatus(hazard, status.status, now(), status.note);
    const updated = await repo.update(id, patch);
    return { result: status, hazard: toPublic(updated ?? hazard) };
  });

  // --- Optional OSM Notes feedback loop (moderator-triggered, dry-run default) ---
  // Drafts an anonymous OSM Note for a hazard describing a permanent map feature
  // (eligible categories only). Dry-runs unless OSM_NOTES_ENABLED is set. The
  // note carries only the FUZZED location + category/severity labels + a
  // back-link — never description, photo, or reporter data (see osmNotes.ts).
  app.post('/api/moderation/:id/osm-note', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hazard = await repo.findById(id);
    if (!hazard) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found.' });
    }
    if (!isOsmEligible(hazard.category)) {
      return reply.status(400).send({
        error: 'ineligible_category',
        message: 'Only permanent-infrastructure categories can be suggested to OSM.',
      });
    }
    const result = await postOsmNote(
      hazard,
      {
        enabled: config.osmNotesEnabled,
        apiUrl: config.osmNotesApiUrl,
      },
      fetchImpl,
    );
    // Record the suggestion (who + dry-run/delivered) as the audit trail, the
    // same way the 311 hand-off records its intent. Even a dry-run is recorded.
    const by = (req as AuthedRequest).moderatorUsername;
    const updated = await repo.update(id, {
      osmNote: { by, at: now(), dryRun: result.dryRun, delivered: result.delivered },
      updatedAt: now(),
    });
    return { result, hazard: updated ? toPublic(updated) : toPublic(hazard) };
  });

  // --- 311 status sync-back: inbound webhook (city/GOGov → us) ---
  // Authenticated by a shared secret; DISABLED (503) unless GOGOV_WEBHOOK_SECRET
  // is configured, so we never accept unauthenticated status writes.
  app.post('/api/handoff/webhook', async (req, reply) => {
    if (!config.gogovWebhookSecret) {
      return reply.status(503).send({ error: 'disabled', message: '311 sync-back webhook is not configured.' });
    }
    const header = req.headers['x-gogov-signature'];
    const signature = Array.isArray(header) ? '' : header ?? '';
    if (!constantTimeEqual(signature, config.gogovWebhookSecret)) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid webhook signature.' });
    }
    const { reference, status, note } = handoffStatusSchema.parse(req.body);
    // The reference is the hazard id we forwarded.
    const hazard = (await repo.findById(reference)) ?? undefined;
    if (!hazard) {
      return reply.status(404).send({ error: 'not_found', message: 'No hazard for that reference.' });
    }
    const { patch, stage, resolved } = applyHandoffStatus(hazard, status, now(), note);
    const updated = await repo.update(reference, patch);
    return { ok: true, stage, resolved, hazard: toPublic(updated ?? hazard) };
  });

  return app;
}

/**
 * Constant-time string comparison for shared secrets (e.g. the 311 webhook
 * signature), consistent with token/password verification elsewhere. Returns
 * false for unequal lengths without leaking *where* a same-length value differs.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Parse a "lat,lng" query value into a point (or undefined if malformed). */
function parsePoint(value: unknown): { lat: number; lng: number } | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',').map(Number);
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n))) return undefined;
  return { lat: parts[0], lng: parts[1] };
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
