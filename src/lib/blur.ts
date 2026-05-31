/**
 * Face / licence-plate blurring helpers.
 *
 * The Responsible-Tech audit requires that blurring be OFFERED on every photo.
 * We implement it as manual region blur — the cyclist taps/drags a box over a
 * face or plate and we pixelate that region. Manual blur is the reliable floor:
 * it works fully offline with no ML model and never silently misses a face the
 * way an automatic detector can.
 *
 * `detectFacesIfAvailable` is progressive enhancement: when the browser ships
 * the experimental Shape Detection `FaceDetector`, we pre-seed blur boxes over
 * detected faces so the common case is one tap. It is never relied upon.
 *
 * The pixel math lives here as pure functions so it is unit-testable without a
 * real canvas; the editor component applies it to `ImageData`.
 */

export interface BlurRegion {
  /** Top-left corner and size in source-image pixel coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Build a normalized rectangle from two drag corners (any order). */
export function rectFromCorners(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): BlurRegion {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  };
}

/** Clamp a region so it stays fully inside a width x height image. */
export function clampRegion(region: BlurRegion, width: number, height: number): BlurRegion {
  const x = Math.max(0, Math.min(Math.round(region.x), width));
  const y = Math.max(0, Math.min(Math.round(region.y), height));
  const w = Math.max(0, Math.min(Math.round(region.w), width - x));
  const h = Math.max(0, Math.min(Math.round(region.h), height - y));
  return { x, y, w, h };
}

/**
 * Pixelate one rectangular region of an RGBA buffer, in place.
 *
 * The region is divided into `blockSize`-square cells; every pixel in a cell is
 * set to the cell's average colour. This is irreversible (unlike a reversible
 * blur kernel) which is what we want for redaction.
 *
 * @param data   RGBA pixel buffer (length === width*height*4), mutated in place.
 * @param width  Image width in pixels.
 * @param height Image height in pixels.
 * @param region Region to redact (will be clamped to the image).
 * @param blockSize Cell size in pixels; larger = coarser. Defaults to a size
 *                  scaled to the region so small boxes still fully obscure.
 */
export function pixelateRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  region: BlurRegion,
  blockSize?: number,
): void {
  const { x, y, w, h } = clampRegion(region, width, height);
  if (w === 0 || h === 0) return;

  const block = blockSize ?? Math.max(4, Math.floor(Math.min(w, h) / 6));

  for (let by = y; by < y + h; by += block) {
    for (let bx = x; bx < x + w; bx += block) {
      const cellW = Math.min(block, x + w - bx);
      const cellH = Math.min(block, y + h - by);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let py = by; py < by + cellH; py++) {
        for (let px = bx; px < bx + cellW; px++) {
          const i = (py * width + px) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
          count++;
        }
      }
      if (count === 0) continue;

      const ar = Math.round(r / count);
      const ag = Math.round(g / count);
      const ab = Math.round(b / count);
      const aa = Math.round(a / count);

      for (let py = by; py < by + cellH; py++) {
        for (let px = bx; px < bx + cellW; px++) {
          const i = (py * width + px) * 4;
          data[i] = ar;
          data[i + 1] = ag;
          data[i + 2] = ab;
          data[i + 3] = aa;
        }
      }
    }
  }
}

/** Apply every region to a buffer (order-independent; regions may overlap). */
export function pixelateRegions(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  regions: BlurRegion[],
  blockSize?: number,
): void {
  for (const region of regions) {
    pixelateRegion(data, width, height, region, blockSize);
  }
}

/**
 * Best-effort automatic face detection via the browser Shape Detection API.
 * Returns [] when the API is missing or detection fails — manual blur remains
 * the guarantee. Never throws.
 */
export async function detectFacesIfAvailable(
  source: CanvasImageSource,
): Promise<BlurRegion[]> {
  type DetectedFace = { boundingBox: { x: number; y: number; width: number; height: number } };
  const Ctor = (globalThis as { FaceDetector?: new (opts?: unknown) => unknown }).FaceDetector;
  if (typeof Ctor !== 'function') return [];
  try {
    const detector = new Ctor({ fastMode: true }) as {
      detect: (s: CanvasImageSource) => Promise<DetectedFace[]>;
    };
    const faces = await detector.detect(source);
    return faces.map((f) => ({
      // Pad the detected box outward so hairline/jaw are covered too.
      x: f.boundingBox.x - f.boundingBox.width * 0.15,
      y: f.boundingBox.y - f.boundingBox.height * 0.15,
      w: f.boundingBox.width * 1.3,
      h: f.boundingBox.height * 1.3,
    }));
  } catch {
    return [];
  }
}
