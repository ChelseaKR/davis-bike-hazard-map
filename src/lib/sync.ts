/**
 * Background sync: drain the offline queue to the server when the network is up.
 *
 * The core (`syncOnce`) takes its dependencies as arguments so it can be unit
 * tested with fakes and so the retry/state-machine logic is verifiable without
 * a real network or IndexedDB.
 */
import {
  getPendingReports,
  updateReport,
  type QueuedReport,
} from './db.ts';
import { submitReport, ApiRequestError } from './api.ts';
import { config } from '../config.ts';

export interface SyncDeps {
  getPending: () => Promise<QueuedReport[]>;
  update: typeof updateReport;
  submit: typeof submitReport;
}

export interface SyncResult {
  attempted: number;
  synced: number;
  failed: number;
}

/** Max attempts before we stop auto-retrying and surface an error to the user. */
export const MAX_SYNC_ATTEMPTS = 5;

const defaultDeps: SyncDeps = {
  getPending: getPendingReports,
  update: updateReport,
  submit: submitReport,
};

/**
 * Attempt to sync every pending report once.
 *
 * A 4xx (other than 429) means the server rejected the payload permanently, so
 * we mark it errored without burning more retries; network errors and 5xx/429
 * are transient and left queued (or errored once attempts run out).
 */
export async function syncOnce(deps: Partial<SyncDeps> = {}): Promise<SyncResult> {
  const { getPending, update, submit } = { ...defaultDeps, ...deps };
  const pending = await getPending();
  const result: SyncResult = { attempted: pending.length, synced: 0, failed: 0 };

  for (const report of pending) {
    await update(report.clientId, { state: 'syncing' });
    try {
      const { hazard } = await submit(report.submission);
      await update(report.clientId, { state: 'synced', serverId: hazard.id });
      result.synced++;
    } catch (err) {
      result.failed++;
      const attempts = report.attempts + 1;
      const permanent =
        err instanceof ApiRequestError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429;
      const exhausted = attempts >= MAX_SYNC_ATTEMPTS;

      await update(report.clientId, {
        state: permanent || exhausted ? 'error' : 'queued',
        attempts,
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** True when the browser believes it is online (defaults to true in SSR/tests). */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * Start the background sync loop: on an interval, when we come back online,
 * when a backgrounded PWA returns to the foreground, and once immediately.
 *
 * The foreground (`visibilitychange`) trigger matters for the bike case: a
 * phone that was asleep for hours may never fire `online` because the socket
 * never formally dropped, so we drain the queue the moment the app is reopened.
 * Returns a disposer that stops it.
 */
export function startSync(onResult?: (r: SyncResult) => void): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped || !isOnline()) return;
    try {
      // Auto-retry everything pending EXCEPT reports in 'error' (a permanent
      // 4xx rejection, or MAX_SYNC_ATTEMPTS exhausted) so the loop never
      // retries those forever; the manual "Sync now" button in My Reports
      // calls syncOnce() with the default getPending, which does include them
      // — that is the user-driven retry path.
      const r = await syncOnce({
        getPending: async () =>
          (await getPendingReports()).filter((report) => report.state !== 'error'),
      });
      if (!stopped && r.attempted > 0) onResult?.(r);
    } catch {
      // syncOnce already records per-report errors; nothing else to do.
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void tick();
  };

  const interval = setInterval(tick, config.syncIntervalMs);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', onVisible);
  void tick();

  return () => {
    stopped = true;
    clearInterval(interval);
    window.removeEventListener('online', tick);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
