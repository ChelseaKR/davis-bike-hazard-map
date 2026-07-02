# Open data: versioned, citable hazard snapshots

The map's approved hazards are published as open data under the
[Open Database License 1.0 (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).
Two surfaces:

- **Live export** — `GET /api/hazards/export` returns the current approved,
  privacy-fuzzed hazards as a GeoJSON `FeatureCollection` (`license: "ODbL-1.0"`).
- **Versioned snapshots** — dated, checksummed snapshot files plus a
  machine-readable catalog, so a published figure ("41 hazards in South Davis in
  June") stays re-derivable and citable. This is EXP-07.

All open-data endpoints send `Access-Control-Allow-Origin: *` — read them from
anywhere.

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/hazards/export` | Live GeoJSON `FeatureCollection` (now) |
| `GET /api/exports` | JSON index of available snapshot dates + URLs |
| `GET /api/exports/catalog.jsonld` | DCAT / schema.org `Dataset` catalog (JSON-LD) |
| `GET /api/exports/YYYY-MM-DD.geojson` | One dated snapshot |
| `GET /api/exports/YYYY-MM-DD.geojson.sha256` | Its SHA-256 checksum |

Snapshots are written to disk by a scheduler (`SNAPSHOT_INTERVAL_MS`, default
daily) into `SNAPSHOT_DIR` (default `exports/` beside the JSON data file),
keeping the newest `SNAPSHOT_RETAIN` calendar days (default 30). Snapshots are
disabled when the server runs fully in-memory (no data file).

## Snapshot format

Each `YYYY-MM-DD.geojson` is a GeoJSON `FeatureCollection` with as-of metadata:

```json
{
  "type": "FeatureCollection",
  "license": "ODbL-1.0",
  "snapshotDate": "2026-07-02",
  "asOf": "2026-07-02T23:59:59.999Z",
  "limits": "Snapshots are regenerated from current data on every run…",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-121.7405, 38.5449] },
      "properties": {
        "id": "…",
        "category": "pothole",
        "severity": "high",
        "description": "…",
        "confirmations": 2,
        "createdAt": 1751000000000,
        "updatedAt": 1751000000000
      }
    }
  ]
}
```

`snapshotDate` is a UTC calendar day; `asOf` is the end of that day. A snapshot
for date *D* contains exactly the hazards with `createdAt` on or before the end
of *D*.

### Privacy

Locations are privacy-fuzzed (never the reporter's precise coordinate), and no
reporter-identifying fields are published. In particular the reporter's
`clientId` (their deletion capability) is never present — only the seven
non-identifying `properties` above.

## Verifying a checksum

Each snapshot ships a `shasum -a 256`-compatible sidecar:

```sh
# In the directory containing both files:
shasum -a 256 -c 2026-07-02.geojson.sha256
# 2026-07-02.geojson: OK
```

Or compute and compare manually:

```sh
shasum -a 256 2026-07-02.geojson
cat 2026-07-02.geojson.sha256
```

The same SHA-256 is recorded in `catalog.jsonld` for each distribution
(`sha256`, plus an SPDX `Checksum` object), so you can verify integrity from the
catalog without downloading first.

## Deletion-propagation policy (and its reproducibility trade-off)

Snapshots are **regenerated from current data on every run.** When a reporter
deletes their report (`DELETE /api/reports/:clientId`), it disappears from
**all** snapshots on the next run — including previously published dates.

This is a deliberate choice: the project's consent ethos (a reporter can always
withdraw their data) wins over strict bit-for-bit historical immutability. The
consequence is that a snapshot's bytes — and therefore its SHA-256 — can change
if an underlying report is deleted after the snapshot was first written. They are
otherwise stable.

**How to cite reproducibly:** cite the `snapshotDate` **and** the `sha256` you
verified. That pair pins the exact bytes you used. If a later re-fetch has a
different checksum, some report in that window was withdrawn — which is the
policy working as intended, not corruption. The trade-off is stated in every
snapshot's `limits` field and in the catalog's `usageInfo`.

## License

Open Database License (ODbL) 1.0 —
<https://opendatacommons.org/licenses/odbl/1-0/>. Attribute "Davis Bike Hazard
Map" and share adaptations of the database alike. See `CITATION.cff` for dataset
citation guidance.
