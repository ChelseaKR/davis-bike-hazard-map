# Davis Bike Hazard Map

**A crowdsourced cycling-hazard map for Davis** — report a pothole, broken glass, blocked lane, or dangerous intersection from your phone in seconds (photo + location + category + severity), see a live map of what others have flagged, route around the bad spots, and optionally hand the report off to the city's 311/GOGov system. Built as an offline-capable PWA for use on a bike, in a town that calls itself the bike capital of the US.

**Status:** `Beta` · **Track:** Civic (shippable product) · **License:** MIT · **Data:** open

> **Running the private beta?** See [`BETA.md`](./BETA.md) for one-time provisioning, the preview link, and what to watch.

## Why it matters
Davis cyclists hit the same hazards repeatedly; the city's 311 is underused and reports vanish into a queue. A fast, public, local map turns scattered private frustration into shared, actionable, open data — and is the kind of tangible civic thing real neighbors will actually use.

## What it does
- **Report in seconds:** category, severity, photo (EXIF stripped, faces/plates blurrable), auto-location; works offline and syncs later.
- **Live hazard map:** clustered, filterable by type/severity/recency; lightweight enough for mobile data.
- **Map + list parity:** a fully accessible, non-map list view shows the exact same data.
- **Hazard-avoiding route planner:** pick a start + end and get a cycling route that steers around reported hazards (weighted by severity + recency), as both a map polyline and an equivalent turn-by-turn list. Routes via an OSRM cycling backend, proxied through our API so the browser stays same-origin and the plan is offline-cacheable; degrades to a straight-line fallback with no connection.
- **Lifecycle + 311 status sync-back:** hazards move through *reported → confirmed → resolved* (surfaced as a badge on the map/list), and a report handed off to GOGov/311 carries its status back — when the city marks it fixed, the hazard resolves and lingers briefly (greyed) so a fix is *visible*, not just an absence.
- **311 hand-off (optional):** forward an approved report to Davis's GOGov/311 with the same payload.
- **Saved-route push alerts (flagged):** save an area or route and get a web-push notification when a new hazard appears on it. The matcher, Postgres subscription store, service-worker notification handlers, and real `web-push` delivery all ship behind `PUSH_ENABLED`; turning delivery on is just the flag + a VAPID key pair — see below.
- **Public read-only dashboard:** a no-auth, read-only deployment mode (map/list/coverage/route only) for graduating the private beta — `VITE_PUBLIC_DASHBOARD=true`.

## Quickstart

```bash
make install        # install dependencies
make dev            # client (Vite, :5173) + API server (:8787) with hot reload
# open http://localhost:5173  — dev moderator login is admin / admin (printed to the log)
```

Other entrypoints:

```bash
make verify         # lint + typecheck + unit/integration tests + build (the merge gate)
make a11y           # accessibility tests (axe)
make e2e            # end-to-end tests (offline capture→sync + full-page a11y); run `make e2e-install` once first
make build          # production build of the PWA
make start          # run the server (serves the built client + API) in production mode
make seed           # load a first pass of demo hazards into ./data/hazards.json
make help           # list all targets
```

Configuration is via environment variables — see [`.env.example`](./.env.example). The app runs with all defaults unset (in-memory store, a dev moderator account admin/admin).

## Project layout

```
shared/   Framework-free domain model + validation + geo/EXIF logic (client ⇆ server)
src/      Vite + React + TS PWA (capture, photo privacy editor, map, list, offline queue, sync)
server/   Fastify API (intake, moderation, lifecycle, 311 hand-off) + serves the built client
tests/    Vitest unit/integration/a11y (tests/unit) + Playwright e2e (tests/e2e)
docs/     ROADMAP, ARCHITECTURE (incl. ADRs), and committed responsible-tech audits/
```

## Testing & gates

| Gate | Command | Enforces |
|------|---------|----------|
| Lint + typecheck | `make verify` | TS strict, ESLint clean |
| Unit + integration | `make verify` | 200+ tests (incl. Postgres adapter when `TEST_DATABASE_URL` is set); coverage ≥ 80% lines/fns, ≥ 75% branches on core logic |
| EXIF / privacy | (in unit + server tests) | photos are EXIF-clean; precise location never public |
| Accessibility | `make a11y` + `make e2e` | zero axe violations (component + full-page incl. contrast) |
| Offline → sync | `make e2e` | file offline → syncs → moderated → on the map |
| Security | CI | `npm audit` (high/critical), gitleaks secret scan |

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs the same gates on every push/PR. A **pre-commit hook** (husky + lint-staged) runs ESLint on staged files locally. The HTTP API is described by an **OpenAPI spec** at `GET /api/openapi.json`, and every endpoint is also reachable under the versioned alias `/api/v1/*`.

## Operations (2 a.m. runbook)

- **Run it:** `SESSION_SECRET=… DATABASE_URL=postgresql://… MODERATOR_USERNAME=… MODERATOR_PASSWORD=… make start` (production serves the built client + API on `PORT`, default 8787). `SESSION_SECRET` and `DATABASE_URL` are **required** in production — the server refuses to start without them; the bootstrap moderator is created on first boot. (Dev can omit `DATABASE_URL` and falls back to `DATABASE_PATH`/in-memory with an admin/admin account.)
- **Health:** `GET /api/health` → `{ "status": "ok" }`. Put this behind your uptime check.
- **Data (production):** PostgreSQL at `DATABASE_URL` (schema auto-created on boot; safe for multiple processes). Use your provider's managed backups / `pg_dump`.
- **Data (dev fallback):** a single JSON file at `DATABASE_PATH`, written atomically (temp + rename). ⚠️ **Single-process only** — never run two instances against one file (there is no cross-process lock; concurrent writes corrupt it). The server takes **automatic timestamped snapshots** every `BACKUP_INTERVAL_HOURS` (default 6) into `BACKUP_DIR` (default `backups/` beside the data file), keeping the newest `BACKUP_RETAIN` (default 14). To restore, stop the server, copy a snapshot over `DATABASE_PATH`, restart. Photo bytes live separately in a `photos/` dir beside the data file (kept out of the JSON to keep it small) — back that dir up too. (Still copy snapshots off-box for disaster recovery.)
- **Auth throttling (single instance):** the per-account login lockout (5 misses → 15 min lock, bounded in memory — `server/lib/loginThrottle.ts`) and the `@fastify/rate-limit` per-IP counters live in **process memory**, so they are **per-instance**. ⚠️ Run exactly **one app instance** — scaling out (e.g. `fly scale count 2`) silently divides these brute-force mitigations across instances. Before scaling beyond one instance, move both counters to a shared store (a Postgres `auth_throttle` table or Redis) first.
- **Metrics & alerting:** `GET /api/metrics` (Prometheus text) exposes `dbhm_moderation_queue_depth`, `dbhm_oldest_pending_age_seconds`, and `dbhm_handoff_failures_total` (failed 311 forward attempts, R3). Moderation backlog is the signal to watch against the 48 h SLA — example alert rules in [`docs/ops/prometheus-alerts.yml`](./docs/ops/prometheus-alerts.yml).
- **Deploy:** containerised via the [`Dockerfile`](./Dockerfile) (`docker compose up --build` for a local Postgres + app stack on :8787). A [`fly.toml`](./fly.toml) is included for Fly.io — `fly postgres create && fly postgres attach` wires `DATABASE_URL`, then set `SESSION_SECRET` + the bootstrap moderator and `fly deploy`.
- **Moderator accounts:** each moderator signs in with a username + password (Moderate tab) and gets an expiring session token; the audit trail records who approved/rejected each report. Rotate `SESSION_SECRET` to invalidate all sessions; change a password by re-seeding `MODERATOR_PASSWORD` (or via the DB).
- **311 down?** Hand-off degrades gracefully (returns a dry-run result, never throws) — the app keeps working. A failed real transport now leaves a delivery receipt and retries automatically on an exponential schedule (5 min doubling, capped 6 h, 6 attempts); exhausted hand-offs surface as dead letters in the moderation panel (`GET /api/moderation/handoff-failures`) for a manual re-send (R3).
- **Map tiles:** OpenStreetMap. If tile usage gets heavy, self-host tiles and set `VITE_TILE_URL`.
- **Routing backend:** the planner proxies an OSRM cycling server (`ROUTING_URL`, default the public OSRM demo). The demo server is rate-limited and best-effort — **self-host `osrm-backend` for production** and point `ROUTING_URL` at it. With no backend reachable the API returns a straight-line fallback (no turn-by-turn) so the feature never hard-fails.
- **311 status sync-back:** two paths, both graceful/dry-run by default. Pull — a moderator hits *Sync* (`POST /api/moderation/:id/handoff/sync`), which polls `GOGOV_STATUS_URL`. Push — 311 (or a shim) POSTs `/api/handoff/webhook` with the hazard's reference + status, authenticated by `GOGOV_WEBHOOK_SECRET` (the webhook is **disabled with 503** until that secret is set). A "fixed/closed" status resolves the hazard and coarsens its stored location.
- **311 hand-off provider:** `HANDOFF_PROVIDER` selects between the bespoke `gogov` adapter (default, `GOGOV_*` above) and a vendor-neutral **Open311 GeoReport v2** adapter (`open311`, `OPEN311_*`; `server/lib/open311.ts`) — switching is config-only, no code change. Whichever provider a hazard was handed off with is recorded on it and reused for every later status sync, so an in-flight hand-off survives a later provider switch.
- **Push alerts:** shipped behind `PUSH_ENABLED` — server-side matching, durable subscription storage (Postgres `push_subscriptions` when `DATABASE_URL` is set, in-memory otherwise), the service worker's `push`/`notificationclick` handlers (`public/push-sw.js`), and real encrypted delivery via `web-push` (`server/lib/pushNotify.ts`). To turn delivery on: generate a VAPID pair (`npx web-push generate-vapid-keys`) and set `PUSH_ENABLED=true`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (and optionally `VAPID_SUBJECT`); the boot log states which mode is active. Without keys the matcher still runs in dry-run (matches are logged, not sent). Subscriptions the push service reports gone (HTTP 404/410) are pruned automatically.
- **Public dashboard:** deploy with `VITE_PUBLIC_DASHBOARD=true` for a read-only public map (no report/moderation UI). Seed demo data first so the map isn't empty: `DATABASE_PATH=./data/hazards.json make seed` (or run `make seed` against your `DATABASE_URL`); seeds are clearly fictional (see `scripts/seed.ts`).

## Observability
Per `/STANDARDS/OBSERVABILITY-STANDARD.md`, tier is declared explicitly rather than left implicit:

- **Server (Fastify + Postgres): Tier A.** In place: `/livez` + `/readyz` (fail-closed, contract
  tested), structured JSON logs (Pino, redaction-tested), Prometheus metrics
  (`dbhm_moderation_queue_depth`, `dbhm_oldest_pending_age_seconds`, RED-shaped HTTP histogram),
  Sentry error + trace sampling. **Gaps tracked:** no OpenTelemetry SDK/spans yet (no trace
  correlation, no `trace_id`/`span_id` in logs), no `slos/*.yaml` + burn-rate alerts yet (the 48h
  moderation SLA exists de facto with metrics/alert rules in
  [`docs/ops/prometheus-alerts.yml`](./docs/ops/prometheus-alerts.yml) but isn't a declared SLO
  document).
- **PWA (client): Tier B.** In place: Lighthouse CI lab budgets (accessibility blocking; perf/byte-
  weight advisory), client error reporting (`src/lib/telemetry.ts`). **Gap tracked:** no RUM/
  web-vitals field beacon (OBS-26).

Dated: 2026-07-05. See the Standards Conformance table below (§Standards) for the OBSERVABILITY row.

## Guardrails

Non-negotiables, each enforced as a tested gate rather than a promise:

- **Photo privacy first.** Every photo is stripped of EXIF metadata before upload, with
  face/license-plate blurring offered at capture time; precise report locations are never
  exposed publicly.
- **Nothing public without moderation.** A report appears on the map only after a
  moderator approves it — there is no unmoderated public photo feed.
- **Usable on a bike.** The app stays usable on mobile data and fully offline; reports
  queue and sync when a connection returns.
- **Accessible by default.** Accessibility is a merge-blocking gate, and the map always
  has an equivalent non-map list view.
- **Open mapping.** GIS stays free and open via OpenStreetMap.

Agent-facing build instructions live in [`CLAUDE.md`](./CLAUDE.md).

## Standards
Inherits [`/STANDARDS`](../STANDARDS/). Responsible-tech findings are committed in [`docs/RESPONSIBLE-TECH-AUDITS.md`](./docs/RESPONSIBLE-TECH-AUDITS.md) and [`docs/audits/`](./docs/audits/).

### Standards Conformance
Per `/STANDARDS/README.md` §"How a repo declares conformance," every standard is
explicitly scoped. Project-specific evidence lives here; shared requirements
remain in `/STANDARDS`. This declaration was verified on 2026-07-11.

| Standard | State | Project-specific evidence |
|---|---|---|
| Responsible-Tech Framework | Applies | [`docs/RESPONSIBLE-TECH-AUDITS.md`](./docs/RESPONSIBLE-TECH-AUDITS.md) and dated artifacts under [`docs/audits/`](./docs/audits/) |
| Code Quality | Applies | Strict TypeScript, ESLint/stylelint, coverage-gated Vitest, `make verify`, and the MADR log under [`docs/adr/`](./docs/adr/) |
| Security & Supply-Chain | Applies | ASVS declaration, SHA-pinned Actions, blocking CodeQL/npm-audit/gitleaks/Trivy, and signed/SBOM-attested release workflow |
| CI/CD | Applies | Least-privilege workflows, CODEOWNERS, committed [`main` ruleset](./docs/ops/branch-ruleset.json), and local/CI `make verify` parity |
| Release & Versioning | Applies | SemVer package metadata, Keep-a-Changelog file, and tag-triggered build/scan/SBOM/sign/provenance/boot verification; no release tag has been cut yet |
| Accessibility | Applies | WCAG 2.2 AA axe and Lighthouse gates, map/list parity, and dated accessibility and screen-reader artifacts |
| Observability | Applies | Tier A server and Tier B PWA declaration, liveness/readiness probes, structured redacted logs, Prometheus metrics, Sentry, and cookieless Web Vitals |
| Performance | Applies | Blocking Lighthouse job with explicit budgets in [`lighthouserc.json`](./lighthouserc.json); service load-baseline expansion remains release-scoped |
| Internationalization | Applies | FormatJS catalogs in `src/i18n/locales`, extraction/parity/BCP-47/CLDR/logical-CSS gates, and pseudolocale browser coverage; reviewed Spanish copy is still required before Spanish is enabled |
| AI Evaluation | N/A — no prompt, model, retrieval, or agent surface exists in this application | Applicability registry sets `llm: false` |
| Documentation | Applies | Root operator/contributor/security/release docs, docs index/scope/audit, and sequential ADR log |
| Quality & Metrics | Applies | Coverage thresholds, accessibility/e2e/security gates, project metrics ledger in [`docs/ROADMAP.md`](./docs/ROADMAP.md), and the attached PR Definition of Done |
| Incident Response | Applies | Severity/label conventions and secret-response procedure inherit from `/STANDARDS`; project security reporting and operational recovery are documented in [`SECURITY.md`](./SECURITY.md) and [`BETA.md`](./BETA.md) |
| Data Governance | Applies | L2 precise-location/photo handling, minimization, EXIF stripping, retention/GC, coarsened public exports, PostgreSQL backup expectations, and privacy artifacts |

The live `protect-main` ruleset blocks force-pushes and deletion and requires the
documented status checks. [`docs/ops/branch-ruleset.json`](./docs/ops/branch-ruleset.json)
is the recovery/import mirror; verify live enforcement before changing it.
