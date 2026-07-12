# Research Roadmap — Davis Bike Hazard Map

> **This document complements [`docs/ROADMAP.md`](./ROADMAP.md); it does not replace
> it.** The implementation roadmap carries the build plan and milestones (M0–M6,
> mostly delivered). This one carries the **evidence-driven backlog** that fell out
> of the synthetic persona panel in [`USER-RESEARCH.md`](./USER-RESEARCH.md):
> remediations (sharpen what exists) and expansions (new capability), each tied to
> a persona, a priority, an effort, and a **real, cited** piece of evidence.
>
> Every item is tagged **[corroborates …]** (independently re-surfaces something
> the existing docs already name — triangulation, not noise) or **[NET-NEW]** (the
> panel surfaced it; the existing roadmap/audits don't cover it). No feature or
> fact is invented; "values today" and "reuses" point only at code/behaviour that
> exists in [`README.md`](../README.md) / [`ARCHITECTURE.md`](./ARCHITECTURE.md) /
> the [`docs/audits/`](./audits/). **Last assembled: 2026-06-30.**

> [!WARNING]
> The personas and interviews underpinning this roadmap are **synthetic** — a
> brainstorming device, not user data. This is a prioritization *hypothesis* to
> validate with real Davis riders, the city, moderators, and accessibility/privacy
> testers — **not** evidence of demand and **not** safety data. See *Validate with
> real users* below.

---

## Delivery status — reconciled 2026-07-11

This file is an evidence-driven option set, not a promise that every idea is an
active engineering ticket. The active implementation lane has been drained; the
remaining proposals stay behind the explicit product, operations, or human gates
below rather than being represented as silently open work.

| State | Items | Evidence / gate |
| --- | --- | --- |
| **Delivered** | R1, R2, R4, R9, R11, E1, E7 | Duplicate nudge + confirmations; reporter trail; normalized coverage; manual + optional `FaceDetector` blur; durable Web Push delivery; near-miss taxonomy; recently resolved hazards remain visible. |
| **Delivered foundation; external completion remains** | R3, R7 | 311 references and pull/webhook status reconciliation ship, but live delivery/retry requires a real provider contract; privacy copy and accessible/photo-optional capture ship, while the human screen-reader walkthrough remains review-gated. |
| **Operations/partner-gated** | R8, E5 | Self-hosted routing requires hosting and an OSM extract; the campus on-ramp requires a real UC Davis/Unitrans partner and distribution plan. |
| **Future options, not activated commitments** | R5, R6, R10, R12, E2, E3, E4, E6, E8, E9 | These require additional product scope, threat-model decisions, real-user validation, operating capacity, or partner/legal review. Promote one to an implementation ticket only when its gate and owner are explicit. |

The detailed entries below remain as the decision record and evidence base. The
status table is authoritative when older prose says a delivered foundation is
still absent.

---

## Framing — how this fits the existing roadmap

The existing roadmap's MoSCoW already shipped the **Must** and most of the
**Should** (fast offline report, EXIF/blur, fuzzing, map + list parity, lifecycle,
moderation, hazard-aware routing, 311 hand-off + sync-back, coverage view, open
data, public dashboard). It also explicitly *defers* validation work — "validate
top hazard categories with a short local survey," "duplicate clustering," "equity
reviewer sign-off." This research roadmap does three things on top of that:

1. **Closes the loop the literature says civic tools live or die on** — feedback to
   reporters, delivery receipts to the city, and dedupe — which the rails already
   support but don't yet surface.
2. **Hardens the project's defining integrity claim** ("absence ≠ safety") into an
   **equity-aware** layer, because every under-reporting study warns raw crowd
   counts are skewed.
3. **Adds the small, high-leverage net-new pieces** the panel kept asking for —
   near-miss reporting, rider-aware routing profiles, and anti-gaming defenses —
   none of which require a rebuild.

## Research basis / evidence

All URLs accessed **2026-06-30**. High-stakes statistics are cross-checked against
≥2 reputable sources.

| Tag | Finding (load-bearing for the backlog) | Sources |
| --- | --- | --- |
| **EV-DANGER** | US cyclist deaths reached **1,105 in 2022**, the highest in FARS's 47-year history (prior peak 1,003 in 1975); **~87% above** the 2010 low of 623; light trucks/SUVs in **46%** of fatal crashes. | [NHTSA 2022 Data](https://crashstats.nhtsa.dot.gov/Api/Public/Publication/813591) · [League of American Bicyclists (2022)](https://bikeleague.org/highest-ever-reported-number-of-people-killed-while-biking-in-2022/) · [League (trend)](https://bikeleague.org/another-year-of-devastating-and-preventable-bicyclist-deaths/) · [Route Fifty](https://www.route-fifty.com/infrastructure/2024/04/2022-was-worst-year-ever-bicyclist-deaths-new-data-shows/395491/) |
| **EV-UNDERREPORT** | Official crash data captures a fraction of reality: bicycle-crash reporting rates ~**7–46%**; cycling **near-miss non-reporting ~97%**. | [UC eScholarship data-linkage review](https://escholarship.org/uc/item/0jq5h6f5) · [Vancouver under-reporting study](https://www.sciencedirect.com/science/article/abs/pii/S2214140516303851) · [COST TU1101 survey](https://www.sciencedirect.com/science/article/abs/pii/S0001457517303391) |
| **EV-CROWD-WORKS** | Crowdsourcing closes the gap fast: BikeMaps.org logged **~1 year of official collisions in 2 months** in Victoria; **~62% of reports are near misses**; multiuse path–road intersections show the highest injury share. | [Nelson et al. (PMC/CDC)](https://pubmed.ncbi.nlm.nih.gov/25870852/) · [BikeMaps about](https://bikemaps.org/about/) · [Ferster et al. critical-events](https://www.sciencedirect.com/science/article/pii/S2590198221000671) |
| **EV-SKEW** | Crowd reporting is spatially and socioeconomically biased; cycling-safety volunteers skew demographically. | [Liu/Garg et al., *Nature Comp. Sci.* 2024 (arXiv 2204.08620)](https://arxiv.org/abs/2204.08620) · [Boston 311 behavior](https://www.researchgate.net/publication/353628453) · [BikeMaps representation](https://www.researchgate.net/publication/320767994) |
| **EV-COLLECTIVE** | Visible collective input drives city action: comments + follows **double closure probability** and resolve issues ~**5 days faster**. | [Schiff, *Public Administration Review* 2025](https://onlinelibrary.wiley.com/doi/full/10.1111/puar.13747) |
| **EV-ABANDON** | Civic tools die from operational failure, not features: Champaign dropped SeeClickFix over **silent API failures, home-address geolocation, un-actionable anonymous reports, and low awareness**. | [CU-CitizenAccess](https://cu-citizenaccess.org/2025/12/software-issues-led-champaign-to-axe-seeclickfix-in-favor-of-new-public-reporting-system-brightly/) |
| **EV-GAMING** | Crowd systems face coordinated spam; reputation weighting is manipulable (**5–20% bad actors** can suppress correct items). | [Collective Obfuscation (arXiv)](https://arxiv.org/pdf/2208.06405) · [Community Notes manipulation (arXiv)](https://arxiv.org/pdf/2511.02615) · [Crowdsourced image-moderation dangers](https://www.webpurify.com/blog/the-dangers-of-crowdsourcing-for-image-moderation/) |
| **EV-EXIF** | Photo EXIF GPS is a documented deanonymization vector (activists, abuse survivors, McAfee 2012). | [Proton](https://proton.me/blog/exif-data) · [Consumer Reports](https://www.consumerreports.org/electronics-computers/privacy/what-can-you-tell-from-photo-exif-data-a2386546443/) |
| **EV-OSRM** | OSRM Lua profiles already encode cyclability penalties; a re-ranking layer over OSRM candidates is standard, and the public demo is rate-limited (self-host for prod). | [OSRM profiles](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/profiles.md) · [bicycle.lua](https://github.com/Project-OSRM/osrm-backend/blob/master/profiles/bicycle.lua) · [Project OSRM](https://project-osrm.org/) |
| **EV-DAVIS** | Davis is an unusually dense, broad cycling public: first **Platinum** Bicycle Friendly Community (2006; re-cert 2020); ~**¼ of residents / ~½ of UC Davis students** bike. | [League of American Bicyclists — Davis](https://bikeleague.org/davis-ca-platinum-bicycle-friendly-trifecta/) · [UC Davis Transportation](https://transportation.ucdavis.edu/bicycleprogram) · [City of Davis Bicycle Action Plan](https://documents.cityofdavis.org/Media/CityCouncil/Documents/PDF/CDD/Planning/Subdivisions/West-Davis-Active-Adult-Community/Reference-Documents/City_of_Davis_Beyond_Platinum_Bicycle_Action_Plan_2014.pdf) |

---

## Remediation backlog (sharpen / activate what exists)

Priority: **P0** now · **P1** next · **P2** soon · **P3** opportunistic.
Effort: **S** ≈ an afternoon · **M** ≈ a day or two · **L** ≈ a week+.

| ID | Remediation | Personas | Pri | Effort | Evidence · reuses / notes |
| --- | --- | --- | --- | --- | --- |
| **R1** | **"Me too / still here" confirmation + lightweight comment** on an existing hazard instead of a duplicate filing | P1,P8,P9,P11 | P0 | M | EV-COLLECTIVE, EV-ABANDON · confirmations already feed lifecycle + routing weight. **[corroborates ROADMAP §3 "duplicate clustering" / "comments"]** · **✅ Implemented in this PR** — confirm/dedupe nudge at report time (`src/lib/dedupe.ts` + `ReportForm`); the *comment* sub-feature is deferred (it would add an un-moderated text channel). |
| **R2** | **Reporter-facing feedback loop** — post-submit "in review" confirmation + a visible per-hazard trail (*reported → approved → handed to city → fixed*) | P1,P5,P11 | P0 | S–M | EV-ABANDON, EV-COLLECTIVE · `lifecycleStage` + resolved-lingers exist; the *reporter view* is thin. **[corroborates ADR-6, extends]** · **✅ Implemented in this PR** — `GET /api/reports/:clientId` (clientId capability) + `reportTrail` rendered in `MyReports`. |
| **R3** | **311 hand-off delivery receipts + reconciliation/retry** — never let a forwarded report vanish silently | P9,P8,P15 | P0 | M | EV-ABANDON · hand-off + pull/push sync-back shipped; no receipt/retry. **[corroborates ADR-6, extends]** |
| **R4** | **Equity-aware coverage** — normalize reports by ridership/population + explicit "data desert" call-outs in the coverage view | P10,P8,P13,P11 | P1 | M | EV-SKEW, EV-UNDERREPORT · `CoverageView`/`areas.ts` lists zero-report areas today (passive). **[corroborates coverage-equity.md, extends]** · **✅ Implemented in this PR** — `normalizeCoverage` (coarse exposure weights) + data-desert call-outs + limits note in `CoverageView`. |
| **R5** | **Anti-Sybil confirmations** — weight/limit confirmations per actor-device, not per-IP only, so a target can't be inflated | P12,P14,P8 | P1 | M | EV-GAMING · moderation rate-limit is per-IP/hour; confirmations exist. **[corroborates moderation-policy.md, extends]** |
| **R6** | **Burst / coordinated-spam moderator tooling** — cluster near-identical reports, bulk-reject, surface single-source spikes | P12,P9 | P1 | M | EV-GAMING · queue is single-item today; metrics expose depth/oldest. **[NET-NEW tooling]** |
| **R7** | **Legible privacy + accessible capture** — a "what's protected / what the city sees" explainer + fuzzed-point preview, and a fully SR-narrated (or photo-optional) capture/blur path | P6,P7 | P1 | M–L | EV-EXIF · privacy stack + list parity shipped but invisible; SR walkthrough still review-gated. **[corroborates privacy-notes.md + a11y gate, extends]** |
| **R8** | **Self-host OSRM** for production routing (off the rate-limited public demo) | P15,P2,P3 | P1 | M | EV-OSRM · ADR-5 proxies the demo; README ops already flags self-hosting. **[corroborates README ops note]** |
| **R9** | **Auto-blur pre-pass** that flags likely faces/plates for moderator review (cut missed-PII risk at volume) | P12,P7 | P2 | M | EV-EXIF, EV-GAMING · `PhotoEditor` manual blur + optional `FaceDetector` exist. **[corroborates ADR-3, extends]** |
| **R10** | **Data dictionary + methodology/limits note** shipped with the open-data export | P13,P10 | P2 | S | EV-UNDERREPORT, EV-SKEW · PII-free export + "reports-received not ground-truth" framing exist; no schema doc. **[NET-NEW doc]** |
| **R11** | **Postgres-backed push subscription store + wire delivery** (flip push from dry-run) | P15,P1,P11 | P2 | M | EV-DANGER · ADR-7 matcher/subscription API shipped; storage in-memory, delivery behind `PUSH_ENABLED`. **[corroborates ADR-7 / README]** |
| **R12** | **Light ops dashboard** over existing `/api/metrics` (queue depth, oldest-pending, RED, hand-off failures) | P15 | P3 | S | EV-ABANDON · Prometheus metrics shipped; no view. **[NET-NEW]** |

## Expansion backlog (new capability)

| ID | Expansion | Personas | Pri | Effort | Evidence · reuses / notes |
| --- | --- | --- | --- | --- | --- |
| **E1** | **Near-miss / "close call" report category** (scary intersection, dooring, swerve) — capture the leading-indicator class | P2,P3,P5,P11 | P1 | M | EV-CROWD-WORKS, EV-UNDERREPORT · taxonomy today is physical hazards; ROADMAP §4 already plans taxonomy validation. **[corroborates §4, extends taxonomy]** |
| **E2** | **Rider-aware routing profiles** — "family / safest" and "e-bike / speed-aware" weighting | P2,P3 | P1 | M–L | EV-OSRM, EV-DANGER · ADR-5 re-ranking layer is the natural seam. **[corroborates routing, extends]** |
| **E3** | **Low-tech intake** — SMS / QR-to-report / kiosk for riders who won't install a PWA (digital-divide mitigation) | P11,P5,P10 | P2 | L | EV-SKEW · same intake validation/store behind a new channel. **[NET-NEW]** |
| **E4** | **Service-area expansion path** — Davis → Yolo County corridors (causeway, county roads) behind the same explicit-bbox policy | P4 | P2 | M | EV-CROWD-WORKS · `davisPointSchema` bbox is a deliberate policy, parameterizable. **[NET-NEW]** |
| **E5** | **Campus / Unitrans on-ramp** — QR posters at bike racks, orientation/ASUCD tie-in, recurring awareness | P5,P11 | P2 | M | EV-DAVIS, EV-ABANDON (low awareness) · public dashboard + PWA install path exist. **[NET-NEW]** |
| **E6** | **City-grade prioritization export** — confirmation-weighted, exposure-normalized, keyed to city GIS / work-order IDs | P8,P9 | P2 | M | EV-COLLECTIVE, EV-SKEW · open-data export + precise internal coords exist. **[corroborates open-data export, extends]** |
| **E7** | **"What got fixed" public wins feed** — highlight resolved hazards over time to sustain momentum | P11,P1,P10 | P3 | S | EV-COLLECTIVE · resolved-lingers (greyed) already shipped. **[corroborates ADR-6, extends]** |
| **E8** | **Trend-over-time view** for council + research (time series, not just a snapshot) | P10,P13 | P3 | M | EV-UNDERREPORT, EV-SKEW · lifecycle timestamps already stored. **[NET-NEW]** |
| **E9** | **Advocacy embed / campaign kit** on the public dashboard (embeddable widget + seeded known hazards) | P11 | P3 | S–M | EV-CROWD-WORKS · `VITE_PUBLIC_DASHBOARD` + seed script exist. **[corroborates public-dashboard mode, extends]** |

---

## Sequenced roadmap

**Sprint 1 — "Close the loop" (Now).** The retention keystone + the integrity guard,
all on rails that exist. → **R2, R1, E1, R3, R4, R8.**
*Outcome:* reporters see their reports land and get fixed; ten reports of one
pothole become one confirmed item; near misses are first-class; the city gets
reliable hand-offs; coverage can't be misread as safety; routing runs on owned
infra.

**Sprint 2 — "Trust at volume" (Next).** Defend the signal once volume (and
adversaries) arrive. → **R5, R6, R7, E2, R9.**
*Outcome:* confirmations resist gaming; one moderator can survive a spam burst;
the privacy/accessibility promises are legible *and* SR-complete; routing serves
families and e-bikes; PII slips through less often.

**Later — "Reach & reuse."** Broaden who reports and who can build on it. →
**E3 (low-tech intake), E4 (service area), E5 (campus on-ramp), R10 (data
dictionary), E6 (city export), R11 (push delivery), E7/E8/E9 (wins feed, trends,
advocacy kit), R12 (ops dashboard).**

Cross-cut, do-anytime afternoon wins: **R10**, **R12**, **E7**, **E9**.

## Recommended first sprint (highest leverage, mostly already-built infra)

1. **R2 + R1 — feedback loop + "me too" confirmation/dedupe.** The single most
   evidence-backed lever: Champaign abandoned a 311 tool because reports vanished
   (EV-ABANDON); Schiff shows visible collective input doubles closure (EV-COLLECTIVE).
   The lifecycle + confirmation rails already exist — this is surfacing, not building.
2. **E1 — near-miss / close-call category.** Cheap taxonomy add that unlocks the
   ~62% leading-indicator class official data misses entirely (EV-CROWD-WORKS,
   EV-UNDERREPORT). Aligns with the taxonomy-validation already planned in ROADMAP §4.
3. **R4 — equity-aware coverage.** Hardens the project's defining "absence ≠ safety"
   claim into something that survives a hostile reading at a council meeting
   (EV-SKEW). The coverage view exists; add normalization + data-desert call-outs.
4. **R3 — 311 hand-off delivery receipts + retry.** Directly engineers against the
   documented abandonment failure mode (EV-ABANDON). Sync-back exists; add receipts
   and reconciliation.
5. **R8 — self-host OSRM.** Flips routing from the rate-limited demo to production
   with no app changes (EV-OSRM) — pure ops, and a prerequisite for E2.

---

## Traceability matrix (persona → findings)

| Persona | Remediations | Expansions |
| --- | --- | --- |
| P1 Commuter | R1, R2, R11 | E7 |
| P2 Parent / cargo | R8 | E1, E2 |
| P3 E-bike | R8 | E1, E2 |
| P4 Recreational | — | E4 |
| P5 Student | R2 | E1, E3, E5 |
| P6 Low-vision / SR | R7 | — |
| P7 Privacy reporter | R7, R9 | — |
| P8 Traffic engineer | R1, R3, R4, R5 | E6 |
| P9 311 admin | R1, R3, R6 | E6 |
| P10 Council / policy | R4, R10 | E3, E7, E8 |
| P11 Advocacy lead | R1, R2, R11 | E5, E7, E9 |
| P12 Moderator | R5, R6, R9 | — |
| P13 Data journalist | R4, R10 | E8 |
| P14 Spam adversary | R5, R6 | — |
| P15 Owner / maintainer | R3, R8, R11, R12 | E6 |

## Net-new findings the existing roadmap doesn't cover

Surfaced only from the panel; not in `docs/ROADMAP.md` or the audits:
**R6** burst/coordinated-spam moderator tooling · **R10** open-data data
dictionary/methodology note · **R12** ops dashboard · **E1** near-miss category
(extends the planned taxonomy) · **E3** low-tech (SMS/QR) intake · **E4**
service-area expansion · **E5** campus/Unitrans on-ramp · **E8** trend-over-time
view. The strongest of these — **near-miss reporting (E1)** and **anti-gaming /
burst defenses (R5/R6)** — are cheap, lean on existing seams, and address the two
things the literature says make-or-break a crowdsourced hazard map: capturing the
leading indicator, and protecting the signal from manipulation.

---

## Validate with real users / risks

This backlog is a **hypothesis from synthetic personas** — validate before
committing engineering:

- **Recruit real roles** (the panel is a casting sheet, not data): beta testers
  ([`BETA.md`](../BETA.md)); the City of Davis Public Works + GOGov/311 contacts;
  the Davis Bicycling Advisory Commission / local advocacy orgs; UC Davis
  Transportation + Unitrans; and — non-negotiable for **R7** — at least one daily
  screen-reader user and a privacy-sensitive reporter.
- **Validate the E1 beta taxonomy before declaring it stable** (ROADMAP §4 already
  calls for this): the implemented near-miss category is a testable hypothesis,
  not evidence that Davis riders use this wording. Confirm which categories and
  labels matter most with real riders before public launch.
- **Pilot R4 (equity normalization) carefully:** ridership/exposure denominators are
  themselves uncertain and can *introduce* bias; pair with the still-open equity
  reviewer sign-off, and never publish a normalized map without the limits note (R10).
- **Risks to weigh:**
  - *R1/R2 visibility cuts both ways* — surfacing "reported to city / fixed" sets an
    expectation the city may not meet; coordinate with P9 before promising it.
  - *R5 anti-Sybil vs. no-accounts* — the product's privacy stance is *no accounts to
    report*; per-actor weighting must not become tracking. This is a genuine tension
    (EV-GAMING vs. privacy-notes.md), not a clean win.
  - *E3 low-tech intake widens reach but also the abuse surface* — sequence it after
    R5/R6.
  - *EV-DANGER's "1,166 in 2024" figure* (cited in advocacy analyses) was **not**
    used here as a hard stat; the FARS-confirmed, twice-corroborated **1,105 (2022)**
    is the load-bearing number. Re-verify any newer FARS release before quoting.

## Honest limits of this exercise
The personas are synthetic; this is a structured guess, not discovery. It can rank
*plausible* work against *real* evidence, but it cannot tell you which items real
Davis riders, the city, or moderators actually want, how many people would use any
of it, or whether the privacy/accessibility designs satisfy those who most need
them — and **none of this is safety data**. Treat the priorities as a starting
agenda for real interviews and a beta, not a commitment. Re-derive after the first
real cohort; expect it to move.

⬅️ **Persona panel & simulated interviews:** [`USER-RESEARCH.md`](./USER-RESEARCH.md).
