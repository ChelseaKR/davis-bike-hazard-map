/**
 * Guard: the documentation-audit gate can fail, and fails closed.
 *
 * `docs/DOCUMENTATION-AUDIT.md` carries a generated block, and
 * `scripts/doc_audit.py --check` is the `make verify` step that is supposed to
 * hold it to the tree. Until 2026-08-28 that check did exactly one thing:
 * re-render the block and compare it to the committed text. "The file is
 * current" was therefore the only proposition it could ever fail on, and two
 * real failures rode through it green:
 *
 *  (a) a *failing predicate that had been regenerated*. Break a relative link,
 *      run `make docs-audit`, and the block honestly records
 *      `| Local doc links resolve | fail |` and names the broken link. Because
 *      the block then matched the tree, `--check` printed "doc audit OK" and
 *      exited 0. The documented fix for a merge conflict in this file is "run
 *      `make docs-audit` and commit the result" (docs/PR-TRIAGE.md), so the
 *      routine conflict resolution was also the laundering path;
 *  (b) *nothing to audit*. Against a tree with no `README.md`, no `tests/` and
 *      no `.github/workflows/`, every presence row rendered `fail` and the gate
 *      still exited 0 — success reported having inspected zero test files, zero
 *      workflows and zero links.
 *
 * Both are the failure the audit itself was written to delete (a validation
 * surface reporting success about records it did not inspect), moved up one
 * level into the checker. These tests are the reason it cannot come back.
 *
 * The cases run against synthetic fixture trees in a temp dir, never against
 * this repository, so the suite never has to mutate the real docs to prove the
 * gate bites. The one case that does run against the real tree asserts only
 * that it is currently green.
 *
 * Exit codes under test: 0 green, 1 the committed block drifted, 2 the audit
 * itself failed (failing predicate, nothing to audit, or unreadable input).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Vitest runs with cwd at the repo root (the same approach as pushSw.test.ts
// and requiredChecks.test.ts, since import.meta.url is an http: URL in jsdom).
const ROOT = process.cwd();
const SCRIPT = join('scripts', 'doc_audit.py');

const BEGIN = '<!-- BEGIN GENERATED: doc-audit (scripts/doc_audit.py) -->';
const END = '<!-- END GENERATED: doc-audit -->';

const EXIT_OK = 0;
const EXIT_DRIFT = 1;
const EXIT_AUDIT_FAILED = 2;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function run(cwd: string, ...args: string[]): Run {
  const result = spawnSync('python3', [SCRIPT, ...args], { cwd, encoding: 'utf-8' });
  if (result.error) throw result.error;
  // A null status means the process was killed by a signal. Treat that as a
  // failure rather than coercing it to 0, which is this file's whole subject.
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * A minimal but *valid* fixture tree: every presence check satisfied, one
 * resolvable relative link, one test file, one workflow. `--check` is green on
 * it, so any single mutation below is the sole cause of the failure it proves.
 */
function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-audit-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });
  mkdirSync(join(dir, 'tests', 'unit'), { recursive: true });
  mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });

  cpSync(join(ROOT, SCRIPT), join(dir, SCRIPT));
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: {} }),
  );

  for (const name of [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'CHANGELOG.md',
    'LICENSE',
    'NOTICE',
    'CITATION.cff',
    'CODE_OF_CONDUCT.md',
  ]) {
    writeFileSync(join(dir, name), `# ${name}\n`);
  }
  writeFileSync(join(dir, '.github', 'PULL_REQUEST_TEMPLATE.md'), '# PR\n');
  writeFileSync(join(dir, '.github', 'CODEOWNERS'), '* @owner\n');
  writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
  writeFileSync(join(dir, 'tests', 'unit', 'fixture.test.ts'), "it('x', () => {});\n");

  // One in-repo relative link that resolves, so the link check has something to
  // check and the "found no links to audit" floor is satisfied.
  writeFileSync(join(dir, 'docs', 'GUIDE.md'), '# Guide\n\n[readme](../README.md)\n');
  writeFileSync(
    join(dir, 'docs', 'DOCUMENTATION-AUDIT.md'),
    `# Documentation Audit\n\nHand-authored preamble.\n\n${BEGIN}\n${END}\n`,
  );

  return dir;
}

// The green fixture is built and generated *once*, then copied per case. Each
// case still gets its own tree to mutate, but the suite spawns the interpreter
// a handful of times instead of three times per case: this file shares CPU with
// jsdom + axe cases whose budgets are timing-sensitive.
let template = '';
const trees: string[] = [];

beforeAll(() => {
  template = makeTree();
  const regen = run(template);
  expect(regen.status, `fixture should regenerate cleanly: ${regen.stderr}`).toBe(EXIT_OK);
  const check = run(template, '--check');
  expect(check.status, `fixture should start green: ${check.stderr}`).toBe(EXIT_OK);
});

afterAll(() => {
  for (const dir of [template, ...trees]) {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A private copy of the already-green fixture, cleaned up after the suite. */
function freshGreenTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-audit-'));
  cpSync(template, dir, { recursive: true });
  trees.push(dir);
  return dir;
}

describe('doc audit gate', () => {
  it('is green against this repository as committed', () => {
    const result = run(ROOT, '--check');
    expect(result.status, result.stderr).toBe(EXIT_OK);
  });

  it('fails when a doc changes and the audit is not regenerated', () => {
    const dir = freshGreenTree();
    // A new document moves the inventory count; no predicate breaks.
    writeFileSync(join(dir, 'docs', 'NEW.md'), '# New\n');
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_DRIFT);
    expect(result.stderr).toMatch(/no longer describes this tree/);
  });

  it('fails on a broken local link even after the audit is regenerated', () => {
    const dir = freshGreenTree();
    writeFileSync(join(dir, 'docs', 'GUIDE.md'), '# Guide\n\n[gone](./NO-SUCH-FILE.md)\n');

    // Regenerating is the documented conflict fix. It must not launder this.
    const regen = run(dir);
    expect(regen.status).toBe(EXIT_AUDIT_FAILED);

    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/unresolved local link/);
    expect(result.stderr).toContain('NO-SUCH-FILE.md');
  });

  it('fails closed when a required doc is absent', () => {
    const dir = freshGreenTree();
    rmSync(join(dir, 'README.md'));
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/entry doc missing/);
  });

  it('fails closed when there are no test files to audit', () => {
    const dir = freshGreenTree();
    rmSync(join(dir, 'tests'), { recursive: true });
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/found no test files/);
    expect(result.stderr).toMatch(/inspected nothing cannot pass/);
  });

  it('fails closed when there are no workflow files to audit', () => {
    const dir = freshGreenTree();
    rmSync(join(dir, '.github', 'workflows'), { recursive: true });
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/found no workflow files/);
  });

  it('fails closed when an input cannot be parsed', () => {
    const dir = freshGreenTree();
    writeFileSync(join(dir, 'package.json'), '{ not json');
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/cannot parse package\.json/);
  });

  it('fails closed when the audit document itself is missing', () => {
    const dir = freshGreenTree();
    rmSync(join(dir, 'docs', 'DOCUMENTATION-AUDIT.md'));
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/cannot read docs\/DOCUMENTATION-AUDIT\.md/);
  });

  it('fails closed when the generated-block markers are gone', () => {
    const dir = freshGreenTree();
    writeFileSync(join(dir, 'docs', 'DOCUMENTATION-AUDIT.md'), '# Documentation Audit\n');
    const result = run(dir, '--check');
    expect(result.status).toBe(EXIT_AUDIT_FAILED);
    expect(result.stderr).toMatch(/missing the generated-block markers/);
  });
});
