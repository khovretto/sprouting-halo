# Design consult: splayed take trees (Part A) and the unwind-and-stamp commit (Part B)

Answer to `docs/fable-brief.md`, written against the code as it stands in `viewer/src`
(`growth/plant.ts`, `growth/halo.ts`, `growth/generations.ts`, `layout.ts`, `main.ts`, `deco.ts`,
`params.ts`, `shaders/*`). Nothing here has been built or run; every number is a starting default
to tune, and every claim about how it will look is a prediction to check with the test plans.

## Summary

- **Part A:** replace space colonisation with a *gesture-first* generator: one dominant spine per
  take, a fan of "feather" limbs hung off it with a wing planform, then sparse twigs. There is no
  envelope and no keep-out routing. The avatar is handled by one rule: near the avatar every limb
  must stay close to radial, so limbs cross the silhouette steeply and never run along it.
- **Part A reveal:** grow the spine first, then the feathers from the root outward, then twigs.
  The current distance-from-root order produces a circular growth front, which is part of the
  "ring" look.
- **Part B:** the halo winds tight, moves to the wing's axis just outside the silhouette, then
  unrolls like a fern crozier along the tree's own spine with arc length conserved. It draws back,
  plunges into the hidden root like a planted staff, and the impact squeezes the feathers out.
- **The join:** the tree is built first and the strand conforms to its spine. From the unroll
  onward the strand is drawn in the plant's own layer, so re-layout, spin and sway need no extra
  handling.

---

# Part A: the take tree

## A0. Your diagnosis, confirmed and extended

All four points in A1 are correct. Four more causes are visible in the code, and they explain why
parameter tuning never helped.

1. **The visible band is wider than it is long.** The origin `(0, 0.05)` is inside the keep-out
   (head circle r 0.42, body capsule r 0.55). Along most upward directions a limb only becomes
   visible at about 0.45 to 0.6 from the origin. With `wedgeLength` 1.5 the visible radial band is
   about 0.9 long, while the arc at the outer edge is 1.5 to 2 wide. Any shape that fills that
   band is an arc segment. Narrowing the fan gives a clump; widening it gives a bushy arc.
2. **The reveal front is a circle.** `computeReveal` thresholds on `flex / maxFlex`, which is
   distance from the root. Even a well-shaped tree grows as an expanding disc centred on the
   avatar, so it looks concentric with the halo all the while it grows.
3. **Equal step, equal influence means no hierarchy.** Every branch has the same length scale. The
   pipe model puts the thickness in the trunk, which is hidden, so everything visible has about
   the same width. A dominant limb never forms.
4. **`ensureBuilt` has the placement angle in its signature**, so a re-layout rebuilds every tree
   instantly while the placement eases. That pop will fight Part B, which changes the take count.

The conclusion is that the fix is structural. The silhouette must come from limb lengths chosen
by a profile, the hierarchy must be explicit, and the growth front must follow the limbs.

## A1. Shape language

Three rules make a tree read as "splayed and free" here.

- **Radial, not tangential.** Lines pointing away from the avatar are the opposite of a ring. The
  spine is nearly straight (total turn under about 15 degrees). I considered a strongly curved
  spine and rejected it: on a mostly horizontal wing, a curve that arches down is concentric with
  the body and a curve that sweeps up is concentric with the halo.
- **One gesture, then a fan.** Each take has one dominant limb (the spine) that is the longest and
  thickest thing visible. Five to nine secondary limbs ("feathers") leave it at angles that are
  wide near the root (about 50 degrees) and narrow toward the tip (about 18 degrees). They curve
  slightly back toward the spine direction, like swept feathers.
- **A pointed, ragged outline.** Feather length follows a wing planform: longest at about a third
  of the span, shrinking to the tip, with plus or minus 15 to 25 percent jitter and one "hero"
  feather 25 percent longer. Tip distance from the origin then varies from about 0.65 to 1.0 of
  the spine length across the fan. Gaps of 0.15 to 0.3 units between feather tips are left empty.

Asymmetry is what separates a wing from a bush. Side plants carry their feathers on one side
only, the world-up side. Judgement call: feathers rise from the spine instead of hanging below it
as on a painted angel wing, because rising limbs read as reaching and the space below a side wing
is the body and the stream's lower-third area. A flip is one sign (`featherSide`), so the artist
can try the drooping version.

One-sidedness is continuous in the placement angle: `side = clamp(sweep * -cos(phi) * 1.3)`. This
is the same `upward(phi)` the layout already uses for `bend`. A plant pointing straight up is a
symmetric tree; a plant pointing sideways is a full wing.

| Takes | What it should look like |
| --- | --- |
| 1 | **Crown.** Origin low (`lowOriginY`). Spine tilted 6 to 14 degrees off vertical by seed, so it is a leader and not an antenna on the head. Two or three limbs per side emerge from behind the head and shoulders at about 25, 50 and 70 degrees. The leader reaches y of about 1.5 (0.4 beyond the halo top), the 50 degree limbs about 85 percent of that, the lowest pair about 65 percent, ending near shoulder height at x of about 1.1 to 1.3. Clear wedges of 15 degrees or more between limbs. |
| 2 | **Wings.** Spines at 160 and 20 degrees (I suggest `wingTilt` 20, up from 14), length 1.7, nearly straight, ending near x = 1.6, about 0.55 beyond the ring. Feathers rise on the upper side and fill from the spine up to about 115 and 65 degrees. A 50 degree V of empty sky stays above the head. A few short twigs (under 0.25) on the lower side stop the spine reading as a ruled edge. |
| 3 | Top plant: a narrow symmetric crown (fan about plus or minus 35 degrees). The two lower plants (210 and 330 degrees): wings whose feathers rise toward horizontal, so their mass sits beside the body and not behind it. |
| 6 | Six slim plumes: a spine plus three to five feathers each, fan half-angle about 22 degrees, twigs only at high `branching`. Lengths alternate 1.0 and 0.82 by slot, so the overall outline is a star. That alternation is what stops six plants summing to a disc. About 25 degrees of gap between neighbours. |
| 12 | Two tiers of six pinions: a spine plus two to four short feathers, no twigs. Outer tier long and narrow, inner tier (scale 0.8, offset) shorter and a little wider. About 120 nodes per plant. |

Relation to the avatar: limbs emerge from behind the silhouette already diverged, crossing its
edge within about 28 degrees of perpendicular. The fork itself happens behind the avatar on
purpose, so the viewer sees rays coming out from behind the singer, not a trunk bending round her.

## A2. The generator, and why this one

It is a small parametric tree in the Weber and Penn (1995) family: explicit branch orders, with
per-order profiles for position, angle, length and curvature, plus two tropisms.

1. **Spine (order 0).** From the root along +Y with a seeded tilt, length `L`, a gentle bow toward
   the feather side and low-frequency wander.
2. **Feathers (order 1).** `N1` attachment points stratified along the spine. Side, divergence,
   length and recurve come from profiles of `u`, the position along the spine.
3. **Twigs (order 2), twiglets (order 3).** Short, alternating, on the outer part of each feather.
4. **Every step of every limb:** planned curl, wander, a lift tropism toward world up, then the
   radial clamp (A3).
5. **Widths** are analytic tapers per order. **Reveal thresholds** are a schedule per branch (A4).

Why it beats the alternatives for this job:

- **Space colonisation, including an open cloud with phototropism.** The outline is always the
  boundary of the attractor cloud and the hierarchy is emergent, so "one dominant limb plus an
  ordered fan" cannot be asked for. Routing round a keep-out is exactly the silhouette-hugging
  behaviour to remove.
- **Stochastic L-system.** It produces the same family of shapes, but through a grammar, which
  makes "feather 3 is the hero" and "length follows this planform" awkward to express. The direct
  recursive form is shorter and each slider maps to one line.
- **Part B needs a spine.** A generator that starts from a spine gives the commit strand something
  exact to land on (`spineAt(d)`).
- **Cost.** It is linear in node count with no spatial grid, well under a millisecond for about
  400 nodes, so a new tree per phrase is free.

What is lost: space colonisation guarantees no self-crossing and this does not. Feathers on the
same side are ordered by angle and curve the same way, so crossings should be rare and limited to
twigs. On thin glowing lines a twig crossing reads as overlap, not as an error.

## A3. Avatar handling

No keep-out, no attractor removal, no routing. Three mechanisms:

1. **`rClear`, per plant.** At build time, march along the plant axis in world space with the
   existing `blocked()` and record where it leaves the silhouette (about 0.5 to 0.65 for upward
   and sideways plants; capped at 1.0). The spine's bow and wander only start there.
2. **Radial clamp, the anti-hugging rule.** At each step compare the heading with the radial
   direction from the root. The allowed difference is 28 degrees inside `rClear + 0.15`, opening
   smoothly to 60 degrees by `rClear + 0.85`. A limb that starts wide near the root is held steep
   until it has crossed the silhouette. Outside, the clamp rarely binds, because a straight line
   becomes more radial as it travels; it only stops lift or curl from turning a limb tangential.
3. **No wasted detail.** Twigs whose attachment point is `blocked()` are skipped. Feathers are
   kept: their hidden bases cost about ten nodes each and their bloom gives a soft backlight rim.

Plants that point down and inward (240 and 300 degrees at six takes) are hidden for 1.1 of their
1.5 length whatever the generator does. I recommend a small layout option, `layout.downGap`
(default 100 degrees, used only when `spinSpeed` is 0): for three or more takes, spread the
angles over `360 - downGap` centred on straight up. Six takes then sit at 90 plus or minus 22, 65
and 108 degrees, and every wing is visible. This is optional; the generator does not depend on it.

Stop rebuilding on re-layout. Take the placement angle, origin and scale out of the build
signature. A tree keeps the form it was built with; the next generation picks up the new form.
With `newTreeEachPhrase` off, mark the tree stale and regrow at the next phrase start.

## A4. Mapping onto the growth model

Everything in `computeReveal` stays (monotonic `target`, growth along each segment from its base,
`regrowSpeed`, `life` and `leafLife`). Only the per-node threshold changes.

- **Reveal order.** A build-time `baseThr[i]` replaces `flex / maxFlex`:
  - spine: `0.42 * t` (t is 0..1 along the limb);
  - a child branch starts at `thr(attach node) + 0.04 + 0.10 * order` and spans
    `0.30 * sqrt(len / L)`;
  - then divide everything by the maximum.

  The spine reaches full length at about 45 percent of the reveal (about 1.5 s of full voice at
  the default `secondsToFull` of 3.5, which matches `regrowSpeed` 1.2). Feathers open one after
  another from the root outward while the spine is still extending, then twigs. The viewer sees a
  limb reach out and a wing open along it.
- **`trunkFrac`** becomes `baseThr` at spine arc `rClear`, so reveal 0 still means "grown to the
  silhouette edge".
- **Variety.** `t = baseThr + variety * 0.3 * (branchRand[branch] - 0.5)` for order 1 and above.
  The spine is never shuffled.
- **Pitch steering.** `side[i]` becomes the node's normalised world height:
  `(x*upX + y*upY)` mapped to -1..1 over the tree. High notes open the higher limbs first, in
  every layout, with the existing `steer` term unchanged.
- **Withering.** Use `witherH = height + (order == 0 ? 99 : order == 1 ? 0.12 : 0)` in the two
  wither tests. Twigs and feather ends wither in pauses; the spine and feather stubs never do.
- **New tree per phrase.** Seed the spine tilt and bow from the slot's stable seed, and the
  feathers, twigs and wander from the generation seed. Successive trees then share a gesture (the
  wing does not jump) while the plumage is new each phrase. `new Plant(seed, slotSeed)`.
- **Effort to thickness.** Unchanged (`look.width`). The analytic taper gives it more to work
  with, since the visible spine is two to three times the feather width.

## A5. Audio shaping the structure (optional, in two layers)

**At build time: a phrase "mood".** `Generations.regrow()` creates the tree when the phrase
starts, so pass a snapshot of the take's `Drive` (`effort`, `pitch`, `softness`, `vibrato`, all
already smoothed) into the build. It is not part of the signature; it applies only to that tree.

| Voice | Structure |
| --- | --- |
| Effort high | Fan opens: divergence x 1.2, feathers +10 percent longer, one extra feather |
| Soft or breathy | Lift turns negative (tips droop), fan x 0.85, twigs thinned by a third |
| Pitch high | Lift x 1.5, feathers on the upper half +20 percent, spine -5 percent |
| Pitch low | Spine +8 percent, fan flatter, lift near zero |
| Vibrato | Wander amplitude x 2 on feathers, twig spacing x 0.75 (finer plumage) |

**Live: fan aperture as a pose (phase 2).** Store each node's polar rest position (`restR`,
`restA`, angle measured from +Y). Each frame write `x = r * sin(a * k)`, `y = r * cos(a * k)` with
`k = lerp(0.85, 1.15, smoothed effort)`. The wing spreads on full-voice notes and folds slightly
on soft ones, with no rebuild and no ungrowing. It is one `sin` and `cos` per node. Build the
static version first and add this only if the trees feel stiff.

## A6. Pseudocode

New per-plant form, derived once per build from the placement (no envelope maths):

```ts
export interface PlantForm {
  kind: EnvelopeKind;
  L: number;        // spine length (plant units) = pl.length * (pl.lengthMul ?? 1)
  fan: number;      // widest feather divergence (rad) = pl.halfAngle * deg
  side: number;     // -1..1: local-X side that carries feathers, and how one-sided (0 = symmetric)
  upX: number; upY: number; // world up in the local frame: (-cos(angle), sin(angle))
  rClear: number;   // spine arc length at which it leaves the avatar (plant units)
  detail: number;   // 0..1 complexity budget: clamp(1.25 - 0.07 * takeCount, 0.35, 1)
}
export interface Mood { effort: number; pitch: number; soft: number; vibrato: number }

export function formOf(pl: Placement, n: number, p: Params, blocked: Blocked): PlantForm {
  const upX = -Math.cos(pl.angle), upY = Math.sin(pl.angle);
  let rClear = 0.3;
  for (let d = 0; d <= 1.0; d += 0.03) {              // world distance along the axis
    const [wx, wy] = toWorld(0, d / pl.scale, pl);
    if (blocked(wx, wy)) rClear = d / pl.scale + 0.05;
  }
  return {
    kind: pl.kind, L: pl.length * (pl.lengthMul ?? 1), fan: pl.halfAngle * deg,
    side: pl.kind === 'crown' ? 0 : clamp(p.growth.sweep * upX * 1.3, -1, 1) * p.plants.featherSide,
    upX, upY, rClear: Math.min(rClear, 1.0),
    detail: clamp(1.25 - 0.07 * n, 0.35, 1),
  };
}
```

`pl.length` and `pl.halfAngle` keep coming from `layoutTakes` (see defaults below). `lengthMul` is
a new optional `Placement` field: `k % 2 ? 0.82 : 1` when a tier has five or more plants.

The generator (replaces `Plant.build`; `sk`, `rng`, `noise1`, `clamp`, `lerp`, `deg` as today):

```ts
interface Limb { first: number; last: number; order: number; len: number; side: number;
                 attach: number; u: number; heading: number }   // node range, attach node, u on parent

private build(f: PlantForm, mood: Mood, p: Params, blocked: Blocked, pl: Placement) {
  const pp = p.plants, g = p.growth;
  const rs = rng(this.slotSeed * 131 + 7);   // gesture: stable for the slot
  const r = rng(this.seed);                  // plumage: new every generation
  const sk = this.sk; sk.reset();
  const step = pp.step;                      // 0.03
  const wild = pp.wildness * (1 + mood.vibrato);
  const branching = clamp(g.branching);
  const lift = (pp.lift + 0.5 * (mood.pitch - 0.5) - 0.9 * mood.soft * pp.softDroop) * 0.9; // rad per unit
  const fan = f.fan * lerp(0.85, 1.2, mood.effort);
  const smooth01 = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const limbs: Limb[] = [];
  this.order = []; this.tAlong = []; this.limbOf = [];
  sk.add(0, 0, -1, 0, pp.maxWidth, NodeKind.Branch); this.order.push(0); this.tAlong.push(0); this.limbOf.push(0);

  // Heading h is measured from +Y, positive toward +X: direction = (sin h, cos h).
  const grow = (parent: number, h: number, len: number, order: number, curl: number,
                w0: number, side: number, u: number, noiseSeed: number): Limb => {
    const n = Math.max(2, Math.ceil(len / step)), ds = len / n;
    let x = sk.x[parent], y = sk.y[parent], prev = parent;
    const first = sk.n, id = limbs.length;
    const hUp = Math.atan2(f.upX, f.upY);
    for (let k = 1; k <= n && sk.n < pp.maxNodes; k++) {
      const t = k / n;
      h += curl * (Math.PI / 2) * Math.sin(Math.PI * Math.min(1, t / 0.6)) / (0.6 * n) * (t < 0.6 ? 1 : 0); // recurve over the first 60 %
      h += wild * 0.5 * noise1(t * 2.5 + noiseSeed, this.seed) * ds;                                       // wander
      h += lift * ds * (0.3 + 0.7 * t) * Math.sin(hUp - h);                                                 // lift toward world up
      const rr = Math.hypot(x, y);
      if (rr > 0.12) {                                                                                      // radial clamp
        const hr = Math.atan2(x, y);
        const max = lerp(28, 60, smooth01(f.rClear + 0.15, f.rClear + 0.85, rr)) * deg;
        h = hr + clamp(wrap(h - hr), -max, max);
      }
      x += Math.sin(h) * ds; y += Math.cos(h) * ds;
      const tipW = pp.tipWidth * (order === 0 ? 1.6 : 1);
      prev = sk.add(x, y, prev, 0, lerp(w0, tipW, Math.pow(t, 0.8)), NodeKind.Branch);
      this.order.push(order); this.tAlong.push(t); this.limbOf.push(id);
    }
    const limb = { first, last: sk.n - 1, order, len, side, attach: parent, u, heading: h };
    limbs.push(limb);
    return limb;
  };

  // 1. Spine. Straight until rClear, then a small bow toward the feather side.
  const tilt = (rs() < 0.5 ? -1 : 1) * (f.kind === 'crown' ? 6 + 8 * rs() : 2 + 3 * rs()) * deg;
  const spineLen = f.L * lerp(0.95, 1.08, mood.effort) * (1 - 0.05 * (mood.pitch - 0.5) * 2);
  const spine = grow(0, tilt, spineLen, 0, 0, pp.maxWidth, 0, 0, rs() * 10);
  // (bow: add `f.side * 12 * deg / n` to h per step once arc > rClear; fold into grow via a flag.)

  // 2. Feathers on the spine.
  const N1 = Math.max(2, Math.round(lerp(4, 9, branching) * f.detail + (mood.effort > 0.7 ? 1 : 0)));
  const chord = f.kind === 'crown' ? 0.8 : f.kind === 'wing' ? 0.62 : 0.5;
  const plan = (u: number) => Math.pow(1 - u, 0.65) * (0.7 + 0.3 * smooth01(0, 0.3, u));
  const hero = Math.floor(N1 * (0.25 + 0.2 * r()));
  const firstSide = r() < 0.5 ? -1 : 1;
  const feathers: Limb[] = [];
  for (let j = 0; j < N1; j++) {
    const u = lerp(f.kind === 'crown' ? 0.06 : 0.10, 0.86, (j + 0.5 + (r() - 0.5) * 0.6) / N1);
    const node = spine.first + Math.round(u * (spine.last - spine.first));
    const onLift = Math.abs(f.side) < 0.15 ? (j % 2 ? 1 : -1) * firstSide
                 : (r() < 0.5 + 0.5 * Math.abs(f.side) ? 1 : -1) * Math.sign(f.side);
    const offSide = Math.abs(f.side) >= 0.15 && onLift !== Math.sign(f.side);
    const delta = fan * lerp(1.0, 0.35, Math.pow(u, 0.9)) * (0.85 + 0.3 * r());
    let len = spineLen * chord * plan(u) * (1 + wild * (r() * 0.5 - 0.25));
    if (j === hero) len *= 1.25;
    if (offSide) len *= 0.35;                         // short "coverts" on the bare side
    const hSpine = headingAt(node);                   // atan2(dx, dy) of the spine at that node
    feathers.push(grow(node, hSpine + onLift * delta, len, 1, -onLift * delta * 0.35,
                       Math.min(sk.w[node] * 0.62, pp.maxWidth * 0.5), onLift, u, r() * 10));
  }

  // 3. Twigs on feathers (and twiglets on twigs when branching is high).
  const twigGap = lerp(0.30, 0.11, branching) * (1 + 0.5 * mood.soft) / (1 + 0.3 * mood.vibrato);
  const addTwigs = (host: Limb, order: number) => {
    const count = Math.floor((host.len * 0.62) / twigGap * f.detail);
    let s = r() < 0.5 ? -1 : 1;
    for (let j = 0; j < count; j++) {
      const u = lerp(0.3, 0.92, (j + 0.5 + (r() - 0.5) * 0.5) / count);
      const node = host.first + Math.round(u * (host.last - host.first));
      const [wx, wy] = toWorld(sk.x[node], sk.y[node], pl);
      if (blocked(wx, wy)) continue;                  // no detail behind the avatar
      s = r() < 0.65 ? host.side || s : -s;           // prefer the side away from the spine
      const len = Math.max(0.05, host.len * lerp(0.32, 0.14, u) * (0.8 + 0.4 * r()));
      const tw = grow(node, headingAt(node) + s * (28 + 18 * r()) * deg, len, order,
                      (r() - 0.5) * 0.35, Math.min(sk.w[node] * 0.7, pp.tipWidth * 1.5), s, u, r() * 10);
      if (order === 2 && branching > 0.75 && f.detail > 0.7 && r() < 0.5) addTwigs(tw, 3);
    }
  };
  if (f.detail > 0.45 || branching > 0.8) for (const ft of feathers) addTwigs(ft, 2);

  sk.computeChildren();
  // 4. flex (distance from root along the path), maxFlex, height: exactly as today.
  // 5. Reveal schedule.
  const start = new Float32Array(limbs.length), span = new Float32Array(limbs.length);
  span[0] = 0.42;
  this.baseThr = new Float32Array(sk.n);
  for (let i = 1; i < sk.n; i++) {                    // nodes are created parent-first
    const b = this.limbOf[i], lb = limbs[b];
    if (i === lb.first && b > 0) {
      start[b] = this.baseThr[lb.attach] + 0.04 + 0.10 * lb.order;
      span[b] = 0.30 * Math.sqrt(lb.len / spineLen);
    }
    this.baseThr[i] = start[b] + span[b] * this.tAlong[i];
  }
  normalise(this.baseThr);                            // divide by max
  this.trunkFrac = this.baseThr[spine.first + Math.round((f.rClear / spineLen) * (spine.last - spine.first))];
  // 6. side[i] = world height, normalised to -1..1:  (x*f.upX + y*f.upY - mid) / halfRange
  // 7. branchId = limbOf; branchRand, vis, target, life, leafLife: as today.
  this.spineLimb = spine; this.feathers = feathers;   // kept for Part B
}
```

Small API additions on `Plant`, used by Part B:

```ts
spineLength: number;                               // arc length of order 0
spineAt(d: number): { x, y, tx, ty, w };           // local position, unit tangent and width at arc d;
                                                   // extrapolates in a straight line past the tip
revealSpine(): void;                               // vis = target = 1 for order-0 nodes
```

### Defaults and sliders

High-level sliders the artist gets. The four existing names are kept; two are redefined, two are new.

| Slider | Range | Default | Meaning now |
| --- | --- | --- | --- |
| `growth.branching` | 0..1 | 0.55 | 0 = spine plus four bare feathers; 1 = nine feathers, twigs and twiglets |
| `growth.reach` | 0.6..1.3 | 1.0 | Multiplies spine length (and with it every feather) |
| `growth.spread` | 0.4..1.5 | 1.0 | Fan aperture: scales feather divergence |
| `growth.sweep` | 0..1 | 0.75 | 0 = every plant a symmetric tree; 1 = side plants are one-sided wings |
| `plants.lift` (new) | -1..1 | 0.25 | Tips curve toward the sky (positive) or droop (negative) |
| `plants.wildness` (new) | 0..1 | 0.5 | Length jitter, wander, hero feather |

Fine detail under `plants`: `step` 0.03, `tipWidth` 0.008, `maxWidth` 0.035, `maxNodes` 900,
`featherSide` 1 (or -1), `softDroop` 1. The attractor, influence, kill, jitter, smoothing and
pipe-exponent values are no longer read. Judgement call: keep the old builder behind
`plants.generator: 'gesture' | 'colonise'` for one release so the two can be compared side by side.

Layout and envelope defaults (the envelope's `*Min`, `*Bend`, `*Taper` are no longer read):
`crownLength` 1.9, `crownHalfAngle` 70, `wingLength` 1.7, `wingHalfAngle` 50, `wedgeLength` 1.5,
`wedgeFill` 0.8 (half-angle = `min(55, 0.8 * step / 2)`), `wingTilt` 20, `downGap` 100.
`overlay.ts` should draw the guide as a simple fan (length, half-angle) since the envelope is gone.

## A7. Test plan

Render with theme `branches` first (bare structure), then `leaves`. Use
`sprout.params.scene.layers` and `sprout.advance()`.

- **Matrix:** seeds 1 to 8, take counts 1, 2, 3, 4, 6, 8, 12, at full reveal. Then one seed per
  count at reveal 0.25, 0.5, 0.75.
- **Automated checks** (a `plantMetrics(plant, placement)` debug function):
  - *Outline is not an arc:* standard deviation over mean of the tip distances of order 0 and 1
    limbs is above 0.15. I would expect today's trees to score under about 0.07.
  - *Nothing hugs:* less than 5 percent of visible stroke length has a heading more than 60
    degrees off radial, and none within 0.2 of the silhouette is more than 35 degrees off.
  - *Not wasted:* more than 75 percent of stroke length is not `blocked()` (apart from the
    down-pointing plants when `downGap` is off).
  - *Negative space:* on a circle of radius 1.25 around the origin, less than 60 percent of
    angles lie within 0.04 of a stroke.
- **What good looks like in a frame grab:**
  - Shrunk to 64 px and blurred, two takes read as a V or a pair of wings, and six takes as a
    star. Neither reads as a disc or a ring.
  - You can point at the main limb of every plant.
  - Every limb meets the avatar's edge steeply. Nothing runs along the head or shoulders.
  - At reveal 0.3 you see long bare spines with the first feathers opening near the root, not a
    small bush.
- **Regression:** change the take count from 2 to 3 mid-phrase and confirm no tree pops.

---

# Part B: the commit transition

## B0. The idea: crozier, staff, stamp

A fern frond starts as a coiled crozier and unrolls into a straight stalk with side blades, which
is the Part A tree. So the halo becomes a crozier:

1. the ring **winds tight** (anticipation) and moves to the wing's axis, just outside the avatar;
2. it **unrolls** along the tree's spine, with arc length conserved: a straight stalk grows while
   a shrinking, spinning coil rides at its tip;
3. the finished strand is a vine-wrapped **staff**, drawn back slightly along its own axis;
4. it **plunges** into the hidden root behind the singer, like planting a staff in the ground;
5. the impact **squeezes the feathers out** of the spine, throws the halo's leaves along them, and
   the staff is now the tree's spine.

Three decisions follow from what failed before:

- **Conserve length, do not scale.** A ring whose circumference equals the spine length has
  radius `L / 2pi`, about 0.27, which is the existing `restRadius` (0.3). So the wind-up is the
  motion the halo already makes when recording stops, and the unroll is physically honest: a ring
  0.55 across becomes a rod 1.7 long. I considered unrolling the big open ring directly and
  rejected it: its 6.6 units of circumference would have to be squeezed 4:1 into the spine, which
  is the "scaled sprite" look again.
- **The stamp is axial.** The rod thrusts along its own length into the root. This works for any
  direction, including the vertical crown, and does not sweep a bar across the frame. The impact
  point is hidden, which reads as "planted into her back"; the visible evidence is the jolt of the
  whole staff, a flash along it, a ring expanding from behind the avatar, and the splay.
- **The strand is the spine.** Both are functions of arc length, so there is no node-to-node map.

## B1. Choreography

Times are from the commit, in simulation time (`t`, so pause and `timeScale` work). All durations
scale with one `commit.duration` slider.

| Beat | Time | What happens | Easing | Feel |
| --- | --- | --- | --- | --- |
| 0 Release | 0 to 120 ms | Vine tips stop. Glow +40 percent, ring radius x 1.04. Colour starts moving from the live colour to the take colour (done by 720 ms). | ease-out quad | "It heard me stop" |
| 1 Wind-up | 120 to 520 ms | Radius goes from its current value to `Rc`. The centre moves round the head to the launch point. The vine spins 3/4 turn plus alignment, accelerating. The plain ring line fades to 40 percent. Half the ring's own leaves let go and drift. | radius and centre: ease-in-out cubic; spin: ease-in quad | Gathering, an inhale |
| 2 Unfurl | 520 to 1120 ms | Peel front `sigma` runs 0 to 1. The stalk lies along the spine and its base slides rootward; the coil rolls outward, shrinking as `sqrt(1 - sigma)`. Core width grows toward the spine's width. | smoothstep | Release, reaching |
| 3 Draw back | 1120 to 1300 ms (+ up to 300 ms) | Staff complete. It pulls 0.06 further out, glow ramps to x 2.2, width x 1.3, leaves swing to trail. Holds here for the sync window. | ease-out quad | Held breath |
| 4 Plunge | 80 ms | Staff drives rootward by `D` (0.28). The tip lags 20 ms (about 6 percent stretch). | ease-in cubic | The hit is coming |
| Impact | one frame | Spine switches to the plant's strokes. Flash, shock ring, quiver, burst. | none | Thunk |
| 5 Splay | impact to +450 ms | Feathers shoot out in a wave from root to tip (about 6 units per second along the spine), each overshooting slightly. Halo leaves fly along the feather directions. Vine wrap sinks into the spine. | per feather ease-out-back | Bloom, an exhale |
| 6 Settle | +450 to +1100 ms | Flash and quiver decay (time constants 120 ms and 250 ms). Plant eases to rest brightness. | exponential | Ring-out |

Impact lands at about 1.38 s; the splay is done by about 1.85 s. The settle tail is the plant's
own behaviour and blocks nothing.

**Musical hook.** The staff waits in beat 3 for the next onset on any audible layer (`onset` on a
layer with `level > 0.1`, the new live take included), for at most `syncWindow` (0.3 s). The
plunge starts on that onset, so the impact is 80 ms after it; that should be close enough to read
as on the beat. With nothing playing it times out and the transition runs at its fixed length. A
hold that short should read as anticipation, not waiting. If tempo ever reaches the viewer,
quantise to the next eighth note instead.

**Impact ingredients** (scaled by one `commit.impact` slider):

- *Flash:* spine and feathers get `shine` 0.8, glow x 3 and width x 1.8 for one frame, decaying
  with a 120 ms time constant.
- *Shock ring:* 64 stroke segments on an identity layer, centred on the root. Radius 0.3 to 1.6
  over 450 ms (ease-out cubic), alpha `(1 - e)^2`, width 0.012 to 0.003, take colour mixed halfway
  to white. It starts hidden and emerges all round the avatar.
- *Quiver:* multiply the plant layer's motion by `1 + 3 * exp(-tau / 0.25)` and add tremble
  amplitude `0.02 * exp(-tau / 0.25)` at 9 Hz. Both go through the existing `u_motion` uniform.
- *No full-screen distortion pass in the first version.* Judgement call: on thin lines over
  transparency a UV distortion mostly smears the alpha edge round the avatar. It belongs to the
  theatrical alternative.

## B2. Unwinding geometry

**Cut point.** Open the ring just ahead of the leading growing tip (the runner with the largest
`arc`; `HaloVine` needs a small `leadTip()` accessor). The strand parameter `u` runs 0 to 1 round
the ring in that runner's direction of travel, so `u = 1` is the fresh bright tip and `u = 0` is
the old faded tail. The meaning is "the growing tip lets go of the ring", and the youngest growth
ends up in the middle of the coil, as in a real crozier. The cut falls on faded vine, so no bright
runner is visibly sliced. With `bothWays` there are two leading tips of opposite direction; pick
the one whose direction puts the coil on the bare side of the spine (next paragraph).

**Coil side.** A layer cannot mirror, so the coil's turning sense in the world must equal the
vine's direction `dir`. The coil therefore sits on side `n = dir > 0 ? ccw(a) : cw(a)` of the
spine tangent `a`. Where there is a choice, prefer `n` opposite the feather side: the halo's
outward shoots (the high notes) then lie on the feather side of the stalk.

**Per-node data, computed once at the snapshot:**

- Runner node `i`: `u_i = frac(dir * (theta_i - theta_cut) / 2pi)` and `off_i = rho_i - 1` (its
  wander off the ring, in ring radii).
- Sprout node: its anchor runner (walk parents to the first runner) and its offset from that
  anchor in the anchor's tangent and outward-normal frame, `(dt, dn)`, in ring radii.
- A runner segment whose two ends have `u` more than 0.5 apart straddles the cut; set that
  node's parent to -1 so no stroke is drawn across it.

**Strand shape for a peel position `sigma`** (plant-local frame, lengths in plant units):

- `S` = strand length = spine length; `Rc = S / 2pi`.
- Stalk, for `u <= sigma`: the point on the spine at arc `d = base + S * u`, from
  `plant.spineAt(d)`. `base` slides from `b0 = max(D, rClear + Rc + 0.05)` to `D` during beat 2,
  so the coil starts outside the silhouette and the staff's foot moves in behind the avatar.
- Junction `J` at `u = sigma`, with tangent `a` and coil-side normal `n`.
- Coil, for `u > sigma`: radius `r = Rc * sqrt(1 - sigma)`, total angle
  `Theta = 2pi * sqrt(1 - sigma)`, `omega = Theta * (u - sigma) / (1 - sigma)`:
  - position `P = J + n * r * (1 - cos omega) + a * r * sin omega`
  - tangent `T = a * cos omega + n * sin omega`
  - outward normal `N = a * sin omega - n * cos omega`

  Check: `r * Theta = S * (1 - sigma)`, so arc length is conserved. At `sigma = 0` it is exactly
  a closed ring of radius `Rc` touching the spine at `J`. As `sigma` rises, material passes
  through `J`, so the coil visibly spins as it pays out.
- On the stalk, `T = a` and `N = -n`.
- A node is drawn at `P(u) + N(u) * off * Rc * wrap` (runners) or
  `P(u_anchor) + T * dt * Rc + N * dn * Rc` (sprouts).

**Side shoots and leaves while unwinding.** They ride rigidly in the local frame, so they swing
round with the coil and comb flat as they reach the stalk. `wrap` goes 1 to 0.6 during beat 2 and
to 0 after impact (the vine sinks into the spine). Leaves keep their world size; because the ring
has shrunk they are four times denser than on the open halo, so thin them: fade nodes with
`hash(id) > keep`, with `keep` going 1 to 0.5 across beats 1 and 2. The ones that go are the
drifting "surplus" leaves of beat 1.

**The core line.** The plain ring (`pushRing`) becomes a 72-sample polyline along `P(u)` with zero
offset. Its width goes from `ringWidth` to the plant's spine width at each arc position, so at
impact it is identical to the plant's own spine strokes.

## B3. Travel

- **Beat 1 is the only free flight**, and it is drawn with the existing halo path (`drawHalo` with
  an overridden centre, radius and rotation). The centre goes from the halo centre to the launch
  point `K0 = toWorld(spineAt(b0) + n * Rc)`. Interpolate in polar coordinates about the head
  centre (angle and radius separately), so a resting halo on top of the head travels round the
  head to a side wing. An open halo already surrounds the head; it tightens toward the point where
  it crosses the wing axis, and that side of it stays visible throughout.
- **Rotation** at the end of beat 1 must put the cut angle on the touching point `J0`. The target
  is `rho1 = angleOf(J0 - K0) - theta_cut`, plus whole turns so the total spin is at least 3/4
  turn in direction `dir`.
- **Moving destination.** `K0` and `rho1` are recomputed from the slot's current placement (with
  spin) every frame and blended from the snapshot by the beat's eased progress, so the ring
  converges on a target that is still easing. From beat 2 on, the strand is emitted in plant-local
  coordinates **with the slot's own layer index**, so the GPU applies the same origin, rotation,
  spin and scale as the plant. Nothing else is needed.
- **Sway.** The plant layer bends by `flex`. Give strand nodes `flex = arc * s`, where `s` rises
  0 to 1 across beat 2, and give coil nodes the junction's flex. The strand then has no sway at
  the switch from the halo layer (no jump there) and full plant sway by the time it is a staff (no
  jump at impact).
- **Orientation** is never interpolated separately. The stalk takes the spine's tangent.

## B4. The stamp, and how the strand becomes the plant

**Recommendation: the strand becomes the spine, and the tree is built first.** At the commit, the
slot's first generation is created and built immediately but kept invisible. The strand then
conforms to that tree's spine through `spineAt`. I prefer this to "build the plant around a given
spine" because the tree's quality stays entirely the generator's business and the strand lands
exactly, by construction. I prefer it to morphing nodes because the counts and topologies differ
and a morph of 1000 points into 300 is the blur that was already rejected. I prefer it to a burst
from the stamp point because then the halo's vine would not visibly become anything.

At the impact frame, once:

1. `plant.revealSpine()` and stop drawing the strand's core line. They are the same curve with
   the same width in the same layer, so there is no visible change apart from the flash.
2. `slot.alpha = 1` (no ramp). `gen.reveal = max(gen.reveal, commit.stampReveal)` (default 0.6:
   spine, most of each feather, no twigs).
3. Reveal boost: multiply `regrowSpeed` by `1 + 5 * exp(-tau / 0.2)`. Feathers still wait for the
   spine node they attach to, so set `vis` along the spine with a delay of `arc / 6` seconds; that
   gives the root-to-tip wave. Feather length overshoot: draw with `min(1.08, ...)` for 150 ms.
4. Mark the generation `stamped`: it does not fade while idle, and the take's first phrase keeps
   growing it instead of calling `regrow()` (then the flag clears). Without this, the stamped tree
   would fade after `fadeAfter` if the new take is not playing back yet.
5. Colour: the strand reached the take colour in beat 2, so there is no colour change at impact.

The tree's `Mood` comes from the halo: keep level-weighted running means of effort, pitch,
softness and vibrato on `LiveHalo` while it records. The stamped tree then reflects how the take
was sung.

## B5. Data mapping

Do not map nodes to nodes. Both sides are functions of spine arc length.

| Halo element | During flight | At and after impact |
| --- | --- | --- |
| Ring line | Core polyline `P(u)` | Replaced by the plant's order-0 strokes (identical) |
| Runner nodes (~60 percent) | `P(u) + N * off` | Offset goes to 0 and alpha to 0 over 250 ms: the wrap sinks into the spine |
| Sprout nodes (~40 percent) | Rigid on their anchor | Released as burst particles (below) |
| Vine and ring decorations | `decorateTree` on the strand skeleton, same stable ids, thinned by `keep` | Burst particles; the plant's own decorations pop in through its normal `vis` |

**Burst.** Choose up to `commit.burst` (36) strand nodes by hash, preferring sprout tips. Each
becomes a free sprite in an identity layer, starting at its world position at impact:

- shape by theme: leaf; thorn; needle, with a berry for one in five; for `branches`, a short
  stroke "splinter";
- direction: the heading of the nearest feather on its side (nearest by attach arc), plus or minus
  0.3 rad;
- speed 1.2 to 2.8 units per second with drag 5 per second, so it travels 0.25 to 0.55 units,
  just ahead of the feather growing behind it;
- spin `(h - 0.5) * 8` rad per second; alpha `(1 - e)^1.5` over 450 to 650 ms; gravity 0.3.

Every remaining strand node fades in 150 ms. The leaves trace the feathers a moment before the
feathers fill in, and that is what makes the stamp read as the halo's foliage becoming the wing.

## B6. Pseudocode

```ts
// growth/commit.ts
export interface HaloSnapshot {
  sk: Skeleton; vis: Float32Array; alpha: Float32Array; ids: Int32Array;   // copies
  cx: number; cy: number; R: number;                                       // halo layer at commit
  look: { theme: Theme; density: number; colour: string };
  seed: number; lead: { angle: number; sign: number }; mood: Mood;
}
export interface CommitTarget { place: Placement; spinAngle: number; plant: Plant; layer: number }
export interface CommitHooks {                      // provided by main.ts; reuses pushTree / decorateTree
  drawRing(cx: number, cy: number, R: number, rot: number, snap: HaloSnapshot, o: StrandLook): void;
  drawSkeleton(sk: Skeleton, vis: Float32Array, alpha: Float32Array, ids: Int32Array, layer: number, o: StrandLook): void;
  stroke(layer: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number, fa: number, fb: number, o: StrandLook): void;
  sprite(x: number, y: number, angle: number, size: number, shape: number, rgb: RGB, a: number): void; // fx layer
  blocked(wx: number, wy: number): boolean;
}
const T = { release: 0.12, wind: 0.40, unfurl: 0.60, draw: 0.18, plunge: 0.08, splay: 0.45 };

export class CommitAnimation {
  done = false;
  stampedAt = -1;                                   // sim time of impact
  private u: Float32Array; private off: Float32Array;          // runners
  private anchor: Int32Array; private dt: Float32Array; private dn: Float32Array; // sprouts
  private dir: number; private thetaCut: number;
  private tmp = new Skeleton(2048);
  private particles: Particle[] = [];
  private last?: { place: Placement; spinAngle: number };      // frozen if the target vanishes
  private aborted = -1;

  constructor(readonly slotId: string, private snap: HaloSnapshot, private t0: number, private p: Params) {
    this.dir = snap.lead.sign;
    this.thetaCut = snap.lead.angle + this.dir * 0.06;         // just ahead of the leading tip
    // fill u/off for runners; anchor/dt/dn for sprouts; set parent = -1 across the cut
  }

  /** Call every frame with the slot's current placement, or undefined if the take is gone. */
  update(t: number, dt: number, target: CommitTarget | undefined, onset: boolean, hooks: CommitHooks) {
    const k = Math.max(0.3, this.p.commit.duration);
    const tau = (t - this.t0) / k;
    if (!target && this.stampedAt < 0 && this.aborted < 0) this.aborted = t;      // B7.4
    if (target) this.last = { place: { ...target.place }, spinAngle: target.spinAngle };
    if (this.aborted >= 0) return this.scatter(t, hooks);

    const tWind = T.release, tUnf = tWind + T.wind, tDraw = tUnf + T.unfurl, tReady = tDraw + T.draw;
    // Plunge starts on the first onset after tReady, or at the timeout. Stored once, then stateless.
    if (this.plungeAt < 0 && tau >= tReady &&
        (onset || !this.p.commit.syncToOnset || tau >= tReady + this.p.commit.syncWindow / k))
      this.plungeAt = t;
    const pl = target!.place, plant = target!.plant;
    const S = plant.spineLength, Rc = Math.max(S / TAU, 0.16 / pl.scale);
    const D = this.p.commit.plunge / pl.scale;

    if (tau < tUnf) {                                           // beats 0-1: still a ring, halo layer
      const e = easeInOutCubic(clamp((tau - tWind) / T.wind));
      const b0 = Math.max(D, plant.rClear + Rc + 0.05);
      const sp = plant.spineAt(b0), n = this.coilNormal(sp);
      const K0 = toWorld(sp.x + n.x * Rc, sp.y + n.y * Rc, pl, target!.spinAngle);
      const J0 = toWorld(sp.x, sp.y, pl, target!.spinAngle);
      const c = polarLerpAbout(this.p.avatar.headX, this.p.avatar.headY, [this.snap.cx, this.snap.cy], K0, e);
      const R = lerp(this.snap.R * (1 + 0.04 * easeOutQuad(clamp(tau / T.release))), Rc * pl.scale, e);
      const rho1 = alignTurns(Math.atan2(J0[1] - K0[1], J0[0] - K0[0]) - this.thetaCut, this.dir, 0.75);
      const rot = rho1 * easeInQuad(clamp((tau - tWind) / T.wind));
      hooks.drawRing(c[0], c[1], R, rot, this.snap, this.look(tau, 0));
      return;
    }

    // Beats 2-5: strand in the plant's local frame, drawn in the plant's layer.
    const sigma = smoothstep(clamp((tau - tUnf) / T.unfurl));
    const plungeE = this.plungeAt < 0 ? 0 : (t - this.plungeAt) / (T.plunge * k);
    if (plungeE >= 1 && this.stampedAt < 0) { this.stampedAt = t; this.spawnBurst(target!, hooks); }
    const after = this.stampedAt < 0 ? -1 : t - this.stampedAt;
    const drawBack = 0.06 / pl.scale * easeOutQuad(clamp((tau - tDraw) / T.draw));
    const b0 = Math.max(D, plant.rClear + Rc + 0.05);
    const baseAt = (u: number) => {                             // tip lags 20 ms: smear
      const pe = clamp(plungeE - (0.02 / T.plunge) * u);
      return lerp(b0, D, sigma) + drawBack - (D + drawBack) * easeInCubic(pe);
    };
    const swayIn = sigma;
    const wrap = after < 0 ? lerp(1, 0.6, sigma) : 0.6 * (1 - clamp(after / 0.25));
    const point = (u: number) => {
      if (u <= sigma || sigma >= 0.999) {
        const d = baseAt(u) + S * u, sp = plant.spineAt(d), n = this.coilNormal(sp);
        return { x: sp.x, y: sp.y, tx: sp.tx, ty: sp.ty, nx: -n.x, ny: -n.y, flex: d * swayIn, w: sp.w };
      }
      const dJ = baseAt(sigma) + S * sigma, sp = plant.spineAt(dJ), n = this.coilNormal(sp);
      const q = Math.sqrt(1 - sigma), r = Rc * q, om = TAU * q * (u - sigma) / (1 - sigma);
      const c = Math.cos(om), s = Math.sin(om);
      return { x: sp.x + n.x * r * (1 - c) + sp.tx * r * s, y: sp.y + n.y * r * (1 - c) + sp.ty * r * s,
               tx: sp.tx * c + n.x * s, ty: sp.ty * c + n.y * s,
               nx: sp.tx * s - n.x * c, ny: sp.ty * s - n.y * c, flex: dJ * swayIn, w: sp.w };
    };

    // Vine and shoots: fill this.tmp with the snapshot's topology and ids, new positions.
    const sk = this.tmp; sk.reset();
    const keep = lerp(0.75, 0.5, sigma), fade = after < 0 ? 1 : 1 - clamp(after / 0.15);
    for (let i = 0; i < this.snap.sk.n; i++) {
      const sprout = this.snap.sk.kind[i] === NodeKind.Sprout;
      const q = point(this.u[sprout ? this.anchor[i] : i]);
      const x = sprout ? q.x + (q.tx * this.dt[i] + q.nx * this.dn[i]) * Rc : q.x + q.nx * this.off[i] * Rc * wrap;
      const y = sprout ? q.y + (q.ty * this.dt[i] + q.ny * this.dn[i]) * Rc : q.y + q.ny * this.off[i] * Rc * wrap;
      sk.add(x, y, this.snap.sk.parent[i], q.flex, this.snap.sk.w[i] / pl.scale, this.snap.sk.kind[i]);
      this.nodeAlpha[i] = this.snap.alpha[i] * (sprout ? fade : (after < 0 ? 1 : wrap / 0.6))
                        * (hash1(this.snap.ids[i] * 3.7) > keep ? 0.0 : 1.0);
    }
    sk.computeChildren();
    const look = this.look(tau, after);
    hooks.drawSkeleton(sk, this.snap.vis, this.nodeAlpha, this.snap.ids, target!.layer, look);

    // Core line, until the plant's own spine takes over.
    if (after < 0) {
      const N = 72; let a = point(0);
      for (let j = 1; j <= N; j++) {
        const b = point(j / N);
        const w = (s: typeof a) => lerp(this.p.halo.ringWidth / pl.scale, s.w, sigma) * look.width;
        hooks.stroke(target!.layer, a.x, a.y, b.x, b.y, w(a), w(b), a.flex, b.flex, look);
        a = b;
      }
    }
    this.drawShockRing(after, hooks); this.drawParticles(t, dt, hooks);
    this.done = after > T.splay * k + 0.7 && this.particles.length === 0;
  }
}
```

Helper notes:

- `coilNormal(sp)` is `dir > 0 ? (-ty, tx) : (ty, -tx)`.
- `polarLerpAbout` interpolates angle and radius about the head; if the start radius is under
  0.05 it uses the target's angle.
- `alignTurns(a, dir, min)` adds whole turns in direction `dir` until at least `min` turns.
- `look(tau, after)` returns colour (live to take, done by 720 ms), glow, width and shine,
  including the beat-3 charge and the impact flash.
- Particles integrate with `dt` but are spawned with a known start time, so a long frame still
  places them correctly.

Wiring in `main.ts`:

```ts
// simulate(), where a halo leaves `halos`:
for (const h of halos) if (!nextHalos.includes(h)) {
  const k = ids.indexOf(h.id);                                  // its id is now a take
  if (k >= 0 && !slots.some((s) => s.id === h.id) && commits.length < 4)
    commits.push(new CommitAnimation(h.id, snapshotOf(h), t + 0.09 * commitsStartedThisFrame++, params));
  else { h.endT0 = t; endingHalos.push(h); }                    // unchanged: plain fade
}
// When creating the Slot for an id that has a commit: slot.pending = true; slot.gens.regrow();
//   then ensureBuilt(...) with the halo's mood, so plant.spineAt() exists from frame 1.
// While slot.pending: its plant strokes are not drawn (alpha 0) and its reveal does not advance.
// When commit.stampedAt is first set: slot.pending = false; slot.alpha = 1; gen.reveal = max(...);
//   gen.stamped = true; plant.revealSpine(); plant.burstAt = t.
// newHalo('idle') created on the same frame as a commit: spawnT0 = t + 0.5 (see B7.1).
// draw(): assign the slot's layer first, then call commit.update(...) with that layer; reserve one
//   identity "fx" layer shared by all shock rings and particles.
```

Changes in `Plant` and `Generations`:

- `Plant`: `spineLength`, `spineAt`, `revealSpine`, `rClear` and `feathers` (Part A).
  `computeReveal` takes a `boost` factor on `regrowSpeed` and a per-spine-node delay after
  `burstAt`.
- `Generations.update`: skip the fade test and the first `regrow()` while `gen.stamped` is set.
- `HaloVine`: `leadTip()` returning the angle and sign of the runner with the largest `arc`.

## B7. Constraints and edge cases

1. **The next take starts at once, or a new halo pops in.**
   - The departing ring changes to the take colour within 720 ms, loses its plain ring line,
     spins, and leaves the halo's position during beat 1.
   - A new *idle* halo's spawn is delayed 0.5 s, because the resting halo and the wound-up ring
     are the same size and, for a crown, in the same place.
   - A new *recording* halo opens round the head as usual; the departing one is by then a small
     ring off to the side.
2. **Several halos commit together.** Each gets its own animation, cut and slot. Starts are
   staggered 90 ms (outermost first), so the stamps land as a quick run. The onset sync applies to
   each separately. Above four at once, the extras use the short form (wind-up, flash, feathers
   burst; no unfurl).
3. **Re-layout during the animation.** Free from beat 2 (plant layer); beat 1 chases the live
   target. `layout.ease` 2.5 means most of the rotation is done by the unfurl, which reads as the
   other wings making room. Requires the Part A change that trees do not rebuild on re-layout.
4. **Destination disappears.**
   - Before impact: the strand scatters. Every node drifts along its current tangent at 0.3 units
     per second with slight gravity and fades in 400 ms. No stamp.
   - After impact: the slot is already in `dying`; the particles finish and the animation ends.
   - The last placement is kept each frame so the strand still has a frame to draw in.
5. **Spin.** Handled by the plant layer. Beat 1 uses `angle + spin * tierDir`.
6. **Themes.** The strand is drawn by the existing `decorateTree` with the halo's theme, density
   and stable ids, so leaves, thorns and wreath all carry over unchanged. Burst sprites use the
   theme's shape; `branches` uses splinter strokes.
7. **Opaque centre.** The launch point is outside the silhouette by construction. The plunge is
   hidden at the root but seen as the staff's 0.28 jolt. If less than 40 percent of the spine is
   visible (down-pointing slots without `downGap`), use the short form: the ring winds up at the
   exit point and dives behind the body; flash and shock ring at the edge.
8. **Low frame rates.** Every pose is a pure function of `t - t0`, the snapshot and the current
   placement. The only stored state is `plungeAt`, `stampedAt` and the particle list. The impact
   actions run on `plungeE >= 1 && stampedAt < 0`, so a 100 ms hitch across the impact still fires
   them exactly once.
9. **Halo already resting, or commit right after spawn.** The wind-up shortens with the distance
   to cover: `lerp(0.2, 0.4, clamp((R0 - Rc) / 0.7))`. An empty vine still works: the core line
   alone unrolls.
10. **Very small destination** (twelve takes, inner tier). `Rc` has a floor of 0.16 world units so
    the coil stays readable. The strand is then longer than the spine and is compressed along the
    stalk by `S_spine / S_strand`; at that size the squeeze should not be noticeable.
11. **No slot** (more than 16 takes) **or no free layer:** fall back to today's 0.8 s fade.

## B8. Sliders

| Parameter | Range | Default | Tuned by the artist? |
| --- | --- | --- | --- |
| `commit.duration` | 0.6..1.6 | 1.0 | Yes: overall pace |
| `commit.impact` | 0..2 | 1.0 | Yes: flash, shock ring, quiver together |
| `commit.stampReveal` | 0.2..1 | 0.6 | Yes: how much tree the stamp leaves |
| `commit.burst` | 0..80 | 36 | Yes: leaves thrown |
| `commit.syncToOnset`, `commit.syncWindow` | on/off, 0..0.5 s | on, 0.3 | Once |
| `commit.plunge` | 0.1..0.5 | 0.28 | Rarely |
| `commit.spinTurns` | 0..2 | 0.75 | Rarely |
| `commit.shockRing` | on/off | on | Once |

## B9. Two alternative directions

- **Restrained: "the pour" (about 1.2 s, no impact).** The open ring does not wind up. It pays out
  from the cut like thread from a spool, the thread runs round the head into the root, and the
  tree's reveal is driven by the length consumed (the ring's 6.6 units is roughly the length of
  spine plus feathers). Calm and continuous, but it is a cross-flow, not a stamp, and the joining
  point is hidden.
- **Theatrical: "whip and seal" (about 2.2 s).** After the wind-up the strand cracks out along the
  wing direction as a whip with a travelling wave. It lands on the beat with a full-screen
  shockwave distortion pass, a brief seal (a ring plus radial ticks) at the silhouette edge, twice
  the leaf burst, and a short pulse on every other plant. More spectacle, more GPU, and it may
  wear thin on the tenth take of a song.

## B10. Risks and how to test quickly

| Risk | Why it would look bad | Quick check |
| --- | --- | --- |
| Wind-up reads as scaling | A uniform shrink is what was rejected | Contact sheet of beat 1 at 40 ms steps. The spin must be obvious and leaves must not shrink with the ring. If it still reads as zoom, raise `spinTurns` to 1.5. |
| Pop at the hand-over | Core line and plant spine disagree by a pixel or a width | Set `impact` to 0 and difference the frames either side of impact. Only feathers should differ. |
| Bloom blow-out | Four times leaf density on the staff, plus the flash | Wreath theme at density 1, `glow.strength` 1.6. Clamp the charge glow if the staff turns into a white bar. |
| Coil too small to read | `Rc` about 0.27 is roughly 150 px across at 1080p; less for small slots | Grab at 1080p with 6 and 12 takes. The floor on `Rc` is the lever. |
| Confusion with the new halo | Same size and place for a crown | Fake singer, `liveTracks` 2, commit one; and commit with one track when zero takes exist. |
| Busy frame | All plants re-laying out while one stamps | Commit with 1, 2, 5 and 11 existing takes. If it is too much, raise `layout.ease` so the others settle before the unfurl. |
| Stamp hidden | Down-pointing slots | Commit into each slot of the 6-take layout with `downGap` off. |
| Sync feels late | A 300 ms hold | Compare `syncWindow` 0 and 0.3 against a metronome take. |
| Hitches | State that depends on frame count | Run the sequence at 8 fps and at 60 fps; grabs at the same times must match. |
| Destination removed | Dangling strand | Delete the take at 0.3, 0.8 and 1.2 s and just after impact. |

Capture recipe: `sprout.action('commit')`, then step with `sprout.advance(1/30)` and save
`canvas.toDataURL()` for 70 frames into a contact sheet. `advance` currently steps at a fixed 1/60;
give it an optional step argument for the hitch test. Run each scenario with all four themes and
once with spin on. Use `scene.timeScale` 0.25 to watch it live.

## Suggested build order

1. Part A generator behind `plants.generator`, with the new reveal schedule and the no-rebuild
   rule. Judge with the A7 matrix before touching the commit.
2. `spineAt`, `revealSpine`, the `stamped` generation flag.
3. Commit beats 2 to 5 in the plant layer (start from a ring already at the launch point). This is
   the core of the effect and can be judged alone.
4. Beat 1 (wind-up and travel), then the onset sync, burst, shock ring and quiver.
5. Edge cases from B7, then the mood and the live fan pose from A5.
