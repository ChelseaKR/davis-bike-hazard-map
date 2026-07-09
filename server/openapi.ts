/**
 * OpenAPI 3.0 description of the public API, served at GET /api/openapi.json.
 *
 * Hand-maintained (the routes validate via zod, not Fastify JSON schemas, so
 * there's nothing to auto-generate from). Both `/api/...` and the versioned
 * `/api/v1/...` alias resolve to the same handlers.
 */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Davis Bike Hazard Map API',
    version: '1.0.0',
    description:
      'Crowdsourced cycling-hazard reporting. Public read + report endpoints, ' +
      'moderator-authenticated review, and an open-data export. Reachable at ' +
      '/api/* and the versioned alias /api/v1/*.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/api', description: 'current' }, { url: '/api/v1', description: 'v1 alias' }],
  tags: [
    { name: 'public' },
    { name: 'reports' },
    { name: 'routing' },
    { name: 'moderation' },
    { name: 'alerts' },
    { name: 'auth' },
    { name: 'ops' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Moderator session token' },
    },
    schemas: {
      GeoPoint: {
        type: 'object',
        required: ['lat', 'lng'],
        properties: { lat: { type: 'number' }, lng: { type: 'number' } },
      },
      Hazard: {
        type: 'object',
        // Note: `clientId` is intentionally NOT exposed here — it is the
        // reporter's deletion capability and never appears in the public feed.
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'moderate', 'high'] },
          description: { type: 'string', nullable: true },
          location: { $ref: '#/components/schemas/GeoPoint' },
          photoUrl: { type: 'string', nullable: true },
          thumbnailUrl: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'resolved', 'expired'] },
          confirmations: { type: 'integer' },
          createdAt: { type: 'integer' },
          updatedAt: { type: 'integer' },
          expiresAt: { type: 'integer' },
          resolvedAt: { type: 'integer', nullable: true },
          handoff: {
            type: 'object',
            nullable: true,
            description: '311/GOGov hand-off + synced-back status',
            properties: {
              provider: { type: 'string' },
              reference: { type: 'string' },
              externalStatus: { type: 'string' },
              stage: { type: 'string', enum: ['submitted', 'acknowledged', 'in_progress', 'resolved', 'closed', 'rejected'] },
              submittedAt: { type: 'integer' },
              updatedAt: { type: 'integer' },
            },
          },
        },
      },
      ReportSubmission: {
        type: 'object',
        required: ['category', 'severity', 'location', 'clientId', 'capturedAt'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'moderate', 'high'] },
          description: { type: 'string' },
          location: { $ref: '#/components/schemas/GeoPoint' },
          photo: { type: 'string', nullable: true, description: 'base64 image data URL' },
          clientId: { type: 'string', format: 'uuid' },
          capturedAt: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['ops'], summary: 'Liveness', responses: { '200': { description: 'ok' } } } },
    '/ready': {
      get: { tags: ['ops'], summary: 'Readiness (DB-aware)', responses: { '200': { description: 'ready' }, '503': { description: 'not ready' } } },
    },
    '/metrics': { get: { tags: ['ops'], summary: 'Prometheus metrics', responses: { '200': { description: 'metrics' } } } },
    '/openapi.json': { get: { tags: ['ops'], summary: 'This document', responses: { '200': { description: 'OpenAPI spec' } } } },
    '/hazards': {
      get: {
        tags: ['public'],
        summary: 'Public hazard feed (approved, unexpired)',
        parameters: [
          { name: 'categories', in: 'query', schema: { type: 'string' }, description: 'comma-separated' },
          { name: 'minSeverity', in: 'query', schema: { type: 'string' } },
          { name: 'withinDays', in: 'query', schema: { type: 'integer' } },
          { name: 'bbox', in: 'query', schema: { type: 'string' }, description: 'minLat,minLng,maxLat,maxLng' },
        ],
        responses: {
          '200': { description: 'feed (ETag/304 supported)', content: { 'application/json': { schema: { type: 'object', properties: { hazards: { type: 'array', items: { $ref: '#/components/schemas/Hazard' } } } } } } },
          '304': { description: 'not modified' },
        },
      },
    },
    '/hazards/export': { get: { tags: ['public'], summary: 'Open-data export (GeoJSON, ODbL)', responses: { '200': { description: 'FeatureCollection' } } } },
    '/route': {
      get: {
        tags: ['routing'],
        summary: 'Hazard-aware cycling route plan (proxies OSRM, re-ranks to avoid hazards)',
        parameters: [
          { name: 'from', in: 'query', required: true, schema: { type: 'string' }, description: 'lat,lng (within Davis)' },
          { name: 'to', in: 'query', required: true, schema: { type: 'string' }, description: 'lat,lng (within Davis)' },
        ],
        responses: {
          '200': { description: 'a RoutePlan (chosen route geometry + turn-by-turn steps + hazards on route)' },
          '400': { description: 'endpoints missing or outside Davis' },
        },
      },
    },
    '/hazards/{id}/confirm': {
      post: { tags: ['public'], summary: 'Confirm a hazard ("I saw this too")', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'updated' }, '404': { description: 'not active' } } },
    },
    '/photos/{id}': {
      get: { tags: ['public'], summary: 'Moderated photo (approved only)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'size', in: 'query', schema: { type: 'string', enum: ['thumb'] } }], responses: { '200': { description: 'image/jpeg' }, '404': { description: 'not available' } } },
    },
    '/reports': {
      post: {
        tags: ['reports'],
        summary: 'Submit a report (idempotent on clientId)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ReportSubmission' } } } },
        responses: { '201': { description: 'created (pending moderation)' }, '400': { description: 'validation error' } },
      },
    },
    '/reports/{clientId}': {
      delete: { tags: ['reports'], summary: 'Delete my report (clientId is the capability)', parameters: [{ name: 'clientId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'deleted' }, '404': { description: 'not found' } } },
    },
    '/client-errors': { post: { tags: ['ops'], summary: 'Client error telemetry sink', responses: { '204': { description: 'accepted' } } } },
    '/auth/login': {
      post: { tags: ['auth'], summary: 'Moderator login', responses: { '200': { description: 'session token' }, '401': { description: 'invalid credentials' }, '429': { description: 'locked out' } } },
    },
    '/auth/refresh': { post: { tags: ['auth'], security: [{ bearerAuth: [] }], summary: 'Refresh session', responses: { '200': { description: 'new token' } } } },
    '/auth/revoke': { post: { tags: ['auth'], security: [{ bearerAuth: [] }], summary: 'Revoke all my sessions', responses: { '200': { description: 'revoked' } } } },
    '/moderation/queue': { get: { tags: ['moderation'], security: [{ bearerAuth: [] }], summary: 'Pending review queue', responses: { '200': { description: 'queue' }, '401': { description: 'unauthorized' } } } },
    '/moderation/{id}': {
      post: { tags: ['moderation'], security: [{ bearerAuth: [] }], summary: 'Approve / reject / resolve', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'updated' }, '404': { description: 'not found' } } },
    },
    '/moderation/{id}/handoff': {
      post: { tags: ['moderation'], security: [{ bearerAuth: [] }], summary: '311/GOGov hand-off (dry-run by default)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'result + updated hazard' } } },
    },
    '/moderation/{id}/handoff/sync': {
      post: { tags: ['moderation'], security: [{ bearerAuth: [] }], summary: 'Poll 311 for status and reflect it (resolving the hazard if fixed)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'sync result + updated hazard' }, '409': { description: 'never handed off' } } },
    },
    '/handoff/webhook': {
      post: {
        tags: ['moderation'],
        summary: '311 status sync-back webhook (HMAC-SHA256 over the raw body + signed timestamp; replay-protected)',
        description:
          'Send `x-gogov-timestamp` (epoch ms) and `x-gogov-signature` = hex ' +
          'HMAC-SHA256, keyed by the shared secret, over the string ' +
          '`{timestamp}.{rawBody}`. The timestamp must be within 5 minutes of ' +
          'server time and each signature is accepted at most once. The ' +
          'referenced hazard must already have a 311 hand-off record.',
        parameters: [
          { name: 'x-gogov-timestamp', in: 'header', required: true, schema: { type: 'string' }, description: 'epoch ms; folded into the signed message' },
          { name: 'x-gogov-signature', in: 'header', required: true, schema: { type: 'string' }, description: 'hex HMAC-SHA256 of `{timestamp}.{rawBody}`' },
        ],
        responses: {
          '200': { description: 'applied' },
          '401': { description: 'missing/forged signature, or stale timestamp' },
          '404': { description: 'no hazard for that reference' },
          '409': { description: 'replayed signature, or hazard never handed off' },
          '503': { description: 'webhook disabled (no secret configured)' },
        },
      },
    },
    '/alerts/subscribe': {
      post: { tags: ['alerts'], summary: 'Subscribe a saved area/route to new-hazard push alerts (feature-flagged)', responses: { '201': { description: 'subscription id' }, '400': { description: 'invalid' }, '503': { description: 'push disabled' } } },
    },
    '/alerts/subscribe/{id}': {
      delete: { tags: ['alerts'], summary: 'Remove a saved alert subscription', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '204': { description: 'removed' }, '404': { description: 'not found' }, '503': { description: 'push disabled' } } },
    },
  },
} as const;
