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
import { ZodError } from 'zod';
import {
  reportSubmissionSchema,
  hazardFiltersSchema,
  moderationDecisionSchema,
} from '../shared/validation.ts';
import { SEVERITY_RANK, type Severity } from '../shared/types.ts';
import { dataUrlToBytes } from '../shared/exif.ts';
import { serverConfig } from './config.ts';
import type { Repository } from './lib/repository.ts';
import {
  confirmHazard,
  createHazard,
  listModerationQueue,
  listPublic,
  moderateHazard,
  toPublic,
} from './lib/hazards.ts';
import { forwardToGogov } from './lib/gogov.ts';

export interface AppDeps {
  repo: Repository;
  now?: () => number;
  config?: typeof serverConfig;
  fetchImpl?: typeof fetch;
  logger?: boolean;
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

  const app = Fastify({
    logger: deps.logger ?? (!config.isTest && { redact: ['req.headers.authorization'] }),
    bodyLimit: 6 * 1024 * 1024, // photos arrive as base64; keep a sane ceiling
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
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong.' });
  });

  const requireModerator = async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!config.moderationToken || token !== config.moderationToken) {
      await reply.status(401).send({ error: 'unauthorized', message: 'Moderator token required.' });
    }
  };

  // --- Health ---
  app.get('/api/health', async () => ({ status: 'ok', time: now() }));

  // --- Public feed ---
  app.get('/api/hazards', async (req) => {
    const filters = hazardFiltersSchema.parse(parseHazardQuery(req.query));
    let hazards = listPublic(repo, now());

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
    return { hazards };
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
      const stored = createHazard(repo, report, now(), ttlOpts(config));
      return reply.status(201).send({ hazard: toPublic(stored) });
    },
  );

  // --- Confirm a hazard ("I saw this too") ---
  app.post('/api/hazards/:id/confirm', async (req, reply) => {
    const { id } = req.params as { id: string };
    const updated = confirmHazard(repo, id, now(), ttlOpts(config));
    if (!updated) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found or not active.' });
    }
    return { hazard: toPublic(updated) };
  });

  // --- Serve a moderated photo (approved + live only) ---
  app.get('/api/photos/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const hazard = repo.findById(id);
    if (!hazard || !hazard.photo || hazard.status !== 'approved' || hazard.expiresAt <= now()) {
      return reply.status(404).send({ error: 'not_found', message: 'Photo not available.' });
    }
    const { bytes, mime } = dataUrlToBytes(hazard.photo);
    return reply
      .header('content-type', mime)
      .header('cache-control', 'public, max-age=3600')
      .send(Buffer.from(bytes));
  });

  // --- Moderation (auth) ---
  app.get('/api/moderation/queue', { preHandler: requireModerator }, async () => ({
    hazards: listModerationQueue(repo),
  }));

  app.post('/api/moderation/:id', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { decision, reason } = moderationDecisionSchema.parse(req.body);
    const updated = moderateHazard(repo, id, decision, now(), reason);
    if (!updated) {
      return reply.status(404).send({ error: 'not_found', message: 'Hazard not found.' });
    }
    return { hazard: toPublic(updated) };
  });

  // --- Optional 311/GOGov hand-off (moderator-triggered, least privilege) ---
  app.post('/api/moderation/:id/handoff', { preHandler: requireModerator }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hazard = repo.findById(id);
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
  return out;
}
