"""Pitch detector benchmark for Sprout.

    python run_bench.py --data data/synth                    # synthetic set (exact truth)
    python run_bench.py --data data/recordings --reference   # your recordings (CREPE-full reference)

Modes per detector:
  offline     whole file at once (best case, not real-time)
  L20, L40    streaming: only 20 / 40 ms of audio after the reported instant
  L20+guard   L20 plus Sprout's octave-jump guard (hold value unless a jump persists 60 ms)

Writes results/<set>/summary.md, a per-frame table, and pitch plots.
"""
from __future__ import annotations

import argparse
import csv
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

import detectors as D

CONTEXT_S = 0.3   # covers PESTO's longest CQT kernel half (128 ms) and FCPE's useful context
STRIDE_S = 0.03
LOOKAHEADS = [0.020, 0.040]
C6 = 1046.5
F5 = 698.5


# ------------------------------------------------------------------------------------------
def load_clip(wav: Path):
    x, sr = sf.read(wav, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    x16 = soxr.resample(x, sr, 16000).astype(np.float32)
    truth = None
    csv_path = wav.with_suffix("").with_suffix(".f0.csv")
    if csv_path.exists():
        rows = np.loadtxt(csv_path, delimiter=",", skiprows=1)
        truth = (rows[:, 0], rows[:, 1])
    return x, sr, x16, truth


def nearest(times, values, query):
    idx = np.clip(np.searchsorted(times, query), 1, len(times) - 1)
    left = times[idx - 1]
    right = times[idx]
    idx -= query - left < right - query
    return values[idx]


def sample_track(track, query):
    times, f0, voiced = track
    return nearest(times, f0, query), nearest(times, voiced.astype(float), query) > 0.5


def octave_guard(f0, voiced, frame_s=STRIDE_S, persist=2, reset_s=0.3):
    """Causal: hold the last accepted pitch when a ~octave jump appears, unless it persists."""
    out_f0 = np.zeros_like(f0)
    out_v = voiced.copy()
    last, pending, silent = None, 0, 0.0
    for i in range(len(f0)):
        if not voiced[i] or f0[i] <= 0:
            silent += frame_s
            if silent >= reset_s:
                last, pending = None, 0
            out_v[i] = False
            continue
        silent = 0.0
        if last is None:
            last = f0[i]
        else:
            cents = 1200 * np.log2(f0[i] / last)
            octs = round(cents / 1200)
            if octs != 0 and abs(cents - 1200 * octs) < 250:
                pending += 1
                if pending < persist:
                    out_f0[i] = last
                    continue
            pending = 0
            last = f0[i]
        out_f0[i] = last
    return out_f0, out_v


# ------------------------------------------------------------------------------------------
def streaming_track(det, x_native, x16, query, lookahead, offline_track=None):
    """Estimate at each query time using only audio up to query + lookahead."""
    if det.kind == "frame":
        # The newest window that fits: centred at t when the lookahead covers half a window,
        # otherwise centred earlier (the estimate is then a little stale).
        full = offline_track if offline_track is not None else det.run(x_native if det.sr != 16000 else x16)
        return sample_track(full, query + min(0.0, lookahead - det.half_window_s))

    sr = 16000
    c, l = int(CONTEXT_S * sr), int(round(lookahead * sr))
    windows, valid = [], []
    for t in query:
        end = int(round(t * sr)) + l
        start = end - (c + l)
        if end > len(x16):
            valid.append(False)
            windows.append(np.zeros(c + l, np.float32))
            continue
        w = x16[max(0, start):end]
        if start < 0:
            w = np.pad(w, (-start, 0))
        windows.append(w)
        valid.append(True)
    windows = np.stack(windows)
    results = det.run_batch(windows)
    f0 = np.zeros(len(query))
    v = np.zeros(len(query), bool)
    for i, (times, tf0, tv) in enumerate(results):
        if not valid[i]:
            continue
        # A window's final frame is unreliable (half its hop is missing); never use it.
        times = times[:-1]
        k = int(np.argmin(np.abs(times - CONTEXT_S)))
        f0[i], v[i] = tf0[k], tv[k]
    return f0, v


def measure_cpu_ms(det, x16, x_native):
    """Returns (amortised CPU ms per estimate, CPU ms to recompute one whole streaming window).
    A streaming implementation that caches past work pays the first; a naive one the second."""
    seg = (x_native if det.sr != 16000 else x16)[: det.sr * 4]
    det.run(seg)  # warm-up
    t0 = time.perf_counter()
    times, _, _ = det.run(seg)
    per_frame = (time.perf_counter() - t0) / max(1, len(times)) * 1000
    if det.kind == "frame":
        return per_frame, per_frame
    w = x16[16000: 16000 + int((CONTEXT_S + 0.02) * 16000)]
    t0 = time.perf_counter()
    for _ in range(10):
        det.run(w)
    return per_frame, (time.perf_counter() - t0) / 10 * 1000


# ------------------------------------------------------------------------------------------
def metrics(truth, est, voiced, truth_voiced_mask=None):
    tv = truth > 0 if truth_voiced_mask is None else truth_voiced_mask
    out = {}
    n_tv = tv.sum()
    if n_tv == 0:
        return None
    det = tv & voiced & (est > 0)
    cents = np.zeros_like(truth)
    cents[det] = 1200 * np.log2(est[det] / truth[det])
    correct = det & (np.abs(cents) <= 50)
    octs = np.round(cents / 1200)
    octave = det & (octs != 0) & (np.abs(cents - 1200 * octs) <= 50)
    out["frames"] = int(n_tv)
    out["recall"] = det.sum() / n_tv
    out["usable"] = correct.sum() / n_tv
    out["octave_of_detected"] = octave.sum() / max(1, det.sum())
    out["gross_other_of_detected"] = (det & ~correct & ~octave).sum() / max(1, det.sum())
    out["median_cents"] = float(np.median(np.abs(cents[correct]))) if correct.any() else float("nan")
    # Raw pitch: right pitch on sung frames, whatever the detector's voicing decision said.
    has = tv & (est > 0)
    raw = np.zeros_like(truth)
    raw[has] = 1200 * np.log2(est[has] / truth[has])
    out["raw"] = (has & (np.abs(raw) <= 50)).sum() / n_tv
    if truth_voiced_mask is None:
        unv = ~tv
        out["false_voicing"] = (unv & voiced & (est > 0)).sum() / max(1, unv.sum())
    else:
        out["false_voicing"] = None  # meaningless inside a pitch band
    return out


def fmt(p):
    return "–" if p is None or (isinstance(p, float) and np.isnan(p)) else f"{100 * p:.1f}%"


# ------------------------------------------------------------------------------------------
_worker = {}


def process_clip(job):
    """Runs every detector on one clip. Executed in a worker process."""
    wav, only, use_reference, plots = job
    if "dets" not in _worker:
        dets = D.all_candidates()
        if only:
            dets = [d for d in dets if d.name in only]
        _worker["dets"] = dets
        _worker["ref"] = D.Crepe("full", viterbi=True, periodicity=0.5) if use_reference else None
    dets, reference = _worker["dets"], _worker["ref"]

    wav = Path(wav)
    x, sr, x16, truth = load_clip(wav)
    clip = wav.stem
    voice, _, cond = clip.partition("__")
    cond = cond or "recording"
    query = np.arange(CONTEXT_S, len(x16) / 16000 - 0.05, STRIDE_S)
    if truth is not None:
        tq = nearest(truth[0], truth[1], query)
    else:
        rf0, rv = sample_track(reference.run(x16), query)
        tq = np.where(rv, rf0, 0.0)

    rows, plot = [], {}
    for det in dets:
        if isinstance(det, D.MPM) and det.sr != sr:
            det = D.MPM(sr=sr)
        native = x if det.sr == sr else x16
        track = det.run(native)
        modes = {"offline": sample_track(track, query)}
        for la in LOOKAHEADS:
            modes[f"L{int(la * 1000)}"] = streaming_track(det, native, x16, query, la, offline_track=track)
        modes["L20+guard"] = octave_guard(*modes["L20"])
        for mode, (f0, v) in modes.items():
            rows.append((det.name, mode, voice, cond, tq, f0, v))
            if clip in plots and mode in ("L20+guard", "offline"):
                plot[(det.name, mode)] = (query, f0, v)
    if clip in plots:
        plot[("truth", "")] = (query, tq, tq > 0)
    return rows, plot, clip


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/synth")
    ap.add_argument("--out", default=None)
    ap.add_argument("--reference", action="store_true", help="no truth files: use CREPE-full+viterbi as reference")
    ap.add_argument("--only", nargs="*", help="detector names to run")
    ap.add_argument("--plots", nargs="*", default=["high_soprano__clean", "high_soprano__uke_bleed", "coloratura__breathy"])
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    data = Path(args.data)
    out = Path(args.out or Path("results") / data.name)
    out.mkdir(parents=True, exist_ok=True)
    wavs = sorted(data.glob("*.wav"))
    print(f"{len(wavs)} clips from {data}")

    rows = []          # per-frame records
    plot_data = defaultdict(dict)
    jobs = [(str(w), args.only, args.reference, args.plots) for w in wavs]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for i, (clip_rows, clip_plots, clip) in enumerate(pool.map(process_clip, jobs)):
            rows += clip_rows
            for k, v in clip_plots.items():
                plot_data[clip][k] = v
            print(f"[{i + 1}/{len(wavs)}] {clip}", flush=True)

    # CPU cost, measured in this process alone so workers don't skew it.
    dets = D.all_candidates()
    if args.only:
        dets = [d for d in dets if d.name in args.only]
    x, sr, x16, _ = load_clip(wavs[0])
    latency = {}
    for det in dets:
        if isinstance(det, D.MPM) and det.sr != sr:
            det = D.MPM(sr=sr)
        latency[det.name] = measure_cpu_ms(det, x16, x if det.sr == sr else x16)

    # ---- aggregate --------------------------------------------------------------------------
    def agg(filter_fn, band=None):
        acc = defaultdict(lambda: [[], [], []])
        for name, mode, voice, cond, tq, f0, v in rows:
            if not filter_fn(voice, cond):
                continue
            a = acc[(name, mode)]
            a[0].append(tq); a[1].append(f0); a[2].append(v)
        res = {}
        for key, (t, f, v) in acc.items():
            t, f, v = np.concatenate(t), np.concatenate(f), np.concatenate(v)
            mask = None
            if band is not None:
                lo, hi = band
                mask = (t > 0) & (t >= lo) & (t < hi)
            res[key] = metrics(t, f, v, mask)
        return res

    names = [d.name for d in dets]
    modes = ["offline"] + [f"L{int(la * 1000)}" for la in LOOKAHEADS] + ["L20+guard"]
    conds = sorted({r[3] for r in rows})
    lines = [f"# Pitch benchmark: `{data}`", ""]
    lines.append(f"{len(wavs)} clips. Streaming modes use {int(CONTEXT_S * 1000)} ms of past audio and the stated lookahead; "
                 f"estimates every {int(STRIDE_S * 1000)} ms. CPU: 2 threads.")
    lines.append("")
    lines.append("**Usable** = share of sung frames reported voiced *and* within 50 cents. "
                 "**Raw pitch** = share of sung frames whose pitch is within 50 cents, ignoring the voicing decision. "
                 "**Octave err** and **Other gross** are shares of the frames the detector reported voiced. "
                 "**False voicing** = share of silent/unsung frames reported voiced. "
                 "**Latency** = lookahead + CPU time per new estimate.")
    lines.append("")

    def table(title, res, with_latency):
        lines.append(f"## {title}")
        lines.append("")
        hdr = "| Detector | Mode | Usable | Raw pitch | Octave err | Other gross | Missed | False voicing | Median error (cents) |"
        if with_latency:
            hdr += " Latency |"
        lines.append(hdr)
        lines.append("|" + " --- |" * (hdr.count("|") - 1))
        for n in names:
            for m in modes:
                r = res.get((n, m))
                if r is None:
                    continue
                row = (f"| {n} | {m} | {fmt(r['usable'])} | {fmt(r['raw'])} | {fmt(r['octave_of_detected'])} | {fmt(r['gross_other_of_detected'])} | "
                       f"{fmt(1 - r['recall'])} | {fmt(r['false_voicing'])} | {r['median_cents']:.0f} |")
                if with_latency:
                    if m == "offline":
                        row += " – |"
                    else:
                        la = 0.040 if m == "L40" else 0.020
                        row += f" {la * 1000 + latency[n][0]:.0f} ms |"
                lines.append(row)
        lines.append("")

    table("All conditions, all pitches", agg(lambda v, c: True), True)
    table("All conditions, notes above C6 (1046 Hz)", agg(lambda v, c: True, band=(C6, 1e9)), False)
    table("All conditions, F5 to C6", agg(lambda v, c: True, band=(F5, C6)), False)

    lines.append("## Usable by condition (L20+guard)")
    lines.append("")
    lines.append("| Detector | " + " | ".join(conds) + " |")
    lines.append("|" + " --- |" * (len(conds) + 1))
    per_cond = {c: agg(lambda v, cc, c=c: cc == c) for c in conds}
    for n in names:
        lines.append(f"| {n} | " + " | ".join(fmt((per_cond[c].get((n, 'L20+guard')) or {}).get('usable')) for c in conds) + " |")
    lines.append("")
    lines.append("## Usable above C6 by condition (L20+guard)")
    lines.append("")
    lines.append("| Detector | " + " | ".join(conds) + " |")
    lines.append("|" + " --- |" * (len(conds) + 1))
    per_cond_hi = {c: agg(lambda v, cc, c=c: cc == c, band=(C6, 1e9)) for c in conds}
    for n in names:
        lines.append(f"| {n} | " + " | ".join(fmt((per_cond_hi[c].get((n, 'L20+guard')) or {}).get('usable')) for c in conds) + " |")
    lines.append("")

    lines.append("## False voicing by condition (L20+guard)")
    lines.append("")
    lines.append("Share of frames with no singing that the detector reported as sung. With uke bleed, "
                 "the instrument keeps playing between phrases, so a high value there means it tracked the uke.")
    lines.append("")
    lines.append("| Detector | " + " | ".join(conds) + " |")
    lines.append("|" + " --- |" * (len(conds) + 1))
    for n in names:
        lines.append(f"| {n} | " + " | ".join(fmt((per_cond[c].get((n, 'L20+guard')) or {}).get('false_voicing')) for c in conds) + " |")
    lines.append("")

    lines.append("## CPU cost per estimate (2 threads)")
    lines.append("")
    lines.append("| Detector | Cached streaming | Recompute whole window |")
    lines.append("| --- | --- | --- |")
    for n in names:
        lines.append(f"| {n} | {latency[n][0]:.2f} ms | {latency[n][1]:.1f} ms |")
    lines.append("")
    lines.append("Context models never use a window's final frame (unreliable for all three), so their newest "
                 "estimate is one hop older than the lookahead suggests: 16 ms for SwiftF0, 10 ms for PESTO and FCPE.")
    lines.append("")

    (out / "summary.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))

    # ---- plots ------------------------------------------------------------------------------
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        for clip, tracks in plot_data.items():
            fig, axes = plt.subplots(len(names), 1, figsize=(14, 2.2 * len(names)), sharex=True)
            q, tf, tv = tracks[("truth", "")]
            for ax, n in zip(np.atleast_1d(axes), names):
                ax.plot(q, np.where(tv, tf, np.nan), color="k", lw=3, alpha=0.25, label="truth")
                if (n, "L20+guard") in tracks:
                    _, f, v = tracks[(n, "L20+guard")]
                    ax.plot(q, np.where(v, f, np.nan), ".", ms=2.5, label=f"{n} L20+guard")
                ax.set_yscale("log")
                ax.set_ylim(60, 2200)
                ax.axhline(C6, color="r", lw=0.5, ls="--")
                ax.legend(loc="upper left", fontsize=8)
            plt.suptitle(clip)
            plt.tight_layout()
            plt.savefig(out / f"plot_{clip}.png", dpi=90)
            plt.close(fig)
    except Exception as e:  # plots are optional
        print("plotting failed:", e)


if __name__ == "__main__":
    main()
