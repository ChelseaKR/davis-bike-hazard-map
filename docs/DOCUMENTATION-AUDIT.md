# Documentation Audit

Last reviewed: 2026-07-08. Base branch: `main`.

This audit records the documentation sweep and remediation loop for this repository. It checks the docs as a system: entry points, root-level process and legal files, project scope, setup and validation notes, safety and privacy posture, architecture and planning docs, local links, and the places where code, tests, workflows, and docs meet.

## Audit Results

| Area | Result | Evidence |
| --- | --- | --- |
| Entry docs | pass | `README.md` present |
| Security/process docs | pass | CONTRIBUTING.md, SECURITY.md, CHANGELOG.md |
| Architecture/planning docs | pass | 1 architecture/interface docs; 6 planning/research docs |
| Safety/privacy/audit docs | pass | 8 safety/privacy/accessibility/audit docs |
| Validation surface | pass | 56 test files; 7 workflow files |
| Local doc links | pass | 60 authored-doc links checked; 0 unresolved |

## Root-Level Documentation Audit

This section covers hand-authored documentation at the repository root and root-adjacent GitHub templates. It is separate from the `docs/` inventory so README, process, legal, release, and project-specific root files do not get hidden inside the larger docs tree.

| Surface | Result | Evidence |
| --- | --- | --- |
| Root README | pass | Present: `README.md` |
| Root process docs | pass | Present: `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md` |
| Root legal, citation, and conduct docs | pass | Present: `LICENSE`, `NOTICE`, `CITATION.cff`, `CODE_OF_CONDUCT.md` |
| Other root project docs | info | `BETA.md`, `DEFINITION_OF_DONE.md` |
| Root-adjacent GitHub templates | pass | `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS` |
| Root/template doc links | pass | 35 root-level/template links checked; 0 unresolved |

Root-level files checked:

- `BETA.md`
- `CHANGELOG.md`
- `CITATION.cff`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `DEFINITION_OF_DONE.md`
- `LICENSE`
- `NOTICE`
- `README.md`
- `SECURITY.md`

Root-adjacent template files checked:

- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/CODEOWNERS`

## Remediation In This PR

- Added missing root-level remediation docs found by the audit loop, including legal, conduct, contribution, or security files where absent.
- Added `docs/PROJECT-SCOPE.md` as the plain-language project and boundary map.
- Added this audit record so future doc changes have a dated baseline.
- Added or refreshed the docs index so scope, audit, and primary docs are easy to find.
- Fixed or added root/doc remediation files: `NOTICE`, `README.md`.

## Repo Surfaces Checked

Package and workspace metadata:

- Node workspace `package.json` named `davis-bike-hazard-map` (scripts: a11y, build, dev, dev:client, dev:server, e2e, e2e:i18n, i18n:bcp47).

Source and operations surfaces seen at the repo root:

- `docker-compose.yml`
- `Dockerfile`
- `Makefile`
- `package-lock.json`
- `package.json`
- `public/`
- `scripts/`
- `server/`
- `shared/`
- `src/`
- `tests/`

Workflow files checked:

- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/container-scan.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/secret-audit.yml`
- `.github/workflows/standards.yml`
- `.github/workflows/workflow-lint.yml`

## Documentation Inventory

| Category | Count | Representative files |
| --- | ---: | --- |
| architecture and interfaces | 1 | `docs/ARCHITECTURE.md` |
| entry points and repo process | 10 | `.github/CODEOWNERS`, `.github/PULL_REQUEST_TEMPLATE.md`, `CHANGELOG.md`, `CITATION.cff`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `LICENSE`, `NOTICE`, plus 2 more |
| other docs | 6 | `BETA.md`, `DEFINITION_OF_DONE.md`, `docs/I18N.md`, `docs/PROJECT-SCOPE.md`, `docs/README.md`, `public/robots.txt` |
| planning and research | 6 | `docs/ROADMAP.md`, `docs/ideation/01-deep-dive.md`, `docs/ideation/02-large-scale-fixes.md`, `docs/ideation/03-expansions.md`, `docs/ideation/04-impact-and-sequencing.md`, `docs/ideation/README.md` |
| safety, privacy, accessibility, and audits | 8 | `docs/DOCUMENTATION-AUDIT.md`, `docs/RESPONSIBLE-TECH-AUDITS.md`, `docs/audits/accessibility-2026-05-31.md`, `docs/audits/coverage-equity.md`, `docs/audits/moderation-policy.md`, `docs/audits/privacy-notes.md`, `docs/audits/residual-risk.md`, `docs/audits/screen-reader-walkthrough.md` |

Full hand-authored doc inventory checked by this pass:

- `.github/CODEOWNERS`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `BETA.md`
- `CHANGELOG.md`
- `CITATION.cff`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `DEFINITION_OF_DONE.md`
- `LICENSE`
- `NOTICE`
- `README.md`
- `SECURITY.md`
- `docs/ARCHITECTURE.md`
- `docs/DOCUMENTATION-AUDIT.md`
- `docs/I18N.md`
- `docs/PROJECT-SCOPE.md`
- `docs/README.md`
- `docs/RESPONSIBLE-TECH-AUDITS.md`
- `docs/ROADMAP.md`
- `docs/audits/accessibility-2026-05-31.md`
- `docs/audits/coverage-equity.md`
- `docs/audits/moderation-policy.md`
- `docs/audits/privacy-notes.md`
- `docs/audits/residual-risk.md`
- `docs/audits/screen-reader-walkthrough.md`
- `docs/ideation/01-deep-dive.md`
- `docs/ideation/02-large-scale-fixes.md`
- `docs/ideation/03-expansions.md`
- `docs/ideation/04-impact-and-sequencing.md`
- `docs/ideation/README.md`
- `public/robots.txt`

## Link Check

- Checked 60 local links in authored Markdown and MDX docs.
- Unresolved authored-doc links after remediation: 0.
- Root-level/template unresolved links after remediation: 0.

Audit scope notes:

- Generated sites, deployed app routes, raw third-party HTML captures, and golden fixture websites were inventoried as product or data surfaces but excluded from authored-doc link failure counts.

## Validation Notes

- The audit was generated from a clean worktree based on `origin/main` for this PR branch.
- Ran a local relative-link check over hand-authored Markdown and MDX docs.
- Ran an explicit root-level documentation presence and link check for README, process, legal, project, and template docs.
- Ran `git diff --check` across the PR worktrees after remediation.
- Product test suites remain the authority for runtime behavior; this PR changes documentation only.
