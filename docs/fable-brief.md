# Design consult brief for Claude Fable 5.2

For: Claude Fable 5.2, as a design consultant. From: the Sprout Visualizer project.

Two related questions, both about the visuals, both to be answered precisely enough that we can
implement them in our existing renderer without guesswork:

- **Part A — the take plant itself (please answer first).** Redesign how the background trees
  (one per recorded take) are generated and grown. Our current trees curl around the avatar and
  look cramped; the artist wants splayed, free, wing-like trees.
- **Part B — the commit transition.** When a take finishes recording, its halo should *unwind and
  stamp itself* into its new place as that take's tree.

Part B lands on the tree from Part A, so the two should fit together (e.g. the unwound strand
could become the spine of the new tree).

---

## Shared context

### What Sprout is (context in one minute)

Sprout is a live-streaming overlay for a VTuber who sings in layered takes. It is a glowing,
audio-reactive visual drawn **behind the avatar** (VTube Studio model) in OBS:

- **The live take** (the track being sung/recorded right now) is a **halo**: a glowing ring around
  the avatar's head with a vine endlessly growing round it (leaves / thorns / Christmas-wreath
  themes). When nothing is recording, the halo rests small on top of the head; while recording it
  opens around the head and shoulders. Several live tracks nest as **concentric halos**.
- **Each previous take** (recorded track playing back) is a **plant**: a glowing branching tree
  growing outward from a hidden origin behind the avatar, placed like **wings** — 1 take = a crown
  above, 2 = left/right wings, 3+ = evenly spaced fans, 7+ = two tiers ("biblically accurate").
- The look is a **"light construct"**: thin glowing strokes and leaf sprites on a transparent
  background with heavy bloom. Everything is driven by the voice (loudness, onsets, pitch up to F6,
  vibrato, vocal effort, breathiness).

The artist's words about intent: the plants should feel like wings and represent *freedom of
singing*; growth should feel alive; nothing should look like it "ungrows" (retracting looked bad;
fading and regrowing looks good).

## Part A — redesign the take tree ("splayed and free, not a hunchbacked mess")

### A1. What the artist sees and wants

The artist's words: the trees grow *"into a circle around the model, straining against some
invisible boundary"*; they should be *"splayed and like a tree representing freedom, not that
hunchbacked mess"*. Earlier: the takes should read as **wings**, reaching **outward** from behind
the avatar, expressing the freedom of singing. We have tried tightening parameters several times
(narrower fans, shorter or longer reach, less upward sweep); the result is either a cramped clump
inside the halo or a bushy arc that follows the halo's curve. Parameter tuning is not fixing it;
we need a better generative idea.

Our reading of why it fails (please confirm or correct):

1. **The envelope acts as a wall.** Space colonisation fills a fixed region (an annular sector
   from rMin to length, half-angle around the growth direction). Branches fill it evenly and stop
   at its edge, so every tree ends in a smooth arc — concentric with the halo — and reads as a
   blob "pressing" against an invisible boundary.
2. **The keep-out region makes trees hug the avatar.** Attractors inside the head/body region are
   removed, so the trunk (rooted behind the neck) routes around the head and limbs bend along the
   silhouette: the "hunchback".
3. **Uniform fill = no gesture.** Space colonisation gives an even, bushy canopy with no dominant
   limbs, no taper of intent, no negative space — the opposite of "splayed".
4. **Upward sweep (bend) curls side plants around the body**, adding to the encircling look.

### A2. How the tree is built and grown today

- Layout (`viewer/src/layout.ts`): take k of n gets an origin (≈ (0, 0.05), behind the neck; a
  lower origin for a single take), a growth direction φ (1 take: up; 2: left/right wings with a
  small upward tilt; 3+: evenly spaced, straight down left as a gap; 7+: two tiers), a scale, and
  an envelope kind (crown / wing / wedge) with rMin, length, half-angle, bend, taper.
- Structure (`viewer/src/growth/plant.ts`): space colonisation (Runions et al. 2007), run to
  completion when the tree is created: ~150–500 attractors sampled in the envelope (minus the
  keep-out), influence radius ~0.2–0.3, kill ~0.05–0.1, step ~0.02–0.03, small jitter; then
  smoothing passes (chain nodes relaxed toward the midpoint of parent and child), pipe-model widths
  (w_parent^2.4 = Σ w_child^2.4), and per-node distance-from-root ("flex") and distance-to-tip.
- Growth is a *reveal*, not a simulation: per node a threshold (mostly normalised distance from
  root, mixed with a random per-branch order, nudged by pitch toward one side), and segments grow
  along each branch from its base. Nothing un-grows; outer twigs can wither in pauses and regrow.
- Per phrase, optionally a brand-new tree (new seed); old trees fade a few seconds after their
  phrase.
- Audio available per take every frame: loudness, onsets, pitch (to F6), vibrato depth/rate,
  vocal effort (soft…pressed), breathiness.
- Units: halo space, halo ring radius ≈ 1 (open), centred ≈ (0, 0.1); head ≈ circle at (0, 0.2)
  r 0.42; body = capsule below. The canvas shows about ±1.9 units. The avatar is opaque in OBS.

### A3. What we'd like from you for Part A

1. **A shape language**: what a "free, splayed, wing-like" tree is, concretely, at 1, 2, 3, 6 and
   12 takes (silhouette, dominant limbs, branching angles, taper, negative space, how far it
   reaches beyond the halo, how it relates to the avatar without hugging it).
2. **A generation algorithm** that produces that reliably from a seed. Feel free to replace space
   colonisation (e.g. gesture-first: a few curved main limbs, then recursive splay; stochastic
   L-system / turtle with tropisms; space colonisation with an open, outward-biased attractor
   cloud and phototropism; something else). Say why your choice beats the alternatives here.
3. **How it handles the avatar**: the trunk origin is hidden behind the neck; we need trees to
   leave that region quickly and then grow freely, never following the silhouette.
4. **How it maps to our growth model**: per-node reveal order from the root outward, withering of
   outer twigs in pauses, new tree per phrase, pitch steering, effort → thickness. If your
   structure suggests a better reveal (e.g. main limbs first, then splay), describe it.
5. **How audio could shape the structure itself** (optional): e.g. effort → more open angles,
   high pitch → longer upward limbs, soft → drooping, vibrato → finer twigs.
6. **Pseudocode** for the generator (TypeScript-flavoured), producing nodes {x, y, parent, width}
   in the plant's local frame (root at 0, growing along +Y), plus default parameters and the few
   high-level sliders the artist should get (we currently expose: branching, reach, spread, sweep).
7. **A quick test plan**: which seeds / take counts to render to judge it, and what "good" looks
   like in a frame grab.

---

## Part B — the commit transition: unwind and stamp

### B1. The moment to design

**Trigger:** the singer finishes recording a take. In Reaper the track is disarmed, the tap plugin
switches that track from role `live` to role `take`. The viewer sees, in one frame, a layer id that
was a live halo become a take. (A new live halo for the next take may appear at the same moment or
later.)

**What exists now:** the halo of that track simply fades out (0.8 s) and its plant starts growing
from nothing at its layout slot. Functional, but the connection between "the thing I just sang"
and "the plant that now represents it" is lost.

**What was tried and rejected:** the ring was squashed into a thin vertical ellipse (non-uniform
scale), rotated and flown to the plant's origin, then faded while the plant bloomed. The artist:
*"It doesn't look good."* Our read on why: it read as a 2D sprite being squished and dragged — no
sense of the vine itself transforming, no weight, and the halo's identity (its vine, leaves) was
lost in a blur.

**What the artist wants:** *"a good in-depth animation that unwinds the circle and 'stamps' it in
its new place."* So:

1. **Unwind** — the halo's circle should come apart and straighten, like a coiled vine being
   unrolled, rather than being scaled.
2. **Travel** — the unwound strand moves to the take's place in the layout (behind the avatar,
   pointing outward as a wing).
3. **Stamp** — it lands with impact and *becomes* the plant: a decisive moment (a press, a seal, a
   burst) after which the plant is there, not a cross-fade.

Please design this so it feels intentional and musical, and is still legible at stream resolution
(1080p, behind an avatar that hides the centre).

### B2. What we can draw (renderer capabilities, applies to Part A too)

WebGL2 in an OBS Browser Source (Chromium 127; **no WebGPU / compute shaders**). 60 fps target
alongside VTube Studio and OBS on the same GPU; keep it light.

- **Strokes:** instanced tapered capsules (segment A→B with radius rA→rB), anti-aliased signed
  distance in the fragment shader. Each instance: local A/B, radii, "flex" (distance along branch,
  used for sway), RGBA, glow amount, layer index. Thousands per frame are fine.
- **Sprites:** instanced decoration shapes as signed distances: leaf, thorn, berry, pine needle,
  holly leaf, five-petal blossom. Each: position, angle, size, shape, colour, alpha, glow, layer.
- **Layers:** up to 32 per frame; each has an origin + a 2×2 matrix (rotation · scale · squash)
  and sway/tremble motion parameters applied in the vertex shader.
- **Bloom:** strokes and sprites also write a glow-emission target; it is blurred at ½, ¼ and ⅛
  resolution and composited (premultiplied alpha, transparent background).
- **CPU side:** we rebuild instance buffers every frame, so any per-vertex / per-segment
  animation computed in TypeScript is fine (positions can be anything each frame). Extra
  full-screen passes (shockwave distortion, ripples, trails via ping-pong targets) are possible.

### B3. Data we have at the moment of the transition

Coordinates: "halo space", ring radius ≈ 1, origin at the halo centre; y up; avatar head ≈ circle
at (0, 0.2) r 0.42, body = capsule below (keep-out region where nothing is visible in OBS).

**The halo (source):**
- Ring: a circle of radius `R` (≈ 1.05 open, 0.3 resting) centred at `(0, cy)` (≈ 0.1 open).
- Vine (`viewer/src/growth/halo.ts`, class `HaloVine`): built in unit-circle space. One or more
  *tips* (origins spread evenly from a start angle; each origin may grow both ways) creep round the
  ring forever. Each tip trails `tailDeg` (default 300°) of vine; the oldest part fades.
  Nodes: `{id, x, y, parent, flex, width, kind: runner|sprout, arcAt}`; side shoots (sprouts) hang
  off runner nodes. Per node we know growth (0..1) and opacity (tail fade). Typically 400–1500 nodes.
- Decorations on vine nodes and on the ring itself (leaves etc.), hashed on stable node ids.
- Colour/theme of that track; its current drive values (energy, effort, pitch…).

**The plant (destination):**
- Placement (`viewer/src/layout.ts`): origin `(ox, oy)` (≈ (0, 0.05), behind the neck), growth
  direction angle φ, scale, and an envelope (crown / wing / wedge) the branches fill. The layout
  may re-ease when the take count changes (the same transition adds one take, so every plant may
  be rotating to a new angle while this plays).
- Structure (`viewer/src/growth/plant.ts`, class `Plant`): a tree built by space colonisation in
  the plant's local frame (root at 0, growing along +Y), smoothed, pipe-model widths. Per node:
  position, parent, flex (distance from root), width, distance-to-tip. Typically 150–600 nodes.
  Growth is revealed per node (0..1) along each branch from its base; nothing un-grows.
- Generations (`viewer/src/growth/generations.ts`): a take can show a new tree per phrase; old
  trees fade a few seconds after their phrase.

### B4. Constraints and edge cases

1. Duration budget: roughly 1.2–2.5 s total; the singer may start the next take immediately, and a
   new live halo may pop in at the same time (it must not be confused with the departing one).
2. Several live tracks (concentric halos) can commit at once or in sequence.
3. The take count changes, so all existing plants may be re-laying out (rotating to new angles)
   during the animation; the destination moves.
4. The destination can disappear mid-animation (take deleted / track removed).
5. Spin can be enabled (all plants slowly rotating).
6. Themes differ (leaves, thorns, wreath, bare branches) — the animation should carry the halo's
   identity (its vine, its leaves) into the plant.
7. The centre (avatar) is opaque in OBS — anything travelling straight through the middle is
   invisible; paths around or behind the head read better than through it.
8. Must degrade gracefully at low frame rates (time-based, no per-frame state that breaks on a
   100 ms hitch).

### B5. What we'd like from you for Part B

Please give us:

1. **The choreography**, beat by beat with timings and easing (e.g. 0–300 ms "loosen", …), and
   what the viewer should feel at each beat. Tie beats to sound if there is a musically sensible
   hook (e.g. the stamp lands on the next onset of any playing take, with a timeout).
2. **The unwinding geometry**: how a closed ring (plus its vine and side shoots) turns into an open
   strand. For example: cut point choice (where on the ring it opens and why), arc-length
   parameterisation, how the strand straightens over time (curvature decay? a "peel" front moving
   along the ring?), how side shoots and leaves behave while it unwinds.
3. **The travel**: path from the halo to the plant origin (around the head, not through it), how
   the strand orients and how it handles a moving destination.
4. **The stamp**: the impact moment — what happens visually (compression, ring/shockwave in the
   glow buffer, a seal/emblem, leaves bursting outward, a flash), and how the strand *becomes* the
   plant. Specifically: should the strand become the trunk/main limb of the new tree (requiring the
   plant to be built around a given spine), should its nodes be mapped onto the plant's nodes and
   morph, or should the plant grow out of the stamp point as a burst? Recommend one and say why.
5. **Data mapping**: concrete algorithm(s) to map halo vine nodes → strand points → plant nodes
   (counts differ: ~1000 → ~300), including what to do with surplus nodes and leaves.
6. **Pseudocode** against the structures above (TypeScript-flavoured is ideal): a
   `CommitAnimation` that is created with a snapshot of the halo and the target slot id, has
   `update(t, dt, target placement | undefined)` and emits strokes/sprites for each frame, plus any
   changes needed in `Plant` (e.g. "build around this spine").
7. **Parameters** worth exposing as sliders (with sensible ranges), and which ones the artist will
   actually tune.
8. **Two alternatives** in a sentence or two each (e.g. a more restrained version and a more
   theatrical one), so the artist can choose a direction.
9. **Risks**: what is likely to look bad and how to test it quickly (we can fast-forward the
   simulation and capture frames).

Keep both answers implementation-oriented; we will build them directly from your spec. If
Part A changes what the destination looks like (e.g. a spine-first tree), design Part B's stamp to
land on that.

## Files to read (if you have repository access)

- `viewer/src/growth/halo.ts` — the halo vine (source of the animation)
- `viewer/src/growth/plant.ts` — plant structure and reveal (destination)
- `viewer/src/growth/generations.ts` — tree generations per take
- `viewer/src/layout.ts` — where takes go (placements, envelopes)
- `viewer/src/main.ts` — frame loop: halos, slots, drawing, how layers and instances are built
- `viewer/src/deco.ts`, `viewer/src/shaders/*` — decorations and the render pipeline
- `docs/procedural-growth-research.md` — background research and the layout rule
