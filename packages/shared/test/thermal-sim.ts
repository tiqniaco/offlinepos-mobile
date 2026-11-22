/**
 * Dev tool: simulate a thermal print from a receipt screenshot.
 * PNG (any size) → resize to printer dots (like react-native-view-shot `width`) → shared escpos
 * pipeline → bytes → decode the GS v 0 bands back into a 1-bit image (what the printer would print).
 * Usage: npx tsx packages/shared/test/thermal-sim.ts in.png out.png 384
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decode, encode } from 'fast-png';
import { buildReceiptBytes } from '../src/escpos';

const [inp, out, dotsArg] = process.argv.slice(2);
const dots = Number(dotsArg ?? 384);
const png = decode(readFileSync(inp!));
const ch = png.channels;
const src = png.data as Uint8Array;
const scale = png.width / dots;
const h = Math.round(png.height / scale);
const rgba = new Uint8Array(dots * h * 4);
// Box-filter downscale (area average), like the phone's capture resize.
for (let y = 0; y < h; y++)
  for (let x = 0; x < dots; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = Math.floor(y * scale); yy < Math.min(png.height, Math.floor((y + 1) * scale)); yy++)
      for (let xx = Math.floor(x * scale); xx < Math.min(png.width, Math.floor((x + 1) * scale)); xx++) {
        const i = (yy * png.width + xx) * ch;
        r += src[i]!; g += src[i + 1]!; b += src[i + 2]!; n++;
      }
    const o = (y * dots + x) * 4;
    rgba[o] = r / n; rgba[o + 1] = g / n; rgba[o + 2] = b / n; rgba[o + 3] = 255;
  }
const bytes = buildReceiptBytes({ rgba, width: dots, height: h, openDrawer: false });
// Decode the printer stream back.
const rows: number[][] = [];
let bpr = 0;
for (let i = 0; i < bytes.length; ) {
  if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) {
    bpr = bytes[i + 4]! | (bytes[i + 5]! << 8);
    const n = bytes[i + 6]! | (bytes[i + 7]! << 8);
    i += 8;
    for (let r = 0; r < n; r++, i += bpr) rows.push(Array.from(bytes.subarray(i, i + bpr)));
  } else i++;
}
const W = bpr * 8;
const img = new Uint8Array(W * rows.length * 3).fill(255);
rows.forEach((row, y) => row.forEach((byte, bx) => { for (let k = 0; k < 8; k++) if (byte & (0x80 >> k)) img.fill(0, (y * W + bx * 8 + k) * 3, (y * W + bx * 8 + k) * 3 + 3); }));
writeFileSync(out!, encode({ width: W, height: rows.length, data: img, channels: 3 }));
console.log(`printer bytes: ${bytes.length}  image: ${W}×${rows.length} dots  (${(rows.length / 8).toFixed(0)} mm of paper)`);
