/**
 * Pure JPEG metadata stripping, shared by the client (pre-upload) and the
 * server (defense-in-depth backstop). See the privacy audit: photos must be
 * EXIF-clean before they are ever stored or shown.
 *
 * Uses Web/Node-shared globals (`atob`/`btoa`, `Uint8Array`) only, so it runs
 * unchanged in the browser and in Node 18+.
 */

const SOI = 0xd8; // Start of image
const SOS = 0xda; // Start of scan (compressed data begins)
const APP1 = 0xe1; // EXIF and XMP live here
const APP13 = 0xed; // Photoshop IRB / IPTC (can carry author, location)
const COM = 0xfe; // Free-text comment

/** The ASCII bytes "Exif" that prefix an APP1 EXIF payload. */
const EXIF_ID = [0x45, 0x78, 0x69, 0x66];

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === SOI;
}

function segmentStartsWith(bytes: Uint8Array, offset: number, id: number[]): boolean {
  for (let i = 0; i < id.length; i++) {
    if (bytes[offset + i] !== id[i]) return false;
  }
  return true;
}

/**
 * Returns true if the JPEG carries an EXIF (APP1/"Exif") segment.
 * Used by the UI to assert "metadata removed" and by tests to prove stripping.
 */
export function hasExif(bytes: Uint8Array): boolean {
  if (!isJpeg(bytes)) return false;
  let offset = 2; // skip SOI
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === SOS) break; // image data — no more headers
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    if (marker === APP1 && segmentStartsWith(bytes, offset + 4, EXIF_ID)) {
      return true;
    }
    offset += 2 + length;
  }
  return false;
}

/**
 * Remove EXIF, XMP, Photoshop/IPTC, and comment segments from JPEG bytes.
 * Non-JPEG input is returned unchanged. The image content is untouched.
 */
export function stripExifBytes(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) return input;

  const out: number[] = [0xff, SOI];
  let offset = 2;

  while (offset + 1 < input.length) {
    if (input[offset] !== 0xff) {
      // Misaligned (corrupt or already in scan data) — copy the remainder.
      for (let i = offset; i < input.length; i++) out.push(input[i]);
      return Uint8Array.from(out);
    }

    const marker = input[offset + 1];

    if (marker === SOS) {
      // Compressed image data follows the SOS header to the end of file.
      for (let i = offset; i < input.length; i++) out.push(input[i]);
      return Uint8Array.from(out);
    }

    if (offset + 4 > input.length) break;
    const length = (input[offset + 2] << 8) | input[offset + 3];
    if (length < 2 || offset + 2 + length > input.length) break;

    const dropExif = marker === APP1 && segmentStartsWith(input, offset + 4, EXIF_ID);
    const dropXmp =
      marker === APP1 &&
      // XMP packets begin with the namespace URL "http://ns.adobe.com/xap/".
      segmentStartsWith(input, offset + 4, [0x68, 0x74, 0x74, 0x70]);
    const isMetadata = dropExif || dropXmp || marker === APP13 || marker === COM;

    if (!isMetadata) {
      for (let i = offset; i < offset + 2 + length; i++) out.push(input[i]);
    }
    offset += 2 + length;
  }

  // Copy any trailing bytes we didn't classify.
  for (let i = offset; i < input.length; i++) out.push(input[i]);
  return Uint8Array.from(out);
}

/** Decode a base64 data URL into its raw bytes and declared MIME type. */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Not a base64 data URL');
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mime };
}

/** Encode raw bytes back into a base64 data URL. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Strip metadata from a base64 image data URL (JPEG only; others pass through). */
export function stripExifFromDataUrl(dataUrl: string): string {
  const { bytes, mime } = dataUrlToBytes(dataUrl);
  if (mime !== 'image/jpeg') return dataUrl;
  return bytesToDataUrl(stripExifBytes(bytes), mime);
}
