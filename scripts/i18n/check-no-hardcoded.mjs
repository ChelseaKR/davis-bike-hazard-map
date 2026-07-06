#!/usr/bin/env node
// G2 — no NEW hardcoded UI strings (ratchet) — INTERNATIONALIZATION-STANDARD §4.
//
// Runs `eslint-plugin-formatjs`'s `no-literal-string-in-jsx` over the wrapped UI
// surface (src/App.tsx + src/components/**.tsx) and fails on any flagged literal
// that contains an actual letter (\p{L}) — i.e. real, translatable copy that
// isn't behind `formatMessage`/`<FormattedMessage>`. Decorative literals with no
// letters (forced spaces `{' '}`, `·` separators, emoji like 🚲/🔒) are ignored,
// so the gate targets translatable text only. The current baseline is ZERO, so
// any new hardcoded string breaks the build.
//
// This is the ratchet half of G2; check-extract.mjs is the "catalog is current"
// half. Together: every user-facing string is wrapped AND in the catalog.

import { Linter } from 'eslint';
import formatjs from 'eslint-plugin-formatjs';
import tsparser from '@typescript-eslint/parser';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const COMPONENTS = resolve(ROOT, 'src/components');

const files = [
  resolve(ROOT, 'src/App.tsx'),
  ...readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(COMPONENTS, f)),
];

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

if (offenders.length > 0) {
  console.error(`✖ G2 no-hardcoded: ${offenders.length} untranslated literal(s) with letters:`);
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('  Wrap them in formatMessage / <FormattedMessage> and re-run i18n:extract.');
  process.exit(1);
}

console.log(`✔ G2 no-hardcoded: ${files.length} UI files clean — no untranslated letter-bearing literals.`);
