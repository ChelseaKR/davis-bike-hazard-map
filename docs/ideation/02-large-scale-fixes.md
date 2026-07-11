# Large-scale fixes — 2026-07-01

Deep structural fixes surfaced by the code read in
[`01-deep-dive.md`](./01-deep-dive.md). None of these restate R1–R12 from
`RESEARCH-ROADMAP.md` (branch `research-panel-and-roadmap`) or ROADMAP.md
items; where one builds on an existing ID it says so. Effort tiers:
**S** ≈ hours · **M** ≈ 1–3 days · **L** ≈ a week · **XL** ≈ multi-week.

---

## FIX-01 — Remove the deletion-capability leak from the public feed
**Status: DONE (2026-07-02; the code fix landed on `main` via #41's WIP
commit, the audit trail below completes it)** — `clientId` dropped from
`toPublic()` (`server/lib/hazards.ts`) and the public `Hazard` interface
(`shared/types.ts`); merge-blocking regression test "never leaks the reporter
clientId in any unauthenticated response (FIX-01)" in
`tests/unit/server.test.ts`; recorded as R8 in `docs/audits/residual-risk.md`,
including the residual: clientIds published by any pre-fix deployment remain
valid deletion proofs until rotated — see R8 for operator guidance.

**Pitch:** stop publishing `clientId` — currently anyone can delete anyone's report.

- **Why it matters:** `toPublic()` (`server/lib/hazards.ts:143`) puts
  `clientId` into every hazard returned by `GET /api/hazards`, and
  `DELETE /api/reports/:clientId` (`server/app.ts:404-414`) uses that same id
  as the ownership proof. A hostile actor (the research pass's P14 adversary)
  can silently erase the whole map — worse than spam, because deletion is
  invisible. Verified that nothing in `src/` needs other hazards' `clientId`.
- **Shape of work:** drop `clientId` from the `Hazard` public interface
  (`shared/types.ts:149-171`) and `toPublic()`; keep it in `StoredHazard`.
  Audit every projection for other capability-ish fields. `MyReports`
  (`src/components/MyReports.tsx`) already works from the local IndexedDB
  queue, so client changes are minimal. Add a regression test asserting the
  feed and export never contain `clientId` (extend the existing
  PII-in-export schema test pattern).
- **Effort:** S. **Risks/deps:** none — do first, before any wider beta.
- **Excellent looks like:** a merge-blocking test proving no capability field
  appears in any unauthenticated response; a short entry in
  `docs/audits/residual-risk.md` recording the find and fix (honesty ethos:
  report it, don't bury it).

## FIX-02 — Harden the inbound 311 webhook (HMAC, replay, hand-off check)
**Pitch:** make `POST /api/handoff/webhook` cryptographically bound to its body and unable to resolve hazards never handed off.

- **Why it matters:** today the webhook compares the `x-gogov-signature`
  header to the *raw static secret* (`server/app.ts:611`) — any observer of
  one request can forge all future ones — and it skips the
  `hazard.handoff` existence check the sync route enforces
  (`app.ts:585-587` vs `605-623`), so a secret holder can resolve arbitrary
  hazards. "The city marked it fixed" is the product's highest-trust claim;
  its ingress must be its best-defended one. Complements (does not repeat)
  R3, which is about *outbound* receipts/retry.
- **Shape of work:** in `app.ts` + a new `server/lib/webhookAuth.ts`:
  HMAC-SHA256 of the raw body with the shared secret, a signed timestamp with
  a tolerance window, a seen-nonce (or reference+timestamp) replay cache, and
  a 409 for hazards without a `handoff` record. Document the contract in
  `server/openapi.ts` so a future GOGov shim implements it correctly.
- **Effort:** M. **Risks/deps:** the real GOGov side may not support HMAC —
  then keep the static secret as a *documented downgrade* behind a config
  flag, stated in `residual-risk.md`, rather than pretending. Gate: city
  integration conversation.
- **Excellent looks like:** unit tests for forged-body, replayed, stale, and
  never-handed-off requests all rejected; the threat-model row for 311
  ingress updated from implicit to explicit.

## FIX-03 — Photo-blob retention & garbage collection
**Pitch:** delete photo bytes when a hazard leaves the actionable state, on a defined schedule.

- **Why it matters:** rejected photos are the ones most likely to contain
  faces/plates (that's often *why* they were rejected), yet
  `moderateHazard()` (`server/lib/hazards.ts:78-105`) never calls
  `photos.delete()`; neither does `repo.expire()`. Only reporter
  self-deletion removes blobs (`app.ts:410-413`). The location-coarsening
  discipline applied at every terminal state has no photo equivalent —
  an inconsistency in an otherwise excellent retention story.
- **Shape of work:** a retention sweep alongside the existing lazy-expiry
  pattern (or the backup timer in `server/index.ts`): delete `photos.get(id)`
  + thumb for `rejected` immediately, for `expired`/`resolved` after
  `RESOLVED_VISIBLE_DAYS`-aligned grace; add photo bytes to the data
  inventory in `docs/audits/privacy-notes.md`; note the 1-hour public cache
  (`app.ts:493` `max-age=3600`) as the residual window after deletion.
- **Effort:** M. **Risks/deps:** must not race the moderation queue's inline
  photo read (see FIX-04); S3 store deletion is already abstracted
  (`server/lib/photoStore.ts`).
- **Excellent looks like:** a stated, tested retention table
  (state × asset × TTL) in privacy-notes.md, with a test that a rejected
  hazard's blob is gone after the sweep.

## FIX-04 — Query pushdown + moderation queue pagination + photos by reference
**Pitch:** make the read paths scale past beta volume instead of loading everything into process memory.

- **Why it matters:** category/severity/`withinDays` filters run in JS after
  the store returns all active rows (`server/app.ts:356-367`);
  `listModerationQueue` calls `repo.all()` and inlines every pending photo as
  a base64 data URL in a single response (`server/lib/hazards.ts:204-213`) —
  a 50-report spam burst at ~3 MB/photo is a ~200 MB response that arrives
  exactly when the moderator most needs the queue (the R6 scenario). The
  route planner also re-reads the full active set per request
  (`app.ts:449`).
- **Shape of work:** extend the `Repository` interface
  (`server/lib/repository.ts:27-51`) with filtered/paged reads
  (`listActive(now, {bbox, categories, minSeverity, since, limit, cursor})`,
  `listPending(limit, cursor)`); implement as SQL in `pgRepository.ts` and
  trivially in the memory store; replace the moderation queue's inline data
  URLs with an auth-gated pending-photo route (extend
  `GET /api/photos/:id` with a moderator branch) so photos stream on demand.
- **Effort:** L. **Risks/deps:** touches the interface all three stores
  implement — lean on the existing Postgres integration suite
  (`tests/unit/pgRepository.test.ts`); coordinate with FIX-03's deletion
  sweep.
- **Excellent looks like:** queue endpoint payload independent of queue
  depth; a load test (new) showing p95 for `/api/hazards` and
  `/api/moderation/queue` flat from 100 to 10,000 hazards.

## FIX-05 — Delta feed for mobile data
**Pitch:** an `updatedSince` cursor so the 30-second poll ships only what changed.

- **Why it matters:** the feed's conditional-request story is a SHA-1 ETag of
  the *fully serialized* body (`app.ts:371-380`) — a correct but all-or-
  nothing optimization: any single change re-sends the entire feed, and the
  server still does the full query+serialize per poll. "Usable on mobile
  data" is a stated guardrail (README "For Claude Code"); the sync loop and
  `useHazards` already reconcile state, so the client is delta-ready in
  spirit.
- **Shape of work:** add `updatedSince` to `hazardFiltersSchema`
  (`shared/validation.ts:78-83`), push it down via FIX-04's repository
  filters (rows are already `updatedAt`-indexed in intent —
  `migrations/0001_init.sql` would gain an index), return
  `{changed, deletedIds, serverTime}`; client merges in
  `src/hooks/useHazards.ts`. Deletions need a tombstone or a
  `deleted_at` column — small migration.
- **Effort:** M (after FIX-04). **Risks/deps:** tombstones interact with
  reporter deletion (FIX-01/privacy): tombstones must carry ids only, no
  content. Depends on FIX-04.
- **Excellent looks like:** steady-state poll traffic measured (Playwright or
  a scripted client) at <1 KB when nothing changed, with correctness proven
  by a sync-reconciliation test.

## FIX-06 — OpenAPI generated from the zod schemas + contract test
**Pitch:** make the spec un-driftable by deriving it from `shared/validation.ts` and testing it against the live routes.

- **Why it matters:** `server/openapi.ts` (171 lines) is hand-maintained
  parallel truth. The repo's ethos is verifiability; an unverified spec is a
  promise the CI doesn't check. E6/E9 (city export, embeds) and any future
  external consumer make the spec load-bearing.
- **Shape of work:** adopt `zod-openapi` (or `@asteasolutions/zod-to-openapi`)
  over the existing schemas; a CI contract test that (a) every route
  registered in `buildApp` appears in the spec, and (b) `app.inject()`
  responses for a golden set validate against the spec's response schemas.
- **Effort:** M. **Risks/deps:** zod v3 (`package.json`) vs library
  compatibility; keep the current file as the fallback if generation fights
  the `/api/v1` rewrite trick (`app.ts:119-122`).
- **Excellent looks like:** deleting a route or changing a schema fails CI
  until the spec matches; spec published as a build artifact.

## FIX-07 — Multi-instance-safe auth throttling (and bound the failure map)
**Pitch:** login lockout and rate limits that survive `fly scale count 2`.

- **Status:** ✅ DONE (S + doc branch) — the failure map is bounded and
  self-pruning (`server/lib/loginThrottle.ts`, LRU cap 10k + lazy expiry +
  opportunistic sweep; unit-tested in `tests/unit/loginThrottle.test.ts`,
  including the 10k-spray bound), locked accounts survive cap eviction, and
  "single instance only" is documented as a hard operational constraint in
  the README runbook. The shared-store (`auth_throttle` table) path remains
  the prerequisite for scaling out.
- **Why it matters:** `loginFailures` is an unbounded per-process `Map`
  (`server/app.ts:213-215`) — an attacker spraying random usernames grows it
  forever (slow memory leak), and both lockout and `@fastify/rate-limit`
  counters silently become per-instance the day the app scales, weakening
  R4/R5 mitigations documented in `docs/audits/residual-risk.md` without
  anyone deciding that.
- **Shape of work:** bound the map (LRU + periodic sweep of expired
  entries) now — S; then either move counters to Postgres (a tiny
  `auth_throttle` table; the pool exists) or document "single instance only"
  as a hard operational constraint in README's runbook the way the JSON
  store's single-process constraint already is.
- **Effort:** S (bound) + M (shared store). **Risks/deps:** none; pairs with
  FIX-13's philosophy of enforcing documented constraints in code.
- **Excellent looks like:** a test that 10k distinct failed usernames don't
  grow memory unboundedly; lockout proven effective across two app instances
  in the compose stack (`docker-compose.yml`).

## FIX-08 — URL/navigation state: permalinks, history, deep links
**Pitch:** give tabs, filters, and individual hazards real URLs.

- **Why it matters:** all view state is in-memory
  (`src/hooks/useViewState.ts`); the back button does nothing (an
  accessibility and basic-web-expectations failure the axe gates can't see),
  hazards can't be shared or referenced from a 311 email or council agenda,
  and the push payload can only open `'/'`
  (`server/lib/pushNotify.ts:36`) — which will blunt R11 (push delivery)
  when it lands. Advocacy expansions (E9) and EXP-01/EXP-03 here all want
  addressable hazards.
- **Shape of work:** reflect `useViewState` into
  `location.hash`/`history` (no need for a router dependency — the reducer
  seam in `useViewState.ts` is the right place); add
  `/#/hazard/:id` resolution to focus-on-map; update
  `buildAlertPayload().url`; extend the e2e suite with back/forward and
  deep-link cases; confirm the service worker navigation fallback
  (`vite.config.ts` PWA config) handles hash routes (it should — verify,
  don't assume).
- **Effort:** M. **Risks/deps:** none hard; touches files the research branch
  also touches (see FIX-14 — sequence after the merge).
- **Excellent looks like:** any hazard, tab, and filter combination is a
  copy-pasteable URL; back button behaves; a Playwright test opens a hazard
  permalink cold and lands focused on it in both map and list.

## FIX-09 — Explicit status-transition state machine
**Status: DONE (2026-07-02)** — `shared/statusMachine.ts` holds the
legal-transition table (`LEGAL_TRANSITIONS`), `canTransition(from, to, cause)`
and the `transition()` patch helper; `moderateHazard`/`confirmHazard`
(`server/lib/hazards.ts`), `applyHandoffStatus` (`server/lib/lifecycle.ts` —
closes the webhook-resolves-rejected hole) and `MemoryRepository.expire()` all
route through it (the Postgres `expire()` predicate mirrors the table);
exhaustive (from, to, cause) unit tests + fast-check property tests over
arbitrary operation sequences in `tests/unit/statusMachine.test.ts`.

**Pitch:** one module that says which `HazardStatus` transitions are legal, enforced everywhere state changes.

- **Why it matters:** transitions are currently implied by call sites —
  `moderateHazard` (`server/lib/hazards.ts:78-105`), `applyHandoffStatus`
  (`server/lib/lifecycle.ts:47-73`), `repo.expire()`, and raw `repo.update()`
  patches. Nothing prevents a webhook resolving a `rejected` hazard, a
  confirm racing an expiry, or a future contributor approving a `resolved`
  one. The invariants exist in the authors' heads and scattered tests, not in
  code. FIX-02's hand-off check is one instance of this class.
- **Shape of work:** `shared/statusMachine.ts` — a transition table
  (`canTransition(from, to, cause)`) + a `transition()` helper returning the
  patch; refactor the three mutation paths through it; property tests
  (fast-check is a natural fit) asserting no sequence of API calls reaches an
  illegal state.
- **Effort:** M. **Risks/deps:** pure refactor risk; the DI/test seam makes
  it safe. Do before EXP-01 (reopen flow) adds a *new* transition.
- **Excellent looks like:** the transition diagram in `ARCHITECTURE.md`
  generated from (or asserted against) the table; property tests in CI.

## FIX-10 — Alert-subscription privacy: inventory, minimization, TTL
**Pitch:** treat saved routes/areas as the sensitive location data they are, before delivery ships.

- **Why it matters:** a saved watch is a home↔work corridor — arguably the
  most sensitive data the system will hold, more identifying than any single
  report. Today it's stored verbatim (up to 2,000 exact polyline points,
  `shared/validation.ts:123-127`) keyed to a push endpoint, unbounded in
  time, and *absent from the privacy audit's data inventory*
  (`docs/audits/privacy-notes.md` / `RESPONSIBLE-TECH-AUDITS.md` §C predate
  ADR-7). R11 (Postgres persistence + delivery) will make this permanent —
  the privacy work must land first or ride along.
- **Shape of work:** add subscriptions to the data inventory + privacy page
  (`public/privacy.html`); store simplified geometry (Douglas-Peucker to the
  ~70 m fuzz scale — matching is corridor-based in `shared/alerts.ts`, so
  precision beyond the corridor width is pure liability); expiry/TTL with
  renewal-on-use; endpoint values treated as secrets in logs (extend the
  redaction list in `server/lib/logger.ts`); a no-auth unsubscribe already
  exists (`DELETE /api/alerts/subscribe/:id`) — document id handling.
- **Effort:** M. **Risks/deps:** coordinate with R11 so the Postgres schema
  is minimization-shaped from day one. Privacy-review gate before delivery
  flips on.
- **Excellent looks like:** the stored geometry provably no more precise than
  matching requires (test comparing match results before/after
  simplification); inventory + retention documented; redaction test covers
  endpoints.

## FIX-11 — Localize the surfaces the i18n catalog can't see
**Pitch:** extend the (excellent) client i18n to API error messages, static policy pages, and push payloads.

- **Why it matters:** the G1–G12 gate battery covers `src/**` react-intl
  messages, but users also read: server error envelopes shown verbatim in
  the UI ("Wrong username or password.", "Location must be within Davis,
  CA." from `shared/validation.ts:39`), `public/privacy.html` +
  `public/accessibility.html` (`lang="en"`, English-only — the *privacy
  promises* are untranslated, which is an equity problem, not a polish
  problem), and push notification text (`pushNotify.ts:31-38`). Davis has a
  substantial Spanish-speaking population; the portfolio's i18n phase plan
  (Phase 1 pending) covers catalog mechanics, not these server-side surfaces.
- **Shape of work:** error envelopes gain stable machine codes (they already
  have `error` codes — stop showing `message` and translate client-side by
  code, which also removes a class of server-string leakage); static pages
  get `es` variants + `hreflang`; `buildAlertPayload` accepts a locale stored
  with the subscription (one more FIX-10 field). Extend
  `scripts/i18n/check-no-hardcoded.mjs`'s scope or add a companion check for
  `shared/` user-facing strings.
- **Effort:** M. **Risks/deps:** native-Spanish review is a human gate (the
  portfolio's §7 benchmark-owner gap applies here too — defer sign-off, say
  so). Sequence with the i18n-catalog-retrofit branch landing.
- **Excellent looks like:** a Spanish-preference user completes report →
  status → privacy-page reading with zero English; parity gate extended to
  the new catalogs.

## FIX-12 — Verify and document the real fuzzing guarantee
**Pitch:** property-test `fuzzCoordinate` and reconcile the "cell centre" comment with the code's cell-edge behavior.

- **Why it matters:** `snap()` (`shared/geo.ts:54-56`) computes
  `(Math.round(v/step)+0.5)*step` — published points sit on cell *edges*,
  max displacement ≈ one full step (~70–100 m at Davis latitude), while the
  doc comment promises the cell centre (max ≈ half a step). No privacy hole
  (deterministic, bounded, non-averageable), but the repo's core privacy
  claim is currently *stated* imprecisely and *tested* only by example. For
  a project whose ethos is "measured, not asserted," the flagship privacy
  control deserves a measured bound.
- **Shape of work:** property tests (max/min displacement over the Davis
  bbox, determinism, non-invertibility of repeated same-spot reports); decide
  centre vs edge deliberately (centre via `Math.floor(v/step)+0.5` halves
  worst-case *utility* error for map users; either is private) — note any
  change shifts existing published points one cell, so migrate or accept and
  document; update `privacy-notes.md` with the measured figure.
- **Effort:** S. **Risks/deps:** none; a nice first issue for a
  contributor post-CONTRIBUTING.md.
- **Excellent looks like:** `privacy-notes.md` quotes a test-enforced number
  ("public point is within X m of true point; reports <Y m apart are
  indistinguishable") instead of "~70 m".

## FIX-13 — Enforce the JSON store's single-process constraint in code
**Pitch:** a lock file so the documented "never run two instances" rule can't be violated silently.

- **Why it matters:** the README (§ Operations) and `server/config.ts:27-30`
  both warn that two processes on one `DATABASE_PATH` corrupt it — but
  nothing enforces it. Beta-runbook users (`BETA.md`) are exactly the people
  who'll start a second process by accident. Honest systems fail loudly.
- **Shape of work:** an advisory lock file (`{path}.lock` with pid +
  liveness check) acquired in `JsonFileRepository`'s constructor
  (`server/lib/repository.ts:162-187`); refuse to boot with a clear message;
  stale-lock recovery on unclean shutdown.
- **Effort:** S. **Risks/deps:** none; dev-only path.
- **Excellent looks like:** a test that a second repository instance on the
  same path throws before any write.

## FIX-14 — Reconcile the research branch before the histories diverge further
**Pitch:** land `research-panel-and-roadmap` (docs + implemented R1/R2/R4) and the i18n retrofit into one mainline.

- **Why it matters:** the repo's "current state" is currently three-way:
  `main` (through `2c8c20e`), `i18n-catalog-retrofit` (HEAD here), and
  `research-panel-and-roadmap` (`094ef6f` — the *only* home of
  RESEARCH-ROADMAP.md, USER-RESEARCH.md, `src/lib/dedupe.ts`, the reporter
  trail endpoint, and `normalizeCoverage`). The i18n retrofit rewrote
  user-facing strings in `ReportForm.tsx`, `MyReports.tsx`, and
  `CoverageView.tsx` — the same files the research work modified. Every week
  of divergence makes the merge worse and leaves the portfolio's research
  layer invisible on `main`. (Conflict scope is an estimate; I read the
  research branch's docs and commit message, not its full diff.)
- **Shape of work:** merge order decision (suggest: land i18n retrofit →
  rebase research branch, wrapping its new strings in the catalog as you go
  → run the full gate battery incl. `i18n:gates` on the result); then delete
  merged branches (the repo carries ~15 stale `productionize/*` and
  dependabot remotes).
- **Effort:** M (mostly careful review, not new code). **Risks/deps:** the
  R1/R2/R4 implementations were flagged "working tree, uncommitted" in the
  research doc — verify what actually made it into `094ef6f` before assuming.
- **Excellent looks like:** `main` contains the research docs, the R1/R2/R4
  features behind green i18n gates, and `git branch -a` lists only live work.
