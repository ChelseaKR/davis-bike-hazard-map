# Project Scope

Last reviewed: 2026-07-08. Base branch: `main`.

This file is a plain-language map of the project as it exists on `main`. It does not replace the README, roadmap, audit docs, or source comments. It points to them so a reviewer can see the whole shape without reading every file first.

## What This Project Is

This repo is a civic hazard-reporting map for people biking in Davis. It collects reports, shows them on an accessible web map, supports moderation and status updates, and keeps the privacy limits visible.

Package metadata checked in this pass:

- Node workspace `package.json` named `davis-bike-hazard-map` (scripts: test, typecheck, lint, build, verify, dev).

## Who It Serves

- People reporting bike hazards or near misses.
- Advocates and city staff who need a shared view of reported conditions.
- Maintainers running a small civic web app with moderation, alerts, and public reporting.

## What It Covers

- A browser map and report flow.
- A Node/TypeScript server with database migrations and hazard APIs.
- Moderation, handoff, authentication, backup, and alert-support code.
- Accessibility, privacy, roadmap, architecture, and audit docs.
- Playwright, i18n, and CI checks around the user surface.

## How It Is Put Together

- server/ contains the API and service logic.
- public/ and client assets hold static pages and icons.
- migrations/ define the database shape.
- scripts/ contains i18n and setup checks.
- docs/audits/ contains accessibility, privacy, moderation, and residual-risk notes.

Observed source and operations surfaces:

- `Dockerfile`
- `Makefile`
- `docker-compose.yml`
- `migrations/`
- `package.json`
- `scripts/`
- `server/`
- `shared/`
- `src/`

GitHub workflow files checked:

- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/container-scan.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/secret-audit.yml`
- `.github/workflows/standards.yml`
- `.github/workflows/workflow-lint.yml`

## Trust Boundaries

- Reports are useful signals, not official city work orders.
- The app needs moderation and privacy protections because locations and reporter context can be sensitive.
- Coverage gaps matter; the docs call out equity and residual-risk issues instead of treating the map as complete truth.

## Outside This Scope

- It is not a 311 replacement.
- It cannot prove every hazard or guarantee city action.
- Live integrations such as push, 311, or SMS depend on deployed credentials and operational decisions.

## Docs And Evidence Checked

This pass checked 25 hand-authored doc or metadata files, 60 test files, and 7 workflow files on `main`. The count excludes vendored provider licenses, dependency folders, generated cache files, and large generated artifact history.

Large content groups were counted rather than listed file by file:

- `public/`: 1 files

Primary docs checked:

- `.github/PULL_REQUEST_TEMPLATE.md`
- `BETA.md`
- `CHANGELOG.md`
- `CITATION.cff`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `DEFINITION_OF_DONE.md`
- `LICENSE`
- `README.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/I18N.md`
- `docs/RESPONSIBLE-TECH-AUDITS.md`
- `docs/ROADMAP.md`
- `docs/audits/accessibility-2026-05-31.md`
- `docs/audits/coverage-equity.md`
- `docs/audits/moderation-policy.md`
- `docs/audits/privacy-notes.md`
- `docs/audits/residual-risk.md`
- `docs/audits/screen-reader-walkthrough.md`
- `docs/ideation/01-deep-dive.md`
- `docs/ideation/02-large-scale-fixes.md`
- `docs/ideation/03-expansions.md`
- `docs/ideation/04-impact-and-sequencing.md`
- `docs/ideation/README.md`

Representative test files checked:

- `tests/axe.ts`
- `tests/e2e/a11y.spec.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/report-flow.spec.ts`
- `tests/i18n-render.tsx`
- `tests/i18n/pseudo-overflow.spec.ts`
- `tests/setup.ts`
- `tests/unit/App.a11y.test.tsx`
- `tests/unit/CoverageView.a11y.test.tsx`
- `tests/unit/ErrorBoundary.test.tsx`
- `tests/unit/FeedFreshness.test.tsx`
- `tests/unit/Filters.a11y.test.tsx`
- `tests/unit/HazardCard.test.tsx`
- `tests/unit/HazardPhoto.test.tsx`
- `tests/unit/ListView.a11y.test.tsx`
- `tests/unit/ModerationPanel.test.tsx`
- `tests/unit/MyReports.test.tsx`
- `tests/unit/PhotoEditor.a11y.test.tsx`
- `tests/unit/PhotoEditor.test.tsx`
- `tests/unit/ReportForm.test.tsx`
- `tests/unit/RoutePlanner.a11y.test.tsx`
- `tests/unit/RoutePlanner.test.tsx`
- `tests/unit/Skeleton.test.tsx`
- `tests/unit/StatusBanner.test.tsx`
- `tests/unit/alerts.test.ts`
- `tests/unit/api.test.ts`
- `tests/unit/areas.test.ts`
- `tests/unit/auth.test.ts`
- `tests/unit/backup.test.ts`
- `tests/unit/blur.test.ts`
- `tests/unit/db.test.ts`
- `tests/unit/exif.test.ts`
- `tests/unit/filters.test.ts`
- `tests/unit/format.test.ts`
- `tests/unit/geo.test.ts`
- `tests/unit/geolocation.test.ts`
- `tests/unit/gogov.test.ts`
- `tests/unit/hazardsLib.test.ts`
- `tests/unit/id.test.ts`
- `tests/unit/image.test.ts`
- `tests/unit/landmarks.test.ts`
- `tests/unit/lifecycle.test.ts`
- `tests/unit/mapIcons.test.ts`
- `tests/unit/moderators.test.ts`
- `tests/unit/observability.test.ts`
- Plus 15 more test files.

## Validation Notes

For this docs PR, validation means the scope file was generated from the clean `origin/main` worktree, reviewed against repo metadata and docs inventory, and checked with `git diff --check`. Project test suites are still the authority for code behavior, because this PR changes documentation only.
