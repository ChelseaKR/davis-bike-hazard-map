# Residual-risk register — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §F. STRIDE-style threat
model of the data flows, the controls in place, and the risk that remains.

## Threat model summary

Data flows: phone → (offline queue) → API intake → moderation → public feed →
optional 311 hand-off. Trust boundary at the API; the client is untrusted.

| # | Threat (STRIDE) | Control in place | Residual risk | Owner |
|---|-----------------|------------------|---------------|-------|
| R1 | **Tampering/Info** — malicious or oversized image upload | Type + size + base64 validation (`reportSubmissionSchema`); server re-encodes/strips; 6 MB body cap | Low — no image decoding beyond strip; consider a server-side image re-encode lib pre-launch | maintainer |
| R2 | **Info disclosure** — photo leaks a face/plate | Client blur offered + EXIF strip ×2 + moderation gate | Medium — blur is user-driven; a moderator may miss one. Mitigation: reject-on-doubt policy | moderation |
| R3 | **Info disclosure** — precise location de-anonymises a reporter | ~70 m deterministic fuzzing; precise point server-only | Low — fuzz grid is a tunable trade-off (`DEFAULT_FUZZ_METERS`) | privacy reviewer |
| R4 | **Spoofing/DoS** — spam or flooding | Per-IP global + per-hour report rate limits; idempotent writes; out-of-area rejection | Medium — no account/captcha; a determined actor can rotate IPs | maintainer |
| R5 | **Elevation** — unauthorised moderation | Bearer token required on all moderation/hand-off routes; server is the authority | Medium — shared token (MVP). Move to per-user auth before scaling moderators | maintainer |
| R6 | **Tampering** — 311 adapter injection | Fixed, minimal payload contract; least-privilege; dry-run default | Low — only structured fields forwarded | maintainer |
| R7 | **Repudiation/availability** — data loss on crash | Atomic file writes (temp+rename); idempotent client retries | Low — single-node store; back up the data file in ops | ops |

## Dependency & secret hygiene

- `npm audit` (production deps, fail on high/critical) and `gitleaks` run in CI.
- No secrets in source: the moderator token and any 311 key come only from env
  (`server/config.ts`); `.env` is gitignored; `.env.example` documents them.

## Known limitations carried into v1

- Shared moderator token (R5) and IP-only rate limiting (R4) are MVP-grade.
- Single-node JSON store (R7) — fine for launch volume; PostGIS is the scale path.
- Automatic face detection is best-effort/optional; manual blur is the guarantee.

**Last verified: 2026-05-31 · Recheck cadence: per release / per dependency-advisory.**
