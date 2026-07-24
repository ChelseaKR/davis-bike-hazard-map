# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this
project intends to adopt [Semantic Versioning](https://semver.org/) once tagged releases begin
(see `docs/RESPONSIBLE-TECH-AUDITS.md` and the Standards Conformance table in `README.md` —
RELEASE-AND-VERSIONING is currently a declared gap, tracked for the first `v0.1.0` tag).

## [Unreleased]

- Release authorization now runs from reviewed `main` through the immutable
  portfolio authorizer. Verification, GHCR publication, signing, and
  attestations use the exact selected commit; a separate checkout-free job
  rechecks the tag object before creating the GitHub Release.

Pre-release Beta on `main`. No tags have been cut yet; entries below are seeded from the June 2026
PR history so the log isn't empty when the first release ships. Once `v0.1.0` is tagged, the
corresponding subset of these entries moves under that heading.

### Added
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
- react-intl i18n catalog retrofit (188 messages) + 8 merge-gated i18n checks, pseudolocale e2e
  (branch `i18n-catalog-retrofit`, not yet on `main` — see README Standards Conformance table)
- Renovate config with GitHub Actions digest pinning (branch `i18n-catalog-retrofit`)

### Changed
- Vitest coverage raised with meaningful tests; thresholds raised to measured levels
  (89/86/89/84 lines/functions/statements/branches) (#36)
- Standards remediation: `persist-credentials: false` on checkouts, flyctl action pin comment,
  `CITATION.cff` added (#34)

### Fixed
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
