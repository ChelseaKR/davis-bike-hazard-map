# Privacy notes (DPIA-style) — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §C for this repo.

## Data inventory

| Data | Why | Where | Retention | Who can access |
|------|-----|-------|-----------|----------------|
| Hazard type/severity/description | Core function | Server store | Until resolved/expired (14–30 d by severity) | Public (after approval) |
| Photo (EXIF-stripped, optionally blurred) | Evidence of hazard | Server store | Same as hazard | Public only after approval; moderators before |
| Precise location | 311 dispatch (opt-in only) | Server store, internal | Same as hazard | Server + opt-in 311 hand-off only |
| Public location (grid-snapped 70 m; ≤ 105 m from true point, test-enforced) | Map display | Server store | Same as hazard | Public |
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
- **Location fuzzing — measured guarantee.** Every public coordinate is
  snapped to a fixed 70 m grid (`shared/geo.ts`). The snap lands on cell
  *edges* (half-step-offset grid lines), so each axis can move up to one full
  step: the published point is **within 105 m of the true point** (measured
  worst case over the Davis bbox ≈ 99 m ≈ √2 × 70 m), enforced by property
  tests (fast-check) in `tests/unit/geo.test.ts` ("never displaces … more
  than 1.5 x the grid size" and the worst-case sweep). Snapping is
  deterministic — the same true location always publishes the identical
  coordinate, and same-latitude reports in one grid cell are byte-identical —
  so repeated reports cannot be averaged back to the true point. The precise
  point is exposed only in an opt-in, moderator-triggered 311 hand-off.
- **Moderation before public.** No unmoderated public photo feed; the photo
  route 404s for any non-approved hazard.
- **No PII in logs.** Fastify logger redacts `authorization`; request bodies
  (which carry photos/locations) are not logged.
- **Minimal retention + precise-location coarsening.** Hazards auto-expire
  (lazy sweep on every read). The precise coordinate is retained only while a
  hazard is *active*: on reject/resolve/expire it is **overwritten with the
  public (fuzzed) point**, so we don't keep a reporter's exact spot once it's no
  longer needed for an optional 311 hand-off.
- **Reporter deletion.** `DELETE /api/reports/<clientId>` removes a report
  (record + photo blobs); the clientId is the device-held capability. Exposed in
  the app's "My reports" and the privacy page.

## "Open-data export" schema

The public API is the open-data surface. `GET /api/hazards` returns the public
projection only (no precise location, no raw photo bytes, no contact info), and
`GET /api/hazards/export` serves the same data as **GeoJSON (ODbL)** for reuse.
Enforced by `toPublic()` and asserted by the server tests ("fuzzes the public
location", "gates the photo behind approval", "exports GeoJSON", "coarsens …").
A user-facing **privacy page** (`/privacy.html`) and **accessibility statement**
(`/accessibility.html`) are linked from the footer.

## Checklist

- [x] EXIF-clean photos — **auto-gated** (unit + server tests).
- [x] No precise location in the public feed — **auto-gated** (server test).
- [x] No PII in logs — **auto-gated** (logger redaction; no body logging).
- [x] Blur offered on every photo — **auto-gated** (PhotoEditor a11y/render test).
- [x] Retention/expiry enforced — **auto-gated** (server expiry test).
- [x] Fuzzing displacement bound (≤ 105 m) + determinism — **auto-gated**
      (fast-check property tests, `tests/unit/geo.test.ts`).
- [ ] Location-fuzzing policy sign-off — **review-gated** (privacy reviewer).

**Last verified: 2026-05-31 · Recheck cadence: per data-flow change.**
