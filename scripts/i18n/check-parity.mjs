#!/usr/bin/env node
// G6 (EN/ES id-parity) + G5 (completeness + placeholder parity)
// — INTERNATIONALIZATION-STANDARD §4.
//
// The catalogs are flat `{ id: message }` maps produced by
// `formatjs extract --format simple`. English is the reference; the gates are:
//
//   G6  keys(en) == keys(es) EXACTLY (symmetric difference empty) — always
//       merge-blocking. A missing/extra id in es is a defect.
//   G5  en:  COMPLETE — no empty English message; every message is well-formed
//            ICU (balanced braces); placeholder set is self-consistent.
//       es:  STRUCTURAL parity today (empty values allowed) because es ships
//            structure-only with runtime English fallback (REVIEW-GATE R3 — no
//            machine translation). For any es value that IS translated, its
//            ICU placeholder set MUST match English (a dropped/renamed
//            placeholder would break interpolation). Flip ES_REQUIRE_COMPLETE
//            to true — one line — to promote es to hard completeness once
//            translation lands.
//
// Deterministic, dependency-free, offline.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ── one-line flip: set true once es is fully translated (promotes G5 for es
//    from structural parity to hard completeness). ────────────────────────────
const ES_REQUIRE_COMPLETE = false;

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = resolve(HERE, '../../src/i18n/locales');
const REFERENCE = 'en';
const TARGETS = ['es'];

function load(tag) {
  return JSON.parse(readFileSync(resolve(LOCALES, `${tag}.json`), 'utf8'));
}

/** Top-level ICU argument names in a message: `{name}`, `{name, plural, …}`, etc.
 *  Only names at brace-depth 0 count; `#` and plural sub-messages are ignored. */
function placeholders(message) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === '{') {
      if (depth === 0) {
        const m = /^\{\s*([a-zA-Z0-9_]+)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth++;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

/** Cheap ICU well-formedness: braces must balance and never go negative. */
function bracesBalanced(message) {
  let depth = 0;
  for (const ch of message) {
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function eqSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const en = load(REFERENCE);
const problems = [];

// G5(en): completeness + well-formedness.
for (const [id, msg] of Object.entries(en)) {
  if (typeof msg !== 'string' || msg.trim() === '') {
    problems.push(`en.${id}: empty English message (source must be complete)`);
  } else if (!bracesBalanced(msg)) {
    problems.push(`en.${id}: malformed ICU (unbalanced braces)`);
  }
}

for (const tag of TARGETS) {
  const target = load(tag);
  const enKeys = new Set(Object.keys(en));
  const tgtKeys = new Set(Object.keys(target));

  // G6: exact id parity (symmetric difference empty).
  for (const id of enKeys) if (!tgtKeys.has(id)) problems.push(`${tag}.${id}: missing (in en, not ${tag})`);
  for (const id of tgtKeys) if (!enKeys.has(id)) problems.push(`${tag}.${id}: unexpected (in ${tag}, not en)`);

  // G5(target): completeness (if required) + placeholder parity on translated values.
  for (const id of enKeys) {
    if (!tgtKeys.has(id)) continue;
    const value = target[id];
    const translated = typeof value === 'string' && value.trim() !== '';
    if (!translated) {
      if (ES_REQUIRE_COMPLETE) problems.push(`${tag}.${id}: empty (es must be complete)`);
      continue; // structure-only: English fallback at runtime
    }
    if (!bracesBalanced(value)) {
      problems.push(`${tag}.${id}: malformed ICU (unbalanced braces)`);
      continue;
    }
    if (!eqSet(placeholders(en[id]), placeholders(value))) {
      problems.push(
        `${tag}.${id}: placeholder mismatch — en {${[...placeholders(en[id])].sort().join(', ')}} vs ` +
          `${tag} {${[...placeholders(value)].sort().join(', ')}}`,
      );
    }
  }
}

problems.sort();

if (problems.length > 0) {
  console.error(`✖ G5/G6 i18n parity: ${problems.length} issue(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const esTranslated = Object.values(load('es')).filter((v) => v.trim() !== '').length;
console.log(
  `✔ G5/G6 i18n parity: ${Object.keys(en).length} ids, en↔${TARGETS.join(',')} key-for-key; ` +
    `en complete; es structure-only (${esTranslated} translated, ES_REQUIRE_COMPLETE=${ES_REQUIRE_COMPLETE}).`,
);
