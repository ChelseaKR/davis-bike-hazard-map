#!/usr/bin/env node
/**
 * Reconcile docs/ops/branch-ruleset.json against the LIVE `protect-main`
 * ruleset on GitHub.
 *
 *     make ruleset-check          # fail on drift
 *     make ruleset-check ARGS=--write   # pull the live ruleset into the mirror
 *
 * Why this is a separate target and not part of `make verify`:
 * tests/unit/requiredChecks.test.ts proves that every required status-check
 * name in the mirror is produced by a job that exists and can fail. That test
 * is offline on purpose — a check that reads the GitHub API passes vacuously
 * the moment `gh` is missing or unauthenticated, which is precisely the empty
 * gate this repository is trying to eliminate. So the offline test guards the
 * mirror, and this target guards the mirror against reality. It NEVER passes
 * quietly: no `gh`, no auth, no ruleset, or any drift all exit non-zero.
 *
 * Read-only. The only GitHub call is `gh api ... /rulesets`, a GET.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIRROR = join(ROOT, 'docs', 'ops', 'branch-ruleset.json');
const WRITE = process.argv.includes('--write');

/** Print and exit non-zero. There is no quiet failure path in this script. */
function fail(headline, ...detail) {
  console.error(`ruleset-check: ${headline}`);
  for (const line of detail) console.error(`  ${line}`);
  process.exit(1);
}

function gh(...args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        'the GitHub CLI (`gh`) is not installed, so the live ruleset cannot be read.',
        'Install it from https://cli.github.com/ and run `gh auth login`.',
        'This target fails rather than skipping: an unverified mirror is not a verified one.',
      );
    }
    fail(
      `\`gh ${args.join(' ')}\` failed.`,
      'If this is an authentication error, run `gh auth login`.',
      ...String(error?.stderr ?? error?.message ?? error).trim().split('\n'),
    );
  }
}

/**
 * The fields the mirror exists to preserve, in a shape that compares cleanly
 * whichever side it came from. Required contexts are sorted: GitHub returns
 * them in its own order and the order carries no meaning.
 */
function normalize(ruleset, source) {
  const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
  const statusRule = rules.find((r) => r?.type === 'required_status_checks');
  if (!statusRule) {
    fail(
      `the ${source} ruleset has no required_status_checks rule.`,
      'Either main is no longer gated on status checks, or this is a broken record.',
    );
  }
  const params = statusRule.parameters ?? {};
  return {
    name: ruleset?.name ?? null,
    target: ruleset?.target ?? null,
    enforcement: ruleset?.enforcement ?? null,
    includes: [...(ruleset?.conditions?.ref_name?.include ?? [])].sort(),
    excludes: [...(ruleset?.conditions?.ref_name?.exclude ?? [])].sort(),
    ruleTypes: rules.map((r) => r?.type).sort(),
    strict: params.strict_required_status_checks_policy ?? null,
    doNotEnforceOnCreate: params.do_not_enforce_on_create ?? null,
    contexts: (params.required_status_checks ?? []).map((c) => c?.context).sort(),
  };
}

const mirrorRaw = JSON.parse(readFileSync(MIRROR, 'utf8'));
const mirror = normalize(mirrorRaw, 'committed');

if (!mirror.name) fail('the committed mirror has no `name`, so the live ruleset cannot be located.');

const live = JSON.parse(gh('api', 'repos/{owner}/{repo}/rulesets', '--paginate'));
const summary = live.find((r) => r?.name === mirror.name);
if (!summary) {
  fail(
    `no ruleset named "${mirror.name}" exists on this repository.`,
    `Live rulesets: ${live.map((r) => `"${r?.name}"`).join(', ') || '(none)'}`,
    'main is not protected by the rule this mirror describes.',
  );
}

const liveRaw = JSON.parse(gh('api', `repos/{owner}/{repo}/rulesets/${summary.id}`));
const liveNormalized = normalize(liveRaw, 'live');

const differences = Object.keys(mirror).filter(
  (field) => JSON.stringify(mirror[field]) !== JSON.stringify(liveNormalized[field]),
);

if (differences.length === 0) {
  console.log(
    `ruleset-check: docs/ops/branch-ruleset.json matches the live "${mirror.name}" ` +
      `ruleset (id ${summary.id}, enforcement ${liveNormalized.enforcement}).`,
  );
  console.log(`  ${liveNormalized.contexts.length} required status checks:`);
  for (const context of liveNormalized.contexts) console.log(`    ${context}`);
  process.exit(0);
}

if (WRITE) {
  // Rewrite the mirror from the live rule. The field list is a whitelist, not a
  // subtraction: ids, timestamps and `_links` belong to the live object rather
  // than to an import template, and a field GitHub adds later should land in
  // the mirror by a human's decision, not by this script copying it silently.
  // `bypass_actors` is deliberately outside the list — the mirror has never
  // carried it, so re-importing this template restores the branch rules
  // without granting anyone a bypass.
  const importable = {};
  for (const field of ['name', 'target', 'enforcement', 'conditions', 'rules']) {
    if (field in liveRaw) importable[field] = liveRaw[field];
  }
  writeFileSync(MIRROR, `${JSON.stringify(importable, null, 2)}\n`, 'utf8');
  console.log(`ruleset-check: rewrote docs/ops/branch-ruleset.json from live "${mirror.name}".`);
  console.log(`  Reconciled fields: ${differences.join(', ')}`);
  console.log('  Review the diff and commit it: the mirror is a reviewed record, not a cache.');
  process.exit(0);
}

console.error(`ruleset-check: docs/ops/branch-ruleset.json has drifted from the live "${mirror.name}" ruleset.`);
for (const field of differences) {
  console.error(`  ${field}`);
  console.error(`    committed: ${JSON.stringify(mirror[field])}`);
  console.error(`    live     : ${JSON.stringify(liveNormalized[field])}`);
}
console.error('');
console.error('  Decide which side is right. If the live rule is: `make ruleset-check ARGS=--write`,');
console.error('  then review and commit. If the mirror is: fix the ruleset in the GitHub UI.');
console.error('  Note that tests/unit/requiredChecks.test.ts gates on the committed mirror, so a');
console.error('  required context that only exists live is not covered by that test until it lands here.');
process.exit(1);
