import { describe, it, expect } from 'vitest';
import {
  clampRegion,
  pixelateRegion,
  pixelateRegions,
  rectFromCorners,
  detectFacesIfAvailable,
} from '../../src/lib/blur.ts';

describe('rectFromCorners', () => {
  it('normalizes corners in any drag direction', () => {
    expect(rectFromCorners(10, 20, 4, 6)).toEqual({ x: 4, y: 6, w: 6, h: 14 });
    expect(rectFromCorners(4, 6, 10, 20)).toEqual({ x: 4, y: 6, w: 6, h: 14 });
  });
});

describe('clampRegion', () => {
  it('keeps a region inside the image bounds', () => {
    expect(clampRegion({ x: -5, y: -5, w: 100, h: 100 }, 50, 40)).toEqual({
      x: 0,
      y: 0,
      w: 50,
      h: 40,
    });
  });

  it('clamps width/height to remaining space', () => {
    expect(clampRegion({ x: 40, y: 30, w: 100, h: 100 }, 50, 40)).toEqual({
      x: 40,
      y: 30,
      w: 10,
      h: 10,
    });
  });
});

/** Build a width x height RGBA buffer where each pixel encodes its index. */
function makeBuffer(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = i * 10;
    data[i * 4 + 1] = i * 10;
    data[i * 4 + 2] = i * 10;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('pixelateRegion', () => {
  it('replaces a region with its block average (irreversible redaction)', () => {
    // 4x1 strip: values 0,10,20,30. One block over the whole strip => avg 15.
    const data = makeBuffer(4, 1);
    pixelateRegion(data, 4, 1, { x: 0, y: 0, w: 4, h: 1 }, 4);
    for (let i = 0; i < 4; i++) {
      expect(data[i * 4]).toBe(15);
      expect(data[i * 4 + 1]).toBe(15);
      expect(data[i * 4 + 2]).toBe(15);
      expect(data[i * 4 + 3]).toBe(255);
    }
  });

  it('leaves pixels outside the region untouched', () => {
    const data = makeBuffer(4, 1);
    const before3 = data[3 * 4];
    pixelateRegion(data, 4, 1, { x: 0, y: 0, w: 2, h: 1 }, 2);
    expect(data[3 * 4]).toBe(before3); // last pixel unchanged
    expect(data[0]).toBe(5); // avg of 0 and 10
  });

  it('is a no-op for a zero-size region', () => {
    const data = makeBuffer(2, 1);
    const copy = Uint8ClampedArray.from(data);
    pixelateRegion(data, 2, 1, { x: 0, y: 0, w: 0, h: 0 });
    expect(Array.from(data)).toEqual(Array.from(copy));
  });
});

describe('pixelateRegions', () => {
  it('applies multiple regions', () => {
    const data = makeBuffer(4, 1);
    pixelateRegions(
      data,
      4,
      1,
      [
        { x: 0, y: 0, w: 2, h: 1 },
        { x: 2, y: 0, w: 2, h: 1 },
      ],
      2,
    );
    expect(data[0]).toBe(5); // avg(0,10)
    expect(data[2 * 4]).toBe(25); // avg(20,30)
  });
});

describe('detectFacesIfAvailable', () => {
  it('returns [] when the FaceDetector API is absent (never throws)', async () => {
    const fakeSource = {} as CanvasImageSource;
    await expect(detectFacesIfAvailable(fakeSource)).resolves.toEqual([]);
  });
});
