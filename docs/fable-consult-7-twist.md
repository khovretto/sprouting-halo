# Design consult 7: twisting branches, a "dark and twisted" look, a light test backdrop

Written against commit 44392d6 (branch `part-a-gesture-trees`). Read: `viewer/src/growth/plant.ts`,
`growth/skeleton.ts`, `growth/halo.ts`, `shaders/stroke.vert`, `stroke.frag`, `motion.glsl`,
`composite.frag`, `blur.frag`, `render/renderer.ts`, `main.ts` (`pushTree`, `pushRing`, `drawPlant`,
`draw`), `motion.ts`, `params.ts`, `presets.ts`, `panel-layout.ts`, `ui.ts` (`RANGES`), `deco.ts`,
`growth/commit.ts` (uses of `limbAt`), `index.html`. Nothing was run or seen on screen: every number
is a starting point reasoned from the code. No source file was changed.

## Summary

| # | Question | Decision |
| --- | --- | --- |
| 1 | Where does twist live | **In the build**, as a post-pass over the finished skeleton (new step 4b in `buildGesture`, between the shoots and `sk.computeChildren()`). It only moves `sk.x / y / w`. Everything downstream (flex, bend frames, `limbPaths`, spine, tone, leaf ranks, decorations, fronds) is computed after it from the moved nodes, so all of them agree for free. Topology, node count, node order, reveal schedule, tip targets, hub and the hidden part do not change: the silhouette is the same tree, its branches just do not run straight. |
| 2 | Shader twist | Not for the static shape (decorations and fronds would disagree). Only an optional animated **writhe** on top (`motion.writhe`), written as a function of the rest point so joints stay closed and sprites follow. |
| 3 | Rope strands | Feasible at draw time in `pushTree`: a limb segment is emitted as 2 or 3 thinner strokes on a phase-shifted helix, back strand first, dimmer when behind. Limbs only (order <= 1), so about +30..70 % stroke instances. Envelope width stays the branch width. |
| 4 | Gnarl, knots, curls | Gnarl = irregular wavelength + elbows (sine blended to a triangle wave). Knots = width bulges at elbows and forks. Curls = a short spiral **appended** to limb tips and some twig ends (new nodes at the end of the skeleton, inside the band, budgeted). |
| 5 | Voice | Free at build time: the phrase's vibrato and effort scale the twist (`plants.twistVoice`, uses the existing `mood`). Live: `motion.writhe` driven by vibrato (or effort / loudness / nothing). Both optional. |
| 6 | Preset | Look **"Dark & twisted"** (`twisted`) and Reaction **"Writhing"** (`writhe`), section 2. Needs two small glow additions to read on dark *and* light: `glow.tintFlat` (dark ink still gets a coloured rim) and `glow.shadow` (a dark soft outline from the blurred coverage that already exists). |
| 7 | Backdrop | `scene.backdrop` already exists (`'checker' \| 'black' \| 'none'`, a CSS class on `<body>`, skipped in OBS). Add `'checker-light'`, `'white'` and `'checker-split'`. CSS only; the canvas pixels stay exactly what OBS gets. |

### New keys at a glance

All defaults leave today's picture unchanged (`twist`, `gnarl`, `knots`, `curl`, `writhe`, `shadow`,
`tintFlat`, `halo.twist`, `halo.braid` = 0; `strands` = 1). The others only scale those.

| Key | Default | Range | 0 means | Folder | Adv. | Kind |
| --- | --- | --- | --- | --- | --- | --- |
| `plants.twist` | `0` | 0..1 | straight branches (today) | Tree shape | | visual |
| `plants.gnarl` | `0` | 0..1 | even, smooth waves | Tree shape | | visual |
| `plants.curl` | `0` | 0..1 | no spiral tips | Tree shape | | visual |
| `plants.strands` | `1` | 1..3, step 1 | 1 = single stroke (today) | Tree shape | | visual |
| `plants.twistLength` | `0.35` | 0.15..0.8 | (length of one turn on a limb, plant units) | Tree shape | yes | visual |
| `plants.twistTighten` | `0.5` | 0..1 | same turn length root to tip | Tree shape | yes | visual |
| `plants.twistTwigs` | `1` | 0..2 | only limbs twist, twigs stay straight | Tree shape | yes | visual |
| `plants.knots` | `0` | 0..1 | no bulges | Tree shape | yes | visual |
| `plants.twistDepth` | `0.6` | 0..1 | flat: no near / far shading of turns and strands | Tree shape | yes | visual |
| `plants.strandLay` | `9` | 4..20 | (one strand turn per this many branch widths) | Tree shape | yes | visual |
| `plants.twistVoice` | `1` | 0..2 | the phrase does not change the twist | Pitch, effort and softness | | reactivity |
| `motion.writhe` | `0` | 0..1 | branches do not squirm | Held notes & vibrato | | reactivity |
| `motion.writheVoice` | `'vibrato'` | `'none' \| 'vibrato' \| 'effort' \| 'loudness'` | none = always squirms | Held notes & vibrato | | reactivity |
| `halo.braid` | `0` | 0..1 | plain ring (today) | Live halo | | visual |
| `halo.twist` | `0` | 0..1 | vine follows the ring as today | Live halo | yes | visual |
| `glow.shadow` | `0` | 0..1 | no dark outline | Glow | | visual |
| `glow.shadowColour` | `'#000000'` | colour | | Glow | | visual |
| `glow.tintFlat` | `0` | 0..1 | glow strength follows ink brightness (today) | Glow | yes | visual |
| `scene.backdrop` | `'checker'` | adds `'checker-light'`, `'white'`, `'checker-split'` | | Test & preview | | testing |

Wiring: `plants.twistVoice` goes into `REACTIVE` in `presets.ts` (`motion.*` is reactive by section;
everything else is visual with no change). Ranges into `ui.ts` `RANGES`. Folders, labels and tips in
section 1.9. A smallest useful first cut is `plants.twist`, `twistLength`, `gnarl`, `curl`, the
backdrop and `glow.shadow`; strands, writhe and the halo keys can follow.

---

## 1. Twisting branches

### 1.1 What "keep the shape" pins down

These must come out identical with any twist setting, and the design below guarantees each:

| Kept | How |
| --- | --- |
| Tip targets on the outline, hub, fork and shoot topology, node count and node index order | Twist runs after steps 1 to 4 and never adds, removes or reorders their nodes. |
| Limb tips exactly on their targets | The envelope of an order-1 limb is 0 at both ends. |
| The hidden part (trunk, primaries behind the avatar), the steep moat crossing, `trunkFrac`, `limbPaths[k].clear`, `rClear` | Envelope is 0 while hidden and ramps in after `limb.emerge`. |
| Moat, avatar, territory, outline x 1.04 | A displaced node that was `inBand` must still be `inBand`; otherwise its offset is halved, then dropped. |
| Reveal order | `tAlong`, `limb.len`, `start / span` are parametric and untouched; `baseThr` comes out the same. |
| Joints | A child branch starts at its parent node's *displaced* position (carried offset). |
| Twist 0 = today, bit for bit | The pass is skipped at 0 and uses its own `rng`, so the main random stream is never consumed. |

Things that change a little and are fine: `flex` and `maxFlex` grow with the real arc length (about
+7 % at the preset's values), so regrow time, wither depth and the carrier sway scale with it;
`witherH` rises for ancestors of a curl.

### 1.2 The model

Each branch keeps its built centreline `X0(s)` (s = arc length from its base). The drawn centreline
is

```
X(s) = X0(s) + C(s) + N0(s) * A(s) * m(phi(s))
```

- `N0` = unit normal of the *rest* centreline (never of the displaced one: no feedback).
- `phi(s)` = accumulated phase, `dphi = 2*pi * ds / lambda(s)`. This is a helix of radius A about the
  branch axis seen from the side: the lateral part is `sin(phi)`; the depth part `cos(phi)` is not
  drawn as position but as brightness (`plants.twistDepth`), which is what makes it read as a
  corkscrew rather than a flat wiggle.
- `m` = `sin`, blended toward a triangle wave by gnarl (elbows).
- `A(s)` = amplitude x envelope `E(s)`. `E` is 0 at the base, 0 while hidden, 0 at the tip of an
  order-1 limb; twig tips (order >= 2) stay free, which gives them a natural hooked end.
- `C(s)` = the parent's offset at the attach node, carried: constant for twigs (a twig is a rigid
  passenger of its limb, its shape is unchanged), fading to 0 along an order-1 fork (its tip must
  land on its own target).
- Phase continuity: a child starts with its parent's phase at the attach node (the same "grain"
  runs through the tree); twigs add a random offset so neighbours do not swing in step.

Caps that keep it drawable with `plants.step`-long segments and flat joins:

```
lambda >= 8 * ds                         (at least 8 nodes per turn)
A <= thetaMax * lambda^2 / (4*pi^2 * ds) (turn per node at a crest <= thetaMax)
     thetaMax = 0.22 rad on limbs, 0.30 on twigs (twigs already turn 0.30 today: kMax * step)
A <= 0.16 * branch length
```

With the default `step` 0.03 and `twistLength` 0.35 a limb gets at most A = 0.023 (about 1.5 limb
widths). With `step` 0.02 and `twistLength` 0.4 it is 0.045. A look that wants strong twist
lowers `plants.step`; the preset does.

### 1.3 Step 4b in `buildGesture` (after the `shootRound` loop, before `// 5. Per-node arrays`)

New fields on `Plant`: `twistPhase = new Float32Array(0)` (strand phase per node), `elbow = new
Uint8Array(0)` (node turns sharply: its incoming segment keeps a round end), and `end?: number` on
`Limb` (last node including a curl). Add to the `ensureBuilt` signature: `pp.twist, pp.twistLength,
pp.gnarl, pp.knots, pp.curl, pp.twistTighten, pp.twistTwigs, pp.twistDepth, pp.strandLay,
pp.twistVoice`. `plant.ts` needs `TAU` added to its import from `../math`.

```ts
// 4b. Twist (consult 7). Moves x, y, w only.
const tw = clamp(pp.twist * (1 + pp.twistVoice * (0.6 * mood.vibrato + 0.5 * (mood.effort - 0.5))), 0, 1.5);
const gn = clamp(pp.gnarl), n0 = sk.n;
this.twistPhase = new Float32Array(pp.maxNodes + 1);
this.elbow = new Uint8Array(pp.maxNodes + 1);
const rt = rng(this.seed * 977 + 11);                 // own stream
const offX = new Float32Array(n0), offY = new Float32Array(n0), phi = new Float32Array(n0);
if (tw > 0 || pp.knots > 0 || pp.strands > 1) {
  const x0 = sk.x.slice(0, n0), y0 = sk.y.slice(0, n0);
  const AMP = [0, 0.05, 0.032, 0.022];               // by order, at twist = 1
  const lam0 = pp.twistLength;
  for (const lb of limbs) {                           // creation order: parents first
    if (lb.last < lb.first) continue;
    const ord = Math.min(3, lb.order), at = lb.attach;
    let Lb = 0;
    for (let i = lb.first; i <= lb.last; i++) { const q = i === lb.first ? at : i - 1; Lb += Math.hypot(x0[i] - x0[q], y0[i] - y0[q]); }
    const A0 = Math.min(AMP[ord] * tw * (ord >= 2 ? pp.twistTwigs : 1), 0.16 * Lb);
    const ramp = Math.min(0.12, 0.35 * Lb);
    const thetaMax = ord >= 2 ? 0.30 : 0.22;
    const sgn = rt() < 0.5 ? -1 : 1, ns = rt() * 100;
    let ph = phi[at] + (ord >= 2 ? Math.PI * rt() : 0), psi = this.twistPhase[at], s = 0;
    for (let i = lb.first; i <= lb.last; i++) {
      const q = i === lb.first ? at : i - 1, nx = i < lb.last ? i + 1 : i;
      const ds = Math.hypot(x0[i] - x0[q], y0[i] - y0[q]);
      s += ds;
      const t = s / Math.max(1e-6, Lb);
      let tx = x0[nx] - x0[q], ty = y0[nx] - y0[q];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;                              // rest tangent; normal = (ty, -tx)
      const lam = Math.max(8 * ds, lam0 * (ord >= 2 ? 0.6 : 1) * lerp(1, 0.45, pp.twistTighten * t)
        * Math.exp(0.7 * gn * noise1(s * 4 + ns, this.seed)));
      ph += (TAU * ds) / lam;
      let E = hidden(x0[i], y0[i]) ? 0 : smooth01(lb.emerge, lb.emerge + ramp, s);
      if (ord < 2) E *= smooth01(0, ramp, Lb - s);      // limb tips stay on their targets
      const A = Math.min(A0, (thetaMax * lam * lam) / (4 * Math.PI * Math.PI * ds)) * E
        * (1 + 0.6 * gn * noise1(s * 6 + ns + 31, this.seed));
      const sn = Math.sin(ph);
      const m = sgn * lerp(sn, (2 / Math.PI) * Math.asin(sn), 0.8 * gn);   // sine -> elbows
      const carry = ord >= 2 ? 1 : 1 - smooth01(0, 1, t);
      let dx = offX[at] * carry + ty * A * m, dy = offY[at] * carry - tx * A * m;
      const band = inBand(x0[i], y0[i]), hid = hidden(x0[i], y0[i]);
      for (let k = 0; k < 3; k++) {                    // full, half, none
        const ok = band ? inBand(x0[i] + dx, y0[i] + dy) : hid || !hidden(x0[i] + dx, y0[i] + dy);
        if (ok) break;
        dx = k < 1 ? dx / 2 : 0; dy = k < 1 ? dy / 2 : 0;
      }
      offX[i] = dx; offY[i] = dy; phi[i] = ph;
      sk.x[i] = x0[i] + dx; sk.y[i] = y0[i] + dy;
      // Strand phase: one turn per strandLay branch widths (a rope's lay), never under 4 nodes.
      psi += (TAU * ds) / Math.max(pp.strandLay * 2 * sk.w[i], 4 * ds);
      this.twistPhase[i] = psi;
      // Knots at the crests.
      sk.w[i] *= 1 + 0.45 * pp.knots * E * Math.pow(Math.abs(sn), 6);
    }
  }
  // Knots where a fork leaves a limb (not at every twig: that would thicken the whole limb).
  for (const lb of limbs)
    if (lb.order === 1 && lb.prim < 0 && lb.last >= lb.first && pp.knots > 0) {
      sk.w[lb.attach] *= 1 + 0.5 * pp.knots;
      if (sk.parent[lb.attach] > 0) sk.w[sk.parent[lb.attach]] *= 1 + 0.25 * pp.knots;
    }
  // Elbows: a node whose in and out directions differ by more than 0.3 rad.
  for (let i = 1; i < n0 - 1; i++) {
    const pa = sk.parent[i], c = i + 1;
    if (pa < 0 || sk.parent[c] !== i) continue;
    const a = Math.atan2(sk.x[i] - sk.x[pa], sk.y[i] - sk.y[pa]), b = Math.atan2(sk.x[c] - sk.x[i], sk.y[c] - sk.y[i]);
    if (Math.abs(wrap(b - a)) > 0.3) this.elbow[i] = 1;
  }
}
```

Near / far shading goes into step 8, after `this.tone[i]` is computed (keep `phi` and the
envelope in scope, or store `E * cos(phi)` in a scratch array in the loop above):

```ts
this.tone[i] *= 1 + 0.22 * pp.twistDepth * depthOf[i];   // depthOf[i] = E * cos(phi[i]), 0 without twist
```

`tone` already feeds branch brightness, glow (`tn * tn`) and the leaves on that node, so the near
half of every turn is brighter and its leaves with it.

`pushTree` one-line change for elbows: `sk.parent[pa] >= 0 ? (shown[i] && !(elbow && elbow[i]) ? 2 : 1) : 0`.
A flat join leaves a wedge open on the outside of a sharp bend; the round end closes it and reads
as the knot of the elbow (see risks: a faint bead there on see-through trees).

### 1.4 Step 4c: curling tips (`plants.curl`)

A spiral of new nodes appended after everything else, so no existing index moves. `Limb.last` stays
the last *contiguous* node (the `limbPaths` and `trunkFrac` loops iterate `first..last`); the curl's
last node goes into `lb.end`, and step 5 uses `this.branchLast = limbs.map((l) => l.end ?? (l.last >= l.first ? l.last : l.attach))`.

```ts
// 4c. Curling tips. Every limb tip, and a share of the longer twig ends.
if (pp.curl > 0) {
  const attached = new Set(limbs.map((l) => l.attach));
  let budget = Math.min(pp.maxNodes - sk.n, Math.floor(0.2 * pp.maxNodes));
  for (const lb of limbs) {
    if (budget <= 0) break;
    if (lb.order < 1 || lb.last < lb.first || attached.has(lb.last)) continue;
    if (lb.order >= 2 && (lb.len < 0.12 || rt() > 0.25 + 0.5 * pp.curl)) continue;
    const i0 = lb.last, pa = sk.parent[i0];
    let h = Math.atan2(sk.x[i0] - sk.x[pa], sk.y[i0] - sk.y[pa]);
    // Limb tips curl back toward the hub, so the outline is kept. Twigs: either way.
    const sgn = lb.order === 1 ? Math.sign(wrap(Math.atan2(f.cx - sk.x[i0], f.cy - sk.y[i0]) - h) || 1) : rt() < 0.5 ? -1 : 1;
    const r0 = (lb.order === 1 ? 0.05 : 0.032) * (0.8 + 0.4 * rt());   // first radius
    const total = TAU * pp.curl * lerp(0.6, 1.4, rt());               // up to 1.4 turns
    const dth = 0.45, m = Math.ceil(total / dth);
    let x = sk.x[i0], y = sk.y[i0], prev = i0, arc = 0;
    for (let k = 1; k <= m && budget > 0; k++) {
      const u = k / m, ds = r0 * (1 - 0.7 * u) * dth;                 // radius shrinks to 30 %
      h += sgn * dth;
      x += Math.sin(h) * ds; y += Math.cos(h) * ds; arc += ds;
      if (!inBand(x, y) || taken(x, y, lb.id, limbOf[lb.attach])) break;
      prev = sk.add(x, y, prev, 0, sk.w[i0] * (1 - 0.5 * u), NodeKind.Branch);
      order.push(lb.order); tAlong.push(1 + arc / Math.max(0.05, lb.len)); limbOf.push(lb.id);
      this.twistPhase[prev] = this.twistPhase[i0];
      claim(x, y, lb.id);
      budget--;
    }
    if (prev !== i0) lb.end = prev;
  }
}
```

Cost: one turn at r0 = 0.05 is 14 nodes and 0.2 of path; about 20 limb tips plus 30 to 60 twigs
gives 400 to 900 nodes, capped at 20 % of `maxNodes`. `tAlong > 1` is fine: step 6 normalises by
the largest threshold, so curls simply unroll last. `bendFrames` needs parents before children and
groups by the parent chain: appended nodes satisfy both. Tip decorations (blossom sites,
`sk.children[i] === 0`) move to the centre of the spiral, which is where a bud belongs.

### 1.5 Rope strands (`plants.strands`, draw time, `main.ts` `pushTree`)

Evaluated: feasible, no shader change, no extra buffers.

- Only for segments with `order <= 1` whose rest radius is above `W0 = max(1.6 * plants.tipWidth,
  0.008)`. Below that the strands merge into the single stroke (a twisted trunk that frays into
  ordinary twigs).
- Strand j of S at a node: lateral offset `w * (1 - rho) * K * sin(psi + 2*pi*j/S)` along the
  node's normal, radius `rho * w`, with `rho` = 0.62 (S = 2) or 0.52 (S = 3). The outer edge stays
  at `w`: the branch's silhouette width does not change.
- The node normal is the perpendicular of the node's *incoming* segment (`parent -> node`). Every
  segment that starts at a node uses that same normal and the node's `twistPhase` for its A end, so
  strands are continuous along a limb and a fork's strands start exactly on its parent's.
- Depth `z = cos(psi + 2*pi*j/S)` at the segment's middle: emit the S strokes back first (the
  instance order is the paint order), brightness `1 - 0.4 * twistDepth * (0.5 - 0.5 * z)`. At a
  crossing the front strand covers the back one, which is the whole rope illusion.
- `K = smooth01(W0, 1.6 * W0, w) * ropeK`: strand 0 has radius `lerp(1, rho, K) * w`, the others
  `rho * w * K`, so extra strands grow out of the main one instead of popping. `ropeK` (0..1) is a
  new `pushTree` argument: 1 normally, `clamp((t - s.stampT) / 0.3)` just after a planting so the
  frond (a single stroke) splits into strands under the impact flash instead of being swapped.

```ts
// in pushTree's loop, after c, tn, k are known; wa / wb = the two radii already computed for out.stroke
const W0 = Math.max(1.6 * params.plants.tipWidth, 0.008);
if (rope && rope.strands > 1 && (order ? order[i] : 1) <= 1 && sk.w[pa] > W0) {
  const S = rope.strands, rho = S === 2 ? 0.62 : 0.52;
  const gp = sk.parent[pa];
  let bx = sk.x[i] - ax, by = sk.y[i] - ay; const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
  let qx = gp >= 0 ? ax - sk.x[gp] : bx, qy = gp >= 0 ? ay - sk.y[gp] : by; const ql = Math.hypot(qx, qy) || 1; qx /= ql; qy /= ql;
  const Ka = rope.k * smooth01(W0, 1.6 * W0, sk.w[pa]), Kb = rope.k * smooth01(W0, 1.6 * W0, sk.w[i]);
  const mid = 0.5 * (rope.phase[pa] + rope.phase[i]);
  for (const j of backToFront(S, mid)) {              // sort j by cos(mid + TAU * j / S), ascending
    const o = (TAU * j) / S, z = Math.cos(mid + o);
    const oa = wa * (1 - rho) * Ka * Math.sin(rope.phase[pa] + o), ob = wb * (1 - rho) * Kb * Math.sin(rope.phase[i] + o);
    const ra = wa * (j === 0 ? lerp(1, rho, Ka) : rho * Ka), rb = wb * (j === 0 ? lerp(1, rho, Kb) : rho * Kb);
    if (ra <= 0 && rb <= 0) continue;
    const sh = 1 - 0.4 * rope.depth * (0.5 - 0.5 * z) * Math.min(1, Ka + Kb);
    const Ax = ax - qy * oa, Ay = ay + qx * oa, Bx = sk.x[i] - by * ob, By = sk.y[i] + bx * ob;
    out.stroke(Ax, Ay, lerp(Ax, Bx, f), lerp(Ay, By, f), ra, rb, sk.flex[pa], sk.flex[i],
      /* same colour */ r * sh, g * sh, b * sh, a, glow, layer, join, ord, /* same bend frame */ ...);
  }
  continue;
}
```

Compute the colour (`inkAt`) once per segment, not per strand. `drawPlant` passes
`{ phase: g.tree.twistPhase, strands: params.plants.strands, depth: params.plants.twistDepth, k }`;
the halo and the commit hooks pass nothing. The strand points go through the same `bendPoint` as
any other point, so sway and writhe carry the rope along.

Cost: limb segments are roughly a quarter to a third of a tree's nodes. S = 2 adds about 30 %
stroke instances, S = 3 about 65 %. Pixels: the same area, a little overdraw at crossings.

Not recommended: strands on twigs (1 to 2 px wide: nothing to see, triple the instances), or a
depth buffer (the renderer has none and painter's order per segment is exact here).

### 1.6 Animated writhe (`motion.writhe`, `shaders/motion.glsl`)

A slow travelling sideways wave on top of the static shape. It must be a function of the rest point
and its bend frame only (never of a segment's own tangent), otherwise the two segments at a joint
get different offsets and the joint opens.

```glsl
uniform vec4 u_mD[MAX_LAYERS]; // writhe: amplitude (local units), phase, 2*pi / wavelength, 0

// Limbs: sideways to the radial direction, stiff near the root (hidden part stays put).
vec2 limbWave(vec2 P, float flex, int layer) {
  vec4 D = u_mD[layer];
  float r = length(P);
  vec2 dir = r > 1e-4 ? P / r : vec2(0.0, 1.0);
  return vec2(-dir.y, dir.x) * 0.6 * D.x * smoothstep(0.25, 0.7, flex) * sin(0.6 * D.z * flex - D.y + float(layer));
}
```

- `struct Branch` gains `vec2 wp; vec2 hd; float ph; float shoot;`. In `branchOf`, for shoots:
  `br.wp = limbWave(br.pb, bend.z, layer); br.hd = hd; br.ph = 6.2831853 * h1; br.shoot = 1.0;`
  (zeros on limbs).
- `bendPoint`, after the existing result `Q = br.pb + rot(P - br.pb, own)`:

```glsl
if (u_mD[layer].x > 0.0) {
  if (br.shoot > 0.5) {
    vec2 d = rot(br.hd, ang);
    Q += br.wp + vec2(-d.y, d.x) * u_mD[layer].x * (u / (u + 0.08)) * sin(u_mD[layer].z * u - u_mD[layer].y + br.ph);
  } else Q += limbWave(P, flex, layer);
}
```

At a shoot's attach point `u = 0`, so the shoot's first point is `pb + wp`, exactly where the limb's
own segments put that node. A shoot and its sub-shoots share one frame (`bendFrames` groups them),
so they stay joined too. `sprite.vert` calls the same `bendPoint`: leaves and thorns ride along.
The ring layer (`mode 1`) has `flex = 0` on the runner, so only the halo's sprouts writhe.

CPU side (`motion.ts`, `LayerMotion.update`): a fourth array `d`, copied by `LayerUniforms.set` into
a new `mD` and bound as `u_mD` in `renderer.ts` `common`; `STILL.d = [0, 0, 0, 0]`.

```ts
const v = m.writheVoice === 'none' ? 1 : 0.25 + 0.75 * clamp(
  m.writheVoice === 'vibrato' ? d.vibrato * m.shiverSensitivity : m.writheVoice === 'effort' ? d.effort : d.energy * 1.3);
this.wPhase = (this.wPhase + TAU * 0.35 * m.speed * (0.6 + v) * dt) % TAU;   // integrated: no jumps
this.d.set([0.02 * m.writhe * scale * v, this.wPhase, TAU / 0.22, 0]);
```

Cost: two `sin` and a `smoothstep` per vertex when on, one branch when off.

### 1.7 Voice

- Build time (free, already snapshotted in `mood`): `tw` in 4b is scaled by `1 + twistVoice *
  (0.6 * vibrato + 0.5 * (effort - 0.5))`. A phrase sung with vibrato grows a more twisted tree; a
  soft phrase a straighter one. Only with `plants.moodShaping` on (the pass reads the same `mood`
  variable, which is `NEUTRAL_MOOD` otherwise: factor 1).
- Live: `motion.writhe` with `motion.writheVoice` (section 1.6).
- Pitch is deliberately not wired to twist: it already steers lift and the reveal order; one more
  mapping would be hard to read.

### 1.8 The halo

- `halo.twist`: in `stepTip`, add a corkscrew to the radius the tip homes to:
  `target = 1 + h.wander * noise1(...) + 0.045 * h.twist * Math.sin(tip.arc * (TAU / 0.42) + ti * 2.1)`
  and use `angleLerp(..., h.twist > 0 ? 0.4 : 0.25)` so the tip follows it. It is a function of the
  arc already travelled, so the vine keeps its shape as it ages. `STEP` is 0.014: 30 nodes per wave.
- `halo.braid`: `pushRing` draws two strands instead of one circle: radius
  `1 + 0.028 * braid * sin(12 * a + j * PI)` for j = 0, 1, width `0.7 * w`, the strand with the
  smaller `cos(12 * a + j * PI)` first and dimmed by `1 - 0.4 * plants.twistDepth * (0.5 - 0.5 * z)`.
  12 is whole, so the ring closes. 320 strokes instead of 160. With thorns on it this is a crown
  of thorns, which is what the preset wants.
- Curls: the halo already has them (`halo.sproutCurl`).
- No rope strands on the vine: at `vineWidth` 0.007 it is about 2 px.

### 1.9 Panel (`panel-layout.ts`, `ui.ts`)

- `shape` folder: keys `+ 'plants.twist', 'plants.gnarl', 'plants.curl', 'plants.strands'`; advanced
  `+ 'plants.twistLength', 'plants.twistTighten', 'plants.twistTwigs', 'plants.knots',
  'plants.twistDepth', 'plants.strandLay'`.
- `halo` folder: keys `+ 'halo.braid'`; advanced `+ 'halo.twist'`.
- `glow` folder: keys `+ 'glow.shadow', 'glow.shadowColour'`; advanced `+ 'glow.tintFlat'`.
- `timbre` folder: `+ 'plants.twistVoice'`. `held` folder: `+ 'motion.writhe', 'motion.writheVoice'`.
- `RANGES`: as in the table; `'motion.writheVoice': { options: { Always: 'none', Vibrato: 'vibrato',
  Effort: 'effort', Loudness: 'loudness' } }`.

Labels and tips:

| Key | Label | Tip |
| --- | --- | --- |
| `plants.twist` | twist | Branches wind from side to side like a corkscrew instead of running straight. The tree keeps its size, outline and limbs. |
| `plants.gnarl` | gnarl | Makes the twist irregular: uneven turns and sharp elbows, like old wood. |
| `plants.curl` | curling tips | Limb ends and some twigs finish in a small spiral. |
| `plants.strands` | strands | Main limbs are drawn as 2 or 3 strands wound round each other, like rope. Thin twigs stay single. |
| `plants.twistLength` | turn length | Length of one full turn on a main limb. Short turns need a small segment length (Many takes, advanced). |
| `plants.twistTighten` | tighter toward tips | Turns get shorter along the branch. |
| `plants.twistTwigs` | twig twist | How much the side shoots twist compared with the limbs (0 = straight twigs). |
| `plants.knots` | knots | Branches thicken at elbows and where a fork leaves. |
| `plants.twistDepth` | depth shading | The near side of each turn (and the front strand) is brighter than the far side. |
| `plants.strandLay` | strand turn (widths) | One strand turn per this many branch widths (lower = tighter rope). |
| `plants.twistVoice` | voice twists new trees | Reads: when a tree is created, twist x (1 + this x (0.6 x vibrato + 0.5 x (effort - 0.5))). Needs "shaped by the phrase". |
| `motion.writhe` | writhe | Branches slowly squirm from side to side. |
| `motion.writheVoice` | writhe follows | What makes them squirm harder: vibrato, effort, loudness, or always the same. |
| `halo.braid` | braided ring | The ring becomes two strands braided round each other. |
| `halo.twist` | vine corkscrew | The vine winds in and out across the ring. |
| `glow.shadow` | dark outline | A soft dark edge round everything, so light colours and glow stay readable on a bright background. |
| `glow.shadowColour` | outline colour | |
| `glow.tintFlat` | dark ink glows too | Glow strength no longer follows how bright a branch is: dark branches get the full glow colour (needs a glow colour amount above 0). |

---

## 2. Preset: "Dark & twisted"

Near-black wood that goes through aubergine to a bruised magenta at the tips, bone-tipped thorns,
rope limbs, elbows and curled ends, a braided thorn halo. On a dark background it is held by a
crimson rim glow (`tintFlat`), on a light one by the ink itself plus the dark outline (`shadow`).
`inkMask: 1` keeps every bit of glow off the ink, so the branches stay dark on both.

Add to `BUILTINS.visual`:

```ts
{
  id: 'twisted', name: 'Dark & twisted', description: 'Gnarled black-violet limbs wound like rope, elbows, curled tips, bone-tipped thorns, a braided halo; a crimson rim and a dark outline keep it readable on dark and light.',
  values: {
    colBranch: { source: 'gradient', gradient: 'ok;0:0d0a10,0.5:2a1030,0.85:5a1f4a,1:b23a6a', along: 1, speed: 0, perTake: 0, takeMix: 0.15, voice: 'effort', voiceAmount: 0.2 },
    colLeaf: { source: 'gradient', gradient: 'ok;0:1a0d16,0.55:6b2244,1:d9c7b0', along: 0.6, scatter: 0.4, takeMix: 0.1 },
    colAccent: { source: 'gradient', gradient: 'ok;0:8a0f22,1:ff3355', takeMix: 0, scatter: 0.6 },
    colHalo: { source: 'gradient', gradient: 'ok;0:1a0d16,0.5:6b2244,0.8:b23a6a,1:f0e6d8', along: 2, speed: 0.03, perTake: 0, takeMix: 0 },
    growth: { branching: 0.75, reach: 1.05, spread: 1.6, flatten: 0.5 },
    look: { theme: 'thorns', density: 0.6, decoSize: 1.3, variety: 0.9, depthShade: 0.9, decoGlow: 0.05, buds: 0,
      tint: '#3a0f2a', tintAmount: 0.15, dryColour: '#4a4046' },
    plants: { lift: -0.35, wildness: 0.9, taper: 0.9, clearance: 0.06, overlap: 0.6, maxWidth: 0.06, tipWidth: 0.004,
      step: 0.02, maxNodes: 4200,
      twist: 0.8, twistLength: 0.4, gnarl: 0.7, knots: 0.6, curl: 0.6, strands: 2, twistTighten: 0.6, twistDepth: 0.75 },
    halo: { origins: 2, tailDeg: 420, sproutLength: 18, sproutCurl: 2.2, wander: 0.16, alwaysLeaves: 0.5,
      ringWidth: 0.011, vineWidth: 0.009, braid: 0.8, twist: 0.7 },
    glow: { strength: 1.1, radius: 1.6, wide: 0.6, base: 0.25, crowd: 1.0, inkMask: 1, knee: 1.0,
      tint: '#d0204f', tintAmount: 1, tintFlat: 0.85, shadow: 0.7, shadowColour: '#12060e' },
    palette: { from: 'list', list: 'step;0:7a1238,0.2:4a1a6b,0.4:a3262e,0.6:2f3a6b,0.8:6b6b2a', pick: 'order' },
  },
},
```

Why these: `clearance` 0.06 leaves room for the meander (twig amplitude at these values is about
0.02); `step` 0.02 is what lets `twistLength` 0.4 carry the full limb amplitude and keeps elbows
crisp; `maxWidth` 0.06 makes limbs about 14 px thick at 1080p, enough for two visible strands;
`lift` -0.35 with `spread` 1.6 gives clawing, drooping arcs inside the same outline. The palette
(oxblood, aubergine, rust, midnight, moss) only enters through `takeMix` 0.15 and the halo, so takes
differ without breaking the look.

Add to `BUILTINS.reactivity`:

```ts
{
  id: 'writhe', name: 'Writhing', description: 'Slow and heavy: branches squirm on vibrato and stay solid when you sing quietly; full voice thickens them and grows the thorns; phrases with vibrato grow more twisted trees.',
  values: {
    growth: { secondsToFull: 4.5, regrowSpeed: 0.9, restBrightness: 0.8, fadeAfter: 5, fadeSeconds: 4,
      witherDepth: 0.6, witherSeconds: 1.2, twigFadeSeconds: 1.4 },
    response: { brightness: 0.3, effortWidth: 1.4, pitchSteer: 0.3, variety: 0.8, release: 2.5 },
    look: { thornEffort: 2.2, blossoms: 0 },
    plants: { twistVoice: 1.6, softDroop: 1.5 },
    halo: { idleSpeed: 4, singSpeed: 55, sproutRate: 4, sproutGrow: 0.9 },
    glow: { levelGain: 0.5, onsetGain: 1.1, pitchShine: 0.2, front: 1.4, softGlow: 0.2 },
    motion: { writhe: 0.7, writheVoice: 'vibrato', swayDeg: 5, idle: 0.5, speed: 0.6, kickDeg: 8, springiness: 0.75,
      twigs: 1.6, flutterDeg: 6, shiverDeg: 5, shiverSensitivity: 1.5 },
    commit: { duration: 1.3, impact: 1.3, spinTurns: 1.25, burst: 20, limbs: 3 },
  },
},
```

`response.brightness` is low on purpose: below 1 it shows as see-through, and see-through dark ink
disappears on a dark background.

Add to `BUILTINS.testing`:

```ts
{ id: 'light', name: 'On a light background', description: 'Light checkerboard behind the preview, to check a look against bright scenes.', values: { scene: { backdrop: 'checker-light' } } },
```

---

## 3. Light checker backdrop

### 3.1 What exists

`scene.backdrop: 'checker' | 'black' | 'none'` is already there: `draw()` sets
`document.body.className = obs ? '' : 'backdrop-' + value`, the patterns are CSS in `index.html`, the
key is in `LOCAL_KEYS` (never synced) and in the `TESTING` set (a testing preset may set it). That
is the right mechanism; keep it. The backdrop must stay CSS behind the canvas: if it were drawn in
the composite shader, the preview's pixels would differ from what OBS receives and a preset tuned
in the preview could look different on stream. With CSS, the browser does `canvas.rgb + (1 -
canvas.a) * page`, which is the same premultiplied "over" OBS applies to the browser source.

### 3.2 Change

- `params.ts`: `backdrop: 'checker' as 'checker' | 'checker-light' | 'checker-split' | 'black' | 'white' | 'none'`.
  `'checker'` keeps meaning the dark one, so saved settings and testing presets still work.
- `ui.ts`: `{ 'Checker (dark)': 'checker', 'Checker (light)': 'checker-light', 'Checker (half dark, half light)': 'checker-split', Black: 'black', White: 'white', 'None (transparent)': 'none' }`.
- Tip: "Preview background: dark or light checkerboard, both side by side, black, white, or
  transparent (as in OBS). Never shown in OBS."
- `index.html`:

```css
body.backdrop-checker-light, body.backdrop-checker-split {
  background-color: #ececf0;
  background-image:
    linear-gradient(45deg, #d6d6de 25%, transparent 25%), linear-gradient(-45deg, #d6d6de 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #d6d6de 75%), linear-gradient(-45deg, transparent 75%, #d6d6de 75%);
  background-size: 32px 32px;
  background-position: 0 0, 0 16px, 16px -16px, -16px 0;
}
/* Split: the existing dark checker over the left half. */
body.backdrop-checker-split::before {
  content: ''; position: fixed; inset: 0 50% 0 0;
  background-color: #1b1b1f;
  background-image:
    linear-gradient(45deg, #26262c 25%, transparent 25%), linear-gradient(-45deg, #26262c 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #26262c 75%), linear-gradient(-45deg, transparent 75%, #26262c 75%);
  background-size: 32px 32px;
  background-position: 0 0, 0 16px, 16px -16px, -16px 0;
}
body.backdrop-white { background: #fff; }
```

The `::before` box is positioned and comes first in the body, so the fixed canvases paint over it.
The split view is the quickest way to judge a look on both at once (the canopy is symmetric).

### 3.3 How the current composite behaves on a light background

`composite.frag` outputs `rgb = ink + glow`, `a = ink.a + max(glow.r, glow.g, glow.b)`, premultiplied.

- **Dark ink is not washed out.** Ink has alpha 1 and `glow *= 1 - inkMask * ink.a`, so with
  `inkMask` near 1 no glow lands on it. Dark strokes read better on light than on dark.
- **Glow is not additive on the background.** A glow pixel covers the background by its brightest
  channel and replaces that share with the glow colour: a red glow of 0.5 over white gives
  (0.95, 0.45, 0.45), a pink veil. It can tint and it can lighten a dark background, but it can
  never darken a light one, so on a bright scene the glow no longer separates anything.
- **Dark ink barely glows at all.** `stroke.frag` scales the glow by the ink colour, and
  `glow.tint` is multiplied by the ink's luma: near-black branches emit near nothing, which on a
  dark background leaves them with no rim.
- **Pale ink disappears on light** (bone thorns, white tips, the halo glint).

So two small additions, both off by default:

**`glow.tintFlat`** (`stroke.frag` and `sprite.frag`, new uniform `u_glowFlat`):

```glsl
float lum = dot(gsrc, vec3(0.2126, 0.7152, 0.0722));
vec3 gc = mix(gsrc, u_glowTint.rgb * mix(lum, 0.5, u_glowFlat) * 2.0, u_glowTint.a);
```

At 1 with `tintAmount` 1 every stroke glows in the tint colour at the strength a mid-bright ink
would, however dark it is. (`drawPlant`'s per-take normalisation `clamp(0.5 / luma, 0.65, 1.4)`
can stay.)

**`glow.shadow` / `glow.shadowColour`** (`composite.frag`, new uniform `vec4 u_shadow` = rgb,
amount). The glow buffer's alpha is coverage and is already blurred at each bloom level, so a soft
outline costs no new pass:

```glsl
vec3 rgb = min(b.rgb + g, vec3(a));                       // as today
float s = clamp(u_shadow.a * (1.4 * g1.a + 0.8 * g2.a) - 0.02, 0.0, 1.0) * (1.0 - a);  // under everything
o = vec4(rgb + u_shadow.rgb * s, a + s);
```

It is composited *under* ink and glow (the `1 - a` factor), is cut to exactly zero where coverage
is negligible (no fog for OBS), and is part of the real output: on stream it darkens the scene
slightly around the plant, which is what makes pale or glowing parts readable over a bright game or
room. On a dark background a dark shadow is invisible, so one preset works on both. A light
`shadowColour` gives a pale outline instead (useful for dark ink over dark scenes without glow).

Not recommended: a multiply or "ink" blend mode for the glow. A browser source can only hand OBS
premultiplied colour and alpha, so a multiply cannot be expressed in the output; it would be a
preview-only effect and the preview would lie.

---

## 4. Risks and order

### 4.1 Risks

- **Performance at `maxNodes` 5000.** The twist pass is one O(n) loop with two `inBand` calls per
  node, once per build: well under a millisecond next to the shoot placement. Builds already
  re-run for every tree while a shape slider is dragged; the new sliders do the same. Per frame:
  curls add up to 20 % nodes to a tree (inside `maxNodes`, so the cap holds); strands add 30 to
  65 % stroke instances for limbs. Six takes at 4200 nodes with two strands is about 33 k
  instances, 2.6 MB of `bufferData` per frame: fine, but `step` 0.02 is what really costs
  (1.5 x nodes for the same tree). `Minimal` and the default stay as cheap as today.
- **Sharp bends and flat joins.** Flat joins open a wedge on the outside of a bend, about `width x
  angle` pixels. The curvature cap keeps smooth twist at or below today's worst case for twigs;
  elbows exceed it and get a round end (`elbow[]`), which shows as a small bead where the tree is
  see-through (fading trees, low `response.brightness`). If that bothers, the proper fix is a
  mitred join in `stroke.frag` (cut at the bisector), which needs one more per-instance float.
- **Strands when see-through.** Strands overlap at crossings and in the merge zone, so alpha
  stacks there. It reads as rope shading at alpha near 1 and as slight beading on fading trees.
- **Clearance.** Shoots claimed their space as straight runs. Twig amplitude is at most 0.032 x
  twist against a default `clearance` of 0.045, so at high twist neighbours can touch. Raise
  `plants.clearance` with twist (the preset does), or scale `pp.clearance` by `1 + 0.6 * twist`
  inside `free()`; the latter changes how many shoots fit, so it is not shape-neutral: keep it out.
- **Decorations.** They read `sk.x / y` and the segment direction after the pass, and leaf ranks
  (step 9) are spaced on the moved nodes, so placement and spacing hold. Leaf angles follow the
  local tangent and therefore scatter more: good for thorns, slightly untidy for the wreath.
  Strands do not move decorations (they sit on the centreline).
- **Motion bend frames.** `bendFrames` takes a shoot's heading from its first 0.12 of length; the
  envelope ramps in over the same 0.12, so headings barely change. The carrier's stiffness uses
  `flex / 1.6`; flex is a few percent longer, so tips sway a few percent more.
- **Planting fronds.** `limbAt` returns the moved centreline, tangent and (knotted) width, so
  fronds unroll along the twisted limb with no change in `commit.ts`. The hidden part and `clear`
  are untouched, so each frond still starts where it did. With strands the frond is one stroke and
  the planted limb is two: hence `ropeK` fading the strands in over 0.3 s after the stamp. Curls
  are not on `limbPaths`; they unroll by the normal reveal after the impact.
- **Old boughs (branch per phrase).** `drawPlant` pivots a drying bough at `limbAt(0, path.clear)`:
  unchanged by twist.
- **Halo.** `halo.twist` changes where new vine is laid, not existing nodes, so toggling it shows
  only on fresh growth. The controller in `stepTip` follows the target loosely; the amplitude
  actually reached needs a look on screen. The braided ring is static geometry in `pushRing`.
- **Writhe.** Limb waves use the radial direction from the layer origin, which is only roughly
  across a limb; at 0.02 units this is not visible. Leaf rotation does not follow the wave's slope.
- **`twist` near the moat.** Offsets are halved or dropped where they would enter the moat or the
  avatar, which can leave one slightly straighter node. Invisible at these amplitudes.

### 4.2 Implementation order

1. Backdrop values and CSS (section 3.2), testing preset "On a light background". Ten minutes, and
   everything after it is judged against it.
2. `glow.shadow`, `glow.shadowColour`, `glow.tintFlat` (two shader edits, three uniforms).
3. Twist pass 4b with `twist`, `twistLength`, `gnarl`, `twistTighten`, `twistTwigs`,
   `twistDepth` (tone), `knots`, `elbow[]`, signature, `twistVoice`. Check with guides on that the
   outline, tips and moat are unchanged at twist 1, and that twist 0 is identical to today.
4. Curling tips 4c (`Limb.end`, `branchLast`).
5. Preset "Dark & twisted". Add every new key to `defaults` in this step even if it is not wired
   yet: a preset only applies keys that exist in `defaults` (`KIND_PATHS`), so the full values
   object can go in now and strands, braid, halo twist and writhe light up as they land.
6. Rope strands in `pushTree` (`twistPhase`, `ropeK`).
7. `halo.braid`, `halo.twist`.
8. Writhe (`u_mD`, `motion.ts`, `motion.glsl`), preset "Writhing".
9. Panel folders, labels, tips, ranges (section 1.9).
