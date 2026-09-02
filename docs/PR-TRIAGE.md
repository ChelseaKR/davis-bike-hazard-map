# Pull-request triage, 2026-08-28

Triage of the nine open pull requests (#147, #146, #145, #144, #143, #142, #139,
#138, #137) against `origin/main` at `540a5c8`.

Everything below was checked against the repository and the GitHub API rather
than taken from the pull-request descriptions. The final section separates what
was verified by execution from what was reasoned about or taken on trust.

## Group counts

| Group | Count | PRs |
| --- | ---: | --- |
| Merge now | 1 | #147 |
| Merge after one small fix | 1 | #145 |
| Merge after re-running CI, content already correct | 1 | #142 |
| Merge after adding tests, implementation sound | 2 | #138, #139 |
| Rework, real correctness defect | 2 | #137, #146 |
| Merge via the owner's bypass, CI cannot pass by construction | 2 | #143, #144 |
| Auto-closing stack members | 0 | none |
| Superseded or empty | 0 | none |

Six of the nine are blocked by CI, and in **five** of those six the failure has
nothing to do with the change. Only #146 is red for its own reasons.

Merge-state truth, independent of the labels GitHub is showing:

- All nine merge cleanly into `origin/main` **individually**
  (`git merge-tree --write-tree --messages origin/main <head>` exits 0 for
  every one).
- Seven of the nine collide with each other on one generated file. See
  *Non-diff hazards*.

## Per-PR table

| PR | Base | Real merge state | CI classification | Recommendation |
| --- | --- | --- | --- | --- |
| #147 | `main` | CLEAN, verified mergeable | All 12 checks green | **Merge first.** Verified falsifiable end to end. |
| #146 | `main` | UNSTABLE, mergeable but red | **Genuine failure**, and the cause is a design bug | **Do not merge. Rework.** |
| #145 | `main` | CLEAN, verified mergeable | All 11 checks green | **Merge after a one-line fix** (fails open on a malformed 200). |
| #144 | `main` | BLOCKED | **Not its own**: `standards` cannot read a private repo from a Dependabot run | **Merge via the owner's bypass**, but fix the version input first. |
| #143 | `main` | BLOCKED | **Not its own**: same Dependabot secret isolation | **Merge via the owner's bypass.** |
| #142 | `main` | BLOCKED | **Not its own**: stale base, `main` already fixed it | **Re-run checks, then merge.** Content verified correct. |
| #139 | `main` | BLOCKED | **Not its own**: stale base, same fix | **Merge after X**: persist the receipt in Postgres, fix the 404 test. |
| #138 | `main` | BLOCKED | **Not its own**: stale base, same fix | **Merge after X**: the implementation is sound, the wiring is untested. |
| #137 | `main` | BLOCKED | **Not its own**: stale base, same fix | **Rework.** The delta feed cannot report the app's normal removal path. |

No check on any of the nine was **starved** (no zero-step job, no ~3-5 second
run, no budget or spending-limit annotation anywhere in the queue), and none was
**absent**: every one of the seven required contexts reported on every one of
the nine pull requests. Every check completed with `success` or `failure`; there
are no neutral, skipped or cancelled conclusions to explain away.

## There is no stack

Every one of the nine bases directly on `main`. No PR's base is another PR's
head branch, so **nothing in this queue auto-closes** when anything else merges,
and there is no cumulative snapshot stack: no PR's diff is contained in
another's.

```
main (540a5c8)
 |
 +-- #147  ci/required-checks-mean-what-they-say
 +-- #146  ci/codeql-gate-can-fail
 +-- #145  fix/coverage-counts-reports-received
 +-- #144  dependabot/.../trufflehog-3.97.1
 +-- #143  dependabot/.../codeql-action-f442528237
 +-- #142  bugfix/sweep-2026-08-23
 +-- #139  land/exp-08-osm-notes
 +-- #138  land/exp-04-night-weighting
 +-- #137  land/fix-05-updated-since
```

The three `land/*` branches share a naming convention and an open date
(2026-08-22) but are independent siblings, not a stack.

## The CI failures, classified

### Stale base: #142, #139, #138, #137

All four fail exactly one required check, `zizmor (workflow SAST)`, and the
failure is not theirs. The log shows zizmor aborting rather than reporting:

```
fatal: no audit was performed
'impostor-commit' audit failed on file://.github/workflows/release.yml
Caused by:
    2: can't access ChelseaKR/portfolio-standards: missing or you have no access
```

`main` already fixed this in `540a5c8` ("audit every input in two passes, so the
gate can run at all", #141), which landed 2026-08-27T03:49:16Z. The split is
exact, with no exceptions:

| PR | Has `540a5c8` in its merge base | `zizmor (workflow SAST)` |
| --- | --- | --- |
| #147, #146, #145, #144, #143 | yes | pass |
| #142, #139, #138, #137 | **no** | **fail** |

#142's failing run started at 03:48:28Z, 48 seconds before the fix merged.
The other three last ran on 2026-08-22. All four are only **one commit** behind
`origin/main`, and that one commit is the fix.

### Dependabot secret isolation: #143, #144

Both fail the required `standards` check with:

```
repository 'https://github.com/ChelseaKR/portfolio-standards/' not found
```

`.github/workflows/standards.yml` checks out the private sibling repo with
`ssh-key: ${{ secrets.STANDARDS_DEPLOY_KEY }}`. A `pull_request` run raised by
Dependabot does not receive repository secrets, so the key is empty and a
private repo reads as "not found". This is not a defect in either bump, and it
is not fixable by rebasing: it will fail on every Dependabot PR until the
standards check is made to tolerate a missing key or the sibling repo is made
public. #142, which touches nothing relevant and is not from Dependabot, passes
`standards` on the same day.

### Genuine failure: #146

Classified as genuine because the failing job is the one this PR rewrites, and
it fails for a reason the PR introduced. Detail below.

## Dominant-defect findings: tests that pass in both states

### #147 is clean. All four detectors bite.

The headline claim of #147 is that a required status check must name a job that
exists and can fail. That is the kind of claim that is usually asserted and
never tested, so it was falsified directly, by planting each defect in a scratch
worktree at `4b55c21` and re-running
`/Users/chelsea/portfolio/davis-bike-hazard-map/tests/unit/requiredChecks.test.ts`:

| Planted defect | Result |
| --- | --- |
| A required context naming no job (`Ghost Job (renamed away)`) | **caught**, `produces every required context from a job that exists` fails |
| `continue-on-error: true` on the required `lighthouse` job | **caught**, `requires only contexts whose job can actually fail` fails |
| The required-context list emptied | **caught**, the non-emptiness guard fails |
| The required job's body replaced with a single `echo` | **caught**, named as `every step is a no-op` |

The test is not vacuous, and its own inputs are asserted non-empty so a sweep
over nothing cannot report success. `make verify` at `4b55c21` exits 0 with 764
passed and 21 skipped, exactly as the description claims. `make ruleset-check`
runs read-only, exits 0, and confirms the committed mirror currently matches the
live `protect-main` ruleset context for context.

### #146: the test suite is green because the failure branch is unreachable

`/Users/chelsea/portfolio/davis-bike-hazard-map/tests/unit/codeqlGate.test.ts`
passes 23 of 23 while the real job fails. The reason is the shape this triage was
told to hunt: **a candidate set constructed so the failure branch cannot be
reached.**

`.github/workflows/codeql.yml` runs the gate once per matrix language,
`javascript-typescript` and `actions`, each against only its own language's
SARIF, and passes both of them the same shared
`.github/codeql-acknowledged.json`. The gate fails on a "stale" acknowledgement,
meaning one that matches no error-level finding in the SARIF it was handed. An
acknowledgement for a JavaScript finding therefore matches nothing during the
`actions` leg, and fails it, unconditionally and forever.

There is exactly one SARIF fixture in the suite,
`tests/fixtures/codeql/real-codeql-run-33129762935.sarif`, and it is the
JavaScript one, which contains the single acknowledged finding. The suite never
feeds the gate a SARIF from a different language, so the cross-language case
that breaks in production is the one case the fixtures cannot express.

Reproduced locally at `bbcfc36` against a minimal, entirely clean SARIF with zero
results:

```
$ node scripts/codeql-gate.mjs /tmp/sarif-actions .github/codeql-acknowledged.json
CodeQL gate: 1 SARIF file(s), 0 finding(s).
  acknowledged entries: 1
::error::CodeQL gate failed with 1 problem(s):
  - stale acknowledgement: js/user-controlled-bypass at server/app.ts matched no
    error-level finding.
EXIT=1
```

Zero findings, and the gate still fails. The acknowledgement list can never be
non-empty without failing at least one matrix leg.

That is one of the three problems in CI. The other two are real and were not
anticipated by the description:

```
- actions/cache-poisoning/poisonable-step at .github/workflows/release.yml:83 - error-level
- actions/cache-poisoning/poisonable-step at .github/workflows/release.yml:88 - error-level
```

Two genuine error-level `actions` findings that the new gate is correctly
surfacing for the first time. The PR description proves the gate can fail only
against the JavaScript SARIF and never runs the `actions` leg, which is why both
were missed.

`make verify` at `bbcfc36` exits 0 with 779 passed, exactly as claimed. That is
the point: `verify` does not run the CodeQL job, so the offline suite is green
while the gate the PR exists to fix is red.

### #145: correct, well-tested, but it fails open on a malformed response

The counting change itself is right. `areaReportCounts` in
`/Users/chelsea/portfolio/davis-bike-hazard-map/server/lib/hazards.ts` filters
`status !== 'rejected'` over `repo.all()`, which is pending plus approved plus
resolved plus expired: every report received minus rejected, as claimed. No
double counting (`repo.all()` is unique by id, unlike `listPublicFeed`), no
timezone arithmetic anywhere in the path, and the `DAVIS_AREAS` literal moved
from `src/lib/areas.ts` to `shared/areas.ts` **byte-identically**, so client and
server cannot disagree.

Reversion testing: 27 tests collected, 27 pass at head; with the production files
reverted to `540a5c8` and the tests kept, **20 fail and 7 pass**. All 14 of the
dedicated new tests fail on reversion with behavioural assertions, not import
crashes. Targeted mutation of the counted set is caught in 2 of 3 cases.

Of the 7 survivors, 3 are legitimate refactor-safety tests in `areas.test.ts`
whose behaviour genuinely does not change. The other 4, in
`tests/unit/CoverageView.a11y.test.tsx`, are the shape worth naming: the PR
modifies them to stub `fetch`, which makes them look endpoint-driven, but the
mocked coverage response and the `hazards` prop are always given the same
numbers, so they cannot detect which source the component actually read. A
weakness rather than the dominant defect, since the dedicated tests do
discriminate and the description never claims these four fail pre-change.

**The one thing to fix before merging** is in
`/Users/chelsea/portfolio/davis-bike-hazard-map/src/components/CoverageView.tsx`:

```ts
const areas   = normalizeCoverage(received ?? bucketByArea(hazards));
const flagged = received !== null;
```

`fetchCoverage()` destructures `{ areas }` with no runtime validation, so a 200
whose body lacks `areas` yields `undefined`. Since `undefined !== null`, the view
marks the data as authoritative while the numbers actually came from the feed
fallback, and it suppresses the "partial view" banner that exists to say so.
Confirmed with a probe that stubs `fetch` to return `{}`: the banner does not
render and the desert callout is computed from feed data under
reported-counts wording. That is the pre-fix defect reinstated, silently, on the
integrity claim this PR is about. `const flagged = Array.isArray(received);`
closes it.

Three follow-ups, none blocking: swapping `publicLocation` for `preciseLocation`
in the counting line passes all 7 coverage tests, so the fuzzed-coordinate
invariant is documented in four places and gated by nothing; seed rows
(`source: 'seed'`) count as reports received, which silently retires data-desert
warnings on a seeded deployment; and `/api/coverage` has no `NetworkFirst` entry
in `vite.config.ts`, so offline users of an offline-first PWA see "Partial view"
permanently.

### #142 is clean. The test discriminates.

Re-ran
`/Users/chelsea/portfolio/davis-bike-hazard-map/tests/unit/hazardsLib.test.ts`
at `3e97d19` with the production fix reverted to its `55703f3` state and the new
test kept:

```
=== AS SUBMITTED ===            Tests  19 passed (19)
=== FIX REVERTED, TEST KEPT === Tests  1 failed | 18 passed (19)
  × starts empty, logs loudly, and moves the bad file aside instead of
    silently overwriting it
```

The test fails without the fix, so it is testing the fix. The assertion that
carries it is the stderr diagnostic and the preserved `.corrupt-*` copy; the
`expect(await repo.all()).toEqual([])` line on its own would pass in both states,
but it is not the only assertion.

### #138: sound arithmetic, and the production wiring is tested by nothing

This is the cleanest example in the queue of a green suite that would stay green
if the feature were deleted. In
`/Users/chelsea/portfolio/davis-bike-hazard-map/server/app.ts` the whole feature
turns on one line:

```ts
const isDark = isDarkAt(at, DAVIS_LAT, DAVIS_LNG);
```

Replace it with `const isDark = false` and **all 32 tests still pass.** The
feature is inert in production, `plan.nightWeighting` is never emitted, and CI is
green. `tests/unit/serverRouting.test.ts` has a `describe` block named "as wired
in the route handler" and a comment saying it mirrors the planner, but it
re-implements those two lines inline and never calls `buildApp` or
`GET /api/route`. Grepping `nightWeighting` across `tests/` and `src/` returns
zero hits: nothing asserts the field the description calls the honest output.

The twilight threshold is the "bound too far apart to exercise" shape:

| Mutation to `shared/routing.ts` | Result |
| --- | --- |
| `CIVIL_TWILIGHT_ALTITUDE_DEG` from -6 to **0** | 32 of 32 pass |
| `CIVIL_TWILIGHT_ALTITUDE_DEG` from -6 to **-18** | 32 of 32 pass |
| **Delete the NOAA solar-altitude routine** and substitute a crude UTC-hour test | 32 of 32 pass |
| Control: `NIGHT_MULTIPLIERS.poor_visibility` from 2 to 1 | 4 fail, as expected |

The only altitude assertions are "above 0 at noon" (about +30 degrees) and "below
-6 at 23:00" (about -60 degrees), inputs roughly 90 degrees apart on a 180 degree
scale. Nothing comes near the boundary that decides anything.

The implementation itself is correct and was not faulted. `solarAltitudeDeg`
works on the UTC epoch throughout, with no `getHours()` and no local-date
parsing, so timezone and DST are structurally not a problem. The weighting does
change routes: 400 by day against 800 at night straddles a 600 metre detour, so
the day/night divergence test is real. **Add a `/api/route` test through
`buildApp` at an injected dark instant, and one assertion near the actual -6
degree boundary.**

### #137: the delta feed cannot report the app's normal way of removing a hazard

This is the one PR in the queue with a defect serious enough to call rework on
the feature rather than the tests. The description says the delta feed solves the
classic "a poller never removes anything" problem. It does not.

`listUpdatedSince` matches only rows that are approved and unexpired, or
resolved. Tombstones are written by `deleteById` and by nothing else. But TTL
expiry, which is how hazards normally disappear, moves a row to `expired` and
writes no tombstone; so does a moderator rejection. Probed directly against
`buildApp` with a `MemoryRepository`:

```
EXPIRY  (expiresAt in the past)   => {"hazards":[],"deletedIds":[],"serverTime":...}
REJECT  (approved -> rejected)    => {"hazards":[],"deletedIds":[],"serverTime":...}
```

Both removals are invisible. The delta handler literally calls
`await repo.expire(nowMs)`, so it **performs the removal it then fails to
report**. `mergeDelta` in `src/hooks/useHazards.ts` removes only ids present in
`deletedIds`, so a phone left on the 30 second poll keeps showing expired and
moderator-rejected hazards indefinitely. On a hazard map, that is the safety
claim inverted.

A second disagreement: the full feed bounds resolved rows to
`resolvedVisibleDays`, seven days, while the delta returns any row resolved since
the cursor, up to the 30 day tombstone TTL. A poller accumulates resolved
hazards that a fresh page load would never show.

Five separate mutations survive the new `tests/unit/deltaFeed.test.ts`, all with
4 of 4 passing: flipping the `>=` cursor boundary to `>` in both
`listUpdatedSince` and `listTombstones`, removing the bbox filter, **deleting the
entire resolved-rows branch**, and stamping a tombstone 36 days wrong. The
advertised "plus recently resolved rows" half of the feature has no coverage at
all, and the boundary has none in either direction.

The Postgres half is untested in every environment. `server/lib/pgRepository.ts`
gains about 46 lines plus `migrations/0004_delta_feed.sql`, and
`tests/unit/pgRepository.test.ts` is untouched, so even in CI, which does provide
a database, there is nothing new to run. On inspection the two implementations do
agree; nothing enforces it.

### #139: the audit receipt never reaches the database

Network safety is genuinely good, and was checked rather than assumed: no
import-time network, `postOsmNote` short-circuits on disabled config before
touching `fetchImpl`, `osmNotesEnabled` defaults false, failures return
`{delivered: false, error}` rather than throwing, and tests prove the fuzzed
`publicLocation` is sent while `description` and `clientId` are not.

The defect is that the receipt is not persisted. `osmNote` is added to
`StoredHazard`, but `server/lib/pgRepository.ts` has no `osm_note` in `COLUMNS`,
`writeValues`, `rowToHazard` or the `UPDATE ... SET` list, and the PR adds no
migration. `PostgresRepository.update` does read-modify-write through
`writeValues(merged)`, so the receipt is dropped on the way to the database and
is gone on the next read. The route still returns `{result, hazard}`, so the API
looks correct. The test that appears to prove otherwise runs against
`MemoryRepository` and passes identically whether Postgres keeps the receipt or
discards it.

Two smaller things. The one test that survives a full revert of the feature is
`tests/unit/server.test.ts > OSM Notes feedback loop > 404s for an unknown
hazard`: with `server/lib/osmNotes.ts` deleted and the route unmounted it still
passes, because Fastify returns 404 for an unregistered route exactly as for a
missing hazard, and the test asserts only the status code. Asserting
`note.json().error === 'not_found'` kills it. And
`server/config.ts` defaults `osmNotesApiUrl` to the **live production** OSM
endpoint rather than the sandbox, with `deps.fetchImpl ?? fetch` behind it; the
only thing standing between a stray dev or test process and a real write to the
public OSM database is `osmNotesEnabled === false`.

### #144 carries a defect that is not in its diff

The bump is correct as far as it goes, but it walks past a real problem:

```yaml
uses: trufflesecurity/trufflehog@20652fbb...  # v3.97.1
with:
  version: 3.96.0
  extra_args: --only-verified
```

Dependabot updates the `uses:` pin and never the `version:` input. `main` today
already reads `# v3.97.0` with `version: 3.96.0`, so the secret scanner has been
running **3.96.0** regardless of what the pin claims, and merging #144 makes the
gap one version wider. The pin is cosmetic until that input is bumped with it, or
removed so the action uses its own bundled version.

Separately, `--only-verified` limits reporting to secrets TruffleHog could verify
against a live service. That is a deliberate choice, and the job is named for it,
but it does mean the "full history" scan reports a strict subset of what it
finds.

## Non-diff hazards

### The generated doc audit serialises the entire queue

`docs/DOCUMENTATION-AUDIT.md` is generated by `scripts/doc_audit.py`, and
`npm run docs:audit:check` is part of `npm run verify`, which is the merge gate.
**Seven of the nine PRs edit it**: #147, #146, #145, #142, #139, #138, #137.

All seven rewrite the same line, the `Test declarations` count on line 32. So:

- every one of the seven is `MERGEABLE` right now, because `main` has not moved;
- the moment any one of them merges, **the other six become conflicting**;
- and the conflict is in generated output, where hand-resolution is silently
  wrong.

Demonstrated by merging #145 and #139 into a scratch tree and resolving the
conflict by taking one side, which is what a hurried resolution does:

```
hand-resolved:  | Test files | 81 |   | Test declarations | 646 |
regenerated:    | Test files | 83 |   | Test declarations | 662 |
```

Both sides of the conflict are wrong, because the true count is the union and
neither branch knows about the other's tests. Taking either side leaves
`docs:audit:check` failing, which turns `main` red on the next push even though
both PRs were green.

**The only correct resolution is `make docs-audit`, never a hand-merge.** That
step belongs in the merge procedure for every one of the seven after the first.

This report is subject to its own finding. Adding `docs/PR-TRIAGE.md` changes the
hand-authored-doc count from 45 to 46 and the Markdown-file count from 41 to 42,
so `docs:audit:check` fails and, with it, `make verify`. The pull request
carrying this file therefore also carries the regenerated
`docs/DOCUMENTATION-AUDIT.md`, produced by `make docs-audit` and not edited by
hand. It is the eighth member of the conflict set and needs the same treatment in
the same order.

### The rest of the overlaps are safe, and were checked rather than assumed

- **#145 and #139** both append to `src/i18n/locales/en.json` and `es.json`, the
  classic two-appends-one-file hazard. Merged both into a scratch tree: the JSON
  auto-merges, stays valid, and lands on 221 keys (214 + 3 + 4). `npm run
  i18n:gates` passes, `en` and `es` stay key-for-key, `tsc --noEmit` is clean,
  and the full unit suite passes 787 with 21 skipped. No syntax break.
- **#145, #139, #138 and #137** all modify `server/app.ts`. #145 and #139
  auto-merge there cleanly and the combined tree typechecks and tests green.
### Two pairs conflict in real source, not only in the generated file

Beyond the doc audit, which every pair collides on, exactly two pairs conflict in
code:

| Pair | Conflicting source file | Nature |
| --- | --- | --- |
| #138 x #137 | `server/app.ts` | The `import` block. Both edit the same `shared/routing.ts` and `shared/types.ts` import lines. Mechanical to resolve, but it is a real hand-merge. |
| #142 x #137 | `server/lib/repository.ts` | Both change `JsonFileRepository`. #142 rewrites the `load()` catch block; #137 adds delta-feed methods to the same class. |

Every other pair auto-merges in source. Confirmed by sequential squash-merge into
a scratch tree, which is what GitHub actually does, and cross-checked with
`git merge-tree --write-tree --messages` reading only its `CONFLICT` lines. Note
that the informational `Auto-merging <path>` lines that tool also prints are not
conflicts; reading them as conflicts over-reports badly.

- **#146 and #143** both modify `.github/workflows/codeql.yml`. They auto-merge
  cleanly: the merged file keeps #143's new `v4.37.8` pins on all three
  `codeql-action` steps and #146's `node scripts/codeql-gate.mjs` step together.
- **#147's `package-lock.json`** change is a two-line generated edit that adds
  only the root `devDependencies` reference for `yaml`. It needs no new package
  entry because `node_modules/yaml` at `2.9.0` was already in the lock, and
  `2.9.0` satisfies the declared `^2.9.0`. Consistent, not drifted.

### Hazards checked for and not found

- **No CHANGELOG hazard.** No PR in the queue modifies `CHANGELOG.md` at all.
  The single grep hit is a context line inside the generated audit table. Worth
  noting the inverse instead: none of the nine adds a `## [Unreleased]` entry,
  though the repo keeps one.
- **No bypass is removed.** No PR touches `bypass_actors` in any form. The
  committed mirror `docs/ops/branch-ruleset.json` has never carried the field,
  and `scripts/check-branch-ruleset.mjs` in #147 deliberately excludes it from
  both the comparison and the `--write` import, with a comment saying why. Live
  bypass configuration is untouched by this queue.
- **No PR re-introduces a defeated gate shape.** Grepping every diff for added
  `continue-on-error`, echo-only gate bodies, required-check lists and ruleset
  mirrors turns up nothing but #147's own detector text and documentation.

## Safe order of operations

1. **Merge #147 first.** It is green, verified falsifiable, and it is the only
   PR whose value decays if something else lands first: every later merge should
   be gated by a required-check test that is already in `main`.
2. **Re-run checks on #142, #139, #138 and #137.** No rebase and no code change
   is needed. For a `pull_request` event GitHub builds the workflow from the
   merge commit, so a fresh run picks up the fixed `workflow-lint.yml` from the
   base. Confirm each goes green before merging any of them.
3. **After every merge from the set {#147, #146, #145, #142, #139, #138, #137},
   the next one needs `make docs-audit` re-run and the result committed.** Do not
   hand-resolve `docs/DOCUMENTATION-AUDIT.md`. This is the step that turns `main`
   red if it is skipped.
4. **#145 next**, since it is green and independent. Regenerate the doc audit as
   step 3 requires.
5. **#142** once its checks are re-run.
6. **#143 and #144** need the owner's bypass, because the `standards` check
   cannot pass on a Dependabot run by construction. Before merging #144, decide
   what to do about the `version: 3.96.0` input; merging it as-is widens a gap
   that is already there.
7. **#138, then #139**, once their checks are re-run and the missing tests are
   added. #138 is the smallest surface and its implementation is sound; #139
   needs the `osm_note` column and migration first.
8. **#137 last, and only after rework.** It is both the most defective and the
   most conflict-prone: it collides in `server/app.ts` with #138 and in
   `server/lib/repository.ts` with #142, so landing it after both turns two
   conflicts into one rebase. It should not merge until the delta feed can report
   expiry and rejection.
9. **#146 only after rework.** See below.

Every step from 1 onward that merges one of {#147, #146, #145, #142, #139, #138,
#137} needs `make docs-audit` re-run on the next one. That is nine
regenerations across the queue if all of them land, and skipping any one of them
turns `main` red.

## The two that must not merge

### #137, because the feature does not do what it says

Stated plainly: **#137 should not merge.** The delta feed exists so a polling
client converges on the server's state, and it cannot report the app's normal way
of removing a hazard. Expiry and moderator rejection both produce an empty
`deletedIds`, so a phone on the 30 second poll keeps showing hazards that are
gone. It is green on every check it can currently run, and `npm run verify` at
its head exits 0. Neither fact touches the defect, because no test exercises it.

### #146, because its own gate is red and nothing will stop it

Its `mergeStateStatus` is `UNSTABLE` rather than `BLOCKED`, and that is the trap:
neither `Analyze (javascript-typescript)` nor `Analyze (actions)` is a required
context in the ruleset, so GitHub will let this merge with the gate red. Merging
it puts a permanently red CodeQL job on `main`.

Two things must change first:

1. **Scope acknowledgements to a language, or run the gate once over all SARIFs.**
   As written, the stale-acknowledgement guard and the per-language matrix cannot
   both be satisfied. This is a design fix, not a data fix; adding entries will
   not help, because an entry for one language is stale in the other.
2. **Resolve the two `actions/cache-poisoning/poisonable-step` findings** in
   `.github/workflows/release.yml` at lines 83 and 88, by fixing them or by
   acknowledging them with a written reason once (1) makes that possible.

None of this diminishes the finding underneath. The root-cause analysis is
correct and was independently confirmed: CodeQL does not put `level` on a result,
so the old `select(.level == "error")` matched nothing and the gate passed
everything. That part is worth landing. It just is not landable in this shape.


## Corrections to the working assumptions this triage started from

Two things believed at the outset turned out not to hold, and both change
conclusions:

1. **The gate-falsifiability work is not on `main`.** Commits `180501d`,
   `2d5efd9` and `4b55c21` are visible on the local checkout only because the
   working tree sits on the unmerged branch `ci/required-checks-mean-what-they-say`.
   They are pushed to `origin` as a branch and opened as #147, but
   `git merge-base --is-ancestor <sha> origin/main` is false for all three.
   `origin/main` is still `540a5c8`. Every staleness judgement here is measured
   against `origin/main`, never the local checkout.
2. **There is no repository-admin ruleset bypass to protect.** The live
   `protect-main` ruleset (id `18752845`) has exactly one bypass actor, and it is
   not an admin-role entry:

   ```json
   [{ "actor_id": 3114598, "actor_type": "User", "bypass_mode": "pull_request" }]
   ```

   No `RepositoryRole 5`, no `bypass_mode: always`. The practical consequence is
   good news: no PR in this queue removes a bypass, because none of them touches
   bypass configuration at all. It is worth knowing that the surviving bypass is
   `pull_request` mode for a single user, which is what makes the #143 and #144
   recommendation workable.

3. **Two files that look new are not.** `tests/unit/routing.test.ts` and
   `tests/unit/serverRouting.test.ts` show in #138's file list as pure additions,
   which reads as new files. Both already exist on `origin/main`; #138 appends to
   them. Only `tests/unit/deltaFeed.test.ts` and `tests/unit/osmNotes.test.ts`
   are genuinely new in this queue.
4. **Two PR descriptions overstate their test counts.** #137 and #138 both claim
   792 tests pass. Measured at their own heads: #137 is 760 passed with 21
   skipped, #138 is 762 passed with 21 skipped. #139's claim is accurate. All
   three exit 0, so the gate result is honest even where the number is not.

Also worth recording, since it bears on merge order: the ruleset's
`strict_required_status_checks_policy` is **false**. Branches do not have to be
up to date before merging, so nothing in this queue needs a rebase purely to
satisfy the gate.

## What was verified, and what was taken on trust

### Verified by execution

- **Every merge state.** `git merge-tree --write-tree --messages origin/main <head>`
  run for all nine heads; all exit 0.
- **Every failing check's annotation and log**, pulled via
  `gh api .../check-runs/<id>/annotations` and `gh run view <id> --log`, not read
  off the conclusion.
- **The stale-base split.** `git merge-base --is-ancestor 540a5c8 <head>` for all
  nine; the four that lack it are exactly the four whose `zizmor` check fails.
- **#147's falsifiability**, by planting four separate defects and confirming
  each is caught. `make verify` at `4b55c21` run to completion: exit 0, 764
  passed, 21 skipped, matching the description exactly.
- **`make ruleset-check`**, run read-only: exit 0, mirror matches the live rule
  context for context.
- **The live ruleset contents**, by read-only `GET /repos/.../rulesets/18752845`.
- **#146's cross-language acknowledgement bug**, reproduced locally by running
  `scripts/codeql-gate.mjs` against a hand-built zero-result SARIF with the
  committed acknowledgement list. Exit 1 on zero findings.
- **#146's `make verify`**: exit 0, 779 passed, matching the description, which
  is precisely why the offline suite did not catch the defect.
- **#142's test discrimination**, by reverting the production fix and confirming
  the new test fails.
- **#145's counting logic, reversion behaviour and mutation coverage**, and the
  fail-open probe against a malformed 200.
- **#138's dead wiring**, by hardcoding `isDark = false` and watching all 32
  tests still pass; and the twilight threshold, by moving it to 0 and to -18 and
  by deleting the NOAA routine entirely, each with no test noticing.
- **#137's blind spots**, by probing `buildApp` with a `MemoryRepository` and
  observing that an expired and a rejected hazard both produce empty
  `deletedIds`; and by five surviving mutations of `listUpdatedSince` and
  `listTombstones`.
- **#139's dropped receipt**, by inspecting `COLUMNS`, `writeValues`,
  `rowToHazard` and the `UPDATE` list in `server/lib/pgRepository.ts` for
  `osm_note` and finding none, with no migration in the diff.
- **#139's surviving 404 test**, by deleting `server/lib/osmNotes.ts`, reverting
  `server/app.ts`, confirming the route is unmounted, and watching the test pass.
- **`npm run verify` at all three `land/*` heads**: exit 0 for each, at 760, 762
  and 771 passed respectively.
- **That this queue contains no cumulative snapshot stack**, by ancestry checks
  over all six ordered pairs, three distinct patch-ids, and per-file hunk
  comparison on the shared `server/app.ts`.
- **The doc-audit collision**, by merging #147 then #145, and #145 then #139, in
  scratch trees; and by showing that a hand-resolved conflict yields 81/646 where
  regeneration yields 83/662.
- **The #145 + #139 combination**: locale JSON stays valid at 221 keys,
  `i18n:gates` passes, `tsc --noEmit` clean, 787 tests pass.
- **The #146 + #143 combination** on `codeql.yml`: auto-merges, keeps both the
  new pins and the new gate step.
- **Both Dependabot pins**, dereferenced against the upstream tag objects:
  `v4.37.8` resolves to `db488dde`, `v3.97.1` resolves to `20652fbb`. Both
  genuine.
- **The absence of a pre-push gate.** `.husky/pre-push` does not exist, so the
  husky dispatcher exits 0. Only `pre-commit` is wired, and it touches
  `*.{ts,tsx,js,mjs}` only.
- **That this report's own file breaks `docs:audit:check`**, and that
  `make docs-audit` fixes it.

### Reasoned from the code and configuration, not executed

- **That re-running the checks on #142, #139, #138 and #137 is sufficient**, with
  no rebase. This follows from the workflow file for a `pull_request` event being
  taken from the merge commit, so the fixed `workflow-lint.yml` in the base is
  picked up on a fresh run; from the job name `zizmor (workflow SAST)` being
  unchanged across `540a5c8`, so the required context is not orphaned; and from
  the `pull_request` trigger carrying no path filter. It was not demonstrated,
  because re-running a check is a write and this triage was read-only. There are
  no post-`540a5c8` runs on those branches to observe.
- **That the #143 and #144 `standards` failure is Dependabot secret isolation.**
  The workflow demonstrably requires `secrets.STANDARDS_DEPLOY_KEY`, the two
  failing PRs are the only Dependabot PRs, and non-Dependabot PRs pass the same
  check on the same days. The mechanism was not reproduced by triggering a run.

### Taken on trust

- **That the two `actions/cache-poisoning/poisonable-step` findings in
  `release.yml` are true positives.** CodeQL's judgement is reported as-is; the
  release workflow's checkout of `needs.authorize.outputs.release-commit` was not
  independently analysed for exploitability.
- **The contents of the private `ChelseaKR/portfolio-standards`**, which is
  unreadable from here. What the `standards` check would say on a run that could
  fetch it is unknown.
- **Anything behind the Postgres integration suite.** It is skipped without
  `TEST_DATABASE_URL`, so no result in this report exercises the production store
  adapter. This matters most for #137 and #139, whose Postgres defects were found
  by reading `server/lib/pgRepository.ts` rather than by running it. The reading
  is unambiguous in both cases, but it is reading.
- **The GitHub-reported check conclusions for jobs whose logs have expired or
  were not fetched**, specifically the passing checks. Failing and neutral checks
  were all inspected; passing ones were trusted.
