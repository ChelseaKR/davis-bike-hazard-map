/**
 * Advisory pid-lock behavior of JsonFileRepository (FIX-13).
 *
 * The JSON store is single-process; the lock file makes a second process fail
 * loudly at construction instead of silently corrupting the data file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileRepository } from '../../server/lib/repository.ts';

/** A pid that cannot belong to a live process (far above any OS pid ceiling). */
const DEAD_PID = 999_999_999;

const tmpDirs: string[] = [];
const openRepos: JsonFileRepository[] = [];

function freshPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbhm-lock-'));
  tmpDirs.push(dir);
  return join(dir, 'hazards.json');
}

function open(path: string): JsonFileRepository {
  const repo = new JsonFileRepository(path);
  openRepos.push(repo);
  return repo;
}

afterEach(async () => {
  for (const r of openRepos.splice(0)) await r.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('JsonFileRepository advisory lock', () => {
  it('makes a second instance on the same path throw before any write', () => {
    const path = freshPath();
    open(path);
    expect(existsSync(`${path}.lock`)).toBe(true);

    expect(() => new JsonFileRepository(path)).toThrow(
      /locked by pid \d+.*single-process/s,
    );
    // The holder's lock survived the failed takeover attempt.
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(String(process.pid));
  });

  it('recovers a stale lock left by a dead process', () => {
    const path = freshPath();
    writeFileSync(`${path}.lock`, String(DEAD_PID));

    const repo = open(path); // must not throw
    expect(repo).toBeInstanceOf(JsonFileRepository);
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(String(process.pid));
  });

  it('recovers a lock whose content is unparsable', () => {
    const path = freshPath();
    writeFileSync(`${path}.lock`, 'not-a-pid');

    open(path); // must not throw
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(String(process.pid));
  });

  it('treats a lock recorded under our own pid as stale (crashed predecessor)', () => {
    const path = freshPath();
    writeFileSync(`${path}.lock`, String(process.pid));

    open(path); // must not throw
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(String(process.pid));
  });

  it('removes the lock on close() so a successor can construct', async () => {
    const path = freshPath();
    const first = new JsonFileRepository(path);
    await first.close();
    expect(existsSync(`${path}.lock`)).toBe(false);

    open(path); // must not throw
  });
});
