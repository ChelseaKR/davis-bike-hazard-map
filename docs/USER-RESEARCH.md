# User Research — Synthetic Personas & Simulated Interviews

> [!WARNING]
> **These personas and interviews are synthetic.** They were generated as a
> structured brainstorming device — *not* conducted with real people. No real
> Davis cyclist, city engineer, or moderator said any of this. This document
> pressure-tests the product from many angles at once; it is **not** evidence of
> demand and does **not** substitute for real discovery. Treat every "quote" as a
> hypothesis to validate, not a finding — consistent with how this repo labels its
> synthetic seed data (`scripts/seed.ts` seeds are clearly fictional) and its
> responsible-tech posture ([`RESPONSIBLE-TECH-AUDITS.md`](./RESPONSIBLE-TECH-AUDITS.md)).
>
> The honest next step is real interviews with ≥5 of these roles — most cheaply
> recruited through the private beta ([`BETA.md`](../BETA.md)) and Davis cycling
> channels. **Last assembled: 2026-06-30.**

## Why do this at all
Even simulated, role-playing the full cast around a civic hazard-mapping PWA
surfaces gaps a single author misses and forces the question "who is each feature
*for*?" Davis is an unusually demanding test bed: it calls itself the Bicycle
Capital of America, earned the first **Platinum** Bicycle Friendly Community award
in 2006 (re-certified 2020), and roughly **a quarter of residents and half of
UC Davis students commute by bike** ([League of American Bicyclists](https://bikeleague.org/davis-ca-platinum-bicycle-friendly-trifecta/),
[UC Davis Transportation](https://transportation.ucdavis.edu/bicycleprogram)).
That density is the opportunity *and* the obligation: a hazard map here is used by
a genuinely broad public, including people the design must not exclude.

The synthesis at the end is tagged so it doesn't become a wishlist:

- **[shipped]** — already exists (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) / [`README.md`](../README.md)).
- **[specified]** — already in [`docs/ROADMAP.md`](./ROADMAP.md) but not yet built.
- **[blocked]** — needs an external/human input (VAPID keys, a live GOGov endpoint, self-hosted OSRM, reviewer sign-off).
- **[new]** — genuinely surfaced here.

## How to read a persona
Each card compresses the simulated interview to five lines: **Goal**, **Values
today** *(mapped only to features that actually exist)*, **Gets stuck**, **Wants
next**, and **Adopts / walks** (the one thing that wins or loses them).

---

## Method

- **Sampling frame.** Everyone who touches a crowdsourced civic hazard map: people
  who **report & ride** (commuters, a parent towing kids, an e-bike rider, a
  recreational rider, a student, a screen-reader user who lives in the list view,
  and a privacy-minded reporter); the city that must **maintain & respond**
  (public-works/traffic engineering, the GOGov/311 administrator, council/policy
  staff); the advocates who **amplify**; the people who **assure & audit** (a
  community moderator, a data journalist reusing the open data, and the
  adversary the moderation must survive); and the **owner/maintainer** who
  operates it.
- **Protocol.** For each persona: a goal, a walkthrough of the live surfaces they'd
  touch (capture flow, map, list, coverage view, route planner, moderation queue,
  311 hand-off, open-data export), what worked, where they stalled, and an open
  "what would make this a 10/10" prompt.
- **Research basis (citations).** Personas and their frictions are anchored to
  published evidence on cycling safety, under-reporting, civic 311 systems, and
  crowdsourced hazard maps so they're plausible rather than invented:
  - **The danger is real and rising.** US cyclist deaths hit **1,105 in 2022**,
    the highest in the 47-year history of NHTSA's Fatality Analysis Reporting
    System ([NHTSA 2022 Data](https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813591);
    [League of American Bicyclists](https://bikeleague.org/highest-ever-reported-number-of-people-killed-while-biking-in-2022/);
    [Route Fifty](https://www.route-fifty.com/infrastructure/2024/04/2022-was-worst-year-ever-bicyclist-deaths-new-data-shows/395491/)) —
    an **~87% rise from the 2010 low of 623**, with light trucks/SUVs in **46%**
    of fatal crashes ([League of American Bicyclists](https://bikeleague.org/another-year-of-devastating-and-preventable-bicyclist-deaths/)).
  - **Official data is a fraction of reality.** Police–hospital data-linkage
    reviews put bicycle-crash reporting rates at roughly **7–46%** ([UC eScholarship review](https://escholarship.org/uc/item/0jq5h6f5));
    near-miss non-reporting runs as high as **~97%** ([Vancouver under-reporting study](https://www.sciencedirect.com/science/article/abs/pii/S2214140516303851);
    [COST TU1101 international survey](https://www.sciencedirect.com/science/article/abs/pii/S0001457517303391)).
  - **Crowdsourcing can close the gap — fast.** BikeMaps.org collected roughly a
    **year of official collision reports in two months** in pilot-city Victoria,
    with **~62% near misses vs. 38% collisions** ([Nelson et al., *PMC/CDC*](https://pubmed.ncbi.nlm.nih.gov/25870852/);
    [BikeMaps about](https://bikemaps.org/about/);
    [Ferster et al., critical-events mining](https://www.sciencedirect.com/science/article/pii/S2590198221000671)).
  - **…but crowdsourcing is biased.** Resident reporting carries large spatial /
    socioeconomic disparities ([Liu, Garg et al., *Nature Computational Science* 2024 / arXiv 2204.08620](https://arxiv.org/abs/2204.08620);
    [Boston 311 crowdsourcing behavior](https://www.researchgate.net/publication/353628453);
    and demographic skew in cycling-safety volunteers, [BikeMaps representation study](https://www.researchgate.net/publication/320767994)).
  - **Collective signals move the city.** On SeeClickFix, comments and follows
    **double the probability a request is closed** and resolve issues up to **~5
    days faster** ([Schiff, *Public Administration Review* 2025](https://onlinelibrary.wiley.com/doi/full/10.1111/puar.13747)).
  - **Civic reporting tools get abandoned for boring reasons.** Champaign, IL
    dropped SeeClickFix after **API failures dropped reports silently**,
    geolocation pinned issues to reporters' homes, and anonymous reports blocked
    follow-up — with several residents unaware the platform even existed
    ([CU-CitizenAccess](https://cu-citizenaccess.org/2025/12/software-issues-led-champaign-to-axe-seeclickfix-in-favor-of-new-public-reporting-system-brightly/)).
  - **Adversaries game civic reports.** Crowdsourced systems face coordinated spam
    (the VOICE-line floods), and even reputation-weighted moderation is
    manipulable: **5–20% of bad raters can suppress correct items** ([Collective Obfuscation](https://arxiv.org/pdf/2208.06405);
    [Community Notes manipulation](https://arxiv.org/pdf/2511.02615);
    [crowdsourced image-moderation dangers](https://www.webpurify.com/blog/the-dangers-of-crowdsourcing-for-image-moderation/)).
  - **Photo metadata is a real privacy vector.** EXIF GPS has deanonymized
    activists and abuse survivors (and McAfee, 2012) ([Proton](https://proton.me/blog/exif-data);
    [Consumer Reports](https://www.consumerreports.org/electronics-computers/privacy/what-can-you-tell-from-photo-exif-data-a2386546443/)).
  - **Hazard-aware routing is tractable on OSRM.** OSRM's Lua profiles already
    encode cyclability penalties; a re-ranking layer over OSRM candidates is a
    standard pattern ([OSRM profiles](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md);
    [bicycle.lua](https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua)).
- **Synthesis.** Frictions → **R**emediations; wishes → **E**xpansions, carried
  into [`RESEARCH-ROADMAP.md`](./RESEARCH-ROADMAP.md) with value × effort, evidence,
  and a traceability matrix. *Access date for all sources: 2026-06-30.*

---

## Persona roster

| # | Persona | Group | Primary goal | Top friction |
| --- | --- | --- | --- | --- |
| P1 | **Marisol** — daily bike commuter | Report & Ride | Flag a hazard one-handed at a corner, ride on | Wants proof the city actually saw it |
| P2 | **Trevor** — parent towing two kids (cargo bike) | Report & Ride | Pick the *safest* route, not the fastest | "Safe enough for kids" isn't a filter |
| P3 | **Priya** — Class-2 e-bike commuter | Report & Ride | Avoid the spots where speed + a pothole = a fall | Routing doesn't know she rolls at 20 mph |
| P4 | **Hank** — recreational/road cyclist, county roads | Report & Ride | Log loose gravel & debris on weekend loops | Davis-only bbox rejects the causeway/county hazards |
| P5 | **Wei** — UC Davis undergrad | Report & Ride | Fast, free, on a cracked phone, bad dorm Wi-Fi | Doesn't know the app exists; no campus hook |
| P6 | **Dolores** — low-vision daily rider, screen-reader user | Report & Ride | Use the **list**, never the map, as a first-class path | Filing a report with a photo via SR is uncertain |
| P7 | **"Ren"** — privacy-minded reporter | Report & Ride | Report a hazard near home without being identifiable | Can the city / a FOIA re-link the precise spot to them? |
| P8 | **Greg** — city public-works / traffic engineer | Maintain & Respond | Triage real, located, prioritized repair work | Crowd map ≠ his work-order system; is it ground truth? |
| P9 | **Anita** — GOGov/311 administrator | Maintain & Respond | Keep 311 clean; no duplicate or junk floods | Wants dedupe + provenance before it hits her queue |
| P10 | **Councilmember Okafor** — council / policy staff | Maintain & Respond | Defensible evidence for where to spend safety $ | Coverage gaps could be misread as "safe streets" |
| P11 | **Sam** — Davis bike-advocacy org lead | Advocate | Turn rider frustration into a public, durable record | Needs the data to outlive a maintainer and a grant |
| P12 | **Jordan** — community moderator | Assure & Audit | Approve real hazards, reject PII/abuse within SLA | Burst spam + identifiable faces are hard at volume |
| P13 | **Dr. Lin** — data journalist / safety researcher | Assure & Audit | Reuse the open data without over-claiming | Must not present reports as ground-truth danger |
| P14 | **"floodbot"** — malicious / spam reporter | Assure & Audit *(adversary)* | Bury a rival street / vandalize the map at scale | Wants to beat rate-limits, fuzzing, and confirmations |
| P15 | **Chelsea** — owner / maintainer | Operate | Run it cheaply, safely, and graduate it to public | No real OSRM/GOGov/VAPID infra; thin ops visibility |

---

## Interviews

## Group A — Report & Ride (cyclists & reporters)

### P1 — Marisol, daily bike commuter
- **Goal:** flag the glass at 5th & B in three taps without unclipping for long, and trust it mattered.
- **Values today:** the **seconds-long capture flow** (category · severity · photo · auto-location); that it **works offline and syncs later** (IndexedDB queue + background sync) so a dead zone never loses the report; the **live filterable map**.
- **Gets stuck:** after she submits, she gets no sense the report *landed* with anyone who can fix it — it just enters moderation. She doesn't know other riders can corroborate it.
- **Wants next:** a "you'll see it after review" confirmation; a way to **mark "still here" / "me too"** on an existing hazard instead of filing a duplicate; an honest "reported to the city / fixed" trail.
- **Adopts if:** filing is faster than tweeting at the city. **Walks if:** her reports vanish into a queue she never hears about again (the exact failure that sank SeeClickFix in Champaign).

### P2 — Trevor, parent towing two kids on a cargo bike
- **Goal:** get the *safest* route to preschool, even if it's slower — he's hauling precious cargo.
- **Values today:** the **hazard-avoiding route planner** (OSRM cycling route re-ranked by severity × recency × confirmations) and that it returns a **turn-by-turn list**, not only a map line; **severity shown by shape + text + colour**, so danger reads at a glance.
- **Gets stuck:** the route optimizes around *reported* hazards but he can't ask for "kid-safe": avoid high-severity *and* unprotected arterials regardless of reports. He worries empty areas look safe when they're just unobserved.
- **Wants next:** a **"safest / family" routing preference**; a way to weight *near-miss / scary-intersection* reports (the leading-indicator class BikeMaps shows is ~62% of submissions) — not just physical debris.
- **Adopts if:** the route is one he'd actually put his kids on. **Walks if:** it sends them down a road that's clear of potholes but obviously hostile.

### P3 — Priya, Class-2 e-bike commuter
- **Goal:** avoid the spots where her 20 mph + a lip in the pavement equals a crash.
- **Values today:** **recency filtering** (a 3-day-old pothole matters more than a 3-month-old one) and that **routing already weights recency and confirmations**; the **lifecycle badge** so she can see *reported → confirmed → resolved*.
- **Gets stuck:** the route's speed assumptions are a standard bike profile; at e-bike speed her safe stopping distance is different and the planner can't know that. No way to say "I ride fast."
- **Wants next:** an **e-bike / speed-aware routing profile**; clearer "how recent is recent" controls; confidence that a *resolved* badge means actually fixed, not just expired.
- **Adopts if:** it catches the fast-line hazards. **Walks if:** "resolved" turns out to mean "aged out," not "repaired."

### P4 — Hank, recreational / road cyclist on county roads
- **Goal:** log loose gravel, ag debris, and a washed-out shoulder on his weekend Yolo County loops.
- **Values today:** **photo with EXIF stripped + blur** so he can document a hazard responsibly; the **map clustering** that keeps a long route legible.
- **Gets stuck:** half his ride is **outside the Davis bounding box**, and intake **rejects out-of-area coordinates** (`davisPointSchema`) — by design, but it means the causeway and county roads where he sees the worst hazards aren't mappable here.
- **Wants next:** a documented **service-area expansion path** (Davis → Yolo County corridors) and clarity that the bbox is a policy choice, not a bug.
- **Adopts if:** his real riding fits the coverage area. **Walks if:** the tool only knows the 4×4-mile core and silently drops everything else.

### P5 — Wei, UC Davis undergrad
- **Goal:** report the bent rail-trail bollard on the way to class, free, fast, on a cracked phone with flaky dorm Wi-Fi.
- **Values today:** **no account required to report or view**; **installable PWA** ("Add to Home Screen"); **offline capture → sync** that survives the campus dead spots.
- **Gets stuck:** he's never heard of it — there's no campus/Unitrans/orientation hook, and student turnover means awareness resets every year. Multiuse path–road intersections (where BikeMaps found injury rates highest) are exactly his commute.
- **Wants next:** a **campus on-ramp** (QR posters at bike racks, an ASUCD/Unitrans tie-in), and a category that fits **path-crossing near misses**, not just car-road hazards.
- **Adopts if:** a friend shows him a QR code at the bike barn. **Walks if:** he never learns it exists — the quiet-adoption death of most 311 tools.

### P6 — Dolores, low-vision daily rider & screen-reader user
- **Goal:** use the **list view** as a complete, first-class path — she never touches the map.
- **Values today:** **map + list parity** (the List renders the exact same filtered dataset, keyboard- and SR-operable); **severity by shape + text**, never colour alone; the **coverage view's honest empty state** ("none reported here — *not* that the area is safe"); axe gates at component **and** full-page level.
- **Gets stuck:** *filing* a report — especially the **photo / blur editor** — is a canvas interaction she's unsure she can complete non-visually; she can't tell if the precise location was captured right; she worries about whether streamed status updates are announced politely.
- **Wants next:** a **fully SR-narrated capture + blur flow** (or a documented photo-optional path), explicit `aria-live` on lifecycle changes, and the committed human VoiceOver/NVDA pass finished (it's still review-gated pre-launch).
- **Adopts if:** she can *report*, not just *read*, entirely by keyboard + SR. **Walks if:** the map is accessible but the capture flow is a visual-only wall.

### P7 — "Ren", privacy-minded reporter
- **Goal:** report a dangerous spot 50 m from home without anyone re-linking the report to *them*.
- **Values today:** the **defense-in-depth privacy stack** — client **+** server EXIF strip, manual/auto **face & plate blur**, and **~70 m location fuzzing** so the public point is never the exact one; **no account, minimal data**; precise coordinates only ever used for an **opt-in** 311 hand-off they explicitly trigger.
- **Gets stuck:** they don't *see* the protections, so they don't trust them — is the fuzz enough near a low-density block where one house = one suspect? If a moderator hands off to 311, what exactly does the city receive, and is it FOIA-able?
- **Wants next:** a **visible "what's protected / what the city sees" explainer** at capture time; a per-report preview of the fuzzed public point; clarity on hand-off data minimization and retention.
- **Adopts if:** the privacy story is legible, not just true. **Walks if:** reporting near home feels like self-doxxing.

## Group B — Maintain & Respond (city)

### P8 — Greg, city public-works / traffic engineer
- **Goal:** turn the map into prioritized, *located* repair work he can defend in a maintenance budget.
- **Values today:** **precise (internal) coordinates preserved server-side** for the opt-in hand-off (he can't fix a fuzzed point); **severity + confirmations + recency**; **open-data export** he can pull; **OSM base** he already uses.
- **Gets stuck:** the public map is **reports-received, not ground truth** — he can't let "loud street looks dangerous, quiet street looks safe" drive spending (the documented allocational-bias trap). He needs dedupe and a confidence signal before it's actionable.
- **Wants next:** **confirmation-weighted prioritization normalized by ridership/exposure**; a clean **export keyed to his GIS/work-order IDs**; coverage-gap flags so under-reported ≠ deprioritized.
- **Adopts if:** it feeds, not fights, his work-order system. **Walks if:** it's a popularity contest dressed as a hazard map.

### P9 — Anita, GOGov/311 administrator
- **Goal:** protect the 311 queue — every item that arrives should be real, located, de-duplicated, and traceable.
- **Values today:** **hand-off is moderator-triggered, not reporter-triggered** (least privilege), **dry-run by default**, and carries the **same structured payload**; **status sync-back** (pull *Sync* + authenticated push webhook) so a city "fixed" closes the loop and **resolves + coarsens** the hazard.
- **Gets stuck:** she's seen 311 tools (Champaign's SeeClickFix) abandoned over **silent API failures, home-address geolocation, and un-actionable anonymous reports**. She wants delivery *receipts* and dedupe *before* the hand-off, not after.
- **Wants next:** **hand-off delivery confirmation + reconciliation/retry**; **duplicate clustering** so ten reports of one pothole arrive as one ticket with a count; a provenance stamp ("community-reported, moderator-approved, N confirmations").
- **Adopts if:** it *reduces* her queue noise. **Walks if:** it floods 311 with dupes the way an un-deduped feed would.

### P10 — Councilmember Okafor, council / policy staff
- **Goal:** point safety dollars at evidence, and defend the choice publicly.
- **Values today:** the **coverage-by-area view** that lists **every** area including zero-report ones with explicit "under-reported, not safe" framing; the "**community-reported, not verified by the city**" labeling; **open data + open methodology** they can cite.
- **Gets stuck:** the press (or an opponent) could wield the map as "these streets are dangerous, those are fine" — exactly the representational-bias failure the under-reporting literature warns about. Coverage is uneven by neighbourhood and income.
- **Wants next:** an **equity-aware view** (reports normalized by ridership/population; explicit "data desert" call-outs); a plain-language methodology note for public meetings; trend-over-time, not just a snapshot.
- **Adopts if:** it survives a hostile reading at a council meeting. **Walks if:** it can be screenshotted into a misleading "safe vs. dangerous" map.

## Group C — Advocate

### P11 — Sam, Davis bike-advocacy org lead
- **Goal:** convert scattered private frustration into a **shared, public, durable** record that pressures the city and outlives any one grant.
- **Values today:** **open data + MIT license + OSM** (no proprietary lock-in); the **public read-only dashboard mode** (`VITE_PUBLIC_DASHBOARD=true`) to embed/share; that the design **never equates absence with safety**; the self-cleaning **lifecycle** so the map stays current.
- **Gets stuck:** adoption is the whole game — a thin, lopsidedly-covered map is worse than none, and BikeMaps-style volunteer data skews toward confident, younger, male riders. He needs to *seed* under-reported areas and recruit broadly.
- **Wants next:** a **campaign/embed kit** + seeded known-hazard list; **low-tech intake** (SMS/QR) to reach riders who won't install a PWA; periodic "here's what got fixed" wins to sustain momentum.
- **Adopts if:** it gives advocacy a credible, ownable evidence base. **Walks if:** coverage stays too thin and skewed to cite.

## Group D — Assure & Audit

### P12 — Jordan, community moderator
- **Goal:** clear the queue inside the **48 h SLA** — approve real hazards, reject PII/abuse — without burning out.
- **Values today:** the **moderation queue** (keyset-paged) with the pending photo **streamed only to an authenticated moderator** (never public while pending); **named accounts + attributable audit trail** (`moderation[]` records *who* acted); **approve / reject / resolve**; mechanical defenses already in place — **per-IP rate-limit, idempotent UUIDs, out-of-area rejection**; **queue-depth + oldest-pending metrics** to watch the SLA.
- **Gets stuck:** **burst or coordinated spam** (the VOICE-line pattern) and **un-blurred faces/plates** are hard to catch one-by-one at volume; there's no batch action, no similar-report grouping, and no signal that a wave is coordinated.
- **Wants next:** **moderator tooling for bursts** (cluster near-identical reports, bulk reject, flag suspected coordinated floods), an auto-blur *pre-pass* that flags likely faces for review, and a clear escalation when a single source spikes.
- **Adopts if:** one volunteer can hold the line solo. **Walks if:** a motivated spammer can out-pace human review.

### P13 — Dr. Lin, data journalist / cycling-safety researcher
- **Goal:** reuse the open data to report on Davis cycling safety — without over-claiming what crowdsourced reports mean.
- **Values today:** the **PII-free open-data export** (precise location and contact never in it); the **explicit "reports-received, not ground-truth" framing**; lifecycle + confirmation fields; **OSM attribution** and a documented schema; the **OpenAPI spec** + versioned `/api/v1` for stable pulls.
- **Gets stuck:** she needs **denominators** (ridership/exposure) to say anything causal, and a stable, documented, versioned schema with a data dictionary so a story isn't built on a field that changes; she must not present coverage gaps as a danger map.
- **Wants next:** a published **data dictionary + methodology/limits note**, exposure/normalization guidance, and an example "how to *not* misread this" caveat she can cite.
- **Adopts if:** she can publish a checkable, well-caveated claim. **Walks if:** the data invites the exact misreading the project warns against.

### P14 — "floodbot", malicious / spam reporter *(adversary — the moderation must survive this)*
- **Goal:** bury a rival business's street under fake hazards, or vandalize the map with junk and identifiable photos at scale.
- **Values today (as obstacles to them):** **human moderation before anything is public** (no unmoderated feed to poison); **per-IP/hour rate-limiting**; **idempotent UUIDs** (retries don't multiply); **out-of-Davis rejection**; **location fuzzing + EXIF strip** that blunt doxxing; **moderator-only 311 hand-off** (can't push junk straight to the city).
- **Gets stuck (good):** they can't get anything public without a human; single-IP floods throttle; out-of-area junk bounces.
- **Breaks through (the risk to design against):** rotating IPs / many low-volume accounts to **inflate confirmations** on a target hazard (reputation-weighted systems fall to 5–20% bad actors); **slow-drip** plausible-but-false reports that pass casual moderation; overwhelming the **single 48 h-SLA queue** so real reports age out.
- **Defeated if:** confirmations resist Sybil inflation, coordinated bursts are surfaced to moderators, and abuse is rate-limited per-actor, not just per-IP. **Wins if:** confirmations are one-click-per-anonymous-device and the queue has no burst defenses.

## Group E — Operate

### P15 — Chelsea, owner / maintainer
- **Goal:** run it cheaply and safely through the private beta, then graduate it to a public deployment.
- **Values today:** **one container + Postgres**, **`make verify` merge gate**, CI gates (axe, EXIF, offline-sync e2e, `npm audit`, gitleaks), **graceful degradation everywhere** (311 dry-run, straight-line route fallback, push behind a flag), **/api/health + /api/metrics**, **automatic timestamped backups** (dev), and **Fly.io deploy + rollback** documented in [`BETA.md`](../BETA.md).
- **Gets stuck:** the civic-grade features are **real but un-provisioned** — push delivery needs **VAPID keys + a SW handler**, routing leans on the **rate-limited public OSRM demo**, 311 hand-off + sync-back need a **live GOGov endpoint + webhook secret**, and two **review-gated** items (human SR walkthrough, equity sign-off) gate public launch. Ops visibility is thin (metrics exist; no dashboard).
- **Wants next:** **self-hosted OSRM** for production routing; a **Postgres-backed push subscription store** + wired delivery; a **GOGov integration contract** + delivery receipts; the two review-gated sign-offs closed; light ops dashboards over the existing metrics.
- **Adopts if:** each civic feature flips from "flagged/dry-run" to "live" without re-architecting. **Walks if:** turning anything on means a rewrite (it doesn't — every path was built flagged on purpose).

---

## Cross-cutting themes

1. **"Did anyone see it? Did it get fixed?" is the retention question.** P1, P8, P9,
   P11, P15 all circle the **feedback loop**. The evidence is blunt: Champaign
   abandoned SeeClickFix partly because reports **vanished silently**, while Schiff
   (2025) shows visible collective input **doubles closure odds**. The lifecycle +
   sync-back rails exist; the gap is *delivery receipts, dedupe, and a visible
   "fixed" story*.
2. **Absence-is-not-safety is the project's defining integrity constraint — and the
   personas keep testing it.** P2, P8, P10, P11, P13 each independently risk
   misreading coverage gaps as safe streets. The coverage view + framing are
   shipped; the next layer is **equity-aware normalization** (reports per rider,
   explicit data deserts), because the under-reporting literature is unanimous that
   raw crowdsourced counts are spatially and socioeconomically skewed.
3. **The capture flow is fast for the median rider but uncertain at the edges.**
   P6 (screen-reader) can *read* everything but isn't sure she can *file* a photo
   report; P7 (privacy) is protected but can't *see* it. The hard, differentiated
   work is **making the accessible + private capture path legible**, not just
   correct.
4. **Routing is the standout feature and the most under-finished.** P2, P3 love it
   and immediately want **rider-aware profiles** (family-safe, e-bike speed) and
   **near-miss-class hazards** weighted in. P15 needs it **off the public OSRM
   demo**. Small surface, high leverage.
5. **The map's value scales with trustworthy volume — which invites gaming.** P11
   needs *more, broader* reports; P12 and P14 are the same coin's two sides:
   confirmations and a single SLA queue are exactly what an adversary targets.
   **Anti-Sybil confirmations + burst-aware moderation** protect the very signal
   advocacy and the city depend on.
6. **Everything civic is built, flagged, and waiting on provisioning, not code.**
   Push (VAPID), routing (self-host OSRM), 311 (live GOGov + secret), and two
   review-gated sign-offs. The honest roadmap is mostly *operational activation +
   thin new layers*, not a rebuild — which is the project's deliberate design.

---

## Honest limits of this exercise
This is simulated. It can generate plausible needs and obvious gaps grounded in the
cited literature, but it **cannot** tell you which are real for *Davis*, how many
people would actually use this, what the city would actually accept into 311, or
whether the privacy/accessibility protections satisfy the people who most need
them. It over-represents the author's mental model and will miss what only real
riders, a real traffic engineer, and a real moderator surprise you with — and it is
emphatically **not** safety data. **Do not prioritize off this alone.** Use it to
design the questions for, and lower the cost of, real discovery: recruit the beta
group in [`BETA.md`](../BETA.md), the city's public-works and GOGov contacts, the
Davis Bicycling Advisory Commission / advocacy orgs, UC Davis Transportation and
disability-services testers, and at least one screen-reader user for the still-open
VoiceOver/NVDA pass.

➡️ **Triaged backlog, sequencing, and evidence trace:** [`RESEARCH-ROADMAP.md`](./RESEARCH-ROADMAP.md).
