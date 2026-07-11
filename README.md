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
- **Saved-route push alerts (flagged):** save an area or route and get a web-push notification when a new hazard appears on it (server matcher + subscription API are complete; turning on delivery needs VAPID keys — see below).
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
- **Metrics & alerting:** `GET /api/metrics` (Prometheus text) exposes `dbhm_moderation_queue_depth` and `dbhm_oldest_pending_age_seconds`. Moderation backlog is the signal to watch against the 48 h SLA — example alert rules in [`docs/ops/prometheus-alerts.yml`](./docs/ops/prometheus-alerts.yml).
- **Deploy:** containerised via the [`Dockerfile`](./Dockerfile) (`docker compose up --build` for a local Postgres + app stack on :8787). A [`fly.toml`](./fly.toml) is included for Fly.io — `fly postgres create && fly postgres attach` wires `DATABASE_URL`, then set `SESSION_SECRET` + the bootstrap moderator and `fly deploy`.
- **Moderator accounts:** each moderator signs in with a username + password (Moderate tab) and gets an expiring session token; the audit trail records who approved/rejected each report. Rotate `SESSION_SECRET` to invalidate all sessions; change a password by re-seeding `MODERATOR_PASSWORD` (or via the DB).
- **311 down?** Hand-off degrades gracefully (returns a dry-run result, never throws) — the app keeps working; retry later.
- **Map tiles:** OpenStreetMap. If tile usage gets heavy, self-host tiles and set `VITE_TILE_URL`.
- **Routing backend:** the planner proxies an OSRM cycling server (`ROUTING_URL`, default the public OSRM demo). The demo server is rate-limited and best-effort — **self-host `osrm-backend` for production** and point `ROUTING_URL` at it. With no backend reachable the API returns a straight-line fallback (no turn-by-turn) so the feature never hard-fails.
- **311 status sync-back:** two paths, both graceful/dry-run by default. Pull — a moderator hits *Sync* (`POST /api/moderation/:id/handoff/sync`), which polls `GOGOV_STATUS_URL`. Push — 311 (or a shim) POSTs `/api/handoff/webhook` with the hazard's reference + status, authenticated by `GOGOV_WEBHOOK_SECRET` (the webhook is **disabled with 503** until that secret is set). A "fixed/closed" status resolves the hazard and coarsens its stored location.
- **Push alerts:** server-side matching, subscription storage (in-memory; a Postgres table is the documented next step), and dry-run delivery ship behind `PUSH_ENABLED`. To actually deliver: generate a VAPID pair (`npx web-push generate-vapid-keys`), set `PUSH_ENABLED=true` + `VAPID_*`, add a `push`/`notificationclick` handler to the service worker, and wire the `web-push` transport into `server/lib/pushNotify.ts` (`PushSender`). Until then subscriptions are accepted only when enabled and matches are logged, not sent.
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

## For Claude Code
- **Build entrypoint:** [`docs/ROADMAP.md`](./docs/ROADMAP.md) → *Implementation Plan*; what was built is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- **Hard guardrails:** **strip EXIF and offer face/plate blurring on every photo before upload** (privacy is a gate); the map must be usable on mobile data and offline; moderation exists before launch (no unmoderated public photo feed); GIS stays free via OpenStreetMap; accessibility is a gate (the map has a non-map list view).
- **Commands:** `make dev` · `make verify` · `make a11y` · `make e2e`.
- **Definition of done:** a Davis cyclist can install the PWA, file a hazard offline, see it on the map after sync, and (optionally) push it to 311 — functionally met; see the gates table above and [`docs/audits/`](./docs/audits/). Standards conformance: see the table below — gaps are tracked, not hidden.

## Standards
Inherits [`/STANDARDS`](../STANDARDS/). Responsible-tech findings are committed in [`docs/RESPONSIBLE-TECH-AUDITS.md`](./docs/RESPONSIBLE-TECH-AUDITS.md) and [`docs/audits/`](./docs/audits/).

### Standards Conformance
Per `/STANDARDS/README.md` §"How a repo declares conformance," every standard gets an explicit
row: **Applies** (with the honest state and where the gap is tracked) or **N/A** (with a reason).
Silent omission is itself a defect, so this table exists even though it shows real gaps rather than
a clean sweep. Full evidence: the 2026-07-05 conformance audit,
[`audit-2026-07-05/davis-bike-hazard-map-AUDIT.md`](../audit-2026-07-05/davis-bike-hazard-map-AUDIT.md)
(≈48% weighted conformance), and the corresponding
[`audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md`](../audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md)
(work plan + live execution status per item). Regenerate this table whenever a re-audit lands.

| Standard | Applies? | State | Gap tracking |
|---|---|---|---|
| QUALITY-AND-METRICS | Applies | Partial (coverage/e2e/a11y gated; DORA ledger, perf budgets, PR-template DoD owed) | REMEDIATION.md P2-4, P3 |
| CODE-QUALITY | Applies (TS/frontend sections; Python-only controls N/A) | Partial (strict TS + ESLint recommended in place; strictTypeChecked, Prettier, size-limit, ADR extraction owed) | REMEDIATION.md P1-3, P1-4, P1-6, P2-3 |
| SECURITY-AND-SUPPLY-CHAIN | Applies (ships code + container) | Partial (SHA-pinned actions, Trivy, npm audit, gitleaks CI all blocking; ASVS now declared — see Responsible-Tech §F; SBOM/signing, Scorecard, scheduled TruffleHog owed) | REMEDIATION.md P1-7, P2-1 |
| CI-CD | Applies (5 workflows) | Partial (single ordered `ci.yml`, least-privilege `permissions:` blocks, concurrency groups all in place; **branch protection/rulesets absent — see below**, CODEOWNERS added 2026-07-05, zizmor owed) | REMEDIATION.md P0-2 (BLOCKED, manual), P1-2 |
| RELEASE-AND-VERSIONING | Applies — **no releases yet**; pipeline intent: tagged betas `vX.Y.Z` once cut, deployed image maps to tag | Gap (zero tags, `CHANGELOG.md` added 2026-07-05, SBOM/signing/release workflow not yet built) | REMEDIATION.md P2-1 |
| ACCESSIBILITY | Applies (frontend emitting HTML; repo-stated gate) | Partial (axe + Lighthouse a11y merge-blocking, WCAG 2.2 AA tagged; ACR/VPAT, dated SR-matrix, reading-level gate owed) | REMEDIATION.md P2-5, P3 |
| OBSERVABILITY | Applies (Server → Tier A, PWA → Tier B — see `## Observability` above, declared 2026-07-05) | Partial (probes/metrics/logging solid; OTel spans, SLO yaml, RUM beacon owed) | REMEDIATION.md P1-9, P2-7, P3 |
| INTERNATIONALIZATION | Applies (explicitly in-scope, STANDARDS §1/§11) | Strongest standard in the repo (see [`docs/I18N.md`](./docs/I18N.md)) — **catalog + gates exist only on the unmerged `i18n-catalog-retrofit` branch as of 2026-07-05**, not on `main`; Spanish translation still skeleton-only (documented deferral) | REMEDIATION.md P1-1 (merge decision — not automated, see Execution Log), P2-6 |
| AI-EVALUATION | **N/A** — no LLM SDK, no AI/agent code paths anywhere in `package.json` or `src/`/`server/` (verified 2026-07-05) | N/A | — |
| DOCUMENTATION | Applies | Partial (this table + `CHANGELOG.md` close two gaps as of 2026-07-05; ADRs still inline in `ARCHITECTURE.md` rather than `docs/adr/`, currency stamps incomplete) | REMEDIATION.md P2-3, P3 |
| RESPONSIBLE-TECH-FRAMEWORK | Applies | Strong (ethics/bias/privacy/transparency sign-offs committed in `docs/RESPONSIBLE-TECH-AUDITS.md` + `docs/audits/`; ASVS level now declared §F; audit artifacts dated 2026-05-31, predate the June feature wave — regeneration owed) | REMEDIATION.md P2-2 |

**Branch protection / rulesets (CI-CD, CODE-QUALITY):** `main` currently has no branch protection
and no rulesets configured on GitHub (verified by API at audit time: `.../branches/main/protection`
→ 404, `.../rulesets` → `[]`), so every merge-blocking CI gate above is advisory, not enforced —
direct push, force-push, and self-merge are all technically possible. This is a live GitHub setting
outside this repo's files; see `audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md` P0-2 for the
exact decision and commands needed (repo-visibility/plan choice, then a ruleset). **BLOCKED pending
a maintainer decision** — not something a code change can fix.
