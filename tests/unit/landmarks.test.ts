import { describe, it, expect } from 'vitest';
import { DAVIS_LANDMARKS, landmarkByName } from '../../src/lib/landmarks.ts';
import { isWithinDavis } from '../../shared/geo.ts';

describe('DAVIS_LANDMARKS', () => {
  it('all lie within the Davis bounding box', () => {
    for (const l of DAVIS_LANDMARKS) {
      expect(isWithinDavis(l.point), l.name).toBe(true);
    }
  });

  it('has unique names', () => {
    const names = DAVIS_LANDMARKS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('landmarkByName', () => {
  it('resolves a known landmark and misses gracefully', () => {
    expect(landmarkByName(DAVIS_LANDMARKS[0].name)).toEqual(DAVIS_LANDMARKS[0].point);
    expect(landmarkByName('Nowhere')).toBeUndefined();
  });
});
