# Architecture

Three programs, two links between them.

```
┌──────────── DAW process(es) ────────────┐        ┌──────────────── Sprout.exe ────────────────┐        ┌──── browser / OBS ────┐
│ Sprout Tap (VST3, JUCE)                 │        │ reads every slot each frame                │        │ viewer (WebGL2)       │
│  one instance per track                 │ shared │ per tap: level, onsets, pitch (MPM),       │  WS    │  sources/live.ts      │
│  writes: role, name, colour, transport, ├───────►│ vibrato, effort, breath (app/Pitch.h)      ├───────►│  drives, growth,      │
│  record state, per-track look, dry mono │ memory │ FeatureServer: HTTP + WebSocket :7777      │ frames │  decorations, render  │
│  audio (ring buffer), heartbeat         │◄───────┤ settings merge + replay, themes folder,    │◄───────┤  panel, presets       │
│  reads: look requests, theme list       │ look   │ detection settings, simple Spout halo      │ params │                       │
└─────────────────────────────────────────┘ req.   └────────────────────────────────────────────┘ themes └───────────────────────┘
```

| Part | Code | Language |
| --- | --- | --- |
| Sprout Tap plugin | `tap/` | C++20, JUCE 8 (VST3) |
| Shared-memory protocol | `common/SproutBus.h` | C++ header, used by the tap, the app and the tools |
| Sprout.exe | `app/` | C++20, Win32, Direct3D 11, Spout2 |
| Viewer | `viewer/` | TypeScript, WebGL2, Vite, Tweakpane |
| Test tools | `tools/` | C++ |
| Pitch benchmark | `bench/` | Python |

## 1. The bus: tap → Sprout.exe

One named file mapping, `Local\SproutBus_v5` (`kVersion` 5), holds a header and 16 slots. Either
side creates it zeroed if it isn't there yet, so the start order doesn't matter.

- **Slots.** Each tap instance claims a free slot with a random owner token and is its only writer.
  It publishes a `SlotInfo` under a **seqlock** (odd sequence while writing): role, track name and
  colour, sample rate, tempo, playhead, block level, the DAW's record state, and the per-track look
  (`theme` / `customTheme`, `density`, `colourMode`, `ink`). Dry mono audio goes into a
  32768-sample ring with a monotonic write position. A heartbeat marks it alive: after 1 s without
  one the app treats the slot as gone, after 5 s another tap may take it over (a crashed host).
- **App → tap, look requests.** The viewer's "Set every tap to Auto" makes Sprout.exe write
  `lookTheme` / `lookDensityBits` / `lookCustom` and bump `lookSeq` in each voice slot. The tap
  applies a new `lookSeq` to its own parameters (so it's saved with the project and undoable).
  `kLookResetAll` puts theme, amount and colour back to Auto.
- **App → tap, theme list.** Sprout.exe writes the themes the tap can offer into the header's
  `ThemeList` (seqlock, up to 64 entries): the viewer's data-defined built-ins (Briar) first, then
  the files in its `themes` folder.
- Values meaning **Auto**: `theme` = `ViewerDefault` (4), `density` < 0, `colourMode` = `Auto` (1).

The app only reads audio and info, so DAWs that run plugins in separate processes work too.
Changing `SlotInfo` or `Slot` means a new `kVersion` and mapping name: Sprout.exe and every tap
must then be updated together.

## 2. Sprout.exe

`app/main.cpp` runs one loop at the display rate:

1. Open the bus (retried until it exists) and publish the theme list when it changed.
2. For each live slot: copy the info under the seqlock, read the new audio from the ring, measure
   level and onsets, and run the pitch tracker (`app/Pitch.h`: MPM with an octave guard and voicing
   hysteresis, up to F6) for pitch, vibrato depth and rate, effort and breathiness. Vibrato
   thresholds come from `sprout-detect.json`.
3. Send one `frame` message to every viewer (`featureJson`).
4. Handle messages from viewers: `tapLook`, `detect`, `themeSave`, `themeDelete`.
5. Draw the simple Direct3D 11 halo and send it over Spout (the project's first output path).

`app/FeatureServer.cpp` is a small single-threaded HTTP and WebSocket server:

- `GET /…` serves the built viewer from `--web`, else `<exe>\web`, else `viewer\dist` of the
  repository (for a `build\Release` exe). `/controls` and `/themes` are the same page in another mode.
- `GET /theme-files/index.json` and `/theme-files/<id>.json` serve the user themes.
- WebSocket: viewers connect to the same port. Theme writes are only accepted from pages served
  by this machine (`Origin` on localhost).

## 3. The WebSocket messages

| Type | Direction | What it carries |
| --- | --- | --- |
| `frame` | app → viewers, every frame | `t`, and per active tap: slot, role (`live` / `take` / `instrument`), name, colour, trackColour, level, onset, pitch (MIDI, 0 = unvoiced), vibrato, vibratoRate, effort, breath, playing, recording, bpm, theme / customTheme, density (absent = Auto), colourMode (`track` / `auto` / `ink`), ink |
| `params` | viewer ↔ app ↔ viewers | `patch`: changed settings as `"section.key": value`. The app merges every patch, keeps the result in `sprout-settings.json`, relays it to the other viewers, and replays the whole merge (`replay: true`) to a viewer that connects. |
| `detect` | viewer → app | Voice detection settings (written to `sprout-detect.json`). |
| `tapLook` | viewer → app | `{ theme: 'default', density: -1, colour: 'auto' }`: set every tap to Auto. |
| `themeSave` / `themeDelete` | theme editor → app | A theme as JSON (pictures as PNG data URLs). |
| `themes` | app → viewers | `rev`: the themes folder changed; viewers reload the theme files. |
| `action` | viewer ↔ viewers | Test actions (commit, delete, restart) relayed between open panels. |

**Settings sync.** Only changed keys travel. A viewer never echoes what it just received, the
newest change wins, and a key being dragged in one panel isn't overwritten for a second. Keys that
only concern one browser (`LOCAL_KEYS` in `viewer/src/panel-layout.ts`: audio source, fake singer,
preview switches, the avatar picture) are never sent.

## 4. The viewer

Per frame (`viewer/src/main.ts`):

1. **Features** from `sources/live.ts` (or `sources/fake.ts`, the fake singer), one
   `FeatureFrame` (`features.ts`) with a layer per tap.
2. **Drives** (`drive.ts`): per layer, phrase detection, energy, flash, effort, softness, the
   halo's open envelope.
3. **Layout** (`layout.ts`): the shared canopy outline and each take's territory.
4. **Growth:** the live halo vine (`growth/halo.ts`); for takes, `growth/generations.ts` (trees per
   phrase, branch per phrase, endings) over `growth/plant.ts` (the tree build: hub, territory,
   sector subdivision, ivy shoots, twist, reveal order, pauses and endings, leaf fall). Harmony
   between tracks comes from their pitches (`harmony.ts`).
5. **Planting** (`growth/commit.ts`): the halo winds up, travels and unrolls into the new tree.
6. **Instances:** branch segments as tapered strokes (`pushTree`), decorations as sprites
   (`deco.ts`, with falling ones in `shed.ts`), colours from the colour roles (`colour.ts`,
   `gradient.ts`).
7. **Render** (`render/renderer.ts`, `shaders/`): strokes and sprites into a colour and a glow
   target, with the motion (wind springs from `motion.ts`, gusts, per-shoot bend, shiver, writhe) in
   the vertex shaders; three bloom levels; a composite with premultiplied alpha, crowd-aware glow and
   an optional outline.

Settings: every value lives in `params.ts`. The panel (`ui.ts`, grouped by `panel-layout.ts`) is
generated from it, presets (`presets.ts`) are partial `params` objects of one kind (Look / Reaction /
testing), and sync sends `params` keys.

## 5. Files on disk

| Where | File | Written by |
| --- | --- | --- |
| Next to Sprout.exe | `sprout-settings.json` | Sprout.exe: the merged synced settings |
| Next to Sprout.exe | `sprout-detect.json` | Sprout.exe: voice detection settings |
| Next to Sprout.exe | `themes\<id>.json` | Sprout.exe, from the theme editor |
| Browser storage (per address) | `sprout.viewer.params.v2`, `…presets.v2`, `…panel.v1`, `…tab.v1`, `…gradients.v1` | The viewer: this browser's changed settings, saved presets, panel state, saved gradients |
| DAW project | Sprout Tap state | The tap: role, theme, leaves, colour, own colour or gradient |

## 6. Tools

| Tool | What it does |
| --- | --- |
| `fake_tap.exe [--takes N] [--instrument] [--seconds S] [--custom ID] [--ink #rrggbb\|GRADIENT]` | Claims slots and sings a melody up to F6 with vibrato on up to 6 takes, so Sprout.exe can be tested without a DAW. Prints the theme list it sees and every look request. |
| `spout_snapshot.exe --out frame.png` | Saves one frame of the Spout output and a preview over a checkerboard. |
| `pitch_test.exe` | Scores `app/Pitch.h` on the synthetic set in `bench/data/synth`. |
| `bench/` | Offline comparison of pitch detectors (see its README). |
