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
- **Coverage view (planned).** A reports-per-area overlay that makes coverage
  gaps visible rather than letting absence masquerade as safety. Tracked as a
  follow-up (see ROADMAP §12 / Could-have).

## Segments to monitor post-launch

- Reports per Davis neighbourhood / census block over time.
- Report density vs. known cycling-volume corridors.

## Checklist

- [x] "No reports ≠ safe" framing present in UI — **auto-gated** (list/map copy test).
- [x] No inference of reporter attributes — **review-gated** (design: no accounts/PII).
- [ ] Coverage-by-area view — **review-gated** (planned; equity reviewer sign-off).

**Last verified: 2026-05-31 · Recheck cadence: per release / quarterly post-launch.**
