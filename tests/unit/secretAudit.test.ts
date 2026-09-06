/**
 * Guard: the scheduled secret audit must stay capable of failing.
 *
 * `secret-audit.yml` is the only gate in this repository that looks at the WHOLE
 * committed history; the two gitleaks gates only ever see a diff. Four things
 * silently un-arm it, and none of them shows up as a red build:
 *
 *  (a) the result tiers stop including `unverified`. TruffleHog sorts a finding
 *      into `verified` (it authenticated the credential against the live
 *      service), `unknown` (verification errored) and `unverified` (it asked,
 *      and the service said no). A credential that leaked and was later REVOKED
 *      — the normal end state of a real leak, and the exact case a history sweep
 *      exists to catch — answers "no", so it is `unverified`. `--only-verified`
 *      cannot fail on it, and neither can `--results=verified` or
 *      `--results=verified,unknown`: they exclude the same tier under other
 *      names. Measured 2026-09-06 on a throwaway clone of this repository with a
 *      real-shaped AWS key planted in one commit and deleted in the next —
 *      `--only-verified` exited 0 reporting nothing, the widened tier exited 183
 *      with `unverified_secrets: 1`;
 *
 *  (b) the widened lane's `--exclude-globs` stops being covered. Lane 1 excludes
 *      `docker-compose.yml`, whose single finding is the local stack's own
 *      `postgres:postgres@db` connection string. That is only safe while lane 2
 *      still scans every path for verified results. Deleting lane 2, or adding
 *      the same exclusion to it, would leave a path this job no longer looks at;
 *
 *  (c) the `version:` input drifts from the `uses:` ref. `version:` is what
 *      selects the scanning binary (`ghcr.io/trufflesecurity/trufflehog:$V`);
 *      the SHA pins only the wrapper, and Dependabot rewrites `uses:` and never
 *      a `with:` input. #105 re-synced them by hand and #130, #144 and #154 each
 *      re-introduced the drift. workflow-lint.yml's Guard 4 also checks this, in
 *      CI only; this runs in `npm test` too;
 *
 *  (d) `fetch-depth: 0` disappears from the checkout, at which point
 *      actions/checkout fetches a single commit and the "full history" sweep
 *      becomes a one-commit scan that still reports success.
 *
 * The pin comment is a YAML comment and is invisible to a YAML parser, so this
 * reads the workflow as text on purpose.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// import.meta.url is an http: URL under jsdom, so resolve from cwd instead
// (the same approach as requiredChecks.test.ts). Vitest runs with cwd at the
// repo root.
const ROOT = process.cwd();
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'secret-audit.yml');
const WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8');

/** The tier a revoked credential lands in. Its absence is the defect. */
const REQUIRED_RESULT_TIER = 'unverified';

const extraArgs: string[] = [
  ...WORKFLOW.matchAll(/^[ \t]*extra_args:[ \t]*(.+?)[ \t]*$/gm),
].map((match) => match[1]);

const tiersOf = (args: string): string[] => {
  const results = /--results=([\w,]+)/.exec(args);
  expect(results, `expected an explicit --results= tier list in: ${args}`).not.toBeNull();
  return results![1].split(',');
};

const globsOf = (args: string): string[] => {
  const globs = /--exclude-globs=([^\s]+)/.exec(args);
  return globs ? globs[1].split(',') : [];
};

describe('secret-audit.yml', () => {
  it('runs at least one TruffleHog lane', () => {
    expect(extraArgs.length).toBeGreaterThan(0);
  });

  it('states its result tiers explicitly and never uses --only-verified', () => {
    for (const args of extraArgs) {
      expect(
        args,
        '--only-verified cannot fail on a revoked credential, which is the normal end state ' +
          'of a real leak and the case this scan exists for',
      ).not.toContain('--only-verified');
      expect(args).toMatch(/--results=[\w,]+/);
    }
  });

  it('reports the unverified tier, where a revoked credential lands', () => {
    const tierLists = extraArgs.map(tiersOf);
    expect(
      tierLists.some((tiers) => tiers.includes(REQUIRED_RESULT_TIER)),
      `no lane reports "${REQUIRED_RESULT_TIER}" results (found ${JSON.stringify(tierLists)}), ` +
        'so nothing here can fail on a credential the provider has already revoked. Measured: ' +
        'verified and verified,unknown both exit 0 on a planted-then-deleted AWS key; adding ' +
        'unverified exits 183.',
    ).toBe(true);
  });

  it('keeps every path the widened lane excludes covered by another lane', () => {
    const widened = extraArgs.filter((args) => tiersOf(args).includes(REQUIRED_RESULT_TIER));
    const others = extraArgs.filter((args) => !tiersOf(args).includes(REQUIRED_RESULT_TIER));
    const excluded = [...new Set(widened.flatMap(globsOf))];

    for (const glob of excluded) {
      expect(
        others.some((args) => !globsOf(args).includes(glob)),
        `${glob} is excluded from the widened lane and from every other lane too, so no lane ` +
          'of this job looks at it any more. Keep the verified-only lane that still scans it.',
      ).toBe(true);
    }
  });

  it('pins the scanner: every action ref and its version: input name the same release', () => {
    const pinned = [
      ...WORKFLOW.matchAll(/trufflesecurity\/trufflehog@[0-9a-f]{40}\s*#\s*v(\d+(?:\.\d+)*)/g),
    ].map((match) => match[1]);
    const selected = [
      ...WORKFLOW.matchAll(/^[ \t]*version:[ \t]*"?(\d+(?:\.\d+)*)"?[ \t]*$/gm),
    ].map((match) => match[1]);

    expect(pinned.length, 'could not read a trufflehog pin and its `# vX.Y.Z` comment').toBeGreaterThan(0);
    expect(
      selected.length,
      'no `version:` input. Without it the action defaults to "latest" and the SHA pin above ' +
        'it pins nothing that actually scans.',
    ).toBe(pinned.length);

    pinned.forEach((refVersion, index) => {
      expect(
        selected[index],
        `the action is pinned to v${refVersion} but \`version: ${selected[index]}\` is what ` +
          `downloads the scanner, so the scan would run ${selected[index]} and the bump to ` +
          `v${refVersion} is a no-op`,
      ).toBe(refVersion);
    });
  });

  it('checks out the full history', () => {
    expect(WORKFLOW).toContain('actions/checkout@');
    expect(
      WORKFLOW,
      '`fetch-depth: 0` is missing. actions/checkout then fetches a single commit and this ' +
        'full-history sweep silently becomes a one-commit scan that still reports success.',
    ).toMatch(/^[ \t]*fetch-depth:[ \t]*0[ \t]*(#.*)?$/m);
  });
});
