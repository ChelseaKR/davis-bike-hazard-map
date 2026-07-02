/**
 * Storage abstraction for hazards.
 *
 * Route/domain logic depends only on the async `Repository` interface, so it is
 * testable against the in-memory implementation and swappable for Postgres in
 * production. The interface is async because the production store
 * (PostgresRepository) does network I/O; the in-memory and JSON stores satisfy
 * it trivially.
 *
 * Stores:
 *   - PostgresRepository — production (see pgRepository.ts). Required in prod.
 *   - JsonFileRepository — single-process dev/MVP persistence (atomic writes).
 *   - MemoryRepository   — tests and zero-config dev.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StoredHazard } from './types.ts';

/** A geographic bounding box for spatial culling of the public feed. */
export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface Repository {
  insert(hazard: StoredHazard): Promise<StoredHazard>;
  findById(id: string): Promise<StoredHazard | undefined>;
  findByClientId(clientId: string): Promise<StoredHazard | undefined>;
  update(id: string, patch: Partial<StoredHazard>): Promise<StoredHazard | undefined>;
  all(): Promise<StoredHazard[]>;
  /** Approved, not-yet-expired rows (optional bbox pushdown), newest first. */
  listActive(now: number, bbox?: BBox): Promise<StoredHazard[]>;
  /** Resolved rows fixed at/after `resolvedAfter` (optional bbox), newest first. */
  listRecentlyResolved(resolvedAfter: number, bbox?: BBox): Promise<StoredHazard[]>;
  /**
   * Transition approved rows past their TTL to `expired`, and coarsen their
   * precise location to the public (fuzzed) one — it's only needed while a
   * hazard is actionable. Returns the count expired.
   */
  expire(now: number): Promise<number>;
  /**
   * Hazards whose photo blobs are due for garbage collection: they still carry
   * a photo ref, are `expired`/`resolved`, and left the actionable state at or
   * before `cutoff` (resolvedAt for resolved rows, else updatedAt). Consumed by
   * sweepPhotoRetention (see docs/audits/privacy-notes.md).
   */
  listPhotoGcCandidates(cutoff: number): Promise<StoredHazard[]>;
  /** Hard-delete a hazard by id (reporter data deletion). Returns true if found. */
  deleteById(id: string): Promise<boolean>;
  /** Moderation backlog stats for observability (cheap; no photos loaded). */
  pendingStats(): Promise<PendingStats>;
  /** Liveness of the backing store (readiness probe). Throws/false if down. */
  ping(): Promise<boolean>;
  /** Release resources (e.g. a connection pool). Optional. */
  close?(): Promise<void>;
}

export interface PendingStats {
  /** Reports awaiting moderation. */
  count: number;
  /** createdAt of the oldest pending report, or null if the queue is empty. */
  oldestCreatedAt: number | null;
}

/** Whether a public point lies inside a bounding box (inclusive). */
export function inBounds(p: { lat: number; lng: number }, b: BBox): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

export class MemoryRepository implements Repository {
  protected store = new Map<string, StoredHazard>();

  async insert(hazard: StoredHazard): Promise<StoredHazard> {
    this.store.set(hazard.id, hazard);
    this.persist();
    return hazard;
  }

  async findById(id: string): Promise<StoredHazard | undefined> {
    return this.store.get(id);
  }

  async findByClientId(clientId: string): Promise<StoredHazard | undefined> {
    for (const h of this.store.values()) {
      if (h.clientId === clientId) return h;
    }
    return undefined;
  }

  async update(id: string, patch: Partial<StoredHazard>): Promise<StoredHazard | undefined> {
    const existing = this.store.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch, id: existing.id };
    this.store.set(id, updated);
    this.persist();
    return updated;
  }

  async all(): Promise<StoredHazard[]> {
    return [...this.store.values()];
  }

  async listActive(now: number, bbox?: BBox): Promise<StoredHazard[]> {
    return [...this.store.values()]
      .filter((h) => h.status === 'approved' && h.expiresAt > now)
      .filter((h) => !bbox || inBounds(h.publicLocation, bbox))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listRecentlyResolved(resolvedAfter: number, bbox?: BBox): Promise<StoredHazard[]> {
    return [...this.store.values()]
      .filter((h) => h.status === 'resolved' && (h.resolvedAt ?? 0) >= resolvedAfter)
      .filter((h) => !bbox || inBounds(h.publicLocation, bbox))
      .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  }

  async expire(now: number): Promise<number> {
    let expired = 0;
    for (const h of this.store.values()) {
      if (h.status === 'approved' && h.expiresAt <= now) {
        // Coarsen the precise location away once the hazard is no longer active.
        this.store.set(h.id, {
          ...h,
          status: 'expired',
          updatedAt: now,
          preciseLocation: h.publicLocation,
        });
        expired++;
      }
    }
    if (expired) this.persist();
    return expired;
  }

  async listPhotoGcCandidates(cutoff: number): Promise<StoredHazard[]> {
    return [...this.store.values()].filter(
      (h) =>
        h.photo !== null &&
        (h.status === 'expired' || h.status === 'resolved') &&
        (h.resolvedAt ?? h.updatedAt) <= cutoff,
    );
  }

  async deleteById(id: string): Promise<boolean> {
    const existed = this.store.delete(id);
    if (existed) this.persist();
    return existed;
  }

  async pendingStats(): Promise<PendingStats> {
    let count = 0;
    let oldestCreatedAt: number | null = null;
    for (const h of this.store.values()) {
      if (h.status !== 'pending') continue;
      count++;
      if (oldestCreatedAt === null || h.createdAt < oldestCreatedAt) {
        oldestCreatedAt = h.createdAt;
      }
    }
    return { count, oldestCreatedAt };
  }

  async ping(): Promise<boolean> {
    return true; // in-memory / file store is always "reachable"
  }

  /** No-op for the in-memory store; the file store overrides this. */
  protected persist(): void {}
}

/**
 * JSON-file-backed store. Loads once on construction and writes the whole set
 * atomically (temp file + rename) after each mutation so a crash mid-write
 * never corrupts the data file. SINGLE-PROCESS ONLY (see server/config.ts).
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
    writeFileSync(tmp, JSON.stringify([...this.store.values()], null, 0), 'utf8');
    renameSync(tmp, this.path);
  }
}

export interface RepositoryOptions {
  /** Postgres connection string. When set, the production store is used. */
  databaseUrl?: string;
  /** JSON store path (single-process dev/MVP). Empty => in-memory. */
  dataFile?: string;
}

/** Build the repository the server should use given its config. */
export async function createRepository(opts: RepositoryOptions): Promise<Repository> {
  if (opts.databaseUrl) {
    const { PostgresRepository } = await import('./pgRepository.ts');
    const repo = new PostgresRepository(opts.databaseUrl);
    await repo.init();
    return repo;
  }
  if (opts.dataFile) return new JsonFileRepository(opts.dataFile);
  return new MemoryRepository();
}
