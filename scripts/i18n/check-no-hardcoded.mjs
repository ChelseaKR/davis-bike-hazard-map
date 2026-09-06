#!/usr/bin/env node
// G2 — no NEW hardcoded UI strings (ratchet) — INTERNATIONALIZATION-STANDARD §4.
//
// TWO PASSES, because display text is produced in two different shapes here and
// one detector cannot see both.
//
// Pass A — JSX (src/App.tsx + src/components/**.tsx)
//   `eslint-plugin-formatjs`'s `no-literal-string-in-jsx`, failing on any
//   flagged literal that contains an actual letter (\p{L}) — real translatable
//   copy not behind `formatMessage`/`<FormattedMessage>`. Decorative literals
//   with no letters (forced spaces `{' '}`, `·` separators, emoji) are ignored.
//
// Pass B — display text produced OUTSIDE JSX (src/lib/**)
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
//   Pass B walks the TypeScript AST of every file under src/lib and flags a
//   string or template literal that looks like display text — multi-word, or
//   capitalised and not an identifier/constant — unless it is inside a
//   `defineMessages`/`formatMessage` call, is a property key, an import source,
//   a literal type, or a `'X' in window` feature probe.
//
//   Two escape hatches, both of which leave a written reason in the tree:
//     * `LIB_DEFERRED` below — a whole file, with the reason, mirrored in
//       docs/I18N.md's honest ledger;
//     * an `i18n-exempt: <reason>` comment on the literal's line or the line
//       above, for a one-off technical string.
//   Neither is silent, which is the point: the previous gate published a clean
//   baseline of 0 over a surface it never opened.
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
const COMPONENTS = resolve(ROOT, 'src/components');
const LIB = resolve(ROOT, 'src/lib');

const files = [
  resolve(ROOT, 'src/App.tsx'),
  ...readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(COMPONENTS, f)),
];

/**
 * Files under src/lib that pass B does not scan, each with the reason. Keep
 * this in step with the "Deferred / out of scope" ledger in docs/I18N.md — an
 * exclusion with no stated reason is the thing this gate exists to prevent.
 */
const LIB_DEFERRED = new Map([
  [
    'src/lib/format.ts',
    'relative-time and distance formatting — already named in the docs/I18N.md ledger; needs Intl.RelativeTimeFormat/NumberFormat (G7/G8), not message wrapping',
  ],
  [
    'src/lib/landmarks.ts',
    'Davis place names — proper nouns ("UC Davis Memorial Union"), not translated copy',
  ],
  [
    'src/lib/api.ts',
    'HTTP scheme tokens ("Bearer ") and developer-facing request diagnostics, none of which is rendered to a rider as prose',
  ],
  [
    'src/lib/geolocation.ts',
    'thrown Error text surfaced through the catalogued {reason} slot in route.error.location — tracked separately, see docs/I18N.md',
  ],
  [
    'src/lib/photo.ts',
    'thrown Error text — same follow-up as geolocation.ts, see docs/I18N.md',
  ],
  [
    'src/lib/push.ts',
    'thrown Error text — same follow-up as geolocation.ts, see docs/I18N.md',
  ],
]);

const HAS_LETTER = /\p{L}/u;
const linter = new Linter();
const offenders = [];

for (const file of files) {
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

// --- Pass B: display text produced outside JSX (src/lib/**) -----------------

function tsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(p);
  }
  return out.sort();
}

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

let libScanned = 0;
for (const file of tsFilesUnder(LIB)) {
  const rel = relative(ROOT, file);
  if (LIB_DEFERRED.has(rel)) continue;
  libScanned++;
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

    offenders.push(`${rel}:${line + 1}  ${JSON.stringify(value)}`);
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
}

if (offenders.length > 0) {
  console.error(`✖ G2 no-hardcoded: ${offenders.length} untranslated literal(s) with letters:`);
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('  Wrap them in defineMessages / formatMessage / <FormattedMessage> and re-run i18n:extract.');
  console.error('  For a genuinely technical string, add an `i18n-exempt: <reason>` comment on its line.');
  process.exit(1);
}

console.log(
  `✔ G2 no-hardcoded: ${files.length} JSX file(s) + ${libScanned} src/lib file(s) clean — ` +
    `no untranslated letter-bearing literals. ` +
    `${LIB_DEFERRED.size} src/lib file(s) deferred with a stated reason (see docs/I18N.md):`,
);
for (const [file, why] of LIB_DEFERRED) console.log(`    ${file} — ${why}`);
