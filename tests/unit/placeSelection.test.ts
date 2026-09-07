/**
 * Which place pack a build serves, and how that choice can go wrong.
 *
 * Selection is the half of #181 that was still Davis-shaped: one pack was compiled
 * in and there was no way to ask for another. The risk in adding one is not that it
 * fails loudly — it is that it fails quietly, by serving Davis to a deployment that
 * asked for somewhere else. Every test here is about a wrong pack being served
 * *without saying so*.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import syntheticJson from '../fixtures/place/synthetic-town.json';
import davisJson from '../../place/davis.json';
import {
  BUILT_IN_PACKS,
  DEFAULT_PLACE_ID,
  PLACE,
  PlacePackError,
  resolvePlacePack,
  selectedPlaceId,
} from '../../shared/place.ts';

const ROOT = process.cwd();

type Registry = Readonly<Record<string, { source: string; raw: unknown }>>;

const SYNTHETIC_REGISTRY: Registry = {
  davis: { source: 'place/davis.json', raw: davisJson },
  'synthetic-town': {
    source: 'tests/fixtures/place/synthetic-town.json',
    raw: syntheticJson,
  },
};

/**
 * Set both env surfaces directly rather than through `vi.stubEnv`, which writes to
 * `process.env` *and* `import.meta.env` at once and so cannot express the case this
 * file most needs: the two disagreeing.
 */
function setEnv(vitePlace: string | undefined, serverPlace: string | undefined): void {
  if (vitePlace === undefined) delete import.meta.env.VITE_PLACE;
  else import.meta.env.VITE_PLACE = vitePlace;
  if (serverPlace === undefined) delete process.env.PLACE;
  else process.env.PLACE = serverPlace;
}

afterEach(() => {
  setEnv(undefined, undefined);
});

describe('resolving a pack by id', () => {
  it('serves the default pack when nothing selects one', () => {
    expect(selectedPlaceId()).toBe(DEFAULT_PLACE_ID);
    expect(PLACE.id).toBe('davis');
  });

  it('refuses an unknown id instead of falling back to the default', () => {
    // The fallback is the defect. A deployment that asked for Woodland and silently
    // got Davis would validate Woodland reports against Davis bounds and tally them
    // into Davis areas, and nothing in the output would say so.
    expect(() => resolvePlacePack('woodland')).toThrow(PlacePackError);
    expect(() => resolvePlacePack('woodland')).toThrow(/no such pack in this build/);
    expect(() => resolvePlacePack('woodland')).toThrow(/available: davis/);
  });

  it('says the registry is empty rather than "no such pack"', () => {
    // A registry emptied by a bad refactor is a different outage from a typo in an
    // id, and reporting the second for the first sends the operator to the wrong file.
    expect(() => resolvePlacePack('davis', {})).toThrow(/no packs are compiled into this build/);
  });

  it('resolves a second pack through exactly the same loader', () => {
    const pack = resolvePlacePack('synthetic-town', SYNTHETIC_REGISTRY);
    expect(pack.id).toBe('synthetic-town');
    expect(pack.areas.length).toBeGreaterThan(0);
    // Not the Davis pack under another name.
    expect(pack.bounds).not.toEqual(PLACE.bounds);
  });

  it('refuses a registered pack whose contents are unusable', () => {
    // Registration is not validation. A pack can be selectable and still be broken,
    // and selection must not be the thing that skips the check.
    const broken = JSON.parse(JSON.stringify(davisJson)) as Record<string, unknown>;
    delete broken.landmarks;
    expect(() =>
      resolvePlacePack('davis', { davis: { source: 'broken.json', raw: broken } }),
    ).toThrow(PlacePackError);
  });
});

describe('the environment that selects a pack', () => {
  it('takes VITE_PLACE in a client build', () => {
    setEnv('synthetic-town', undefined);
    expect(selectedPlaceId()).toBe('synthetic-town');
  });

  it('takes PLACE on the server', () => {
    setEnv(undefined, 'synthetic-town');
    expect(selectedPlaceId()).toBe('synthetic-town');
  });

  it('accepts the two agreeing', () => {
    setEnv('synthetic-town', 'synthetic-town');
    expect(selectedPlaceId()).toBe('synthetic-town');
  });

  it('refuses the two disagreeing rather than picking a winner', () => {
    // `npm start` serves the API and the built SPA from one process and one
    // environment. A precedence rule here would draw one town's bounds on the map
    // while the server refused every report outside another's — a divergence visible
    // only as reports being rejected at coordinates the map says are in range.
    setEnv('davis', 'synthetic-town');
    expect(() => selectedPlaceId()).toThrow(PlacePackError);
    expect(() => selectedPlaceId()).toThrow(/disagree/);
  });

  it('treats an empty string as unset, not as an id', () => {
    // `PLACE=` in a deploy template is a variable someone meant to fill in. Taken as
    // an id it resolves to nothing and reads as a typo; taken as unset it serves the
    // default, which is what an unfilled template means.
    setEnv('', '');
    expect(selectedPlaceId()).toBe(DEFAULT_PLACE_ID);
  });

  it('does not read PLACE as a disagreement when only one side is set', () => {
    setEnv(undefined, 'davis');
    expect(selectedPlaceId()).toBe('davis');
    setEnv('davis', undefined);
    expect(selectedPlaceId()).toBe('davis');
  });
});

describe('the registry and the gate cannot drift apart', () => {
  it('points every registered pack at a file that exists', () => {
    for (const [id, entry] of Object.entries(BUILT_IN_PACKS)) {
      expect(existsSync(join(ROOT, entry.source)), `${id} -> ${entry.source}`).toBe(true);
    }
  });

  it('validates every registered pack in the build gate', () => {
    // `scripts/place-validate.ts` derives its shippable half from this same registry
    // rather than retyping it, so a pack cannot become selectable by `VITE_PLACE`
    // while going unvalidated. This is the assertion that holds that derivation in
    // place if someone re-hardcodes the list.
    const source = readFileSync(join(ROOT, 'scripts/place-validate.ts'), 'utf8');
    expect(source).toContain('Object.values(BUILT_IN_PACKS).map((entry) => entry.source)');
  });
});
