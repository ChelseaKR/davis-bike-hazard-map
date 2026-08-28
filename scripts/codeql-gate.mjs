#!/usr/bin/env node
/**
 * The CodeQL SAST gate: fail the build on any error-level CodeQL finding.
 *
 * WHY THIS IS A SCRIPT AND NOT A jq ONE-LINER
 * -------------------------------------------
 * The gate used to be this, inline in .github/workflows/codeql.yml:
 *
 *     jq -s '[.[].runs[].results[]? | select(.level == "error")] | length'
 *
 * CodeQL does not put a `level` on a result. Verified against the real SARIF
 * from run 33129762935 (committed, trimmed, as
 * tests/fixtures/codeql/real-codeql-run-33129762935.sarif): both results have
 * no `level` key, so `select(.level == "error")` matched nothing and the count
 * was permanently 0. The step the workflow labelled "this is what actually
 * blocks CI now" could not fail on any input.
 *
 * It was not failing on nothing, either. In that same run one finding resolves
 * to error: js/user-controlled-bypass (security-severity 7.8, CWE-807/CWE-290)
 * at server/app.ts. The gate reported "CodeQL error-level (security) findings:
 * 0" and went green.
 *
 * HOW SEVERITY IS ACTUALLY RESOLVED
 * ---------------------------------
 * SARIF 2.1.0 §3.27.10 makes `result.level` optional and says it is inherited
 * from the reporting descriptor's `defaultConfiguration.level`. CodeQL relies
 * on that inheritance. It also does NOT put its rules in
 * `runs[].tool.driver.rules` (empty in the real run) - they are in
 * `runs[].tool.extensions[].rules`, 201 of them, 74 at level `error`. And it
 * emits no `ruleIndex`, so the lookup has to be by `ruleId`.
 *
 * So: result.level, else the rule's defaultConfiguration.level, else UNKNOWN.
 *
 * FAIL CLOSED
 * -----------
 * A finding whose severity cannot be resolved fails the gate. SARIF's own
 * default for a missing level is "warning", but "I could not work out how bad
 * this is" must never be spelled "pass" in a security gate - that is precisely
 * how the previous version passed. If CodeQL moves its rule table again, this
 * gate goes red and says so instead of quietly grading everything as a warning.
 *
 * ACKNOWLEDGED FINDINGS
 * ---------------------
 * .github/codeql-acknowledged.json lists findings that have been reviewed and
 * accepted, each with a written reason. An acknowledged finding does not fail
 * the gate. The acknowledgement list is itself checked in both directions: an
 * entry that matches nothing in the SARIF fails the gate, so a stale
 * acknowledgement cannot sit there silently widening the hole after the code it
 * covered has changed. Same shape as the guards in workflow-lint.yml.
 *
 * Usage:  node scripts/codeql-gate.mjs <dir-with-sarif-files> [acknowledgements.json]
 * Exit 0 = pass, 1 = fail. Deterministic, dependency-free, offline.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Effective level of a result, or null when it cannot be resolved. */
export function resolveLevel(result, rulesById) {
  if (typeof result.level === 'string' && result.level !== '') return result.level;
  const rule = rulesById.get(result.ruleId);
  const fromRule = rule?.defaultConfiguration?.level;
  if (typeof fromRule === 'string' && fromRule !== '') return fromRule;
  return null;
}

/** Every reporting descriptor in a run, from the driver and every extension. */
export function rulesForRun(run) {
  const rules = new Map();
  for (const rule of run?.tool?.driver?.rules ?? []) if (rule?.id) rules.set(rule.id, rule);
  for (const ext of run?.tool?.extensions ?? []) {
    for (const rule of ext?.rules ?? []) if (rule?.id) rules.set(rule.id, rule);
  }
  return rules;
}

/** First location path of a result, for matching acknowledgements. */
function pathOf(result) {
  return result?.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? '';
}

/**
 * Grade a set of SARIF documents.
 *
 * Returns every finding with its resolved level, plus the problems that must
 * fail the build: unresolvable severities, error-level findings that are not
 * acknowledged, and acknowledgements that matched nothing.
 */
export function gradeSarif(documents, acknowledgements = []) {
  const findings = [];
  for (const doc of documents) {
    for (const run of doc?.runs ?? []) {
      const rules = rulesForRun(run);
      for (const result of run?.results ?? []) {
        findings.push({
          ruleId: result.ruleId ?? '(no ruleId)',
          path: pathOf(result),
          line: result?.locations?.[0]?.physicalLocation?.region?.startLine ?? null,
          level: resolveLevel(result, rules),
          message: result?.message?.text ?? '',
        });
      }
    }
  }

  const used = new Set();
  const matches = (ack, f) => ack.ruleId === f.ruleId && ack.path === f.path;

  const problems = [];
  for (const f of findings) {
    if (f.level === null) {
      problems.push(
        `${f.ruleId} at ${f.path}:${f.line ?? '?'} — severity could not be resolved ` +
          `(no result level, and no rule with this id in the driver or any extension). ` +
          `Failing closed: an unknown severity is not a pass.`,
      );
      continue;
    }
    if (f.level !== 'error') continue;
    const ack = acknowledgements.findIndex((a) => matches(a, f));
    if (ack === -1) {
      problems.push(`${f.ruleId} at ${f.path}:${f.line ?? '?'} — error-level finding. ${f.message}`);
    } else {
      used.add(ack);
    }
  }

  acknowledgements.forEach((ack, i) => {
    if (used.has(i)) return;
    problems.push(
      `stale acknowledgement: ${ack.ruleId} at ${ack.path} matched no error-level finding. ` +
        `The finding is gone or has moved — delete the entry from ` +
        `.github/codeql-acknowledged.json rather than leaving it to widen the gate.`,
    );
  });

  return { findings, problems };
}

/** Read and validate the acknowledgement list. A reason is mandatory. */
export function loadAcknowledgements(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  const entries = parsed?.acknowledged ?? [];
  if (!Array.isArray(entries)) throw new Error(`${path}: "acknowledged" must be an array.`);
  for (const [i, e] of entries.entries()) {
    for (const field of ['ruleId', 'path', 'reason']) {
      if (typeof e?.[field] !== 'string' || e[field].trim() === '') {
        throw new Error(`${path}: acknowledged[${i}] is missing a non-empty "${field}".`);
      }
    }
  }
  return entries;
}

function main(argv) {
  const dir = argv[0];
  const ackPath = argv[1] ?? '.github/codeql-acknowledged.json';
  if (!dir) {
    console.error('usage: codeql-gate.mjs <dir-with-sarif-files> [acknowledgements.json]');
    return 1;
  }
  if (!existsSync(dir)) {
    console.error(
      `::error::No SARIF directory ${dir} — treating as a failure rather than a silent pass.`,
    );
    return 1;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sarif'))
    .sort()
    .map((f) => join(dir, f));
  if (files.length === 0) {
    console.error(
      `::error::No SARIF output in ${dir} — treating as a failure rather than a silent pass.`,
    );
    return 1;
  }

  const documents = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
  const acknowledgements = loadAcknowledgements(ackPath);
  const { findings, problems } = gradeSarif(documents, acknowledgements);

  const byLevel = findings.reduce((acc, f) => {
    const key = f.level ?? 'unresolved';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`CodeQL gate: ${files.length} SARIF file(s), ${findings.length} finding(s).`);
  for (const [level, n] of Object.entries(byLevel).sort()) console.log(`  ${level}: ${n}`);
  if (acknowledgements.length > 0) {
    console.log(`  acknowledged entries: ${acknowledgements.length}`);
  }

  if (problems.length === 0) {
    console.log('CodeQL gate: pass.');
    return 0;
  }
  console.error(`::error::CodeQL gate failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}

// Only run when invoked directly, so the pure functions above stay importable.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
