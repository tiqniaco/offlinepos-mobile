/**
 * Feedback for the important actions = haptic + sound, always together and always the same, so the shop
 * "hears" what happened without looking: beep = scanned, tick = added, thud = removed, chime = sale done,
 * coins = money received, chord = saved, low double = not found / error.
 * Both halves follow the user's settings (المظهر → الأصوات / الاهتزاز) and never throw.
 */
import { haptic } from './haptics';
import { playSound, type SoundName } from './sounds';

const both = (h: keyof typeof haptic | null, s: SoundName | null) => () => {
  try {
    if (h) haptic[h]();
  } catch {
    /* ignore */
  }
  try {
    if (s) playSound(s);
  } catch {
    /* ignore */
  }
};

export const fx = {
  /** Barcode read and item added. */
  scan: both('medium', 'scan'),
  /** Item added from search, quantity +1. */
  add: both('tap', 'add'),
  /** Line removed / quantity −1. */
  remove: both('soft', 'remove'),
  /** Sale posted (pay screen) — the big moment. */
  saleDone: both('success', 'sale'),
  /** Money received (customer receipt, cash in). */
  paid: both('success', 'paid'),
  /** Saved: purchase, voucher, shift closed, backup, count posted… */
  success: both('success', 'success'),
  /** Barcode not found / not allowed. */
  notFound: both('warn', 'notfound'),
  error: both('error', 'error'),
  warn: both('warn', 'warn'),
  /** Something arrived (new message, OCR finished reading). */
  notify: both('tap', 'pop'),
  /** Keypad keys: barely-there click. */
  tap: both('select', 'tap'),
};
export type FxName = keyof typeof fx;
