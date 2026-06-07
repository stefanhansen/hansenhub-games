'use strict';
// Generates sticker-book app icons (no external deps) using a tiny PNG encoder.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public');

// ---- colors ----
const CORAL = [155, 107, 255];
const GOLD = [255, 200, 87];
const INK = [52, 48, 58];
const CREAM = [255, 246, 233];

function hexBlend(c) { return c; }

// 5-point star: returns vertices for given outer radius around (cx,cy)
function starPoints(cx, cy, outer, inner, rot) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (Math.PI / 5) * i;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
    const hit = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// rounded-rect membership
function inRoundRect(x, y, w, h, r) {
  if (x < 0 || y < 0 || x > w || y > h) return false;
  const dx = Math.min(x, w - x);
  const dy = Math.min(y, h - y);
  if (dx > r || dy > r) return true;
  return (r - dx) ** 2 + (r - dy) ** 2 <= r * r;
}

function render(size) {
  const SS = 4; // supersample for smooth edges
  const S = size * SS;
  const buf = Buffer.alloc(S * S * 4);

  const rot = -Math.PI / 2;
  const cx = S / 2, cy = S / 2;
  const outerInk = S * 0.40;
  const innerInk = outerInk * 0.44;
  const border = S * 0.035;
  const outerGold = outerInk - border;
  const innerGold = outerGold * 0.44;
  const radius = S * 0.20;

  const inkStar = starPoints(cx, cy + S * 0.01, outerInk, innerInk, rot);
  const goldStar = starPoints(cx, cy + S * 0.01, outerGold, innerGold, rot);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let col, a = 255;
      const px = x + 0.5, py = y + 0.5;
      if (!inRoundRect(px, py, S, S, radius)) { a = 0; col = CREAM; }
      else if (inPoly(px, py, goldStar)) col = GOLD;
      else if (inPoly(px, py, inkStar)) col = INK;
      else col = CORAL;
      const o = (y * S + x) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = a;
    }
  }

  // downsample SS x SS -> size
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * S + (x * SS + sx)) * 4;
          r += buf[o]; g += buf[o + 1]; b += buf[o + 2]; a += buf[o + 3];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

// ---- PNG encode ----
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [180, 192, 512]) {
  const png = encodePNG(render(size), size);
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
// favicon: reuse the 192 as .ico-ish png is fine for browsers; write a 32 png named favicon
const fav = encodePNG(render(48), 48);
fs.writeFileSync(path.join(OUT, 'favicon.ico'), fav); // browsers accept PNG-in-.ico
console.log('wrote favicon.ico');
