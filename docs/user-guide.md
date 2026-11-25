# Sprouting Halo: user guide

This guide takes you from the downloaded files to a working overlay in OBS, then through the
settings panel, presets, themes and the per-track options in the DAW. For building from source,
see the [README](../README.md#build).

- [1. What you need](#1-what-you-need)
- [2. Install](#2-install)
- [3. Set up the DAW](#3-set-up-the-daw)
- [4. Run Sprout.exe](#4-run-sproutexe)
- [5. Add it to OBS](#5-add-it-to-obs)
- [6. Fit it to your avatar](#6-fit-it-to-your-avatar)
- [7. The settings panel](#7-the-settings-panel)
- [8. Presets: Look, Reaction, Setup](#8-presets-look-reaction-setup)
- [9. Themes](#9-themes)
- [10. Per-track settings in the Sprout Tap window](#10-per-track-settings-in-the-sprout-tap-window)
- [11. How it reacts to your voice](#11-how-it-reacts-to-your-voice)
- [12. Pages, keys and files](#12-pages-keys-and-files)
- [13. Troubleshooting](#13-troubleshooting)

## 1. What you need

- Windows 10 or 11.
- A DAW that loads VST3 plugins. REAPER is the best fit: Sprout Tap reads its record-armed track,
  its record state, and each track's name and colour. Other DAWs work with the role set by hand.
- OBS Studio 30 or newer (its Browser Source shows the overlay with transparency).
- A graphics card with WebGL2 (any card from the last ten years).

## 2. Install

A release zip holds:

| File | What it is |
| --- | --- |
| `Sprout.exe` | The app. Run it while you stream or record. |
| `web\` | The overlay page Sprout.exe serves. Keep it next to `Sprout.exe`. |
| `Sprout Tap.vst3\` | The plugin for your DAW. |
| `fake_tap.exe` | A test tool that sings into Sprout.exe without a DAW. |
| `docs\`, `README.md`, licences | This guide and the rest of the documentation. |

1. Unzip it anywhere, for example `Documents\Sprout`. Sprout.exe saves its settings and your themes
   next to itself, so pick a folder you can write to (not `Program Files`).
2. Copy the whole `Sprout Tap.vst3` folder to `C:\Program Files\Common Files\VST3\`, or to any
   folder your DAW scans for VST3 plugins.
3. Rescan plugins in the DAW (REAPER: Options → Preferences → Plug-ins → VST → Re-scan).

Updating: replace `Sprout.exe`, the `web` folder and the plugin together. They talk through a
shared-memory protocol with a version number; an old plugin and a new Sprout.exe don't see each
other. Your settings and themes stay where they are.

## 3. Set up the DAW

Put **Sprout Tap** as the **first** effect on every vocal track you want to see: before reverb,
EQ, compression or pitch correction. It only listens to the dry voice; it never changes the sound.

### Role

| Role | What it shows |
| --- | --- |
| **Auto (follows record arm)**, the default | In REAPER: the record-armed track is the live voice, every other track is a take playing back. Disarm a track after recording it and its halo is planted as a tree. In other DAWs Auto acts as Live voice. |
| **Live voice** | The halo: the track you're singing into now. Several live tracks get nested halos. |
| **Take playback** | A tree: a recorded layer playing back. |
| **Instrument** | An instrument track. Read by Sprout.exe, not drawn yet. |

The plugin window says **Connected** when it has a slot in the shared memory that Sprout.exe reads
(16 slots; it doesn't need Sprout.exe running for that, and the start order doesn't matter). Track
names and colours come from the DAW where it reports them.

### Recording flow in REAPER

1. Arm a track and record: the halo opens with your first phrase and grows a vine round the ring.
2. Stop and disarm it: the halo winds up, travels to the new take's place, unrolls along the new
   tree's main limb and drives into its root. The tree grows from then on whenever the take sings.
3. Arm the next track and sing the next layer over the playback: the old take's tree reacts to
   its own playback, the new halo to your live voice.
4. Delete or mute a take: after a short hold its tree fades out and its leaves fall.

## 4. Run Sprout.exe

Start `Sprout.exe`. A small preview window opens; its title bar shows
`web: http://localhost:7777 (N viewers)`. Keep it running while you use the overlay. Closing the
window quits it.

Command-line options (for a shortcut's Target field):

| Option | Default | What it does |
| --- | --- | --- |
| `--port N` | 7777 | Port of the overlay page and its WebSocket (0 turns the web server off) |
| `--web DIR` | `web` next to the exe | Serve another build of the page |
| `--size N` | 1080 | Size of the Spout output (see below) |
| `--name NAME` | Sprout | Spout sender name |

Sprout.exe also sends a simple ring-shaped halo over **Spout** (the first version of this project).
The Browser Source below is the full overlay and needs no plugin; use Spout only if you
already use the Off World Live Spout2 plugin for OBS and want the plain rings.

## 5. Add it to OBS

1. In your scene: **+ → Browser**. Name it "Sprout".
2. URL: `http://localhost:7777/?obs`. Width and height: your canvas size (for example 1920 × 1080).
3. Untick "Shutdown source when not visible" and "Refresh browser when scene becomes active".
   Leave "Use custom frame rate" off (the page follows OBS's frame rate).
4. In the Sources list drag "Sprout" **below** your VTube Studio (or other avatar) source, so the
   avatar is drawn over the plants.
5. Keep OBS's Browser Source Hardware Acceleration on (Settings → Advanced).

`?obs` hides the panel and the grey placeholder avatar and keeps the background transparent. The
page detects OBS by itself: it never slows down for "not focused", and its panel starts hidden.

## 6. Fit it to your avatar

Open `http://localhost:7777/` in a normal browser (Chrome, Edge, Firefox). This is the same page
with the settings panel. Every change you make here is sent to the OBS source at once.

1. **Setup → Test & preview → Load avatar PNG**: load a screenshot of your avatar (with
   transparency). It's only shown in this browser, to line things up; OBS never shows it.
2. **Setup → Fit to avatar**: zoom out and move the picture until the placeholder matches your
   avatar's size and place, then set the idle halo (small, on top of the head while you're not
   recording) and the open halo (while recording): size and height. Squish and tilt make the idle
   ring look like a halo seen slightly from above. Turn on the guides to see the canopy outline and
   each tree's territory.
3. With **show advanced** on, the same folder has the head circle and body outline (head x / y /
   size, shoulders, body bottom and width). Trees grow round this shape and keep a small gap from it.

These "fit" settings belong to your avatar, not to a look: presets never change them.

`http://localhost:7777/controls` shows the panel without drawing anything, handy on a second
monitor while OBS shows the overlay.

## 7. The settings panel

The panel has three tabs. Each has a preset of its own at the top.

| Tab | What's in it |
| --- | --- |
| **Look** | How it looks: colours, theme and leaves, tree shape (including twist), halo, glow, many takes. |
| **Reaction** | How it answers the voice: growing per phrase, pauses and endings, harmony between tracks, loudness, note starts, pitch / effort / softness, held notes and vibrato, planting a take. |
| **Setup** | Fit to avatar, voice detection, performance, connection and sync, test and preview. |

- **Hover** any row or folder title for what it does. Settings driven by the voice say exactly how
  they read it ("Reads: …").
- **Show advanced** (top of the panel) shows the rarely needed settings in each folder.
- **Combined sliders** (fullness, liveliness, pace) move several settings at once.
- A changed row gets a **↺** button: click returns it to the active preset, Shift-click to the
  factory default. Folders with changes show a dot.
- Type any number into a slider's box, even past the slider's ends: the slider stretches to fit.
  Only a few settings have hard limits where the overlay would break (for example layers 1–17).
- The **toolbar** under the status rows: Fake singer ⇄ live, Restart, Halo → tree, End phrase,
  and the key list. Press **/** for all keys.

## 8. Presets: Look, Reaction, Setup

The three kinds are picked independently: any Look works with any Reaction.

**Look presets:** Sprout, Lush ivy, Winter branches, Festive wreath, Red bramble, Minimal, Neon
stage, Rainbow, Cherry blossom, Autumn, Dark & twisted, Black briar.

**Reaction presets:** Responsive, Calm (ballad), Punchy (stage), Subtle, Vibrato-sensitive, Branch
by branch, Blossom ballad, Falling leaves, Falling away, Duet (harmony), Steady (no withering),
Fade away (nothing dies), Writhing, Nocturne.

**Setup (testing) presets** only change the fake singer and the preview in this browser: Normal
song, Ballad, Fast pop, Six takes, Not recording, Two live tracks, Duet: trading phrases, Stacked
takes, Slow-motion study, Held notes, Short phrases with long pauses, On a light background, Full
stops, Pitch jumps, Planting loop.

Some pairings made for each other: **Black briar + Nocturne** (black ink stays solid when you're
quiet), **Dark & twisted + Writhing**, **Cherry blossom + Blossom ballad**.

- **Save as new preset** keeps your own in this browser. **Export / Import** move them as files.
- Switching presets with unsaved changes keeps them as "Unsaved tweaks" in the list.
- Presets never touch the fit to your avatar, your own take colours ("My take colours"), or the
  Sprout Tap windows.

### Colours

Look → Colours has a sub-folder for branches, leaves, blossoms & berries, and the halo. Each takes
its colour from the take colour, the theme's own colours, or a **gradient**. A gradient can stay
still, run from root to tip, flow with time, follow your voice (pitch, loudness, effort, airiness,
vibrato, note starts) or scatter per leaf; the buttons Still, Root→tip, Flow, Sparkle and Sing it
set these in one click.

The gradient picker: click the bar to open it and again to fold it (or Fold, or Esc). Click the
strip under the bar to add a colour stop, drag a stop to move it, drag it down or right-click to
remove it. Smooth / Linear / Steps, Loop, Reverse, Spread, built-in gradients, your saved ones, and
the gradient as text to copy and paste.

**Take colours:** each take gets a colour from "My take colours" (yours, kept across presets),
unless the look brings its own list ("Take colours of this look"). "Always use my take colours"
overrides that.

## 9. Themes

A theme is what a plant is made of: its leaves, thorns, needles, blossoms or berries, and their
natural colours. Built in: **Leaves** (with blossoms), **Thorns**, **Christmas wreath**,
**Briar** (leaves and thorns, with a few roses) and **Branches** (no decorations).

Make your own at `http://localhost:7777/themes` (or Look → Theme & leaves → Edit themes…):

- A theme has up to six **parts**. Each is a built-in shape or your own PNG picture, placed spaced
  along branches (like leaves), several on every node (like needles), at branch tips (like
  blossoms), in small clusters (like berries) or in mirrored pairs (like holly).
- Draw pictures **pointing up**. Set the part's **origin**, the point that sits on the branch
  and that it grows and turns about, with the two sliders or by clicking the small picture: the
  bottom centre for a leaf with a stalk, the middle for a flower.
- White or grey pictures take their colour from the colour settings. Colourful ones can keep their
  own colours.
- **Opens** says when a part shows: always, on long held notes (like blossoms), or **in harmony
  with another track** (section 11). On twig ends it stays a bud until then; anywhere else it is
  not there until then.
- Each part's natural colour can be a gradient with a movement. The theme also has a branch colour.
- **Save** stores it in the `themes` folder next to Sprout.exe, so OBS gets it too. **Use in
  viewer** makes it the theme of the look. The normal panel sits on the right of this page, so you
  can try presets on the theme you're editing.

## 10. Per-track settings in the Sprout Tap window

Besides the role, each Sprout Tap window has three **overrides**. They start on **Auto**, which
means "follow the look". Change one only when this track should differ from the rest.

| Setting | Auto means | Otherwise |
| --- | --- | --- |
| **Theme** | The look's theme | A built-in theme, Briar, or one of your own (listed while Sprout.exe runs) |
| **Leaves** | The look's amount | This track's own amount (moving the slider turns Auto off) |
| **Colour** | The viewer's colour for this take | Track colour (from the DAW), My colour (a picker), or My gradient (built-in gradients, or Paste one copied in the viewer) |

**All Auto** puts all three back on Auto. In the viewer, Look → Theme & leaves → **Set every tap to
Auto** does that for every track at once. "Per-track settings: Ignored" (advanced) makes every
track use the look whatever the tap windows say. Everything in the tap window is saved with the
DAW project.

## 11. How it reacts to your voice

| Your voice | What happens (default Reaction) |
| --- | --- |
| Singing a phrase | The take's tree grows (about 3.5 s of full voice for a whole tree); the halo vine races round the ring. |
| A new phrase | A new tree on a new seed (or, with "new branch each phrase", one new branch on the take's tree; the oldest dries, droops and falls). |
| Short pause (a breath) | The outer twigs grow back into the tree ("ungrow"); their leaves fall. They regrow when you sing again. |
| The phrase ends (1 s of silence) | The tree stays whole until 3 s after you stopped singing, so it stands next to the tree the next phrase grows; then it ungrows, trunk and all. |
| Full stop (4 s of silence) | Whatever is left of the tree goes the same way. The next phrase grows a new one. |
| Two tracks in harmony | Their colours run into each other, their branches crisscross, everything glows a little more. |
| Loudness | Brightness, glow, wind in the branches. |
| Note starts | A flash of glow. They do not move the plants (an optional push that swings back is under Reaction → Note starts, advanced; off by default). |
| Pitch | High notes grow the upper side first and can shift the colours. |
| Effort (pressed, full voice) | Thicker branches, bigger thorns. Soft singing: thinner, drooping, a wider softer glow. |
| Vibrato | Twigs and leaves shimmer at your vibrato rate. With "leaves fall" (Autumn) it shakes leaves loose. |
| Notes held 1.5 s | Blossoms open; their petals fall when the note ends. |

### Pauses and endings

Reaction → **Pauses & endings** has one choice for each length of silence: a **short pause** acts
on the outer twigs, the **phrase end** and the **full stop** on the whole tree.

| Choice | What the branches do |
| --- | --- |
| Keep | Nothing: they stay. |
| Ungrow | They grow back into the tree from their tips. |
| Fade, from the tips | They fade out, the tips first. |
| Fade, all at once | Everything fades together. |
| Fall away, from the tips | Pieces break off and fall, the tips first. |
| Fall away, all at once | Everything lets go together. |

- "Short pause reaches in" is how deep a breath goes; "tree stays after singing" keeps a
  tree whole for that long after its take stopped singing, so old and new trees overlap into a
  fuller canopy (0 = its ending starts as soon as the phrase is over);
  "an ending takes" is how long the phrase end and the full stop take.
- **Leaves let go when twigs go** (on by default): leaves and petals fall whenever their twig
  ungrows, fades or falls. Off: they go the way of the twig, so they shrink back with it, fade with
  it, and fall only when it falls.
- "Leaves fall on their own" (Look → Theme & leaves) is something else: a steady trickle of
  falling leaves that grow back, whatever the branches do.

### Harmony

The overlay notices when two tracks sing **in harmony**: at the same time, a third, fourth, fifth
or sixth apart (in any octave), for at least a quarter of a second. It works between the live
voice and takes played back, and between takes. Doubling the same note does not count unless you
turn on "unison & octaves count".

Reaction → **Harmony** has one amount per effect; 0 turns an effect off, so use any of them
together:

- **Colours come together:** both voices' colours move toward a shared colour and back. The
  shared colour is a gradient from one voice's colour to the other's, the mix of the two, or a
  colour you pick.
- **Branches crisscross:** the branches weave across each other and the two trees lean into one
  another; each branch keeps its course and the tree its outline. The halo ring braids.
- **Blossoms open in harmony**, and **glow in harmony**.
- Theme parts can open in harmony (section 9).

To try it without a second singer: Setup preset **Duet: trading phrases**, Reaction preset
**Duet (harmony)**.

The **voice scope** (key G) draws rolling graphs of what Sprout.exe hears and what the overlay
makes of it: loudness, pitch, effort and breath, vibrato, note starts and phrases, growth. Hover a
value for what it is and which settings use it.

**Voice detection** (Setup) sets how vibrato is recognised. Sprout.exe keeps these in
`sprout-detect.json`, so every viewer and OBS use the same values.

## 12. Pages, keys and files

| Address | What it is |
| --- | --- |
| `http://localhost:7777/?obs` | The OBS source: no panel, transparent. |
| `http://localhost:7777/` | The overlay with the settings panel (preview in a browser). |
| `http://localhost:7777/controls` | The panel and voice scope only, nothing drawn. |
| `http://localhost:7777/themes` | The theme editor, with the normal panel beside it. |

Add `?offline` to a preview to use the built-in fake singer without Sprout.exe.

| Key | What it does |
| --- | --- |
| H | Hide / show the panels (works in OBS's Interact window too) |
| G | Voice scope |
| F | Fake singer ⇄ live taps |
| R | Restart growth |
| T | Halo → tree (plant the live take) |
| D | Delete the last take |
| E | End the phrase (a full stop for the fake singer) |
| P | Pause / play |
| / | The list of keys |

Files Sprout.exe writes next to itself:

| File | What it holds |
| --- | --- |
| `sprout-settings.json` | The synced settings: every viewer and OBS start from these |
| `sprout-detect.json` | Voice detection settings |
| `themes\*.json` | Your themes, pictures included |

Settings that only concern one browser (the audio source, the fake singer, preview switches such
as backdrop and guides, the avatar picture) stay in that browser and are never synced.

## 13. Troubleshooting

| Problem | Try |
| --- | --- |
| The OBS source is empty | Is Sprout.exe running? Open `http://localhost:7777/` in a browser: if it loads there, check the OBS URL and that the source is the size of the canvas. |
| The tap says "Not connected (no free slot)" | All 16 slots are taken: remove unused Sprout Taps. If the track is Connected but Sprout.exe doesn't see it, the two are different versions; install both from the same release. |
| The halo never opens | The live track must be recognised: in REAPER arm it (Role Auto), elsewhere set Role to Live voice. "Fake singer" in the panel's toolbar must be off. |
| Everything reacts too little or too much | Put the tap before any effects. In the Sprout.exe window Up / Down moves the sensitivity floor (quieter sound than that counts as silence). Setup → Voice detection tunes vibrato. |
| Trees never appear | Take tracks need Role Take playback (or Auto in REAPER with the track disarmed) and must actually play back sound. |
| The panel's dropdowns don't open in OBS's Interact window | They open their own menu inside OBS; click the row again. Easier: change settings in a browser or on `/controls`. |
| It stutters | Setup → Performance: lower "max fps" or "max picture size". Check that OBS's Browser Source hardware acceleration is on. `sprout.perf()` in the browser console shows where the time goes. |
| A tap's track looks different from the rest | It has its own Theme, Leaves or Colour set. Press All Auto in that tap window, or Set every tap to Auto in the viewer. |
| Black or dark looks vanish on a dark scene | They rely on the rim glow: keep glow strength up, use a Reaction that keeps trees opaque (Nocturne), and check on Setup → Test & preview → backdrop "half dark, half light". |
| Port 7777 is taken | Start Sprout.exe with `--port 8123` and use that port in the OBS URL. |
