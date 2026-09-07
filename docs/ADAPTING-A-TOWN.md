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

**2. A privacy review for that town.** Every public coordinate is snapped to a fuzz
grid before it leaves the server, because a hazard reported outside somebody's house
is a fact about where they live. The grid was sized against Davis's density. A denser
or sparser town changes what the same grid discloses, and that has to be looked at
rather than assumed to transfer.

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
  "bounds":  { "minLat": …, "maxLat": …, "minLng": …, "maxLng": … },
  "center":  { "lat": …, "lng": … },   // must be inside bounds
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
3. **Point the build at it.** `shared/place.ts` imports `place/davis.json`
   directly today; a second pack means changing that import. Build-time pack
   *selection* (`VITE_PLACE` / `PLACE_PATH`) is not built yet — see issue #181.
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

- **Interface copy** naming Davis, in `src/i18n/locales/`.
- **311 provider configuration** and its defaults, in `server/config.ts`.
- **Tile and routing service URLs**, in `src/config.ts` and `server/config.ts`.
- **Licence and attribution text** for the tile layer.
- **Build-time pack selection** — one pack is compiled in; there is no `VITE_PLACE`
  switch, and no support for serving two towns from one deployment.

## Checking your work

`tests/fixtures/place/synthetic-town.json` is a deliberately synthetic second pack
that the test suite drives through the same bucketing, tallying, landmark-lookup and
bounds-validation code that serves Davis. It is the falsification for "the map is
parameterised over its town": if that claim stops being true, those tests fail.
It is a fixture, not a town, and not a deployment target.
