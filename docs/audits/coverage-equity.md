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

## Segments to monitor post-launch

- Reports per Davis neighbourhood / census block over time.
- Report density vs. known cycling-volume corridors.

## Checklist

- [x] "No reports ≠ safe" framing present in UI — **auto-gated** (list/map copy test).
- [x] No inference of reporter attributes — **review-gated** (design: no accounts/PII).
- [x] Coverage-by-area view — **auto-gated** (`areas` + `CoverageView` tests); equity reviewer sign-off pending pre-launch.

**Last verified: 2026-05-31 · Recheck cadence: per release / quarterly post-launch.**
