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

## Segments to monitor post-launch

- Reports per Davis neighbourhood / census block over time.
- Report density vs. known cycling-volume corridors.

## Checklist

- [x] "No reports ≠ safe" framing present in UI — **auto-gated** (list/map copy test).
- [x] No inference of reporter attributes — **review-gated** (design: no accounts/PII).
- [x] Coverage-by-area view — **auto-gated** (`areas` + `CoverageView` tests); equity reviewer sign-off pending pre-launch.
- [x] Coverage counts the set it claims to count (reports received, not the live feed) — **auto-gated** (`tests/unit/coverage.test.ts`, `tests/unit/CoverageView.test.tsx`).

**Last verified: 2026-08-27 · Recheck cadence: per release / quarterly post-launch.**
