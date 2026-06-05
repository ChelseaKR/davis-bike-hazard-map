import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupOnce, startBackups } from '../../server/lib/backup.ts';

let root: string;
let dataFile: string;
let backupDir: string;
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dbhm-backup-'));
  dataFile = join(root, 'hazards.json');
  backupDir = join(root, 'backups');
  writeFileSync(dataFile, '[{"id":"h1"}]', 'utf8');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function snaps(): string[] {
  return existsSync(backupDir)
    ? readdirSync(backupDir).filter((f) => f.startsWith('hazards-')).sort()
    : [];
}

describe('backupOnce', () => {
  it('writes a timestamped snapshot copying the data file verbatim', () => {
    const dest = backupOnce({ dataFile, backupDir, retain: 14 }, Date.UTC(2026, 5, 5, 12));
    expect(dest).not.toBeNull();
    expect(readFileSync(dest!, 'utf8')).toBe('[{"id":"h1"}]');
    expect(snaps()).toHaveLength(1);
    expect(snaps()[0]).toMatch(/^hazards-2026-06-05T12-00-00-000Z\.json$/);
  });

  it('returns null when there is nothing to back up', () => {
    expect(backupOnce({ dataFile: join(root, 'missing.json'), backupDir, retain: 14 })).toBeNull();
  });

  it('prunes to the newest N snapshots', () => {
    for (let h = 0; h < 5; h++) {
      backupOnce({ dataFile, backupDir, retain: 3 }, Date.UTC(2026, 5, 5, h));
    }
    const remaining = snaps();
    expect(remaining).toHaveLength(3);
    // The three newest hours survive; the two oldest are pruned.
    expect(remaining[0]).toMatch(/T02-/);
    expect(remaining[2]).toMatch(/T04-/);
  });
});

describe('startBackups', () => {
  it('takes one snapshot immediately and is a no-op disposer when enabled', () => {
    const stop = startBackups(
      { dataFile, backupDir, retain: 14 },
      HOUR,
      undefined,
      () => Date.UTC(2026, 5, 5, 9),
    );
    expect(snaps()).toHaveLength(1);
    stop();
  });

  it('is disabled (no snapshot) when there is no data file', () => {
    const stop = startBackups({ dataFile: '', backupDir, retain: 14 }, HOUR);
    expect(snaps()).toHaveLength(0);
    stop();
  });
});
