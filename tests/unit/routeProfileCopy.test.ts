/**
 * The route planner's weight sentences are composed from `ROUTE_PROFILES`
 * (issue #178), so a weight change changes what a rider is told. These tests
 * hold the copy to the table in both directions: every rule the table carries is
 * said, nothing is said that the table does not carry, and no preference is
 * called safe.
 */
import { describe, it, expect } from 'vitest';
import { createIntl } from 'react-intl';
import { DEFAULT_SCORING, ROUTE_PROFILES } from '../../shared/routing.ts';
import { HAZARD_CATEGORIES, ROUTE_PROFILE_IDS } from '../../shared/types.ts';
import { DEFAULT_LOCALE, loadMessages } from '../../src/i18n/config.ts';
import {
  categoryLabel,
  routeProfileLabel,
  routeProfileWeightLines,
} from '../../src/i18n/labels.ts';
import { formatDistance } from '../../src/lib/format.ts';

const intl = createIntl({
  locale: DEFAULT_LOCALE,
  defaultLocale: DEFAULT_LOCALE,
  messages: loadMessages(DEFAULT_LOCALE),
});

describe('routeProfileWeightLines', () => {
  it('has a sentence for every kind of scoring override the table carries', () => {
    // The copy describes `highPenaltyMeters` and nothing else in `scoring`. A
    // profile that gained a corridor or a recency half-life would be described
    // without it, and the picker would under-report what the profile does. This
    // fails first, so the sentence is written in the same change as the weight.
    for (const id of ROUTE_PROFILE_IDS) {
      expect(Object.keys(ROUTE_PROFILES[id].scoring), id).toEqual(
        Object.keys(ROUTE_PROFILES[id].scoring).filter((k) => k === 'highPenaltyMeters'),
      );
    }
  });

  it("states each profile's high-severity cost from the table, and Standard's beside it when different", () => {
    const standard = DEFAULT_SCORING.highPenaltyMeters;
    for (const id of ROUTE_PROFILE_IDS) {
      const meters = ROUTE_PROFILES[id].scoring.highPenaltyMeters ?? standard;
      const [first] = routeProfileWeightLines(intl, id);
      expect(first, id).toContain(`counts as ${formatDistance(meters)} of extra riding`);
      const comparison = `(${routeProfileLabel(intl, 'default')}: ${formatDistance(standard)})`;
      if (meters === standard) expect(first, id).not.toContain(comparison);
      else expect(first, id).toContain(comparison);
    }
  });

  it('names every category multiplier other than 1, with its factor, and no other category', () => {
    for (const id of ROUTE_PROFILE_IDS) {
      const lines = routeProfileWeightLines(intl, id);
      for (const category of HAZARD_CATEGORIES) {
        const factor = ROUTE_PROFILES[id].categoryMultipliers[category];
        const line = lines.find((l) => l.includes(categoryLabel(intl, category)));
        if (factor === undefined || factor === 1) {
          expect(line, `${id} describes ${category}, which it does not weight`).toBeUndefined();
        } else {
          expect(line, `${id} weights ${category} but does not say so`).toBeDefined();
          expect(line).toContain(`${intl.formatNumber(factor)}×`);
        }
      }
    }
  });

  it('states the high-severity refusal exactly when the profile applies it', () => {
    for (const id of ROUTE_PROFILE_IDS) {
      const said = routeProfileWeightLines(intl, id).some((l) =>
        /never picks a route past a high-severity report/i.test(l),
      );
      expect(said, id).toBe(ROUTE_PROFILES[id].refuseHighSeverityWhenAlternativeExists);
    }
  });

  it('says every type counts the same only for a profile that weights none differently', () => {
    for (const id of ROUTE_PROFILE_IDS) {
      const equal = routeProfileWeightLines(intl, id).some((l) =>
        /every hazard type counts the same/i.test(l),
      );
      const weightsOne = Object.values(ROUTE_PROFILES[id].categoryMultipliers).some(
        (f) => f !== undefined && f !== 1,
      );
      expect(equal, id).toBe(!weightsOne);
    }
  });

  it('pins the shipped copy for family-safest, in its stated order', () => {
    expect(routeProfileWeightLines(intl, 'family-safest')).toEqual([
      'A high-severity report right beside a route counts as 2.4 km of extra riding (Standard: 800 m), and less as it ages or sits further from the line.',
      'Dangerous intersection counts 2.5× as much as usual.',
      'Blocked bike lane, Near miss / close call, and Poor visibility count 1.5× as much as usual.',
      'Never picks a route past a high-severity report while the road network offered one without, however much longer that one is.',
    ]);
  });

  it('never calls a preference safe, in its name or in any rule', () => {
    for (const id of ROUTE_PROFILE_IDS) {
      expect(routeProfileLabel(intl, id), id).not.toMatch(/safe/i);
      for (const line of routeProfileWeightLines(intl, id)) expect(line, id).not.toMatch(/safe/i);
    }
  });
});
