# Design consult 6: presets, planting animation, branch-per-phrase, falling leaves, blossoms, taps, take colours

Written against commit b46ac5b (branch `part-a-gesture-trees`). Read: `viewer/src/params.ts`,
`presets.ts`, `panel-layout.ts`, `deco.ts`, `themes.ts`, `colour.ts`, `gradient.ts`, `drive.ts`,
`main.ts`, `growth/commit.ts`, `growth/generations.ts`, `growth/plant.ts`, `growth/halo.ts`,
`layout.ts`, `sources/live.ts`, `sources/fake.ts`, `shaders/sprite.vert`, `common/SproutBus.h`,
`tap/SproutTapProcessor.*`, `app/main.cpp`. Nothing was run or seen on screen: every number is a
starting point reasoned from the code. No source file was changed.

## Summary

| # | Question | Decision |
| --- | --- | --- |
| 1 | Presets | 10 Look presets (7 reworked, 3 new), 9 Reaction presets (5 reworked, 4 new), 11 Setup presets (4 new). Every one uses the colour roles, glow tint, held-note blossoms, shedding and the new keys below. "Sprout" and "Responsive" stay `{}`, so new features reach them through changed **defaults**. `halo.squish` / `tilt` stay rig (a preset must not undo your fit); the default squish becomes 0.35 so it shows. |
| 2 | Planting animation | Keep the beats and all params. Change the geometry: the ring breaks into up to `commit.limbs` pieces; each curls up **at the spot where one main limb leaves the avatar** and unrolls outward along that real, curved limb like a fern frond. It never uses the straight extension past the tip, stops inside the view, and at the impact the fronds *are* the limbs, so nothing is swapped. |
| 3 | Branch per phrase | `growth.branchEachPhrase`. Built on the existing "new tree each phrase" machinery: each phrase's tree is built as **one bough** in the next free slice of the take's territory. The newest `growth.branchesKept` stay; older ones dry out, droop, drop their leaves and fall. Bounded by construction. |
| 4 | Tips ungrowing | It is the wither feature itself: twigs retract (`vis` falls), and leaves and blossoms are sized by `vis`. New toggle `growth.shed` (default on): a leaf or blossom whose twig starts to retract, or whose blossom closes, lets go and falls. |
| 5 | Blossoms | A blossom gets its own twig end: that end carries **no leaf** (nor does the node before it), shows a small bud while closed, and the flower turns toward the sky instead of along the twig. |
| 6 | Preset / theme / tap | Theme = what a plant is made of, including its natural colours (which may now be gradients). Look preset = how the scene uses colour and shape. Tap = per-track overrides; every tap setting defaults to **Auto** and presets stop writing into taps. Tap colour gets Auto / Track colour / My colour / My gradient; the gradient travels as the viewer's gradient string in a new `SlotInfo.ink[192]` (bus v5). |
| 7 | Take colours | Stay a rig setting by default ("My take colours"). A Look may bring its own palette (`palette.from: 'list'`, a step gradient used as a list) with pick `order`, `random` or `spread`. Colours are assigned per take **id** (stable when another take is deleted). Not a theme setting. |

### New keys at a glance

| Key | Default | Kind | Range | Item |
| --- | --- | --- | --- | --- |
| `growth.shed` | `true` | reactivity | | 4 |
| `growth.branchEachPhrase` | `false` | reactivity | | 3 |
| `growth.branchesKept` | `3` | reactivity | 1..6, step 1 | 3 |
| `growth.branchWitherSeconds` | `2.5` | reactivity | 0.3..8 | 3 |
| `growth.branchDroopDeg` | `30` | reactivity | 0..70 | 3 |
| `growth.branchFallSeconds` | `1.4` | reactivity | 0.3..4 | 3 |
| `commit.limbs` | `3` | reactivity | 1..4, step 1 | 2 |
| `look.buds` | `0.25` | visual | 0..0.6 | 5 |
| `look.dryColour` | `'#8a6f45'` | visual | colour | 3, 4 |
| `palette.from` | `'mine'` | visual | `'mine' \| 'list'` | 7 |
| `palette.list` | the seven current take colours as a step gradient | visual | gradient | 7 |
| `palette.pick` | `'order'` | visual | `'order' \| 'random' \| 'spread'` | 7 |
| `palette.seed` | `1` | visual | 1..99, step 1 | 7 |
| `colours.lock` | `false` | rig | | 7 |
| `fake.autoCommit` | `0` | testing | 0..30 (s, 0 = off) | 1 |

Changed defaults: `halo.squish` 0 → 0.35; `colHalo` → `{ source: 'gradient', gradient:
'ok;0:t,0.7:t,1:ffffff', along: 1, speed: 0.08, perTake: 0 }` (the take colour with a white glint
travelling round the ring, so the default look already shows a gradient and a mover).

Wiring for every new key: add the five `growth.*` keys to `REACTIVE` in `presets.ts` (`commit.*`
is reactive by section; `look.buds`, `look.dryColour` and `palette.*` are visual without any
change; `fake.*` is testing by prefix); add `colours.lock` to `RIG_KEYS`; add ranges in `ui.ts`
`RANGES` (`'palette.list': { gradient: true }`); add the keys to folders in `panel-layout.ts`
(section 8).

---

## 1. Presets

### 1.1 Rules used

- `kindOf()` decides what a preset may hold. Checked for every key below: `col*`, `glow.tint*`,
  `look.theme/density/decoSize/variety/depthShade/decoGlow/tint/tintAmount`, tree shape, halo
  shape and `palette.*` are **visual**; `look.blossoms`, `look.blossomHold`, `look.thornEffort`,
  the `growth` timing and wither keys, `response`, `motion`, `commit`, `transitions` are
  **reactivity**; `fake.*` and the listed `scene.*` keys are **testing**.
- `halo.squish`, `halo.tilt`, `halo.restX` are in `RIG_KEYS`. They fit the halo to how your
  avatar's head is drawn, so a preset must not change them (every look you pick would undo your
  fit). They stay rig. To make the feature visible out of the box the default `halo.squish`
  becomes 0.35, and the Setup preset "Not recording" shows the resting halo.
- "Sprout" and "Responsive" must stay `values: {}`: the active preset is found by comparing
  values with the defaults, so a non-empty default preset would show a star on a fresh install.
  New features reach them through `params.ts` defaults (table above).
- Macros are not settings, but presets should sit on the macro lines so the combined sliders
  read cleanly (no "~"). The macro position is given where the preset is on the line.
- Blossoms on long notes and shedding are reactivity keys, so they are exercised in the Reaction
  presets, not the Look presets.

### 1.2 Look presets (`BUILTINS.visual`)

Paste-ready. Keys not listed keep their defaults.

```ts
{ id: 'default', name: 'Sprout',
  description: 'The standard look: leafy canopy in your take colours, a white glint travelling round the halo.',
  values: {} },

{ id: 'ivy', name: 'Lush ivy',
  description: 'Dense and overgrown. Woody dark stems that turn into your take colour, leaves from deep to light green.',
  values: {                                             // fullness macro = 1
    colBranch: { source: 'gradient', gradient: 'ok;0:2e2116,0.45:t,1:t', along: 1, speed: 0, perTake: 0, takeMix: 0 },
    colLeaf: { source: 'gradient', gradient: 'ok;0:14532a,0.5:3fae4e,1:9bdc3a', takeMix: 0.4, along: 0.8, scatter: 0.5 },
    colAccent: { takeMix: 0.2 },
    colHalo: { source: 'take' },
    growth: { branching: 0.95, reach: 1.1, spread: 1.3, flatten: 0.45 },
    look: { theme: 'leaves', density: 0.85, decoSize: 1.5, variety: 0.8, depthShade: 0.8, decoGlow: 0.12, buds: 0.3 },
    plants: { wildness: 0.7, overlap: 0.8, clearance: 0.03, taper: 0.55, lift: 0.05, maxNodes: 3600 },
    halo: { origins: 2, tailDeg: 540, tailFade: 0.3, sproutLength: 16, alwaysLeaves: 0.7, wander: 0.14 },
    glow: { strength: 1.2, wide: 0.5, crowd: 1.1, inkMask: 0.85, tint: '#d8ffb0', tintAmount: 0.25 },
  } },

{ id: 'winter', name: 'Winter branches',
  description: 'Bare twigs from deep blue roots to white tips, a cold haze. Airy singing frosts them further.',
  values: {                                             // fullness macro = 0
    colBranch: { source: 'gradient', gradient: 'ok;0:0b2a6b,0.4:2f7fe0,0.75:8fe3ff,1:f2fdff', along: 1, speed: 0,
                 perTake: 0, takeMix: 0.35, voice: 'breath', voiceAmount: 0.3 },
    colHalo: { source: 'branches' },
    colLeaf: { takeMix: 0.9 },
    growth: { branching: 0.3, spread: 0.7, flatten: 0.35 },
    look: { theme: 'branches', density: 0.3, decoSize: 1.0, variety: 0.35, depthShade: 0.4, buds: 0, dryColour: '#9aa3ad' },
    plants: { taper: 0.8, wildness: 0.6, lift: 0.35, clearance: 0.07, overlap: 0.25 },
    halo: { alwaysLeaves: 0.2, sproutLength: 8, sproutCurl: 0.4, tailDeg: 220 },
    glow: { strength: 1.9, radius: 2.6, wide: 1.2, base: 0.2, crowd: 0.4, knee: 1.2, tint: '#bfe3ff', tintAmount: 0.6 },
    palette: { from: 'list', list: 'step;0:e8f4ff,0.2:9fd0ff,0.4:6aa8f0,0.6:b8a8ff,0.8:8fe3ff', pick: 'order' },
  } },

{ id: 'festive', name: 'Festive wreath',
  description: 'A full wreath: natural greens, baubles in red, gold and white, a candy-striped ring, warm glow.',
  values: {
    colLeaf: { source: 'theme', takeMix: 0.1 },
    colAccent: { source: 'gradient', gradient: 'step;0:e61424,0.5:ffd24a,0.8:ffffff', takeMix: 0, along: 0, scatter: 1 },
    colHalo: { source: 'gradient', gradient: 'step~;0:c8102e,0.167:f4f4f4,0.333:c8102e,0.5:f4f4f4,0.667:c8102e,0.833:f4f4f4',
               along: 2, speed: 0.04, perTake: 0, takeMix: 0 },
    growth: { branching: 0.7, flatten: 0.4 },
    look: { theme: 'wreath', density: 0.8, decoSize: 2.2, decoGlow: 0.35, variety: 0.7, dryColour: '#5b4630' },
    plants: { lift: 0.3 },
    halo: { origins: 2, tailDeg: 720, tailFade: 0.2, alwaysLeaves: 0.9, sproutLength: 7, sproutCurl: 0.5, wander: 0.04,
            ringWidth: 0.014, vineWidth: 0.01 },
    glow: { strength: 2.0, base: 0.45, crowd: 0.9, tint: '#ffcf7a', tintAmount: 0.35 },
    palette: { from: 'list', list: 'step;0:c8102e,0.25:1a7333,0.5:ffd24a,0.75:f4f4f4', pick: 'order' },
  } },

{ id: 'bramble', name: 'Red bramble',
  description: 'A drooping thicket: stems from black-red to crimson that flare when you push, pale bone thorns, red glow.',
  values: {
    colBranch: { source: 'gradient', gradient: 'ok;0:2a0508,0.5:8a0f22,1:e0304a', along: 1, speed: 0, perTake: 0,
                 takeMix: 0.1, voice: 'effort', voiceAmount: 0.35 },
    colLeaf: { source: 'theme', takeMix: 0.2 },
    colHalo: { source: 'branches' },
    growth: { branching: 0.95, spread: 1.5, flatten: 0.6 },
    look: { theme: 'thorns', density: 0.95, decoSize: 1.5, variety: 0.8, depthShade: 0.85, decoGlow: 0.05,
            tint: '#c0142c', tintAmount: 0.25, dryColour: '#3a2226' },
    plants: { lift: -0.2, taper: 0.85, wildness: 0.75, clearance: 0.03, overlap: 0.7, maxNodes: 3400 },
    halo: { sproutCurl: 0.3, sproutLength: 14, wander: 0.12, alwaysLeaves: 0.6 },
    glow: { strength: 0.75, radius: 1.3, wide: 0.35, base: 0.12, crowd: 1.1, inkMask: 0.85, tint: '#ff2a3c', tintAmount: 0.5 },
    palette: { from: 'list', list: 'step;0:c0142c,0.33:8a0f22,0.66:e0304a,1:6b1030', pick: 'order' },
  } },

{ id: 'minimal', name: 'Minimal',
  description: 'Small, quiet, one flat colour per take: no gradients, no buds, low glow. Lightest on the GPU.',
  values: {                                             // fullness macro = 0
    colLeaf: { source: 'take' }, colAccent: { source: 'take' }, colHalo: { source: 'take' },
    growth: { branching: 0.3, reach: 0.8 },
    look: { density: 0.3, decoSize: 1.2, decoGlow: 0.1, buds: 0 },
    plants: { wildness: 0.25, maxNodes: 1500 },
    halo: { sproutLength: 7, alwaysLeaves: 0.2, tailDeg: 180, wander: 0.04 },
    glow: { strength: 0.8, radius: 1.2, wide: 0.3, base: 0.15 },
  } },

{ id: 'neon', name: 'Neon stage',
  description: 'Pink, cyan and lime light running along wide-arching trees; your pitch pushes the colours. Strong glow.',
  values: {                                             // fullness macro = 0.64
    colBranch: { source: 'gradient', gradient: 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b', along: 0.3, speed: 0.12,
                 perTake: 0.33, takeMix: 0, voice: 'pitch', voiceAmount: 0.5 },
    colLeaf: { source: 'gradient', gradient: 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b', along: 0, speed: 0.12,
               scatter: 1, takeMix: 0 },
    colAccent: { source: 'gradient', gradient: 'ok;0:ffffff', takeMix: 0, scatter: 0 },
    colHalo: { source: 'branches' },
    growth: { branching: 0.7, spread: 1.4 },
    look: { density: 0.64 },
    halo: { origins: 3, tailDeg: 200, alwaysLeaves: 0.49 },
    glow: { strength: 2.4, base: 0.2, knee: 1.2 },
  } },

// ---- new ----
{ id: 'rainbow', name: 'Rainbow',
  description: 'Every take runs through the rainbow, each a step further along; pastel leaves; the halo jumps colour on note starts.',
  values: {                                             // fullness macro = 0.5
    colBranch: { source: 'gradient', takeMix: 0 },      // the default gradient is the rainbow: along 0.3, speed 0.05, perTake 0.13
    colLeaf: { source: 'gradient', gradient: 'rgb~;0:ffa6a6,0.167:ffffa6,0.333:a6ffa6,0.5:a6ffff,0.667:a6a6ff,0.833:ffa6ff',
               along: 0.3, speed: 0.05, perTake: 0.13, scatter: 0.6, takeMix: 0 },
    colAccent: { source: 'gradient', gradient: 'ok;0:ffffff', takeMix: 0, scatter: 0 },
    colHalo: { source: 'gradient', gradient: 'rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff',
               along: 1, speed: 0.05, perTake: 0.15, takeMix: 0, voice: 'flash', voiceAmount: 0.15 },
    glow: { strength: 1.8 },
  } },

{ id: 'sakura', name: 'Cherry blossom',
  description: 'Dark bark with rosy tips, a canopy of pink petals, big buds that open on long notes, soft pink glow.',
  values: {                                             // fullness macro = 0.75
    colBranch: { source: 'gradient', gradient: 'ok;0:3b2620,0.6:6b4038,1:c98a8a', along: 1, speed: 0, perTake: 0, takeMix: 0.15 },
    colLeaf: { source: 'gradient', gradient: 'ok;0:ffd1e6,0.5:ff9ccb,1:ffffff', along: 0, scatter: 0.8, takeMix: 0.1 },
    colAccent: { source: 'gradient', gradient: 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff', along: 0, scatter: 1, takeMix: 0 },
    colHalo: { source: 'gradient', gradient: 'ok;0:ff9ccb,1:ffffff', along: 1, speed: 0.05, perTake: 0, takeMix: 0.2 },
    growth: { branching: 0.775, spread: 1.2 },
    look: { theme: 'leaves', density: 0.7, decoSize: 1.6, variety: 0.7, buds: 0.35, dryColour: '#c9a0a8' },
    plants: { lift: -0.1, wildness: 0.55 },
    halo: { alwaysLeaves: 0.55, sproutCurl: 1.2 },
    glow: { strength: 1.5, tint: '#ffc4de', tintAmount: 0.45 },
    palette: { from: 'list', list: 'step;0:ff9ccb,0.25:ffc4de,0.5:f47fb0,0.75:ffe3ef', pick: 'order' },
  } },

{ id: 'autumn', name: 'Autumn',
  description: 'Brown wood and leaves scattered from rust to gold that brighten as you sing louder; amber glow.',
  values: {                                             // fullness macro = 0.6
    colBranch: { source: 'gradient', gradient: 'ok;0:2e1c10,1:6b4a2b', along: 1, speed: 0, perTake: 0, takeMix: 0.2 },
    colLeaf: { source: 'gradient', gradient: 'ok;0:7a1f0e,0.4:d9541e,0.7:f2a51e,1:f7dc6f', along: 0.3, scatter: 0.9,
               takeMix: 0.1, voice: 'loudness', voiceAmount: 0.2 },
    colAccent: { source: 'gradient', gradient: 'ok;0:f7dc6f,1:fff6cf', scatter: 1, takeMix: 0 },
    colHalo: { source: 'gradient', gradient: 'ok;0:d9541e,0.5:f2a51e,1:f7dc6f', along: 1, speed: 0.04, perTake: 0, takeMix: 0.2 },
    growth: { branching: 0.67 },
    look: { theme: 'leaves', density: 0.61, variety: 0.8, dryColour: '#6b4a2b' },
    plants: { lift: 0.05 },
    halo: { alwaysLeaves: 0.46 },
    glow: { tint: '#ffb060', tintAmount: 0.4 },
    palette: { from: 'list', list: 'step;0:d9541e,0.25:f2a51e,0.5:7a1f0e,0.75:f7dc6f', pick: 'random' },
  } },
```

Why each change:

| Preset | What it now exercises |
| --- | --- |
| Sprout | Halo gradient with a mover (new default), buds, shedding, squish (defaults). |
| Lush ivy | Take-colour stops (`t`) in a branch gradient, leaf gradient with scatter, glow tint. `colLeaf.takeMix: 0.4` kept. |
| Winter | Root-to-tip gradient, a voice mover (airiness), halo following branches, glow tint instead of the flat `look.tint`, a look palette, a grey dry colour. |
| Festive | Step gradient as a palette with per-berry scatter, a looping striped halo gradient, natural (`theme`) leaves, look palette. |
| Red bramble | The 0.88 flat tint goes (it hid every other colour setting); a gradient with the effort mover and natural bone thorns replace it. |
| Minimal | The control case: all roles on `take`. Needed so that one preset shows the picture with none of the colour features. |
| Neon | Looping gradient with time, pitch and per-take movers, sparkle leaves. |
| Rainbow | The old rainbow mode as a preset; note-start (`flash`) mover on the halo. |
| Cherry blossom / Autumn | Leaf gradients that are not green, large buds, `look.dryColour`, `palette.pick: 'random'`. They pair with the Reaction presets "Blossom ballad" and "Falling leaves". |

`colHalo.along` uses 2 (slider limit) with six stripes in the gradient rather than a larger value.
`colLeaf.source` stays `'theme'` in the defaults on purpose: it also colours thorns, needles and
custom parts, and only `'theme'` gives each of those its own natural colour.

### 1.3 Reaction presets (`BUILTINS.reactivity`)

```ts
{ id: 'default', name: 'Responsive',
  description: 'The standard response: grows in about 3.5 s of singing, leaves fall in pauses, blossoms on notes held 1.5 s.',
  values: {} },

{ id: 'calm', name: 'Calm (ballad)',
  description: 'Slow and lingering. Each phrase grows one new branch; old ones dry, droop and fall. Gentle motion.',
  values: {                                             // pace macro = 0, liveliness macro = 0.25
    growth: { secondsToFull: 6, fadeAfter: 6, fadeSeconds: 5, restBrightness: 0.7, witherDepth: 0.3, witherSeconds: 1.5,
              twigFadeSeconds: 1.2, regrowSpeed: 0.8,
              branchEachPhrase: true, branchesKept: 4, branchWitherSeconds: 4, branchDroopDeg: 25, branchFallSeconds: 2 },
    response: { release: 3, brightness: 0.6, variety: 0.3 },
    look: { blossoms: 0.9, blossomHold: 2 },
    halo: { idleSpeed: 5, singSpeed: 40, sproutRate: 2, sproutGrow: 1.0 },
    glow: { levelGain: 0.65, onsetGain: 0.5, softGlow: 0.8 },
    motion: { swayDeg: 6, kickDeg: 4.5, springiness: 0.3, flutterDeg: 10, speed: 0.7 },
    commit: { duration: 1.5, impact: 0.5, shockRing: false, spinTurns: 0.5, plunge: 0.2, syncToOnset: false, limbs: 2 },
  } },

{ id: 'stage', name: 'Punchy (stage)',
  description: 'Fast and hard: trees shoot up and clear quickly, pitch drops throw leaves, short holds bloom, big planting.',
  values: {                                             // pace macro = 1, liveliness macro = 1
    growth: { secondsToFull: 1.8, fadeAfter: 1.5, fadeSeconds: 1.2, restBrightness: 0.4, witherOnPitchDip: true,
              witherDepth: 0.7, witherSeconds: 0.4, regrowSpeed: 2.5 },
    response: { phraseGap: 0.6, release: 0.7, brightness: 1, effortWidth: 1.5, pitchSteer: 0.8, variety: 0.8 },
    look: { blossoms: 1, blossomHold: 0.8, thornEffort: 2 },
    halo: { idleSpeed: 20, singSpeed: 160, sproutRate: 8, sproutGrow: 0.3, spawnSeconds: 0.5 },
    glow: { levelGain: 1.6, onsetGain: 1.8, pitchShine: 1.0, front: 1.8 },
    motion: { swayDeg: 12, kickDeg: 12, springiness: 0.7, speed: 1.4, shiverDeg: 5 },
    transitions: { liveEndSeconds: 0.4, pruneSeconds: 0.9 },
    commit: { duration: 0.65, impact: 1.8, burst: 70, spinTurns: 1.5, plunge: 0.4, syncToOnset: true, syncWindow: 0.15, limbs: 4 },
  } },

{ id: 'subtle', name: 'Subtle',
  description: 'Small reactions: little brightness change, light motion, few blossoms, the halo plants as a single quiet frond.',
  values: {                                             // liveliness macro = 0
    growth: { restBrightness: 0.35, fadeAfter: 1.5, fadeSeconds: 2 },
    response: { brightness: 0.5, effortWidth: 0.5 },
    look: { blossoms: 0.4, blossomHold: 2.5 },
    halo: { sproutRate: 1.5 },
    glow: { levelGain: 0.5, onsetGain: 0.3, pitchShine: 0.2, front: 0.4 },
    motion: { swayDeg: 4, kickDeg: 3, flutterDeg: 8, shiverDeg: 1.5 },
    commit: { duration: 0.7, impact: 0.4, burst: 10, shockRing: false, spinTurns: 0.5, syncToOnset: false, limbs: 1 },
  } },

{ id: 'vibrato', name: 'Vibrato-sensitive',
  description: 'Light vibrato already makes twigs and leaves shimmer; soft singing glows wider; blossoms after a 1 s hold.',
  values: {
    look: { blossomHold: 1 },
    motion: { shiverDeg: 6, shiverSensitivity: 2, flutterDeg: 18 },
    glow: { softGlow: 0.8 },
  } },

// ---- new ----
{ id: 'branches', name: 'Branch by branch',
  description: 'One tree per take: every phrase grows a new branch on it while the oldest withers, droops and falls off.',
  values: {
    growth: { branchEachPhrase: true, branchesKept: 3, branchWitherSeconds: 2.5, branchDroopDeg: 35, branchFallSeconds: 1.4,
              secondsToFull: 3, restBrightness: 0.7 },
  } },

{ id: 'bloom', name: 'Blossom ballad',
  description: 'One tree keeps growing through the song. Notes held for a second open the blossoms; their petals fall when the note ends.',
  values: {
    growth: { newTreeEachPhrase: false, secondsToFull: 5, restBrightness: 0.75, witherDepth: 0.35, witherSeconds: 1.5 },
    look: { blossoms: 1, blossomHold: 1 },
    glow: { softGlow: 0.8 },
    motion: { shiverDeg: 5, shiverSensitivity: 1.5 },
  } },

{ id: 'fall', name: 'Falling leaves',
  description: 'Pauses and pitch drops strip the outer twigs deep into the tree and the leaves rain down; it regrows fast when you sing.',
  values: {
    growth: { newTreeEachPhrase: false, witherOnPitchDip: true, witherDipSemitones: 2, witherDepth: 0.8, witherSeconds: 0.6,
              twigFadeSeconds: 1.2, regrowSpeed: 2 },
  } },

{ id: 'steady', name: 'Steady (no withering)',
  description: 'Nothing retracts or falls: one tree grows and stays, blossoms open whenever you sing. For comparing.',
  values: {
    growth: { newTreeEachPhrase: false, witherOnPause: false, shed: false, restBrightness: 0.8 },
    look: { blossomHold: 0 },
  } },
```

`growth.shed` is `true` by default, so every preset except "Steady" has it on ("defaulting to on
everywhere"). "Steady" turns it off on purpose so the old shrink-in-place behaviour of blossoms
stays testable.

### 1.4 Setup presets (`BUILTINS.testing`)

The seven existing ones stay as they are. New:

```ts
{ id: 'held', name: 'Held notes (blossoms)',
  description: 'Fake singer holds notes up to 4.5 s: blossoms open, and their petals fall when the note ends.',
  values: { fake: { phraseMin: 5, phraseMax: 9, noteMax: 4.5, gapMin: 0.6, gapMax: 1.2, highNotes: 0.15 } } },
{ id: 'pauses', name: 'Short phrases, long pauses',
  description: 'Every pause ends the phrase: shows a new tree or a new branch per phrase, withering and falling leaves.',
  values: { fake: { phraseMin: 1.5, phraseMax: 3, gapMin: 1.5, gapMax: 3 } } },
{ id: 'jumps', name: 'Pitch jumps',
  description: 'Many jumps to very high notes and back down: shows pitch-dip withering and pitch-driven colour.',
  values: { fake: { highNotes: 0.8, noteMax: 0.8 } } },
{ id: 'planting', name: 'Planting loop',
  description: 'The live take is planted as a tree every 7 s and the oldest of four is removed: shows the planting and the removal.',
  values: { fake: { autoCommit: 7 }, scene: { layers: 2 } } },
```

Note: while this was being written, the working tree gained `fake.longNotes`,
`fake.fullStopEvery` and `fake.fullStopSeconds` (uncommitted). Where they exist, use them in
these presets as well: "Held notes" adds `longNotes: 0.6`; "Short phrases, long pauses" adds
`fullStopEvery: 1, fullStopSeconds: 3`; "Pitch jumps" and "Fast pop" set `fullStopEvery: 0` so
nothing but the pitch drives the withering there.

`fake.autoCommit` (seconds, 0 = off) in `FakeSource.update`:

```ts
if (fp.autoCommit > 0 && (this.commitDue += dt) >= fp.autoCommit) {
  this.commitDue = 0;
  this.commit(p);
  if (this.takeIds.length > 4) { this.takeIds.shift(); p.scene.layers = this.takeIds.length + 1; }
}
```

### 1.5 Keeping the rule

"Always include new features in existing system presets" is easy to forget. Add one check to the
dev build (a `console.warn` in `presets.ts` under `import.meta.env.DEV`): for every key in
`KIND_PATHS[kind]`, warn if no built-in preset of that kind sets a value different from the
default. A new param then names itself in the console until some preset uses it.

---

## 2. Planting animation (`growth/commit.ts`)

### 2.1 Why it reads as "one long branch out of the view, then a respawn"

- `point(u)` puts the strand at `d = baseAt(u) + S * u` on `plant.spineAt(d)`, with
  `baseAt = lerp(b0, D, sigma) + drawBack` and `b0 = max(D, rClear + Rc + 0.05)` (about 1.3).
  While it unrolls, the coil rides far out along the spine, and when it is fully unrolled the staff
  covers `[D + drawBack, D + drawBack + S]`: 0.34 units **past the limb's tip**, where `spineAt`
  continues in a straight line. The limb's tip is already on the canopy outline (half-width
  `2.15 * growth.reach`), which is wider than the square that is always visible
  (`scene.viewRadius` 1.9). So the end of the staff leaves the picture in any window that is not
  wide.
- The spine is the root, the hidden trunk and one primary limb: 2.2 to 2.6 units, the longest
  path in the tree. The whole 6.6-unit ring is squeezed onto that one line.
- At the impact `revealSpine()` shows one limb, `s.alpha` jumps from 0 to 1, `g.reveal` jumps to
  `stampReveal`, and the strand (a different shape in a different place: it has just moved 0.34
  rootward) fades in 0.15 to 0.25 s. Two different drawings are swapped, which is the respawn.

### 2.2 New idea: "fronds"

The ring breaks into K pieces (K = the tree's primary limbs, at most `commit.limbs`). Each piece
curls up into a small coil **at the point where its limb comes out from behind the avatar**, then
unrolls outward along that limb's real curve, like a fern frond, and stops short of the tip.
Then the short tug and hit at the root, and the rest of the tree grows out of the fronds.

Why this reads as the halo becoming the tree: the ring's 6.6 units are about the total length of
three or four primaries (1.5 to 2.2 each), so the pieces hardly stretch; every piece stays inside
the tree's own footprint next to the head; and at the impact the fronds lie exactly on the limbs
that `Plant` then shows, so there is nothing to swap. In branch-per-phrase mode (section 3) a
tree has one primary, so K = 1 and the whole ring becomes that branch.

Beats and their lengths (`T`) stay. All params keep their meaning:

| Beat | Was | Now |
| --- | --- | --- |
| 0 release | glow swells, colour turns | same |
| 1 wind-up | ring shrinks to one coil and travels round the head | ring spins (`spinTurns`), breaks into K arcs; each arc curls into its coil at its limb's exit point |
| 2 unfurl | one coil unrolls along the spine | K coils unroll along their limbs, 0.06 s apart |
| 3 draw back | staff pulls back 0.06 | fronds pull back 0.06 toward their tips (same number) |
| 4 plunge | staff drives `plunge` rootward | fronds snap `plunge + 0.06` rootward, so their root ends reach the avatar's edge |
| impact | spine revealed, flash, ring, burst | the K limbs are revealed up to where the fronds end; same effects |
| 5 splay | tree grows fast | same, a little slower (2.6) |

### 2.3 Geometry

Plant side (`plant.ts`): generalise the spine to every primary.

```ts
/** One path per primary limb: root -> hub -> that primary. limbPaths[mid] is today's spine. */
limbPaths: { idx: Int32Array; cum: Float32Array; length: number; clear: number }[] = [];
limbAt(k: number, d: number)            // today's spineAt, on path k, clamped to 0..length (no straight extension)
revealLimb(k: number, upTo: number)     // today's revealSpine for the nodes of path k with cum <= upTo
```

Build them where the spine is built today (end of `buildGesture`): loop over all `limbs` with
`prim >= 0`, same code, `clear` = first `cum` whose node is not `hidden`. Keep `spine`,
`spineLength`, `rClear` as aliases of the middle path so nothing else changes.

Commit side. Units are plant-local; `sc = max(0.05, place.scale)`; `D = commit.plunge / sc`;
`back = 0.06 / sc`.

```ts
interface Piece { k: number; d0: number; L: number; Rc: number; side: 1 | -1; delay: number }

/** Frozen on the first frame with a target, and again only if the plant was rebuilt. */
private pieces(tg: CommitTarget): Piece[] {
  const P = tg.plant.limbPaths, want = clamp(Math.round(this.p.commit.limbs), 1, 4);
  const K = Math.min(want, P.length);
  // Evenly chosen primaries, always including the middle one; sorted by world angle about the hub
  // in the vine's direction, so the pieces do not cross on their way.
  const ks = pickEven(P.length, K).sort(byWorldAngle(tg, this.dir));
  return ks.map((k, m) => {
    const d0 = P[k].clear;
    const L = Math.max(0.25, this.fit(tg, k, d0) - D - back);     // the tip stays inside the view
    const Rc = Math.max(L / TAU, 0.08 / sc);
    return { k, d0, L, Rc, side: this.coilSide(tg, k, d0, Rc), delay: 0.06 * m };
  });
}

/** Longest stretch of limb k from d0 whose world points stay inside the view, margin 0.12. */
private fit(tg: CommitTarget, k: number, d0: number) {
  const v = tg.view, S = tg.plant.limbPaths[k].length;
  let ok = d0;
  for (let d = d0; d <= S; d += 0.05) {
    const q = tg.plant.limbAt(k, d);
    const [wx, wy] = toWorld(q.x, q.y, tg.place, tg.spinAngle);
    if (Math.abs(wx - v.cx) > v.hw - 0.12 || Math.abs(wy - v.cy) > v.hh - 0.12) break;
    ok = d;
  }
  return ok - d0;
}
```

`coilSide`: the coil's centre is `J + n * Rc` with `J = limbAt(k, d0 + D)` and `n` the limb's
normal; take the side (`+n` or `-n`) whose centre is nearer the view centre, so a coil never hangs
outside the picture.

`CommitTarget` gains `view: { cx, cy, hw, hh }`. `targetOf` in `main.ts` fills it from `lastView`
(`hw = W / 2 / s`, `hh = H / 2 / s`, `cx`, `cy`), or from `scene.centerX/Y` and `viewRadius` for
both half sizes when there is no view yet.

Ring fraction to piece: `u` is as today (0 at the cut, 1 at the vine's leading tip). Piece
`m = min(K - 1, floor(u * K))`, position in the piece `v = u * K - m`. Also cut the stroke
between two pieces: in the constructor's "no stroke across the cut" loop, add "or the two nodes
are in different pieces" (do it at draw time, since K is known only then: skip a runner segment
whose ends have different `m`).

Pose of a point of piece `pc` at `v` (this is today's `point(u)` with three substitutions:
`S -> pc.L`, `b0` term `-> pc.d0 + D`, `spineAt -> limbAt(pc.k, ..)`):

```ts
const sigma = smoothstep(clamp((tau - tUnf - pc.delay) / (T.unfurl - 0.06 * (K - 1))));
const baseAt = (v: number) => {
  const pe = after >= 0 ? 1 : clamp(plungeE - (0.02 / T.plunge) * v);
  return pc.d0 + (D + drawBack) * (1 - easeInCubic(pe));          // drawBack = back * easeOutQuad((tau - tDraw) / T.draw)
};
const point = (v: number) => {
  if (v <= sigma || sigma >= 0.999) {
    const d = baseAt(v) + pc.L * v, sp = plant.limbAt(pc.k, d), n = normal(sp, pc.side);
    return { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, nx: -n.x, ny: -n.y, flex: d * sigma, w: sp.w };
  }
  const dJ = baseAt(sigma) + pc.L * sigma, sp = plant.limbAt(pc.k, dJ), n = normal(sp, pc.side);
  const q = Math.sqrt(1 - sigma), r = pc.Rc * q, om = (TAU * q * (v - sigma)) / (1 - sigma);
  // ... exactly today's coil formula with r and om
};
```

Before the plunge the frond covers `[d0 + D + back, d0 + D + back + L]`, whose far end is
`d0 + fit`: the last visible point of the limb. After it: `[d0, d0 + L]`. It never leaves
`0..length`, so the straight extension in `spineAt` is never used.

Beat 1 (wind-up) is drawn through the same strand path as beat 2, as a blend from the ring pose
to the coil pose, so `drawRing` is only left for the hold before `t0` and the abort:

```ts
// ring pose of node i (world, then plant-local), spinning by rot as today
const e = easeInOutCubic(clamp((tau - T.release) / T.wind));
const phi = thetaOf(anchor) + rot;                                 // rot: today's rho1 * easeInQuad(..)
const rho = (1 + this.off[a]) * snap.R * (1 - 0.1 * e);
const sq = 1 - clamp(p.halo.squish, 0, 0.95) * (snap.idle ?? 1) * (1 - e);
const ring = toLocalSpin(snap.cx + rho * Math.cos(phi), snap.cy + rho * Math.sin(phi) * sq, tg);
const coil = point(v) evaluated with sigma = 0;                    // the piece's coil at its exit point
x = lerp(ring.x, coil.x, e); y = lerp(ring.y, coil.y, e);
```

`rho1` (the spin target) is chosen so that piece 0's middle faces limb `ks[0]`'s exit point, and
is at least `spinTurns` turns in the vine's direction, as today. Side shoots keep today's rigid
offsets, computed in each pose and blended the same way. `toLocalSpin` is `toLocal` with the spin
angle added (`toLocal` has no `extraAngle` parameter yet). The plain ring line: draw it with
`hooks.ring` only while `e < 0.3`, fading out; after that the core line of each piece (the
existing 72-segment loop, now 72 / K per piece) carries the picture.

Impact (`main.ts`, where `revealSpine()` is called):

```ts
for (const pc of c.framePieces) g.tree.revealLimb(pc.k, pc.d0 + pc.L);
g.reveal = Math.max(g.reveal, params.commit.stampReveal);
```

and soften the growth burst so the tree is seen growing out of the fronds:
`g.tree.boost = 1 + 3 * Math.exp(-(t - s.stampT) / 0.35)` (was `1 + 5 * exp(-x / 0.2)`; the same
total extra growth, spread over twice the time). The last `D + back` of each limb, and every
primary that got no frond, grow in from there. Strand fades stay (`runnerFade` 0.25 s,
`sproutFade` 0.15 s): the limbs are already drawn underneath at the same place.

Unchanged: `step()`, the onset sync, the shock ring, the burst, the abort path, `look()`.

---

## 3. Replacement branching (`growth.branchEachPhrase`)

### 3.1 Design in one paragraph

Do not add per-branch state to `Plant`. A "branch" is a **generation**: the same `Generations`
list that holds one tree per phrase today, except that in this mode each generation's `Plant`
builds only **one bough** (one primary limb with its forks and shoots) in one slice of the
take's territory. All boughs of a take come out of the same hub in the same layer, so together
they read as one tree. Retiring a bough does not fade it: it dries (colour), droops (rotation),
sheds its leaves (section 4), then detaches and falls.

When `branchEachPhrase` is on, `newTreeEachPhrase` is ignored (hide its row; say so in the tip).

### 3.2 Which bough a phrase grows

`M = clamp(branchesKept + 1, 3, 7)` slices. Phrase number `n` (a counter in `Generations`) takes
slice `ORDER[M][n % M]`:

```ts
const ORDER: Record<number, number[]> = {
  3: [1, 0, 2], 4: [1, 3, 0, 2], 5: [2, 0, 4, 1, 3], 6: [2, 5, 0, 3, 1, 4], 7: [3, 0, 5, 2, 6, 1, 4],
};
```

One more slice than boughs kept means: the slice a new phrase grows into was last used by the
bough that began to wither one whole phrase ago, so it is empty again. The orders start in the
middle (the planted bough, and the planting animation, point at the middle of the territory) and
then jump far, so neighbours are of different ages.

`Plant` gets `slice: [number, number] | null = null` (set by the creator before the first build,
like `mood`; add it to the `ensureBuilt` signature). In `buildGesture`:

```ts
// step 2: at least one tip per slice
const nTip = clamp(Math.round((sOut / gTip) * f.detail) + (mood.effort > 0.7 ? 1 : 0), this.slice ? Math.max(3, this.slice[1]) : 3, 20);
// step 3
if (this.slice) {
  const [j, M] = this.slice;
  const from = Math.min(tips.length - 1, Math.floor((j * tips.length) / M));
  const to = Math.max(from + 1, Math.floor(((j + 1) * tips.length) / M));
  if (tips.length) subdivide(hub, tips.slice(from, to), 0, wPrim, null, 0);
} else for (let k = 0; k < nPrim; k++) { /* as today */ }
```

Everything after that (shoots, reveal schedule normalised to this tree's own nodes, leaf ranks,
`limbPaths`) works unchanged on the smaller tree. A bough has 2 to 4 tips: a limb, one to three
forks, and its shoots.

### 3.3 Lifecycle (`generations.ts`)

```ts
export interface Generation<T> { /* ... */ bough: boolean; dry: number; fall: number }

regrow(p: Params) {
  const g = p.growth, keep = Math.max(1, Math.round(g.branchesKept));
  if (!g.branchEachPhrase) for (const x of this.gens) x.retired = true;
  else {
    const alive = this.gens.filter((x) => !x.retired);
    while (alive.length >= keep) alive.shift()!.retired = true;          // the oldest starts to wither
  }
  const M = clamp(keep + 1, 3, 7);
  const slice = g.branchEachPhrase ? ([ORDER[M][this.phrase++ % M], M] as [number, number]) : null;
  const seed = this.nextSeed++;
  this.gens.push({ tree: this.make(seed, slice), seed, reveal: 0, alpha: 1, retired: false, idle: 0, wither: 0,
                   bough: !!slice, dry: 0, fall: 0 });
  const cap = Math.max(MAX_GENERATIONS, keep + 3);
  while (this.gens.length > cap) this.gens.shift();
}
```

In `update`:

- New phrase starts a new bough only when the current one is at least half grown:
  `d.newPhrase && (g.branchEachPhrase ? cur.reveal > 0.5 : g.newTreeEachPhrase && cur.reveal > 0.05)`.
  A short phrase therefore keeps growing the bough it has instead of leaving a stub.
- A bough is a fraction of a tree, so it grows faster: multiply the reveal rate by
  `cur.bough ? clamp(M / 2, 1.5, 3) : 1`.
- Living boughs (`bough && !retired`) never fade. Their brightness target is 1 while the take is
  in a phrase (`d.voice || !d.phraseOver(p)`) and `restBrightness` otherwise, for all of them, not
  only the newest: they are one tree.
- Retired boughs skip the alpha fade and run the wither clock instead:

```ts
if (gen.bough && gen.retired) {
  const hurry = this.gens.filter((x) => x.bough && x.retired).length > 2 ? 3 : 1;   // phrases come faster than boughs fall
  if (gen.dry < 1) gen.dry = Math.min(1, gen.dry + (hurry * dt) / Math.max(0.05, g.branchWitherSeconds));
  else gen.fall = Math.min(1, gen.fall + (hurry * dt) / Math.max(0.05, g.branchFallSeconds));
  if (gen.fall >= 1) gen.alpha = 0;                                                  // removed by the filter below
  continue;
}
```

The `make` callback in `main.ts` gets the slice and sets `plant.slice = slice`. A take planted by
the commit animation starts with one bough (`regrow(params)` is already called there); the next
phrases add the others, so a new take's tree builds up over its first phrases.

### 3.4 Wither and fall, as drawn (`main.ts` `drawPlant`)

A bough with `dry > 0` is drawn in **its own layer**, so it can turn and drop on its own (the
motion and bend of a layer are shared by everything in it). `drawPlant` takes the layer as an
argument; inside its loop over generations:

```ts
let L = slotLayer, a = alpha * g.alpha, inks = slotInks, ang = angle, ox = pl.ox, oy = pl.oy;
if (g.bough && g.dry > 0 && layer < MAX_LAYERS - 4) {                 // keep 4 for halos and the planting
  L = layer++;
  const path = g.tree.limbPaths[0];
  const [px, py] = toWorld(...xy(g.tree.limbAt(0, path.clear)), pl, spinA);    // pivot: where it leaves the avatar
  const [tx, ty] = toWorld(...xy(g.tree.limbAt(0, path.length)), pl, spinA);   // its tip
  const toDown = wrapPi(-Math.PI / 2 - Math.atan2(ty - py, tx - px));          // turn that would hang it straight down
  const e = g.dry * g.dry;                                                      // slow start
  const delta = Math.sign(toDown) * Math.min(Math.abs(toDown), params.growth.branchDroopDeg * deg) * (0.85 * e + 0.15 * g.fall);
  const c = Math.cos(delta), s2 = Math.sin(delta);
  const fs = g.fall * params.growth.branchFallSeconds;                          // seconds falling
  ox = px + c * (pl.ox - px) - s2 * (pl.oy - py) + 0.06 * Math.sign(tx - px) * g.fall;
  oy = py + s2 * (pl.ox - px) + c * (pl.oy - py) - 0.5 * 1.8 * fs * fs;         // gravity 1.8 units / s²
  ang = angle + delta;
  layerU.set(L, ox, oy, ang, pl.scale, s.motion);
  a *= 1 - smooth(g.fall);
  inks = inksFor(L, take, k, s.drive, false);
  const dryRgb = hexToRgb(params.look.dryColour);
  for (const ink of [inks.stroke, inks.leaf, inks.accent]) {                    // dry colour through the ink's tint slot
    ink.tint = mix(ink.tint, dryRgb, g.dry);
    ink.tintK = lerp(ink.tintK, 0.75, g.dry);
  }
}
```

Rotating a layer by `delta` about a world point P is: new origin `P + R(delta)(O - P)`, new angle
`angle + delta` (from `toWorld` in `layout.ts`). `localDown` for the falling leaves uses `ang`.
If no layer is free (16 takes all dropping a bough at once) the bough stays in the slot's layer
and only dries and fades.

Leaves: pass `dry: g.dry` in the extras of `decorateTree`; a leaf's `has` becomes
`has && !(dry > 0.1 + 0.5 * h0)`, so between 10 % and 60 % of the wither time the leaves let go one
by one through the shed pool of section 4, and it is a bare, dry bough that drops. Blossoms on a
drying bough stay closed.

### 3.5 Budget over a long song

- Living boughs per take: at most `branchesKept` (1 to 6). Withering or falling at once: 2 in
  normal use, and never more than 3 for longer than a third of the fall time (the `hurry` rule).
  The list is capped at `branchesKept + 3` generations.
- Nodes: each bough is built from 1 / M of the tips, so a take's living boughs together are about
  `branchesKept / M` (75 % at the default) of one full tree. `plants.maxNodes` still caps each.
- One `Plant` is built per phrase, as with "new tree each phrase" today, but about M times
  smaller. Old ones are dropped from the list and collected.
- Extra layers: one per withering bough, only while it withers (default 3.9 s).
- Nothing counts up with song length except the phrase counter and the seed.

---

## 4. Tip decorations ungrowing

### 4.1 Cause

It is not a bug in the leaf code; it is what withering does, seen at the tips.

1. `Generations.update`: with `growth.witherOnPause` (default on) `cur.wither` rises after
   0.12 s of silence; with `witherOnPitchDip` a dip adds 0.6.
2. `Plant.computeReveal`: every node within `wither * witherDepth` of a tip has its `vis`
   **retracted** from the tip inward (`this.vis[i] -= retract / seg`). `life` and `leafLife` are
   filled with 1 every frame and never anything else, so there is no fading at all; retraction is
   the only wither.
3. `decorateTree`, take-plant path: a leaf's size is `... * pop * pres`, where
   `pop = unfurl(vis[i])` and `pres` comes from `presence(i, has)`, and `has` needs
   `allowed = vis[i] >= 0.999`. The first frame a twig starts to retract, `allowed` turns false and
   the leaf shrinks to nothing in place over about 0.2 s (and by `pop` as well). That is the leaf
   "ungrowing".
4. Blossoms have no easing at all: they need the same `allowed`, so a blossom on a retracting
   twig disappears in one frame; and their size is `* st.bloom`, which closes over 0.7 s after a
   held note ends (`Drive.bloom`), so at the end of a note every blossom shrinks back into its tip.
5. A side effect that makes it look busier: as the end of a twig retreats, each node it passes
   becomes the "visible tip" (`tipScratch === 1`), is given a leaf, and loses it a few frames
   later. A small leaf flickers along the retracting twig.
6. Unrelated but visible at the phrase end: `main.ts` passes `g.retired ? 0 : g.wither`, so the
   withered twigs of a tree that was just replaced **grow back** while it fades. Pass `g.wither`
   for retired trees too.

### 4.2 `growth.shed` (default `true`)

"Leaves and blossoms let go and fall instead of shrinking back." Reactivity kind; panel folder
"Pauses: withering", first row. With it on:

- A leaf that is there (`leafState > 0.5`) and stops being wanted is not eased out: it detaches
  at full size and falls. Its `leafState` is set to 0.
- A blossom stays at the size it reached; when the bloom closes or its twig retracts, it
  detaches and falls. A bud is left (section 5).
- No new leaves are handed to retreating twig ends while anything in the tree is still
  retracting (cause 5). They get their end leaf when the retraction has stopped.

The twigs still retract; only the decorations change. With it off, today's behaviour.

### 4.3 Implementation

New small file `viewer/src/shed.ts`: a fixed pool per `Plant` (`plant.shed = new ShedPool()`),
because the particles live in the plant's local frame and should fade and die with it.

```ts
const MAX = 256, N = 20;          // floats per particle
export class ShedPool {
  private d = new Float32Array(MAX * N);
  private head = 0;
  count = 0;
  add(now: number, x: number, y: number, angle: number, size: number, shape: number, c: number[], flex: number,
      h: number, glowMul: number, frame: number[] | null, alpha: number) { /* write at head, head = (head + 1) % MAX */ }
  /** Draw every living particle. down: world down in the layer's frame (DecoStyle.downX / downY). */
  draw(out: Instances, st: DecoStyle, now: number, dry: RGB) {
    for (each particle q) {
      const age = now - q.t0, life = 1.1 + 0.6 * q.h;
      if (age >= life) continue;
      const blossom = q.shape === 5;
      const vT = blossom ? 0.35 : 0.55, k = 3;                       // terminal speed (world units / s), how fast it is reached
      const fallD = vT * (age - (1 - Math.exp(-k * age)) / k);       // closed form: any frame rate places it alike
      const sway = 0.05 * Math.sin(age * (5 + 3 * q.h) + q.h * 6.28) * Math.min(1, age * 2);
      const x = q.x + st.downX * fallD - st.downY * sway;            // (-downY, downX) is sideways
      const y = q.y + st.downY * fallD + st.downX * sway;
      const ang = q.angle + (q.h - 0.5) * 6 * age + 0.6 * Math.sin(age * 4 + q.h * 9);
      const u = age / life, a = q.alpha * st.alpha * (u < 0.5 ? 1 : 1 - smooth((u - 0.5) * 2));
      const m = 0.4 * Math.min(1, age / 0.8);                        // turns toward look.dryColour as it falls
      out.sprite(x, y, ang, q.size, q.shape, q.flex, q.h, lerp(q.r, dry[0], m), lerp(q.g, dry[1], m), lerp(q.b, dry[2], m),
                 a, st.glow * q.glowMul, st.layer, q.f0, q.f1, q.f2, q.f3, q.f4);
    }
  }
}
```

The particle keeps the node's `flex` and bend frame and passes them on every frame. That matters:
sway and bend are applied on the GPU, so only with the same values does the leaf start exactly
where it hung (at the tips the sway is up to 0.2 units); it then keeps drifting with its branch's
wind, which looks right. The existing whole-plant fall for deleted takes (`Placer.put` with
`st.fall`) does the same.

`deco.ts`:

- `Placer` gets `drop: ShedPool | null` and `now`. In `put`, after position, angle, size and
  alpha are final: `if (this.drop) { this.drop.add(...); this.drop = null; return; }`.
- `TreeExtras` gets `shed?: ShedPool`, `now?: number`, `bloomState?: Float32Array`,
  `retracting?: boolean`, `dry?: number`. `Plant` gets `bloomState` (allocated in `finish`, like
  `leafState`) and `retracting` (set false at the top of `computeReveal`, true in the retract loop
  whenever a `vis` is lowered).
- `presence`:

```ts
const shedOn = p.growth.shed && !!extras.shed && st.fall <= 0;
const presence = (i: number, want: boolean) => {
  if (!ls) return want ? 1 : 0;
  if (shedOn && !want && ls[i] > 0.5) {                 // let go: drawn by the pool from now on
    const v = ls[i]; ls[i] = 0;
    place.drop = extras.shed!;                           // (and underPlace.drop for an under-leaf)
    return v * v * (3 - 2 * v);
  }
  ls[i] += ((want ? 1 : 0) - ls[i]) * ease;
  const v = ls[i];
  return v < 0.003 ? 0 : v * v * (3 - 2 * v);
};
```

  and in the leaf branch use `pop = 1` for a leaf that is being dropped (its twig has only just
  started to retract).
- Visible-tip rule (cause 5):
  `visTip = allowed && (tipScratch[i] === 2 || (tipScratch[i] === 1 && (terminal || !extras.retracting)))`.
- Blossoms, per site node, with `bs = extras.bloomState`:

```ts
const want = site && allowed && !(extras.dry! > 0) ? st.bloom : 0;       // 0..1
let b = bs[i];                                    // > 0: open amount shown; -1: petals fell, wait for the bloom to close
if (b < 0) { if (st.bloom < 0.02) b = 0; }
else if (want >= b) b = want;                     // opening follows the bloom
else if (!shedOn || b <= 0.3) b = want;           // old behaviour, and half-open ones just close
else if (want < b * (0.35 + 0.6 * h3)) { dropBlossom(b); b = -1; }       // each lets go at its own moment of the 0.7 s close
bs[i] = b;                                        // between: held at the size it reached
```

  The `0.35 + 0.6 * h3` threshold spreads the petals over the closing time instead of dropping
  all of them in one frame.
- At the end of `decorateTree`: `extras.shed?.draw(out, st, extras.now!, dryRgb)`.

`main.ts` passes `shed: g.tree.shed, now: t, bloomState: g.tree.bloomState,
retracting: g.tree.retracting, dry: g.dry` in `drawPlant`.

Cost: at most 256 extra sprites per tree, in practice a few dozen for a second or two. When the
pool is full the oldest particle is overwritten.

The halo vine is rebuilt every frame and has no per-node state, so its blossoms still close by
shrinking. Fix later with a small map keyed by the vine's stable node ids.

---

## 5. Blossoms

### 5.1 What happens now

Every sprite is anchored at its base and drawn along its angle (`sprite.vert`: `uv.y` runs 0 at
the base to 1 at the tip). A tip leaf is put at the tip node at `dir + (h1 - 0.5) * 0.6`
(within 17° of the twig's direction), about 0.10 long. A blossom is put at the **same node**, at
exactly `dir`, about 0.135 long. So the flower lies on top of the tip leaf, pointing the same way.
Tip nodes always have a leaf (terminals are ranked first, and `visTip` gives one regardless of
density).

### 5.2 New placement

| | Leaves | Blossoms |
| --- | --- | --- |
| Where | spaced nodes along the twig, and twig ends | only real twig ends (`terminal`), and only those chosen as blossom sites |
| Shared nodes | | none: a blossom site carries no leaf, and neither does the node before it |
| Angle | along the twig (ends), or 30° to 75° to one side | turned from the twig toward the sky by up to 50°, plus a small twist |
| Closed | | a bud (`look.buds` of the open size), in a mix of leaf and blossom colour |
| Draw order | first | after the leaves of the same node range (as today), so a flower near foliage is in front of it |

Because the site has no leaf, the flower extends from the bare twig end into the free space
beyond it (shoots stop at claimed space with `plants.clearance`, limbs end on the outline). The
nearest leaves are at least one leaf spacing away along the twig and point sideways.

```ts
// pre-pass (next to tipScratch, take plants): 1 = blossom site, 2 = the node before one
const isSite = (i: number) => sk.children[i] === 0 && hash1(i * 9.77 + st.seed * 4.4) < 0.35 * L.blossoms;   // the same h3 as today
bloomSite.fill(0, 0, sk.n);
for (let i = 1; i < sk.n; i++) if (isSite(i)) { bloomSite[i] = 1; if (!bloomSite[sk.parent[i]]) bloomSite[sk.parent[i]] = 2; }

// leaf: no leaf on either
const has = allowed && !bloomSite[i] && (rank[i] <= dens || (visTip && dens > 0.1));

// blossom
if (bloomSite[i] === 1 && allowed) {
  const up = Math.atan2(-st.downY, -st.downX);                        // the sky, in the layer's frame
  const ang = dir + clamp(wrapPi(up - dir), -0.9, 0.9) * 0.6 + (h2 - 0.5) * 0.5;
  const open = /* b from section 4.3, or st.bloom when shed is off */;
  const s = size * 0.075 * pop * (0.8 + 0.4 * h2) * Math.max(open, L.buds);
  const c = col(st.accent, PETAL, flex * st.sScale, h3, 1, st.intensity * lerp(0.8, 1.1, open));
  if (open < L.buds) mixToward(c, leafColourHere, 0.5);               // a closed bud is greener
  place.put(x, y, ang, s, Shape.Blossom, c, flex, h3, lerp(0.6, 1.4, open));
}
```

Blossoms no longer appear on retreating twig ends (`visTip`), only on real ends.

The same rule in the other two paths:

- Halo and non-ranked path (`switch (st.theme) case 'leaves'`): `const site = terminal && h3 <
  0.35 * L.blossoms;` the leaf condition gets `&& !site`; the blossom uses the angle above.
- User themes: a part with `place: 'tips'` defines the sites; a `spaced` part of the same theme
  skips them; `opens: 'bloom'` parts get the bud, `opens: 'always'` parts are simply full size.

Optional refinement, not needed for a first version: choose the sites at build time in
`plant.ts` step 9 with the same blue-noise pass as the leaves (a `bloomRank` per terminal, placed
first with a spacing of `3 * L0`), which also guarantees a distance between two blossoms.

---

## 6. Presets, themes and tap settings

### 6.1 Who owns what

| | Answers the question | Holds | Scope | Stored |
| --- | --- | --- | --- | --- |
| **Rig** (Setup) | How does it fit my avatar and me? | framing, halo position, squish, tilt, hub, keep-out, my take colours, performance | everything, always | Sprout.exe settings, synced |
| **Theme** | What is this plant made of? | its parts: shape or picture, where they sit, size, and their **natural colours** (branch too) | one track, or the look's default | `themes/<id>.json` next to Sprout.exe |
| **Look** (visual preset) | How is the whole scene styled? | tree and halo shape, glow, the four colour roles (where colour comes from and how it moves), the default theme and amount, the palette choice | all tracks | preset store |
| **Reaction** (reactivity preset) | How does it answer the voice? | timing, withering, shedding, branch-per-phrase, blossoms on held notes, motion, planting | all tracks | preset store |
| **Tap** | What is different about this one track? | role, theme, amount, colour: each **Auto** until changed | one track | the DAW project |

Order of precedence for a track: tap override, else the Look, with the theme supplying the
natural colours whenever a colour role says "Theme colour".

### 6.2 Should themes carry colours and gradients?

Yes, but only their **natural** colouring, and through the switch that already exists.

- Each part already has `natural` (one colour) and the editor shows it ("natural colour"); it is
  used when the role's source is "Theme colour". What is missing is a gradient and the branches.
- `ThemePart.natural` may be a colour (`#52c757`) or a gradient string (`ok;0:1f6b2e,...`). In the
  theme editor the row becomes the existing `GradientEditor` (one stop = one colour, so nothing is
  lost), plus `move?: 'Still' | 'Root→tip' | 'Flow' | 'Sparkle' | 'Sing it'` (the five
  `MOVEMENTS` from `panel-layout.ts`, default Sparkle: each leaf its own shade).
- `ThemeDef.branch?: { natural: string; move?: string }`. Today "Theme colour" on branches
  silently gives the take colour, because `pushTree` passes no natural colour to `inkAt`. Give
  the built-ins one too: Leaves `#7a5a3a`, Thorns `#5a3b46`, Wreath `#5b4630`, Branches `#cfd8e6`.
- Themes do **not** carry the take mix, the look tint, glow, shapes or reactions. Those stay in
  the Look, and still apply on top of a theme's natural colours.

In `deco.ts` (generic part loop only): if the part's natural is a gradient,

```ts
const mv = MOVEMENTS_BY_NAME[part.move ?? 'Sparkle'];
const u = mv.speed * st.time + mv.along * s + mv.scatter * (h - 0.5) + (mv.voice === 'pitch' ? mv.voiceAmount * st.pitch : 0);
nat = sampleLut(bakeGradient(part.natural, take).lut, u);    // then the existing col(ink, nat, ...): take mix and tint still apply
```

(`DecoStyle` gains `time` and `pitch`.) This gives per-track colouring for free: a track on a
"sakura" theme and a track on an "autumn" theme each bring their own gradients under one Look, as
long as the Look's leaf and accent roles say "Theme colour" (the default).

### 6.3 Auto for every tap setting

Today the taps are not overrides: Theme defaults to "Leaves", Colour to "Track colour", and
picking a Look **writes** its theme and amount into every tap (`presetApplied` → `tapLook` →
`requestLook`), which destroys per-track choices. Change:

| Tap setting | Auto means | Default | Override |
| --- | --- | --- | --- |
| Role | follows the track's record arm (exists) | Auto | Live voice / Take playback / Instrument |
| Theme | the Look's theme (`look.theme`) | Auto (today's "Viewer default", renamed) | a built-in or one of your themes |
| Amount | the Look's leaf amount (`look.density`) | Auto | the slider |
| Colour | the viewer picks: its palette (section 7), or the DAW track colour if Setup → "use DAW track colours" is on | Auto (today's "Viewer palette", renamed) | Track colour / My colour / My gradient |

- Picking a Look no longer sends `tapLook`. Taps on Auto follow at once; taps with an override
  keep it. Remove the `presetApplied` call in `ui.ts` `choose()`.
- `look.themeFrom` keeps working but changes its wording: "Per-track settings: used / ignored
  (this look for every track)". Move it to Advanced.
- A button in Look → Theme & leaves: "Set every tap to Auto". It sends
  `{"type":"tapLook","theme":"default","density":-1,"colour":"auto"}`; `applyTapLook` in
  `app/main.cpp` maps `"default"` to `ThemeChoice::ViewerDefault` (today it returns for that name)
  and passes the negative density through; the tap sets theme = Auto, amount = Auto, colour = Auto.
  This is also the way out for existing projects, whose taps all hold an explicit "Leaves".
- Old projects are not changed silently: in `setStateInformation`, if the saved state has no
  `densityAuto`, set it to false, so a saved amount stays an override.

### 6.4 The tap window

```
Sprout Tap
Role     [ Auto (follows record arm)        v ]
Theme    [ Auto (viewer's look)             v ]  (↺)      one box: Auto, Leaves, Thorns, Christmas wreath,
Amount   [x] Auto   [=====o-------] 0.55         (↺)      Branches only, ---, then your themes
Colour   [ Auto (viewer picks)              v ]  (↺)
         [■] pick...                                       only for "My colour"
         [▓▓▓▓▒▒▒▒░░░░]  [ Rainbow v ] [Paste] [Copy]      only for "My gradient"
Connected  |  Track: Lead vox
```

- **One Theme box.** The `theme` choice parameter stays (hosts store it), but the box is filled by
  hand, not attached: Auto and the four built-ins set the parameter and clear `customTheme`; a user
  theme calls `setCustomTheme(id)`. The separate "Custom" row goes away.
- **Amount**: a new bool parameter `densityAuto` (`ParameterID { "densityAuto", 2 }`, default
  true) next to the slider; the slider is dimmed while it is on, and moving the slider turns it
  off.
- **Colour** choice, in this order so saved projects keep their meaning:
  `{ "Track colour", "Auto (viewer picks)", "My colour", "My gradient" }`, default index 1.
- **My colour**: a swatch button that opens JUCE's `juce::ColourSelector` in a
  `juce::CallOutBox`. Stored as the state property `inkColour` (`"#rrggbb"`), like `customTheme`.
- **My gradient**: a combo with the built-in gradient names (Rainbow, Pastel rainbow, Natural
  green, Autumn, Fire, Ice, Sakura, Sunset, Neon), each mapped to the same string as in
  `gradient.ts`, plus "Pasted". A 20 px preview bar (a small `Component` that parses the string and
  paints a `juce::ColourGradient`; linear is close enough for a preview). **Paste** takes a
  gradient string from the clipboard if it matches `^(rgb|ok|step)~?;`, **Copy** puts it there. The
  full stop editor already exists in the viewer (Look → Colours → any gradient → Copy), so the tap
  does not need its own in the first version. Stored as the state property `inkGradient`.
- (↺) sets that row back to Auto. A row on Auto is drawn dim, so overrides are visible at a
  glance.

### 6.5 What an own colour or gradient means in the viewer

- **My colour**: the track's take colour is that colour. Everything else as usual.
- **My gradient**: for this track, the branches (and the halo while it is live) use that gradient
  with the Look's movers (`colBranch.along`, `speed`, `voice`, `voiceAmount`), take mix 0. The
  track's take colour (for the leaves' take mix, glow balance, planting effects, `t` stops)
  becomes the gradient's middle colour.

```ts
// main.ts
const takeColour = (id: string, f?: LayerFeatures) => {
  if (f?.ink?.startsWith('#')) return f.ink;
  if (f?.ink) return midHex(bakeGradient(f.ink, [1, 1, 1]).lut);
  const track = f?.colourMode === 'track' || (f?.colourMode !== 'palette' && params.source.useTrackColours);
  if (track && f?.colour) return f.colour;
  return paletteColour(id);                                   // section 7
};
// colour.ts: setInk(ink, p, role, take, k, t, d, override?: string)
if (override && (role === 'colBranch' || role === 'colHalo')) {
  const b = bakeGradient(override, take);
  ink.lut = b.lut; ink.loop = b.loop; ink.natural = false; ink.takeMix = 0;
  ink.u0 = r.speed * t + r.voiceAmount * voiceOf(d, r.voice); ink.along = r.along || 1; ink.scatter = 0;
}
```

`Slot` and `LiveHalo` keep `ink?: string` next to `colour`. This also fixes a small mismatch:
the tip of "use DAW track colours" says it applies "for taps set to Viewer palette too", but the
code never did (`f?.trackColour ?? ...` is always a boolean from the tap).

### 6.6 How it travels (bus v5)

The gradient string can be 180 characters (12 stops); `reserved[8]` has 28 free bytes. Add one
field and bump the version. The string is passed through untouched, exactly like `customTheme`,
so there is no packing code on either side.

```cpp
// SproutBus.h
constexpr uint32_t kVersion      = 5;                       // 5: per-track ink, Auto amount
constexpr wchar_t  kMappingName[] = L"Local\\SproutBus_v5";
constexpr uint32_t kInkLength    = 192;

struct SlotInfo {
    ...
    uint32_t theme       = 4;      // ThemeChoice; ViewerDefault = Auto
    float    density     = -1.0f;  // < 0 = Auto (the viewer's amount)
    uint32_t colourMode  = 1;      // 0 track colour, 1 Auto (viewer picks), 2 own colour, 3 own gradient
    uint32_t reserved[8] {};
    char     customTheme[kThemeIdLength] {};
    char     ink[kInkLength] {};   // "#rrggbb" (mode 2) or a gradient string (mode 3), see viewer/src/gradient.ts
};
constexpr uint32_t kLookResetAll = 0x100;                   // lookTheme flag: set theme, amount and colour to Auto
```

- Tap: cache `ink` under `trackLock` next to `customTheme` and `memcpy` it into `info` in
  `processBlock`; `info.density = densityAuto ? -1 : density`.
- App (`featureJson`): replace `"trackColour":bool` by
  `"colourMode":"track"|"auto"|"ink"`, add `"ink":"..."` (with `appendJsonString`) when the mode is
  2 or 3, and write the density unclamped when it is negative.
- Viewer (`live.ts`): `theme: tap.customTheme || (tap.theme !== 'default' ? tap.theme : undefined)`
  as today; `density: tap.density >= 0 ? tap.density : undefined` (no longer tied to the theme);
  `colourMode`, `ink` copied. `themeOf` in `main.ts` then falls back per value:
  `theme: own?.theme ?? look.theme`, `density: f?.density ?? look.density`.
- v4 taps cannot open the v5 mapping (as with every bump so far): rebuild and copy
  `Sprout Tap.vst3` to the test folder together with Sprout.exe.

If the bump is unwanted: a colour alone fits `reserved[1]` (ARGB), and a gradient of up to six
stops can be packed into `reserved[2..7]` (one byte of flags and count, then position, r, g, b per
stop). That costs pack and unpack code in C++ and TypeScript and caps the stops at six; the string
is simpler.

---

## 7. Take colours

### 7.1 Where the colours come from today

From `colours.take1..7` and `colours.live` in `params.ts`. They are rig keys: no preset holds or
changes them; a Look can only lean everything toward `look.tint` or stop using the take colour
through the colour roles. So "preset default colours" are simply the seven defaults in
`params.ts`.

Two weaknesses: a Look cannot bring colours that suit it, and the colour is looked up by the
take's **position** (`takeColour(k)`, redone every frame), so when a take is deleted every later
take changes colour.

### 7.2 Decision

- Not a theme setting. A theme belongs to one track and says what its plant is made of; a
  palette exists to tell the tracks apart and to make them sit well together, which is a property
  of the whole scene.
- "My take colours" stay rig and stay the default.
- A **Look** may bring its own list and say how to pick from it. `colours.lock` (rig, "always use
  my take colours") lets the artist overrule that for every Look.

```ts
// params.ts (visual)
palette: {
  /** mine: your own take colours (Setup). list: this look's colours below. */
  from: 'mine' as 'mine' | 'list',
  /** The look's colours: the stops of this gradient, in order. */
  list: 'step;0:b5e61d,0.143:3d4fd6,0.286:00dd88,0.429:ff7ac8,0.571:ffb347,0.714:a77bff,0.857:4fd1ff',
  /** order: first free colour. random: a free colour chosen by the take's id. spread: any gradient, sampled at well-spaced positions. */
  pick: 'order' as 'order' | 'random' | 'spread',
  /** Another number gives another random choice. */
  seed: 1,
},
```

The list is a gradient string edited with the existing gradient widget (consult 5: "a palette is a
step gradient"). With `order` and `random` only the stops' colours count. With `spread` the whole
gradient counts, so a smooth one gives any number of distinct colours.

### 7.3 Stable assignment per take id

```ts
// main.ts
const assigned = new Map<string, number>();              // take or halo id -> number
let ordinal = 0;
const strHash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

function paletteColour(id: string): string {
  const P = params.palette, mine = P.from === 'mine' || params.colours.lock;
  const list = mine ? MINE() /* take1..7 */ : parseGradient(P.list).stops.map((s) => '#' + s.col);
  let n = assigned.get(id);
  if (n === undefined) {
    if (!mine && P.pick === 'spread') n = ordinal++;
    else {
      const used = new Set(assigned.values());
      const free = list.map((_, i) => i).filter((i) => !used.has(i));
      const pool = free.length ? free : list.map((_, i) => i);
      n = P.pick === 'random' && !mine ? pool[Math.floor(hash1(strHash(id) * 0.731 + P.seed * 17.3) * pool.length)] : pool[0];
    }
    assigned.set(id, n);
  }
  if (!mine && P.pick === 'spread') return lutHex(bakeGradient(P.list, [1, 1, 1]).lut, (n * 0.618034) % 1);
  return list[n % list.length];
}
```

- An id gets its number the first time it is seen and keeps it; the entry is removed when the id
  is in none of `halos`, `slots`, `dying`, `commits` (one pass per `simulate`). Deleting a take no
  longer recolours the others, and a colour is not reused while it is on screen (until there are
  more takes than colours).
- `random` is seeded by the id (`slot-5`, `fake-take-3`) and `palette.seed`, so the same project
  gets the same colours every session. Changing the pick mode, the seed or `from` clears the map.
- With a Look palette (`from: 'list'`) the **live halo uses the same function with its own id**.
  In live mode a recording keeps its id when it becomes a take, so the halo already has the
  colour its tree will have, and the planting animation no longer changes colour on the way. With
  "mine" the halo keeps `colours.live` as today.
- Pass this number, not `slots.indexOf(s)`, as `k` to `inksFor` / `setInk`: `perTake` shifts then
  also stay put when a take is deleted.
- Tap overrides (section 6) come first: Track colour, My colour, My gradient.

Panel: in Look → Colours, the sub-folder "My take colours (kept across presets)" gets
`colours.lock` as its first row, and a new sub-folder "Take colours of this look" holds
`palette.from`, `palette.list`, `palette.pick`, `palette.seed` (the last three hidden while
`from` is `mine`).

---

## 8. Panel and text additions

`panel-layout.ts`:

- `phrases` folder keys: add `growth.branchEachPhrase` after `growth.newTreeEachPhrase`;
  advanced: `growth.branchesKept`, `growth.branchWitherSeconds`, `growth.branchDroopDeg`,
  `growth.branchFallSeconds`.
- `pauses` folder keys: `growth.shed` first.
- `held` folder: nothing new (buds are a Look setting).
- `theme` folder keys: add `look.buds`, `look.dryColour`.
- `commit` folder keys: add `commit.limbs`.
- `colours` folder: `catchSections` add `'palette'`; sub-folders as in 7.3.
- `test` folder advanced: `fake.autoCommit`.

Labels: `growth.shed` "leaves fall instead of shrinking", `growth.branchEachPhrase` "new branch
each phrase", `growth.branchesKept` "branches kept", `growth.branchWitherSeconds` "old branch
dries (s)", `growth.branchDroopDeg` "old branch droops (deg)", `growth.branchFallSeconds` "old
branch falls (s)", `commit.limbs` "halo divides into", `look.buds` "bud size", `look.dryColour`
"withered colour", `palette.from` "take colours from", `palette.list` "this look's colours",
`palette.pick` "pick", `palette.seed` "shuffle", `colours.lock` "always use my take colours",
`fake.autoCommit` "plant a take every (s)".

Tips worth writing in full: `growth.shed` ("When a twig withers back, or a blossom closes after a
held note, its leaves and petals let go and fall instead of shrinking back into the twig."),
`growth.branchEachPhrase` ("Each phrase grows one new branch on the take's tree; when there are
more than 'branches kept', the oldest dries, droops, drops its leaves and falls. Replaces 'new
tree each phrase' while on."), `commit.limbs` ("The halo breaks into this many pieces, and each
unrolls along one main limb of the new tree. 1 = a single frond.").

Fix while there: `LABELS['look.blossoms']` still says "(leaves theme)", `TIPS['colours.mode']`
and `TIPS['colours.rainbowSpeed']` describe keys that no longer exist, and `FOLDER_HINTS.leaves`
says presets set the theme in every tap (no longer true after 6.3).

---

## 9. Implementation order

Each step leaves the app working. Steps 1 to 6 are the day; 7 to 9 are a second sitting.

1. **Shedding (item 4).** `shed.ts`; `Plant.shed`, `bloomState`, `retracting`; `Placer.drop`;
   `presence`; the visible-tip rule; pass `g.wither` for retired trees; `growth.shed`. Test with
   Setup "Short phrases, long pauses" and Reaction "Falling leaves" values typed in by hand.
2. **Blossoms (item 5).** The `bloomSite` pre-pass, no leaf on sites, the sky-turned angle, buds
   (`look.buds`), the blossom state with shedding. Same rule in the halo path and the user-theme
   `tips` case. Test with Setup "Ballad".
3. **Planting animation (item 2).** `Plant.limbPaths`, `limbAt`, `revealLimb`; `view` in
   `CommitTarget`; pieces, `fit`, `coilSide`; `point()` with the three substitutions; the
   wind-up as a ring-to-coil blend; reveal the limbs at the impact; softer boost; `commit.limbs`.
   Add `fake.autoCommit` first so it can be watched hands-free. Check a narrow window and a wide
   one, one take (crown) and three (wedges).
4. **Branch per phrase (item 3).** `Plant.slice`; `Generations` (`regrow(p)`, `bough`, `dry`,
   `fall`, the half-grown rule, the faster reveal); the extra layer with droop and fall in
   `drawPlant`; dry tint; leaves shed by `dry`; the five `growth.branch*` keys and
   `look.dryColour`. Depends on steps 1 and 3 (`limbPaths`).
5. **Take colours (item 7).** `palette.*`, `colours.lock`, `paletteColour(id)` with the
   assignment map, the same number as `k` for the inks, the two panel sub-folders.
6. **Presets (item 1).** Changed defaults (`halo.squish`, `colHalo`); the three lists from
   section 1; labels, tips and folders from section 8; the dev-build check of 1.5. Go through every
   preset once with Setup "Six takes" and once with "Planting loop".
7. **Taps on Auto (item 6.3, 6.4 without colour).** Stop sending `tapLook` on preset pick; the
   "Set every tap to Auto" button and `"default"` in `applyTapLook`; one Theme box; `densityAuto`;
   new defaults; viewer falls back per value.
8. **Tap colour (item 6.4 to 6.6).** Bus v5 with `ink`; Colour choice with four entries; colour
   picker, gradient combo, preview bar, Paste and Copy; `colourMode` and `ink` in the feature JSON
   and `live.ts`; `takeColour` and the `setInk` override. Rebuild and copy `Sprout Tap.vst3`.
9. **Theme natural gradients (item 6.2).** `natural` as a gradient with `move` in the generic part
   loop, the gradient widget in the theme editor, `ThemeDef.branch` and natural branch colours for
   the built-ins.

Risky parts, in order: the ring-to-coil blend in step 3 (check that pieces do not cross: the
sort by world angle is what prevents it); the extra layers in step 4 when many takes shed a bough
at once (the fallback is "fade in place"); step 7 for existing DAW projects (taps holding an
explicit "Leaves" stay overrides until "Set every tap to Auto" is pressed).
