import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryPhotoStore,
  FilePhotoStore,
  createPhotoStore,
} from '../../server/lib/photoStore.ts';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('MemoryPhotoStore', () => {
  it('round-trips, reports presence, and deletes', () => {
    const store = new MemoryPhotoStore();
    expect(store.get('a')).toBeNull();
    expect(store.has('a')).toBe(false);

    store.put('a', bytes('hello'));
    expect(store.has('a')).toBe(true);
    expect(new TextDecoder().decode(store.get('a')!)).toBe('hello');

    store.delete('a');
    expect(store.has('a')).toBe(false);
  });
});

describe('FilePhotoStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dbhm-photos-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists bytes to disk and round-trips them', () => {
    const store = new FilePhotoStore(join(dir, 'photos'));
    store.put('11111111-1111-4111-8111-111111111111', bytes('jpegdata'));
    expect(new TextDecoder().decode(store.get('11111111-1111-4111-8111-111111111111')!)).toBe(
      'jpegdata',
    );
    // No leftover temp files after an atomic write.
    expect(readdirSync(join(dir, 'photos')).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('rejects unsafe ids (path-traversal guard)', () => {
    const store = new FilePhotoStore(join(dir, 'photos'));
    expect(() => store.put('../evil', bytes('x'))).toThrow(/unsafe photo id/);
  });
});

describe('createPhotoStore', () => {
  it('is in-memory when no data file is configured', () => {
    expect(createPhotoStore('')).toBeInstanceOf(MemoryPhotoStore);
  });
  it('is file-backed (sibling photos dir) when a data file is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbhm-cps-'));
    try {
      expect(createPhotoStore(join(dir, 'hazards.json'))).toBeInstanceOf(FilePhotoStore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
