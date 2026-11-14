# Design consult 3: motion — wind, spring-back and shiver instead of sine waves

Scope: sway and tremble of the take plants, the halo vine and the leaves. Nothing here was built
or run. All constants are starting values chosen by reasoning, not by looking at the result; the
ones most likely to need tuning are marked in section 5.

## Summary

- **Why it looks like a wave.** Three things in today's `bendLocal`:
  1. The phase depends on arc length (`flex * 2` for sway, `flex * 23` for tremble). Over a 1.6 unit
     tree that is half a sway wave and about six tremble waves standing on every branch, travelling
     root to tip. Real branches move in their first bending mode: the whole branch is in phase.
  2. Everything rotates about the layer origin by an angle that depends only on `flex`, so the
     canopy turns like a wheel: the left side goes down while the right side goes up. In wind, all
     tips move the same way in the world.
  3. One pure sine per component, the same for every node. There is no irregularity, no branch that
     does something of its own, and no response to an event.
- **The replacement** has two levels and three sources.
  - Levels: a **carrier** (trunk and limbs: a smooth bend of the whole plant, stiff near the root)
    and an **own bend** for every shoot about its attach point, plus leaves turning on their stalk.
  - Sources: (a) three damped **springs per layer** on the CPU (limb 0.75 Hz, shoot 1.7 Hz, twig
    3.3 Hz) pushed by a wandering wind whose strength is the loudness and kicked by every note
    start; (b) **value noise in the shader**: a gust field drifting across the scene for the limbs,
    an independent stream per shoot and per leaf; (c) the **vibrato shiver**: a carrier at the sung
    vibrato rate whose amplitude and phase are random per shoot and per leaf, so it shimmers
    instead of running along the branch.
- **Cost.** One more vec4 per instance (20 floats instead of 16), three more vec4 uniforms per
  layer, about ten hash lookups per vertex. No textures, no extra passes.
- **Also fixes a current bug:** `sin(u_time * vibratoRate * 2pi)` jumps whenever the measured
  vibrato rate changes, because the whole phase is rescaled. Phases are now integrated on the CPU.

---

## 1. The motion model

### 1.1 Wind is a vector in the world, and a branch bends by the part that hits it sideways

Every bend angle has the form

    angle = stiffness * cross(branchDirection, W)        cross(a, b) = a.x*b.y - a.y*b.x

`W` is a 2D lean vector in world space (radians at the tip for a branch square to it). A branch
pointing up in a wind to the right gets `cross = -1`: it turns clockwise and its tip goes right. A
branch pointing down-left also moves its tip right. A branch lying along the wind does not bend.
This one change removes the wheel rotation: the canopy shears, it does not spin. Because the canopy
is flat and wide, `W` also needs a vertical part or the horizontal limbs would stand still: that is
the bough bounce (1.3).

### 1.2 Two levels

**Carrier (orders 0 and 1, and it carries everything else).** Rotate a rest point `q` about the
layer origin by

    s      = clamp(flex / 1.6, 0, 1.25)
    Wc     = mix(limbSpring, shootSpring, 0.3 * s) + turb * gustField(worldRest(q), windT)
    angleC = s^1.5 * cross(normalize(q), Wc)             clamped to +-0.5 rad

`s^1.5` instead of today's `s`: displacement grows like `flex^2.5`, so the inner half of a limb
moves a third as much as before and the trunk reads as stiff. The outer part mixes in the faster
shoot spring, so a limb flexes along its length rather than turning as a rigid stick.
`gustField` is noise sampled at the node's rest position in the world with a low spatial frequency
(features about two units wide) that drifts sideways: a gust arrives at one plant, then at its
neighbour. The spatial variation follows position in the scene, not arc length, so no wave can run
up a branch. Because the angle is a smooth function of rest position and flex only, a parent and a
child evaluate the same value at their shared node: joints cannot open.

**Own bend (orders 2 and 3).** A shoot and everything that grows from it form one group. The group
turns about its attach point `b` (a node of an order 0/1 limb):

    u     = flex - flex(b)                               arc length along the shoot
    lever = u / (u + 0.10)                               0 at the base: no kink where it joins
    Wo    = mix(shootSpring, twigSpring, thin) * (0.7 + 0.6*h2) + 1.6 * turb * ownNoise(windT)
    own   = lever * twigs * 0.5 * order * (cross(heading, Wo) + shiver)    clamped to +-0.7 rad
    p'    = carry(b) + rotate(carry(p) - carry(b), own)

`thin` (0 shoot-like .. 1 twig-like) comes from the order plus a per-group hash, so neighbouring
shoots answer with different springs; `ownNoise` is an independent noise stream per group at its
own rate (0.9 to 2.5 changes per second). `heading` is the shoot's direction at its base, one value
per group, so a curled tendril bends one way instead of reversing along the curl. Sub-shoots share
their host shoot's group (same pivot, `u` continues through the junction): they sit further out, so
they move more, and they cannot detach. This is the "thin twigs lag the limbs, each on its own"
part.

**Leaves.** A leaf follows its node exactly (same function), then turns about its own base by

    vane    = clamp(1.5 * cross(leafDir, twigSpring + turb*gustField), +-0.6)   trails downwind
    flutter = flutterAmp * (0.65*n(2.3/s) + 0.35*n(5.2/s))                      own stream per leaf
    shiver  = 2.5 * shiverAmp * (per-leaf shiver, see 1.4)
    width  *= 1 - 0.3 * max(0, n(3.3/s))                                        turns edge-on now and then

The weathervane term is the most readable cue of all: on a push every leaf swings to trail the
same way, then they relax one by one. Thorns stay rigid; berries, needles and blossoms get a share.

### 1.3 Springs: the voice pushes, the plant answers (CPU, per layer)

Three 2D damped oscillators per layer; state is a lean vector in world space.

| spring | f0 | damping ratio | drives |
| --- | --- | --- | --- |
| limb | 0.75 Hz | 0.28 | carrier |
| shoot | 1.7 Hz | 0.20 | outer carrier, own bend |
| twig | 3.3 Hz | 0.16 | own bend, leaves |

    x'' = w^2 (F - x) - 2 zeta w x' - lag * a_limb       lag = 0, 0.5, 0.8

- `F` is the wind force. Sideways: `0.8 * A * side(t)` where `side` is slow signed noise (0.11 and
  0.17 changes per second, 60 % shared by all layers so the plants mostly agree, clamped so the
  plant leans one way for a while, passes through calm, leans the other way). Vertical:
  `0.6 * A * swell`, with `swell = clamp(2 * (energy - slow))`: a note that grows lifts the boughs,
  a note that fades lets them sag and bounce. `A = swayDeg * (idle + (1 - idle) * clamp(1.5 * slow))`.
- A **note start** adds velocity `J * w * gain` to each spring (gain 1, 0.8, 0.6), direction 35
  degrees above the current wind side, `J = kickDeg * (0.35 + 0.65 * effort) * (0.5 + 0.5 * level)`.
  The peak lean is about `0.75 * J * gain` whatever the frequency, then two or three swings back.
- `- lag * a_limb` is the inertia of the thin parts: when the limb accelerates right, shoots and
  twigs are thrown left relative to it, then whip through. That is follow-through, for one line.
- Damping is multiplied by `1 + 0.8 * softness`: breathy, soft singing gives a mellow sway with no
  ringing; full voice gives a springy plant.

Because the three springs have unrelated frequencies and each shoot mixes them differently, the
plant dephases after a push: for a moment everything moves together, a second later every part is
somewhere else in its swing. That is what a real shrub does and it is the opposite of lockstep.

### 1.4 Vibrato shiver

    shiver_b(t) = env_b(t) * sin(shiverPhase + 2pi*h_b + 1.2 * n_b(0.7/s))
    env_b(t)    = 0.35 + 0.65 * (0.5 + 0.5 * n_b(1.1/s))

`shiverPhase` is integrated on the CPU from the measured vibrato rate, so the shiver stays in time
with the voice. Per shoot and per leaf the phase offset is random and both the amplitude and the
phase wander: a carrier with slow random amplitude and phase is narrow-band noise. Limbs do not
shiver at all; shoots a little, twigs more, leaves most. The eye sees a shimmer at the vibrato
tempo, like aspen leaves, with no pattern in space.

### 1.5 Halo vine

A hoop cannot sway, and it should stay a clean halo. Today the runner has `flex = 0` (it never
moves), the ring wobbles on the CPU with a 5-lobe travelling wave the vine does not follow, and the
sprouts turn about the ring centre, so they slide along the ring instead of bending.

Ring mode (a per-layer flag) replaces the carrier rotation by a radial displacement applied to
every point of the layer (ring strokes, runner, sprouts, leaf bases):

    q' = q * (1 + rho(phi)),   phi = atan(q.y, q.x)
    rho = 0.35 * (e.x*cos(2 phi) + e.y*sin(2 phi)) + 0.25 * turb * (n1(t)*cos(3 phi) + n2(t)*sin(3 phi))

`e` is the limb spring. Only the two lowest shape modes of a hoop are used (oval and trefoil), as
standing shapes with noise amplitudes: on a note start the ring goes slightly oval (up to about
3 % of the radius at default settings) and rings down like a flicked hoop. Nothing travels round
it. Sprouts get the own bend about their anchor on the runner exactly as tree shoots do, and
leaves flutter as on the trees. Remove the `rAt` wobble from `pushRing` (pass radius 1).

### 1.6 What the voice does (the musical mapping)

| voice | motion |
| --- | --- |
| slow loudness | size of the wind lean and of the gust noise |
| loudness rising / falling against its mean | boughs lift / sag and bounce |
| note start, scaled by effort and level | a push: limbs lean, twigs whip, leaves swing downwind, then spring back |
| vibrato depth and rate | shimmer of twigs and leaves at the sung rate |
| softness (low effort, breath) | more damping (no ringing); breath adds leaf rustle |
| silence | `idle` share of the wind remains: slow, small, never still |

---

## 2. Implementation

### 2.1 Per-instance data: 20 floats

`renderer.ts`: `FLOATS_PER_INSTANCE = 20`, loop the attribute setup to 5. New attribute for both
strokes and sprites:

    layout(location = 4) in vec4 a_bend;   // pivot.xy (local), pivot flex, heading (local radians)

Branch order goes in a free slot: strokes `a_misc.w`, sprites `a_misc.z`. Limbs (order < 2) carry
their own position as pivot and are not bent about it. The per-group random numbers are hashed in
the shader from the bits of `a_bend`, so no phase attribute is needed.

Fill it once per skeleton (plants: at the end of `buildGesture`, store as `plant.bend`; halo: at
the end of `rebuild`, with order = `kind === Sprout ? 2 : 1`):

```ts
// growth/skeleton.ts
/** Per node (4 floats): pivot x, y, pivot flex, heading. Nodes with order < 2 are limbs. */
export function bendFrames(sk: Skeleton, order: ArrayLike<number>, out: Float32Array): Float32Array {
  const n = sk.n;
  if (out.length < n * 4) out = new Float32Array(n * 8);
  const grp = new Int32Array(n);            // first node of this node's shoot, -1 on limbs
  const hx = new Float32Array(n), hy = new Float32Array(n);
  for (let i = 0; i < n; i++) {             // parents come before children in both skeletons
    const pa = sk.parent[i];
    const g = order[i] < 2 || pa < 0 ? -1 : order[pa] < 2 || grp[pa] < 0 ? i : grp[pa];
    grp[i] = g;
    if (g < 0) continue;
    const b = sk.parent[g];
    if (sk.flex[i] - sk.flex[b] <= 0.12) {  // heading = mean direction of the first 0.12 of the shoot
      hx[g] += sk.x[i] - sk.x[b];
      hy[g] += sk.y[i] - sk.y[b];
    }
  }
  for (let i = 0; i < n; i++) {
    const g = grp[i], o = i * 4;
    if (g < 0) { out[o] = sk.x[i]; out[o + 1] = sk.y[i]; out[o + 2] = sk.flex[i]; out[o + 3] = 0; continue; }
    const b = sk.parent[g];
    out[o] = sk.x[b]; out[o + 1] = sk.y[b]; out[o + 2] = sk.flex[b]; out[o + 3] = Math.atan2(hy[g], hx[g]);
  }
  return out;
}
```

(For the halo, reuse the scratch arrays; it runs every frame over at most 4096 nodes.)

Call sites: `Instances.stroke(..., join, order, px, py, pf, heading)` and
`Instances.sprite(..., layer, order, px, py, pf, heading)`. `pushTree` takes `bend` and `order` and
passes `order[i], bend[4i..4i+3]` (node `i`, for both ends of the segment). `decorateTree` passes
the node's order and bend through `Placer.put`. `pushRing` and `decorateRing` pass order 1 and
pivot = the point itself.

### 2.2 Uniforms

Five vec4 arrays of 32 = 160 vectors (the WebGL2 minimum is 256).

    u_org[L], u_mat[L]   unchanged
    u_mA[L] = limb.x, limb.y, shoot.x, shoot.y          spring leans, world frame, radians
    u_mB[L] = twig.x, twig.y, turb, shiverPhase         turb in radians; phase wrapped to 0..2pi
    u_mC[L] = shiverAmp, flutterAmp, twigs, mode        radians; mode 0 = plant, 1 = ring
    u_windT              one float, wind time in seconds, wrapped at 4096

`u_motion` and (for motion) `u_time` go away.

### 2.3 Shared GLSL

Put this in `shaders/motion.glsl` and splice it into both vertex shaders after their uniform and
`toWorld` declarations (for example `strokeVS.replace('//#motion', motionGLSL)` in `renderer.ts`;
`sprite.vert` needs the same `toWorld` as `stroke.vert`).

```glsl
uniform vec4 u_mA[MAX_LAYERS];
uniform vec4 u_mB[MAX_LAYERS];
uniform vec4 u_mC[MAX_LAYERS];
uniform float u_windT;

uint hashU(uint x) { x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; x ^= x >> 16; return x; }
float hash01(uint x) { return float(hashU(x) >> 8) * (1.0 / 16777216.0); }

// Value noise in -1..1 with period 64, one independent stream per seed (seed < 2^24).
// Every rate multiplying u_windT must be a multiple of 1/64: then the wrap of u_windT at 4096 is
// invisible. Offsets added to x can be anything.
float vn(float x, uint seed) {
  float i = floor(x), f = x - i;
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  uint k = uint(int(i));
  return mix(hash01(seed * 64u + (k & 63u)), hash01(seed * 64u + ((k + 1u) & 63u)), f) * 2.0 - 1.0;
}
float q64(float r) { return floor(r * 64.0 + 0.5) / 64.0; }

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// World direction -> layer-local direction (u_mat is rotation * uniform scale).
vec2 toLocalDir(vec2 w, int layer) {
  vec4 m = u_mat[layer];
  return vec2(m.x * w.x + m.y * w.y, m.z * w.x + m.w * w.y) / max(1e-6, sqrt(abs(m.x * m.w - m.y * m.z)));
}

// Gusts: a world-space vector field that drifts across the scene.
vec2 gustField(vec2 wp) {
  float a = vn(u_windT * (20.0 / 64.0) - wp.x * 0.45 + wp.y * 0.17, 11u);
  float b = vn(u_windT * (43.0 / 64.0) - wp.x * 0.80 - wp.y * 0.31, 12u);
  float c = vn(u_windT * (27.0 / 64.0) + wp.x * 0.25 - wp.y * 0.55, 13u);
  return vec2(0.7 * a + 0.3 * b, 0.55 * c);
}

// Limb level. Plant: rotate about the layer origin, stiff near the root. Ring: oval / trefoil.
vec2 carry(vec2 q, float flex, int layer, out float ang) {
  vec4 A = u_mA[layer], B = u_mB[layer];
  ang = 0.0;
  if (u_mC[layer].w > 0.5) {
    float phi = atan(q.y, q.x);
    uint s = 200u + uint(layer) * 2u;
    float rho = 0.35 * (A.x * cos(2.0 * phi) + A.y * sin(2.0 * phi))
              + 0.25 * B.z * (vn(u_windT * (14.0 / 64.0), s) * cos(3.0 * phi)
                            + vn(u_windT * (19.0 / 64.0) + 0.5, s + 1u) * sin(3.0 * phi));
    return q * (1.0 + rho);
  }
  float s = clamp(flex / 1.6, 0.0, 1.25);
  vec2 W = mix(A.xy, A.zw, 0.3 * min(s, 1.0)) + B.z * gustField(toWorld(q, layer));
  float r = length(q);
  vec2 dir = r > 1e-4 ? q / r : vec2(0.0, 1.0);
  ang = clamp(s * sqrt(s) * cross2(dir, toLocalDir(W, layer)), -0.5, 0.5);
  return rot(q, ang);
}

// Per-instance state of the shoot this instance belongs to.
struct Branch { vec2 pb; float k; };   // carried pivot; own-bend angle at full lever

float shiverOf(float h, uint seed, float phase) {
  float off = h * 64.0;
  float env = 0.35 + 0.65 * (0.5 + 0.5 * vn(u_windT * (70.0 / 64.0) + off, seed));
  return env * sin(phase + 6.2831853 * h + 1.2 * vn(u_windT * (45.0 / 64.0) + off, seed + 1u));
}

Branch branchOf(vec4 bend, float order, int layer) {
  Branch br;
  br.pb = vec2(0.0);
  br.k = 0.0;
  if (order < 1.5) return br;
  vec4 A = u_mA[layer], B = u_mB[layer], C = u_mC[layer];
  float aB;
  br.pb = carry(bend.xy, bend.z, layer, aB);
  uint id = hashU(floatBitsToUint(bend.x) + 0x9e3779b9U * hashU(floatBitsToUint(bend.y)
          ^ hashU(floatBitsToUint(bend.w) + uint(layer))));
  float h1 = float(id & 1023u) / 1023.0, h2 = float((id >> 10) & 1023u) / 1023.0;
  uint seed = 4096u + (id >> 20) * 4u;
  float off = h1 * 64.0;
  float thin = clamp(0.3 + 0.5 * (order - 2.0) + 0.4 * (h1 - 0.5), 0.0, 1.0);
  float r1 = q64(mix(0.9, 1.7, h2) * (1.0 + 0.5 * thin)), r2 = q64(mix(0.9, 1.7, h2) * 0.77);
  vec2 W = mix(A.zw, B.xy, thin) * (0.7 + 0.6 * h2)
         + 1.6 * B.z * vec2(vn(u_windT * r1 + off, seed), 0.6 * vn(u_windT * r2 + off, seed + 1u));
  vec2 hd = vec2(cos(bend.w), sin(bend.w));
  float sh = C.x * (0.5 + 0.5 * thin) * shiverOf(h1, seed + 2u, B.w);
  br.k = clamp(C.z * 0.5 * order * (cross2(hd, toLocalDir(W, layer)) + sh), -0.7, 0.7);
  return br;
}

// Rest point p (arc length flex) -> bent point (local). ang = total rotation there.
vec2 bendPoint(vec2 p, float flex, vec4 bend, Branch br, int layer, out float ang) {
  float a;
  vec2 P = carry(p, flex, layer, a);
  float u = max(flex - bend.z, 0.0);
  float own = br.k * u / (u + 0.10);
  ang = a + own;
  return br.pb + rot(P - br.pb, own);   // k = 0 on limbs: returns P
}
```

### 2.4 stroke.vert

Delete `u_motion`, `u_time` and `bendLocal`. In `main`:

```glsl
  Branch br = branchOf(a_bend, a_misc.w, layer);
  float aa;
  vec2 A = toWorld(bendPoint(a_ab.xy, a_rf.z, a_bend, br, layer, aa), layer);
  vec2 B = toWorld(bendPoint(a_ab.zw, a_rf.w, a_bend, br, layer, aa), layer);
```

The rest is unchanged. A shoot's first segment starts at the host's node with `u = 0`, so it lands
exactly on the host; consecutive links of one chain share inputs at their common node.

### 2.5 sprite.vert

Replace the block from `float flex` to `vec2 dirL` and use `twist` in the last position line:

```glsl
  vec4 B = u_mB[layer], C = u_mC[layer];
  Branch br = branchOf(a_bend, a_misc.z, layer);
  float ang;
  vec2 p = bendPoint(a_pos.xy, a_shape.y, a_bend, br, layer, ang);

  // The decoration's own motion about its base. Thorns are rigid.
  float sid = a_shape.x;
  float leafy = sid < 0.5 ? 1.0 : sid < 1.5 ? 0.0 : sid < 2.5 ? 0.3 : sid < 3.5 ? 0.5 : sid < 4.5 ? 0.8 : 0.4;
  uint ls = hashU(floatBitsToUint(a_shape.w) ^ hashU(floatBitsToUint(a_bend.x) ^ hashU(floatBitsToUint(a_bend.y) + uint(layer))));
  float lh = float(ls & 1023u) / 1023.0, off = lh * 64.0;
  uint seed = 70000u + (ls >> 12) * 4u;
  vec2 Wl = toLocalDir(B.xy + B.z * gustField(toWorld(a_pos.xy, layer)), layer);
  vec2 d0 = vec2(cos(a_pos.z), sin(a_pos.z));
  float vane = clamp(1.5 * cross2(d0, Wl), -0.6, 0.6);
  float fl = 0.65 * vn(u_windT * (150.0 / 64.0) + off, seed) + 0.35 * vn(u_windT * (330.0 / 64.0) + off, seed + 1u);
  float sh = 2.5 * C.x * shiverOf(lh, seed + 2u, B.w);
  float la = a_pos.z + ang + leafy * (vane + C.y * fl + sh);
  vec2 dirL = vec2(cos(la), sin(la));
  float twist = 1.0 - 0.3 * leafy * clamp(C.y * 4.0, 0.0, 1.0)
              * max(0.0, vn(u_windT * (210.0 / 64.0) + off + 7.0, seed + 3u));
  ...
  vec2 P = base + dirW * (uv.y * size) + perp * (uv.x * size * twist);
```

(`base` is computed from `p` as before. The leaf hash uses the seed and the pivot, not `a_pos`, because falling leaves change `a_pos` every frame. `ls >> 12` is 20 bits; times 4 plus 70000 stays below 2^24.)

### 2.6 CPU state: `viewer/src/motion.ts`

Add `onset = false;` to `Drive` and set `this.onset = !!f?.onset;` in `update`.

```ts
import type { Drive } from './drive';
import type { Params } from './params';
import { clamp, deg, lerp, noise1, TAU } from './math';

const F0 = [0.75, 1.7, 3.3];     // Hz: limb, shoot, twig
const ZETA = [0.28, 0.2, 0.16];  // damping ratios at springiness 0.5
const KICK = [1, 0.8, 0.6];      // share of a note-start push each spring takes
const LAG = [0, 0.5, 0.8];       // how much the limb's acceleration throws the thinner parts back
const KICK_UP = 35 * deg;

/** One for the scene: the wind clock. */
export class Wind {
  t = 0;    // wrapped at 4096 (shader)
  raw = 0;  // not wrapped (CPU noise)
  update(dt: number, p: Params) {
    const d = dt * p.motion.speed;
    this.raw += d;
    this.t = (this.t + d) % 4096;
  }
}

/** One per layer (take slot, halo), next to its Drive. */
export class LayerMotion {
  private x = new Float64Array(6);  // lean per spring: [limb.x, limb.y, shoot.x, shoot.y, twig.x, twig.y]
  private v = new Float64Array(6);
  private phase = 0;
  private flip = 1;
  readonly a = new Float32Array(4);
  readonly b = new Float32Array(4);
  readonly c = new Float32Array(4);

  constructor(private seed: number) {}

  /** scale: 1 for plants, about 0.6 for the halo, 0.3 for a dying plant. */
  update(d: Drive, wind: Wind, dt: number, p: Params, scale: number, ring: boolean) {
    const m = p.motion;
    const amp = m.swayDeg * deg * scale * (m.idle + (1 - m.idle) * clamp(d.slow * 1.5));

    // Wind: sideways, wandering from one side through calm to the other; mostly shared by all layers.
    const side = clamp(2.2 * (0.6 * noise1(wind.raw * 0.11, 3) + 0.4 * noise1(wind.raw * 0.17, 10 + this.seed)), -1, 1);
    // Swell: louder than the running mean lifts the boughs, a fading note lets them sag.
    const swell = clamp((d.energy - d.slow) * 2, -1, 1);
    const fx = 0.8 * amp * side;
    const fy = amp * (0.6 * swell + 0.2 * noise1(wind.raw * 0.23, 40 + this.seed));

    // A note start is a push with the wind and upward.
    if (d.onset && dt > 0) {
      const j = m.kickDeg * deg * scale * (0.35 + 0.65 * d.effort) * (0.5 + 0.5 * clamp(d.level * 1.5));
      let sgn = Math.sign(side);
      if (Math.abs(side) < 0.15) sgn = this.flip = -this.flip;
      const jx = sgn * Math.cos(KICK_UP) * j, jy = Math.sin(KICK_UP) * j;
      for (let i = 0; i < 3; i++) {
        const w = TAU * F0[i];
        this.v[2 * i] += jx * w * KICK[i];
        this.v[2 * i + 1] += jy * w * KICK[i];
      }
    }

    // Springs (semi-implicit Euler, at most 1/120 s per step).
    const zMul = lerp(2.2, 0.55, clamp(m.springiness)) * (1 + 0.8 * d.softness);
    const steps = Math.min(16, Math.max(1, Math.ceil(dt * 120)));
    const h = Math.min(dt, 0.25) / steps;
    for (let s = 0; s < steps && h > 0; s++) {
      for (let c = 0; c < 2; c++) {
        const F = c ? fy : fx;
        let a0 = 0;
        for (let i = 0; i < 3; i++) {
          const w = TAU * F0[i], k = 2 * i + c;
          const acc = w * w * (F - this.x[k]) - 2 * ZETA[i] * zMul * w * this.v[k] - LAG[i] * a0;
          if (i === 0) a0 = acc;
          this.v[k] += acc * h;
          this.x[k] += this.v[k] * h;
        }
      }
    }

    // Vibrato: integrate the phase so a changing rate never jumps.
    this.phase = (this.phase + TAU * (d.vibratoRate || 5.5) * dt) % TAU;

    this.a.set([this.x[0], this.x[1], this.x[2], this.x[3]]);
    this.b.set([this.x[4], this.x[5], 0.45 * amp, this.phase]);
    this.c.set([
      m.shiver ? m.shiverDeg * deg * d.vibrato * scale : 0,
      m.flutterDeg * deg * Math.min(1.5, m.idle + (1 - m.idle) * clamp(d.energy * 1.3) + 0.5 * d.breath),
      m.twigs,
      ring ? 1 : 0,
    ]);
  }
}
```

Wiring in `main.ts`: one `Wind`, updated once in `simulate`; a `LayerMotion` on every `Slot` and
`LiveHalo` (seed = its index or plant seed), updated right after its `drive.update`. `motionOf`
goes. `LayerUniforms` gets `mA`, `mB`, `mC` (each `4 * MAX_LAYERS`) and `set(i, ox, oy, angle,
scale, motion: LayerMotion)` copies `motion.a/b/c`. `Renderer.render` passes `u_mA`, `u_mB`,
`u_mC` and `u_windT: wind.t`. With `sprout.advance(60)` the springs just step along (dt is capped).

---

## 3. Params (replace `params.motion`)

```ts
  motion: {
    /** How far the tips lean in a full-voice gust, degrees. */
    swayDeg: 8,          // 0..25
    /** Share of the wind that stays when nobody sings (0 = stands still). */
    idle: 0.35,          // 0..1
    /** Wind tempo: how quickly gusts, sway and flutter change. */
    speed: 1,            // 0.25..3
    /** Push from every note start, degrees at the tips (scaled by effort and loudness). */
    kickDeg: 6,          // 0..20
    /** After a push: 0 settles at once, 1 swings back and forth for a while. */
    springiness: 0.5,    // 0..1
    /** How much thin shoots move on their own compared with the limbs. */
    twigs: 1,            // 0..2.5
    /** Leaf flutter about the stalk, degrees. */
    flutterDeg: 14,      // 0..40
    /** Shimmer of twigs and leaves on vibrato. */
    shiver: true,
    shiverDeg: 3,        // 0..12
  },
```

`ui.ts`: ranges as above, section label "Wind & shiver". Old presets carry `swayFromLevel`,
`swayHz`, `tremble`, `trembleDeg`; map `tremble -> shiver` and `trembleDeg -> shiverDeg` when
loading, drop the other two. README: the "Tremble" bullet and the pipeline line "with sway and
tremble in the vertex shaders" need new wording.

---

## 4. How to verify

Use the fake singer and the dev page. Isolate one part at a time from the console
(`sprout.params.motion`), then combine.

1. **Wind only** (`kickDeg 0, twigs 0, flutterDeg 0, shiver false, swayDeg 15`). The canopy must
   shear: tips on the left and right move the same way on screen. The trunk and the inner third of
   the limbs barely move. Pause on any frame: the pose must look like a plausible rest pose, with
   no S-curve along a limb. With two or three takes a gust should arrive at one plant slightly
   before its neighbour.
2. **Push only** (`swayDeg 0, idle 0, kickDeg 15`, twigs back to 1). On every note start: limbs
   lean and return in two to three swings over about two seconds; shoots are thrown back first,
   then overshoot, and end their swings at different times. `springiness 0` must give a single
   settle with no overshoot; soft fake notes must ring less than full ones.
3. **Shiver only** (everything else 0, `shiverDeg 8`, a held fake note with vibrato). Limbs still.
   Twigs and leaves shimmer at the vibrato tempo. Look for bands of brightness or motion running
   along a branch: there must be none. Change the fake vibrato rate while it sounds: no jump.
4. **Leaves** (`flutterDeg 30`). Each leaf moves on its own; on a push they all swing to trail the
   same way, then relax. Thorns do not move against their branch. If the edge-on narrowing makes
   small leaves sparkle in the bloom, lower the 0.3 in `twist`.
5. **Joints** (`swayDeg 25, kickDeg 20, twigs 2.5`, zoom the browser to 400 %). Shoot bases stay on
   their limb, sub-shoots on their shoot, leaves on their node, chain links tile without notches.
   Any gap means a pivot or flex was filled for the wrong node.
6. **Halo.** The ring, the runner and the leaves on the ring move as one; the ring goes slightly
   oval on a push and settles; it never shifts sideways as a whole. Sprouts bend about their
   anchor. Curly tendrils bend one way, not into an S.
7. **Wrap** (`wind.t = 4090` from the console, watch for ten seconds): no twitch when it passes 4096.
8. **Whole picture**, default values, a full fake song, viewed at stream size in OBS: in silence
   the plants are slow and small but never frozen; a phrase start visibly pushes; a long note with
   vibrato shimmers; nothing looks like a wave travelling along a branch or like the whole plant
   turning about its root. Compare `sprout.stats()` frame time before and after.

## 5. Constants most likely to need tuning, and limits

- `LAG` (0.5, 0.8): too high and the twigs look loose or rubbery; too low and they look glued on.
- `1.6 * turb` in `branchOf` and `0.45 * amp` for `turb`: the balance of independent motion to
  common motion. If the plant looks nervous, lower these before touching `swayDeg`.
- The lever length 0.10 and `0.5 * order`: how far out a shoot starts to bend and how much more
  sub-shoots move. The same 0.10 is used in ring units for halo sprouts (about 0.15 long), which
  bends them mostly in their outer half; a smaller value there would need a per-layer uniform.
- `1.5` in `vane` and the 0.35 / 0.25 ring factors.
- The carrier takes the limb direction as "away from the layer origin". For the crown, whose
  trunk runs from the root to the hub, this is the direction from the root, not from the hub. The
  difference is small and behind the avatar; if the crown's low limbs bend oddly, pass the hub in
  the two free slots `u_org.zw` and use `q - hub`.
- Limbs of one plant differ only through their direction and the gust field, by design: the slow
  level should be coherent. If the limbs look too uniform, raise the 0.45 / 0.80 spatial
  frequencies in `gustField`.
- A pitch-driven wind side (melody rising leans one way, falling the other) would fit in `side`
  in one line; left out to keep the first version readable.
