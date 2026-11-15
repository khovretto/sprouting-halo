# Design consult 5: colour system, gradient picker, expandable themes, panel restructure

Written against the code at commit f5d7839 (`viewer/src/params.ts`, `panel-layout.ts`, `presets.ts`,
`ui.ts`, `deco.ts`, `main.ts`, `shaders/sprite.*`, `app/FeatureServer.cpp`, `common/SproutBus.h`,
`tap/SproutTapProcessor.cpp`). Nothing here was run or viewed on screen: values and code are
reasoned from the source and are starting points. No source file was changed.

## Summary of the decisions

| Question | Decision |
| --- | --- |
| Colour model | 4 colour **roles** (branches, leaves, accents, halo), each with the same 9 settings: a **source** (take colour, the theme's natural colours, or a gradient) and a **position** along it made of 6 movers (along the branch, time, voice, per take, per leaf, plus the fixed stops themselves). |
| Fixed colour, palette, rainbow | All are gradients: one stop = fixed colour, `step` interpolation = palette, 6 looping stops = rainbow. One widget, one key. |
| "Leaves white" | The shapes in `sprite.frag` are already neutral. The six hard-coded colours in `deco.ts` (LEAF, PETAL, THORN, PINE, HOLLY, BERRY) move into theme data as each part's `natural` colour, used only by source "theme". |
| Gradient encoding | One string per gradient: `ok~;0:ff4d4d,0.5:4dff4d,1:4d4dff`. Not fixed stop keys (section B.1 says why). |
| Preset kind | The four `col*` sections and `glow.tint*` are **visual**. The take palette (`colours.live`, `take1..7`) stays **rig**. |
| User themes | One JSON file per theme with the textures embedded, in a `themes` folder next to Sprout.exe, saved through the existing WebSocket. Reaches OBS because Sprout.exe serves it. |
| Textures | One `TEXTURE_2D_ARRAY` (256 x 256, up to 16 layers), sampled in the existing sprite shader so draw order does not change. |
| Tracks picking a custom theme | First version: tap on "Viewer default" (or "theme comes from: this preset") shows the viewer's theme, which can now be a custom one. No tap or bus change. Per-track custom themes need bus v4 and can wait. |
| Panel | Three top tabs that equal the three preset kinds: **Look**, **Reaction**, **Setup**. Reaction is grouped by what the voice does (loudness, note starts, pitch, held notes). Three macro sliders that only write existing keys. |

---

## A. Colour system

### A.1 Model

Every instance (a branch segment or a decoration) gets its colour in three steps:

1. **Source colour** `g`: the take colour, the part's natural colour, or a lookup in a baked
   gradient at position `u`.
2. **Take mix**: `c = lerp(g, take, takeMix)` so takes keep their identity under a gradient.
3. **Look tint** (existing `look.tint`, `look.tintAmount`): `c = lerp(c, tint, tintAmount)`.

Brightness, tone, shine and alpha are applied afterwards exactly as today.

Position along a gradient:

```
u = speed * t  +  perTake * takeIndex  +  voiceAmount * voice  +  along * s  +  scatter * (h - 0.5)
```

| Term | Meaning | Where the value comes from |
| --- | --- | --- |
| `t` | time in seconds | sim time `t` in `main.ts` |
| `takeIndex` | 0, 1, 2 ... per take; live halos count from 0 | slot index `k` |
| `voice` | one of pitch, loudness, effort, breath, vibrato, note starts (0..1) | the layer's `Drive` (`pitch`, `energy`, `effort`, `breath`, `vibrato`, `flash`) |
| `s` | 0 at the root to 1 at the tip; on the halo, the angle round the ring | `sk.flex[i] / plant.maxFlex`; ring: `angle / TAU` |
| `h` | a stable random number per leaf | the existing `h2` hash in `deco.ts` |

A gradient marked **loop** wraps (`u - floor(u)`); any other gradient goes there and back
(triangle wave), so no setting ever produces a seam.

"Depth (inside to rim)" is not a separate mover: on these trees it is almost the same as root to
tip, and `look.depthShade` already darkens the inside. One slider fewer.

### A.2 Settings

Four sections with identical keys (two-level paths, as `getPath` requires). All **visual**.

```ts
// params.ts (new). Defaults reproduce today's picture.
const RAINBOW = 'rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff';

colBranch: {
  /** take: the take's colour. theme: the theme's branch colour. gradient: the gradient below. */
  source: 'take' as 'take' | 'theme' | 'gradient',
  gradient: RAINBOW,
  /** How much of the take colour is mixed back in (0 = pure gradient or natural colour). */
  takeMix: 0,
  /** Gradient lengths from root to tip (negative runs the other way). */
  along: 0.3,
  /** Gradient lengths per second. */
  speed: 0.05,
  /** What in the voice moves the colour along the gradient. */
  voice: 'none' as 'none' | 'pitch' | 'loudness' | 'effort' | 'breath' | 'vibrato' | 'flash',
  voiceAmount: 0.5,
  /** Each further take starts this far along the gradient. */
  perTake: 0.13,
  /** Random spread per leaf (decorations only). */
  scatter: 0,
},
colLeaf:   { source: 'theme', gradient: 'ok;0:1f6b2e,0.5:52c757,1:b5e61d', takeMix: 0.65,
             along: 1, speed: 0, voice: 'none', voiceAmount: 0.5, perTake: 0, scatter: 0.25 },
colAccent: { source: 'theme', gradient: 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff', takeMix: 0.35,
             along: 0, speed: 0, voice: 'none', voiceAmount: 0.5, perTake: 0, scatter: 0.5 },
colHalo:   { source: 'branches' as 'branches' | 'take' | 'gradient', gradient: RAINBOW, takeMix: 0,
             along: 1, speed: 0.05, voice: 'none', voiceAmount: 0.5, perTake: 0.15, scatter: 0 },
glow: { ..., /** A colour the glow leans toward. */ tint: '#ffffff', tintAmount: 0 },
```

Ranges (`RANGES` in `ui.ts`): `takeMix` 0..1, `along` -2..2, `speed` -1..1, `voiceAmount` -1..1,
`perTake` 0..1, `scatter` 0..1, `glow.tintAmount` 0..1.

Which role colours what:

| Role | Elements |
| --- | --- |
| `colBranch` | take tree strokes; the shock ring and commit effects (colour at the tip, `s = 1`) |
| `colLeaf` | leaf, thorn, needle, holly, and any custom part with `role: 'leaf'`, on trees and on the halo |
| `colAccent` | blossom, berry, and any custom part with `role: 'accent'` |
| `colHalo` | halo ring and halo vine strokes. `branches` = use the `colBranch` settings |

Rows for `gradient` and the movers are hidden while a role's source is `take` or `theme`
(`binding.hidden = true`), so a new artist sees one dropdown per role.

### A.3 Compatibility and migration

- `colours.mode` and `colours.rainbowSpeed` are removed. `migrate()` in `ui.ts`:
  `mode === 'rainbow'` becomes `colBranch.source = 'gradient'`, `colBranch.speed = rainbowSpeed`,
  `colHalo.source = 'branches'`. The defaults above (`along 0.3`, `perTake 0.13`, 70 % saturated
  six-stop loop) match today's `colourAt` closely. Linear RGB between the six rainbow stops is
  exactly the HSV hue wheel, so no HSV mode is needed.
- `look.naturalTint` is removed: `colLeaf.takeMix = 1 - naturalTint`. Run the same migration on
  saved user presets when the store loads (`presets.ts` `loadStore`) and on imported files.
- Built-in presets: replace `naturalTint: x` by `colLeaf: { takeMix: 1 - x }` (Lush ivy 0.4,
  Winter 0.9, Festive 0.1 plus `colAccent: { takeMix: 0.05 }`, Bramble 0.95, Minimal 0.8, Neon 0.9).
- Small visible differences to accept: thorns used `naturalTint * 0.6`, berries `0.6 + 0.4 n`,
  petals `0.4 + 0.5 n`. They now follow the role's `takeMix` (leaf 0.65, accent 0.35). `look.tint`
  now also reaches the natural part of leaves (today only the take colour is tinted first).
- Old keys still stored in `sprout-settings.json` are harmless: `applyPatch` only takes known paths.

### A.4 Evaluation code

New file `viewer/src/colour.ts`. One `Ink` per layer and role, refilled each frame (no
allocation); gradients are baked once per string into a 256-entry table.

```ts
import { clamp, RGB, hexToRgb } from './math';
import type { Params } from './params';
import type { Drive } from './drive';
import { bakeGradient, Baked } from './gradient';

export type RoleId = 'colBranch' | 'colLeaf' | 'colAccent' | 'colHalo';
type RoleParams = Params['colBranch'];

export interface Ink {
  lut: Float32Array | null;   // 256 * 3 when the source is a gradient
  loop: boolean;
  natural: boolean;           // source 'theme': the caller passes the part's natural colour
  take: RGB;
  takeMix: number;
  tint: RGB; tintK: number;
  u0: number; along: number; scatter: number;
  /** Mean colour, for the glow equalisation in drawPlant and for commit effects. */
  mid: RGB;
}
export const newInk = (): Ink => ({ lut: null, loop: false, natural: false, take: [1, 1, 1], takeMix: 1,
  tint: [1, 1, 1], tintK: 0, u0: 0, along: 0, scatter: 0, mid: [1, 1, 1] });

const voiceOf = (d: Drive | undefined, v: RoleParams['voice']) =>
  !d || v === 'none' ? 0 : v === 'pitch' ? d.pitch : v === 'loudness' ? d.energy : v === 'effort' ? d.effort
  : v === 'breath' ? d.breath : v === 'vibrato' ? d.vibrato : d.flash;

/** Fill `ink` for one layer. `take` is the untinted take colour; `k` the take index. */
export function setInk(ink: Ink, p: Params, role: RoleId, take: RGB, k: number, t: number, d?: Drive): Ink {
  let r = p[role] as RoleParams;
  if (role === 'colHalo' && (r.source as string) === 'branches') r = p.colBranch;
  ink.take = take;
  ink.tint = hexToRgb(p.look.tint);
  ink.tintK = clamp(p.look.tintAmount);
  ink.natural = r.source === 'theme';
  ink.takeMix = r.source === 'take' ? 1 : clamp(r.takeMix);
  ink.lut = null;
  if (r.source === 'gradient') {
    const b: Baked = bakeGradient(r.gradient, take);   // cached by string (+ take colour if it has "t" stops)
    ink.lut = b.lut;
    ink.loop = b.loop;
    ink.u0 = r.speed * t + r.perTake * k + r.voiceAmount * voiceOf(d, r.voice);
    ink.along = r.along;
    ink.scatter = r.scatter;
    inkAt(ink, 0.5, 0.5, ink.mid);
  } else inkAt(ink, 0, 0.5, ink.mid);
  return ink;
}

/**
 * Colour at a point. s: 0 root .. 1 tip (ring: angle / TAU). h: per-leaf random 0..1.
 * natural: the part's natural colour (source 'theme'). natScale: per-leaf variety of the mix
 * (deco.ts passes lerp(1, 0.4 + 1.2 * h2, variety), as today). gain: brightness multiplier.
 */
export function inkAt(ink: Ink, s: number, h: number, out: number[], natural?: RGB, natScale = 1, gain = 1) {
  let r: number, g: number, b: number;
  const lut = ink.lut;
  if (lut) {
    let u = ink.u0 + ink.along * s + ink.scatter * (h - 0.5);
    if (ink.loop) u -= Math.floor(u);
    else { u = Math.abs(u) % 2; if (u > 1) u = 2 - u; }
    const i = Math.min(255, (u * 256) | 0) * 3;
    r = lut[i]; g = lut[i + 1]; b = lut[i + 2];
  } else if (ink.natural && natural) { r = natural[0]; g = natural[1]; b = natural[2]; }
  else { r = ink.take[0]; g = ink.take[1]; b = ink.take[2]; }
  const m = ink.takeMix >= 1 ? 1 : 1 - clamp((1 - ink.takeMix) * natScale);
  const k = ink.tintK, a = (1 - m) * (1 - k) * gain, tk = m * (1 - k) * gain, kk = k * gain;
  out[0] = r * a + ink.take[0] * tk + ink.tint[0] * kk;
  out[1] = g * a + ink.take[1] * tk + ink.tint[1] * kk;
  out[2] = b * a + ink.take[2] * tk + ink.tint[2] * kk;
}
```

Cost: about 25 floating-point operations per instance, 3000 instances, well under 0.1 ms. With
every source on `take` the path is three multiply-adds, the same order as today.

### A.5 Where it plugs in

`main.ts`:

- Keep `inks: Ink[][]` (`MAX_LAYERS` x 4 roles), created once.
- `drawPlant`: replace `const base = tinted(hexToRgb(s.colour))` by
  `const take = hexToRgb(s.colour)` and
  `const ib = setInk(inks[layer][0], params, 'colBranch', take, k, t, s.drive)`, likewise leaf and
  accent. The luma for the glow equalisation reads `ib.mid`.
- `pushTree(out, sk, vis, layer, ink, sScale, ring, ...)` replaces the `base` argument. In the
  loop, instead of `const c = rainbow ? colourAt(...) : base`:
  ```ts
  const s = ring ? ringS(sk.x[i], sk.y[i], ink.loop) : sk.flex[i] * sScale;   // sScale = 1 / plant.maxFlex
  inkAt(ink, s, 0.5, C);                                                      // C: module-level scratch [0, 0, 0]
  ```
  with `ringS = (x, y, loop) => (Math.atan2(y, x) / TAU + 0.5) * (loop ? 1 : 2)`. The factor 2
  makes a non-looping gradient go there and back round the ring, so the ring has no seam.
- `pushRing`: `inkAt(ink, (k / N) * (ink.loop ? 1 : 2), 0.5, C)`. Use the same formula as the vine
  so ring and vine always agree.
- `drawHalo`: `setInk(..., 'colHalo', take, haloIndex, t, h.drive)`.
- `tinted()` stays only for the commit animation, which passes single colours around
  (`targetOf`, `HaloSnapshot`): give it `ink.mid`. During the 1.4 s flight the ring is one colour.
- `colourAt` and the `rainbow` flag are deleted.

`deco.ts`:

- `DecoStyle.colour` becomes `leaf: Ink; accent: Ink; sScale: number`.
- The six colour constants leave the file (they become `natural` in theme data, section C.2).
- `tint(st.colour, LEAF, nat * f, inten)` becomes
  `inkAt(st.leaf, sk.flex[i] * st.sScale, h2, tintA, part.natural, f, inten)`; blossoms and
  berries use `st.accent`. `decorateRing` passes `s = a / TAU`.
- The under-leaf (`* 0.6`) and all sizes, angles and hashes stay as they are.

Shaders: no change for the colour system. For the glow tint add one uniform to `stroke.frag` and
`sprite.frag`: `uniform vec4 u_glowTint;` and
`vec3 gc = mix(col, u_glowTint.rgb * dot(col, vec3(0.2126, 0.7152, 0.0722)) * 2.0, u_glowTint.a);`
then `o_glow = vec4(gc * v_glow, 1.0) * cov;` (set in `common` in `renderer.ts`).

---

## B. Gradient picker

### B.1 Encoding

```
gradient := interp [ "~" ] ";" stop { "," stop }
interp   := "rgb" | "ok" | "step"          linear RGB, OKLab (smooth, no grey middle), hard steps
"~"      := loop: the last stop blends back into the first
stop     := position ":" colour            position 0..1, at most 3 decimals
colour   := 6 hex digits, lower case, no "#"   |   "t"  (the take colour)
```

Examples: `ok;0:ff7ac8` (a fixed colour), `step;0:b5e61d,0.33:3d4fd6,0.66:00dd88` (a palette),
`ok;0:t,1:ffffff` (take colour fading to white tips). 1 to 12 stops, always sorted, always lower
case (so `same()` in `presets.ts` compares correctly).

Why one string and not fixed stop keys:

- A gradient changes **atomically**. With keys per stop, adding or reordering a stop sends many
  keys; another viewer (OBS) would show half-applied gradients, and the "newest change wins per
  key" rule could mix two people's edits into a gradient nobody made.
- Sprout.exe needs no change: `mergePatch` already keeps a quoted string as one raw token (commas
  and colons inside the quotes are safe; the encoding has no `"` or `\`).
- Presets, export files and copy/paste all carry the same text.
- 4 keys instead of 4 x (12 x 2 + 2) = 104.

Two things to watch in `ui.ts`: a string must **not start with `#`** (the row builder turns those
into colour pickers; the encoding starts with a letter), and gradient rows need their own builder
(B.3).

### B.2 Parse, serialise, bake (`viewer/src/gradient.ts`)

```ts
import { hexToRgb, RGB } from './math';

export interface Stop { pos: number; col: string }           // col: 'rrggbb' or 't'
export interface Gradient { interp: 'rgb' | 'ok' | 'step'; loop: boolean; stops: Stop[] }
export interface Baked { lut: Float32Array; loop: boolean }

export function parseGradient(s: string): Gradient {
  const m = /^(rgb|ok|step)(~?);(.*)$/.exec(s.trim().toLowerCase());
  const stops: Stop[] = [];
  for (const part of (m ? m[3] : '').split(',')) {
    const q = /^([0-9.]+):([0-9a-f]{6}|t)$/.exec(part.trim());
    if (q && stops.length < 12) stops.push({ pos: Math.min(1, Math.max(0, +q[1])), col: q[2] });
  }
  if (!stops.length) stops.push({ pos: 0, col: 'ffffff' });
  stops.sort((a, b) => a.pos - b.pos);
  return { interp: (m?.[1] as Gradient['interp']) ?? 'ok', loop: m?.[2] === '~', stops };
}

export const formatGradient = (g: Gradient) =>
  `${g.interp}${g.loop ? '~' : ''};` + [...g.stops].sort((a, b) => a.pos - b.pos)
    .map((s) => `${+s.pos.toFixed(3)}:${s.col}`).join(',');

// OKLab (Björn Ottosson). The app treats #rrggbb / 255 as its working values, so convert through
// linear light only inside this function.
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
function toOk([r, g, b]: RGB): RGB {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOk([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const c = (v: number) => Math.min(1, Math.max(0, gam(v)));
  return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

const cache = new Map<string, Baked>();
export function bakeGradient(str: string, take: RGB): Baked {
  const usesTake = str.includes(':t');
  const key = usesTake ? `${str}|${take.map((v) => Math.round(v * 255)).join(',')}` : str;
  let b = cache.get(key);
  if (b) return b;
  if (cache.size > 64) cache.clear();
  const g = parseGradient(str), n = g.stops.length;
  const cols = g.stops.map((s) => (s.col === 't' ? take : hexToRgb(s.col)));
  const work = g.interp === 'ok' ? cols.map(toOk) : cols;
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = g.loop ? i / 256 : i / 255;
    let j = 0;
    while (j < n && g.stops[j].pos <= u) j++;                 // j = first stop after u
    let i0 = j - 1, i1 = j, p0: number, p1: number;
    if (g.loop) {                                             // neighbours wrap round
      p0 = i0 < 0 ? g.stops[n - 1].pos - 1 : g.stops[i0].pos;
      p1 = i1 >= n ? g.stops[0].pos + 1 : g.stops[i1].pos;
      i0 = (i0 + n) % n; i1 %= n;
    } else {
      i0 = Math.max(0, i0); i1 = Math.min(n - 1, i1);
      p0 = g.stops[i0].pos; p1 = g.stops[i1].pos;
    }
    const f = g.interp === 'step' || p1 - p0 < 1e-6 ? 0 : (u - p0) / (p1 - p0);
    const a = work[i0], c = work[i1];
    const mix: RGB = [a[0] + (c[0] - a[0]) * f, a[1] + (c[1] - a[1]) * f, a[2] + (c[2] - a[2]) * f];
    lut.set(g.interp === 'ok' ? fromOk(mix) : mix, i * 3);
  }
  cache.set(key, (b = { lut, loop: g.loop }));
  return b;
}

export const GRADIENT_PRESETS: Record<string, string> = {
  'Rainbow': 'rgb~;0:ff4d4d,0.167:ffff4d,0.333:4dff4d,0.5:4dffff,0.667:4d4dff,0.833:ff4dff',
  'Rainbow (vivid)': 'rgb~;0:ff0000,0.167:ffff00,0.333:00ff00,0.5:00ffff,0.667:0000ff,0.833:ff00ff',
  'Pastel rainbow': 'rgb~;0:ffa6a6,0.167:ffffa6,0.333:a6ffa6,0.5:a6ffff,0.667:a6a6ff,0.833:ffa6ff',
  'Natural green': 'ok;0:1f6b2e,0.5:52c757,1:b5e61d',
  'Autumn': 'ok;0:7a1f0e,0.4:d9541e,0.7:f2a51e,1:f7dc6f',
  'Fire': 'ok;0:3a0a00,0.35:c21a00,0.65:ff7a00,0.9:ffd84a,1:fff6cf',
  'Ice': 'ok;0:0b2a6b,0.4:2f7fe0,0.75:8fe3ff,1:f2fdff',
  'Sakura': 'ok;0:ff7ac8,0.6:ffd1e6,1:ffffff',
  'Sunset': 'ok;0:2b1b6b,0.4:c2338f,0.7:ff7a59,1:ffd36b',
  'Neon': 'rgb~;0:ff2bd6,0.33:2bd9ff,0.66:7dff2b',
  'Take to white': 'ok;0:t,1:ffffff',
  'Dark to take': 'ok;0:101018,0.6:t,1:t',
  'Single colour': 'ok;0:ffffff',
};
```

### B.3 Interaction

Collapsed, the row shows only the gradient bar (full value width, 20 px). A click opens the
editor under the row; the panel stays compact.

```
[ label ] [========== gradient bar ==========]            <- always visible
            ^      ^          ^           ^               <- stop handles (pins in the stop's colour)
          [Smooth v] [Loop] [Reverse] [Spread] [Presets v]
          selected stop:  [colour] position [0.42] [take colour] [remove]
          [ inline colour picker (Tweakpane) ]
          [ ok~;0:ff4d4d,...                ] [Copy] [Paste]
```

| Action | Result |
| --- | --- |
| Click the bar or the empty track | New stop there, in the colour the gradient has at that point; it becomes the selected stop |
| Drag a handle sideways | Moves the stop (Shift: snap to 0.05). Stops may pass each other |
| Drag a handle more than 30 px down, or Delete / Backspace, or right-click | Removes it (never the last one) |
| Click a handle | Selects it; the colour picker below edits it |
| Arrow left / right on a focused handle | Moves by 0.01 (Shift 0.1) |
| Smooth / Linear / Steps | `ok` / `rgb` / `step` |
| Loop | Sets `~`; the bar draws the wrap-around blend at its right end |
| Reverse, Spread | Mirror all positions; space the stops evenly |
| Take colour (checkbox) | The stop becomes `t`; its pin shows a ring instead of a fill |
| Presets | The built-in list plus "Save current..." (stored in `localStorage` under `sprout.viewer.gradients.v1`) |
| Text field, Copy, Paste | The raw string. Editing or pasting applies when it parses. The text field is the fallback where the clipboard is blocked (OBS Interact) |

Better than Godot's editor in four ways: the real scene updates while a stop is dragged; loop is
seamless by construction; a stop can be the take colour; and (optional, second sitting) small
ticks under the bar show where each take currently reads the gradient (`ink.u0`), which makes the
movers visible.

Colour editing uses Tweakpane's own inline picker (plain DOM, so it works in OBS's Interact
window, unlike `<input type="color">`).

### B.4 Component sketch (`viewer/src/gradient-editor.ts`)

```ts
import { Pane } from 'tweakpane';
import { bakeGradient, formatGradient, Gradient, GRADIENT_PRESETS, parseGradient } from './gradient';

export class GradientEditor {
  readonly el = document.createElement('div');
  private g: Gradient;
  private sel = 0;
  private bar = document.createElement('canvas');        // 256 x 1, stretched by CSS
  private track = document.createElement('div');          // holds the handles
  private body = document.createElement('div');           // editor below the bar, hidden when collapsed
  private text = document.createElement('input');
  private picker: Pane;
  private pick = { colour: '#ffffff' };

  constructor(value: string, private onChange: (v: string) => void, private take = '#b5e61d') {
    this.g = parseGradient(value);
    this.el.className = 'sprout-grad';
    this.bar.width = 256; this.bar.height = 1;
    this.el.append(this.bar, this.track, this.body);
    this.bar.addEventListener('click', (e) => (this.body.hidden ? (this.body.hidden = false) : this.addAt(this.posOf(e))));
    this.track.addEventListener('pointerdown', (e) => { if (e.target === this.track) this.addAt(this.posOf(e)); });
    this.body.hidden = true;
    // toolbar: interpolation <select> (use select-menu.ts inside OBS), Loop, Reverse, Spread, Presets
    // ... each handler edits this.g and calls this.commit()
    this.picker = new Pane({ container: this.body });
    this.picker.addBinding(this.pick, 'colour', { view: 'color', picker: 'inline', expanded: true, label: 'stop' })
      .on('change', (ev) => { this.g.stops[this.sel].col = ev.value.slice(1).toLowerCase(); this.commit(false); });
    this.text.addEventListener('change', () => this.set(this.text.value, true));
    this.body.append(this.text);
    this.render();
  }

  /** From outside (sync, revert, preset): show a new value without firing onChange. */
  set(value: string, fire = false) {
    this.g = parseGradient(value);
    this.sel = Math.min(this.sel, this.g.stops.length - 1);
    this.render();
    if (fire) this.onChange(formatGradient(this.g));
  }

  private posOf(e: MouseEvent) {
    const r = this.bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  private addAt(pos: number) {
    if (this.g.stops.length >= 12) return;
    const { lut } = bakeGradient(formatGradient(this.g), [1, 1, 1]);
    const i = Math.min(255, Math.floor(pos * 256)) * 3;
    const hex = [0, 1, 2].map((k) => Math.round(lut[i + k] * 255).toString(16).padStart(2, '0')).join('');
    const stop = { pos, col: hex };
    this.g.stops.push(stop);
    this.commit();
    this.sel = this.g.stops.indexOf(stop);
    this.render();
  }

  private commit(rebuild = true) {
    const keep = this.g.stops[this.sel];
    this.g.stops.sort((a, b) => a.pos - b.pos);
    this.sel = Math.max(0, this.g.stops.indexOf(keep));
    if (rebuild) this.render(); else this.paint();
    this.onChange(formatGradient(this.g));
  }

  private paint() {
    const { lut } = bakeGradient(formatGradient(this.g), hexRgb(this.take));
    const ctx = this.bar.getContext('2d')!, img = ctx.createImageData(256, 1);
    for (let i = 0; i < 256; i++) {
      img.data[i * 4] = lut[i * 3] * 255; img.data[i * 4 + 1] = lut[i * 3 + 1] * 255;
      img.data[i * 4 + 2] = lut[i * 3 + 2] * 255; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.text.value = formatGradient(this.g);
  }

  private render() {
    this.paint();
    this.track.replaceChildren(...this.g.stops.map((s, i) => {
      const h = document.createElement('button');
      h.className = 'sprout-grad-stop' + (i === this.sel ? ' sel' : '') + (s.col === 't' ? ' take' : '');
      h.style.left = `${s.pos * 100}%`;
      h.style.background = s.col === 't' ? 'transparent' : '#' + s.col;
      h.addEventListener('pointerdown', (e) => this.drag(e, s, h));
      h.addEventListener('keydown', (e) => this.key(e, s));
      h.addEventListener('contextmenu', (e) => { e.preventDefault(); this.remove(s); });
      return h;
    }));
    const cur = this.g.stops[this.sel];
    this.pick.colour = cur.col === 't' ? this.take : '#' + cur.col;
    this.picker.refresh();
  }

  private drag(e: PointerEvent, s: { pos: number; col: string }, h: HTMLElement) {
    this.sel = this.g.stops.indexOf(s);
    h.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      let pos = this.posOf(ev);
      if (ev.shiftKey) pos = Math.round(pos * 20) / 20;
      s.pos = pos;
      h.style.left = `${pos * 100}%`;
      h.classList.toggle('removing', ev.clientY - y0 > 30 && this.g.stops.length > 1);
      this.commit(false);                                   // repaint the bar, keep the handle elements
    };
    const up = (ev: PointerEvent) => {
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      if (ev.clientY - y0 > 30) this.remove(s); else this.commit();
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
  }
  private remove(s: { pos: number }) { /* splice unless it is the last stop; commit() */ }
  private key(e: KeyboardEvent, s: { pos: number }) { /* arrows move, Delete removes; commit() */ }
}
```

Hooking it into `ui.ts` `addRow` without a Tweakpane plugin: add
`'colBranch.gradient': { gradient: true }` (and the other three) to `RANGES`. For such a path
create the normal text binding (so revert, marks and `rows` keep working), hide its `.tp-txtv`
input, and append `editor.el` to the row's `.tp-lblv_v`. `onChange` writes `obj[key] = v`, calls
`updateMarks()` and `userChange()`. Keep the editors in a list and call `editor.set(obj[key])` from
the UI's `refresh()` and from the revert button. Throttle `userChange()` from a drag to about
15 per second; the bar itself repaints every event.

---

## C. Expandable themes

### C.1 What a theme is

A named set of up to 6 **parts**. A part is one kind of decoration with a placement rule, a
shape, and a colour role. Placement rules are the five that `deco.ts` already has, named:

| `place` | Rule (today's code) | Built-in use |
| --- | --- | --- |
| `spaced` | one per node where `rank <= density`, alternating sides, plus every visible tip | leaf, thorn |
| `every` | 1 to 4 per node on alternating sides | pine needle |
| `tips` | at branch tips; `opens: 'bloom'` ties it to held notes (`look.blossoms`, `blossomHold`) | blossom |
| `clusters` | three in a ring on rare nodes | berries |
| `pairs` | a mirrored pair on rare nodes | holly |

```ts
// viewer/src/themes.ts
export interface ThemePart {
  place: 'spaced' | 'every' | 'tips' | 'clusters' | 'pairs';
  /** Built-in SDF shape, or the name of a texture in this theme. */
  shape: 'leaf' | 'thorn' | 'berry' | 'needle' | 'holly' | 'blossom' | `tex:${string}`;
  size: number;                    // relative to today's size for that rule (1 = unchanged)
  amount: number;                  // weight on the track's density (1 = unchanged)
  role: 'leaf' | 'accent';         // which colour role paints it
  natural: string;                 // '#rrggbb', used by source "theme"
  /** tint: the texture is a white / grey mask, coloured by the role. own: keeps its own colours. */
  colour?: 'tint' | 'own';
  glow?: number;                   // multiplier on leaf glow (berries 1.3, blossoms 1.4, needles 0.5)
  flutter?: number;                // 0 rigid .. 1 like a leaf
  sizeFrom?: 'effort';             // thorns grow with effort (look.thornEffort)
  opens?: 'always' | 'bloom';
}
export interface ThemeDef {
  id: string;                      // [a-z0-9-]{1,40}; the four built-in ids are reserved
  name: string;
  version: 1;
  parts: ThemePart[];
  branch?: { natural?: string };   // colBranch source "theme"
  /** name -> PNG data URL, at most 256 x 256 each. */
  textures?: Record<string, string>;
}
export const BUILTIN_THEMES: ThemeDef[] = [
  { id: 'branches', name: 'Branches', version: 1, parts: [] },
  { id: 'leaves', name: 'Leaves', version: 1, parts: [
    { place: 'spaced', shape: 'leaf', size: 1, amount: 1, role: 'leaf', natural: '#52c757', flutter: 1 },
    { place: 'tips', shape: 'blossom', size: 1, amount: 1, role: 'accent', natural: '#ffd1e6', glow: 1.4, opens: 'bloom', flutter: 0.4 } ] },
  { id: 'thorns', name: 'Thorns', version: 1, parts: [
    { place: 'spaced', shape: 'thorn', size: 1, amount: 1, role: 'leaf', natural: '#ebdbb3', flutter: 0, sizeFrom: 'effort' } ] },
  { id: 'wreath', name: 'Christmas wreath', version: 1, parts: [
    { place: 'every', shape: 'needle', size: 1, amount: 1, role: 'leaf', natural: '#298c4d', glow: 0.5, flutter: 0.5 },
    { place: 'clusters', shape: 'berry', size: 1, amount: 1, role: 'accent', natural: '#e61424', glow: 1.3, flutter: 0.3 },
    { place: 'pairs', shape: 'holly', size: 1, amount: 1, role: 'leaf', natural: '#1a7333', flutter: 0.8 } ] },
];
```

First version: the four built-ins keep their current code path in `deco.ts` and only read
`natural` from this table. Custom themes run through one new generic loop over `parts` (one
`switch (part.place)` whose cases are copies of today's five blocks with `size`, `amount`, shape id
and ink taken from the part). Port the built-ins onto the generic loop later, once the two paths
have been compared side by side.

`look.theme` widens from the four-name union to `string` (a theme id). `Theme` in `features.ts`
becomes `string`; unknown ids fall back to `leaves` until the theme has loaded.

### C.2 Where themes live and how they reach OBS

OBS's browser is a separate browser profile, so `localStorage` and IndexedDB never reach it (the
reason the avatar PNG is preview-only). Themes therefore live with Sprout.exe:

```
<folder of Sprout.exe>\themes\sakura.json        one file per theme, textures embedded as data URLs
```

Not inside `viewer/dist`: `vite build` empties that folder.

One file per theme (instead of JSON plus PNG files) keeps the server work small and makes a theme
one thing to share, back up, or drop into the folder by hand. The page shrinks every texture to
at most 256 x 256 before embedding, so a theme with six textures stays near 300 KB.

Changes in `app/FeatureServer.cpp` (small, all in existing paths):

1. **Read:** `GET /theme-files/<id>.json` serves from the `themes` folder; `GET
   /theme-files/index.json` returns the ids found there (`FindFirstFileW` on `*.json`), e.g.
   `["sakura","autumn"]`. Add the prefix check before the `webRoot` lookup. The path checks that
   exist (`..`, `\`) stay.
2. **Write:** a WebSocket message, not an HTTP upload (the HTTP handler has no body reading and
   is GET-only; the WebSocket path already parses frames and routes typed messages to the app):
   `{"type":"themeSave","id":"sakura","data":"<base64 of the JSON file>"}` and
   `{"type":"themeDelete","id":"sakura"}`. Add both prefixes next to `tapLook` / `detect` at the
   `appInbox` test so they are **not relayed** to other viewers. Raise `kMaxRequestSize` to 2 MB
   (it is also the largest WebSocket message). The app validates the id against
   `[a-z0-9-]{1,40}`, decodes base64 (about 15 lines; the encoder is already there), writes
   `<id>.json.tmp`, renames it, and refuses more than 64 themes.
3. **Notify:** after a save or delete, broadcast `{"type":"themes","rev":<counter>}`; every
   viewer (OBS included) re-fetches the index and any theme it is showing.
4. **Safety:** any local web page can open `ws://localhost:7777`. Accept `themeSave` /
   `themeDelete` only on connections whose `Origin` header at the upgrade was
   `http://localhost:<port>`, `http://127.0.0.1:<port>` or the dev server (`:5173`). Only a
   validated file name inside `themes` is ever written.

Always-available fallback with no page at all: copy a theme `.json` into the folder and reload.

### C.3 The /themes page

`http://localhost:7777/themes` already loads the viewer (extensionless routes serve
`index.html`). In `main.ts`, next to the `/controls` test, add `themesPage`. It runs the normal
renderer with the fake singer, one take and one halo, and replaces the tweak panel with the
editor:

| Area | Contents |
| --- | --- |
| Left | Theme list: built-ins (read-only, "Duplicate to edit"), your themes, "New theme", "Import...". |
| Centre | Live preview: the real renderer showing the theme being edited on every layer. Edits apply here at once and are **not** synced until Save. Backdrop switch (checker / black). |
| Right | Tweakpane: name; per part a folder with place, shape (built-in shapes and this theme's textures as thumbnails), a drop zone "drop a PNG here", size, amount, colour role, natural colour, colour mode (tint / own), glow, flutter, opens on held notes; "Add part", "Remove part". |
| Bottom | Save (sends `themeSave`), Use in viewer (sets `look.theme` to this id and `look.themeFrom` to `preset`, synced), Export (.json download), Delete. |

Texture rules shown next to the drop zone: PNG with transparency; drawn pointing **up**, with the
stalk at the bottom centre (as the built-in shapes are, base to tip); white or grey for "tint",
full colour for "own"; it is scaled to fit 256 x 256.

### C.4 Drawing textures

Same instanced draw, same batch, same shader as the SDF shapes. That is the important choice:
decorations are drawn in one back-to-front batch per layer group, and a second program would
break their ordering against each other.

- One `TEXTURE_2D_ARRAY`, `RGBA8`, 256 x 256 x 16 layers (4 MB, 5.3 MB with mipmaps), allocated
  only when a custom theme with textures is in use; a 1 x 1 x 1 dummy is bound otherwise.
- Each texture is drawn into a 256 x 256 canvas (fit inside with a 2 px transparent border,
  bottom-centred), uploaded with `UNPACK_PREMULTIPLY_ALPHA_WEBGL` true, then `generateMipmap`,
  `LINEAR_MIPMAP_LINEAR`, `CLAMP_TO_EDGE`. Leaves are 10 to 40 px on screen and flutter, so
  mipmaps are needed against shimmer. An array (not an atlas) means no bleeding between
  neighbours in the small mip levels.
- Shape ids 16..31 are texture layers 0..15. Per-layer facts go in one uniform array.

```glsl
// sprite.frag
uniform highp sampler2DArray u_tex;
uniform vec4 u_texInfo[16];            // x = half-width (0.5 * aspect), y = flutter, z = 1 if "own" colours
...
if (shape >= 16) {
  vec4 info = u_texInfo[shape - 16];
  vec2 uv = vec2(x / (2.0 * info.x) + 0.5, 1.0 - y);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 tx = texture(u_tex, vec3(uv, float(shape - 16)));         // premultiplied
  float gain = max(v_col.r, max(v_col.g, v_col.b));
  vec3 rgb = tx.rgb * mix(v_col.rgb, vec3(gain), info.z);        // tint, or own colours x brightness
  float a = tx.a * v_col.a;
  if (a <= 0.003) discard;
  o_colour = vec4(rgb * v_col.a, a);
  o_glow = vec4(rgb * v_col.a * v_glow, a);
  return;
}
```

`sprite.vert`: for `sid >= 15.5` take `hw` and `leafy` from `u_texInfo[int(sid) - 16]` (`.x`,
`.y`) instead of the constant tables. One texture fetch per fragment is cheaper than the blossom
SDF (which calls `atan`); the cost to watch is overdraw from large, mostly transparent textures,
so the page warns when a texture's opaque area is under 25 % of its box.

For "own" colour parts `deco.ts` passes white times intensity (it skips `inkAt`).

### C.5 How a track picks a custom theme

The tap's Theme is an `AudioParameterChoice` with a fixed list. Growing that list at run time is
not safe (hosts store the value normalised over the item count), so the enum stays as it is.

**First version (no tap, bus or enum change):**

- A custom theme is the **viewer's** theme: `look.theme = '<id>'`. It shows on every track whose
  tap says "Viewer default", and on all tracks when "theme comes from" is "this preset".
- A visual preset that uses a custom theme also stores `look.themeFrom: 'preset'` (it is a visual
  key already), so picking the preset shows the theme everywhere at once.
- `presetApplied` in `ui.ts` sends `tapLook` with the theme only when it is one of the four
  built-in names; for a custom id it sends the density alone (give `handleTapLook` in
  `app/main.cpp` a "theme absent: keep the tap's theme" case, or skip the message).

**Later (per-track custom themes), in this order of preference:**

1. Bus v4: the app writes the theme names into the bus header (`char themeNames[16][32]` and a
   revision counter); the tap editor gets a second box "Custom theme" filled from it and stores
   the chosen **id as a string in the plugin state** (not a parameter); `SlotInfo` gains
   `char customTheme[32]`, which wins over the enum when not empty. Names survive renumbering,
   and a project that names a missing theme falls back to its enum value.
2. Not recommended: fixed "Custom 1..8" enum entries. They mean nothing in a saved project once
   the theme list changes.

### C.6 What can wait

Per-track custom themes (C.5), porting the built-ins to the generic loop, custom branch line
styles (dashes, textures along strokes), animated textures, more than 16 textures, per-part
colour sources beyond the two roles, sharing themes online.

---

## D. Panel restructure

### D.1 Principle: a tab is a preset kind

Today each folder mixes visual and reactivity keys (Glow holds `strength` and `levelGain`; Live
halo holds `tailDeg` and `singSpeed`), so "which preset owns this slider" is invisible. New top
level, one Tweakpane tab bar:

| Tab | Holds | Preset picker at its top |
| --- | --- | --- |
| **Look** | every visual key, plus the take palette (rig) in a marked sub-folder | Visual |
| **Reaction** | every reactivity key, grouped by what the voice does | Reactivity |
| **Setup** | rig and local keys: fit, detection, performance, connection, test | Testing (inside Test & preview) |

The Presets folder with its three inner tabs goes away; each tab starts with its own preset rows
(list, Save, Save as, Revert all, Export / Import), same code as `sec.page` today. The status
readouts (feed, layers, pitch, voice) stay above the tab bar.

Nothing about how values behave changes. No key is renamed. Folder ids change, so stored
open/closed state (`sprout.viewer.panel.v1`) starts fresh.

Basic and advanced: each folder keeps 3 to 7 rows and its `Advanced` fold, as now. Add one
switch in the panel header, "show advanced" (stored with the panel state, default off), that
hides every `Advanced` fold for a clean artist view.

### D.2 Macros

A macro is a slider that is **not a setting**. It writes several existing keys along a line
through three anchor points (0, 0.5 = default, 1) and reads its position back from the first
target. Presets, sync and revert see only the real keys, so nothing else changes.

```ts
export interface MacroSpec { id: string; label: string; tip: string; folder: string;
  targets: { path: string; at: [number, number, number] }[] }

export const MACROS: MacroSpec[] = [
  { id: 'fullness', folder: 'theme', label: 'fullness',
    tip: 'Sparse to overgrown: branch density, leaf amount and permanent halo leaves together.',
    targets: [{ path: 'growth.branching', at: [0.3, 0.6, 0.95] }, { path: 'look.density', at: [0.3, 0.55, 0.85] },
              { path: 'halo.alwaysLeaves', at: [0.2, 0.4, 0.7] }] },
  { id: 'liveliness', folder: 'rpreset', label: 'liveliness',
    tip: 'How strongly everything answers the voice: brightness, glow, sway and push together.',
    targets: [{ path: 'response.brightness', at: [0.5, 0.7, 1] }, { path: 'glow.levelGain', at: [0.5, 0.8, 1.6] },
              { path: 'glow.onsetGain', at: [0.3, 0.7, 1.8] }, { path: 'motion.swayDeg', at: [4, 8, 12] },
              { path: 'motion.kickDeg', at: [3, 6, 12] }] },
  { id: 'pace', folder: 'rpreset', label: 'pace',
    tip: 'Slow and lingering to fast and snappy: grow time, fades, settle time and halo speeds together.',
    targets: [{ path: 'growth.secondsToFull', at: [6, 3.5, 1.8] }, { path: 'growth.fadeAfter', at: [6, 3, 1.5] },
              { path: 'growth.fadeSeconds', at: [5, 2.5, 1.2] }, { path: 'response.release', at: [3, 1.4, 0.7] },
              { path: 'halo.idleSpeed', at: [5, 8, 20] }, { path: 'halo.singSpeed', at: [40, 70, 160] }] },
];
const macroValue = (m: number, [a, b, c]: number[]) => (m < 0.5 ? a + (b - a) * m * 2 : b + (c - b) * (m - 0.5) * 2);
```

The anchors are the Subtle / default / Punchy, Calm / default / Punchy and Minimal / default /
Lush ivy preset values. When the targets do not sit on the line (the artist moved one by hand),
the macro label shows "~" and the knob sits at the first target's position; moving the macro puts
all targets back on the line.

The Colours folder gets the same idea as buttons, "movement" per role: Still (`along 0, speed 0,
scatter 0`), Root to tip (`along 1`), Flow (`along 0.3, speed 0.05`), Sparkle (`scatter 1`),
Sing it (`voice 'pitch', voiceAmount 1`).

### D.3 Folder map

`tab` is new in `FolderSpec`; `sub` are nested folders with their own title. Keys listed once.

```ts
export interface FolderSpec { id: string; tab: 'look' | 'reaction' | 'setup'; title: string; open?: boolean;
  keys: string[]; advanced?: string[]; sub?: { id: string; title: string; keys: string[] }[];
  catchSections?: string[] }

const ROLE = (s: string) => [`${s}.source`, `${s}.gradient`, `${s}.takeMix`, `${s}.along`, `${s}.speed`,
  `${s}.voice`, `${s}.voiceAmount`, `${s}.perTake`, `${s}.scatter`];

export const FOLDERS: FolderSpec[] = [
  // ---------------- Look (visual preset) ----------------
  { id: 'colours', tab: 'look', title: 'Colours', open: true,
    keys: ['look.tint', 'look.tintAmount'],
    sub: [
      { id: 'colBranch', title: 'Branches', keys: ROLE('colBranch') },
      { id: 'colLeaf', title: 'Leaves', keys: ROLE('colLeaf') },
      { id: 'colAccent', title: 'Blossoms & berries', keys: ROLE('colAccent') },
      { id: 'colHalo', title: 'Halo ring & vine', keys: ROLE('colHalo') },
      { id: 'palette', title: 'My take colours (kept across presets)',
        keys: ['colours.live', 'colours.take1', 'colours.take2', 'colours.take3', 'colours.take4',
               'colours.take5', 'colours.take6', 'colours.take7', 'source.useTrackColours'] },
    ],
    catchSections: ['colBranch', 'colLeaf', 'colAccent', 'colHalo', 'colours'] },

  { id: 'theme', tab: 'look', title: 'Theme & leaves',                      // + macro "fullness" first
    keys: ['look.theme', 'look.themeFrom', 'look.density', 'look.decoSize', 'look.variety', 'look.depthShade'] },
    // + button "Edit themes..." (opens /themes)

  { id: 'shape', tab: 'look', title: 'Tree shape',
    keys: ['growth.reach', 'growth.flatten', 'growth.branching', 'growth.spread', 'plants.lift',
           'plants.wildness', 'plants.taper'],
    advanced: ['plants.clearance', 'plants.tipWidth', 'plants.maxWidth'] },

  { id: 'halo', tab: 'look', title: 'Live halo',
    keys: ['halo.origins', 'halo.bothWays', 'halo.tailDeg', 'halo.sproutLength', 'halo.sproutCurl',
           'halo.alwaysLeaves', 'halo.wander'],
    advanced: ['halo.startAngle', 'halo.tailFade', 'halo.ringWidth', 'halo.vineWidth', 'halo.sproutWidth',
               'halo.ringSpacing'] },

  { id: 'glow', tab: 'look', title: 'Glow',
    keys: ['glow.strength', 'glow.radius', 'glow.base', 'look.decoGlow', 'glow.tint', 'glow.tintAmount'],
    advanced: ['glow.wide', 'glow.crowd', 'glow.inkMask', 'glow.knee'] },

  { id: 'many', tab: 'look', title: 'Many takes',
    keys: ['plants.overlap', 'layout.shrinkPerTake', 'layout.spinSpeed', 'layout.spinFrom'],
    advanced: ['layout.tierFrom', 'layout.innerScale', 'layout.ease', 'plants.step', 'plants.maxNodes'] },

  // ---------------- Reaction (reactivity preset; macros "liveliness" and "pace" under the preset) ----------------
  { id: 'phrases', tab: 'reaction', title: 'Singing & phrases: growing', open: true,
    keys: ['growth.secondsToFull', 'growth.newTreeEachPhrase', 'response.phraseGap', 'growth.fadeAfter',
           'growth.fadeSeconds', 'growth.restBrightness', 'response.release'],
    advanced: ['response.variety', 'plants.moodShaping'] },

  { id: 'pauses', tab: 'reaction', title: 'Pauses: withering',
    keys: ['growth.witherOnPause', 'growth.witherDepth'],
    advanced: ['growth.witherSeconds', 'growth.witherOnPitchDip', 'growth.witherDipSemitones',
               'growth.twigFadeSeconds', 'growth.regrowSpeed'] },

  { id: 'loud', tab: 'reaction', title: 'Loudness: brightness, wind, halo speed',
    keys: ['response.brightness', 'glow.levelGain', 'motion.swayDeg', 'motion.idle', 'halo.singSpeed',
           'halo.sproutRate'],
    advanced: ['halo.idleSpeed', 'motion.flutterDeg', 'motion.speed'] },

  { id: 'onsets', tab: 'reaction', title: 'Note starts: flash and push',
    keys: ['glow.onsetGain', 'motion.kickDeg', 'motion.springiness'],
    advanced: ['motion.twigs', 'glow.front', 'halo.sproutGrow'] },

  { id: 'timbre', tab: 'reaction', title: 'Pitch, effort and softness',
    keys: ['response.pitchSteer', 'glow.pitchShine', 'response.effortWidth', 'look.thornEffort',
           'glow.softGlow', 'plants.softDroop'] },

  { id: 'held', tab: 'reaction', title: 'Held notes & vibrato: blossoms, shiver',
    keys: ['look.blossoms', 'look.blossomHold', 'motion.shiver', 'motion.shiverDeg', 'motion.shiverSensitivity'],
    catchSections: ['motion', 'response'] },

  { id: 'commit', tab: 'reaction', title: 'Planting a take & removal',
    keys: ['commit.enabled', 'commit.duration', 'commit.impact', 'commit.burst', 'commit.shockRing'],
    advanced: ['commit.plunge', 'commit.spinTurns', 'commit.stampReveal', 'commit.syncToOnset',
               'commit.syncWindow', 'transitions.liveEndSeconds', 'transitions.pruneSeconds', 'halo.spawnSeconds'],
    catchSections: ['commit', 'transitions'] },
    // + the two test buttons, as today

  // ---------------- Setup (unchanged content; no "Setup:" prefix needed inside the tab) ----------------
  { id: 'fit', tab: 'setup', title: 'Fit to avatar', open: true,
    keys: ['scene.showGuides', 'scene.viewRadius', 'scene.centerX', 'scene.centerY', 'halo.restRadius',
           'halo.restY', 'halo.openRadius', 'halo.openY', 'halo.restX', 'halo.squish', 'halo.tilt',
           'layout.lowOriginY', 'layout.midOriginY', 'layout.downGap', 'avatar.avoid'],
    advanced: ['avatar.headX', 'avatar.headY', 'avatar.headR', 'avatar.bodyTopY', 'avatar.bodyBottomY', 'avatar.bodyR'],
    catchSections: ['avatar'] },
  { id: 'detect', tab: 'setup', title: 'Voice detection',
    keys: ['detect.vibratoMinNote', 'detect.vibratoMinSemitones', 'detect.vibratoFullSemitones',
           'detect.vibratoMinHz', 'detect.vibratoMaxHz'], catchSections: ['detect'] },
  { id: 'perf', tab: 'setup', title: 'Performance',
    keys: ['perf.fps', 'perf.idleFps', 'perf.backgroundFps'],
    advanced: ['perf.maxMegapixels', 'perf.renderScale'], catchSections: ['perf'] },
  { id: 'connection', tab: 'setup', title: 'Connection & sync',
    keys: ['source.mode', 'source.syncSettings', 'source.holdSeconds'],
    advanced: ['source.port'], catchSections: ['source'] },
  { id: 'test', tab: 'setup', title: 'Test & preview (this viewer only)',
    keys: ['scene.showScope', 'scene.scopeLayer', 'scene.scopeSeconds', 'scene.backdrop', 'scene.showAvatar',
           'avatar.opacity', 'avatar.useImage', 'avatar.imageX', 'avatar.imageY', 'avatar.imageHeight',
           'scene.paused', 'scene.timeScale', 'scene.layers', 'fake.liveTracks', 'fake.recording'],
    advanced: ['fake.seed', 'fake.phraseMin', 'fake.phraseMax', 'fake.gapMin', 'fake.gapMax', 'fake.highNotes', 'fake.noteMax'],
    catchSections: ['scene', 'fake'] },
];
```

Coverage: every key of today's `params.ts` (172, including the new `look.blossomHold` and `fake.noteMax`) appears exactly once, except the three that are
removed by migration (`colours.mode`, `colours.rainbowSpeed`, `look.naturalTint`). New keys:
36 in the four `col*` sections, `glow.tint` and `glow.tintAmount`.
Checked by script against `params.ts`.

Add a dev-time assert in `buildUI`: every key in a `look` tab folder has `kindOf(path)` `visual`
or `null`, every key in a `reaction` folder `reactivity`. With the map above this holds for the
current `REACTIVE` set (`look.blossomHold` is already in it). `plants.step` and `plants.maxNodes`
move from Test & preview to Many takes > Advanced because they are visual keys that presets set.

`scopeOf` / `kindOf` additions: nothing for `col*` (they fall through to `look` / `visual`);
`glow.tint*` likewise.

### D.4 Labels that change or are new

```ts
Object.assign(LABELS, {
  'look.tint': 'lean everything toward', 'look.tintAmount': 'how far',
  'look.theme': 'theme', 'look.themeFrom': 'theme comes from',
  'glow.tint': 'glow colour', 'glow.tintAmount': 'glow colour amount',
  'look.blossomHold': 'blossoms after holding (s)', 'look.blossoms': 'blossom amount',
  'look.thornEffort': 'thorns grow with effort', 'glow.levelGain': 'glow', 'response.brightness': 'brightness',
  'motion.swayDeg': 'wind sway (deg)', 'halo.singSpeed': 'halo speed (deg/s)', 'halo.sproutRate': 'halo shoots per second',
  'glow.onsetGain': 'flash', 'motion.kickDeg': 'push (deg)', 'glow.front': 'growing-edge glow',
  'glow.pitchShine': 'high notes shine', 'response.effortWidth': 'effort thickens branches',
  'glow.softGlow': 'soft voice glows wider', 'plants.softDroop': 'soft voice droops new trees',
  'response.release': 'settle time after a phrase (s)',
});
for (const s of ['colBranch', 'colLeaf', 'colAccent', 'colHalo']) Object.assign(LABELS, {
  [`${s}.source`]: 'colour from', [`${s}.gradient`]: 'gradient', [`${s}.takeMix`]: 'take colour mixed in',
  [`${s}.along`]: 'spread root to tip', [`${s}.speed`]: 'flow speed', [`${s}.voice`]: 'voice moves it',
  [`${s}.voiceAmount`]: 'how far', [`${s}.perTake`]: 'shift per take', [`${s}.scatter`]: 'random per leaf',
});
LABELS['colHalo.along'] = 'spread round the ring';
```

Inside the feature folders the shorter labels work because the folder title names the cause
("Loudness: ..." then "brightness", "glow", "wind sway"). Tooltips keep their "Reads:" lines.
Source dropdown texts: "The take's colour", "The theme's natural colours", "A gradient"; for the
halo also "Same as the branches".

New folder hints (`FOLDER_HINTS`): `colours`: "What colours everything. Each part takes its
colour from the take, from the theme's natural colours, or from a gradient that can move with
time, along the branch, or with your voice. Your own take colours are kept across presets.";
`loud`: "Everything your loudness drives."; `onsets`: "What happens at the start of every
note."; `timbre`: "What high notes, full singing and soft, breathy singing change."; `held`:
"What a long held note and vibrato do."

---

## E. Build order

### Sitting 1: colours

1. `gradient.ts` (parse, format, bake, presets) with a few console checks: the Rainbow string
   baked at 0, 1/6, 1/3 equals `hsv2rgb(h, 0.7, 1)`.
2. `colour.ts` (`Ink`, `setInk`, `inkAt`); new `params.ts` sections; `migrate()` for
   `colours.mode`, `rainbowSpeed`, `naturalTint` (settings, user presets, imports); update the
   built-in presets.
3. Plug into `main.ts` (`pushTree`, `pushRing`, `drawPlant`, `drawHalo`, commit colours) and
   `deco.ts`; move the natural colours into a small table (the start of `themes.ts`).
4. **Check before going on:** with defaults, `sprout.pixels()` and a screenshot must match the
   build before the change (leaves theme and wreath theme). Thorns and blossoms will differ
   slightly (A.3).
5. `gradient-editor.ts` and the gradient row in `ui.ts`; temporary flat "Colours" folder with the
   four role sub-folders. Glow tint uniform.

### Sitting 2: panel, then themes

6. `FolderSpec.tab` and `sub`, the three-tab layout, preset pickers moved into their tabs, the
   kind assert, "show advanced", macros.
7. Themes, read side: `themes.ts` types, `/theme-files/` routes in `FeatureServer.cpp`, loading
   and the generic `parts` loop in `deco.ts`, the texture array and shader branch. Test with a
   hand-written theme file in the folder.
8. Themes, write side: `/themes` page, `themeSave` / `themeDelete`, the `themes` broadcast.

### Risky parts

| Risk | Why | Mitigation |
| --- | --- | --- |
| `deco.ts` regressions | Every `tint()` call changes; the take path has subtle per-leaf variety | Step 4 comparison before any UI work; keep `natScale` identical to today's factor |
| Gradient drag over sync | A drag sends a 60 to 200 character string many times a second to every viewer | Throttle to 15 per second; the existing 1 s "being dragged" guard covers echoes |
| String rows in `ui.ts` | Strings starting with `#` become colour pickers; other strings get a text input | The encoding starts with a letter; build gradient rows explicitly from `RANGES` |
| Old presets and settings | User presets hold `look.naturalTint` and `colours.mode` | Migrate at load and at import, not only in `loadParams` |
| Commit animation colours | It carries single colours through `HaloSnapshot` and `CommitTarget` | Use `ink.mid`; accept a one-colour ring during the flight |
| Texture branch in the sprite shader | A sampler array plus a dynamic branch on OBS's Chromium 127 and integrated GPUs | Bind the dummy texture always; measure with `sprout.bench(240)` and `?obs&perflog` using a 6-texture theme at density 1 |
| Overdraw from textures | Large, mostly transparent PNGs cost fill rate that SDF shapes do not | 256 px cap, the 25 % coverage warning, quad width from the image aspect |
| C++ changes | 2 MB message cap, file writes from a WebSocket message, base64 decode | Origin check, id pattern, write to `.tmp` then rename, cap of 64 files |
| Panel tab move | `panelState` ids, scope links ("click a value to open it in the panel") resolve folders by path | Rebuild `pathFolders` to include the tab, so a scope link first selects the tab |
| `look.theme` as free string | `Theme` union is used in `features.ts`, `main.ts`, `deco.ts`, the fake source | Widen the type once; unknown id falls back to `leaves` |
