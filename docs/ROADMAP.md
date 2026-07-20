# Davis Bike Hazard Map — Implementation Roadmap

> Generic enforcement lives in `/STANDARDS`. This document carries the decisions and project-specific values.
> **Last verified: 2026-05-31 · Recheck cadence: per GOGov/311 + map-tile provider change.**

## 1. Snapshot
An offline-capable PWA for crowdsourced cycling-hazard reporting and mapping in Davis, with hazard-aware routing and optional 311/GOGov hand-off. Hyper-local, tangible, open-data, and shippable; GIS via OpenStreetMap keeps it free.

## 2. Problem & users
- **Problem.** Repeated cycling hazards in Davis go unreported or disappear into 311; no shared, public, current map exists.
- **Primary users.** Davis cyclists (commuters, students, families); secondarily, the city (as a hand-off recipient and open-data consumer).
- **Jobs to be done.** "Flag this hazard fast, even with one hand and bad signal." · "Show me what's dangerous on my route." · "Get this fixed by routing it to the city."
- **Evidence basis.** Davis's cycling density and the known under-use of municipal 311; validate top hazard categories with a short local survey before finalizing taxonomy.

## 3. Product definition
- **Vision.** The shared, trusted, public picture of where it's unsafe to ride in Davis.
- **Scope (MoSCoW).**
  - *Must:* fast report (category, severity, photo w/ EXIF strip + blur option, geolocation); offline capture + sync; live filterable map + list view; hazard lifecycle (confirm/resolve/expire); moderation.
  - *Should:* hazard-aware routing; 311/GOGov hand-off; duplicate clustering; report detail + comments.
  - *Could:* heatmap/trends; public open-data export/API; notifications for a watched area ✅ *(shipped behind `PUSH_ENABLED`: real `web-push` delivery with VAPID keys, service-worker `push`/`notificationclick` handlers, and a Postgres subscription store — see README → Push alerts).*
  - *Won't (v1):* accounts required to view; gamification; city-wide official adoption (nice, not required).
- **Non-goals.** Not a surveillance tool; not a place to photograph identifiable people.

## 4. Research & evidence
- **Taxonomy validation.** Short survey/interviews with local cyclists to lock hazard categories and severity scale.
- **GIS path.** OpenStreetMap base + Davis street network for routing; document tile/routing provider choice and any usage limits; no proprietary GIS dependency.
- **Moderation reality.** Decide the moderation model up front (lightweight queue + community flagging) so it's not bolted on.

## 5. Experience & design
- **Mobile-first, one-handed.** Big targets, minimal steps, works in sunlight; capture flow optimized for "stopped at a corner."
- **Map + list parity.** Every map capability has an accessible list/table equivalent (the map is not the only way in).
- **Design system.** High-contrast, legible at speed; severity color + shape (not color alone); reduced-motion aware.
- **Accessibility.** Map a11y is hard — provide the list view, keyboard operation, SR-labeled markers/clusters, and accessible report forms. This is a release gate.

## 6. Architecture
- **Shape.** React PWA (service worker for offline + background sync) + MapLibre GL (OpenStreetMap tiles) + a backend (Postgres + PostGIS) for storage, clustering, and lifecycle; photo storage with server-side EXIF strip as a backstop to client-side stripping.
- **Routing.** OSM-based routing service with a hazard-avoidance weighting layer.
- **311 hand-off.** Adapter that formats and forwards a report to GOGov/311 (document the integration contract; degrade gracefully if unavailable).
- **Data model.** `Hazard(type, severity, geom, photo_ref, status, created, expires, confirmations)`, `Report`, `ModerationAction`. Open-data export view excludes any sensitive fields.
- **Key decisions (ADRs).** PWA over native (installable, offline, no app-store friction). OSM/PostGIS over proprietary GIS (free, open). Client+server EXIF strip (defense in depth). Moderation-before-public (rejected: raw public photo feed — privacy/abuse risk).
- **Build-time ADRs (where the build refined the spec):** Leaflet + raster OSM tiles (not MapLibre GL); an atomic JSON-file store behind a `Repository` interface for v1 (PostGIS remains the scaling path); manual region blur as the guarantee with optional automatic face detection; moderator-triggered, dry-run-by-default 311 hand-off. Full rationale in [`ARCHITECTURE.md` → ADRs](./ARCHITECTURE.md#architecture-decision-records-adrs).

## 7. Quality attributes & metrics
| Metric | Target | Measured by | Gate |
|--------|--------|-------------|------|
| EXIF stripped on upload | 100% | upload pipeline test | merge-blocking |
| Offline report → sync success | works w/o connectivity | e2e offline test | merge-blocking |
| axe violations (incl. list view) | 0 | axe (Vitest component + Playwright full-page, WCAG 2.2 AA) + Lighthouse a11y ≥ 0.9 | merge-blocking |
| Map first interactive (mobile) | within budget | Lighthouse mobile (warn-level; not yet merge-blocking — tracked) | advisory |
| Moderation SLA (flagged content) | documented + enforced in flow | moderation test | review-gated |
| Coverage | lines ≥ 89, functions ≥ 86, statements ≥ 89, branches ≥ 84 (enforced; vite.config.ts:162) | Vitest coverage-v8 | merge-blocking |
| PII in open-data export | none | export schema test | merge-blocking |

**Testing.** Unit (taxonomy, lifecycle, routing weights), integration (report→store→map, 311 adapter), e2e (offline capture + sync via Playwright), a11y (axe + keyboard + SR + list parity), and privacy (EXIF strip, export schema).

**CI-CD-STANDARD §1 optional stages (6–8), declared per repo (CICD-29):**

| Stage | Applicable? | Evidence |
|---|---|---|
| 6. a11y | Applicable | axe (component + full-page) + Lighthouse a11y, merge-blocking (see table above) |
| 7. perf | Applicable | Lighthouse CI budgets in `lighthouserc.json`, run in `ci.yml`'s `lighthouse` job — currently warn-level except a11y; tightening to blocking is tracked (P1-3, bundle-size gate) |
| 8. responsible | Applicable | `docs/RESPONSIBLE-TECH-AUDITS.md` + `docs/audits/*` (ethics, bias/equity, privacy/DPIA, transparency, security); auto-gated tests (EXIF strip, moderation-before-public, coverage-view, export schema) + review-gated sign-offs |

Row corrected 2026-07-05 (prior version claimed `pa11y-ci`, which is not present, and a stale coverage target of 85/80; see `audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md` quick-win 8).

## 8. Implementation plan for Claude Code
```
web/      (PWA: capture, map, list, routing UI, offline/sync)
api/      (reports, hazards, lifecycle, clustering, 311 adapter)
gis/      (routing + hazard weighting)
db/       (postgis schema + migrations)
docs/
```
- **M0 — Scaffold & gates.** PWA shell + CI (`/STANDARDS` gates + axe + EXIF test). *Done when `make verify` green and the shell installs offline.*
- **M1 — Report + storage.** Capture flow (category/severity/photo/geo), EXIF strip + blur option, PostGIS storage. *Done when a report round-trips and photos are EXIF-clean.*
- **M2 — Map + list.** MapLibre map with clustering/filters + accessible list parity. *Done when both render the same data and axe = 0.*
- **M3 — Offline + sync.** Service-worker capture offline, background sync. *Done when the offline e2e test passes.*
- **M4 — Lifecycle + moderation.** Confirm/resolve/expire; moderation queue + flagging. *Done when stale hazards expire and flagged content is gated.*
- **M5 — Routing + 311 hand-off.** Hazard-aware routing; optional GOGov/311 forward. *Done when routing avoids active hazards and hand-off works (or degrades cleanly).*
- **M6 — Open data + launch polish.** PII-free export/API; performance + a11y hardening. *Done when all §7 gates pass.*
- **Claude Code approach.** Mobile + offline as first-class from M0; never ship a photo path without EXIF strip; keep list-view parity with every map feature.

## 9. Community
Contribution + moderation guidelines; open-data license; "report quality" norms.

## 10. Legal & compliance
- **Photos of public spaces** can capture people/plates → EXIF strip + blurring + moderation, and a clear "don't photograph identifiable people" norm.
- **Open-data licensing** for the export; OSM attribution honored.
- **Accessibility** statement; CCPA-friendly minimal data.

## 11. Operations & sustainability
- **Hosting/cost.** Modest: managed Postgres/PostGIS + static PWA hosting + OSM tiles (watch tile usage; self-host tiles if needed).
- **Observability.** Health, sync-failure alarms, moderation-queue depth, map performance.
- **Maintenance.** Hazard expiry + community confirmation keep data fresh; periodic dedupe.
- **Sustainability.** Open data + open source means the map survives the maintainer; low running cost.

## 12. Responsible-tech summary
Top risks: (1) photos exposing identifiable people/plates → mandatory EXIF strip + blurring + moderation; (2) inequitable hazard coverage across neighborhoods skewing attention → surface coverage gaps, never present absence as safety; (3) map-only access excluding some users → list parity + full a11y. Full treatment in [`RESPONSIBLE-TECH-AUDITS.md`](./RESPONSIBLE-TECH-AUDITS.md).
