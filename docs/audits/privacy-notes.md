# Privacy notes (DPIA-style) — 2026-05-31

Instantiates `/STANDARDS/RESPONSIBLE-TECH-FRAMEWORK.md` §C for this repo.

## Data inventory

| Data | Why | Where | Retention | Who can access |
|------|-----|-------|-----------|----------------|
| Hazard type/severity/description | Core function | Server store | Until resolved/expired (14–30 d by severity) | Public (after approval) |
| Photo (EXIF-stripped, optionally blurred) | Evidence of hazard | PhotoStore (blob) | Rejected: deleted at decision; resolved/expired: deleted after `RESOLVED_VISIBLE_DAYS` (see retention table) | Public only after approval; moderators before |
| Precise location | 311 dispatch (opt-in only) | Server store, internal | Same as hazard | Server + opt-in 311 hand-off only |
| Public location (fuzzed to a ~70 m grid, ≤~99 m from true) | Map display | Server store | Same as hazard | Public |
| Alert subscription: watch geometry (saved area box, or route polyline **simplified to ~35 m** — corridor precision, never the raw GPS trace) | Saved-route/area push alerts (opt-in, feature-flagged) | Server subscription store | **180-day TTL**, renewed on re-subscribe; expired records pruned before every match | Server only; never public |
| Alert subscription: push endpoint + encryption keys, optional label | Web Push delivery | Server subscription store | Same 180-day TTL | Server only; endpoint/keys redacted from logs |
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
- **Location fuzzing.** Every public coordinate is snapped onto a fixed ~70 m
  grid (`shared/geo.ts`): every true point in a cell publishes as the one
  representative point for that cell, so repeated reports can't be averaged back
  to the true point, and the published point sits within one grid step per axis
  of the true point — worst case the cell diagonal, √2 · 70 m ≈ 99 m. Both the
  ≈99 m bound and the same-cell collapse are property-tested over the Davis bbox
  in `tests/unit/geo.test.ts`, not just asserted by example. The precise point is
  exposed only in an opt-in, moderator-triggered 311 hand-off.
- **Moderation before public.** No unmoderated public photo feed; the photo
  route 404s for any non-approved hazard.
- **No PII in logs.** Fastify logger redacts `authorization`; request bodies
  (which carry photos/locations) are not logged.
- **Minimal retention + precise-location coarsening.** Hazards auto-expire
  (lazy sweep on every read). The precise coordinate is retained only while a
  hazard is *active*: on reject/resolve/expire it is **overwritten with the
  public (fuzzed) point**, so we don't keep a reporter's exact spot once it's no
  longer needed for an optional 311 hand-off.
- **Photo-blob retention & garbage collection.** Photo bytes (full + thumb in
  the PhotoStore) follow the hazard's lifecycle. Rejection deletes the bytes
  immediately in `moderateHazard()` — a rejected photo is the one most likely
  to contain faces/plates. Expired and resolved hazards keep their photo only
  for the public visibility window; an hourly `sweepPhotoRetention()` job
  (`server/index.ts`) then deletes blob + thumb and clears the photo ref.

  | Hazard state | Photo bytes (full + thumb) | TTL |
  |--------------|----------------------------|-----|
  | `pending` | Kept (moderators need them to judge the report) | Until a moderation decision |
  | `approved` | Kept (served via `/api/photos/:id`) | While the hazard is live |
  | `rejected` | **Deleted immediately** on the reject decision | 0 |
  | `resolved` | Deleted by the retention sweep | `RESOLVED_VISIBLE_DAYS` (default 7 d) after resolution |
  | `expired` | Deleted by the retention sweep | `RESOLVED_VISIBLE_DAYS` (default 7 d) after expiry |

  **Residual window:** `/api/photos/:id` responses carry
  `cache-control: public, max-age=3600` (`server/app.ts`), so a copy of a
  deleted photo can persist in browser/CDN caches for up to **1 hour** after
  deletion. Reporter self-deletion has the same residual window.
- **Reporter deletion.** `DELETE /api/reports/<clientId>` removes a report
  (record + photo blobs); the clientId is the device-held capability. Exposed in
  the app's "My reports" and the privacy page.
- **Alert-subscription minimization + TTL (FIX-10).** A saved route watch is a
  home↔work corridor — treated as sensitive location data. Route geometry is
  Douglas–Peucker-simplified to ~35 m (half the public fuzz grid) **before
  storage** (`shared/simplify.ts`, applied in `server/lib/subscriptions.ts`);
  matching is corridor-based so results are unchanged (auto-gated by
  `tests/unit/alerts.test.ts`). Every subscription expires after **180 days**;
  re-subscribing (deterministic id per endpoint) renews it, and expired records
  are pruned before every match and on unsubscribe. Push endpoints (capability
  URLs) and encryption keys (`p256dh`/`auth`/`keys`) are on the log redaction
  list (`server/lib/logger.ts`).
- **Subscription deletion.** `DELETE /api/alerts/subscribe/:id` removes a
  subscription immediately, no auth required. The id is a SHA-1 hash prefix of
  the push endpoint — unguessable to third parties, but derivable by the
  client that holds the endpoint, so the subscriber can always delete their
  own record.

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
- [x] Alert subscriptions minimized (≤ corridor precision) + 180-day TTL +
      endpoint/keys log redaction — **auto-gated** (`alerts.test.ts` match-
      equivalence/TTL tests; `observability.test.ts` redaction test).
- [ ] Location-fuzzing policy sign-off — **review-gated** (privacy reviewer).

**Last verified: 2026-07-02 · Recheck cadence: per data-flow change.**
