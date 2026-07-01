#!/usr/bin/env node
// G12 — CLDR/tzdata freshness pin (INTERNATIONALIZATION-STANDARD §4 & §10).
//
// STATUS FOR THIS REPO: LIVE — davis ships react-intl / @formatjs (an ICU
// message-formatting stack), so the §10 floor is asserted on that dependency.
//
// §10 pins the CLDR/ICU floor (>= 48.2) on the npm ICU *message-formatting*
// package (@formatjs/intl / react-intl / @messageformat/core). react-intl >= 7
// and @formatjs/intl >= 3 sit at the LDML 48.2 level. This gate is fail-closed:
// if any such package drops below its §10 major floor the build breaks. Raw
// `Intl` locale-data (src/lib/format.ts, dates/numbers) is separately governed by
// the `engines.node` pin. This keeps G12 wired and honest.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(HERE, '../../package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

// ICU message-formatting libs that carry a pinnable CLDR/LDML level per §10.
// Raw `Intl` and plain i18next are intentionally NOT here — they have no npm CLDR pin.
const ICU_MESSAGE_LIBS = [
  { re: /^@formatjs\//, minMajor: 3 }, // @formatjs/intl, @formatjs/cli, ...
  { re: /^@messageformat\/core$/, minMajor: 3 }, // MF2 runtime, LDML 48.2 level
  { re: /^react-intl$/, minMajor: 7 },
  { re: /^i18next-icu$/, minMajor: 2 },
  { re: /^intl-messageformat$/, minMajor: 10 },
];

function major(range) {
  const m = String(range).match(/(\d+)/);
  return m ? Number(m[1]) : NaN;
}

const found = [];
const problems = [];

for (const [name, range] of Object.entries(deps)) {
  for (const spec of ICU_MESSAGE_LIBS) {
    if (spec.re.test(name)) {
      found.push(`${name}@${range}`);
      const maj = major(range);
      if (!Number.isFinite(maj) || maj < spec.minMajor) {
        problems.push(
          `${name}@${range}: below §10 floor — need major >= ${spec.minMajor} (CLDR/LDML >= 48.2)`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`✖ G12 cldr-pin: ${problems.length} ICU message lib(s) below the §10 floor:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (found.length > 0) {
  console.log(`✔ G12 cldr-pin: ICU message lib(s) satisfy the §10 floor — ${found.join(', ')}.`);
  process.exit(0);
}

if (!pkg.engines || !pkg.engines.node) {
  // Raw Intl's CLDR is governed by the Node pin; without one there is nothing anchoring it.
  console.error('✖ G12 cldr-pin: raw Intl in use but no engines.node pin governs the platform CLDR.');
  process.exit(1);
}

console.log(
  `✔ G12 cldr-pin: N/A-until-used — no @formatjs/@messageformat/i18next-icu dependency; ` +
    `raw Intl CLDR/tzdata governed by engines.node "${pkg.engines.node}". ` +
    `Gate activates automatically when an ICU message lib is added.`,
);
