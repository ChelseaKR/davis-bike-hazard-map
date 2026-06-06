/**
 * Authoritative server-side photo processing.
 *
 * The client downscales and strips EXIF, but the server must not trust that: a
 * crafted upload (decompression bomb, metadata in PNG/WebP, wrong dimensions)
 * could slip through. We decode under a pixel ceiling, apply EXIF orientation,
 * downscale, strip ALL metadata, and re-encode to JPEG — plus a small thumbnail
 * for list/map. Anything that isn't a decodable image returns null and is
 * dropped. (Closes residual-risk R1.)
 */
import sharp from 'sharp';
import { dataUrlToBytes } from '../../shared/exif.ts';

const MAX_EDGE = 1280;
const THUMB_EDGE = 320;
const MAX_INPUT_PIXELS = 50_000_000; // ~50 MP decompression-bomb guard
const QUALITY = 82;
const THUMB_QUALITY = 70;

export interface ProcessedPhoto {
  full: Uint8Array;
  thumb: Uint8Array;
  mime: 'image/jpeg';
}

export async function processPhoto(dataUrl: string): Promise<ProcessedPhoto | null> {
  try {
    const { bytes } = dataUrlToBytes(dataUrl);
    // limitInputPixels guards against decompression bombs; failOn:'error'
    // rejects truncated/corrupt inputs. .rotate() bakes in EXIF orientation.
    const base = sharp(Buffer.from(bytes), {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    }).rotate();

    const full = await base
      .clone()
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();

    const thumb = await base
      .clone()
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer();

    return { full: new Uint8Array(full), thumb: new Uint8Array(thumb), mime: 'image/jpeg' };
  } catch {
    // Not a decodable image (or exceeded limits) — drop it rather than store junk.
    return null;
  }
}
