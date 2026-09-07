import { describe, it, expect } from 'vitest';
import { PLACE_LANDMARKS, landmarkByName } from '../../src/lib/landmarks.ts';
import { isWithinPlace } from '../../shared/geo.ts';

describe('PLACE_LANDMARKS', () => {
  it('all lie within the Davis bounding box', () => {
    for (const l of PLACE_LANDMARKS) {
      expect(isWithinPlace(l.point), l.name).toBe(true);
    }
  });

  it('has unique names', () => {
    const names = PLACE_LANDMARKS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('landmarkByName', () => {
  it('resolves a known landmark and misses gracefully', () => {
    expect(landmarkByName(PLACE_LANDMARKS[0].name)).toEqual(PLACE_LANDMARKS[0].point);
    expect(landmarkByName('Nowhere')).toBeUndefined();
  });
});
