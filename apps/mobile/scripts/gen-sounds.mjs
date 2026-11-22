/**
 * Generates the app's UI sounds (original, synthesized — no third-party audio). Short, soft, 22.05 kHz mono WAV.
 * Run: node scripts/gen-sounds.mjs   → assets/sounds/*.wav
 */
import fs from 'node:fs';
import path from 'node:path';

const RATE = 22050;
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '../assets/sounds');

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** One tone: frequency (or sweep), duration, attack/decay envelope, optional harmonics (bell-like). */
function tone({ f, f2 = f, ms, gain = 0.5, attack = 4, decay = 0.6, harm = [], delay = 0 }) {
  const n = Math.round((ms / 1000) * RATE);
  const off = Math.round((delay / 1000) * RATE);
  const s = new Float64Array(off + n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const fr = f + (f2 - f) * t;
    ph += (2 * Math.PI * fr) / RATE;
    const a = Math.min(1, i / ((attack / 1000) * RATE));
    const env = a * Math.pow(1 - t, decay * 3);
    let v = Math.sin(ph);
    for (const [mult, amp] of harm) v += amp * Math.sin(ph * mult);
    s[off + i] = (gain * env * v) / (1 + harm.reduce((x, [, a2]) => x + a2, 0));
  }
  return s;
}
const mix = (...parts) => {
  const n = Math.max(...parts.map((p) => p.length));
  const o = new Float64Array(n);
  for (const p of parts) p.forEach((v, i) => (o[i] += v));
  return o;
};

const sounds = {
  // Classic, clean scanner beep.
  scan: tone({ f: 2650, ms: 75, gain: 0.45, attack: 2, decay: 0.15 }),
  // Product not found: two soft low notes.
  notfound: mix(tone({ f: 420, ms: 110, gain: 0.4, decay: 0.4, harm: [[2, 0.2]] }), tone({ f: 330, ms: 150, gain: 0.4, decay: 0.5, harm: [[2, 0.2]], delay: 120 })),
  // Item added from search / +1: tiny soft pop.
  add: tone({ f: 1300, f2: 900, ms: 45, gain: 0.3, attack: 2, decay: 0.5 }),
  // Line removed: lower soft tick.
  remove: tone({ f: 700, f2: 480, ms: 55, gain: 0.28, attack: 2, decay: 0.5 }),
  // Sale completed: bright two-bell chime (register-like, original).
  sale: mix(
    tone({ f: 1567.98, ms: 420, gain: 0.35, attack: 3, decay: 0.7, harm: [[2.01, 0.35], [3.0, 0.12]] }),
    tone({ f: 2093.0, ms: 520, gain: 0.32, attack: 3, decay: 0.75, harm: [[2.0, 0.3], [3.01, 0.1]], delay: 90 }),
  ),
  // Saved (voucher, purchase, backup…): gentle rising pair.
  success: mix(tone({ f: 1046.5, ms: 120, gain: 0.3, decay: 0.5, harm: [[2, 0.15]] }), tone({ f: 1318.5, ms: 200, gain: 0.3, decay: 0.6, harm: [[2, 0.15]], delay: 90 })),
  // Error: short soft low buzz.
  error: mix(tone({ f: 220, ms: 90, gain: 0.35, decay: 0.3, harm: [[3, 0.25]] }), tone({ f: 196, ms: 130, gain: 0.35, decay: 0.4, harm: [[3, 0.25]], delay: 110 })),
  // Cash drawer / payment received: soft coin-like ting.
  cash: mix(tone({ f: 3135.96, ms: 160, gain: 0.25, attack: 1, decay: 0.6, harm: [[1.5, 0.2]] }), tone({ f: 2637.02, ms: 220, gain: 0.22, attack: 1, decay: 0.7, delay: 60 })),
};

fs.mkdirSync(out, { recursive: true });
for (const [name, s] of Object.entries(sounds)) {
  fs.writeFileSync(path.join(out, `${name}.wav`), wav(s));
  console.log(name, `${Math.round((s.length / RATE) * 1000)} ms`, `${Math.round((44 + s.length * 2) / 1024)} KB`);
}
