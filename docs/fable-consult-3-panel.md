# Design consult 3: the panel — regrouping, presets, revert, save

Scope: `viewer/src/ui.ts` only (plus one small suggestion for `main.ts` sync, section 3.6).
No `params.ts` key changes: every key keeps its path, so saved settings, sync and old exported
.json files keep working. Written against Tweakpane 4.0.5.

Preset values in section 2 are reasoned from the code comments and RANGES, not viewed on screen.
Treat them as starting points to tune by eye; all are inside the RANGES limits.

## Summary

- Split every key into one of three **scopes**. This one decision drives folders, presets and revert:
  - **look**: what a preset owns (shape, growth, leaves, halo behaviour, glow, motion, commit).
  - **rig**: fits the overlay to this avatar and this artist's brand (framing, halo position and
    size, keep-out, hub heights, the colour palette). Synced, but never touched by a preset.
  - **local**: per viewer, not synced today (`source.*`, `fake.*`, preview switches in `scene`).
- 14 code-mirroring folders become **10 artist folders + 3 setup folders**, ordered by what the
  artist sees: Preset, Tree shape, Growing & fading, Leaves, Colours, Live halo, Voice response,
  Glow, Motion, Take commit, then Fit to avatar, Connection, Test & preview.
- Each folder shows 5 to 10 controls and tucks the rest in a nested `Advanced` folder.
- 8 built-in presets (default + 7). A preset is a partial object over look keys, applied on top
  of the defaults.
- Revert button per control reverts to the **active preset's** value (Shift-click: factory default).
- Active preset and dirty state are **derived by comparing values**, so sync needs no protocol change.

---

## 1. Panel structure

### 1.1 Folder map

`keys` are top-level controls in order; `advanced` go in a nested closed folder titled
`Advanced`. `scope` is the default for the folder; exceptions are marked in 1.2.

```ts
type FolderSpec = { id: string; title: string; open?: boolean; scope: 'look' | 'rig' | 'local';
                    keys: string[]; advanced?: string[] };

export const FOLDERS: FolderSpec[] = [
  // (status readouts stay above everything; the Preset folder of section 3 comes next, open)
  { id: 'shape', title: 'Tree shape', open: true, scope: 'look',
    keys: ['growth.reach', 'growth.flatten', 'growth.branching', 'growth.spread',
           'plants.lift', 'plants.wildness', 'plants.taper'],
    advanced: ['plants.clearance', 'plants.softDroop', 'plants.moodShaping',
               'plants.tipWidth', 'plants.maxWidth'] },

  { id: 'life', title: 'Growing & fading', scope: 'look',
    keys: ['growth.secondsToFull', 'growth.newTreeEachPhrase', 'growth.fadeAfter',
           'growth.fadeSeconds', 'growth.restBrightness', 'growth.witherOnPause',
           'growth.witherDepth'],
    advanced: ['growth.witherSeconds', 'growth.witherOnPitchDip', 'growth.witherDipSemitones',
               'growth.leafFadeSeconds', 'growth.twigFadeSeconds', 'growth.regrowSpeed'] },

  { id: 'leaves', title: 'Leaves & decorations', scope: 'look',
    keys: ['look.theme', 'look.density', 'look.decoSize', 'look.naturalTint',
           'look.variety', 'look.depthShade', 'look.blossoms', 'look.thornEffort'] },

  { id: 'colours', title: 'Colours', scope: 'rig',
    keys: ['colours.mode', 'colours.rainbowSpeed', 'colours.live', 'colours.take1',
           'colours.take2', 'colours.take3', 'colours.take4', 'colours.take5',
           'colours.take6', 'colours.take7'] },

  { id: 'halo', title: 'Live halo', scope: 'look',
    keys: ['halo.origins', 'halo.bothWays', 'halo.idleSpeed', 'halo.singSpeed', 'halo.tailDeg',
           'halo.sproutRate', 'halo.sproutLength', 'halo.sproutCurl', 'halo.alwaysLeaves',
           'halo.wander'],
    advanced: ['halo.startAngle', 'halo.tailFade', 'halo.sproutGrow', 'halo.spawnSeconds',
               'halo.ringWidth', 'halo.vineWidth', 'halo.sproutWidth', 'halo.ringSpacing'] },

  { id: 'voice', title: 'Voice response', scope: 'look',
    keys: ['response.brightness', 'response.effortWidth', 'response.pitchSteer',
           'response.variety', 'response.phraseGap', 'response.release'] },

  { id: 'glow', title: 'Glow', scope: 'look',
    keys: ['glow.strength', 'glow.radius', 'glow.base', 'glow.levelGain', 'glow.onsetGain',
           'glow.pitchShine', 'glow.front', 'look.decoGlow'],
    advanced: ['glow.wide', 'glow.softGlow', 'glow.crowd', 'glow.inkMask', 'glow.knee'] },

  { id: 'motion', title: 'Motion', scope: 'look',          // being redesigned: take whatever
    keys: ['motion.tremble', 'motion.swayDeg', 'motion.swayFromLevel', 'motion.swayHz',
           'motion.trembleDeg'] },                          // params.motion ends up holding

  { id: 'commit', title: 'Take commit & removal', scope: 'look',
    keys: ['commit.duration', 'commit.impact', 'commit.burst', 'commit.shockRing',
           'commit.plunge', 'commit.spinTurns', 'commit.stampReveal'],
    advanced: ['commit.syncToOnset', 'commit.syncWindow', 'transitions.liveEndSeconds',
               'transitions.pruneSeconds'] },
    // + two buttons at the bottom: "Test commit", "Test delete" (the existing fake-singer actions)

  { id: 'many', title: 'Many takes', scope: 'look',
    keys: ['plants.overlap', 'layout.shrinkPerTake', 'layout.spinSpeed', 'layout.spinFrom'],
    advanced: ['layout.tierFrom', 'layout.innerScale', 'layout.ease'] },

  // ---- separator blade: pane.addBlade({ view: 'separator' }) ----
  { id: 'fit', title: 'Setup: fit to avatar', scope: 'rig',
    keys: ['scene.showGuides', 'scene.viewRadius', 'scene.centerX', 'scene.centerY',
           'halo.restRadius', 'halo.restY', 'halo.openRadius', 'halo.openY',
           'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'avatar.avoid'],
    advanced: ['avatar.headX', 'avatar.headY', 'avatar.headR', 'avatar.bodyTopY',
               'avatar.bodyBottomY', 'avatar.bodyR'] },

  { id: 'connection', title: 'Setup: connection & sync', scope: 'local',
    keys: ['source.mode', 'source.syncSettings', 'source.useTrackColours', 'source.holdSeconds'],
    advanced: ['source.port'] },

  { id: 'test', title: 'Test & preview (this viewer only)', scope: 'local',
    keys: ['scene.backdrop', 'scene.showAvatar', 'avatar.opacity', 'scene.paused',
           'scene.timeScale', 'scene.layers', 'fake.liveTracks', 'fake.recording',
           'scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds'],
    advanced: ['fake.seed', 'fake.phraseMin', 'fake.phraseMax', 'fake.gapMin', 'fake.gapMax',
               'fake.highNotes', 'plants.step', 'plants.maxNodes'] },
    // + buttons: "Restart growth", "Export everything", "Import...", "Reset everything"
];
```

Coverage: all 136 keys in today's `params.ts` (checked by script, including the three new
`scene.scope*` keys) plus the 9 `commit.*` keys appear exactly once.
Nothing is hidden outright; the two engine values (`plants.step`, `plants.maxNodes`) sit in
Test & preview > Advanced. Add a dev-time assert in `buildUI` that walks `defaults` and warns
in the console about any key missing from `FOLDERS`, and append missing keys to a last
`Unsorted` folder so a new param still "shows up automatically" as `params.ts` promises.

### 1.2 Scope exceptions

| Key(s) | Folder scope | Actual scope | Why |
| --- | --- | --- | --- |
| `colours.mode`, `colours.rainbowSpeed` | rig | **look** | rainbow is a look; the palette is the artist's brand |
| `scene.showGuides` | rig | **local** | preview switch, already excluded from sync |
| `avatar.opacity` | local | rig (synced today) | preview-only value; harmless either way |
| `plants.step`, `plants.maxNodes` | local | **look** | synced, and a preset may raise `maxNodes` (Lush ivy) |
| `transitions.*` | look | look | listed for clarity: presets may change them |

Derive scope in code rather than by hand: `local` = whatever `syncable()` in `main.ts` strips;
`rig` = an explicit `RIG_KEYS` set (`scene.viewRadius/centerX/centerY`, `avatar.*`,
`halo.restRadius/restY/openRadius/openY`, `layout.lowOriginY/midOriginY/downGap`,
`colours.live`, `colours.take1..7`); `look` = everything else.

### 1.3 Labels (UI only)

Today the label is the raw key. Add `LABELS: Record<string, string>` next to RANGES; fall back to
the key. Put the `params.ts` doc comment in the row's `title` attribute as a tooltip
(`binding.element.title = HINTS[path]`), since Tweakpane has no description line.

| Key | Label | Key | Label |
| --- | --- | --- | --- |
| `growth.reach` | size | `growth.spread` | arch |
| `growth.flatten` | flatten | `growth.branching` | density of branches |
| `plants.lift` | tips up / droop | `plants.clearance` | gap between branches |
| `plants.maxWidth` | trunk width | `plants.tipWidth` | tip width |
| `growth.secondsToFull` | grow time (s) | `growth.fadeAfter` | old tree stays (s) |
| `growth.fadeSeconds` | old tree fade (s) | `growth.restBrightness` | brightness when resting |
| `growth.witherOnPause` | wither in pauses | `growth.witherDepth` | wither depth |
| `look.theme` | theme (fallback) | `look.density` | leaf amount (fallback) |
| `look.decoSize` | leaf size | `look.naturalTint` | natural colours |
| `look.variety` | tone variety | `look.depthShade` | inner shade |
| `look.blossoms` | blossoms (leaves theme) | `look.thornEffort` | thorn growth (thorns theme) |
| `look.decoGlow` | leaf glow | `glow.base` | idle glow |
| `glow.levelGain` | glow from loudness | `glow.onsetGain` | flash on note starts |
| `glow.pitchShine` | shine on high notes | `glow.front` | growing-edge glow |
| `glow.wide` | haze | `glow.crowd` | less glow where dense |
| `glow.inkMask` | glow around, not on | `glow.knee` | soft roll-off |
| `response.brightness` | loudness to brightness | `response.effortWidth` | effort to thickness |
| `response.pitchSteer` | high notes grow upward | `response.variety` | reveal-order variety |
| `response.phraseGap` | pause that ends a phrase (s) | `response.release` | settle time (s) |
| `halo.origins` | growing points | `halo.tailDeg` | vine length (deg) |
| `halo.alwaysLeaves` | permanent leaves | `halo.spawnSeconds` | appear time (s) |
| `halo.restRadius` / `restY` | idle halo size / height | `halo.openRadius` / `openY` | recording halo size / height |
| `layout.lowOriginY` | hub height (1 take) | `layout.midOriginY` | hub height (2+ takes) |
| `layout.downGap` | gap behind body (deg) | `layout.shrinkPerTake` | shrink per extra take |
| `layout.spinSpeed` | carousel speed (deg/s) | `layout.spinFrom` | carousel from N takes |
| `layout.tierFrom` | two rows from N takes | `layout.innerScale` | inner row size |
| `scene.viewRadius` | zoom out | `scene.layers` | fake takes |
| `scene.showScope` | voice scope (G) | `scene.scopeLayer` | scope follows (0 = halo) |
| `source.useTrackColours` | use DAW track colours | `source.holdSeconds` | dropout hold (s) |
| `avatar.avoid` | keep leaves off the avatar | `avatar.opacity` | placeholder opacity |

Two near-duplicates were the reason for renaming: `look.variety` vs `response.variety`, and
`response.brightness` vs `growth.restBrightness`.

### 1.4 Small behaviours

- `look.theme` / `look.density`: keep the folder note. Put a one-line readonly text blade above
  them: "Used by the fake singer and tracks set to Viewer default". Everything else in the
  folder applies to every track.
- Hide dependent rows with `binding.hidden`: `colours.rainbowSpeed` unless mode is rainbow;
  `growth.witherDipSemitones` unless `witherOnPitchDip`; `scene.scopeLayer` / `scopeSeconds`
  unless `showScope`; `commit.syncWindow` unless
  `commit.syncToOnset`; `layout.downGap` gets the tooltip "ignored while the carousel spins".
- Open by default: Preset and Tree shape. Remember each folder's `expanded` state in
  `localStorage['sprout.viewer.panel.v1']` (`folder.on('fold', ...)`).
- The old `Actions` folder disappears: preset actions go to Preset, test actions to Take commit
  and Test & preview.

---

## 2. Built-in presets

A preset is `{ id, name, description, values }`, with `values` a partial over **look** keys
only. Applying one: set every look key to its default, deep-merge `values`, leave rig and local
keys alone. `deepMerge` already drops unknown keys, so `motion.*` entries that do not survive
the motion redesign are ignored silently. Retune those after the redesign.

Themes: `look.theme` and `look.density` only reach the fake singer and tracks on "Viewer
default". Winter, Festive and Bramble depend on the theme, so show the hint "set tracks to
Viewer default for the full look" as the description of those three.

`commit.*` ranges are not in ui.ts yet, so they are given as direction only (last table).

```ts
export const BUILTIN_PRESETS = [
  { id: 'default', name: 'Sprout', description: 'The standard look.', values: {} },

  { id: 'calm', name: 'Calm garden',
    description: 'Slow growth, long fades, soft even glow. For ballads and talk segments.',
    values: {
      growth: { secondsToFull: 6, fadeAfter: 6, fadeSeconds: 5, restBrightness: 0.7,
                witherDepth: 0.3, witherSeconds: 1.5, leafFadeSeconds: 0.6,
                twigFadeSeconds: 1.2, regrowSpeed: 0.8 },
      response: { release: 3, brightness: 0.45, variety: 0.3 },
      plants: { lift: 0.1, wildness: 0.3 },
      halo: { idleSpeed: 5, singSpeed: 40, sproutRate: 2, sproutCurl: 1.4, sproutGrow: 1.0 },
      glow: { strength: 1.3, radius: 2.4, base: 0.4, levelGain: 0.5, onsetGain: 0.3,
              softGlow: 0.8 },
      motion: { swayHz: 0.2, trembleDeg: 1.5 },
    } },

  { id: 'ivy', name: 'Lush ivy',
    description: 'Dense, overgrown canopy and a long leafy halo vine. Glow held back so the detail shows.',
    values: {
      growth: { branching: 0.95, reach: 1.1, spread: 1.3, flatten: 0.45, secondsToFull: 4.5,
                fadeAfter: 8, fadeSeconds: 4, restBrightness: 0.65, witherDepth: 0.3 },
      look: { theme: 'leaves', density: 0.85, decoSize: 1.5, naturalTint: 0.6, variety: 0.8,
              depthShade: 0.8, blossoms: 0.4, decoGlow: 0.12 },
      plants: { wildness: 0.7, overlap: 0.8, clearance: 0.03, taper: 0.55, lift: 0.05,
                maxNodes: 3600 },
      halo: { origins: 2, tailDeg: 540, tailFade: 0.3, sproutRate: 6, sproutLength: 16,
              alwaysLeaves: 0.7, wander: 0.14 },
      glow: { strength: 1.2, wide: 0.5, crowd: 1.1, inkMask: 0.85 },
    } },

  { id: 'winter', name: 'Winter branches',
    description: 'Bare, fine twigs with wide cold haze. Sparse and quick to wither.',
    values: {
      growth: { branching: 0.25, spread: 0.7, flatten: 0.35, secondsToFull: 3,
                restBrightness: 0.4, fadeAfter: 2, fadeSeconds: 3.5, witherDepth: 0.7 },
      look: { theme: 'branches', density: 0.15, decoSize: 1.0, naturalTint: 0.1, variety: 0.35,
              depthShade: 0.4, blossoms: 0 },
      plants: { taper: 0.8, wildness: 0.6, lift: 0.35, clearance: 0.07, overlap: 0.25 },
      response: { effortWidth: 0.5 },
      halo: { alwaysLeaves: 0.1, sproutRate: 1.5, sproutLength: 8, sproutCurl: 0.4,
              tailDeg: 220 },
      glow: { strength: 1.9, radius: 2.6, wide: 1.2, base: 0.2, crowd: 0.4, knee: 1.2,
              softGlow: 0.7 },
      motion: { swayDeg: 3 },
    } },

  { id: 'festive', name: 'Festive wreath',
    description: 'Full closed wreath for the halo, natural reds and greens, sparkle on note starts.',
    values: {
      growth: { branching: 0.7, flatten: 0.4, restBrightness: 0.7, fadeAfter: 5 },
      look: { theme: 'wreath', density: 0.8, decoSize: 2.2, naturalTint: 0.9, decoGlow: 0.35,
              variety: 0.7 },
      plants: { lift: 0.3 },
      halo: { origins: 2, tailDeg: 720, tailFade: 0.2, alwaysLeaves: 0.9, idleSpeed: 12,
              sproutLength: 7, sproutCurl: 0.5, wander: 0.04, ringWidth: 0.014,
              vineWidth: 0.01 },
      glow: { strength: 2.0, base: 0.45, onsetGain: 1.2, pitchShine: 0.9, crowd: 0.9 },
    } },

  { id: 'stage', name: 'Stage',
    description: 'Fast and punchy: trees shoot up and clear quickly, strong flashes, big motion.',
    values: {
      growth: { secondsToFull: 1.8, fadeAfter: 1.5, fadeSeconds: 1.2, restBrightness: 0.4,
                branching: 0.7, spread: 1.4, witherOnPitchDip: true, witherDepth: 0.7,
                witherSeconds: 0.4, regrowSpeed: 2.5 },
      response: { phraseGap: 0.6, release: 0.7, brightness: 1, effortWidth: 1.5,
                  pitchSteer: 0.8, variety: 0.8 },
      look: { blossoms: 1 },
      halo: { origins: 3, idleSpeed: 20, singSpeed: 160, tailDeg: 200, sproutRate: 8,
              sproutLength: 16, sproutGrow: 0.3, spawnSeconds: 0.5 },
      glow: { strength: 2.4, base: 0.2, levelGain: 1.6, onsetGain: 1.8, pitchShine: 1.0,
              front: 1.8, knee: 1.2 },
      motion: { swayDeg: 8, swayFromLevel: 3, swayHz: 0.5, trembleDeg: 5 },
      transitions: { liveEndSeconds: 0.4, pruneSeconds: 0.9 },
    } },

  { id: 'minimal', name: 'Minimal',
    description: 'Small, quiet, low glow. Stays out of the way of chat and game capture; lightest on the GPU.',
    values: {
      growth: { branching: 0.3, reach: 0.8, restBrightness: 0.35, fadeAfter: 1.5,
                fadeSeconds: 2 },
      response: { brightness: 0.5, effortWidth: 0.5 },
      look: { density: 0.3, decoSize: 1.2, decoGlow: 0.1, blossoms: 0.3, naturalTint: 0.2 },
      plants: { wildness: 0.25, maxNodes: 1500 },
      halo: { sproutRate: 1.5, sproutLength: 7, alwaysLeaves: 0.2, tailDeg: 180,
              wander: 0.04 },
      glow: { strength: 0.8, radius: 1.2, wide: 0.3, base: 0.15, levelGain: 0.5,
              onsetGain: 0.3, pitchShine: 0.2, front: 0.4 },
      motion: { swayDeg: 3, trembleDeg: 1.5 },
    } },

  { id: 'bramble', name: 'Bramble',
    description: 'Drooping, pointed, thorny. Thorns and thickness follow vocal effort.',
    values: {
      growth: { branching: 0.5, spread: 1.6, flatten: 0.7 },
      look: { theme: 'thorns', thornEffort: 2, density: 0.45, decoSize: 1.6, naturalTint: 0.5,
              depthShade: 0.8 },
      plants: { lift: -0.25, taper: 0.9, wildness: 0.8, softDroop: 1.6 },
      response: { effortWidth: 1.4, pitchSteer: 0.7 },
      halo: { sproutCurl: 0.3, sproutLength: 14, wander: 0.12, alwaysLeaves: 0.5 },
      glow: { strength: 1.4, front: 1.4, onsetGain: 1.2 },
    } },
] as const;
```

Commit animation per preset, to fill in once the `commit.*` ranges exist:

| Preset | duration | impact / burst / shockRing | spinTurns, plunge | syncToOnset |
| --- | --- | --- | --- | --- |
| Sprout | default | default | default | default |
| Calm garden | about 1.5x | about half; shockRing off or lowest | fewer turns, gentle plunge | off |
| Lush ivy | default | burst up (more leaves), impact default | default | default |
| Winter branches | default | burst low, shockRing up (one clean ring) | default | default |
| Festive wreath | default | burst high | one extra turn | on |
| Stage | about 0.6x | all near the top of the range | more turns, deep plunge | on, short window |
| Minimal | about 0.7x | all low; shockRing off | zero or one turn | off |
| Bramble | default | impact high, burst low | deep plunge | default |

Notes on the choices:

- No preset touches reach above 1.1 or any rig key, so picking a preset never pushes the canopy
  out of frame or off the avatar.
- `plants.maxNodes` 3600 in Lush ivy costs GPU and build time; check `sprout.stats()` in OBS
  with 6+ takes before shipping it, and fall back to 2600 if frames drop.
- Stage leaves `layout.spinSpeed` at 0: a carousel behind the avatar is a bigger decision than
  a preset should make silently.
- Run `sprout.ink()` and `sprout.pixels()` on Lush ivy and Festive (the two dense ones); the
  comment on `decoGlow` warns that dense themes blow out above about 0.6, and Festive sits at 0.35.

---

## 3. Behaviour spec

### 3.1 Model

```ts
type Preset = { id: string; name: string; description?: string; values: DeepPartial<Params>;
                builtin?: boolean };
// baseline(path) = look key ? (active.values[path] ?? defaults[path]) : defaults[path]
// modified(path) = !same(params[path], baseline(path))
// dirty          = any look key is modified
```

`same()`: numbers equal within 1e-6 (or half the slider step), colour strings compared
lower-case, everything else `===`. Dirty and "which preset is active" are always computed from
values, never stored as flags, so they cannot go stale after a sync or an import.

Storage, all in localStorage:

| Key | Content |
| --- | --- |
| `sprout.viewer.params.v2` | unchanged: diff of all params against defaults |
| `sprout.viewer.presets.v1` | `{ active: 'calm' or 'user:<slug>' or null, user: Preset[], stash?: values }` |
| `sprout.viewer.panel.v1` | folder open/closed states |

User presets store `values` as the look-scope diff against defaults (same idea as
`changedOnly`), so improved defaults still reach the keys a preset never set. The cost: a user
preset can shift slightly when a default changes. That matches how saved settings already behave.

### 3.2 Preset folder (top of the pane, open)

```
Preset: Calm garden *                 <- folder title; " *" when dirty
  preset   [ Calm garden        v ]   <- list blade
  (description, readonly text blade, hidden when empty)
  [ Save ]                            <- user presets only, enabled when dirty
  name     [ Calm garden 2      ]     <- text binding on a scratch object
  [ Save as new preset ]
  [ Revert all changes ]              <- enabled when dirty
  [ Delete ]  [ Export ]  [ Import... ]
```

- **List**: `pane.addBlade({ view: 'list', label: 'preset', options, value })`. Options in
  order: built-ins, then user presets A to Z prefixed with a middle dot or "My: ", then
  "Unsaved tweaks" when a stash exists. Rebuild the options after save/delete through the list
  blade's `options` setter; if that misbehaves in 4.0.5, dispose the blade and re-add it with
  `index: 0` in the folder.
- **Dirty indicator**: set `folder.title = 'Preset: ' + name + (dirty ? ' *' : '')` after every
  change (inside the existing 80 ms debounce). Do not rewrite the option text; changing options
  while the dropdown is open closes it.
- When values match no preset and none is active: title `Preset: Custom`, list shows a
  disabled-looking first option "(custom)".
- **Choosing a preset**: apply it (section 2), `refresh()`, then `userChange()` once, so one
  save and one sync message. If the panel was dirty, first copy the current look values to
  `stash`; they appear as "Unsaved tweaks" in the list and choosing that restores them. One
  stash only; the next dirty switch overwrites it. No confirm dialog: a modal while live on
  stream is worse than a recoverable switch.
- **Revert all changes**: re-apply the active preset. Stashes first, same as above.

### 3.3 Per-control revert button

- **Where**: a 14 px button with a return arrow, appended to the row's label element
  (`binding.element.querySelector('.tp-lblv_l')`), right-aligned inside the label column so the
  value column keeps its width. Keep a `Map<path, { binding, button }>` built in the folder loop.
- **When visible**: only when `modified(path)`. Toggle a class on `binding.element`
  (`sprout-mod`); the same class tints the label text (Tweakpane CSS variable
  `--tp-label-foreground-color` on that row). Recompute for all rows after every change,
  refresh, preset switch and remote update; about 145 comparisons is nothing.
- **Folder hint**: a folder whose rows include modified ones gets a dot appended to its title
  ("Glow •"), and the nested Advanced folder likewise, so a changed value inside a closed fold
  is never invisible.
- **Click**: set the value to `baseline(path)`, which is the active preset's value, or the
  factory default when no preset is active and for rig/local keys. This is the right default:
  with "Calm garden" active the artist's mental reference is Calm garden, and reverting to
  factory would make the row *more* different from the preset while the button vanished.
- **Shift-click**: set the factory default instead (the row may then still show as modified
  against the preset; that is correct).
- **Tooltip** (`title`): `Revert to 6.0 (Calm garden). Shift-click: default 3.5`. Omit the
  second half when both are equal.
- **Keyboard**: a real `<button>`, in tab order after its control, Enter or Space activates,
  Shift+Enter gives the factory default. No global shortcut.
- **Mechanics**: write `p[section][key] = value`, call `binding.refresh()`, then the normal
  `userChange()` path. Do not go through `refresh()` of the whole pane, whose 400 ms quiet
  window would swallow a slider drag that follows immediately.
- Readonly status rows and buttons get no revert button. Colour rows do.

### 3.4 Save and save-as

- **Save** overwrites the active *user* preset with the current look diff. Hidden for built-ins.
- **Save as new preset**: uses the `name` field, prefilled with `<active name> 2` (or
  `My look`). Trim, max 32 characters, empty is refused. A built-in name gets " (mine)"
  appended. An existing user name turns the button into `Overwrite "<name>"?` for 3 seconds;
  a second click confirms. Id is `user:` + slug of the name. After saving, the new preset is
  active and the title loses its star.
- **Delete** (user presets only): two-click confirm in the same style (`Click again to delete`
  for 3 s). The values stay on screen; the panel becomes `Custom` and is not dirty-starred.
- Rename is save-as followed by delete; no separate control.

### 3.5 Export and import

| Button | File | Content |
| --- | --- | --- |
| Preset > Export | `sprout-preset-<slug>.json` | `{ sprout: 'preset', version: 1, name, description, values }` with current look diff (so it includes unsaved tweaks) |
| Test & preview > Export everything | `sprout-settings.json` | `{ sprout: 'settings', version: 1, params: <full p, as today>, presets: <user presets> }` |

Import (one button in each place, same handler) decides by content:

1. `sprout === 'preset'`: add to user presets (name clash: append " (imported)"), select it.
2. `sprout === 'settings'`: `deepMerge(p, params)` for everything including rig, merge user
   presets by id, then re-derive the active preset.
3. No `sprout` field (a file from today's "Export preset"): treat as case 2 with no presets.
   This keeps every existing .json working.

Always wrap `JSON.parse` in try/catch and show the failure in the button title for 3 s; today a
bad file throws inside the `onchange` handler. `deepMerge` already filters by key and type; do
not clamp to RANGES, since typed values may exceed them by design.

"Reset to defaults" becomes: Preset list > Sprout (look only). "Reset everything" in
Test & preview restores rig and local keys too, with the two-click confirm.

### 3.6 Presets and settings sync

- Applying, reverting or saving sends exactly what a slider change sends today: one `params`
  message with `syncable()`. No new message type and no change to Sprout.exe.
- A receiving viewer with a panel runs **match by value** after `deepMerge`: if its current
  active preset still matches, keep it; otherwise search built-ins then user presets for one
  whose applied values equal the received look values; otherwise show the old name with a star
  when one was active, else `Custom`. The same routine runs at page load and after an import.
- The OBS page has no panel and needs none of this; it only needs the values.
- User preset *libraries* are per browser origin. Two tabs on `localhost:7777` share them (listen
  for the `storage` event and rebuild the list); the dev server on 5173 has its own. Moving a
  library is "Export everything" then Import. Storing presets in Sprout.exe would fix this
  properly, and is not needed for a first version.
- `source.syncSettings` off: presets apply to this viewer only, as with any other change.
- Rig keys ride along in sync as today, but since presets never contain them, choosing a
  preset in one viewer can never reframe or re-fit another.

One thing to check outside the panel: `syncable()` (main.ts:143) drops all of `source`, and the
OBS page has no panel, so as far as I can tell from the code `source.useTrackColours` and
`source.holdSeconds` can only ever have their default values in OBS. If the artist expects the
"use DAW track colours" fallback to reach OBS, sync those two keys (strip only `mode`, `port`
and `syncSettings` from `source`). I did not test this against a running OBS page.

---

## 4. Build order

1. `FOLDERS`, `LABELS`, scope sets and the coverage assert; rebuild the folder loop (no behaviour change).
2. `baseline` / `modified` and the per-row revert button with folder dots.
3. Built-in presets, the list blade, title star, stash.
4. Save, save-as, delete, the presets storage key.
5. Export/import formats; match-by-value on remote updates and load.
6. Tune the preset values on screen; fill in `commit.*` and retune `motion.*` when those land.
