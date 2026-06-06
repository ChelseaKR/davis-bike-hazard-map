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
    { name: 'moderation' },
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
        properties: {
          id: { type: 'string' },
          clientId: { type: 'string', format: 'uuid' },
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
      post: { tags: ['moderation'], security: [{ bearerAuth: [] }], summary: '311/GOGov hand-off (dry-run by default)', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'result' } } },
    },
  },
} as const;
