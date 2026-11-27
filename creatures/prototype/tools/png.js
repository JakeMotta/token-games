// Tiny PNG encoder for Node (RGBA, no filtering), used by the tests and the shot script.
'use strict';
const zlib = require('zlib');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rgba: w*h*4 bytes. scale: integer upscale (nearest neighbour) so pixels stay crisp.
function encode(w, h, rgba, scale) {
  scale = scale || 1;
  const W = w * scale, H = h * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4, di = y * (W * 4 + 1) + 1 + x * 4;
      raw[di] = rgba[si]; raw[di + 1] = rgba[si + 1]; raw[di + 2] = rgba[si + 2]; raw[di + 3] = rgba[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Flatten a see-through sprite onto a background colour.
function onBackground(rgba, bg) {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] / 255;
    out[i] = rgba[i] * a + bg[0] * (1 - a); out[i + 1] = rgba[i + 1] * a + bg[1] * (1 - a); out[i + 2] = rgba[i + 2] * a + bg[2] * (1 - a); out[i + 3] = 255;
  }
  return out;
}
// Paste several equally sized renders side by side into one sheet.
function sheet(items, cols, bg) {
  const w = items[0].w, h = items[0].h, rows = Math.ceil(items.length / cols);
  const out = new Uint8ClampedArray(w * cols * h * rows * 4);
  for (let i = 0; i < out.length; i += 4) { out[i] = bg[0]; out[i + 1] = bg[1]; out[i + 2] = bg[2]; out[i + 3] = 255; }
  items.forEach((it, n) => {
    const flat = onBackground(it.rgba, bg), ox = (n % cols) * w, oy = Math.floor(n / cols) * h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((oy + y) * w * cols + ox + x) * 4;
      out[d] = flat[s]; out[d + 1] = flat[s + 1]; out[d + 2] = flat[s + 2];
    }
  });
  return { w: w * cols, h: h * rows, rgba: out };
}
module.exports = { encode, onBackground, sheet };
