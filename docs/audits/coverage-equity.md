# Coverage & equity — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §B for this repo.

## The risk

A crowdsourced map measures **reports received**, not ground-truth danger. Two
failure modes:

- **Allocational bias:** attention and fixes flow to well-covered (often louder
  or wealthier) streets, while under-reported areas are neglected.
- **Representational bias:** an area with no reports reads as "safe" when it is
  really just unobserved.

## Commitments (and where they live in the product)

- **Never equate absence of reports with safety.** Empty results say so
  explicitly: the List empty state reads *"none have been reported here — not
  that the area is safe,"* and the Map caption says *"empty areas mean no
  reports, not guaranteed safety."* Asserted in `tests/unit/ListView.a11y.test.tsx`
  ("frames an empty result as 'no reports', not 'safe'").
- **Surface, don't infer.** Each hazard is labelled *community-reported, not
  verified by the city* (transparency), and we never infer attributes about
  reporters (no accounts, no profiling).
- **Coverage view (shipped).** A "Reports by area" tab (`CoverageView` /
  `src/lib/areas.ts`) buckets reports into Davis areas and lists every area —
  including zero-report ones — with explicit "under-reported, not safe" framing,
  so absence can't masquerade as safety.
- **The coverage view counts reports RECEIVED, not the public feed.** Its
  numbers come from `GET /api/coverage` (`areaReportCounts`,
  `server/lib/hazards.ts`), which tallies every report ever received except
  rejected ones. The public hazard feed carries only approved, unexpired
  hazards plus recently-resolved ones; counted over that set, an area whose
  reports are all still in the moderation queue, or have since expired, shows
  zero and gets labelled a **data desert** — the exact inversion of the truth,
  printed in the one surface built to prevent it. Rejected reports are excluded
  so a spam burst cannot retire an area's data-desert warning. Asserted in
  `tests/unit/coverage.test.ts` and `tests/unit/CoverageView.test.tsx`.
  When the endpoint is unreachable the view falls back to the feed, says so,
  and withholds every desert/over/under flag rather than guessing it.

- **Reports by month (issue #180).** `GET /api/trends` counts the SAME set this
  view counts — reports received, minus rejected — split by the month each was
  received in the town's time zone, and minus seeded demo data, which is counted
  apart so fiction never enters a time series. A test holds the two surfaces to
  each other area by area. A month in which nothing was received anywhere is
  omitted and counted, never shown as zero: a quiet month and a month the service
  was not running in are indistinguishable from this data, and the paused beta
  (#161) makes that live rather than hypothetical. Every trend carries this
  document's own sentence — *A crowdsourced map measures reports received, not
  ground-truth danger.* — in its payload and in the view, and a test fails if the
  two drift apart.
- **Recurring sites are computed but NOT published.** A ranking of places by how
  often they were reported is the allocational bias this document commits to
  avoiding, pointed at a map: it ranks the streets whose riders report most. It is
  behind `CHRONIC_PUBLISH`, off, pending a year of real data and this reviewer's
  sign-off. The per-hazard labels are behind a second flag, off, pending the
  location-fuzzing review (#160), because they disclose the cell-level history of
  reports that have left the map.

## Segments to monitor post-launch

- Reports per Davis neighbourhood / census block over time.
- Report density vs. known cycling-volume corridors.

## Checklist

- [x] "No reports ≠ safe" framing present in UI — **auto-gated** (list/map copy test).
- [x] No inference of reporter attributes — **review-gated** (design: no accounts/PII).
- [x] Coverage-by-area view — **auto-gated** (`areas` + `CoverageView` tests); equity reviewer sign-off pending pre-launch.
- [x] Coverage counts the set it claims to count (reports received, not the live feed) — **auto-gated** (`tests/unit/coverage.test.ts`, `tests/unit/CoverageView.test.tsx`).
- [x] Trends count that same set, month by month, and omit months rather than zero them — **auto-gated** (`tests/unit/trends.test.ts`, `tests/unit/recurrenceApi.test.ts`).
- [ ] Publishing a ranking of recurring sites — **review-gated** (equity reviewer; `CHRONIC_PUBLISH` is off).
- [ ] Publishing per-hazard recurrence labels — **review-gated** (privacy reviewer, #160; `RECURRENCE_BADGES_PUBLISH` is off).

**Last verified: 2026-08-27 · Recheck cadence: per release / quarterly post-launch.**
