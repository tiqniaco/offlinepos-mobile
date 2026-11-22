/**
 * Short UI sounds (synthesized originals in assets/sounds, see scripts/gen-sounds.mjs). Preloaded once, played
 * from the start each time; mixes with other apps' audio and stays silent when the iPhone is on silent.
 * Turned on/off in المظهر → الأصوات (personal setting, default on).
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES = {
  scan: require('../../assets/sounds/scan.wav'),
  notfound: require('../../assets/sounds/notfound.wav'),
  add: require('../../assets/sounds/add.wav'),
  remove: require('../../assets/sounds/remove.wav'),
  sale: require('../../assets/sounds/sale.wav'),
  success: require('../../assets/sounds/success.wav'),
  error: require('../../assets/sounds/error.wav'),
  cash: require('../../assets/sounds/cash.wav'),
} as const;
/* eslint-enable @typescript-eslint/no-require-imports */

export type SoundName = keyof typeof SOURCES;
const VOLUME: Record<SoundName, number> = { scan: 0.7, notfound: 0.6, add: 0.45, remove: 0.4, sale: 0.65, success: 0.5, error: 0.55, cash: 0.5 };

let enabled = true;
let players: Partial<Record<SoundName, AudioPlayer>> | null = null;

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}
export const soundsEnabled = () => enabled;

/** Load all players once (called at startup; cheap: ~80 KB of WAV in total). */
export function preloadSounds() {
  if (players) return;
  players = {};
  void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(() => undefined);
  for (const [k, src] of Object.entries(SOURCES) as [SoundName, number][]) {
    try {
      const p = createAudioPlayer(src);
      p.volume = VOLUME[k];
      players[k] = p;
    } catch {
      /* no audio on this device/build */
    }
  }
}

export function playSound(name: SoundName) {
  if (!enabled) return;
  if (!players) preloadSounds();
  const p = players?.[name];
  if (!p) return;
  try {
    void p.seekTo(0).then(() => p.play(), () => p.play());
  } catch {
    /* never let a sound break an action */
  }
}
