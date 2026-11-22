/**
 * ESC/POS raster printing (SPEC §3). Arabic is rendered as an IMAGE on the phone and sent with
 * `GS v 0`, so shaping never depends on printer code pages.
 * Pure functions: RGBA → grayscale → 1-bit (threshold / Floyd–Steinberg) → raster command bands.
 */

export const PAPER_DOTS = { 58: 384, 80: 576 } as const;

export function rgbaToGray(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    const a = rgba[p + 3]! / 255;
    // Transparent pixels are paper (white).
    const lum = 0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!;
    g[i] = Math.round(lum * a + 255 * (1 - a));
  }
  return g;
}

/** 1 = black dot. Threshold suits text (crisp); dithering suits logos/photos. */
export function threshold(gray: Uint8Array, level = 160): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i]! < level ? 1 : 0;
  return out;
}

export function floydSteinberg(gray: Uint8Array, width: number, height: number): Uint8Array {
  const buf = new Float32Array(gray);
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = buf[i]!;
      const nv = old < 128 ? 0 : 255;
      out[i] = nv === 0 ? 1 : 0;
      const err = old - nv;
      if (x + 1 < width) buf[i + 1]! += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) buf[i + width - 1]! += (err * 3) / 16;
        buf[i + width]! += (err * 5) / 16;
        if (x + 1 < width) buf[i + width + 1]! += err / 16;
      }
    }
  }
  return out;
}

/** Pack 1-bit pixels into rows of bytes (MSB = leftmost dot). */
export function packBits(bits: Uint8Array, width: number, height: number): { bytesPerRow: number; data: Uint8Array } {
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (bits[y * width + x]) data[y * bytesPerRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { bytesPerRow, data };
}

/** `GS v 0` raster commands, split into bands (many cheap printers have small buffers). */
export function rasterCommands(bits: Uint8Array, width: number, height: number, bandRows = 128): Uint8Array {
  const { bytesPerRow, data } = packBits(bits, width, height);
  const chunks: number[] = [];
  for (let y = 0; y < height; y += bandRows) {
    const rows = Math.min(bandRows, height - y);
    chunks.push(0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, (bytesPerRow >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff);
    const start = y * bytesPerRow;
    for (let i = start; i < start + rows * bytesPerRow; i++) chunks.push(data[i]!);
  }
  return new Uint8Array(chunks);
}

export const ESC = {
  init: [0x1b, 0x40],
  /** Feed n lines. */
  feed: (n: number) => [0x1b, 0x64, Math.max(0, Math.min(255, n))],
  /** Partial cut after feeding. Printers without a cutter ignore it. */
  cut: [0x1d, 0x56, 0x42, 0x00],
  /** Cash drawer kick on pin 2 (ESC p 0 25 250). */
  drawer: [0x1b, 0x70, 0x00, 0x19, 0xfa],
  center: [0x1b, 0x61, 0x01],
};

export interface ReceiptJob {
  /** RGBA pixels of the rendered receipt, exactly `width` dots wide. */
  rgba: Uint8Array;
  width: number;
  height: number;
  mode?: 'threshold' | 'dither';
  cut?: boolean;
  openDrawer?: boolean;
}

/** Full byte stream for one receipt. */
export function buildReceiptBytes(job: ReceiptJob): Uint8Array {
  const gray = rgbaToGray(job.rgba, job.width, job.height);
  const bits = job.mode === 'dither' ? floydSteinberg(gray, job.width, job.height) : threshold(gray);
  const raster = rasterCommands(bits, job.width, job.height);
  const parts = [ESC.init, ESC.center, Array.from(raster), ESC.feed(4), ...(job.cut !== false ? [ESC.cut] : []), ...(job.openDrawer ? [ESC.drawer] : [])];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Split bytes for transports with small packets (BLE MTU). */
export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}
