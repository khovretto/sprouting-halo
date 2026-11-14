# Sprout pitch benchmark

Compares live pitch detectors for Sprout: **MPM** (classic), **CREPE-tiny**, **PESTO**, **SwiftF0**
and **FCPE**. Each is scored offline (best case) and streamed with only 20 or 40 ms of future
audio, which is what the app can afford. A further mode adds Sprout's octave-jump guard.

## Setup (once)

```bash
py -3.12 -m venv bench/.venv
```

```bash
bench/.venv/Scripts/python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

```bash
bench/.venv/Scripts/python -m pip install numpy scipy soundfile soxr librosa matplotlib onnxruntime pesto-pitch swift-f0 torchfcpe torchcrepe
```

## 1. Synthetic set (exact pitch, already run)

```bash
cd bench && .venv/Scripts/python synth.py --out data/synth
```

```bash
cd bench && .venv/Scripts/python run_bench.py --data data/synth
```

The set is 7 voice types (bass to coloratura reaching F6) × 5 conditions (clean, breathy, reverb,
uke bleed, noisy), 20 s each. Results go to `results/synth/summary.md` plus pitch plots.

Synthetic voices are easier than real ones, so these results narrow the field; your recordings
decide.

## 2. Your recordings (the real test)

**What to record:** about 10–15 minutes in total, dry (no reverb or pitch correction), at your
normal mic position:

| File name | What to sing |
| --- | --- |
| `me__sustained.wav` | Long held notes across your whole range, including F6 if you can, with and without vibrato |
| `me__runs.wav` | Fast runs and scales, especially into the top of your range |
| `me__songs.wav` | A couple of real songs as you'd sing them on stream |
| `me__breathy.wav` | Soft, breathy and quiet passages |
| `me__uke.wav` | Singing while playing the uke into the same mic |
| `me__uke_only.wav` | Uke alone, no singing (checks false voicing) |

The part after `__` becomes the condition name in the results. Use any number of files.

**Getting the files out of Reaper:** recorded takes are already dry WAV files in the project's
media folder (right-click the item → *Show in explorer*). Copy them into `bench/data/recordings/`
and rename them as above. Stereo is fine; it's mixed to mono.

**Run:**

```bash
cd bench && .venv/Scripts/python run_bench.py --data data/recordings --reference --plots me__sustained me__runs me__uke
```

With `--reference` there's no exact truth, so the slow offline **CREPE-full + Viterbi** stands
in for it. Only frames it's confident about count. That reference can be wrong too, especially
high up, so check the plots in `results/recordings/`: the grey line is the reference, the dots
are each detector streamed at 20 ms with the guard.

## Files

| File | Purpose |
| --- | --- |
| `synth.py` | Synthetic singing with exact f0 |
| `detectors.py` | One wrapper per detector, same interface |
| `run_bench.py` | Streaming simulation, octave guard, metrics, report, plots |
