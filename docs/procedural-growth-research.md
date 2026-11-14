# Procedural sprouting & growth — research notes

Status: research, 2026-11-12. Nothing here is implemented yet.

## 1. What we're actually solving

The halo today is a single full-screen HLSL pixel shader (`app/HaloShaders.h`) drawing up to 8
analytic rings into a transparent 1080² target that goes to OBS over Spout. "Sprouting" means
adding things that **grow out of / along those rings over time**, driven by the voice:

- vines, tendrils, leaves, buds and flowers (default look)
- thorns / briars (thorn theme), pine, holly and berries (wreath theme), frost or coral (extras)

Constraints that shape every choice below:

| Constraint | Consequence |
| --- | --- |
| 2D, transparent background, avatar sits in the middle | Growth must stay in an annulus around the ring; nothing may fog the centre. |
| Runs next to VTube Studio + OBS on the same GPU | Keep the growth pass well under ~1 ms GPU at 1080². |
| A song is 3–5 minutes, layered takes | Growth needs a **budget and a lifecycle** (wither, prune, shed), or the frame fills up by verse 2. |
| One live track must look complete | Growth has to be driven by level/onsets alone; pitch and vibrato only *enrich* it (pitch detection is the unreliable part). |
| Sway, tremble, shine are wanted | Grown structure needs secondary motion (springs), not just a static drawing. |
| "Translatable to rigging" | Expose a few scalar outputs (growth amount, bloom, wither) that could also drive VTS parameters. |

The key realisation from the literature: **"what grows" (structure generation) and "how it is shown
growing" (reveal/animation/render) are separate problems.** Almost every production system
(film FX, game shaders) generates or grows a skeleton, stamps each piece with a *birth time*, and
then reveals it with a single growth parameter. That split is what we should build.

```
audio features ──► growth controller ──► generator(s) ──► segment graph (+birth time, width, kind)
 (level, onset,     (budget, lifecycle,    (walker, space      │
  pitch, vibrato)    where to sprout)       colonisation, …)   ▼
                                                     physics (sway / tremble springs)
                                                               │
                                                               ▼
                                         GPU: instanced SDF capsules + leaves/flowers + glow
                                               composited with the existing ring shader
```

---

## 1.5 Layer layout (design correction, 2026-11-12)

From the user's sketches for 1–4 layers. **The live take stays the halo; every previous take is
a separate plant rooted at an origin hidden behind the avatar**, growing outward past the model.

| Layers | Live take | Previous takes |
| --- | --- | --- |
| 1 | Thin vine wrapped around the ring, with short sprouts off it | none |
| 2 | same | **One big splayed plant.** Origin low, behind the torso. The trunk comes up behind the head and the crown fans out left, up and right around the model, mostly inside the ring. |
| 3 | same | **Wings.** Both plants share one origin closer to the middle (around neck/upper chest) and grow in opposite directions, left and right, sweeping slightly upward. |
| 4+ | same | **Equiangular plants** from the shared origin. In the 4-layer sketch: up, lower-left, lower-right (120° apart). More layers → more wings, ending in a "biblically accurate" ring of wings, possibly rotating. |

Visual hierarchy from the sketches: the live halo vine is **thin and hugs the ring**; take plants are
**bold, thick, branching**, each in its take's colour, and reach well past the ring (≈1.3–1.5× ring
radius), so the Spout canvas needs margin beyond the current ring size.

### Layout rule

Let `n` = number of previous takes (layers − 1). Each take `k` gets an origin `O` and a direction
angle `φk` (0° = right, 90° = up, in halo space):

- `n = 1`: `O` = low origin (behind torso), `φ = 90°`, wide crown envelope (≈ ±100° fan).
- `n = 2`: `O` = shared mid origin, `φ = 180° − tilt` and `0° + tilt` (tilt ≈ 10–20° upward).
- `n ≥ 3`: `O` = shared mid origin, `φk = φ0 + k · 360°/n`, with `φ0` chosen to keep plants
  away from straight down (270°), where the body hides them:
  - `n` odd → `φ0 = 90°` (one plant straight up; matches the 4-layer sketch: 90°, 210°, 330°)
  - `n` even → `φ0 = 90° + 180°/n` (no plant straight up or down; e.g. 4 takes → an X)
  - Downward-ish plants should curve outward (tropism away from the body) so they emerge beside it.
- Large `n` (≈ 7+): split into **tiers** — an inner ring of short wings and an outer ring of long
  ones, offset by half a step, optionally counter-rotating (ophanim-style wheels). Plant length and
  envelope width shrink with `n` so the whole thing stays inside the canvas.

### Consequences for the architecture

- **Grow each plant in its own local frame** ("wing space": origin at 0, growing along +Y), and
  apply the per-take transform (origin, rotation `φk`, scale) on the GPU. Then:
  - re-layout when a take is added is just **animating `φk` / origins / scale** to new targets
    (the 2→3 layer change morphs the single crown into wings without regrowing anything —
    or, for n=1→2, the crown can bend over into a wing as it rotates);
  - **spinning** for many takes is a uniform rotation (speed could follow tempo from the bus);
  - per-take sway/tremble stays local to that plant.
- **Envelope per layout.** Each plant grows inside a shape in wing space: a crown fan for `n = 1`,
  a swept wing/teardrop for `n = 2`, a wedge of angle `≈ 360°/n` minus a gap for `n ≥ 3`. The
  envelope is what changes with `n`; the generator stays the same.
- **Avoid wasting growth behind the avatar.** Branches behind the model are invisible. A
  calibrated keep-out region (head circle + torso capsule, set once in halo space) lets growth
  route around the silhouette — only the trunk lives inside it.
- **Origin anchoring.** The origin is behind the avatar, so it should follow the model: anchor the
  halo-space origin to the VTS neck/body position (already planned for the ring).
- **Counting layers.** Layer count must come from *registered* Take-playback taps, not from who is
  audible right now, with hysteresis — otherwise the layout flips every time a take goes quiet.
  Open: whether the optional instrument track counts as a layer (current answer: no, it keeps its
  thin outer ring) and what happens visually when the live take is committed and becomes a take.

---

## 2. Structure generators (what grows)

### 2.1 Turtle / tropism walkers ("ivy" agents) — **recommended first**

Each growing tip is an agent with a position and heading. Every step it moves forward and its new
heading is a weighted blend of: previous heading (stiffness), random wander, a pull toward the
ring (adhesion), a tangential push (so it wraps around the circle), and optional "gravity"/"light"
directions. Occasionally it forks a child tip. This is essentially Thomas Luft's Ivy Generator
(primary direction from weighted previous directions + random influence + adhesion to nearby
surfaces) ported to 2D, with the halo ring standing in for the wall.

- **Why it fits:** fully live and incremental (one step per frame per tip), trivially steerable by
  audio every frame, cheap (dozens of tips, a few thousand segments). Hugging the ring is just an
  attraction term toward `|p| = R`.
- **Audio hooks:** level → step speed; onset → fork a new tip or sprout a leaf; pitch → curl rate
  or how far off the ring the tip wanders (high notes climb outward); vibrato → wobble in heading.
- **Weak spots:** tips can cross each other; needs a simple spatial hash to avoid / reduce overlap.
- **Themes:** thorns = stiff walker with spikes stamped at intervals; wreath = many short walkers
  hugging the ring with needle sprites.

### 2.2 Space colonisation (Runions, Lane, Prusinkiewicz 2007)

Scatter *attraction points* in the region you want filled (for us: an annulus around the ring).
Each point pulls the nearest branch node within an influence radius; nodes grow toward the average
direction of their attractors; points are deleted when a branch reaches them. Produces very
natural branching that fills space without self-crossing.

- **Why it fits:** we control *where* growth goes simply by *where we add attractors*. Inject
  attractors as the song plays: loud phrase → attractors further out; a note at pitch X → a
  cluster at angle θ(X). The halo then "fills in" where and when the singer is active.
- **Cost:** naive is O(nodes × attractors) per step; with a uniform grid it's comfortable for a
  few thousand of each on the CPU at 60 fps (and we only need a few steps per frame).
  The original paper lists speed as future work; game-oriented follow-ups tune parameters for
  real-time generation.
- **Weak spots:** less "tendril-y" by default (more tree/venation-like); needs taper and leaf
  dressing to look like a vine.

### 2.3 L-systems (parametric / stochastic / timed)

Rewrite grammars (Prusinkiewicz & Lindenmayer, *The Algorithmic Beauty of Plants*). Parametric
symbols carry lengths/angles; stochastic rules add variation; "timed" / continuous L-systems
interpolate between derivation steps so growth is smooth rather than popping.

- **Why it fits:** best tool for **authored, stylised ornaments** — a specific fern frond, a rose
  with thorns, a holly sprig, a snowflake. Great as a *sprout* spawned at a point on a vine.
- **Weak spots:** hard to make a global structure respect the ring and avoid the avatar; discrete
  steps need interpolation; less naturally reactive. Use for local motifs, not the main vine.

### 2.4 Differential growth — the ring itself grows

Treat the halo ring as a closed polyline of nodes. Each step: neighbours attract (springs), nearby
non-neighbours repel, edges that get too long split. The curve lengthens inside a confined space
and buckles into organic, coral/lettuce-edge folds (Jason Webb's 2D experiments, inconvergent,
Nervous System's Floraform).

- **Why it fits:** unique to *our* concept — the ring isn't decorated, it **becomes** organic.
  Quiet: a clean circle. Sustained singing: it frills. Release: springs relax it back toward the
  circle. A very strong "hero" look for a single take.
- **Cost:** a few thousand nodes with a spatial hash runs fine on the CPU; GPU compute is possible.
- **Weak spots:** grows unbounded unless we add a target length, node budget, or a "relax back to
  circle" force — which we want anyway for the lifecycle.

### 2.5 Phyllotaxis (Vogel / golden angle)

`θ = n · 137.508°`, `r = c·√n`. Used for flower heads, buds, and spacing leaves along a stem.
Not a generator of vines by itself, but the right placement rule for blooms (the "shine for
high/loud parts" moment could open phyllotactic flowers on the vine).

### 2.6 Grid / texture-space growth on the GPU

These run as ping-pong render-target simulations (compute or pixel shader), cheap at 512² masked
to the annulus:

- **Reaction–diffusion (Gray-Scott):** moss, lichen, coral, spots. Feed/kill rates mapped to audio
  give dramatically different textures. Fills an area rather than sprouting stems.
- **DLA / Eden growth:** frost, crystals, lightning-like branching — good for a winter/Christmas
  variant ("frost creeping around the wreath").
- **Cellular automata:** pixel-art growth themes.

Good as **texture themes on top of** the vine system, not as the main sprouting mechanic.

### 2.7 Authored tiles + procedural placement (wreath)

A Christmas wreath reads best from authored parts: pine-needle clusters, holly leaves, berries,
ribbons. Procedurally *place and grow in* those parts along the ring (Poisson-disk spacing around
the circle, each part scaling/unfurling in on its birth time). Wave Function Collapse is overkill
here; simple constraint rules ("berries cluster next to holly") are enough.

### 2.8 Hand-authored skeleton + reveal

Not procedural, but worth listing: an artist draws vine curves once, we stamp arc-length birth
times and reveal them with audio. Zero risk, total art control, fully deterministic. A good
fallback for a theme that has to look exactly right.

---

## 3. Making it *grow* (reveal and lifecycle)

### 3.1 Birth-time reveal (the core trick)

Every segment stores `birth` (when it was created, or its arc-length distance from the root for a
pre-built skeleton). A segment is visible when `growth > birth`; its tip end is drawn partially
(`saturate((growth - birth) / segDuration)`) so the vine visibly extends instead of popping.
Width tapers with *age* (`growth - birth`), so tips are thin and older stem thickens. Leaves and
flowers have their own unfurl curve keyed to age (scale-in with an overshoot ease, rotate open).
This is how film/game vine growth (e.g. DreamWorks' beanstalk, Unity Shader Graph "grow" shaders)
works, and it lets us **mix live generation and precomputed structure** in the same renderer.

### 3.2 Growth as an accumulator, not a meter

Raw level should not map straight to size — it flickers. Integrate it:

- `growthBudget += level · dt · rate` while singing; generators spend budget to add segments.
- Onsets are discrete events: spawn a bud, fork a tip, open a flower.
- Sustained notes = steady extension; staccato = many short sprouts. This reads musically.

### 3.3 Lifecycle (essential for 4-minute songs)

Pick one or combine:

- **Cap + recycle:** fixed segment budget; when full, the oldest branches wither (desaturate,
  droop, shrink to zero) and their slots are reused.
- **Breath cycle:** silence → growth slowly retracts toward the ring (reverse reveal), so every
  phrase regrows. Very readable on stream.
- **Shedding:** petals/leaves detach and fall as particles on phrase end (pretty, and frees budget).
- **Song arc:** growth tied to song position (DAW playhead is already on the bus) so the chorus is
  always the lushest and a rewind/retake replays deterministically from a seed.

### 3.4 Motion: sway and tremble

Grown structure gets secondary motion so the "sway for slow singing / tremble for vibrato" asks
come for free:

- Treat each branch as a chain of segments with angular springs (or Verlet rope with stiffness).
  A slow "wind" field driven by smoothed level/tempo gives sway; vibrato rate/depth injects small
  high-frequency jitter at the tips (tips move more than roots).
- Cheap alternative, all in the vertex shader: displace by `sin(t·f + arcLen·k) · amp · age-weight`.
  No physics state, good enough for a first pass.

---

## 4. Rendering options in our D3D11 app

| Option | How | Good for | Notes |
| --- | --- | --- | --- |
| **A. Extend the full-screen pixel shader** | Polar domain repetition: split the ring into angular cells, each cell hashes a sprout (curve SDF + leaf SDF), check own + neighbour cells | Small decorative sprouts, thorns, sparkle; zero CPU state | No real branching topology; cost scales with per-pixel work; can't hold a live-grown graph |
| **B. Instanced SDF capsules** (recommended) | CPU uploads a structured buffer of segments `{a, b, r0, r1, birth, colour, kind}`; one instanced draw of quads, the PS evaluates a capsule/tapered-capsule SDF for anti-aliased round-capped strokes | Thousands of segments, any generator, birth-time reveal in-shader | Same AA quality as the current rings; leaves/flowers as a second instanced pass (SDF shapes or a small texture atlas) |
| **C. Jump-flood distance field** | Rasterise the grown structure, JFA to a distance texture, then shade glow/outline from distance | A soft glow around the whole vine that matches the halo's glow | Extra passes (~log2(1080) ≈ 11); add only if B's per-segment glow looks wrong where branches overlap |
| **D. Compute-shader simulation** | Ping-pong textures or GPU particle buffers | Reaction–diffusion, DLA, differential growth on GPU | Only needed if CPU generators run out of headroom |

Compositing note: the current output is straight (non-premultiplied) alpha. Draw growth into the
same target with premultiplied blending internally and un-premultiply once at the end (or render
everything premultiplied and set the OBS source accordingly) — otherwise overlapping translucent
leaves will fringe dark.

Draw order: vines **behind** the ring core but glow **in front** reads best (the ring looks like
it's tangled in the vine).

---

## 5. Comparison

| Technique | Live-reactive | Art control | Fits ring/annulus | Cost | Best role |
| --- | --- | --- | --- | --- | --- |
| Tropism walkers | ★★★ | ★★ | ★★★ | Low | Main vines, thorns |
| Space colonisation | ★★ | ★★ | ★★★ | Low–Med | Filling growth, ivy cover |
| L-systems | ★ | ★★★ | ★ | Low | Local ornaments (fern, rose, holly sprig) |
| Differential growth | ★★★ | ★ | ★★★ | Med | "The ring itself grows" hero mode |
| Phyllotaxis | ★★ | ★★★ | n/a | Trivial | Flower/bud placement |
| Reaction–diffusion / DLA | ★★ | ★ | ★★ (masked) | Low on GPU | Moss / frost texture themes |
| Authored parts + placement | ★★ | ★★★ | ★★★ | Trivial | Christmas wreath |
| Shader-only polar sprouts | ★★ | ★★ | ★★★ | Low (GPU) | Quick prototype, sparkly thorns |

---

## 6. Recommendation

Revised after the layer-layout correction (§1.5): two kinds of growth, two generators.

| Role | Look | Generator |
| --- | --- | --- |
| Live take (halo) | Thin vine wrapped around the ring, short side sprouts | **Tropism walkers** hugging `|p| = R` |
| Each previous take | Bold branching plant from a hidden origin, filling a crown / wing / wedge | **Space colonisation** inside the layout envelope, in wing space |

Space colonisation is the natural fit for take plants: one trunk, branches that fill a given shape
without crossing, and the shape (envelope) is exactly what changes between the 2-, 3- and 4+-layer
layouts. Attractors are fed in over time from that take's audio (louder → attractors further out
toward the envelope edge; onsets → a new cluster), so each plant grows with its take. Branch width
follows the pipe model (`w_parent² ≈ Σ w_child²`) to get the bold trunk-to-tip taper in the sketches.

1. **Build the shared backbone first:** a CPU `Grower` that owns a segment graph (`birth`, width,
   kind, parent, take) in a local frame, and a GPU instanced-capsule renderer with birth-time
   reveal, taper, and a **per-take transform** (origin, rotation, scale) for layout and spinning.
2. **Live halo vine: tropism walkers** around the ring, budget-driven by level, forking on onsets.
   This alone has to make a single live track look complete.
3. **Take plants: space colonisation** in wing space with the three envelopes (crown, wing, wedge)
   and the layout rule from §1.5, including animated re-layout when the take count changes.
4. **Lifecycle:** segment cap + oldest-branch wither, and retract-on-silence as an option.
5. **Motion:** vertex-shader sway/tremble first; spring chains only if it looks stiff. Slow spin for
   many takes.
6. **Then add, in order of payoff:** leaves/buds along stems, phyllotaxis flowers on loud/high
   moments (the "shine" moment), tiered "biblically accurate" layouts for 7+ takes,
   differential-growth ring as a hero theme for the live halo, L-system / authored ornaments for
   thorn and wreath themes, reaction–diffusion/frost last.
6. **Prototype cheaply:** the generators are pure 2D geometry, so they can be tried in a small
   Python or p5.js sketch driven by the `bench/` WAV files before porting to C++.

Open questions for later: whether growth should be deterministic per song (seed + playhead, so
retakes match), how takes' vines should interact (intertwine for harmony — deferred with the other
harmony visuals), and which growth scalars to forward to VTube Studio parameters.

---

## Sources

- Runions, Lane, Prusinkiewicz — [Modeling Trees with a Space Colonization Algorithm (2007, PDF)](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.pdf) · [paper page](https://www.algorithmicbotany.org/papers/colonization.egwnp2007.html)
- Pirk et al. 2012 — [Plastic Trees / skeleton-based tree modelling (PDF)](https://cs.purdue.edu/homes/bbenes/papers/Pirk12ToG.pdf)
- Prusinkiewicz & Lindenmayer — [The Algorithmic Beauty of Plants (free PDF)](https://algorithmicbotany.org/papers/abop/abop.pdf) · Hanan — [Parametric L-systems dissertation (PDF)](https://www.algorithmicbotany.org/papers/hanan.dis1992.pdf) · [L-system Explorer (GitHub)](https://github.com/Lowclouds/lsystem)
- Thomas Luft — [An Ivy Generator](https://graphics.uni-konstanz.de/~luft/ivy_generator/) · [80.lv write-up](https://80.lv/articles/an-ivy-generator-by-thomas-luft) · [Blender Ivy Gen add-on](https://www.blender.org/manual/en/addons/add_curve/ivy_gen.html)
- Jason Webb — [Exploring 2D differential growth with JavaScript](https://medium.com/@jason.webb/2d-differential-growth-in-js-1843fd51b0ce) · inconvergent — [Shepherding random growth](https://inconvergent.net/2016/shepherding-random-growth) · [Differential growth overview](https://generative-art-site.pages.dev/growth/differential_growth)
- DreamWorks — [Puss in Boots beanstalk growth (PDF)](https://research.dreamworks.com/wp-content/uploads/2018/07/PussInBoots_Beanstalk_DWA_2012.pdf)
- [Grow anything with Unity Shader Graph (realtimevfx)](https://realtimevfx.com/t/grow-anything-with-unity-shader-graph-grow-vines-and-trees-for-example/16642) · [kinnaraa — real-time vines with tropism](https://kinnaraa.itch.io/vines) · [Curvature-directed rendering (GPU curve tracing)](https://matthiasbroske.github.io/curvature-rendering.html)
- Inigo Quilez — [2D distance functions](https://iquilezles.org/articles/distfunctions2d) (capsule, uneven capsule, bezier SDFs used for strokes and leaves)
