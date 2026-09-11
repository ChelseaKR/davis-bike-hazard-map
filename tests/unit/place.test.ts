import { describe, it, expect } from 'vitest';

import syntheticJson from '../fixtures/place/synthetic-town.json';
import davisJson from '../../place/davis.json';
import { PLACE, PlacePackError, parsePlacePack, type PlacePack } from '../../shared/place.ts';
import { areaNameFor, tallyByArea, PLACE_AREAS, ELSEWHERE_AREA } from '../../shared/areas.ts';
import { placePointSchemaFor, PLACE_BOUNDS, PLACE_CENTER } from '../../shared/validation.ts';
import { landmarkByName, PLACE_LANDMARKS } from '../../src/lib/landmarks.ts';

const SYNTHETIC = parsePlacePack(syntheticJson, 'tests/fixtures/place/synthetic-town.json');

/** A structurally valid pack, as a plain object, for mutation in the refusal tests. */
function validPack(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(davisJson)) as Record<string, unknown>;
}

describe('the shipped Davis pack pins the values it replaced', () => {
  // These are LITERALS on purpose. The extraction's whole risk is that a bound or a
  // weight quietly changes on the way from a `const` into a JSON file, and no
  // property test can catch a wrong constant — only a test that names the number.
  // Every figure below is the value that stood in the code before `place/davis.json`
  // existed (shared/validation.ts, shared/areas.ts, src/lib/landmarks.ts,
  // shared/routing.ts) at commit 8214f61.

  it('keeps the bounding box byte-for-byte', () => {
    expect(PLACE_BOUNDS).toEqual({
      minLat: 38.52,
      maxLat: 38.59,
      minLng: -121.82,
      maxLng: -121.68,
    });
  });

  it('keeps the centre, which routing.ts used to duplicate by hand', () => {
    expect(PLACE_CENTER).toEqual({ lat: 38.5449, lng: -121.7405 });
    // `shared/routing.ts` carried its own `DAVIS_LAT = 38.5449` / `DAVIS_LNG =
    // -121.7405` with a comment claiming the values matched, and nothing checked it.
    // They are gone; this assertion is what now holds the number.
    expect(PLACE_CENTER.lat).toBe(38.5449);
    expect(PLACE_CENTER.lng).toBe(-121.7405);
  });

  it('keeps every area box, in order, with its exposure weight', () => {
    expect(PLACE_AREAS).toEqual([
      { name: 'UC Davis campus', minLat: 38.53, maxLat: 38.545, minLng: -121.77, maxLng: -121.745, exposureWeight: 5 },
      { name: 'North Davis', minLat: 38.56, maxLat: 38.6, minLng: -121.8, maxLng: -121.7, exposureWeight: 3 },
      { name: 'South Davis', minLat: 38.5, maxLat: 38.535, minLng: -121.8, maxLng: -121.7, exposureWeight: 2 },
      { name: 'West Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.8, maxLng: -121.755, exposureWeight: 3 },
      { name: 'East Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.73, maxLng: -121.7, exposureWeight: 3 },
      { name: 'Central Davis', minLat: 38.535, maxLat: 38.56, minLng: -121.755, maxLng: -121.73, exposureWeight: 4 },
    ]);
  });

  it('keeps the ten landmark presets and their coordinates', () => {
    expect(PLACE_LANDMARKS).toEqual([
      { name: 'UC Davis Memorial Union', point: { lat: 38.5421, lng: -121.7494 } },
      { name: 'Downtown Davis (E St Plaza)', point: { lat: 38.5447, lng: -121.7405 } },
      { name: 'Davis Amtrak Station', point: { lat: 38.5419, lng: -121.7376 } },
      { name: 'Davis Food Co-op', point: { lat: 38.5462, lng: -121.7385 } },
      { name: 'North Davis (Covell & F)', point: { lat: 38.5611, lng: -121.7385 } },
      { name: 'South Davis (Montgomery Elementary)', point: { lat: 38.5318, lng: -121.7546 } },
      { name: 'West Davis (Lake Blvd & Arlington)', point: { lat: 38.5556, lng: -121.7745 } },
      { name: 'East Davis (Mace & 2nd)', point: { lat: 38.5435, lng: -121.7126 } },
      { name: 'Davis Community Park', point: { lat: 38.5519, lng: -121.7503 } },
      { name: 'Sutter Davis Hospital', point: { lat: 38.5571, lng: -121.7745 } },
    ]);
  });

  it('keeps the out-of-bounds message and the elsewhere bucket name', () => {
    expect(PLACE.outOfBoundsMessage).toBe('Location must be within Davis, CA.');
    expect(ELSEWHERE_AREA).toBe('Elsewhere in Davis');
  });

  it('keeps the deployment name that the OSM note body used to hard-code', () => {
    // A literal, for the same reason as every figure above: this string is
    // written into notes posted to OpenStreetMap, which are public and
    // permanent, so a silent change to it is a change to published data. The
    // value is exactly the wording `server/lib/osmNotes.ts` used to carry.
    expect(PLACE.deploymentName).toBe('Davis Bike Hazard Map');
    // And it is not the same field as `displayName`: one names the town, the
    // other names the service. Collapsing them would put "Davis, CA" into a
    // sentence that reads "via the Davis, CA".
    expect(PLACE.displayName).toBe('Davis, CA');
  });
});

describe('the loader refuses rather than defaulting', () => {
  it('refuses a pack with a missing exposureWeight instead of assuming one', () => {
    const pack = validPack();
    const areas = pack.areas as Record<string, unknown>[];
    delete areas[0].exposureWeight;
    expect(() => parsePlacePack(pack, 'incomplete')).toThrow(PlacePackError);
    // The point of the refusal: a default of 1 here would put a number nobody
    // chose into the coverage view's exposure denominator.
    expect(() => parsePlacePack(pack, 'incomplete')).toThrow(/exposureWeight/);
  });

  it('refuses a misspelled field rather than silently ignoring it', () => {
    const pack = validPack();
    const areas = pack.areas as Record<string, unknown>[];
    areas[0].exposureWieght = areas[0].exposureWeight;
    delete areas[0].exposureWeight;
    expect(() => parsePlacePack(pack, 'typo')).toThrow(PlacePackError);
  });

  it.each([
    'packVersion',
    'id',
    'displayName',
    'deploymentName',
    'bounds',
    'center',
    'timeZone',
    'outOfBoundsMessage',
    'elsewhereAreaName',
    'areas',
    'landmarks',
  ])('refuses a pack with no %s', (field) => {
    const pack = validPack();
    delete pack[field];
    expect(() => parsePlacePack(pack, `missing-${field}`)).toThrow(PlacePackError);
  });

  it('refuses a time zone this runtime does not know, rather than bucketing months in UTC', () => {
    for (const zone of ['America/Davis', 'PST', 'UTC+8', '']) {
      const pack = validPack();
      pack.timeZone = zone;
      expect(() => parsePlacePack(pack, `zone-${zone}`), zone).toThrow(PlacePackError);
    }
    const pack = validPack();
    pack.timeZone = 'America/Los_Angeles';
    expect(parsePlacePack(pack, 'zone-ok').timeZone).toBe('America/Los_Angeles');
  });

  it('refuses a zero or negative exposure weight', () => {
    for (const weight of [0, -1]) {
      const pack = validPack();
      (pack.areas as Record<string, unknown>[])[0].exposureWeight = weight;
      expect(() => parsePlacePack(pack, 'bad-weight')).toThrow(PlacePackError);
    }
  });

  it('refuses duplicate area names, which would silently share one tally', () => {
    const pack = validPack();
    const areas = pack.areas as Record<string, unknown>[];
    areas[1].name = areas[0].name;
    expect(() => parsePlacePack(pack, 'dupe')).toThrow(/duplicate name/);
  });

  it('refuses an elsewhere bucket that collides with a named area', () => {
    const pack = validPack();
    pack.elsewhereAreaName = (pack.areas as Record<string, unknown>[])[0].name;
    // Without this check every unbucketed report would be counted as that area's —
    // absence rendered as a value, in the one view built to stop exactly that.
    expect(() => parsePlacePack(pack, 'collide')).toThrow(/is also a named area/);
  });

  it('refuses a landmark outside the bounds', () => {
    const pack = validPack();
    (pack.landmarks as Record<string, unknown>[])[0].point = { lat: 0, lng: 0 };
    expect(() => parsePlacePack(pack, 'stray-landmark')).toThrow(/outside the pack bounds/);
  });

  it('refuses a centre outside the bounds', () => {
    const pack = validPack();
    pack.center = { lat: 0, lng: 0 };
    expect(() => parsePlacePack(pack, 'stray-centre')).toThrow(/center is outside/);
  });

  it('refuses an inverted bounding box', () => {
    const pack = validPack();
    pack.bounds = { minLat: 38.59, maxLat: 38.52, minLng: -121.82, maxLng: -121.68 };
    expect(() => parsePlacePack(pack, 'inverted')).toThrow(PlacePackError);
  });

  it('names every problem at once, not just the first', () => {
    const pack = validPack();
    pack.center = { lat: 0, lng: 0 };
    (pack.landmarks as Record<string, unknown>[])[0].point = { lat: 0, lng: 0 };
    let message = '';
    try {
      parsePlacePack(pack, 'two-problems');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/center is outside/);
    expect(message).toMatch(/outside the pack bounds/);
  });
});

describe('overlapping areas are deliberate, and order resolves them', () => {
  // This is the assertion that stops a future "pack validation" change from turning
  // the shipped Davis pack into an invalid one. `UC Davis campus` genuinely overlaps
  // `South Davis`, `West Davis` and `Central Davis`; the boxes are approximate and
  // ORDERED, and the first containing box wins.
  it('the Davis pack really does contain overlapping boxes', () => {
    const overlapping: string[] = [];
    for (let i = 0; i < PLACE_AREAS.length; i += 1) {
      for (let j = i + 1; j < PLACE_AREAS.length; j += 1) {
        const a = PLACE_AREAS[i];
        const b = PLACE_AREAS[j];
        if (a.minLat < b.maxLat && b.minLat < a.maxLat && a.minLng < b.maxLng && b.minLng < a.maxLng) {
          overlapping.push(`${a.name} x ${b.name}`);
        }
      }
    }
    expect(overlapping).toEqual([
      'UC Davis campus x South Davis',
      'UC Davis campus x West Davis',
      'UC Davis campus x Central Davis',
    ]);
  });

  it('a point in an overlap is bucketed into the FIRST matching box', () => {
    // Inside both `UC Davis campus` (listed first) and `West Davis`.
    const inBoth = { lat: 38.54, lng: -121.76 };
    expect(areaNameFor(inBoth)).toBe('UC Davis campus');
  });
});

describe('a second pack drives the same code', () => {
  it('buckets points by the second pack, not by Davis', () => {
    const inOldQuarter = { lat: 10.05, lng: 20.05 };
    expect(areaNameFor(inOldQuarter, SYNTHETIC)).toBe('Old Quarter');
    // The same point against the shipped pack is nowhere near a named Davis box.
    expect(areaNameFor(inOldQuarter)).toBe(ELSEWHERE_AREA);
  });

  it('resolves the second pack’s own overlap by its own order', () => {
    // Inside both `Old Quarter` (first) and `Riverside`.
    expect(areaNameFor({ lat: 10.15, lng: 20.15 }, SYNTHETIC)).toBe('Old Quarter');
  });

  it('tallies into the second pack’s areas and its own elsewhere bucket', () => {
    const tally = tallyByArea(
      [
        { lat: 10.05, lng: 20.05 }, // Old Quarter
        { lat: 10.25, lng: 20.25 }, // Riverside
        { lat: 10.35, lng: 20.35 }, // inside bounds, outside both boxes
      ],
      SYNTHETIC,
    );
    expect(tally).toEqual([
      { name: 'Old Quarter', count: 1 },
      { name: 'Riverside', count: 1 },
      { name: 'Elsewhere in Synthetic Town', count: 1 },
    ]);
  });

  it('keeps a zero-report area visible rather than dropping it', () => {
    const tally = tallyByArea([{ lat: 10.05, lng: 20.05 }], SYNTHETIC);
    expect(tally).toEqual([
      { name: 'Old Quarter', count: 1 },
      { name: 'Riverside', count: 0 },
    ]);
  });

  it('resolves landmark presets from the second pack', () => {
    expect(landmarkByName('Synthetic Station', SYNTHETIC)).toEqual({ lat: 10.05, lng: 20.05 });
    // A Davis preset is not a Synthetic Town preset, and vice versa.
    expect(landmarkByName('Davis Amtrak Station', SYNTHETIC)).toBeUndefined();
    expect(landmarkByName('Synthetic Station')).toBeUndefined();
  });

  it('accepts and refuses points by the second pack’s bounds, with its own message', () => {
    const schema = placePointSchemaFor(SYNTHETIC);
    expect(schema.safeParse({ lat: 10.2, lng: 20.2 }).success).toBe(true);
    const rejected = schema.safeParse(PLACE_CENTER);
    expect(rejected.success).toBe(false);
    if (!rejected.success) {
      expect(rejected.error.issues[0].message).toBe('Location must be within Synthetic Town.');
    }
  });

  it('refuses the Davis centre and accepts the synthetic centre — the packs really differ', () => {
    const davisSchema = placePointSchemaFor(PLACE as PlacePack);
    expect(davisSchema.safeParse(PLACE_CENTER).success).toBe(true);
    expect(davisSchema.safeParse(SYNTHETIC.center).success).toBe(false);
  });
});
