# Residual-risk register — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §F. STRIDE-style threat
model of the data flows, the controls in place, and the risk that remains.

## Threat model summary

Data flows: phone → (offline queue) → API intake → moderation → public feed →
optional 311 hand-off. Trust boundary at the API; the client is untrusted.

| # | Threat (STRIDE) | Control in place | Residual risk | Owner |
|---|-----------------|------------------|---------------|-------|
| R1 | **Tampering/Info** — malicious or oversized image upload | Type + size + base64 validation (`reportSubmissionSchema`); **authoritative server-side re-encode via sharp** (`server/lib/image.ts`): bounded input pixels (~50 MP bomb guard), EXIF-orientation applied, downscaled, ALL metadata stripped, normalized to JPEG + thumbnail; undecodable inputs dropped; 6 MB body cap | Low — decoding is bounded and isolated; revisit limits if larger formats are added | maintainer |
| R2 | **Info disclosure** — photo leaks a face/plate | Client blur offered + EXIF strip ×2 + moderation gate | Medium — blur is user-driven; a moderator may miss one. Mitigation: reject-on-doubt policy | moderation |
| R3 | **Info disclosure** — precise location de-anonymises a reporter | ~70 m deterministic fuzzing; precise point server-only | Low — fuzz grid is a tunable trade-off (`DEFAULT_FUZZ_METERS`) | privacy reviewer |
| R4 | **Spoofing/DoS** — spam or flooding | Per-IP global + per-hour report rate limits; idempotent writes; out-of-area rejection | Medium — no account/captcha; a determined actor can rotate IPs | maintainer |
| R5 | **Elevation** — unauthorised moderation | Per-moderator accounts (scrypt) → signed, expiring session tokens on all moderation/hand-off routes; constant-time login with per-IP **and** per-account lockout; **per-account token version** allows revoking a leaked token / signing out everywhere (`POST /api/auth/revoke`); every decision attributed to a named moderator | Low — session tokens are stateless (revocation is a version bump checked per request); SESSION_SECRET rotation invalidates all sessions globally | maintainer |
| R6 | **Tampering** — 311 adapter injection | Fixed, minimal payload contract; least-privilege; dry-run default | Low — only structured fields forwarded | maintainer |
| R7 | **Repudiation/availability** — data loss on crash | Atomic file writes (temp+rename); idempotent client retries; **automatic timestamped snapshots** (`server/lib/backup.ts`, retained N deep) | Low — single-node store; snapshots are local, so copy them off-box for DR | ops |
| R8 | **Elevation/Tampering** — `GET /api/hazards` formerly published each hazard's `clientId`, which doubles as the deletion capability for `DELETE /api/reports/:clientId` — anyone could scrape the feed and silently delete any report (found + fixed 2026-07-02, FIX-01) | `clientId` removed from the public `Hazard` projection (`server/lib/hazards.ts` `toPublic`) and the `shared/types.ts` `Hazard` interface; it now lives only on `StoredHazard` and the reporter's own device. Regression test "never leaks the reporter clientId in any unauthenticated response (FIX-01)" (`tests/unit/server.test.ts`) asserts the feed, export, and create/confirm bodies never carry it | Low — audit any new projection for capability-ish fields before exposing it | maintainer |

## Dependency & secret hygiene

- `npm audit` (production deps, fail on high/critical) and `gitleaks` run in CI.
- No secrets in source: the moderator token and any 311 key come only from env
  (`server/config.ts`); `.env` is gitignored; `.env.example` documents them.

## Known limitations carried into v1

- IP-only rate limiting (R4) is MVP-grade (no captcha). Moderator auth (R5) is
  now per-user accounts with hashed passwords and expiring sessions.
- Single-**process** JSON store (R7) — fine for launch volume; never run two
  instances against one file. Local snapshots cover crash recovery; PostGIS is
  the scale path (and replaces snapshots with managed backups / pg_dump).
- Automatic face detection is best-effort/optional; manual blur is the guarantee.

**Last verified: 2026-05-31 · Recheck cadence: per release / per dependency-advisory.**
