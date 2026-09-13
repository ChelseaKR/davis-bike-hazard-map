// Every Playwright config in this repository that retries in CI must also fail
// the run on a flaky result.
//
// Playwright reports a test that failed and then passed on a retry as `flaky`,
// and exits 0 on flaky unless `failOnFlakyTests` is set. With `retries` above
// zero in CI, that turns an intermittent failure into a green check — which is
// not hypothetical here: the WebKit nightly of 2026-09-10 (run 34527424825)
// concluded `success` over `1 flaky`.
//
// This imports each config the way Playwright reads it, with CI set, rather
// than matching its text, so a key that is commented out, misspelt or set to
// `false` cannot satisfy it. It also enumerates the configs from disk, so a
// third config added later is checked without anyone remembering to list it.
import { readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const CONFIGS = readdirSync(ROOT)
  .filter((name) => /^playwright(\.[a-z0-9]+)?\.config\.ts$/.test(name))
  .sort();

beforeAll(() => {
  process.env.CI = '1';
});

describe('Playwright flaky policy', () => {
  it('finds the configs it is meant to check, so the assertions below are not vacuous', () => {
    expect(CONFIGS).toEqual(['playwright.config.ts', 'playwright.i18n.config.ts']);
  });

  it.each(CONFIGS)('%s fails a CI run when a test passed only on its retry', async (name) => {
    const config = (await import(pathToFileURL(join(ROOT, name)).href)).default;
    const retries = config.retries ?? 0;
    expect(
      retries === 0 || config.failOnFlakyTests === true,
      `${name} retries ${retries} time(s) in CI but does not set failOnFlakyTests: true, ` +
        'so a test that passes only on its retry reads as green',
    ).toBe(true);
    // Importing a TypeScript Playwright config goes through vite's transform;
    // under the full suite's parallel load that can take well over vitest's
    // 5s default, which showed up as a timeout rather than a policy failure.
  }, 30_000);
});
