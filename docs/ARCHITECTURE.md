# Architecture

> Companion to [`ROADMAP.md`](./ROADMAP.md). This describes what was *built*; the
> roadmap describes what was *specified*. Where the two diverge, the ADRs at the
> bottom record why.
> **Last verified: 2026-05-31 · Recheck cadence: per major dependency change.**

## Shape

A single repository with three coordinated parts:

```
shared/    Framework-free domain model, validation (zod), geo + EXIF logic
           used identically by client and server (one source of truth).
src/       Vite + React + TypeScript PWA (capture, map, list, offline queue).
server/    Fastify API (intake, moderation, lifecycle, 311 hand-off) that also
           serves the built client in production.
```

```
 Phone (PWA)                         Server (Fastify)
 ┌───────────────┐  POST /reports    ┌──────────────────────────────┐
 │ ReportForm    │ ───────────────▶  │ validate → EXIF strip backstop│
 │  EXIF strip   │  (when online)    │  → fuzz location → status=    │
 │  + blur       │                   │    pending (moderation gate)  │
 │  IndexedDB ◀──┼─ offline queue    │                              │
 │  queue        │                   │ Moderation (auth) approve ──▶ │
 │ MapView/List ◀┼─ GET /hazards ──  │ public feed (approved, fuzzed)│
 └───────────────┘                   │ 311 hand-off (opt-in, precise)│
   Service Worker                    └──────────────────────────────┘
   (app shell + tile + API cache)        JSON file store (atomic)
```

## Data model

- **`StoredHazard`** (server-internal): keeps `preciseLocation` (only ever used
  for an opt-in 311 hand-off) and the EXIF-stripped `photo` bytes. Never exposed.
- **`Hazard`** (public projection): carries the grid-snapped `publicLocation` and
  a `photoUrl` that resolves only for **approved** hazards.
- Lifecycle: `pending → approved → (confirmed*) → resolved | expired`, or
  `pending → rejected`. Expiry is lazy-swept before every public read.

## Privacy controls (defense in depth)

1. **Client EXIF strip** (`shared/exif.ts`) before the photo is queued or shown.
2. **Canvas re-encode + manual/auto blur** (`PhotoEditor`) bakes redactions in.
3. **Server EXIF strip backstop** on intake — never trusts the client.
4. **Location fuzzing** (`shared/geo.ts`) snaps every public coordinate to a
   ~70 m grid; the precise point never leaves the server except in an opt-in
   311 hand-off the user explicitly triggers.
5. **Moderation gate**: nothing is public, and no photo is servable, until a
   moderator approves it.

## Offline-first

- Reports are written to **IndexedDB** first (`src/lib/db.ts`); submission is
  idempotent on a client-generated UUID, so retries never duplicate.
- A **background sync loop** (`src/lib/sync.ts`) drains the queue on an interval
  and on the `online` event, with bounded retries and permanent-vs-transient
  error classification.
- A **service worker** (vite-plugin-pwa / Workbox) caches the app shell, OSM
  tiles (cache-first, capped), and the hazard API (network-first) so the last
  view works offline.

## Accessibility

- The **List view** is a full, keyboard- and screen-reader-operable equivalent
  of the map and renders the exact same filtered dataset (parity gate).
- Severity is conveyed by **shape + text + colour**, never colour alone.
- Automated axe gates run at two levels: component-level (jsdom, WCAG A/AA) in
  unit tests and full-page (real browser, incl. colour-contrast) in Playwright.

## Architecture Decision Records (ADRs)

These record where the build deviated from the roadmap, and why.

- **ADR-1 — Leaflet + raster OSM tiles instead of MapLibre GL.** Rationale:
  raster OSM tiles need no style server or vector pipeline, keeping the app free
  and trivially offline-cacheable on mobile data; Leaflet + markercluster covers
  clustering/filtering with a small footprint. *Rejected MapLibre GL:* heavier,
  and vector tiles add hosting/cost without a v1 benefit here.
- **ADR-2 — PostgreSQL as the production store; JSON-file for dev; one async
  `Repository` interface.** The store is selected by env: `DATABASE_URL` →
  `PostgresRepository` (required in production), else `DATABASE_PATH` →
  single-process `JsonFileRepository`, else in-memory. Postgres gives
  multi-process safety, indexed reads, bounding-box pushdown for the public
  feed, and managed backups; the JSON store stays for zero-dependency local
  dev. *Plain Postgres, not PostGIS:* the only spatial query is a bounding box,
  which `lat/lng BETWEEN` on btree-indexed columns answers — PostGIS would add
  an extension dependency for no current benefit and can be layered on later
  (radius/polygon queries) behind the same interface. *Update from the original
  ADR-2,* which deferred Postgres entirely; the async refactor that enabled it
  also kept the JSON store working unchanged for dev.
- **ADR-3 — Manual region blur as the floor, automatic face detection as
  progressive enhancement.** Rationale: manual blur works fully offline with no
  ML model and never silently misses a face; the experimental `FaceDetector`
  API pre-seeds boxes when present. *Rejected ML-only auto-blur:* a missed face
  is a privacy failure, and bundling a model bloats the mobile critical path.
- **ADR-4 — Moderator-triggered 311 hand-off (not reporter-triggered), dry-run
  by default.** Rationale: least privilege and spam-resistance — only an
  approved hazard is forwarded, by a moderator, and with no webhook configured
  the adapter degrades to a dry run so the system never depends on a live 311.
- **ADR-5 — Route planning proxies an OSRM backend server-side; hazard
  avoidance is a re-ranking layer, not a custom router.** Rationale: bundling a
  road graph for true offline routing is far too heavy for a mobile PWA, and
  hitting an external router from the browser would break the `'self'` CSP and
  the offline cache. So the server proxies OSRM (`/api/route`), and the
  *hazard-aware* part lives in a small, pure re-ranking module
  (`shared/routing.ts`): fetch OSRM's candidate routes, score each by proximity
  to reported hazards (severity × recency × confirmations, falling off across a
  corridor), and pick the lowest-cost one. With no backend reachable it returns
  a straight-line fallback so the feature degrades instead of failing. *Rejected
  a self-hosted full offline router* (bundle size) *and a direct browser→OSRM
  call* (CSP + cache).
- **ADR-6 — Lifecycle is a derived projection; resolved hazards linger; 311
  status syncs back over an authenticated webhook.** Rationale: the public
  *reported → confirmed → resolved* stage is computed from the existing
  moderation `status` + confirmation count (`lifecycleStage`), so the moderation
  gate's invariants and tests are untouched — no new enum to keep consistent.
  Recently-resolved hazards stay briefly visible (greyed) so a *fix* is shown,
  not just an absence. Status sync-back is graceful/dry-run by default, with the
  inbound webhook disabled until a shared secret is set (never accept
  unauthenticated status writes).
- **ADR-7 — Saved-route push alerts: real matcher + subscription API now,
  flagged delivery.** Rationale: the testable, civic-valuable core — geometric
  matching of a new hazard against saved areas/route corridors, plus
  subscription storage and a moderation-approval hook — is implemented and
  tested. Actual Web Push needs VAPID keys, a service-worker `push` handler, and
  the `web-push` transport, which are operational infra, so delivery ships
  behind `PUSH_ENABLED` and dry-runs (logging matches) until wired. *Rejected
  shipping a half-working push path* that would degrade the PWA's offline story.
- **ADR-8 — `FLY_API_TOKEN` as a long-lived deploy secret (waiver), not GitHub
  OIDC.** Dated 2026-07-05. CI-CD-STANDARD §8 wants cloud credentials via
  short-lived GitHub OIDC federation, not a long-lived repo secret. Fly.io does
  not offer a GitHub OIDC trust relationship (no equivalent of AWS's
  `sts:AssumeRoleWithWebIdentity`/`id-token: write` flow), so this control
  cannot be met literally. **Waiver:** `FLY_API_TOKEN` stays a repo secret,
  scoped to a **deploy-only** Fly token (`fly tokens create deploy -a
  davis-bike-hazard-map`, not an org/personal token) rather than a full-access
  token, consumed only by `deploy.yml`'s single job with no other write scope.
  **Rotation cadence:** rotate at minimum every 90 days and immediately on any
  suspected exposure; track the rotation date here or in a follow-up dated
  note. **Compensating controls:** the secret is never printed/echoed, the
  deploy job requests no other permissions, and (once configured — see below)
  the job runs under a GitHub Environment so a compromised workflow file still
  can't deploy without going through the environment gate. *Owed:* actually
  configuring the `production` environment's required reviewer is a live
  GitHub setting, not a file change — tracked in
  `audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md` P1-8.
