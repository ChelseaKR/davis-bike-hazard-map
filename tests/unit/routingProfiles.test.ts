/**
 * Named routing profiles (E2 / issue #178).
 *
 * A profile is a stated preference over *reported* hazards. Four things have to
 * hold, and each is a distinct way this could quietly mislead a rider:
 *
 *  1. `default` is unchanged — **byte-for-byte**, not "close enough". A profile
 *     layer that shifted the existing route by a metre would silently re-rank
 *     every plan the planner has ever produced.
 *  2. `family-safest` never routes through a high-severity hazard while any
 *     alternative exists. That is an absolute claim, so it is a lexicographic
 *     rule rather than a large weight: a finite penalty, however big, is beaten
 *     by a long enough detour, and the endpoints nobody tried are exactly where
 *     that would surface.
 *  3. An unknown profile is refused, not defaulted. A rider who asked for
 *     `family-safest` and was quietly given the default route would be told the
 *     map had avoided things it had not.
 *  4. A profile never changes what the rider is *told* is on the route. It moves
 *     the cost of a hazard; `nearby` is the same list for every profile.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROUTE_PROFILE_ID,
  ROUTE_PROFILES,
  ROUTE_PROFILE_IDS,
  UnknownRouteProfileError,
  hasHighSeverityNearby,
  hazardPenalty,
  profileWeight,
  rankRoutes,
  resolveRouteProfile,
  resolveScoringOptions,
  scoreRoute,
  type Route,
  type RouteScoringOptions,
} from '../../shared/routing.ts';
import { HAZARD_CATEGORIES, type Hazard } from '../../shared/types.ts';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function hazard(over: Partial<Hazard> = {}): Hazard {
  return {
    id: 'h1',
    category: 'pothole',
    severity: 'high',
    description: null,
    location: { lat: 38.545, lng: -121.74 },
    photoUrl: null,
    thumbnailUrl: null,
    status: 'approved',
    confirmations: 0,
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW + 30 * DAY,
    ...over,
  };
}

/** West→east through central Davis, passing the hazard fixture above. */
const throughHazard: Route = {
  geometry: [
    { lat: 38.545, lng: -121.75 },
    { lat: 38.545, lng: -121.73 },
  ],
  distanceMeters: 1740,
  durationSeconds: 400,
  steps: [],
};

/** A clear parallel street 500 m north, and deliberately much longer. */
const clearButLong: Route = {
  geometry: [
    { lat: 38.5495, lng: -121.75 },
    { lat: 38.5495, lng: -121.73 },
  ],
  distanceMeters: 9000,
  durationSeconds: 2100,
  steps: [],
};

/**
 * Options as the production path resolves them.
 *
 * `resolveScoringOptions` rather than a hand-built object: `hazardPenalty` takes
 * already-resolved options, so a fixture that spread `DEFAULT_SCORING` by hand
 * would silently drop every profile's `scoring` overrides and measure only its
 * category multipliers. That is what the first run of this file did.
 */
const opts = (over: Partial<RouteScoringOptions> = {}): RouteScoringOptions =>
  resolveScoringOptions({ now: NOW, ...over });

describe('the profile table itself', () => {
  it('declares every id it lists, keyed by its own id', () => {
    // A table whose key and `id` disagree would resolve one profile and report
    // another, which is the whole failure mode `profileApplied` exists to catch.
    for (const id of ROUTE_PROFILE_IDS) {
      expect(ROUTE_PROFILES[id]).toBeDefined();
      expect(ROUTE_PROFILES[id].id).toBe(id);
    }
    expect(Object.keys(ROUTE_PROFILES).sort()).toEqual([...ROUTE_PROFILE_IDS].sort());
  });

  it('names only real hazard categories in its multipliers', () => {
    // A typo'd category is a weight that silently never applies: the multiplier
    // lookup falls back to 1 and nothing anywhere says the entry is dead.
    for (const id of ROUTE_PROFILE_IDS) {
      for (const category of Object.keys(ROUTE_PROFILES[id].categoryMultipliers)) {
        expect(HAZARD_CATEGORIES).toContain(category);
      }
    }
  });

  it('leaves `default` with no weights and no refusal at all', () => {
    const base = ROUTE_PROFILES[DEFAULT_ROUTE_PROFILE_ID];
    expect(base.scoring).toEqual({});
    expect(base.categoryMultipliers).toEqual({});
    expect(base.refuseHighSeverityWhenAlternativeExists).toBe(false);
  });

  it('multiplies an unnamed category by exactly 1', () => {
    // Exactly 1, because that is what makes `default` byte-identical below
    // rather than merely indistinguishable at the precision anyone checks.
    expect(profileWeight('other', ROUTE_PROFILES['family-safest'])).toBe(1);
    expect(profileWeight('dangerous_intersection', ROUTE_PROFILES['family-safest'])).toBe(2.5);
  });
});

describe('`default` is unchanged, byte-for-byte', () => {
  const hazards = [
    hazard({ id: 'a', category: 'dangerous_intersection', severity: 'high' }),
    hazard({ id: 'b', category: 'pothole', severity: 'moderate', location: { lat: 38.5451, lng: -121.742 } }),
    hazard({ id: 'c', category: 'poor_visibility', severity: 'low', location: { lat: 38.5449, lng: -121.738 } }),
  ];

  it('scores identically with no profile and with the default profile', () => {
    const without = scoreRoute(throughHazard, hazards, opts());
    const withDefault = scoreRoute(
      throughHazard,
      hazards,
      opts({ profile: ROUTE_PROFILES.default }),
    );
    // Object.is on the numbers, not a tolerance: `toEqual` on the whole scored
    // route compares every penalty and the cost exactly.
    expect(withDefault).toEqual(without);
    expect(withDefault.cost).toBe(without.cost);
    expect(withDefault.penalty).toBe(without.penalty);
  });

  it('ranks identically with no profile and with the default profile', () => {
    const without = rankRoutes([throughHazard, clearButLong], hazards, opts());
    const withDefault = rankRoutes(
      [throughHazard, clearButLong],
      hazards,
      opts({ profile: ROUTE_PROFILES.default }),
    );
    expect(withDefault).toEqual(without);
  });

  it('still takes the shorter hazardous route when the alternative is far longer', () => {
    // The premise of the family-safest test below: on this fixture `default`
    // genuinely prefers the route through the hazard, so a later assertion that
    // family-safest does not is a difference the profile made, not the fixture.
    const ranked = rankRoutes([throughHazard, clearButLong], hazards, opts());
    expect(ranked[0].route).toBe(throughHazard);
    expect(hasHighSeverityNearby(ranked[0])).toBe(true);
  });
});

describe('`family-safest` refuses a high-severity hazard while an alternative exists', () => {
  const hazards = [hazard({ id: 'a', severity: 'high' })];

  it('takes the clear route even when it is five times longer', () => {
    const ranked = rankRoutes(
      [throughHazard, clearButLong],
      hazards,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    expect(ranked[0].route).toBe(clearButLong);
    expect(hasHighSeverityNearby(ranked[0])).toBe(false);
  });

  it('takes it at any detour, because the rule is lexicographic and not a weight', () => {
    // A hundred kilometres. Any finite penalty loses this comparison; the rule
    // is that a high-severity candidate ranks below every clear one, full stop.
    const absurd: Route = { ...clearButLong, distanceMeters: 100_000, durationSeconds: 30_000 };
    const ranked = rankRoutes(
      [throughHazard, absurd],
      hazards,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    expect(ranked[0].route).toBe(absurd);
  });

  it('still ranks by cost among candidates that are equally clear', () => {
    const longerClear: Route = { ...clearButLong, distanceMeters: 12_000 };
    const ranked = rankRoutes(
      [longerClear, clearButLong],
      hazards,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    expect(ranked[0].route).toBe(clearButLong);
  });

  it('falls back to cost when every candidate carries a high-severity hazard', () => {
    // "When any alternative exists" is the whole claim. With none, the profile
    // must still return the least-bad route rather than refusing to answer.
    const alsoThrough: Route = { ...throughHazard, distanceMeters: 5000 };
    const ranked = rankRoutes(
      [alsoThrough, throughHazard],
      hazards,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    expect(ranked[0].route).toBe(throughHazard);
    expect(hasHighSeverityNearby(ranked[0])).toBe(true);
  });

  it('does not reorder on a moderate hazard: the rule names high severity only', () => {
    const moderate = [hazard({ id: 'a', severity: 'moderate' })];
    const ranked = rankRoutes(
      [throughHazard, clearButLong],
      moderate,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    expect(ranked[0].route).toBe(throughHazard);
  });
});

describe('a profile changes cost, never what the rider is told is there', () => {
  const hazards = [
    hazard({ id: 'a', category: 'dangerous_intersection', severity: 'moderate' }),
    hazard({ id: 'b', category: 'pothole', severity: 'low', location: { lat: 38.5451, lng: -121.742 } }),
  ];

  it('reports the same corridor hazards under every profile', () => {
    const seen = ROUTE_PROFILE_IDS.map((id) =>
      scoreRoute(throughHazard, hazards, opts({ profile: ROUTE_PROFILES[id] })).nearby.map(
        (n) => n.hazard.id,
      ),
    );
    for (const list of seen) expect(list).toEqual(seen[0]);
    expect(seen[0].length).toBeGreaterThan(0); // otherwise this compares empty lists
  });

  it('weights an intersection higher for family-safest than for default', () => {
    const intersection = hazard({ category: 'dangerous_intersection', severity: 'moderate' });
    const base = hazardPenalty(intersection, 0, opts());
    const family = hazardPenalty(
      intersection,
      0,
      opts({ profile: ROUTE_PROFILES['family-safest'] }),
    );
    // 2.5x the category multiplier and 3x the base penalty (2400 vs 800).
    expect(family).toBeCloseTo(base * 2.5 * 3, 6);
  });

  it('weights a surface hazard higher for e-bike than for default', () => {
    const pothole = hazard({ category: 'pothole', severity: 'moderate' });
    const base = hazardPenalty(pothole, 0, opts());
    const ebike = hazardPenalty(pothole, 0, opts({ profile: ROUTE_PROFILES['e-bike'] }));
    expect(ebike).toBeCloseTo(base * 1.5 * 1.5, 6);
  });

  it('leaves a category no profile names untouched by that profile', () => {
    const other = hazard({ category: 'other', severity: 'moderate' });
    const base = hazardPenalty(other, 0, opts());
    const family = hazardPenalty(other, 0, opts({ profile: ROUTE_PROFILES['family-safest'] }));
    // Only the base penalty moves (800 -> 2400); the category multiplier is 1.
    expect(family).toBeCloseTo(base * 3, 6);
  });
});

describe('resolveRouteProfile fails closed', () => {
  it('resolves every declared id', () => {
    for (const id of ROUTE_PROFILE_IDS) {
      expect(resolveRouteProfile(id).id).toBe(id);
    }
  });

  it('refuses an unknown id rather than falling back to default', () => {
    expect(() => resolveRouteProfile('cargo-trike')).toThrow(UnknownRouteProfileError);
  });

  it('names the value it was given and the ones that exist', () => {
    // The API's error envelope is a stable `validation_error`, so the message is
    // the only place a caller learns which profile they got wrong.
    expect(() => resolveRouteProfile('cargo-trike')).toThrow(/cargo-trike/);
    expect(() => resolveRouteProfile('cargo-trike')).toThrow(/family-safest/);
  });

  it('refuses a prototype key that is not a profile', () => {
    // `ROUTE_PROFILES.constructor` is truthy on a plain object literal, and a
    // presence check written as `if (!profile)` would have let it through.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => resolveRouteProfile(key)).toThrow(UnknownRouteProfileError);
    }
  });
});
