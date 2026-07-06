#!/usr/bin/env node
// G1 — UTF-8 encoding (INTERNATIONALIZATION-STANDARD §4).
//
// Assert every tracked TEXT file is us-ascii or utf-8. A latin-1 / utf-16 file
// silently mangles non-ASCII copy (accents, ñ, curly quotes) the moment it is
// read as UTF-8, so any other encoding is merge-blocking. Binary files (images,
// fonts, favicons) are not text and are skipped.
//
// Mechanism per §4: `git ls-files | file --mime-encoding`, asserting utf-8/us-ascii.

import { execFileSync } from 'node:child_process';

const ALLOWED = new Set(['utf-8', 'us-ascii']);
const SKIP = new Set(['binary']); // not text — nothing to encode

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

if (files.length === 0) {
  console.error('✖ G1 utf-8: no tracked files found (not a git repo?)');
  process.exit(1);
}

// `file --mime-encoding --brief` prints one encoding per input, in argv order.
// Batch to stay comfortably under ARG_MAX on any platform.
const encodings = [];
const BATCH = 400;
for (let i = 0; i < files.length; i += BATCH) {
  const chunk = files.slice(i, i + BATCH);
  const out = execFileSync('file', ['--mime-encoding', '--brief', '--', ...chunk], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((l) => l.length > 0);
  encodings.push(...out);
}

if (encodings.length !== files.length) {
  console.error(
    `✖ G1 utf-8: internal mismatch (${files.length} files, ${encodings.length} encodings) — aborting fail-closed`,
  );
  process.exit(1);
}

const offenders = [];
files.forEach((f, idx) => {
  const enc = encodings[idx].trim();
  if (ALLOWED.has(enc) || SKIP.has(enc)) return;
  offenders.push(`${enc}\t${f}`);
});

if (offenders.length > 0) {
  console.error(`✖ G1 utf-8: ${offenders.length} tracked text file(s) not utf-8/us-ascii:`);
  for (const o of offenders) console.error(`  - ${o}`);
  process.exit(1);
}

console.log(`✔ G1 utf-8: all ${files.length} tracked files are utf-8/us-ascii (or binary).`);
