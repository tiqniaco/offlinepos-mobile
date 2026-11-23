/**
 * Short UI sounds (synthesized originals in assets/sounds, see scripts/gen-sounds.py: 44.1 kHz mono WAV, each
 * < 60 KB). Preloaded once shortly after boot (never on the startup path), played from the start each time;
 * mixes with other apps' audio and stays silent when the iPhone is on silent.
 * Turned on/off + volume in المظهر → الأصوات (personal settings, default on / medium).
 * Every call is guarded: a missing audio module, a failed load or a device without audio never throws.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES = {
  scan: require('../../assets/sounds/scan.wav'),
  notfound: require('../../assets/sounds/notfound.wav'),
  add: require('../../assets/sounds/add.wav'),
  remove: require('../../assets/sounds/remove.wav'),
  sale: require('../../assets/sounds/sale.wav'),
  paid: require('../../assets/sounds/paid.wav'),
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
  warn: require('../../assets/sounds/warn.wav'),
  pop: require('../../assets/sounds/pop.wav'),
  tap: require('../../assets/sounds/tap.wav'),
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */

export type SoundName = keyof typeof SOURCES;
export type SoundVolume = 'low' | 'medium' | 'high';
export const SOUND_NAMES = Object.keys(SOURCES) as SoundName[];

/** Per-sound balance (the files are already peak-matched; this is the fine mix). */
const MIX: Record<SoundName, number> = { scan: 0.75, notfound: 0.7, add: 0.6, remove: 0.6, sale: 0.8, paid: 0.75, success: 0.7, error: 0.7, warn: 0.65, pop: 0.65, tap: 0.5 };
const LEVEL: Record<SoundVolume, number> = { low: 0.45, medium: 0.75, high: 1 };

let enabled = true;
let level: SoundVolume = 'medium';
let players: Partial<Record<SoundName, AudioPlayer>> | null = null;
let preloadTimer: ReturnType<typeof setTimeout> | null = null;
const lastPlayed: Partial<Record<SoundName, number>> = {};

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}
export const soundsEnabled = () => enabled;

export function setSoundVolume(v: SoundVolume) {
  level = LEVEL[v] ? v : 'medium';
  if (!players) return;
  for (const [k, p] of Object.entries(players) as [SoundName, AudioPlayer][]) {
    try {
      p.volume = MIX[k] * LEVEL[level];
    } catch {
      /* ignore */
    }
  }
}
export const soundVolume = () => level;

/** Load all players once (~250 KB of WAV in total). */
export function preloadSounds() {
  if (players) return;
  players = {};
  try {
    void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false })?.catch?.(() => undefined);
  } catch {
    /* no audio module */
  }
  for (const [k, src] of Object.entries(SOURCES) as [SoundName, number][]) {
    try {
      const p = createAudioPlayer(src);
      p.volume = MIX[k] * LEVEL[level];
      players[k] = p;
    } catch {
      /* no audio on this device/build */
    }
  }
}

/** Preload after the first screens are up, so sounds never delay startup. */
export function preloadSoundsSoon(delayMs = 1200) {
  if (players || preloadTimer) return;
  preloadTimer = setTimeout(() => {
    preloadTimer = null;
    preloadSounds();
  }, delayMs);
}

export function playSound(name: SoundName) {
  if (!enabled) return;
  // The same sound twice within 120 ms (e.g. fx.error() + the error toast) plays once.
  const now = Date.now();
  if (now - (lastPlayed[name] ?? 0) < 120) return;
  lastPlayed[name] = now;
  try {
    if (!players) preloadSounds();
    const p = players?.[name];
    if (!p) return;
    const r = p.seekTo(0) as Promise<void> | undefined;
    if (r && typeof r.then === 'function') void r.then(() => p.play(), () => p.play());
    else p.play();
  } catch {
    /* never let a sound break an action */
  }
}

/** Tests only. */
export function __resetSounds() {
  players = null;
  for (const k of Object.keys(lastPlayed)) delete lastPlayed[k as SoundName];
  if (preloadTimer) clearTimeout(preloadTimer);
  preloadTimer = null;
}
