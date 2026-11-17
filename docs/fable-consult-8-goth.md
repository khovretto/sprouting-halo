# Design consult 8: a goth botanical look ("Black briar")

Written against commit a19215a (branch `part-a-gesture-trees`). Read: `docs/fable-consult-7-twist.md`,
`viewer/src/presets.ts`, `params.ts`, `themes.ts`, `deco.ts`, `colour.ts`, `shed.ts`, `panel-layout.ts`,
`shaders/sprite.frag`, `stroke.frag`, `composite.frag`, `render/renderer.ts` (uniforms), `main.ts`
(`themeOf`, `inksFor`, `pushTree`, `pushRing`, `styleOf`, `drawPlant`, halo colour), `growth/plant.ts`
(tone, leaf ranks), `growth/commit.ts` (burst shapes), `sources/live.ts`, `app/main.cpp`
(`applyTapLook`, `validThemeId`, `publishThemeList`, the theme names sent to the viewer),
`common/SproutBus.h` (`ThemeChoice`), `tap/SproutTapProcessor.cpp` (theme box). Nothing was run or
seen on screen: every number is a starting point reasoned from the code. No source file was changed.

The request: a second dark preset, next to "Dark & twisted" (which stays as it is): purely black
leaves, a plant with leaves and thorns at the same time, goth, not burgundy tentacles.

## Summary

| # | Question | Decision |
| --- | --- | --- |
| 1 | Leaves and thorns together | **A new built-in theme defined as data**: `briar`, "Briar (leaves & thorns)", three `ThemePart`s (leaf, thorn, a sparse rose on twig ends). It runs through the generic part loop. That loop needs four small fixes, because today two `spaced` parts land on the same nodes, on the same side (section 1.3). User themes get the same ability for free. |
| 2 | Tap protocol | Untouched. `ThemeChoice` 0..4 and the bus stay as they are. A tap on Auto follows the look and gets `briar`; the tap window shows "Auto (viewer's look)". Optional: Sprout.exe lists `briar` among the themes it publishes, so a tap can pick it by name (one block in `publishThemeList`, no bus change). |
| 3 | Pure black leaves | `colLeaf` as a gradient of two near-blacks with `takeMix` 0. **This is not enough today**: `inkAt` mixes up to 60 % of the take colour into single leaves even at `takeMix` 0 when `look.variety` is above 0. One-line fix in `colour.ts` (section 2.1). |
| 4 | Readable on dark | A cold, pale rim glow (`glow.tintFlat` 1, `tintAmount` 1, `inkMask` 1): black ink emits the glow colour and the glow lies round it, so every leaf is a backlit silhouette. Plus a new, optional hairline sheen on leaves (`look.leafSheen`), because the glow steps back where the canopy is dense (section 2.3). |
| 5 | Readable on light | The ink itself, plus `glow.shadow` at a moderate 0.35 for the pale thorns and the glow. |
| 6 | Preset | Visual **"Black briar"** (`blackbriar`), section 3. Reaction **"Nocturne"** (`nocturne`), section 4: black ink must stay opaque, and the stock reaction lets resting trees go 45 % see-through. |

Code changes beyond data, in order of need:

1. `themes.ts`: split "built-in" from "has its own code" (5 lines) and add the theme. Required.
2. `deco.ts`: generic loop, several `spaced` parts share the leaf slots; ring alternates the parts. Required.
3. `colour.ts`: `takeMix` 0 means none. Required for "purely black".
4. `sprite.frag`, `renderer.ts`, `params.ts`: leaf sheen. Recommended, optional.
5. `app/main.cpp`: list `briar` for the tap windows. Optional.

---

## 1. The theme

### 1.1 Options weighed

- **(a) A built-in theme as `ThemeDef` parts, through the generic loop.** Chosen. The look is data
  (parts, sizes, natural colours), the theme editor can show and duplicate it, and the fixes it
  needs make every user theme with two spaced parts work properly.
- (b) A thorn switch on the coded `leaves` theme (`look.thorns`). About the same amount of code and
  the leaves keep every nicety untouched, but it adds a setting that only one coded theme reads,
  thorns could not have their own colour role, and user themes gain nothing. Rejected.
- (c) Shipping `briar.json` in the themes folder. Works only with Sprout.exe running (not offline
  or in the dev page), can be deleted, and still needs fix 2. Rejected.

### 1.2 `themes.ts`

`isBuiltin` is used for three things: `customDef` (which code path draws it), the theme editor
(read only, "Duplicate to make your own"), and `uniqueId`. A data-defined built-in must be built-in
for the editor and not for `customDef`.

```ts
/** Built-in themes drawn by their own code in deco.ts; the other built-ins run through the part loop. */
const CODED_IDS = ['leaves', 'thorns', 'wreath', 'branches'];

export const BUILTIN_THEMES: ThemeDef[] = [
  // ... the four existing ones, unchanged ...
  {
    id: 'briar', name: 'Briar (leaves & thorns)', version: 1, branch: { natural: '#3b2b26' }, parts: [
      { place: 'spaced', shape: 'leaf', size: 1, amount: 1, role: 'leaf', natural: '#2f6b3a', flutter: 1 },
      { place: 'spaced', shape: 'thorn', size: 0.62, amount: 0.7, role: 'accent', natural: '#d6ccb8', glow: 0.6, flutter: 0, sizeFrom: 'effort' },
      { place: 'tips', shape: 'blossom', size: 0.9, amount: 0.5, role: 'accent', natural: 'ok;0:6b0a18,1:c2152e', move: 'Sparkle',
        glow: 1.2, opens: 'bloom', flutter: 0.4, pivot: [0.5, 0.5] },
    ],
  },
];
export const BUILTIN_IDS = BUILTIN_THEMES.map((t) => t.id);          // move below BUILTIN_THEMES
export const isBuiltin = (id: string) => BUILTIN_IDS.includes(id);
export const customDef = (id: string) => (CODED_IDS.includes(id) ? undefined : themeDef(id));
```

- `themeDef` looks in `custom` first. In `loadThemes`, skip a user file with a built-in id:
  `for (const d of got) if (d && !isBuiltin(d.id)) custom.set(d.id, d);`
- `branchNatural` already falls through to `themeDef(id)?.branch?.natural`: nothing to add to
  `BUILTIN_BRANCH`.
- `allThemes()` already starts with `BUILTIN_THEMES`, so the panel's theme list (`ui.ts` line 895)
  and the editor list show it with no change. `theme-editor.ts` line 197 names a new theme
  `'My theme ' + (allThemes().length - 3)`: make it `- BUILTIN_IDS.length + 1` (cosmetic).
- `refreshTextures` only walks `draft` and `custom`: fine, the theme has no textures.

Why these parts:

- Leaf: the plain leaf, natural dark green, so the theme is usable under any look.
- Thorn: size 0.62 gives `0.055 * 0.62 = 0.034`, the coded thorn's size. `sizeFrom: 'effort'` gives
  `0.6 + look.thornEffort * effort`, the coded formula. **Role `accent`**, so a look can paint the
  leaves with `colLeaf` and still give the thorns another colour. With `colAccent.source: 'theme'`
  each accent part keeps its own natural colour: bone thorns and red roses from one role.
- Rose: on twig ends only, `amount` 0.5 halves the site chance (`0.35 * look.blossoms * amount`,
  about one twig end in eight), opens on held notes like the leaves theme's blossoms. The blossom
  shader's pale yellow centre on a dark red flower reads as a small wild rose.

### 1.3 `deco.ts`: what the generic loop gives and where it falls short

For a `spaced` part on a take tree the generic loop already gives: blue-noise leaf ranks
(`rank[i] <= dens * amount`), a leaf on every visible twig end and at withered joints (`visTip`),
no leaf on or before a blossom site, leaves only on finished branches (`allowed`), unfurl instead
of the springy pop, tone in the brightness, the motion frame, and presence easing with shedding
(`presence()` sets `place.drop`, the pool draws the fall). Gaps:

| Gap | Effect with leaf + thorn | Fix |
| --- | --- | --- |
| G1. Every `spaced` part uses the same test (`rank[i] <= dens * amt`, or `h0 < dens * 0.45 * amt` on the vine) and the same `side`. | Each thorn sits on a leaf's node, on the same side, under the leaf. | The parts share the leaf slots: the first takes ranks up to its cut, the next the following window. A node has one owner. |
| G2. `presence()` runs only for the first spaced part (`spacedDone`). | Thorns pop in and out and never fall. | One `presence()` call per node, for the owner. |
| G3. No `extras.dry` test; blossoms on a drying bough stay open. | Old boughs (branch per phrase) keep all leaves until they fall. | Same test as the coded path. |
| G4. No early skip: every node of every tree walks the part list. | Cost only (4 parts x 3000 nodes x 6 takes). | Skip nodes that can carry nothing when the theme has only `spaced` and `tips` parts. |
| G5. `decorateRing` uses only the first `spaced`/`every` part. | The halo ring gets leaves and no thorns. | Alternate the parts round the ring. |
| G6. No under-leaves, no smaller inner leaves, no per-leaf brightness variety. | Invisible on black leaves. | Leave out; three lines if wanted later (below). |

Rank windows are a good fit: ranks are blue-noise levels, so the thorns take exactly the leaf slots
that the density leaves free. Thorns keep the same guaranteed spacing from the leaves and from each
other, and never share a node. At `density` 0.55 with amounts 1 and 0.7: leaves on ranks up to 0.55,
thorns on 0.55 to 0.935. The upper rank levels hold the most nodes (finer spacing), so thorns
outnumber leaves somewhat, which is right for a briar. At density 1 there are no free slots and so
no thorns: the preset stays at 0.55, and the tooltip of `look.density` should say so for this theme.

**In `decorateTree`, after `const custom = customDef(st.theme);`:**

```ts
// Spaced parts share the leaf slots: the first takes ranks up to its cut, each further one the next window.
const spaced = custom ? custom.parts.filter((x) => x.place === 'spaced') : [];
const cuts: number[] = [];
for (let k = 0, acc = 0; k < spaced.length; k++) cuts.push(Math.min(1, (acc += st.density * Math.max(0, spaced[k].amount))));
const sparse = !!custom && custom.parts.every((x) => x.place === 'spaced' || x.place === 'tips');
```

**Next to the `leafOnly` skip at the top of the node loop (G4):**

```ts
if (sparse && rank && rank[i] > 1 && tipScratch[i] === 0 && bloomSite[i] !== 1 && !(ls && ls[i] > 0.003)) continue;
```

**In the `if (custom)` block, replacing `let spacedDone = false;`:**

```ts
// Which spaced part owns this node (-1: none), and whether it is there now.
let owner = -1, pres = 0;
if (spaced.length) {
  const key = rank ? rank[i] : h0 / 0.45;                       // rank 2 = never a slot
  for (let k = 0; k < cuts.length; k++) if (key <= cuts[k]) { owner = k; break; }
  let has: boolean;
  if (rank) {
    const tip = visTip && dens > 0.1;
    // True twig ends, bare visible ends and leaves still fading out belong to the first part.
    if ((tip && (terminal || owner < 0)) || (owner < 0 && ls && ls[i] > 0.003)) owner = 0;
    has = owner >= 0 && allowed && !bloomSite[i] && (key <= cuts[cuts.length - 1] || tip)
      && !((extras.dry ?? 0) > 0.1 + 0.5 * h0);                  // G3
    pres = owner >= 0 ? presence(i, has) : 0;                    // G2: once per node
  } else {
    if (owner < 0 && terminal && dens > 0.15) owner = 0;
    pres = owner >= 0 && !bloomSite[i] ? 1 : 0;
  }
}
```

**`case 'spaced'` becomes:**

```ts
case 'spaced': {
  if (spaced[owner] !== part || pres <= 0) break;
  const ang = terminal ? dir + (h1 - 0.5) * 0.6 : dir + side * lerp(0.95, 0.5 + 0.8 * h2, variety);
  const sz = size * 0.055 * part.size * eff * lerp(1, 0.6 + 0.65 * h2, variety) * pop * pres;
  place.put(x, y, ang, sz, sid, colourFor(flex * st.sScale, h2, lerp(1, 0.4 + 1.2 * h2, variety), st.intensity * tone), flex, h0, gl);
  place.drop = null;                                             // see the note below
  if (underPlace) underPlace.drop = null;
  break;
}
```

**`case 'tips'` (G3):** pass `(extras.dry ?? 0) > 0 ? 0 : st.bloom` to `blossomOpen` instead of
`st.bloom`, as the coded `blossom()` does.

Edge cases checked:

- Blossom sites: `siteChance` already reads the theme's `tips` part; `bloomSite` 1 and 2 carry no
  spaced part, so a rose never sits on a leaf or a thorn. The sparse skip keeps site nodes
  (`bloomSite[i] !== 1`).
- Twig ends: a true terminal always gets the first part (a leaf), statically, so there is no
  thorn-to-leaf swap when a twig retracts. A thorn slot that becomes the visible end of a
  withering twig keeps its thorn: a twig ending in a spine, which is what blackthorn does.
- Presence and shedding: one `leafState` float per node is enough because a node has one owner.
  Thorns now ease in and out and fall with the leaves when a twig withers (the coded thorns theme
  does the same). `shed.ts` stores shape and pivot per particle: nothing to change.
- Changing `look.density` moves the window edges, so some thorns become leaves. They swap at the
  same presence value: a pop while a slider is dragged, never during a song.
- Vine and commit strands (no ranks): windows on the hash instead (`h0 / 0.45`), so leaf and thorn
  nodes are disjoint there too; the first part alone takes the terminals.
- Effort-grown thorns: `eff` multiplies the size each frame, as in the coded theme.
- Side note, existing behaviour: `presence()` arms `drop` on both placers but the coded leaf is put
  on only one of them, so the other placer's next leaf (another node) is handed to the shed pool
  for a frame: one extra leaf falls. Clearing both after the put (as above) avoids it; the same two
  lines fit after the coded leaf's put.

**`decorateRing` (G5).** Replace the single `ringPart` by all of them and alternate:

```ts
const ringParts = custom ? custom.parts.filter((x) => x.place === 'spaced' || x.place === 'every') : [];
if (custom && !ringParts.length) return;
const nR = Math.max(1, ringParts.length);
const spacing = (st.theme === 'wreath' ? 0.07 : st.theme === 'thorns' ? 0.2 : 0.3) / nR;
// in the loop:
const ringPart = ringParts[k % nR];
const alt = Math.floor(k / nR) % 2 ? 1 : -1;      // not k % 2: with two parts every thorn would point inward
```

The rest of the custom branch is unchanged (it already reads `ringPart`). With one part, `nR` is 1
and today's ring comes out bit for bit. With leaf and thorn: a leaf and a thorn every 0.3 rad,
pairs alternating outward and inward. On the braided ring this is the thorn crown.

**G6, only if wanted:** inside `case 'spaced'`, for `sid === Shape.Leaf` and
`underPlace && hash1(id * 7.7 + st.seed) < 0.4`, put the leaf on `underPlace` at `sz * 1.15` with
the colour times 0.6 (and set `underPlace.pivot = place.pivot`). On black leaves it changes only
which leaves pass behind the branches.

### 1.4 The tap and Sprout.exe

- Presets no longer push a theme to the taps (the only `tapLook` the viewer sends is "Set every tap
  to Auto"). A tap on Auto sends theme 4 (`default`); `themeOf` in `main.ts` then uses
  `params.look.theme`, here `briar`. Nothing in the bus, `app/main.cpp` or the tap has to know the
  new id. The tap window shows "Auto (viewer's look)".
- A tap set to Leaves, Thorns, Wreath or Branches keeps that theme under this look (its leaves
  still come out black, see 2.1). "Set every tap to Auto" or `look.themeFrom: 'preset'` undoes it.
- Optional, so a tap can choose Briar by name: in `publishThemeList` (`app/main.cpp`), before the
  sort, add one fixed entry unless a file already has that id:
  `{ "briar", "Briar (leaves & thorns)" }`. The tap lists it in its user-theme section, sends
  `customTheme: "briar"`, `live.ts` passes it on, and `themeDef('briar')` resolves it in the
  viewer. `validThemeId("briar")` already passes. No bus version change. If this is done, also make
  `validThemeId` refuse `briar` for `themeSave` (or rely on `uniqueId`, which already avoids it).
- `growth/commit.ts` `shapeOf` falls through to leaves for an unknown theme: the planting burst
  throws leaves. Optional: `snap.theme === 'briar' ? (h < 0.35 ? 1 : 0)`.

---

## 2. Colour: getting black, and keeping it readable

### 2.1 True black through `colLeaf`

What multiplies or mixes a leaf's colour, in order:

| Stage | Where | On black |
| --- | --- | --- |
| Source | `inkAt`: gradient LUT, theme natural, or take colour | Use a gradient of two near-blacks. It wins over any theme's natural green, so a tap fixed on "Leaves" is black too. |
| Take mix | `m = 1 - clamp((1 - takeMix) * natScale)` | **Leaks.** `natScale = lerp(1, 0.4 + 1.2 * h2, variety)` is below 1 for half the leaves, so at `takeMix` 0 and `variety` 0.7 a leaf gets up to 42 % take colour. The coded thorn passes `natScale` 0.6: always 40 %. (This is also where the burgundy thorns of "Dark & twisted" come from.) |
| Look tint | `look.tint`, `tintAmount` | Keep `tintAmount` 0. |
| Gain | `st.intensity * tone` (`brighten(look)` is 1 to about 1.5; tone 0.6 to 1.08; depth shade) | Multipliers: black stays black. `#0a0a0c` at gain 1.5 is `#0f0f12`. |
| Shader | midrib x0.5, rim x0.45, stalk-to-tip x0.70..1.12 | All multiplicative: they vanish on black (2.3). |
| Opacity | `response.brightness` below full and `growth.restBrightness` are applied as alpha | Black at 55 % alpha is a grey veil on light and nothing on dark: section 4. |

Fix for the leak, `colour.ts` `inkAt`:

```ts
// takeMix 0 is none at all (params.ts: "0 = pure gradient or natural colour"); unchanged from 0.1 up.
const m = ink.takeMix >= 1 ? 1 : (1 - clamp((1 - ink.takeMix) * natScale)) * Math.min(1, ink.takeMix * 10);
```

Continuous, exact 0 at `takeMix` 0, identical for every `takeMix` of 0.1 or more (all built-in
looks except the leaf roles of "Neon stage" and "Rainbow", which have `takeMix` 0 and lose a take
tint they were never meant to have).

Without this fix the only clean way to black is `look.variety: 0`, which also removes the size and
angle variety. A palette of near-blacks would hide the leak but breaks when the artist locks their
own take colours.

Leaf gradient: `'ok;0:040405,1:0c0b0f'` with `scatter` 1. Both ends are black to the eye; the tiny
spread only stops large overlaps from being one flat value after stream compression. Use
`'ok;0:000000'` for literal zero if wanted: nothing else depends on it.

### 2.2 Glow on black ink

- `stroke.frag` / `sprite.frag`: emission is `mix(ink, tint * mix(luma, 0.5, tintFlat) * 2, tintAmount)`.
  Black ink with `tintFlat` 0 emits nothing. With `tintFlat` 1 and `tintAmount` 1 every stroke and
  sprite emits the glow colour at full strength, whatever its own colour.
- `composite.frag`: `g *= 1 - inkMask * ink.a`. With `inkMask` 1 no glow lands on the ink. So a
  black leaf stays black and gets a light rim round it. That is wanted on leaves: it is the only
  thing that draws a black leaf on a dark scene. `look.decoGlow` sets how much (leaf emission =
  `look.glow * decoGlow`); 0.3 gives leaves a rim about a third as strong as the branches', which
  keeps the canopy from fogging.
- `crowd`: the glow steps back where ink is dense, so leaves deep in the canopy lose their rim and
  merge. Lower `crowd` (0.8) helps a little; the sheen (2.3) is the real answer.
- `drawPlant` scales each take's glow by `clamp(0.5 / luma(branch mid), 0.65, 1.4)`. Black bark
  gives 1.4 for every take: constant, harmless. The preset's `glow.strength` is set with it in mind.
- Glow colour: a cold, pale moonlight (`#aeb6e8`). It is the opposite of the crimson of "Dark &
  twisted", turns black shapes into backlit silhouettes, and leaves the few red roses as the only
  warm thing in the picture. For a blood-lit version change only `glow.tint` to `#a3142a`.
- On a light background glow can only veil (consult 7, 3.3): a faint blue-grey haze. The black ink
  carries the picture there.

### 2.3 Leaf shading on black: a hairline sheen (recommended)

On black the midrib, rim and tip shading are gone, so a leaf is a flat almond. In the open the rim
glow outlines it. In a dense canopy on a dark scene, where the glow has stepped back, forty leaves
are one blob, and the plant stops reading as leaves. A faint light vein and a thin lit edge on one
side fix that and suit the look (ink drawing with a silver line). It is small enough that the leaf
still reads as black. Off by default; the preset uses 0.35.

`params.ts`, section `look` (both visual by section, nothing to add in `presets.ts`):

```ts
/** A faint light vein and edge on leaves, so near-black leaves keep their form (0 = off). */
leafSheen: 0,
sheenColour: '#ffffff',
```

`sprite.frag`: `uniform vec4 u_sheen; // rgb, amount`, and in the `shape == 0 || shape == 4` block
after the two existing `col *=` lines:

```glsl
if (u_sheen.a > 0.0) {
  // At least 0.75 px wide, so it survives on small leaves.
  float vein = (1.0 - smoothstep(0.0, max(0.03, 0.75 * v_uvPerPx), abs(x))) * step(0.06, y) * step(y, 0.9);
  // A 1 px line just inside the edge, on one side only: a sheen, not an outline.
  float edge = smoothstep(0.5, 1.5, inside) * (1.0 - smoothstep(1.5, 3.0, inside)) * smoothstep(-0.05, 0.2, x);
  col = mix(col, u_sheen.rgb, u_sheen.a * max(0.8 * vein, 0.6 * edge));
}
```

`mix`, not add: on a bright leaf it only lightens the existing dark midrib and cannot blow out.
`renderer.ts`: add optional `sheen?: number; sheenColour?: string` to `GlowSettings` and
`u_sheen: [...hexToRgb(glow.sheenColour ?? '#ffffff'), Math.max(0, glow.sheen ?? 0)]` to `common`
(the stroke program ignores it, as it ignores `u_tex`). `main.ts` passes them with the glow
settings (one object reused per frame: `Object.assign(glowArgs, params.glow, { sheen:
params.look.leafSheen, sheenColour: params.look.sheenColour })`). Panel: `'look.leafSheen',
'look.sheenColour'` in the `theme` folder's keys; `RANGES['look.leafSheen'] = { min: 0, max: 1 }`;
labels "leaf sheen", "sheen colour"; tip "A faint light vein and edge on every leaf. Made for very
dark leaves, which otherwise lose their form."

With `tintFlat` 1 and `tintAmount` 1 the sheen does not change the glow (emission ignores the ink
colour). Thorns and blossoms are not touched.

If this step is skipped, raise the top of the leaf gradient to `1a191f` so overlapping leaves
differ a little. That is charcoal next to black, a weaker answer.

### 2.4 Bark, thorns, roses, halo

- **Bark**: `ok;0:0a090b,0.55:19161c,1:34303a` root to tip. Black at the limbs, charcoal in the
  middle, ash at the twig ends. Thin twigs get little rim glow, so the lighter ends are what keeps
  the fine structure visible on a dark scene; on light they read as the youngest wood. The stroke
  shader's darker sides (x0.6 on wide strokes) give the limbs a little roundness in charcoal.
  Effort moves it slightly toward ash (`voice: 'effort'`, 0.15).
- **Thorns**: bone (`#d6ccb8`, the theme's natural colour through `colAccent.source: 'theme'`,
  `takeMix` 0). Small pale spikes along black stems are what says "thorns" at stream size; black
  thorns on black bark would only show in the rim glow. They vanish on a light scene without help:
  that is what `glow.shadow` is for here.
- **Roses**: a few dark red blossoms on twig ends, closed as small buds (`look.buds` 0.3), opening
  on held notes. Justification: in a black, charcoal and bone picture one small saturated accent
  gives the eye a place to land, it is the black-rose-stem image the brief describes, and it gives
  held notes something to do. It is sparse by construction (about one twig end in eight). To drop
  it, set `look.buds: 0` and the Reaction's `look.blossoms: 0`, or remove the part.
- **Halo**: a crown of thorns in tarnished silver. Braided ring (`halo.braid` 0.7), leaves and
  thorns alternating on it (G5) with most of them permanent (`alwaysLeaves` 0.75), a short, barely
  curled vine (curl reads as tentacle), a slight corkscrew. Colour: near-black to pewter with one
  pale glint travelling slowly round (`colHalo` gradient, no take colour in it).
- **Take colours**: the look brings a palette of muted goth tones (silver-lilac, oxblood, slate,
  dusty violet, bone). With black leaves and bark it shows only where it should: the live halo
  during the planting flight and the burst (`commitInks` uses the take colour), since `main.ts`
  line 863 gives the halo a palette colour when the look has its own list.
- **Withered colour**: `#6f6a78` (ash). Falling leaves turn up to 40 % toward it (`shed.ts`), so a
  black leaf becomes dark grey as it falls and can be seen falling; old boughs dry to ash wood.

---

## 3. The Visual preset

Add to `BUILTINS.visual` in `presets.ts` (after `twisted`, which stays unchanged):

```ts
{
  id: 'blackbriar', name: 'Black briar', description: 'Gothic bramble: charcoal wood with a little gnarl, pure black leaves with a hairline silver vein, bone thorns, a few blood-red roses on held notes, a thorn-crown halo; a cold moonlight rim and a soft dark outline keep it readable on dark and light backgrounds.',
  values: {
    colBranch: { source: 'gradient', gradient: 'ok;0:0a090b,0.55:19161c,1:34303a', along: 1, speed: 0, perTake: 0, takeMix: 0, voice: 'effort', voiceAmount: 0.15 },
    colLeaf: { source: 'gradient', gradient: 'ok;0:040405,1:0c0b0f', along: 0, speed: 0, perTake: 0, scatter: 1, takeMix: 0 },
    colAccent: { source: 'theme', takeMix: 0 },
    colHalo: { source: 'gradient', gradient: 'ok;0:121015,0.5:3c3844,0.82:8d8a9c,1:ecebf5', along: 2, speed: 0.03, perTake: 0, takeMix: 0 },
    growth: { branching: 0.7, reach: 1.0, spread: 1.1, flatten: 0.5 },
    look: { theme: 'briar', density: 0.55, decoSize: 1.6, variety: 0.7, depthShade: 0.5, decoGlow: 0.3, buds: 0.3,
      tintAmount: 0, dryColour: '#6f6a78', leafSheen: 0.35, sheenColour: '#8f96c8' },
    plants: { lift: 0.1, wildness: 0.6, taper: 0.75, clearance: 0.05, overlap: 0.6, maxWidth: 0.045, tipWidth: 0.005, maxNodes: 3200,
      twist: 0.3, twistLength: 0.45, gnarl: 0.65, knots: 0.5, curl: 0, strands: 1, twistTwigs: 0.6, twistTighten: 0.3, twistDepth: 0.4 },
    halo: { origins: 2, tailDeg: 360, sproutLength: 10, sproutCurl: 0.5, wander: 0.08, alwaysLeaves: 0.75,
      ringWidth: 0.011, vineWidth: 0.008, braid: 0.7, twist: 0.25 },
    glow: { strength: 1.0, radius: 1.5, wide: 0.45, base: 0.3, crowd: 0.8, inkMask: 1, knee: 1.0,
      tint: '#aeb6e8', tintAmount: 1, tintFlat: 1, shadow: 0.35, shadowColour: '#07060a' },
    palette: { from: 'list', list: 'step;0:b9b4c8,0.2:7d1626,0.4:5b6b8c,0.6:8a7f9e,0.8:c9c2b4', pick: 'order' },
  },
},
```

Every key exists in `params.ts` except `look.leafSheen` and `look.sheenColour` (section 2.3). A
preset only applies keys that are in `defaults`, so without step 4 those two are ignored and the
rest works. `look.theme: 'briar'` needs step 1; until then `themeDef` fails, and the coded `switch`
in `deco.ts` draws nothing for an unknown id (bare black branches).

Rationale by section:

- **colBranch / colLeaf / colAccent / colHalo**: section 2. `along: 0, scatter: 1` on the leaves
  spreads the two near-blacks per leaf, not root to tip. `colAccent` says only "theme, no take
  colour": the theme's bone and rose red come through untouched.
- **growth**: a full but not overgrown canopy. `spread` 1.1 keeps the limbs fairly straight from
  the hub: stiff, woody, the opposite of the 1.6 arcs of "Dark & twisted".
- **look**: `density` 0.55 splits the leaf slots about 3 : 2 between leaves and thorns by rank
  window (1.3). `decoSize` 1.6: leaves about 25 px long at 1080p, large enough for the vein.
  `depthShade` 0.5: it cannot darken black, it only dims inner thorns and shrinks nothing here.
- **plants**: the restraint the brief asks for. `twist` 0.3 with `gnarl` 0.65 and `knots` 0.5 gives
  irregular elbows and thickened joints, which is old wood; `curl` 0 and `strands` 1 remove the two
  things that read as tentacle and rope. `twistTwigs` 0.6 keeps twigs nearly straight, so thorns
  and leaves sit on clean lines. `lift` 0.1: tips rise a little; drooping arcs are the tentacle
  silhouette. `taper` 0.75: fine pointed twig ends. `step` stays at the default 0.03 (twist 0.3
  does not need 0.02), so it costs about a third less than "Dark & twisted" per tree.
- **halo**: section 2.4.
- **glow**: section 2.2. `base` 0.3 because the rim must be there in silence too: it is what draws
  the plant on a dark scene. `strength` 1.0 with the fixed x1.4 of `drawPlant`. `radius` 1.5 and
  `wide` 0.45 keep the rim tight, a contour and not a fog. `shadow` 0.35: on a light scene it puts
  a soft smoke-dark edge under the pale glow and round the bone thorns; more than that smudges the
  leaf silhouettes, which are already dark. `shadowColour` near-black with a trace of violet.
- **palette**: section 2.4.

How it should read. On a dark scene: black leaf and thorn silhouettes edged in cold light, ash
twig ends, bone thorns, a silver vein on each leaf, a few dark red points. On a light scene: an ink
drawing of a bramble, black on white, with a thin smoky edge and red roses.

---

## 4. The Reaction preset: "Nocturne"

Clearly useful here, because two stock reactions fight black ink:

- `response.brightness` 0.7: quiet singing is drawn as lower opacity. See-through black is grey on
  light and gone on dark.
- `growth.restBrightness` 0.55: between phrases the whole tree is 55 % opaque.

"Writhing" has both right (0.3, 0.8) but squirms at 0.7, which is the tentacle read again. So:

```ts
{
  id: 'nocturne', name: 'Nocturne', description: 'For dark, solid looks: trees stay opaque when you are quiet and the voice shows in the rim glow instead; slow growth, stiff branches that only sway, thorns that grow when you push, roses on notes held a second.',
  values: {
    growth: { secondsToFull: 4, restBrightness: 0.9, fadeAfter: 4, fadeSeconds: 3.5, ending: 'wither', dieAfter: 6,
      witherDepth: 0.5, witherSeconds: 1.2, twigFadeSeconds: 1.0, regrowSpeed: 1.0 },
    response: { brightness: 0.25, effortWidth: 1.1, release: 2.2 },
    look: { thornEffort: 2, blossoms: 0.6, blossomHold: 1.2 },
    plants: { twistVoice: 0.6 },
    halo: { idleSpeed: 5, singSpeed: 50, sproutRate: 3, sproutGrow: 0.8 },
    glow: { levelGain: 0.9, onsetGain: 0.9, pitchShine: 0.3, front: 1.2, softGlow: 0.5 },
    motion: { writhe: 0, swayDeg: 5, idle: 0.4, speed: 0.7, kickDeg: 5, springiness: 0.4, twigs: 0.8, flutterDeg: 9, shiverDeg: 3 },
  },
},
```

- Loudness goes to the rim glow (`levelGain` 0.9, on top of the look's `base` 0.3), the only
  brightness channel a black plant has. Note starts flash the rim (`onsetGain`).
- `ending: 'wither'` with `growth.shed` at its default (on): leaves and thorns let go and fall,
  turning ash, instead of the tree fading through grey.
- `thornEffort` 2: thorns run from 0.6x when soft to 2.6x at full push. This is the look's most
  readable voice reaction.
- `twistVoice` 0.6: vibrato adds a little gnarl to a new tree, never enough to bring the twist back.
- Motion is stiff: small sway, low springiness, twigs follow the limbs, no writhe.

Every key is in `params.ts` and in the reactivity kind (`REACTIVE` or the `response` / `motion`
sections).

---

## 5. Risks

- **Black on dark depends on the glow.** With `glow.strength` or `glow.base` turned far down, or
  the OBS source's opacity reduced, the plant disappears on a dark scene by construction. The
  sheen, the ash twig ends and the bone thorns are what remains; that is one reason to do step 4.
- **Stream compression** crushes near-blacks together: leaf on bark on dark scene is carried by
  the rim and the sheen, not by the difference between `#0a0a0c` and `#19161c`. Judge it in the
  "half dark, half light" backdrop and once in a real OBS recording.
- **Sheen strength is a guess.** At 0.35 the vein is about 28 % of the way to `#8f96c8`. If the
  leaves start to look grey from a distance, lower it before touching anything else.
- **The `inkAt` fix changes two existing looks slightly** ("Neon stage" and "Rainbow" leaves lose a
  take tint of up to about 35 % on some leaves). It matches the documented meaning of `takeMix` 0.
  If that is unwanted, give those two presets `takeMix: 0.1` to keep them as they are.
- **Generic loop changes touch user themes.** A theme with one spaced part comes out as before,
  apart from G3 (leaves now drop from drying boughs) and the cleared `drop`. A user theme with two
  spaced parts changes visibly: its second part moves off the first part's nodes. That is the
  intended fix, but an existing theme built around the overlap would look different.
- **Thorn count follows the free leaf slots.** Above `density` 0.8 or so thorns thin out and at 1
  there are none. If thorns must be independent of leaf density, the alternative is a hash test on
  in-band nodes, which needs a per-node "in band" flag that `leafRank` does not carry today.
- **Halo ring spacing** halves for two-part themes (a leaf and a thorn per 0.3 rad). With
  `alwaysLeaves` 0.75 the resting halo is fairly full; lower it if the small resting ring looks
  crowded.
- **Cost.** The part loop is slower per node than the coded leaves path; G4 keeps it to the nodes
  that carry something. Without G4, six takes at 3200 nodes walk 19 000 nodes x 3 parts a frame.
- **Tap window.** Without step 5 nobody can pick Briar on a single track; a track is Briar only by
  being on Auto under this look (or with "per-track settings: ignored"). A tap fixed on "Thorns"
  under this look gets black thorns: the coded thorn is painted by the leaf role, which is the
  black gradient here. Black thorns on black bark are close to invisible, so use "Set every tap to
  Auto" when picking the look.
- **A user theme file named `briar`** is ignored once the id is built in (the `loadThemes` guard).
- **Light scenes and the shadow.** `glow.shadow` is part of the OBS output: it darkens the scene a
  little round the plant. At 0.35 that is a thin edge; raise it only if the bone thorns are lost.
- **Roses and the cold glow.** With `tintAmount` 1 the roses' own glow is moonlight, not red. That
  is deliberate (one glow colour). For red-glowing roses lower `glow.tintAmount` to 0.85; black ink
  then glows 15 % less.

## 6. Order of work

1. `colour.ts` `inkAt` (2.1). Check "Lush ivy" and "Dark & twisted" are unchanged, "Neon stage"
   leaves no longer pick up take colour.
2. `themes.ts` (1.2), then `deco.ts` G1, G2, G3, G4 (1.3). Check with the theme editor: `leaves`,
   `thorns`, `wreath` unchanged (coded path), `briar` shows leaves and thorns on different nodes,
   thorns fall when a twig withers, roses only on twig ends.
3. `decorateRing` G5. Check a one-part user theme's ring is unchanged.
4. Preset "Black briar" and Reaction "Nocturne". Judge on the split backdrop.
5. Leaf sheen (2.3): params, shader, uniform, panel rows.
6. Optional: Sprout.exe lists `briar` (1.4); the burst shape in `commit.ts`.
