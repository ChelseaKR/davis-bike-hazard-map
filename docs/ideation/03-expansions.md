# Expansions — 2026-07-01

Net-new expansion ideas in three horizons. E1–E9 from `RESEARCH-ROADMAP.md`
(near-miss category, routing profiles, SMS/QR intake, service-area bbox
expansion, campus on-ramp, city export, wins feed, trends view, advocacy
embed) are *not* restated; several items below deliberately build past them
and say so. Effort tiers as in `02-large-scale-fixes.md`.

---

## Horizon 1 — deepen the core

### EXP-01 — "Still there / actually fixed?" rider verification loop
**Pitch:** let riders dispute a resolution — the mirror image of the existing "I saw this too" confirm.

- **Impact:** the resolved-lingers design (ADR-6) shows fixes; nothing
  catches *false* fixes — a city status of "Closed - Resolved"
  (`server/lib/lifecycle.ts:17-26`) resolves the hazard even if the pothole
  remains, and the map then actively misinforms. This closes the last open
  edge of the lifecycle loop and is distinct from E7 (wins feed = celebrate
  fixes) and R2 (reporter trail = visibility).
- **Shape:** a "still not fixed" action on resolved-and-lingering hazards
  (`HazardCard.tsx` already renders lifecycle badges); server-side it's a
  new legal transition `resolved → approved(reopened)` — which is exactly why
  FIX-09's state machine should land first; reopened hazards flag the
  hand-off record for moderator attention (`handoff.stage` stays honest:
  "city says fixed, riders disagree" is *shown as both*, not overwritten —
  honesty-as-a-feature).
- **Effort:** M. **Risks/deps:** FIX-09; anti-gaming interacts with R5
  (a reopen is a stronger action than a confirm). Coordinate messaging with
  the city before shipping — publicly contradicting 311 statuses has
  relationship consequences (human gate).
- **Excellence bar:** a reopened hazard shows the full contradictory record
  (city: fixed / riders: 3 say not fixed) and moderators get a queue filter
  for disputes; zero silent overwrites of either party's claim.

### EXP-02 — Davis offline tile pack
**Pitch:** pre-seed the service worker with the full Davis tile set so the map (not just the app shell) works offline on day one.

- **Impact:** today tiles are cached opportunistically (cache-first, capped —
  `vite.config.ts` Workbox config): the map is only offline-usable for areas
  you already viewed. A rider in a network dead zone filing a report about a
  new area gets a blank map. Davis at zoom 13–17 is a small, bounded tile
  set — this is the rare town where "download the whole map" is trivial.
- **Shape:** an opt-in "save Davis for offline" action that enumerates tiles
  for `DAVIS_BOUNDS` (`shared/validation.ts:9-14`) across the zoom bands the
  UI uses, fetches through the existing tile cache, and reports storage used;
  respect OSM tile-usage policy — realistically this lands *after* R8/
  self-hosted tiles (`VITE_TILE_URL` already exists for that), and the UI
  must say what's being downloaded and how much.
- **Effort:** M. **Risks/deps:** OSM tile policy (do not bulk-fetch the
  public servers — hard dependency on self-hosted tiles); storage quotas on
  iOS Safari. **Excellence bar:** airplane-mode e2e test: cold-start the
  PWA offline, pan the whole city, file a report — all functional.

### EXP-03 — Route honesty panel: what the safer route costs you
**Pitch:** show the chosen-vs-fastest delta and the per-hazard penalty breakdown the scorer already computes.

- **Impact:** `rankRoutes` (`shared/routing.ts:194-202`) considers
  alternatives and the plan even reports `alternativesConsidered`
  (`RoutePlan`, `shared/routing.ts:205-216`) — but the UI shows only the
  winner. Riders can't see "this adds 400 m to avoid 2 fresh high-severity
  hazards," which is precisely the transparency §D of
  `RESPONSIBLE-TECH-AUDITS.md` promises for routing ("explains that it
  avoids *reported* hazards"). Turning the scorer's internals into UI is the
  cheapest honest-by-construction feature available.
- **Shape:** extend `RoutePlan` to carry the top non-chosen candidate's
  distance/duration and the chosen route's `nearby` penalties (already
  there); render a comparison strip in `RoutePlanner.tsx` + narrated list in
  the turn-by-turn (list parity is already the repo's pattern); i18n via the
  catalog.
- **Effort:** S–M. **Risks/deps:** none hard; sequence after FIX-14 to avoid
  string-file conflicts. **Excellence bar:** a rider (and a screen-reader
  rider) can answer "why this route, what did it avoid, what did it cost"
  from the UI alone; a11y tests cover the new panel.

### EXP-04 — Time- and condition-aware hazard weighting
**Pitch:** weight `poor_visibility` hazards higher after dusk (and similar condition modifiers) in route scoring.

- **Impact:** the taxonomy already has `poor_visibility`
  (`shared/types.ts:10-18`) but the scorer treats a dark-underpass hazard at
  noon and at 11 pm identically (`hazardPenalty`, `shared/routing.ts:146-161`
  — severity/recency/confirmations only). Distinct from E2 (rider *profiles*:
  who you are) — this is *when you're riding*. Davis's student population
  rides late.
- **Shape:** an optional `conditions: {isDark: boolean}` in
  `RouteScoringOptions`, a per-category condition multiplier table, computed
  server-side from request time + civil-twilight for Davis's fixed lat/lng
  (a pure function — no API needed); surfaced honestly in the plan ("weighted
  for night riding").
- **Effort:** S–M. **Risks/deps:** multiplier values are guesses until
  validated — ship behind the same "reported, not verified" framing, and
  fold the question into the ROADMAP §4 taxonomy survey (real-rider gate for
  tuning, not for the mechanism). **Excellence bar:** deterministic unit
  tests (fixed clock) showing a night route diverges from the day route
  around a visibility hazard, and the UI says why.

### EXP-05 — Structured hazard attributes v2 (schema evolution machinery)
**Pitch:** category-specific structured fields (extent, lane position, recurrence) plus the migration/versioning machinery to evolve the taxonomy safely.

- **Impact:** everything downstream that the research pass wants — E1
  near-misses, E6 city-grade exports, R4 equity normalization — will pressure
  the flat `category/severity/description` model
  (`shared/types.ts:130-141`). The expansion here is not any one field: it's
  the *capability to evolve the schema* (versioned report payloads, migration
  of stored rows, export schema versioning) so E1 and successors aren't
  hacked in as description conventions.
- **Shape:** `schemaVersion` on `ReportSubmission`; a per-category optional
  `attributes` object validated by per-category zod schemas in
  `shared/validation.ts`; migration `0004_attributes.sql`; export
  (`app.ts:417-436`) gains a versioned properties block; old clients keep
  working (additive-only rule, enforced by a compatibility test).
- **Effort:** L. **Risks/deps:** attribute design needs the real-rider
  taxonomy survey (ROADMAP §4 — human gate); moderation UI grows. **Excellence
  bar:** a v1 client submission and a v2 submission round-trip side by side;
  export consumers get versioned, documented schemas (dovetails with R10).

---

## Horizon 2 — adjacent capabilities, audiences, integrations

### EXP-06 — Open311 GeoReport v2 adapter
**Pitch:** implement the vendor-neutral civic standard alongside the bespoke GOGov adapter.

- **Impact:** `server/lib/gogov.ts` is a clean but proprietary-shaped
  contract for an API that (per its own header comment) has no documented
  public spec. Open311 GeoReport v2 is the actual interoperability standard
  many 311 vendors expose. Implementing it (a) gives Davis a second,
  standards-based integration path, (b) makes every other city reachable
  (prereq for EXP-11), and (c) replaces "waiting on GOGov" with "conforming
  to a public spec" — testable *today* against Open311 test servers without
  faking anything.
- **Shape:** `server/lib/open311.ts` implementing service-list/
  service-request POST/request-status GET against the same
  `StoredHazard → payload` seam `buildPayload()` uses; a provider selector in
  `server/config.ts`; the status mapping in `lifecycle.ts:17-26` already
  normalizes free-form strings so it mostly carries over; contract tests
  against recorded Open311 fixtures.
- **Effort:** M–L. **Risks/deps:** whether Davis's GOGov instance exposes
  Open311 is unknown (city conversation gate for *production*, not for the
  adapter). **Excellence bar:** conformance against the published Open311
  spec fixtures in CI; switching providers is config-only.

### EXP-07 — Versioned open-data snapshots + machine-readable catalog metadata
**Pitch:** make the export a citable dataset, not just a live endpoint.

- **Impact:** `GET /api/hazards/export` (`app.ts:417-436`) returns *now* —
  researchers, journalists (persona P13), and the city's data portal need
  *as-of* data with stable identifiers and metadata. R10 covers the human-
  readable data dictionary; this goes beyond it: reproducibility as a
  feature. A council claim ("41 hazards in South Davis in June") should be
  re-derivable forever.
- **Shape:** nightly (or on-demand) snapshot files
  (`/api/hazards/export?asOf=` or static `exports/YYYY-MM-DD.geojson` in the
  photo store's object bucket), a DCAT/schema.org `Dataset` JSON-LD document,
  checksums, and the ODbL license + limits note (R10) embedded in each
  snapshot; `CITATION.cff` already exists — extend it to the dataset.
- **Effort:** M. **Risks/deps:** snapshots must apply the same PII-free
  projection *and* respect later reporter deletions (decide + document:
  deletion propagates to snapshots — consent ethos says yes, even at the
  cost of perfect reproducibility; state the trade-off in the metadata).
- **Excellence bar:** a third party can fetch a dated snapshot, verify its
  checksum, and reproduce a published figure; deletion-propagation is
  documented and tested.

### EXP-08 — OSM feedback loop for permanent infrastructure hazards
**Pitch:** offer moderators a "suggest to OpenStreetMap" action for hazards that are really map features (bad crossings, missing curb cuts), via OSM Notes.

- **Impact:** `dangerous_intersection` and `poor_visibility` reports often
  describe *permanent* conditions that outlive any TTL
  (`config.ttlDays`, max 30 days) — the expiry model structurally forgets
  them. OSM Notes is the legitimate channel for putting that knowledge where
  every OSM-based router (including this app's own OSRM backend) can
  eventually benefit. Reciprocity with the commons the app is built on.
- **Shape:** a moderator-triggered (never automatic) action beside the 311
  hand-off in `ModerationPanel.tsx` that drafts an OSM Note (anonymous notes
  need no OAuth; authenticated is better) with the fuzzed location and a
  templated description — no photos, no reporter data crosses the boundary;
  dry-run default like every other adapter in this codebase.
- **Effort:** M. **Risks/deps:** license/consent review (ODbL contribution
  terms; reporter consent language on the report form must cover this reuse
  — legal-ish gate); OSM community norms (don't spam Notes — moderator
  judgment + rate cap). **Excellence bar:** each suggested note links back to
  the hazard's public record; contribution volume visible in the audit trail;
  privacy review signed off before enabling.

### EXP-09 — Consented research-access program (UC Davis)
**Pitch:** a documented, IRB-compatible path for transportation researchers to use the data beyond the public export.

- **Impact:** Davis hosts one of the strongest cycling-research communities
  anywhere (UC Davis ITS). The public export is deliberately coarse; some
  legitimate research questions (exposure, under-reporting — the EV-SKEW
  agenda) need more (e.g., finer spatial resolution or lifecycle timing) than
  the public feed should ever carry. Doing this *by policy* rather than ad
  hoc is the difference between a data partner and a data liability.
- **Shape:** mostly governance, some code: a written access policy
  (what exists, what is never shared — precise locations are server-only by
  design and should stay that way; aggregated products are the offer), a DUA
  template, and an aggregation pipeline (per-cell / per-week rollups
  generated like EXP-07 snapshots). Reporter-facing consent language updated
  *before* any sharing.
- **Effort:** M (policy) + M (rollup pipeline). **Risks/deps:** hard human/
  legal gate — IRB, DUA, privacy reviewer sign-off; do not build the pipeline
  before a real researcher asks. **Excellence bar:** the policy is public,
  the first shared artifact is aggregate-only, and reporters can read exactly
  what researchers can see.

### EXP-10 — Broaden the audience: adaptive cyclists and shared-path users
**Pitch:** extend the taxonomy and capture flow to hazards that specifically endanger adaptive bikes, trikes, cargo trailers, and wheelchair users on Davis's shared-use paths.

- **Impact:** the current categories encode a standard-bike frame of harm
  (`shared/types.ts:10-18`); a bollard spacing that's fine on a road bike
  blocks a handcycle or a wheelchair. Davis's greenbelt paths are shared
  infrastructure. This widens who the map protects — the equity commitment
  (§B of the responsible-tech audit) applied to the *taxonomy itself*, not
  just spatial coverage. Distinct from E1 (near-misses) and E2 (routing
  profiles), though it feeds E2 naturally.
- **Shape:** attribute-level (per EXP-05: e.g., `clearanceWidth`,
  `affectsMobilityDevice`) rather than new top-level categories, to avoid
  ghettoizing the reports; capture-flow copy reviewed with disability
  advocates; routing profile "wide/adaptive" becomes possible later on E2's
  seam.
- **Effort:** M (after EXP-05). **Risks/deps:** SME gate — non-negotiable
  co-design with adaptive riders/disability advocates (parallel to R7's
  screen-reader gate); don't guess at this taxonomy. **Excellence bar:** the
  attributes were named by the affected community, and at least one routing
  or filtering behavior consumes them end-to-end.

---

## Horizon 3 — transformative bets

### EXP-11 — Hazard-map-in-a-box: parameterize the town
**Pitch:** extract every Davis-specific constant into a "place pack" so any college town can deploy this in an afternoon.

- **Impact:** the codebase is one config layer away from being a *pattern*
  instead of a product: `DAVIS_BOUNDS`/`DAVIS_CENTER`
  (`shared/validation.ts:8-17`), `DAVIS_AREAS` (`src/lib/areas.ts:21-28`),
  `DAVIS_LANDMARKS` (`src/lib/landmarks.ts`), hard-coded copy, the 311
  provider. E4 widens the bbox to Yolo County; this is categorically more —
  multi-deployment, which is also the strongest possible portfolio evidence
  that the civic pattern generalizes.
- **Shape:** a `place/` package (JSON + generated types): bounds, center,
  areas (GeoJSON, replacing hand-drawn boxes — which also upgrades R4's
  denominators), landmarks, tile/routing endpoints, 311 provider config
  (EXP-06 makes that pluggable), locale defaults; a validation script that
  refuses incoherent packs; docs for "deploy for your town."
- **Effort:** XL. **Risks/deps:** real risk of abstraction-before-second-user
  — do not start until a second community actually commits (human gate);
  moderation is the non-transferable cost (each deployment needs local
  moderators — say so up front). **Excellence bar:** a second town runs from
  an unmodified container + its place pack, with all gates green and *its
  own* coverage-equity audit generated.

### EXP-12 — Official co-stewardship with the City of Davis
**Pitch:** negotiate a formal path from "civic side project" to city-recognized data source — MOU, data stewardship terms, succession plan.

- **Impact:** the abandonment literature the research pass cites
  (EV-ABANDON) says civic tools die operationally. The durable version of
  this product is one the city acknowledges: 311 credentials (unblocking the
  deferred live GOGov integration + webhook secret), a named contact, agreed
  SLAs on sync-back, and continuity if the maintainer steps away (the
  open-source + open-data design already anticipates this — ROADMAP §11
  "the map survives the maintainer").
- **Shape:** not code: a one-page proposal (the public dashboard +
  `docs/audits/` are the portfolio of evidence), a pilot MOU covering data
  flow both ways, liability/disclaimer language ("community-reported, not
  verified" is already the product's frame), and a succession clause. Code
  follow-ons: whatever credentials/endpoints the agreement yields plug into
  existing seams (`gogov.ts`, `GOGOV_WEBHOOK_SECRET`).
- **Effort:** M in engineering time, XL in calendar time. **Risks/deps:**
  entirely a human/legal gate; the honest framing is "this item cannot be
  built, only earned." **Excellence bar:** live (non-dry-run) hand-off with
  receipts, a signed MOU, and the beta graduated to a public instance the
  city links to.

### EXP-13 — Recurrence intelligence (descriptive, never predictive)
**Pitch:** detect and display *recurring* hazard sites — same cell, same category, repeatedly — as first-class chronic locations.

- **Impact:** expiry (by design) forgets; E8's trend view charts volume over
  time; neither says "this exact underpass has flooded every winter for
  three years — a work order won't fix it, capital planning will." Chronic-
  site detection converts crowd reports into infrastructure-grade evidence,
  the strongest artifact an advocacy group (P11) or council (P10) can use.
- **Shape:** an offline job over the stored history (fuzzed cells ×
  category × time), a `chronic` annotation surfaced with its evidence
  ("5 reports across 3 winters"), and a section in the EXP-07 snapshots.
  Explicitly *descriptive*: no risk prediction, no extrapolation to
  unreported areas — the EV-SKEW critique makes predictive scoring from
  biased crowd data an equity hazard, and this portfolio defers such work
  rather than fake safeguards for it. State that boundary in the UI.
- **Effort:** L. **Risks/deps:** needs real multi-season data (real-data
  gate: not meaningfully buildable before ~a year of operation — say so);
  equity review before publishing any ranking of chronic sites. **Excellence
  bar:** every chronic label clicks through to its raw supporting reports;
  the methodology note ships with it (extends R10).

### EXP-14 — Near-miss data federation (BikeMaps.org and kin)
**Pitch:** interoperate with the established cycling-incident crowdsourcing ecosystem — import context, export (consented) contributions.

- **Impact:** the research pass's own evidence base (EV-CROWD-WORKS) leans on
  BikeMaps.org; Davis riders may already report there. Federation avoids
  splitting a small town's reporting energy across silos and connects local
  data to a research-grade platform. Directionally H3 because it requires
  E1 (near-miss category) to exist, consent language to cover re-sharing,
  and a willing partner.
- **Shape:** import: render partner incidents as a clearly-labeled separate
  layer (provenance is a §D transparency commitment — never mix into the
  community feed); export: an opt-in per-report checkbox, schema mapping,
  ODbL/licensing reconciliation. Technically all existing seams: a second
  read adapter + an EXP-07-style export profile.
- **Effort:** L. **Risks/deps:** partner agreement + license compatibility
  (legal-ish gate); consent must be per-report and revocable-in-effect
  (deletion propagation, same policy as EXP-07). **Excellence bar:** a rider
  can tell at a glance which platform any marker came from; a revoked report
  provably stops flowing outward.
