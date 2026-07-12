# Portfolio standards conformance audit — 2026-07-11

- Scope: repository-local requirements from `ChelseaKR/portfolio-standards`
- Standards version used by CI: `v1.0.1`
- Auditor: Codex, reviewed with deterministic portfolio tooling
- Result: conformant for all mechanically evaluated repository-local controls

## Automated evidence

The portfolio conformance checker passes **23/23** controls in strict, offline
mode. The independent honesty-gate action passes **10/10** applicable controls
at notice severity. `make verify` remains the application-code merge gate, and
the dedicated `standards` workflow now runs both standards freshness and strict
conformance on pushes and pull requests.

## Remediations completed

- Replaced the incomplete and stale README declaration with an explicit row for
  every current standard, including reasoned AI Evaluation N/A status.
- Added the required sequential MADR log, migrated the eight decisions formerly
  embedded in `docs/ARCHITECTURE.md`, and recorded the live AWS deployment.
- Added a repository-level i18n discovery entry point that directs tooling and
  maintainers to the canonical FormatJS catalogs under `src/i18n`.
- Reconciled the README's obsolete branch-protection statement with the
  committed and live `protect-main` ruleset posture.
- Preserved the local AWS App Runner/RDS documentation and RDS trust-store image
  change while rebasing the audit onto current `origin/main`.

## Review-gate evidence

Project-specific ethics, bias/equity, privacy, accessibility, moderation,
screen-reader, and residual-risk reviews remain under `docs/audits/` and
`docs/RESPONSIBLE-TECH-AUDITS.md`. Their findings are not duplicated here.

## Recheck

Re-run on every standards-version bump and before each release. Refresh the
responsible-tech and accessibility artifacts when a new user-facing surface,
data class, external provider, or production deployment shape is introduced.
