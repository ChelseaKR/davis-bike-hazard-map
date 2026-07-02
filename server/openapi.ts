/**
 * OpenAPI 3.0 description of the public API, served at GET /api/openapi.json.
 *
 * GENERATED from the zod schemas the routes actually validate with — see
 * server/lib/openapi-registry.ts. Do not hand-edit paths or schemas here; add
 * them to the registry. tests/unit/openapi-contract.test.ts fails CI when the
 * spec and the live routes drift.
 *
 * Both `/api/...` and the versioned `/api/v1/...` alias resolve to the same
 * handlers (rewriteUrl in server/app.ts), hence the two `servers` entries.
 */
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './lib/openapi-registry.ts';

export const openapiSpec = new OpenApiGeneratorV3(registry.definitions).generateDocument({
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
  servers: [
    { url: '/api', description: 'current' },
    { url: '/api/v1', description: 'v1 alias' },
  ],
  tags: [
    { name: 'public' },
    { name: 'reports' },
    { name: 'routing' },
    { name: 'moderation' },
    { name: 'alerts' },
    { name: 'auth' },
    { name: 'ops' },
  ],
});
