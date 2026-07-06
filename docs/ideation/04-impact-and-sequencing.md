# Impact × effort and sequencing — 2026-07-01

Covers FIX-01…FIX-14 (`02-large-scale-fixes.md`) and EXP-01…EXP-14
(`03-expansions.md`). "Impact" here means: protects or grows the trust the
product asks of Davis, weighted by the portfolio ethos (a privacy/integrity
fix outranks a feature of equal reach). These are options, not commitments;
the gates section at the bottom is as much a part of the plan as the
sequence.

## Impact × effort matrix

| | **S** | **M** | **L / XL** |
| --- | --- | --- | --- |
| **Critical / high impact** | FIX-01 (capability leak) · FIX-12 (fuzz guarantee) | FIX-02 (webhook hardening) · FIX-03 (photo GC) · FIX-14 (branch reconcile) · FIX-10 (subscription privacy) · EXP-01 (dispute resolution) · EXP-06 (Open311) | FIX-04 (query pushdown/queue) · EXP-05 (schema evolution) · EXP-11 (place packs) · EXP-12 (city MOU — calendar-XL) |
| **Medium impact** | FIX-07a (bound login map) · FIX-13 (JSON lock) · EXP-03 (route honesty, S–M) | FIX-05 (delta feed) · FIX-06 (OpenAPI contract) · FIX-08 (URL state) · FIX-09 (state machine) · FIX-11 (server-side i18n) · EXP-04 (night weighting) · EXP-02 (tile pack) · EXP-07 (dataset snapshots) · EXP-10 (adaptive audience) | EXP-13 (recurrence) · EXP-14 (federation) |
| **Lower / speculative** | — | FIX-07b (shared throttle store) · EXP-08 (OSM notes) · EXP-09 (research access) | — |

Reading it: the top-left cell is rare and precious — FIX-01 is an
hours-scale change that closes the repo's only found integrity hole. The
bottom-right cell is empty by design: nothing here is both huge and
low-value.

## Dependency notes

- **FIX-09 (state machine) → EXP-01 (reopen)**: don't add a new status
  transition to implicit call sites; formalize first. FIX-02's missing
  hand-off check is the same class of bug FIX-09 prevents structurally.
- **FIX-04 (pushdown) → FIX-05 (delta feed)**: the cursor needs
  repository-level filtering; FIX-03's photo GC should also land with/before
  FIX-04's queue rework since both touch pending-photo handling.
- **FIX-14 (branch reconcile) → FIX-08, EXP-03, and anything touching
  `ReportForm`/`MyReports`/`CoverageView` strings**: merge first or pay the
  conflict twice.
- **FIX-10 (subscription privacy) rides with R11** (research roadmap:
  Postgres push store + delivery) — the schema must be minimization-shaped
  before it becomes permanent. FIX-08's deep links are what make R11's
  notifications actually useful (`url: '/'` today).
- **EXP-05 (attributes machinery) → EXP-10 (adaptive taxonomy) and
  strengthens E1/E6**; both taxonomy items share the ROADMAP §4 real-rider
  survey gate.
- **EXP-06 (Open311) → EXP-11 (place packs) and de-risks EXP-12 (city
  MOU)**: a standards adapter is buildable now, testable against public
  fixtures, and is the credible artifact to bring to the city.
- **R8 (self-hosted OSRM/tiles, research roadmap) → EXP-02 (tile pack)**:
  bulk-fetching public OSM tile servers is not acceptable.
- **EXP-07 (snapshots) → EXP-09 (research rollups), EXP-13 (recurrence
  publishing), EXP-14 (export profile)** — one snapshot/aggregation pipeline,
  three consumers.

## Suggested sequence (beyond the existing roadmaps)

This deliberately does **not** re-sequence the research roadmap's Sprint 1/2
(R2, R1, E1, R3, R4, R8 etc.) — it assumes that work proceeds and slots the
net-new layer around it.

**Now (this week — trust repairs, all self-contained):**
1. FIX-01 — capability leak. Hours, critical, zero dependencies.
2. FIX-14 — reconcile branches; everything else lands cleaner after.
3. FIX-12 + FIX-07a + FIX-13 — three S-tier hardening items; a good single
   PR-sized batch of "enforce what the docs promise."
4. FIX-02 — webhook hardening (the parts that don't need the city: body
   HMAC support, replay cache, hand-off existence check).

**Next (the following 2–4 weeks — structural correctness before scale):**
5. FIX-09 — state machine (unlocks EXP-01, hardens FIX-02's class of bug).
6. FIX-03 + FIX-04 — retention GC and read-path scaling as one storage
   workstream; FIX-05 delta feed immediately after.
7. FIX-08 — URL state (pre-req for useful push, sharing, advocacy).
8. FIX-10 — subscription privacy, timed to land with/before R11.
9. EXP-03 + EXP-04 — two small, high-honesty routing upgrades on the
   `shared/routing.ts` seam.
10. FIX-06 — OpenAPI contract gate, before external consumers appear.

**Later (quarter scale — grow reach on the hardened base):**
11. EXP-01 — dispute/reopen loop (after FIX-09; with city messaging care).
12. EXP-06 — Open311 adapter; then use it as the opening artifact for
    EXP-12 conversations.
13. EXP-07 — versioned snapshots + catalog metadata (extends R10).
14. FIX-11 — server-side/static-page localization (with native-ES review).
15. EXP-05 — attributes machinery, once the ROADMAP §4 taxonomy survey has
    real answers; EXP-10 co-designed on top of it.
16. EXP-02 — offline tile pack, after self-hosted tiles (R8).
17. EXP-08, EXP-09 — commons/research programs when a partner materializes.
18. EXP-11, EXP-13, EXP-14 — the H3 bets, each behind its gate below.

## Items behind human / legal / SME / real-data gates

Per the portfolio ethos: these are **deferred and reported honestly, never
faked or simulated past their gate**. Building the code side ahead of the
gate is sometimes fine (dry-run seams are this repo's house style); crossing
the gate is not.

| Item | Gate | What must actually happen |
| --- | --- | --- |
| FIX-02 (full) | City/vendor | GOGov (or shim) must agree to HMAC-signed callbacks; until then the hardened path ships dry-run-testable and the static-secret downgrade is documented, not hidden |
| FIX-11 | Human (native speaker) | Native-Spanish review of policy pages and error strings — same unfilled reviewer role the portfolio i18n plan already flags; no machine-translation sign-off |
| EXP-01 | Human (city relations) | Publicly displaying "riders dispute the city's 'fixed'" needs a heads-up conversation with 311/Public Works first |
| EXP-05 / EXP-10 | Real users + SME | ROADMAP §4 taxonomy survey with real Davis riders; EXP-10 additionally requires co-design with adaptive riders / disability advocates — do not guess this taxonomy |
| EXP-08 | Legal-ish + community | ODbL contribution terms, reporter-consent language update, OSM community norms review |
| EXP-09 | Legal + IRB | Data-use agreement, IRB determination, privacy-reviewer sign-off; consent language updated *before* any sharing |
| EXP-11 | Human (second community) | A real second town committed, with named local moderators — no speculative generalization |
| EXP-12 | Legal + political | MOU, liability language, succession clause; cannot be engineered, only earned |
| EXP-13 | Real data + equity review | Requires multi-season real reporting history (~a year minimum) and an equity review before publishing chronic-site rankings |
| EXP-14 | Legal + partner | License compatibility and a willing partner platform; per-report, revocable consent |
| (Existing, restated for completeness) | Ops/keys | Live 311 delivery (`GOGOV_*`) and web-push delivery (VAPID, R11) remain config-gated exactly as README documents — nothing in this folder changes that honesty |

Also carried over unresolved from the audits (not new, listed so this folder
can't be read as superseding them): the screen-reader walkthrough sign-off
(R7 gate), the equity reviewer sign-off (`coverage-equity.md`), and the
pre-launch manual Safari/iOS device pass that the non-blocking WebKit CI job
stands in for.
