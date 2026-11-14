# Sprout viewer (web visual layer)

The halo and take plants, rendered with WebGL2 in a web page that OBS shows as a **Browser
Source** with built-in transparency. No Spout plugin is needed for this path.

`Sprout.exe` reads the Sprout Tap plugins and streams one JSON feature frame per frame to the page
over a local WebSocket (port 7777). It also serves the built page on the same port. The live take
(record-armed track, or role Live voice) is the halo; every take playing back becomes a plant and
keeps it while it stays connected. Instrument taps aren't shown yet. Each tap carries loudness,
onsets, pitch (MIDI, 0 when unvoiced), vibrato depth/rate, **effort** (0 soft … 1 full/pressed,
independent of mic gain) and **breathiness**, all from `app/Pitch.h`.

The renderer only consumes `FeatureFrame` (`src/features.ts`). Panel → Audio source → mode picks
**auto** (live taps when Sprout.exe is running, otherwise the fake singer), **live** or **fake**.

## How it behaves

- **Take plants grow at phrase speed and never ungrow.** About 3.5 s of full voice grows a whole
  tree (Growth → secondsToFull). With newTreeEachPhrase on, each phrase grows a new tree on a new
  seed; older trees stay and only start fading growth.fadeAfter seconds after their own phrase
  ended (fadeSeconds for the fade). Off: one tree keeps growing and rests dimmer between phrases.
- **Tree shape (docs/fable-consult-2.md):** all take plants grow from one hub behind the neck
  and end on one shared, flattened canopy outline, so several takes read as one wide canopy that
  cradles the avatar. Each plant fills its own territory (an angular sector of the arc outside
  Layout → downGap). Tip targets are spaced evenly along the outline first; a few limbs leave the
  hub, cross the silhouette steeply and fork on the way out, each fork taking a share of the tips,
  so the density stays level instead of bunching. Ivy side shoots are only placed into free space
  and stop short of other branches (Take plants → clearance). Leaves keep a guaranteed spacing
  (density = how close), the inside of a plant is dimmer than its rim, and some leaves sit dim
  under the branches for depth. Sliders: Growth → branching, reach (canopy size), flatten (round …
  flat), spread (how much limbs arch out); Take plants → lift (tips up / droop), wildness,
  overlap (how far neighbours interleave at the seams), taper, clearance, moodShaping (each new
  tree takes its character from its phrase); Look → variety, depthShade; Layout → shrinkPerTake.
  A tree keeps its form when the layout eases; a change in take count rebuilds it for its new
  territory. Console checks: `sprout.metrics()` (shape), `sprout.ink()` (bunching and blobbing),
  `sprout.pixels()` (clipping and contrast).
- **Glow that keeps the detail:** where branches and leaves are dense the bloom steps back
  (Glow → crowd), glow lies around the ink rather than on it (inkMask), bright glow rolls off
  softly (knee), and every take colour glows about equally.
- **Pauses and dips:** in a pause shorter than a phrase gap (Response → phraseGap, 1 s) the outer
  twigs and their leaves fade (leaves first) and grow back from their stubs when singing resumes;
  the main limbs stay. Optional: pitch dips do the same (Growth → witherOnPitchDip). Depth and
  speeds: witherDepth, witherSeconds, leafFadeSeconds, twigFadeSeconds, regrowSpeed.
- **Halo vine loops forever.** Tips grow round the ring from halo.origins points spread evenly
  from halo.startAngle (-90 = bottom), both ways if bothWays. They creep at idleSpeed and race up to
  singSpeed while singing; each trails tailDeg of vine whose oldest part fades away. Singing sets
  what sprouts: loudness = how often, effort = longer/thicker shoots, softness = curlier tendrils,
  pitch = outward (high) or inward (low). Leaf amount on the vine is divided by the number of
  origins. A share of the ring's leaves is always there, spread evenly (alwaysLeaves).
- **Tremble** on vibrato can be switched off (Sway & tremble → tremble).
- **Halo size follows recording.** Small on top of the head while nothing is being recorded. When
  the DAW records the live take, it opens with the first phrase and stays open until recording
  stops (the tap reports the DAW's record state; the fake singer has fake.recording).
- **Several live tracks** get concentric halos (the first outermost, Live halo → ringSpacing),
  each in its own colour (hue-shifted from the live colour unless the track colour is used).
- **Recording finished → playback:** the halo fades out (Transitions → liveEndSeconds) and the
  take's plant grows in its place in the layout. A richer "unwind and stamp" animation is being
  designed (docs/fable-brief.md).
- **Take deleted:** after a short hold (Audio source → holdSeconds) the plant flashes and fades
  away while its leaves fall.
- **Looks per track:** Theme, Amount and Colour in each track's **Sprout Tap window**. The
  viewer's Look section is only the fallback for the fake singer and "Viewer default".

## Use with OBS

1. Build the page once (and again after changing it):

   ```bash
   npm --prefix viewer run build
   ```

2. Run `build/Release/Sprout.exe`. Its title bar shows `web: http://localhost:7777 (N viewers)`.
3. In OBS: **+ → Browser**, URL `http://localhost:7777/?obs`, width/height = your canvas
   (e.g. 1920×1080). Place it **below** the VTube Studio source. Transparency is built in, so no
   plugin or composite setting is needed.
4. To tweak the look, open `http://localhost:7777/` in a normal browser. Every change there is
   mirrored live to the OBS page (and any other open viewer) through Sprout.exe; a viewer that
   opens later picks up the current settings. The newest change wins, and a viewer never sends
   back settings it just received, so two open panels don't fight. Audio source settings stay
   per viewer. Turn off Audio source → syncSettings to tweak one viewer on its own.

`Sprout.exe --port 8123` uses another port; `--web <folder>` serves a different build.

## Develop

Requires Node 20+.

```bash
npm --prefix viewer install
```

```bash
npm --prefix viewer run dev
```

Open http://localhost:5173. Saving any `.ts` or shader file reloads the page. Only settings you
changed are saved in the browser, so improved defaults still reach the rest. The dev page connects
to Sprout.exe on `localhost:7777` (Audio source → port) when it's running.

- **Panel:** every value in `src/params.ts` has a control. **H** hides the panel.
- **Actions:** restart, presets (.json), reset, and two fake-singer tests: *Commit live take*
  (the recording-finished transition) and *Delete last take* (pruning).
- **Guides:** Scene → showGuides draws the canopy outline split into each plant's territory, and the avatar keep-out.
- **OBS mode:** `?obs` hides the panel and the placeholder avatar and leaves a transparent background.
- **Console:** `sprout.params`, `sprout.restart()`, `sprout.advance(60)` (fast-forward),
  `sprout.action('commit' | 'delete' | 'restart')`, `sprout.stats()`.

## Layout

| Path | What it does |
| --- | --- |
| `src/params.ts` | All tweakable values. Add a value here and it appears in the panel, presets and sync. |
| `src/ui.ts` | Panel (auto-generated from params), slider ranges, presets, localStorage. |
| `src/features.ts` | `FeatureFrame`: the audio features per layer that drive everything. |
| `src/drive.ts` | Per-layer phrase detection, halo open envelope, energy, flash, effort/softness. |
| `src/growth/generations.ts` | Trees per layer: grow with the voice, new tree per phrase, fade the old. |
| `src/sources/fake.ts` | Fake singer (phrases, soft/full notes, melody up to F6, vibrato, commit/delete tests). |
| `src/sources/live.ts` | Sprout.exe connection: tap → layer mapping, reconnect, dropout hold, viewer messages. |
| `src/layout.ts` | Take territories: crown (1 take), wings (2), equal sectors (3+), two tiers (7+); the shared canopy outline. |
| `src/growth/halo.ts` | Live halo vine (unit circle): runners + curling sprouts, revealed by the voice. |
| `src/growth/plant.ts` | Take plants: hub, territory and sector subdivision, ivy shoots on an occupancy grid, reveal order, tone and leaf spacing. |
| `src/growth/skeleton.ts` | Shared node tree. |
| `src/deco.ts` | Theme decorations on branches and the halo ring. |
| `src/render/` | WebGL2 helpers and the pass pipeline. |
| `src/shaders/` | GLSL: tapered-capsule strokes, decoration shapes, downsample, blur, composite. |
| `src/main.ts` | Frame loop: features → drives → layout → reveal → instances → render; transitions; sync. |

## Render pipeline

1. **Strokes and decorations:** instanced draws of tapered capsules (every branch segment) and
   decoration shapes (leaf, thorn, berry, needle, holly, blossom as signed distances), back to
   front, with sway and tremble in the vertex shaders. Written to two targets at once: colour and
   glow emission.
2. **Bloom:** glow emission at ½, ¼ and ⅛ resolution, separable Gaussian blur on each.
3. **Composite:** strokes + bloom, premultiplied alpha, glow cut to exactly zero where negligible.

Adding a pass: write a `.frag` in `src/shaders`, create a `Program` in `Renderer`, call
`fullscreen(program, target, uniforms)`. OBS's browser (Chromium 127) supports WebGL2 but not
WebGPU, so simulations (reaction–diffusion, trails, feedback) are done as ping-pong passes between
render targets rather than compute shaders.
