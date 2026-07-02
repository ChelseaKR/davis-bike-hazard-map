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
   * Delta feed: rows relevant to reconciling the public feed that changed at or
   * after `since` — approved-and-live rows (updatedAt >= since), resolved rows
   * (resolvedAt >= since), and rows that transitioned OUT of the feed (expired /
   * rejected, updatedAt >= since) so a polling client can drop them. Excludes
   * `pending` rows (never publicly visible). Newest first.
   */
  listUpdatedSince(since: number, now: number, bbox?: BBox): Promise<StoredHazard[]>;
  /**
   * Ids (ONLY ids — a tombstone never carries content, per the privacy rules)
   * of hazards hard-deleted at/after `since`.
   */
  listTombstones(since: number): Promise<string[]>;
  /**
   * Transition approved rows past their TTL to `expired`, and coarsen their
   * precise location to the public (fuzzed) one — it's only needed while a
   * hazard is actionable. Also prunes tombstones older than TOMBSTONE_TTL_MS to
   * bound growth. Returns the count expired.
   */
  expire(now: number): Promise<number>;
  /**
   * Hard-delete a hazard by id (reporter data deletion). Records an id-only
   * tombstone (at `deletedAt`, default the wall clock) so delta polls can drop
   * it. Returns true if found.
   */
  deleteById(id: string, deletedAt?: number): Promise<boolean>;
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

/**
 * How long a deletion tombstone is retained before `expire()` prunes it.
 * A constant (not config) because `expire(now)` has no config in scope; it is
 * deliberately generous — the API refuses delta cursors older than
 * min(resolvedVisibleDays, this), so a client can never miss a pruned
 * tombstone: it is told to do a full fetch instead.
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Rows a delta poll must hear about (everything but the never-public). */
function feedRelevant(h: StoredHazard, since: number, now: number): boolean {
  switch (h.status) {
    case 'approved':
      return h.expiresAt > now && h.updatedAt >= since;
    case 'resolved':
      // Resolution bumps updatedAt too, but resolvedAt is the authoritative
      // "entered the resolved window" instant.
      return (h.resolvedAt ?? h.updatedAt) >= since;
    case 'expired':
      // Transitioned out of the public feed — the poller must drop it.
      return h.updatedAt >= since;
    case 'rejected':
      // Only surfaced if it was ever approved (un-published by a moderator);
      // rejected-while-pending rows were never on the feed, so not even their
      // ids may leak through the delta.
      return h.updatedAt >= since && h.moderation.some((m) => m.decision === 'approve');
    default:
      return false; // pending: never publicly visible, never leaked
  }
}

export class MemoryRepository implements Repository {
  protected store = new Map<string, StoredHazard>();
  /** id -> deletedAt. Ids ONLY — a tombstone never retains report content. */
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
      .filter((h) => feedRelevant(h, since, now))
      .filter((h) => !bbox || inBounds(h.publicLocation, bbox))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listTombstones(since: number): Promise<string[]> {
    return [...this.tombstones.entries()]
      .filter(([, deletedAt]) => deletedAt >= since)
      .map(([id]) => id);
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
    // Bound tombstone growth: anything older than the delta-cursor horizon can
    // never be requested (the API forces stale cursors onto the full feed).
    let pruned = 0;
    for (const [id, deletedAt] of this.tombstones) {
      if (deletedAt < now - TOMBSTONE_TTL_MS) {
        this.tombstones.delete(id);
        pruned++;
      }
    }
    if (expired || pruned) this.persist();
    return expired;
  }

  async deleteById(id: string, deletedAt: number = Date.now()): Promise<boolean> {
    const existed = this.store.delete(id);
    if (existed) {
      this.tombstones.set(id, deletedAt);
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
 * On-disk shape of the JSON store. Older files were a bare StoredHazard array;
 * the object form adds id-only deletion tombstones for the delta feed.
 */
interface JsonBlob {
  hazards: StoredHazard[];
  /** id -> deletedAt (epoch ms). Ids only — no report content. */
  tombstones: Record<string, number>;
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
      const parsed = JSON.parse(raw) as StoredHazard[] | JsonBlob;
      // Legacy format: a bare array of hazards (no tombstones).
      const list = Array.isArray(parsed) ? parsed : parsed.hazards ?? [];
      for (const h of list) this.store.set(h.id, h);
      if (!Array.isArray(parsed)) {
        for (const [id, deletedAt] of Object.entries(parsed.tombstones ?? {})) {
          this.tombstones.set(id, deletedAt);
        }
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
    const blob: JsonBlob = {
      hazards: [...this.store.values()],
      tombstones: Object.fromEntries(this.tombstones),
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
