#!/usr/bin/env node
// G2b — no NEW user-facing string literals in shared/ (ratchet) —
// INTERNATIONALIZATION-STANDARD §3/§4.
//
// `shared/` runs on BOTH the server (authoritative validation) and the client
// (pre-submit checks). Any human-readable message it hard-codes is an English
// string with no translation path — the fix is to back it with a STABLE MACHINE
// CODE the client can translate (see server/app.ts error envelopes +
// src/i18n/apiErrors.ts) rather than shipping the prose to users.
//
// This gate parses shared/*.ts and flags letter-bearing string literals used as
// user-facing validation messages: a `message:` property (Zod refine/schema
// options) or a string argument to `.regex(...)`. It is a RATCHET: the strings
// that exist today are grandfathered in the ALLOWLIST below (each is already
// mapped to a stable server error code and translated via the react-intl
// catalog); any NEW such literal breaks the build until it is either mapped to a
// code or explicitly allow-listed with a rationale.
//
// Deterministic, dependency-free beyond the TS parser (already a devDep).

import { parse } from '@typescript-eslint/parser';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SHARED = resolve(ROOT, 'shared');

// Grandfathered validation messages (each backed by a stable error code and
// translated client-side). Keep this list SHORT and shrinking — do not add to it
// to silence a new string; add an error code instead.
const ALLOWLIST = new Set([
  'Location must be within Davis, CA.',
  'Photo must be a base64-encoded JPEG, PNG, or WebP data URL.',
  'Photo is too large; please retake at a lower resolution.',
  'bbox min must not exceed max.',
]);

const HAS_LETTER = /\p{L}/u;
const MESSAGE_KEYS = new Set(['message']);
// Zod methods whose string arguments are user-facing error messages.
const MESSAGE_CALLS = new Set(['regex']);

const files = readdirSync(SHARED)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => join(SHARED, f));

const offenders = [];

/** Collect string literals that look like user-facing validation messages. */
function collect(node, file, out) {
  if (!node || typeof node !== 'object') return;

  if (node.type === 'Property' && node.key && MESSAGE_KEYS.has(node.key.name)) {
    const v = node.value;
    if (v && v.type === 'Literal' && typeof v.value === 'string' && HAS_LETTER.test(v.value)) {
      out.push({ text: v.value, line: v.loc?.start.line ?? 0 });
    }
  }

  if (
    node.type === 'CallExpression' &&
    node.callee?.type === 'MemberExpression' &&
    node.callee.property?.type === 'Identifier' &&
    MESSAGE_CALLS.has(node.callee.property.name)
  ) {
    for (const arg of node.arguments ?? []) {
      if (arg.type === 'Literal' && typeof arg.value === 'string' && HAS_LETTER.test(arg.value)) {
        out.push({ text: arg.value, line: arg.loc?.start.line ?? 0 });
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => collect(c, file, out));
    else if (child && typeof child.type === 'string') collect(child, file, out);
  }
}

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(code, { loc: true });
  } catch (err) {
    console.error(`✖ G2b shared-strings: failed to parse ${file.replace(ROOT + '/', '')}: ${err.message}`);
    process.exit(1);
  }
  const found = [];
  collect(ast, file, found);
  for (const { text, line } of found) {
    if (!ALLOWLIST.has(text)) {
      offenders.push(`${file.replace(ROOT + '/', '')}:${line}  ${JSON.stringify(text)}`);
    }
  }
}

if (offenders.length > 0) {
  console.error(`✖ G2b shared-strings: ${offenders.length} new user-facing literal(s) in shared/:`);
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('  Back each with a stable error code (server/app.ts + src/i18n/apiErrors.ts) so the client can translate it.');
  process.exit(1);
}

console.log(
  `✔ G2b shared-strings: shared/ clean — ${ALLOWLIST.size} grandfathered message(s), no new untranslatable literals.`,
);
