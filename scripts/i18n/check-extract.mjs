#!/usr/bin/env node
// G2 — no hardcoded UI strings / catalog is current (INTERNATIONALIZATION-STANDARD §4).
//
// Re-runs `formatjs extract --throws` into a temp file and asserts it matches the
// committed `src/i18n/locales/en.json`. Two failure modes it catches:
//   1. Extraction throws → a malformed/duplicate message descriptor (bad ICU,
//      same id with two different defaultMessages) — fail closed.
//   2. The extracted set differs from the committed catalog → a string was
//      wrapped/edited/removed without regenerating en.json, i.e. the catalog is
//      stale. Comparison is order-independent (parsed objects), so glob-traversal
//      ordering never causes a false failure.
//
// Paired with `eslint-plugin-formatjs` `no-literal-string-in-jsx` (which blocks a
// NEW hardcoded JSX literal from landing at all), this keeps G2 honest: every
// user-facing string is behind `formatMessage`/`<FormattedMessage>` and present
// in the catalog.

import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const COMMITTED = resolve(ROOT, 'src/i18n/locales/en.json');

const tmp = mkdtempSync(join(tmpdir(), 'i18n-extract-'));
const out = join(tmp, 'en.extracted.json');

try {
  execFileSync(
    'npx',
    [
      'formatjs',
      'extract',
      'src/**/*.{ts,tsx}',
      '--out-file',
      out,
      '--throws',
      '--format',
      'simple',
    ],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
  );
} catch (err) {
  console.error('✖ G2 extract: formatjs extract failed (malformed/duplicate message?).');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(err.status ?? 1);
}

const fresh = JSON.parse(readFileSync(out, 'utf8'));
const committed = JSON.parse(readFileSync(COMMITTED, 'utf8'));
rmSync(tmp, { recursive: true, force: true });

const freshKeys = new Set(Object.keys(fresh));
const committedKeys = new Set(Object.keys(committed));
const problems = [];

for (const id of freshKeys) {
  if (!committedKeys.has(id)) problems.push(`${id}: extracted but not in committed en.json (run i18n:extract)`);
  else if (fresh[id] !== committed[id]) {
    problems.push(`${id}: message drifted — committed "${committed[id]}" vs extracted "${fresh[id]}"`);
  }
}
for (const id of committedKeys) {
  if (!freshKeys.has(id)) problems.push(`${id}: in committed en.json but no longer extracted (stale — run i18n:extract)`);
}

if (problems.length > 0) {
  console.error(`✖ G2 extract: en.json is stale (${problems.length} issue(s)):`);
  for (const p of problems.sort()) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✔ G2 extract: en.json current — ${freshKeys.size} messages, all behind formatMessage.`);
