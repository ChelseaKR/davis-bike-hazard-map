# Privacy notes (DPIA-style) — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §C for this repo.

## Data inventory

| Data | Why | Where | Retention | Who can access |
|------|-----|-------|-----------|----------------|
| Hazard type/severity/description | Core function | Server store | Until resolved/expired (14–30 d by severity) | Public (after approval) |
| Photo (EXIF-stripped, optionally blurred) | Evidence of hazard | Server store | Same as hazard | Public only after approval; moderators before |
| Precise location | 311 dispatch (opt-in only) | Server store, internal | Same as hazard | Server + opt-in 311 hand-off only |
| Public location (fuzzed ~70 m) | Map display | Server store | Same as hazard | Public |
| No accounts, no contact info, no analytics/trackers | — | — | — | — |

**Threat model (specific people in the data):** a bystander photographed in a
street scene; a reporter whose home-adjacent report could reveal where they live.

## Controls implemented

- **EXIF/metadata removal, twice.** Client strips JPEG APP1 (EXIF GPS), XMP,
  IPTC, and comment segments before the photo is queued or displayed
  (`shared/exif.ts`); the server re-strips on intake as a backstop
  (`server/lib/hazards.ts`). Verified by `tests/unit/exif.test.ts` and the
  server test "strips EXIF server-side and gates the photo behind approval".
- **Face/plate blur** offered on every photo (`PhotoEditor`), baked in via
  canvas re-encode (irreversible pixelation, `src/lib/blur.ts`).
- **Location fuzzing.** Every public coordinate is grid-snapped (~70 m,
  deterministic so it can't be averaged back), `shared/geo.ts`. The precise
  point is exposed only in an opt-in, moderator-triggered 311 hand-off.
- **Moderation before public.** No unmoderated public photo feed; the photo
  route 404s for any non-approved hazard.
- **No PII in logs.** Fastify logger redacts `authorization`; request bodies
  (which carry photos/locations) are not logged.
- **Minimal retention.** Hazards auto-expire; lazy sweep on every read.

## "Open-data export" schema

The public API (`GET /api/hazards`) **is** the open-data surface. It returns the
public projection only: no precise location, no raw photo bytes, no contact
info. This is enforced by `toPublic()` and asserted by the server tests
("fuzzes the public location", "gates the photo behind approval").

## Checklist

- [x] EXIF-clean photos — **auto-gated** (unit + server tests).
- [x] No precise location in the public feed — **auto-gated** (server test).
- [x] No PII in logs — **auto-gated** (logger redaction; no body logging).
- [x] Blur offered on every photo — **auto-gated** (PhotoEditor a11y/render test).
- [x] Retention/expiry enforced — **auto-gated** (server expiry test).
- [ ] Location-fuzzing policy sign-off — **review-gated** (privacy reviewer).

**Last verified: 2026-05-31 · Recheck cadence: per data-flow change.**
