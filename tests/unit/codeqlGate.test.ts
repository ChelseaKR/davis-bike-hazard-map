/**
 * The CodeQL SAST gate must be able to fail.
 *
 * The gate it replaces could not. It was `jq '… select(.level == "error") …'`
 * over CodeQL SARIF, and CodeQL does not put a `level` on a result — so the
 * count was 0 for every input, and the step the workflow called "this is what
 * actually blocks CI now" went green on anything.
 *
 * The first test here is the regression: it runs the gate over the REAL SARIF
 * from run 33129762935 (trimmed, committed as a fixture) and asserts the gate
 * fails on it, because that run contains one finding that resolves to error.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  gradeSarif,
  loadAcknowledgements,
  resolveLevel,
  rulesForRun,
} from '../../scripts/codeql-gate.mjs';

const REAL = resolve(__dirname, '../fixtures/codeql/real-codeql-run-33129762935.sarif');
const realSarif = () => JSON.parse(readFileSync(REAL, 'utf8'));

/** A SARIF document in CodeQL's actual shape: rules in extensions, no result level. */
function codeqlShaped(rules: { id: string; level?: string }[], results: { ruleId: string; uri: string }[]) {
  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'CodeQL', rules: [] },
          extensions: [
            {
              name: 'codeql/javascript-queries',
              rules: rules.map((r) => ({
                id: r.id,
                ...(r.level ? { defaultConfiguration: { enabled: true, level: r.level } } : {}),
              })),
            },
          ],
        },
        results: results.map((r) => ({
          ruleId: r.ruleId,
          message: { text: 'finding' },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.uri },
                region: { startLine: 1 },
              },
            },
          ],
        })),
      },
    ],
  };
}

describe('the real CodeQL SARIF this gate was passing', () => {
  it('carries no result-level severity at all — which is why the old jq gate was dead', () => {
    const results = realSarif().runs.flatMap((r: { results: unknown[] }) => r.results);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(Object.hasOwn(r as object, 'level')).toBe(false);
    // The old gate, verbatim.
    const oldGateCount = results.filter((r: { level?: string }) => r.level === 'error').length;
    expect(oldGateCount).toBe(0);
  });

  it('puts its rules in tool.extensions, not tool.driver.rules', () => {
    const run = realSarif().runs[0];
    expect(run.tool.driver.rules).toHaveLength(0);
    expect(rulesForRun(run).size).toBeGreaterThan(0);
  });

  it('contains an error-level finding once severity is resolved properly', () => {
    const { findings } = gradeSarif([realSarif()], []);
    const errors = findings.filter((f: { level: string | null }) => f.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].ruleId).toBe('js/user-controlled-bypass');
    expect(errors[0].path).toBe('server/app.ts');
  });

  it('FAILS the gate when nothing is acknowledged', () => {
    const { problems } = gradeSarif([realSarif()], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('js/user-controlled-bypass');
    expect(problems[0]).toContain('error-level finding');
  });

  it('passes once that one finding is acknowledged, and only that one', () => {
    const { problems } = gradeSarif(
      [realSarif()],
      [{ ruleId: 'js/user-controlled-bypass', path: 'server/app.ts', reason: 'reviewed' }],
    );
    expect(problems).toEqual([]);
  });
});

describe('severity resolution', () => {
  it('prefers an explicit result level', () => {
    expect(resolveLevel({ level: 'error', ruleId: 'x' }, new Map())).toBe('error');
  });

  it('falls back to the rule default when the result has none', () => {
    const rules = new Map([['x', { id: 'x', defaultConfiguration: { level: 'error' } }]]);
    expect(resolveLevel({ ruleId: 'x' }, rules)).toBe('error');
  });

  it('returns null when neither is available, rather than assuming a level', () => {
    expect(resolveLevel({ ruleId: 'x' }, new Map())).toBeNull();
  });

  it('reads rules from the driver as well as from extensions', () => {
    const run = {
      tool: {
        driver: { rules: [{ id: 'from-driver' }] },
        extensions: [{ rules: [{ id: 'from-extension' }] }],
      },
    };
    expect([...rulesForRun(run).keys()].sort()).toEqual(['from-driver', 'from-extension']);
  });
});

describe('gradeSarif', () => {
  it('fails on an error-level finding that carries no result level', () => {
    const doc = codeqlShaped(
      [{ id: 'js/sql-injection', level: 'error' }],
      [{ ruleId: 'js/sql-injection', uri: 'server/db.ts' }],
    );
    const { problems } = gradeSarif([doc], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('js/sql-injection');
  });

  it('passes on warning-level findings', () => {
    const doc = codeqlShaped(
      [{ id: 'js/file-system-race', level: 'warning' }],
      [{ ruleId: 'js/file-system-race', uri: 'server/lib/repository.ts' }],
    );
    expect(gradeSarif([doc], []).problems).toEqual([]);
  });

  it('passes on an empty result set', () => {
    expect(gradeSarif([codeqlShaped([], [])], []).problems).toEqual([]);
  });

  it('FAILS CLOSED when a finding has no resolvable severity', () => {
    // No rule with this id anywhere — e.g. CodeQL moves its rule table again.
    const doc = codeqlShaped([], [{ ruleId: 'js/mystery', uri: 'server/app.ts' }]);
    const { problems } = gradeSarif([doc], []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('severity could not be resolved');
    expect(problems[0]).toContain('an unknown severity is not a pass');
  });

  it('an acknowledgement covers only its own rule and path', () => {
    const doc = codeqlShaped(
      [{ id: 'js/a', level: 'error' }, { id: 'js/b', level: 'error' }],
      [
        { ruleId: 'js/a', uri: 'server/app.ts' },
        { ruleId: 'js/b', uri: 'server/app.ts' },
        { ruleId: 'js/a', uri: 'server/other.ts' },
      ],
    );
    const { problems } = gradeSarif([doc], [
      { ruleId: 'js/a', path: 'server/app.ts', reason: 'reviewed' },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems.some((p: string) => p.includes('js/b'))).toBe(true);
    expect(problems.some((p: string) => p.includes('server/other.ts'))).toBe(true);
  });

  it('FAILS on a stale acknowledgement, so the list cannot rot open', () => {
    const doc = codeqlShaped([], []);
    const { problems } = gradeSarif([doc], [
      { ruleId: 'js/gone', path: 'server/removed.ts', reason: 'reviewed' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('stale acknowledgement');
  });

  it('grades every SARIF document it is given, not just the first', () => {
    const clean = codeqlShaped([{ id: 'js/ok', level: 'warning' }], [{ ruleId: 'js/ok', uri: 'a.ts' }]);
    const bad = codeqlShaped([{ id: 'js/bad', level: 'error' }], [{ ruleId: 'js/bad', uri: 'b.ts' }]);
    expect(gradeSarif([clean, bad], []).problems).toHaveLength(1);
  });
});


describe('the committed acknowledgement list', () => {
  const REPO = resolve(__dirname, '../..');
  const ACK = resolve(REPO, '.github/codeql-acknowledged.json');

  it('parses, and every entry carries a non-empty reason', () => {
    const entries = loadAcknowledgements(ACK);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.reason.trim().length).toBeGreaterThan(40);
    }
  });

  it('refuses an entry with no reason rather than accepting a silent waiver', () => {
    const bad = resolve(__dirname, '../fixtures/codeql/acknowledged-missing-reason.json');
    expect(() => loadAcknowledgements(bad)).toThrow(/missing a non-empty "reason"/);
  });

  it('covers the real SARIF exactly: no unacknowledged errors, no stale entries', () => {
    const { problems } = gradeSarif([realSarif()], loadAcknowledgements(ACK));
    expect(problems).toEqual([]);
  });
});

describe('the hand-written declaration file matches the module', () => {
  it('declares every export the module has, and no more', async () => {
    const runtime = Object.keys(
      (await import('../../scripts/codeql-gate.mjs')) as Record<string, unknown>,
    )
      .filter((k) => k !== 'default')
      .sort();
    const declared = readFileSync(resolve(__dirname, '../../scripts/codeql-gate.d.mts'), 'utf8')
      .split('\n')
      .flatMap((line) => {
        const m = /^export function ([A-Za-z0-9_]+)/.exec(line);
        return m ? [m[1]] : [];
      })
      .sort();
    expect(declared).toEqual(runtime);
  });
});

describe('the workflow actually runs this gate', () => {
  const workflow = readFileSync(
    resolve(__dirname, '../../.github/workflows/codeql.yml'),
    'utf8',
  );

  it('invokes scripts/codeql-gate.mjs', () => {
    expect(workflow).toContain('node scripts/codeql-gate.mjs sarif-results');
  });

  it('passes the acknowledgement list, so entries here are the ones in force', () => {
    expect(workflow).toContain('.github/codeql-acknowledged.json');
  });

  it('no longer selects on a result level CodeQL never sets', () => {
    // Comments may quote the dead expression to explain it; executable lines
    // must not reinstate it.
    const executable = workflow
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(executable).not.toContain('.level == "error"');
  });
});
