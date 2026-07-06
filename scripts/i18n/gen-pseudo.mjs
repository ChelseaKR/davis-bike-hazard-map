#!/usr/bin/env node
// G9 — pseudolocale generator (INTERNATIONALIZATION-STANDARD §4 / §8).
//
// Transforms the English reference catalog (`src/i18n/locales/en.json`, a flat
// `{ id: message }` map) into an `en-XA`-style pseudolocale that (1) accents
// every Latin letter so untranslated / hardcoded strings stand out, (2) expands
// text ~40% to mimic longer locales (Spanish, German …), and (3) brackets each
// value with ⟦ … ⟧ so the overflow test can prove pseudo strings rendered.
//
// ICU-safe: it protects `{…}` argument/plural/select syntax (brace-depth
// tracked, so nested plural sub-messages survive) AND react-intl `<tag>` rich-
// text markup, accenting only the literal text between them. Untouched syntax
// means the pseudo message stays valid ICU that react-intl can format.
//
// The output is a TEST ARTIFACT, not a shipping locale: written OUTSIDE
// `src/i18n/locales/` (so the G3/G5/G6 catalog gates never see it) and git-
// ignored. The pseudo-overflow Playwright spec loads it and injects it into the
// running react-intl provider via the VITE_I18N_TEST_HOOKS window hook, so the
// production bundle never contains it. See tests/i18n/pseudo-overflow.spec.ts.
//
// Deterministic and dependency-free: identical input → identical output.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../src/i18n/locales/en.json');
const OUT_DIR = resolve(HERE, '../../tests/i18n');
const OUT = resolve(OUT_DIR, 'en-XA.generated.json');

// Latin letter → accented look-alike (readable, same visual width).
const ACCENTS = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í',
  j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'ƥ', q: 'ɋ', r: 'ř',
  s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Đ', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í',
  J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ', N: 'Ñ', O: 'Ó', P: 'Ƥ', Q: 'Ǫ', R: 'Ř',
  S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

// Filler drawn cyclically to reach the ~40% expansion target.
const FILLER = 'áéíóúàèìòù';
const EXPANSION = 0.4; // ~40% more characters than the source (§4 target).

/** Accent one word and append deterministic filler to grow it ~EXPANSION. */
function expandWord(word, counterRef) {
  let accented = '';
  let letters = 0;
  for (const ch of word) {
    if (ACCENTS[ch]) {
      accented += ACCENTS[ch];
      letters++;
    } else {
      accented += ch; // digits, punctuation, symbols pass through
    }
  }
  if (letters === 0) return accented;
  const padLen = Math.ceil(letters * EXPANSION);
  let pad = '';
  for (let i = 0; i < padLen; i++) {
    pad += FILLER[counterRef.i % FILLER.length];
    counterRef.i++;
  }
  return accented + pad;
}

/** Accent + expand only whitespace-delimited word tokens in a literal run. */
function transformLiteral(literal, counterRef) {
  return literal
    .split(/(\s+)/g)
    .map((tok) => (/^\s+$/.test(tok) || tok === '' ? tok : expandWord(tok, counterRef)))
    .join('');
}

/**
 * Pseudo-localize a single value. Walks char-by-char: `{…}` (any nesting depth)
 * and `<…>` markup pass through untouched; the literal text between them is
 * accented + expanded. The whole value is then bracketed with ⟦ … ⟧.
 */
function pseudo(value) {
  if (typeof value !== 'string' || value.trim() === '') return value;
  const counterRef = { i: 0 };
  let out = '';
  let literal = '';
  let depth = 0;
  let inTag = false;
  const flush = () => {
    out += transformLiteral(literal, counterRef);
    literal = '';
  };
  for (const ch of value) {
    if (inTag) {
      out += ch;
      if (ch === '>') inTag = false;
    } else if (ch === '<' && depth === 0) {
      flush();
      out += ch;
      inTag = true;
    } else if (ch === '{') {
      if (depth === 0) flush();
      out += ch;
      depth++;
    } else if (ch === '}') {
      out += ch;
      depth = Math.max(0, depth - 1);
    } else if (depth > 0) {
      out += ch; // inside ICU argument/plural/select — protected
    } else {
      literal += ch;
    }
  }
  flush();
  return `⟦${out}⟧`;
}

const en = JSON.parse(readFileSync(SRC, 'utf8'));
const pseudoCatalog = {};
for (const id of Object.keys(en).sort()) pseudoCatalog[id] = pseudo(en[id]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(pseudoCatalog, null, 2) + '\n', 'utf8');

console.log(
  `✔ G9 pseudolocale: wrote en-XA (${OUT.replace(process.cwd() + '/', '')}) from en.json ` +
    `(${Object.keys(pseudoCatalog).length} messages).`,
);
