/**
 * Photo helpers. Canvas compositing lives in the PhotoEditor component (it is
 * browser-only); the pure, testable maths lives here.
 */

/** Read a File into a base64 data URL. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Scale dimensions down so the longest edge is at most `maxEdge`, preserving
 * aspect ratio. Never upscales. Keeps photo uploads small on mobile data.
 */
export function computeScaledDimensions(
  source: Dimensions,
  maxEdge: number,
): Dimensions {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxEdge || longest === 0) {
    return { width: Math.round(source.width), height: Math.round(source.height) };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/** Approximate decoded byte size of a base64 data URL (for upload budgeting). */
export function dataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}
