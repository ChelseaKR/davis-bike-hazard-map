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
- **311 hand-off (optional):** forward an approved report to Davis's GOGov/311 with the same payload.
- **Lifecycle:** hazards can be confirmed, marked resolved, and expire, so the map stays trustworthy.

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

CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)) runs the same gates on every push/PR.

## Operations (2 a.m. runbook)

- **Run it:** `SESSION_SECRET=… DATABASE_URL=postgresql://… MODERATOR_USERNAME=… MODERATOR_PASSWORD=… make start` (production serves the built client + API on `PORT`, default 8787). `SESSION_SECRET` and `DATABASE_URL` are **required** in production — the server refuses to start without them; the bootstrap moderator is created on first boot. (Dev can omit `DATABASE_URL` and falls back to `DATABASE_PATH`/in-memory with an admin/admin account.)
- **Health:** `GET /api/health` → `{ "status": "ok" }`. Put this behind your uptime check.
- **Data (production):** PostgreSQL at `DATABASE_URL` (schema auto-created on boot; safe for multiple processes). Use your provider's managed backups / `pg_dump`.
- **Data (dev fallback):** a single JSON file at `DATABASE_PATH`, written atomically (temp + rename). ⚠️ **Single-process only** — never run two instances against one file (there is no cross-process lock; concurrent writes corrupt it). The server takes **automatic timestamped snapshots** every `BACKUP_INTERVAL_HOURS` (default 6) into `BACKUP_DIR` (default `backups/` beside the data file), keeping the newest `BACKUP_RETAIN` (default 14). To restore, stop the server, copy a snapshot over `DATABASE_PATH`, restart. Photo bytes live separately in a `photos/` dir beside the data file (kept out of the JSON to keep it small) — back that dir up too. (Still copy snapshots off-box for disaster recovery.)
- **Metrics & alerting:** `GET /api/metrics` (Prometheus text) exposes `dbhm_moderation_queue_depth` and `dbhm_oldest_pending_age_seconds`. Moderation backlog is the signal to watch against the 48 h SLA — example alert rules in [`docs/ops/prometheus-alerts.yml`](./docs/ops/prometheus-alerts.yml).
- **Deploy:** containerised via the [`Dockerfile`](./Dockerfile) (`docker compose up --build` for a local Postgres + app stack on :8787). A [`fly.toml`](./fly.toml) is included for Fly.io — `fly postgres create && fly postgres attach` wires `DATABASE_URL`, then set `SESSION_SECRET` + the bootstrap moderator and `fly deploy`.
- **Moderator accounts:** each moderator signs in with a username + password (Moderate tab) and gets an expiring session token; the audit trail records who approved/rejected each report. Rotate `SESSION_SECRET` to invalidate all sessions; change a password by re-seeding `MODERATOR_PASSWORD` (or via the DB).
- **311 down?** Hand-off degrades gracefully (returns a dry-run result, never throws) — the app keeps working; retry later.
- **Map tiles:** OpenStreetMap. If tile usage gets heavy, self-host tiles and set `VITE_TILE_URL`.

## For Claude Code
- **Build entrypoint:** [`docs/ROADMAP.md`](./docs/ROADMAP.md) → *Implementation Plan*; what was built is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
- **Hard guardrails:** **strip EXIF and offer face/plate blurring on every photo before upload** (privacy is a gate); the map must be usable on mobile data and offline; moderation exists before launch (no unmoderated public photo feed); GIS stays free via OpenStreetMap; accessibility is a gate (the map has a non-map list view).
- **Commands:** `make dev` · `make verify` · `make a11y` · `make e2e`.
- **Definition of done:** a Davis cyclist can install the PWA, file a hazard offline, see it on the map after sync, and (optionally) push it to 311 — with all `/STANDARDS` gates green. ✅ Met; see the gates table above and [`docs/audits/`](./docs/audits/).

## Standards
Inherits [`/STANDARDS`](../STANDARDS/). Responsible-tech findings are committed in [`docs/RESPONSIBLE-TECH-AUDITS.md`](./docs/RESPONSIBLE-TECH-AUDITS.md) and [`docs/audits/`](./docs/audits/).
