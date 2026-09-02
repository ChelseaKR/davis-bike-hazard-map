# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project intends to adopt [Semantic Versioning](https://semver.org/) once tagged releases begin
(see `docs/RESPONSIBLE-TECH-AUDITS.md` and the Standards Conformance table in `README.md` —
RELEASE-AND-VERSIONING is currently a declared gap, tracked for the first `v0.1.0` tag).

## [Unreleased]

- The documentation-audit gate can fail on something other than staleness.
  `scripts/doc_audit.py --check` re-rendered the generated block of
  `docs/DOCUMENTATION-AUDIT.md` and diffed it against the committed text, so
  "the file is current" was the only proposition it could ever fail on. Two
  failures rode through green: a broken relative link that had been through
  `make docs-audit` (the block honestly recorded
  `| Local doc links resolve | fail |` and named the link, matched the tree,
  and the gate printed "doc audit OK" and exited 0), and a tree with nothing
  in it (no `README.md`, no `tests/`, no `.github/workflows/` — every presence
  row rendered `fail` and the gate still exited 0, reporting success having
  inspected zero test files, zero workflows and zero links). Because the
  documented fix for a merge conflict in that file is "run `make docs-audit`
  and commit the result", routine conflict resolution was also the laundering
  path. The predicates are now asserted against the tree, the audit fails
  closed when it finds nothing to audit or cannot read what it found, and
  regenerating cannot turn a failing predicate green. `--check` exits `1` on
  drift and `2` when the audit itself failed; `tests/unit/docAudit.test.ts`
  holds both directions. The file itself stays committed: it is linked from
  the README, `docs/README.md`, `docs/PROJECT-SCOPE.md` and `docs/I18N.md`,
  and `docs/PROJECT-SCOPE.md` delegates its counts to it explicitly.

- Cleared all 6 open Dependabot alerts (2 high, 4 moderate — js-yaml quadratic
  CPU consumption, nanoid infinite-loop generator, and five undici advisories
  including response desync and cross-user cache disclosure). `npm audit fix`
  resolved all three affected packages within their existing dev-only semver
  ranges (js-yaml 4.3.0→4.3.1, nanoid 3.3.16→3.3.18, undici 7.28.0→7.29.0, the
  last pulled in transitively by `jsdom`) — a `package-lock.json`-only change,
  no `package.json` bump. Production dependency audit was already clean
  (these were all dev/test-scope); `npm audit` now reports 0 vulnerabilities
  in either scope.

- The 311 hand-off has a real entry point now. `forwardHandoff` had exactly
  three callers, all reachable only from a hand-off that already existed — so
  nothing in the app could start a *first* hand-off, and the receipt/retry/
  dead-letter machinery it feeds (R3, shipped 2026-07-17) could never fill
  (issue #113, #122). Approving a report now forwards it automatically
  (dry-run unless a real provider is configured), the same best-effort,
  never-blocks-moderation shape already used for saved-route push alerts on
  the same code path. The standalone `POST .../handoff` route is now the
  manual re-send used from the dead-letter list. README corrected in three
  places that no longer matched the app: the "moderator hits *Sync*" line (no
  such button exists — the route is real, reachable only via the API today),
  and the saved-route push-alerts bullet (server-side pieces are all real and
  tested; `registerHazardAlert`/`removeHazardAlert` have zero call sites, and
  neither the VAPID key pair nor a "Watch this route/area" UI control exists
  — left as honestly unreachable rather than wired in this change, since
  doing it for real needs a new client-facing config endpoint for the VAPID
  public key plus a whole alerts-management UI, not two buttons).

- Locale negotiation no longer claims Spanish it can't deliver. `es.json` is
  structure-only (0 of 214 values translated — REVIEW-GATE R3, no unreviewed MT
  in this civic app), but `negotiate()` matched any *catalogued* locale, so an
  `es`-preferring browser got `document.documentElement.lang = 'es'` while every
  string on the page still rendered in English via the `defaultMessage` fallback
  (issue #112). `src/i18n/config.ts` now separates *catalogued* (`SUPPORTED_LANGUAGES`
  — has a JSON file, exercises the gates) from *activated* (`ACTIVATED_LANGUAGES`
  — `negotiate()` will actually select it for a visitor), today `['en']` only.
  `tests/unit/i18nConfig.test.ts` is the regression guard, including a test that
  intentionally expires the day `es` is genuinely promoted. Promoting `es` is a
  two-part, done-together change: add it to `ACTIVATED_LANGUAGES` and flip
  `ES_REQUIRE_COMPLETE` in `scripts/i18n/check-parity.mjs` — not before real,
  reviewed translations exist.
- The open-data export now claims the license this repo actually grants. Four places
  told a consumer of `GET /api/hazards/export` that the data was `ODbL-1.0` — the
  response payload, the OpenAPI schema, `public/privacy.html`, and
  `docs/audits/privacy-notes.md` — while no document in the repo granted ODbL terms
  or named the attribution string ODbL requires, and the repo's own `LICENSE`,
  `CITATION.cff`, and README all say MIT (issue #121). All four now say MIT, matching
  what is actually granted; a new "Open data" section in the README says so plainly
  and is explicit that this is the current, honest answer rather than a considered
  decision that MIT is the right license for a geographic database specifically —
  `docs/ROADMAP.md`'s "Open-data licensing for the export" item is unchanged and
  still open.
- Relative times now tick. `timeAgo` reads `Date.now()` when it is called and React
  does not re-render on the passage of time, so every "Updated N min ago" in the app
  was frozen: `FeedFreshness` and `HazardCard` sampled `useState(Date.now)` once at
  mount (movable only by a test-only `now` prop, issue #114), while `MapView`,
  `ModerationPanel`, `MyReports`, and `HandoffFailures` passed no clock at all — two
  conventions for the same thing and no rule saying which to use. On a map left open
  on a handlebar mount, which is the expected way to use this, "2 min ago" stayed
  "2 min ago" for the session. `src/lib/useNow.ts` is now the single rule: it seeds
  from the real clock, ticks once a minute (`timeAgo`'s own finest granularity, so no
  re-render happens for a string that cannot have changed), and cleans up on unmount.
  All seven call sites thread a clock, the existing `now` props are retained as test
  overrides that install no timer, and a unit test fails the build on any bare
  `timeAgo(x)` in `src/` so the next component cannot reintroduce it. `MapView`'s
  popup keeps reading the clock at open time — Leaflet rebuilds popup content on
  every open — but now says so with a named parameter instead of an implicit default.
- The `make verify` parity claims are now true or gone. The README's gate table said
  `make verify` enforces "200+ tests (incl. Postgres adapter when `TEST_DATABASE_URL`
  is set); coverage >= 80% lines/fns, >= 75% branches". It ran neither: `verify` calls
  `test:unit` (bare `vitest run`), not `test:coverage`, and sets no
  `TEST_DATABASE_URL`, so the coverage floor and the only store adapter that talks to
  a real database were both CI-only. The enforced floor is also 89/86/89/84, not
  80/75. The table is split into what `make verify` enforces and what only CI does,
  and a Vitest `globalSetup` now prints a notice whenever the Postgres suite skips, so
  a green local run cannot be mistaken for a complete one. `docs/ROADMAP.md`'s stale
  `vite.config.ts:162` line reference is corrected, `docker-compose.yml`'s example
  `TEST_DATABASE_URL` named a database (`dbhm_test`) that exists only in CI, and
  `docs/RESPONSIBLE-TECH-AUDITS.md` no longer claims `make verify` regenerates the
  audit artifacts — `make audit` writes nothing and is in no workflow.
- `docs/DOCUMENTATION-AUDIT.md` is generated from the tree instead of typed. Its
  counts had rotted into false `pass` verdicts — "68 test files; 8 workflow files"
  against 77 and 10, and a "full hand-authored doc inventory" missing `CLAUDE.md`,
  the ten ADRs, `docs/RESEARCH-ROADMAP.md`, `docs/USER-RESEARCH.md`, and more.
  `scripts/doc_audit.py` (ported from nearmiss, which closed the same defect)
  regenerates the block between the file's markers; `make docs-audit-check` runs in
  `make verify` and in CI, so drift now fails the build. Counts are reported as
  `info`, never `pass`: a count is not a verdict. Fixes the same class of stale
  figure in `docs/PROJECT-SCOPE.md` and `docs/I18N.md`, and corrects the changelog
  entry that still described the i18n catalog and Renovate config as unlanded.
- README no longer contradicts itself on the Web Vitals beacon: OBS-26 was listed as
  an open gap forty lines above the conformance row that credited it as delivered.
  It shipped — `src/lib/vitals.ts` and `POST /api/metrics/web-vitals` — so the gap
  sentence is gone and the Observability paragraph is re-dated.
- Release authorization now runs from reviewed `main` through the immutable
  portfolio authorizer. Verification, GHCR publication, signing, and
  attestations use the exact selected commit; a separate checkout-free job
  rechecks the tag object before creating the GitHub Release.
- Standards pin moved from portfolio-standards `v1.0.1` to `v2.0.0` in both
  `.standards-version` and `standards.yml`, and the README conformance
  declaration was re-assessed against the tightened v2.0.0 gate set rather than
  re-dated. The table now carries all fifteen standards (AI Development
  Measurement was missing), sits at heading level two so DOC-11's checker can
  find it, and names the gaps the tighter gates exposed instead of claiming
  them: CQ-48's per-module critical-coverage floor, DOC-21's capability ledger,
  the untrue `make verify` parity claim, the empty Spanish catalog values, and
  the ODbL/MIT export contradiction. `scripts/check-portfolio-conformance.py`
  now delegates to the shared single-repository entry point, which restores the
  applicability-manifest scoping and publication-state lookup the hand-rolled
  v1.0.1 wrapper bypassed.

Pre-release Beta on `main`. No tags have been cut yet; entries below are seeded from the June 2026
PR history so the log isn't empty when the first release ships. Once `v0.1.0` is tagged, the
corresponding subset of these entries moves under that heading.

### Added
- Route honesty panel (EXP-03): the route planner now surfaces the trade-off it already computes
  but didn't show — `RoutePlan.fastestAlternative` carries the fastest candidate's distance/duration
  and the hazards it would pass near whenever the hazard-aware pick differs from it (`null` when the
  chosen route already is the fastest, i.e. nothing was traded away); the UI states the extra
  distance/time and hazard count, and each nearby hazard's list item now shows its own contribution
  to the route's score (previously computed but never rendered)
- 311 hand-off delivery receipts + reconciliation/retry (R3): every forward attempt records a
  server-internal `HandoffDelivery` receipt (submitted/acked/retrying/failed) on the hazard;
  failed transports retry on an exponential schedule (5 min doubling, capped 6 h, 6-attempt
  budget) via a periodic sweep; exhausted hand-offs dead-letter into the auth-gated
  `GET /api/moderation/handoff-failures` + a moderator re-send panel; any synced-back city
  status acks the receipt and cancels retries; `dbhm_handoff_failures_total` counts failed
  attempts. Fully dry-run testable — actual delivery to the city still requires provider
  credentials (external gate)
- Moderation queue pagination + photo streaming (FIX-04): `GET /api/moderation/queue` is
  keyset-paged (`limit`/`cursor`, response size independent of queue depth) and references photos
  by URL instead of inlining base64; `GET /api/photos/:id` streams a PENDING photo to an
  authenticated moderator only (`private, no-store`), answering 404 to everyone else. New
  `Repository.listPending` on all three stores + partial Postgres index
  (`migrations/0005_pending_queue_index.sql`); the moderation UI pages with "Load more" and
  fetches pending photos with the session bearer token
- Tag-triggered release workflow (`.github/workflows/release.yml`, REL-14): re-runs `make verify`
  at the tagged commit, builds + Trivy-scans the production image, publishes it to GHCR by digest
  (never `:latest`), generates a CycloneDX SBOM, cosign-signs + attests SLSA build provenance
  (keyless OIDC), cuts a GitHub Release, and pulls the published digest back down to prove it boots
  and answers `/livez` before calling anything released (standards conformance remediation)
- G10 logical-CSS i18n gate; G9 pseudolocale overflow check blocked-on-catalog (#39)
- Structured JSON logging + `/livez` and `/readyz` probes; Sentry tracing enabled (#38)
- SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md (#37)
- Trivy container CVE scan (HIGH/CRITICAL, blocking) (#35)
- Hazard-aware routing, resolved lifecycle + 311 status sync-back, push alerts, public read-only
  dashboard (#31)
- GitHub Actions pinned to full commit SHAs across all workflows (#30)
- Pinned portfolio-standards fetched at CI build time (#27)
- react-intl i18n catalog retrofit + merge-gated i18n checks and pseudolocale e2e. `src/i18n/locales/`
  and the `i18n:gates` chain are on `main`; the current catalog size is generated into
  [`docs/DOCUMENTATION-AUDIT.md`](docs/DOCUMENTATION-AUDIT.md) rather than typed here. Every Spanish
  value is still an empty string (#112)
- Renovate config with GitHub Actions digest pinning (`renovate.json`, on `main`)

### Changed
- Runtime image now runs `apt-get upgrade` during the build so newly-published Debian
  package CVEs are patched immediately instead of waiting on the next `node:22-slim` base
  image refresh — `container-scan.yml`'s weekly Trivy run flapped on exactly this gap on
  2026-07-27 (schedule run failed with no Dockerfile change, next one passed once the base
  image was repulled)
- Vitest coverage raised with meaningful tests; thresholds raised to measured levels
  (89/86/89/84 lines/functions/statements/branches) (#36)
- Standards remediation: `persist-credentials: false` on checkouts, flyctl action pin comment,
  `CITATION.cff` added (#34)

### Fixed
- Seeded demo hazards (`scripts/seed.ts`) were indistinguishable from real reports on the public
  dashboard and in the `/api/hazards/export` open-data feed (issue #111): the README's "seeds are
  clearly fictional" claim was true only for someone reading the source, not for a site visitor.
  `StoredHazard`/`Hazard` now carry `source: 'report' | 'seed'`, set explicitly by `scripts/seed.ts`
  and defaulted to `'report'` everywhere a pre-existing record (on disk or in Postgres) predates the
  field. Seeded hazards now render a "Demo data" marker on every card/popup, the public dashboard
  shows a standing banner whenever a seeded row is in the feed, and the GeoJSON export's
  `properties.source` makes the ODbL-licensed data self-describing so it can't silently redistribute
  unlabelled fiction. `migrations/0008_hazard_source.sql` backfills existing Postgres rows.
- Offline synchronization no longer retries permanently failed reports every 30 seconds;
  user-triggered retries remain available, and reports orphaned in `syncing` after an interrupted
  submission return to the idempotent retry queue after ten minutes.
- Production now defaults to same-origin CORS when `CORS_ORIGINS` is unset while still honoring an
  explicit allow-list; regression tests cover both production configuration paths.
- CodeQL was fully non-blocking (`continue-on-error: true`) pending code-scanning enablement;
  narrowed so the analysis step itself can fail CI even while SARIF upload stays skipped on a
  private repo (2026-07-05 remediation — see `audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md`
  P0-3)
- `codeql.yml`'s explanatory comment about that same 2026-07-05 fix literally contained the text
  `continue-on-error: true`, which made the portfolio's automated conformance checker (a naive
  text scan) misreport the gate as still-silenced even though the actual gate has been real since
  2026-07-05. Reworded the comment (no functional change) so the check reads the workflow
  correctly (standards conformance remediation)

## Notes on pre-[Unreleased] history

Everything before the entries above (dating to the initial scaffold) predates this changelog and is
not individually itemized; see `git log` for the full commit history. The project has not cut a
tagged release yet — `git tag` is empty as of 2026-07-05. `CITATION.cff` and `SECURITY.md` describe
a `version: 0.1.0` / "latest tagged release" model that is aspirational until the first tag ships
(tracked in the remediation plan's P2-1).
