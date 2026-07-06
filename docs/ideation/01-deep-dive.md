# Deep dive — current state as read on 2026-07-01

Read on branch `i18n-catalog-retrofit` (clean tree, HEAD `2faf788`). This is an
assessment from the code, not from the docs' claims — though the two agree far
more often than is typical.

## Architecture summary

Three coordinated parts in one repo, exactly as `docs/ARCHITECTURE.md` says:

- **`shared/`** — framework-free domain core used identically by client and
  server: the domain model and derived lifecycle projection
  (`shared/types.ts`), zod validation incl. the Davis bounding-box policy
  (`shared/validation.ts`), deterministic ~70 m grid fuzzing + haversine
  (`shared/geo.ts`), EXIF handling (`shared/exif.ts`), pure hazard-aware route
  scoring (severity × recency × confirmations falling off across a corridor,
  `shared/routing.ts`), and geometric alert matching (`shared/alerts.ts`).
- **`server/`** — a Fastify app factory (`server/app.ts`, 665 lines) that takes
  all dependencies (repo, clock, fetch, photo store, moderator store,
  subscription store, logger) as arguments so the whole HTTP surface is
  testable via `app.inject()`. Storage is a three-way `Repository` abstraction
  (`server/lib/repository.ts`): in-memory → atomic JSON file → Postgres
  (`server/lib/pgRepository.ts`, with `SELECT … FOR UPDATE` read-modify-write
  and versioned SQL migrations in `migrations/`). Photos live outside the row
  store (`server/lib/photoStore.ts`: memory / FS / S3-compatible). The 311
  adapter (`server/lib/gogov.ts`) and status mapping (`server/lib/lifecycle.ts`)
  degrade to dry-run without config; push alerts (`server/lib/pushNotify.ts`)
  match for real but deliver via a no-op sender until VAPID keys exist.
  Observability: RED metrics + queue gauges (`server/lib/metrics.ts`),
  `/livez` `/readyz`, structured JSON logs with a redaction list
  (`server/lib/logger.ts`), optional Sentry (`server/lib/sentry.ts`).
- **`src/`** — Vite + React PWA. Tabbed shell with no router
  (`src/App.tsx` + `src/hooks/useViewState.ts` hold all view state in memory);
  Leaflet lazy-loaded; offline queue in IndexedDB (`src/lib/db.ts`) drained by
  a visibility/online/interval-triggered sync loop (`src/lib/sync.ts`) with
  permanent-vs-transient error classification; client EXIF strip + manual/auto
  blur (`src/lib/exif.ts`, `src/lib/blur.ts`, `src/components/PhotoEditor.tsx`);
  coverage-equity view over six hard-coded area boxes (`src/lib/areas.ts`,
  `src/components/CoverageView.tsx`); react-intl catalog with an extensive
  gate battery (`scripts/i18n/*.mjs`, G1–G12 in CI).

**Tests:** ~50 unit/component/a11y suites in `tests/unit/` (including a
Postgres adapter suite gated on `TEST_DATABASE_URL`), Playwright e2e for
offline-capture→sync and full-page axe (`tests/e2e/`), and a pseudolocale
overflow suite (`tests/i18n/`). CI (`.github/workflows/ci.yml`) runs the same
gates on Node 20+22 with a Postgres service, plus Lighthouse (a11y
error-level), npm audit, gitleaks, CodeQL, Trivy, and a standards-fetch
workflow. Actions are SHA-pinned. WebKit e2e exists but is non-blocking and
currently broken on Linux CI (acknowledged in the workflow comment).

## What is genuinely strong

- **Privacy defense-in-depth is real, not aspirational.** Client strip →
  canvas re-encode with baked-in blur → authoritative server-side sharp
  re-encode with a pixel-bomb guard (`server/lib/image.ts`) → moderation gate →
  deterministic grid snap for every public coordinate → precise-location
  coarsening on every terminal state (`server/lib/hazards.ts:93-104`,
  `server/lib/lifecycle.ts:69-71`, `repository.expire`). The reasoning for
  snapping over jitter (can't be averaged back) in `shared/geo.ts` is correct.
- **Graceful degradation as a design language.** 311 hand-off, status polling,
  OSRM routing, and push delivery all dry-run or fall back rather than fail
  (`gogov.ts`, `server/lib/routing.ts`, `pushNotify.ts`) — the app never
  depends on infrastructure that doesn't exist yet, and says so.
- **The DI seam.** `buildApp(deps)` plus the pure modules in `shared/` is why
  the test suite can cover lifecycle, scoring, and the full HTTP surface
  without network/disk/clock. This is the repo's best structural asset.
- **Honesty in the UI and docs.** "No reports ≠ safe" is asserted by tests
  (`tests/unit/ListView.a11y.test.tsx` per `docs/audits/coverage-equity.md`);
  seeds are labeled fictional; the research pass loudly labels itself
  synthetic.

## Structural debt and gaps actually observed

Detailed as FIX items in `02-large-scale-fixes.md`; headlines, all verified in
source:

1. **The public feed leaks the deletion capability.** `toPublic()`
   (`server/lib/hazards.ts:140-158`) includes `clientId`, and
   `DELETE /api/reports/:clientId` (`server/app.ts:404-414`) treats `clientId`
   as the proof of ownership. Anyone can scrape `GET /api/hazards` and delete
   every report on the map. The client never needs other hazards' `clientId`
   (verified: `src/` only uses its own queued ids). This is the single most
   important finding of this pass. (FIX-01)
2. **The inbound 311 webhook trusts a static header secret and skips the
   hand-off check.** `POST /api/handoff/webhook` compares
   `x-gogov-signature` to the raw shared secret (no body HMAC, no timestamp,
   no replay protection) and — unlike the moderator-triggered sync route,
   which 409s — resolves *any* hazard by id, handed off or not
   (`server/app.ts:605-623`). (FIX-02)
3. **Photo bytes for rejected/expired hazards are never garbage-collected** —
   only reporter deletion removes blobs (`server/app.ts:410-413`). Rejected
   photos are disproportionately the ones containing PII. (FIX-03)
4. **In-process filtering and an all-rows moderation queue.** Category/
   severity/recency filters run in JS after the store returns rows
   (`server/app.ts:356-367`); `listModerationQueue` calls `repo.all()` and
   inlines every pending photo as a base64 data URL into one response
   (`server/lib/hazards.ts:204-213`). Fine at beta volume; a spam burst (the
   research pass's R6 scenario) makes the queue endpoint itself the bottleneck.
5. **No URL state.** Tabs, filters, and focused hazards live only in memory
   (`useViewState.ts`); there are no per-hazard permalinks, the back button
   does nothing, and the push payload can only deep-link to `'/'`
   (`pushNotify.ts:36`).
6. **Per-process auth state.** Login lockout is an unbounded in-process `Map`
   (`server/app.ts:213-215`) and rate-limit counters are per-instance —
   correctness degrades silently the day the Fly app scales to 2 machines.
7. **Hand-maintained OpenAPI** (`server/openapi.ts`) with no contract test
   binding it to the routes in `app.ts` — drift is a matter of time.
8. **Small doc/code mismatch in the fuzzing math**: `snap()` in
   `shared/geo.ts:54-56` computes `(Math.round(v/step)+0.5)*step`, which
   publishes a cell *edge* (max displacement ≈ one full grid step, ~70–100 m),
   while the comment says "centre of a fixed grid cell" (max ≈ half a step).
   Deterministic and privacy-safe either way, but the documented guarantee and
   the measured one differ. (FIX-12)
9. **Branch divergence as integration debt.** The research docs *and* the
   implemented top research items (R1 dedupe nudge, R2 reporter trail, R4
   coverage normalization) live only on `research-panel-and-roadmap`, which
   forked before the i18n catalog retrofit rewrote user-facing strings across
   `ReportForm`/`MyReports`/`CoverageView`. Merging later will conflict in
   exactly the files both branches touched. (FIX-14; I could not inspect the
   research branch's implementation details beyond its commit message and doc,
   so the conflict scope is an informed estimate.)

## Strategic position in the portfolio

This is the portfolio's most complete *shippable civic product*: a real PWA
with a live beta path (`BETA.md`, `fly.toml`), real operational surface
(runbook, metrics, alerts), and the strongest privacy story of the civic
track. It is the flagship demonstration that the portfolio's standards
(gates-as-CI, responsible-tech audits committed in-repo, i18n gate battery)
survive contact with a full-stack product rather than a library. Its two
deliberate incompletenesses — live 311 delivery and web-push delivery — are
honestly flagged everywhere they appear, which itself models the portfolio
ethos. The highest-leverage next moves are therefore ones that (a) protect the
trust the product asks of a town (FIX-01/02/03), and (b) convert the
single-town codebase into evidence of a *repeatable* civic pattern
(EXP-06, EXP-11) without faking the parts that need the city at the table.
