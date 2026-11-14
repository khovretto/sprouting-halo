"""Pitch detector wrappers with one interface.

Every detector returns (times_s, f0_hz, voiced) for a mono float32 signal at its native rate.
`voiced` uses each detector's own recommended threshold.

Two kinds, which decides how the streaming test treats them:
  - frame models (MPM, CREPE): each estimate depends only on one analysis window, so a
    streamed result at time t equals the offline frame centred at t + lookahead - half_window.
  - context models (PESTO, SwiftF0, FCPE): the network looks at many frames, so the streaming
    test re-runs them on [t - context, t + lookahead] windows.
"""
from __future__ import annotations

import numpy as np
import torch

torch.set_num_threads(2)


class Detector:
    name = "?"
    sr = 16000
    kind = "context"          # or "frame"
    half_window_s = 0.0       # frame models: centre-to-edge of the analysis window
    batchable = False

    def run(self, x: np.ndarray):
        raise NotImplementedError

    def run_batch(self, windows: np.ndarray):
        """windows: (B, N). Returns list of (times, f0, voiced). Default: loop."""
        return [self.run(w) for w in windows]


# ------------------------------------------------------------------------------------------
class MPM(Detector):
    """McLeod Pitch Method (NSDF), the classic low-latency baseline. Runs at 48 kHz."""

    kind = "frame"

    def __init__(self, sr=48000, window=2048, hop=480, fmin=60.0, fmax=2100.0, k=0.88, clarity=0.75):
        self.name = "MPM"
        self.sr, self.W, self.hop = sr, window, hop
        self.tau_min = int(sr / fmax)
        self.tau_max = min(int(sr / fmin), window - 2)
        self.k, self.clarity = k, clarity
        self.half_window_s = window / 2 / sr

    def run(self, x):
        x = np.asarray(x, dtype=np.float64)
        if len(x) < self.W:
            x = np.pad(x, (0, self.W - len(x)))
        n = 1 + (len(x) - self.W) // self.hop
        idx = np.arange(self.W)[None, :] + self.hop * np.arange(n)[:, None]
        frames = x[idx]
        frames = frames - frames.mean(axis=1, keepdims=True)
        spec = np.fft.rfft(frames, n=2 * self.W, axis=1)
        acf = np.fft.irfft(np.abs(spec) ** 2, axis=1)[:, : self.W]
        sq = frames ** 2
        c = np.cumsum(sq, axis=1)
        total = c[:, -1:]
        taus = np.arange(self.W)
        prefix = np.concatenate([np.zeros((n, 1)), c[:, :-1]], axis=1)    # sum x_0..x_{tau-1}
        m = c[:, self.W - 1 - taus] + (total - prefix)
        nsdf = np.where(m > 1e-12, 2 * acf / np.maximum(m, 1e-12), 0.0)
        rms_db = 10 * np.log10(np.maximum(sq.mean(axis=1), 1e-12))

        f0 = np.zeros(n)
        clar = np.zeros(n)
        lo, hi = self.tau_min, self.tau_max
        for i in range(n):
            d = nsdf[i, : hi + 2]
            # key maxima: highest point of each positive lobe after the first negative zero crossing
            neg = np.where((d[:-1] > 0) & (d[1:] <= 0))[0]
            if len(neg) == 0:
                continue
            start = neg[0] + 1
            seg = d[start:]
            pos_cross = np.where((seg[:-1] <= 0) & (seg[1:] > 0))[0] + start + 1
            neg_cross = np.where((seg[:-1] > 0) & (seg[1:] <= 0))[0] + start + 1
            peaks = []
            for a in pos_cross:
                b = neg_cross[neg_cross > a]
                b = b[0] if len(b) else len(d) - 1
                if b - a < 1:
                    continue
                j = a + int(np.argmax(d[a:b]))
                if lo <= j <= hi:
                    peaks.append(j)
            if not peaks:
                continue
            vals = d[peaks]
            thresh = self.k * vals.max()
            j = next(p for p, v in zip(peaks, vals) if v >= thresh)
            # parabolic interpolation
            if 0 < j < len(d) - 1:
                y0, y1, y2 = d[j - 1], d[j], d[j + 1]
                den = y0 - 2 * y1 + y2
                delta = 0.5 * (y0 - y2) / den if abs(den) > 1e-12 else 0.0
                peak = y1 - 0.25 * (y0 - y2) * delta
            else:
                delta, peak = 0.0, d[j]
            f0[i] = self.sr / (j + delta)
            clar[i] = peak
        times = (np.arange(n) * self.hop + self.W / 2) / self.sr
        voiced = (clar >= self.clarity) & (rms_db > -60)
        return times, f0, voiced


# ------------------------------------------------------------------------------------------
class Crepe(Detector):
    kind = "frame"
    half_window_s = 512 / 16000

    def __init__(self, model="tiny", viterbi=False, periodicity=0.25):
        import torchcrepe

        self.tc = torchcrepe
        self.model = model
        self.viterbi = viterbi
        self.name = f"CREPE-{model}" + ("+viterbi" if viterbi else "")
        self.periodicity = periodicity

    def run(self, x):
        audio = torch.from_numpy(np.asarray(x, dtype=np.float32))[None]
        decoder = self.tc.decode.viterbi if self.viterbi else self.tc.decode.weighted_argmax
        with torch.inference_mode():
            pitch, per = self.tc.predict(audio, 16000, hop_length=160, fmin=50.0, fmax=2006.0, model=self.model,
                                         decoder=decoder, return_periodicity=True, batch_size=1024,
                                         device="cpu", pad=True)
        f0 = pitch[0].numpy().astype(np.float64)
        per = per[0].numpy()
        times = np.arange(len(f0)) * 0.01
        return times, f0, per >= self.periodicity


# ------------------------------------------------------------------------------------------
class Pesto(Detector):
    batchable = True

    def __init__(self, model_name="mir-1k_g7", step_ms=10.0, conf=0.5):
        import pesto

        self.model = pesto.load_model(model_name, step_size=step_ms, sampling_rate=16000)
        self.step = step_ms / 1000
        self.conf = conf
        self.name = "PESTO"

    def _forward(self, batch):
        with torch.inference_mode():
            preds, conf, _ = self.model(torch.from_numpy(batch.astype(np.float32)), sr=16000,
                                        convert_to_freq=True, return_activations=False)
        return preds.numpy().astype(np.float64), conf.numpy()

    def run(self, x):
        f0, conf = self._forward(np.asarray(x)[None])
        f0, conf = f0[0], conf[0]
        times = np.arange(len(f0)) * self.step
        return times, f0, conf >= self.conf

    def run_batch(self, windows):
        out = []
        for s in range(0, len(windows), 128):
            f0, conf = self._forward(windows[s:s + 128])
            times = np.arange(f0.shape[1]) * self.step
            out += [(times, f0[i], conf[i] >= self.conf) for i in range(len(f0))]
        return out


# ------------------------------------------------------------------------------------------
class Swift(Detector):
    def __init__(self, conf=0.5):
        from swift_f0 import SwiftF0

        self.det = SwiftF0(threads=2)
        self.conf = conf
        self.name = "SwiftF0"

    def run(self, x):
        r = self.det.detect(np.asarray(x, dtype=np.float32), 16000)
        return np.asarray(r.timestamps), np.asarray(r.pitch_hz, dtype=np.float64), np.asarray(r.confidence) >= self.conf


# ------------------------------------------------------------------------------------------
class Fcpe(Detector):
    batchable = True

    def __init__(self, threshold=0.006):
        from torchfcpe import spawn_bundled_infer_model

        self.model = spawn_bundled_infer_model(device="cpu")
        self.threshold = threshold
        self.name = "FCPE"

    def _forward(self, batch):
        wav = torch.from_numpy(batch.astype(np.float32))[..., None]
        with torch.inference_mode():
            f0 = self.model.infer(wav, sr=16000, decoder_mode="local_argmax", threshold=self.threshold,
                                  f0_min=50, f0_max=2100, interp_uv=False)
        return f0[..., 0].numpy().astype(np.float64)

    def run(self, x):
        f0 = self._forward(np.asarray(x)[None])[0]
        times = np.arange(len(f0)) * 0.01
        return times, f0, f0 > 0

    def run_batch(self, windows):
        out = []
        for s in range(0, len(windows), 128):
            f0 = self._forward(windows[s:s + 128])
            times = np.arange(f0.shape[1]) * 0.01
            out += [(times, f0[i], f0[i] > 0) for i in range(len(f0))]
        return out


def all_candidates():
    return [MPM(), Crepe("tiny"), Pesto(), Swift(), Fcpe()]
