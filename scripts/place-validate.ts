/**
 * Validate every place pack in the repository, and fail the build if any is unusable.
 *
 * ## Why this script exists, measured rather than assumed
 *
 * `shared/place.ts` validates the pack at import time, so a bad pack makes the server
 * refuse to boot and makes every test that touches the map fail at import. That is
 * genuinely load-bearing — a zero `exposureWeight` planted in `place/davis.json`
 * turned 22 test files red at once.
 *
 * It does **not** stop a release. `npm run build` is `tsc --noEmit && vite build`, and
 * neither half executes the module's top-level code: `tsc` checks types, not values,
 * and Vite bundles the client without evaluating it. Planting that same zero weight and
 * running `npx vite build` produced `✓ built in 439ms`, exit code 0, and a `dist/` that
 * shipped the broken pack. A gate that cannot fail is worse than no gate, because it
 * reads as a pass.
 *
 * So the pack gets a check that runs the loader for its own sake and exits non-zero.
 * It is wired into `npm run verify` ahead of the build.
 *
 * Exit codes: 0 every pack is usable, 1 at least one is not, 2 the check could not run
 * (which is a failure too — a validator that cannot find its inputs has validated
 * nothing, and must not report success).
 */
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_PACKS, PlacePackError, parsePlacePack } from '../shared/place.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Packs that are checked here but are not selectable in a build: test fixtures.
 *
 * Explicitly, not by glob: a glob over `place/**` would silently validate nothing at
 * all if the directory were renamed, and report success while doing it.
 */
const FIXTURE_PACKS: readonly string[] = [
  'tests/fixtures/place/synthetic-town.json',
];

/**
 * Every pack this repository ships or tests.
 *
 * The shippable half is derived from `BUILT_IN_PACKS` rather than retyped, because a
 * hand-kept second list is a list that goes stale: a pack added to the registry and
 * forgotten here would be selectable by `VITE_PLACE` and never validated by the gate,
 * which is exactly the hole this script exists to close.
 */
const PACKS: readonly string[] = [
  ...Object.values(BUILT_IN_PACKS).map((entry) => entry.source),
  ...FIXTURE_PACKS,
];

function main(): number {
  if (PACKS.length === 0) {
    console.error('place validate: no packs listed — this check would pass vacuously.');
    return 2;
  }

  let failures = 0;
  for (const relativePath of PACKS) {
    const absolute = resolve(ROOT, relativePath);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch (error) {
      console.error(`place validate: cannot read ${relative(ROOT, absolute)}: ${String(error)}`);
      return 2;
    }
    try {
      const pack = parsePlacePack(raw, relativePath);
      console.log(
        `place validate: ${relativePath} OK — ${pack.displayName} ` +
          `(${pack.areas.length} areas, ${pack.landmarks.length} landmarks)`,
      );
    } catch (error) {
      failures += 1;
      if (error instanceof PlacePackError) {
        console.error(error.message);
      } else {
        console.error(`place validate: ${relativePath}: ${String(error)}`);
      }
    }
  }

  if (failures > 0) {
    console.error(`\nplace validate: ${failures} of ${PACKS.length} pack(s) unusable.`);
    return 1;
  }
  console.log(`place validate: ${PACKS.length} pack(s) usable.`);
  return 0;
}

process.exit(main());
