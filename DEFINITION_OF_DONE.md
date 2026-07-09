# Definition of Done

Instantiates `QUALITY-AND-METRICS-STANDARD.md` QM-18. This is the actual merge-readiness
checklist — it replaces the one-line claim that used to live at `README.md`'s "For Claude Code"
section, which asserted "all `/STANDARDS` gates green ✅ Met" without a per-standard breakdown (see
`audit-2026-07-05/davis-bike-hazard-map-AUDIT.md` DOC-11/DOC-14, corrected 2026-07-05). Every PR is
expected to satisfy this before merge; `.github/PULL_REQUEST_TEMPLATE.md` embeds it so it shows up
by default.

## Merge-gate checklist

- [ ] `make verify` is green locally (lint, `lint:css`, i18n gates, typecheck, unit/integration
      tests with coverage thresholds, build).
- [ ] `make a11y` is green; `make e2e` is green if the change touches a user-facing flow.
- [ ] No real photo, precise location, EXIF, or credential appears in any new surface, test, or
      fixture — only synthetic seed/sentinel data (see `CONTRIBUTING.md`).
- [ ] Tests are added or updated; if the change touches the privacy, moderation, or accessibility
      invariant, that invariant is **proven** by a test, not just asserted in prose.
- [ ] Docs are updated to match the change (README, `docs/ARCHITECTURE.md`, `docs/I18N.md`,
      `docs/ROADMAP.md` as applicable).
- [ ] Significant architectural decisions are recorded as an ADR (currently inline in
      `docs/ARCHITECTURE.md` § Architecture Decision Records — see `docs/adr/` migration tracked in
      REMEDIATION.md P2-3).
- [ ] If the change touches a `docs/RESPONSIBLE-TECH-AUDITS.md` §A–F area (ethics, bias/equity,
      privacy, transparency, accessibility, security), the relevant `docs/audits/*.md` artifact is
      updated or a follow-up is filed — don't let those go stale silently (RTF-08).
- [ ] The applicable ISO/IEC 25010 quality characteristic(s) the change primarily affects are named
      in the PR description (e.g. "usability," "security," "maintainability") — this is what QM-18
      means by "characteristic named," and it's a one-line ask, not a formal review.
- [ ] If the change adds, removes, or changes applicability of any `/STANDARDS` control, the
      Standards Conformance table in `README.md` is updated in the same PR — a stale table is a
      defect (DOC-11/DOC-14), not a follow-up.

## Non-negotiable invariants (see `CONTRIBUTING.md` for detail)

- **Privacy gate.** EXIF stripped + blur offered before upload; precise reporter location never
  reaches a public surface.
- **Moderation gate.** No unmoderated public photo feed.
- **Accessibility gate.** Every map view has a fully accessible non-map list-view equivalent; axe
  is merge-blocking.

Last updated: 2026-07-05.
