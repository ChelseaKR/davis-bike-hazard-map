#!/usr/bin/env node
// Keep es.json in structural parity with the extracted en.json (G6), WITHOUT
// clobbering any translations already provided.
//
// es ships **structure-only** today (INTERNATIONALIZATION-STANDARD REVIEW-GATE
// R3 — no machine translation): every English id is present with an empty
// string, so the runtime falls back to the inline English defaultMessage. When
// a translator fills a value in, this script preserves it; it only adds newly
// extracted ids (as empty) and drops ids that no longer exist in en. Run it
// after `formatjs extract` whenever the English catalog changes.
//
// Deterministic, dependency-free: sorts keys so the diff is stable.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCALES = resolve(HERE, '../../src/i18n/locales');
const EN = resolve(LOCALES, 'en.json');
const ES = resolve(LOCALES, 'es.json');

const en = JSON.parse(readFileSync(EN, 'utf8'));
let es = {};
try {
  es = JSON.parse(readFileSync(ES, 'utf8'));
} catch {
  es = {};
}

const out = {};
let added = 0;
let kept = 0;
for (const id of Object.keys(en).sort()) {
  const existing = typeof es[id] === 'string' ? es[id] : '';
  if (existing.trim() !== '') kept++;
  else added++;
  out[id] = existing;
}
const dropped = Object.keys(es).filter((id) => !(id in en));

writeFileSync(ES, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(
  `✔ es skeleton synced: ${Object.keys(out).length} ids ` +
    `(${kept} translated, ${added} empty/untranslated, ${dropped.length} dropped).`,
);
