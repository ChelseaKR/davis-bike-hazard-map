import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  lngLatToTile,
  enumerateDavisTiles,
  tilePackCount,
  estimatedTilePackBytes,
  buildTileUrl,
  isBulkDownloadAllowed,
  downloadTilePack,
  DEFAULT_TILE_ZOOMS,
  ESTIMATED_BYTES_PER_TILE,
  TILE_CACHE_NAME,
} from '../../src/lib/tilePack.ts';
import { DAVIS_BOUNDS } from '../../shared/validation.ts';

const SELF_HOSTED = 'https://{s}.tiles.davisbikehazard.org/{z}/{x}/{y}.png';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lngLatToTile', () => {
  it('maps the Davis centre to the correct tile at z=13', () => {
    // Verified against the standard slippy-map reference for 38.5449, -121.7405.
    expect(lngLatToTile(38.5449, -121.7405, 13)).toEqual({ x: 1325, y: 3144 });
  });

  it('maps the Davis centre to the correct tile at z=17', () => {
    expect(lngLatToTile(38.5449, -121.7405, 17)).toEqual({ x: 21211, y: 50305 });
  });

  it('is consistent with the world grid: x scales with zoom', () => {
    // The prime meridian / equator sits on the tile-grid seam at every zoom.
    expect(lngLatToTile(0, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(lngLatToTile(0, 0, 2)).toEqual({ x: 2, y: 2 });
  });

  it('clamps out-of-world coordinates into the valid tile range', () => {
    const z = 3;
    const max = 2 ** z - 1;
    const t = lngLatToTile(89, 179.999, z);
    expect(t.x).toBeLessThanOrEqual(max);
    expect(t.y).toBeLessThanOrEqual(max);
    expect(t.x).toBeGreaterThanOrEqual(0);
    expect(t.y).toBeGreaterThanOrEqual(0);
  });
});

describe('enumerateDavisTiles', () => {
  it('covers every corner of DAVIS_BOUNDS at a given zoom', () => {
    const z = 15;
    const tiles = enumerateDavisTiles([z]);
    const nw = lngLatToTile(DAVIS_BOUNDS.maxLat, DAVIS_BOUNDS.minLng, z);
    const se = lngLatToTile(DAVIS_BOUNDS.minLat, DAVIS_BOUNDS.maxLng, z);
    const has = (x: number, y: number) => tiles.some((t) => t.x === x && t.y === y);
    expect(has(nw.x, nw.y)).toBe(true);
    expect(has(se.x, se.y)).toBe(true);
    // Rectangular grid: count == width * height.
    const w = Math.abs(se.x - nw.x) + 1;
    const h = Math.abs(se.y - nw.y) + 1;
    expect(tiles.length).toBe(w * h);
  });

  it('produces the full-Davis pack count across the default zooms', () => {
    // z13:15 + z14:40 + z15:126 + z16:442 + z17:1768 = 2391 tiles.
    expect(tilePackCount()).toBe(2391);
    expect(enumerateDavisTiles(DEFAULT_TILE_ZOOMS).length).toBe(2391);
  });

  it('has no duplicate {z,x,y} entries', () => {
    const tiles = enumerateDavisTiles();
    const keys = new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`));
    expect(keys.size).toBe(tiles.length);
  });

  it('estimates size as count × per-tile bytes', () => {
    expect(estimatedTilePackBytes()).toBe(2391 * ESTIMATED_BYTES_PER_TILE);
  });
});

describe('buildTileUrl', () => {
  it('expands {z}/{x}/{y} placeholders', () => {
    expect(buildTileUrl('https://host/{z}/{x}/{y}.png', { z: 13, x: 1325, y: 3144 })).toBe(
      'https://host/13/1325/3144.png',
    );
  });

  it('fills the {s} subdomain from a fixed round-robin set', () => {
    const url = buildTileUrl(SELF_HOSTED, { z: 13, x: 1325, y: 3144 });
    expect(url).toMatch(/^https:\/\/[abc]\.tiles\.davisbikehazard\.org\/13\/1325\/3144\.png$/);
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(buildTileUrl('{z}-{z}', { z: 5, x: 1, y: 2 })).toBe('5-5');
  });
});

describe('isBulkDownloadAllowed', () => {
  it('is false for the public OpenStreetMap tile servers (OSM policy)', () => {
    expect(isBulkDownloadAllowed('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')).toBe(false);
    expect(isBulkDownloadAllowed('https://a.tile.openstreetmap.org/13/1325/3144.png')).toBe(false);
  });

  it('is true for a self-hosted / custom tile host', () => {
    expect(isBulkDownloadAllowed(SELF_HOSTED)).toBe(true);
    expect(isBulkDownloadAllowed('https://tiles.example.com/{z}/{x}/{y}.png')).toBe(true);
  });
});

/** Minimal in-memory Cache Storage double. */
function makeFakeCache(preCached: Iterable<string> = []) {
  const store = new Set<string>(preCached);
  const puts: string[] = [];
  const cache = {
    match: vi.fn(async (url: string) => (store.has(url) ? ({} as Response) : undefined)),
    put: vi.fn(async (url: string) => {
      store.add(url);
      puts.push(url);
    }),
  };
  return { cache, puts, store };
}

function okTile(): Response {
  return {
    ok: true,
    status: 200,
    clone() {
      return okTile();
    },
    arrayBuffer: async () => new ArrayBuffer(1024),
  } as unknown as Response;
}

describe('downloadTilePack', () => {
  it('refuses to run against the public OSM tile servers', async () => {
    await expect(
      downloadTilePack({ tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' }),
    ).rejects.toThrow(/policy/i);
  });

  it('fetches and caches uncached tiles, reporting per-run counts', async () => {
    const { cache, puts } = makeFakeCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetchMock = vi.fn(async () => okTile());
    vi.stubGlobal('fetch', fetchMock);

    const progress: number[] = [];
    const res = await downloadTilePack({
      tileUrl: SELF_HOSTED,
      zooms: [13],
      onProgress: (p) => progress.push(p.completed),
    });

    expect(res.fetched).toBe(15);
    expect(res.skipped).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.bytes).toBe(15 * 1024);
    expect(puts.length).toBe(15);
    expect(fetchMock).toHaveBeenCalledTimes(15);
    // Progress advanced monotonically to the final count.
    expect(progress[progress.length - 1]).toBe(15);
  });

  it('skips tiles already present in the cache (no re-fetch)', async () => {
    const z = 13;
    const cachedUrls = enumerateDavisTiles([z]).map((t) => buildTileUrl(SELF_HOSTED, t));
    const { cache } = makeFakeCache(cachedUrls);
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetchMock = vi.fn(async () => okTile());
    vi.stubGlobal('fetch', fetchMock);

    const res = await downloadTilePack({ tileUrl: SELF_HOSTED, zooms: [z] });

    expect(res.skipped).toBe(15);
    expect(res.fetched).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('counts non-ok responses as failed rather than caching them', async () => {
    const { cache } = makeFakeCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }) as Response),
    );

    const res = await downloadTilePack({ tileUrl: SELF_HOSTED, zooms: [13] });

    expect(res.failed).toBe(15);
    expect(res.fetched).toBe(0);
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('rejects immediately with an already-aborted signal', async () => {
    const { cache } = makeFakeCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const fetchMock = vi.fn(async () => okTile());
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort();

    await expect(
      downloadTilePack({ tileUrl: SELF_HOSTED, zooms: [13], signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight download when the signal fires', async () => {
    const { cache } = makeFakeCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        if (calls === 3) controller.abort();
        return okTile();
      }),
    );

    await expect(
      downloadTilePack({
        tileUrl: SELF_HOSTED,
        zooms: [13],
        concurrency: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    // It stopped early rather than fetching all 15 tiles.
    expect(calls).toBeLessThan(15);
  });

  it('reports origin storage usage when the browser exposes it', async () => {
    const { cache } = makeFakeCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    vi.stubGlobal('fetch', vi.fn(async () => okTile()));
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 5_000_000, quota: 100_000_000 }) },
    });

    const res = await downloadTilePack({ tileUrl: SELF_HOSTED, zooms: [13] });
    expect(res.storageUsed).toBe(5_000_000);
    expect(res.storageQuota).toBe(100_000_000);
  });

  it('opens the same cache Workbox uses for on-demand tiles', async () => {
    const { cache } = makeFakeCache();
    const open = vi.fn(async () => cache);
    vi.stubGlobal('caches', { open });
    vi.stubGlobal('fetch', vi.fn(async () => okTile()));

    await downloadTilePack({ tileUrl: SELF_HOSTED, zooms: [13] });
    expect(open).toHaveBeenCalledWith(TILE_CACHE_NAME);
  });
});
