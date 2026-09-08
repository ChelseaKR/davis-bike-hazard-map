#!/usr/bin/env node
// G2 — no NEW hardcoded UI strings (ratchet) — INTERNATIONALIZATION-STANDARD §4.
//
// TWO PASSES, because display text is produced in two different shapes here and
// one detector cannot see both.
//
// COVERAGE IS PART OF THE VERDICT. Every `.ts`/`.tsx` under `src/` (the client
// display surface) must be judged by pass A, judged by pass B, or named in
// `DEFERRED` with a written reason. A file that is in none of the three FAILS
// the gate, and the green line states how many files were judged out of how
// many exist. Before that accounting existed the gate scanned 35 of 48 files
// and printed a pass — `src/hooks/`, `src/i18n/`, `src/config.ts`, `src/main.tsx`
// and `src/components/*.ts` were outside both passes with no record anywhere in
// the gate's own output, and `src/hooks/useHazards.ts` was carrying an
// untranslated rider-facing string through it.
//
// Pass A — JSX (every `.tsx` under src/)
//   `eslint-plugin-formatjs`'s `no-literal-string-in-jsx`, failing on any
//   flagged literal that contains an actual letter (\p{L}) — real translatable
//   copy not behind `formatMessage`/`<FormattedMessage>`. Decorative literals
//   with no letters (forced spaces `{' '}`, `·` separators, emoji) are ignored.
//
// Pass B — display text produced OUTSIDE JSX (every `.ts` under src/)
//   `no-literal-string-in-jsx` only flags literals appearing directly in JSX. A
//   string built in a `.ts` module and interpolated as `{step.label}` is
//   invisible to it twice over: wrong file, wrong node type. `check-extract.mjs`
//   does glob `src/**`, but `formatjs extract` harvests only
//   `defineMessages`/`formatMessage`/`FormattedMessage` nodes, so a bare literal
//   is invisible to that half too. Both halves were blind, for different
//   reasons — and `src/lib/reportTrail.ts` shipped 14 untranslated strings
//   through the entire reporter feedback trail, landing AFTER the ratchet and
//   passing it (issue #164).
//
//   Pass B walks the TypeScript AST of every `.ts` file under src/ and flags a
//   string or template literal that looks like display text — multi-word, or
//   capitalised and not an identifier/constant — unless it is inside a
//   `defineMessages`/`formatMessage` call, is a property key, an import source,
//   a literal type, or a `'X' in window` feature probe.
//
//   Pass B is not run over `.tsx`: a `defaultMessage="…"` JSX attribute is a
//   plain string literal to this walker, so every correctly-wrapped component
//   would be reported. Pass A is the detector for those files.
//
//   Two escape hatches, both of which leave a written reason in the tree:
//     * `DEFERRED` below — a whole file, with the reason, mirrored in
//       docs/I18N.md's honest ledger;
//     * an `i18n-exempt: <reason>` comment on the literal's line or the line
//       above, for a one-off technical string.
//   Neither is silent, which is the point: the previous gate published a clean
//   baseline of 0 over a surface it never opened.
//
//   `DEFERRED` is SELF-LIMITING. An entry whose file no longer exists, whose
//   reason is blank, or which produces no finding when scanned fails the gate
//   until it is deleted — otherwise the map becomes the drawer an untranslated
//   string is swept into, and a stale entry exempts a file nothing is wrong
//   with while reading as a live exception.
//
// OUT OF THIS GATE'S UNIVERSE: `server/**` and `shared/**`. They are not
// scanned and are not claimed to be clean — running pass B over them reports
// 344 candidates, mostly SQL and diagnostics, but including the routing step
// labels and the push notification body, which a rider does read. Issue #201
// and docs/I18N.md carry that; the point here is that the boundary is stated
// rather than implied by a green line.
//
// Together with check-extract.mjs ("catalog is current"): every user-facing
// string is wrapped AND in the catalog.

import { Linter } from 'eslint';
import formatjs from 'eslint-plugin-formatjs';
import tsparser from '@typescript-eslint/parser';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SRC = resolve(ROOT, 'src');

/** Every `.ts`/`.tsx` under src/, walked from the filesystem rather than from
 *  `git ls-files` — an untracked new module is exactly the code most likely to
 *  carry a new mistake, and a git-derived universe cannot see it. */
function sourceFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFilesUnder(p));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) out.push(p);
  }
  return out.sort();
}

const universe = sourceFilesUnder(SRC).map((f) => relative(ROOT, f));
const jsxFiles = universe.filter((f) => f.endsWith('.tsx'));
const tsFiles = universe.filter((f) => !f.endsWith('.tsx'));

/**
 * Whole files pass B does not scan, each with the reason. Keep this in step
 * with the "Deferred / out of scope" ledger in docs/I18N.md — an exclusion with
 * no stated reason is the thing this gate exists to prevent.
 *
 * Self-limiting: an entry that names a file outside the universe, carries a
 * blank reason, or produces no finding when scanned fails the gate below.
 */
const DEFERRED = new Map([
  [
    'src/lib/format.ts',
    'relative-time and distance formatting — already named in the docs/I18N.md ledger; needs Intl.RelativeTimeFormat/NumberFormat (G7/G8), not message wrapping',
  ],
  // `src/lib/landmarks.ts` was deferred here for "Davis place names — proper
  // nouns, not translated copy". PR #191 moved that list into the place pack
  // (place/davis.json), so the file has held no place name since; the entry was
  // exempting nothing while reading as a live exception. The self-limiting
  // check below found it on its first run. It is now scanned, and clean.
  [
    'src/lib/api.ts',
    'HTTP scheme tokens ("Bearer ") plus the thrown request-failure text, which DOES reach a rider: useHazards renders err.message into ListView\'s role="alert". Wrapping only the local fallback would translate the rarest branch and leave the server sentence in English — the fix is the issue #173 shape (throw a code, resolve it in src/i18n/labels.ts at the point of display), tracked at issue #200',
  ],
  [
    'src/hooks/useHazards.ts',
    'the same feed-error string as api.ts above: `Could not load hazards.` is the fallback for a non-Error throw, and the common branch is the server sentence api.ts carries. Both move together in issue #200; deferring one and wrapping the other would make the gate green over the branch a rider actually sees',
  ],
]);

const HAS_LETTER = /\p{L}/u;
const linter = new Linter();
const offenders = [];

for (const rel of jsxFiles) {
  const file = resolve(ROOT, rel);
  const code = readFileSync(file, 'utf8');
  const lines = code.split('\n');
  const messages = linter.verify(code, {
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: { formatjs },
    rules: { 'formatjs/no-literal-string-in-jsx': 'error' },
  });
  for (const m of messages) {
    // Only our rule's findings — ignore core noise (e.g. unknown inline
    // eslint-disable directives for rules this standalone Linter doesn't load).
    if (m.ruleId !== 'formatjs/no-literal-string-in-jsx') continue;
    const line = lines[m.line - 1] ?? '';
    const end = m.endColumn && m.endLine === m.line ? m.endColumn - 1 : line.length;
    const text = line.slice(m.column - 1, end);
    if (HAS_LETTER.test(text)) {
      offenders.push(`${file.replace(ROOT + '/', '')}:${m.line}:${m.column}  ${text.trim()}`);
    }
  }
}

// --- Pass B: display text produced outside JSX (every `.ts` under src/) -----

const INTER_WORD = /\S\s+\S/;
/** SCREAMING_SNAKE and enum-ish constants. */
const SCREAMING = /^[\p{Lu}0-9_]+$/u;
/** PascalCase/camelCase identifiers used as strings: ApiRequestError, PushManager. */
const IDENTIFIER_LIKE = /^\p{Lu}[\p{Ll}0-9]*\p{Lu}/u;
const I18N_CALL = /(^|\.)(defineMessages|formatMessage)$/;

function insideI18nCall(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isCallExpression(n) && I18N_CALL.test(n.expression.getText())) return true;
  }
  return false;
}

/** Every display-text finding in one `.ts` file. */
function passB(rel) {
  const file = resolve(ROOT, rel);
  const found = [];
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const lines = text.split('\n');

  const consider = (node, value) => {
    if (!HAS_LETTER.test(value)) return;
    const looksLikeDisplay =
      INTER_WORD.test(value) ||
      (/^\p{Lu}/u.test(value) && !SCREAMING.test(value) && !IDENTIFIER_LIKE.test(value));
    if (!looksLikeDisplay) return;

    const parent = node.parent;
    if (
      parent &&
      ((ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node))
    ) {
      return; // a key, not a value
    }
    if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))) return;
    if (parent && ts.isLiteralTypeNode(parent)) return;
    // Feature probes: `'PushManager' in window`.
    if (
      parent &&
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      parent.left === node
    ) {
      return;
    }
    if (insideI18nCall(node)) return;

    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    if (/i18n-exempt/.test(lines[line] ?? '') || /i18n-exempt/.test(lines[line - 1] ?? '')) return;

    found.push(`${rel}:${line + 1}  ${JSON.stringify(value)}`);
  };

  const walk = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      consider(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      consider(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(' '));
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  return found;
}

const scannedByB = tsFiles.filter((rel) => !DEFERRED.has(rel));
for (const rel of scannedByB) offenders.push(...passB(rel));

// --- Coverage accounting: what did this gate actually judge? -----------------
//
// A finding count is only meaningful beside the size of the corpus it came
// from. These three checks make "0 findings" impossible to confuse with
// "0 inputs examined".

const problems = [];

// 1. Non-empty floor. A walker that stopped finding files, or a rename that
//    emptied a pass, must fail rather than pass on nothing.
if (universe.length === 0) problems.push('src/ holds no .ts/.tsx files — the walker found nothing to judge');
if (jsxFiles.length === 0) problems.push('pass A had no .tsx files to scan');
if (scannedByB.length === 0) problems.push('pass B had no .ts files to scan');

// 2. Every file is accounted for. Judged by A, judged by B, or deferred with a
//    reason. A file in none of the three is a surface this gate never opened
//    and would otherwise have reported clean.
const accounted = new Set([...jsxFiles, ...scannedByB, ...DEFERRED.keys()]);
const unaccounted = universe.filter((rel) => !accounted.has(rel));
for (const rel of unaccounted) {
  problems.push(`${rel} is neither scanned nor deferred — add it to a pass, or to DEFERRED with a reason`);
}

// 3. The deferral list is self-limiting. Each entry must name a file in the
//    universe, carry a reason, and still produce a finding — a deferral that
//    exempts nothing is a live exception in the ledger that describes nothing.
for (const [rel, why] of DEFERRED) {
  if (!universe.includes(rel)) {
    problems.push(`DEFERRED names ${rel}, which is not a .ts/.tsx file under src/ — delete the entry`);
    continue;
  }
  if (rel.endsWith('.tsx')) {
    problems.push(`DEFERRED names ${rel}, a .tsx file — pass A scans those and has no deferral hatch`);
    continue;
  }
  if (!why || !why.trim()) {
    problems.push(`DEFERRED entry for ${rel} has no written reason`);
    continue;
  }
  if (passB(rel).length === 0) {
    problems.push(`DEFERRED entry for ${rel} is stale: it now produces no finding, so delete it and let the gate scan it`);
  }
}

if (offenders.length > 0 || problems.length > 0) {
  if (offenders.length > 0) {
    console.error(`✖ G2 no-hardcoded: ${offenders.length} untranslated literal(s) with letters:`);
    for (const o of offenders) console.error(`  - ${o}`);
    console.error('  Wrap them in defineMessages / formatMessage / <FormattedMessage> and re-run i18n:extract.');
    console.error('  For a genuinely technical string, add an `i18n-exempt: <reason>` comment on its line.');
  }
  if (problems.length > 0) {
    console.error(`✖ G2 no-hardcoded: ${problems.length} coverage problem(s) — the gate cannot report a clean scan:`);
    for (const p of problems) console.error(`  - ${p}`);
  }
  process.exit(1);
}

const judged = jsxFiles.length + scannedByB.length;
console.log(
  `✔ G2 no-hardcoded: judged ${judged} of ${universe.length} src/ source file(s) — ` +
    `${jsxFiles.length} in JSX pass A, ${scannedByB.length} in AST pass B — ` +
    `no untranslated letter-bearing literals. ` +
    `${DEFERRED.size} file(s) deferred with a stated reason (see docs/I18N.md):`,
);
for (const [file, why] of DEFERRED) console.log(`    ${file} — ${why}`);
console.log(
  "  server/** and shared/** are outside this gate's universe and are NOT claimed clean — issue #201, docs/I18N.md.",
);
