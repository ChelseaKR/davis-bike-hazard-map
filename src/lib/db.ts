/**
 * Offline-first report queue, backed by IndexedDB.
 *
 * Report creation must work with no network (ROADMAP guardrail: offline-first).
 * A submitted report is written here first and synced later; the queue is the
 * source of truth for "things this device still owes the server".
 *
 * The store is wrapped so the rest of the app never touches IndexedDB directly,
 * which also makes it trivial to test with `fake-indexeddb`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ReportSubmission } from '../../shared/types.ts';

export type QueueState = 'queued' | 'syncing' | 'synced' | 'error';

/** A report plus its local sync bookkeeping. */
export interface QueuedReport {
  clientId: string;
  submission: ReportSubmission;
  state: QueueState;
  attempts: number;
  lastError?: string;
  /** Server id once synced, for de-duplication and linking. */
  serverId?: string;
  createdAt: number;
  updatedAt: number;
}

interface HazardDB extends DBSchema {
  reports: {
    key: string; // clientId
    value: QueuedReport;
    indexes: { 'by-state': QueueState };
  };
}

const DB_NAME = 'davis-bike-hazard-map';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<HazardDB>> | null = null;

function getDB(): Promise<IDBPDatabase<HazardDB>> {
  if (!dbPromise) {
    dbPromise = openDB<HazardDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('reports', { keyPath: 'clientId' });
        store.createIndex('by-state', 'state');
      },
    });
  }
  return dbPromise;
}

/**
 * Reset the store between tests: close the cached connection (so a pending
 * deleteDatabase isn't blocked by an open handle) and drop the database.
 */
export async function _resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      // already closed
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Add a freshly captured report to the queue. */
export async function enqueueReport(submission: ReportSubmission): Promise<QueuedReport> {
  const db = await getDB();
  const now = Date.now();
  const record: QueuedReport = {
    clientId: submission.clientId,
    submission,
    state: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.put('reports', record);
  return record;
}

/**
 * A report stuck in 'syncing' longer than this is treated as orphaned (the app
 * was killed mid-request) and becomes retryable again. Generous enough that no
 * live upload — even a photo on slow mobile data — is still in flight.
 */
export const STALE_SYNCING_MS = 10 * 60 * 1000;

/**
 * All reports that still need to reach the server: queued, errored, and
 * orphaned 'syncing' ones (stuck longer than {@link STALE_SYNCING_MS} — e.g.
 * the app was killed mid-request, so no outcome was ever recorded). Re-trying
 * a stale 'syncing' report is safe: submission is idempotent on clientId.
 */
export async function getPendingReports(now: number = Date.now()): Promise<QueuedReport[]> {
  const db = await getDB();
  const all = await db.getAll('reports');
  return all
    .filter(
      (r) =>
        r.state === 'queued' ||
        r.state === 'error' ||
        (r.state === 'syncing' && now - r.updatedAt > STALE_SYNCING_MS),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Everything in the queue, newest first — for the "my reports" UI. */
export async function getAllReports(): Promise<QueuedReport[]> {
  const db = await getDB();
  const all = await db.getAll('reports');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getReport(clientId: string): Promise<QueuedReport | undefined> {
  const db = await getDB();
  return db.get('reports', clientId);
}

/** Patch a queued report (state transitions, error messages, server id). */
export async function updateReport(
  clientId: string,
  patch: Partial<Omit<QueuedReport, 'clientId'>>,
): Promise<QueuedReport | undefined> {
  const db = await getDB();
  const existing = await db.get('reports', clientId);
  if (!existing) return undefined;
  const updated: QueuedReport = { ...existing, ...patch, updatedAt: Date.now() };
  await db.put('reports', updated);
  return updated;
}

export async function deleteReport(clientId: string): Promise<void> {
  const db = await getDB();
  await db.delete('reports', clientId);
}

export async function countByState(): Promise<Record<QueueState, number>> {
  const db = await getDB();
  const all = await db.getAll('reports');
  const counts: Record<QueueState, number> = {
    queued: 0,
    syncing: 0,
    synced: 0,
    error: 0,
  };
  for (const r of all) counts[r.state]++;
  return counts;
}
