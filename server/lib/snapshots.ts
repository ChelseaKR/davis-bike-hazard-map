/**
 * Versioned open-data snapshots + a DCAT/schema.org catalog (EXP-07).
 *
 * The live `GET /api/hazards/export` returns *now*. Researchers, journalists,
 * and the city's data portal need *as-of* data with stable identifiers so a
 * published figure ("41 hazards in South Davis in June") stays re-derivable.
 * This module writes dated, checksummed, ODbL-licensed GeoJSON snapshots plus
 * a machine-readable JSON-LD `Dataset` catalog.
 *
 * Deletion propagation (deliberate trade-off): snapshots are REGENERATED from
 * current data on every run — a report a reporter later deletes disappears from
 * ALL snapshots, including previously published dates. The consent ethos wins
 * over perfect bit-for-bit reproducibility; the trade-off is documented in each
 * snapshot's `limits` note, in the catalog, and in docs/OPEN-DATA.md. Cite by
 * `snapshotDate` + `sha256`, which stay stable until the underlying reports
 * change.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Hazard } from '../../shared/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Open Database License 1.0 — the license all exported data carries. */
export const SNAPSHOT_LICENSE = 'ODbL-1.0';
/** Canonical URL for the ODbL, for the catalog's machine-readable `license`. */
export const SNAPSHOT_LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/**
 * The deletion-propagation trade-off, embedded in every snapshot and the
 * catalog so a downstream consumer understands what "as-of" does and does not
 * guarantee here.
 */
export const DELETION_POLICY =
  'Snapshots are regenerated from current data on every run. A report deleted ' +
  'by its reporter is removed from ALL snapshots, including previously published ' +
  'dates: right-to-erasure is upheld at the cost of strict bit-for-bit historical ' +
  'immutability. Locations are privacy-fuzzed and no reporter-identifying fields ' +
  'are included. Cite by snapshotDate + sha256, which are stable until the ' +
  'underlying reports change.';

/** A single GeoJSON Feature in the PII-free public projection. */
export interface HazardFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    id: string;
    category: string;
    severity: string;
    description: string | null;
    confirmations: number;
    createdAt: number;
    updatedAt: number;
  };
}

/** The live-export FeatureCollection shape (GET /api/hazards/export). */
export interface ExportFeatureCollection {
  type: 'FeatureCollection';
  license: string;
  features: HazardFeature[];
}

/** A dated snapshot: the live shape plus as-of metadata and the limits note. */
export interface SnapshotFeatureCollection extends ExportFeatureCollection {
  /** Calendar day (UTC) the snapshot represents, YYYY-MM-DD. */
  snapshotDate: string;
  /** ISO-8601 instant the snapshot is as-of (end of `snapshotDate`, UTC). */
  asOf: string;
  /** Deletion-propagation / privacy trade-off note. */
  limits: string;
}

/**
 * Project one public hazard to a PII-free GeoJSON Feature. Deliberately omits
 * `clientId` (the reporter's deletion capability) and photo URLs — only the
 * fuzzed location and non-identifying attributes are published.
 */
export function hazardFeature(h: Hazard): HazardFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [h.location.lng, h.location.lat] },
    properties: {
      id: h.id,
      category: h.category,
      severity: h.severity,
      description: h.description,
      confirmations: h.confirmations,
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    },
  };
}

/**
 * The live open-data export FeatureCollection. Shared by the live endpoint and
 * the snapshot builder so there is exactly one PII-free projection.
 */
export function exportFeatureCollection(hazards: Hazard[]): ExportFeatureCollection {
  return {
    type: 'FeatureCollection',
    license: SNAPSHOT_LICENSE,
    features: hazards.map(hazardFeature),
  };
}

/** YYYY-MM-DD (UTC) for an epoch-ms instant. */
export function toSnapshotDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last ms of the UTC day named by a YYYY-MM-DD string. */
function endOfDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) + DAY_MS - 1;
}

/**
 * Build a dated snapshot from an already-filtered set of hazards. `asOfMs`
 * fixes both `snapshotDate` (its UTC day) and `asOf` (its ISO instant), so the
 * output — and therefore its checksum — depends only on the data and the date.
 */
export function buildSnapshot(hazards: Hazard[], asOfMs: number): SnapshotFeatureCollection {
  return {
    type: 'FeatureCollection',
    license: SNAPSHOT_LICENSE,
    snapshotDate: toSnapshotDate(asOfMs),
    asOf: new Date(asOfMs).toISOString(),
    limits: DELETION_POLICY,
    features: hazards.map(hazardFeature),
  };
}

/** sha256 hex digest of a string payload. */
export function sha256(payload: string): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** The `shasum -a 256`-compatible checksum-file body for a snapshot. */
export function checksumFile(hash: string, filename: string): string {
  return `${hash}  ${filename}\n`;
}

/** One catalogued distribution: a dated snapshot + its integrity metadata. */
export interface CatalogEntry {
  date: string;
  sha256: string;
  /** ISO instant the snapshot is as-of. */
  dateModified: string;
  featureCount: number;
}

/**
 * Build a schema.org / DCAT `Dataset` JSON-LD document listing every retained
 * snapshot as a `DataDownload` distribution (contentUrl, encodingFormat,
 * sha256, dateModified) under the ODbL, with the deletion-propagation note.
 */
export function buildCatalog(entries: CatalogEntry[], baseUrl = ''): Record<string, unknown> {
  const base = baseUrl.replace(/\/+$/, '');
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return {
    '@context': [
      'https://schema.org/',
      {
        dcat: 'http://www.w3.org/ns/dcat#',
        spdx: 'http://spdx.org/rdf/terms#',
      },
    ],
    '@type': 'Dataset',
    '@id': `${base}/api/exports/catalog.jsonld`,
    name: 'Davis Bike Hazard Map — open-data snapshots',
    description:
      'Dated, checksummed GeoJSON snapshots of approved, privacy-fuzzed cycling ' +
      'hazards in Davis, CA. Each distribution is an as-of FeatureCollection.',
    license: SNAPSHOT_LICENSE_URL,
    creator: {
      '@type': 'Organization',
      name: 'Davis Bike Hazard Map',
    },
    keywords: ['cycling', 'hazards', 'davis', 'open-data', 'geojson', 'odbl'],
    dateModified: sorted.length ? sorted[sorted.length - 1].dateModified : undefined,
    usageInfo: DELETION_POLICY,
    distribution: sorted.map((e) => ({
      '@type': 'DataDownload',
      name: `${e.date}.geojson`,
      contentUrl: `${base}/api/exports/${e.date}.geojson`,
      encodingFormat: 'application/geo+json',
      dateModified: e.dateModified,
      sha256: e.sha256,
      // DCAT/SPDX-style checksum object for consumers that expect it.
      spdx__checksum: {
        '@type': 'spdx:Checksum',
        'spdx:algorithm': 'spdx:checksumAlgorithm_sha256',
        'spdx:checksumValue': e.sha256,
      },
    })),
  };
}

/** Configuration for the snapshot writer/scheduler. */
export interface SnapshotOptions {
  /** Directory dated snapshots + the catalog are written to. */
  dir: string;
  /** How many trailing calendar days to keep (older files are pruned). */
  retain: number;
  /** Loads the current PUBLIC (approved, unexpired, fuzzed) hazards. */
  loadHazards: (now: number) => Promise<Hazard[]> | Hazard[];
  /** Optional absolute base URL for catalog contentUrls (default: relative). */
  baseUrl?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SNAPSHOT_RE = /^(\d{4}-\d{2}-\d{2})\.geojson(\.sha256)?$/;

/** The trailing `retain` calendar days ending at `now`, oldest-first. */
function retainedDates(now: number, retain: number): string[] {
  const startOfToday = Date.parse(`${toSnapshotDate(now)}T00:00:00.000Z`);
  const out: string[] = [];
  for (let i = Math.max(1, retain) - 1; i >= 0; i--) {
    out.push(toSnapshotDate(startOfToday - i * DAY_MS));
  }
  return out;
}

/** Remove snapshot/checksum files whose date is not in `keep`. */
function prune(dir: string, keep: Set<string>): void {
  for (const file of readdirSync(dir)) {
    const m = SNAPSHOT_RE.exec(file);
    if (m && !keep.has(m[1])) unlinkSync(join(dir, file));
  }
}

/**
 * Write one full set of retained snapshots and regenerate the catalog. Each
 * retained date is rebuilt from CURRENT data filtered to `createdAt <=` end of
 * that day, so reporter deletions propagate. Returns the catalog entries.
 * A no-op returning `[]` when no directory is configured.
 */
export async function snapshotOnce(
  opts: SnapshotOptions,
  now: number = Date.now(),
): Promise<CatalogEntry[]> {
  if (!opts.dir) return [];
  if (!existsSync(opts.dir)) mkdirSync(opts.dir, { recursive: true });

  const hazards = await opts.loadHazards(now);
  const dates = retainedDates(now, opts.retain);
  const entries: CatalogEntry[] = [];

  for (const date of dates) {
    const asOfMs = endOfDayMs(date);
    const filtered = hazards.filter((h) => h.createdAt <= asOfMs);
    const snapshot = buildSnapshot(filtered, asOfMs);
    const payload = JSON.stringify(snapshot, null, 2);
    const hash = sha256(payload);
    const geojsonName = `${date}.geojson`;

    writeFileSync(join(opts.dir, geojsonName), payload);
    writeFileSync(join(opts.dir, `${geojsonName}.sha256`), checksumFile(hash, geojsonName));

    entries.push({
      date,
      sha256: hash,
      dateModified: snapshot.asOf,
      featureCount: filtered.length,
    });
  }

  prune(opts.dir, new Set(dates));

  const catalog = buildCatalog(entries, opts.baseUrl);
  writeFileSync(join(opts.dir, 'catalog.jsonld'), `${JSON.stringify(catalog, null, 2)}\n`);

  return entries;
}

/**
 * Start periodic snapshotting: one immediately, then every `intervalMs`.
 * Returns a disposer. A no-op (with a no-op disposer) when snapshots are
 * disabled — no directory, or a non-positive interval. Modeled on
 * `startBackups` in ./backup.ts.
 */
export function startSnapshotScheduler(
  opts: SnapshotOptions & { intervalMs: number },
  log?: (entries: CatalogEntry[]) => void,
  now: () => number = Date.now,
): () => void {
  if (!opts.dir || opts.intervalMs <= 0) return () => {};

  const run = () => {
    snapshotOnce(opts, now())
      .then((entries) => {
        if (log) log(entries);
      })
      .catch(() => {
        // Snapshots are best-effort; never crash the server over one.
      });
  };

  const timer = setInterval(run, opts.intervalMs);
  timer.unref?.();
  run();
  return () => clearInterval(timer);
}

/** Whether a filename is a valid `YYYY-MM-DD.geojson[.sha256]` request. */
export function parseSnapshotName(name: string): { date: string; checksum: boolean } | null {
  const m = SNAPSHOT_RE.exec(name);
  if (!m) return null;
  return { date: m[1], checksum: Boolean(m[2]) };
}

export { DATE_RE };
