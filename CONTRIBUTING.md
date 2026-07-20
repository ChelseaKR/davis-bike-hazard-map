# Contributing to Davis Bike Hazard Map

Thanks for considering a contribution. This is a civic, community-facing app that people use on a
bike, in the real world, with photos and locations that can be privacy-sensitive. So contributing
here carries one obligation most projects do not: **privacy, moderation, and accessibility are
first-class engineering requirements, not nice-to-haves.** Please read this whole document before
opening an issue or a pull request.

If you have not yet, read [`README.md`](README.md) for what the project is and why, and
[`SECURITY.md`](SECURITY.md) for how to report a vulnerability. The
[Code of Conduct](CODE_OF_CONDUCT.md) applies to every interaction.

## Project independence

Davis Bike Hazard Map is an independent, personal open-source project (Apache-2.0). It is not affiliated
with, sponsored by, or endorsed by the City of Davis, any employer, or any client, and it contains
no proprietary or client material. Please keep it that way: contribute only what you have the right
to release under the Apache-2.0 license, and never bring closed material into this repository.

## Don't paste real personal data (read this first)

**Never put a real person's photo, precise location, EXIF, or moderator credential into an issue,
a pull request, a commit message, a test, or a fixture.** A report or a test that helps us fix a
privacy leak must not itself become a leak.

- Reproduce bugs with the seed data (`make seed`, `scripts/seed.ts`) and the synthetic test
  fixtures — they are clearly fictional and exist exactly for this. If a fixture you need does not
  exist, add a synthetic one; do not reach for real data.
- Describe a disclosure flaw by its **shape**, not its content: "a report photo on route X still
  carried GPS EXIF for an anonymous viewer," never an actual person's coordinates or image.
- Scrub screenshots and pasted logs before attaching them.

## Getting set up

The project is Node (≥ 20) + TypeScript: a Vite/React PWA client, a Fastify API server, and a
framework-free shared domain layer. One command installs everything:

```bash
make install        # npm install (client + server + tooling)
make dev            # client (Vite, :5173) + API (:8787) with hot reload
                    # dev moderator login is admin / admin (printed to the log)
```

The app runs with all defaults unset (in-memory store, an `admin`/`admin` dev moderator). See
[`.env.example`](.env.example) for configuration. Run `make help` to list every target.

## The merge gate: `make verify`

A change merges only when the full gate set is green. Reproduce the core gate locally with:

```bash
make verify         # lint + typecheck + unit/integration tests + build
```

`make verify` runs the same `npm` scripts CI runs, on the same pinned toolchain, so green locally
means green in CI. The full gate set:

| Gate | Command | What it checks |
| --- | --- | --- |
| Lint + typecheck | `make verify` | ESLint clean, TypeScript strict (no emit) |
| Unit + integration | `make verify` | Vitest; coverage thresholds enforced. Set `TEST_DATABASE_URL` to also run the Postgres adapter tests |
| Accessibility | `make a11y` | zero axe violations (component-level) |
| End-to-end | `make e2e` | offline capture → sync → moderated → on the map, plus full-page a11y (run `make e2e-install` once first) |
| Security | CI | `npm audit` (high/critical, prod deps) + gitleaks secret scan |

Three gates protect the project's core promises, and a regression in any of them must be
unmistakable, not buried:

- **Privacy gate.** Photos must have their EXIF stripped and offer face/plate blurring **before
  upload**; precise reporter location must never reach a public surface (it is coarsened). If your
  change touches photo handling (`shared/` EXIF/blur logic, the capture/editor UI) or any read path
  that emits location, prove the guarantee still holds with tests.
- **Moderation gate.** There is no unmoderated public photo feed. Report content reaches a public
  surface only after a moderator approves it. Don't add a path around the queue.
- **Accessibility gate.** Every map view has an equivalent, fully accessible **non-map list view**,
  and the app stays usable on mobile data and offline. Axe is merge-blocking; a regression fails
  the build. Manual screen-reader review (NVDA, VoiceOver) is part of the bar before a public
  launch.

## Commit style: Conventional Commits + DCO sign-off

This repository uses [Conventional Commits](https://www.conventionalcommits.org/). The type drives
the changelog and the next semver bump.

```
<type>(<scope>): <imperative summary>

<body — what & why, not how>

Signed-off-by: Your Name <you@example.com>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`. A breaking
change is marked with `!` after the type/scope and explained in a `BREAKING CHANGE:` footer. Useful
scopes mirror the layout: `client`, `server`, `shared`, `map`, `capture`, `moderation`, `routing`,
`a11y`, `dx`, `ci`, `docs`.

Contributions are accepted under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). **Sign off every
commit** so the certification is on record:

```bash
git commit -s -m "fix(server): coarsen location on the public hazard export"
```

`-s` appends the `Signed-off-by:` trailer matching your `git config user.name`/`user.email`. If you
forget, `git commit --amend -s` (or `git rebase --signoff main` for a series) fixes it. By signing
off you certify you wrote the contribution or have the right to submit it under the Apache-2.0 license. A
**pre-commit hook** (husky + lint-staged) runs ESLint on staged files locally.

## Pull requests

Open a PR against `main`. Before requesting review:

- [ ] `make verify` is green locally.
- [ ] `make a11y` (and `make e2e` if you touched a user-facing flow) is green.
- [ ] No real photo, location, EXIF, or credential appears in any new surface, test, or fixture —
      only synthetic seed/sentinel data.
- [ ] Tests are added or updated; the privacy / moderation / accessibility invariant your change
      touches is proven, not asserted.
- [ ] Docs are updated to match the change; significant architectural decisions are recorded as an
      ADR under [`docs/`](docs/) (ARCHITECTURE / ADRs).

Keep PRs focused, explain the *why* in the description, and link any related issue. Reviews look
hardest at anything near a photo, a location, a read path, or the moderation queue.

## Reporting bugs and security issues

- **Security, or any privacy / moderation-bypass flaw:** do **not** open a public issue. Use
  GitHub's private vulnerability reporting (**Security** tab → "Report a vulnerability"), or email
  **ckellyreif@gmail.com** as a fallback. See [`SECURITY.md`](SECURITY.md).
- **Ordinary bugs and accessibility barriers:** open a normal issue, describing the shape of the
  problem with synthetic data only.

## License

By contributing, you agree that your contributions are licensed under the project's
[Apache-2.0](LICENSE) license, and that you have the right to release what you contribute.
