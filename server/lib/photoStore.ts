/**
 * Photo blob storage, kept OUT of the JSON record store.
 *
 * Inlining base64 photos in the hazards JSON bloated both the file and the
 * in-memory map: a 1 MB photo is ~1.4 MB of base64, and every record mutation
 * rewrote the whole file (and re-held every photo in RAM). Photos are large,
 * immutable, and addressed by hazard id, so they live in their own content
 * store; the JSON keeps only a tiny reference ({ mime }).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PhotoStore {
  /** Store (or overwrite) the bytes for a hazard id. */
  put(id: string, bytes: Uint8Array): void;
  /** Read bytes, or null if absent. */
  get(id: string): Uint8Array | null;
  has(id: string): boolean;
  delete(id: string): void;
}

/** Ids are server-generated UUIDs; reject anything else (path-traversal guard). */
function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`unsafe photo id: ${id}`);
}

export class MemoryPhotoStore implements PhotoStore {
  private blobs = new Map<string, Uint8Array>();

  put(id: string, bytes: Uint8Array): void {
    this.blobs.set(id, bytes);
  }
  get(id: string): Uint8Array | null {
    return this.blobs.get(id) ?? null;
  }
  has(id: string): boolean {
    return this.blobs.has(id);
  }
  delete(id: string): void {
    this.blobs.delete(id);
  }
}

/** One file per photo, written atomically (temp + rename). */
export class FilePhotoStore implements PhotoStore {
  constructor(private readonly dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    assertSafeId(id);
    return join(this.dir, id);
  }

  put(id: string, bytes: Uint8Array): void {
    const dest = this.path(id);
    const tmp = `${dest}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, dest);
  }
  get(id: string): Uint8Array | null {
    const p = this.path(id);
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  }
  has(id: string): boolean {
    return existsSync(this.path(id));
  }
  delete(id: string): void {
    rmSync(this.path(id), { force: true });
  }
}

/** Build the photo store matching the record store: file-backed when persisting. */
export function createPhotoStore(dataFile: string): PhotoStore {
  if (!dataFile) return new MemoryPhotoStore();
  return new FilePhotoStore(join(dirOf(dataFile), 'photos'));
}

function dirOf(file: string): string {
  const idx = file.lastIndexOf('/');
  return idx === -1 ? '.' : file.slice(0, idx);
}
