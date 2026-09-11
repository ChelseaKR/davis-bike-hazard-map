# Adapting the map to another town

This map's geography is a **place pack**: one validated JSON file holding the
bounding box, centre, named areas with their exposure weights, and the landmark
presets. `place/davis.json` is the pack this build serves. Widening to another town
or corridor is meant to be a new pack, not a patch.

**Extracting the pack does not make a second deployment ready.** The prerequisites
below are not code, and they are the reason this document leads with them.

---

## Before any of the technical steps

Two things gate a second deployment, and neither is satisfiable by editing a file.

**1. A named moderator roster.** There is no unmoderated public photo feed in this
project, by design — moderation exists before launch, and it is a person, not a
setting. A second town without named moderators is a second town without
moderation. See `docs/RESPONSIBLE-TECH-AUDITS.md`.

**2. A privacy review for that town.** Every public coordinate is snapped to a ~70 m
grid before it leaves the server, because a hazard reported outside somebody's house
is a fact about where they live. That grid is not a settled safe value: this project
records it as a **tunable trade-off** whose residual risk is owned by a *privacy
reviewer*, not by the code (`docs/audits/residual-risk.md`, R3). How much a 70 m cell
actually discloses depends on how densely a place is built, so the reviewer's reading
is about the town — and a reading made for Davis is not a reading made for anywhere
else. `DEFAULT_FUZZ_METERS` is per-deployment for that reason, and the place pack
deliberately does **not** carry it: a privacy parameter that travels silently inside a
geography file is a privacy parameter nobody reviews.

Neither prerequisite is checkable by CI, so nothing in this repository will stop you
shipping without them. That is what this section is for.

---

## The pack

A pack is validated by `shared/place.ts` at import time. An unusable pack fails the
import, so the server refuses to boot and every test that touches the map fails at
import rather than running against a partly-filled map.

**Import-time validation alone does not stop a release, and that was measured rather
than assumed.** `npm run build` is `tsc --noEmit && vite build`; neither half executes
the module's top-level code, so a pack with a zero `exposureWeight` planted in it
produced `✓ built in 439ms`, exit code 0, and a `dist/` shipping the broken pack —
while the same sabotage turned 22 test files red. That is why `npm run place:validate`
(`scripts/place-validate.ts`) exists and runs inside `npm run verify` ahead of the
build: it runs the loader for its own sake and exits non-zero.

```jsonc
{
  "packVersion": 1,
  "id": "davis",                       // lowercase kebab-case
  "displayName": "Davis, CA",
  "deploymentName": "Davis Bike Hazard Map", // what the service calls itself; leaves the system in OSM notes
  "bounds":  { "minLat": …, "maxLat": …, "minLng": …, "maxLng": … },
  "center":  { "lat": …, "lng": … },   // must be inside bounds
  "timeZone": "America/Los_Angeles",   // IANA zone; month-by-month trends are bucketed in it
  "outOfBoundsMessage": "Location must be within Davis, CA.",
  "elsewhereAreaName": "Elsewhere in Davis",
  "areas":     [ { "name": …, "minLat": …, "maxLat": …, "minLng": …, "maxLng": …, "exposureWeight": … } ],
  "landmarks": [ { "name": …, "point": { "lat": …, "lng": … } } ]
}
```

### Every field is required. There are no defaults.

This is deliberate, and it is the single most important property of the loader.

The failure mode this project keeps finding in its own output is **an absence
rendered as a value** — something missing, capped or unread, published as if it were
a real measurement. A place pack is an unusually good place for that to happen. If
`exposureWeight` were optional with a default of `1`, a pack that simply forgot to
state a weight would publish an exposure estimate nobody made, and the coverage view
— whose entire job is to say where reports are scarce *relative to ridership* —
would be reporting against a denominator invented by a default parameter.

So the schema is strict in both directions: a **missing** field does not load, and an
**unknown** field does not load either. A silently-ignored `exposureWieght` is the
same defect wearing a typo.

### What a pack is refused for

Each of these is a mistake that would otherwise be invisible in the output rather
than obvious at boot:

| Refusal | Why it matters |
| --- | --- |
| Duplicate area names | Two boxes would silently share one tally. |
| `elsewhereAreaName` equal to a named area | Every unbucketed report would be counted as that area's. |
| `exposureWeight` zero, negative, or absent | A number nobody chose enters the exposure denominator. |
| Inverted bounding box (`min` ≥ `max`) | Accepts nothing, and reads as "no reports here". |
| Centre outside its own bounds | The default map view opens somewhere the map refuses reports. |
| A landmark outside the bounds | A route preset the report validator would then refuse. |
| `timeZone` this runtime does not know | Month-by-month trends would have no calendar to bucket in; a default of UTC would move every evening report at a month's end into the next month. |
| Unknown or misspelled field | See above. |
| Empty `areas` or `landmarks` | A coverage view with nothing to bucket into. |

The loader reports **every** problem at once, not the first, so a town adapting the
map sees the whole list once rather than discovering it one boot at a time.

### What a pack is deliberately NOT refused for

Two properties of the shipped Davis pack look like errors and are not. If you are
tempted to add validation for either, read this first — both changes would reject
`place/davis.json`, and `tests/unit/place.test.ts` will fail if you try.

**Areas may overlap.** `UC Davis campus` overlaps `South Davis`, `West Davis` and
`Central Davis`. The boxes are approximate and **ordered**: the first box containing
a point wins. Overlap is how a small, precise box (a campus) sits inside a large,
coarse one. A no-overlap rule would reject the only pack this repository ships, and
"fixing" the overlap by trimming boxes would silently move real reports between
areas.

**Area boxes may extend past the pack bounds.** `North Davis` reaches `maxLat: 38.6`
against a pack `maxLat` of `38.59`; `South Davis` reaches `minLat: 38.5` against
`38.52`. The overhang is unreachable rather than wrong — a report outside the bounds
is refused before it is ever bucketed. Trimming the boxes to match would be a change
to the map's data, and that is a decision about the town, not about the schema.

---

## Steps

1. **Write the pack.** Copy `place/davis.json`, change every value. Areas are
   ordered, most specific first.
2. **Choose exposure weights honestly.** They are a coarse relative stand-in for
   "how much riding happens here", not a measured ridership figure, and the coverage
   view always shows them next to a limits note. Guessing is expected; guessing and
   then presenting the result as data is not. See
   `docs/audits/coverage-equity.md`.
3. **Register it, then select it.** Add one line to `BUILT_IN_PACKS` in
   `shared/place.ts` giving the pack's id and its file. That makes it *selectable*
   and, because `scripts/place-validate.ts` derives its list from the same registry,
   *validated on every `make verify`* — a pack cannot become selectable while going
   unchecked. Then select it at deploy time: `VITE_PLACE=<id>` for the client build
   and `PLACE=<id>` for the API. Both default to `davis`, and an id that is not in
   the registry is refused with the available ids named — never quietly replaced by
   the default.
4. **Run the gate.** `make verify`. `npm run place:validate` checks every listed pack
   directly and fails the run; the import-time validation additionally fails the
   tests and the server's boot. Note that `tsc` will *not* catch a bad value — it
   checks types, not the numbers in the pack.
5. **Re-check the copy.** The pack carries `displayName`, `outOfBoundsMessage` and
   `elsewhereAreaName`. Everything else the interface says about Davis by name is
   still in the translation catalogues (`src/i18n/locales/`), not in the pack.

---

## What is still Davis-shaped

Extracting the geography did not extract everything, and claiming otherwise would be
the same kind of overstatement this document exists to avoid. Still hard-coded, and
tracked on issue #181:

- **Interface copy** naming Davis, in `src/i18n/locales/en.json` — the app title, the
  coverage hint, the map's `aria-label`, and the two out-of-bounds messages.
- **Server-side text that names Davis but is only ever served.** `server/openapi.ts`'s
  API title and several `server/lib/openapi-registry.ts` descriptions say Davis.
  These are read by whoever calls this deployment's own API; nothing about them
  reaches another system, and correcting them is copy-editing rather than a data
  question.
- **Licence and attribution text** for the tile layer — `config.tileAttribution` in
  `src/config.ts` is a literal with no environment override. It is OpenStreetMap's
  required attribution, so it is correct for any town using OSM tiles and wrong only
  for a deployment that changes tile provider.
- **The default 311 provider and service code.** Every 311 endpoint, key and secret
  in `server/config.ts` is already read from the environment and defaults to empty,
  which means dry-run — none of them is a Davis constant. What is a Davis-shaped
  default is `HANDOFF_PROVIDER` falling back to `gogov` (the vendor Davis uses) and
  `OPEN311_SERVICE_CODE` falling back to `bike-hazard`. Both are one environment
  variable away.
- **Serving two towns from one deployment.** Selection picks one pack per build and
  per process; there is no per-request town.

**Taken off this list because it was fixed, not because it was wrong:** the note
body **posted to OpenStreetMap**. It used to write *"reported by cyclists via the
Davis Bike Hazard Map"* and *"Davis Bike Hazard Map reference &lt;id&gt;"* from two
literals in `server/lib/osmNotes.ts`, so a second town would have published its
hazards into OSM — public, permanent, and not retractable by redeploying — under
Davis's name. This document argued that what a second deployment calls itself is a
naming decision rather than a substitution, and that is right; the answer is that
the pack is where a town states it. `deploymentName` is a required pack field, so a
second town writes its own name and a pack that omits one does not load at all.
Nothing here invents a name for anybody.

**Not on this list, and previously on it in error:** the **tile and routing service
URLs**. `VITE_TILE_URL` (`src/config.ts`), `ROUTING_URL` and `OSM_NOTES_API_URL`
(`server/config.ts`) are all read from the environment, and their defaults are
OpenStreetMap-project services that behave identically for any town. They are
deployment configuration, and they were never Davis constants.
`tests/unit/adaptingATown.test.ts` holds that correction against the tree so it
cannot quietly become wrong again.

## Selecting a pack

Two variables, one meaning:

| Variable | Read by | When |
| --- | --- | --- |
| `VITE_PLACE` | the client bundle | `vite build` — Vite substitutes the value into the bundle, so it is fixed at build time |
| `PLACE` | the API server | process start |

Unset, both fall back to `davis`.

**They must not disagree.** `npm start` serves the API and the built SPA from one
process and one environment, so `PLACE=woodland` with `VITE_PLACE` left on `davis`
would draw a Davis map in front of a Woodland validator: the client would show one
town's bounds while the server refused every report outside another's. Selection
refuses that combination at boot rather than applying a precedence rule, because the
symptom — reports rejected at coordinates the map says are in range — reads as a
validation bug and not as a misconfiguration.

A **split** deployment (SPA on a CDN, API elsewhere) has two environments and no
process that can compare them, so nothing can refuse it for you. `GET /api/health`
reports the pack id the API is validating against, which is what makes that case
checkable at all — compare it against the id the client was built with.

### Why there is no `PLACE_PATH`

Issue #181 asked for `VITE_PLACE` **and** `PLACE_PATH`, a filesystem path the server
would read at boot. That half is deliberately not built. A path the *server* reads
cannot reach the *client* bundle, which is compiled ahead of time from a static
import, so `PLACE_PATH` would let the two halves serve different towns by
construction — the same divergence the rule above exists to refuse, with no way to
detect it, since a pack loaded from an arbitrary path has no id to compare.

Packs are also not a plugin surface: an arbitrary file path is one more thing a
deployment can point at something unreviewed. A registry entry is a code change that
goes through review, and the same review that adds a town is where the moderator
roster and the privacy reading belong.

---

## Checking your work

`tests/fixtures/place/synthetic-town.json` is a deliberately synthetic second pack
that the test suite drives through the same bucketing, tallying, landmark-lookup and
bounds-validation code that serves Davis. It is the falsification for "the map is
parameterised over its town": if that claim stops being true, those tests fail.
It is a fixture, not a town, and not a deployment target.
