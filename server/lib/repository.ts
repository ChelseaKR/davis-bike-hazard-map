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

/**
 * How long id-only tombstones are retained (and, equivalently, the maximum
 * delta-poll cursor age the server will honour). A client that polls more
 * often than this never misses a deletion; one whose cursor is older is served
 * a full feed instead of a lossy delta (see the `/api/hazards` handler). Kept
 * generous so a phone that was merely backgrounded still gets a cheap delta.
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
   * Delta feed for the 30s mobile poll: rows that changed since `since` —
   * approved+unexpired rows with `updatedAt >= since`, plus recently-resolved
   * rows with `resolvedAt >= since` (shown greyed client-side). Newest first.
   */
  listUpdatedSince(since: number, now: number, bbox?: BBox): Promise<StoredHazard[]>;
  /**
   * Ids hard-deleted at/after `since` (id-only tombstones — no content is kept,
   * per the privacy note). Lets a delta poll surface removals, not just changes.
   */
  listTombstones(since: number): Promise<string[]>;
  /**
   * Transition approved rows past their TTL to `expired`, and coarsen their
   * precise location to the public (fuzzed) one — it's only needed while a
   * hazard is actionable. Returns the count expired.
   */
  expire(now: number): Promise<number>;
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
  /**
   * Id -> epoch-ms deleted, for delta-poll removals. Ids only — no content is
   * retained for a deleted report (privacy). Pruned in `expire()` so it can't
   * grow without bound; a client whose cursor predates the pruning window is
   * told (by app.ts) to do a full refresh instead.
   */
  protected tombstones = new Map<string, number>();

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

  async listUpdatedSince(since: number, now: number, bbox?: BBox): Promise<StoredHazard[]> {
    return [...this.store.values()]
      .filter(
        (h) =>
          (h.status === 'approved' && h.expiresAt > now && h.updatedAt >= since) ||
          (h.status === 'resolved' && (h.resolvedAt ?? 0) >= since),
      )
      .filter((h) => !bbox || inBounds(h.publicLocation, bbox))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listTombstones(since: number): Promise<string[]> {
    const ids: string[] = [];
    for (const [id, deletedAt] of this.tombstones) {
      if (deletedAt >= since) ids.push(id);
    }
    return ids;
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
    const pruned = this.pruneTombstones(now);
    if (expired || pruned) this.persist();
    return expired;
  }

  /**
   * Drop tombstones older than the delta-visibility window. A client polling
   * more often than this never misses a deletion; one that fell further behind
   * is served a full feed (see app.ts) rather than a lossy delta.
   */
  protected pruneTombstones(now: number): number {
    const cutoff = now - TOMBSTONE_TTL_MS;
    let pruned = 0;
    for (const [id, deletedAt] of this.tombstones) {
      if (deletedAt < cutoff) {
        this.tombstones.delete(id);
        pruned++;
      }
    }
    return pruned;
  }

  async deleteById(id: string): Promise<boolean> {
    const existed = this.store.delete(id);
    if (existed) {
      // Record an id-only tombstone so the next delta poll conveys the removal.
      this.tombstones.set(id, Date.now());
      this.persist();
    }
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
/** On-disk shape for the JSON store (hazards + id-only delta tombstones). */
interface JsonFileShape {
  hazards: StoredHazard[];
  tombstones: [string, number][];
}

export class JsonFileRepository extends MemoryRepository {
  constructor(private readonly path: string) {
    super();
    this.load();
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as StoredHazard[] | JsonFileShape;
      // Back-compat: the file used to be a bare hazard array. Newer writes wrap
      // it in `{ hazards, tombstones }` so delta-poll tombstones survive restarts.
      const list = Array.isArray(parsed) ? parsed : parsed.hazards;
      for (const h of list) this.store.set(h.id, h);
      if (!Array.isArray(parsed) && parsed.tombstones) {
        for (const [id, deletedAt] of parsed.tombstones) this.tombstones.set(id, deletedAt);
      }
    } catch {
      // A malformed file should not crash startup; start empty and overwrite
      // on the next successful write.
    }
  }

  protected override persist(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.tmp`;
    const blob: JsonFileShape = {
      hazards: [...this.store.values()],
      tombstones: [...this.tombstones.entries()],
    };
    writeFileSync(tmp, JSON.stringify(blob, null, 0), 'utf8');
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
