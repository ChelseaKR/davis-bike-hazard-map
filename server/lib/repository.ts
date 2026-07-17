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
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { transition } from '../../shared/statusMachine.ts';
import type { StoredHazard } from './types.ts';

/**
 * Lock paths held by a live JsonFileRepository in *this* process. The on-disk
 * `.lock` file guards against a second OS process on the same data file; this
 * set additionally catches a second instance inside one process (which shares
 * the same pid and so would slip past the file check).
 */
const heldLocks = new Set<string>();

/** True if `pid` is a running process. `kill(pid, 0)` sends no signal; ESRCH
 * means the process is gone (a stale lock), EPERM means it exists but isn't
 * ours (still alive). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A geographic bounding box for spatial culling of the public feed. */
export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** One page of the moderation backlog (FIX-04). */
export interface PendingPage {
  /** Pending hazards, oldest first (FIFO — moderators clear the backlog in order). */
  hazards: StoredHazard[];
  /** Opaque cursor for the next page, or null when this page is the last. */
  nextCursor: string | null;
}

export interface PendingPageOptions {
  /** Maximum rows to return. */
  limit: number;
  /** Cursor from a previous page (absent = start at the oldest). */
  cursor?: string;
}

/**
 * Keyset cursor for pending pages: `<createdAt>:<id>`. Encoded/decoded here so
 * every store pages identically and callers treat it as opaque.
 */
export function encodePendingCursor(h: StoredHazard): string {
  return `${h.createdAt}:${h.id}`;
}

/** Decode a pending-page cursor, or null if it is not one we issued. */
export function decodePendingCursor(
  cursor: string,
): { createdAt: number; id: string } | null {
  const sep = cursor.indexOf(':');
  if (sep <= 0 || sep === cursor.length - 1) return null;
  const createdAt = Number(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) return null;
  return { createdAt, id };
}

export interface Repository {
  insert(hazard: StoredHazard): Promise<StoredHazard>;
  findById(id: string): Promise<StoredHazard | undefined>;
  findByClientId(clientId: string): Promise<StoredHazard | undefined>;
  update(id: string, patch: Partial<StoredHazard>): Promise<StoredHazard | undefined>;
  all(): Promise<StoredHazard[]>;
  /**
   * One page of `pending` hazards, oldest first (keyset-paged on
   * (createdAt, id) so the response size is independent of queue depth —
   * FIX-04). Cursor format is validated at the API boundary
   * (moderationQueueQuerySchema); an undecodable cursor here falls back to
   * the first page rather than corrupting the traversal.
   */
  listPending(opts: PendingPageOptions): Promise<PendingPage>;
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
  /**
   * Hazards whose hand-off retry is due: delivery receipt in `retrying` with
   * `nextRetryAt` at/before `now` (R3 — consumed by sweepHandoffRetries).
   */
  listHandoffRetryDue(now: number): Promise<StoredHazard[]>;
  /**
   * Dead-lettered hand-offs: delivery receipt in `failed` (retry budget
   * exhausted), oldest attempt first — the moderator's re-send surface (R3).
   */
  listHandoffFailed(): Promise<StoredHazard[]>;
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

  async listPending(opts: PendingPageOptions): Promise<PendingPage> {
    const after = opts.cursor ? decodePendingCursor(opts.cursor) : null;
    // Tiebreak ids by plain code-unit order (ids are ASCII UUIDs), matching
    // the Postgres store's COLLATE "C" — the two stores must page identically.
    const idAfter = (a: string, b: string) => (a > b ? 1 : a < b ? -1 : 0);
    const pending = [...this.store.values()]
      .filter((h) => h.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt || idAfter(a.id, b.id))
      .filter(
        (h) =>
          !after ||
          h.createdAt > after.createdAt ||
          (h.createdAt === after.createdAt && idAfter(h.id, after.id) > 0),
      );
    const page = pending.slice(0, opts.limit);
    const last = page.at(-1);
    const nextCursor = pending.length > page.length && last ? encodePendingCursor(last) : null;
    return { hazards: page, nextCursor };
  }

  async expire(now: number): Promise<number> {
    let expired = 0;
    for (const h of this.store.values()) {
      if (h.expiresAt > now) continue;
      // Route through the state machine: only `approved` hazards have an
      // `expire` edge, so terminal (or pending) hazards are never touched.
      const patch = transition(h, 'expired', 'expire', now);
      if (!patch) continue;
      // Coarsen the precise location away once the hazard is no longer active.
      this.store.set(h.id, { ...h, ...patch, preciseLocation: h.publicLocation });
      expired++;
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

  async listHandoffRetryDue(now: number): Promise<StoredHazard[]> {
    return [...this.store.values()].filter(
      (h) =>
        h.handoffDelivery?.state === 'retrying' &&
        h.handoffDelivery.nextRetryAt !== null &&
        h.handoffDelivery.nextRetryAt <= now,
    );
  }

  async listHandoffFailed(): Promise<StoredHazard[]> {
    return [...this.store.values()]
      .filter((h) => h.handoffDelivery?.state === 'failed')
      .sort((a, b) => (a.handoffDelivery?.lastAttemptAt ?? 0) - (b.handoffDelivery?.lastAttemptAt ?? 0));
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
  private readonly lockPath: string;
  private readonly lockKey: string;
  private lockReleased = false;

  constructor(private readonly path: string) {
    super();
    this.lockPath = `${this.path}.lock`;
    this.lockKey = resolve(this.lockPath);
    this.acquireLock();
    this.load();
  }

  /**
   * Acquire the single-process advisory lock, or throw loudly. The README and
   * server/config.ts both warn that two processes on one data file corrupt it;
   * FIX-13 makes that documented rule fail fast instead of silently. A lock left
   * by a dead process (unclean shutdown) is treated as stale and reclaimed.
   */
  private acquireLock(): void {
    if (heldLocks.has(this.lockKey)) {
      throw new Error(
        `JsonFileRepository: ${this.path} is already open in this process. ` +
          `Use a single repository instance per data file (single-process only).`,
      );
    }
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(this.lockPath)) {
      const holder = Number.parseInt(readFileSync(this.lockPath, 'utf8').trim(), 10);
      if (Number.isInteger(holder) && holder !== process.pid && isProcessAlive(holder)) {
        throw new Error(
          `JsonFileRepository: ${this.path} is locked by a live process (pid ${holder}). ` +
            `Running two processes on one data file corrupts it (single-process only). ` +
            `Stop the other process, or delete ${this.lockPath} if it is stale.`,
        );
      }
      // Otherwise the lock is stale (dead holder, unparsable, or our own pid) — reclaim it.
    }
    writeFileSync(this.lockPath, String(process.pid), 'utf8');
    heldLocks.add(this.lockKey);
    process.once('exit', this.releaseLock);
  }

  /** Release the advisory lock. Bound so it can be an `exit` handler; idempotent
   * and best-effort (a leftover file is reclaimed as stale on the next boot). */
  private readonly releaseLock = (): void => {
    if (this.lockReleased) return;
    this.lockReleased = true;
    heldLocks.delete(this.lockKey);
    try {
      if (
        existsSync(this.lockPath) &&
        readFileSync(this.lockPath, 'utf8').trim() === String(process.pid)
      ) {
        rmSync(this.lockPath);
      }
    } catch {
      // Best effort.
    }
  };

  /**
   * Release the lock so another instance may open this file. Async to satisfy
   * the `Repository.close` contract; the release itself is synchronous, so a
   * caller that does not await still frees the lock immediately.
   */
  async close(): Promise<void> {
    this.releaseLock();
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
