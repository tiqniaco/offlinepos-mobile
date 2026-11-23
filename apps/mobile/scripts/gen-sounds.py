#!/usr/bin/env python3
"""
Generates the app's UI sounds — original, synthesized (no third-party audio), 44.1 kHz mono 16-bit WAV,
each well under 60 KB. Soft attack/release fades on every sound, peak-normalised per sound so the whole set
sits at the same comfortable level (nothing harsh, nothing clipped).

Run:  python3 scripts/gen-sounds.py   → assets/sounds/*.wav
"""
import os
import wave

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sounds')
rng = np.random.default_rng(7)  # deterministic output


def t_axis(ms):
    return np.arange(int(RATE * ms / 1000)) / RATE


def env(n, attack_ms=3.0, decay=8.0):
    """Fast linear attack + exponential decay (decay = 1/seconds)."""
    t = np.arange(n) / RATE
    a = np.clip(t / (attack_ms / 1000), 0, 1)
    return a * np.exp(-decay * t)


def bell(f, ms, decay=6.0, partials=((1, 1.0), (2.0, 0.28), (3.01, 0.10), (4.2, 0.05)), attack_ms=2.0, detune=0.0):
    """Bell/chime tone: a few partials; higher partials decay faster (sounds natural, not 'beepy')."""
    t = t_axis(ms)
    out = np.zeros_like(t)
    for mult, amp in partials:
        fr = f * mult * (1 + detune)
        out += amp * np.sin(2 * np.pi * fr * t) * np.exp(-decay * (1 + 0.6 * (mult - 1)) * t)
    a = np.clip(t / (attack_ms / 1000), 0, 1)
    return out * a / sum(a2 for _, a2 in partials)


def sweep(f0, f1, ms, decay=10.0, attack_ms=2.0, harm=0.0):
    t = t_axis(ms)
    fr = f0 * (f1 / f0) ** (t / t[-1])  # exponential glide
    ph = 2 * np.pi * np.cumsum(fr) / RATE
    v = np.sin(ph) + harm * np.sin(2 * ph)
    return v * env(len(t), attack_ms, decay) / (1 + harm)


def noise(ms, lo=2000, hi=9000, decay=30.0, attack_ms=0.5):
    """Band-limited noise (FFT mask) — for clicks and the cash-register shimmer."""
    n = int(RATE * ms / 1000)
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / RATE)
    X[(f < lo) | (f > hi)] = 0
    x = np.fft.irfft(X, n)
    x /= np.max(np.abs(x)) + 1e-9
    return x * env(n, attack_ms, decay)


def place(total_ms, *parts):
    """Mix (delay_ms, signal, gain) parts into one buffer."""
    out = np.zeros(int(RATE * total_ms / 1000))
    for delay, sig, gain in parts:
        s = int(RATE * delay / 1000)
        e = min(len(out), s + len(sig))
        out[s:e] += gain * sig[: e - s]
    return out


def room(x, taps=((23, 0.18), (41, 0.12), (67, 0.07))):
    """Two or three soft early reflections: a touch of space, no long tail."""
    y = x.copy()
    for ms, g in taps:
        d = int(RATE * ms / 1000)
        y[d:] += g * x[:-d]
    return y


def finish(x, peak_db, fade_in_ms=1.5, fade_out_ms=12):
    x = x - np.mean(x)
    n_in = max(1, int(RATE * fade_in_ms / 1000))
    n_out = max(1, int(RATE * fade_out_ms / 1000))
    x[:n_in] *= np.linspace(0, 1, n_in)
    x[-n_out:] *= np.linspace(1, 0, n_out) ** 2
    peak = np.max(np.abs(x)) + 1e-9
    return x / peak * (10 ** (peak_db / 20))


SOUNDS = {
    # Barcode read: short bright two-tone (C7 → E7), clean like a good scanner, but rounder.
    'scan': lambda: finish(place(120, (0, bell(2093, 60, 40, ((1, 1), (2, 0.08))), 1.0), (42, bell(2637, 78, 34, ((1, 1), (2, 0.08))), 0.9)), -7),
    # Item added: tiny soft "tick" with a downward glide.
    'add': lambda: finish(place(70, (0, sweep(1500, 950, 55, 55), 1.0), (0, noise(10, 3000, 8000, 300), 0.25)), -11, fade_out_ms=8),
    # Line removed / −1: soft low thud.
    'remove': lambda: finish(place(120, (0, sweep(330, 170, 110, 30, harm=0.25), 1.0), (0, noise(25, 150, 1200, 120), 0.2)), -10),
    # Sale done: pleasant ascending chime C6-E6-G6-C7 + soft cash-register shimmer.
    'sale': lambda: finish(
        room(
            place(
                620,
                (0, bell(1046.5, 520, 5.5), 0.55),
                (70, bell(1318.5, 480, 5.5), 0.55),
                (140, bell(1568.0, 440, 5.5), 0.6),
                (215, bell(2093.0, 400, 6.0), 0.65),
                (215, noise(330, 5000, 12000, 9, attack_ms=25), 0.10),
                (260, bell(4186.0, 280, 12, ((1, 1), (2.76, 0.2))), 0.12),
            )
        ),
        -5,
        fade_out_ms=40,
    ),
    # Payment received: bright coin "ting-ting".
    'paid': lambda: finish(
        room(place(380, (0, bell(2637, 300, 10, ((1, 1), (2.4, 0.3), (5.1, 0.08))), 0.8), (75, bell(3520, 300, 10, ((1, 1), (2.4, 0.3), (5.1, 0.08))), 0.7), (0, noise(12, 4000, 10000, 200), 0.15))),
        -7,
        fade_out_ms=30,
    ),
    # Saved / backup done / count posted: warm major chord, gently strummed (G5-B5-D6-G6).
    'success': lambda: finish(
        room(place(520, (0, bell(784, 480, 6.5), 0.6), (45, bell(987.8, 460, 6.5), 0.55), (90, bell(1174.7, 430, 6.5), 0.55), (135, bell(1568, 380, 7.5), 0.45))),
        -7,
        fade_out_ms=40,
    ),
    # Not found: soft low double "bonk-bonk" (not alarming).
    'notfound': lambda: finish(place(300, (0, bell(523.3, 130, 18, ((1, 1), (2, 0.2))), 1.0), (140, bell(392, 155, 16, ((1, 1), (2, 0.2))), 1.0)), -9),
    # Error: lower, slightly firmer double.
    'error': lambda: finish(place(320, (0, sweep(311, 293, 130, 14, harm=0.35), 1.0), (150, sweep(247, 233, 160, 12, harm=0.35), 1.0)), -8),
    # Warning: two even mid pulses.
    'warn': lambda: finish(place(260, (0, bell(740, 100, 22, ((1, 1), (2, 0.15))), 1.0), (125, bell(740, 120, 20, ((1, 1), (2, 0.15))), 0.9)), -10),
    # Notification: rounded "pop" (upward bubble).
    'pop': lambda: finish(place(140, (0, sweep(520, 1250, 75, 22), 1.0), (60, bell(1250, 70, 40, ((1, 1),)), 0.35)), -9),
    # Keypad / tap: barely-there click.
    'tap': lambda: finish(place(28, (0, noise(18, 2500, 7000, 260), 0.6), (0, bell(3000, 18, 220, ((1, 1),)), 0.5)), -18, fade_out_ms=4),
}


def write(name, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    path = os.path.join(OUT, f'{name}.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    size = os.path.getsize(path)
    assert size <= 60 * 1024, f'{name} is {size} bytes'
    print(f'{name:9s} {len(x) * 1000 // RATE:4d} ms  {size / 1024:5.1f} KB  peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for old in ('cash.wav',):  # renamed to paid.wav
        p = os.path.join(OUT, old)
        if os.path.exists(p):
            os.remove(p)
    for name, make in SOUNDS.items():
        write(name, make())
