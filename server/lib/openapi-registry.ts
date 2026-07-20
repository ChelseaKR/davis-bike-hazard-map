/**
 * OpenAPI registry — the single source of truth for the API contract.
 *
 * Registers the SAME zod schemas the routes parse requests with
 * (shared/validation.ts) plus the public response shapes, and one
 * registerPath() entry per route. server/openapi.ts turns this registry into
 * the document served at GET /api/openapi.json, and
 * tests/unit/openapi-contract.test.ts asserts the registered paths match the
 * routes buildApp actually mounts — so spec/route drift fails CI.
 *
 * Paths here are relative to the `/api` (and `/api/v1` alias) server URLs
 * declared in server/openapi.ts.
 */
import { z } from 'zod';
import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import {
  HAZARD_CATEGORIES,
  SEVERITIES,
  HAZARD_STATUSES,
  HANDOFF_STAGES,
  type Hazard,
} from '../../shared/types.ts';
import {
  geoPointSchema,
  reportSubmissionSchema,
  moderationDecisionSchema,
  loginSchema,
  clientErrorSchema,
  webVitalSchema,
  handoffStatusSchema,
  alertSubscriptionSchema,
  moderationQueueQuerySchema,
} from '../../shared/validation.ts';

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  description: 'Moderator session token',
});
const bearerAuth = [{ bearerAuth: [] }];

// --- Components (named schemas) ---

// Shared schemas are constructed before this server-only module runs. Under
// Zod 4, clone them after installing the extension so the cloned instances
// carry `.openapi()` without pulling zod-to-openapi into the browser bundle.
const geoPoint = registry.register('GeoPoint', geoPointSchema.clone());

const handoffInfo = registry.register(
  'HandoffInfo',
  z
    .object({
      provider: z.string(),
      reference: z.string(),
      externalStatus: z.string(),
      stage: z.enum(HANDOFF_STAGES),
      submittedAt: z.number().int(),
      updatedAt: z.number().int(),
      note: z.string().nullish(),
    })
    .openapi({ description: '311/GOGov hand-off + synced-back status' }),
);

/**
 * A hazard exactly as the public API exposes it (the shape `toPublic()` in
 * server/lib/hazards.ts returns). The `satisfies` clause pins this schema to
 * the shared `Hazard` interface at compile time; the contract test parses
 * live responses with it at test time.
 */
export const hazardSchema = registry.register(
  'Hazard',
  // `clientId` is deliberately ABSENT from this public shape: it is the
  // reporter's deletion capability (FIX-01) and never appears in any
  // unauthenticated response. It exists only in the request schemas below
  // (report submission + the reporter's own DELETE path parameter).
  z.object({
    id: z.string(),
    category: z.enum(HAZARD_CATEGORIES),
    severity: z.enum(SEVERITIES),
    description: z.string().nullable(),
    location: geoPoint,
    photoUrl: z.string().nullable(),
    thumbnailUrl: z.string().nullable().optional(),
    status: z.enum(HAZARD_STATUSES),
    confirmations: z.number().int(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    expiresAt: z.number().int(),
    resolvedAt: z.number().int().nullable().optional(),
    handoff: handoffInfo.nullable().optional(),
  }) satisfies z.ZodType<Hazard>,
);

const reportSubmission = registry.register('ReportSubmission', reportSubmissionSchema.clone());
const moderationDecision = registry.register('ModerationDecision', moderationDecisionSchema.clone());
const loginRequest = registry.register('LoginRequest', loginSchema.clone());
const clientError = registry.register('ClientError', clientErrorSchema.clone());
const webVital = registry.register('WebVital', webVitalSchema.clone());
const handoffStatus = registry.register('HandoffStatus', handoffStatusSchema.clone());
const alertSubscription = registry.register('AlertSubscription', alertSubscriptionSchema.clone());

const errorSchema = registry.register(
  'Error',
  z
    .object({ error: z.string(), message: z.string(), details: z.unknown().optional() })
    .openapi({ description: 'Standard error envelope' }),
);

// --- Response shapes (exported so the contract test can parse live bodies) ---

export const healthResponseSchema = z.object({ status: z.literal('ok'), time: z.number().int() });

export const readyResponseSchema = z.object({ status: z.literal('ready'), time: z.number().int() });

/** Body of GET /hazards. */
export const hazardFeedResponseSchema = z.object({ hazards: z.array(hazardSchema) });

/**
 * Body of GET /moderation/queue — one keyset page (FIX-04). Photo fields are
 * references into GET /photos/{id} (which streams pending bytes to
 * authenticated moderators only), never inline data URLs.
 */
export const moderationQueueResponseSchema = z.object({
  hazards: z.array(hazardSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

export const hazardResponseSchema = z.object({ hazard: hazardSchema });

export const sessionResponseSchema = z.object({
  token: z.string(),
  username: z.string(),
  expiresAt: z.number().int(),
});

/** GET /hazards/export — open-data GeoJSON FeatureCollection (ODbL). */
export const hazardExportSchema = z.object({
  type: z.literal('FeatureCollection'),
  license: z.literal('ODbL-1.0'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z.object({
        id: z.string(),
        category: z.enum(HAZARD_CATEGORIES),
        severity: z.enum(SEVERITIES),
        description: z.string().nullable(),
        confirmations: z.number().int(),
        createdAt: z.number().int(),
        updatedAt: z.number().int(),
      }),
    }),
  ),
});

/**
 * A hand-off delivery receipt (R3) as returned by the auth-gated dead-letter
 * route. Server-internal data (lastError may carry provider internals) — this
 * schema is deliberately used by no public route.
 */
export const handoffDeliverySchema = registry.register(
  'HandoffDelivery',
  z
    .object({
      state: z.enum(['submitted', 'acked', 'retrying', 'failed']),
      dryRun: z.boolean(),
      attempts: z.number().int(),
      lastAttemptAt: z.number().int(),
      nextRetryAt: z.number().int().nullable(),
      lastError: z.string().nullable(),
    })
    .openapi({ description: '311 hand-off delivery receipt (auth-gated, R3)' }),
);

/** GET /moderation/handoff-failures — dead-lettered hand-offs. */
export const handoffFailuresResponseSchema = z.object({
  failures: z.array(z.object({ hazard: hazardSchema, delivery: handoffDeliverySchema.nullable() })),
});

const json = (schema: z.ZodTypeAny) => ({ 'application/json': { schema } });
const errorContent = json(errorSchema);

// --- Paths ---
// Wire-format note: /hazards and /route take comma-separated query strings;
// the server splits them (parseHazardQuery/parsePoint in server/app.ts) before
// validating with hazardFiltersSchema/routeRequestSchema, so the parameters
// below document the on-the-wire encoding, not the post-parse shape.

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['ops'],
  summary: 'Liveness',
  responses: { 200: { description: 'ok', content: json(healthResponseSchema) } },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  tags: ['ops'],
  summary: 'Readiness (DB-aware)',
  responses: {
    200: { description: 'ready', content: json(readyResponseSchema) },
    503: { description: 'not ready' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['ops'],
  summary: 'Prometheus metrics',
  responses: { 200: { description: 'metrics' } },
});

registry.registerPath({
  method: 'get',
  path: '/openapi.json',
  tags: ['ops'],
  summary: 'This document',
  responses: { 200: { description: 'OpenAPI spec' } },
});

registry.registerPath({
  method: 'get',
  path: '/hazards',
  tags: ['public'],
  summary: 'Public hazard feed (approved, unexpired)',
  request: {
    query: z.object({
      categories: z.string().optional().openapi({ description: 'comma-separated' }),
      minSeverity: z.enum(SEVERITIES).optional(),
      withinDays: z.coerce.number().int().positive().max(365).optional(),
      bbox: z.string().optional().openapi({ description: 'minLat,minLng,maxLat,maxLng' }),
    }),
  },
  responses: {
    200: { description: 'feed (ETag/304 supported)', content: json(hazardFeedResponseSchema) },
    304: { description: 'not modified' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/hazards/export',
  tags: ['public'],
  summary: 'Open-data export (GeoJSON, ODbL)',
  responses: {
    200: { description: 'FeatureCollection', content: { 'application/geo+json': { schema: hazardExportSchema } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/route',
  tags: ['routing'],
  summary: 'Hazard-aware cycling route plan (proxies OSRM, re-ranks to avoid hazards)',
  request: {
    query: z.object({
      from: z.string().openapi({ description: 'lat,lng (within Davis)' }),
      to: z.string().openapi({ description: 'lat,lng (within Davis)' }),
    }),
  },
  responses: {
    200: { description: 'a RoutePlan (chosen route geometry + turn-by-turn steps + hazards on route)' },
    400: { description: 'endpoints missing or outside Davis', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/hazards/{id}/confirm',
  tags: ['public'],
  summary: 'Confirm a hazard ("I saw this too")',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'updated', content: json(hazardResponseSchema) },
    404: { description: 'not active', content: errorContent },
  },
});

registry.registerPath({
  method: 'get',
  path: '/photos/{id}',
  tags: ['public'],
  summary: 'Hazard photo (approved publicly; pending only with a moderator bearer token)',
  description:
    'Approved, unexpired hazard photos are public and cacheable. A PENDING ' +
    'photo is served only when the request carries a valid moderator bearer ' +
    'token (FIX-04 — the moderation queue references photos instead of ' +
    'inlining them); without one the route answers 404, never 401/403. ' +
    'Rejected/expired/resolved photos are not served to anyone.',
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({ size: z.enum(['thumb']).optional() }),
  },
  responses: {
    200: { description: 'image/jpeg' },
    404: { description: 'not available', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/reports',
  tags: ['reports'],
  summary: 'Submit a report (idempotent on clientId)',
  request: {
    body: { required: true, content: json(reportSubmission) },
  },
  responses: {
    201: { description: 'created (pending moderation)', content: json(hazardResponseSchema) },
    400: { description: 'validation error', content: errorContent },
  },
});

registry.registerPath({
  method: 'get',
  path: '/reports/{clientId}',
  tags: ['reports'],
  summary: 'Status of my own report (clientId is the capability)',
  request: { params: z.object({ clientId: z.string().uuid() }) },
  responses: {
    200: { description: 'current report status', content: json(hazardResponseSchema) },
    404: { description: 'not found', content: errorContent },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/reports/{clientId}',
  tags: ['reports'],
  summary: 'Delete my report (clientId is the capability)',
  request: { params: z.object({ clientId: z.string() }) },
  responses: {
    204: { description: 'deleted' },
    404: { description: 'not found', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/client-errors',
  tags: ['ops'],
  summary: 'Client error telemetry sink',
  request: { body: { required: true, content: json(clientError) } },
  responses: { 204: { description: 'accepted' } },
});

registry.registerPath({
  method: 'post',
  path: '/metrics/web-vitals',
  tags: ['ops'],
  summary: 'Cookieless Core Web Vitals RUM sink (log-only)',
  request: { body: { required: true, content: json(webVital) } },
  responses: {
    204: { description: 'accepted' },
    400: { description: 'validation error', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['auth'],
  summary: 'Moderator login',
  request: { body: { required: true, content: json(loginRequest) } },
  responses: {
    200: { description: 'session token', content: json(sessionResponseSchema) },
    401: { description: 'invalid credentials', content: errorContent },
    429: { description: 'locked out', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['auth'],
  security: bearerAuth,
  summary: 'Refresh session',
  responses: { 200: { description: 'new token', content: json(sessionResponseSchema) } },
});

registry.registerPath({
  method: 'post',
  path: '/auth/revoke',
  tags: ['auth'],
  security: bearerAuth,
  summary: 'Revoke all my sessions',
  responses: { 200: { description: 'revoked' } },
});

registry.registerPath({
  method: 'get',
  path: '/moderation/queue',
  tags: ['moderation'],
  security: bearerAuth,
  summary: 'Pending review queue (keyset-paged, oldest first)',
  description:
    'One page of the moderation backlog (FIX-04). Pass the returned ' +
    '`nextCursor` to fetch the next page; `total` is the full backlog count. ' +
    'Photo fields are references into GET /photos/{id} — bytes are never inlined.',
  request: { query: moderationQueueQuerySchema.clone() },
  responses: {
    200: { description: 'queue page', content: json(moderationQueueResponseSchema) },
    400: { description: 'invalid limit/cursor', content: errorContent },
    401: { description: 'unauthorized', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/moderation/{id}',
  tags: ['moderation'],
  security: bearerAuth,
  summary: 'Approve / reject / resolve',
  request: {
    params: z.object({ id: z.string() }),
    body: { required: true, content: json(moderationDecision) },
  },
  responses: {
    200: { description: 'updated', content: json(hazardResponseSchema) },
    404: { description: 'not found', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/moderation/{id}/handoff',
  tags: ['moderation'],
  security: bearerAuth,
  summary: '311/GOGov hand-off (dry-run by default; records a delivery receipt)',
  description:
    'Forwards the hazard to the configured 311 provider and records a ' +
    'delivery receipt (R3). A failed transport schedules automatic ' +
    'exponential retries; once the retry budget is exhausted the hand-off ' +
    'appears under GET /moderation/handoff-failures for a manual re-send ' +
    '(POSTing here again).',
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'result + updated hazard' } },
});

registry.registerPath({
  method: 'get',
  path: '/moderation/handoff-failures',
  tags: ['moderation'],
  security: bearerAuth,
  summary: 'Dead-lettered 311 hand-offs (delivery retry budget exhausted)',
  description:
    'Hand-offs whose delivery failed through every automatic retry (R3). ' +
    'The receipt (attempts, last error) is auth-gated because it can carry ' +
    'provider internals; it never appears in any public response.',
  responses: {
    200: { description: 'dead-letter list', content: json(handoffFailuresResponseSchema) },
    401: { description: 'unauthorized', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/moderation/{id}/handoff/sync',
  tags: ['moderation'],
  security: bearerAuth,
  summary: 'Poll 311 for status and reflect it (resolving the hazard if fixed)',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'sync result + updated hazard' },
    409: { description: 'never handed off', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/handoff/webhook',
  tags: ['moderation'],
  summary:
    '311 status sync-back webhook (HMAC-SHA256 over the raw body + signed timestamp; replay-protected)',
  description:
    'Send `x-gogov-timestamp` (epoch ms) and `x-gogov-signature` = hex ' +
    'HMAC-SHA256, keyed by the shared secret, over the string ' +
    '`{timestamp}.{rawBody}`. The timestamp must be within 5 minutes of ' +
    'server time and each signature is accepted at most once. The ' +
    'referenced hazard must already have a 311 hand-off record.',
  request: {
    headers: z.object({
      'x-gogov-timestamp': z
        .string()
        .openapi({ description: 'epoch ms; folded into the signed message' }),
      'x-gogov-signature': z
        .string()
        .openapi({ description: 'hex HMAC-SHA256 of `{timestamp}.{rawBody}`' }),
    }),
    body: { required: true, content: json(handoffStatus) },
  },
  responses: {
    200: { description: 'applied' },
    401: { description: 'missing/forged signature, or stale timestamp', content: errorContent },
    404: { description: 'no hazard for that reference', content: errorContent },
    409: {
      description: 'replayed signature, or hazard never handed off',
      content: errorContent,
    },
    503: { description: 'webhook disabled (no secret configured)', content: errorContent },
  },
});

registry.registerPath({
  method: 'post',
  path: '/alerts/subscribe',
  tags: ['alerts'],
  summary: 'Subscribe a saved area/route to new-hazard push alerts (feature-flagged)',
  request: { body: { required: true, content: json(alertSubscription) } },
  responses: {
    201: { description: 'subscription id', content: json(z.object({ id: z.string() })) },
    400: { description: 'invalid', content: errorContent },
    503: { description: 'push disabled', content: errorContent },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/alerts/subscribe/{id}',
  tags: ['alerts'],
  summary: 'Remove a saved alert subscription',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'removed' },
    404: { description: 'not found', content: errorContent },
    503: { description: 'push disabled', content: errorContent },
  },
});
