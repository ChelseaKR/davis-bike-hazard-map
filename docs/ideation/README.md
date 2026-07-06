# Ideation — large-scale fixes & expansions

**Drafted: 2026-07-01.** This folder is the third documentation layer for this
repo, and it is deliberately different in kind from the other two:

1. [`docs/ROADMAP.md`](../ROADMAP.md) — the original build spec (M0–M6, mostly
   delivered; see [`ARCHITECTURE.md`](../ARCHITECTURE.md) for what was actually
   built and why it diverged).
2. `docs/RESEARCH-ROADMAP.md` + `docs/USER-RESEARCH.md` — the 2026-06-30
   synthetic-stakeholder research pass (R1–R12 remediations, E1–E9 expansions).
   **Note:** as of 2026-07-01 those two documents exist only on the
   `research-panel-and-roadmap` branch (commit `094ef6f`), not on `main` — see
   FIX-14 in this folder.
3. **This folder** — net-new ideation from a fresh, code-level deep dive:
   deep structural fixes and larger expansions that the two layers above do
   *not* already contain. Where an idea builds on an existing item, it cites
   that item's ID (R*/E* from the research roadmap, or a ROADMAP section) and
   states what goes beyond it.

## Contents

| File | What it holds |
| --- | --- |
| [`01-deep-dive.md`](./01-deep-dive.md) | Current-state assessment from reading the code: architecture, genuine strengths, observed debt/gaps, portfolio position |
| [`02-large-scale-fixes.md`](./02-large-scale-fixes.md) | FIX-01…FIX-14 — structural fixes (correctness, security, privacy, performance, operability, i18n/a11y) |
| [`03-expansions.md`](./03-expansions.md) | EXP-01…EXP-14 — expansions in three horizons (deepen core / adjacent / transformative) |
| [`04-impact-and-sequencing.md`](./04-impact-and-sequencing.md) | Impact×effort matrix, dependencies, Now/Next/Later, and the honest list of human/legal/SME/real-data gates |

## Ground rules this folder follows

- **Ideas, not commitments.** Nothing here is scheduled or promised. Each item
  is an option to evaluate — several explicitly *should not* be built until a
  named gate (real users, the city, an SME, legal review) is cleared. Where the
  analysis is uncertain, the uncertainty is stated in the item itself.
- **Net-new only.** Items already carried by ROADMAP.md or RESEARCH-ROADMAP.md
  are referenced, never restated.
- **Grounded in the code as read on 2026-07-01** (branch
  `i18n-catalog-retrofit`, clean tree, HEAD `2faf788`). Every fix cites the
  file(s) it would touch; two of the fixes are findings from this read
  (FIX-01, FIX-02) that were verified against the source, not assumed.
- **Portfolio ethos applies throughout:** honesty-as-a-feature ("reports
  received, not ground truth"), privacy/consent boundaries (no accounts, EXIF
  strip, fuzzing), reproducibility, accessibility as a gate, and equity of
  coverage (absence ≠ safety).
