import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { processPhoto } from '../../server/lib/image.ts';

async function dataUrl(format: 'jpeg' | 'png' | 'webp', w = 2000, h = 1500): Promise<string> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 90 } } });
  const buf = await (format === 'png' ? img.png() : format === 'webp' ? img.webp() : img.jpeg()).toBuffer();
  return `data:image/${format};base64,${buf.toString('base64')}`;
}

describe('processPhoto', () => {
  it('downscales to the max edge, strips metadata, and emits JPEG + thumb', async () => {
    const out = await processPhoto(await dataUrl('jpeg', 2000, 1500));
    expect(out).not.toBeNull();
    expect(out!.mime).toBe('image/jpeg');

    const full = await sharp(Buffer.from(out!.full)).metadata();
    expect(full.format).toBe('jpeg');
    expect(Math.max(full.width!, full.height!)).toBeLessThanOrEqual(1280); // downscaled
    expect(full.exif).toBeUndefined(); // metadata stripped

    const thumb = await sharp(Buffer.from(out!.thumb)).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBeLessThanOrEqual(320);
  });

  it('normalizes PNG and WebP inputs to JPEG', async () => {
    expect((await processPhoto(await dataUrl('png')))!.mime).toBe('image/jpeg');
    expect((await processPhoto(await dataUrl('webp')))!.mime).toBe('image/jpeg');
  });

  it('returns null for undecodable input (no junk stored)', async () => {
    expect(await processPhoto('data:image/jpeg;base64,////')).toBeNull();
  });
});
