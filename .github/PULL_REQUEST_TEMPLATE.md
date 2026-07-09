<!--
Thanks for opening a PR. This template embeds the repo's Definition of Done
(DEFINITION_OF_DONE.md, QM-18) so it applies by default instead of living only
in CONTRIBUTING.md where it never auto-attached to a PR (the gap this file
fixes — see audit-2026-07-05/davis-bike-hazard-map-REMEDIATION.md P2-4).
-->

## What & why

<!-- What does this change do, and why? Link any related issue. -->

## ISO/IEC 25010 characteristic

<!-- Name the quality characteristic(s) this PR primarily affects, e.g.
     usability, security, maintainability, reliability, performance efficiency. -->

## Definition of Done

See [`DEFINITION_OF_DONE.md`](../DEFINITION_OF_DONE.md) for the full checklist. At minimum:

- [ ] `make verify` is green locally.
- [ ] `make a11y` (and `make e2e` if this touches a user-facing flow) is green.
- [ ] No real photo, location, EXIF, or credential in any new surface, test, or fixture.
- [ ] Tests prove the privacy / moderation / accessibility invariant this change touches, if any.
- [ ] Docs updated to match (README, ARCHITECTURE, I18N, ROADMAP as applicable); an ADR added for
      any significant architectural decision.
- [ ] If this changes `/STANDARDS` applicability or gate status, the README Standards Conformance
      table is updated in this same PR.
- [ ] If this touches a `docs/RESPONSIBLE-TECH-AUDITS.md` §A–F area, the relevant
      `docs/audits/*.md` artifact is updated or a follow-up is filed.

## Security / privacy considerations

<!-- Does this touch photo handling, location data, moderation, or auth? If so, what's the invariant
     and how is it tested? If not, say "None." -->
