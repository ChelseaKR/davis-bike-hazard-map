import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSnapshot,
  buildCatalog,
  exportFeatureCollection,
  snapshotOnce,
  SNAPSHOT_LICENSE,
  DELETION_POLICY,
} from '../../server/lib/snapshots.ts';
import type { Hazard } from '../../shared/types.ts';

let dir: string;
// 2026-07-02T15:00Z — the "now" every run is anchored to.
const NOW = Date.UTC(2026, 6, 2, 15);
const JUN30 = Date.UTC(2026, 5, 30, 10);
const JUL01 = Date.UTC(2026, 6, 1, 8);

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: 'deep pothole',
    location: { lat: 38.5449, lng: -121.7405 },
    photoUrl: '/api/photos/h1',
    thumbnailUrl: '/api/photos/h1?size=thumb',
    status: 'approved',
    confirmations: 2,
    createdAt: JUN30,
    updatedAt: JUN30,
    expiresAt: NOW + 1_000_000,
    resolvedAt: null,
    handoff: null,
    ...over,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dbhm-snap-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readGeojson(date: string) {
  return JSON.parse(readFileSync(join(dir, `${date}.geojson`), 'utf8'));
}
function readSha(date: string): string {
  return readFileSync(join(dir, `${date}.geojson.sha256`), 'utf8');
}

describe('exportFeatureCollection', () => {
  it('projects to a PII-free ODbL FeatureCollection', () => {
    const fc = exportFeatureCollection([hazard()]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.license).toBe('ODbL-1.0');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [-121.7405, 38.5449] });
    expect(Object.keys(f.properties).sort()).toEqual(
      ['category', 'confirmations', 'createdAt', 'description', 'id', 'severity', 'updatedAt'].sort(),
    );
  });
});

describe('buildSnapshot', () => {
  it('adds dated, licensed, deletion-policy metadata', () => {
    const snap = buildSnapshot([hazard()], Date.UTC(2026, 6, 2, 23, 59, 59, 999));
    expect(snap.type).toBe('FeatureCollection');
    expect(snap.license).toBe('ODbL-1.0');
    expect(snap.snapshotDate).toBe('2026-07-02');
    expect(snap.asOf).toBe('2026-07-02T23:59:59.999Z');
    expect(snap.limits).toBe(DELETION_POLICY);
    expect(snap.features).toHaveLength(1);
  });
});

describe('snapshotOnce', () => {
  it('writes dated GeoJSON snapshots with a matching sha256 file', async () => {
    const store = [hazard()];
    const entries = await snapshotOnce({ dir, retain: 3, loadHazards: () => store }, NOW);

    // retain=3 ending 2026-07-02 => three trailing days, oldest-first.
    expect(entries.map((e) => e.date)).toEqual(['2026-06-30', '2026-07-01', '2026-07-02']);

    for (const date of ['2026-06-30', '2026-07-01', '2026-07-02']) {
      const payload = readFileSync(join(dir, `${date}.geojson`), 'utf8');
      const gj = JSON.parse(payload);
      expect(gj.snapshotDate).toBe(date);
      expect(gj.license).toBe('ODbL-1.0');

      // The .sha256 file's digest matches the exact bytes on disk.
      const expected = createHash('sha256').update(payload).digest('hex');
      const line = readSha(date);
      expect(line).toBe(`${expected}  ${date}.geojson\n`);
      expect(line.split(/\s+/)[0]).toBe(expected);
    }
  });

  it('never includes reporter PII in feature properties', async () => {
    const store = [hazard({ id: 'secret' })];
    await snapshotOnce({ dir, retain: 1, loadHazards: () => store }, NOW);
    const payload = readFileSync(join(dir, '2026-07-02.geojson'), 'utf8');
    expect(payload).not.toContain('clientId');
    expect(payload).not.toContain('preciseLocation');
    expect(payload).not.toContain('photoUrl');
    const gj = JSON.parse(payload);
    for (const f of gj.features) {
      expect(f.properties).not.toHaveProperty('clientId');
      expect(f.properties).not.toHaveProperty('photoUrl');
      expect(f.properties).not.toHaveProperty('location');
    }
  });

  it('excludes hazards created after a snapshot date', async () => {
    // h-late is created on Jul 1; it must be absent from the Jun 30 snapshot.
    const store = [hazard({ id: 'early', createdAt: JUN30 }), hazard({ id: 'late', createdAt: JUL01 })];
    await snapshotOnce({ dir, retain: 3, loadHazards: () => store }, NOW);

    const jun30 = readGeojson('2026-06-30');
    expect(jun30.features.map((f: { properties: { id: string } }) => f.properties.id)).toEqual(['early']);

    const jul01 = readGeojson('2026-07-01');
    expect(jul01.features.map((f: { properties: { id: string } }) => f.properties.id).sort()).toEqual([
      'early',
      'late',
    ]);
  });

  it('writes a DCAT/schema.org catalog listing distributions with correct checksums', async () => {
    const store = [hazard()];
    await snapshotOnce({ dir, retain: 2, loadHazards: () => store }, NOW);

    const catalog = JSON.parse(readFileSync(join(dir, 'catalog.jsonld'), 'utf8'));
    expect(catalog['@type']).toBe('Dataset');
    expect(catalog.license).toContain('opendatacommons.org');
    expect(catalog.usageInfo).toBe(DELETION_POLICY);
    expect(catalog.distribution).toHaveLength(2);

    for (const dist of catalog.distribution) {
      expect(dist.encodingFormat).toBe('application/geo+json');
      const date = dist.name.replace('.geojson', '');
      const payload = readFileSync(join(dir, `${date}.geojson`), 'utf8');
      const expected = createHash('sha256').update(payload).digest('hex');
      expect(dist.sha256).toBe(expected);
      expect(dist.contentUrl).toBe(`/api/exports/${date}.geojson`);
    }
  });

  it('propagates reporter deletion to previously written snapshots + updates the checksum', async () => {
    const store: Hazard[] = [
      hazard({ id: 'keep', createdAt: JUN30 }),
      hazard({ id: 'delete-me', createdAt: JUN30 }),
    ];
    await snapshotOnce({ dir, retain: 3, loadHazards: () => store }, NOW);

    const before = readGeojson('2026-06-30');
    expect(before.features.map((f: { properties: { id: string } }) => f.properties.id).sort()).toEqual([
      'delete-me',
      'keep',
    ]);
    const shaBefore = readSha('2026-06-30');

    // Reporter deletes their report; the store no longer has it.
    const idx = store.findIndex((h) => h.id === 'delete-me');
    store.splice(idx, 1);
    await snapshotOnce({ dir, retain: 3, loadHazards: () => store }, NOW);

    const after = readGeojson('2026-06-30');
    expect(after.features.map((f: { properties: { id: string } }) => f.properties.id)).toEqual(['keep']);
    // The digest recorded on disk changed to match the new bytes.
    const shaAfter = readSha('2026-06-30');
    expect(shaAfter).not.toBe(shaBefore);
    const payload = readFileSync(join(dir, '2026-06-30.geojson'), 'utf8');
    expect(shaAfter.split(/\s+/)[0]).toBe(createHash('sha256').update(payload).digest('hex'));
  });

  it('prunes snapshots outside the retain window', async () => {
    const store = [hazard()];
    // First run keeps 5 days, then a run with retain=2 should prune to 2.
    await snapshotOnce({ dir, retain: 5, loadHazards: () => store }, NOW);
    expect(readdirSync(dir).filter((f) => f.endsWith('.geojson'))).toHaveLength(5);
    await snapshotOnce({ dir, retain: 2, loadHazards: () => store }, NOW);
    const geojson = readdirSync(dir).filter((f) => f.endsWith('.geojson')).sort();
    expect(geojson).toEqual(['2026-07-01.geojson', '2026-07-02.geojson']);
    // Checksums for pruned dates are gone too.
    expect(existsSync(join(dir, '2026-06-28.geojson.sha256'))).toBe(false);
  });

  it('is a no-op returning [] when no directory is configured', async () => {
    const entries = await snapshotOnce({ dir: '', retain: 3, loadHazards: () => [] }, NOW);
    expect(entries).toEqual([]);
  });
});

describe('buildCatalog', () => {
  it('prefixes contentUrls with an absolute base URL when given', () => {
    const catalog = buildCatalog(
      [{ date: '2026-07-02', sha256: 'abc', dateModified: '2026-07-02T23:59:59.999Z', featureCount: 1 }],
      'https://data.example.org',
    );
    const dist = (catalog.distribution as Array<{ contentUrl: string }>)[0];
    expect(dist.contentUrl).toBe('https://data.example.org/api/exports/2026-07-02.geojson');
    expect(catalog.license).toBe('https://opendatacommons.org/licenses/odbl/1-0/');
  });
});

describe('license constant', () => {
  it('is ODbL-1.0', () => {
    expect(SNAPSHOT_LICENSE).toBe('ODbL-1.0');
  });
});
