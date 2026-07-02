/**
 * Davis offline tile pack (EXP-02).
 *
 * Pure slippy-map helpers plus a fetch driver that pre-seeds every raster tile
 * covering `DAVIS_BOUNDS` (zooms 13–17) into the same runtime cache Workbox
 * uses for on-demand tiles (`osm-tiles`), so the map works offline across the
 * whole city — not just the last-browsed area.
 *
 * Gated by OSM policy: bulk pre-fetching against the public
 * `tile.openstreetmap.org` servers is disallowed, so the driver refuses to run
 * (and the UI disables itself) unless the app is pointed at self-hosted tiles
 * (roadmap R8 — "self-host tiles if needed").
 */
import { DAVIS_BOUNDS } from '../../shared/validation.ts';
import { config } from '../config.ts';

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/**
 * Zoom levels seeded by the pack. 13 gives the whole-city overview; 17 is the
 * street-level detail a cyclist needs at an intersection. Higher zooms explode
 * the tile count (each level ~quadruples it), so 17 is the practical ceiling.
 */
export const DEFAULT_TILE_ZOOMS: readonly number[] = [13, 14, 15, 16, 17];

/**
 * Average on-disk size of a 256px OSM raster tile. Real tiles run ~15–25 KB;
 * 20 KB is a middle estimate used ONLY for the pre-download confirmation UI
 * (the real figure comes from `navigator.storage.estimate()` afterwards).
 */
export const ESTIMATED_BYTES_PER_TILE = 20 * 1024;

/** Same cache name as the Workbox `osm-tiles` runtime cache (vite.config.ts). */
export const TILE_CACHE_NAME = 'osm-tiles';

const SUBDOMAINS = ['a', 'b', 'c'] as const;

/**
 * Standard slippy-map projection: (lat, lng, zoom) → integer tile column/row.
 * Result is clamped to the valid `[0, 2^z − 1]` range so out-of-world inputs
 * can't produce negative or overflowing coordinates.
 */
export function lngLatToTile(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const rawX = Math.floor(((lng + 180) / 360) * n);
  const rawY = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v));
  return { x: clamp(rawX), y: clamp(rawY) };
}

/**
 * Every tile covering `DAVIS_BOUNDS` at the given zooms. Latitude increases
 * as tile-row (y) decreases, so `maxLat` maps to the top row and `minLat` to
 * the bottom — we normalise the two corners into ascending ranges before
 * walking the grid.
 */
export function enumerateDavisTiles(zooms: readonly number[] = DEFAULT_TILE_ZOOMS): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (const z of zooms) {
    const topLeft = lngLatToTile(DAVIS_BOUNDS.maxLat, DAVIS_BOUNDS.minLng, z);
    const bottomRight = lngLatToTile(DAVIS_BOUNDS.minLat, DAVIS_BOUNDS.maxLng, z);
    const xMin = Math.min(topLeft.x, bottomRight.x);
    const xMax = Math.max(topLeft.x, bottomRight.x);
    const yMin = Math.min(topLeft.y, bottomRight.y);
    const yMax = Math.max(topLeft.y, bottomRight.y);
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

/** How many tiles the pack covers (drives the confirmation UI). */
export function tilePackCount(zooms: readonly number[] = DEFAULT_TILE_ZOOMS): number {
  return enumerateDavisTiles(zooms).length;
}

/** Rough download/storage size of the pack, in bytes (confirmation UI only). */
export function estimatedTilePackBytes(zooms: readonly number[] = DEFAULT_TILE_ZOOMS): number {
  return tilePackCount(zooms) * ESTIMATED_BYTES_PER_TILE;
}

/**
 * Expand a Leaflet-style tile template (`{s}/{z}/{x}/{y}`) for one tile. The
 * `{s}` subdomain is chosen round-robin from `x + y` so a pack spreads its
 * requests across the host's subdomains instead of hammering one.
 */
export function buildTileUrl(template: string, { z, x, y }: TileCoord): string {
  const s = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
  return template
    .replaceAll('{s}', s)
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y));
}

/**
 * Bulk pre-fetching is forbidden against the public OSM tile servers (usage
 * policy), so it's only allowed when the app is configured with self-hosted
 * (or otherwise policy-cleared) tiles.
 */
export function isBulkDownloadAllowed(url: string): boolean {
  return !/tile\.openstreetmap\.org/i.test(url);
}

export interface TilePackProgress {
  /** Total tiles in the pack. */
  total: number;
  /** Tiles processed so far (fetched + skipped + failed). */
  completed: number;
  fetched: number;
  skipped: number;
  failed: number;
}

export interface TilePackResult {
  fetched: number;
  skipped: number;
  failed: number;
  /** Bytes newly written to the cache this run (0 for already-cached tiles). */
  bytes: number;
  /** Total origin-private storage used, per `navigator.storage.estimate()`. */
  storageUsed?: number;
  /** Storage quota granted to the origin, if the browser reports it. */
  storageQuota?: number;
}

export interface DownloadTilePackOptions {
  onProgress?: (progress: TilePackProgress) => void;
  signal?: AbortSignal;
  zooms?: readonly number[];
  /** Parallel fetches. Kept small (default 5) to be polite to the tile host. */
  concurrency?: number;
  /** Override the tile template (defaults to `config.tileUrl`). */
  tileUrl?: string;
}

/**
 * Fetch driver: enumerates the Davis tiles, skips any already in the
 * `osm-tiles` cache, and downloads the rest with small concurrency and
 * `AbortSignal` support, `cache.put`-ing each response. Returns per-run counts
 * and (best-effort) origin storage usage.
 */
export async function downloadTilePack(options: DownloadTilePackOptions = {}): Promise<TilePackResult> {
  const {
    onProgress,
    signal,
    zooms = DEFAULT_TILE_ZOOMS,
    concurrency = 5,
    tileUrl = config.tileUrl,
  } = options;

  if (!isBulkDownloadAllowed(tileUrl)) {
    throw new Error(
      'Bulk tile download is disabled for the public OpenStreetMap tile servers (usage policy). Configure self-hosted tiles first.',
    );
  }
  if (signal?.aborted) {
    throw new DOMException('Tile download aborted', 'AbortError');
  }

  const tiles = enumerateDavisTiles(zooms);
  const cache = await caches.open(TILE_CACHE_NAME);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  let completed = 0;
  let next = 0;

  const emit = () => onProgress?.({ total: tiles.length, completed, fetched, skipped, failed });
  emit();

  const worker = async () => {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Tile download aborted', 'AbortError');
      const index = next++;
      if (index >= tiles.length) return;

      const url = buildTileUrl(tileUrl, tiles[index]);
      try {
        const existing = await cache.match(url);
        if (existing) {
          skipped++;
        } else {
          const response = await fetch(url, { signal });
          if (response.ok) {
            const measure = response.clone();
            await cache.put(url, response);
            const buffer = await measure.arrayBuffer().catch(() => null);
            if (buffer) bytes += buffer.byteLength;
            fetched++;
          } else {
            failed++;
          }
        }
      } catch (err) {
        // A genuine abort unwinds the whole run; anything else (a single 5xx,
        // a dropped connection) is counted as a failed tile and skipped.
        if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          throw err;
        }
        failed++;
      } finally {
        completed++;
        emit();
      }
    }
  };

  const pool = Array.from({ length: Math.min(concurrency, tiles.length) }, () => worker());
  await Promise.all(pool);

  const result: TilePackResult = { fetched, skipped, failed, bytes };
  // `navigator.storage.estimate` is advisory and not present in every runtime
  // (e.g. jsdom, older browsers), so probe for it defensively.
  const storage = (navigator as Navigator | undefined)?.storage;
  if (storage && typeof storage.estimate === 'function') {
    try {
      const { usage, quota } = await storage.estimate();
      result.storageUsed = usage;
      result.storageQuota = quota;
    } catch {
      // Storage estimate is advisory only — a failure doesn't fail the pack.
    }
  }
  return result;
}
