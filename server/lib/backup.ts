/**
 * Scheduled snapshots of the JSON data file.
 *
 * The single-file JSON store (repository.ts) has no write-ahead log and no
 * point-in-time recovery: a bad write, an `rm`, or disk loss is unrecoverable
 * without an external copy. This takes a timestamped snapshot on an interval
 * and prunes to the newest N, so there is always a recent restore point.
 *
 * This is an MVP safety net for the file store. Once Postgres lands (see the
 * ADR in docs/ARCHITECTURE.md) its managed backups / pg_dump supersede this.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

export interface BackupOptions {
  /** The live data file to snapshot. */
  dataFile: string;
  /** Directory snapshots are written to. */
  backupDir: string;
  /** Keep at most this many snapshots; older ones are pruned. */
  retain: number;
}

const PREFIX = 'hazards-';

/** Snapshot filename for a moment in time, filesystem-safe (no colons/dots). */
function snapshotName(now: number): string {
  const iso = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `${PREFIX}${iso}.json`;
}

/**
 * Take one snapshot and prune old ones. Returns the snapshot path, or null if
 * there is nothing to back up yet (the data file does not exist).
 */
export function backupOnce(opts: BackupOptions, now: number = Date.now()): string | null {
  if (!opts.dataFile || !existsSync(opts.dataFile)) return null;
  if (!existsSync(opts.backupDir)) mkdirSync(opts.backupDir, { recursive: true });

  const dest = join(opts.backupDir, snapshotName(now));
  copyFileSync(opts.dataFile, dest);
  prune(opts.backupDir, opts.retain);
  return dest;
}

/** Keep the newest `retain` snapshots; delete the rest. */
function prune(backupDir: string, retain: number): void {
  const snaps = readdirSync(backupDir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.json'))
    .sort(); // ISO timestamps sort lexicographically == chronologically
  const excess = snaps.length - Math.max(0, retain);
  for (let i = 0; i < excess; i++) {
    unlinkSync(join(backupDir, snaps[i]));
  }
}

/**
 * Start periodic backups: one immediately, then every `intervalMs`. Returns a
 * disposer that stops the schedule. A no-op (with a no-op disposer) when
 * backups are disabled — no data file, or a non-positive interval.
 */
export function startBackups(
  opts: BackupOptions,
  intervalMs: number,
  log?: (path: string) => void,
  now: () => number = Date.now,
): () => void {
  if (!opts.dataFile || !opts.backupDir || intervalMs <= 0) return () => {};

  const run = () => {
    try {
      const path = backupOnce(opts, now());
      if (path && log) log(path);
    } catch {
      // Backups are best-effort; never crash the server over one.
    }
  };

  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return () => clearInterval(timer);
}
