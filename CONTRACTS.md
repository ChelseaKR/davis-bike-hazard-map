# Contracts

These names live outside this repository's source: in visitors' browsers, in
the Postgres database, in other people's code that reads the open-data export
and the API, and in shared links. Renaming one in the source passes every test
here and still breaks those readers, so each changes only by the policy in its
row. A pull request that adds a persisted or published identifier adds its row
here in the same change (DOC-23).

| Identifier | Kind | Where | Owner | Change policy |
|---|---|---|---|---|
| `dbhm.deviceId` | localStorage key | `src/lib/deviceId.ts` | web client | Never renamed. A successor key reads this one once, writes the new key, then removes this one |
| `dbhm.session` | localStorage key (moderator session) | `src/components/ModerationPanel.tsx` | web client | May be renamed only if every moderator signing in again is acceptable; say so in the PR |
| `davis-bike-hazard-map` (version 1) | IndexedDB database name | `src/lib/db.ts` | web client | Never renamed: queued offline reports live in it. Schema changes bump the version and migrate in `upgrade` |
| `reports` store, `clientId` key path, `by-state` index | IndexedDB object store and index | `src/lib/db.ts` | web client | Changed only through a versioned `upgrade` that carries existing records over |
| `osm-tiles`, `hazard-api`, `route-api` | service worker cache names | `vite.config.ts` (Workbox runtime caching) | web client | A rename orphans the old cache; ship it with cleanup of the old name |
| `#/map`, `#/hazard/<id>`, `#/list`, `#/coverage`, `#/trends`, `#/route`, `#/report`, `#/mine`, `#/moderate` | URL hash routes (permalinks) | `src/hooks/useViewState.ts` | web client | Shared links must keep resolving: a renamed route keeps the old one as an alias |
| `cat`, `severity`, `days`, `profile` | URL hash query parameters | `src/hooks/useViewState.ts` | web client | Same as the hash routes: the old parameter stays readable |
| `/api/*` and its `/api/v1/*` alias | public HTTP API routes | `server/app.ts`, described at `/api/openapi.json` | server | Additive changes only. A rename or removal ships behind a new API version, with the old route kept for one version |
| `/api/hazards/export` GeoJSON: `id`, `category`, `severity`, `description`, `confirmations`, `createdAt`, `updatedAt`, `source`, and the top-level `license` | published open-data fields | `server/app.ts` | server | Additive changes only. A renamed field ships beside the old name for one API version |
| `/livez`, `/readyz`, `/api/health`, `/api/ready`, `/api/metrics` | health and monitoring URLs | `server/app.ts` | server | Monitors and the Fly.io checks call these; a rename updates `fly.toml` and BETA.md in the same change and keeps the old path for one release |
| `/api/handoff/webhook` | inbound webhook URL | `server/app.ts` | server | Configured in the 311 provider; changes only together with that configuration |
| `hazards`, `moderators`, `hazard_tombstones`, `push_subscriptions`, `schema_migrations` and their columns | database tables and columns | `migrations/*.sql` | server | Changed only by a new numbered migration; an applied migration file is never edited to change schema |
| `migrations/NNNN_name.sql` file names | applied-migration versions | `migrations/`, `server/lib/migrate.ts` | server | Never renamed: the runner records each applied file by name in `schema_migrations` |
| Server environment variables (`DATABASE_URL`, `SESSION_SECRET`, `MODERATOR_USERNAME`, `MODERATOR_PASSWORD`, `CORS_ORIGINS`, `PUSH_ENABLED`, `VAPID_*`, `SENTRY_*`, `GOGOV_*`, `HANDOFF_PROVIDER`, `OSM_NOTES_*`, `ROUTING_URL`, and the rest read in `server/config.ts`) | environment variables | `server/config.ts`, `fly.toml` | server | A rename reads the old name as a fallback for one release and says so in the CHANGELOG |
| `VITE_API_BASE`, `VITE_TILE_URL`, `VITE_PUBLIC_DASHBOARD`, `VITE_PUSH_ENABLED` | build-time environment variables | `src/config.ts` | web client | Same as the server variables |
| `davis-bike-hazard-map` | Fly.io app name and `davis-bike-hazard-map.fly.dev` host | `fly.toml`, `third-party-scripts.json` | operator | Changing it changes the public URL; it needs a redirect plan first |
