/** fx = haptic + sound: must never throw (sounds off, audio module missing/broken, haptics failing). */
const mockPlayer = () => ({ volume: 1, play: jest.fn(), seekTo: jest.fn(() => Promise.resolve()) });
const mockCreated: ReturnType<typeof mockPlayer>[] = [];
let mockAudioBroken = false;

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => {
    if (mockAudioBroken) throw new Error('no audio on this build');
    const p = mockPlayer();
    mockCreated.push(p);
    return p;
  }),
  setAudioModeAsync: jest.fn(() => Promise.reject(new Error('no audio session'))),
}));
jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  impactAsync: jest.fn(() => Promise.reject(new Error('no vibrator'))),
  notificationAsync: jest.fn(() => {
    throw new Error('sync failure');
  }),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

import { fx, fxRecently } from './fx';
import { __resetSounds, playSound, preloadSounds, setSoundsEnabled, setSoundVolume, SOUND_NAMES } from './sounds';
import { setHapticsEnabled } from './haptics';

const ALL = Object.keys(fx) as (keyof typeof fx)[];

beforeEach(() => {
  __resetSounds();
  mockCreated.length = 0;
  mockAudioBroken = false;
  setSoundsEnabled(true);
  setHapticsEnabled(true);
});

describe('fx', () => {
  it('has the full vocabulary', () => {
    expect(ALL.sort()).toEqual(['add', 'error', 'notFound', 'notify', 'paid', 'remove', 'saleDone', 'scan', 'success', 'tap', 'warn'].sort());
  });

  it('never throws when sounds are disabled, and plays nothing', () => {
    setSoundsEnabled(false);
    for (const k of ALL) expect(() => fx[k]()).not.toThrow();
    expect(mockCreated).toHaveLength(0);
    expect(fxRecently()).toBe(true);
  });

  it('never throws when the audio module is unavailable or haptics fail', () => {
    mockAudioBroken = true;
    for (const k of ALL) expect(() => fx[k]()).not.toThrow();
    expect(() => preloadSounds()).not.toThrow();
    setHapticsEnabled(false);
    for (const k of ALL) expect(() => fx[k]()).not.toThrow();
  });

  it('preloads every sound once, applies the volume level, plays from the start, de-duplicates bursts', () => {
    preloadSounds();
    preloadSounds();
    expect(mockCreated).toHaveLength(SOUND_NAMES.length);
    const before = mockCreated.map((p) => p.volume);
    setSoundVolume('low');
    mockCreated.forEach((p, i) => expect(p.volume).toBeLessThan(before[i]!));
    playSound('scan');
    playSound('scan'); // same sound within 120 ms → once
    const scan = mockCreated[SOUND_NAMES.indexOf('scan')]!;
    expect(scan.seekTo).toHaveBeenCalledTimes(1);
    expect(scan.seekTo).toHaveBeenCalledWith(0);
  });

  it('a player that throws on play() after seeking never leaves an unhandled rejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      preloadSounds();
      const tap = mockCreated[SOUND_NAMES.indexOf('tap')]!;
      tap.play.mockImplementation(() => {
        throw new Error('player released');
      });
      expect(() => playSound('tap')).not.toThrow();
      await new Promise((r) => setTimeout(r, 20));
      expect(tap.play).toHaveBeenCalled();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
