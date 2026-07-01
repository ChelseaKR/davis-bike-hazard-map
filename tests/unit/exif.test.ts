import { describe, it, expect } from 'vitest';
import {
  hasExif,
  stripExifBytes,
  stripExifFromDataUrl,
  dataUrlToBytes,
  bytesToDataUrl,
} from '../../shared/exif.ts';

/** Build a tiny but structurally valid JPEG with optional metadata segments. */
function makeJpeg(opts: { exif?: boolean; xmp?: boolean; comment?: boolean } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI

  if (opts.exif) {
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]; // "Exif\0\0" + data
    const len = payload.length + 2;
    bytes.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  if (opts.xmp) {
    const payload = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f]; // "http://"
    const len = payload.length + 2;
    bytes.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  if (opts.comment) {
    const payload = [0x68, 0x69]; // "hi"
    const len = payload.length + 2;
    bytes.push(0xff, 0xfe, (len >> 8) & 0xff, len & 0xff, ...payload);
  }

  // APP0 (JFIF) — should be KEPT.
  bytes.push(0xff, 0xe0, 0x00, 0x04, 0x10, 0x20);
  // SOS + 1 header byte + scan data + EOI.
  bytes.push(0xff, 0xda, 0x00, 0x03, 0x55, 0x12, 0x34, 0xff, 0xd9);
  return Uint8Array.from(bytes);
}

describe('hasExif', () => {
  it('detects an EXIF APP1 segment', () => {
    expect(hasExif(makeJpeg({ exif: true }))).toBe(true);
  });

  it('returns false for a JPEG without EXIF', () => {
    expect(hasExif(makeJpeg())).toBe(false);
  });

  it('returns false for non-JPEG bytes', () => {
    expect(hasExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('stripExifBytes', () => {
  it('removes EXIF and reports clean afterwards (the privacy gate)', () => {
    const dirty = makeJpeg({ exif: true });
    expect(hasExif(dirty)).toBe(true);
    const clean = stripExifBytes(dirty);
    expect(hasExif(clean)).toBe(false);
  });

  it('removes XMP and comment segments too', () => {
    const dirty = makeJpeg({ xmp: true, comment: true });
    const clean = stripExifBytes(dirty);
    // The output should be shorter (segments removed) but still a valid JPEG.
    expect(clean.length).toBeLessThan(dirty.length);
    expect(clean[0]).toBe(0xff);
    expect(clean[1]).toBe(0xd8);
  });

  it('keeps the APP0/JFIF segment and the image scan data', () => {
    const clean = stripExifBytes(makeJpeg({ exif: true }));
    // APP0 marker FFE0 should still be present.
    let hasApp0 = false;
    for (let i = 0; i < clean.length - 1; i++) {
      if (clean[i] === 0xff && clean[i + 1] === 0xe0) hasApp0 = true;
    }
    expect(hasApp0).toBe(true);
    // EOI marker should still terminate the file.
    expect(clean[clean.length - 2]).toBe(0xff);
    expect(clean[clean.length - 1]).toBe(0xd9);
  });

  it('passes non-JPEG bytes through unchanged', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(stripExifBytes(png)).toEqual(png);
  });

  // Robustness: a corrupt/truncated upload must never crash the privacy gate and
  // must never silently drop image bytes it could not classify.
  it('copies the remainder verbatim when the stream is misaligned (no crash)', () => {
    // After SOI a non-0xFF byte appears where a marker was expected.
    const bytes = Uint8Array.from([0xff, 0xd8, 0x00, 0x42, 0x43, 0x44]);
    expect(Array.from(stripExifBytes(bytes))).toEqual([0xff, 0xd8, 0x00, 0x42, 0x43, 0x44]);
  });

  it('stops cleanly and preserves trailing bytes on a truncated segment', () => {
    // APP1 claims a 0xFFFF-byte payload the buffer does not contain.
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]);
    expect(Array.from(stripExifBytes(bytes))).toEqual([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]);
  });

  it('breaks safely when a segment header is cut off before its length', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00]);
    expect(Array.from(stripExifBytes(bytes))).toEqual([0xff, 0xd8, 0xff, 0xe1, 0x00]);
  });
});

describe('data URL round-tripping', () => {
  it('decodes and re-encodes bytes losslessly', () => {
    const bytes = Uint8Array.from([1, 2, 3, 250, 251, 0, 255]);
    const url = bytesToDataUrl(bytes, 'image/jpeg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    const back = dataUrlToBytes(url);
    expect(back.mime).toBe('image/jpeg');
    expect(Array.from(back.bytes)).toEqual(Array.from(bytes));
  });

  it('strips EXIF when given a JPEG data URL', () => {
    const url = bytesToDataUrl(makeJpeg({ exif: true }), 'image/jpeg');
    const cleanedUrl = stripExifFromDataUrl(url);
    expect(hasExif(dataUrlToBytes(cleanedUrl).bytes)).toBe(false);
  });

  it('leaves a PNG data URL untouched', () => {
    const url = bytesToDataUrl(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    expect(stripExifFromDataUrl(url)).toBe(url);
  });

  it('throws on a non-data-URL string', () => {
    expect(() => dataUrlToBytes('not a data url')).toThrow();
  });
});
