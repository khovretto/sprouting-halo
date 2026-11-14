# Design consult 2: the take tree — flattened, wide, cradling, evenly spread, textured

Answer to `docs/fable-brief-2.md`. Scope: the take tree only (generator + its rendering).
Nothing here was built or run; ink and density figures are estimates worked out from the code and
defaults, and are marked as such. Section numbers follow section 5 of the brief.

## Summary

- **Why it blobs:** every limb starts from one apex and leaves the silhouette through the same
  notch, so stroke density falls as 1/r and is highest exactly where the plant becomes visible.
  On top of that the plant carries about as much leaf area as it has footprint, leaves are drawn
  over all strokes in one hue with no edge, and the bloom is a linear sum (about 3.3 x emission in
  a covered region) that clips to a flat colour. Repulsion moves the knot around; it cannot remove it.
- **Generator:** replace "spine + feathers" by **hub, territory and sector subdivision**. All
  plants share one flattened outline (a superellipse about a hub behind the neck) and tile its arc
  with angular territories. Tips are placed evenly on the outline first; limbs are then grown
  *to* them, forking on the way out so the number of limbs rises with radius. Ivy shoots are only
  spawned into free space, found by probing an occupancy grid.
- **Repulsion:** retire the per-step pairwise repulsion. Its intent (do not bunch) is delivered by
  construction (even tips, sector budgets) and by space claiming for shoots (choose the freest of
  a few directions once, at spawn; stop short of claimed cells). That is kink-free and deterministic.
- **Rendering, in order of value for cost:** (1) crowd-compensated bloom using the blurred
  coverage that is already in the glow buffer's alpha, (2) blue-noise leaf placement with a
  guaranteed minimum spacing, (3) a dark rim and base-to-tip gradient on every leaf, (4) a
  dim-inside, bright-outside tone ramp plus per-limb and per-leaf variety, (5) luminance-equalised
  glow per take colour, (6) an under-leaf layer, (7) thinner stems with a shaded edge.
- **Tests:** an ink-coverage grid gives `blobMax`, `blobShare`, `emptyShare`, `evenness`,
  `overdraw`, `aspect` and `arcCover`; a pixel readback gives `saturatedShare` and `localContrast`.

One correction to my first consult: A7 said six takes should read "as a star". The artist has
since rejected stars and triangles. The target outline is now one broad, flattened canopy.

---

## 0. What the frames show

1. **`1-liked-3takes-leaves-before-repel.jpg`** — Three plants at 9, 12 and 3 o'clock. The blue
   top plant is a symmetric fan about 170 degrees wide; you can follow single branches and count
   leaves, and there is dark background between them. The yellow-green and cyan side plants are
   horizontal lozenges whose inner halves (where they cross the halo ring) are a solid bright
   patch; only their outer fringe has texture. The composition is a "T": nothing below the
   horizontal except the ring.
2. **`2-3takes-leaves-repel-off.jpg`** — Same structure at 800 x 600. The blue crown is taller
   than wide and ends in a rough point. The side plants are dense balls centred at about
   x = +/-0.95 (on the ring), one-sided upward, with a saturated core roughly 0.5 units across.
   The empty quadrants at 7-8 and 4-5 o'clock look accidental.
3. **`3-3takes-leaves-repel-0.6.jpg`** — Repulsion on. The crown is flatter and wider (the best
   part). Side plants now spread up and down and trail toward 7 and 5 o'clock, so the overall mass
   starts to wrap. The outer third of every plant is good: separate twigs with leaves. The cores
   at the ring crossings are unchanged: flat yellow and flat cyan.
4. **`4-3takes-bare-branches-repel-0.6.jpg`** — Bare structure. A thick, straight, bare spine
   runs from the neck to each ring crossing; six to ten limbs then leave from a stretch about 0.3
   long, nearly parallel, before they fan. That bundle is the core of the blob. Further out the
   twigs zigzag in sharp kinks (lightning, not ivy) and cross each other. The crown is a vertical
   trunk with near-horizontal, angular arms.
5. **`5-2takes-leaves-repel-0.6.jpg`** — Two takes. The yellow plant's core is fully saturated
   with no internal detail over about a quarter of the plant. The blue plant has the same
   structure and density but still shows leaf shapes in its core, and its lower limbs trail down
   past the ring to about y = -1.1, which reads as holding the figure.

---

## 1. Diagnosis

### Structure (why it bunches)

1. **One apex.** All feathers hang off one spine rooted at the neck. Limbs radiating from a point
   have a density proportional to 1/r, so the densest place is the smallest visible radius. No
   steering rule changes this; only adding limbs with distance does. (Frame 4.)
2. **Base packing plus the head clamp make a bundle.** Feathers attach at
   `u = lerp(0.1, 0.88, x^1.35)`, so about half of the 11 feathers (branching 0.65, three takes)
   attach in the first 0.6 units of a 1.5 spine, which is inside or at the silhouette. The head
   clamp then holds each within 28 degrees of radial as it leaves. They exit through the same notch
   between head and shoulder, side by side. (Frame 4: the parallel stretch at the ring crossing.)
3. **Narrow, one-sided footprint.** A three-take wedge has a half-angle of about 43 degrees and
   `sweep` 0.75 puts roughly three quarters of the feathers on the upper side. The usable
   footprint is about 1.2 to 1.5 square units while the quadrants below the horizontal stay
   empty. (Frames 1 and 2.)
4. **Shoots ignore their neighbours.** `addShoots` sets count and length from the host's length
   alone, to three levels. Between feathers that are already 0.1 apart this is pure overdraw.
5. **Repulsion treats the symptom.** It is per step, pairwise and order dependent. The push
   direction flips from step to step, which gives the kinks in frame 4, and it turns limbs
   tangential (your metrics: 10 % to 29-36 % of length over 60 degrees off radial). It spreads the
   outer fringe, which is why frame 3 improved, but 11 limbs still share an apex.
6. **The long, thick, bare spine.** `maxWidth` 0.035 is a radius: the spine is 0.07 units wide,
   about 11 px at 600 px height, and runs straight through the knot.

### Ink budget (why it is textureless) — estimates from the code

For one three-take side plant at the defaults:

| Quantity | Estimate |
| --- | --- |
| Stroke length (spine 1.5, 11 feathers of about 0.85, about 50 shoots of about 0.3, sub-shoots) | about 30 units |
| Stroke area at a mean width of about 0.025 | about 0.75 square units |
| Leaves (0.25 chance per node at step 0.03, plus every terminal) | about 350 |
| Area of one leaf (0.099 long, 0.067 wide almond) | about 0.004 square units |
| Leaf area | about 1.4 square units |
| Visible footprint | about 1.2 to 1.5 square units |

So the plant carries about 2 square units of ink for 1.2 to 1.5 square units of footprint, and
the distribution is 1/r. Mean coverage is above 100 %; the core is covered several times over.
Texture needs gaps: a readable mass sits at 30 to 40 % coverage.

### Rendering (why the covered area goes flat)

7. **Leaves hide the branches.** Batch order is all strokes, then all leaves. In the core you
   only see leaves.
8. **Leaves do not separate from each other.** One hue per plant, `naturalTint` 0.35 for all, no
   brightness variation, and the only internal detail is a thin midrib. Two overlapping leaves
   merge into one shape.
9. **Bloom is linear in coverage.** `composite.frag` adds
   `(0.45 g1 + 0.7 g2 + 0.9 wide g3) * strength`. In a region that is uniformly covered, all three
   levels equal the emission, so the sum is about 2.05 x 1.6 = 3.3 x emission. With stroke glow
   around 0.8 while singing that is 2.6 x colour on top of the colour; with leaf glow (x 0.3) it
   is still about 0.8 x colour. `min(rgb, a)` then clips it to a flat full-channel colour. Any
   region above roughly one third coverage saturates. A threshold on emission would not help,
   because the per-pixel emission is the same everywhere; the problem is the spatial sum.
10. **Yellow clips long before blue.** Luma of take 1 (`#b5e61d`) is about 0.80, of take 2
    (`#3d4fd6`) about 0.33. The same structure blobs in yellow and survives in blue. (Frame 5.)

### Why the top blue plant is "best"

It has roughly twice the territory (a fan of about 170 degrees instead of a one-sided wedge), it
is symmetric, the head hides its apex and bundle, and blue is far from clipping. That is the
recipe: a larger, even territory per plant, the apex hidden, and density and glow bounded.

---

## 2. Generator revision: hub, territory, sector subdivision

### 2.1 The form

- **Hub.** One point behind the neck, `C = (avatar.headX, layout.midOriginY)` in world space.
  Every plant's limbs start there. For wings and wedges the hub is the root. For the single
  crown the root stays at `lowOriginY` and a short hidden trunk rises to the hub.
- **Common outline.** All plants end on one curve about the hub: a superellipse, wider than tall.
  This is what makes one composition out of several plants.
- **Territories.** The arc that is not behind the body (`downGap`) is divided between the plants.
  Each plant fills its own sector of the band between the silhouette and the outline.
- **Limbs.** A plant throws a few *primaries* from the hub. They are straight and radial while
  hidden, cross the silhouette steeply, then arch toward tip targets that were placed evenly on the
  outline beforehand. On the way out each primary *forks*, so the limb count rises with radius and
  the density stays level.
- **Ivy shoots.** Every limb throws short alternating shoots at a regular spacing, as now, but a
  shoot exists only where a probe finds free space, and it ends before it reaches a claimed cell.
- **Moat.** No shoot or leaf comes within 0.08 of the silhouette. Only limbs cross that gap, and
  they cross it steeply. This is how the mass can cradle the figure without any limb hugging it:
  the foliage holds the avatar at a visible, even distance.

Reason for building to targets instead of steering freely: the artist's requirements are all
statements about the *result* (even, wide, flat, no knots). Placing the tips first makes them true
by construction; emergent steering made them a matter of luck per seed.

### 2.2 The cradle silhouette

Outline radius about the hub, for a world angle `phi` (0 = right, 90 degrees = up), in plant units:

```
a      = 2.15 * growth.reach          // horizontal half-width
b      = a * (1 - 0.6 * growth.flatten)   // top half-height; flatten 0.55 gives b = 1.44
bDown  = 0.85 * b                      // below the horizontal
E      = 2.4                           // superellipse exponent: slightly boxy, so the top is flat
rOut(phi) = ( (|cos phi| / a)^E + (|sin phi| / (sin phi >= 0 ? b : bDown))^E )^(-1/E)
```

With the defaults the canopy spans x = +/-2.15, tops out at y = 1.5 and its lowest tips sit near
(+/-1.3, -1.0), beside the upper arms. Width to height is about 1.7. The halo ring (radius 1.05)
runs through the middle of the band. At 800 x 600 (`viewRadius` 1.9) this leaves about 0.4 units of
margin at the sides and top.

Arc: `arcLo = -90 + downGap / 2`, `arcHi = 270 - downGap / 2` (degrees). With `downGap` 100 the
arc runs from -40 to 220 degrees. Apply it for every take count, including 1 and 2.

| Takes | Territories (degrees) | What the whole reads as |
| --- | --- | --- |
| 1 | one plant, [-40, 220]; root low, hidden trunk to the hub | a fountain or palm crown: fronds leave steeply and arch out and down to both sides |
| 2 | [90, 220] and [-40, 90]; plant angles 155 and 25 | two broad wings whose upper limbs meet and interleave over the head |
| 3 | [133, 220], [47, 133], [-40, 47] | a canopy over the head and two side masses that come down past the shoulders |
| 6 | six sectors of about 43 | one continuous canopy in six colour bands, each plant two primaries and four or five tips |
| 7+ | two tiers as now; the inner tier uses the same outline (its `scale` shrinks it) with sectors offset half a step and clipped to the arc | a second, smaller canopy inside the first |

Territories are widened by `0.25 * plants.overlap` of their width on each side (clipped to the
arc), so neighbouring plants interleave at the seams. That keeps "on top of one another" where it
looks good (single limbs crossing in the open) and removes it where it blobs (cores).

When `layout.spinSpeed` is not 0, set `b = bDown = a * 0.8` (a circle), because a world-referenced
flattening has no meaning for plants that rotate. Change `lengthMul` for five or more plants per
tier from 0.82 to 0.92: 0.82 was there to make a star, which is now unwanted.

**One composition.** Five things tie the plants together: the shared hub, the shared outline, the
shared moat, the same density target, and interleaved seams. Colour stays per take.

### 2.3 Space claiming: the decisions

| Option | Decision | Reason |
| --- | --- | --- |
| Per-step pairwise repulsion (current) | **Retire** (`repel`, `repelRadius`) | Order dependent, kinks, turns limbs tangential, cannot fix the shared apex |
| "Available space" budget per limb | **Adopt: sector subdivision** | Each limb owns a contiguous group of tips; children split the parent's group. Even by construction, no iteration |
| Even tip placement | **Adopt: stratified on the outline** | One dimension only, so stratified jitter does what Poisson-disk would do, more cheaply and with an exact count |
| Occupancy grid | **Adopt for shoots, the moat and the metrics** | A shoot probes a few directions, takes the freest, and stops short of claimed cells. Decided once at spawn, so no kinks |
| Poisson-disk | **Adopt for leaves** (section 3, R2) | Leaf pile-up is the larger share of the blob; a minimum spacing bounds coverage |
| Light-seeking / space colonisation | **Reject** | It is the old generator: even fill, but no gesture and no control of where limbs cross the silhouette |
| Cross-plant shared grid | **Reject** | Trees are rebuilt per phrase at different times and keep their form on re-layout; territories give the same result without coupling |

The probe-and-choose rule for shoots is the artist's "branch paths weakly repelling each other",
in a form that cannot zigzag: the branch decides where the room is before it grows.

### 2.4 Parameters and derived values

| Name | Value | Meaning |
| --- | --- | --- |
| `gTip` | `lerp(0.60, 0.28, branching)` | spacing of limb tips along the outline |
| `nTip` | `clamp(round(outlineArc / gTip * detail), 3, 20)` | tips for this plant |
| `nPrim` | `clamp(round(emergeArc / 0.20), 2, min(nTip, 7))` | primaries from the hub |
| `kE` | `clamp(1.05 - 0.4 * spread, 0.3, 1)` | how far emergence angles are squeezed toward the sector centre (1 = straight rays, lower = stronger arch) |
| ragged | tip radius x `(1 - 0.28 * wildness * rand)`, odd tips x 0.92, one hero x 1.06 | keeps the outline irregular without making a star |
| `shootGap` | `lerp(0.22, 0.09, branching)` | spacing of shoots along a limb |
| `shootMax` | `lerp(0.16, 0.34, branching)` | longest shoot |
| `clearance` | `plants.clearance`, 0.045 | gap a shoot keeps from other branches |
| `MOAT` | 0.08 | gap between silhouette and foliage |
| `CELL` | 0.06 | occupancy cell (two steps; about 9 px at 600 px height) |
| `kMax` | 6 rad/unit for limbs, 10 for shoots | turn-rate cap; minimum bend radius 0.17 / 0.10 |
| widths (radius) | primary `0.42 * maxWidth` = 0.0147; fork = parent at the fork x 0.8; shoot = `min(host x 0.6, 1.2 * tipWidth)`; `tipWidth` 0.006 | thinner inner stems |
| shoot depth | 2 at branching > 0.5, else 1 | was up to 3 |

Estimated result for a three-take side plant at branching 0.6: territory about 2.5 square units
(it was 1.2 to 1.5), 3 primaries, 9 tips, about 21 units of stroke at a mean width of 0.016, which
is about 13 % stroke coverage, about 700 nodes. One take alone: 20 tips, about 2000 nodes, inside
`maxNodes` 2600.

### 2.5 `layout.ts`

```ts
export interface Placement {
  // ...existing fields
  /** World-angle sector this plant fills (radians, lo < hi; may exceed pi). */
  sectorLo: number;
  sectorHi: number;
}

// in layoutTakes()
const gapAll = L.spinSpeed === 0 ? clamp(L.downGap, 0, 300) : 0;
const arcLo = (-90 + gapAll / 2) * deg, arcHi = (270 - gapAll / 2) * deg;
const widen = (lo: number, hi: number) => {
  const m = 0.25 * clamp(p.plants.overlap) * (hi - lo);
  return { sectorLo: Math.max(arcLo, lo - m), sectorHi: Math.min(arcHi, hi + m) };
};
// n === 1: angle 90 deg, ...widen(arcLo, arcHi)
// n === 2: sectors [90 deg, arcHi] and [arcLo, 90 deg]; angle = the sector's middle (replaces wingTilt)
// n >= 3: ...widen((phi - step / 2) * deg, (phi + step / 2) * deg), clipped to the arc
// lengthMul: m >= 5 && k % 2 ? 0.92 : 1
```

Add `pl.sectorLo`, `pl.sectorHi`, `p.growth.flatten`, `p.plants.clearance`, `p.look.decoSize` and
`p.layout.midOriginY` to the build signature, and remove the retired values from it. `main.ts`
copies placement fields with `Object.assign`; add the two sector fields there so the guide overlay
can draw the sector and outline.

### 2.6 `plant.ts`: form

```ts
interface PlantForm {
  kind: Placement['kind'];
  upX: number; upY: number;
  detail: number;
  hx: number; hy: number; headR: number;      // head, local (as now)
  cx: number; cy: number;                      // hub, local
  lo: number; hi: number; mid: number;         // sector, world radians
  a: number; b: number; bDown: number;         // outline, plant units
  rIn: (phi: number) => number;                // silhouette radius from the hub + 0.02, plant units
}

/** World point -> plant-local (generalises headLocal). */
function toLocal(wx: number, wy: number, pl: Placement): [number, number] {
  const th = pl.angle - Math.PI / 2, c = Math.cos(th), s = Math.sin(th);
  const dx = wx - pl.ox, dy = wy - pl.oy, sc = Math.max(1e-3, pl.scale);
  return [(c * dx + s * dy) / sc, (-s * dx + c * dy) / sc];
}

// formOf():
const [cx, cy] = toLocal(p.avatar.headX, p.layout.midOriginY, pl);
const effort = lerp(0.95, 1.08, mood.effort);
const a = 2.15 * p.growth.reach * effort * (pl.lengthMul ?? 1);
const round = p.layout.spinSpeed !== 0;
const b = round ? a * 0.8 : a * (1 - 0.6 * clamp(p.growth.flatten));
const bDown = round ? b : 0.85 * b;
// A world angle phi is the local heading h = pl.angle - phi; direction = (sin h, cos h).
const dirOf = (phi: number): [number, number] => [Math.sin(pl.angle - phi), Math.cos(pl.angle - phi)];
// rIn: 49 samples across [lo, hi]; march r = 0..1.6 in 0.02 from the hub, keep the last blocked r.
const N = 49, table = new Float32Array(N);
for (let k = 0; k < N; k++) {
  const [dx, dy] = dirOf(lerp(pl.sectorLo, pl.sectorHi, k / (N - 1)));
  let last = 0.2;
  for (let r = 0; r <= 1.6; r += 0.02) {
    const [wx, wy] = toWorld(cx + dx * r, cy + dy * r, pl);
    if (blocked(wx, wy)) last = r + 0.02;
  }
  table[k] = last;
}
const rIn = (phi: number) => {
  const x = clamp((phi - pl.sectorLo) / (pl.sectorHi - pl.sectorLo)) * (N - 1), i = Math.min(N - 2, Math.floor(x));
  return lerp(table[i], table[i + 1], x - i);
};
```

Helpers used below, inside `buildGesture`:

```ts
const E = 2.4;
const rOut = (phi: number) => {
  const c = Math.abs(Math.cos(phi)), s = Math.sin(phi), bb = s >= 0 ? f.b : f.bDown;
  return Math.pow(Math.pow(c / f.a, E) + Math.pow(Math.abs(s) / bb, E), -1 / E);
};
const hOf = (phi: number) => pl.angle - phi;                       // world angle -> local heading
/** Polar position about the hub: [radius, world angle unwrapped around the sector's middle]. */
const polar = (x: number, y: number): [number, number] => {
  const phi = pl.angle - Math.atan2(x - f.cx, y - f.cy);
  return [Math.hypot(x - f.cx, y - f.cy), f.mid + wrap(phi - f.mid)];
};
const hidden = (x: number, y: number) => { const [wx, wy] = toWorld(x, y, pl); return blocked(wx, wy); };
```

### 2.7 `plant.ts`: occupancy

```ts
const CELL = 0.06, MOAT = 0.08;
const occ = new Map<number, number>();                 // cell -> id of the first limb that claimed it
const key = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);
const claim = (x: number, y: number, id: number) => { const k = key(x, y); if (!occ.has(k)) occ.set(k, id); };
const taken = (x: number, y: number, self: number, host: number) => {
  const o = occ.get(key(x, y));
  return o !== undefined && o !== self && o !== host;
};
/** May a shoot or leaf be here? Inside the band, outside the moat, not hidden. */
const inBand = (x: number, y: number) => {
  const [r, phi] = polar(x, y);
  if (phi < f.lo - 0.03 || phi > f.hi + 0.03) return false;
  return r >= f.rIn(phi) + MOAT && r <= rOut(phi) * 1.04 && !hidden(x, y);
};
/** Free at this point, with `clearance` to both sides of the direction of travel. */
const free = (x: number, y: number, h: number, self: number, host: number) => {
  if (!inBand(x, y)) return false;
  const nx = Math.cos(h) * pp.clearance, ny = -Math.sin(h) * pp.clearance;
  return !taken(x, y, self, host) && !taken(x + nx, y + ny, self, host) && !taken(x - nx, y - ny, self, host);
};
/** Distance a shoot could run from (x, y) along heading h before it meets something. */
const freeRun = (x: number, y: number, h: number, max: number, host: number) => {
  let d = 1.5 * CELL;                                  // skip the host's own cells at the base
  for (; d < max; d += CELL / 2)
    if (!free(x + Math.sin(h) * d, y + Math.cos(h) * d, h, -1, host)) break;
  return d;
};
```

### 2.8 `plant.ts`: `grow`

Changes against the current `grow`: no repulsion; an optional aim point with homing that only
starts once the limb is out of the silhouette; a turn-rate cap; shoots stop at claimed space;
the far clamp is measured about the hub; `this.order` keeps its meaning (0 trunk, 1 limbs
including forks, 2 shoots, 3 sub-shoots) so reveal, withering and the outline metric keep working.

```ts
interface Limb {
  id: number; first: number; last: number;
  order: number;          // 0 trunk, 1 limb or fork, 2 shoot, 3 sub-shoot
  depth: number;          // fork depth within order 1 (widths, reveal)
  len: number; attach: number;
  emerge: number;         // arc length at which it left the silhouette (0 if it started outside)
}
interface Aim { x: number; y: number }

const grow = (parent: number, h: number, len: number, ord: number, depth: number,
              w0: number, noiseSeed: number, aim?: Aim, host = -1): Limb => {
  const n = Math.max(2, Math.ceil(len / step)), ds = len / n;
  let x = sk.x[parent], y = sk.y[parent], prev = parent, arc = 0;
  const first = sk.n, id = limbs.length;
  const taper = clamp(pp.taper);
  const tipW = lerp(w0 * 0.75, pp.tipWidth, taper);
  const taperExp = lerp(2.2, 0.8, taper);
  const kMax = ord >= 2 ? 10 : 6;
  let emerge = hidden(x, y) ? -1 : 0;                  // -1 = still behind the avatar
  for (let k = 1; k <= n && sk.n < pp.maxNodes; k++) {
    const t = k / n;
    arc += ds;
    let dh = 0;
    if (emerge >= 0) {
      if (aim) {
        // Homing: ramps in over 0.25 after leaving the silhouette, tightens near the target.
        const rem = Math.hypot(aim.x - x, aim.y - y);
        if (rem < ds) break;
        const w = smooth01(emerge + 0.05, emerge + 0.3, arc);
        dh += wrap(Math.atan2(aim.x - x, aim.y - y) - h) * clamp((1.6 * ds) / Math.max(rem, 0.2), 0, 0.5) * w;
      }
      dh += wild * 0.25 * noise1(t * 2.5 + noiseSeed, this.seed) * ds;        // wander
      dh += lift * ds * (0.3 + 0.7 * t) * Math.sin(hUp - h);                  // tips toward the sky
    }
    h += clamp(dh, -kMax * ds, kMax * ds);                                     // no kinks
    // Head-outline clamp: unchanged (28..70 degrees from radial-to-head while leaving it).
    // ...existing block...
    // Far out: never more than 75 degrees off radial from the hub (was 80 from the root).
    const [rr] = polar(x, y);
    if (emerge >= 0 && rr > 0.3) {
      const hr = Math.atan2(x - f.cx, y - f.cy);
      h = hr + clamp(wrap(h - hr), -75 * deg, 75 * deg);
    }
    const nx = x + Math.sin(h) * ds, ny = y + Math.cos(h) * ds;
    if (ord >= 2 && !free(nx, ny, h, id, host)) break;                         // shoots stop at claimed space
    x = nx; y = ny;
    if (emerge < 0 && !hidden(x, y)) emerge = arc;
    prev = sk.add(x, y, prev, 0, lerp(w0, tipW, Math.pow(t, taperExp)), NodeKind.Branch);
    order.push(ord); tAlong.push(t); limbOf.push(id);
    if (emerge >= 0) claim(x, y, id);
  }
  const limb = { id, first, last: sk.n - 1, order: ord, depth, len, attach: parent, emerge: Math.max(0, emerge) };
  limbs.push(limb);
  return limb;
};
```

Behind the avatar a limb neither homes nor wanders, so it reaches the silhouette exactly radial
from the hub and crosses it steeply. That replaces the role the 28-degree clamp played, and the
clamp stays as a safety net.

### 2.9 `plant.ts`: `buildGesture`

```ts
private buildGesture(pl: Placement, p: Params, blocked: Blocked, takeCount: number) {
  const mood = p.plants.moodShaping ? this.mood : NEUTRAL_MOOD;
  const f = this.formOf(pl, p, blocked, takeCount, mood);
  const pp = p.plants, g = p.growth;
  const rs = rng(this.slotSeed * 131 + 7);   // gesture: stable for the take
  const r = rng(this.seed);                   // plumage: new every generation
  // sk.reset(), step, wild, branching, lift, hUp, limbs/order/tAlong/limbOf: as now
  // occupancy helpers (2.7), grow (2.8)

  // 1. Hidden trunk: root -> hub (crown only; for wings and wedges the hub is the root).
  sk.add(0, 0, -1, 0, pp.maxWidth, NodeKind.Branch);
  let hub = 0;
  const trunkLen = Math.hypot(f.cx, f.cy);
  if (trunkLen > 2 * step) hub = grow(0, Math.atan2(f.cx, f.cy), trunkLen, 0, 0, pp.maxWidth, 0).last;
  else limbs.push({ id: 0, first: 0, last: 0, order: 0, depth: 0, len: 0, attach: 0, emerge: 0 });

  // 2. Tip targets: evenly spaced along the outline, stratified jitter, ragged radius.
  const W = f.hi - f.lo;
  const usable = (phi: number) => f.rIn(phi) < 0.7 * rOut(phi);         // not a direction behind the body
  let sOut = 0, sIn = 0;
  for (let k = 0; k < 24; k++) {
    const phi = f.lo + (W * (k + 0.5)) / 24;
    if (usable(phi)) { sOut += (rOut(phi) * W) / 24; sIn += (f.rIn(phi) * W) / 24; }
  }
  const gTip = lerp(0.6, 0.28, branching);
  const nTip = clamp(Math.round((sOut / gTip) * f.detail) + (mood.effort > 0.7 ? 1 : 0), 3, 20);
  const kE = clamp(1.05 - 0.4 * g.spread * lerp(0.85, 1.2, mood.effort), 0.3, 1);
  const hero = Math.floor(nTip * (0.25 + 0.5 * rs()));
  const droop = 8 * deg * mood.soft * pp.softDroop;
  interface Tip { phiE: number; x: number; y: number }
  const tips: Tip[] = [];
  for (let i = 0; i < nTip; i++) {
    let phiT = f.lo + (W * (i + 0.5 + (r() - 0.5) * 0.5)) / nTip;
    phiT += Math.cos(phiT) >= 0 ? -droop : droop;   // soft singing: both halves turn away from the top
    phiT = clamp(phiT, f.lo, f.hi);
    if (!usable(phiT)) continue;
    const rag = (1 - 0.28 * wild * r()) * (i % 2 ? 0.92 : 1) * (i === hero ? 1.06 : 1);
    const R = Math.max(f.rIn(phiT) + 0.35, rOut(phiT) * rag);
    const [dx, dy] = dirOf(phiT);
    tips.push({ phiE: f.mid + (phiT - f.mid) * kE, x: f.cx + dx * R, y: f.cy + dy * R });
  }

  // 3. Sector subdivision: each limb takes the middle tip of its group and hands the tips on
  //    either side to forks that leave it further out.
  const wPrim = pp.maxWidth * 0.42;
  const featherLimbs: Limb[] = [];
  const subdivide = (start: number, group: Tip[], depth: number, w0: number, parentLimb: Limb | null) => {
    if (!group.length || sk.n >= pp.maxNodes) return;
    const m = Math.min(group.length - 1, Math.floor(group.length / 2 + (r() - 0.5) * 0.6));
    const main = group[m];
    const chord = Math.hypot(main.x - sk.x[start], main.y - sk.y[start]);
    let h0: number;
    if (!parentLimb) h0 = hOf(main.phiE);                                // primary: radial from the hub
    else {
      const turn = wrap(Math.atan2(main.x - sk.x[start], main.y - sk.y[start]) - headingAt(start));
      h0 = headingAt(start) + Math.sign(turn || 1) * clamp(Math.abs(turn) * 0.8, 22 * deg, 55 * deg);
    }
    const limb = grow(start, h0, chord * 1.08, 1, depth, w0, r() * 10, { x: main.x, y: main.y });
    featherLimbs.push(limb);
    for (const side of [group.slice(0, m), group.slice(m + 1)]) {
      if (!side.length) continue;
      // Fork in the visible part, later for deeper forks: where the gap to the neighbours has opened.
      const e = clamp(limb.emerge / Math.max(0.05, limb.len));
      const u = e + (1 - e) * clamp(lerp(0.25, 0.55, r()) + 0.08 * depth, 0.2, 0.75);
      const node = limb.first + Math.round(u * (limb.last - limb.first));
      subdivide(node, side, depth + 1, sk.w[node] * 0.8, limb);
    }
  };
  const nPrim = clamp(Math.round(sIn * kE / 0.2), 2, Math.min(tips.length, 7));
  for (let k = 0; k < nPrim; k++) {
    const from = Math.round((k * tips.length) / nPrim), to = Math.round(((k + 1) * tips.length) / nPrim);
    subdivide(hub, tips.slice(from, to), 0, wPrim, null);
  }

  // 4. Ivy shoots, placed into free space. All limbs exist before any shoot does, and spawn
  //    sites are visited in a shuffled order so no limb takes all the room first.
  const shootGap = (lerp(0.22, 0.09, branching) * (1 + 0.5 * mood.soft * pp.softDroop)) / (1 + 0.3 * mood.vibrato);
  const shootMax = lerp(0.16, 0.34, branching);
  const maxDepth = branching > 0.5 ? 2 : 1;
  const CANDS = [55, 40, 72].map((d) => d * deg);
  const shootRound = (hosts: Limb[], ord: number, gapMul: number): Limb[] => {
    const sites: { host: Limb; node: number; side: number; u: number; key: number }[] = [];
    for (const host of hosts) {
      const e = clamp((host.emerge + 0.1) / Math.max(0.05, host.len));
      const count = Math.floor(((host.len * (0.95 - e)) / (shootGap * gapMul)) * f.detail);
      let s = r() < 0.5 ? -1 : 1;
      for (let j = 0; j < count; j++) {
        const u = lerp(e, 0.95, (j + 0.5 + (r() - 0.5) * 0.5) / count);
        s = -s;                                                           // alternate, like ivy
        sites.push({ host, node: host.first + Math.round(u * (host.last - host.first)), side: s, u, key: r() });
      }
    }
    sites.sort((p, q) => p.key - q.key);
    const made: Limb[] = [];
    for (const st of sites) {
      if (sk.n >= pp.maxNodes) break;
      const x = sk.x[st.node], y = sk.y[st.node], hb = headingAt(st.node);
      if (!inBand(x, y)) continue;                                        // nothing in the moat or behind the avatar
      const want = shootMax * (0.7 + 0.6 * r()) * lerp(1, 0.6, st.u) * (ord > 2 ? 0.7 : 1);
      // Preferred side first; the other side only if the preferred one is crowded.
      let best = 0, bestH = 0;
      for (const sgn of [st.side, -st.side]) {
        for (const c of CANDS) {
          const run = freeRun(x, y, hb + sgn * c, want + pp.clearance, st.host.id);
          if (run > best) { best = run; bestH = hb + sgn * c; }
        }
        if (best >= want * 0.6) break;
      }
      const len = Math.min(want, best - pp.clearance);
      if (len < 0.07) continue;                                           // crowded: no shoot here
      made.push(grow(st.node, bestH, len, ord, 0, Math.min(sk.w[st.node] * 0.6, pp.tipWidth * 1.2), r() * 10, undefined, st.host.id));
    }
    return made;
  };
  let hosts = featherLimbs;
  for (let d = 0; d < maxDepth; d++) hosts = shootRound(hosts, 2 + d, d === 0 ? 1 : 1.2).filter((l) => l.len > 0.14);

  // 5. finish(), witherH: as now (order 0 never withers, order 1 holds +0.12).

  // 6. Reveal schedule. There is no long spine any more: the trunk takes 0.1, primaries open
  //    from the sector's middle outward, forks and shoots follow their attachment point.
  //    start[trunk] = 0, span[trunk] = 0.1
  //    primary k:   start = 0.1 + 0.05 * |k - (nPrim - 1) / 2|, span = 0.45 * sqrt(len / f.a)
  //    fork:        start = thr[attach] + 0.03,                 span = 0.45 * sqrt(len / f.a)
  //    shoot:       start = thr[attach] + 0.04 + 0.06 * (order - 2), span = 0.3 * sqrt(len / f.a)
  //    then normalise as now.
  //    trunkFrac = clamp(min over primaries of thr[first node with !hidden], 0, 0.6)

  // 7. Pitch steering by world height: as now.

  // 8. Per-node data for the renderer (section 3): this.tone, this.leafRank.
}
```

**Hugging.** Limbs are radial at the silhouette by construction and capped at 75 degrees off
radial further out; shoots leave their host at 40 to 72 degrees, never enter the moat and never
grow behind the avatar. The moat is the visible proof that nothing hugs.

**What to delete:** the spine bow, `chord`, `plan()`, the feather loop, `offSide` and `featherSide`
handling, `repelVec` and its grid, and the `side` field of `PlantForm`. Keep `colonise` out of the
panel (see section 4).

---

## 3. De-blobbing in the renderer, ranked

| Rank | Change | Impact | Cost |
| --- | --- | --- | --- |
| R1 | Crowd-compensated bloom, ink mask and soft knee in `composite.frag` | very high | about 10 shader lines, 3 uniforms |
| R2 | Blue-noise leaf placement (`leafRank`) | very high | about 40 lines in `plant.ts`, 5 in `deco.ts` |
| R3 | Leaf rim, gradient and stronger midrib in `sprite.frag` | high | 4 shader lines |
| R4 | Tone ramp (dim inside, bright outside) and per-limb / per-leaf variety | high | one per-node array, a few lines in `pushTree` and `deco.ts` |
| R5 | Luminance-equalised glow per take colour | medium, decisive for yellow | 3 lines in `main.ts` |
| R6 | Under-leaf layer drawn before the strokes | medium | one more batch |
| R7 | Thinner stems (section 2.4) and a shaded stroke edge | medium | 2 shader lines |
| — | Bloom threshold | not recommended | emission per pixel is uniform, so a threshold does not tell core from fringe |

R1 and R3 are worth doing first and on their own: they need no generator change and should show
within the hour whether the "textureless" complaint is mostly rendering.

### R1. Bloom that knows how crowded it is

The glow target's alpha already holds coverage (`o_glow = vec4(rgb * glow, 1) * cov`, "over"
blended, and `copy.frag` and `blur.frag` carry all four channels). After the blur chain, the alpha
of the quarter and eighth levels is the local ink density over roughly 10 to 25 px. No extra pass.

```glsl
uniform float u_crowd;    // 0.7
uniform float u_inkMask;  // 0.7
uniform float u_knee;     // 0.8
void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 g1 = texture(u_g1, v_uv), g2 = texture(u_g2, v_uv), g3 = texture(u_g3, v_uv);
  float dens = 0.4 * g2.a + 0.6 * g3.a;                       // local ink coverage, 0..1
  float crowd = 1.0 / (1.0 + 6.0 * u_crowd * dens * dens);    // 0.15 -> 0.91, 0.5 -> 0.49, 1.0 -> 0.19
  vec3 g = (g1.rgb * 0.45 + g2.rgb * 0.7 + g3.rgb * 0.9 * u_wide) * u_strength * crowd;
  g = max(g - 0.004, 0.0);
  g *= 1.0 - u_inkMask * b.a;                                 // glow lies around the ink, not on it
  g /= 1.0 + u_knee * max(g.r, max(g.g, g.b));                // soft knee: never clips flat, hue kept
  vec3 rgb = b.rgb + g;
  float a = clamp(b.a + max(g.r, max(g.g, g.b)), 0.0, 1.0);
  o = vec4(min(rgb, vec3(a)), a);
}
```

A single strand in the open keeps its full glow. In a dense area the glow drops to about a fifth
and the ink itself, with its shading, is what you see. Add `crowd`, `inkMask` and `knee` to
`GlowSettings` and `params.glow`.

### R2. Leaves with a guaranteed spacing

Built once per tree, as a *rank* per node so the per-track density still works at draw time and
changing it never makes leaves jump:

```ts
// plant.ts, end of buildGesture. leafRank[i] = the lowest density at which node i carries a leaf.
const L0 = 0.055 * p.look.decoSize;                               // base leaf length, plant units
const LEVELS = [2.6, 2.0, 1.55, 1.2, 0.95, 0.75, 0.6].map((k) => k * L0);
this.leafRank = new Float32Array(n).fill(2);                      // 2 = never
const cand: number[] = [];
for (let i = 1; i < n; i++) if (this.order[i] >= 1 && inBand(sk.x[i], sk.y[i])) cand.push(i);
const pri = (i: number) => (sk.children[i] === 0 ? 0 : 1) + hash1(i * 3.7 + this.seed);   // terminals first
cand.sort((p, q) => pri(p) - pri(q));
const placed = new Map<number, number[]>();                       // grid with cell = LEVELS[0]
LEVELS.forEach((d, lv) => {
  for (const i of cand) {
    if (this.leafRank[i] < 2 || nearerThan(placed, sk.x[i], sk.y[i], d)) continue;
    this.leafRank[i] = (lv + hash1(i * 5.3)) / LEVELS.length;
    insert(placed, i);
  }
});
```

```ts
// deco.ts, 'leaves' case: TreeExtras gains rank?, tone?, order?
const show = extras.rank ? extras.rank[i] <= dens : h0 < dens * 0.45 || (terminal && dens > 0.15);
```

At density 0.55 the spacing is about 1.2 leaf lengths, which bounds leaf coverage at roughly 30 %
anywhere in the plant. The halo vine has no rank and keeps the old rule.

Also in that case, for variety: side angle `0.5 + 0.8 * h2` instead of `0.75 + 0.4 * h2`, and size
`(0.6 + 0.65 * h2) * lerp(0.85, 1.1, rho)` so inner leaves are a little smaller.

### R3. Leaf shading

```glsl
// sprite.frag, leaf (and holly) branch, after d is known. d and v_uvPerPx are both in uv units.
float inside = clamp(-d / v_uvPerPx, 0.0, 4.0);               // pixels in from the edge
col *= mix(0.45, 1.0, smoothstep(0.0, 2.5, inside));          // dark rim: overlapping leaves separate
col *= mix(0.70, 1.12, smoothstep(0.0, 1.0, y));              // darker at the stalk, lighter at the tip
// midrib: raise 0.35 to 0.5
```

The glow emission uses the same `col`, so rims do not glow either.

### R4. Tone and variety

```ts
// plant.ts: per-node tone, built once.
const limbTone = limbs.map(() => 1 + 0.14 * (r() * 2 - 1) * variety);
for (let i = 0; i < n; i++) {
  const [rr, phi] = polar(sk.x[i], sk.y[i]);
  const rho = clamp((rr - f.rIn(phi)) / Math.max(0.1, rOut(phi) - f.rIn(phi)));
  this.tone[i] = lerp(lerp(1, 0.6, depthShade), 1.08, rho * rho * (3 - 2 * rho)) * limbTone[limbOf[i]];
}
```

- `pushTree` takes an optional `tone` array and multiplies the stroke colour by `tone[i]` and the
  glow by `tone[i] * tone[i]`.
- `decorateTree` multiplies the leaf intensity by `tone[i] * lerp(1, 0.72 + 0.43 * h3, variety)`
  and jitters the natural tint per leaf: `nat * lerp(1, 0.4 + 1.2 * h2, variety)`. Some leaves
  come out greener and some closer to the take colour, using the mechanism that already exists.

The inner mass becomes a dimmer textured ground and the rim carries the light, which is the
opposite of the current hot core. `variety` = `look.variety` (0.6), `depthShade` =
`look.depthShade` (0.6).

### R5. Equal glow for every take colour

```ts
// main.ts, drawPlant
const luma = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
const lookEq = { ...look, glow: look.glow * clamp(0.5 / Math.max(0.05, luma), 0.65, 1.4) };
```

Yellow-green gets about 0.65 x the glow and blue 1.4 x. Use `lookEq` for the plant's strokes and
leaves only, not for the halo.

### R6. Under-leaves

Add an `Instances` batch `backUnder` before `back`. In `decorateTree`, leaves with
`hash1(id * 7.7 + seed) < 0.4` go to it at 0.6 x intensity, 1.15 x size and glow 0. Branches then
pass over dark leaves and under bright ones, which gives depth for one extra draw call.

### R7. Stroke edge

```glsl
// stroke.frag
float inside = clamp(-d / u_px, 0.0, 3.0);                     // pixels in from the edge
float wide = step(1.5 * u_px, max(v_r.x, v_r.y));              // 1 for strokes wider than about 3 px
vec3 col = v_col.rgb * mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 2.0, inside)), wide);
// then use col in place of v_col.rgb for both outputs
```

Only strokes wider than about 3 px get the darker edge; thin twigs stay as they are. Crossing
limbs then read as one lying on top of the other.

---

## 4. Defaults and sliders

### Artist panel (top level)

| Slider | Range | Default | Meaning after the change | Status |
| --- | --- | --- | --- | --- |
| `growth.branching` | 0..1 | 0.6 | tip spacing 0.60 to 0.28, shoot spacing 0.22 to 0.09, shoot depth 1 or 2 | keep |
| `growth.reach` | 0.4..1.6 | 1.0 | half-width of the canopy = 2.15 x reach | keep |
| `growth.flatten` | 0..1 | 0.55 | 0 = round canopy, 1 = height 40 % of the half-width | **new** |
| `growth.spread` | 0.4..2 | 1.0 | 0.4 = straight rays from the hub, 2 = limbs arch strongly away from the plant's middle | keep, redefined |
| `plants.overlap` | 0..1 | 0.5 | how far neighbouring plants' territories interleave (0 to 25 % of a sector per side) | keep, redefined |
| `plants.lift` | -1..1 | 0.2 | tips curve to the sky or droop; on the lowest limbs positive lift makes the upturned ends of the cradle | keep |
| `plants.wildness` | 0..1 | 0.45 | wander, ragged outline, hero tip | keep |
| `plants.taper` | 0..1 | 0.4 | as now | keep |
| `plants.clearance` | 0.02..0.12 | 0.045 | gap a shoot keeps from other branches; the "repel" idea as one number | **new** |
| `look.density` | 0..1 | 0.55 | now a leaf *spacing* (2.6 to 0.6 leaf lengths) | keep, redefined |
| `look.variety` | 0..1 | 0.6 | brightness and tint differences between limbs and leaves | **new** |
| `look.depthShade` | 0..1 | 0.6 | how much dimmer the inside of a plant is than its rim | **new** |
| `glow.crowd` | 0..1.5 | 0.7 | how strongly glow is reduced where ink is dense | **new** |

Other defaults: `look.decoSize` 1.8 (unchanged; the spacing scales with it), `look.decoGlow` 0.2
(was 0.3), `glow.wide` 0.8 (was 1.0), `glow.inkMask` 0.7 and `glow.knee` 0.8 (new, fine-detail
section), `glow.strength` 1.6 (unchanged: single strands should keep their glow),
`plants.tipWidth` 0.006 (was 0.008), `plants.maxWidth` 0.035 (now only the hidden trunk is that
wide), `plants.step` 0.03, `plants.maxNodes` 2600, `layout.downGap` 100.

### Retire

| Setting | Why |
| --- | --- |
| `plants.repel`, `plants.repelRadius` | replaced by territories, even tips and `clearance` |
| `plants.planform` | the outline is now the canopy itself; `flatten` and `wildness` cover it |
| `plants.featherSide`, `growth.sweep` | plants are no longer one-sided; territories tile the arc |
| `layout.wingTilt` | the two-take angle is the middle of its sector |
| `envelope.*`, `plants.generator`, `attractors`, `influence`, `kill`, `jitter`, `smoothing`, `pipeExponent` | only read by `colonise`; my earlier advice was to keep it one release for comparison, and that release has passed. Delete the generator, or hide the group behind a "legacy" fold |

Net change on the artist-facing panel: seven sliders out (`repel`, `repelRadius`, `planform`,
`featherSide`, `sweep`, `wingTilt`, `generator`), five in (`flatten`, `clearance`, `variety`,
`depthShade`, `crowd`), plus two fine-detail glow values.

Mood shaping keeps its inputs: effort scales the outline (0.95 to 1.08) and the arch, pitch
feeds `lift`, softness turns the tip targets 8 degrees away from the top and widens shoot spacing,
vibrato adds wander.

---

## 5. Test plan

### 5.1 New metrics

**`inkMetrics(plants, placements, params)`** in `debug.ts`, on a world grid with a cell of 0.02
(about 3 px at 600 px height) covering x in [-2.8, 2.8], y in [-1.9, 2.1]:

1. Rasterise every visible stroke as a capsule of its real width and every shown leaf
   (`leafRank <= density`) as an ellipse (length `L`, width `0.68 L`), skipping cells that are
   `blocked`. Keep two grids: `cover` (0 or 1) and `count` (number of primitives on the cell).
2. Box-filter `cover` with a window of 0.24 (12 cells) to get `dens`.
3. The territory mask is every cell in the band `rIn + 0.1 <= r <= 0.9 * rOut` inside the arc.

| Metric | Definition | Pass | Expected today |
| --- | --- | --- | --- |
| `blobMax` | maximum of `dens` | <= 0.60 | about 1.0 |
| `blobShare` | share of the territory with `dens > 0.5` | <= 0.03 | 0.15 to 0.3 |
| `emptyShare` | share of the territory with `dens < 0.04` | <= 0.12 | above 0.4 |
| `evenness` | standard deviation / mean of `dens` over the territory | <= 0.55 | above 1 |
| `meanCover` | mean of `dens` over the territory | 0.22 to 0.40 | — |
| `overdraw` | sum of `count` / sum of `cover` | <= 1.6 | above 3 in the cores |
| `aspect` | width / height of the box holding 98 % of the ink, all plants | >= 1.45 with flatten 0.55 | about 1.2 |
| `topAspect` | the same for the plant nearest 90 degrees (3+ takes) | >= 1.6 | 0.9 to 1.3 |
| `halfWidth` | 95th percentile of abs(x) of the ink | >= 1.85 x reach | about 1.9 |
| `arcCover` | share of 5-degree bins of the arc with ink at mid-band radius | >= 0.9 | about 0.6 |
| `lowReach` | lowest ink y | <= -0.6 | about -0.2 without repulsion |
| `moatInk` | share of ink within 0.08 of the silhouette, not counting order-1 limbs | <= 0.02 | — |
| `tipGapCoV` | standard deviation / mean of the angular gaps between neighbouring order-1 tips, per plant | <= 0.35 | — |

`evenness` and `blobShare` are the bunching metrics; `blobMax` and `overdraw` are the blobbing
metrics. The "expected today" column is my estimate from the frames, to be replaced by a measured
baseline before anything is changed.

**`pixelMetrics()`**: call `gl.readPixels` straight after `draw()` inside `sprout.advance()` (same
task, so no `preserveDrawingBuffer` is needed). Over pixels with alpha above 0.5 that are outside
the avatar:

| Metric | Definition | Pass |
| --- | --- | --- |
| `saturatedShare` | share with the largest channel >= 0.98 | <= 0.02 |
| `localContrast` | mean of abs(luma - 9x9 box-blurred luma) / mean luma | >= 0.18 |

Run it for take colour 1 (yellow-green) at full loudness. That is the worst case.

### 5.2 Changes to the A7 metrics

- Measure "radial" from the hub, not the plant root, and only on order 0 and 1 (limbs). Ivy
  shoots leave at 40 to 72 degrees by design and would fail a radial test for no visual reason.
- `tangentialShare` (limbs over 60 degrees off radial): pass <= 0.12. The old 0.05 was for
  straight feathers; arching limbs need the room.
- `hugNearSilhouette`: unchanged, pass about 0. `visibleShare`: pass >= 0.8.
- `outlineCoV`: measure the tip radius divided by `rOut` at that angle; pass 0.06 to 0.20 (ragged,
  but one canopy).
- Drop `coveredAt125` and the "six takes read as a star" check.

### 5.3 Frames

Fixed fake seed, `?offline`, paused at full reveal, avatar placeholder at opacity 1 (OBS hides
the centre, so judge it hidden).

| Set | Frames |
| --- | --- |
| Baseline first | the five consult frames again with `inkMetrics` and `pixelMetrics` recorded, before any change |
| Rendering only | R1 + R3 + R5 on the *current* generator, three takes with leaves, repel 0.6. This isolates how much of the verdict is rendering |
| Structure | seeds 1 to 8, takes 1, 2, 3, 6: theme `branches`, then `leaves` |
| Worst colour | three takes, every take set to `#b5e61d`, full loudness |
| Sizes | 800 x 600 and 1920 x 1080 |
| Growth | one seed per take count at reveal 0.25, 0.5, 0.75 |
| Sliders | `flatten` 0 / 0.55 / 1, `branching` 0.3 / 0.6 / 0.9, `density` 0.3 / 0.55 / 0.9, `overlap` 0 / 1 |

What good looks like:

- Shrunk to 64 px and blurred, the whole reads as one wide, low crescent that is open at the
  bottom, with the figure sitting in it. Not a T, not three balls.
- Converted to greyscale, every plant still shows branches and leaves in its middle.
- A thin, even dark gap runs along the avatar's edge, crossed only by limbs at a steep angle.
- No part of a bare-branch frame shows more than three limbs running parallel within 0.1.
- At reveal 0.3 the primaries are out and the first forks are opening; it is not a small bush.

### 5.4 Risks to watch

- **Wheel spokes.** Evenly placed primaries can look mechanical. The jitter, unequal groups,
  random fork positions and wander are there to prevent it; if it still shows, raise the tip
  jitter from 0.5 to 0.8 of a slot before touching anything else. `tipGapCoV` below about 0.1
  would be the sign that it is too regular.
- **Single take.** One plant filling 260 degrees is the largest case (about 2000 nodes). Check it
  against `maxNodes` and for the trunk peeking out between the root and the hub.
- **The moat reading as a halo of its own.** If it looks like an outline around the avatar,
  lower `MOAT` to 0.05 rather than removing it.
- **Take count changes.** Territories are part of the build signature, so plants rebuild when the
  count changes. That is the current behaviour too (the wedge half-angle is already in the
  signature), but the shape change will now be larger. Check the 2 to 3 transition mid-phrase.

---

## Suggested build order

1. Baseline metrics on the current build (`inkMetrics`, `pixelMetrics`).
2. R1, R3, R5 (shader and three lines). Show the artist; this may already settle "textureless".
3. `layout.ts` sectors, `formOf`, hub and outline, tips, `subdivide`, with shoots still off.
   Judge bare-branch frames for flat, wide, cradling.
4. Occupancy grid and shoots. Judge bare-branch frames for even and not bunched.
5. R2 (`leafRank`), R4 (`tone`), then R6 and R7.
6. Retire the old sliders, set the defaults, rerun the full matrix.
