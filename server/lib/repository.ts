/**
 * Storage abstraction for hazards.
 *
 * Route/domain logic depends only on the `Repository` interface, so it is fully
 * testable against the in-memory implementation. Production uses a JSON file
 * store with atomic writes — adequate for a civic MVP's volume and free of any
 * native dependency. Swapping in Postgres/PostGIS later means implementing this
 * one interface (see the ADR in docs/ROADMAP.md).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredHazard } from './types.ts';

export interface Repository {
  insert(hazard: StoredHazard): StoredHazard;
  findById(id: string): StoredHazard | undefined;
  findByClientId(clientId: string): StoredHazard | undefined;
  update(id: string, patch: Partial<StoredHazard>): StoredHazard | undefined;
  all(): StoredHazard[];
}

export class MemoryRepository implements Repository {
  protected store = new Map<string, StoredHazard>();

  insert(hazard: StoredHazard): StoredHazard {
    this.store.set(hazard.id, hazard);
    this.persist();
    return hazard;
  }

  findById(id: string): StoredHazard | undefined {
    return this.store.get(id);
  }

  findByClientId(clientId: string): StoredHazard | undefined {
    for (const h of this.store.values()) {
      if (h.clientId === clientId) return h;
    }
    return undefined;
  }

  update(id: string, patch: Partial<StoredHazard>): StoredHazard | undefined {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id };
    this.store.set(id, updated);
    this.persist();
    return updated;
  }

  all(): StoredHazard[] {
    return [...this.store.values()];
  }

  /** No-op for the in-memory store; the file store overrides this. */
  protected persist(): void {}
}

/**
 * JSON-file-backed store. Loads once on construction and writes the whole set
 * atomically (temp file + rename) after each mutation so a crash mid-write
 * never corrupts the data file.
 */
export class JsonFileRepository extends MemoryRepository {
  constructor(private readonly path: string) {
    super();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const list = JSON.parse(raw) as StoredHazard[];
      for (const h of list) this.store.set(h.id, h);
    } catch {
      // A malformed file should not crash startup; start empty and overwrite
      // on the next successful write.
    }
  }

  protected override persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.all(), null, 0), 'utf8');
    renameSync(tmp, this.path);
  }
}

/** Build the repository the server should use given its config. */
export function createRepository(dataFile: string): Repository {
  return dataFile ? new JsonFileRepository(dataFile) : new MemoryRepository();
}
