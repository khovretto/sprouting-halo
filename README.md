# Sprout Visualizer (MVP)

A giant audio-reactive halo for a VTube Studio avatar. Sprout Tap plugins in the DAW stream the
dry vocal of each take to the Sprout app, which renders a transparent halo and sends it to OBS
over Spout.

```
DAW track(s) ── Sprout Tap (VST3) ──shared memory──► Sprout.exe ──Spout "Sprout"──► OBS
```

What the MVP does:

- One ring per take: the live voice is the main gold ring, playback takes add inner rings, and an
  optional instrument track adds a thin outer ring that sparkles on strums.
- Rings breathe, grow, glow and run hot toward white with loudness, and flash on onsets.
- A single live track looks complete on its own.
- When no tap is connected, a faint idle ring shows so you can position the halo in OBS.

Pitch (MPM, to F6) and vibrato are analysed in the app and sent to the web viewer (`viewer/`), which also
does sway and themes. Not done yet: calibration, VTube Studio link (see the design doc).

## Build

Requirements: Windows 10/11, Visual Studio 2022 (C++ desktop workload), CMake 3.22+.

```bash
git clone --depth 1 --branch 8.0.9 https://github.com/juce-framework/JUCE.git external/JUCE
```

```bash
git clone --depth 1 --branch 2.007.018 https://github.com/leadedge/Spout2.git external/Spout2
```

```bash
cmake -S . -B build -G "Visual Studio 17 2022" -A x64
```

```bash
cmake --build build --config Release
```

Outputs:

| File | What it is |
| --- | --- |
| `build/Release/Sprout.exe` | The app: renderer + Spout sender |
| `build/SproutTap_artefacts/Release/VST3/Sprout Tap.vst3` | The tap plugin |
| `build/Release/fake_tap.exe` | Test tool: fake sung takes, no DAW needed |
| `build/Release/spout_snapshot.exe` | Test tool: grabs one Spout frame as a PNG |
| `build/Release/pitch_test.exe` | Test tool: scores the app's pitch tracker on `bench/data/synth` |

## Setup

1. **Install the plugin:** copy the whole `Sprout Tap.vst3` folder to
   `C:\Program Files\Common Files\VST3\` and rescan plugins in Reaper.
2. **In Reaper:** put **Sprout Tap first** on each take track, before reverb, EQ or pitch
   correction. Its Role:
   - **Auto (follows record arm)**, the default: in Reaper a record-armed track is the live voice
     and every other track is a take playing back. Disarm a track after recording it and its
     visual turns from the halo into a plant on its own. Other DAWs don't report record arm, so
     there Auto acts as Live voice; pick a role by hand instead.
   - **Live voice** on the track you're singing into now,
   - **Take playback** on recorded layers,
   - **Instrument** on a separate instrument track, if you have one.

   The same window sets this track's look in the viewer: **Theme** (leaves, thorns, Christmas
   wreath, branches only, or viewer default), **Amount** of leaves/thorns, and **Colour** (the
   Reaper track colour, or the viewer palette).

   This plugin speaks bus protocol v2: update Sprout.exe and every Sprout Tap instance together.

   The plugin window shows "Connected" when it has a slot. Track name and color are picked up
   from Reaper automatically.
3. **Run `Sprout.exe`.** The preview window shows the halo over a checkerboard.
   - Up / Down: sensitivity (raise it if the halo barely reacts, lower it if it's always maxed)
   - I: hide the idle ring
   - Esc: quit
4. **In OBS:**
   1. Install the Off World Live Spout2 plugin for OBS from its GitHub releases page
      (Off-World-Live/obs-spout2-plugin). Close OBS and run the installer with its default folder.
      Pick the release that matches your OBS version; current releases need OBS 33 or newer.
   2. With `Sprout.exe` running, add a source with **+ → Spout2 Capture** and name it "Sprout halo".
   3. In its properties, set **Spout Sender** to **Sprout** and change **Composite mode** from
      the default **Opaque** to the **alpha** option. Opaque draws the halo on a black square.
      Leave the other options at their defaults.
   4. In the Sources list, drag "Sprout halo" **below** your VTube Studio source, so the avatar
      draws over the halo.
   5. Scale and move the halo so the ring sits around your avatar's head and shoulders. Hold
      Shift while dragging a corner if OBS won't keep it square.

   If the source stays black, OBS and Sprout are probably on different GPUs. Set both to the same
   GPU (High performance) in Windows Settings → System → Display → Graphics.

Start order doesn't matter: taps and the app find each other whenever both are running.

## Test without a DAW

```bash
build/Release/Sprout.exe
```

```bash
build/Release/fake_tap.exe --takes 3 --instrument
```

`fake_tap` sings a melody up to F6 with vibrato on up to 6 takes (harmony layers above take 1).
With the app running, `spout_snapshot.exe --out frame.png` saves what OBS would receive plus a
`frame_preview.png` over a checkerboard, and prints an alpha profile.

## Layout

| Path | Contents |
| --- | --- |
| `common/SproutBus.h` | Shared-memory protocol (slots, seqlock, audio ring) |
| `tap/` | JUCE tap plugin |
| `app/` | Renderer, analysis, Spout sender; `HaloShaders.h` has the HLSL |
| `tools/` | `fake_tap`, `spout_snapshot`, `pitch_test` |
| `app/Pitch.h` | Pitch + vibrato tracker (MPM, octave guard, voicing hysteresis) |
| `viewer/` | New web visual layer (WebGL2, OBS Browser Source): halo vine, take plants, layouts. `Sprout.exe` feeds it live tap features over WebSocket and serves it at `http://localhost:7777`. See `viewer/README.md` for the OBS setup that replaces Spout. |
| `app/FeatureServer.*` | Localhost HTTP + WebSocket server in `Sprout.exe` for the viewer. |
| `docs/` | Research notes (procedural growth, layer layout) |

### Protocol in short

`Local\SproutBus_v1` holds 16 slots. Each tap instance claims one and is its only writer. It
publishes role, track name and color, sample rate, tempo and playhead, and block level under a
seqlock, and writes dry mono audio into a 32768-sample ring. A heartbeat marks it alive, and a
slot older than 5 s can be reclaimed after a crash. The app only reads, so DAWs that run plugins
in separate processes work too.
