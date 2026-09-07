/**
 * Guard: the place-pack gate exists, is green, and covers every pack in the tree.
 *
 * `shared/place.ts` validates its pack at import time, which is real: planting a zero
 * `exposureWeight` in `place/davis.json` turned 22 test files red at once. What that
 * import-time check does NOT do is stop a release. `npm run build` is
 * `tsc --noEmit && vite build`, and neither half evaluates the module's top-level
 * code — `tsc` checks types, not values, and Vite bundles the client without running
 * it. With that same sabotage in place, `npx vite build` printed `✓ built in 439ms`,
 * exited 0, and emitted a `dist/` carrying the broken pack.
 *
 * `scripts/place-validate.ts` is the check that actually fails the build, and these
 * tests are why it cannot quietly stop checking:
 *
 *  - it is green against this tree;
 *  - it names every pack it inspected, so a vacuous run is visible;
 *  - its explicit pack list matches the packs that actually exist, so adding a pack
 *    without listing it fails here rather than shipping unvalidated.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BUILT_IN_PACKS } from '../../shared/place.ts';

const ROOT = process.cwd();

/** Every `*.json` under a directory, as repo-relative paths. */
function packFilesIn(relativeDir: string): string[] {
  return readdirSync(join(ROOT, relativeDir))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `${relativeDir}/${name}`)
    .sort();
}

describe('the place-pack gate', () => {
  it('is green against this repository as committed', () => {
    const result = spawnSync('npx', ['tsx', 'scripts/place-validate.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it('names each pack it inspected, so a run that checked nothing is visible', () => {
    const result = spawnSync('npx', ['tsx', 'scripts/place-validate.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.stdout).toContain('place/davis.json OK');
    expect(result.stdout).toContain('tests/fixtures/place/synthetic-town.json OK');
    expect(result.stdout).toMatch(/2 pack\(s\) usable\./);
  });

  it('checks every pack that exists in the tree', () => {
    // The script lists its packs explicitly rather than globbing, because a glob over a
    // renamed directory validates nothing and reports success while doing it. The cost
    // of an explicit list is that it can go stale; this is the check that stops it.
    //
    // Half the list is no longer typed into the script at all: the shippable packs come
    // from `BUILT_IN_PACKS` in `shared/place.ts`, so a pack made selectable by
    // `VITE_PLACE` is validated by construction. Only the test fixtures are literals
    // there, and only those are scraped here.
    const source = readFileSync(join(ROOT, 'scripts/place-validate.ts'), 'utf8');
    const fixtureLiterals = Array.from(source.matchAll(/^\s*'([^']+\.json)',?$/gm)).map(
      (m) => m[1],
    );
    const declared = [
      ...Object.values(BUILT_IN_PACKS).map((entry) => entry.source),
      ...fixtureLiterals,
    ].sort();

    const onDisk = [...packFilesIn('place'), ...packFilesIn('tests/fixtures/place')].sort();

    expect(declared).toEqual(onDisk);
  });
});
