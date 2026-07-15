import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryRepository,
  JsonFileRepository,
  createRepository,
} from '../../server/lib/repository.ts';
import { MemoryPhotoStore } from '../../server/lib/photoStore.ts';
import {
  createHazard,
  moderateHazard,
  sweepExpired,
  sweepPhotoRetention,
  thumbKey,
  toModeration,
  listPublicFeed,
} from '../../server/lib/hazards.ts';
import type { ValidatedReport } from '../../shared/validation.ts';
import type { Severity } from '../../shared/types.ts';

const ttl = { ttlDays: { low: 1, moderate: 1, high: 1 } as Record<Severity, number> };
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function report(over: Partial<ValidatedReport> = {}): ValidatedReport {
  return {
    category: 'pothole',
    severity: 'high',
    description: 'x',
    location: { lat: 38.5449, lng: -121.7405 },
    photo: null,
    clientId: '11111111-1111-4111-8111-111111111111',
    capturedAt: NOW,
    ...over,
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('sweepExpired', () => {
  it('expires approved hazards past their TTL', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    await moderateHazard(repo, photos, h.id, 'approve', NOW);
    expect(await sweepExpired(repo, NOW)).toBe(0); // not yet
    expect(await sweepExpired(repo, NOW + 2 * DAY)).toBe(1);
    expect((await repo.findById(h.id))!.status).toBe('expired');
  });
});

/** Create a hazard and attach photo bytes (full + thumb) to the stores. */
async function hazardWithPhoto(repo: MemoryRepository, photos: MemoryPhotoStore) {
  const h = await createHazard(repo, photos, report(), NOW, ttl);
  await photos.put(h.id, new Uint8Array([1, 2, 3]));
  await photos.put(thumbKey(h.id), new Uint8Array([4, 5]));
  return (await repo.update(h.id, { photo: { mime: 'image/jpeg' } }))!;
}

describe('photo retention', () => {
  it('deletes blob + thumb immediately when a hazard is rejected', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await hazardWithPhoto(repo, photos);

    const updated = await moderateHazard(repo, photos, h.id, 'reject', NOW);
    expect(updated?.status).toBe('rejected');
    expect(updated?.photo).toBeNull();
    expect(await photos.has(h.id)).toBe(false);
    expect(await photos.has(thumbKey(h.id))).toBe(false);
  });

  it('keeps the photo on approve and resolve (still publicly visible)', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await hazardWithPhoto(repo, photos);

    await moderateHazard(repo, photos, h.id, 'approve', NOW);
    const resolved = await moderateHazard(repo, photos, h.id, 'resolve', NOW);
    expect(resolved?.photo).toEqual({ mime: 'image/jpeg' });
    expect(await photos.has(h.id)).toBe(true);
    expect(await photos.has(thumbKey(h.id))).toBe(true);
  });

  it('sweeps resolved photos only after the grace window', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await hazardWithPhoto(repo, photos);
    await moderateHazard(repo, photos, h.id, 'approve', NOW);
    await moderateHazard(repo, photos, h.id, 'resolve', NOW);

    // Within the grace window: untouched.
    expect(await sweepPhotoRetention(repo, photos, NOW + 6 * DAY, 7 * DAY)).toBe(0);
    expect(await photos.has(h.id)).toBe(true);

    // Past the grace window: blob + thumb gone, photo ref cleared.
    expect(await sweepPhotoRetention(repo, photos, NOW + 8 * DAY, 7 * DAY)).toBe(1);
    expect(await photos.has(h.id)).toBe(false);
    expect(await photos.has(thumbKey(h.id))).toBe(false);
    expect((await repo.findById(h.id))?.photo).toBeNull();
  });

  it('sweeps expired photos after the grace window', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await hazardWithPhoto(repo, photos);
    await moderateHazard(repo, photos, h.id, 'approve', NOW);
    await sweepExpired(repo, NOW + 2 * DAY); // ttl is 1 day

    expect(await sweepPhotoRetention(repo, photos, NOW + 2 * DAY, 7 * DAY)).toBe(0);
    expect(await sweepPhotoRetention(repo, photos, NOW + 10 * DAY, 7 * DAY)).toBe(1);
    expect(await photos.has(h.id)).toBe(false);
    expect(await photos.has(thumbKey(h.id))).toBe(false);
  });

  it('never touches pending hazards (moderation queue still needs the bytes)', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await hazardWithPhoto(repo, photos); // stays pending

    expect(await sweepPhotoRetention(repo, photos, NOW + 100 * DAY, 7 * DAY)).toBe(0);
    expect(await photos.has(h.id)).toBe(true);
    expect(await photos.has(thumbKey(h.id))).toBe(true);
    expect((await repo.findById(h.id))?.photo).toEqual({ mime: 'image/jpeg' });
  });
});

describe('toModeration', () => {
  it('inlines the photo as a data URL for the moderator', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    await photos.put('id1', new Uint8Array([1, 2, 3]));
    const stored = await createHazard(repo, photos, report(), NOW, ttl);
    // Force a photo ref onto the stored record.
    const withPhoto = { ...stored, id: 'id1', photo: { mime: 'image/jpeg' } };
    const view = await toModeration(withPhoto, photos);
    expect(view.photoUrl?.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});

describe('listPublicFeed', () => {
  it('omits resolved hazards when the visibility window is zero', async () => {
    const repo = new MemoryRepository();
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);
    await moderateHazard(repo, photos, h.id, 'approve', NOW);
    await moderateHazard(repo, photos, h.id, 'resolve', NOW);
    expect(await listPublicFeed(repo, NOW, 0)).toHaveLength(0);
  });
});

describe('createRepository', () => {
  it('returns an in-memory store with no options', async () => {
    const repo = await createRepository({});
    expect(repo).toBeInstanceOf(MemoryRepository);
  });

  it('returns a JSON-file store that persists and reloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-'));
    tmpDirs.push(dir);
    const path = join(dir, 'hazards.json');
    const repo = (await createRepository({ dataFile: path })) as JsonFileRepository;
    const photos = new MemoryPhotoStore();
    const h = await createHazard(repo, photos, report(), NOW, ttl);

    // A fresh store over the same file (after the first releases its lock, as a
    // real restart would) sees the persisted record.
    await repo.close();
    const reloaded = new JsonFileRepository(path);
    expect((await reloaded.findById(h.id))?.id).toBe(h.id);
    await reloaded.close();
  });

  it('refuses a second live instance on the same data file (FIX-13)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-'));
    tmpDirs.push(dir);
    const path = join(dir, 'hazards.json');
    const repo = new JsonFileRepository(path);
    try {
      // A second instance while the first holds the lock must fail loudly,
      // before it can write and corrupt the file.
      expect(() => new JsonFileRepository(path)).toThrow(/single-process|already open|locked/i);
    } finally {
      await repo.close();
    }
  });

  it('reclaims a stale lock left by a dead process (FIX-13)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-'));
    tmpDirs.push(dir);
    const path = join(dir, 'hazards.json');
    // A lock naming a pid well above any OS pid_max cannot be a live process,
    // so an unclean-shutdown lock is treated as stale and reclaimed, not fatal.
    writeFileSync(`${path}.lock`, '2147483647', 'utf8');
    const repo = new JsonFileRepository(path);
    expect(readFileSync(`${path}.lock`, 'utf8').trim()).toBe(String(process.pid));
    await repo.close();
  });

  it('close() releases the lock so a new instance can open (FIX-13)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-'));
    tmpDirs.push(dir);
    const path = join(dir, 'hazards.json');
    const repo = new JsonFileRepository(path);
    await repo.close();
    expect(existsSync(`${path}.lock`)).toBe(false);
    const repo2 = new JsonFileRepository(path);
    await repo2.close();
  });
});
