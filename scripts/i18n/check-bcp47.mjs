#!/usr/bin/env node
// G3 — BCP 47 / RFC 5646 tag validity (INTERNATIONALIZATION-STANDARD §4).
//
// Validate every authored locale tag via `Intl.Locale(tag)` (well-formedness)
// and registry-check its language subtag against the ICU/CLDR language registry
// (`Intl.DisplayNames`). A malformed or unregistered tag (custom enum drift,
// wrong casing, typo like "sp" for Spanish) would break Accept-Language lookup,
// `hreflang`, and the html `lang` attribute, so this gate is merge-blocking.
//
// Source of truth for authored tags: the shipping catalogs in src/i18n/locales/.
// One <tag>.json == one authored, shipping locale.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = resolve(HERE, '../../src/i18n/locales');

const tags = readdirSync(LOCALES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

if (tags.length === 0) {
  console.error('✖ G3 bcp47: no locale catalogs found in src/i18n/locales/');
  process.exit(1);
}

const langNames = new Intl.DisplayNames(['en'], { type: 'language' });
const problems = [];

for (const tag of tags) {
  // 1. Well-formed per BCP 47 grammar — Intl.Locale throws RangeError otherwise.
  let loc;
  try {
    loc = new Intl.Locale(tag);
  } catch {
    problems.push(`${tag}: malformed BCP 47 tag (Intl.Locale rejected it)`);
    continue;
  }
  // 2. Canonical form — catches bad casing / non-canonical subtags (e.g. "EN", "es_MX").
  const canonical = Intl.getCanonicalLocales(tag)[0];
  if (canonical !== tag) {
    problems.push(`${tag}: not canonical — expected "${canonical}"`);
  }
  // 3. Registry validity — the language subtag must resolve to a real language.
  //    DisplayNames returns the code unchanged for an unregistered subtag.
  const display = langNames.of(loc.language);
  if (!display || display.toLowerCase() === loc.language.toLowerCase()) {
    problems.push(`${tag}: language subtag "${loc.language}" is not in the ICU/CLDR registry`);
  }
}

if (problems.length > 0) {
  console.error(`✖ G3 bcp47: ${problems.length} invalid authored tag(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`✔ G3 bcp47: ${tags.length} authored tag(s) valid & canonical — ${tags.join(', ')}.`);
