/**
 * Guard: a required status check must name a job that exists and can fail.
 *
 * A required status check is only a gate if the context name configured in the
 * `protect-main` ruleset corresponds to a job that actually runs on a pull
 * request and is capable of reporting failure. Two shapes break that, and both
 * are silent:
 *
 *  (a) the ruleset requires a context no workflow ever produces — a renamed
 *      job, a dropped matrix leg, a typo. The context is never reported, so
 *      either every pull request is unmergeable forever, or (with the check
 *      configured loosely) the protection simply is not there;
 *  (b) a job produces the context but cannot fail — a job-level
 *      `continue-on-error: true`, or a body of `echo` steps. The context goes
 *      green whatever the code does. The sibling repo shipped exactly this:
 *      "five required status checks were satisfied by an echo" (a9b2875).
 *
 * The required names are read from `docs/ops/branch-ruleset.json`, the
 * committed mirror of the live ruleset. They are deliberately NOT read from
 * the GitHub API here: a test that reaches the network passes vacuously the
 * moment `gh` is absent or unauthenticated, which is the failure mode this
 * whole file exists to eliminate. Reconciling the mirror against the live
 * ruleset is a separate, explicitly-run target that fails loudly when it
 * cannot reach GitHub:
 *
 *     make ruleset-check        # or: npm run ruleset:check
 *
 * What this guard does NOT model, stated so nobody reads more into a green
 * run than is there: step-level `if:` conditions (a step that skips itself on
 * every real run still counts as substantive work); the body of a
 * reusable-workflow call, which lives in another repository and is taken on
 * trust as able to fail; and `matrix.include`/`exclude`. The last of those is
 * not silently ignored — the expander refuses to guess and fails instead.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

// import.meta.url is an http: URL under jsdom, so resolve from cwd instead
// (the same approach as pushSw.test.ts). Vitest runs with cwd at the repo root.
const ROOT = process.cwd();
const RULESET_PATH = join(ROOT, 'docs', 'ops', 'branch-ruleset.json');
const WORKFLOW_DIR = join(ROOT, '.github', 'workflows');

type Yaml = Record<string, any>;

interface ProducedCheck {
  /** The status-check context GitHub reports for this job. */
  name: string;
  workflowFile: string;
  jobId: string;
  /** False when no outcome of the job can turn the context red. */
  canFail: boolean;
  cannotFailReason: string;
  /** Empty string when the context reports on every pull request into main. */
  pullRequestProblem: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Required context names from the committed ruleset mirror.
 *
 * Structural absence throws (a mirror without a `required_status_checks` rule
 * is a broken input, not an empty gate). An empty context list returns empty,
 * so the emptiness assertion below is the thing that reports it.
 */
function readRequiredContexts(): string[] {
  const ruleset = JSON.parse(readFileSync(RULESET_PATH, 'utf8')) as Yaml;
  const rules: Yaml[] = Array.isArray(ruleset.rules) ? ruleset.rules : [];
  const rule = rules.find((r) => r?.type === 'required_status_checks');
  if (!rule) {
    throw new Error(
      `${RULESET_PATH} has no required_status_checks rule. Either the mirror is ` +
        'broken or main is no longer gated on status checks; both need a human.',
    );
  }
  const contexts: Yaml[] = Array.isArray(rule.parameters?.required_status_checks)
    ? rule.parameters.required_status_checks
    : [];
  return contexts.map((c) => String(c?.context));
}

function readWorkflows(): { file: string; doc: Yaml }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .map((file) => ({
      file,
      doc: (parse(readFileSync(join(WORKFLOW_DIR, file), 'utf8')) ?? {}) as Yaml,
    }));
}

// ---------------------------------------------------------------------------
// Deriving the check names a workflow actually produces
// ---------------------------------------------------------------------------

const MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

/**
 * Every matrix leg of a job, as an ordered map of variable to value. A job
 * with no matrix has exactly one leg, the empty one.
 */
function matrixLegs(job: Yaml, where: string): Map<string, string>[] {
  const matrix = job?.strategy?.matrix;
  if (!matrix || typeof matrix !== 'object') return [new Map()];

  // GitHub merges `include` into matching legs and appends the rest, and
  // `exclude` removes legs. Modelling that wrong would invent or hide check
  // names, so refuse rather than approximate.
  for (const unsupported of ['include', 'exclude']) {
    if (unsupported in matrix) {
      throw new Error(
        `${where} uses matrix.${unsupported}, which this guard does not model. ` +
          'Teach checkNamesFor() the semantics before landing that matrix.',
      );
    }
  }

  let legs: Map<string, string>[] = [new Map()];
  for (const [key, values] of Object.entries(matrix)) {
    if (!Array.isArray(values)) continue;
    legs = legs.flatMap((leg) =>
      values.map((value) => new Map(leg).set(key, String(value))),
    );
  }
  return legs;
}

/** The status-check contexts a single job reports, one per matrix leg. */
function checkNamesFor(jobId: string, job: Yaml, where: string): string[] {
  const legs = matrixLegs(job, where);
  const declared = typeof job?.name === 'string' ? job.name : null;

  return legs.map((leg) => {
    if (declared !== null) {
      return declared.replace(MATRIX_REF, (whole, key: string) =>
        leg.has(key) ? leg.get(key)! : whole,
      );
    }
    // No `name:`. GitHub falls back to the job id, suffixed with the matrix
    // values in declaration order.
    return leg.size === 0
      ? jobId
      : `${jobId} (${[...leg.values()].join(', ')})`;
  });
}

// ---------------------------------------------------------------------------
// Can the job fail?
// ---------------------------------------------------------------------------

/** A step whose outcome cannot turn the job red. */
function isNoOpStep(step: Yaml): boolean {
  if (step?.['continue-on-error'] === true) return true;
  // Any action invocation is real work that can fail.
  if (typeof step?.uses === 'string') return false;
  if (typeof step?.run !== 'string') return true;
  const lines = step.run
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line !== '' && !line.startsWith('#'));
  if (lines.length === 0) return true;
  return lines.every((line: string) => /^(echo\b.*|true|:|exit 0)$/.test(line));
}

function whyItCannotFail(job: Yaml): string {
  if (job?.['continue-on-error'] === true) {
    return 'the job sets continue-on-error: true, so its context is green whatever happens';
  }
  // A reusable-workflow call. Its body is not in this repo, so its steps
  // cannot be inspected, but the call itself fails when the called workflow
  // does. See the header note on what this guard does not model.
  if (typeof job?.uses === 'string') return '';
  const steps: Yaml[] = Array.isArray(job?.steps) ? job.steps : [];
  if (steps.length === 0) return 'the job has no steps';
  if (steps.every(isNoOpStep)) {
    return 'every step is a no-op (echo/true/:/exit 0) or continue-on-error, so nothing in the job can fail';
  }
  return '';
}

// ---------------------------------------------------------------------------
// Does the context report on a pull request into main?
// ---------------------------------------------------------------------------

const MAIN_GLOBS = new Set(['main', '*', '**']);

/**
 * Empty string when this workflow reports on every pull request into main.
 * Otherwise the reason it does not, which for a required context is a defect:
 * a context that never reports leaves pull requests permanently unmergeable.
 */
function pullRequestProblem(doc: Yaml): string {
  const on = doc?.on;
  if (on === 'pull_request') return '';
  if (Array.isArray(on)) {
    return on.includes('pull_request')
      ? ''
      : 'the workflow has no pull_request trigger';
  }
  if (!on || typeof on !== 'object' || !('pull_request' in on)) {
    return 'the workflow has no pull_request trigger, so the context never reports on a pull request';
  }

  const pr = on.pull_request;
  // `pull_request:` with nothing under it means every branch, no path filter.
  if (!pr || typeof pr !== 'object') return '';

  if (Array.isArray(pr.paths) || Array.isArray(pr['paths-ignore'])) {
    return 'the pull_request trigger is path-filtered, so the context does not report on pull requests that touch nothing matching';
  }
  if (Array.isArray(pr.branches) && !pr.branches.some((b: string) => MAIN_GLOBS.has(b))) {
    return `the pull_request trigger only covers ${JSON.stringify(pr.branches)}, not main`;
  }
  if (Array.isArray(pr['branches-ignore']) && pr['branches-ignore'].some((b: string) => MAIN_GLOBS.has(b))) {
    return `the pull_request trigger ignores ${JSON.stringify(pr['branches-ignore'])}, which covers main`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Assembly and matching
// ---------------------------------------------------------------------------

function producedChecks(workflows: { file: string; doc: Yaml }[]): ProducedCheck[] {
  const produced: ProducedCheck[] = [];
  for (const { file, doc } of workflows) {
    const jobs = doc?.jobs;
    if (!jobs || typeof jobs !== 'object') continue;
    const prProblem = pullRequestProblem(doc);
    for (const [jobId, job] of Object.entries(jobs as Record<string, Yaml>)) {
      const where = `${file}:jobs.${jobId}`;
      const reason = whyItCannotFail(job);
      for (const name of checkNamesFor(jobId, job, where)) {
        produced.push({
          name,
          workflowFile: file,
          jobId,
          canFail: reason === '',
          cannotFailReason: reason,
          pullRequestProblem: prProblem,
        });
      }
    }
  }
  return produced;
}

/** Required contexts that no job in the tree produces. */
function unmatchedContexts(required: string[], produced: ProducedCheck[]): string[] {
  const names = new Set(produced.map((p) => p.name));
  return required.filter((context) => !names.has(context));
}

const requiredContexts = readRequiredContexts();
const workflows = readWorkflows();
const produced = producedChecks(workflows);
const producersOf = (context: string) => produced.filter((p) => p.name === context);

describe('required status checks name jobs that exist and can fail', () => {
  // --- the guard's own inputs, so it cannot pass by checking nothing --------

  it('reads a non-empty list of required contexts from the committed ruleset', () => {
    expect(
      requiredContexts,
      `${RULESET_PATH} lists no required status checks. Either main is ungated ` +
        'or the mirror has drifted; run `make ruleset-check`.',
    ).not.toHaveLength(0);
  });

  it('enumerates a non-empty set of workflow files', () => {
    expect(
      workflows.map((w) => w.file),
      `no workflow files were read from ${WORKFLOW_DIR}; this guard would pass ` +
        'without checking anything',
    ).not.toHaveLength(0);
  });

  it('derives a non-empty set of check names from those workflows', () => {
    expect(
      produced.map((p) => p.name),
      'no jobs were parsed out of the workflow files; this guard would pass ' +
        'without checking anything',
    ).not.toHaveLength(0);
  });

  // --- the guard itself -----------------------------------------------------

  it('produces every required context from a job that exists', () => {
    const missing = unmatchedContexts(requiredContexts, produced);
    expect(
      missing,
      `these required status checks name no job in .github/workflows, so they ` +
        `can never report:\n  ${missing.join('\n  ')}\n` +
        `Known check names:\n  ${[...new Set(produced.map((p) => p.name))].sort().join('\n  ')}`,
    ).toEqual([]);
  });

  it('reports a required context that names no job (proves the matcher is not inert)', () => {
    expect(unmatchedContexts(['No Such Job'], produced)).toEqual(['No Such Job']);
  });

  it('requires only contexts whose job can actually fail', () => {
    const toothless = requiredContexts.flatMap((context) =>
      producersOf(context)
        .filter((p) => !p.canFail)
        .map((p) => `${context} (${p.workflowFile}:jobs.${p.jobId}) — ${p.cannotFailReason}`),
    );
    expect(
      toothless,
      `these required status checks are satisfied by a job that cannot fail:\n  ${toothless.join('\n  ')}`,
    ).toEqual([]);
  });

  it('detects a job that cannot fail (proves that detector is not inert)', () => {
    // The nightly WebKit job is deliberately advisory: `continue-on-error: true`.
    // It is the repo's own worked example of a job that must never be required.
    const webkit = producersOf('End-to-end (WebKit, non-blocking)');
    expect(webkit, 'the advisory WebKit job was not found; update this control').toHaveLength(1);
    expect(webkit[0]!.canFail).toBe(false);
    expect(requiredContexts).not.toContain('End-to-end (WebKit, non-blocking)');
  });

  it('requires only contexts that report on every pull request into main', () => {
    const unreported = requiredContexts.flatMap((context) =>
      producersOf(context)
        .filter((p) => p.pullRequestProblem !== '')
        .map((p) => `${context} (${p.workflowFile}) — ${p.pullRequestProblem}`),
    );
    expect(
      unreported,
      `these required status checks cannot report on a pull request into main, ` +
        `which leaves pull requests unmergeable:\n  ${unreported.join('\n  ')}`,
    ).toEqual([]);
  });
});
