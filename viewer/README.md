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
- **Leaves come with finished branches:** a branch carries leaves once it has grown to its tip,
  so nothing rides along a growing twig. A finished branch that withers back keeps the leaves on
  what remains.
- **Pauses and dips:** in a pause shorter than a phrase gap (Response → phraseGap, 1 s) the outer
  twigs *grow back* toward their limbs, leaves shrinking with them, so a withered tree looks
  younger, never dead: every visible tip keeps a leaf and the limbs keep buds where shoots
  were. They regrow when singing resumes; the main limbs stay. Optional: pitch dips do the same (Growth → witherOnPitchDip). Depth and
  speeds: witherDepth, witherSeconds, leafFadeSeconds, twigFadeSeconds, regrowSpeed.
- **Halo vine loops forever.** Tips grow round the ring from halo.origins points spread evenly
  from halo.startAngle (-90 = bottom), both ways if bothWays. They creep at idleSpeed and race up to
  singSpeed while singing; each trails tailDeg of vine whose oldest part fades away. Singing sets
  what sprouts: loudness = how often, effort = longer/thicker shoots, softness = curlier tendrils,
  pitch = outward (high) or inward (low). Leaf amount on the vine is divided by the number of
  origins. A share of the ring's leaves is always there, spread evenly (alwaysLeaves).
- **Wind, push and shiver** (docs/fable-consult-3-motion.md): the plants move like plants, not
  like a wave. Wind is a vector in the world, so the whole canopy leans the same way instead of
  turning about its root; trunks are stiff, limbs flex, every shoot bends on its own about where it
  joins. Three springs per plant (limb, shoot, twig) give the response: loudness is the wind,
  every note start is a push that swings back, a swelling note lifts the boughs and a fading one
  lets them sag, soft singing damps the ringing. Vibrato makes twigs and leaves shimmer at the
  sung rate. Leaves trail downwind, flutter and turn edge-on now and then. The halo ring goes
  slightly oval on a push instead of wobbling. Panel: Wind & shiver.
- **Halo size follows recording.** Small on top of the head while nothing is being recorded. When
  the DAW records the live take, it opens with the first phrase and stays open until recording
  stops (the tap reports the DAW's record state; the fake singer has fake.recording).
- **Several live tracks** get concentric halos (the first outermost, Live halo → ringSpacing),
  each in its own colour (hue-shifted from the live colour unless the track colour is used).
- **Recording finished → the halo is planted** (docs/fable-consult.md, Part B): the ring winds up
  and travels round the head to the new take's place, unrolls along the tree's main limb like a
  fern crozier, pulls back, waits up to 0.3 s for the next note start and drives into the root.
  On the impact the new tree flashes, jolts and grows out fast, a shock ring spreads from behind
  the avatar and the halo's leaves fly out along the branches. Panel: Take commit & removal
  (turn it off with "plant the halo" to get the plain fade).
- **Take deleted:** after a short hold (Audio source → holdSeconds) the plant flashes and fades
  away while its leaves fall.
- **Looks per track:** Theme, Amount and Colour in each track's **Sprout Tap window**. Picking a
  preset sends its theme and amount to every Sprout Tap through Sprout.exe: each Tap window
  switches as if you had set it there (saved with the project, undoable in the DAW), and you can
  change single tracks afterwards. Leaves & decorations → "theme comes from: this preset" forces
  the viewer's theme for every track instead (for taps that are not connected).
- **Idle halo sideways, squish and tilt** (Setup: fit to avatar) hang the resting ring to one
  side and flatten it like a halo seen slightly from above, for a 3D look. Squish changes the
  ring's shape only (lines and leaves keep their size). The recording halo opens round and
  centred.

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

- **Panel:** every value in `src/params.ts` has a control, grouped for the artist
  (`src/panel-layout.ts`, docs/fable-consult-3-panel.md): Preset, Tree shape, Growing & fading,
  Leaves, Colours, Live halo, Voice response, Glow, Wind & shiver, Take commit, Many takes, then
  the setup folders (fit to avatar, connection, test & preview). Rarely needed values sit in each
  folder's Advanced fold. Hover a row for its description. **H** hides the panel.
- **Presets** come in three kinds, picked independently on the tabs of the Presets folder:
  **Visual** (how it looks: Sprout, Lush ivy, Winter branches, Festive wreath, Red bramble,
  Minimal, Neon stage), **Reactivity** (how it answers the voice: Responsive, Calm, Punchy,
  Subtle, Vibrato-sensitive) and **Testing** (fake singer and preview, this browser only).
  None of them touches the fit to the avatar or the colour palette; a visual preset can lean
  everything toward its own colour (Colours → tint). Changed rows get a **↺** button: click returns the value to the active
  preset, Shift-click to the factory default; folders with changes show a dot and the preset
  title a star. *Save as new preset* stores your own (in this browser); Export / Import move them
  as .json. Switching away from unsaved tweaks keeps them as "Unsaved tweaks" in the list.
- **Voice scope:** **G** (or Test & preview → voice scope) shows rolling graphs of the followed
  layer: loudness, pitch, effort / breath / softness, vibrato, note starts and phrases, growth.
  Thin lines are what the tap sends, bold lines what the viewer makes of it. Header buttons
  switch between the live halo and each take, change the history length, freeze and close;
  hover them for what they do. Click the graphs to freeze, hover to read values at any moment.
- **Voice detection** (Setup: voice detection): how Sprout.exe recognises vibrato (how long a
  note must be held, the smallest and the full swing, the accepted rates). These are kept by
  Sprout.exe in `sprout-detect.json` next to it, so every viewer and OBS use the same values;
  a viewer that connects shows them. The fake singer is not affected.
- **Tooltips:** hover any row or folder title in the panel. Settings driven by the voice say
  exactly how they read it ("Reads: …"). In the voice scope, hover a value on the right to see
  what it is and which settings use it; click one to open it in the panel.
- **Your avatar picture:** Test & preview → Load avatar PNG shows your own picture (transparency
  kept) instead of the grey shape, with picture x / y / height and the placeholder opacity. It is
  stored in this browser only and never shown in OBS.
- **Guides:** Scene → showGuides draws the canopy outline split into each plant's territory, and the avatar keep-out.
- **OBS mode:** `?obs` hides the panel and the placeholder avatar and leaves a transparent background.
- **Console:** `sprout.params`, `sprout.restart()`, `sprout.advance(60)` (fast-forward),
  `sprout.action('commit' | 'delete' | 'restart')`, `sprout.stats()`. `sprout.advance(3, 1/8)`
  steps at 8 fps (frame-rate independence checks). `sprout.bench(240)` times simulation,
  instance building and GL submission per frame; `sprout.perf()` shows the live averages.

## Controls and sync

- **http://localhost:7777/controls**: the panel and the voice scope only, nothing drawn (no
  graphics card use). Make changes here; the OBS source (`http://localhost:7777/?obs`) follows
  them, so OBS's Interact window is not needed.
- Settings sync key by key: only what someone changed is sent, and every open viewer applies it
  (also the other way round, from any panel). Sprout.exe merges all changes, keeps them in
  `sprout-settings.json` next to it, and hands every viewer that connects the latest value of
  every setting. A setting being dragged in one panel is not overwritten by others for a second.
- Per viewer, never synced: audio source and port, the fake singer, preview switches (pause,
  speed, backdrop, guides, scope), the preview avatar picture.

## Performance settings (Setup: performance)

- **max fps** 60 (snaps to a whole division of the display: 72 on a 144 Hz monitor),
  **fps when silent** 30 (nobody sings, nothing planted or fading), **preview fps in background**
  30 (another window has focus). A hidden tab or an OBS source that is not shown draws nothing.
- **max picture size** 2.1 MP (1080p): larger windows are drawn at this size and scaled up.
  **render scale** below 1 draws smaller still, for weak GPUs.
- Recommended OBS Browser Source settings: "Use custom frame rate" off (the page follows OBS),
  "Shutdown source when not visible" off, "Refresh browser when scene becomes active" off, and
  Browser Source Hardware Acceleration on (OBS Settings → Advanced).
- Measure: `sprout.perf()` (fps, ms per phase, GPU time where the browser allows it, GPU name,
  heap); `?obs&perflog` writes it to the console every 10 s. Details:
  docs/fable-consult-4-performance.md.
- Inside OBS (window.obsstudio) the panel's dropdowns open their own menu, because OBS's Interact
  window cannot show the browser's dropdown popup (`?customSelect` forces it elsewhere).

## Cost

Measured with the fake singer, leaves theme, after growth (CPU per frame, Chromium):

| Takes | simulation | building instances | GL submit | instances |
| --- | --- | --- | --- | --- |
| 1 | 0.8 ms | 1.7 ms | 0.5 ms | about 2900 |
| 3 | 0.8 ms | 1.9 ms | 0.5 ms | about 3200 |
| 6 | 1.0 ms | 1.7 ms | 0.4 ms | about 3000 |

About 3 ms of a 16.7 ms frame. A new tree costs 1 to 3 ms once, at the start of a phrase. The GPU
work is two full-size passes plus three small blur levels; check OBS's own render-time stats at
your output size.

## Layout

| Path | What it does |
| --- | --- |
| `src/params.ts` | All tweakable values. Add a value here and it appears in the panel, presets and sync. |
| `src/ui.ts` | Panel (auto-generated from params), slider ranges, revert buttons, preset folder, localStorage. |
| `src/panel-layout.ts` | Folder grouping, labels, look / rig / local scopes. |
| `src/presets.ts` | Built-in presets, saved presets, apply / compare. |
| `src/scope.ts` | Voice scope: rolling graphs of features and drives. |
| `src/motion.ts` | Wind clock and per-layer springs (push, sway, shiver phase). |
| `src/growth/commit.ts` | The commit animation: wind-up, unfurl, plunge, impact. |
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
   front, with the motion (shaders/motion.glsl: wind, springs, per-shoot bend, shiver, leaf
   flutter) in the vertex shaders. Written to two targets at once: colour and
   glow emission.
2. **Bloom:** glow emission at ½, ¼ and ⅛ resolution, separable Gaussian blur on each.
3. **Composite:** strokes + bloom, premultiplied alpha, glow cut to exactly zero where negligible.

Adding a pass: write a `.frag` in `src/shaders`, create a `Program` in `Renderer`, call
`fullscreen(program, target, uniforms)`. OBS's browser (Chromium 127) supports WebGL2 but not
WebGPU, so simulations (reaction–diffusion, trails, feedback) are done as ping-pong passes between
render targets rather than compute shaders.
