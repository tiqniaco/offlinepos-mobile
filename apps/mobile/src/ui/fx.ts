/**
 * Feedback for the important actions = haptic + sound, always together and always the same, so the shop
 * "hears" what happened without looking: beep = scanned, low tones = not found, chime = sale done.
 */
import { haptic } from './haptics';
import { playSound } from './sounds';

export const fx = {
  /** Barcode read and item added. */
  scan: () => {
    haptic.tap();
    playSound('scan');
  },
  /** Barcode not found / not allowed. */
  notFound: () => {
    haptic.warn();
    playSound('notfound');
  },
  /** Item added from search, quantity +1. */
  add: () => {
    haptic.tap();
    playSound('add');
  },
  /** Line removed / quantity −1. */
  remove: () => {
    haptic.select();
    playSound('remove');
  },
  /** Sale posted. */
  sale: () => {
    haptic.success();
    playSound('sale');
  },
  /** Money received (customer receipt). */
  cash: () => {
    haptic.success();
    playSound('cash');
  },
  /** Saved: purchase, voucher, shift closed, backup… */
  success: () => {
    haptic.success();
    playSound('success');
  },
  error: () => {
    haptic.error();
    playSound('error');
  },
};
