/**
 * The place pack: every geographic fact this map holds about the town it serves,
 * as validated data rather than as constants scattered through the code.
 *
 * Before this file, "Davis" was six literals in five modules — `DAVIS_BOUNDS` and
 * `DAVIS_CENTER` in `validation.ts`, `DAVIS_AREAS` in `areas.ts`, `DAVIS_LANDMARKS`
 * in `src/lib/landmarks.ts`, and a second, hand-copied latitude/longitude pair in
 * `routing.ts` that a comment promised "matches DAVIS_CENTER" and that nothing
 * checked. Adapting the map to another town meant editing code in five places and
 * hoping the sixth had been noticed.
 *
 * ## Why the loader refuses instead of defaulting
 *
 * The failure this project keeps finding in its own output is **an absence rendered
 * as a value**: something missing, capped or unread, published as if it were a real
 * measurement. A place pack is an unusually good place for that failure to happen.
 * If `exposureWeight` were optional with a default of 1, a pack that simply forgot
 * to state a weight would publish an exposure estimate nobody made, and the coverage
 * view — whose whole job is to say where reports are scarce *relative to ridership* —
 * would report against a denominator that was invented by a default parameter.
 *
 * So: **every field is required and the schema is `.strict()`.** There are no
 * defaults anywhere in this file. A pack missing a field does not load, and a pack
 * with a misspelled field does not load either — a silently-ignored `exposureWieght`
 * is the same defect wearing a typo.
 *
 * ## What is deliberately NOT rejected
 *
 * Two properties of the shipped Davis pack look like errors and are not:
 *
 * 1. **Areas overlap.** `UC Davis campus` overlaps `South Davis`, `West Davis` and
 *    `Central Davis`. This is by design and documented in `areas.ts`: the boxes are
 *    approximate and *ordered*, and the first box containing a point wins. A schema
 *    that rejected overlapping areas would reject the only pack this repository
 *    ships. `tests/unit/place.test.ts` pins that ordering behaviour so a future "fix" that turns
 *    overlap into an error fails loudly instead of silently reassigning real reports.
 *
 * 2. **Two area boxes extend past the pack bounds.** `North Davis` reaches
 *    `maxLat: 38.6` against a pack `maxLat` of `38.59`, and `South Davis` reaches
 *    `minLat: 38.5` against `38.52`. The overhang is unreachable rather than wrong —
 *    a report outside the bounds is refused before it is ever bucketed — and
 *    trimming the boxes would move real reports between areas, which is a decision
 *    about the map's data, not about its schema.
 *
 * What IS rejected is the class of pack error that would be invisible in the output:
 * duplicate area names (two boxes silently sharing one tally), an
 * `elsewhereAreaName` that collides with a named area (every unbucketed report
 * quietly counted as that area's), a non-positive `exposureWeight`, an inverted
 * bounding box, a centre outside its own bounds, and a landmark outside them — a
 * route preset the report validator would refuse.
 */
import { z } from 'zod';

import davisPackJson from '../place/davis.json';

const boundsSchema = z
  .strictObject({
    minLat: z.number().gte(-90).lte(90),
    maxLat: z.number().gte(-90).lte(90),
    minLng: z.number().gte(-180).lte(180),
    maxLng: z.number().gte(-180).lte(180),
  })
  .refine((b) => b.minLat < b.maxLat, { message: 'bounds.minLat must be south of bounds.maxLat' })
  .refine((b) => b.minLng < b.maxLng, { message: 'bounds.minLng must be west of bounds.maxLng' });

const pointSchema = z
  .strictObject({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) });

const areaSchema = z
  .strictObject({
    name: z.string().min(1),
    minLat: z.number(),
    maxLat: z.number(),
    minLng: z.number(),
    maxLng: z.number(),
    // Required on purpose, and positive on purpose. A missing weight defaulted to 1,
    // or a weight of 0, would put a number nobody chose into the coverage view's
    // exposure denominator. See the module docstring.
    exposureWeight: z.number().finite().positive(),
  })
  .refine((a) => a.minLat < a.maxLat, { message: 'area minLat must be south of maxLat' })
  .refine((a) => a.minLng < a.maxLng, { message: 'area minLng must be west of maxLng' });

const landmarkSchema = z.strictObject({ name: z.string().min(1), point: pointSchema });

/**
 * The pack schema. Structural checks only; the cross-field checks that need the
 * whole pack (names unique, centre inside bounds, landmarks inside bounds) run in
 * {@link parsePlacePack}, where they can name the offending entry.
 */
export const placePackSchema = z
  .strictObject({
    packVersion: z.literal(1),
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'pack id must be lowercase kebab-case'),
    displayName: z.string().min(1),
    bounds: boundsSchema,
    center: pointSchema,
    outOfBoundsMessage: z.string().min(1),
    elsewhereAreaName: z.string().min(1),
    areas: z.array(areaSchema).min(1),
    landmarks: z.array(landmarkSchema).min(1),
  });

export type PlacePack = z.infer<typeof placePackSchema>;
export type PlaceArea = PlacePack['areas'][number];
export type PlaceLandmark = PlacePack['landmarks'][number];

/** Thrown when a pack cannot be loaded. Never swallowed, never defaulted around. */
export class PlacePackError extends Error {
  constructor(source: string, problems: string[]) {
    super(`place pack ${source} is not usable:\n  - ${problems.join('\n  - ')}`);
    this.name = 'PlacePackError';
  }
}

function contains(
  bounds: PlacePack['bounds'],
  point: { lat: number; lng: number },
): boolean {
  return (
    point.lat >= bounds.minLat &&
    point.lat <= bounds.maxLat &&
    point.lng >= bounds.minLng &&
    point.lng <= bounds.maxLng
  );
}

/**
 * Validate a candidate pack, or throw {@link PlacePackError} naming every problem.
 *
 * Every problem, not the first: a town adapting the map should see the whole list
 * once rather than discover it one boot at a time.
 */
export function parsePlacePack(raw: unknown, source: string): PlacePack {
  const parsed = placePackSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PlacePackError(
      source,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const pack = parsed.data;
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const area of pack.areas) {
    if (seen.has(area.name)) {
      problems.push(
        `areas: duplicate name ${JSON.stringify(area.name)} — two boxes would share one tally`,
      );
    }
    seen.add(area.name);
  }
  if (seen.has(pack.elsewhereAreaName)) {
    problems.push(
      `elsewhereAreaName ${JSON.stringify(pack.elsewhereAreaName)} is also a named area — ` +
        `every report outside the named boxes would be counted as that area's`,
    );
  }

  const landmarkNames = new Set<string>();
  for (const landmark of pack.landmarks) {
    if (landmarkNames.has(landmark.name)) {
      problems.push(`landmarks: duplicate name ${JSON.stringify(landmark.name)}`);
    }
    landmarkNames.add(landmark.name);
    if (!contains(pack.bounds, landmark.point)) {
      problems.push(
        `landmarks: ${JSON.stringify(landmark.name)} is outside the pack bounds — ` +
          `a route preset the report validator would refuse`,
      );
    }
  }

  if (!contains(pack.bounds, pack.center)) {
    problems.push('center is outside the pack bounds');
  }

  if (problems.length > 0) throw new PlacePackError(source, problems);
  return pack;
}

/**
 * The pack this build serves.
 *
 * Validated at module load, which means an unusable pack fails the import — the
 * server refuses to boot and `vite build` refuses to emit — rather than producing a
 * map whose bounds are `undefined`.
 */
export const PLACE: PlacePack = parsePlacePack(davisPackJson, 'place/davis.json');
