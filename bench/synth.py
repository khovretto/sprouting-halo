"""Synthetic singing test set with exact pitch ground truth.

Real recordings are the real test; this set exists because it has *exact* f0, so it can show
octave errors and behaviour above C6 precisely. Each clip is a voice type x a condition.

    python synth.py --out data/synth --seconds 20

Writes <name>.wav (48 kHz mono, like a DAW track) and <name>.f0.csv (time_s, f0_hz; 0 = unvoiced)
on a 10 ms grid.
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
GRID = 0.010  # ground-truth hop (s)


def midi_to_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m) - 69.0) / 12.0)


def name_to_midi(n: str) -> int:
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    base, octave = n[:-1], int(n[-1])
    semitone = names[base[0]] + (1 if base.endswith("#") else 0)
    return 12 * (octave + 1) + semitone


@dataclass
class VoiceType:
    name: str
    low: str
    high: str
    run_rate: float  # notes/s in fast passages (coloratura)


VOICES = [
    VoiceType("bass", "E2", "D4", 0.0),
    VoiceType("baritone", "A2", "F4", 0.0),
    VoiceType("tenor", "C3", "C5", 0.0),
    VoiceType("alto", "F3", "F5", 0.0),
    VoiceType("soprano", "C4", "C6", 0.0),
    VoiceType("high_soprano", "G4", "F6", 0.0),
    VoiceType("coloratura", "C5", "F6", 8.0),
]

CONDITIONS = ["clean", "breathy", "reverb", "uke_bleed", "noisy"]

# Vowel formants (Hz) and bandwidths for a simple formant envelope.
VOWELS = {
    "a": [(800, 80), (1150, 90), (2900, 120), (3900, 130)],
    "i": [(300, 60), (2300, 100), (3000, 120), (3700, 130)],
    "u": [(350, 60), (700, 80), (2500, 120), (3500, 130)],
    "o": [(500, 70), (850, 80), (2800, 120), (3600, 130)],
}


# ------------------------------------------------------------------------------------------
# Melody: a per-sample f0 track (0 = silence) plus note boundaries.
def make_melody(voice: VoiceType, seconds: float, rng: np.random.Generator):
    lo, hi = name_to_midi(voice.low), name_to_midi(voice.high)
    scale = np.array([0, 2, 4, 5, 7, 9, 11])
    notes = [m for m in range(lo, hi + 1) if (m % 12) in scale]
    n = int(seconds * SR)
    f0 = np.zeros(n)
    vowel_idx = np.zeros(n, dtype=int)
    t = 0.25
    idx = len(notes) // 2
    segments = []  # (start_s, end_s) of voiced notes, for onsets
    while t < seconds - 0.5:
        fast = voice.run_rate > 0 and rng.random() < 0.5
        phrase_notes = rng.integers(6, 14) if fast else rng.integers(3, 7)
        # Make sure every phrase visits the top of the range sometimes.
        if rng.random() < 0.35:
            idx = len(notes) - 1 - rng.integers(0, 3)
        start = t
        prev_m = None
        vowel = rng.integers(0, len(VOWELS))
        top = len(notes) - 1
        reaches_c6 = midi_to_hz(notes[top]) >= 1040
        if fast:
            # Coloratura run: a scale up to the top of the range and part of the way back.
            first = int(rng.integers(0, max(1, top - 4)))
            up = list(range(first, top + 1))
            down = list(range(top - 1, max(first, top - int(rng.integers(3, 8))) - 1, -1))
            plan = [(i, 1.0 / voice.run_rate) for i in up + down]
        else:
            plan = []
            for _ in range(int(phrase_notes)):
                idx = int(np.clip(idx + rng.choice([-2, -1, -1, 1, 1, 2, 3, -3]), 0, top))
                plan.append((idx, float(rng.uniform(0.25, 1.4))))
            if reaches_c6 and rng.random() < 0.6:
                # High voices often end a phrase on a long top note (F6 for the highest).
                plan.append((top - int(rng.integers(0, 2)), float(rng.uniform(0.9, 1.6))))
        for idx, dur in plan:
            m = notes[idx]
            if t + dur > seconds - 0.3:
                break
            a, b = int(t * SR), int((t + dur) * SR)
            tt = np.arange(b - a) / SR
            # Pitch: target note, legato glide from previous, vibrato on long notes, small jitter.
            semis = np.full(b - a, float(m))
            if prev_m is not None:
                glide = min(0.06, dur * 0.3)
                g = tt < glide
                semis[g] = prev_m + (m - prev_m) * (tt[g] / glide)
            if dur > 0.45 and not fast:
                rate = rng.uniform(4.5, 7.5)
                depth = rng.uniform(0.2, 1.3)  # semitones peak-to-peak / 2
                onset = np.clip((tt - 0.2) / 0.3, 0, 1)
                semis += depth * onset * np.sin(2 * np.pi * rate * tt + rng.uniform(0, 6.28))
            jitter = np.cumsum(rng.normal(0, 0.002, b - a))
            jitter -= np.linspace(0, jitter[-1], b - a)  # keep it bounded
            semis += np.clip(jitter, -0.15, 0.15)
            f0[a:b] = midi_to_hz(semis)
            vowel_idx[a:b] = vowel
            prev_m = m
            t += dur
        segments.append((start, t))
        idx = int(np.clip(idx, 0, len(notes) - 1))
        t += rng.uniform(0.25, 0.9)  # breath
    return f0, vowel_idx, segments


# ------------------------------------------------------------------------------------------
def formant_gain(freqs, vowel_formants, f0_block):
    """Magnitude of a simple parallel formant envelope at the given frequencies.
    Sopranos tune the first resonance to f0 when f0 rises above it."""
    g = np.zeros_like(freqs)
    for i, (fc, bw) in enumerate(vowel_formants):
        fc = np.full_like(freqs, float(fc))
        if i == 0:
            fc = np.where(f0_block > 0.9 * fc, f0_block * 1.05, fc)
        g += 1.0 / np.sqrt(1 + ((freqs - fc) / (bw * 1.5)) ** 2) * (0.9 ** i)
    return g


def synth_voice(f0, vowel_idx, rng, breathiness=0.0):
    n = len(f0)
    voiced = f0 > 0
    # Amplitude envelope: attack/release around voiced runs + slow swell.
    env = voiced.astype(float)
    k = int(0.03 * SR)
    env = np.convolve(env, np.ones(k) / k, mode="same")
    swell = 0.7 + 0.3 * np.sin(2 * np.pi * 0.35 * np.arange(n) / SR + rng.uniform(0, 6))
    env *= swell

    f0_filled = f0.copy()
    if voiced.any():  # hold pitch through release tails so phase stays continuous
        idx = np.where(voiced, np.arange(n), 0)
        np.maximum.accumulate(idx, out=idx)
        f0_filled = f0[idx]
        f0_filled[~voiced & (idx == 0)] = 0
    phase = 2 * np.pi * np.cumsum(f0_filled) / SR

    block = 256
    nb = (n + block - 1) // block
    vowels = list(VOWELS.values())
    out = np.zeros(n)
    max_h = int(7500 / 70)
    # Harmonic amplitudes per block, then linear interpolation per sample.
    block_f0 = np.array([f0_filled[i * block:(i + 1) * block].mean() for i in range(nb)])
    block_v = np.array([vowel_idx[min(i * block, n - 1)] for i in range(nb)])
    centers = (np.arange(nb) + 0.5) * block
    for h in range(1, max_h + 1):
        freqs = block_f0 * h
        active = (freqs > 0) & (freqs < 7500)
        if not active.any():
            break
        amp = np.zeros(nb)
        for vi in np.unique(block_v[active]):
            sel = active & (block_v == vi)
            amp[sel] = formant_gain(freqs[sel], vowels[vi], block_f0[sel])
        amp *= h ** -1.2  # glottal source tilt
        amp_s = np.interp(np.arange(n), centers, amp)
        out += amp_s * np.sin(h * phase)
    out *= env

    if breathiness > 0:
        sos = butter(4, [1500, 7000], btype="band", fs=SR, output="sos")
        noise = sosfilt(sos, rng.normal(0, 1, n))
        out += breathiness * np.std(out[voiced] if voiced.any() else out) / (np.std(noise) + 1e-9) * noise * env
    return out / (np.max(np.abs(out)) + 1e-9) * 0.5, env


def consonant_bursts(segments, n, rng):
    """Short unvoiced noise bursts (s, t, sh) just before phrases."""
    out = np.zeros(n)
    sos = butter(4, [3000, 9000], btype="band", fs=SR, output="sos")
    for start, _ in segments:
        if rng.random() < 0.7:
            d = int(rng.uniform(0.05, 0.12) * SR)
            a = max(0, int(start * SR) - d)
            burst = sosfilt(sos, rng.normal(0, 1, d)) * np.hanning(d)
            out[a:a + d] += burst
    return out / (np.max(np.abs(out)) + 1e-9) * 0.12


def reverb(x, rng, rt60=0.7, wet=0.35):
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / rt60)
    ir[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))
    y = fftconvolve(x, ir)[: len(x)]
    y *= np.std(x) / (np.std(y) + 1e-9)
    return (1 - wet) * x + wet * y


def ukulele(n, rng, bpm=100):
    """Karplus-Strong strummed ukulele chords (G C E A tuning)."""
    chords = [[67, 60, 64, 69], [69, 60, 64, 69], [69, 65, 69, 72], [67, 62, 67, 71]]  # C Am F G
    out = np.zeros(n)
    beat = 60 / bpm
    t, c = 0.0, 0
    while t < n / SR - 1:
        for s, m in enumerate(chords[(c // 4) % 4]):
            f = midi_to_hz(m)
            period = int(SR / f)
            buf = rng.uniform(-1, 1, period)
            length = int(1.2 * SR)
            y = np.zeros(length)
            for i in range(length):  # simple loop, short strings
                y[i] = buf[i % period]
                buf[i % period] = 0.497 * (buf[i % period] + buf[(i + 1) % period])
            a = int((t + s * 0.012) * SR)
            b = min(n, a + length)
            out[a:b] += y[: b - a] * (0.9 if c % 2 == 0 else 0.6)
        t += beat
        c += 1
    return out


def truth_grid(f0, env):
    times = np.arange(0, len(f0) / SR, GRID)
    idx = np.minimum((times * SR).astype(int), len(f0) - 1)
    # Sung = a note is active and clearly audible (attack/release ramps below 20% excluded).
    vals = np.where((f0[idx] > 0) & (env[idx] > 0.2 * env.max()), f0[idx], 0.0)
    return times, vals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/synth")
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    for voice in VOICES:
        f0, vowel_idx, segments = make_melody(voice, args.seconds, rng)
        for cond in CONDITIONS:
            crng = np.random.default_rng(rng.integers(1 << 31))
            x, env = synth_voice(f0, vowel_idx, crng, breathiness=0.6 if cond == "breathy" else 0.05)
            if cond == "breathy":
                x = x + consonant_bursts(segments, len(x), crng)
            if cond == "reverb":
                x = reverb(x, crng)
            if cond == "uke_bleed":
                u = ukulele(len(x), crng)
                x = x + u * (np.std(x) / (np.std(u) + 1e-9)) * 10 ** (-6 / 20)
            if cond == "noisy":
                x = x + crng.normal(0, np.std(x) * 10 ** (-20 / 20), len(x))
            x = x / (np.max(np.abs(x)) + 1e-9) * 0.7
            name = f"{voice.name}__{cond}"
            sf.write(out / f"{name}.wav", x.astype(np.float32), SR)
            times, vals = truth_grid(f0, env)
            with open(out / f"{name}.f0.csv", "w", newline="") as fh:
                w = csv.writer(fh)
                w.writerow(["time_s", "f0_hz"])
                w.writerows(zip(np.round(times, 4), np.round(vals, 3)))
            print(f"wrote {name}  voiced={np.mean(vals > 0):.0%}  max={vals.max():.0f} Hz")


if __name__ == "__main__":
    main()
