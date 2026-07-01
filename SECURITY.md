# Security policy

Davis Bike Hazard Map handles data that can be **privacy-sensitive**: report photos, the
locations of hazards, and moderator accounts. Because a report can reveal where a person was and
what they photographed, we treat privacy failures as security bugs, equal in severity to a
classic code-execution or auth-bypass flaw. Please read the reporting rules below before opening
anything public.

## Supported versions

This is a pre-1.0 Beta. Security fixes land on `main` and the latest tagged release; there is no
back-porting to older tags. Pin a tag and watch releases for advisories.

| Version | Supported |
| ------- | --------- |
| `main` / latest tag | ✅ |
| older tags | ❌ |

## Reporting a vulnerability

**Do not open a public GitHub issue, pull request, or discussion for a security report.**

Report privately, by either:

1. **GitHub private vulnerability reporting** — *Security → Report a vulnerability* on the
   repository. This opens a private advisory only maintainers can see (preferred; keeps the
   report, fix, and any GHSA linked). Or,
2. **Email** — `ckellyreif@gmail.com` with `dbhm security` in the subject.

Please include, as far as you can:

- the affected version or commit, and whether the app was in dev (in-memory / `admin`) or a
  production (Postgres + real moderator) configuration,
- a minimal reproduction or proof-of-concept,
- the impact you believe it has, and
- any suggested remediation.

Expect an acknowledgement within a few days. This is a volunteer project, so please be patient and
do not disclose publicly until a fix is available.

### Privacy issues are security issues (responsible disclosure)

The following are **first-class** vulnerabilities in this project, not "just bugs":

- **Any path that exposes a photo's stripped EXIF** — original GPS, timestamp, or device metadata
  surviving upload, or a face/plate that should have been blurrable leaking through.
- **Any path that reveals a reporter's precise location** where the app is supposed to serve a
  coarsened value (public map/list, JSON API, export, tile request, log line, metric label, error
  message, or a timing/inference side channel).
- **Any unmoderated public exposure of report content** — a photo or note reaching a public
  surface before a moderator approved it, bypassing the moderation queue.
- **Any moderator-auth weakness** — session-token forgery or non-expiry, login-lockout bypass, or
  the 311 webhook secret (`GOGOV_WEBHOOK_SECRET`) being checkable in non-constant time.

When you report one of these, **describe the shape of the leak, not real personal data**:
"a report photo on route `/api/...` still carried GPS EXIF for an anonymous viewer," never an
actual person's coordinates or image. Reproduce with the seed/synthetic fixtures
(`make seed`, `scripts/seed.ts`, and the test fixtures) — they are clearly fictional and exist
exactly for this. A report that helps us fix a leak must not itself become a leak.

## Our commitments

- We fix privacy-exposure and moderation-bypass bugs at the highest priority.
- We credit reporters who want credit and respect those who want anonymity.
- Dependencies are pinned and scanned in CI (`npm audit` on production deps at high/critical,
  gitleaks secret scan, CodeQL, and a Trivy container scan); GitHub Actions are pinned to full
  commit SHAs. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
  [`.github/workflows/`](.github/workflows/).

## Hardening notes for self-hosters

- `SESSION_SECRET` and `DATABASE_URL` are **required** in production — the server refuses to start
  without them. Never run production on the dev in-memory / `admin` fallback.
- Supply all secrets (`SESSION_SECRET`, `MODERATOR_PASSWORD`, `VAPID_*`, `GOGOV_WEBHOOK_SECRET`,
  storage keys) via the environment only; they are never committed and gitleaks blocks them in CI.
- Rotate `SESSION_SECRET` to invalidate all moderator sessions. Keep `GOGOV_WEBHOOK_SECRET` unset
  until you have a real 311 integration — the webhook stays disabled (503) without it.
- Run `npm audit --omit=dev --audit-level=high` before deploying and keep dependencies on the
  pinned lockfile.
