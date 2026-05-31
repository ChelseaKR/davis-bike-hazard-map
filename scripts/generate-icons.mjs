/**
 * Generate the PWA icon PNGs with zero external dependencies (Node's built-in
 * zlib + a tiny PNG encoder). Run via `node scripts/generate-icons.mjs`.
 *
 * Produces a brand-green tile with a white pin glyph at the sizes the manifest
 * references. Regenerate whenever the brand colour changes.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BRAND = [11, 110, 79]; // #0b6e4f
const WHITE = [255, 255, 255];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, draw) {
  const bytesPerPixel = 4;
  const rowLen = size * bytesPerPixel;
  const raw = Buffer.alloc((rowLen + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y);
      const off = y * (rowLen + 1) + 1 + x * bytesPerPixel;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A teardrop map-pin with a hole, centred on the tile. */
function pinPixel(size, maskable) {
  const pad = maskable ? size * 0.1 : 0; // keep glyph inside maskable safe zone
  const inner = size - pad * 2;
  const cx = size / 2;
  const headR = inner * 0.22;
  const cy = pad + inner * 0.36;
  const holeR = headR * 0.42;
  return (x, y) => {
    // Background tile.
    let px = [...BRAND, 255];
    const dxh = x - cx;
    const dyh = y - cy;
    const distHead = Math.sqrt(dxh * dxh + dyh * dyh);
    // Pin head (white disc) with a hole.
    if (distHead <= headR && distHead > holeR) px = [...WHITE, 255];
    // Pin tail: triangle narrowing to a point below the head.
    const tipY = pad + inner * 0.8;
    if (y >= cy && y <= tipY) {
      const t = (y - cy) / (tipY - cy);
      const halfW = headR * (1 - t);
      if (Math.abs(x - cx) <= halfW) px = [...WHITE, 255];
    }
    return px;
  };
}

mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
];
for (const { name, size, maskable } of targets) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, pinPixel(size, maskable)));
  console.log(`wrote ${name} (${size}x${size})`);
}
